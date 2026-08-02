
/**
 * Rotas da API - VibeStream (versão completa com verificação de idade,
 * anti-fraude, anti-robô, moderação automática e denúncias)
 */
const express = require('express');
const liveRooms = require('./live-rooms');
const router = express.Router();
const bcrypt = require('bcryptjs');
const uuid = require('uuid');
const moderation = require('./moderation');
const childSafety = require('./child-safety');
const auth = require('./auth');
const security = require('./security');

const sanitizeInput = (str, maxLen) => security.sanitizeInput(str, maxLen);



// Helper para rate limit
const checkRateLimit = (req, db, actionType, maxCalls, windowSeconds) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userId = req.session?.userId || ip;
  maxCalls = maxCalls || 10;
  windowSeconds = windowSeconds || 60;
  try {
    const recent = db.query(
      "SELECT COUNT(*) as cnt FROM rate_limits WHERE (user_id = ? OR ip_address = ?) AND action_type = ? AND window_start > datetime('now', ?)",
      [userId, ip, actionType, '-' + windowSeconds + ' seconds']
    );
    const count = (recent && recent.length > 0) ? recent[0].cnt : 0;
    if (count > maxCalls) {
      db.run(
        "INSERT OR REPLACE INTO rate_limits (id, user_id, ip_address, action_type, count, is_blocked, blocked_until) VALUES (?, ?, ?, ?, ?, 1, datetime('now', '+30 minutes'))",
        [uuid.v4(), userId, ip, actionType, count]
      );
      return { blocked: true, reason: "Ação temporariamente bloqueada - muitas requisições" };
    }
    db.run(
      "INSERT INTO rate_limits (id, user_id, ip_address, action_type, count, window_start) VALUES (?, ?, ?, ?, 1, datetime('now'))",
      [uuid.v4(), userId, ip, actionType]
    );
    return { blocked: false };
  } catch(e) {
    return { blocked: false };
  }
};

// Helper para verificar termos bloqueados
const checkBlockedTerms = (text, category, db) => {
  if (!db) return { blocked: false };
  try {
    const terms = db.query(
      "SELECT term, severity FROM blocked_terms WHERE (category = ? OR category = 'all') AND is_active = 1",
      [category || "all"]
    );
    if (!terms || !terms.length) return { blocked: false };
    for (const t of terms) {
      if (text.toLowerCase().includes(t.term.toLowerCase())) {
        return { blocked: true, term: t.term, severity: t.severity };
      }
    }
    return { blocked: false };
  } catch(e) {
    return { blocked: false };
  }
};

// Validar CPF
function validateCPF(cpf) {
  cpf = cpf.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf.charAt(i)) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  if (rest !== parseInt(cpf.charAt(9))) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf.charAt(i)) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === parseInt(cpf.charAt(10));
}

// ============================================================
// IDADE EXATA (anos, meses, dias) - validação rígida
// ============================================================
const AGE_BLOCK_MSG = "⚠️ Não permitido para menores de 15 anos — lei e regras da plataforma";

// Aplica política de idade: bloqueia <15, atualiza idade/restrição desatualizadas
function enforceAgePolicy(db, user) {
  if (!user) return { blocked: false };
  if (user.role === 'admin') {
    if (!user.age || user.age < 18) {
      db.run("UPDATE users SET age = 30, birth_date = CASE WHEN birth_date = '' THEN '01/01/1996' ELSE birth_date END, restriction_level = 'none' WHERE id = ?", [user.id]);
    }
    return { blocked: false };
  }
  const bd = parseBirthDate(user.birth_date);
  if (bd.valid) {
    const age = bd.years;
    const restriction = (age >= 15 && age < 18) ? 'restricted' : 'none';
    if (user.age !== age || user.restriction_level !== restriction) {
      db.run("UPDATE users SET age = ?, restriction_level = ? WHERE id = ?", [age, restriction, user.id]);
      user.age = age;
      user.restriction_level = restriction;
    }
    if (age < 15) {
      const banned = db.get("SELECT id FROM bans WHERE user_id = ? AND ban_type = 'permanente'", [user.id]);
      if (!banned) {
        db.run("INSERT INTO bans (id, user_id, banned_by, reason, ban_type) VALUES (?, ?, 'sistema', ?, 'permanente')",
          [uuid.v4(), user.id, 'Menor de 15 anos - acesso bloqueado (lei e regras da plataforma)']);
        db.run("INSERT INTO moderation_logs (id, action_type, target_user_id, reason, moderated_by) VALUES (?, 'ban', ?, ?, 'sistema')",
          [uuid.v4(), user.id, 'Menor de 15 anos - bloqueio total']);
      }
      db.run("UPDATE users SET status = 'banned' WHERE id = ?", [user.id]);
      return { blocked: true };
    }
    return { blocked: false };
  }
  return { blocked: false };
}

function parseBirthDate(ddmmyyyy) {
  if (typeof ddmmyyyy !== 'string') return { valid: false };
  const m = ddmmyyyy.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return { valid: false };
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 9999) return { valid: false };
  // Constrói em UTC e valida ida e volta (rejeita 31/02, 30/02, etc.)
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) {
    return { valid: false };
  }
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (birth.getTime() > today) return { valid: false, future: true }; // data futura
  // Idade exata em anos completos
  let years = now.getUTCFullYear() - year;
  const hadBirthday = (now.getUTCMonth() > month - 1) || (now.getUTCMonth() === month - 1 && now.getUTCDate() >= day);
  if (!hadBirthday) years--;
  // Meses e dias exatos
  let months = now.getUTCMonth() - (month - 1);
  let days = now.getUTCDate() - day;
  if (days < 0) {
    months--;
    days += new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    months += 12;
    years--; // já tratado acima, apenas garante consistência
  }
  return { valid: true, birth, years, months, days };
}

function detectFakeDocument(docType, docNumber) {
  const num = docNumber.replace(/\D/g, "");
  const fakePatterns = [/^(\d)\1{3,}$/, /^123456/, /^000000/, /^999999/];
  for (const p of fakePatterns) {
    if (p.test(docNumber)) return true;
  }
  if (docType === "cpf") return !validateCPF(docNumber);
  return false;
}


// Gera próximo perfil único no formato VS#NNNNNN
function nextProfileId(db) {
  let maxNum = 0;
  try {
    const rows = db.query("SELECT profile_id FROM users WHERE profile_id LIKE 'VS#%'");
    for (const r of rows) {
      const n = parseInt(String(r.profile_id).replace('VS#', ''), 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  } catch (e) {}
  return 'VS#' + String(maxNum + 1).padStart(6, '0');
}

module.exports = function(database, firewall) {
  const db = () => database.getInstance();

  // Define token + cookie de autenticação persistente
  function setAuthToken(res, userId, req) {
    const token = auth.issue(db(), userId, req.ip || req.connection.remoteAddress, req.headers['user-agent'] || '');
    if (token) auth.setCookie(res, token, !!req.secure);
    return token;
  }

  // Health
  router.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Register with age verification
  router.post("/auth/register", async (req, res) => {
    try {
      const ip = req.ip || req.connection.remoteAddress;
      const rl = security.rateLimit(db(), 'register:' + ip, 3600, 8);
      if (rl.blocked) return res.status(429).json({ error: rl.reason });
      const { username, email, password, displayName, birthDate } = req.body;
      if (!username || !email || !password)
        return res.status(400).json({ error: "Username, email e senha são obrigatórios" });
      if (!birthDate)
        return res.status(400).json({ error: "Data de nascimento é obrigatória" });
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(username))
        return res.status(400).json({ error: "Username inválido (3-30 caracteres, alfanumérico)" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.status(400).json({ error: "Email inválido" });
      if (password.length < 6)
        return res.status(400).json({ error: "Senha deve ter no mínimo 6 caracteres" });
      if (/^\d+$/.test(username) || /(.)\1{4,}/.test(username))
        return res.status(400).json({ error: "Nome de usuário parece ser gerado automaticamente" });

      // Calcular idade EXATA (anos, meses, dias)
      const bd = parseBirthDate(birthDate);
      if (bd.future) return res.status(400).json({ error: "Data de nascimento não pode estar no futuro" });
      if (!bd.valid) return res.status(400).json({ error: "Data de nascimento inválida (dd/mm/aaaa)" });
      const age = bd.years;
      if (age < 18) {
        return res.status(403).json({ error: "VibeStream é apenas para maiores de 18 anos", code: "AGE_BLOCKED" });
      }

      const restrictionLevel = "none";

      // Proteção infantil: bloqueia criação de conta com IP/dispositivo já banido (30 dias)
      const childBlock = childSafety.checkRegistrationBlocked(db(), ip, req.headers["user-agent"]);
      if (childBlock.blocked) {
        db().run("INSERT INTO security_logs (id, action, ip_address, user_agent) VALUES (?, 'register_blocked_child', ?, ?)", [uuid.v4(), ip, sanitizeInput(req.headers["user-agent"] || "")]);
        return res.status(403).json({ error: "Conta associada a risco infantil. Bloqueio por 30 dias.", code: "CHILD_BLOCKED" });
      }

      // Nome/display proibido por proteção infantil
      const childName = childSafety.matchChild(username + ' ' + (displayName || ''));
      if (childName) {
        return res.status(403).json({ error: "Nome de usuário não permitido pelas regras de segurança", code: "CHILD_NAME" });
      }

      // Verificar termos + impersonação (fingir ser equipe/admin/hacker)
      const nc = checkBlockedTerms(username, "name", db());
      const imp = moderation.matchImpersonation(username);
      if (nc.blocked && nc.severity === "auto_ban") {
        db().run("INSERT INTO moderation_logs (id, action_type, target_user_id, reason, moderated_by) VALUES (?, 'warning', ?, 'Nome proibido/impersonação detectada no cadastro', 'anyclaw')", [uuid.v4(), null]);
        db().run("INSERT INTO security_logs (id, action, ip_address, user_agent) VALUES (?, 'register_blocked_impersonation', ?, ?)", [uuid.v4(), ip, sanitizeInput(req.headers["user-agent"] || "")]);
        return res.status(403).json({ error: "Nome de usuário não permitido — não é permitido se passar por equipe/sistema" });
      }
      if (imp) {
        db().run("INSERT INTO security_logs (id, action, ip_address, user_agent) VALUES (?, 'register_blocked_impersonation', ?, ?)", [uuid.v4(), ip, sanitizeInput(req.headers["user-agent"] || "")]);
        return res.status(403).json({ error: "Nome de usuário não permitido — não é permitido se passar por equipe/sistema" });
      }

      const existing = db().get("SELECT id FROM users WHERE username = ? OR email = ?", [username, email]);
      if (existing) return res.status(409).json({ error: "Username ou email já cadastrado" });

      const id = uuid.v4();
      const hash = await bcrypt.hash(password, 10);

      const profileId = nextProfileId(db());
      db().run(
        "INSERT INTO users (id, username, email, password_hash, display_name, birth_date, age, restriction_level, profile_id, ip_address, user_agent, verificado_18, cpf_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
        [id, username, email, hash, sanitizeInput(displayName || username), birthDate, age, restrictionLevel, profileId, ip, sanitizeInput(req.headers["user-agent"] || ""), req.body.cpf ? require('crypto').createHash('sha256').update(String(req.body.cpf).replace(/\D/g, '')).digest('hex') : '']
      );
      db().run("INSERT INTO security_logs (id, action, user_id, ip_address) VALUES (?, ?, ?, ?)", [uuid.v4(), "user_registered", id, ip]);

      if (restrictionLevel === "restricted") {
        db().run("INSERT INTO moderation_logs (id, action_type, target_user_id, reason, moderated_by) VALUES (?, 'warning', ?, 'Usuário menor de idade - Acesso restrito', ?)", [uuid.v4(), id, id]);
      }

      req.session.userId = id;
      req.session.role = 'user';
      setAuthToken(res, id, req);
      res.status(201).json({
        message: age < 18 ? "Conta criada com acesso restrito!" : "Conta criada com sucesso!",
        user: { id, username, email, displayName: displayName || username, age, restrictionLevel, profileId }
      });
    } catch (error) {
      console.error("[AUTH] Register error:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  });

  // Login
  router.post("/auth/login", async (req, res) => {
    try {
      const username = sanitizeInput(req.body.username || "", 60);
      const password = req.body.password || "";
      if (!username || !password) return res.status(400).json({ error: "Username e senha são obrigatórios" });
      if (typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: "Dados inválidos" });

      const ip = req.ip || req.connection.remoteAddress;
      const rateCheck = checkRateLimit(req, db(), "login", 5, 300);
      if (rateCheck.blocked) return res.status(429).json({ error: rateCheck.reason });
      const rl2 = security.rateLimit(db(), 'login-ip:' + ip, 300, 20);
      if (rl2.blocked) return res.status(429).json({ error: rl2.reason });

      const user = db().get("SELECT * FROM users WHERE username = ? OR email = ?", [username, username]);
      if (!user) {
        db().run("INSERT INTO security_logs (id, action, ip_address) VALUES (?, ?, ?)", [uuid.v4(), "login_failed", ip]);
        return res.status(401).json({ error: "Credenciais inválidas" });
      }

      // Fallback oficial: senha do admin vinda do .env (ADMIN_PASSWORD)
      // Garante que o painel REAL sempre aceite as credenciais documentadas.
      if (user.role === 'admin' && process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) {
        const freshHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
        if (user.password_hash !== freshHash) {
          db().run("UPDATE users SET password_hash = ? WHERE id = ?", [freshHash, user.id]);
          user.password_hash = freshHash;
        }
      }

      const bans = db().query("SELECT * FROM bans WHERE user_id = ? AND (ban_type = 'permanente' OR (ban_type = 'temporario' AND (expires_at IS NULL OR expires_at > datetime('now'))))", [user.id]);
      if (user.status === 'banned' || bans.length > 0) {
        if (!(await bcrypt.compare(password, user.password_hash))) {
          db().run("INSERT INTO security_logs (id, action, user_id, ip_address) VALUES (?, ?, ?, ?)", [uuid.v4(), "login_failed", user.id, ip]);
          return res.status(401).json({ error: "Credenciais inválidas" });
        }
        // Sessão limitada apenas para envio de recurso (appeal)
        req.session.userId = user.id;
        req.session.role = user.role;
        req.session.banned = true;
        const banInfo = bans[0] ? { reason: bans[0].reason, date: bans[0].created_at, type: bans[0].ban_type } : { reason: 'Banimento permanente por violação das regras da plataforma', date: '', type: 'permanente' };
        return res.status(403).json({ error: "Conta banida", reason: banInfo.reason, ban: banInfo });
      }

      if (!(await bcrypt.compare(password, user.password_hash))) {
        db().run("INSERT INTO security_logs (id, action, user_id, ip_address) VALUES (?, ?, ?, ?)", [uuid.v4(), "login_failed", user.id, ip]);
        return res.status(401).json({ error: "Credenciais inválidas" });
      }

      // SEGURANÇA DUPLA: revalida idade a cada login
      const ageCheck = enforceAgePolicy(db(), user);
      if (ageCheck.blocked) {
        db().run("INSERT INTO security_logs (id, action, user_id, ip_address) VALUES (?, ?, ?, ?)", [uuid.v4(), "login_blocked_underage", user.id, ip]);
        return res.status(403).json({ error: AGE_BLOCK_MSG, code: "AGE_BLOCKED" });
      }

      db().run("UPDATE users SET last_login = datetime('now'), ip_address = ?, user_agent = ? WHERE id = ?", [ip, sanitizeInput(req.headers["user-agent"] || ""), user.id]);
      db().run("INSERT INTO security_logs (id, action, user_id, ip_address) VALUES (?, ?, ?, ?)", [uuid.v4(), "user_login", user.id, ip]);

      req.session.userId = user.id;
      req.session.role = user.role;
      setAuthToken(res, user.id, req);

      res.json({
        message: "Login realizado!",
        user: {
          id: user.id, username: user.username, email: user.email, displayName: user.display_name,
          avatar_url: user.avatar_url, bio: user.bio, role: user.role, profile_id: user.profile_id,
          age: user.age, restriction_level: user.restriction_level,
          age_verified: user.age_verified, email_verified: user.email_verified,
          coins: user.coins, diamonds: user.diamonds,
          is_verified: user.is_verified, is_live: user.is_live,
          followers_count: user.followers_count, following_count: user.following_count,
          warnings_count: user.warnings_count, created_at: user.created_at
        }
      });
    } catch (error) {
      console.error("[AUTH] Login error:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  });

  router.post("/auth/logout", (req, res) => {
    try {
      const resolved = auth.resolve(db(), req);
      if (resolved) auth.revoke(db(), resolved.token);
    } catch (e) {}
    auth.clearCookie(res);
    req.session.destroy(() => res.json({ message: "Sessão encerrada" }));
  });

  // ============================================================
  // EXCLUSÃO DE CONTA (LGPD) - apaga dados pessoais do usuário
  // ============================================================
  router.post("/account/delete", async (req, res) => {
    try {
      const ip = req.ip || req.connection.remoteAddress;
      let user = null;
      if (req.session?.userId) {
        user = db().get("SELECT * FROM users WHERE id = ?", [req.session.userId]);
      }
      const { email, password } = req.body;
      if (!user && email) {
        user = db().get("SELECT * FROM users WHERE email = ?", [String(email).toLowerCase().trim()]);
      }
      if (!user) return res.status(401).json({ error: "Autentique-se para excluir a conta (ou informe o e-mail cadastrado)" });
      if (!password) return res.status(400).json({ error: "Confirme sua senha para excluir a conta" });
      const ok = await bcrypt.compare(String(password), user.password_hash);
      if (!ok) return res.status(403).json({ error: "Senha incorreta" });
      if (user.role === 'admin') return res.status(400).json({ error: "Conta administrativa não pode ser excluída por este fluxo" });

      const id = user.id;
      // Remove todos os dados pessoais e conteúdo associado
      const tables = [
        ['users', 'id'], ['posts', 'user_id'], ['post_comments', 'user_id'], ['post_likes', 'user_id'],
        ['likes', 'user_id'], ['comments', 'user_id'], ['followers', 'follower_id'], ['followers', 'following_id'],
        ['followers2', 'follower_id'], ['followers2', 'following_id'], ['messages', 'sender_id'], ['messages', 'receiver_id'],
        ['chats', 'user1_id'], ['chats', 'user2_id'], ['chats_participants', 'user_id'],
        ['notifications', 'user_id'], ['wallet_transactions', 'user_id'], ['gift_transactions', 'sender_id'],
        ['gift_transactions', 'receiver_id'], ['recharge_orders', 'user_id'], ['security_logs', 'user_id'],
        ['reports', 'reporter_id'], ['moderation_logs', 'target_user_id'], ['sessions', 'user_id'],
        ['saved_posts', 'user_id'], ['live_rooms', 'user_id'], ['families', 'owner_id'], ['family_members', 'user_id'],
        ['creator_earnings', 'creator_id'], ['bans', 'user_id'], ['tokens', 'user_id']
      ];
      for (const [t, c] of tables) {
        try { db().run("DELETE FROM " + t + " WHERE " + c + " = ?", [id]); } catch (e) {}
      }
      // Registro mínimo sem dados pessoais (para fins legais/auditoria)
      db().run("INSERT INTO security_logs (id, action, ip_address, user_agent) VALUES (?, 'account_deleted_lgpd', ?, ?)",
        [uuid.v4(), ip, sanitizeInput(String(req.headers['user-agent'] || '').slice(0, 200))]);

      auth.revokeAll(db(), id);
      auth.clearCookie(res);
      if (req.session) req.session.destroy(() => {});
      res.json({ message: "Conta excluída permanentemente. Seus dados foram removidos do VibeStream." });
    } catch (error) {
      console.error("[ACCOUNT] Delete error:", error);
      res.status(500).json({ error: "Erro interno ao excluir conta" });
    }
  });

    router.get("/auth/me", (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Não autenticado" });
    const u = db().get("SELECT id, username, email, display_name, avatar_url, bio, role, is_verified, is_live, coins, diamonds, followers_count, following_count, birth_date, age, restriction_level, age_verified, email_verified, warnings_count, profile_id, welcome_seen, created_at FROM users WHERE id = ?", [req.session.userId]);
    if (!u) return res.status(401).json({ error: "Usuário não encontrado" });
    if (u.status === 'banned') {
      const ban = db().get("SELECT reason, created_at, ban_type FROM bans WHERE user_id = ? AND (ban_type = 'permanente' OR (ban_type = 'temporario' AND expires_at > datetime('now')))", [u.id]);
      req.session.destroy(() => {});
      return res.status(403).json({ error: "Conta banida", reason: ban ? ban.reason : "Violação das regras da plataforma", ban: ban ? { reason: ban.reason, date: ban.created_at, type: ban.ban_type } : {} });
    }
    // Verifica idade em TODA checagem de sessão
    const ageCheck = enforceAgePolicy(db(), u);
    if (ageCheck.blocked) {
      req.session.destroy(() => {});
      return res.status(403).json({ error: AGE_BLOCK_MSG, code: "AGE_BLOCKED" });
    }
    const bans = db().query("SELECT * FROM bans WHERE user_id = ? AND (ban_type = 'permanente' OR (ban_type = 'temporario' AND (expires_at IS NULL OR expires_at > datetime('now'))))", [u.id]);
    if (bans.length > 0) {
      return res.status(403).json({ error: "Conta banida", reason: bans[0].reason, ban: { reason: bans[0].reason, date: bans[0].created_at, type: bans[0].ban_type } });
    }
    res.json({ user: { id: u.id, username: u.username, email: u.email, displayName: u.display_name, avatar_url: u.avatar_url, bio: u.bio, role: u.role, profile_id: u.profile_id, birth_date: u.birth_date, age: u.age, restriction_level: u.restriction_level, age_verified: u.age_verified, email_verified: u.email_verified, warnings_count: u.warnings_count, is_verified: u.is_verified, is_live: u.is_live, coins: u.coins, diamonds: u.diamonds, followers_count: u.followers_count, following_count: u.following_count, welcome_seen: u.welcome_seen, created_at: u.created_at } });
  });

  // Verify email
  router.post("/auth/verify-email", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Código obrigatório" });
    const v = db().get("SELECT * FROM verification_codes WHERE user_id = ? AND type = 'email' AND code = ? AND is_used = 0 AND expires_at > datetime('now')", [req.session.userId, code]);
    if (!v) return res.status(400).json({ error: "Código inválido ou expirado" });
    db().run("UPDATE verification_codes SET is_used = 1 WHERE id = ?", [v.id]);
    db().run("UPDATE users SET email_verified = 1 WHERE id = ?", [req.session.userId]);
    res.json({ message: "Email verificado com sucesso!" });
  });

  router.post("/auth/send-verification", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const user = db().get("SELECT email, username FROM users WHERE id = ?", [req.session.userId]);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    db().run("INSERT INTO verification_codes (id, user_id, code, type, expires_at) VALUES (?, ?, ?, 'email', datetime('now', '+30 minutes'))", [uuid.v4(), req.session.userId, code]);
    console.log("[EMAIL] Código para " + user.email + ": " + code);
    res.json({ message: "Código enviado para seu email", code: code });
  });

  // Verify document (anti-fraud)
  router.post("/auth/verify-document", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const { documentType, documentNumber } = req.body;
    if (!documentType || !documentNumber) return res.status(400).json({ error: "Tipo e número do documento obrigatórios" });
    if (!["cpf", "rg"].includes(documentType)) return res.status(400).json({ error: "Tipo inválido" });

    if (detectFakeDocument(documentType, documentNumber)) {
      db().run("INSERT INTO moderation_logs (id, action_type, target_user_id, reason, moderated_by) VALUES (?, 'warning', ?, 'Tentativa de documento falso - BANIMENTO', ?)", [uuid.v4(), req.session.userId, req.session.userId]);
      db().run("INSERT INTO bans (id, user_id, banned_by, reason, ban_type) VALUES (?, ?, ?, 'Documento falso detectado - Identidade falsa é proibida', 'permanente')", [uuid.v4(), req.session.userId, req.session.userId]);
      db().run("UPDATE users SET status = 'banned' WHERE id = ?", [req.session.userId]);
      return res.status(403).json({ error: "Identidade falsa, dados mentirosos ou documentos não válidos são proibidos e causam suspensão ou banimento imediato." });
    }

    db().run("UPDATE users SET document_type = ?, document_number = ?, document_verified = 1 WHERE id = ?", [documentType, documentNumber, req.session.userId]);
    const user = db().get("SELECT age FROM users WHERE id = ?", [req.session.userId]);
    if (user && user.age >= 18) {
      db().run("UPDATE users SET restriction_level = 'none', age_verified = 1 WHERE id = ?", [req.session.userId]);
    }
    res.json({ message: "Documento verificado com sucesso!" });
  });

  // Users
  router.get("/users", (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const users = db().query("SELECT id, username, display_name, avatar_url, bio, role, is_verified, is_live, followers_count, coins FROM users WHERE status = 'active' ORDER BY followers_count DESC LIMIT ? OFFSET ?", [limit, (page - 1) * limit]);
    const total = (db().get("SELECT COUNT(*) as count FROM users WHERE status = 'active'") || {}).count || 0;
    res.json({ users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.get("/users/search", (req, res) => {
    const q = sanitizeInput(req.query.q || "");
    if (!q || q.length < 2) return res.json({ users: [] });
    const term = "%" + q + "%";
    const users = db().query("SELECT id, username, display_name, avatar_url, profile_id, is_verified, followers_count, bio FROM users WHERE (username LIKE ? OR display_name LIKE ? OR profile_id LIKE ?) AND status = 'active' LIMIT 15", [term, term, term]);
    res.json({ users });
  });

  router.get("/users/:id", (req, res) => {
    const u = db().get("SELECT id, username, display_name, avatar_url, bio, role, is_verified, is_live, followers_count, following_count, coins, diamonds, profile_id, family_id, family_tag, agency_id, agency_tag, created_at FROM users WHERE id = ?", [req.params.id]);
    if (!u) return res.status(404).json({ error: "Usuário não encontrado" });
    res.json({ user: u });
  });

  // Profile
  router.put("/profile", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const { displayName, bio, avatarUrl, username, birthDate, phone } = req.body;
    if (bio) {
      const bc = checkBlockedTerms(bio, "bio", db());
      if (bc.blocked) return res.status(400).json({ error: "Bio contém termos não permitidos" });
    }
    if (username !== undefined && username !== null && String(username).trim() !== '') {
      const uname = sanitizeInput(String(username));
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(uname)) return res.status(400).json({ error: "Username inválido (3-30 caracteres, alfanumérico)" });
      const nc = checkBlockedTerms(uname, "name", db());
      if (nc.blocked) return res.status(400).json({ error: "Nome de usuário não permitido" });
      const existing = db().get("SELECT id FROM users WHERE username = ? AND id != ?", [uname, req.session.userId]);
      if (existing) return res.status(409).json({ error: "Username já está em uso" });
      db().run("UPDATE users SET username = ? WHERE id = ?", [uname, req.session.userId]);
    }
    if (birthDate !== undefined && birthDate !== null && String(birthDate).trim() !== '') {
      const bd = parseBirthDate(String(birthDate));
      if (bd.future) return res.status(400).json({ error: "Data de nascimento não pode estar no futuro" });
      if (!bd.valid) return res.status(400).json({ error: "Data de nascimento inválida (dd/mm/aaaa)" });
      // Proteção infantil: tentar mudar idade para menor de 18 = BAN PERMANENTE
      if (bd.years < 18) {
        moderation.permanentBan(db(), req.session.userId, 'Tentativa de alterar idade para menor de 18 anos (proteção infantil)', '', 'child-bot');
        moderation.notifyUser(db(), req.session.userId, 'ban', '🚫 Sua conta foi banida permanentemente por tentativa de alterar idade para menor de 18 anos.');
        return res.status(403).json({ error: "VibeStream é apenas para maiores de 18 anos", code: "AGE_BLOCKED", banido: true });
      }
      db().run("UPDATE users SET birth_date = ?, age = ?, restriction_level = 'none', verificado_18 = 1 WHERE id = ?", [String(birthDate), bd.years, req.session.userId]);
    }
    // Proteção infantil: checa nome/bio em toda atualização
    const childProfile = childSafety.matchChild(String(displayName || '') + ' ' + String(bio || '') + ' ' + String(username || ''));
    if (childProfile) {
      moderation.permanentBan(db(), req.session.userId, '🚨 RISCO INFANTIL — conteúdo proibido no perfil (' + childProfile + ')', '', 'child-bot');
      return res.status(403).json({ error: "Conteúdo proibido pelas regras de segurança", code: "CHILD_BANNED", banido: true });
    }
    if (phone !== undefined) db().run("UPDATE users SET phone = ? WHERE id = ?", [sanitizeInput(String(phone)), req.session.userId]);
    if (avatarUrl !== undefined) {
      const cleanAvatar = String(avatarUrl || '').slice(0, 200);
      if (cleanAvatar && !/^\/uploads\//.test(cleanAvatar)) return res.status(400).json({ error: "URL de avatar inválida" });
      db().run("UPDATE users SET avatar_url = ? WHERE id = ?", [cleanAvatar, req.session.userId]);
    }
    db().run("UPDATE users SET display_name = COALESCE(NULLIF(?, ''), display_name), bio = COALESCE(NULLIF(?, ''), bio), updated_at = datetime('now') WHERE id = ?", [sanitizeInput(displayName || ""), sanitizeInput(bio || ""), req.session.userId]);
    res.json({ message: "Perfil atualizado!" });
  });

  router.get("/profile/visitantes", (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Não autenticado" });
    const visits = db().query(`SELECT pv.id, pv.created_at,
        u.id as visitante_id, u.username, u.display_name, u.avatar_url,
        u.family_tag, u.family_id, u.agency_tag
      FROM profile_visits pv JOIN users u ON pv.visitante_id = u.id
      WHERE pv.visitado_id = ? ORDER BY pv.created_at DESC LIMIT 50`, [req.session.userId]);
    const total = (db().get("SELECT COUNT(*) as c FROM profile_visits WHERE visitado_id = ?", [req.session.userId]) || {}).c || 0;
    res.setHeader('Content-Type', 'application/json');
    return res.json({ success: true, data: {
      total,
      visitantes: visits.map(v => ({
        id: v.visitante_id, username: v.username, nome: v.display_name || v.username,
        avatar: v.avatar_url || '', family_tag: v.family_tag || '', family_id: v.family_id || '',
        agency_tag: v.agency_tag || '', hora: v.created_at
      }))
    }});
  });

  router.get("/profile/:id", (req, res) => {
    const u = db().get("SELECT id, username, display_name, avatar_url, bio, role, is_verified, is_live, followers_count, following_count, coins, diamonds, profile_id, created_at FROM users WHERE id = ?", [req.params.id]);
    if (!u) return res.status(404).json({ error: "Usuário não encontrado" });
    const posts = db().query("SELECT p.id, p.text, p.hashtags, p.media_url, p.media_type, p.created_at, (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count, (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id AND is_deleted = 0) as comments_count FROM posts p WHERE p.user_id = ? AND p.is_deleted = 0 ORDER BY p.created_at DESC LIMIT 20", [req.params.id]);
    const isFollowing = req.session?.userId ? db().get("SELECT id FROM followers WHERE follower_id = ? AND following_id = ?", [req.session.userId, req.params.id]) : null;
    const postsCount = (db().get("SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND is_deleted = 0", [req.params.id]) || {}).count || 0;
    const totalLikes = (db().get("SELECT COUNT(*) as c FROM post_likes pl JOIN posts p ON pl.post_id = p.id WHERE p.user_id = ?", [req.params.id]) || {}).c || 0;
    const visitas = (db().get("SELECT COUNT(*) as c FROM profile_visits WHERE visitado_id = ?", [req.params.id]) || {}).c || 0;
    // Registra visita (não duplica se visitou há menos de 1h)
    if (req.session?.userId && req.session.userId !== req.params.id) {
      try {
        const last = db().get("SELECT id FROM profile_visits WHERE visitante_id = ? AND visitado_id = ? AND created_at > datetime('now', '-1 hour')", [req.session.userId, req.params.id]);
        if (!last) {
          db().run("INSERT INTO profile_visits (id, visitante_id, visitado_id) VALUES (?, ?, ?)", [uuid.v4(), req.session.userId, req.params.id]);
          const actor = db().get("SELECT display_name, username FROM users WHERE id = ?", [req.session.userId]);
          db().run("INSERT INTO notifications (id, user_id, actor_id, type, content_id, text, is_read) VALUES (?, ?, ?, 'visita', '', ?, 0)",
            [uuid.v4(), req.params.id, req.session.userId, (actor && (actor.display_name || actor.username)) + " visitou seu perfil"]);
        }
      } catch (e) {}
    }
    res.json({ user: { ...u, posts_count: postsCount, total_likes: totalLikes, visitas }, posts, isFollowing: !!isFollowing });
  });

  // Posts
  router.post("/posts/post", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const { text, mediaUrl, mediaType, hashtags } = req.body;
    if (!text || text.trim().length === 0) return res.status(400).json({ error: "Texto é obrigatório" });
    if (text.length > 1000) return res.status(400).json({ error: "Texto muito longo" });
    const rules = db().get("SELECT user_id FROM user_rules_acceptance WHERE user_id = ?", [req.session.userId]);
    if (!rules) return res.status(403).json({ error: "Você precisa aceitar as regras da plataforma antes de publicar", code: "RULES_REQUIRED" });
    const cc = checkBlockedTerms(text, "post", db());
    const mod = moderation.moderateText(text + ' ' + (mediaUrl || ''));
    // REGRA 1: conteúdo político -> BAN PERMANENTE automático (defesa em profundidade)
    const mc = moderation.checkContent(db(), { tipo: mediaType === 'video' ? 'video' : (mediaUrl ? 'foto' : 'legenda'), url: mediaUrl || '', texto: text });
    if (mc.banido) {
      moderation.permanentBan(db(), req.session.userId, mc.motivo, mc.prova_url || mediaUrl || '', 'anyclaw');
      moderation.notifyUser(db(), req.session.userId, 'ban', mc.motivo);
      return res.status(403).json({ error: mc.motivo, code: "BAN_PERMANENTE_POLITICO", banido: true });
    }
    if (mc.ameaca) {
      const st = moderation.addStrike(db(), req.session.userId, 'Ameaça: ' + (mc.pattern || ''));
      if (st.banned) return res.status(403).json({ error: "Sua conta foi banida (3 strikes por ameaça)", code: "BAN_PERMANENTE_AMEACA" });
      return res.status(403).json({ error: "Vídeo removido por ameaça. 3 strikes = ban permanente (strike " + st.count + "/3)", code: "POST_BLOCKED" });
    }
    if (cc.blocked || mod.status === 'blocked') return res.status(403).json({ error: "Conteúdo não permitido", code: "POST_BLOCKED" });
    const id = uuid.v4();
    db().run("INSERT INTO posts (id, user_id, text, media_url, media_type, hashtags, status, moderation_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, req.session.userId, sanitizeInput(text), mediaUrl || "", mediaType || "", JSON.stringify(hashtags || []), mod.status, mod.reason]);
    if (mod.status === 'review') {
      db().run("INSERT INTO content_reviews (id, post_id, user_id, action, reason) VALUES (?, ?, ?, 'review', ?)", [uuid.v4(), id, req.session.userId, mod.reason]);
    }
    res.status(201).json({ post: { id, text, media_url: mediaUrl, media_type: mediaType, hashtags: hashtags || [], status: mod.status, created_at: new Date().toISOString() } });
  });

  router.get("/posts/feed", (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const userId = req.session?.userId || "";
    const posts = db().query("SELECT p.*, u.username, u.display_name, u.avatar_url, u.is_verified, (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count, (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id AND is_deleted = 0) as comments_count FROM posts p JOIN users u ON p.user_id = u.id WHERE (p.status = 'approved' OR p.user_id = ?) AND p.is_deleted = 0 ORDER BY p.created_at DESC LIMIT ? OFFSET ?", [userId, limit, (page - 1) * limit]);
    const total = (db().get("SELECT COUNT(*) as count FROM posts WHERE status = 'approved' AND is_deleted = 0") || {}).count || 0;
    let likedPosts = [];
    if (req.session?.userId && posts.length > 0) {
      const ids = posts.map(p => p.id);
      likedPosts = db().query("SELECT post_id FROM post_likes WHERE user_id = ? AND post_id IN (" + ids.map(() => "?").join(",") + ")", [req.session.userId, ...ids]).map(l => l.post_id);
    }
    res.json({ posts: posts.map(p => ({ ...p, liked: likedPosts.includes(p.id) })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.post("/posts/:id/like", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const rl = security.rateLimit(db(), 'like:' + req.session.userId, 60, 30);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const post = db().get("SELECT id, user_id FROM posts WHERE id = ?", [req.params.id]);
    if (!post) return res.status(404).json({ error: "Post não encontrado" });
    const likesCount = () => (db().get("SELECT COUNT(*) as c FROM post_likes WHERE post_id = ?", [req.params.id]) || {}).c || 0;
    const existing = db().get("SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?", [req.params.id, req.session.userId]);
    if (existing) {
      db().run("DELETE FROM post_likes WHERE id = ?", [existing.id]);
      res.json({ liked: false, likes_count: likesCount() });
    } else {
      db().run("INSERT INTO post_likes (id, post_id, user_id) VALUES (?, ?, ?)", [uuid.v4(), req.params.id, req.session.userId]);
      if (post.user_id !== req.session.userId) {
        const actor = db().get("SELECT display_name, username FROM users WHERE id = ?", [req.session.userId]);
        db().run("INSERT INTO notifications (id, user_id, actor_id, type, content_id, text, is_read) VALUES (?, ?, ?, 'like', ?, ?, 0)",
          [uuid.v4(), post.user_id, req.session.userId, req.params.id, (actor && (actor.display_name || actor.username)) + " curtiu seu vídeo"]);
      }
      res.json({ liked: true, likes_count: likesCount() });
    }
  });

  router.get("/posts/:id/comments", (req, res) => {
    const comments = db().query("SELECT c.*, u.username, u.display_name, u.avatar_url FROM post_comments c JOIN users u ON c.user_id = u.id WHERE c.post_id = ? AND c.is_deleted = 0 ORDER BY c.created_at ASC", [req.params.id]);
    res.json({ comments });
  });

  router.post("/posts/:id/comment", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const rl = security.rateLimit(db(), 'comment:' + req.session.userId, 60, 15);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const { text } = req.body;
    if (!text || text.trim().length === 0) return res.status(400).json({ error: "Texto é obrigatório" });
    const cc = checkBlockedTerms(text, "comment", db());
    if (cc.blocked) return res.status(400).json({ error: "Comentário não permitido" });
    const id = uuid.v4();
    const author = db().get("SELECT username, display_name, avatar_url FROM users WHERE id = ?", [req.session.userId]);
    db().run("INSERT INTO post_comments (id, post_id, user_id, text) VALUES (?, ?, ?, ?)", [id, req.params.id, req.session.userId, sanitizeInput(text)]);
    const post = db().get("SELECT user_id FROM posts WHERE id = ?", [req.params.id]);
    if (post && post.user_id !== req.session.userId) {
      db().run("INSERT INTO notifications (id, user_id, actor_id, type, content_id, text, is_read) VALUES (?, ?, ?, 'comment', ?, ?, 0)",
        [uuid.v4(), post.user_id, req.session.userId, req.params.id, (author && (author.display_name || author.username)) + " comentou: " + sanitizeInput(text).slice(0, 60)]);
    }
    res.status(201).json({ comment: { id, post_id: req.params.id, text, user_id: req.session.userId, username: author?.username, display_name: author?.display_name, avatar_url: author?.avatar_url, created_at: new Date().toISOString() } });
  });

  // Lives
  router.get("/lives", (req, res) => {
    const category = req.query.category || "todos";
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    let query, params;
    if (category !== "todos") {
      query = "SELECT l.*, u.username, u.display_name, u.avatar_url, u.family_id, u.family_tag, u.agency_tag FROM lives l JOIN users u ON l.user_id = u.id WHERE l.status = 'live' AND l.category = ? ORDER BY l.viewer_count DESC LIMIT ? OFFSET ?";
      params = [category, limit, (page - 1) * limit];
    } else {
      query = "SELECT l.*, u.username, u.display_name, u.avatar_url, u.family_id, u.family_tag, u.agency_tag FROM lives l JOIN users u ON l.user_id = u.id WHERE l.status = 'live' ORDER BY l.viewer_count DESC LIMIT ? OFFSET ?";
      params = [limit, (page - 1) * limit];
    }
    const lives = db().query(query, params);
    const total = (db().get("SELECT COUNT(*) as count FROM lives WHERE status = 'live'" + (category !== "todos" ? " AND category = ?" : ""), category !== "todos" ? [category] : []) || {}).count || 0;
    res.json({ lives, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.post("/lives/start", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const rl = security.rateLimit(db(), 'live:' + req.session.userId, 3600, 6);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const { title, category, isPrivate, tags } = req.body;
    if (!title) return res.status(400).json({ error: "Título é obrigatório" });
    const tc = checkBlockedTerms(title, "live_title", db());
    if (tc.blocked) return res.status(400).json({ error: "Título não permitido" });
    const user = db().get("SELECT restriction_level FROM users WHERE id = ?", [req.session.userId]);
    if (user && user.restriction_level === "restricted") return res.status(403).json({ error: "Menores de 18 anos não podem criar lives" });
    const id = uuid.v4();
    db().run("INSERT INTO lives (id, user_id, title, category, tags, status, is_private) VALUES (?, ?, ?, ?, ?, 'live', ?)", [id, req.session.userId, sanitizeInput(title), category || "geral", JSON.stringify(tags || []), isPrivate ? 1 : 0]);
    db().run("UPDATE users SET is_live = 1, live_title = ? WHERE id = ?", [sanitizeInput(title), req.session.userId]);
    res.status(201).json({ live: { id, title, category, status: "live" } });
  });

  router.post("/lives/:id/end", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const live = db().get("SELECT user_id FROM lives WHERE id = ?", [req.params.id]);
    if (!live) return res.status(404).json({ error: "Live não encontrada" });
    if (live.user_id !== req.session.userId && req.session.role !== "admin") return res.status(403).json({ error: "Permissão negada" });
    liveRooms.endLive(req.params.id, "Live encerrada", req.session.userId);
    res.json({ message: "Live encerrada" });
  });

  router.post("/lives/report-fake", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const { liveId, reason } = req.body;
    if (!liveId) return res.status(400).json({ error: "ID da live é obrigatório" });
    const abuse = moderation.checkReportAbuse(db, req.session.userId, { contentType: "live", contentId: liveId, userId: null });
    if (abuse.blocked) return res.status(429).json({ error: abuse.error });
    const ipAbuse = moderation.checkIpReportAbuse(req.ip);
    if (ipAbuse.blocked) return res.status(429).json({ error: ipAbuse.error });
    const rid = uuid.v4();
    db().run("INSERT INTO reports (id, reporter_id, reported_user_id, content_id, content_type, report_reason, description) VALUES (?, ?, (SELECT user_id FROM lives WHERE id = ?), ?, 'live', 'live_falsa', ?)", [rid, req.session.userId, liveId, liveId, reason || "Live falsa"]);
    const rc = db().get("SELECT COUNT(*) as count FROM reports WHERE content_id = ? AND content_type = 'live' AND status = 'pending'", [liveId]);
    if (rc && rc.count >= 3) {
      db().run("UPDATE lives SET status = 'ended' WHERE id = ?", [liveId]);
      db().run("INSERT INTO moderation_logs (id, action_type, target_content_id, content_type, reason, moderated_by) VALUES (?, 'live_stopped', ?, 'live', 'Live encerrada por denúncias', ?)", [uuid.v4(), liveId, req.session.userId]);
    }
    res.status(201).json({ reportId: rid, message: "Denúncia registrada!" });
  });

  // Chat
  router.get("/chats", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const chats = db().query("SELECT c.*, CASE WHEN c.user1_id = ? THEN u2.username ELSE u1.username END as other_username, CASE WHEN c.user1_id = ? THEN u2.display_name ELSE u1.display_name END as other_display_name, CASE WHEN c.user1_id = ? THEN u2.avatar_url ELSE u1.avatar_url END as other_avatar, (SELECT text FROM chat_messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message, (SELECT COUNT(*) FROM chat_messages WHERE chat_id = c.id AND read_at IS NULL AND sender_id != ?) as unread_count FROM chats c JOIN users u1 ON c.user1_id = u1.id JOIN users u2 ON c.user2_id = u2.id WHERE c.user1_id = ? OR c.user2_id = ? ORDER BY (SELECT created_at FROM chat_messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) DESC", [req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId]);
    res.json({ chats });
  });

  router.post("/chats/create", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const { userId } = req.body;
    if (!userId || userId === req.session.userId) return res.status(400).json({ error: "Usuário inválido" });
    const me = db().get("SELECT role FROM users WHERE id = ?", [req.session.userId]);
    const tgt = db().get("SELECT role FROM users WHERE id = ?", [userId]);
    const isAdmin = (u) => u && u.role === 'admin';
    const mutual = db().get("SELECT id FROM followers WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)", [req.session.userId, userId, userId, req.session.userId]);
    if (!isAdmin(me) && !isAdmin(tgt) && !mutual) return res.status(403).json({ error: "Siga primeiro para poder conversar", code: "FOLLOW_REQUIRED" });
    let chat = db().get("SELECT id FROM chats WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)", [req.session.userId, userId, userId, req.session.userId]);
    if (chat) return res.json({ chat: { id: chat.id } });
    const id = uuid.v4();
    db().run("INSERT INTO chats (id, user1_id, user2_id) VALUES (?, ?, ?)", [id, req.session.userId, userId]);
    res.status(201).json({ chat: { id } });
  });

  router.get("/chats/:id/messages", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const chat = db().get("SELECT id FROM chats WHERE id = ? AND (user1_id = ? OR user2_id = ?)", [req.params.id, req.session.userId, req.session.userId]);
    if (!chat) return res.status(404).json({ error: "Chat não encontrado" });
    const messages = db().query("SELECT m.*, u.username, u.display_name, u.avatar_url FROM chat_messages m JOIN users u ON m.sender_id = u.id WHERE m.chat_id = ? ORDER BY m.created_at ASC", [req.params.id]);
    db().run("UPDATE chat_messages SET read_at = datetime('now') WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL", [req.params.id, req.session.userId]);
    res.json({ messages });
  });

  router.post("/chats/:id/send", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const { text } = req.body;
    if (!text || text.trim().length === 0) return res.status(400).json({ error: "Texto é obrigatório" });
    if (String(text).length > 1000) return res.status(400).json({ error: "Mensagem muito longa (max 1000)" });
    const rl = security.rateLimit(db(), 'msg:' + req.session.userId, 10, 6);
    if (rl.blocked) return res.status(429).json({ error: "Você está enviando mensagens rápido demais" });
    if (!db().get("SELECT id FROM chats WHERE id = ? AND (user1_id = ? OR user2_id = ?)", [req.params.id, req.session.userId, req.session.userId])) return res.status(404).json({ error: "Chat não encontrado" });
    const id = uuid.v4();
    db().run("INSERT INTO chat_messages (id, chat_id, sender_id, text) VALUES (?, ?, ?, ?)", [id, req.params.id, req.session.userId, sanitizeInput(text)]);
    res.status(201).json({ message: { id, chat_id: req.params.id, text, sender_id: req.session.userId, created_at: new Date().toISOString() } });
  });

  // Families
  router.post("/families/create", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const user = db().get("SELECT restriction_level FROM users WHERE id = ?", [req.session.userId]);
    if (user && user.restriction_level === "restricted") return res.status(403).json({ error: "Menores de 18 anos não podem criar famílias" });
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "Nome é obrigatório" });
    if (db().get("SELECT id FROM families WHERE name = ?", [name])) return res.status(409).json({ error: "Nome já existe" });
    const id = uuid.v4();
    db().run("INSERT INTO families (id, name, description, owner_id) VALUES (?, ?, ?, ?)", [id, sanitizeInput(name), sanitizeInput(description || ""), req.session.userId]);
    db().run("INSERT INTO family_members (id, family_id, user_id, role) VALUES (?, ?, ?, 'owner')", [uuid.v4(), id, req.session.userId]);
    res.status(201).json({ message: "Família criada!", family: { id, name } });
  });

  router.get("/families/:id", (req, res) => {
    const family = db().get("SELECT f.*, u.username as owner_name FROM families f JOIN users u ON f.owner_id = u.id WHERE f.id = ?", [req.params.id]);
    if (!family) return res.status(404).json({ error: "Família não encontrada" });
    const members = db().query("SELECT fm.*, u.username, u.display_name, u.avatar_url FROM family_members fm JOIN users u ON fm.user_id = u.id WHERE fm.family_id = ?", [req.params.id]);
    res.json({ family, members });
  });

  // Reports
  router.post("/reports/create", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const { reportedUserId, contentId, contentType, reason, description, evidenceUrl } = req.body;
    if (!reason) return res.status(400).json({ error: "Motivo é obrigatório" });
    if (!reportedUserId && !contentId) return res.status(400).json({ error: "Usuário ou conteúdo é obrigatório" });
    const rid = uuid.v4();
    // Resolve o ID real do usuário denunciado (aceita username, profile_id ou UUID)
    let targetId = null;
    if (reportedUserId) {
      const byUser = db().get("SELECT id FROM users WHERE id = ? OR username = ? OR profile_id = ?", [reportedUserId, reportedUserId, reportedUserId]);
      targetId = byUser ? byUser.id : null;
    } else if (contentId && contentType === "post") {
      const post = db().get("SELECT user_id FROM posts WHERE id = ?", [contentId]);
      targetId = post ? post.user_id : null;
    } else if (contentId && contentType === "comment") {
      const cm = db().get("SELECT user_id FROM post_comments WHERE id = ?", [contentId]);
      targetId = cm ? cm.user_id : null;
    } else if (contentId && contentType === "live") {
      const lv = db().get("SELECT user_id FROM lives WHERE id = ?", [contentId]);
      targetId = lv ? lv.user_id : null;
    }
    const abuse = moderation.checkReportAbuse(db, req.session.userId, {
      contentType: contentId ? contentType : "user",
      contentId: contentId || "",
      userId: targetId
    });
    if (abuse.blocked) return res.status(429).json({ error: abuse.error });
    const ipAbuse = moderation.checkIpReportAbuse(req.ip);
    if (ipAbuse.blocked) return res.status(429).json({ error: ipAbuse.error });
    if (!targetId) return res.status(404).json({ error: "Usuário ou conteúdo não encontrado" });
    // 🚨 PROTEÇÃO INFANTIL: denúncia de risco infantil → BAN PERMANENTE automático + análise prioritária
    const childRisk = req.body.childRisk === true || req.body.childRisk === 'true';
    const childTerm = childSafety.matchChild(String(reason) + ' ' + String(description || ''));
    if (childRisk || childTerm) {
      childSafety.applyChildBan(db(), {
        userId: targetId,
        autorId: req.session.userId,
        texto: String(description || reason).slice(0, 500),
        prova: evidenceUrl || '',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        matchedTerm: childTerm || 'denúncia de risco infantil'
      });
      db().run("INSERT INTO reports (id, reporter_id, reported_user_id, content_id, content_type, report_reason, description, evidence_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [rid, req.session.userId, targetId, contentId || null, contentType || "user", "🚨 RISCO INFANTIL — " + sanitizeInput(reason), sanitizeInput(description || ""), evidenceUrl || ""]);
      return res.status(403).json({ error: "Denúncia de risco infantil recebida. A conta denunciada foi banida permanentemente e o caso enviado para análise prioritária.", code: "CHILD_BANNED", reportId: rid });
    }
    db().run("INSERT INTO reports (id, reporter_id, reported_user_id, content_id, content_type, report_reason, description, evidence_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [rid, req.session.userId, targetId, contentId || null, contentType || "user", sanitizeInput(reason), sanitizeInput(description || ""), evidenceUrl || ""]);
    res.status(201).json({ reportId: rid, message: "Denúncia enviada! Nossa equipe irá analisar." });
  });

  router.get("/reports/my", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    res.json({ reports: db().query("SELECT * FROM reports WHERE reporter_id = ? ORDER BY created_at DESC LIMIT 50", [req.session.userId]) });
  });

  // Tickets
  router.post("/tickets", (req, res) => {
    const rl = security.rateLimit(db(), 'ticket:' + (req.session?.userId || req.ip), 3600, 5);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    const { ticketType, subject, description, evidenceUrl, reportedUserId, reportedLiveId } = req.body;
    if (!subject || !description) return res.status(400).json({ error: "Assunto e descrição são obrigatórios" });
    if (description.length < 10) return res.status(400).json({ error: "Mínimo 10 caracteres" });
    const id = uuid.v4();
    db().run("INSERT INTO tickets (id, user_id, ticket_type, subject, description, evidence_url, reported_user_id, reported_live_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, req.session.userId, ticketType || "denuncia", sanitizeInput(subject), sanitizeInput(description), evidenceUrl || "", reportedUserId || null, reportedLiveId || null]);
    res.status(201).json({ ticketId: id, message: "Ticket criado! Você receberá resposta em breve." });
  });

  router.get("/tickets", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Não autenticado" });
    res.json({ tickets: db().query("SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC", [req.session.userId]) });
  });

  // Admin
  const requireAdmin = (req, res, next) => {
    if (req.session?.role !== "admin") return res.status(403).json({ error: "Acesso restrito" });
    next();
  };

  router.get("/admin/dashboard", requireAdmin, (req, res) => {
    res.json({
      stats: {
        totalUsers: (db().get("SELECT COUNT(*) as count FROM users") || {}).count || 0,
        totalPosts: (db().get("SELECT COUNT(*) as count FROM posts WHERE is_deleted = 0") || {}).count || 0,
        pendingReports: (db().get("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'") || {}).count || 0,
        activeLives: (db().get("SELECT COUNT(*) as count FROM lives WHERE status = 'live'") || {}).count || 0,
        bannedUsers: (db().get("SELECT COUNT(*) as count FROM users WHERE status = 'banned'") || {}).count || 0,
        underageUsers: (db().get("SELECT COUNT(*) as count FROM users WHERE restriction_level = 'restricted'") || {}).count || 0,
        pendingVerifications: (db().get("SELECT COUNT(*) as count FROM users WHERE email_verified = 0") || {}).count || 0
      }
    });
  });

  router.get("/admin/reports", requireAdmin, (req, res) => {
    const status = req.query.status || "pending";
    const statusFilter = status === "all" ? "" : "WHERE r.status = ?";
    const params = status === "all" ? [] : [status];
    const reports = db().query(
      "SELECT r.*, ru.username as reporter_name, rru.username as reported_username, " +
      "(SELECT COUNT(*) FROM reports d WHERE d.status = 'pending' AND d.id != r.id AND (" +
      "  (r.content_id IS NOT NULL AND d.content_id = r.content_id AND d.content_type = r.content_type) " +
      "  OR (r.content_id IS NULL AND d.reported_user_id = r.reported_user_id) " +
      ")) as duplicate_count " +
      "FROM reports r JOIN users ru ON r.reporter_id = ru.id LEFT JOIN users rru ON r.reported_user_id = rru.id " +
      statusFilter + " ORDER BY r.created_at DESC LIMIT 100",
      params
    );
    const counts = {
      pending: (db().get("SELECT COUNT(*) as c FROM reports WHERE status = 'pending'") || {}).c || 0,
      accepted: (db().get("SELECT COUNT(*) as c FROM reports WHERE status = 'accepted'") || {}).c || 0,
      rejected: (db().get("SELECT COUNT(*) as c FROM reports WHERE status = 'rejected'") || {}).c || 0
    };
    res.json({ reports, counts });
  });

  router.post("/admin/reports/:id/review", requireAdmin, (req, res) => {
    const { action, notes } = req.body;
    if (!["accept", "reject", "analyzing"].includes(action)) return res.status(400).json({ error: "Ação inválida" });
    const report = db().get("SELECT * FROM reports WHERE id = ?", [req.params.id]);
    if (!report) return res.status(404).json({ error: "Denúncia não encontrada" });
    const statusMap = { accept: "accepted", reject: "rejected", analyzing: "analyzing" };
    db().run("UPDATE reports SET status = ?, reviewed_by = ?, review_notes = ?, reviewed_at = datetime('now') WHERE id = ?", [statusMap[action], req.session.userId, notes || "", req.params.id]);
    if (action === "accept" && report.reported_user_id) {
      const cnt = (db().get("SELECT COUNT(*) as count FROM reports WHERE reported_user_id = ? AND status = 'accepted'", [report.reported_user_id]) || {}).count || 0;
      if (cnt >= 5) {
        db().run("INSERT INTO bans (id, user_id, banned_by, reason, ban_type) VALUES (?, ?, ?, 'Múltiplas denúncias', 'permanente')", [uuid.v4(), report.reported_user_id, req.session.userId]);
        db().run("UPDATE users SET status = 'banned' WHERE id = ?", [report.reported_user_id]);
        db().run("INSERT INTO moderation_logs (id, action_type, target_user_id, reason, moderated_by) VALUES (?, 'ban', ?, 'Ban por múltiplas denúncias', ?)", [uuid.v4(), report.reported_user_id, req.session.userId]);
      } else if (cnt >= 3) {
        db().run("INSERT INTO bans (id, user_id, banned_by, reason, ban_type, expires_at) VALUES (?, ?, ?, 'Múltiplas denúncias', 'temporario', datetime('now', '+7 days'))", [uuid.v4(), report.reported_user_id, req.session.userId]);
        db().run("UPDATE users SET status = 'suspended' WHERE id = ?", [report.reported_user_id]);
        db().run("INSERT INTO moderation_logs (id, action_type, target_user_id, reason, moderated_by) VALUES (?, 'suspension', ?, 'Suspensão por denúncias', ?)", [uuid.v4(), report.reported_user_id, req.session.userId]);
      } else {
        db().run("UPDATE users SET warnings_count = warnings_count + 1 WHERE id = ?", [report.reported_user_id]);
        db().run("INSERT INTO moderation_logs (id, action_type, target_user_id, reason, moderated_by) VALUES (?, 'warning', ?, 'Advertência por denúncia confirmada', ?)", [uuid.v4(), report.reported_user_id, req.session.userId]);
      }
    }
    res.json({ message: "Denúncia " + statusMap[action] });
  });

  router.get("/admin/moderation-logs", requireAdmin, (req, res) => {
    res.json({ logs: db().query("SELECT m.*, u.username as target_username, mu.username as moderator_username FROM moderation_logs m LEFT JOIN users u ON m.target_user_id = u.id LEFT JOIN users mu ON m.moderated_by = mu.id ORDER BY m.created_at DESC LIMIT 100") });
  });

  router.post("/admin/moderation/action", requireAdmin, (req, res) => {
    const { userId, action, reason, durationHours } = req.body;
    if (!userId || !action || !reason) return res.status(400).json({ error: "Campos obrigatórios" });
    const validActions = ["warning", "mute", "suspend", "ban", "unban"];
    if (!validActions.includes(action)) return res.status(400).json({ error: "Ação inválida" });
    if (action === "ban") {
      db().run("UPDATE users SET status = 'banned' WHERE id = ?", [userId]);
      db().run("INSERT INTO bans (id, user_id, banned_by, reason, ban_type) VALUES (?, ?, ?, ?, 'permanente')", [uuid.v4(), userId, req.session.userId, reason]);
    } else if (action === "suspend") {
      db().run("UPDATE users SET status = 'suspended' WHERE id = ?", [userId]);
      db().run("INSERT INTO bans (id, user_id, banned_by, reason, ban_type, expires_at) VALUES (?, ?, ?, ?, 'temporario', datetime('now', '+'" + (durationHours || 168) + "' hours'))", [uuid.v4(), userId, req.session.userId, reason]);
    } else if (action === "unban") {
      db().run("UPDATE users SET status = 'active' WHERE id = ?", [userId]);
      db().run("UPDATE bans SET is_active = 0 WHERE user_id = ? AND is_active = 1", [userId]);
    } else if (action === "warning") {
      db().run("UPDATE users SET warnings_count = warnings_count + 1 WHERE id = ?", [userId]);
    }
    db().run("INSERT INTO moderation_logs (id, action_type, target_user_id, reason, moderated_by, duration_hours) VALUES (?, ?, ?, ?, ?, ?)", [uuid.v4(), action, userId, reason, req.session.userId, durationHours || 0]);
    res.json({ message: "Ação '" + action + "' aplicada" });
  });

  router.get("/admin/users", requireAdmin, (req, res) => {
    res.json({ users: db().query("SELECT id, username, display_name, email, role, status, age, restriction_level, warnings_count, email_verified, document_verified, created_at, last_login FROM users ORDER BY warnings_count DESC, created_at DESC LIMIT 200") });
  });

  // Categories
  router.get("/categories", (req, res) => {
    res.json({ categories: [{ id: "todos", name: "Todos", icon: "🔥" }, { id: "geral", name: "Geral", icon: "📺" }, { id: "games", name: "Games", icon: "🎮" }, { id: "musica", name: "Música", icon: "🎵" }, { id: "danca", name: "Dança", icon: "💃" }, { id: "comedia", name: "Comédia", icon: "😂" }, { id: "educacao", name: "Educação", icon: "📚" }, { id: "entrevista", name: "Entrevista", icon: "🎙️" }, { id: "noticias", name: "Notícias", icon: "📰" }] });
  });

  // Rules
  router.get("/rules", (req, res) => {
    res.json({
      rules: {
        idade: ["🔴 Menores de 15 anos: NÃO PERMITIDO - Acesso bloqueado", "🟡 15 a 17 anos: Acesso restrito - sem lives/criação de famílias", "🟢 18+: Acesso completo"],
        identidade: ["Documento falso ou dados inventados: BANIMENTO PERMANENTE", "Verificação de email obrigatória"],
        gerais: ["Respeite todos os membros", "Proibido conteúdo ofensivo/ilegal", "Não compartilhe dados pessoais"],
        lives: ["❌ NSFW/Adulto: PROIBIDO", "❌ Live falsa: detectada e encerrada", "Respeite os moderadores"],
        denuncias: ["Análise em até 24h", "Denúncias falsas: punição"],
        automacao: ["🤖 Anti-robô ativo", "Ações rápidas/repetitivas bloqueadas"]
      }
    });
  });

  // Ranking
  router.get("/ranking", (req, res) => {
    const type = req.query.type || "diamonds";
    const limit = parseInt(req.query.limit) || 20;
    let ranking = [];
    if (type === "diamonds") ranking = db().query("SELECT id, username, display_name, avatar_url, diamonds, followers_count, is_verified, is_live FROM users WHERE status = 'active' ORDER BY diamonds DESC LIMIT ?", [limit]);
    else if (type === "followers") ranking = db().query("SELECT id, username, display_name, avatar_url, followers_count, diamonds, is_verified, is_live FROM users WHERE status = 'active' ORDER BY followers_count DESC LIMIT ?", [limit]);
    else if (type === "families") ranking = db().query("SELECT f.*, u.username as owner_name FROM families f JOIN users u ON f.owner_id = u.id ORDER BY f.total_diamonds DESC LIMIT ?", [limit]);
    res.json({ ranking, type });
  });

  return router;
};

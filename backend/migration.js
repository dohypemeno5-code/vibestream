const moderation = require('./moderation');

/**
 * Migration - Adiciona novas tabelas e campos para:
 * - Verificação de idade
 * - Anti-fraude
 * - Anti-robô
 * - Moderação automática
 * - Denúncias/Tickets aprimorados
 */
function parseBirthDate(ddmmyyyy) {
  if (typeof ddmmyyyy !== 'string') return { valid: false };
  const m = ddmmyyyy.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return { valid: false };
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 9999) return { valid: false };
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return { valid: false };
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (birth.getTime() > today) return { valid: false, future: true };
  let years = now.getUTCFullYear() - year;
  const hadBirthday = (now.getUTCMonth() > month - 1) || (now.getUTCMonth() === month - 1 && now.getUTCDate() >= day);
  if (!hadBirthday) years--;
  return { valid: true, years };
}
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

module.exports = function(db) {
  console.log('[MIGRATION] Aplicando migrações...');
  
  try {
    // Adicionar colunas de idade/verificação à tabela users
    const userCols = db.query("PRAGMA table_info(users)");
    const userColNames = userCols.map(c => c.name);
    
    if (!userColNames.includes('birth_date')) {
      db.run("ALTER TABLE users ADD COLUMN birth_date TEXT DEFAULT ''");
      console.log('[MIGRATION] + birth_date');
    }
    if (!userColNames.includes('age')) {
      db.run("ALTER TABLE users ADD COLUMN age INTEGER DEFAULT 0");
      console.log('[MIGRATION] + age');
    }
    if (!userColNames.includes('age_verified')) {
      db.run("ALTER TABLE users ADD COLUMN age_verified INTEGER DEFAULT 0");
      console.log('[MIGRATION] + age_verified');
    }
    if (!userColNames.includes('restriction_level')) {
      db.run("ALTER TABLE users ADD COLUMN restriction_level TEXT DEFAULT 'none'");
      console.log('[MIGRATION] + restriction_level');
    }
    if (!userColNames.includes('email_verified')) {
      db.run("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0");
      console.log('[MIGRATION] + email_verified');
    }
    if (!userColNames.includes('welcome_seen')) {
      db.run("ALTER TABLE users ADD COLUMN welcome_seen INTEGER DEFAULT 0");
      console.log('[MIGRATION] + welcome_seen');
    }
    if (!userColNames.includes('welcome_seen_at')) {
      db.run("ALTER TABLE users ADD COLUMN welcome_seen_at TEXT DEFAULT ''");
    }
    if (!userColNames.includes('punishment_level')) {
      db.run("ALTER TABLE users ADD COLUMN punishment_level INTEGER DEFAULT 0");
      console.log('[MIGRATION] + punishment_level');
    }
    if (!userColNames.includes('vip_tier')) {
      db.run("ALTER TABLE users ADD COLUMN vip_tier TEXT DEFAULT ''");
      console.log('[MIGRATION] + vip_tier');
    }
    if (!userColNames.includes('vip_until')) {
      db.run("ALTER TABLE users ADD COLUMN vip_until TEXT DEFAULT ''");
      console.log('[MIGRATION] + vip_until');
    }
    if (!userColNames.includes('phone_verified')) {
      db.run("ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0");
      console.log('[MIGRATION] + phone_verified');
    }
    if (!userColNames.includes('phone')) {
      db.run("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''");
      console.log('[MIGRATION] + phone');
    }
    if (!userColNames.includes('document_type')) {
      db.run("ALTER TABLE users ADD COLUMN document_type TEXT DEFAULT ''");
      console.log('[MIGRATION] + document_type');
    }
    if (!userColNames.includes('document_number')) {
      db.run("ALTER TABLE users ADD COLUMN document_number TEXT DEFAULT ''");
      console.log('[MIGRATION] + document_number');
    }
    if (!userColNames.includes('document_verified')) {
      db.run("ALTER TABLE users ADD COLUMN document_verified INTEGER DEFAULT 0");
      console.log('[MIGRATION] + document_verified');
    }
    if (!userColNames.includes('warnings_count')) {
      db.run("ALTER TABLE users ADD COLUMN warnings_count INTEGER DEFAULT 0");
      console.log('[MIGRATION] + warnings_count');
    }
    if (!userColNames.includes('suspension_count')) {
      db.run("ALTER TABLE users ADD COLUMN suspension_count INTEGER DEFAULT 0");
      console.log('[MIGRATION] + suspension_count');
    }
    if (!userColNames.includes('is_restricted')) {
      db.run("ALTER TABLE users ADD COLUMN is_restricted INTEGER DEFAULT 0");
      console.log('[MIGRATION] + is_restricted');
    }
    if (!userColNames.includes('verificado_18')) {
      db.run("ALTER TABLE users ADD COLUMN verificado_18 INTEGER DEFAULT 0");
      console.log('[MIGRATION] + verificado_18');
    }
    if (!userColNames.includes('cpf_hash')) {
      db.run("ALTER TABLE users ADD COLUMN cpf_hash TEXT DEFAULT ''");
      console.log('[MIGRATION] + cpf_hash');
    }

    // Coluna type na tabela lives (vídeo/áudio)
    try {
      const liveCols = db.query("PRAGMA table_info(lives)");
      if (!liveCols.some(c => c.name === 'type')) {
        db.run("ALTER TABLE lives ADD COLUMN type TEXT DEFAULT 'video'");
        console.log('[MIGRATION] + lives.type');
      }
    } catch(e) { console.error('[MIGRATION] lives.type:', e.message); }

    // Tabela de verificação (códigos)
    db.run(`CREATE TABLE IF NOT EXISTS verification_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT DEFAULT 'email' CHECK(type IN ('email', 'phone')),
      expires_at TEXT NOT NULL,
      is_used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    console.log('[MIGRATION] + verification_codes');

    // Tabela de moderação
    db.run(`CREATE TABLE IF NOT EXISTS moderation_logs (
      id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL CHECK(action_type IN ('warning', 'suspension', 'ban', 'unban', 'mute', 'unmute', 'content_removed', 'live_stopped')),
      target_user_id TEXT,
      target_content_id TEXT,
      content_type TEXT DEFAULT 'post' CHECK(content_type IN ('post', 'comment', 'live', 'profile', 'message')),
      reason TEXT NOT NULL,
      moderated_by TEXT,
      duration_hours INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (target_user_id) REFERENCES users(id),
      FOREIGN KEY (moderated_by) REFERENCES users(id)
    )`);
    console.log('[MIGRATION] + moderation_logs');

    // Tabela de denúncias aprimorada
    db.run(`CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL,
      reported_user_id TEXT,
      content_id TEXT,
      content_type TEXT DEFAULT 'post' CHECK(content_type IN ('post', 'comment', 'live', 'profile', 'message', 'user')),
      report_reason TEXT NOT NULL,
      description TEXT DEFAULT '',
      evidence_url TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'analyzing', 'accepted', 'rejected')),
      reviewed_by TEXT,
      review_notes TEXT DEFAULT '',
      is_false_report INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      reviewed_at TEXT,
      FOREIGN KEY (reporter_id) REFERENCES users(id),
      FOREIGN KEY (reported_user_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    )`);
    console.log('[MIGRATION] + reports');

    // Tabela de bloqueio de termos/nomes
    db.run(`CREATE TABLE IF NOT EXISTS blocked_terms (
      id TEXT PRIMARY KEY,
      term TEXT UNIQUE NOT NULL,
      category TEXT DEFAULT 'name' CHECK(category IN ('name', 'bio', 'comment', 'post', 'live_title', 'all')),
      severity TEXT DEFAULT 'warning' CHECK(severity IN ('warning', 'auto_block', 'auto_ban')),
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    console.log('[MIGRATION] + blocked_terms');

    // Tabela de rate limiting (anti-robô)
    db.run(`CREATE TABLE IF NOT EXISTS rate_limits (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      ip_address TEXT,
      action_type TEXT NOT NULL,
      count INTEGER DEFAULT 1,
      window_start TEXT DEFAULT (datetime('now')),
      is_blocked INTEGER DEFAULT 0,
      blocked_until TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    console.log('[MIGRATION] + rate_limits');

    // Inserir termos bloqueados padrão
    const existingTerms = db.query("SELECT COUNT(*) as count FROM blocked_terms");
    if (!existingTerms.length || existingTerms[0].count === 0) {
      const blockedTerms = [
        ['bt001', 'hacker', 'name', 'auto_ban'],
        ['bt002', 'admin', 'name', 'auto_block'],
        ['bt003', 'suporte', 'name', 'auto_block'],
        ['bt004', 'oficial', 'name', 'auto_block'],
        ['bt005', 'moderador', 'name', 'auto_block'],
        ['bt006', 'vibestream', 'name', 'auto_block'],
        ['bt007', 'melhora', 'name', 'auto_block'],
        ['bt008', 'suport', 'name', 'auto_block'],
        ['bt009', 'apoio', 'name', 'warning'],
        ['bt010', 'diamante', 'name', 'warning'],
        ['bt011', 'promoção', 'name', 'warning'],
        ['bt012', 'gratis', 'name', 'warning'],
        ['bt013', 'seguidores', 'name', 'warning'],
        ['bt014', 'xxx', 'all', 'auto_ban'],
        ['bt015', 'sexo', 'all', 'auto_ban'],
        ['bt016', 'porno', 'all', 'auto_ban'],
        ['bt017', 'puta', 'all', 'auto_ban'],
        ['bt018', 'caralho', 'all', 'warning'],
        ['bt019', 'fdp', 'all', 'warning'],
        ['bt020', 'buceta', 'all', 'auto_ban'],
        ['bt021', 'vender', 'name', 'warning'],
        ['bt022', 'comprar', 'name', 'warning'],
        ['bt023', 'assinar', 'name', 'warning'],
        ['bt024', '@adm', 'name', 'auto_block'],
        ['bt025', 'suporte', 'name', 'auto_block'],
      ];
      const stmt = db.prepare('INSERT OR IGNORE INTO blocked_terms (id, term, category, severity) VALUES (?, ?, ?, ?)');
      for (const t of blockedTerms) {
        stmt.run(t);
      }
      stmt.free();
      console.log('[MIGRATION] + termos bloqueados inseridos');
    }

    // ============================================================
    // VARREDURA DE IDADE - bloqueia contas < 15 anos (rigoroso)
    // ============================================================
    try {
      const users = db.query("SELECT id, role, birth_date, age, restriction_level, status FROM users");
      for (const u of users) {
        if (u.role === 'admin') {
          if (!u.age || u.age < 18) {
            db.run("UPDATE users SET age = 30, birth_date = CASE WHEN birth_date = '' THEN '01/01/1996' ELSE birth_date END, restriction_level = 'none' WHERE id = ?", [u.id]);
          }
          continue;
        }
        const bd = parseBirthDate(u.birth_date);
        if (bd.valid) {
          const restriction = (bd.years >= 15 && bd.years < 18) ? 'restricted' : 'none';
          if (u.age !== bd.years || u.restriction_level !== restriction) {
            db.run("UPDATE users SET age = ?, restriction_level = ? WHERE id = ?", [bd.years, restriction, u.id]);
          }
          if (bd.years < 15) {
            const banned = db.query("SELECT id FROM bans WHERE user_id = ? AND ban_type = 'permanente'", [u.id]);
            if (!banned.length) {
              db.run("INSERT INTO bans (id, user_id, banned_by, reason, ban_type) VALUES (?, ?, 'sistema', ?, 'permanente')",
                [uuid(), u.id, 'Menor de 15 anos - acesso bloqueado (lei e regras da plataforma)']);
              db.run("INSERT INTO moderation_logs (id, action_type, target_user_id, reason, moderated_by) VALUES (?, 'ban', ?, ?, 'sistema')",
                [uuid(), u.id, 'Menor de 15 anos - bloqueio total']);
            }
            db.run("UPDATE users SET status = 'banned' WHERE id = ?", [u.id]);
            console.log('[MIGRATION] ⛔ Conta menor de 15 anos bloqueada:', u.id);
          }
        }
      }
      console.log('[MIGRATION] ✅ Varredura de idade concluída');
    } catch (e) { console.error('[MIGRATION] Varredura idade:', e.message); }

    // ============================================================
    // PERFIL ÚNICO (VS#NNNNNN) + MODERAÇÃO + TIPOS DE MENSAGEM
    // ============================================================
    try {
      const ucols = db.query("PRAGMA table_info(users)").map(c => c.name);
      if (!ucols.includes('profile_id')) {
        db.run("ALTER TABLE users ADD COLUMN profile_id TEXT DEFAULT ''");
        console.log('[MIGRATION] + users.profile_id');
      }
      const pcols = db.query("PRAGMA table_info(posts)").map(c => c.name);
      if (!pcols.includes('status')) {
        db.run("ALTER TABLE posts ADD COLUMN status TEXT DEFAULT 'approved'");
        console.log('[MIGRATION] + posts.status');
      }
      if (!pcols.includes('moderation_reason')) {
        db.run("ALTER TABLE posts ADD COLUMN moderation_reason TEXT DEFAULT ''");
        console.log('[MIGRATION] + posts.moderation_reason');
      }
      const mcols = db.query("PRAGMA table_info(chat_messages)").map(c => c.name);
      if (!mcols.includes('type')) {
        db.run("ALTER TABLE chat_messages ADD COLUMN type TEXT DEFAULT 'text'");
        console.log('[MIGRATION] + chat_messages.type');
      }
      if (!mcols.includes('media_url')) {
        db.run("ALTER TABLE chat_messages ADD COLUMN media_url TEXT DEFAULT ''");
        console.log('[MIGRATION] + chat_messages.media_url');
      }
      if (!mcols.includes('status')) {
        db.run("ALTER TABLE chat_messages ADD COLUMN status TEXT DEFAULT 'sent'");
        console.log('[MIGRATION] + chat_messages.status');
      }
      // Backfill profile_id para contas existentes
      const users = db.query("SELECT id, username FROM users WHERE profile_id = '' OR profile_id IS NULL ORDER BY created_at ASC");
      let maxNum = 0;
      const existingIds = db.query("SELECT profile_id FROM users WHERE profile_id LIKE 'VS#%'");
      for (const e of existingIds) {
        const n = parseInt(String(e.profile_id).replace('VS#', ''), 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
      for (const u of users) {
        maxNum++;
        const pid = 'VS#' + String(maxNum).padStart(6, '0');
        db.run("UPDATE users SET profile_id = ? WHERE id = ?", [pid, u.id]);
      }
      if (users.length) console.log('[MIGRATION] ✅ profile_id gerado para', users.length, 'usuários');
    } catch (e) { console.error('[MIGRATION] Perfil/moderação:', e.message); }

    // ============================================================
    // NOVAS TABELAS (aceite de regras, salvos, recursos, denúncias de chat)
    // ============================================================
    try {
      db.run("CREATE TABLE IF NOT EXISTS user_rules_acceptance (user_id TEXT PRIMARY KEY, version INTEGER DEFAULT 1, accepted_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id))");
      db.run("CREATE TABLE IF NOT EXISTS saved_posts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, post_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (post_id) REFERENCES posts(id), UNIQUE(user_id, post_id))");
      db.run("CREATE TABLE IF NOT EXISTS appeals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','aprovado','rejeitado')), admin_response TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), reviewed_at TEXT, FOREIGN KEY (user_id) REFERENCES users(id))");
      db.run("CREATE TABLE IF NOT EXISTS chat_reports (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, reporter_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','analisado','rejeitado')), created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (chat_id) REFERENCES chats(id), FOREIGN KEY (reporter_id) REFERENCES users(id))");
      db.run("CREATE TABLE IF NOT EXISTS content_reviews (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('review','approved','blocked')), reason TEXT DEFAULT '', moderated_by TEXT DEFAULT 'sistema', created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (post_id) REFERENCES posts(id), FOREIGN KEY (user_id) REFERENCES users(id))");
      console.log('[MIGRATION] ✅ Tabelas: regras, salvos, recursos, chat_reports');
    } catch (e) { console.error('[MIGRATION] Novas tabelas:', e.message); }

    // ============================================================
    // TERMOS DE BLOQUEIO TOTAL (estupro, pedofilia, menores)
    // ============================================================
    try {
      const seedTerms = [
        ...moderation.HARD_BLOCK_PATTERNS.map(r => ({ term: r.source.replace(/[\\/^$.*+?()[\]{}|]/g, ''), category: 'all', severity: 'auto_ban' })),
        ...moderation.HATE_PATTERNS.map(r => ({ term: r.source.replace(/[\\/^$.*+?()[\]{}|]/g, ''), category: 'all', severity: 'auto_block' })),
        ...moderation.APOLOGIA_PATTERNS.map(r => ({ term: r.source.replace(/[\\/^$.*+?()[\]{}|]/g, ''), category: 'all', severity: 'auto_block' })),
        ...moderation.IMPERSONATION_PATTERNS.map(r => ({ term: r.source.replace(/[\\/^$.*+?()[\]{}|]/g, ''), category: 'name', severity: 'auto_ban' }))
      ];
      const seen = new Set();
      for (const t of seedTerms) {
        const term = t.term.trim();
        if (!term || term.length < 3 || seen.has(term)) continue;
        seen.add(term);
        const exists = db.get("SELECT id FROM blocked_terms WHERE term = ?", [term]);
        if (!exists) {
          db.run("INSERT INTO blocked_terms (id, term, category, severity) VALUES (?, ?, ?, ?)", [uuid(), term, t.category, t.severity]);
        }
      }
    } catch (e) { console.error('[MIGRATION] blocked terms:', e.message); }

    // ============================================================
    // RESCAN DE POSTS ANTIGOS (moderação retroativa)
    // ============================================================
    try {
      const approved = db.query(`SELECT p.id, p.user_id, p.text, p.media_url FROM posts p
        WHERE p.status = 'approved' AND p.is_deleted = 0
        AND NOT EXISTS (SELECT 1 FROM content_reviews cr WHERE cr.post_id = p.id AND cr.action IN ('approved','blocked'))`);
      for (const post of approved) {
        const mod = moderation.moderateText(String(post.text || '') + ' ' + String(post.media_url || ''));
        if (mod.status !== 'approved') {
          db.run("UPDATE posts SET status = ?, moderation_reason = ? WHERE id = ?", [mod.status, mod.reason, post.id]);
          const already = db.get("SELECT id FROM content_reviews WHERE post_id = ? AND action = ?", [post.id, mod.status]);
          if (!already) {
            db.run("INSERT INTO content_reviews (id, post_id, user_id, action, reason) VALUES (?, ?, ?, ?, ?)",
              [uuid(), post.id, post.user_id, mod.status, mod.reason]);
          }
          console.log('[MIGRATION] 🔎 Post reexaminado →', mod.status, '|', String(post.text || '').slice(0, 40));
        }
      }
    } catch (e) { console.error('[MIGRATION] Rescan posts:', e.message); }

    // ============================================================
    // NOVAS TABELAS: alertas, agências, carteira, saques, campanhas
    // ============================================================
    try {
      db.run("CREATE TABLE IF NOT EXISTS security_alerts (id TEXT PRIMARY KEY, alert_type TEXT NOT NULL, severity TEXT DEFAULT 'medio' CHECK(severity IN ('baixo','medio','alto','critico')), message TEXT NOT NULL, ip_address TEXT DEFAULT '', user_id TEXT DEFAULT '', is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))");
      db.run("CREATE TABLE IF NOT EXISTS auth_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), last_used_at TEXT, ip_address TEXT DEFAULT '', user_agent TEXT DEFAULT '')");
      db.run("CREATE TABLE IF NOT EXISTS agencies (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, code TEXT UNIQUE NOT NULL, owner_id TEXT NOT NULL, description TEXT DEFAULT '', commission_pct INTEGER DEFAULT 10, members_count INTEGER DEFAULT 1, total_earnings REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (owner_id) REFERENCES users(id))");
      db.run("CREATE TABLE IF NOT EXISTS agency_members (id TEXT PRIMARY KEY, agency_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT DEFAULT 'creator' CHECK(role IN ('owner','manager','creator')), status TEXT DEFAULT 'ativo', joined_at TEXT DEFAULT (datetime('now')), total_earnings REAL DEFAULT 0, FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE(agency_id, user_id))");
      db.run("CREATE TABLE IF NOT EXISTS agency_invites (id TEXT PRIMARY KEY, agency_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','aceito','recusado')), created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE)");
      db.run("CREATE TABLE IF NOT EXISTS wallets (user_id TEXT PRIMARY KEY, balance REAL DEFAULT 0, pending REAL DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id))");
      db.run("CREATE TABLE IF NOT EXISTS wallet_transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL, description TEXT DEFAULT '', status TEXT DEFAULT 'concluido', created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id))");
      db.run("CREATE TABLE IF NOT EXISTS withdrawals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount REAL NOT NULL, pix_key TEXT NOT NULL, pix_type TEXT DEFAULT 'cpf', status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','aprovado','rejeitado')), admin_response TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), reviewed_at TEXT, FOREIGN KEY (user_id) REFERENCES users(id))");
      try { db.run("ALTER TABLE wallet_transactions ADD COLUMN ref_id TEXT DEFAULT ''"); } catch (e) {}
      db.run("CREATE TABLE IF NOT EXISTS recharge_orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, package_id TEXT NOT NULL, coins INTEGER NOT NULL, bonus INTEGER DEFAULT 0, amount REAL NOT NULL, method TEXT DEFAULT 'pix', status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','pago','cancelado')), paid_at TEXT, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id))");
      db.run("CREATE TABLE IF NOT EXISTS video_views (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, post_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, post_id), FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (post_id) REFERENCES posts(id))");
      db.run("CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '', reward REAL DEFAULT 0, required_views INTEGER DEFAULT 100, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))");
      db.run("CREATE TABLE IF NOT EXISTS campaign_participants (user_id TEXT NOT NULL, campaign_id TEXT NOT NULL, status TEXT DEFAULT 'participando' CHECK(status IN ('participando','concluido')), joined_at TEXT DEFAULT (datetime('now')), completed_at TEXT, PRIMARY KEY (user_id, campaign_id))");
      db.run("CREATE TABLE IF NOT EXISTS earnings_config (key TEXT PRIMARY KEY, value REAL DEFAULT 0)");
      const cfg = db.get("SELECT key FROM earnings_config WHERE key = 'per_view'");
      if (!cfg) {
        db.run("INSERT INTO earnings_config (key, value) VALUES ('per_view', 0.001)");
        db.run("INSERT INTO earnings_config (key, value) VALUES ('per_like', 0.01)");
        db.run("INSERT INTO earnings_config (key, value) VALUES ('auto_withdraw_limit', 50)");
        console.log('[MIGRATION] ✅ earnings_config seed');
      }
      // Campanhas iniciais
      const campaigns = (db.get("SELECT COUNT(*) as c FROM campaigns WHERE id IS NOT NULL") || {}).c || 0;
      if (campaigns === 0) {
        db.run("DELETE FROM campaigns WHERE id IS NULL");
        db.run("INSERT INTO campaigns (id, title, description, reward, required_views) VALUES (?, 'Campanha de Boas-Vindas', 'Poste seu primeiro vídeo e alcance 100 visualizações para ganhar recompensa', 10, 100)", [uuid()]);
        db.run("INSERT INTO campaigns (id, title, description, reward, required_views) VALUES (?, 'Engajamento Semanal', 'Alcance 500 visualizações nos seus vídeos da semana', 25, 500)", [uuid()]);
        db.run("INSERT INTO campaigns (id, title, description, reward, required_views) VALUES (?, 'Criador em Alta', 'Seus vídeos somando 1000 visualizações', 50, 1000)", [uuid()]);
        console.log('[MIGRATION] ✅ campanhas seed');
      }
      console.log('[MIGRATION] ✅ Tabelas: alertas, agências, carteira, saques, campanhas');
    } catch (e) { console.error('[MIGRATION] Novas tabelas v2:', e.message); }

    // ============================================================
    // FAMÍLIAS + AGÊNCIAS (Poppo Live style) — colunas novas
    // ============================================================
    try {
      db.run("ALTER TABLE families ADD COLUMN tag TEXT DEFAULT ''");
    } catch (e) {}
    try { db.run("ALTER TABLE families ADD COLUMN total_golds INTEGER DEFAULT 0"); } catch (e) {}
    try { db.run("ALTER TABLE families ADD COLUMN nivel INTEGER DEFAULT 1"); } catch (e) {}
    try { db.run("ALTER TABLE families ADD COLUMN ranking INTEGER DEFAULT 0"); } catch (e) {}
    try { db.run("ALTER TABLE agencies ADD COLUMN tag TEXT DEFAULT ''"); } catch (e) {}
    try { db.run("ALTER TABLE agencies ADD COLUMN logo_url TEXT DEFAULT ''"); } catch (e) {}
    try { db.run("ALTER TABLE agencies ADD COLUMN whatsapp TEXT DEFAULT ''"); } catch (e) {}
    try { db.run("ALTER TABLE agencies ADD COLUMN status TEXT DEFAULT 'pendente'"); } catch (e) {}
    try { db.run("ALTER TABLE agencies ADD COLUMN motivo TEXT DEFAULT ''"); } catch (e) {}
    try { db.run("ALTER TABLE agencies ADD COLUMN criacao_em TEXT DEFAULT ''"); } catch (e) {}
    try { db.run("ALTER TABLE users ADD COLUMN family_id TEXT DEFAULT ''"); } catch (e) {}
    try { db.run("ALTER TABLE users ADD COLUMN agency_id TEXT DEFAULT ''"); } catch (e) {}
    try { db.run("ALTER TABLE users ADD COLUMN family_tag TEXT DEFAULT ''"); } catch (e) {}
    try { db.run("ALTER TABLE users ADD COLUMN agency_tag TEXT DEFAULT ''"); } catch (e) {}
    try { db.run("ALTER TABLE user_rewards ADD COLUMN checkin_streak INTEGER DEFAULT 0"); } catch (e) {}
    try { db.run("ALTER TABLE user_rewards ADD COLUMN checkin_last TEXT DEFAULT ''"); } catch (e) {}

    // Seed mockado (Poppo Live style) se o banco estiver vazio
    const famCount = (db.get("SELECT COUNT(*) as c FROM families") || {}).c || 0;
    if (famCount === 0) {
      const admin = db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      const owner = admin ? admin.id : (db.get("SELECT id FROM users LIMIT 1") || {}).id;
      if (owner) {
        db.run("INSERT INTO families (id, name, description, logo_url, owner_id, members_count, total_golds, rank, level, tag) VALUES ('fam-tropa-a', 'TROPA DO A', 'Família mais forte do VibeStream — bora subir o nível!', '', ?, 1, 0, 1, 1, 'TDA')", [owner]);
        console.log('[MIGRATION] ✅ Seed família TROPA DO A');
      }
    }
    // Garante que o dono aparece como membro da família seed (idempotente)
    const seeded = db.get("SELECT id, owner_id FROM families WHERE id = 'fam-tropa-a'");
    if (seeded) {
      const ownerMember = db.get("SELECT id FROM family_members WHERE family_id = 'fam-tropa-a' AND user_id = ?", [seeded.owner_id]);
      if (!ownerMember) {
        db.run("INSERT OR IGNORE INTO family_members (id, family_id, user_id, role) VALUES ('fam-tropa-a-owner', 'fam-tropa-a', ?, 'owner')", [seeded.owner_id]);
        db.run("UPDATE families SET members_count = (SELECT COUNT(*) FROM family_members WHERE family_id = 'fam-tropa-a') WHERE id = 'fam-tropa-a'");
        console.log('[MIGRATION] ✅ Dono adicionado como membro da família seed');
      }
    }
    const agCount = (db.get("SELECT COUNT(*) as c FROM agencies") || {}).c || 0;
    if (agCount === 0) {
      const admin = db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      const owner = admin ? admin.id : (db.get("SELECT id FROM users LIMIT 1") || {}).id;
      if (owner) {
        db.run("INSERT INTO agencies (id, name, code, owner_id, description, commission_pct, total_earnings, tag, whatsapp, status, criacao_em) VALUES ('ag-ferrari', 'Ferrari OFC', 'FR', ?, 'Agência oficial de criadores Ferrari OFC', 10, 0, 'FR', '', 'aprovada', datetime('now'))", [owner]);
        console.log('[MIGRATION] ✅ Seed agência Ferrari OFC');
      }
    }
    console.log('[MIGRATION] ✅ Famílias + Agências (Poppo)');

    // ============================================================
    // MODERAÇÃO POLÍTICA: strikes (ameaças) + visitas de perfil
    // ============================================================
    try {
      db.run(`CREATE TABLE IF NOT EXISTS strikes (
        user_id TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0,
        ultimo_motivo TEXT DEFAULT '',
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS profile_visits (
        id TEXT PRIMARY KEY,
        visitante_id TEXT NOT NULL,
        visitado_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (visitante_id) REFERENCES users(id),
        FOREIGN KEY (visitado_id) REFERENCES users(id)
      )`);
      try { db.run("ALTER TABLE bans ADD COLUMN prova_url TEXT DEFAULT ''"); } catch (e) {}
      try { db.run("CREATE INDEX IF NOT EXISTS idx_visits_visitado ON profile_visits(visitado_id, created_at)"); } catch (e) {}
      console.log('[MIGRATION] ✅ Moderação: strikes + profile_visits + bans.prova_url');
    } catch (e) { console.error('[MIGRATION] strikes/visits:', e.message); }

    // ============================================================
    // PROTEÇÃO INFANTIL: denúncias graves + bloqueio IP/dispositivo
    // ============================================================
    try {
      db.run(`CREATE TABLE IF NOT EXISTS denuncias_graves (
        id TEXT PRIMARY KEY,
        autor_id TEXT NOT NULL,
        vitima_id TEXT DEFAULT '',
        texto TEXT DEFAULT '',
        prova TEXT DEFAULT '',
        tipo TEXT DEFAULT 'infantil',
        status TEXT DEFAULT 'enviado_para_analise',
        ip TEXT DEFAULT '',
        device_fp TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (autor_id) REFERENCES users(id),
        FOREIGN KEY (vitima_id) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS child_safety_blocks (
        id TEXT PRIMARY KEY,
        ip TEXT DEFAULT '',
        device_fp TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      try { db.run("CREATE INDEX IF NOT EXISTS idx_denuncias_graves_created ON denuncias_graves(created_at)"); } catch (e) {}
      console.log('[MIGRATION] ✅ Proteção infantil: denuncias_graves + child_safety_blocks');
    } catch (e) { console.error('[MIGRATION] proteção infantil:', e.message); }

    // ============================================================
    // VIBEGAMING LIVE: convidados, moderação, reações, estatísticas
    // ============================================================
    try {
      const lvCols = db.query('PRAGMA table_info(lives)').map(c => c.name);
      if (!lvCols.includes('thumbnail_url')) { db.run("ALTER TABLE lives ADD COLUMN thumbnail_url TEXT DEFAULT ''"); }
      if (!lvCols.includes('game_name')) { db.run("ALTER TABLE lives ADD COLUMN game_name TEXT DEFAULT ''"); }
      if (!lvCols.includes('started_at')) { db.run("ALTER TABLE lives ADD COLUMN started_at TEXT DEFAULT ''"); }
      if (!lvCols.includes('ended_at')) { db.run("ALTER TABLE lives ADD COLUMN ended_at TEXT DEFAULT ''"); }
      if (!lvCols.includes('peak_viewers')) { db.run("ALTER TABLE lives ADD COLUMN peak_viewers INTEGER DEFAULT 0"); }
      try { db.run("ALTER TABLE live_comments ADD COLUMN pinned INTEGER DEFAULT 0"); } catch (e) {}
      const uCols = db.query('PRAGMA table_info(users)').map(c => c.name);
      if (!uCols.includes('notify_lives')) { db.run("ALTER TABLE users ADD COLUMN notify_lives INTEGER DEFAULT 1"); }
      db.run(`CREATE TABLE IF NOT EXISTS live_guests (
        id TEXT PRIMARY KEY, live_id TEXT NOT NULL, user_id TEXT NOT NULL,
        status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','aceito','removido')),
        role TEXT DEFAULT 'guest' CHECK(role IN ('guest','moderador')),
        invited_by TEXT DEFAULT '', joined_at TEXT DEFAULT (datetime('now')),
        UNIQUE(live_id, user_id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS live_chat_bans (
        id TEXT PRIMARY KEY, live_id TEXT NOT NULL, user_id TEXT NOT NULL,
        until_at TEXT NOT NULL, reason TEXT DEFAULT '', banned_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS live_reactions (
        id TEXT PRIMARY KEY, live_id TEXT NOT NULL, user_id TEXT NOT NULL,
        emoji TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(live_id, user_id, emoji)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS live_message_reports (
        id TEXT PRIMARY KEY, live_id TEXT NOT NULL, message_id TEXT DEFAULT '',
        reporter_id TEXT NOT NULL, reason TEXT DEFAULT '', status TEXT DEFAULT 'pendente',
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      console.log('[MIGRATION] ✅ VibeGaming: convidados + moderação + reações');
    } catch (e) { console.error('[MIGRATION] gaming:', e.message); }

    // ============================================================
    // VIBEDRAMA: séries, temporadas, episódios, histórico
    // ============================================================
    try {
      db.run(`CREATE TABLE IF NOT EXISTS drama_series (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, synopsis TEXT DEFAULT '',
        cover_url TEXT DEFAULT '', creator_id TEXT DEFAULT '', category TEXT DEFAULT 'drama',
        year TEXT DEFAULT '2026', status TEXT DEFAULT 'publicado', views INTEGER DEFAULT 0,
        likes_count INTEGER DEFAULT 0, total_seasons INTEGER DEFAULT 0, total_episodes INTEGER DEFAULT 0,
        featured INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS drama_seasons (
        id TEXT PRIMARY KEY, series_id TEXT NOT NULL, number INTEGER DEFAULT 1,
        title TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now'))
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS drama_episodes (
        id TEXT PRIMARY KEY, series_id TEXT NOT NULL, season_id TEXT DEFAULT '',
        number INTEGER DEFAULT 1, title TEXT DEFAULT '', synopsis TEXT DEFAULT '',
        summary TEXT DEFAULT '', video_url TEXT DEFAULT '', duration INTEGER DEFAULT 0,
        thumbnail_url TEXT DEFAULT '', views INTEGER DEFAULT 0, likes_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS drama_favorites (
        user_id TEXT NOT NULL, series_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, series_id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS drama_series_follows (
        user_id TEXT NOT NULL, series_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, series_id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS drama_history (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, series_id TEXT NOT NULL,
        episode_id TEXT NOT NULL, progress INTEGER DEFAULT 0, duration INTEGER DEFAULT 0,
        watched_at TEXT DEFAULT (datetime('now'))
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS drama_likes (
        user_id TEXT NOT NULL, episode_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, episode_id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS drama_comments (
        id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, user_id TEXT NOT NULL,
        text TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now'))
      )`);
      try { db.run("CREATE INDEX IF NOT EXISTS idx_drama_ep_series ON drama_episodes(series_id, season_id, number)"); } catch (e) {}
      try { db.run("CREATE INDEX IF NOT EXISTS idx_drama_hist_user ON drama_history(user_id, watched_at)"); } catch (e) {}
      console.log('[MIGRATION] ✅ VibeDrama: séries + temporadas + episódios');
    } catch (e) { console.error('[MIGRATION] drama:', e.message); }

    // ============================================================
    // VIBEAI CREATOR: drafts, logs, uso diário e denúncias
    // ============================================================
    try {
      db.run(`CREATE TABLE IF NOT EXISTS ai_drafts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        idea TEXT DEFAULT '',
        style TEXT DEFAULT 'shorts',
        title TEXT DEFAULT '',
        description TEXT DEFAULT '',
        script TEXT DEFAULT '',
        hashtags TEXT DEFAULT '[]',
        caption TEXT DEFAULT '',
        cover_url TEXT DEFAULT '',
        video_url TEXT DEFAULT '',
        status TEXT DEFAULT 'ready',
        credits_cost INTEGER DEFAULT 0,
        published_post_id TEXT DEFAULT '',
        moderation_note TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS ai_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT DEFAULT '',
        action TEXT DEFAULT '',
        status TEXT DEFAULT '',
        details TEXT DEFAULT '',
        ip TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS ai_usage (
        user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, day)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS ai_reports (
        id TEXT PRIMARY KEY,
        draft_id TEXT DEFAULT '',
        reporter_id TEXT DEFAULT '',
        reason TEXT DEFAULT '',
        status TEXT DEFAULT 'pendente',
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      try { db.run("CREATE INDEX IF NOT EXISTS idx_ai_drafts_user ON ai_drafts(user_id, created_at)"); } catch (e) {}
      console.log('[MIGRATION] ✅ VibeAI Creator: ai_drafts + ai_logs + ai_usage + ai_reports');
    } catch (e) { console.error('[MIGRATION] VibeAI:', e.message); }

    // ============================================================
    // SEED 3 FAMÍLIAS DE TESTE: TROPA DO A [TDA], FERRARI OFC [FR], ELITE [ELT]
    // ============================================================
    try {
      const admin = db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      const owner = admin ? admin.id : (db.get("SELECT id FROM users LIMIT 1") || {}).id;
      const FAMILY_SEEDS = [
        { id: 'fam-tropa-a', nome: 'TROPA DO A', tag: 'TDA', desc: 'Família mais forte do VibeStream — bora subir o nível!' },
        { id: 'fam-ferrari', nome: 'FERRARI OFC', tag: 'FR', desc: 'Equipe Ferrari OFC — batalha de famílias e shows' },
        { id: 'fam-elite', nome: 'ELITE', tag: 'ELT', desc: 'Família ELITE — só os fortes entram' }
      ];
      if (owner) {
        for (const fs of FAMILY_SEEDS) {
          const fam = db.get("SELECT id, owner_id, tag FROM families WHERE name = ?", [fs.nome]);
          let fid = fam ? fam.id : null;
          if (!fam) {
            db.run("INSERT INTO families (id, name, description, logo_url, owner_id, members_count, total_golds, rank, level, tag) VALUES (?, ?, '', '', ?, 1, 0, 1, 1, ?)", [fs.id, fs.nome, owner, fs.tag]);
            fid = fs.id;
            console.log('[MIGRATION] ✅ Seed família ' + fs.nome + ' [' + fs.tag + ']');
          }
          if (fid) {
            const ownerMember = db.get("SELECT id FROM family_members WHERE family_id = ? AND user_id = ?", [fid, owner]);
            if (!ownerMember) {
              db.run("INSERT OR IGNORE INTO family_members (id, family_id, user_id, role) VALUES ('owner-' || ?, ?, ?, 'owner')", [fid, fid, owner]);
            }
            if (fam && !fam.tag) {
              db.run("UPDATE families SET tag = ? WHERE id = ?", [fs.tag, fid]);
            }
            db.run("UPDATE families SET members_count = (SELECT COUNT(*) FROM family_members WHERE family_id = ?) WHERE id = ?", [fid, fid]);
          }
        }
      }
      console.log('[MIGRATION] ✅ 3 famílias de teste garantidas');
    } catch (e) { console.error('[MIGRATION] seed famílias:', e.message); }

    // ============================================================
    // ECONOMIA KWAI-STYLE: recompensas diárias (watch/check-in)
    // ============================================================
    try {
      db.run(`CREATE TABLE IF NOT EXISTS user_rewards (
        user_id TEXT PRIMARY KEY,
        watch_seconds INTEGER DEFAULT 0,
        watch_day TEXT DEFAULT '',
        last_checkin TEXT DEFAULT '',
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS ranking_hour (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        display_name TEXT DEFAULT '',
        avatar_url TEXT DEFAULT '',
        hour_value REAL DEFAULT 0,
        hour_key TEXT DEFAULT '',
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);
      // Presente Diamante (estilo Poppo/Kwai)
      const diam = db.get("SELECT id FROM gifts WHERE id = 'g010'");
      if (!diam) {
        db.run("INSERT INTO gifts (id, name, image_url, price_coins, price_diamonds, animation_url, category, is_active) VALUES ('g010', '💎 Diamante', '', 20, 5, '', 'premium', 1)");
      }
      console.log('[MIGRATION] ✅ Economia K Golds (user_rewards, ranking_hour, Diamante)');
    } catch (e) { console.error('[MIGRATION] economia kwai:', e.message); }

    // ============================================================
    // LIMPEZA: reativa contas com ban temporário expirado
    // ============================================================
    try {
      db.run(`UPDATE users SET status = 'active' WHERE status = 'banned' AND id NOT IN (
        SELECT user_id FROM bans WHERE ban_type = 'permanente' OR (ban_type = 'temporario' AND (expires_at IS NULL OR expires_at > datetime('now')))
      )`);
    } catch (e) { console.error('[MIGRATION] limpeza bans:', e.message); }

    // ============================================================
    // VIBEGUARD AI — segurança e moderação (bots + equipe)
    // ============================================================
    try {
      db.run(`CREATE TABLE IF NOT EXISTS vg_flags (
        id TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now')),
        user_id TEXT,
        content_type TEXT DEFAULT '',
        content_id TEXT DEFAULT '',
        flag_type TEXT DEFAULT '',
        label TEXT DEFAULT '',
        severity TEXT DEFAULT 'medium',
        source TEXT DEFAULT 'vibeguard',
        resolved INTEGER DEFAULT 0,
        resolved_by TEXT,
        resolved_at TEXT
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS vg_observations (
        id TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now')),
        target_type TEXT DEFAULT '',
        target_id TEXT DEFAULT '',
        risk TEXT DEFAULT 'low',
        reason TEXT DEFAULT '',
        details TEXT DEFAULT ''
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS vg_actions (
        id TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now')),
        moderator_id TEXT,
        action_type TEXT DEFAULT '',
        target_type TEXT DEFAULT '',
        target_id TEXT DEFAULT '',
        note TEXT DEFAULT '',
        source TEXT DEFAULT 'vibeguard'
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS vg_chat (
        id TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now')),
        user_id TEXT,
        kind TEXT DEFAULT 'chat',
        message TEXT DEFAULT '',
        case_ref TEXT DEFAULT ''
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS vg_reports (
        id TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now')),
        content_type TEXT DEFAULT '',
        content_id TEXT DEFAULT '',
        reported_user_id TEXT,
        reporter_id TEXT,
        anonymous INTEGER DEFAULT 0,
        reason TEXT NOT NULL,
        evidence_url TEXT DEFAULT '',
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','analyzing','accepted','rejected','hidden')),
        priority INTEGER DEFAULT 0,
        notes TEXT DEFAULT '',
        reviewed_by TEXT,
        reviewed_at TEXT
      )`);
      console.log('[MIGRATION] ✅ VibeGuard AI (vg_flags, vg_observations, vg_actions, vg_chat, vg_reports)');
    } catch (e) { console.error('[MIGRATION] vibeguard:', e.message); }

    db.save();
    console.log('[MIGRATION] ✅ Todas as migrações aplicadas com sucesso!');
  } catch (error) {
    console.error('[MIGRATION] Erro:', error.message);
  }
};

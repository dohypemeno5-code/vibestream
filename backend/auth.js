/**
 * VibeStream - Autenticação segura com tokens expiráveis
 * - Tokens aleatórios (256 bits) com hash SHA-256 no banco
 * - Expiração de 7 dias + renovação deslizante
 * - Sobrevive a reinícios do servidor (diferente da MemoryStore)
 * - Suporte a header Authorization: Bearer ou cookie HttpOnly
 */
const crypto = require('crypto');

const TOKEN_COOKIE = 'vs_token';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;     // 7 dias
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;      // renova se faltar < 24h
const MAX_TOKENS_PER_USER = 10;

function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

// Garante a tabela de tokens
function ensureTable(db) {
  try {
    db.run(`CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT,
      ip_address TEXT DEFAULT '',
      user_agent TEXT DEFAULT ''
    )`);
  } catch (e) {}
}

// Lê cookies do header (sem dependência externa)
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

// Cria um token novo para o usuário
function issue(db, userId, ip, userAgent) {
  ensureTable(db);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  try {
    // Limita quantidade de tokens ativos por usuário (anti-acúmulo)
    const count = (db.get('SELECT COUNT(*) as c FROM auth_tokens WHERE user_id = ?', [userId]) || {}).c || 0;
    if (count >= MAX_TOKENS_PER_USER) {
      db.run('DELETE FROM auth_tokens WHERE user_id = ? AND created_at = (SELECT MIN(created_at) FROM auth_tokens WHERE user_id = ?)', [userId, userId]);
    }
    db.run(
      'INSERT INTO auth_tokens (token_hash, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
      [sha256(token), userId, expiresAt, String(ip || '').slice(0, 64), String(userAgent || '').slice(0, 200)]
    );
    return token;
  } catch (e) { return null; }
}

// Revoga um token específico
function revoke(db, token) {
  if (!token) return;
  try { db.run('DELETE FROM auth_tokens WHERE token_hash = ?', [sha256(token)]); } catch (e) {}
}

// Revoga todos os tokens de um usuário (logout global / segurança)
function revokeAll(db, userId) {
  try { db.run('DELETE FROM auth_tokens WHERE user_id = ?', [userId]); } catch (e) {}
}

// Valida token (header ou cookie) e retorna o userId; renova expiração deslizante
function resolve(db, req) {
  let token = null;
  const auth = req.headers['authorization'] || '';
  if (/^Bearer\s+/i.test(auth)) token = auth.slice(7).trim();
  if (!token) {
    const cookies = parseCookies(req);
    token = cookies[TOKEN_COOKIE] || null;
  }
  if (!token || token.length > 128) return null;
  const row = db.get('SELECT token_hash, user_id, expires_at FROM auth_tokens WHERE token_hash = ?', [sha256(token)]);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    try { db.run('DELETE FROM auth_tokens WHERE token_hash = ?', [row.token_hash]); } catch (e) {}
    return null;
  }
  try {
    if (row.expires_at - Date.now() < RENEW_BEFORE_MS) {
      db.run("UPDATE auth_tokens SET expires_at = ?, last_used_at = datetime('now') WHERE token_hash = ?", [Date.now() + TOKEN_TTL_MS, row.token_hash]);
    } else {
      db.run("UPDATE auth_tokens SET last_used_at = datetime('now') WHERE token_hash = ?", [row.token_hash]);
    }
  } catch (e) {}
  return { userId: row.user_id, token };
}

// Define o cookie de autenticação (HttpOnly, SameSite, Secure quando HTTPS)
function setCookie(res, token, secure) {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!secure,
    maxAge: TOKEN_TTL_MS,
    path: '/'
  });
}

function clearCookie(res) {
  res.clearCookie(TOKEN_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}

/**
 * Middleware híbrido: mantém a sessão express quando existe;
 * caso contrário tenta o token persistente (header ou cookie).
 * Preenche req.session.userId para que todas as rotas atuais funcionem.
 */
function syncSession(db, req, res, next) {
  try {
    if (!req.session.userId) {
      const resolved = resolve(db, req);
      if (resolved) {
        req.session.userId = resolved.userId;
        const u = db.get('SELECT role FROM users WHERE id = ?', [resolved.userId]);
        if (u) req.session.role = u.role;
      }
    }
  } catch (e) {}
  next();
}

// Requer autenticação em rotas protegidas (uso opcional em rotas novas)
function requireAuth(db) {
  return (req, res, next) => {
    if (req.session.userId) return next();
    const resolved = resolve(db, req);
    if (resolved) {
      req.session.userId = resolved.userId;
      const u = db.get('SELECT role FROM users WHERE id = ?', [resolved.userId]);
      if (u) req.session.role = u.role;
      return next();
    }
    return res.status(401).json({ error: 'Não autenticado', code: 'AUTH_REQUIRED' });
  };
}

module.exports = { ensureTable, parseCookies, issue, revoke, revokeAll, resolve, setCookie, clearCookie, syncSession, requireAuth, TOKEN_COOKIE };

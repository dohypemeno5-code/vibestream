// ============================================================
// SEGURANÇA — Alertas de invasão + backup automático
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cria um alerta de segurança (fica visível no painel admin)
function createAlert(db, type, severity, message, ipAddress, userId) {
  try {
    db.run(
      "INSERT INTO security_alerts (id, alert_type, severity, message, ip_address, user_id) VALUES (?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), String(type).slice(0, 40), String(severity || 'medio').slice(0, 10),
       String(message).slice(0, 300), String(ipAddress || '').slice(0, 64), String(userId || '')]
    );
  } catch (e) {}
}

// Registra tentativa de login suspeita (repetidas falhas no mesmo IP)
function trackFailedLogin(db, ip, username) {
  const windowStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const count = (db.get("SELECT COUNT(*) as c FROM security_logs WHERE action = 'login_failed' AND ip_address = ? AND created_at > ?", [ip, windowStart]) || {}).c || 0;
  if (count >= 5) {
    createAlert(db, 'login_suspeito', 'alto', 'Muitas tentativas de login falhas no IP ' + ip + ' (usuário: ' + String(username || '?').slice(0, 40) + ')', ip);
  }
}

// Backup automático do banco + uploads
function autoBackup(projectDir, tag) {
  try {
    const dataDir = path.join(projectDir, 'backend', '.data');
    const uploadsDir = path.join(projectDir, 'backend', 'uploads');
    const backupRoot = path.join(projectDir, 'backups', 'auto');
    if (!fs.existsSync(backupRoot)) fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
    const stamp = tag || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(backupRoot, 'db-' + stamp + '.db');
    if (fs.existsSync(path.join(dataDir, '.cache_storage.db'))) {
      fs.copyFileSync(path.join(dataDir, '.cache_storage.db'), dest);
    }
    // Uploads (apenas recentes, limitado a 200MB total)
    if (fs.existsSync(uploadsDir)) {
      const upDest = path.join(backupRoot, 'uploads-' + stamp);
      fs.mkdirSync(upDest, { recursive: true });
      let total = 0;
      const files = fs.readdirSync(uploadsDir);
      for (const f of files.slice(-200)) {
        const src = path.join(uploadsDir, f);
        if (fs.statSync(src).isFile()) {
          const size = fs.statSync(src).size;
          if (total + size > 200 * 1024 * 1024) break;
          try { fs.copyFileSync(src, path.join(upDest, f)); total += size; } catch (e) {}
        }
      }
    }
    return dest;
  } catch (e) {
    console.error('[SECURITY] Backup falhou:', e.message);
    return null;
  }
}

module.exports = { createAlert, trackFailedLogin, autoBackup };

// ============================================================
// RATE LIMIT genérico (tabela rate_limits)
// ============================================================
function rateLimit(db, key, windowSeconds, maxCalls) {
  windowSeconds = windowSeconds || 60;
  maxCalls = maxCalls || 10;
  key = String(key || 'global').slice(0, 80);
  try {
    const rows = db.query(
      "SELECT COUNT(*) as cnt, COALESCE(SUM(count),0) as total FROM rate_limits WHERE action_type = ? AND window_start > datetime('now', ?)",
      ['rl:' + key, '-' + windowSeconds + ' seconds']
    );
    const count = (rows && rows.length) ? Number(rows[0].total || rows[0].cnt || 0) : 0;
    if (count >= maxCalls) {
      db.run("INSERT INTO rate_limits (id, user_id, action_type, count, window_start) VALUES (?, 'system', ?, 1, datetime('now'))",
        [require('uuid').v4(), 'rl:' + key]);
      return { blocked: true, reason: 'Muitas requisições - tente novamente em instantes' };
    }
    db.run("INSERT INTO rate_limits (id, user_id, action_type, count, window_start) VALUES (?, 'system', ?, 1, datetime('now'))",
      [require('uuid').v4(), 'rl:' + key]);
    return { blocked: false };
  } catch (e) {
    return { blocked: false };
  }
}

// ============================================================
// SANITIZAÇÃO central de entradas
// ============================================================
function sanitizeInput(str, maxLen) {
  if (typeof str !== 'string') return str;
  let s = str
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u001F\u007F]/g, '')
    .replace(/['"\\;()]/g, '')
    .replace(/--/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// Valida se é texto aceitável (tamanho mínimo/máximo)
function validText(str, minLen, maxLen) {
  if (typeof str !== 'string') return false;
  const len = str.trim().length;
  return len >= (minLen || 1) && len <= (maxLen || 2000);
}

module.exports = { createAlert, trackFailedLogin, autoBackup, rateLimit, sanitizeInput, validText };

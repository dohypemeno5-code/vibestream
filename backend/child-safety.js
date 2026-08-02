// ============================================================
// PROTEÇÃO INFANTIL VibeStream — Bot Caça-Predador
// Lista negra -> BAN PERMANENTE AUTOMÁTICO + denúncia grave
// ============================================================
const crypto = require('crypto');

const CHILD_BLACKLIST = [
  { pattern: /novinh[oa]s?/i, term: 'novinha/novinho' },
  { pattern: /pedof/i, term: 'pedofilia/pedófilo' },
  { pattern: /lolicon/i, term: 'lolicon' },
  { pattern: /\bcp\b/i, term: 'CP' },
  { pattern: /nudes\s+menor/i, term: 'nudes menor' },
  { pattern: /pede\s+foto\s+pelada/i, term: 'pede foto pelada' },
  { pattern: /incesto\s+com\s+menor/i, term: 'incesto com menor' },
  { pattern: /(?:^|[\s:(-])-1[2-5](?![0-9])/, term: 'idade -15/-14/-13/-12' },
  { pattern: /\bmenor(es)?\b/i, term: 'menor' },
  { pattern: /\bcrian[çc]a(s)?\b/i, term: 'criança' }
];

// Frases de aliciamento (filtro de idade no chat)
const ALICIAMENTO_PATTERNS = [
  /manda\s+foto/i, /vem\s+aqui/i, /te\s+busco/i, /vem\s+c[aá]/i,
  /me\s+manda/i, /foto\s+sua/i, /sozinha/i, /sozinho/i
];

function matchChild(text) {
  const lower = String(text || '').toLowerCase();
  for (const { pattern, term } of CHILD_BLACKLIST) {
    if (pattern.test(lower)) return term;
  }
  return null;
}

function matchAliciamento(text) {
  const lower = String(text || '').toLowerCase();
  for (const p of ALICIAMENTO_PATTERNS) {
    if (p.test(lower)) return p.source;
  }
  return null;
}

// Impressão digital do dispositivo (user-agent)
function deviceFp(userAgent) {
  return crypto.createHash('sha256').update(String(userAgent || 'desconhecido')).digest('hex').slice(0, 32);
}

// ============================================================
// BAN AUTOMÁTICO + DENÚNCIA GRAVE
// ============================================================
function applyChildBan(db, opts) {
  const { userId, autorId, vitimaId, texto, prova, ip, userAgent, matchedTerm } = opts || {};
  if (!db || !userId) return { ok: false, error: 'sem usuário' };
  const uuid = require('uuid').v4;
  const moderation = require('./moderation');
  const security = require('./security');
  try {
    const autor = autorId || userId;
    const vitima = vitimaId || '';
    // 1) Registro em denuncias_graves (prioridade do admin)
    db.run(`INSERT INTO denuncias_graves (id, autor_id, vitima_id, texto, prova, tipo, status, ip, device_fp, created_at)
      VALUES (?, ?, ?, ?, ?, 'infantil', 'enviado_para_analise', ?, ?, datetime('now'))`,
      [uuid(), autor, vitima, String(texto || '').slice(0, 500), String(prova || '').slice(0, 300), String(ip || '').slice(0, 64), deviceFp(userAgent)]);
    // 2) BAN PERMANENTE automático
    const motivo = '🚨 RISCO INFANTIL — banimento permanente automático. Conteúdo: ' + String(matchedTerm || 'conteúdo proibido').slice(0, 60);
    moderation.permanentBan(db, userId, motivo, prova || '', 'child-bot');
    // 3) Remove mensagens/vídeos na hora
    try {
      db.run("UPDATE chat_messages SET text = '[removido por segurança]', media_url = '' WHERE sender_id = ? AND (text LIKE ? OR media_url = ?)", [userId, '%' + String(texto || '').slice(0, 60) + '%', prova || '____']);
    } catch (e) {}
    try {
      db.run("UPDATE posts SET is_deleted = 1, moderation_reason = ? WHERE user_id = ?", ['🚨 RISCO INFANTIL — removido automaticamente', userId]);
    } catch (e) {}
    // 4) Alerta vermelho no painel do admin
    try {
      security.createAlert(db, 'risco_infantil', 'critico', '🚨 RISCO INFANTIL - VER AGORA — ' + String(matchedTerm || 'conteúdo proibido') + ' (user ' + String(userId).slice(0, 12) + ')', ip, userId);
    } catch (e) {}
    // 5) Bloqueia nova conta com o mesmo IP/dispositivo por 30 dias
    try {
      db.run("INSERT OR IGNORE INTO child_safety_blocks (id, ip, device_fp, created_at) VALUES (?, ?, ?, datetime('now'))",
        [uuid(), String(ip || '').slice(0, 64), deviceFp(userAgent)]);
    } catch (e) {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Checa se IP/dispositivo está bloqueado para criar conta (30 dias)
function checkRegistrationBlocked(db, ip, userAgent) {
  try {
    const fp = deviceFp(userAgent);
    const row = db.get(`SELECT id, created_at FROM child_safety_blocks
      WHERE (ip = ? OR device_fp = ?) AND created_at > datetime('now', '-30 days')
      ORDER BY created_at DESC LIMIT 1`, [String(ip || '').slice(0, 64), fp]);
    return row ? { blocked: true, desde: row.created_at } : { blocked: false };
  } catch (e) { return { blocked: false }; }
}

module.exports = {
  CHILD_BLACKLIST, ALICIAMENTO_PATTERNS,
  matchChild, matchAliciamento, deviceFp, applyChildBan, checkRegistrationBlocked
};

// ============================================================
// VIBEGUARD AI — Segurança e Moderação do VibeStream
// Bots: Moderação (chat/comentários), Observação (conteúdo),
//       Administração (filas/estatísticas) + Chat da equipe.
// Privacidade: nunca lê mensagens privadas; denúncias anônimas;
//              apenas dados necessários para segurança.
// ============================================================
const crypto = require('crypto');

const HARASS_PATTERNS = [
  /fei[oa]|burr[oa]|idiot|retardad|lixo humano|in[úu]til|vagabund|vai se foder|vsf|fdp|filho da puta|piranha|vagabund[ao]/i,
  /te odeio|odeio voc[êe]|cala a boca|some daqui|ningu[ée]m te quer|vai morrer|some do meu/i,
  /te pego na sa[íi]da|vou te bater|vou te dar uma li[çc][ãa]o/i
];

// ------------------------------------------------------------
// ANÁLISE DE TEXTO (comentários, chats, posts, títulos)
// ------------------------------------------------------------
function spamScore(text) {
  const s = String(text || '');
  if (!s.trim()) return 100;
  let score = 0;
  if (/(.)\1{9,}/.test(s)) score += 30;
  const words = s.toLowerCase().split(/\s+/).filter(Boolean);
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const maxFreq = Math.max(0, ...Object.values(freq));
  if (words.length > 8 && maxFreq / words.length > 0.5) score += 40;
  const letters = s.replace(/[^a-zA-Zà-úÀ-Ú]/g, '');
  if (letters.length > 10 && letters === letters.toUpperCase()) score += 15;
  const links = (s.match(/https?:\/\/\S+/g) || []).length;
  if (links >= 3) score += 35;
  if (links >= 6) score += 40;
  const emojis = (s.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  if (emojis >= 10) score += 20;
  return Math.min(score, 100);
}

// Retorna { ok, risk: low|medium|high, reason, flags }
function analyzeText(db, text, type) {
  const moderation = require('./moderation');
  const childSafety = require('./child-safety');
  const hay = String(text || '');
  const flags = [];

  const child = childSafety.matchChild(hay);
  if (child) {
    return { ok: false, risk: 'high', reason: 'Conteúdo proibido por segurança (' + child + ')',
      flags: [{ type: 'child', severity: 'critical', label: 'Proteção infantil — VibeGuard', pattern: child }] };
  }

  const mod = moderation.moderateText(hay, type || 'comment');
  if (mod.status === 'blocked') {
    const ftype = mod.severity === 'auto_ban' ? 'impersonation' : 'blocked';
    flags.push({ type: ftype, severity: 'high', label: mod.reason || 'Conteúdo bloqueado', pattern: mod.pattern });
  } else if (mod.status === 'review') {
    flags.push({ type: 'review', severity: 'medium', label: mod.reason || 'Enviado para revisão', pattern: mod.pattern });
  }

  const spam = spamScore(hay);
  if (spam >= 60) flags.push({ type: 'spam', severity: 'high', label: 'Spam/flood detectado', score: spam });
  else if (spam >= 35) flags.push({ type: 'spam', severity: 'medium', label: 'Possível spam', score: spam });

  for (const p of HARASS_PATTERNS) {
    if (p.test(hay)) { flags.push({ type: 'harassment', severity: 'high', label: 'Assédio/desrespeito — VibeGuard', pattern: p.source }); break; }
  }

  if (!flags.length) return { ok: true, risk: 'low', flags: [] };
  const critical = flags.some(f => f.severity === 'critical');
  const high = flags.some(f => f.severity === 'high');
  const medium = flags.some(f => f.severity === 'medium');
  return {
    ok: !high && !critical,
    risk: critical ? 'critical' : high ? 'high' : medium ? 'medium' : 'low',
    reason: flags[0].label,
    flags
  };
}

// ------------------------------------------------------------
// REGISTROS (flags, observações, ações, chat, denúncias)
// ------------------------------------------------------------
function flag(db, data) {
  try {
    db.run("INSERT INTO vg_flags (id, created_at, user_id, content_type, content_id, flag_type, label, severity, source) VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(),
       String(data.userId || ''), String(data.contentType || ''), String(data.contentId || ''),
       String(data.type || ''), String(data.label || '').slice(0, 200), String(data.severity || 'medium'),
       String(data.source || 'vibeguard')]);
  } catch (e) {}
}

function observe(db, data) {
  try {
    db.run("INSERT INTO vg_observations (id, created_at, target_type, target_id, risk, reason, details) VALUES (?, datetime('now'), ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), String(data.targetType || ''), String(data.targetId || ''),
       String(data.risk || 'low'), String(data.reason || '').slice(0, 200), String(data.details || '').slice(0, 500)]);
  } catch (e) {}
}

function action(db, data) {
  try {
    db.run("INSERT INTO vg_actions (id, created_at, moderator_id, action_type, target_type, target_id, note, source) VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), String(data.moderatorId || ''), String(data.actionType || ''),
       String(data.targetType || ''), String(data.targetId || ''), String(data.note || '').slice(0, 300),
       String(data.source || 'vibeguard')]);
  } catch (e) {}
}

function chatPost(db, userId, message, kind, caseRef) {
  try {
    const id = crypto.randomUUID();
    db.run("INSERT INTO vg_chat (id, created_at, user_id, kind, message, case_ref) VALUES (?, datetime('now'), ?, ?, ?, ?)",
      [id, String(userId || ''), String(kind || 'chat'), String(message || '').slice(0, 500), String(caseRef || '').slice(0, 80)]);
    return id;
  } catch (e) { return ''; }
}

function chatList(db, limit) {
  return db.query("SELECT c.*, u.username, u.display_name, u.avatar_url FROM vg_chat c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC LIMIT ?", [limit || 80]).reverse();
}

function systemAlert(db, message, caseRef) {
  return chatPost(db, 'sistema', message, 'alert', caseRef);
}

// ------------------------------------------------------------
// DENÚNCIA ANÔNIMA (reporter_id fica NULL no banco público)
// ------------------------------------------------------------
function anonymousReport(db, data) {
  const id = crypto.randomUUID();
  db.run("INSERT INTO vg_reports (id, created_at, content_type, content_id, reported_user_id, reporter_id, anonymous, reason, evidence_url, status, priority) VALUES (?, datetime('now'), ?, ?, ?, NULL, 1, ?, ?, 'pending', ?)",
    [id, String(data.contentType || ''), String(data.contentId || ''), String(data.reportedUserId || ''),
     String(data.reason || '').slice(0, 500), String(data.evidenceUrl || '').slice(0, 500), priorityOf(data.reason)]);
  return id;
}

// Prioridade: conteúdo grave > denúncia específica > genérica
function priorityOf(reason) {
  const r = String(reason || '').toLowerCase();
  if (/menor|pedof|infantil|novinha|crian[çc]a/.test(r)) return 100;
  if (/amea[çc]a|matar|morrer|viol[êe]ncia|arma|sequestr|estupro/.test(r)) return 80;
  if (/[óo]dio|racis|homi|transfob|ass[ée]dio|sexual/.test(r)) return 60;
  if (/fraude|golpe|falso|fake|spam/.test(r)) return 40;
  return 10;
}

// ------------------------------------------------------------
// ESTATÍSTICAS (painel VibeGuard)
// ------------------------------------------------------------
function stats(db) {
  const count = (sql, params) => {
    try { const r = db.get(sql, params || []); return r ? (r.c || 0) : 0; } catch (e) { return 0; }
  };
  return {
    reportsPending: count("SELECT COUNT(*) c FROM vg_reports WHERE status IN ('pending','analyzing')"),
    flagsOpen: count("SELECT COUNT(*) c FROM vg_flags WHERE resolved = 0"),
    reviewsPending: count("SELECT COUNT(*) c FROM content_reviews WHERE action = 'review'"),
    actionsToday: count("SELECT COUNT(*) c FROM vg_actions WHERE date(created_at) = date('now')"),
    chatMessages: count("SELECT COUNT(*) c FROM vg_chat"),
    anonymousReports: count("SELECT COUNT(*) c FROM vg_reports WHERE anonymous = 1"),
    totalFlags: count("SELECT COUNT(*) c FROM vg_flags"),
    highRisk: count("SELECT COUNT(*) c FROM vg_flags WHERE resolved = 0 AND severity IN ('high','critical')"),
    alerts: count("SELECT COUNT(*) c FROM security_alerts WHERE date(created_at) = date('now')")
  };
}

// ------------------------------------------------------------
// FILA PRIORIZADA (denúncias + revisões + flags)
// ------------------------------------------------------------
function queue(db, limit) {
  const reports = db.query("SELECT r.*, u.username AS reported_username FROM vg_reports r LEFT JOIN users u ON u.id = r.reported_user_id WHERE r.status IN ('pending','analyzing') ORDER BY r.priority DESC, r.created_at ASC LIMIT ?", [limit || 60]).map(r => ({ ...r, kind: 'report' }));
  const reviews = db.query("SELECT c.*, p.title, p.text AS post_text, u.username AS author_username FROM content_reviews c LEFT JOIN posts p ON p.id = c.post_id LEFT JOIN users u ON u.id = c.user_id WHERE c.action = 'review' ORDER BY c.created_at ASC LIMIT ?", [limit || 40]).map(r => ({ ...r, kind: 'review' }));
  const flags = db.query("SELECT f.*, u.username FROM vg_flags f LEFT JOIN users u ON u.id = f.user_id WHERE f.resolved = 0 AND f.severity IN ('high','critical') ORDER BY f.created_at DESC LIMIT ?", [limit || 40]).map(r => ({ ...r, kind: 'flag' }));
  return { reports, reviews, flags };
}

// ------------------------------------------------------------
// MONITORAMENTO DE POST (Bot Observação)
// Analisa o texto, registra observação e aplica decisão.
// ------------------------------------------------------------
function monitorPost(db, post, userId) {
  const moderation = require('./moderation');
  const childSafety = require('./child-safety');
  const hay = String(post.text || '') + ' ' + String(post.media_url || '');
  const child = childSafety.matchChild(hay);
  if (child) {
    observe(db, { targetType: 'post', targetId: post.id, risk: 'critical', reason: 'Proteção infantil: ' + child, details: hay.slice(0, 300) });
    flag(db, { userId, contentType: 'post', contentId: post.id, type: 'child', label: 'Proteção infantil — ' + child, severity: 'critical' });
    return { decision: 'ban', reason: 'Proteção infantil' };
  }
  const res = analyzeText(db, hay, 'post');
  observe(db, { targetType: 'post', targetId: post.id, risk: res.risk, reason: res.reason || '', details: hay.slice(0, 300) });
  for (const f of res.flags) flag(db, { userId, contentType: 'post', contentId: post.id, type: f.type, label: f.label, severity: f.severity });
  if (res.risk === 'high' || res.risk === 'critical') {
    return { decision: 'block', reason: res.reason || 'Bloqueado pelo VibeGuard' };
  }
  if (res.risk === 'medium') {
    return { decision: 'review', reason: res.reason || 'Revisão pelo VibeGuard' };
  }
  return { decision: 'approved', reason: '' };
}

module.exports = {
  analyzeText, spamScore, flag, observe, action,
  chatPost, chatList, systemAlert, anonymousReport,
  priorityOf, stats, queue, monitorPost
};

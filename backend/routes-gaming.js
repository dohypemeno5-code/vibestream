// ============================================================
// VIBEGAMING LIVE + VIBELIVE — convidados, moderação, reações,
// estatísticas do criador, notificações e denúncias
// ============================================================
const express = require('express');
const router = express.Router();
const uuid = require('uuid');
const moderation = require('./moderation');
const security = require('./security');
const childSafety = require('./child-safety');
const liveRooms = require('./live-rooms');

let db; // definido pelo factory

const sanitize = (str, maxLen) => security.sanitizeInput(str, maxLen);
const MAX_GUESTS = 4;

function notify(userId, actorId, type, text) {
  try {
    db().run("INSERT INTO notifications (id, user_id, actor_id, type, content_id, text, is_read) VALUES (?, ?, ?, ?, '', ?, 0)",
      [uuid.v4(), userId, actorId || 'sistema', type, String(text).slice(0, 300)]);
    liveRooms.notifyUser(userId, { type, text, created_at: new Date().toISOString(), is_read: 0 });
  } catch (e) {}
}

function isHost(req, live) { return live && String(live.user_id) === String(req.session.userId); }
function isMod(db, liveId, userId) {
  const g = db().get("SELECT role FROM live_guests WHERE live_id = ? AND user_id = ? AND status = 'aceito'", [liveId, userId]);
  return g && g.role === 'moderador';
}

// ============================================================
// CONVIDADOS (até 4) — convite, aceitar, remover, sair
// ============================================================
router.get('/lives/:id/guests', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const live = db().get("SELECT id, user_id FROM lives WHERE id = ? AND status = 'live'", [req.params.id]);
    if (!live) return res.status(404).json({ error: 'Live não encontrada' });
    const guests = db().query(`
      SELECT lg.*, u.username, u.display_name, u.avatar_url FROM live_guests lg
      JOIN users u ON lg.user_id = u.id
      WHERE lg.live_id = ? AND lg.status = 'aceito' ORDER BY lg.joined_at ASC LIMIT 4`, [req.params.id]);
    res.json({ success: true, guests, max: MAX_GUESTS });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post('/lives/:id/guests/invite', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const live = db().get("SELECT id, user_id FROM lives WHERE id = ? AND status = 'live'", [req.params.id]);
    if (!live) return res.status(404).json({ error: 'Live não encontrada' });
    if (!isHost(req, live) && !isMod(db, req.params.id, req.session.userId)) return res.status(403).json({ error: 'Só o dono ou moderador pode convidar' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Usuário é obrigatório' });
    const target = db().get('SELECT id, username, display_name FROM users WHERE id = ? AND status = "active"', [userId]);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    const active = db().get("SELECT COUNT(*) as c FROM live_guests WHERE live_id = ? AND status = 'aceito'", [req.params.id]);
    if ((active.c || 0) >= MAX_GUESTS) return res.status(400).json({ error: 'Limite de ' + MAX_GUESTS + ' convidados atingido' });
    db().run("INSERT OR IGNORE INTO live_guests (id, live_id, user_id, status, role, invited_by) VALUES (?, ?, ?, 'pendente', 'guest', ?)",
      [uuid.v4(), req.params.id, userId, req.session.userId]);
    notify(userId, req.session.userId, 'familia', (target.display_name || target.username) + ', você foi convidado(a) para a live! Abra o app para aceitar.');
    res.status(201).json({ success: true, message: 'Convite enviado!' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post('/lives/:id/guests/accept', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const live = db().get("SELECT id, user_id FROM lives WHERE id = ? AND status = 'live'", [req.params.id]);
    if (!live) return res.status(404).json({ error: 'Live não encontrada' });
    const active = db().get("SELECT COUNT(*) as c FROM live_guests WHERE live_id = ? AND status = 'aceito'", [req.params.id]);
    if ((active.c || 0) >= MAX_GUESTS) return res.status(400).json({ error: 'Limite de convidados atingido' });
    const upd = db().run("UPDATE live_guests SET status = 'aceito' WHERE live_id = ? AND user_id = ? AND status = 'pendente'", [req.params.id, req.session.userId]);
    res.json({ success: true, message: 'Você entrou na live como convidado!' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post('/lives/:id/guests/:guestId/remove', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const live = db().get("SELECT id, user_id FROM lives WHERE id = ? AND status = 'live'", [req.params.id]);
    if (!live) return res.status(404).json({ error: 'Live não encontrada' });
    if (!isHost(req, live)) return res.status(403).json({ error: 'Só o dono da live pode remover convidados' });
    db().run("UPDATE live_guests SET status = 'removido' WHERE live_id = ? AND user_id = ? AND status = 'aceito'", [req.params.id, req.params.guestId]);
    notify(req.params.guestId, req.session.userId, 'live_stopped', 'Você foi removido(a) da live pelo apresentador(a).');
    res.json({ success: true, message: 'Convidado removido' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post('/lives/:id/guests/leave', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    db().run("UPDATE live_guests SET status = 'removido' WHERE live_id = ? AND user_id = ?", [req.params.id, req.session.userId]);
    res.json({ success: true, message: 'Você saiu da live' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// MODERAÇÃO DO CHAT: fixar, ban temporário, denunciar mensagem
// ============================================================
router.post('/lives/:id/pin', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const live = db().get("SELECT id, user_id FROM lives WHERE id = ? AND status = 'live'", [req.params.id]);
    if (!live) return res.status(404).json({ error: 'Live não encontrada' });
    if (!isHost(req, live) && !isMod(db, req.params.id, req.session.userId)) return res.status(403).json({ error: 'Permissão negada' });
    const { commentId } = req.body;
    db().run("UPDATE live_comments SET pinned = 0 WHERE live_id = ?", [req.params.id]);
    if (commentId) db().run("UPDATE live_comments SET pinned = 1 WHERE id = ? AND live_id = ?", [commentId, req.params.id]);
    const pinned = db().query("SELECT lc.*, u.username, u.display_name FROM live_comments lc JOIN users u ON lc.user_id = u.id WHERE lc.live_id = ? AND lc.pinned = 1 LIMIT 1", [req.params.id]);
    liveRooms.broadcast(req.params.id, { type: 'live:pin', liveId: req.params.id, pinned: pinned[0] || null });
    res.json({ success: true, pinned: pinned[0] || null });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post('/lives/:id/moderate/ban', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const live = db().get("SELECT id, user_id FROM lives WHERE id = ? AND status = 'live'", [req.params.id]);
    if (!live) return res.status(404).json({ error: 'Live não encontrada' });
    if (!isHost(req, live) && !isMod(db, req.params.id, req.session.userId)) return res.status(403).json({ error: 'Permissão negada' });
    const { userId, minutes, reason } = req.body;
    const mins = Math.max(1, Math.min(parseInt(minutes) || 10, 1440));
    const target = db().get('SELECT id, username FROM users WHERE id = ?', [userId]);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    db().run("INSERT INTO live_chat_bans (id, live_id, user_id, until_at, reason, banned_by) VALUES (?, ?, ?, datetime('now', '+' || ? || ' minutes'), ?, ?)",
      [uuid.v4(), req.params.id, userId, mins, sanitize(String(reason || 'flood/spam'), 200), req.session.userId]);
    try { db().run("INSERT INTO moderation_logs (id, action_type, target_user_id, content_type, reason, moderated_by) VALUES (?, 'live_chat_ban', ?, 'live', ?, ?)", [uuid.v4(), userId, 'Ban temporário no chat da live (' + mins + ' min)', req.session.userId]); } catch (e) {}
    liveRooms.broadcast(req.params.id, { type: 'live:mod', liveId: req.params.id, action: 'ban', user_id: userId, minutes: mins });
    res.json({ success: true, message: target.username + ' banido do chat por ' + mins + ' min' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post('/lives/:id/moderate/unban', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const live = db().get("SELECT id, user_id FROM lives WHERE id = ? AND status = 'live'", [req.params.id]);
    if (!live) return res.status(404).json({ error: 'Live não encontrada' });
    if (!isHost(req, live) && !isMod(db, req.params.id, req.session.userId)) return res.status(403).json({ error: 'Permissão negada' });
    const { userId } = req.body;
    db().run("DELETE FROM live_chat_bans WHERE live_id = ? AND user_id = ?", [req.params.id, userId]);
    res.json({ success: true, message: 'Usuário desbanido do chat' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post('/lives/:id/report-message', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const { messageId, reason } = req.body;
    if (!messageId || !reason || String(reason).trim().length < 5) return res.status(400).json({ error: 'Motivo obrigatório' });
    db().run("INSERT INTO live_message_reports (id, live_id, message_id, reporter_id, reason, status) VALUES (?, ?, ?, ?, ?, 'pendente')",
      [uuid.v4(), req.params.id, messageId, req.session.userId, sanitize(String(reason), 300)]);
    try { security.createAlert(db, 'live_report', 'media', '🚨 Denúncia de mensagem na live: ' + String(reason).slice(0, 100), req.ip, req.session.userId); } catch (e) {}
    res.status(201).json({ success: true, message: 'Denúncia enviada! A equipe vai analisar.' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// Denúncias rápidas: live / usuário / mensagem
router.post('/lives/:id/report', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const rl = security.rateLimit(db(), 'live-report:' + req.session.userId, 3600, 10);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const live = db().get('SELECT id, user_id FROM lives WHERE id = ?', [req.params.id]);
    if (!live) return res.status(404).json({ error: 'Live não encontrada' });
    const { reason, messageId } = req.body;
    if (!reason) return res.status(400).json({ error: 'Motivo é obrigatório' });
    if (messageId) {
      db().run("INSERT INTO live_message_reports (id, live_id, message_id, reporter_id, reason, status) VALUES (?, ?, ?, ?, ?, 'pendente')",
        [uuid.v4(), req.params.id, messageId, req.session.userId, sanitize(String(reason), 300)]);
    } else {
      db().run("INSERT INTO reports (id, reporter_id, reported_user_id, content_id, content_type, report_reason, description) VALUES (?, ?, ?, ?, 'live', ?, ?)",
        [uuid.v4(), req.session.userId, live.user_id, req.params.id, sanitize(String(reason), 100), sanitize(String(req.body.description || ''), 500)]);
    }
    res.status(201).json({ success: true, message: 'Denúncia enviada! A equipe vai analisar.' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// REAÇÕES (emojis)
// ============================================================
router.post('/lives/:id/reaction', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const { emoji } = req.body;
    if (!emoji || String(emoji).length > 8) return res.status(400).json({ error: 'Emoji inválido' });
    const room = liveRooms.getRoom(req.params.id);
    if (!room) return res.status(404).json({ error: 'Live não encontrada' });
    try { db().run("INSERT OR IGNORE INTO live_reactions (id, live_id, user_id, emoji) VALUES (?, ?, ?, ?)", [uuid.v4(), req.params.id, req.session.userId, String(emoji)]); } catch (e) {}
    const counts = db().query('SELECT emoji, COUNT(*) as c FROM live_reactions WHERE live_id = ? GROUP BY emoji ORDER BY c DESC LIMIT 10', [req.params.id]);
    liveRooms.broadcast(req.params.id, { type: 'live:reaction', liveId: req.params.id, emoji: String(emoji), user: req.session.userId, counts });
    res.json({ success: true, counts });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// ESTATÍSTICAS DO CRIADOR + HISTÓRICO
// ============================================================
router.get('/lives/my-stats', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const uid = req.session.userId;
    const totalViews = (db().get("SELECT COALESCE(SUM(viewer_count),0) as c FROM lives WHERE user_id = ?", [uid]) || {}).c || 0;
    const liveCount = (db().get("SELECT COUNT(*) as c FROM lives WHERE user_id = ?", [uid]) || {}).c || 0;
    const totalMinutes = (db().get("SELECT COALESCE(SUM((julianday(COALESCE(ended_at, datetime('now'))) - julianday(COALESCE(started_at, created_at))) * 1440),0) as m FROM lives WHERE user_id = ? AND status = 'ended'", [uid]) || {}).m || 0;
    const followersBefore = (db().get("SELECT followers_count FROM users WHERE id = ?", [uid]) || {}).followers_count || 0;
    const peak = (db().get("SELECT COALESCE(MAX(peak_viewers),0) as p FROM lives WHERE user_id = ?", [uid]) || {}).p || 0;
    const recent = db().query("SELECT * FROM lives WHERE user_id = ? ORDER BY created_at DESC LIMIT 10", [uid]);
    res.json({ success: true, data: {
      totalViews: Math.round(totalViews), liveCount, totalMinutes: Math.round(totalMinutes),
      followers: followersBefore, peak, recent: recent.map(l => ({
        id: l.id, title: l.title, category: l.category, status: l.status,
        viewer_count: l.viewer_count, peak_viewers: l.peak_viewers,
        started_at: l.started_at || l.created_at, ended_at: l.ended_at, created_at: l.created_at
      }))
    } });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// CONFIG DE NOTIFICAÇÕES
// ============================================================
router.put('/settings/notifications', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const { notifyLives } = req.body;
    if (typeof notifyLives !== 'boolean') return res.status(400).json({ error: 'Campo notifyLives (boolean) obrigatório' });
    db().run('UPDATE users SET notify_lives = ? WHERE id = ?', [notifyLives ? 1 : 0, req.session.userId]);
    res.json({ success: true, notifyLives });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// FLOOD / SPAM — checagem usada também pelo WebSocket
// ============================================================
function isChatBanned(liveId, userId) {
  try {
    const b = db().get("SELECT id FROM live_chat_bans WHERE live_id = ? AND user_id = ? AND until_at > datetime('now')", [liveId, userId]);
    return !!b;
  } catch (e) { return false; }
}

function chatAllowed(liveId, userId, text) {
  if (!db()) return { allowed: true };
  if (isChatBanned(liveId, userId)) return { allowed: false, reason: 'Você está temporariamente banido(a) do chat desta live' };
  const lower = String(text || '');
  // Flood: mesma mensagem repetida
  const recent = db().query('SELECT message FROM live_comments WHERE live_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 5', [liveId, userId]);
  const same = recent.filter(r => String(r.message).toLowerCase() === lower.toLowerCase()).length;
  if (same >= 3) return { allowed: false, reason: 'Bloqueado: envio repetido (flood) — aguarde um momento' };
  // Limite de mensagens por minuto
  const cnt = (db().get("SELECT COUNT(*) as c FROM live_comments WHERE live_id = ? AND user_id = ? AND created_at > datetime('now', '-60 seconds')", [liveId, userId]) || {}).c || 0;
  if (cnt >= 15) return { allowed: false, reason: 'Você está enviando mensagens rápido demais' };
  const child = childSafety.matchChild(lower);
  if (child) return { allowed: false, reason: 'Conteúdo removido por segurança', child: true };
  const mod = moderation.moderateText(lower, 'comment');
  if (mod.status === 'blocked') return { allowed: false, reason: mod.reason || 'Mensagem não permitida' };
  return { allowed: true };
}

module.exports = function (database) {
  db = () => database.getInstance();
  return router;
};

module.exports.chatAllowed = chatAllowed;
module.exports.isChatBanned = isChatBanned;

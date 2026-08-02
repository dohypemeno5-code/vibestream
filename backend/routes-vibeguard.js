// ============================================================
// VIBEGUARD AI — Rotas de segurança e moderação
// Toda resposta é JSON puro. Rotas protegidas por role.
// ============================================================
const express = require('express');
const router = express.Router();
const uuid = require('uuid');
const vibeGuard = require('./vibe-guard');
const security = require('./security');
const moderation = require('./moderation');
const childSafety = require('./child-safety');
const liveRooms = require('./live-rooms');

let db;

const sanitize = (str, maxLen) => security.sanitizeInput(str, maxLen);

function ok(res, data) {
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({ success: true, data });
}
function err(res, status, message, code) {
  res.setHeader('Content-Type', 'application/json');
  return res.status(status).json({ success: false, error: message, code: code || '' });
}
function isAdminOrMod(userId) {
  const u = db().get('SELECT role FROM users WHERE id = ?', [userId]);
  return u && (u.role === 'admin' || u.role === 'moderator');
}
function isAdmin(userId) {
  const u = db().get('SELECT role FROM users WHERE id = ?', [userId]);
  return u && u.role === 'admin';
}
function notif(userId, actorId, type, text) {
  try {
    db().run("INSERT INTO notifications (id, user_id, actor_id, type, content_id, text, is_read) VALUES (?, ?, ?, ?, '', ?, 0)",
      [uuid.v4(), userId, actorId || 'sistema', String(type).slice(0, 30), String(text).slice(0, 300)]);
    liveRooms.notifyUser(userId, { type, text, created_at: new Date().toISOString(), is_read: 0 });
  } catch (e) {}
}

// ============================================================
// CHECK DE TEXTO (Bot Moderação) — usado em chat, comentários
// ============================================================
router.post('/vibeguard/check-text', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return err(res, 401, 'Não autenticado');
    const rl = security.rateLimit(db(), 'vg-check:' + req.session.userId, 60, 40);
    if (rl.blocked) return err(res, 429, rl.reason, 'RATE_LIMITED');
    const { text, type } = req.body || {};
    const clean = String(text || '').slice(0, 300);
    const res2 = vibeGuard.analyzeText(db, clean, type || 'comment');
    for (const f of res2.flags) {
      vibeGuard.flag(db(), { userId: req.session.userId, contentType: type || 'comment', contentId: '', type: f.type, label: f.label, severity: f.severity });
    }
    if (res2.risk === 'high' || res2.risk === 'critical') {
      return ok(res, { ok: false, hidden: true, risk: res2.risk, reason: res2.reason || 'Mensagem oculta pela moderação (VibeGuard)' });
    }
    return ok(res, { ok: true, hidden: false, risk: res2.risk, warning: res2.risk === 'medium', flags: res2.flags });
  } catch (e) { return err(res, 500, e.message); }
});

// ============================================================
// DENÚNCIA ANÔNIMA — sem revelar identidade do denunciante
// ============================================================
router.post('/vibeguard/report-anonymous', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return err(res, 401, 'Não autenticado');
    const rl = security.rateLimit(db(), 'vg-anon:' + req.session.userId, 3600, 10);
    if (rl.blocked) return err(res, 429, rl.reason);
    const { contentType, contentId, reportedUserId, reason, evidenceUrl } = req.body || {};
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 5) return err(res, 400, 'Descreva o motivo da denúncia (mínimo 5 caracteres)');
    const types = ['live', 'post', 'comment', 'profile', 'message', 'user', 'video'];
    const ctype = types.includes(String(contentType)) ? String(contentType) : 'post';

    // Resolve o usuário reportado quando não informado (ex: live)
    let reportedId = String(reportedUserId || '');
    if (!reportedId && contentId) {
      if (ctype === 'live') {
        const live = db().get('SELECT user_id FROM lives WHERE id = ?', [contentId]);
        if (live) reportedId = live.user_id;
      } else if (ctype === 'post') {
        const post = db().get('SELECT user_id FROM posts WHERE id = ?', [contentId]);
        if (post) reportedId = post.user_id;
      }
    }

    const rid = vibeGuard.anonymousReport(db(), {
      contentType: ctype, contentId: String(contentId || ''),
      reportedUserId: reportedId, reason: cleanReason,
      evidenceUrl: String(evidenceUrl || '').slice(0, 500)
    });
    vibeGuard.systemAlert(db(), '🚨 Nova denúncia anônima (' + ctype + ') — prioridade ' + vibeGuard.priorityOf(cleanReason) + ': ' + cleanReason.slice(0, 120), rid);
    try { security.createAlert(db, 'vg_anon_report', 'alta', '🚨 Denúncia anônima ' + ctype + ': ' + cleanReason.slice(0, 120), req.ip, reportedId); } catch (e) {}

    // Se a denúncia for grave e houver usuário reportado: registra flag
    if (reportedId) {
      const pr = vibeGuard.priorityOf(cleanReason);
      if (pr >= 60) {
        vibeGuard.flag(db(), { userId: reportedId, contentType: ctype, contentId: String(contentId || ''), type: 'reported', label: 'Denúncia anônima prioritária: ' + cleanReason.slice(0, 150), severity: pr >= 80 ? 'high' : 'medium' });
      }
    }

    res.status(201).json({ success: true, message: 'Denúncia anônima enviada! A identidade do denunciante está protegida.' });
  } catch (e) { return err(res, 500, e.message); }
});

// ============================================================
// PAINEL — apenas admin/moderador
// ============================================================
function requireStaff(req, res, next) {
  if (!req.session?.userId) return err(res, 401, 'Não autenticado');
  if (!isAdminOrMod(req.session.userId)) return err(res, 403, 'Acesso negado — somente equipe de segurança');
  next();
}

router.get('/vibeguard/stats', requireStaff, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try { return ok(res, vibeGuard.stats(db())); } catch (e) { return err(res, 500, e.message); }
});

router.get('/vibeguard/queue', requireStaff, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try { return ok(res, vibeGuard.queue(db(), 80)); } catch (e) { return err(res, 500, e.message); }
});

router.get('/vibeguard/flags', requireStaff, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const flags = db().query("SELECT f.*, u.username FROM vg_flags f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT 120");
    return ok(res, { flags });
  } catch (e) { return err(res, 500, e.message); }
});

router.get('/vibeguard/actions', requireStaff, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const actions = db().query("SELECT a.*, u.username FROM vg_actions a LEFT JOIN users u ON u.id = a.moderator_id ORDER BY a.created_at DESC LIMIT 120");
    return ok(res, { actions });
  } catch (e) { return err(res, 500, e.message); }
});

// Chat da equipe de segurança
router.get('/vibeguard/chat', requireStaff, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try { return ok(res, { messages: vibeGuard.chatList(db(), 100) }); } catch (e) { return err(res, 500, e.message); }
});

router.post('/vibeguard/chat', requireStaff, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { message, kind, caseRef } = req.body || {};
    const clean = String(message || '').trim();
    if (!clean) return err(res, 400, 'Mensagem vazia');
    const id = vibeGuard.chatPost(db(), req.session.userId, clean.slice(0, 500), String(kind || 'chat'), String(caseRef || ''));
    return res.status(201).json({ success: true, message: 'Enviado', id });
  } catch (e) { return err(res, 500, e.message); }
});

// Resolver denúncia (aceitar/rejeitar/ocultar) + punição opcional
router.post('/vibeguard/reports/:id/resolve', requireStaff, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const report = db().get('SELECT * FROM vg_reports WHERE id = ?', [req.params.id]);
    if (!report) return err(res, 404, 'Denúncia não encontrada');
    const { decision, notes, punishment, punishmentMinutes } = req.body || {};
    const decisionMap = ['accepted', 'rejected', 'hidden', 'analyzing'];
    const finalDecision = decisionMap.includes(String(decision)) ? String(decision) : 'accepted';
    db().run("UPDATE vg_reports SET status = ?, notes = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?",
      [finalDecision, sanitize(String(notes || ''), 300), req.session.userId, report.id]);

    // Punição progressiva: aviso -> suspensão -> ban
    if (report.reported_user_id && String(decision) !== 'rejected') {
      const pun = String(punishment || '');
      if (pun === 'warning') {
        moderation.applyPunishment(db(), report.reported_user_id, 'VibeGuard: ' + (notes || 'denúncia aceita'), 'vibeguard');
        notif(report.reported_user_id, 'sistema', 'moderation', 'Você recebeu um aviso após análise de denúncia.');
      } else if (pun === 'suspend') {
        const minutes = Math.min(Math.max(parseInt(punishmentMinutes || 60 * 24 * 7, 10) || 1, 1), 60 * 24 * 90); // 1min a 90 dias
        try {
          db().run("INSERT INTO bans (id, user_id, banned_by, reason, ban_type, expires_at) VALUES (?, ?, ?, ?, 'temporario', datetime('now', '+' || ? || ' minutes'))",
            [uuid.v4(), report.reported_user_id, req.session.userId, 'VibeGuard: suspensão temporária após denúncia', minutes]);
          db().run("UPDATE users SET status = 'banned' WHERE id = ?", [report.reported_user_id]);
        } catch (e) {}
        notif(report.reported_user_id, 'sistema', 'ban', 'Sua conta foi suspensa temporariamente após análise de denúncia.');
      } else if (pun === 'ban') {
        moderation.permanentBan(db(), report.reported_user_id, 'VibeGuard: banimento após análise de denúncia', '', 'vibeguard');
        notif(report.reported_user_id, 'sistema', 'ban', 'Sua conta foi banida permanentemente após análise de denúncia.');
      }
    }
    vibeGuard.action(db(), { moderatorId: req.session.userId, actionType: 'resolve:' + finalDecision, targetType: 'report', targetId: report.id, note: (notes || '') + (punishment ? ' | punição: ' + punishment : ''), source: 'vibeguard' });
    vibeGuard.systemAlert(db(), (finalDecision === 'accepted' ? '✅' : finalDecision === 'rejected' ? '↩️' : '🙈') + ' Denúncia ' + report.id.slice(0, 8) + ' resolvida como ' + finalDecision + (punishment ? ' (punição: ' + punishment + ')' : ''), report.id);
    return ok(res, { message: 'Denúncia atualizada' });
  } catch (e) { return err(res, 500, e.message); }
});

// Revisão humana de post (aprovar/remover/sinalizar)
router.post('/vibeguard/posts/:id/review', requireStaff, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const post = db().get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return err(res, 404, 'Post não encontrado');
    const { decision, reason } = req.body || {};
    if (decision === 'approve') {
      db().run("UPDATE posts SET status = 'approved', moderation_reason = ? WHERE id = ?", ['Aprovado pela revisão VibeGuard', post.id]);
      db().run("UPDATE content_reviews SET action = 'approved' WHERE post_id = ?", [post.id]);
    } else if (decision === 'remove') {
      db().run("UPDATE posts SET status = 'blocked', is_deleted = 1, moderation_reason = ? WHERE id = ?", [sanitize(String(reason || 'Removido pela moderação VibeGuard'), 200), post.id]);
      db().run("UPDATE content_reviews SET action = 'blocked' WHERE post_id = ?", [post.id]);
      moderation.applyPunishment(db(), post.user_id, reason || 'Conteúdo removido pela revisão', 'vibeguard');
      notif(post.user_id, 'sistema', 'moderation', 'Sua publicação foi removida: ' + (reason || 'violação das regras'));
    } else {
      db().run("UPDATE posts SET status = 'review', moderation_reason = ? WHERE id = ?", [sanitize(String(reason || 'Em análise'), 200), post.id]);
      db().run("UPDATE content_reviews SET action = 'review' WHERE post_id = ?", [post.id]);
    }
    vibeGuard.action(db, { moderatorId: req.session.userId, actionType: 'review:' + decision, targetType: 'post', targetId: post.id, note: reason || '', source: 'vibeguard' });
    return ok(res, { message: 'Revisão aplicada' });
  } catch (e) { return err(res, 500, e.message); }
});

module.exports = function (database) {
  db = () => database.getInstance();
  return router;
};

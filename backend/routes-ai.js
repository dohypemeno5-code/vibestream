// ============================================================
// VIBEAI CREATOR — API de criação de vídeos com IA
// Rotas /api/ai/* — nunca expõe chaves; créditos, limites, logs
// ============================================================
const express = require('express');
const router = express.Router();
const uuid = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const moderation = require('./moderation');
const security = require('./security');
const childSafety = require('./child-safety');
const liveRooms = require('./live-rooms');
const ai = require('./ai-creator');

let db; // definido pelo factory abaixo

const sanitize = (str, maxLen) => security.sanitizeInput(str, maxLen);

function createNotification(db, userId, actorId, type, contentId, text) {
  try {
    db().run('INSERT INTO notifications (id, user_id, actor_id, type, content_id, text, is_read) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [uuid.v4(), userId, actorId || '', type, contentId || '', text]);
    liveRooms.notifyUser(userId, { type, content_id: contentId, actor_id: actorId, text, created_at: new Date().toISOString(), is_read: 0 });
  } catch (e) {}
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10MB
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;   // 25MB

// Valida magic bytes: webm (1A45DFA3) ou mp4 (ftyp em 4..8). Rejeita arquivo vazio/corrompido.
function validateVideoBuffer(buf, mime) {
  if (!buf || buf.length < 16) return false;
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return true; // webm/mkv
  if (buf.slice(4, 8).toString('latin1') === 'ftyp') return true; // mp4/mov
  if (String(mime || '').startsWith('video/')) return true; // tolerância: mime video válido
  return false;
}

function saveBase64Media(dataUrl) {
  const match = /^data:([a-z0-9+./-]+);base64,(.*)$/i.exec(dataUrl || '');
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  if (!base64 || base64.length < 64) return { error: 'invalid', mime };
  const isVideo = String(mime || '').startsWith('video/');
  const approxBytes = Math.ceil(base64.length * 3 / 4);
  const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (approxBytes > limit) return { error: 'too_large', mime, limit };
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm' };
  const ext = map[mime];
  if (!ext) return null;
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) return { error: 'invalid', mime };
  if (isVideo && !validateVideoBuffer(buf, mime)) return { error: 'corrupt', mime };
  const dir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  const name = 'ai_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return { url: '/uploads/' + name, mime, size: buf.length };
}

function isAdminOrMod(db, userId) {
  const u = db().get('SELECT role FROM users WHERE id = ?', [userId]);
  return u && (u.role === 'admin' || u.role === 'moderator');
}

function ownDraft(db, draftId, userId) {
  return db().get('SELECT * FROM ai_drafts WHERE id = ? AND user_id = ?', [draftId, userId]);
}

// ============================================================
// CONFIG (custo, limites, estilos, saldo)
// ============================================================
router.get('/ai/config', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const vip = ai.getVipTier(db, req.session.userId);
    res.json({
      success: true,
      cost: ai.COST_PER_GENERATION,
      dailyLimit: ai.dailyLimit(db, req.session.userId),
      dailyUsed: ai.usedToday(db, req.session.userId),
      balance: ai.getBalance(db, req.session.userId),
      isVip: !!vip,
      styles: Object.entries(ai.STYLES).map(([key, s]) => ({ key, label: s.label, emoji: s.emoji, colors: s.colors }))
    });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// GERAR (roteiro + título + descrição + hashtags + legenda + capa)
// ============================================================
router.post('/ai/generate', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const rl = security.rateLimit(db(), 'ai:' + req.session.userId, 3600, 30);
    if (rl.blocked) return res.status(429).json({ error: rl.reason, code: 'RATE_LIMITED' });

    const { idea, style } = req.body || {};
    const cleanIdea = String(idea || '').trim().replace(/\s+/g, ' ').slice(0, 500);
    if (cleanIdea.length < 10) return res.status(400).json({ error: 'Escreva uma ideia com pelo menos 10 caracteres' });
    const styleKey = ai.STYLES[style] ? style : 'shorts';

    // Abuso: muito texto repetido / spam
    const abuse = moderation.checkReportAbuse(db, req.session.userId, { contentType: 'ai', contentId: cleanIdea, userId: null });
    if (abuse.blocked) return res.status(429).json({ error: abuse.error, code: 'ABUSE_BLOCKED' });

    // Segurança do conteúdo
    const safe = ai.checkContentSafety(db, cleanIdea + ' ' + String(style));
    if (!safe.ok) {
      ai.log(db, req.session.userId, 'generate_blocked', 'denied', safe.reason, req.ip);
      return res.status(403).json({ error: safe.reason, code: 'AI_CONTENT_BLOCKED' });
    }

    // Limite diário
    const dailyLimit = ai.dailyLimit(db, req.session.userId);
    const used = ai.usedToday(db, req.session.userId);
    if (used >= dailyLimit) {
      ai.log(db, req.session.userId, 'generate_limit', 'denied', 'limite diário atingido (' + used + '/' + dailyLimit + ')', req.ip);
      return res.status(429).json({ error: 'Limite diário de gerações atingido (' + used + '/' + dailyLimit + '). Volte amanhã.', code: 'DAILY_LIMIT' });
    }

    // Créditos
    const balance = ai.getBalance(db, req.session.userId);
    if (balance < ai.COST_PER_GENERATION) {
      ai.log(db, req.session.userId, 'generate_nocredits', 'denied', 'saldo ' + balance, req.ip);
      return res.status(402).json({ error: 'Moedas insuficientes. A geração custa ' + ai.COST_PER_GENERATION + ' moedas. Você tem ' + balance + '.', code: 'NO_CREDITS', cost: ai.COST_PER_GENERATION, balance });
    }

    const bundle = ai.generateBundle(cleanIdea, styleKey);
    const id = uuid.v4();
    db().run(
      'INSERT INTO ai_drafts (id, user_id, idea, style, title, description, script, hashtags, caption, cover_url, status, credits_cost, moderation_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
      [id, req.session.userId, bundle.idea, bundle.style, bundle.title, bundle.description, bundle.script, JSON.stringify(bundle.hashtags), bundle.caption, bundle.cover_url, 'ready', ai.COST_PER_GENERATION, 'aprovado']
    );
    ai.spendCredits(db, req.session.userId, ai.COST_PER_GENERATION);
    ai.bumpUsage(db, req.session.userId);
    ai.log(db, req.session.userId, 'generate', 'ok', 'estilo ' + bundle.style, req.ip);

    const draft = db().get('SELECT * FROM ai_drafts WHERE id = ?', [id]);
    res.status(201).json({ success: true, draft, balance: ai.getBalance(db, req.session.userId), message: 'Vídeo criado pela IA!' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// HISTÓRICO
// ============================================================
router.get('/ai/drafts', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const drafts = db().query(
      "SELECT id, idea, style, title, status, cover_url, video_url, published_post_id, credits_cost, created_at FROM ai_drafts WHERE user_id = ? AND status != 'deleted' ORDER BY created_at DESC LIMIT 50",
      [req.session.userId]
    );
    res.json({ success: true, drafts });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// DETALHE (dono ou admin)
// ============================================================
router.get('/ai/drafts/:id', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const draft = db().get('SELECT * FROM ai_drafts WHERE id = ?', [req.params.id]);
    if (!draft) return res.status(404).json({ error: 'Rascunho não encontrado' });
    if (String(draft.user_id) !== String(req.session.userId) && !isAdminOrMod(db, req.session.userId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    let script = { scenes: [] };
    try { script = JSON.parse(draft.script || '{}'); } catch (e) {}
    let hashtags = [];
    try { hashtags = JSON.parse(draft.hashtags || '[]'); } catch (e) {}
    res.json({ success: true, draft: { ...draft, script, hashtags } });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// SALVAR VÍDEO DO RASCUNHO (gerado no aparelho -> servidor)
// Valida formato/tamanho, protege contra arquivo corrompido.
// ============================================================
router.post('/ai/drafts/:id/save-video', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const rl = security.rateLimit(db(), 'ai-savevideo:' + req.session.userId, 3600, 40);
    if (rl.blocked) return res.status(429).json({ error: rl.reason, code: 'RATE_LIMITED' });
    const draft = ownDraft(db, req.params.id, req.session.userId);
    if (!draft) return res.status(404).json({ error: 'Rascunho não encontrado' });
    if (draft.status === 'published') return res.status(400).json({ error: 'Este vídeo já foi publicado' });

    const { videoDataUrl, videoUrl: videoUrlBody } = req.body || {};
    let videoUrl = draft.video_url || '';
    if (videoUrlBody && /^\/uploads\//.test(videoUrlBody)) {
      videoUrl = String(videoUrlBody).slice(0, 300);
    } else if (videoDataUrl) {
      const saved = saveBase64Media(videoDataUrl);
      if (!saved || saved.error === 'invalid') return res.status(400).json({ error: 'Vídeo inválido — use MP4 ou WebM' });
      if (saved.error === 'corrupt') return res.status(400).json({ error: 'Arquivo de vídeo corrompido — gere novamente' });
      if (saved.error === 'too_large') return res.status(400).json({ error: 'Vídeo muito grande (máx 25MB). Tente em qualidade menor.', code: 'VIDEO_TOO_LARGE' });
      videoUrl = saved.url;
    }
    if (!videoUrl) return res.status(400).json({ error: 'Envie o vídeo gerado (videoDataUrl ou videoUrl)' });

    db().run("UPDATE ai_drafts SET video_url = ?, status = 'ready' WHERE id = ?", [videoUrl, draft.id]);
    ai.log(db, req.session.userId, 'save_video', 'ok', videoUrl, req.ip);
    const updated = db().get('SELECT * FROM ai_drafts WHERE id = ?', [draft.id]);
    res.status(201).json({ success: true, message: 'Rascunho salvo com o vídeo!', draft: updated });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// PUBLICAR NO FEED (salva vídeo, cria post, notifica seguidores)
// ============================================================
router.post('/ai/drafts/:id/publish', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const rl = security.rateLimit(db(), 'ai-publish:' + req.session.userId, 3600, 30);
    if (rl.blocked) return res.status(429).json({ error: rl.reason, code: 'RATE_LIMITED' });
    const draft = ownDraft(db, req.params.id, req.session.userId);
    if (!draft) return res.status(404).json({ error: 'Rascunho não encontrado' });
    if (draft.status === 'published') return res.status(400).json({ error: 'Este vídeo já foi publicado' });

    const rules = db().get('SELECT user_id FROM user_rules_acceptance WHERE user_id = ?', [req.session.userId]);
    if (!rules) return res.status(403).json({ error: 'Você precisa aceitar as regras da plataforma antes de publicar', code: 'RULES_REQUIRED' });

    const { videoDataUrl, videoUrl: videoUrlBody, coverDataUrl, title, description, caption, hashtags } = req.body || {};
    const finalTitle = sanitize(String(title || draft.title || '').slice(0, 120), 120) || draft.title;
    const finalDesc = sanitize(String(description || draft.description || '').slice(0, 1000), 1000) || draft.description;
    const finalCaption = sanitize(String(caption || draft.caption || '').slice(0, 300), 300) || draft.caption;
    const finalTags = Array.isArray(hashtags) ? hashtags.slice(0, 10).map(h => String(h).replace(/[^a-z0-9à-ú_]/gi, '')) : [];

    // Segurança final
    const hay = finalTitle + ' ' + finalDesc + ' ' + finalCaption + ' ' + finalTags.join(' ');
    const child = childSafety.matchChild(hay);
    if (child) {
      childSafety.applyChildBan(db(), {
        userId: req.session.userId, autorId: req.session.userId,
        texto: hay, prova: '', ip: req.ip, userAgent: req.headers['user-agent'], matchedTerm: child
      });
      ai.log(db, req.session.userId, 'publish_child', 'banned', child, req.ip);
      return res.status(403).json({ error: 'Conteúdo removido por segurança — conta banida permanentemente', code: 'CHILD_BANNED' });
    }
    const safe = ai.checkContentSafety(db, hay);
    if (!safe.ok) {
      ai.log(db, req.session.userId, 'publish_blocked', 'denied', safe.reason, req.ip);
      return res.status(403).json({ error: safe.reason, code: 'AI_CONTENT_BLOCKED' });
    }

    // Salva o vídeo gerado (ou usa URL já enviada via /api/media)
    let videoUrl = draft.video_url || '';
    if (videoUrlBody && /^\/uploads\//.test(videoUrlBody)) {
      videoUrl = String(videoUrlBody).slice(0, 300);
    } else if (videoDataUrl) {
      const saved = saveBase64Media(videoDataUrl);
      if (!saved || saved.error === 'invalid') return res.status(400).json({ error: 'Vídeo inválido (use MP4 ou WebM)' });
      if (saved.error === 'corrupt') return res.status(400).json({ error: 'Arquivo de vídeo corrompido — gere o vídeo novamente', code: 'VIDEO_CORRUPT' });
      if (saved.error === 'too_large') return res.status(400).json({ error: 'Vídeo muito grande (máx 25MB). Escolha qualidade menor.', code: 'VIDEO_TOO_LARGE' });
      videoUrl = saved.url;
    }
    if (!videoUrl) {
      ai.log(db, req.session.userId, 'publish_novideo', 'denied', 'sem vídeo', req.ip);
      return res.status(400).json({ error: 'Gere e salve o vídeo antes de publicar (use Visualizar vídeo > Salvar rascunho)', code: 'VIDEO_REQUIRED' });
    }

    let coverUrl = draft.cover_url || '';
    if (coverDataUrl && coverDataUrl.startsWith('data:image/')) {
      const saved = saveBase64Media(coverDataUrl);
      if (saved && !saved.error) coverUrl = saved.url;
    }

    const postId = uuid.v4();
    const user = db().get('SELECT username, display_name, avatar_url FROM users WHERE id = ?', [req.session.userId]);
    const text = (finalTitle + '\n\n' + finalDesc).slice(0, 2000);

    db().run(
      "INSERT INTO posts (id, user_id, text, media_url, media_type, hashtags, status, moderation_reason) VALUES (?, ?, ?, ?, 'video', ?, 'approved', 'VibeAI Creator')",
      [postId, req.session.userId, text, videoUrl, JSON.stringify(finalTags)]
    );
    db().run("UPDATE ai_drafts SET status = 'published', title = ?, description = ?, caption = ?, hashtags = ?, video_url = ?, cover_url = ?, published_post_id = ? WHERE id = ?",
      [finalTitle, finalDesc, finalCaption, JSON.stringify(finalTags), videoUrl, coverUrl, postId, draft.id]);
    ai.log(db, req.session.userId, 'publish', 'ok', 'post ' + postId, req.ip);

    const followers = db().query('SELECT follower_id FROM followers WHERE following_id = ?', [req.session.userId]);
    const actorName = (user && (user.display_name || user.username)) || 'Alguém';
    for (const f of followers) createNotification(db, f.follower_id, req.session.userId, 'post', postId, actorName + ' publicou um vídeo criado com VibeAI');

    res.status(201).json({
      success: true, postId,
      message: 'Vídeo publicado no Feed com sucesso!',
      post: {
        id: postId, user_id: req.session.userId,
        username: user.username, display_name: user.display_name, avatar_url: user.avatar_url,
        text, media_url: videoUrl, media_type: 'video',
        hashtags: finalTags, likes_count: 0, comments_count: 0, liked: false, saved: false,
        status: 'approved', created_at: new Date().toISOString()
      }
    });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// EXCLUIR RASCUNHO
// ============================================================
router.delete('/ai/drafts/:id', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const draft = ownDraft(db, req.params.id, req.session.userId);
    if (!draft) return res.status(404).json({ error: 'Rascunho não encontrado' });
    db().run("UPDATE ai_drafts SET status = 'deleted' WHERE id = ?", [req.params.id]);
    ai.log(db, req.session.userId, 'delete', 'ok', req.params.id, req.ip);
    res.json({ success: true, message: 'Rascunho removido' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// DENÚNCIA
// ============================================================
router.post('/ai/drafts/:id/report', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const rl = security.rateLimit(db(), 'ai-report:' + req.session.userId, 3600, 10);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const draft = db().get('SELECT * FROM ai_drafts WHERE id = ?', [req.params.id]);
    if (!draft) return res.status(404).json({ error: 'Vídeo não encontrado' });
    const { reason } = req.body;
    if (!reason || String(reason).trim().length < 5) return res.status(400).json({ error: 'Descreva o motivo da denúncia' });
    db().run('INSERT INTO ai_reports (id, draft_id, reporter_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))',
      [uuid.v4(), draft.id, req.session.userId, sanitize(String(reason), 300), 'pendente']);
    try {
      const securityMod = require('./security');
      securityMod.createAlert(db, 'ai_report', 'alta', '🚨 Denúncia de vídeo VibeAI: ' + String(reason).slice(0, 120), req.ip, req.session.userId);
    } catch (e) {}
    ai.log(db, req.session.userId, 'report', 'ok', 'draft ' + draft.id, req.ip);
    res.status(201).json({ success: true, message: 'Denúncia enviada! A equipe vai analisar.' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// LOGS (admin/moderador)
// ============================================================
router.get('/ai/logs', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    if (!isAdminOrMod(db, req.session.userId)) return res.status(403).json({ error: 'Acesso negado' });
    const logs = db().query('SELECT * FROM ai_logs ORDER BY created_at DESC LIMIT 100');
    res.json({ success: true, logs });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

module.exports = function (database) {
  db = () => database.getInstance();
  return router;
};

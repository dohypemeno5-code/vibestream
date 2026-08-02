/**
 * VibeStream - Rotas Avançadas
 * Feed, Posts, Comentários, Chat, Pesquisa
 */
const express = require('express');
const router = express.Router();
const uuid = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const liveRooms = require('./live-rooms');
const moderation = require('./moderation');
const auth = require('./auth');
const security = require('./security');
const childSafety = require('./child-safety');

const sanitize = (str, maxLen) => security.sanitizeInput(str, maxLen);

// ============================================================
// HELPERS - Notificações, mídia, moderação
// ============================================================

function createNotification(db, userId, actorId, type, contentId, text) {
  try {
    db().run(
      'INSERT INTO notifications (id, user_id, actor_id, type, content_id, text, is_read) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [uuid.v4(), userId, actorId || '', type, contentId || '', text]
    );
    liveRooms.notifyUser(userId, {
      type, content_id: contentId, actor_id: actorId,
      text, created_at: new Date().toISOString(), is_read: 0
    });
  } catch (e) {}
}

function isBlockedText(db, text, category) {
  try {
    const terms = db().query("SELECT term FROM blocked_terms WHERE (category = ? OR category = 'all') AND is_active = 1", [category || 'all']);
    const lower = (text || '').toLowerCase();
    for (const t of terms) if (t.term && lower.includes(t.term.toLowerCase())) return true;
  } catch (e) {}
  return false;
}

function saveBase64Media(dataUrl, extHint) {
  const match = /^data:([a-z0-9+./-]+);base64,(.*)$/i.exec(dataUrl || '');
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  // Tamanho máximo (12MB) e validação de MIME permitido
  const approxBytes = Math.ceil(base64.length * 3 / 4);
  if (approxBytes > 12 * 1024 * 1024) return { error: 'too_large' };
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/webm': '.webm' };
  const ext = map[mime];
  if (!ext) return null; // MIME não permitido -> rejeita
  const buf = Buffer.from(base64, 'base64');
  const dir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  const name = Date.now() + '_' + crypto.randomBytes(4).toString('hex') + ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return { url: '/uploads/' + name, mime, size: buf.length };
}

function calcAge(birthDate) {
  const m = String(birthDate || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = parseInt(m[3], 10);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) return null;
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return null;
  const now = new Date();
  if (birth.getTime() > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) return null;
  let age = now.getUTCFullYear() - year;
  const hadBirthday = (now.getUTCMonth() > month - 1) || (now.getUTCMonth() === month - 1 && now.getUTCDate() >= day);
  if (!hadBirthday) age--;
  return age < 0 ? null : age;
}


function canChat(db, userId, otherId) {
  if (String(userId) === String(otherId)) return false;
  const a = db().get('SELECT id FROM followers WHERE follower_id = ? AND following_id = ?', [userId, otherId]);
  if (a) return true;
  const b = db().get('SELECT id FROM followers WHERE follower_id = ? AND following_id = ?', [otherId, userId]);
  return !!b;
}

function isUserAdmin(db, userId) {
  const u = db().get('SELECT role FROM users WHERE id = ?', [userId]);
  return !!(u && u.role === 'admin');
}

function moderatePost(db, userId, text) {
  const lower = (text || '').toLowerCase();
  const mediaSuspicious = /http[s]?:\/\//i.test(lower);
  if (isBlockedText(db, text, 'post') || moderation.matchHardBlock(lower)) return { status: 'blocked', reason: 'Conteúdo proibido pelas regras da plataforma' };
  const reportsCount = (db().get('SELECT COUNT(*) as c FROM reports WHERE reported_user_id = ? AND status != "rejeitado"', [userId]) || {}).c || 0;
  const userWarnings = (db().get('SELECT warnings_count FROM users WHERE id = ?', [userId]) || {}).warnings_count || 0;
  if (moderation.matchReview(lower) || mediaSuspicious || reportsCount >= 3 || userWarnings >= 2) {
    return { status: 'review', reason: 'Enviado para revisão da moderação' };
  }
  return { status: 'approved', reason: '' };
}

module.exports = function(database) {
  const db = () => database.getInstance();

  // ============================================================
  // BOAS-VINDAS (vídeo/animacão + registro "já viu")
  // ============================================================

  router.get('/welcome', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const u = db().get("SELECT username, display_name, profile_id, welcome_seen, welcome_seen_at FROM users WHERE id = ?", [req.session.userId]);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({
      seen: Number(u.welcome_seen) === 1,
      name: u.display_name || u.username,
      username: u.username,
      profile_id: u.profile_id,
      seen_at: u.welcome_seen_at || ''
    });
  });

  router.post('/welcome/seen', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    db().run("UPDATE users SET welcome_seen = 1, welcome_seen_at = datetime('now') WHERE id = ?", [req.session.userId]);
    res.json({ ok: true, message: 'Boas-vindas marcadas como vistas' });
  });

  // ============================================================
  // FEED / POSTS
  // ============================================================
  
  // Criar post
  router.post('/posts', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const rl = security.rateLimit(db(), 'post:' + req.session.userId, 60, 6);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const { text, mediaUrl, mediaType, hashtags } = req.body;
    if (!text) return res.status(400).json({ error: 'Texto é obrigatório' });
    if (text.length > 2000) return res.status(400).json({ error: 'Texto muito longo (max 2000)' });

    // Aceite obrigatório das regras antes de publicar
    const rules = db().get('SELECT user_id FROM user_rules_acceptance WHERE user_id = ?', [req.session.userId]);
    if (!rules) return res.status(403).json({ error: 'Você precisa aceitar as regras da plataforma antes de publicar', code: 'RULES_REQUIRED' });

    // ===== PROTEÇÃO INFANTIL: ban automático + denúncia grave =====
    const childTerm = childSafety.matchChild(String(text) + ' ' + String(mediaUrl || ''));
    if (childTerm) {
      childSafety.applyChildBan(db(), {
        userId: req.session.userId, autorId: req.session.userId,
        texto: text, prova: mediaUrl || '', ip: req.ip,
        userAgent: req.headers['user-agent'], matchedTerm: childTerm
      });
      return res.status(403).json({ error: 'Publicação removida por segurança — conta banida permanentemente', code: 'CHILD_BANNED' });
    }

    // Moderação automática AnyClaw: aprovado / revisão / bloqueado
    const mediaHash = req.body._mediaHash || '';
    let mod = moderation.moderateText(String(text) + ' ' + String(mediaUrl || ''), 'post');
    if (mod.status !== 'blocked' && mediaHash) {
      const mediaCheck = moderation.moderateMedia(db(), mediaHash, req.body._mediaMime || '', req.body._mediaSize || 0);
      if (mediaCheck.status !== 'approved') mod = mediaCheck;
    }
    if (mod.status === 'blocked') {
      moderation.applyPunishment(db(), req.session.userId, mod.reason, 'anyclaw');
      db().run("INSERT INTO content_reviews (id, post_id, user_id, action, reason) VALUES (?, ?, ?, 'blocked', ?)",
        [uuid.v4(), uuid.v4(), req.session.userId, mod.reason]);
      return res.status(403).json({ error: 'Publicação bloqueada: ' + mod.reason, code: 'POST_BLOCKED' });
    }

    const id = uuid.v4();
    const user = db().get('SELECT username, display_name, avatar_url FROM users WHERE id = ?', [req.session.userId]);
    const sanitizedText = sanitize(text);

    db().run(
      "INSERT INTO posts (id, user_id, text, media_url, media_type, hashtags, status, moderation_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, req.session.userId, sanitizedText, mediaUrl || '', mediaType || '', JSON.stringify(hashtags || []), mod.status, mod.reason]
    );

    if (mod.status === 'review') {
      db().run("INSERT INTO content_reviews (id, post_id, user_id, action, reason) VALUES (?, ?, ?, 'review', ?)",
        [uuid.v4(), id, req.session.userId, mod.reason]);
    }

    // Notificar seguidores: "Fulano publicou algo novo"
    if (mod.status === 'approved') {
      const followers = db().query('SELECT follower_id FROM followers WHERE following_id = ?', [req.session.userId]);
      const actorName = (user && (user.display_name || user.username)) || 'Alguém';
      for (const f of followers) {
        createNotification(db, f.follower_id, req.session.userId, 'post', id, actorName + ' publicou algo novo');
      }
    }

    const respPost = {
      id, user_id: req.session.userId,
      username: user.username, display_name: user.display_name, avatar_url: user.avatar_url,
      text: sanitizedText, media_url: mediaUrl || '', media_type: mediaType || '',
      hashtags: hashtags || [], likes_count: 0, comments_count: 0, liked: false, saved: false,
      status: mod.status, moderation_reason: mod.reason,
      created_at: new Date().toISOString()
    };
    res.status(201).json({
      post: respPost,
      message: mod.status === 'review' ? 'Publicação enviada para revisão da moderação' : 'Publicado com sucesso!'
    });
  });

  // Listar feed
  router.get('/posts', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;

    const userId = req.session?.userId || '';
    const posts = db().query(`
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.family_tag, u.family_id, u.agency_tag,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
        (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as comments_count
      FROM posts p JOIN users u ON p.user_id = u.id
      WHERE (p.status = 'approved' OR p.user_id = ?) AND p.is_deleted = 0
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

    const total = (db().get("SELECT COUNT(*) as count FROM posts WHERE status = 'approved' AND is_deleted = 0") || {}).count || 0;

    // Check if current user liked/saved each post
    const enriched = posts.map(p => ({
      ...p, liked: userId ? db().get('SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?', [p.id, userId]) ? true : false : false,
      saved: userId ? db().get('SELECT id FROM saved_posts WHERE post_id = ? AND user_id = ?', [p.id, userId]) ? true : false : false,
      hashtags: JSON.parse(p.hashtags || '[]')
    }));

    res.json({ posts: enriched, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  // Curtir/descurtir post
  router.post('/posts/:id/like', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const post = db().get('SELECT id, user_id FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Post não encontrado' });

    const existing = db().get('SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?', [req.params.id, req.session.userId]);
    if (existing) {
      db().run('DELETE FROM post_likes WHERE id = ?', [existing.id]);
      res.json({ liked: false, likes_count: db().get('SELECT COUNT(*) as c FROM post_likes WHERE post_id = ?', [req.params.id]).c });
    } else {
      db().run('INSERT INTO post_likes (id, post_id, user_id) VALUES (?, ?, ?)', [uuid.v4(), req.params.id, req.session.userId]);
      if (post.user_id !== req.session.userId) {
        const actor = db().get('SELECT display_name, username FROM users WHERE id = ?', [req.session.userId]);
        createNotification(db, post.user_id, req.session.userId, 'like', req.params.id, (actor && (actor.display_name || actor.username)) + ' curtiu sua publicação');
      }
      res.json({ liked: true, likes_count: db().get('SELECT COUNT(*) as c FROM post_likes WHERE post_id = ?', [req.params.id]).c });
    }
  });

  // Comentários
  router.get('/posts/:id/comments', (req, res) => {
    const comments = db().query(`
      SELECT pc.*, u.username, u.display_name, u.avatar_url
      FROM post_comments pc JOIN users u ON pc.user_id = u.id
      WHERE pc.post_id = ? AND pc.is_deleted = 0 ORDER BY pc.created_at ASC
    `, [req.params.id]);
    res.json({ comments });
  });

  router.post('/posts/:id/comments', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const rl = security.rateLimit(db(), 'comment:' + req.session.userId, 60, 15);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const { text, parentId } = req.body;
    if (!text || String(text).trim().length === 0) return res.status(400).json({ error: 'Comentário inválido' });
    if (String(text).length > 500) return res.status(400).json({ error: 'Comentário muito longo (max 500)' });
    const cleanText = sanitize(String(text), 500);

    // Resposta a comentário: valida que o comentário pai existe no mesmo post
    let cleanParent = '';
    if (parentId) {
      const parent = db().get('SELECT id, post_id, user_id FROM post_comments WHERE id = ? AND post_id = ? AND is_deleted = 0', [parentId, req.params.id]);
      if (!parent) return res.status(404).json({ error: 'Comentário original não encontrado' });
      cleanParent = parentId;
    }

    // Moderação AnyClaw no comentário
    const cmod = moderation.moderateText(cleanText, 'comment');
    if (cmod.status === 'blocked') {
      moderation.applyPunishment(db(), req.session.userId, cmod.reason, 'anyclaw');
      return res.status(403).json({ error: 'Comentário bloqueado: ' + cmod.reason, code: 'COMMENT_BLOCKED' });
    }

    const id = uuid.v4();
    const user = db().get('SELECT username, display_name, avatar_url FROM users WHERE id = ?', [req.session.userId]);
    
    db().run(
      'INSERT INTO post_comments (id, post_id, user_id, text, parent_id) VALUES (?, ?, ?, ?, ?)',
      [id, req.params.id, req.session.userId, cleanText, cleanParent]
    );

    res.status(201).json({
      comment: {
        id, post_id: req.params.id, user_id: req.session.userId,
        username: user.username, display_name: user.display_name, avatar_url: user.avatar_url,
        text: cleanText, parent_id: cleanParent, created_at: new Date().toISOString()
      }
    });
    const postOwner = db().get('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (postOwner && postOwner.user_id !== req.session.userId) {
      createNotification(db, postOwner.user_id, req.session.userId, 'comment', req.params.id, (user && (user.display_name || user.username)) + ' comentou: ' + cleanText.slice(0, 60));
    }
    // Notifica dono do comentário pai (resposta)
    if (cleanParent) {
      const parent = db().get('SELECT user_id FROM post_comments WHERE id = ?', [cleanParent]);
      if (parent && parent.user_id !== req.session.userId && parent.user_id !== (postOwner && postOwner.user_id)) {
        createNotification(db, parent.user_id, req.session.userId, 'reply', req.params.id, (user && (user.display_name || user.username)) + ' respondeu seu comentário');
      }
    }
    // Menções @usuario
    const mentions = String(cleanText).match(/@([a-zA-Z0-9_]{3,30})/g) || [];
    for (const m of mentions) {
      const uname = m.slice(1);
      const mentioned = db().get('SELECT id FROM users WHERE username = ? AND status = "active"', [uname]);
      if (mentioned && mentioned.id !== req.session.userId) {
        createNotification(db, mentioned.id, req.session.userId, 'mention', req.params.id, (user && (user.display_name || user.username)) + ' mencionou você em um comentário');
      }
    }
  });

  // ============================================================
  // CHAT
  // ============================================================
  
  // Listar conversas
  router.get('/chats', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    
    const chats = db().query(`
      SELECT c.*,
        (SELECT username FROM users WHERE id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END) as other_username,
        (SELECT display_name FROM users WHERE id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END) as other_display_name,
        (SELECT avatar_url FROM users WHERE id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END) as other_avatar,
        (SELECT text FROM chat_messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM chat_messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
        (SELECT COUNT(*) FROM chat_messages WHERE chat_id = c.id AND sender_id != ? AND read_at IS NULL) as unread_count
      FROM chats c
      WHERE c.user1_id = ? OR c.user2_id = ?
      ORDER BY last_message_at DESC
    `, [req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId]);

    res.json({ chats });
  });

  // Criar conversa (permitido apenas se existe relação de seguir)
  router.post('/chats', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'ID do usuário é obrigatório' });
    if (String(userId) === String(req.session.userId)) return res.status(400).json({ error: 'Você não pode conversar consigo mesmo' });
    const target = db().get('SELECT id, role FROM users WHERE id = ?', [userId]);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (!isUserAdmin(db, req.session.userId) && !isUserAdmin(db, userId) && !canChat(db, req.session.userId, userId)) {
      return res.status(403).json({ error: 'Siga primeiro para poder conversar', code: 'FOLLOW_REQUIRED' });
    }

    // Check if chat already exists
    const existing = db().get(
      'SELECT id FROM chats WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)',
      [req.session.userId, userId, userId, req.session.userId]
    );
    if (existing) {
      const other = db().get('SELECT username, display_name FROM users WHERE id = ?', [userId]);
      return res.json({ chatId: existing.id, participant_name: (other && (other.display_name || other.username)) || 'Usuário' });
    }

    const id = uuid.v4();
    db().run('INSERT INTO chats (id, user1_id, user2_id) VALUES (?, ?, ?)', [id, req.session.userId, userId]);
    const other = db().get('SELECT username, display_name FROM users WHERE id = ?', [userId]);
    res.status(201).json({ chatId: id, participant_name: (other && (other.display_name || other.username)) || 'Usuário' });
  });

  // Mensagens de uma conversa (apenas participantes, com relação de seguir)
  router.get('/chats/:id/messages', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });

    const chat = db().get('SELECT * FROM chats WHERE id = ?', [req.params.id]);
    if (!chat) return res.status(404).json({ error: 'Conversa não encontrada' });
    const isMember = String(chat.user1_id) === String(req.session.userId) || String(chat.user2_id) === String(req.session.userId);
    if (!isMember) return res.status(403).json({ error: 'Acesso negado' });
    const otherId = String(chat.user1_id) === String(req.session.userId) ? chat.user2_id : chat.user1_id;
    if (!isUserAdmin(db, req.session.userId) && !isUserAdmin(db, otherId) && !canChat(db, req.session.userId, otherId)) {
      return res.status(403).json({ error: 'Siga primeiro para poder conversar', code: 'FOLLOW_REQUIRED' });
    }

    const messages = db().query(
      'SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );

    // Mark messages as read
    db().run(
      "UPDATE chat_messages SET read_at = datetime('now') WHERE chat_id = ? AND sender_id != ? AND read_at IS NULL",
      [req.params.id, req.session.userId]
    );

    res.json({ messages });
  });

  // Enviar mensagem (texto/foto/vídeo/áudio) com proteção anti-spam
  router.post('/chats/:id/messages', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const chat = db().get('SELECT * FROM chats WHERE id = ?', [req.params.id]);
    if (!chat) return res.status(404).json({ error: 'Conversa não encontrada' });
    const isMember = String(chat.user1_id) === String(req.session.userId) || String(chat.user2_id) === String(req.session.userId);
    if (!isMember) return res.status(403).json({ error: 'Acesso negado' });

    const { text, type, mediaUrl } = req.body;
    const msgType = ['text', 'photo', 'video', 'audio'].includes(type) ? type : 'text';
    if (msgType === 'text' && (!text || String(text).trim() === '')) return res.status(400).json({ error: 'Mensagem vazia' });
    if (msgType === 'text' && String(text).length > 1000) return res.status(400).json({ error: 'Mensagem muito longa (max 1000)' });
    if (msgType !== 'text' && !mediaUrl) return res.status(400).json({ error: 'Mídia obrigatória' });

    // Anti-spam: limite de envio rápido
    const recent = db().get("SELECT COUNT(*) as c FROM chat_messages WHERE sender_id = ? AND created_at > datetime('now', '-10 seconds')", [req.session.userId]);
    if ((recent || {}).c >= 6) return res.status(429).json({ error: 'Você está enviando mensagens rápido demais' });

    const finalText = msgType === 'text' ? sanitize(String(text)) : '';
    if (msgType === 'text' && isBlockedText(db, finalText, 'chat')) {
      return res.status(403).json({ error: 'Mensagem contém conteúdo proibido' });
    }

    // ===== PROTEÇÃO INFANTIL NO CHAT =====
    const chatPartner = String(chat.user1_id) === String(req.session.userId) ? chat.user2_id : chat.user1_id;
    const childTerm = childSafety.matchChild(finalText + ' ' + String(mediaUrl || ''));
    if (childTerm) {
      childSafety.applyChildBan(db(), {
        userId: req.session.userId, autorId: req.session.userId, vitimaId: chatPartner,
        texto: finalText, prova: mediaUrl || '', ip: req.ip,
        userAgent: req.headers['user-agent'], matchedTerm: childTerm
      });
      return res.status(403).json({ error: 'Mensagem removida por segurança — conta banida permanentemente', code: 'CHILD_BANNED' });
    }

    // Fotos no chat privado: liberadas apenas após 7 dias de amizade
    if (msgType === 'photo' || msgType === 'video') {
      const friend = db().get(`SELECT MIN(created_at) as d FROM followers
        WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)`,
        [chat.user1_id, chat.user2_id, chat.user2_id, chat.user1_id]);
      let days = 0;
      if (friend && friend.d) days = (Date.now() - new Date(String(friend.d).replace(' ', 'T') + 'Z').getTime()) / 86400000;
      if (days < 7) return res.status(403).json({ error: '⏳ Fotos no chat são liberadas após 7 dias de amizade', code: 'PHOTO_LOCK' });
    }

    // Filtro de idade: conversa suspeita (diferença > 10 anos, 18-19 x 30+)
    if (msgType === 'text') {
      const alic = childSafety.matchAliciamento(finalText);
      if (alic) {
        const me = db().get('SELECT id, age FROM users WHERE id = ?', [req.session.userId]);
        const other = db().get('SELECT id, age FROM users WHERE id = ?', [chatPartner]);
        if (me && other) {
          const ages = [Number(me.age) || 0, Number(other.age) || 0];
          const gap = Math.abs(ages[0] - ages[1]);
          const hasYoung = ages.some(a => a >= 18 && a <= 19);
          const hasOld = ages.some(a => a >= 30);
          if (gap > 10 && hasYoung && hasOld) {
            const vitimaId = (Number(me.age) <= 19) ? me.id : other.id;
            try {
              db().run("INSERT INTO notifications (id, user_id, actor_id, type, content_id, text, is_read) VALUES (?, ?, 'sistema', 'alerta_seguranca', '', ?, 0)",
                [uuid.v4(), vitimaId, '⚠️ Cuidado, conversa suspeita. Denuncie se se sentir desconfortável']);
            } catch (e) {}
            liveRooms.notifyUser(vitimaId, { type: 'alerta_seguranca', text: '⚠️ Cuidado, conversa suspeita. Denuncie se se sentir desconfortável' });
          }
        }
      }
    }

    const id = uuid.v4();
    db().run(
      'INSERT INTO chat_messages (id, chat_id, sender_id, text, type, media_url) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.params.id, req.session.userId, finalText, msgType, msgType === 'text' ? '' : sanitize(String(mediaUrl))]
    );

    res.status(201).json({
      message: {
        id, chat_id: req.params.id, sender_id: req.session.userId,
        text: finalText, type: msgType, media_url: msgType === 'text' ? '' : sanitize(String(mediaUrl)),
        created_at: new Date().toISOString(), read_at: null, status: 'sent'
      }
    });
  });

  // Denunciar conversa
  router.post('/chats/:id/report', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const rl = security.rateLimit(db(), 'report:' + req.session.userId, 3600, 10);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const chat = db().get('SELECT * FROM chats WHERE id = ?', [req.params.id]);
    if (!chat) return res.status(404).json({ error: 'Conversa não encontrada' });
    const isMember = String(chat.user1_id) === String(req.session.userId) || String(chat.user2_id) === String(req.session.userId);
    if (!isMember) return res.status(403).json({ error: 'Acesso negado' });
    const { reason } = req.body;
    if (!reason || String(reason).trim().length < 5) return res.status(400).json({ error: 'Descreva o motivo da denúncia' });
    const abuse = moderation.checkReportAbuse(db, req.session.userId, { contentType: 'chat', contentId: req.params.id, userId: null });
    if (abuse.blocked) return res.status(429).json({ error: abuse.error });
    db().run('INSERT INTO chat_reports (id, chat_id, reporter_id, reason) VALUES (?, ?, ?, ?)',
      [uuid.v4(), req.params.id, req.session.userId, sanitize(String(reason))]);
    res.status(201).json({ message: 'Denúncia enviada! A equipe vai analisar.' });
  });

  // ============================================================
  // PESQUISA
  // ============================================================
  
  router.get('/search', (req, res) => {
    const rl = security.rateLimit(db(), 'search:' + (req.session?.userId || req.ip), 60, 30);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const q = sanitize(req.query.q || '', 60);
    if (!q || q.length < 2) return res.json({ users: [], posts: [], lives: [] });

    const users = db().query(
      "SELECT id, username, display_name, avatar_url, profile_id, is_verified, followers_count FROM users WHERE (username LIKE ? OR display_name LIKE ? OR profile_id LIKE ?) AND status = 'active' LIMIT 10",
      [`%${q}%`, `%${q}%`, `%${q}%`]
    );
    const posts = db().query(
      "SELECT p.*, u.username, u.display_name, u.avatar_url FROM posts p JOIN users u ON p.user_id = u.id WHERE p.text LIKE ? ORDER BY p.created_at DESC LIMIT 10",
      [`%${q}%`]
    );
    const lives = db().query(
      "SELECT l.*, u.username, u.display_name FROM lives l JOIN users u ON l.user_id = u.id WHERE l.status = 'live' AND (l.title LIKE ?) LIMIT 10",
      [`%${q}%`]
    );

    res.json({ users, posts, lives });
  });

  // ============================================================
  // PERFIL
  // ============================================================
  
  router.put('/profile', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const { displayName, bio, avatarUrl, username, birthDate, phone } = req.body;

    if (displayName !== undefined && displayName !== null) {
      const cleanName = sanitize(String(displayName), 50);
      if (cleanName.length === 0 || cleanName.length > 50) return res.status(400).json({ error: 'Nome inválido (máx 50)' });
      if (isBlockedText(db, cleanName, 'name')) return res.status(400).json({ error: 'Nome não permitido' });
      db().run('UPDATE users SET display_name = ? WHERE id = ?', [cleanName, req.session.userId]);
    }
    if (bio !== undefined) {
      const cleanBio = sanitize(String(bio), 300);
      if (cleanBio.length > 300) return res.status(400).json({ error: 'Biografia muito longa (máx 300)' });
      db().run('UPDATE users SET bio = ? WHERE id = ?', [cleanBio, req.session.userId]);
    }
    if (avatarUrl !== undefined) {
      const cleanAvatar = String(avatarUrl || '').slice(0, 200);
      if (cleanAvatar && !/^\/uploads\//.test(cleanAvatar)) return res.status(400).json({ error: 'URL de avatar inválida' });
      db().run('UPDATE users SET avatar_url = ? WHERE id = ?', [cleanAvatar, req.session.userId]);
    }
    if (phone !== undefined) {
      const cleanPhone = sanitize(String(phone), 20);
      if (cleanPhone && !/^[0-9()+\-\s]{8,20}$/.test(cleanPhone)) return res.status(400).json({ error: 'Telefone inválido' });
      db().run('UPDATE users SET phone = ? WHERE id = ?', [cleanPhone, req.session.userId]);
    }

    if (username !== undefined && username !== null) {
      const uname = sanitize(String(username));
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(uname)) return res.status(400).json({ error: 'Username inválido (3-30, alfanumérico)' });
      if (isBlockedText(db, uname, 'name')) return res.status(400).json({ error: 'Nome de usuário não permitido' });
      const existing = db().get('SELECT id FROM users WHERE username = ? AND id != ?', [uname, req.session.userId]);
      if (existing) return res.status(409).json({ error: 'Username já está em uso' });
      db().run('UPDATE users SET username = ? WHERE id = ?', [uname, req.session.userId]);
    }

    if (birthDate !== undefined && birthDate !== null && birthDate !== '') {
      const age = calcAge(String(birthDate));
      if (age === null) return res.status(400).json({ error: 'Data de nascimento inválida (dd/mm/aaaa)' });
      if (age < 15) return res.status(403).json({ error: 'Não permitido para menores de 15 anos' });
      const restriction = (age >= 15 && age < 18) ? 'restricted' : 'none';
      db().run('UPDATE users SET birth_date = ?, age = ?, restriction_level = ? WHERE id = ?', [String(birthDate), age, restriction, req.session.userId]);
    }

    res.json({ message: 'Perfil atualizado' });
  });

  // Upload de foto de perfil (base64)
  router.post('/profile/avatar', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const { dataUrl } = req.body;
    const m = /^data:([a-z0-9+./-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
    if (!m || !['image/jpeg','image/png','image/webp','image/gif'].includes(m[1])) return res.status(400).json({ error: 'Imagem inválida' });
    if (Math.ceil(m[2].length * 3 / 4) > 4 * 1024 * 1024) return res.status(400).json({ error: 'Imagem muito grande (máx 4MB)' });
    const saved = saveBase64Media(dataUrl, '.jpg');
    if (!saved || saved.error) return res.status(400).json({ error: 'Imagem inválida' });
    db().run('UPDATE users SET avatar_url = ? WHERE id = ?', [saved.url, req.session.userId]);
    res.json({ avatar_url: saved.url, message: 'Foto atualizada!' });
  });

  // Upload de mídia para posts (base64)
  router.post('/media', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const rl = security.rateLimit(db(), 'media:' + req.session.userId, 3600, 30);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const { dataUrl } = req.body;
    const saved = saveBase64Media(dataUrl, '.bin');
    if (!saved) return res.status(400).json({ error: 'Tipo de arquivo não permitido (use JPG/PNG/WebP/GIF/MP4/MP3/OGG/WebM)' });
    if (saved.error === 'too_large') return res.status(400).json({ error: 'Arquivo muito grande (máx 12MB)' });
    if (saved.size > 8 * 1024 * 1024) return res.status(400).json({ error: 'Arquivo muito grande (máx 8MB para este tipo)' });
    // Moderação de mídia: hash SHA-256 registrado; reenvio de mídia bloqueada é rejeitado
    const buf = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
    const hash = moderation.computeMediaHash(buf);
    const mediaCheck = moderation.moderateMedia(db(), hash, saved.mime, saved.size);
    if (mediaCheck.status === 'blocked') {
      moderation.applyPunishment(db(), req.session.userId, mediaCheck.reason, 'anyclaw');
      return res.status(403).json({ error: 'Mídia bloqueada: ' + mediaCheck.reason, code: 'MEDIA_BLOCKED' });
    }
    const reg = moderation.registerMedia(db(), hash, mediaCheck.status === 'review' ? 'review' : 'ok', mediaCheck.reason, req.session.userId);
    res.status(201).json({ url: saved.url, mime: saved.mime, mediaHash: hash, status: mediaCheck.status === 'review' ? 'review' : 'ok' });
  });

  router.get('/profile/:id', (req, res) => {
    const user = db().get(
      'SELECT id, username, display_name, avatar_url, bio, role, is_verified, followers_count, following_count, coins, profile_id, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const postsCount = (db().get('SELECT COUNT(*) as c FROM posts WHERE user_id = ? AND is_deleted = 0', [req.params.id]) || {}).c || 0;
    const posts = db().query('SELECT * FROM posts WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 20', [req.params.id]);
    const isFollowing = req.session?.userId ? db().get('SELECT id FROM followers WHERE follower_id = ? AND following_id = ?', [req.session.userId, req.params.id]) : null;

    res.json({ user: { ...user, posts_count: postsCount }, posts, isFollowing: !!isFollowing });
  });

  // Follow/Unfollow
  router.post('/profile/:id/follow', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    if (req.session.userId === req.params.id) return res.status(400).json({ error: 'Não pode seguir você mesmo' });

    const existing = db().get('SELECT id FROM followers WHERE follower_id = ? AND following_id = ?', [req.session.userId, req.params.id]);
    if (existing) {
      db().run('DELETE FROM followers WHERE id = ?', [existing.id]);
      db().run('UPDATE users SET followers_count = max(0, followers_count - 1) WHERE id = ?', [req.params.id]);
      db().run('UPDATE users SET following_count = max(0, following_count - 1) WHERE id = ?', [req.session.userId]);
      res.json({ following: false });
    } else {
      db().run('INSERT INTO followers (id, follower_id, following_id) VALUES (?, ?, ?)', [uuid.v4(), req.session.userId, req.params.id]);
      db().run('UPDATE users SET followers_count = followers_count + 1 WHERE id = ?', [req.params.id]);
      db().run('UPDATE users SET following_count = following_count + 1 WHERE id = ?', [req.session.userId]);
      const actor = db().get('SELECT display_name, username FROM users WHERE id = ?', [req.session.userId]);
      createNotification(db, req.params.id, req.session.userId, 'follow', req.session.userId, (actor && (actor.display_name || actor.username)) + ' começou a seguir você');
      res.json({ following: true });
    }
  });

  // ============================================================
  // LIVES REAIS
  // ============================================================

  // Criar live (transmissão real)
  router.post('/lives', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const rl = security.rateLimit(db(), 'live:' + req.session.userId, 3600, 6);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const { title, category, type, isPrivate } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Título é obrigatório' });
    if (String(title).length > 80) return res.status(400).json({ error: 'Título muito longo (máx 80)' });
    const user = db().get('SELECT restriction_level, username, display_name, avatar_url FROM users WHERE id = ?', [req.session.userId]);
    if (user && user.restriction_level === 'restricted') return res.status(403).json({ error: 'Menores de 18 anos não podem criar lives' });
    if (isBlockedText(db, title, 'live_title')) return res.status(400).json({ error: 'Título não permitido' });

    const id = uuid.v4();
    const liveTitle = sanitize(String(title)).slice(0, 80);
    db().run(
      "INSERT INTO lives (id, user_id, title, category, tags, type, status, is_private) VALUES (?, ?, ?, ?, '[]', ?, 'live', ?)",
      [id, req.session.userId, liveTitle, category || 'geral', type === 'audio' ? 'audio' : 'video', isPrivate ? 1 : 0]
    );
    db().run("UPDATE users SET is_live = 1, live_title = ? WHERE id = ?", [liveTitle, req.session.userId]);

    const live = {
      id, user_id: req.session.userId, title: liveTitle, category: category || 'geral',
      type: type === 'audio' ? 'audio' : 'video', status: 'live', is_private: isPrivate ? 1 : 0,
      username: user?.username, display_name: user?.display_name, avatar_url: user?.avatar_url,
      viewer_count: 0, created_at: new Date().toISOString()
    };
    liveRooms.createRoom(id, live);

    // Notifica seguidores
    try {
      const followers = db().query('SELECT follower_id FROM followers WHERE following_id = ?', [req.session.userId]);
      for (const f of followers) {
        createNotification(db, f.follower_id, req.session.userId, 'live_started', id, (user && (user.display_name || user.username)) + ' está ao vivo: ' + liveTitle);
      }
    } catch (e) {}

    res.status(201).json({ live });
  });

  // Detalhe da live
  router.get('/lives/:id', (req, res) => {
    const live = db().query(
      'SELECT l.*, u.username, u.display_name, u.avatar_url, u.family_id, u.family_tag, u.agency_tag FROM lives l JOIN users u ON l.user_id = u.id WHERE l.id = ?',
      [req.params.id]
    )[0];
    if (!live) return res.status(404).json({ error: 'Live não encontrada' });
    if (live.status !== 'live' && !(req.session?.userId && (live.user_id === req.session.userId || req.session.role === 'admin'))) {
      return res.status(404).json({ error: 'Live encerrada' });
    }
    const messages = db().query(
      'SELECT lc.*, u.username, u.display_name, u.avatar_url FROM live_comments lc JOIN users u ON lc.user_id = u.id WHERE lc.live_id = ? ORDER BY lc.created_at ASC LIMIT 100',
      [req.params.id]
    );
    const likes = (db().get('SELECT COUNT(*) as c FROM live_likes WHERE live_id = ?', [req.params.id]) || {}).c || 0;
    res.json({ live, messages, likes_count: likes });
  });

  // Entrar na live
  router.post('/lives/:id/join', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const live = db().get("SELECT id, user_id FROM lives WHERE id = ? AND status = 'live'", [req.params.id]);
    if (!live) return res.status(404).json({ error: 'Live não encontrada' });
    if (live.user_id !== req.session.userId) {
      try {
        db().run("INSERT OR IGNORE INTO live_viewers (id, live_id, user_id, joined_at) VALUES (?, ?, ?, datetime('now'))", [uuid.v4(), req.params.id, req.session.userId]);
      } catch (e) {}
    }
    const viewers = (db().get('SELECT COUNT(DISTINCT user_id) as c FROM live_viewers WHERE live_id = ? AND left_at IS NULL', [req.params.id]) || {}).c || 0;
    res.json({ viewers });
  });

  // Sair da live
  router.post('/lives/:id/leave', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    try {
      db().run("UPDATE live_viewers SET left_at = datetime('now') WHERE live_id = ? AND user_id = ? AND left_at IS NULL", [req.params.id, req.session.userId]);
    } catch (e) {}
    res.json({ message: 'Saiu da live' });
  });

  // Encerrar live (dono ou admin)
  router.post('/lives/:id/end', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const live = db().get('SELECT user_id FROM lives WHERE id = ?', [req.params.id]);
    if (!live) return res.status(404).json({ error: 'Live não encontrada' });
    if (live.user_id !== req.session.userId && req.session.role !== 'admin') return res.status(403).json({ error: 'Permissão negada' });
    liveRooms.endLive(req.params.id, 'Live encerrada', req.session.userId);
    res.json({ message: 'Live encerrada' });
  });

  // Comentários da live
  router.get('/lives/:id/messages', (req, res) => {
    const messages = db().query(
      'SELECT lc.*, u.username, u.display_name, u.avatar_url FROM live_comments lc JOIN users u ON lc.user_id = u.id WHERE lc.live_id = ? ORDER BY lc.created_at ASC LIMIT 100',
      [req.params.id]
    );
    res.json({ messages });
  });

  router.post('/lives/:id/comment', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const text = String(req.body.text || '').trim().slice(0, 300);
    if (!text) return res.status(400).json({ error: 'Mensagem é obrigatória' });
    if (isBlockedText(db, text, 'comment')) return res.status(400).json({ error: 'Mensagem não permitida' });
    const id = uuid.v4();
    const user = db().get('SELECT username, display_name, avatar_url FROM users WHERE id = ?', [req.session.userId]);
    db().run('INSERT INTO live_comments (id, live_id, user_id, message) VALUES (?, ?, ?, ?)', [id, req.params.id, req.session.userId, sanitize(text)]);
    res.status(201).json({
      comment: { id, live_id: req.params.id, user_id: req.session.userId, username: user?.username, display_name: user?.display_name, avatar_url: user?.avatar_url, message: sanitize(text), created_at: new Date().toISOString() }
    });
  });

  // Curtir live
  router.post('/lives/:id/like', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    try { db().run('INSERT OR IGNORE INTO live_likes (id, live_id, user_id) VALUES (?, ?, ?)', [uuid.v4(), req.params.id, req.session.userId]); } catch (e) {}
    const count = (db().get('SELECT COUNT(*) as c FROM live_likes WHERE live_id = ?', [req.params.id]) || {}).c || 0;
    res.json({ likes_count: count });
  });

  // ============================================================
  // ============================================================
  // REGRAS DA PLATAFORMA (aceite obrigatório antes de publicar)
  // ============================================================

  router.get('/rules/status', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const row = db().get('SELECT version, accepted_at FROM user_rules_acceptance WHERE user_id = ?', [req.session.userId]);
    res.json({ accepted: !!row, version: row ? row.version : 0, accepted_at: row ? row.accepted_at : null });
  });

  router.post('/rules/accept', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    db().run('INSERT OR REPLACE INTO user_rules_acceptance (user_id, version, accepted_at) VALUES (?, 1, datetime(\'now\'))', [req.session.userId]);
    res.json({ accepted: true, message: 'Regras aceitas!' });
  });

  // ============================================================
  // SALVAR PUBLICAÇÕES
  // ============================================================

  router.post('/posts/:id/save', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const post = db().get('SELECT id FROM posts WHERE id = ? AND is_deleted = 0', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Post não encontrado' });
    const existing = db().get('SELECT id FROM saved_posts WHERE user_id = ? AND post_id = ?', [req.session.userId, req.params.id]);
    if (existing) {
      db().run('DELETE FROM saved_posts WHERE id = ?', [existing.id]);
      res.json({ saved: false });
    } else {
      db().run('INSERT INTO saved_posts (id, user_id, post_id) VALUES (?, ?, ?)', [uuid.v4(), req.session.userId, req.params.id]);
      res.json({ saved: true });
    }
  });

  router.get('/saved-posts', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const posts = db().query(`
      SELECT p.*, u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
        (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as comments_count,
        1 as saved
      FROM saved_posts sp JOIN posts p ON sp.post_id = p.id JOIN users u ON p.user_id = u.id
      WHERE sp.user_id = ? AND p.status = 'approved' AND p.is_deleted = 0
      ORDER BY sp.created_at DESC
    `, [req.session.userId]);
    const enriched = posts.map(p => ({
      ...p,
      liked: db().get('SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?', [p.id, req.session.userId]) ? true : false,
      hashtags: JSON.parse(p.hashtags || '[]')
    }));
    res.json({ posts: enriched });
  });

  // ============================================================
  // RECURSO DE BANIMENTO (appeal)
  // ============================================================

  router.post('/appeals', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const { reason } = req.body;
    if (!reason || String(reason).trim().length < 10) return res.status(400).json({ error: 'Escreva um motivo com pelo menos 10 caracteres' });
    const user = db().get('SELECT status FROM users WHERE id = ?', [req.session.userId]);
    if (!user || user.status !== 'banned') return res.status(403).json({ error: 'Apenas contas banidas podem enviar recurso' });
    const pending = db().get("SELECT id FROM appeals WHERE user_id = ? AND status = 'pendente'", [req.session.userId]);
    if (pending) return res.status(400).json({ error: 'Você já tem um recurso em análise' });
    const id = uuid.v4();
    db().run('INSERT INTO appeals (id, user_id, reason) VALUES (?, ?, ?)', [id, req.session.userId, sanitize(String(reason))]);
    res.status(201).json({ appeal: { id, status: 'pendente', reason: sanitize(String(reason)), created_at: new Date().toISOString() }, message: 'Recurso enviado! A equipe VibeStream analisará sua solicitação.' });
  });

  router.get('/appeals/my', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const appeals = db().query('SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [req.session.userId]);
    res.json({ appeals });
  });

  // ============================================================
  // BUSCA DE USUÁRIOS (nome ou ID único VS#)
  // ============================================================

  router.get('/users/search', (req, res) => {
    const q = sanitize(req.query.q || '');
    if (!q || q.length < 2) return res.json({ users: [] });
    const term = '%' + q + '%';
    const users = db().query(
      "SELECT id, username, display_name, avatar_url, profile_id, is_verified, followers_count, bio FROM users WHERE (username LIKE ? OR display_name LIKE ? OR profile_id LIKE ?) AND status = 'active' LIMIT 15",
      [term, term, term]
    );
    res.json({ users });
  });

  // NOTIFICAÇÕES
  // ============================================================

  router.get('/notifications', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const notifications = db().query(
      'SELECT n.*, u.display_name as actor_name, u.avatar_url as actor_avatar FROM notifications n LEFT JOIN users u ON n.actor_id = u.id WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50',
      [req.session.userId]
    );
    const unread = (db().get('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0', [req.session.userId]) || {}).c || 0;
    res.json({ notifications, unread });
  });

  router.post('/notifications/read', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const { id } = req.body;
    if (id) db().run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, req.session.userId]);
    else db().run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.session.userId]);
    res.json({ message: 'Notificações marcadas como lidas' });
  });

  return router;
};

// ============================================================
// VIBEDRAMA — novelas, séries e histórias com IA
// Catálogo, temporadas, episódios, player, favoritos, histórico
// ============================================================
const express = require('express');
const router = express.Router();
const uuid = require('uuid');
const moderation = require('./moderation');
const security = require('./security');
const childSafety = require('./child-safety');
const ai = require('./ai-creator');
const liveRooms = require('./live-rooms');

let db;

const sanitize = (str, maxLen) => security.sanitizeInput(str, maxLen);

function notify(userId, actorId, type, text) {
  try {
    db().run("INSERT INTO notifications (id, user_id, actor_id, type, content_id, text, is_read) VALUES (?, ?, ?, ?, '', ?, 0)",
      [uuid.v4(), userId, actorId || 'sistema', type, String(text).slice(0, 300)]);
    liveRooms.notifyUser(userId, { type, text, created_at: new Date().toISOString(), is_read: 0 });
  } catch (e) {}
}

function isAdminOrMod(userId) {
  const u = db().get('SELECT role FROM users WHERE id = ?', [userId]);
  return u && (u.role === 'admin' || u.role === 'moderator');
}

function enrichSeries(s, userId) {
  const episodes = (db().get('SELECT COUNT(*) as c FROM drama_episodes WHERE series_id = ?', [s.id]) || {}).c || 0;
  const fav = userId ? !!db().get('SELECT series_id FROM drama_favorites WHERE user_id = ? AND series_id = ?', [userId, s.id]) : false;
  const follow = userId ? !!db().get('SELECT series_id FROM drama_series_follows WHERE user_id = ? AND series_id = ?', [userId, s.id]) : false;
  return { ...s, total_episodes: episodes, favorite: fav, following: follow };
}

// ============================================================
// RESUMO/IA de episódio
// ============================================================
function aiSummary(synopsis, epTitle, n) {
  const seed = require('crypto').createHash('sha256').update(String(synopsis) + epTitle).digest('hex');
  const openers = ['Neste episódio', 'A trama avança', 'Segredos vêm à tona', 'Um novo capítulo'];
  const middles = ['os personagens enfrentam decisões difíceis', 'alianças mudam de lado', 'o passado volta para cobrar', 'um encontro inesperado muda tudo'];
  const i = parseInt(seed.slice(0, 8), 16);
  const j = parseInt(seed.slice(8, 16), 16);
  return (openers[i % openers.length] + ', ' + middles[j % middles.length] + ' — resumo gerado pela IA do VibeStream.').slice(0, 240);
}

// ============================================================
// CATÁLOGO / DESCOBRIR
// ============================================================
router.get('/drama', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const uid = req.session?.userId || null;
    const emAlta = db().query("SELECT * FROM drama_series WHERE status = 'publicado' ORDER BY views DESC LIMIT 8").map(s => enrichSeries(s, uid));
    const maisAssistidas = db().query("SELECT * FROM drama_series WHERE status = 'publicado' ORDER BY views DESC LIMIT 8").map(s => enrichSeries(s, uid));
    const lancamentos = db().query("SELECT * FROM drama_series WHERE status = 'publicado' ORDER BY created_at DESC LIMIT 8").map(s => enrichSeries(s, uid));
    const recomendadas = db().query("SELECT * FROM drama_series WHERE status = 'publicado' AND featured = 1 ORDER BY likes_count DESC LIMIT 8").map(s => enrichSeries(s, uid));
    const todas = db().query("SELECT * FROM drama_series WHERE status = 'publicado' ORDER BY views DESC LIMIT 40").map(s => enrichSeries(s, uid));
    let continuar = [];
    if (uid) {
      continuar = db().query(`
        SELECT h.*, e.title as ep_title, e.number as ep_number, s.title as series_title, s.cover_url
        FROM drama_history h
        JOIN drama_episodes e ON h.episode_id = e.id
        JOIN drama_series s ON h.series_id = s.id
        WHERE h.user_id = ? ORDER BY h.watched_at DESC LIMIT 10`, [uid]);
    }
    res.json({ success: true, data: {
      emAlta, maisAssistidas, lancamentos, recomendadas, todas, continuar,
      categorias: ['drama', 'comédia', 'ação', 'romance', 'suspense', 'infantil']
    } });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// DETALHE DA SÉRIE (temporadas + episódios)
// ============================================================
router.get('/drama/series/:id', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const s = db().get('SELECT * FROM drama_series WHERE id = ? AND status = "publicado"', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Série não encontrada' });
    const creator = s.creator_id ? db().get('SELECT id, username, display_name, avatar_url, bio FROM users WHERE id = ?', [s.creator_id]) : null;
    const seasons = db().query('SELECT * FROM drama_seasons WHERE series_id = ? ORDER BY number ASC', [s.id]).map(se => ({
      ...se,
      episodes: db().query('SELECT * FROM drama_episodes WHERE season_id = ? ORDER BY number ASC', [se.id])
    }));
    const next = null;
    let continueEp = null;
    if (req.session?.userId) {
      const h = db().query('SELECT * FROM drama_history WHERE user_id = ? AND series_id = ? ORDER BY watched_at DESC LIMIT 1', [req.session.userId, s.id]);
      if (h[0]) continueEp = h[0];
    }
    res.json({ success: true, series: enrichSeries(s, req.session?.userId), creator, seasons, continueEp });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// FAVORITAR / SEGUIR SÉRIE
// ============================================================
router.post('/drama/series/:id/favorite', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const s = db().get('SELECT id FROM drama_series WHERE id = ?', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Série não encontrada' });
    const ex = db().get('SELECT series_id FROM drama_favorites WHERE user_id = ? AND series_id = ?', [req.session.userId, req.params.id]);
    if (ex) { db().run('DELETE FROM drama_favorites WHERE user_id = ? AND series_id = ?', [req.session.userId, req.params.id]); return res.json({ success: true, favorite: false }); }
    db().run('INSERT INTO drama_favorites (user_id, series_id) VALUES (?, ?)', [req.session.userId, req.params.id]);
    res.json({ success: true, favorite: true });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post('/drama/series/:id/follow', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const s = db().get('SELECT id FROM drama_series WHERE id = ?', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Série não encontrada' });
    const ex = db().get('SELECT series_id FROM drama_series_follows WHERE user_id = ? AND series_id = ?', [req.session.userId, req.params.id]);
    if (ex) { db().run('DELETE FROM drama_series_follows WHERE user_id = ? AND series_id = ?', [req.session.userId, req.params.id]); return res.json({ success: true, following: false }); }
    db().run('INSERT INTO drama_series_follows (user_id, series_id) VALUES (?, ?)', [req.session.userId, req.params.id]);
    res.json({ success: true, following: true });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// MINHA ÁREA: favoritos, histórico, continuar assistindo
// ============================================================
router.get('/drama/my', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const uid = req.session.userId;
    const favoritos = db().query(`
      SELECT s.* FROM drama_favorites f JOIN drama_series s ON f.series_id = s.id
      WHERE f.user_id = ? ORDER BY f.created_at DESC`, [uid]).map(s => enrichSeries(s, uid));
    const historico = db().query(`
      SELECT h.progress, h.duration, h.watched_at, e.id as episode_id, e.number, e.title as ep_title,
             s.id as series_id, s.title as series_title, s.cover_url
      FROM drama_history h JOIN drama_episodes e ON h.episode_id = e.id
      JOIN drama_series s ON h.series_id = s.id
      WHERE h.user_id = ? ORDER BY h.watched_at DESC LIMIT 30`, [uid]);
    res.json({ success: true, data: { favoritos, historico } });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// EPISÓDIO: assistir (progresso), curtir, comentar
// ============================================================
router.get('/drama/episodes/:id', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const ep = db().get('SELECT * FROM drama_episodes WHERE id = ?', [req.params.id]);
    if (!ep) return res.status(404).json({ error: 'Episódio não encontrado' });
    const series = db().get('SELECT * FROM drama_series WHERE id = ?', [ep.series_id]);
    const prev = db().query('SELECT id FROM drama_episodes WHERE series_id = ? AND (season_id < ? OR (season_id = ? AND number < ?)) ORDER BY created_at DESC LIMIT 1', [ep.series_id, ep.season_id, ep.season_id, ep.number]);
    const next = db().query('SELECT id FROM drama_episodes WHERE series_id = ? AND (season_id > ? OR (season_id = ? AND number > ?)) ORDER BY created_at ASC LIMIT 1', [ep.series_id, ep.season_id, ep.season_id, ep.number]);
    const liked = req.session?.userId ? !!db().get('SELECT episode_id FROM drama_likes WHERE user_id = ? AND episode_id = ?', [req.session.userId, ep.id]) : false;
    db().run('UPDATE drama_episodes SET views = views + 1 WHERE id = ?', [ep.id]);
    db().run('UPDATE drama_series SET views = views + 1 WHERE id = ?', [ep.series_id]);
    res.json({ success: true, episode: { ...ep, liked }, series: series ? enrichSeries(series, req.session?.userId) : null, prev: prev[0]?.id || null, next: next[0]?.id || null });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post('/drama/episodes/:id/watch', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const ep = db().get('SELECT id, series_id, duration FROM drama_episodes WHERE id = ?', [req.params.id]);
    if (!ep) return res.status(404).json({ error: 'Episódio não encontrado' });
    const progress = Math.max(0, parseInt(req.body.progress) || 0);
    const duration = parseInt(req.body.duration) || ep.duration || 0;
    db().run(`INSERT INTO drama_history (id, user_id, series_id, episode_id, progress, duration, watched_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET progress = excluded.progress, duration = excluded.duration, watched_at = datetime('now')`,
      [uuid.v4(), req.session.userId, ep.series_id, ep.id, progress, duration]);
    res.json({ success: true });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post('/drama/episodes/:id/like', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const ep = db().get('SELECT id, series_id FROM drama_episodes WHERE id = ?', [req.params.id]);
    if (!ep) return res.status(404).json({ error: 'Episódio não encontrado' });
    const ex = db().get('SELECT episode_id FROM drama_likes WHERE user_id = ? AND episode_id = ?', [req.session.userId, ep.id]);
    if (ex) {
      db().run('DELETE FROM drama_likes WHERE user_id = ? AND episode_id = ?', [req.session.userId, ep.id]);
      db().run('UPDATE drama_episodes SET likes_count = MAX(likes_count - 1, 0) WHERE id = ?', [ep.id]);
      db().run('UPDATE drama_series SET likes_count = MAX(likes_count - 1, 0) WHERE id = ?', [ep.series_id]);
      return res.json({ success: true, liked: false });
    }
    db().run('INSERT INTO drama_likes (user_id, episode_id) VALUES (?, ?)', [req.session.userId, ep.id]);
    db().run('UPDATE drama_episodes SET likes_count = likes_count + 1 WHERE id = ?', [ep.id]);
    db().run('UPDATE drama_series SET likes_count = likes_count + 1 WHERE id = ?', [ep.series_id]);
    res.json({ success: true, liked: true });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get('/drama/episodes/:id/comments', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const comments = db().query(`
      SELECT c.*, u.username, u.display_name, u.avatar_url FROM drama_comments c
      JOIN users u ON c.user_id = u.id WHERE c.episode_id = ? ORDER BY c.created_at ASC LIMIT 100`, [req.params.id]);
    res.json({ success: true, comments });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post('/drama/episodes/:id/comments', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const rl = security.rateLimit(db(), 'drama-comment:' + req.session.userId, 60, 10);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const ep = db().get('SELECT id, series_id FROM drama_episodes WHERE id = ?', [req.params.id]);
    if (!ep) return res.status(404).json({ error: 'Episódio não encontrado' });
    const text = sanitize(String(req.body.text || ''), 500);
    if (text.trim().length < 1) return res.status(400).json({ error: 'Comentário vazio' });
    const child = childSafety.matchChild(text);
    if (child) return res.status(403).json({ error: 'Conteúdo removido por segurança', code: 'CHILD_BANNED' });
    const mod = moderation.moderateText(text, 'comment');
    if (mod.status === 'blocked') return res.status(403).json({ error: mod.reason || 'Comentário não permitido' });
    const id = uuid.v4();
    db().run("INSERT INTO drama_comments (id, episode_id, user_id, text) VALUES (?, ?, ?, ?)", [id, req.params.id, req.session.userId, text]);
    const u = db().get('SELECT username, display_name, avatar_url FROM users WHERE id = ?', [req.session.userId]);
    res.status(201).json({ success: true, comment: { id, episode_id: req.params.id, user_id: req.session.userId, text, created_at: new Date().toISOString(), username: u?.username, display_name: u?.display_name, avatar_url: u?.avatar_url } });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// CRIADORES: criar série com IA + adicionar episódio com resumo
// ============================================================
router.post('/drama/series', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const rl = security.rateLimit(db(), 'drama-create:' + req.session.userId, 3600, 10);
    if (rl.blocked) return res.status(429).json({ error: rl.reason });
    const { title, synopsis, category, year } = req.body || {};
    const safeCheck = ai.checkContentSafety(db, String(title || '') + ' ' + String(synopsis || ''));
    if (!safeCheck.ok) return res.status(403).json({ error: safeCheck.reason, code: 'CONTENT_BLOCKED' });
    const cleanTitle = sanitize(String(title || ''), 120);
    const cleanSynopsis = sanitize(String(synopsis || ''), 1500);
    if (cleanTitle.trim().length < 3) return res.status(400).json({ error: 'Título obrigatório' });
    const id = uuid.v4();
    const bundle = ai.generateBundle(cleanSynopsis || cleanTitle, 'cinematografico');
    const cover = bundle.cover_url;
    db().run(`INSERT INTO drama_series (id, title, synopsis, cover_url, creator_id, category, year, total_seasons, total_episodes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [id, cleanTitle, cleanSynopsis, cover, req.session.userId, sanitize(String(category || 'drama'), 30), sanitize(String(year || '2026'), 4)]);
    db().run('INSERT INTO drama_seasons (id, series_id, number, title) VALUES (?, ?, 1, ?)', [uuid.v4(), id, 'Temporada 1']);
    res.status(201).json({ success: true, seriesId: id, cover, message: 'Série criada com capa gerada pela IA!' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post('/drama/series/:id/episodes', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Não autenticado' });
    const s = db().get('SELECT id, creator_id FROM drama_series WHERE id = ?', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Série não encontrada' });
    if (String(s.creator_id) !== String(req.session.userId) && !isAdminOrMod(req.session.userId)) return res.status(403).json({ error: 'Permissão negada' });
    const { title, synopsis, videoUrl, duration, seasonNumber } = req.body || {};
    const safeCheck = ai.checkContentSafety(db, String(title || '') + ' ' + String(synopsis || ''));
    if (!safeCheck.ok) return res.status(403).json({ error: safeCheck.reason, code: 'CONTENT_BLOCKED' });
    const seasonNum = Math.max(1, parseInt(seasonNumber) || 1);
    let season = db().get('SELECT id FROM drama_seasons WHERE series_id = ? AND number = ?', [req.params.id, seasonNum]);
    if (!season) {
      season = { id: uuid.v4() };
      db().run('INSERT INTO drama_seasons (id, series_id, number, title) VALUES (?, ?, ?, ?)', [season.id, req.params.id, seasonNum, 'Temporada ' + seasonNum]);
    }
    const n = (db().get('SELECT COUNT(*) as c FROM drama_episodes WHERE series_id = ? AND season_id = ?', [req.params.id, season.id]) || {}).c || 0;
    const epTitle = sanitize(String(title || ('Episódio ' + (n + 1))), 120);
    const epSynopsis = sanitize(String(synopsis || ''), 1500);
    const summary = aiSummary(epSynopsis || epTitle, epTitle, n + 1);
    const cover = ai.generateCover(epSynopsis || epTitle, epTitle, 'cinematografico');
    const id = uuid.v4();
    db().run(`INSERT INTO drama_episodes (id, series_id, season_id, number, title, synopsis, summary, video_url, duration, thumbnail_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.params.id, season.id, n + 1, epTitle, epSynopsis, summary, sanitize(String(videoUrl || ''), 300), Math.max(0, parseInt(duration) || 0), cover]);
    db().run("UPDATE drama_series SET total_episodes = (SELECT COUNT(*) FROM drama_episodes WHERE series_id = ?), total_seasons = (SELECT COUNT(DISTINCT season_id) FROM drama_episodes WHERE series_id = ?) WHERE id = ?", [req.params.id, req.params.id, req.params.id]);
    // Notifica fãs da série
    const fans = db().query('SELECT user_id FROM drama_series_follows WHERE series_id = ?', [req.params.id]);
    for (const f of fans) notify(f.user_id, req.session.userId, 'live_started', 'Novo episódio de ' + (s.title || 'série') + ': ' + epTitle);
    res.status(201).json({ success: true, episodeId: id, summary, cover, message: 'Episódio adicionado com resumo gerado pela IA!' });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// PERFIL DO CRIADOR + OBRAS
// ============================================================
router.get('/drama/creator/:userId', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const u = db().get('SELECT id, username, display_name, avatar_url, bio, followers_count FROM users WHERE id = ?', [req.params.userId]);
    if (!u) return res.status(404).json({ error: 'Criador não encontrado' });
    const works = db().query('SELECT * FROM drama_series WHERE creator_id = ? AND status = "publicado" ORDER BY views DESC', [req.params.userId]).map(s => enrichSeries(s, req.session?.userId));
    res.json({ success: true, creator: u, works });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});


// ============================================================
// SEED — novelas originais do VibeStream (capas geradas por IA)
// ============================================================
function seedDrama() {
  try {
    const count = (db().get('SELECT COUNT(*) as c FROM drama_series') || {}).c || 0;
    if (count > 0) return;
    const admin = db().get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    const creatorId = admin ? admin.id : null;
    const series = [
      { title: 'O Farol da Virada', category: 'drama', synopsis: 'No litoral brasileiro, um jovem pescador herda o farol da vila e descobre um segredo da família que pode mudar a cidade inteira. Entre o mar e o destino, ele precisa escolher o próprio caminho.', year: '2026', featured: 1 },
      { title: 'Quebrada em Alta', category: 'acao', synopsis: 'Na comunidade urbana, três amigos transformam um projeto social em movimento. Conflitos, superação e amizade em uma história de coragem e recomeço.', year: '2026', featured: 1 },
      { title: 'Amor de Verão', category: 'romance', synopsis: 'Um encontro inesperado em uma praia do nordeste une dois mundos diferentes. O verão termina, mas o que eles sentem não tem data para acabar.', year: '2025', featured: 1 },
      { title: 'A Grande Virada', category: 'suspense', synopsis: 'Um golpe perfeito se torna uma armadilha. Cada episódio revela uma nova reviravolta enquanto um detetive tenta desmontar o plano.', year: '2026', featured: 0 }
    ];
    for (const s of series) {
      const sid = require('uuid').v4();
      const cover = ai.generateCover(s.synopsis, s.title, 'cinematografico');
      db().run("INSERT INTO drama_series (id, title, synopsis, cover_url, creator_id, category, year, status, featured, total_seasons, total_episodes) VALUES (?, ?, ?, ?, ?, ?, ?, 'publicado', ?, 2, 0)",
        [sid, s.title, s.synopsis, cover, creatorId, s.category, s.year, s.featured]);
      for (let sea = 1; sea <= 2; sea++) {
        const seid = require('uuid').v4();
        db().run('INSERT INTO drama_seasons (id, series_id, number, title) VALUES (?, ?, ?, ?)', [seid, sid, sea, 'Temporada ' + sea]);
        for (let ep = 1; ep <= 3; ep++) {
          const eid = require('uuid').v4();
          const epTitle = s.title + ' — Episódio ' + ep;
          const epSynopsis = s.synopsis + ' Neste capítulo, novos segredos e emoções tomam conta da história.';
          const summary = aiSummary(epSynopsis, epTitle, ep);
          const thumb = ai.generateCover(epSynopsis, 'Cap. ' + ep, 'cinematografico');
          db().run(`INSERT INTO drama_episodes (id, series_id, season_id, number, title, synopsis, summary, video_url, duration, thumbnail_url, views, likes_count) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
            [eid, sid, seid, ep, epTitle, epSynopsis, summary, 1320 + (ep * 180), thumb, 1000 + (ep * 777), 80 + ep]);
        }
      }
    }
    console.log('[DRAMA] ✅ Seed: 4 novelas originais (8 temporadas, 24 episódios)');
  } catch (e) { console.error('[DRAMA] seed:', e.message); }
}

module.exports = function (database) {
  db = () => database.getInstance();
  return router;
};
module.exports.seedDrama = seedDrama;


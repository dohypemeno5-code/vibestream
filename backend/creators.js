// ============================================================
// CRIADORES — Agências, carteira, saque PIX, campanhas, views
// ============================================================
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const security = require('./security');

function uuid() { return crypto.randomUUID(); }
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/['";()\-\-]/g, '').replace(/<[^>]*>/g, '').trim();
}
function money(v) { return Math.max(0, Math.round((parseFloat(v) || 0) * 1000) / 1000); }

function getWallet(db, userId) {
  let w = db.get('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  if (!w) {
    db.run('INSERT INTO wallets (user_id, balance, pending) VALUES (?, 0, 0)', [userId]);
    w = db.get('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  }
  return w;
}

function creditWallet(db, userId, amount, type, description) {
  const value = money(amount);
  if (value <= 0) return;
  getWallet(db, userId);
  db.run('UPDATE wallets SET balance = balance + ?, updated_at = datetime(\'now\') WHERE user_id = ?', [value, userId]);
  db.run('INSERT INTO wallet_transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)',
    [uuid(), userId, type, value, sanitize(description || type)]);
}

function getEarningConfig(db, key) {
  return (db.get('SELECT value FROM earnings_config WHERE key = ?', [key]) || {}).value || 0;
}

module.exports = function (database) {
  const db = () => database.getInstance();

  // ============================================================
  // AGÊNCIAS
  // ============================================================
  router.post('/agencies', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const { name, description, commissionPct } = req.body;
    if (!name || String(name).trim().length < 3) return res.status(400).json({ error: 'Nome da agência (mín 3 caracteres)' });
    const nameClean = sanitize(String(name)).slice(0, 40);
    const existing = db().get('SELECT id FROM agencies WHERE name = ?', [nameClean]);
    if (existing) return res.status(409).json({ error: 'Já existe uma agência com esse nome' });
    const my = db().get('SELECT a.id FROM agency_members am JOIN agencies a ON am.agency_id = a.id WHERE am.user_id = ? AND am.status = \'ativo\'', [req.session.userId]);
    if (my) return res.status(400).json({ error: 'Você já está em uma agência' });
    const id = uuid();
    const code = 'AG-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    db().run('INSERT INTO agencies (id, name, code, owner_id, description, commission_pct) VALUES (?, ?, ?, ?, ?, ?)',
      [id, nameClean, code, req.session.userId, sanitize(String(description || '')).slice(0, 200), Math.min(50, Math.max(0, parseInt(commissionPct) || 10))]);
    db().run('INSERT INTO agency_members (id, agency_id, user_id, role) VALUES (?, ?, ?, ?)', [uuid(), id, req.session.userId, 'owner']);
    security.createAlert(db(), 'agencia_criada', 'baixo', 'Nova agência criada: ' + nameClean, req.ip, req.session.userId);
    res.status(201).json({ agency: { id, name: nameClean, code, commission_pct: commissionPct || 10 } });
  });

  router.get('/agencies/my', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const row = db().get(`SELECT a.*, am.role as my_role FROM agency_members am JOIN agencies a ON am.agency_id = a.id WHERE am.user_id = ? AND am.status = 'ativo'`, [req.session.userId]);
    if (!row) return res.json({ agency: null });
    const members = db().query(`SELECT am.role, am.joined_at, am.total_earnings, u.username, u.display_name, u.avatar_url FROM agency_members am JOIN users u ON am.user_id = u.id WHERE am.agency_id = ? AND am.status = 'ativo' ORDER BY am.joined_at ASC`, [row.id]);
    const invites = db().query(`SELECT ai.id, ai.status, u.username FROM agency_invites ai JOIN users u ON ai.to_id = u.id WHERE ai.agency_id = ? AND ai.status = 'pendente'`, [row.id]);
    res.json({ agency: { ...row, members, invites } });
  });

  router.get('/agencies/invites', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const invites = db().query(`SELECT ai.id, ai.status, ai.created_at, a.name, a.code FROM agency_invites ai JOIN agencies a ON ai.agency_id = a.id WHERE ai.to_id = ? AND ai.status = 'pendente' ORDER BY ai.created_at DESC`, [req.session.userId]);
    res.json({ invites });
  });

  router.get('/agencies/:id', (req, res) => {
    const a = db().get('SELECT * FROM agencies WHERE id = ?', [req.params.id]);
    if (!a) return res.status(404).json({ error: 'Agência não encontrada' });
    const members = db().query(`SELECT am.role, am.joined_at, am.total_earnings, u.username, u.display_name, u.avatar_url FROM agency_members am JOIN users u ON am.user_id = u.id WHERE am.agency_id = ? AND am.status = 'ativo' ORDER BY am.total_earnings DESC LIMIT 50`, [a.id]);
    res.json({ agency: { ...a, members } });
  });

  router.post('/agencies/join-code', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código da agência é obrigatório' });
    const a = db().get('SELECT * FROM agencies WHERE code = ?', [String(code).trim().toUpperCase()]);
    if (!a) return res.status(404).json({ error: 'Código inválido' });
    const member = db().get('SELECT id FROM agency_members WHERE agency_id = ? AND user_id = ?', [a.id, req.session.userId]);
    if (member) return res.status(400).json({ error: 'Você já está nessa agência' });
    db().run('INSERT INTO agency_members (id, agency_id, user_id, role) VALUES (?, ?, ?, ?)', [uuid(), a.id, req.session.userId, 'creator']);
    db().run('UPDATE agencies SET members_count = members_count + 1 WHERE id = ?', [a.id]);
    res.json({ message: 'Entrou na agência ' + a.name, agency: { id: a.id, name: a.name } });
  });

  router.post('/agencies/:id/invite', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const a = db().get('SELECT * FROM agencies WHERE id = ?', [req.params.id]);
    if (!a) return res.status(404).json({ error: 'Agência não encontrada' });
    const me = db().get("SELECT role FROM agency_members WHERE agency_id = ? AND user_id = ? AND status = 'ativo'", [a.id, req.session.userId]);
    if (!me || !['owner', 'manager'].includes(me.role)) return res.status(403).json({ error: 'Só o dono/gerente pode convidar' });
    const { username } = req.body;
    const target = db().get('SELECT id, username FROM users WHERE username = ?', [sanitize(String(username || ''))]);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (String(target.id) === String(req.session.userId)) return res.status(400).json({ error: 'Não pode se auto-convidar' });
    const existing = db().get('SELECT id FROM agency_invites WHERE agency_id = ? AND to_id = ? AND status = ?', [a.id, target.id, 'pendente']);
    if (existing) return res.status(400).json({ error: 'Convite já enviado' });
    db().run('INSERT INTO agency_invites (id, agency_id, from_id, to_id) VALUES (?, ?, ?, ?)', [uuid(), a.id, req.session.userId, target.id]);
    res.status(201).json({ message: 'Convite enviado para ' + target.username });
  });

  router.post('/agencies/invites/:id/accept', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const inv = db().get('SELECT * FROM agency_invites WHERE id = ? AND to_id = ?', [req.params.id, req.session.userId]);
    if (!inv || inv.status !== 'pendente') return res.status(404).json({ error: 'Convite não encontrado' });
    const my = db().get("SELECT id FROM agency_members WHERE user_id = ? AND status = 'ativo'", [req.session.userId]);
    if (my) return res.status(400).json({ error: 'Você já está em uma agência' });
    db().run("UPDATE agency_invites SET status = 'aceito' WHERE id = ?", [inv.id]);
    db().run('INSERT INTO agency_members (id, agency_id, user_id, role) VALUES (?, ?, ?, ?)', [uuid(), inv.agency_id, req.session.userId, 'creator']);
    db().run('UPDATE agencies SET members_count = members_count + 1 WHERE id = ?', [inv.agency_id]);
    res.json({ message: 'Convite aceito! Você entrou na agência.' });
  });

  router.post('/agencies/invites/:id/decline', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    db().run("UPDATE agency_invites SET status = 'recusado' WHERE id = ? AND to_id = ?", [req.params.id, req.session.userId]);
    res.json({ message: 'Convite recusado' });
  });

  router.delete('/agencies/:id/members/:userId', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const a = db().get('SELECT * FROM agencies WHERE id = ?', [req.params.id]);
    if (!a) return res.status(404).json({ error: 'Agência não encontrada' });
    const me = db().get("SELECT role FROM agency_members WHERE agency_id = ? AND user_id = ? AND status = 'ativo'", [a.id, req.session.userId]);
    const selfLeave = String(req.params.userId) === String(req.session.userId);
    if (!me || (!selfLeave && !['owner', 'manager'].includes(me.role))) return res.status(403).json({ error: 'Sem permissão' });
    db().run("UPDATE agency_members SET status = 'inativo' WHERE agency_id = ? AND user_id = ?", [a.id, req.params.userId]);
    db().run('UPDATE agencies SET members_count = max(1, members_count - 1) WHERE id = ?', [a.id]);
    res.json({ message: 'Membro removido' });
  });

  // ============================================================
  // CARTEIRA + SAQUE PIX
  // ============================================================
  router.get('/wallet', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const w = getWallet(db(), req.session.userId);
    const transactions = db().query('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.session.userId]);
    const withdrawals = db().query('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [req.session.userId]);
    res.json({ wallet: { balance: w.balance, pending: w.pending }, transactions, withdrawals });
  });

  router.post('/wallet/withdraw', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const { amount, pixKey, pixType } = req.body;
    const value = money(amount);
    if (value < 1) return res.status(400).json({ error: 'Saque mínimo de R$ 1,00' });
    const key = sanitize(String(pixKey || '')).slice(0, 60);
    if (!key || key.length < 4) return res.status(400).json({ error: 'Chave PIX inválida' });
    const w = getWallet(db(), req.session.userId);
    if ((w.balance || 0) < value) return res.status(400).json({ error: 'Saldo insuficiente' });
    const autoLimit = getEarningConfig(db(), 'auto_withdraw_limit');
    const autoApprove = value <= autoLimit;
    const id = uuid();
    db().run('UPDATE wallets SET balance = balance - ?, updated_at = datetime(\'now\') WHERE user_id = ?', [value, req.session.userId]);
    db().run('INSERT INTO withdrawals (id, user_id, amount, pix_key, pix_type, status) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.session.userId, value, key, ['cpf', 'email', 'telefone', 'aleatoria'].includes(pixType) ? pixType : 'cpf', autoApprove ? 'aprovado' : 'pendente']);
    db().run('INSERT INTO wallet_transactions (id, user_id, type, amount, description, status) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), req.session.userId, 'saque', -value, 'Saque via PIX ' + (autoApprove ? '(automático)' : '(aguardando admin)'), autoApprove ? 'concluido' : 'pendente']);
    if (!autoApprove) security.createAlert(db(), 'saque_pendente', 'baixo', 'Saque PIX de R$ ' + value.toFixed(2) + ' aguardando aprovação', req.ip, req.session.userId);
    res.status(201).json({ withdrawal: { id, status: autoApprove ? 'aprovado' : 'pendente' }, message: autoApprove ? 'Saque aprovado automaticamente!' : 'Saque enviado para aprovação do administrador' });
  });

  // ============================================================
  // VÍDEOS: views + engajamento → ganhos
  // ============================================================
  router.post('/posts/:id/view', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const post = db().get('SELECT id, user_id, media_type FROM posts WHERE id = ? AND is_deleted = 0 AND status = ?', [req.params.id, 'approved']);
    if (!post) return res.status(404).json({ error: 'Vídeo não encontrado' });
    if (String(post.user_id) === String(req.session.userId)) return res.json({ counted: false }); // não conta a própria view
    const existing = db().get('SELECT id FROM video_views WHERE user_id = ? AND post_id = ?', [req.session.userId, post.id]);
    if (existing) return res.json({ counted: false });
    db().run('INSERT INTO video_views (id, user_id, post_id) VALUES (?, ?, ?)', [uuid(), req.session.userId, post.id]);
    // Ganho para o criador (por visualização)
    const perView = getEarningConfig(db(), 'per_view');
    creditWallet(db(), post.user_id, perView, 'view', 'Visualização de vídeo');
    // Comissão da agência (se o criador estiver em uma)
    const membership = db().get("SELECT am.agency_id, a.commission_pct FROM agency_members am JOIN agencies a ON am.agency_id = a.id WHERE am.user_id = ? AND am.status = 'ativo'", [post.user_id]);
    if (membership) {
      db().run('UPDATE agency_members SET total_earnings = total_earnings + ? WHERE agency_id = ? AND user_id = ?', [perView, membership.agency_id, post.user_id]);
      db().run('UPDATE agencies SET total_earnings = total_earnings + ? WHERE id = ?', [perView, membership.agency_id]);
    }
    res.json({ counted: true, views: (db().get('SELECT COUNT(*) as c FROM video_views WHERE post_id = ?', [post.id]) || {}).c });
  });

  router.post('/posts/:id/like-earn', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const post = db().get('SELECT id, user_id FROM posts WHERE id = ? AND is_deleted = 0', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Post não encontrado' });
    if (String(post.user_id) === String(req.session.userId)) return res.json({ earned: false });
    const liked = db().get('SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?', [post.id, req.session.userId]);
    if (!liked) return res.json({ earned: false });
    const already = db().get("SELECT id FROM wallet_transactions WHERE user_id = ? AND type = 'like_earn' AND description LIKE ?", [post.user_id, '%' + post.id + '%']);
    if (already) return res.json({ earned: false });
    const perLike = getEarningConfig(db(), 'per_like');
    creditWallet(db(), post.user_id, perLike, 'like_earn', 'Curtida no post ' + post.id);
    res.json({ earned: true });
  });

  // ============================================================
  // CAMPANHAS
  // ============================================================
  router.get('/campaigns', (req, res) => {
    const campaigns = db().query('SELECT * FROM campaigns WHERE active = 1 ORDER BY created_at DESC LIMIT 20');
    const enriched = campaigns.map(c => {
      const joined = req.session?.userId ? db().get('SELECT status FROM campaign_participants WHERE user_id = ? AND campaign_id = ?', [req.session.userId, c.id]) : null;
      const participants = (db().get('SELECT COUNT(*) as c FROM campaign_participants WHERE campaign_id = ?', [c.id]) || {}).c || 0;
      return { ...c, joined: joined ? joined.status : null, participants };
    });
    res.json({ campaigns: enriched });
  });

  router.post('/campaigns/:id/join', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const c = db().get('SELECT * FROM campaigns WHERE id = ? AND active = 1', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
    db().run('INSERT OR IGNORE INTO campaign_participants (user_id, campaign_id) VALUES (?, ?)', [req.session.userId, c.id]);
    res.json({ message: 'Você entrou na campanha!' });
  });

  return router;
};


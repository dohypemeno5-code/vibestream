/**
 * VibeStream — Famílias + Agências (Poppo Live) + tarefas/dinheiro.
 * REGRA DE OURO: TODA rota responde JSON puro {success, data/error}.
 * NUNCA res.send()/res.sendFile() — sempre res.status(200).json(...)
 */
const express = require('express');
const router = express.Router();
const uuid = require('uuid');
const security = require('./security');

function sanitize(str, max = 120) {
  return String(str || '').replace(/['"\\;()\-\-]/g, '').replace(/<[^>]*>/g, '').slice(0, max);
}
function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json');
  return res.status(status).json(payload);
}
function ok(res, data) { return json(res, 200, { success: true, data }); }
function err(res, status, message, code) { return json(res, status, { success: false, error: message, code: code || '' }); }
function auth(db, req) { return req.session?.userId ? db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]) : null; }
function isAdmin(user) { return user && user.role === 'admin'; }
function isMod(user) { return user && (user.role === 'admin' || user.role === 'moderator'); }
function notif(db, userId, type, text) {
  try { db.run("INSERT INTO notifications (id, user_id, actor_id, type, text) VALUES (?, ?, 'sistema', ?, ?)", [uuid.v4(), userId, String(type).slice(0, 30), String(text).slice(0, 200)]); } catch (e) {}
}
function logTx(db, userId, type, amount, description, refId) {
  try { db.run("INSERT INTO wallet_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)", [uuid.v4(), userId, String(type).slice(0, 30), Number(amount || 0), String(description || '').slice(0, 200), refId || '']); } catch (e) {}
}
function getWallet(db, userId) {
  const w = db.get('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  if (!w) { db.run("INSERT INTO wallets (user_id, balance, pending) VALUES (?, 0, 0)", [userId]); return { user_id: userId, balance: 0, pending: 0 }; }
  return w;
}
function addGolds(db, userId, amount, type, desc) {
  db.run('UPDATE users SET coins = coins + ? WHERE id = ?', [amount, userId]);
  logTx(db, userId, type, amount, desc);
  return db.get('SELECT coins FROM users WHERE id = ?', [userId]).coins;
}
function addReais(db, userId, value, type, desc) {
  const w = getWallet(db, userId);
  db.run('UPDATE wallets SET balance = balance + ?, updated_at = datetime(\'now\') WHERE user_id = ?', [value, userId]);
  db.run("INSERT INTO wallet_transactions (id, user_id, type, amount, description, status) VALUES (?, ?, ?, ?, ?, 'concluido')", [uuid.v4(), userId, type, value, desc]);
  return w.balance + value;
}
function todayKey() { return new Date().toISOString().slice(0, 10); }
function getReward(db, userId) {
  const st = db.get('SELECT * FROM user_rewards WHERE user_id = ?', [userId]);
  return st || { watch_seconds: 0, watch_day: '', last_checkin: '', checkin_streak: 0, checkin_last: '' };
}
function saveReward(db, userId, st) {
  db.run(`INSERT INTO user_rewards (user_id, watch_seconds, watch_day, last_checkin, checkin_streak, checkin_last, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET watch_seconds = excluded.watch_seconds, watch_day = excluded.watch_day,
    last_checkin = excluded.last_checkin, checkin_streak = excluded.checkin_streak, checkin_last = excluded.checkin_last, updated_at = datetime('now')`,
    [userId, st.watch_seconds || 0, st.watch_day || '', st.last_checkin || '', st.checkin_streak || 0, st.checkin_last || '']);
}

// ============================================================
// FAMÍLIAS — livre, qualquer um cria
// ============================================================
router.post('/familias/criar', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    if (user.restriction_level === 'restricted') return err(res, 403, 'Menores de 18 anos não podem criar famílias');
    const { nome, tag, logo, descricao } = req.body || {};
    const name = sanitize(nome, 40).toUpperCase();
    const tagClean = String(tag || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5);
    if (!name || name.length < 3) return err(res, 400, 'Nome da família é obrigatório (mín. 3 letras)');
    if (tagClean.length < 3 || tagClean.length > 5) return err(res, 400, 'A TAG precisa ter de 3 a 5 letras (ex: TDA)');
    if (db().get('SELECT id FROM families WHERE name = ?', [name])) return err(res, 409, 'Nome de família já existe');
    if (db().get('SELECT id FROM families WHERE tag = ?', [tagClean])) return err(res, 409, 'TAG já usada por outra família');
    if (db().get('SELECT id FROM families WHERE owner_id = ?', [user.id])) return err(res, 400, 'Você já é dono de uma família');
    const id = uuid.v4();
    db().run("INSERT INTO families (id, name, description, logo_url, owner_id, members_count, total_golds, rank, level, tag, total_diamonds) VALUES (?, ?, ?, ?, ?, 1, 0, 1, 1, ?, 0)", [id, name, sanitize(descricao, 300), sanitize(logo || '', 300), user.id, tagClean]);
    db().run("INSERT INTO family_members (id, family_id, user_id, role) VALUES (?, ?, ?, 'owner')", [uuid.v4(), id, user.id]);
    db().run("UPDATE users SET family_id = ?, family_tag = ? WHERE id = ?", [id, tagClean, user.id]);
    security.createAlert(db(), 'familia_criada', 'baixo', 'Família criada: ' + name + ' [' + tagClean + ']', req.ip, user.id);
    return ok(res, { id, nome: name, tag: tagClean, message: 'Família criada! TAG adicionada ao seu perfil: [' + tagClean + ']' });
  } catch (e) { return err(res, 500, e.message); }
});

router.get('/familias', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const families = db().query("SELECT f.*, u.username as owner_name, (SELECT COUNT(*) FROM family_members fm WHERE fm.family_id = f.id) as membros FROM families f JOIN users u ON f.owner_id = u.id ORDER BY f.total_golds DESC, f.rank ASC");
    return ok(res, families.map((f, i) => ({
      id: f.id, nome: f.name, tag: f.tag || '', logo: f.logo_url || '', donoId: f.owner_id, dono: f.owner_name,
      membros: f.membros || 0, nivel: f.level || 1, totalGolds: f.total_golds || 0, ranking: i + 1
    })));
  } catch (e) { return err(res, 500, e.message); }
});

router.get('/familias/:id', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const f = db().get('SELECT * FROM families WHERE id = ?', [req.params.id]);
    if (!f) return err(res, 404, 'Família não encontrada');
    const members = db().query("SELECT fm.*, u.username, u.display_name, u.avatar_url, u.coins FROM family_members fm JOIN users u ON fm.user_id = u.id WHERE fm.family_id = ? ORDER BY fm.role = 'owner' DESC, fm.joined_at ASC", [f.id]);
    const rank = (db().query("SELECT id FROM families ORDER BY total_golds DESC").map(r => r.id).indexOf(f.id) + 1);
    return ok(res, {
      id: f.id, nome: f.name, tag: f.tag || '', logo: f.logo_url || '', descricao: f.description || '',
      donoId: f.owner_id, nivel: f.level || 1, totalGolds: f.total_golds || 0, ranking: rank || 1,
      membros: members.map(m => ({ id: m.user_id, username: m.username, nome: m.display_name, avatar: m.avatar_url || '', role: m.role, golds: m.coins || 0 }))
    });
  } catch (e) { return err(res, 500, e.message); }
});

router.post('/familias/:id/entrar', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    const f = db().get('SELECT * FROM families WHERE id = ?', [req.params.id]);
    if (!f) return err(res, 404, 'Família não encontrada');
    if (db().get('SELECT id FROM family_members WHERE family_id = ? AND user_id = ?', [f.id, user.id])) return err(res, 400, 'Você já é membro desta família');
    db().run('INSERT INTO family_members (id, family_id, user_id, role) VALUES (?, ?, ?, ?)', [uuid.v4(), f.id, user.id, 'member']);
    db().run('UPDATE families SET members_count = members_count + 1 WHERE id = ?', [f.id]);
    db().run('UPDATE users SET family_id = ?, family_tag = ? WHERE id = ?', [f.id, f.tag || '', user.id]);
    notif(db(), f.owner_id, 'familia', '👥 ' + (user.display_name || user.username) + ' entrou na sua família ' + f.name + '!');
    return ok(res, { message: 'Você entrou na família! TAG adicionada: [' + (f.tag || '') + ']', tag: f.tag || '' });
  } catch (e) { return err(res, 500, e.message); }
});

router.post('/familias/:id/sair', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    const f = db().get('SELECT * FROM families WHERE id = ?', [req.params.id]);
    if (!f) return err(res, 404, 'Família não encontrada');
    const member = db().get('SELECT * FROM family_members WHERE family_id = ? AND user_id = ?', [f.id, user.id]);
    if (!member) return err(res, 400, 'Você não é membro desta família');
    if (member.role === 'owner') return err(res, 400, 'O dono não pode sair da família');
    db().run('DELETE FROM family_members WHERE id = ?', [member.id]);
    db().run('UPDATE families SET members_count = MAX(1, members_count - 1) WHERE id = ?', [f.id]);
    db().run('UPDATE users SET family_id = ?, family_tag = ? WHERE id = ?', ['', '', user.id]);
    return ok(res, { message: 'Você saiu da família' });
  } catch (e) { return err(res, 500, e.message); }
});

router.put('/familias/:id', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    const f = db().get('SELECT * FROM families WHERE id = ?', [req.params.id]);
    if (!f) return err(res, 404, 'Família não encontrada');
    if (String(f.owner_id) !== String(user.id) && !isAdmin(user)) return err(res, 403, 'Só o dono pode editar a família');
    const { nome, tag, descricao, logo } = req.body || {};
    const name = nome ? sanitize(nome, 40).toUpperCase() : f.name;
    const tagClean = tag ? String(tag).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5) : f.tag;
    if (tagClean && tagClean.length >= 3) {
      const other = db().get('SELECT id FROM families WHERE tag = ? AND id != ?', [tagClean, f.id]);
      if (other) return err(res, 409, 'TAG já usada por outra família');
    }
    db().run('UPDATE families SET name = ?, tag = ?, description = ?, logo_url = ? WHERE id = ?', [name, tagClean || '', sanitize(descricao !== undefined ? descricao : f.description, 300), sanitize(logo !== undefined ? logo : f.logo_url, 300), f.id]);
    if (tagClean) db().run("UPDATE family_members fm SET user_id = user_id WHERE fm.family_id = ?", [f.id]); // no-op guarda
    if (tagClean) db().run('UPDATE users SET family_tag = ? WHERE family_id = ?', [tagClean, f.id]);
    return ok(res, { message: 'Família atualizada!', nome: name, tag: tagClean });
  } catch (e) { return err(res, 500, e.message); }
});

// ============================================================
// AGÊNCIAS — precisa de aprovação do admin
// ============================================================
router.post('/agencias/solicitar', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    if (user.restriction_level === 'restricted') return err(res, 403, 'Menores de 18 anos não podem criar agências');
    const { nome, tag, logo, descricao, whatsapp } = req.body || {};
    const name = sanitize(nome, 40);
    const tagClean = String(tag || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4);
    if (!name || name.length < 2) return err(res, 400, 'Nome da agência é obrigatório');
    if (tagClean.length < 2 || tagClean.length > 4) return err(res, 400, 'A TAG precisa ter de 2 a 4 letras (ex: FR)');
    if (db().get('SELECT id FROM agencies WHERE name = ?', [name])) return err(res, 409, 'Nome de agência já existe');
    if (db().get('SELECT id FROM agencies WHERE tag = ?', [tagClean])) return err(res, 409, 'TAG já usada');
    if (db().get('SELECT id FROM agencies WHERE owner_id = ?', [user.id])) return err(res, 400, 'Você já tem uma agência');
    const id = uuid.v4();
    db().run("INSERT INTO agencies (id, name, code, owner_id, description, commission_pct, total_earnings, tag, logo_url, whatsapp, status, criacao_em) VALUES (?, ?, ?, ?, ?, 10, 0, ?, ?, ?, 'pendente', datetime('now'))", [id, name, tagClean, user.id, sanitize(descricao, 300), tagClean, sanitize(logo || '', 300), sanitize(whatsapp || '', 40)]);
    security.createAlert(db(), 'agencia_solicitada', 'medio', 'Solicitação de agência: ' + name + ' [' + tagClean + '] aguardando aprovação', req.ip, user.id);
    return ok(res, { id, nome: name, tag: tagClean, status: 'pendente', message: 'Solicitação enviada! Sua agência será analisada por um admin em até 24h.' });
  } catch (e) { return err(res, 500, e.message); }
});

router.get('/agencias', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const ags = db().query("SELECT a.*, u.username as owner_name, (SELECT COUNT(*) FROM agency_members am WHERE am.agency_id = a.id AND am.status = 'ativo') as membros FROM agencies a JOIN users u ON a.owner_id = u.id WHERE a.status = 'aprovada' ORDER BY a.total_earnings DESC LIMIT 50");
    return ok(res, ags.map(a => ({ id: a.id, nome: a.name, tag: a.tag || a.code || '', logo: a.logo_url || '', donoId: a.owner_id, dono: a.owner_name, descricao: a.description || '', status: a.status, criacaoEm: a.criacao_em || a.created_at, membros: a.membros || 0, ganhosTotais: a.total_earnings || 0 })));
  } catch (e) { return err(res, 500, e.message); }
});

router.get('/agencias/minha', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    const a = db().get("SELECT a.*, u.username as owner_name FROM agencies a JOIN users u ON a.owner_id = u.id WHERE a.id = ?", [user.agency_id || '']);
    if (!a) return err(res, 404, 'Você não está em nenhuma agência');
    return ok(res, { id: a.id, nome: a.name, tag: a.tag || a.code || '', logo: a.logo_url || '', donoId: a.owner_id, dono: a.owner_name, descricao: a.description || '', status: a.status, motivo: a.motivo || '', criacaoEm: a.criacao_em || a.created_at, membros: (db().get("SELECT COUNT(*) as c FROM agency_members WHERE agency_id = ? AND status = 'ativo'", [a.id]) || {}).c || 0, ganhosTotais: a.total_earnings || 0 });
  } catch (e) { return err(res, 500, e.message); }
});

router.get('/agencias/pendentes', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user || !isAdmin(user)) return err(res, 403, 'Acesso restrito — somente admin');
    const ags = db().query("SELECT a.*, u.username as owner_name FROM agencies a JOIN users u ON a.owner_id = u.id WHERE a.status = 'pendente' ORDER BY a.created_at ASC LIMIT 100");
    return ok(res, ags.map(a => ({ id: a.id, nome: a.name, tag: a.tag || a.code || '', logo: a.logo_url || '', dono: a.owner_name, whatsapp: a.whatsapp || '', descricao: a.description || '', status: a.status, criacaoEm: a.criacao_em || a.created_at })));
  } catch (e) { return err(res, 500, e.message); }
});

router.put('/agencias/:id/aprovar', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user || !isAdmin(user)) return err(res, 403, 'Acesso restrito — somente admin');
    const a = db().get('SELECT * FROM agencies WHERE id = ?', [req.params.id]);
    if (!a) return err(res, 404, 'Agência não encontrada');
    if (a.status === 'aprovada') return err(res, 400, 'Agência já aprovada');
    db().run("UPDATE agencies SET status = 'aprovada', motivo = '' WHERE id = ?", [a.id]);
    db().run("UPDATE users SET agency_id = ?, agency_tag = ? WHERE id = ?", [a.id, a.tag || a.code || '', a.owner_id]);
    const hasMember = db().get('SELECT id FROM agency_members WHERE agency_id = ? AND user_id = ?', [a.id, a.owner_id]);
    if (!hasMember) db().run("INSERT INTO agency_members (id, agency_id, user_id, role, status) VALUES (?, ?, ?, 'owner', 'ativo')", [uuid.v4(), a.id, a.owner_id]);
    notif(db(), a.owner_id, 'agencia', '✅ Sua agência ' + a.name + ' foi APROVADA! TAG adicionada: [' + (a.tag || a.code || '') + ']');
    security.createAlert(db(), 'agencia_aprovada', 'baixo', 'Agência aprovada: ' + a.name, req.ip, user.id);
    return ok(res, { message: 'Agência aprovada!', nome: a.name, tag: a.tag || a.code || '' });
  } catch (e) { return err(res, 500, e.message); }
});

router.put('/agencias/:id/reprovar', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user || !isAdmin(user)) return err(res, 403, 'Acesso restrito — somente admin');
    const a = db().get('SELECT * FROM agencies WHERE id = ?', [req.params.id]);
    if (!a) return err(res, 404, 'Agência não encontrada');
    const motivo = sanitize((req.body && req.body.motivo) || 'Não atendeu os requisitos', 300);
    db().run("UPDATE agencies SET status = 'reprovada', motivo = ? WHERE id = ?", [motivo, a.id]);
    notif(db(), a.owner_id, 'agencia', '❌ Sua agência ' + a.name + ' foi reprovada. Motivo: ' + motivo);
    security.createAlert(db(), 'agencia_reprovada', 'medio', 'Agência reprovada: ' + a.name, req.ip, user.id);
    return ok(res, { message: 'Agência reprovada' });
  } catch (e) { return err(res, 500, e.message); }
});

router.delete('/agencias/:id', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    const a = db().get('SELECT * FROM agencies WHERE id = ?', [req.params.id]);
    if (!a) return err(res, 404, 'Agência não encontrada');
    if (String(a.owner_id) !== String(user.id) && !isAdmin(user)) return err(res, 403, 'Só o dono ou admin pode excluir');
    db().run('DELETE FROM agency_invites WHERE agency_id = ?', [a.id]);
    db().run('DELETE FROM agency_members WHERE agency_id = ?', [a.id]);
    db().run('DELETE FROM agencies WHERE id = ?', [a.id]);
    db().run("UPDATE users SET agency_id = '', agency_tag = '' WHERE agency_id = ?", [a.id]);
    return ok(res, { message: 'Agência excluída' });
  } catch (e) { return err(res, 500, e.message); }
});

// ============================================================
// JOGO E DINHEIRO (estilo Kwai)
// ============================================================
router.get('/carteira/saldo', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    const w = getWallet(db(), user.id);
    return ok(res, { reais: Number(w.balance || 0).toFixed(2), golds: user.coins || 0, diamantes: user.diamonds || 0 });
  } catch (e) { return err(res, 500, e.message); }
});

router.post('/tarefas/checkin', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    const today = todayKey();
    const st = getReward(db(), user.id);
    if (st.last_checkin === today) return err(res, 400, 'Check-in já feito hoje', 'ALREADY_DONE');
    // streak: dia seguinte = +1, senão reinicia
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const streak = st.checkin_last === yesterday ? (st.checkin_streak || 0) + 1 : 1;
    addGolds(db(), user.id, 475, 'checkin', 'Check-in diário (+475 K Golds)');
    let reais = 0;
    if (streak % 7 === 0) {
      reais = 15;
      addReais(db(), user.id, reais, 'checkin_premio', 'Prêmio de ' + streak + ' dias de check-in (R$ 15)');
      notif(db(), user.id, 'carteira', '🏆 ' + streak + ' dias de check-in! Você ganhou R$ 15,00!');
    }
    st.last_checkin = today; st.checkin_last = today; st.checkin_streak = streak;
    saveReward(db(), user.id, st);
    return ok(res, { granted: 475, golds: user.coins + 475, streak, premioReais: reais, message: reais > 0 ? 'Check-in +475 Golds e R$ 15,00!' : 'Check-in +475 K Golds! Dia ' + streak });
  } catch (e) { return err(res, 500, e.message); }
});

router.post('/tarefas/ver-video', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    const recent = db().get("SELECT id FROM wallet_transactions WHERE user_id = ? AND type = 'tarefa_video' AND created_at > datetime('now', '-60 seconds')", [user.id]);
    if (recent) return err(res, 429, 'Aguarde 1 minuto para o próximo vídeo', 'RATE');
    const golds = addGolds(db(), user.id, 306, 'tarefa_video', 'Assistiu 1 vídeo (+306 K Golds)');
    notif(db(), user.id, 'recompensa', '🎬 +306 K Golds por assistir vídeo!');
    return ok(res, { granted: 306, golds });
  } catch (e) { return err(res, 500, e.message); }
});

router.post('/tarefas/bonus-diario', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    const today = todayKey();
    const already = db().get("SELECT id FROM wallet_transactions WHERE user_id = ? AND type = 'bonus_diario' AND created_at LIKE ?", [user.id, today + '%']);
    if (already) return err(res, 400, 'Bônus diário já coletado', 'ALREADY_DONE');
    const golds = addGolds(db(), user.id, 50, 'bonus_diario', 'Bônus diário (+50 K Golds)');
    return ok(res, { granted: 50, golds });
  } catch (e) { return err(res, 500, e.message); }
});

router.get('/ranking/hora', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const ranking = db().query(`SELECT u.id, u.username, u.display_name, u.avatar_url, COALESCE(SUM(gt.total_coins), 0) as golds, COUNT(gt.id) as presentes
      FROM gift_transactions gt JOIN users u ON gt.receiver_id = u.id
      WHERE gt.created_at > datetime('now', '-1 hour')
      GROUP BY gt.receiver_id ORDER BY golds DESC LIMIT 10`);
    return ok(res, ranking.map((r, i) => ({ posicao: i + 1, id: r.id, username: r.username, nome: r.display_name, avatar: r.avatar_url, golds: r.golds || 0, presentes: r.presentes || 0 })));
  } catch (e) { return err(res, 500, e.message); }
});

router.post('/presentes/enviar', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    const { liveId, presenteId, quantidade } = req.body || {};
    const qty = Math.min(999, Math.max(1, parseInt(quantidade) || 1));
    const gift = db().get('SELECT * FROM gifts WHERE id = ? AND is_active = 1', [String(presenteId || '')]);
    if (!gift) return err(res, 404, 'Presente não encontrado');
    const live = db().get('SELECT * FROM lives WHERE id = ? AND status = ?', [String(liveId || ''), 'live']);
    if (!live) return err(res, 400, 'Live não está ativa');
    if (String(live.user_id) === String(user.id)) return err(res, 400, 'Você não pode enviar presente para si mesmo');
    const total = gift.price_coins * qty;
    if ((user.coins || 0) < total) return err(res, 400, 'K Golds insuficientes', 'NO_COINS');
    db().run('UPDATE users SET coins = coins - ? WHERE id = ?', [total, user.id]);
    db().run('UPDATE users SET coins = coins + ? WHERE id = ?', [total, live.user_id]);
    const txId = uuid.v4();
    db().run('INSERT INTO gift_transactions (id, live_id, sender_id, receiver_id, gift_id, quantity, total_coins, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [txId, live.id, user.id, live.user_id, gift.id, qty, total, '']);
    db().run('UPDATE families SET total_golds = total_golds + ? WHERE owner_id = ?', [total, live.user_id]);
    notif(db(), live.user_id, 'presente', '🎁 ' + (user.display_name || user.username) + ' enviou ' + qty + 'x ' + gift.name + ' na sua live!');
    return ok(res, { transactionId: txId, totalGolds: total, golds: user.coins - total, gift: { id: gift.id, nome: gift.name, quantidade: qty } });
  } catch (e) { return err(res, 500, e.message); }
});

router.get('/roleta/girar', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    const today = todayKey();
    const already = db().get("SELECT id FROM wallet_transactions WHERE user_id = ? AND type = 'roleta' AND created_at LIKE ?", [user.id, today + '%']);
    if (already) return err(res, 400, 'Roleta já girada hoje', 'ALREADY_DONE');
    const golds = 10 + Math.floor(Math.random() * 191);
    const total = addGolds(db(), user.id, golds, 'roleta', 'Roleta diária SORTEAR (+' + golds + ' K Golds)');
    notif(db(), user.id, 'recompensa', '🎡 Roleta: +' + golds + ' K Golds!');
    return ok(res, { granted: golds, golds: total });
  } catch (e) { return err(res, 500, e.message); }
});

router.post('/bau/abrir', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = auth(db(), req);
    if (!user) return err(res, 401, 'Não autenticado');
    const last = db().get("SELECT id FROM wallet_transactions WHERE user_id = ? AND type = 'bau' ORDER BY created_at DESC LIMIT 1", [user.id]);
    if (last) {
      const lastAt = new Date(last.created_at.replace(' ', 'T') + 'Z').getTime();
      if (Date.now() - lastAt < 30 * 60000) return err(res, 429, 'Baú disponível a cada 30 minutos', 'COOLDOWN');
    }
    const golds = addGolds(db(), user.id, 100, 'bau', 'Baú do desafio (+100 K Golds)');
    return ok(res, { granted: 100, golds });
  } catch (e) { return err(res, 500, e.message); }
});

let db;
module.exports = function (database) {
  db = () => database.getInstance();
  return router;
};

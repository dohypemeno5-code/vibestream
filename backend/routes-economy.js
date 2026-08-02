/**
 * VibeStream — Economia virtual: presentes, moedas/diamantes, VIP e recargas.
 * Toda alteração de saldo acontece NO SERVIDOR (nunca confia no app).
 * Logs completos em wallet_transactions + gift_transactions.
 */
const express = require('express');
const router = express.Router();
const uuid = require('uuid');
const security = require('./security');

function sanitize(str) {
  return String(str || '').replace(/['"\\;()\-\-]/g, '').replace(/<[^>]*>/g, '').slice(0, 200);
}

function notif(db, userId, type, text) {
  try {
    db.run("INSERT INTO notifications (id, user_id, actor_id, type, text) VALUES (?, ?, 'sistema', ?, ?)",
      [uuid.v4(), userId, String(type).slice(0, 30), String(text).slice(0, 200)]);
  } catch (e) {}
}

function logTx(db, userId, type, amount, description, refId) {
  try {
    db.run("INSERT INTO wallet_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)",
      [uuid.v4(), userId, String(type).slice(0, 30), Number(amount || 0), String(description || '').slice(0, 200), refId || '']);
  } catch (e) {}
}

const VIP_PLANS = [
  { id: 'vip1', name: 'VIP Bronze', price_coins: 500, days: 30, perks: ['Selo VIP', 'Molduras exclusivas', 'Badge de perfil'] },
  { id: 'vip2', name: 'VIP Prata', price_coins: 1500, days: 30, perks: ['Selo VIP', 'Molduras premium', 'Prioridade no chat', 'Emblemas animados'] },
  { id: 'vip3', name: 'VIP Ouro', price_coins: 4000, days: 30, perks: ['Selo VIP dourado', 'Molduras exclusivas animadas', 'Destaque no perfil', 'Efeitos especiais em lives', 'Suporte prioritário'] }
];

const RECHARGE_PACKAGES = [
  { id: 'p1', coins: 100, price: 4.90, bonus: 0, label: '100 moedas' },
  { id: 'p2', coins: 500, price: 19.90, bonus: 50, label: '500 moedas +50 bônus' },
  { id: 'p3', coins: 1200, price: 39.90, bonus: 200, label: '1200 moedas +200 bônus' },
  { id: 'p4', coins: 3000, price: 89.90, bonus: 600, label: '3000 moedas +600 bônus' },
  { id: 'p5', coins: 7000, price: 179.90, bonus: 2000, label: '7000 moedas +2000 bônus' },
  { id: 'p6', coins: 15000, price: 349.90, bonus: 5000, label: '15000 moedas +5000 bônus' }
];

module.exports = function (database, firewall) {
  const db = () => database.getInstance();

  // ============================================================
  // PRESENTES
  // ============================================================
  router.get('/gifts', (req, res) => {
    const gifts = db().query('SELECT id, name, image_url, price_coins, price_diamonds, category, animation_url FROM gifts WHERE is_active = 1 ORDER BY price_coins ASC');
    res.json({ gifts });
  });

  router.post('/gifts/send', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const { giftId, liveId, quantity, message } = req.body;
    const qty = Math.min(Math.max(parseInt(quantity) || 1, 1), 99);
    const rl = security.rateLimit(db(), 'gift:' + req.session.userId, 60, 10);
    if (rl.blocked) return res.status(429).json({ error: 'Muitos presentes em pouco tempo — aguarde um instante' });

    const gift = db().get('SELECT * FROM gifts WHERE id = ? AND is_active = 1', [giftId]);
    if (!gift) return res.status(404).json({ error: 'Presente não encontrado' });
    const live = db().get('SELECT id, user_id, title, status FROM lives WHERE id = ? AND status = ?', [liveId, 'live']);
    if (!live) return res.status(404).json({ error: 'Live não está ativa' });
    if (String(live.user_id) === String(req.session.userId)) return res.status(400).json({ error: 'Você não pode enviar presente para si mesmo' });

    const total = gift.price_coins * qty;
    const sender = db().get('SELECT coins FROM users WHERE id = ?', [req.session.userId]);
    if (!sender || (sender.coins || 0) < total) {
      return res.status(400).json({ error: 'Moedas insuficientes — faça uma recarga', code: 'NO_COINS' });
    }

    // Servidor movimenta as moedas (nunca o app)
    db().run('UPDATE users SET coins = coins - ? WHERE id = ?', [total, req.session.userId]);
    db().run('UPDATE users SET coins = coins + ? WHERE id = ?', [total, live.user_id]);
    const txId = uuid.v4();
    db().run("INSERT INTO gift_transactions (id, live_id, sender_id, receiver_id, gift_id, quantity, total_coins, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [txId, liveId, req.session.userId, live.user_id, giftId, qty, total, sanitize(message)]);
    logTx(db(), req.session.userId, 'gift_out', -total, 'Presente ' + gift.name + ' x' + qty + ' em ' + (live.title || 'live'), txId);
    logTx(db(), live.user_id, 'gift_in', total, 'Presente ' + gift.name + ' x' + qty + ' de ' + (sender.username || ''), txId);
    notif(db(), live.user_id, 'gift', '🎁 Você recebeu ' + gift.name + ' x' + qty + ' em uma live!');

    try {
      const liveRooms = require('./live-rooms');
      const sUser = db().get('SELECT username, display_name, avatar_url FROM users WHERE id = ?', [req.session.userId]);
      liveRooms.broadcast(liveId, {
        type: 'live:gift', liveId, gift: { name: gift.name, image_url: gift.image_url, quantity: qty, total_coins: total },
        user: { username: sUser.username, display_name: sUser.display_name, avatar_url: sUser.avatar_url }
      });
    } catch (e) {}

    res.status(201).json({ success: true, transactionId: txId, totalCoins: total, senderCoins: sender.coins - total, gift: { name: gift.name, image_url: gift.image_url, quantity: qty } });
  });

  router.get('/gifts/history', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const sent = db().query(`
      SELECT gt.*, g.name as gift_name, g.image_url, l.title as live_title, ru.username as receiver_name
      FROM gift_transactions gt JOIN gifts g ON gt.gift_id = g.id LEFT JOIN lives l ON gt.live_id = l.id LEFT JOIN users ru ON gt.receiver_id = ru.id
      WHERE gt.sender_id = ? ORDER BY gt.created_at DESC LIMIT 50`, [req.session.userId]);
    const received = db().query(`
      SELECT gt.*, g.name as gift_name, g.image_url, l.title as live_title, su.username as sender_name
      FROM gift_transactions gt JOIN gifts g ON gt.gift_id = g.id LEFT JOIN lives l ON gt.live_id = l.id LEFT JOIN users su ON gt.sender_id = su.id
      WHERE gt.receiver_id = ? ORDER BY gt.created_at DESC LIMIT 50`, [req.session.userId]);
    res.json({ sent, received });
  });

  // ============================================================
  // VIP
  // ============================================================
  router.get('/vip/plans', (req, res) => {
    let current = null;
    if (req.session?.userId) {
      current = db().get('SELECT vip_tier, vip_until, coins FROM users WHERE id = ?', [req.session.userId]);
    }
    res.json({ plans: VIP_PLANS, current: current ? { vip_tier: current.vip_tier || '', vip_until: current.vip_until || '', coins: current.coins || 0 } : null });
  });

  router.post('/vip/activate', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const plan = VIP_PLANS.find(p => p.id === req.body.planId);
    if (!plan) return res.status(400).json({ error: 'Plano VIP inválido' });
    const user = db().get('SELECT coins FROM users WHERE id = ?', [req.session.userId]);
    if (!user || (user.coins || 0) < plan.price_coins) {
      return res.status(400).json({ error: 'Moedas insuficientes — faça uma recarga', code: 'NO_COINS' });
    }
    const now = Date.now();
    const current = db().get('SELECT vip_until FROM users WHERE id = ?', [req.session.userId]);
    const base = (current && current.vip_until && new Date(current.vip_until).getTime() > now) ? new Date(current.vip_until).getTime() : now;
    const until = new Date(base + plan.days * 86400000).toISOString();
    db().run('UPDATE users SET coins = coins - ?, vip_tier = ?, vip_until = ? WHERE id = ?', [plan.price_coins, plan.id, until, req.session.userId]);
    logTx(db(), req.session.userId, 'vip', -plan.price_coins, 'Ativação ' + plan.name + ' (' + plan.days + ' dias)', plan.id);
    notif(db(), req.session.userId, 'vip', '👑 ' + plan.name + ' ativado até ' + until.slice(0, 10) + '!');
    res.status(201).json({ success: true, vip: { tier: plan.id, until, name: plan.name }, coins: user.coins - plan.price_coins });
  });

  // ============================================================
  // RECARGA DE MOEDAS (confirmação segura no servidor)
  // ============================================================
  router.get('/recharge/packages', (req, res) => res.json({ packages: RECHARGE_PACKAGES }));

  router.get('/recharge/history', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    res.json({ orders: db().query('SELECT * FROM recharge_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.session.userId]) });
  });

  router.post('/recharge/create', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const pkg = RECHARGE_PACKAGES.find(p => p.id === req.body.packageId);
    if (!pkg) return res.status(400).json({ error: 'Pacote inválido' });
    const method = ['pix', 'cartao', 'boleto'].includes(req.body.method) ? req.body.method : 'pix';
    const rl = security.rateLimit(db(), 'recharge:' + req.session.userId, 300, 10);
    if (rl.blocked) return res.status(429).json({ error: 'Muitas recargas — aguarde um instante' });
    const id = uuid.v4();
    db().run("INSERT INTO recharge_orders (id, user_id, package_id, coins, bonus, amount, method, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente')",
      [id, req.session.userId, pkg.id, pkg.coins, pkg.bonus || 0, pkg.price, method]);
    logTx(db(), req.session.userId, 'recharge_request', 0, 'Pedido de recarga ' + pkg.label + ' (R$ ' + pkg.price.toFixed(2) + ')', id);
    res.status(201).json({ orderId: id, status: 'pendente', amount: pkg.price, message: 'Pedido criado — confirme o pagamento para receber as moedas' });
  });

  router.post('/recharge/confirm', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const order = db().get('SELECT * FROM recharge_orders WHERE id = ? AND user_id = ?', [req.body.orderId, req.session.userId]);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (order.status !== 'pendente') return res.status(400).json({ error: 'Pedido já processado', code: 'ALREADY_PROCESSED' });
    // Confirmação de pagamento simulada — em produção, validar webhook do gateway
    db().run("UPDATE recharge_orders SET status = 'pago', paid_at = datetime('now') WHERE id = ?", [order.id]);
    const totalCoins = order.coins + (order.bonus || 0);
    db().run('UPDATE users SET coins = coins + ? WHERE id = ?', [totalCoins, order.user_id]);
    logTx(db(), order.user_id, 'recharge', totalCoins, 'Recarga confirmada: ' + totalCoins + ' moedas (R$ ' + Number(order.amount).toFixed(2) + ')', order.id);
    notif(db(), order.user_id, 'recharge', '💰 ' + totalCoins + ' moedas adicionadas à sua conta!');
    const coins = db().get('SELECT coins FROM users WHERE id = ?', [order.user_id]);
    res.status(201).json({ success: true, coinsAdded: totalCoins, balance: coins.coins, message: 'Pagamento confirmado! Moedas creditadas.' });
  });

  // ============================================================
  // SALDO / CARTEIRA (moedas + diamantes + carteira R$)
  // ============================================================
  router.get('/economy/me', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
    const u = db().get('SELECT username, coins, diamonds, vip_tier, vip_until FROM users WHERE id = ?', [req.session.userId]);
    const w = db().get('SELECT balance, pending FROM wallets WHERE user_id = ?', [req.session.userId]) || { balance: 0, pending: 0 };
    res.json({ coins: u.coins || 0, diamonds: u.diamonds || 0, wallet: { balance: w.balance || 0, pending: w.pending || 0 }, vip: { tier: u.vip_tier || '', until: u.vip_until || '' }, username: u.username });
  });


  // ============================================================
  // K GOLDS — Carteira, check-in, assistir, conversão, ranking
  // (resposta padrão: JSON puro { success, data })
  // ============================================================
  const GOLD_CHECKIN = 475;      // check-in diário
  const GOLD_WATCH_60S = 306;    // 1 min assistindo
  const GOLD_CONVERSION = 10000; // 10.000 Golds = R$ 1,00
  const WATCH_DAILY_CAP = 3600;  // máx. 60 min/dia contam

  function json(res, status, data) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(status).json({ success: true, data });
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function getRewardState(db, userId) {
    const st = db.get('SELECT * FROM user_rewards WHERE user_id = ?', [userId]);
    if (!st) return { watch_seconds: 0, watch_day: '', last_checkin: '' };
    return st;
  }

  function saveRewardState(db, userId, state) {
    db.run(`INSERT INTO user_rewards (user_id, watch_seconds, watch_day, last_checkin, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET watch_seconds = excluded.watch_seconds, watch_day = excluded.watch_day, last_checkin = excluded.last_checkin, updated_at = datetime('now')`,
      [userId, state.watch_seconds || 0, state.watch_day || '', state.last_checkin || '']);
  }

  // Carteira completa + ranking por hora
  router.get('/economy/wallet', (req, res) => {
    if (!req.session.userId) return json(res, 401, { error: 'Não autenticado' });
    const u = db().get('SELECT username, display_name, coins, diamonds, vip_tier, vip_until FROM users WHERE id = ?', [req.session.userId]);
    const w = db().get('SELECT balance, pending FROM wallets WHERE user_id = ?', [req.session.userId]) || { balance: 0, pending: 0 };
    const st = getRewardState(db(), req.session.userId);
    const today = todayKey();
    const watchToday = st.watch_day === today ? (st.watch_seconds || 0) : 0;
    const checkinDone = st.last_checkin === today;
    const ranking = hourlyRanking(db());
    const gifts = db().query('SELECT id, name, image_url, price_coins, price_diamonds, category FROM gifts WHERE is_active = 1 ORDER BY price_coins ASC');
    return json(res, 200, {
      golds: u.coins || 0,
      diamonds: u.diamonds || 0,
      wallet: { balance: Number(w.balance || 0).toFixed(2), pending: Number(w.pending || 0).toFixed(2) },
      vip: { tier: u.vip_tier || '', until: u.vip_until || '' },
      checkin: { done: !!checkinDone, reward: GOLD_CHECKIN },
      watch: { secondsToday: watchToday, rewardPerMinute: GOLD_WATCH_60S, cap: WATCH_DAILY_CAP },
      conversion: { rate: GOLD_CONVERSION, value: 1 },
      ranking,
      gifts,
      username: u.username,
      displayName: u.display_name
    });
  });

  // Check-in diário: +475 Golds (uma vez por dia)
  router.post('/economy/checkin', (req, res) => {
    if (!req.session.userId) return json(res, 401, { error: 'Não autenticado' });
    const st = getRewardState(db(), req.session.userId);
    const today = todayKey();
    if (st.last_checkin === today) return json(res, 400, { error: 'Check-in já feito hoje', alreadyDone: true });
    db().run('UPDATE users SET coins = coins + ? WHERE id = ?', [GOLD_CHECKIN, req.session.userId]);
    st.last_checkin = today;
    saveRewardState(db(), req.session.userId, st);
    logTx(db(), req.session.userId, 'checkin', GOLD_CHECKIN, 'Check-in diário (+' + GOLD_CHECKIN + ' K Golds)');
    notif(db(), req.session.userId, 'recompensa', '✅ Check-in concluído! +' + GOLD_CHECKIN + ' K Golds');
    const u = db().get('SELECT coins FROM users WHERE id = ?', [req.session.userId]);
    return json(res, 200, { granted: GOLD_CHECKIN, golds: u.coins, checkinDone: true });
  });

  // Recompensa por tempo assistindo: a cada 60s = +306 Golds (máx. 60 min/dia)
  router.post('/economy/watch', (req, res) => {
    if (!req.session.userId) return json(res, 401, { error: 'Não autenticado' });
    const seconds = Math.min(3600, Math.max(0, parseInt(req.body && req.body.seconds) || 0));
    const today = todayKey();
    const st = getRewardState(db(), req.session.userId);
    if (st.watch_day !== today) { st.watch_day = today; st.watch_seconds = 0; }
    let gained = 0;
    const prev = st.watch_seconds || 0;
    let next = Math.min(WATCH_DAILY_CAP, prev + seconds);
    // Concede a cada 60s completos ainda não pagos
    const chunks = Math.floor(next / 60) - Math.floor(prev / 60);
    if (chunks > 0) {
      gained = chunks * GOLD_WATCH_60S;
      db().run('UPDATE users SET coins = coins + ? WHERE id = ?', [gained, req.session.userId]);
      logTx(db(), req.session.userId, 'watch', gained, 'Assistindo vídeos (' + chunks + ' min) +' + gained + ' K Golds');
      if (chunks >= 1) notif(db(), req.session.userId, 'recompensa', '🎬 Você ganhou +' + gained + ' K Golds assistindo vídeos!');
    }
    st.watch_seconds = next;
    saveRewardState(db(), req.session.userId, st);
    const u = db().get('SELECT coins FROM users WHERE id = ?', [req.session.userId]);
    return json(res, 200, { gained, golds: u.coins, secondsToday: next, capReached: next >= WATCH_DAILY_CAP });
  });

  // Conversão: 10.000 Golds = R$ 1,00 na carteira
  router.post('/economy/convert', (req, res) => {
    if (!req.session.userId) return json(res, 401, { error: 'Não autenticado' });
    const golds = Math.floor(parseInt((req.body && req.body.golds) || 0) / GOLD_CONVERSION) * GOLD_CONVERSION;
    if (golds < GOLD_CONVERSION) return json(res, 400, { error: 'Mínimo de ' + GOLD_CONVERSION + ' K Golds para converter' });
    const u = db().get('SELECT coins FROM users WHERE id = ?', [req.session.userId]);
    if ((u.coins || 0) < golds) return json(res, 400, { error: 'K Golds insuficientes' });
    const reais = golds / GOLD_CONVERSION;
    db().run('UPDATE users SET coins = coins - ? WHERE id = ?', [golds, req.session.userId]);
    const w = db().get('SELECT balance FROM wallets WHERE user_id = ?', [req.session.userId]);
    if (w) db().run('UPDATE wallets SET balance = balance + ?, updated_at = datetime(\'now\') WHERE user_id = ?', [reais, req.session.userId]);
    else db().run("INSERT INTO wallets (user_id, balance, pending) VALUES (?, ?, 0)", [req.session.userId, reais]);
    logTx(db(), req.session.userId, 'conversao', -golds, 'Conversão ' + golds + ' K Golds → R$ ' + reais.toFixed(2));
    db().run("INSERT INTO wallet_transactions (id, user_id, type, amount, description, status) VALUES (?, ?, 'ganho', ?, 'Conversão de K Golds para carteira', 'concluido')",
      [uuid.v4(), req.session.userId, reais]);
    notif(db(), req.session.userId, 'carteira', '💰 ' + golds + ' K Golds convertidos em R$ ' + reais.toFixed(2) + '!');
    const u2 = db().get('SELECT coins FROM users WHERE id = ?', [req.session.userId]);
    const w2 = db().get('SELECT balance FROM wallets WHERE user_id = ?', [req.session.userId]);
    return json(res, 200, { converted: golds, reais, golds: u2.coins, balance: Number(w2.balance || 0).toFixed(2) });
  });

  // Ranking por hora: quem recebeu mais presentes na última hora
  router.get('/economy/ranking', (req, res) => {
    return json(res, 200, { ranking: hourlyRanking(db()) });
  });

  // Bônus diário: bonus50, bonus30, bau (+100), roleta (10–200) — uma vez por dia cada
  router.post('/economy/bonus', (req, res) => {
    if (!req.session.userId) return json(res, 401, { error: 'Não autenticado' });
    const key = String((req.body && req.body.key) || '').slice(0, 20);
    const map = { bonus50: 50, bonus30: 30, bau: 100, roleta: () => 10 + Math.floor(Math.random() * 191) };
    if (!map[key]) return json(res, 400, { error: 'Bônus inválido' });
    const amount = typeof map[key] === 'function' ? map[key]() : map[key];
    const today = new Date().toISOString().slice(0, 10);
    const already = db().get("SELECT id FROM wallet_transactions WHERE user_id = ? AND type = ? AND created_at LIKE ?",
      [req.session.userId, 'bonus_' + key, today + '%']);
    if (already) return json(res, 400, { error: 'Bônus já coletado hoje', alreadyDone: true });
    db().run('UPDATE users SET coins = coins + ? WHERE id = ?', [amount, req.session.userId]);
    logTx(db(), req.session.userId, 'bonus_' + key, amount, 'Bônus diário ' + key + ' (+' + amount + ' K Golds)');
    const u = db().get('SELECT coins FROM users WHERE id = ?', [req.session.userId]);
    return json(res, 200, { granted: amount, golds: u.coins });
  });

  // Recompensa única por ativar notificações: +1500 K Golds
  router.post('/economy/notif-reward', (req, res) => {
    if (!req.session.userId) return json(res, 401, { error: 'Não autenticado' });
    const already = db().get("SELECT id FROM wallet_transactions WHERE user_id = ? AND type = 'notif_reward'", [req.session.userId]);
    if (already) return json(res, 400, { error: 'Recompensa já resgatada', alreadyDone: true });
    db().run('UPDATE users SET coins = coins + 1500 WHERE id = ?', [req.session.userId]);
    logTx(db(), req.session.userId, 'notif_reward', 1500, 'Ativação de notificações (+1500 K Golds)');
    const u = db().get('SELECT coins FROM users WHERE id = ?', [req.session.userId]);
    return json(res, 200, { granted: 1500, golds: u.coins });
  });

  function hourlyRanking(db) {
    try {
      return db.query(`
        SELECT u.id, u.username, u.display_name, u.avatar_url,
               COALESCE(SUM(gt.total_coins), 0) as hour_golds,
               COUNT(gt.id) as gifts_count
        FROM gift_transactions gt
        JOIN users u ON gt.receiver_id = u.id
        WHERE gt.created_at > datetime('now', '-1 hour')
        GROUP BY gt.receiver_id
        ORDER BY hour_golds DESC
        LIMIT 10`);
    } catch (e) {
      return [];
    }
  }

  return router;
};

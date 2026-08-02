// ============================================================
// VIBESTREAM — SISTEMA DE MOEDAS + SAQUE PIX (localStorage)
// Sem chamadas de rede: funciona offline e no GitHub Pages.
// Chaves: vibe_coins, vibe_history, vibe_checkin, vibe_pix_requests,
//         vibe_watched (dramas assistidos por dia)
// ============================================================
(function () {
  const KEY = 'vibe_coins';
  const HIST = 'vibe_history';
  const CHECKIN = 'vibe_checkin';
  const PIX = 'vibe_pix_requests';
  const WATCHED = 'vibe_watched';

  function load(k, def) {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v === null || v === undefined ? def : v;
    } catch (e) { return def; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  const todayKey = () => new Date().toISOString().slice(0, 10);

  function balance() { return Math.max(0, Number(load(KEY, 0)) || 0); }
  function setBalance(n) { save(KEY, Math.max(0, Math.round(n))); return balance(); }

  function history() { return load(HIST, []); }
  function pushHist(n, reason) {
    const h = history();
    h.unshift({ n: Math.round(n), reason: String(reason || ''), at: new Date().toISOString() });
    save(HIST, h.slice(0, 300));
  }

  function add(n, reason) {
    const next = balance() + Math.round(n);
    setBalance(next);
    pushHist(n, reason);
    return balance();
  }

  // Retorna true se conseguiu gastar
  function spend(n, reason) {
    const need = Math.round(n);
    if (balance() < need) return false;
    setBalance(balance() - need);
    pushHist(-need, reason);
    return true;
  }

  // Check-in diário: +50 (uma vez por dia)
  function checkin() {
    const ck = load(CHECKIN, {});
    const day = todayKey();
    if (ck[day]) return { done: true, granted: 0 };
    ck[day] = true;
    save(CHECKIN, ck);
    add(50, 'Check-in diário');
    return { done: false, granted: 50 };
  }

  // Assistir 3 dramas por dia = +30
  function watchVideo(videoId, tag) {
    const w = load(WATCHED, {});
    const day = todayKey();
    const dayList = w[day] || [];
    const isDrama = /drama|farol|novela|dorama/i.test(String(tag || ''));
    if (!isDrama) return { granted: 0, progress: dayList.length };
    if (dayList.includes(String(videoId))) return { granted: 0, progress: dayList.length };
    dayList.push(String(videoId));
    w[day] = dayList;
    save(WATCHED, w);
    if (dayList.length % 3 === 0) {
      add(30, 'Assistir 3 dramas');
      return { granted: 30, progress: dayList.length };
    }
    return { granted: 0, progress: dayList.length };
  }

  // Jogar 1 jogo = +20 (chamado no fim da partida)
  function gameReward() {
    add(20, 'Jogar 1 jogo');
    return balance();
  }

  // Convite = +100 (com limite anti-spam: 5 convites/dia)
  function inviteReward() {
    const key = 'vibe_invites_' + todayKey();
    const n = Number(load(key, 0)) || 0;
    if (n >= 5) return { granted: 0, limit: true };
    save(key, n + 1);
    add(100, 'Convidar amigo');
    return { granted: 100, limit: false };
  }

  // ---------- SAQUE PIX ----------
  // 1000 moedas = R$ 10,00 (mínimo)
  const PIX_RATE = 100; // moedas por real
  const PIX_MIN_COINS = 1000;

  function pixRequest(chave, coins, metodo) {
    const valor = Number(coins) || 0;
    if (valor < PIX_MIN_COINS) return { ok: false, error: 'Mínimo de ' + PIX_MIN_COINS + ' moedas (R$ ' + (PIX_MIN_COINS / PIX_RATE) + ')' };
    if (!chave || String(chave).trim().length < 4) return { ok: false, error: 'Informe uma chave PIX válida' };
    if (balance() < valor) return { ok: false, error: 'Saldo insuficiente' };
    const req = {
      id: 'pix_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
      chave: String(chave).trim(),
      coins: valor,
      reais: valor / PIX_RATE,
      metodo: metodo || 'pix',
      status: 'pending',
      criadoEm: new Date().toISOString()
    };
    spend(valor, 'Saque PIX (R$ ' + req.reais.toFixed(2) + ') — pendente');
    const list = pixRequests();
    list.unshift(req);
    save(PIX, list);
    return { ok: true, request: req };
  }

  function pixRequests() { return load(PIX, []); }
  function setPixStatus(id, status) {
    const list = pixRequests().map(r => r.id === id ? Object.assign({}, r, { status: status || r.status }) : r);
    save(PIX, list);
    return list;
  }
  function pixTotalPending() {
    return pixRequests().filter(r => r.status === 'pending').reduce((s, r) => s + r.reais, 0);
  }

  // ---------- EPISÓDIOS DESBLOQUEADOS ----------
  const EP_KEY = 'unlockedEpisodes';
  function unlockedEps() { return load(EP_KEY, []); }
  function isEpUnlocked(key) { return unlockedEps().some(x => String(x) === String(key)); }
  function unlockEp(key, coinsCost) {
    const list = unlockedEps();
    if (list.some(x => String(x) === String(key))) return { ok: true, already: true };
    if (!spend(coinsCost || 100, 'Desbloquear episódio ' + key)) return { ok: false, error: 'Moedas insuficientes' };
    list.push(String(key));
    save(EP_KEY, list);
    return { ok: true, already: false };
  }

  // ---------- LOJA DE MOEDAS (PIX fictício) ----------
  const PACKS = [
    { coins: 100, price: 1.90 },
    { coins: 550, price: 8.90 },
    { coins: 1200, price: 17.90 }
  ];
  function buyPack(coins) {
    const p = PACKS.find(x => x.coins === coins);
    if (!p) return { ok: false, error: 'Pacote inválido' };
    const order = { id: 'pack_' + Date.now(), coins: p.coins, price: p.price, status: 'pendente', at: new Date().toISOString() };
    const orders = load('vibe_coin_orders', []);
    orders.unshift(order);
    save('vibe_coin_orders', orders);
    return { ok: true, order };
  }
  function coinOrders() { return load('vibe_coin_orders', []); }

  // Header global: pinta o chip de saldo em qualquer página
  function paintChips() {
    document.querySelectorAll('[data-coin-chip]').forEach(el => {
      el.textContent = balance().toLocaleString('pt-BR');
    });
    const badge = document.getElementById('coinHeaderBadge');
    if (badge) badge.textContent = balance().toLocaleString('pt-BR');
  }

  const api = {
    balance, add, spend, history, checkin, watchVideo, gameReward, inviteReward,
    pixRequest, pixRequests, setPixStatus, pixTotalPending,
    PIX_RATE, PIX_MIN_COINS, PACKS, buyPack, coinOrders,
    unlockedEps, isEpUnlocked, unlockEp,
    paintChips
  };
  window.VS_Coins = api;
  window.addEventListener('load', () => api.paintChips());
})();

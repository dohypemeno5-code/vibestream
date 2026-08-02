/* ============================================================
   VibeStream - Rede Social Completa
   ============================================================ */

// URL base da API: usa override opcional (VITE_API_URL), senão mesma origem do site
const API = (window.__VITE_API_URL || window.location.origin) + '/api';
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
let currentUser = null;
let currentPage = 'Feed';
let currentPostPage = 1;
let searchTimeout = null;
let currentChatId = null;
let feedLoading = false;
let pendingMedia = null;
let chatPollTimer = null;
let notifTimer = null;
let liveWs = null;
let liveRoomState = { liveId: null, isStreamer: false, cameraStream: null, frameTimer: null, heartTimer: null };
let birthValid = null;

// ============================================================
// SPLASH & INIT
// ============================================================
// Boot: nunca deixa a tela "Conectando pessoas" presa
// 1) tenta carregar o usuário; 2) esconde o splash; 3) abre a tela principal
let bootStarted = false;
function finishBoot(splash, main) {
  if (splash) splash.classList.add('hidden');
  if (main) main.classList.remove('hidden');
}
function retryBoot() {
  const err = document.getElementById('splashError');
  if (err) err.classList.add('hidden');
  const st = document.getElementById('splashStatus');
  if (st) { st.textContent = 'Conectando ao servidor…'; st.style.color = '#8a8aa3'; }
  bootStarted = false;
  bootApp();
}
async function bootApp() {
  if (bootStarted) return;
  bootStarted = true;
  console.log('[BOOT] iniciando conexão com a API em', API);
  const splash = document.getElementById('splash');
  const main = document.getElementById('mainContent');
  const status = document.getElementById('splashStatus');
  const errBox = document.getElementById('splashError');
  const setStatus = (t, color) => { if (status) { status.textContent = t; status.style.color = color || '#8a8aa3'; } };
  const showErr = (msg) => {
    if (errBox) {
      const p = errBox.querySelector('p');
      if (p) p.textContent = msg;
      errBox.classList.remove('hidden');
    }
    console.error('[BOOT] falha na conexão:', msg);
  };
  // Segurança: nunca deixa a tela "Conectando pessoas" presa além de 10s
  const forceTimer = setTimeout(() => { console.warn('[BOOT] timeout forçado — abrindo app'); finishBoot(splash, main); }, 10000);
  try {
    setStatus('Verificando conexão…');
    const user = await Promise.race([
      checkAuth(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('boot_timeout')), 8000))
    ]);
    clearTimeout(forceTimer);
    setStatus('Conectado! Abrindo o VibeStream…', '#10b981');
    finishBoot(splash, main);
    initApp(user);
  } catch (e) {
    clearTimeout(forceTimer);
    const isTimeout = e && (e.message === 'boot_timeout' || e.message === 'Servidor sem resposta (timeout)' || e.message === 'timeout');
    if (isTimeout) {
      setStatus('Servidor demorou para responder', '#f59e0b');
      showErr('O servidor está demorando para responder. Tente novamente em instantes.');
    } else {
      setStatus('Sem conexão', '#ff6b6b');
      showErr('Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.');
    }
    bootStarted = false; // permite "Tentar novamente"
  }
}
(async function () { bootApp(); })();

async function initApp(user) {
  try {
    if (user) { loadFeed(); loadLives(); loadChats(); loadNotifications(); }
    else {
      loadFeed();
      loadLives();
    }
    notifTimer = setInterval(() => { try { loadNotifications(); } catch (e) {} }, 15000);
    // Rolagem infinita no feed
    const feedPage = document.getElementById('pageFeed');
    if (feedPage) feedPage.addEventListener('scroll', () => {
      if (feedPage.scrollTop + feedPage.clientHeight >= feedPage.scrollHeight - 300) loadFeed(false);
    });
    // Boas-vindas com IA/animacão após login
    if (user) maybeShowWelcome(user);
    // Tracker de K Golds por tempo assistindo
    startWatchTracker();
    // Popup ative notificações (uma vez por sessão)
    if (user) showNotifRewardPopupOnce();
  } catch (e) {
    showConnectionBanner();
  }
}

function showConnectionBanner() {
  let b = document.getElementById('connBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'connBanner';
    b.className = 'conn-banner';
    b.innerHTML = '⚠️ Sem conexão com o servidor. <button onclick="retryConnection()">Tentar novamente</button>';
    document.body.insertBefore(b, document.body.firstChild);
  }
  b.classList.add('show');
}
async function retryConnection() {
  const b = document.getElementById('connBanner');
  if (b) b.classList.remove('show');
  try {
    const user = await checkAuth();
    await initApp(user);
  } catch (e) { showConnectionBanner(); }
}

// ============================================================
// TOAST & MODAL
// ============================================================
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 3000);
}
function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  closeLiveRoomCleanup();
}

// ============================================================
// API HELPER
// ============================================================
async function api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const finalOpts = { headers: { 'Content-Type': 'application/json', ...opts.headers }, credentials: 'include', ...opts };
  try {
    const res = await fetch(API + path, { ...finalOpts, signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) {
      console.error('API non-JSON:', text.substring(0,100));
      throw new Error('Erro de conexão com o servidor');
    }
    if (!res.ok) { const err = new Error(data.error || 'Erro na requisição'); err.data = data; err.status = res.status; throw err; }
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      showToast('Servidor demorou para responder — tente novamente', 'error');
      throw new Error('Servidor sem resposta (timeout)');
    }
    if (err && err.message === 'Failed to fetch') {
      showToast('Sem conexão com o servidor', 'error');
      throw new Error('Sem conexão com o servidor');
    }
    if (!err.message.includes('Erro na requisição') && !err.message.includes('conexão') && !err.message.includes('timeout') && !err.message.includes('Sem conexão')) {
      showToast(err.message, 'error');
    }
    throw err;
  }
}

// ============================================================
// THEME
// ============================================================
function toggleTheme() {
  document.body.classList.toggle('light-theme');
  const btn = document.getElementById('themeToggle');
  btn.textContent = document.body.classList.contains('light-theme') ? '☀️' : '🌙';
  localStorage.setItem('vibestream_theme', document.body.classList.contains('light-theme') ? 'light' : 'dark');
}
if (localStorage.getItem('vibestream_theme') === 'light') {
  document.body.classList.add('light-theme');
  document.getElementById('themeToggle').textContent = '☀️';
}

// ============================================================
// PAGES
// ============================================================
function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page' + page).classList.add('active');
  document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');
  if (page === 'Feed') loadFeed();
  if (page === 'Lives') loadLives();
  if (page === 'Chat') loadChats();
  if (page === 'Profile') loadProfile(currentUser?.id);
}

// ============================================================
// AUTH
// ============================================================
async function checkAuth() {
  try { const d = await api('/auth/me'); currentUser = d.user; updateAuthUI(); return d.user; }
  catch (e) {
    if (e && e.message === 'Conta banida') { closeModal(); showBanModal(e.data?.ban || {}); }
    else if (e && /conex[ãa]o|timeout|Sem conexão|Failed to fetch/i.test(e.message || '')) {
      throw e; // falha de rede -> boot mostra erro + tentar novamente
    }
    currentUser = null; updateAuthUI(); return null;
  }
}
function updateAuthUI() {
  const btn = document.getElementById('authBtn');
  btn.textContent = currentUser ? (currentUser.displayName || currentUser.username)[0].toUpperCase() : '👤';
  if (currentUser) {
    const cp = document.getElementById('cpAvatar');
    if (currentUser.avatar_url) cp.innerHTML = `<img class="avatar-img" src="${currentUser.avatar_url}" alt="">`;
    else cp.textContent = (currentUser.displayName || currentUser.username)[0].toUpperCase();
  } else {
    document.getElementById('cpAvatar').textContent = '👤';
  }
}
function openAuth() {
  if (currentUser) { showProfileMenu(); return; }
  openModal(`
    <div class="auth-modal">
      <h2>🌊 Entrar no VibeStream</h2>
      <div class="auth-tabs">
        <button class="auth-tab active" onclick="showAuthForm('login')">Entrar</button>
        <button class="auth-tab" onclick="showAuthForm('register')">Cadastrar</button>
      </div>
      <div id="authForm">
        <input type="text" id="authUser" class="form-input" placeholder="Usuário ou Email">
        <input type="email" id="authEmail" class="form-input" placeholder="Email" style="display:none">
        <input type="tel" id="authPhone" class="form-input" placeholder="Telefone (opcional)" style="display:none">
        <input type="text" id="authBirth" class="form-input" placeholder="Data de Nascimento (dd/mm/aaaa) - obrigatória" style="display:none">
        <p id="authAgeStatus" class="age-status" style="display:none"></p>
        <input type="password" id="authPass" class="form-input" placeholder="Senha (mín 6 caracteres)">
        <button class="btn-primary btn-full" onclick="doAuth()">Entrar</button>
      </div>
      <p id="authError" class="auth-error"></p>
    </div>
  `);
}
function showAuthForm(type) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('authEmail').style.display = type === 'register' ? 'block' : 'none';
  document.getElementById('authPhone').style.display = type === 'register' ? 'block' : 'none';
  document.getElementById('authBirth').style.display = type === 'register' ? 'block' : 'none';
  const st = document.getElementById('authAgeStatus');
  if (st) { st.style.display = 'none'; st.className = 'age-status'; st.textContent = ''; }
  birthValid = null;
  const birthInput = document.getElementById('authBirth');
  if (birthInput) birthInput.oninput = () => onBirthInput(birthInput.value, 'authAgeStatus');
  document.querySelector('#authForm .btn-primary').textContent = type === 'register' ? 'Cadastrar' : 'Entrar';
  document.querySelector('#authForm .btn-primary').onclick = () => doAuth(type);
}

// ============================================================
// VALIDAÇÃO DE IDADE AO VIVO (dd/mm/aaaa → idade exata)
// ============================================================
function onBirthInput(value, statusId) {
  const st = document.getElementById(statusId);
  if (!value) { birthValid = null; if (st) { st.style.display = 'none'; st.className = 'age-status'; } return; }
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) { birthValid = false; if (st) { st.style.display = 'block'; st.className = 'age-status blocked'; st.textContent = '⚠️ Use o formato dd/mm/aaaa'; } return; }
  const day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = parseInt(m[3], 10);
  const birth = new Date(Date.UTC(year, month - 1, day));
  const ok = birth.getUTCFullYear() === year && birth.getUTCMonth() === month - 1 && birth.getUTCDate() === day;
  if (!ok || year < 1900) { birthValid = false; if (st) { st.style.display = 'block'; st.className = 'age-status blocked'; st.textContent = '⚠️ Data de nascimento inválida'; } return; }
  const now = new Date();
  if (birth.getTime() > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) {
    birthValid = false; if (st) { st.style.display = 'block'; st.className = 'age-status blocked'; st.textContent = '⚠️ Data não pode estar no futuro'; } return;
  }
  let age = now.getUTCFullYear() - year;
  const hadBDay = (now.getUTCMonth() > month - 1) || (now.getUTCMonth() === month - 1 && now.getUTCDate() >= day);
  if (!hadBDay) age--;
  if (age < 15) {
    birthValid = false;
    if (st) { st.style.display = 'block'; st.className = 'age-status blocked'; st.textContent = '⚠️ Não permitido para menores de 15 anos — lei e regras da plataforma'; }
  } else if (age < 18) {
    birthValid = true;
    if (st) { st.style.display = 'block'; st.className = 'age-status restricted'; st.textContent = '🟡 ' + age + ' anos — acesso restrito (15-17)'; }
  } else {
    birthValid = true;
    if (st) { st.style.display = 'block'; st.className = 'age-status ok'; st.textContent = '✅ ' + age + ' anos — acesso completo'; }
  }
}
async function doAuth(type = 'login') {
  const user = document.getElementById('authUser').value;
  const pass = document.getElementById('authPass').value;
  if (!user || !pass) { document.getElementById('authError').textContent = 'Preencha todos os campos'; return; }
  try {
    if (type === 'register') {
      const email = document.getElementById('authEmail').value;
      const phone = document.getElementById('authPhone').value;
      const birth = document.getElementById('authBirth').value;
      if (!email) { document.getElementById('authError').textContent = 'Email é obrigatório'; return; }
      if (!birth) { document.getElementById('authError').textContent = 'Data de nascimento é obrigatória (verificação de idade)'; return; }
      onBirthInput(birth, 'authAgeStatus');
      if (birthValid === false) {
        document.getElementById('authError').textContent = '⚠️ Não permitido para menores de 15 anos — lei e regras da plataforma';
        return;
      }
      if (birthValid !== true) { document.getElementById('authError').textContent = 'Data inválida — use dd/mm/aaaa'; return; }
      await api('/auth/register', { method: 'POST', body: JSON.stringify({ username: user, email, password: pass, birthDate: birth, phone }) });
    }
    const d = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
    currentUser = d.user; updateAuthUI(); closeModal();
    showToast(`Bem-vindo, ${currentUser.displayName || currentUser.username}!`, 'success');
    loadFeed(); loadProfile(currentUser.id);
    maybeShowWelcome(currentUser);
  } catch (e) {
    if (e.message === 'Conta banida') {
      closeModal();
      showBanModal(e.data?.ban || {});
      return;
    }
    document.getElementById('authError').textContent = e.message;
  }
}

// ============================================================
// BOAS-VINDAS (animacão personalizada + registro no banco)
// ============================================================
async function maybeShowWelcome(user) {
  if (!user) return;
  const localKey = 'vs_welcome_' + user.id;
  try {
    const w = await api('/welcome');
    if (w.seen) return;
    if (localStorage.getItem(localKey)) {
      try { await api('/welcome/seen', { method: 'POST' }); } catch (e) {}
      return;
    }
    showWelcomeOverlay(w.name || user.displayName || user.username, user.id, localKey);
  } catch (e) { /* offline: não trava o app */ }
}

function showWelcomeOverlay(name, userId, localKey) {
  const el = document.getElementById('welcomeOverlay');
  if (!el) return;
  document.getElementById('welcomeName').textContent = name;
  document.getElementById('welcomeSkip').onclick = () => finishWelcome(userId, localKey);
  el.classList.remove('hidden');
  startWelcomeAnimation();
  // Se o usuário não pular, finaliza após o "vídeo" animado
  window.__welcomeTimer = setTimeout(() => finishWelcome(userId, localKey), 9000);
}

async function finishWelcome(userId, localKey) {
  const el = document.getElementById('welcomeOverlay');
  if (el && !el.classList.contains('hidden')) {
    el.classList.add('hidden');
    stopWelcomeAnimation();
    if (window.__welcomeTimer) { clearTimeout(window.__welcomeTimer); window.__welcomeTimer = null; }
    if (userId) localStorage.setItem(localKey, '1');
    try { await api('/welcome/seen', { method: 'POST' }); } catch (e) {}
  }
}
function skipWelcome() {
  const el = document.getElementById('welcomeOverlay');
  if (el && !el.classList.contains('hidden')) {
    const uid = currentUser ? currentUser.id : null;
    finishWelcome(uid, uid ? 'vs_welcome_' + uid : 'vs_welcome_');
  }
}

// Animacão leve do boas-vindas (partículas + onda de cores VibeStream)
let __welcomeAnimId = null;
let __welcomeCtx = null;
function startWelcomeAnimation() {
  const canvas = document.getElementById('welcomeCanvas');
  if (!canvas) return;
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth || 360;
  canvas.height = parent.clientHeight || 640;
  const ctx = canvas.getContext('2d');
  __welcomeCtx = ctx;
  const particles = [];
  for (let i = 0; i < 40; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: 1.5 + Math.random() * 4,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -0.2 - Math.random() * 0.8,
      hue: 250 + Math.random() * 60
    });
  }
  let t = 0;
  function frame() {
    t++;
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, 'rgba(108,92,231,0.9)');
    grad.addColorStop(0.5, 'rgba(72,52,212,0.95)');
    grad.addColorStop(1, 'rgba(9,132,227,0.9)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // ondas
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    for (let w = 0; w < 3; w++) {
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 8) {
        const y = canvas.height * 0.75 + Math.sin((x + t * 2 + w * 90) / 40) * 14;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }
      if (p.x < -10) p.x = canvas.width + 10;
      if (p.x > canvas.width + 10) p.x = -10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + p.hue + ', 90%, 75%, 0.8)';
      ctx.fill();
    }
    __welcomeAnimId = requestAnimationFrame(frame);
  }
  frame();
}
function stopWelcomeAnimation() {
  if (__welcomeAnimId) { cancelAnimationFrame(__welcomeAnimId); __welcomeAnimId = null; }
  if (__welcomeCtx) { __welcomeCtx.clearRect(0, 0, 9999, 9999); __welcomeCtx = null; }
}

// ============================================================
// BANIMENTO + RECURSO
// ============================================================
function showBanModal(ban) {
  openModal(`
    <div class="ban-modal">
      <h3>🚫 Sua conta foi banida</h3>
      <p>Olá, sua conta do VibeStream foi banida por uma possível violação das regras da plataforma.</p>
      <div class="ban-info">
        <p><strong>Motivo:</strong> ${escapeHtml(ban.reason || 'Violação das regras da plataforma')}</p>
        <p><strong>Data:</strong> ${ban.date ? getTimeAgo(ban.date) + ' (' + ban.date + ')' : '—'}</p>
        <p><strong>Tipo:</strong> ${ban.type === 'permanente' ? 'Banimento permanente' : 'Banimento temporário'}</p>
      </div>
      <p>Caso você acredite que o banimento foi aplicado sem motivo ou por engano, você pode solicitar uma revisão.</p>
      <textarea id="appealText" class="form-input" rows="4" placeholder="Escreva aqui o motivo do seu recurso..."></textarea>
      <button class="btn-primary btn-full" onclick="submitAppeal()">Enviar recurso</button>
      <p style="font-size:11px;color:var(--text3);margin-top:10px;text-align:center">A equipe VibeStream analisará sua solicitação.<br>Suporte: <a href="mailto:suportevibestream@gmail.com">suportevibestream@gmail.com</a></p>
    </div>
  `);
}

async function submitAppeal() {
  const reason = document.getElementById('appealText')?.value;
  if (!reason || reason.trim().length < 10) { showToast('Escreva um motivo com pelo menos 10 caracteres', 'error'); return; }
  try {
    const d = await api('/appeals', { method: 'POST', body: JSON.stringify({ reason }) });
    closeModal();
    showToast(d.message || 'Recurso enviado!', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function reportChat() {
  if (!currentUser) { openAuth(); return; }
  if (!currentChatId) return;
  openModal(`
    <div class="report-modal">
      <h3>🚩 Denunciar conversa</h3>
      <p style="font-size:13px;color:var(--text2)">Conteúdo que viola as regras (assédio, ódio, golpe, spam, conteúdo ilegal) será analisado pela equipe.</p>
      <textarea id="chatReportReason" class="form-input" rows="4" placeholder="Descreva o motivo da denúncia..."></textarea>
      <button class="btn-primary btn-full" onclick="submitChatReport()">Enviar denúncia</button>
    </div>
  `);
}

async function submitChatReport() {
  const reason = document.getElementById('chatReportReason')?.value;
  if (!reason || reason.trim().length < 5) { showToast('Descreva o motivo da denúncia', 'error'); return; }
  try {
    const d = await api(`/chats/${currentChatId}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
    closeModal();
    showToast(d.message || 'Denúncia enviada!', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function sendChatMedia(type) {
  if (!currentUser) { openAuth(); return; }
  if (!currentChatId) return;
  const input = document.getElementById('chatMediaInput');
  const acceptMap = { photo: 'image/*', video: 'video/*', audio: 'audio/*' };
  input.accept = acceptMap[type] || 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast('Arquivo muito grande (máx 8MB)', 'error'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const up = await api('/media', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result }) });
        const d = await api(`/chats/${currentChatId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ type, mediaUrl: up.url })
        });
        appendChatMessage(d.message);
      } catch (e) { showToast(e.message, 'error'); }
    };
    reader.readAsDataURL(file);
    input.value = '';
  };
  input.click();
}

function chatMediaHtml(m) {
  if (m.type === 'photo') return `<img src="${m.media_url}" class="chat-media-img" alt="foto" onclick="window.open('${m.media_url}','_blank')">`;
  if (m.type === 'video') return `<video src="${m.media_url}" class="chat-media-video" controls playsinline preload="metadata"></video>`;
  if (m.type === 'audio') return `<audio src="${m.media_url}" controls preload="metadata" style="width:100%;max-width:220px"></audio>`;
  return '';
}

function appendChatMessage(m) {
  const container = document.getElementById('messagesContainer');
  if (!container) return;
  container.insertAdjacentHTML('beforeend', `
    <div class="msg ${m.sender_id === currentUser?.id ? 'msg-mine' : 'msg-other'}">
      ${m.type !== 'text' ? `<div class="msg-media">${chatMediaHtml(m)}</div>` : ''}
      ${m.text ? `<div class="msg-text">${escapeHtml(m.text)}</div>` : ''}
      <div class="msg-time">agora</div>
    </div>
  `);
  container.scrollTop = container.scrollHeight;
}
function showProfileMenu() {
  let adminLink = '';
  if (currentUser && currentUser.role === 'admin') {
    adminLink = `<button class="btn-secondary btn-full" style="margin-top:8px" onclick="closeModal();openAdmin()">🛡️ Painel Admin</button>`;
  }
  openModal(`
    <div class="profile-menu">
      <h3>👤 ${currentUser.displayName || currentUser.username}</h3>
      <p style="color:#888;font-size:13px">@${currentUser.username} ${currentUser.role === 'admin' ? '🛡️ Admin' : ''}</p>
      <hr style="border-color:#333;margin:12px 0">
      <button class="btn-primary btn-full" onclick="closeModal();switchPage('Profile')">Meu Perfil</button>
      <button class="btn-secondary btn-full" style="margin-top:8px" onclick="closeModal();openEconomy()">💎 Loja / Recarga / VIP</button>
      <button class="btn-secondary btn-full" style="margin-top:8px" onclick="closeModal();openWallet()">💰 Carteira / Saque PIX</button>
      <button class="btn-secondary btn-full" style="margin-top:8px" onclick="closeModal();openAgency()">🏢 Minha Agência</button>
      <button class="btn-secondary btn-full" style="margin-top:8px" onclick="closeModal();openCampaigns()">🎯 Campanhas</button>
      <button class="btn-secondary btn-full" style="margin-top:8px" onclick="closeModal();openTicket()">📋 Denunciar / Ticket</button>
      ${adminLink}
      <button class="btn-secondary btn-full" style="margin-top:8px" onclick="doLogout()">Sair</button>
    </div>
  `);
}
async function doLogout() {
  await api('/auth/logout', { method: 'POST' });
  currentUser = null; updateAuthUI(); closeModal(); showToast('Até logo!');
}

// ============================================================
// TICKETS / DENÚNCIAS
// ============================================================
function openTicket() {
  if (!currentUser) { openAuth(); return; }
  openModal(`
    <div class="ticket-modal">
      <h3>📋 Abrir Ticket / Denúncia</h3>
      <p style="color:#888;font-size:13px;margin-bottom:16px">Reporte problemas, denuncie usuários ou faça sugestões</p>
      <select id="ticketType" class="form-input">
        <option value="denuncia">🚨 Denúncia</option>
        <option value="suporte">🆘 Suporte</option>
        <option value="sugestao">💡 Sugestão</option>
        <option value="bug">🐛 Reportar Bug</option>
      </select>
      <input type="text" id="ticketSubject" class="form-input" placeholder="Assunto">
      <textarea id="ticketDesc" class="form-input" placeholder="Descreva detalhadamente..." rows="4"></textarea>
      <input type="text" id="ticketUser" class="form-input" placeholder="Usuário denunciado (opcional)">
      <button class="btn-primary btn-full" onclick="submitTicket()">Enviar Ticket</button>
      <hr style="border-color:#333;margin:16px 0">
      <button class="btn-secondary btn-full" onclick="viewMyTickets()">Ver Meus Tickets</button>
      <p style="font-size:11px;color:#888;margin-top:12px;text-align:center">Precisa de ajuda direta?<br><a href="mailto:suportevibestream@gmail.com" style="color:var(--blue)">suportevibestream@gmail.com</a></p>
    </div>
  `);
}

async function submitTicket() {
  const subject = document.getElementById('ticketSubject').value;
  const description = document.getElementById('ticketDesc').value;
  const ticketType = document.getElementById('ticketType').value;
  const reportedUser = document.getElementById('ticketUser').value;
  if (!subject || !description) { showToast('Preencha assunto e descrição', 'error'); return; }
  if (description.length < 10) { showToast('Descrição muito curta (mín 10 caracteres)', 'error'); return; }
  try {
    const d = await api('/tickets', {
      method: 'POST',
      body: JSON.stringify({ ticketType, subject, description, reportedUserId: reportedUser || null })
    });
    closeModal();
    showToast('✅ Ticket criado! ID: ' + d.ticketId.substring(0,8), 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function viewMyTickets() {
  if (!currentUser) return;
  try {
    const d = await api('/tickets');
    let html = `<div class="tickets-list"><h3>📋 Meus Tickets</h3>`;
    if (!d.tickets.length) {
      html += `<p style="color:#888;padding:20px">Nenhum ticket aberto</p>`;
    } else {
      d.tickets.forEach(t => {
        const statusColor = t.status === 'resolvido' ? '#10b981' : t.status === 'em_andamento' ? '#f59e0b' : '#6C5CE7';
        html += `<div class="ticket-card" style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between">
            <strong>${t.subject}</strong>
            <span style="color:${statusColor};font-size:12px">${t.status || 'aberto'}</span>
          </div>
          <p style="font-size:13px;color:#888;margin:4px 0">${t.description}</p>
          ${t.response ? `<div style="background:var(--bg3);padding:8px;border-radius:6px;margin-top:8px;font-size:13px"><strong>Resposta:</strong> ${t.response}</div>` : ''}
          <small style="color:#666">${new Date(t.created_at).toLocaleString()}</small>
        </div>`;
      });
    }
    html += `</div>`;
    document.getElementById('modalContent').innerHTML = html;
  } catch(e) { showToast(e.message, 'error'); }
}

// ============================================================
// ADMIN PANEL
// ============================================================
function openAdmin() {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('Acesso negado', 'error');
    return;
  }
  window.open('/admin', '_blank');
}

// ============================================================
// FEED / POSTS
// ============================================================
function focusPost() {
  if (!currentUser) { openAuth(); return; }
  document.getElementById('cpActions').style.display = 'block';
  document.getElementById('postInput').style.display = 'none';
  document.getElementById('postTextarea').focus();
}
function addMedia(type) {
  if (!currentUser) { openAuth(); return; }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = type === 'photo' ? 'image/*' : type === 'video' ? 'video/*' : 'audio/*';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast('Arquivo muito grande (máx 8MB)', 'error'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const d = await api('/media', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result }) });
        pendingMedia = { url: d.url, type };
        const prev = document.getElementById('mediaPreview');
        if (prev) {
          prev.innerHTML = type === 'photo'
            ? `<img src="${d.url}" alt=""><button onclick="removeMedia()">✕</button>`
            : type === 'video'
              ? `<video src="${d.url}" controls playsinline></video><button onclick="removeMedia()">✕</button>`
              : `<audio src="${d.url}" controls></audio><button onclick="removeMedia()">✕</button>`;
          prev.style.display = 'block';
        }
        showToast('📎 Mídia anexada!', 'success');
      } catch (e) { showToast(e.message, 'error'); }
    };
    reader.readAsDataURL(file);
  };
  input.click();
}
function removeMedia() {
  pendingMedia = null;
  const prev = document.getElementById('mediaPreview');
  if (prev) { prev.innerHTML = ''; prev.style.display = 'none'; }
}

let pendingPostData = null;

// Tela obrigatória antes do POST — regras da plataforma
function showRulesModal() {
  openModal(`
    <div class="rules-modal">
      <h3>📋 Regras antes de publicar</h3>
      <div class="rules-box">
        <p><strong>❌ Não publique:</strong></p>
        <ul>
          <li>• Conteúdo adulto</li>
          <li>• Violência</li>
          <li>• Ódio</li>
          <li>• Assédio</li>
          <li>• Conteúdo ilegal</li>
          <li>• Identidade falsa</li>
          <li>• Conteúdo envolvendo menores</li>
        </ul>
        <p>Publicações que violarem as regras serão removidas e podem causar suspensão ou banimento.</p>
        <p style="margin-top:8px">Dúvidas? Fale com o suporte: <a href="mailto:suportevibestream@gmail.com">suportevibestream@gmail.com</a></p>
      </div>
      <label class="rules-check"><input type="checkbox" id="rulesCheck"> ☑ Li e concordo com as regras</label>
      <button class="btn-primary btn-full" onclick="acceptRulesAndPost()">Continuar</button>
    </div>
  `);
}

async function acceptRulesAndPost() {
  const check = document.getElementById('rulesCheck');
  if (!check || !check.checked) { showToast('Você precisa marcar "Li e concordo com as regras"', 'error'); return; }
  try {
    await api('/rules/accept', { method: 'POST' });
    closeModal();
    if (pendingPostData) {
      const d = pendingPostData; pendingPostData = null;
      await submitPost(d);
    }
  } catch (e) { showToast(e.message, 'error'); }
}

async function submitPost({ text, hashtags }) {
  const mediaType = pendingMedia?.type || '';
  const mediaUrl = pendingMedia?.url || '';
  // ===== MODERAÇÃO ANTES DE PUBLICAR (AnyClaw) =====
  try {
    const mc = await api('/moderation/check', {
      method: 'POST',
      body: JSON.stringify({ tipo: mediaType === 'video' ? 'video' : (mediaUrl ? 'foto' : 'legenda'), url: mediaUrl, texto: text })
    });
    if (mc.data && mc.data.banido) {
      showBanPoliticoModal(mc.data.motivo);
      return;
    }
    if (mc.data && mc.data.ameaca) {
      closeModal();
      openModal(`
        <div class="ban-modal" style="border-color:#ff3b30">
          <h3>🚨 Vídeo removido por ameaça</h3>
          <p style="color:#ff8b96">${escapeHtml(mc.data.motivo)}</p>
          <button class="btn-red btn-full" onclick="closeModal()">Entendi</button>
        </div>`);
      return;
    }
    if (mc.data && !mc.data.aprovado) {
      showToast('❌ ' + (mc.data.motivo || 'Conteúdo não permitido'), 'error');
      return;
    }
  } catch (e) { /* se a API de moderação falhar, segue o fluxo normal de publicação */ }
  try {
    const d = await api('/posts', {
      method: 'POST',
      body: JSON.stringify({ text, hashtags, mediaUrl, mediaType })
    });
    removeMedia();
    document.getElementById('postTextarea').value = '';
    document.getElementById('postHashtags').value = '';
    document.getElementById('cpActions').style.display = 'none';
    document.getElementById('postInput').style.display = 'block';
    if (d.post.status === 'review') {
      showToast('⚠️ Publicação enviada para revisão da moderação', 'warning');
      return;
    }
    showToast('✅ Post compartilhado!', 'success');
    const feed = document.getElementById('feedContainer');
    feed.insertAdjacentHTML('afterbegin', renderTikSlide({ ...d.post, hashtags: d.post.hashtags || [] }));
    setupTikObserver();
    currentPostPage = 1;
  } catch (e) {
    if (e && e.data && e.data.code === 'BAN_PERMANENTE_POLITICO') { showBanPoliticoModal(e.message); return; }
    if (e && e.message && (e.message.includes('banida') || e.message.includes('banido'))) {
      showBanModal({ reason: e.message, type: 'permanente', date: '' });
      return;
    }
    if (e && e.message && e.message.includes('strike')) { showToast(e.message, 'error'); return; }
    showToast(e.message, 'error');
  }
}

function showBanPoliticoModal(motivo) {
  closeModal();
  openModal(`
    <div class="ban-modal" style="border-color:#ff3b30">
      <h3>🚫 BAN PERMANENTE</h3>
      <p style="color:#ff8b96"><strong>Conteúdo político proibido</strong></p>
      <div class="ban-info">
        <p><strong>Motivo:</strong> ${escapeHtml(motivo || 'Sua conta foi banida permanentemente por violar regra 1: Proibido conteúdo político (Bolsonaro/Lula). Contate suporte: suportevibestream@gmail.com')}</p>
        <p><strong>Tipo:</strong> Banimento permanente</p>
      </div>
      <p style="font-size:11px;color:var(--text3);text-align:center">Equipe VibeStream · <a href="mailto:suportevibestream@gmail.com">suportevibestream@gmail.com</a></p>
      <button class="btn-red btn-full" onclick="doLogout()">Sair</button>
    </div>`);
}

async function doLogout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
  currentUser = null;
  updateAuthUI();
  closeModal();
  showToast('Sessão encerrada', '');
}

async function createPost() {
  if (!currentUser) { openAuth(); return; }
  const text = document.getElementById('postTextarea').value;
  if (!text || text.length < 2) { showToast('Escreva algo para postar', 'error'); return; }
  const hashtags = (document.getElementById('postHashtags').value.match(/#[\w]+/g) || []).map(h => h.replace('#',''));
  // Tela obrigatória de regras ANTES de publicar (sempre)
  pendingPostData = { text, hashtags };
  showRulesModal();
}

// ============================================================
// FEED TIKTOK — rolagem vertical com snap (cada post = 100vh)
// IntersectionObserver: 80% visível = view +306 K Golds + autoplay
// ============================================================
let tikObserver = null;
const tikWatched = new Set();

async function loadFeed(reset = true) {
  if (feedLoading) return;
  feedLoading = true;
  if (reset) {
    currentPostPage = 1;
    tikWatched.clear();
    document.getElementById('feedContainer').innerHTML = '';
  }
  document.getElementById('feedLoader').style.display = 'block';
  try {
    const d = await api(`/posts?page=${currentPostPage}&limit=5`);
    document.getElementById('feedLoader').style.display = 'none';
    const container = document.getElementById('feedContainer');
    container.classList.add('tik-feed');
    document.getElementById('pageFeed').classList.add('tik-mode');
    if (d.posts.length === 0 && currentPostPage === 1) {
      container.innerHTML = `<div class="empty-state">📝 Nenhum post ainda.<br>Seja o primeiro a compartilhar!</div>`;
      feedLoading = false;
      return;
    }
    d.posts.forEach(p => {
      container.insertAdjacentHTML('beforeend', renderTikSlide(p));
    });
    setupTikObserver();
    // Preload da próxima página em background
    if (d.pagination.totalPages > currentPostPage) {
      currentPostPage++;
      setTimeout(() => { if (!feedLoading) loadFeed(false); }, 1500);
    }
  } catch (e) { document.getElementById('feedLoader').style.display = 'none'; }
  feedLoading = false;
}

function renderTikSlide(p) {
  const tag = p.family_tag ? `<span class="tik-tag" onclick="event.stopPropagation();openFamilyDetail('${p.family_id || ''}')">[${escapeHtml(p.family_tag)}]</span>` : '';
  const agencyTag = p.agency_tag ? `<span class="tik-tag tik-tag-agency" onclick="event.stopPropagation();location.href='/agencia'">[${escapeHtml(p.agency_tag)}]</span>` : '';
  let media;
  if (p.media_url && p.media_type === 'video') {
    media = `<video src="${p.media_url}" loop muted playsinline preload="metadata"></video>`;
  } else if (p.media_url && p.media_type === 'audio') {
    media = `<div class="tik-audio"><div class="tik-audio-ic">🎵</div><div class="tik-audio-wave"></div></div>`;
  } else if (p.media_url) {
    media = `<img src="${p.media_url}" alt="" loading="lazy">`;
  } else {
    media = `<div class="tik-textonly"><div class="tik-textonly-card">${escapeHtml(p.text)}</div></div>`;
  }
  return `
  <div class="tik-slide" data-id="${p.id}" onclick="onSlideTap(event)">
    ${media}
    <div class="tik-gradient"></div>
    <div class="tik-actions">
      <div class="tik-act" onclick="viewProfile('${p.user_id}')">
        <div class="tik-av">${p.avatar_url && p.avatar_url !== '/default-avatar.png' ? `<img src="${p.avatar_url}" alt="">` : (p.display_name || p.username || '?')[0].toUpperCase()}</div>
        <span>@${escapeHtml(p.username)}</span>
      </div>
      <div class="tik-act ${p.liked ? 'liked' : ''}" onclick="toggleLike('${p.id}', this)">${p.liked ? '❤️' : '🤍'}<span>${fmtK(p.likes_count || 0)}</span></div>
      <div class="tik-act" onclick="showComments('${p.id}')">💬<span>${fmtK(p.comments_count || 0)}</span></div>
      <div class="tik-act" onclick="sharePost('${p.id}')">🔗<span>Compartilhar</span></div>
      <div class="tik-act" onclick="toggleSave('${p.id}', this)">${p.saved ? '🔖' : '📑'}</div>
    </div>
    <div class="tik-info">
      <div class="tik-user" onclick="viewProfile('${p.user_id}')">${tag}${agencyTag}<b>${escapeHtml(p.display_name || p.username)}</b> <small>· ${getTimeAgo(p.created_at)}</small></div>
      <p class="tik-caption">${escapeHtml(p.text)}</p>
      <div class="tik-hash">${(p.hashtags || []).map(h => '#' + escapeHtml(h)).join(' ')}</div>
    </div>
  </div>`;
}

function onSlideTap(e) {
  const slide = e.target.closest('.tik-slide');
  if (!slide) return;
  const v = slide.querySelector('video');
  if (!v) return;
  if (v.paused) v.play().catch(() => {});
  else v.pause();
}

function setupTikObserver() {
  if (!('IntersectionObserver' in window)) return;
  if (!tikObserver) {
    tikObserver = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        const slide = en.target;
        const visible = en.intersectionRatio >= 0.8;
        if (visible) {
          slide.classList.add('tik-active');
          const v = slide.querySelector('video');
          if (v) { v.muted = true; v.play().catch(() => {}); }
          const pid = slide.dataset.id;
          if (!tikWatched.has(pid) && currentUser) {
            tikWatched.add(pid);
            api('/tarefas/ver-video', { method: 'POST' }).then(d => {
              if (d && d.success && d.data) showGoldToast('+306 K Golds');
            }).catch(() => {});
          }
        } else {
          slide.classList.remove('tik-active');
          const v = slide.querySelector('video');
          if (v && !v.paused) v.pause();
        }
      });
    }, { threshold: [0.8] });
  }
  document.querySelectorAll('.tik-slide:not(.obs-bound)').forEach(sl => {
    sl.classList.add('obs-bound');
    tikObserver.observe(sl);
  });
}

let goldToastTimer = null;
function showGoldToast(msg) {
  let el = document.getElementById('goldToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'goldToast';
    document.body.appendChild(el);
  }
  el.textContent = '🪙 ' + msg;
  el.classList.add('show');
  clearTimeout(goldToastTimer);
  goldToastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

async function toggleSave(postId, btn) {
  if (!currentUser) { openAuth(); return; }
  try {
    const d = await api(`/posts/${postId}/save`, { method: 'POST' });
    btn.classList.toggle('saved', d.saved);
    btn.innerHTML = `${d.saved ? '🔖' : '📑'} <span>${d.saved ? 'Salvo' : 'Salvar'}</span>`;
    showToast(d.saved ? '🔖 Salvo!' : 'Removido dos salvos', d.saved ? 'success' : '');
  } catch (e) { showToast(e.message, 'error'); }
}

async function toggleLike(postId, btn) {
  if (!currentUser) { openAuth(); return; }
  try {
    const d = await api(`/posts/${postId}/like`, { method: 'POST' });
    btn.innerHTML = `${d.liked ? '❤️' : '🤍'} <span>${d.likes_count}</span>`;
    btn.classList.toggle('liked', d.liked);
  } catch (e) { showToast(e.message, 'error'); }
}

async function showComments(postId) {
  try {
    const d = await api(`/posts/${postId}/comments`);
    let html = `<div class="comments-modal"><h3>💬 Comentários</h3><div class="comments-list">`;
    d.comments.forEach(c => {
      html += `<div class="comment-item">
        <div class="comment-avatar">${(c.display_name || c.username || '?')[0].toUpperCase()}</div>
        <div class="comment-body">
          <strong>${c.display_name || c.username}</strong>
          <p>${escapeHtml(c.text)}</p>
          <small>${getTimeAgo(c.created_at)}</small>
        </div>
      </div>`;
    });
    html += `</div>`;
    if (currentUser) {
      html += `<div class="comment-input"><input type="text" id="commentText" placeholder="Escreva um comentário..." onkeydown="if(event.key==='Enter')sendComment('${postId}')">
        <button onclick="sendComment('${postId}')">Enviar</button></div>`;
    }
    html += `</div>`;
    openModal(html);
  } catch (e) { showToast(e.message, 'error'); }
}

async function sendComment(postId) {
  const text = document.getElementById('commentText')?.value;
  if (!text) return;
  try {
    const d = await api(`/posts/${postId}/comments`, {
      method: 'POST', body: JSON.stringify({ text })
    });
    document.getElementById('commentText').value = '';
    document.querySelector('.comments-list').insertAdjacentHTML('beforeend', `
      <div class="comment-item">
        <div class="comment-avatar">${(d.comment.display_name || d.comment.username)[0].toUpperCase()}</div>
        <div class="comment-body"><strong>${d.comment.display_name || d.comment.username}</strong><p>${escapeHtml(d.comment.text)}</p><small>agora</small></div>
      </div>
    `);
    showToast('💬 Comentário enviado!', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

function sharePost(postId) {
  const url = window.location.href;
  navigator.clipboard?.writeText(url).then(() => showToast('🔗 Link copiado!', 'success')).catch(() => {});
}

// ============================================================
// LIVES
// ============================================================
async function loadLives() {
  try {
    const d = await api('/lives?limit=20');
    const container = document.getElementById('livesContainer');
    if (!d.lives || d.lives.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div style="font-size:48px;margin-bottom:12px">📺</div>
          <h3>Nenhuma live no momento</h3>
          <p style="color:#888;font-size:14px">Seja o primeiro a criar uma live!</p>
          <button class="btn-primary" style="margin-top:16px" onclick="createLive()">🔴 Criar Live</button>
        </div>`;
      return;
    }
    container.innerHTML = d.lives.map(l => `
      <div class="live-card" onclick="enterLive('${l.id}')">
        <div class="live-thumb">
          <div class="live-status">🔴 AO VIVO</div>
          <div class="live-viewers">👁️ ${l.viewer_count || 0}</div>
        </div>
        <div class="live-info">
          <div class="live-avatar">${(l.display_name || l.username || '?')[0].toUpperCase()}</div>
          <div class="live-details">
            <strong>${l.title}</strong>
            <span style="font-size:12px;color:#888">${l.display_name || l.username} · ${l.category || 'geral'}</span>
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) { showToast(e.message, 'error'); }
}

function createLive() {
  if (!currentUser) { openAuth(); return; }
  openModal(`
    <div class="create-live-modal">
      <h3>🔴 Criar Live</h3>
      <select id="liveType" class="form-input">
        <option value="video">📹 Live em Vídeo</option>
        <option value="audio">🎤 Live em Áudio</option>
      </select>
      <input type="text" id="liveTitle" class="form-input" placeholder="Título da live">
      <select id="liveCategory" class="form-input">
        <option value="geral">📺 Geral</option>
        <option value="games">🎮 Games</option>
        <option value="musica">🎵 Música</option>
        <option value="danca">💃 Dança</option>
        <option value="comedia">😂 Comédia</option>
        <option value="educacao">📚 Educação</option>
      </select>
      <button class="btn-primary btn-full" onclick="startLive()">🔴 Iniciar Live</button>
    </div>
  `);
}

async function startLive() {
  const title = document.getElementById('liveTitle').value;
  const category = document.getElementById('liveCategory').value;
  const type = document.getElementById('liveType').value;
  if (!title) { showToast('Título é obrigatório', 'error'); return; }
  try {
    const d = await api('/lives', {
      method: 'POST',
      body: JSON.stringify({ title, category, type })
    });
    closeModal();
    showToast('🔴 Live iniciada!', 'success');
    loadLives();
    openLiveRoom(d.live.id);
  } catch (e) { showToast(e.message, 'error'); }
}

async function enterLive(liveId) {
  try {
    const d = await api('/lives/' + liveId);
    openLiveRoom(d.live.id);
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// LIVE ROOM REAL (câmera + WebSocket + chat ao vivo)
// ============================================================
async function openLiveRoom(liveId) {
  let d;
  try { d = await api('/lives/' + liveId); } catch (e) { showToast(e.message, 'error'); return; }
  const live = d.live;
  const isStreamer = currentUser?.id === live.user_id;
  liveRoomState = { liveId, isStreamer, cameraStream: null, frameTimer: null, heartTimer: null };

  if (live.type === 'audio') { openAudioLiveRoom(live, d, isStreamer); return; }

  const streamerActions = isStreamer
    ? `<button class="btn-live btn-full" style="flex:1" onclick="endMyLive()">⏹️ Encerrar Live</button>`
    : '';

  openModal(`
    <div class="live-room">
      <div class="live-stage">
        <div class="live-stage-top">
          <span class="live-status">🔴 AO VIVO</span>
          <span class="live-viewers" id="liveViewerCount">👁️ ${live.viewer_count || 0}</span>
        </div>
        <div class="live-video-wrap" id="liveVideoWrap">
          <img id="liveFrameImg" class="live-frame hidden" alt="transmissão">
          <video id="liveCameraVideo" class="live-frame hidden" autoplay muted playsinline></video>
          <div class="live-placeholder" id="livePlaceholder">
            <div style="font-size:56px">${live.type === 'audio' ? '🎤' : '📺'}</div>
            <p>${isStreamer ? 'Conectando transmissão...' : 'Aguardando transmissão...'}</p>
          </div>
        </div>
        <div class="live-title-bar">
          <div class="live-avatar">${(live.display_name || live.username || '?')[0].toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <strong style="font-size:14px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(live.title)}</strong>
            <span style="font-size:12px;color:var(--text2)">@${live.username || ''} · ${live.category || 'geral'}</span>
          </div>
        </div>
      </div>
      <div class="live-room-chat">
        <div class="live-chat-list" id="liveChatList"></div>
        <div class="live-chat-input">
          <input type="text" id="liveChatInput" placeholder="Comente na live..." onkeydown="if(event.key==='Enter')sendLiveComment()">
          <button onclick="sendLiveComment()">➤</button>
        </div>
      </div>
      <div class="live-actions">
        <button class="btn-primary" style="flex:1" onclick="liveLike()">❤️ <span id="liveLikeCount">${d.likes_count || 0}</span></button>
        <button class="btn-secondary" style="flex:1" onclick="liveGift()">🎁 Presente</button>
        ${streamerActions}
      </div>
    </div>
  `);

  renderLiveComments(d.messages || []);
  connectLiveWs(liveId, isStreamer, live.type === 'audio');
}

function connectLiveWs(liveId, isStreamer, isAudio) {
  if (liveWs) { try { liveWs.close(); } catch (e) {} }
  try { liveWs = new WebSocket(WS_URL); } catch (e) { showToast('Erro ao conectar em tempo real', 'error'); return; }
  liveWs.onopen = () => {
    try { liveWs.send(JSON.stringify({ type: 'live:join', liveId })); } catch (e) {}
    if (isStreamer) {
      startHeartbeat(liveId);
      startCamera(isAudio);
    }
  };
  liveWs.onmessage = (ev) => { try { handleLiveMsg(JSON.parse(ev.data)); } catch (e) {} };
  liveWs.onclose = () => {
    if (liveRoomState.liveId === liveId && !document.getElementById('modal').classList.contains('hidden')) {
      // Reconecta em 3s se o modal ainda estiver aberto
      setTimeout(() => { if (liveRoomState.liveId === liveId && !document.getElementById('modal').classList.contains('hidden')) connectLiveWs(liveId, isStreamer, isAudio); }, 3000);
    }
  };
}

function handleLiveMsg(msg) {
  if (!msg) return;
  if (msg.type === 'live:viewers') {
    const el = document.getElementById('liveViewerCount');
    if (el) el.textContent = '👁️ ' + (msg.count || 0);
    const ael = document.getElementById('audioViewerCount');
    if (ael) ael.textContent = msg.count || 0;
  }
  if (msg.type === 'live:frame') {
    const img = document.getElementById('liveFrameImg');
    const ph = document.getElementById('livePlaceholder');
    if (img && !liveRoomState.isStreamer) {
      img.src = msg.data;
      img.classList.remove('hidden');
      if (ph) ph.classList.add('hidden');
    }
  }
  if (msg.type === 'live:comment') appendLiveComment(msg.comment);
  if (msg.type === 'live:like') {
    const el = document.getElementById('liveLikeCount');
    if (el) el.textContent = msg.count || '0';
  }
  if (msg.type === 'live:gift' && msg.user) {
    appendLiveComment({ message: `🎁 ${msg.user.display_name || msg.user.username} enviou um presente!`, display_name: 'VibeStream', username: 'presentes', created_at: new Date().toISOString(), gift: true });
    if (msg.gift && msg.gift.image_url) showGiftAnimation(msg.gift.image_url, msg.gift.name || '');
  }
  if (msg.type === 'live:ended') {
    showToast('⏹️ Live encerrada' + (msg.reason ? ': ' + msg.reason : ''), 'info');
    closeModal();
    loadLives();
  }
  if (msg.type === 'live:error') showToast(msg.error, 'error');
  if (msg.type === 'notification' && msg.notification) { loadNotifications(); }
}

function renderLiveComments(messages) {
  const list = document.getElementById('liveChatList');
  if (!list) return;
  list.innerHTML = '';
  (messages || []).forEach(m => appendLiveComment(m));
}

function appendLiveComment(c) {
  const list = document.getElementById('liveChatList');
  if (!list) return;
  const name = c.display_name || c.username || 'usuário';
  const mine = currentUser && c.user_id === currentUser.id;
  list.insertAdjacentHTML('beforeend', `
    <div class="live-chat-item ${mine ? 'mine' : ''} ${c.gift ? 'gift' : ''}">
      <strong>${escapeHtml(name)}</strong>${c.gift ? '' : ':'} <span>${escapeHtml(c.message)}</span>
      <small>${getTimeAgo(c.created_at)}</small>
    </div>`);
  list.scrollTop = list.scrollHeight;
  // Sala de áudio (estilo Poppo)
  const alist = document.getElementById('audioChatList');
  if (alist) {
    alist.insertAdjacentHTML('beforeend', `
      <div class="audio-chat-msg">${c.gift ? '🎁 ' : ''}<b>${escapeHtml(name)}</b>${c.gift ? '' : ':'} ${escapeHtml(c.message)}</div>`);
    alist.scrollTop = alist.scrollHeight;
  }
}

function sendLiveComment() {
  const input = document.getElementById('liveChatInput');
  const text = input?.value?.trim();
  if (!text) return;
  if (!currentUser) { openAuth(); return; }
  if (liveWs && liveWs.readyState === 1) {
    liveWs.send(JSON.stringify({ type: 'live:comment', liveId: liveRoomState.liveId, text }));
    input.value = '';
  } else { showToast('Desconectado da live', 'error'); }
}

function liveLike() {
  if (!currentUser) { openAuth(); return; }
  if (liveWs && liveWs.readyState === 1) liveWs.send(JSON.stringify({ type: 'live:like', liveId: liveRoomState.liveId }));
}

async function liveGift() {
  if (!currentUser) { openAuth(); return; }
  if (!liveRoomState.liveId) { showToast('Entre em uma live primeiro', 'error'); return; }
  try {
    const d = await api('/gifts');
    const eco = await api('/economy/me');
    openModal(`
      <div class="wallet-modal">
        <h2>🎁 Presentes para a live</h2>
        <p style="color:var(--text2);font-size:13px">Seu saldo: <strong style="color:var(--success)">💎 ${Number(eco.coins || 0)} moedas</strong></p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
          ${(d.gifts || []).map(g => `
            <div onclick="sendGift('${g.id}','${g.name.replace(/'/g, '')}','${g.image_url || '🎁'}','${g.price_coins}')" style="border:1px solid var(--border);border-radius:12px;padding:12px;text-align:center;cursor:pointer;background:var(--card)">
              <div style="font-size:34px">${g.image_url || '🎁'}</div>
              <div style="font-size:13px;margin-top:4px">${escapeHtml(g.name)}</div>
              <div style="font-size:12px;color:var(--text3)">${g.price_coins} moedas</div>
            </div>`).join('')}
        </div>
        <p style="color:var(--text3);font-size:11px;margin-top:10px">Moedas insuficientes? <a href="javascript:void(0)" onclick="closeModal();openEconomy()">💎 Recarregar</a></p>
      </div>
    `);
  } catch (e) { showToast(e.message, 'error'); }
}

async function sendGift(giftId, name, emoji, price) {
  if (!confirm('Enviar ' + name + ' (' + price + ' moedas) para esta live?')) return;
  try {
    const d = await api('/gifts/send', { method: 'POST', body: JSON.stringify({ giftId, liveId: liveRoomState.liveId, quantity: 1 }) });
    showToast('🎁 ' + name + ' enviado!', 'success');
    showGiftAnimation(emoji || '🎁', name);
    if (liveWs && liveWs.readyState === 1) {
      liveWs.send(JSON.stringify({ type: 'live:gift', liveId: liveRoomState.liveId, gift: { name, image_url: emoji, quantity: 1, total_coins: d.totalCoins }, user: { display_name: currentUser.displayName || currentUser.username, username: currentUser.username } }));
    }
    closeModal();
  } catch (e) {
    if (e.data && e.data.code === 'NO_COINS') { showToast('Moedas insuficientes — faça uma recarga', 'error'); closeModal(); openEconomy(); }
    else showToast(e.message, 'error');
  }
}

function showGiftAnimation(emoji, name) {
  const wrap = document.getElementById('liveVideoWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'gift-anim';
  el.innerHTML = '<div class="gift-anim-emoji">' + emoji + '</div><div class="gift-anim-name">' + escapeHtml(name || '') + '</div>';
  wrap.appendChild(el);
  setTimeout(() => { try { el.remove(); } catch (e) {} }, 2600);
}

async function endMyLive() {
  try {
    await api(`/lives/${liveRoomState.liveId}/end`, { method: 'POST' });
    closeModal();
    showToast('⏹️ Live encerrada', 'success');
    loadLives();
  } catch (e) { showToast(e.message, 'error'); }
}

async function startCamera(isAudio) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: !isAudio, audio: true });
    liveRoomState.cameraStream = stream;
    const video = document.getElementById('liveCameraVideo');
    const ph = document.getElementById('livePlaceholder');
    if (video) {
      video.srcObject = stream;
      video.classList.remove('hidden');
      video.muted = true;
      video.play().catch(() => {});
      if (ph) ph.classList.add('hidden');
    }
    if (!isAudio) startFrameLoop(liveRoomState.liveId);
  } catch (e) {
    showToast('⚠️ Sem permissão de câmera/microfone — live continua em áudio', 'error');
  }
}

function startFrameLoop(liveId) {
  clearInterval(liveRoomState.frameTimer);
  const canvas = document.createElement('canvas');
  liveRoomState.frameTimer = setInterval(() => {
    const video = document.getElementById('liveCameraVideo');
    if (!video || !video.videoWidth || !liveWs || liveWs.readyState !== 1) return;
    canvas.width = 320;
    canvas.height = Math.max(1, Math.round((video.videoHeight * 320) / video.videoWidth));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.45);
    liveWs.send(JSON.stringify({ type: 'live:frame', liveId, data, hash: simpleHash(data) }));
  }, 900);
}

function startHeartbeat(liveId) {
  clearInterval(liveRoomState.heartTimer);
  liveRoomState.heartTimer = setInterval(() => {
    if (liveWs && liveWs.readyState === 1) liveWs.send(JSON.stringify({ type: 'live:heartbeat', liveId }));
  }, 10000);
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
  return h.toString(36);
}

function closeLiveRoomCleanup() {
  if (liveRoomState.cameraStream) {
    liveRoomState.cameraStream.getTracks().forEach(t => t.stop());
    liveRoomState.cameraStream = null;
  }
  clearInterval(liveRoomState.frameTimer);
  clearInterval(liveRoomState.heartTimer);
  if (liveWs) {
    try { if (liveRoomState.liveId) liveWs.send(JSON.stringify({ type: 'live:leave', liveId: liveRoomState.liveId })); } catch (e) {}
    try { liveWs.close(); } catch (e) {}
    liveWs = null;
  }
  liveRoomState.liveId = null;
  liveRoomState.isStreamer = false;
}

// ============================================================
// SEARCH
// ============================================================
function doSearch(q) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    if (!q || q.length < 2) {
      document.getElementById('searchResults').innerHTML = '<div class="empty-state" style="padding:40px">🔍 Digite para buscar</div>';
      return;
    }
    try {
      const d = await api(`/search?q=${encodeURIComponent(q)}`);
      let html = '';
      if (d.users.length) {
        html += `<h3 style="margin:12px 0 8px;font-size:16px">👤 Usuários</h3>`;
        d.users.forEach(u => html += `
          <div class="search-item" onclick="viewProfile('${u.id}')">
            <div class="search-avatar">${(u.display_name || u.username)[0].toUpperCase()}</div>
            <div><strong>${u.display_name || u.username}</strong><br><small style="color:#888">@${u.username}${u.profile_id ? ' · ' + escapeHtml(u.profile_id) : ''}</small></div>
          </div>`);
      }
      if (d.posts.length) {
        html += `<h3 style="margin:12px 0 8px;font-size:16px">📝 Posts</h3>`;
        d.posts.forEach(p => html += `
          <div class="search-item" onclick="showComments('${p.id}')">
            <div style="flex:1"><p style="font-size:13px">${escapeHtml(p.text).substring(0,80)}...</p><small style="color:#888">${p.display_name || p.username}</small></div>
          </div>`);
      }
      if (d.lives.length) {
        html += `<h3 style="margin:12px 0 8px;font-size:16px">📺 Lives</h3>`;
        d.lives.forEach(l => html += `
          <div class="search-item" onclick="enterLive('${l.id}')">
            <div style="font-size:24px;margin-right:12px">🔴</div>
            <div><strong>${l.title}</strong><br><small style="color:#888">${l.display_name || l.username}</small></div>
          </div>`);
      }
      if (!html) html = '<div class="empty-state" style="padding:40px">Nada encontrado para "' + q + '"</div>';
      document.getElementById('searchResults').innerHTML = html;
    } catch (e) {}
  }, 500);
}

// ============================================================
// CHAT
// ============================================================
async function loadChats() {
  try {
    const d = await api('/chats');
    const container = document.getElementById('chatsContainer');
    if (!d.chats || d.chats.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:30px">💬 Nenhuma conversa<br><button class="btn-primary" style="margin-top:12px" onclick="newChat()">Nova Conversa</button></div>`;
      return;
    }
    container.innerHTML = d.chats.map(c => {
      const name = c.other_display_name || c.other_username || 'Usuário';
      const last = c.last_message ? String(c.last_message).substring(0, 40) : 'Clique para conversar';
      return `<div class="chat-item" onclick="openChat('${c.id}', '${escapeHtml(name)}')">
        <div class="chat-avatar">${(c.other_display_name || c.other_username || '?')[0].toUpperCase()}</div>
        <div class="chat-info">
          <strong>${escapeHtml(name)}</strong>
          <p>${escapeHtml(last)}</p>
        </div>
        ${c.unread_count ? `<div class="chat-unread">${c.unread_count}</div>` : ''}
      </div>`;
    }).join('');
  } catch (e) {}
}

function newChat() {
  if (!currentUser) { openAuth(); return; }
  openModal(`
    <div class="new-chat-modal">
      <h3>✏️ Nova Conversa</h3>
      <input type="text" id="searchUserChat" class="form-input" placeholder="Buscar usuário..." oninput="searchUsers(this.value)">
      <div id="userSearchResults"></div>
    </div>
  `);
}

async function searchUsers(q) {
  if (q.length < 2) return;
  try {
    const d = await api(`/search?q=${encodeURIComponent(q)}`);
    let html = '';
    d.users.forEach(u => {
      if (u.id !== currentUser?.id) {
        html += `<div class="search-item" onclick="startChat('${u.id}')">
          <div class="search-avatar">${(u.display_name || u.username)[0].toUpperCase()}</div>
          <div><strong>${u.display_name || u.username}</strong><br><small style="color:#888">@${u.username}${u.profile_id ? ' · ' + escapeHtml(u.profile_id) : ''}</small></div>
        </div>`;
      }
    });
    if (!html) html = '<p style="color:#888;padding:10px">Nenhum usuário encontrado</p>';
    document.getElementById('userSearchResults').innerHTML = html;
  } catch(e) {}
}

async function startChat(userId) {
  try {
    const d = await api('/chats', {
      method: 'POST',
      body: JSON.stringify({ userId })
    });
    closeModal();
    loadChats();
    setTimeout(() => openChat(d.chatId, d.participant_name || 'Usuário'), 300);
  } catch (e) {
    if (e.data?.code === 'FOLLOW_REQUIRED' || (e.message || '').includes('Siga primeiro')) {
      showFollowRequiredModal(userId);
      return;
    }
    showToast(e.message, 'error');
  }
}

function showFollowRequiredModal(userId) {
  openModal(`
    <div class="follow-required-modal">
      <h3>🔒 Siga primeiro para poder conversar</h3>
      <p style="font-size:13px;color:var(--text2)">Para abrir uma conversa é preciso que um de vocês siga o outro. Siga esse usuário para liberar o chat.</p>
      <button class="btn-primary btn-full" onclick="followAndChat('${userId}')">➕ Seguir e conversar</button>
      <button class="btn-secondary btn-full" style="margin-top:8px" onclick="closeModal()">Voltar</button>
    </div>
  `);
}

async function followAndChat(userId) {
  try {
    await api(`/profile/${userId}/follow`, { method: 'POST' });
    closeModal();
    await startChat(userId);
  } catch (e) { showToast(e.message, 'error'); }
}

async function openChat(chatId, partnerName) {
  currentChatId = chatId;
  document.getElementById('chatsContainer').style.display = 'none';
  document.getElementById('chatMessages').classList.remove('hidden');
  document.getElementById('chatPartnerName').textContent = partnerName;
  try {
    const d = await api(`/chats/${chatId}/messages`);
    const container = document.getElementById('messagesContainer');
    container.innerHTML = d.messages.map(m => `
      <div class="msg ${m.sender_id === currentUser?.id ? 'msg-mine' : 'msg-other'}">
        ${m.type && m.type !== 'text' ? `<div class="msg-media">${chatMediaHtml(m)}</div>` : ''}
        ${m.text ? `<div class="msg-text">${escapeHtml(m.text)}</div>` : ''}
        <div class="msg-time">${getTimeAgo(m.created_at)}</div>
      </div>
    `).join('');
    container.scrollTop = container.scrollHeight;
    startChatPoll(chatId);
  } catch (e) { showToast(e.message, 'error'); }
}

function closeChat() {
  clearInterval(chatPollTimer);
  chatPollTimer = null;
  currentChatId = null;
  document.getElementById('chatsContainer').style.display = 'block';
  document.getElementById('chatMessages').classList.add('hidden');
  loadChats();
}

function startChatPoll(chatId) {
  clearInterval(chatPollTimer);
  chatPollTimer = setInterval(() => pollChatMessages(chatId), 4000);
}

async function pollChatMessages(chatId) {
  if (document.getElementById('chatMessages')?.classList.contains('hidden')) return;
  try {
    const d = await api(`/chats/${chatId}/messages`);
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    const wasAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 60;
    container.innerHTML = d.messages.map(m => `
      <div class="msg ${m.sender_id === currentUser?.id ? 'msg-mine' : 'msg-other'}">
        ${m.type && m.type !== 'text' ? `<div class="msg-media">${chatMediaHtml(m)}</div>` : ''}
        ${m.text ? `<div class="msg-text">${escapeHtml(m.text)}</div>` : ''}
        <div class="msg-time">${getTimeAgo(m.created_at)}</div>
      </div>
    `).join('');
    if (wasAtBottom) container.scrollTop = container.scrollHeight;
  } catch (e) {}
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value;
  if (!text || !currentChatId) return;
  input.value = '';
  try {
    const d = await api(`/chats/${currentChatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text })
    });
    const container = document.getElementById('messagesContainer');
    container.insertAdjacentHTML('beforeend', `
      <div class="msg msg-mine">
        <div class="msg-text">${escapeHtml(d.message.text)}</div>
        <div class="msg-time">agora</div>
      </div>
    `);
    container.scrollTop = container.scrollHeight;
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// PROFILE
// ============================================================
async function loadProfile(userId) {
  if (!userId) {
    document.getElementById('profileContainer').innerHTML = '<div class="empty-state" style="padding:40px">👤 Faça login para ver seu perfil</div>';
    return;
  }
  try {
    const d = await api(`/profile/${userId}`);
    const u = d.user;
    const isMe = currentUser?.id === userId;
    const avHtml = u.avatar_url ? `<img src="${u.avatar_url}" alt="">` : (u.display_name || u.username || '?')[0].toUpperCase();
    const followBtn = isMe ? '' : `<button class="edit" onclick="toggleFollow('${userId}', this)">${d.isFollowing ? '✅ Seguindo' : '➕ Seguir'}</button>`;
    const chatBtn = isMe ? '' : `<button class="add" onclick="startChat('${userId}')">💬 Conversar</button>`;
    const signo = u.birth_date ? getZodiac(u.birth_date) : '';
    const tiles = d.posts.length ? d.posts.map(p => `
      <div class="video-tile" onclick="showComments('${p.id}')">
        ${p.media_url ? `<img src="${p.media_url}" alt="">` : `<div class="vt-empty">📝</div>`}
        <span class="vt-views">▶ ${fmtK(p.likes_count || 0)}</span>
        ${p.media_type === 'video' ? '<span class="vt-ic">🎥</span>' : (p.media_type === 'audio' ? '<span class="vt-ic">🎵</span>' : '')}
      </div>`).join('') : '<div class="video-tile"><div class="vt-empty">📷</div></div>';

    document.getElementById('profileContainer').innerHTML = `
      <div class="kw-profile">
        <div class="kw-profile-head">
          <div class="row1">
            <div class="kw-avatar-diamond"><div class="in">${avHtml}</div></div>
            <div class="name-row">
              <h2>${u.family_tag ? `<a class="profile-tag" onclick="event.preventDefault();openFamilyDetail('${u.family_id}')" href="/familia?id=${u.family_id}">[${u.family_tag}]</a>` : ''}${escapeHtml(u.display_name || u.username)} ${u.agency_tag ? `<a class="profile-tag agency" onclick="event.preventDefault();location.href='/agencia'" href="/agencia">[${u.agency_tag}]</a>` : ''} ${u.is_verified || u.role === 'admin' ? '<span class="gold-seal">OURO</span>' : ''}</h2>
              <div class="kw-profile-stats">
                <div><b>${fmtK(u.followers_count || 0)}</b><small>Seguidores</small></div>
                <div><b>${fmtK(u.following_count || 0)}</b><small>Seguindo</small></div>
                <div><b>${fmtK(u.total_likes || 0)}</b><small>Curtidas</small></div>
              </div>
              <div class="kw-profile-meta">@${escapeHtml(u.username)}${u.profile_id ? ' · ' + escapeHtml(u.profile_id) : ''}${signo ? ' · ' + signo : ''}${u.age ? ' · ' + u.age + ' anos' : ''}</div>
              ${u.bio ? `<p class="kw-profile-bio">${escapeHtml(u.bio)}</p>` : ''}
              ${u.visitas != null ? `<div class="kw-visitas" onclick="${isMe ? 'loadVisitors()' : ''}" style="${isMe ? 'cursor:pointer' : ''}">👁️ ${fmtK(u.visitas)} visitas no perfil${isMe ? ' · <u>ver quem visitou</u>' : ''}</div>` : ''}
            </div>
            <button class="share-btn" onclick="shareProfile('${u.id}')">↗</button>
          </div>
          ${isMe ? `
          <div class="kw-profile-creator-btns">
            <button onclick="openCreatorCenter()"><span class="ic">🎯</span>Central do Criador</button>
            <button onclick="openWallet()"><span class="ic">🛍️</span>Loja</button>
            <button onclick="openEconomy()"><span class="ic">▶</span>Player</button>
          </div>` : ''}
          <div class="kw-profile-actions">
            ${followBtn}
            ${chatBtn}
            ${isMe ? `<button class="edit" onclick="editProfile()">✏️ Editar Perfil</button><button class="add" onclick="suggestFriends()">➕ Adicionar amigos</button>` : ''}
          </div>
        </div>
        <div style="padding:0 12px">
          <div class="wallet-section-title" style="margin-top:6px">🎬 Vídeos</div>
          <div class="video-grid">${tiles}</div>
          ${isMe ? `
          <div class="kw-card profile-info-progress" style="margin-top:12px">
            <div class="pip-n">6/7</div>
            <div class="pip-bar"><i></i></div>
            <div style="font-size:11px;color:var(--text2)">Complete seu perfil</div>
          </div>
          <div class="profile-tasks">
            <div class="profile-task"><div class="pt-ic">📱</div><div class="pt-tx"><b>Vincule seu celular</b><small>Segurança da conta</small></div><div class="pt-r">R$ 15</div><button onclick="editProfile()">Vincular</button></div>
            <div class="profile-task"><div class="pt-ic">✏️</div><div class="pt-tx"><b>Definir nome de usuário</b><small>Identidade no app</small></div><div class="pt-r">+50 K Golds</div><button onclick="editProfile()">Definir</button></div>
          </div>` : ''}
        </div>
      </div>`;
  } catch (e) { showToast(e.message, 'error'); }
}

function getZodiac(birthDate) {
  try {
    const m = String(birthDate || '').match(/(\d{1,2})\/(\d{1,2})/);
    if (!m) return '';
    const d = parseInt(m[1], 10), mo = parseInt(m[2], 10);
    const signs = [['Capricórnio',1222,119],['Aquário',120,218],['Peixes',219,320],['Áries',321,419],['Touro',420,520],['Gêmeos',521,620],['Câncer',621,722],['Leão',723,822],['Virgem',823,922],['Libra',923,1022],['Escorpião',1023,1121],['Sagitário',1122,1221]];
    const v = mo * 100 + d;
    for (const [n, a, b] of signs) { if (v >= a && v <= b) return n; }
    return 'Capricórnio';
  } catch (e) { return ''; }
}
// ============================================================
// VISITANTES DO PERFIL — "Quem viu meu perfil"
// ============================================================
async function loadVisitors() {
  if (!currentUser) { openAuth(); return; }
  try {
    const d = await api('/profile/visitantes');
    const data = d.data || {};
    const list = data.visitantes || [];
    let html = `<div style="max-width:440px">
      <h3 style="margin-bottom:4px">👁️ Quem visitou meu perfil</h3>
      <div style="font-size:12px;color:var(--text3);margin-bottom:12px">${fmtK(data.total || 0)} visitas no total</div>`;
    if (!list.length) {
      html += `<p style="color:var(--text3);text-align:center;padding:24px">Ninguém visitou seu perfil ainda</p>`;
    }
    list.forEach(v => {
      html += `<div class="visitor-item" onclick="viewProfile('${v.id}')">
        <div class="kw-avatar-diamond" style="width:44px;height:44px"><div class="in">${v.avatar && v.avatar !== '/default-avatar.png' ? `<img src="${v.avatar}" alt="">` : (v.nome || '?')[0].toUpperCase()}</div></div>
        <div style="flex:1;min-width:0">
          <b style="font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v.family_tag ? `<span style="color:#FFC700">[${escapeHtml(v.family_tag)}]</span> ` : ''}${escapeHtml(v.nome)}</b>
          <small style="color:var(--text3)">@${escapeHtml(v.username)}</small>
        </div>
        <span style="font-size:11px;color:var(--text3)">${getTimeAgo(v.hora)}</span>
      </div>`;
    });
    html += `</div>`;
    openModal(html);
  } catch (e) { showToast(e.message, 'error'); }
}

function shareProfile(id) {
  if (navigator.share) { navigator.share({ title: 'VibeStream', url: location.origin + '/?user=' + id }).catch(() => {}); }
  else { navigator.clipboard && navigator.clipboard.writeText(location.origin + '/?user=' + id).then(() => showToast('Link copiado!', 'success')); }
}
async function suggestFriends() {
  if (!currentUser) { openAuth(); return; }
  try {
    const d = await api('/users');
    const list = (d.users || []).filter(u => u.id !== currentUser.id).slice(0, 8).map(u => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div class="kw-avatar-diamond" style="width:44px;height:44px"><div class="in">${u.avatar_url ? `<img src="${u.avatar_url}" alt="">` : (u.display_name || u.username || '?')[0].toUpperCase()}</div></div>
        <div style="flex:1;min-width:0"><b style="font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(u.display_name || u.username)}</b><small style="color:var(--text3)">@${escapeHtml(u.username)}</small></div>
        <button class="btn-primary" style="padding:8px 14px;font-size:12px" onclick="toggleFollow('${u.id}', this)">➕ Seguir</button>
      </div>`).join('') || '<p style="color:var(--text3)">Nenhum usuário encontrado</p>';
    openModal(`<div style="max-width:420px"><h3 style="margin-bottom:10px">➕ Adicionar amigos</h3>${list}</div>`);
  } catch (e) { showToast(e.message, 'error'); }
}

function viewProfile(userId) {
  switchPage('Profile');
  loadProfile(userId);
}

async function toggleFollow(userId, btn) {
  if (!currentUser) { openAuth(); return; }
  try {
    const d = await api(`/profile/${userId}/follow`, { method: 'POST' });
    btn.textContent = d.following ? '✅ Seguindo' : '➕ Seguir';
    loadProfile(userId);
  } catch (e) { showToast(e.message, 'error'); }
}

function editProfile() {
  const ageLabel = currentUser.age ? currentUser.age + ' anos' : '—';
  const restrictLabel = currentUser.restriction_level === 'restricted' ? 'Acesso restrito (15-17)' : (currentUser.age >= 18 ? 'Acesso completo' : 'Verifique sua data de nascimento');
  openModal(`
    <div class="edit-profile">
      <h3>✏️ Editar Perfil</h3>
      <div class="edit-avatar-row">
        <div class="profile-avatar-large" id="editAvatar">${currentUser.avatar_url ? `<img class="profile-avatar-img" src="${currentUser.avatar_url}" alt="">` : (currentUser.displayName || currentUser.username || '?')[0].toUpperCase()}</div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn-secondary" style="flex:1" onclick="uploadAvatar()">📷 Trocar Foto</button>
        <button class="btn-secondary" style="flex:1" onclick="removeAvatar()">🗑️ Remover</button>
      </div>
      <input type="text" id="editUsername" class="form-input" placeholder="Nome de usuário" value="${escapeHtml(currentUser.username || '')}">
      <input type="text" id="editName" class="form-input" placeholder="Nome de exibição" value="${escapeHtml(currentUser.displayName || '')}">
      <input type="text" id="editBirth" class="form-input" placeholder="Data de nascimento (dd/mm/aaaa)" value="${escapeHtml(currentUser.birth_date || '')}">
      <p id="editAgeStatus" class="age-status"></p>
      <textarea id="editBio" class="form-input" placeholder="Bio" rows="3">${escapeHtml(currentUser.bio || '')}</textarea>
      <p style="font-size:12px;color:var(--text2);margin-bottom:12px">Idade atual: ${ageLabel} · ${restrictLabel}</p>
      <button class="btn-primary btn-full" onclick="saveProfile()">Salvar Alterações</button>
    </div>
  `);
  const birthInput = document.getElementById('editBirth');
  if (birthInput) birthInput.oninput = () => onBirthInput(birthInput.value, 'editAgeStatus');
  if (currentUser.birth_date) onBirthInput(currentUser.birth_date, 'editAgeStatus');
}

async function saveProfile() {
  const username = document.getElementById('editUsername').value;
  const displayName = document.getElementById('editName').value;
  const bio = document.getElementById('editBio').value;
  const birthDate = document.getElementById('editBirth').value;
  if (birthDate && birthDate.trim() !== '') {
    onBirthInput(birthDate, 'editAgeStatus');
    if (birthValid === false) { showToast('⚠️ Não permitido para menores de 15 anos', 'error'); return; }
    if (birthValid !== true) { showToast('Data de nascimento inválida', 'error'); return; }
  }
  try {
    await api('/profile', { method: 'PUT', body: JSON.stringify({ username, displayName, bio, birthDate }) });
    closeModal(); showToast('✅ Perfil atualizado!', 'success');
    await checkAuth();
    updateAuthUI();
    loadProfile(currentUser.id);
  } catch (e) { showToast(e.message, 'error'); }
}

function uploadAvatar() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { showToast('Imagem muito grande (máx 4MB)', 'error'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const d = await api('/profile/avatar', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result }) });
        currentUser.avatar_url = d.avatar_url;
        const el = document.getElementById('editAvatar');
        if (el) el.innerHTML = `<img class="profile-avatar-img" src="${d.avatar_url}" alt="">`;
        updateAuthUI();
        showToast('✅ Foto atualizada!', 'success');
      } catch (e) { showToast(e.message, 'error'); }
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

async function removeAvatar() {
  try {
    await api('/profile', { method: 'PUT', body: JSON.stringify({ avatarUrl: '' }) });
    currentUser.avatar_url = '';
    const el = document.getElementById('editAvatar');
    if (el) el.textContent = (currentUser.displayName || currentUser.username || '?')[0].toUpperCase();
    updateAuthUI();
    showToast('🗑️ Foto removida', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// NOTIFICATIONS
// ============================================================
async function loadNotifications() {
  if (!currentUser) { updateNotifBadge(0); return; }
  try {
    const d = await api('/notifications');
    updateNotifBadge(d.unread || 0);
  } catch (e) {}
}

function updateNotifBadge(n) {
  const b = document.getElementById('notifBadge');
  if (!b) return;
  b.textContent = n > 99 ? '99+' : n;
  b.classList.toggle('hidden', !n);
}

async function showNotifications() {
  if (!currentUser) { openAuth(); return; }
  try {
    const d = await api('/notifications');
    updateNotifBadge(d.unread || 0);
    let html = `<div class="notif-modal"><h3>🔔 Notificações</h3><div class="notif-list">`;
    if (!d.notifications.length) {
      html += `<p style="color:var(--text2);padding:20px;text-align:center">Nenhuma notificação no momento</p>`;
    }
    d.notifications.forEach(n => {
      const icon = { like: '❤️', comment: '💬', follow: '👤', visita: '👁️', familia: '👥', agencia: '🏢', ban: '🚫', moderation: '⚠️', live_started: '🔴', live_ended: '⏹️', live_stopped: '🚨', report: '🚨' }[n.type] || '🔔';
      html += `<div class="notif-item ${n.is_read ? '' : 'unread'}">
        <div class="notif-icon">${icon}</div>
        <div class="notif-body">
          <p>${escapeHtml(n.text)}</p>
          <small>${getTimeAgo(n.created_at)}</small>
        </div>
      </div>`;
    });
    html += `</div></div>`;
    openModal(html);
    await api('/notifications/read', { method: 'POST' });
    updateNotifBadge(0);
  } catch (e) {}
}

// ============================================================
// UTILITIES
// ============================================================
function getTimeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'Z');
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// CARTEIRA + SAQUE PIX
// ============================================================
async function openWallet() {
  if (!currentUser) return openAuth();
  try {
    const d = await api('/wallet');
    const w = d.wallet || { balance: 0, pending: 0 };
    const tx = (d.transactions || []).slice(0, 10).map(t =>
      `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span>${t.type} — ${t.description || ''}</span>
        <span style="color:${t.amount >= 0 ? 'var(--success)' : 'var(--danger)'}">${t.amount >= 0 ? '+' : ''}R$ ${Number(t.amount).toFixed(2)}</span>
      </div>`).join('');
    openModal(`
      <div class="wallet-modal">
        <h2>💰 Carteira</h2>
        <div class="wallet-balance">
          <div class="stat"><strong>R$ ${Number(w.balance || 0).toFixed(2)}</strong> saldo</div>
          <div class="stat"><strong>${tx ? 'Histórico' : '—'}</strong></div>
        </div>
        <div style="max-height:180px;overflow-y:auto">${tx || '<p style="color:var(--text3);font-size:13px">Sem movimentações ainda. Poste vídeos para ganhar!</p>'}</div>
        <h3 style="margin:14px 0 8px">💸 Sacar via PIX</h3>
        <input type="number" id="wdAmount" class="form-input" placeholder="Valor (mín R$ 5,00)" min="5" step="0.01">
        <select id="wdType" class="form-input" style="margin-top:8px">
          <option value="cpf">CPF</option><option value="email">E-mail</option>
          <option value="telefone">Telefone</option><option value="aleatoria">Chave aleatória</option>
        </select>
        <input type="text" id="wdKey" class="form-input" style="margin-top:8px" placeholder="Chave PIX">
        <button class="btn-primary btn-full" style="margin-top:12px" onclick="submitWithdraw()">Solicitar Saque</button>
        <div id="wdMsg" style="margin-top:8px;font-size:13px"></div>
      </div>
    `);
  } catch (e) { showToast(e.message, 'error'); }
}
async function openEconomy() {
  if (!currentUser) { openAuth(); return; }
  try {
    const [eco, pkgs, vip] = await Promise.all([
      api('/economy/me'),
      api('/recharge/packages'),
      api('/vip/plans')
    ]);
    const packHtml = (pkgs.packages || []).map(p => `
      <div style="display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-top:8px;background:var(--card)">
        <div><strong>${escapeHtml(p.label)}</strong><br><span style="font-size:12px;color:var(--text3)">R$ ${Number(p.price).toFixed(2)}</span></div>
        <button class="btn-primary" style="padding:8px 14px" onclick="buyPackage('${p.id}')">Comprar</button>
      </div>`).join('');
    const vipHtml = (vip.plans || []).map(pl => `
      <div style="display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-top:8px;background:var(--card)">
        <div><strong>👑 ${escapeHtml(pl.name)}</strong><br><span style="font-size:12px;color:var(--text3)">${pl.price_coins} moedas · ${pl.days} dias · ${escapeHtml((pl.perks||[]).join(', '))}</span></div>
        <button class="btn-secondary" style="padding:8px 14px" onclick="activateVip('${pl.id}')">Ativar</button>
      </div>`).join('');
    openModal(`
      <div class="wallet-modal" style="max-width:440px">
        <h2>💎 Loja VibeStream</h2>
        <div style="display:flex;gap:10px;margin:12px 0">
          <div style="flex:1;border:1px solid var(--border);border-radius:12px;padding:10px;text-align:center;background:var(--card)"><div style="font-size:20px">💎</div><strong>${Number(eco.coins||0)}</strong><div style="font-size:11px;color:var(--text3)">moedas</div></div>
          <div style="flex:1;border:1px solid var(--border);border-radius:12px;padding:10px;text-align:center;background:var(--card)"><div style="font-size:20px">🔷</div><strong>${Number(eco.diamonds||0)}</strong><div style="font-size:11px;color:var(--text3)">diamantes</div></div>
          <div style="flex:1;border:1px solid var(--border);border-radius:12px;padding:10px;text-align:center;background:var(--card)"><div style="font-size:20px">💰</div><strong>R$ ${Number((eco.wallet||{}).balance||0).toFixed(2)}</strong><div style="font-size:11px;color:var(--text3)">carteira</div></div>
        </div>
        ${eco.vip && eco.vip.tier ? `<p style="color:var(--success);font-size:13px">👑 VIP ativo: ${escapeHtml(eco.vip.tier)} até ${String(eco.vip.until||'').slice(0,10)}</p>` : '<p style="color:var(--text3);font-size:13px">Sem VIP ativo — ative um plano abaixo.</p>'}
        <h3 style="margin-top:16px">🛒 Recarga de moedas</h3>
        ${packHtml}
        <h3 style="margin-top:18px">👑 Planos VIP</h3>
        ${vipHtml}
        <div id="ecoMsg" style="margin-top:10px;font-size:13px"></div>
      </div>
    `);
  } catch (e) { showToast(e.message, 'error'); }
}

async function buyPackage(packageId) {
  const msg = document.getElementById('ecoMsg');
  if (msg) msg.textContent = 'Criando pedido...';
  try {
    const d = await api('/recharge/create', { method: 'POST', body: JSON.stringify({ packageId, method: 'pix' }) });
    if (msg) msg.style.color = 'var(--text2)';
    if (msg) msg.innerHTML = 'Pedido criado! Confirme o pagamento (simulação) para receber as moedas.<br><button class="btn-primary" style="margin-top:8px" onclick="confirmRecharge(' + d.orderId + ')">✅ Confirmar pagamento</button>';
    else showToast('Pedido criado! Confirme o pagamento para receber as moedas', 'success');
  } catch (e) { if (msg) msg.textContent = '❌ ' + e.message; else showToast(e.message, 'error'); }
}

async function confirmRecharge(orderId) {
  const msg = document.getElementById('ecoMsg');
  try {
    const d = await api('/recharge/confirm', { method: 'POST', body: JSON.stringify({ orderId }) });
    if (msg) { msg.style.color = 'var(--success)'; msg.textContent = '✅ ' + d.message + ' Saldo: ' + d.balance + ' moedas'; }
    else showToast('✅ ' + d.message, 'success');
    openEconomy();
  } catch (e) { if (msg) msg.textContent = '❌ ' + e.message; else showToast(e.message, 'error'); }
}

async function activateVip(planId) {
  if (!confirm('Ativar este plano VIP?')) return;
  const msg = document.getElementById('ecoMsg');
  try {
    const d = await api('/vip/activate', { method: 'POST', body: JSON.stringify({ planId }) });
    if (msg) { msg.style.color = 'var(--success)'; msg.textContent = '✅ VIP ativado! Saldo: ' + d.coins + ' moedas'; }
    showToast('👑 VIP ativado!', 'success');
    setTimeout(() => openEconomy(), 900);
  } catch (e) {
    if (e.data && e.data.code === 'NO_COINS') { showToast('Moedas insuficientes — faça uma recarga', 'error'); }
    else if (msg) msg.textContent = '❌ ' + e.message;
    else showToast(e.message, 'error');
  }
}

async function submitWithdraw() {
  const amount = document.getElementById('wdAmount').value;
  const pixKey = document.getElementById('wdKey').value;
  const pixType = document.getElementById('wdType').value;
  const msg = document.getElementById('wdMsg');
  if (!amount || Number(amount) < 5) { msg.textContent = 'Valor mínimo R$ 5,00'; return; }
  if (!pixKey || pixKey.trim().length < 4) { msg.textContent = 'Chave PIX inválida'; return; }
  try {
    const d = await api('/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount: Number(amount), pixKey, pixType }) });
    msg.style.color = 'var(--success)';
    msg.textContent = '✅ ' + (d.message || 'Saque solicitado!');
    setTimeout(() => { closeModal(); openWallet(); }, 1200);
  } catch (e) { msg.style.color = 'var(--danger)'; msg.textContent = e.message; }
}

// ============================================================
// AGÊNCIA DE CRIADORES
// ============================================================
async function openAgency() {
  if (!currentUser) return openAuth();
  try {
    const d = await api('/agencies/my');
    const a = d.agency;
    if (!a) {
      openModal(`
        <div class="agency-modal">
          <h2>🏢 Agência de Criadores</h2>
          <p style="font-size:13px;color:var(--text2);margin-bottom:10px">Crie sua agência ou entre com o código de convite.</p>
          <input type="text" id="agName" class="form-input" placeholder="Nome da agência">
          <input type="text" id="agDesc" class="form-input" style="margin-top:8px" placeholder="Descrição (opcional)">
          <button class="btn-primary btn-full" style="margin-top:12px" onclick="createAgency()">Criar Agência</button>
          <hr style="border-color:var(--border);margin:14px 0">
          <input type="text" id="agCode" class="form-input" placeholder="Código (ex: AG-XXXXXX)">
          <button class="btn-secondary btn-full" style="margin-top:8px" onclick="joinAgency()">Entrar com código</button>
          <div id="agInvites" style="margin-top:12px"></div>
        </div>
      `);
      loadInvites();
      return;
    }
    const members = (a.members || []).map(m =>
      `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span>${m.display_name || m.username} ${m.role === 'owner' ? '👑' : ''}</span>
        <span>R$ ${Number(m.total_earnings || 0).toFixed(2)}</span>
      </div>`).join('');
    const canManage = a.my_role === 'owner' || a.my_role === 'manager';
    openModal(`
      <div class="agency-modal">
        <h2>🏢 ${escapeHtml(a.name)}</h2>
        <p style="font-size:13px;color:var(--text2)">Código: <strong>${a.code}</strong> · Comissão: ${a.commission_pct}%</p>
        <div style="display:flex;gap:12px;margin:12px 0">
          <div class="stat"><strong>${(a.members || []).length}</strong> criadores</div>
          <div class="stat"><strong>R$ ${Number(a.total_earnings || 0).toFixed(2)}</strong> ganhos</div>
        </div>
        <h3 style="margin:8px 0">Membros</h3>
        <div style="max-height:200px;overflow-y:auto">${members || '<p style="color:var(--text3)">Sem membros</p>'}</div>
        ${canManage ? `
          <h3 style="margin:12px 0 8px">Convidar criador</h3>
          <input type="text" id="agInviteUser" class="form-input" placeholder="Nome de usuário">
          <button class="btn-primary btn-full" style="margin-top:8px" onclick="sendInvite('${a.id}')">Enviar convite</button>` : ''}
      </div>
    `);
  } catch (e) { showToast(e.message, 'error'); }
}
async function createAgency() {
  const name = document.getElementById('agName').value;
  const description = document.getElementById('agDesc').value;
  if (!name || name.trim().length < 3) return showToast('Nome da agência (mín 3 letras)', 'error');
  try {
    const d = await api('/agencies', { method: 'POST', body: JSON.stringify({ name, description }) });
    showToast('✅ Agência criada! Código: ' + (d.agency.code || ''), 'success');
    closeModal(); openAgency();
  } catch (e) { showToast(e.message, 'error'); }
}
async function joinAgency() {
  const code = document.getElementById('agCode').value;
  if (!code) return showToast('Digite o código', 'error');
  try {
    await api('/agencies/join-code', { method: 'POST', body: JSON.stringify({ code }) });
    showToast('✅ Entrou na agência!', 'success');
    closeModal(); openAgency();
  } catch (e) { showToast(e.message, 'error'); }
}
async function loadInvites() {
  try {
    const d = await api('/agencies/invites');
    const box = document.getElementById('agInvites');
    if (box) {
      box.innerHTML = (d.invites || []).length ? '<h3 style="font-size:14px;margin-bottom:6px">Convites recebidos</h3>' + (d.invites || []).map(i =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:var(--bg3);border-radius:10px;margin-bottom:6px;font-size:13px">
          <span>🏢 ${escapeHtml(i.name)}</span>
          <span><button class="btn-sm" onclick="acceptInvite('${i.id}')">Aceitar</button></span>
        </div>`).join('') : '';
    }
  } catch (e) {}
}
async function acceptInvite(id) {
  try {
    await api('/agencies/invites/' + id + '/accept', { method: 'POST' });
    showToast('✅ Convite aceito!', 'success');
    closeModal(); openAgency();
  } catch (e) { showToast(e.message, 'error'); }
}
async function sendInvite(agencyId) {
  const username = document.getElementById('agInviteUser').value;
  if (!username) return showToast('Digite o nome de usuário', 'error');
  try {
    const d = await api('/agencies/' + agencyId + '/invite', { method: 'POST', body: JSON.stringify({ username }) });
    showToast('✅ ' + d.message, 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// CAMPANHAS
// ============================================================
async function openCampaigns() {
  try {
    const d = await api('/campaigns');
    const list = (d.campaigns || []).map(c => `
      <div style="padding:12px;background:var(--bg3);border-radius:12px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between">
          <strong>🎯 ${escapeHtml(c.title)}</strong>
          <span style="color:var(--success);font-weight:700">R$ ${Number(c.reward || 0).toFixed(2)}</span>
        </div>
        <p style="font-size:13px;color:var(--text2);margin:6px 0">${escapeHtml(c.description || '')}</p>
        <small style="color:var(--text3)">Meta: ${c.required_views} visualizações · ${c.participants} participantes</small>
        <div style="margin-top:8px">
          ${c.joined === 'concluido' ? '<span style="color:var(--success);font-size:13px">✅ Concluído</span>'
            : c.joined === 'participando' ? '<span style="color:var(--warning);font-size:13px">⏳ Participando</span>'
            : `<button class="btn-primary btn-full" onclick="joinCampaign('${c.id}')">Participar</button>`}
        </div>
      </div>`).join('');
    openModal(`
      <div class="campaigns-modal">
        <h2>🎯 Campanhas</h2>
        <p style="font-size:13px;color:var(--text2);margin-bottom:12px">Participe, poste vídeos e ganhe recompensas.</p>
        ${list || '<p style="color:var(--text3)">Nenhuma campanha ativa no momento</p>'}
      </div>
    `);
  } catch (e) { showToast(e.message, 'error'); }
}
async function joinCampaign(id) {
  try {
    await api('/campaigns/' + id + '/join', { method: 'POST' });
    showToast('✅ Você entrou na campanha!', 'success');
    closeModal(); openCampaigns();
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// K GOLDS — CARTEIRA / GANHAR DINHEIRO (estilo Kwai)
// ============================================================
let walletData = null;
function fmtK(n) {
  n = Number(n || 0);
  if (n >= 1000000) return (n / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' milhão';
  if (n >= 1000) return (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return String(n);
}
function fmtReais(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function openWallet() {
  currentPage = 'Wallet';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('pageWallet').classList.add('active');
  loadWallet();
}
function closeWallet() { switchPage('Profile'); }
function goWatch() { switchPage('Feed'); showToast('🎬 Assista vídeos para ganhar K Golds (306/min)', 'success'); }

async function loadWallet() {
  const box = document.getElementById('walletContainer');
  box.innerHTML = `<div class="wallet-page" style="padding:40px;text-align:center;color:var(--text3)">Carregando carteira…</div>`;
  try {
    const d = await api('/economy/wallet');
    walletData = d.data || d;
    const w = walletData;
    const checkinBtn = w.checkin && w.checkin.done
      ? '<button class="bub-btn done">✅ Feito</button>'
      : '<button class="bub-btn" onclick="doCheckin()">Coletar</button>';
    const rankHtml = (w.ranking || []).length
      ? w.ranking.map((r, i) => `
        <div class="rank-item">
          <span class="rk-pos">${i + 1}</span>
          <div class="rk-av">${r.avatar_url ? `<img src="${r.avatar_url}" alt="">` : (r.display_name || r.username || '?')[0].toUpperCase()}</div>
          <div class="rk-tx"><div class="rk-n">${escapeHtml(r.display_name || r.username)}</div><div class="rk-s">${r.gifts_count || 0} presentes</div></div>
          <span class="rk-v">🪙 ${fmtK(r.hour_golds)}</span>
        </div>`).join('')
      : '<div style="padding:14px;color:var(--text3);font-size:12px;text-align:center">Nenhum presente na última hora — seja o primeiro!</div>';
    const giftsHtml = (w.gifts || []).map(g => `
      <div class="store-item">
        <div class="s-ic">${g.image_url || '🎁'}</div>
        <div class="s-n">${escapeHtml(g.name)}</div>
        <div class="s-p">🪙 ${g.price_coins}</div>
        <button onclick="sendGiftFromStore('${g.id}','${g.name.replace(/'/g, "\\'")}','${g.image_url || '🎁'}',${g.price_coins})">Enviar</button>
      </div>`).join('');
    box.innerHTML = `
      <div class="wallet-page">
        <div class="wallet-topbar">
          <button class="back" onclick="closeWallet()">←</button>
          <div class="wallet-balance">
            <div class="lbl">Saldo em dinheiro (R$)</div>
            <div class="val">R$ <span id="walletReais">${fmtReais(w.wallet.balance)}</span></div>
            <div class="wallet-coins-row">
              <span class="coin-pill"><span class="ic">🪙</span> <span class="k-val" id="walletGolds">${fmtK(w.golds)}</span> <small>K Golds</small></span>
              <span class="coin-pill"><span class="ic">💎</span> <span class="k-val" id="walletDiamonds">${fmtK(w.diamonds)}</span> <small>Diamantes</small></span>
            </div>
          </div>
          <button class="wallet-collect-btn" onclick="loadWallet()">🪙 Coletar<small>atualizar</small></button>
        </div>
        <div class="wallet-body">
          <div class="wallet-bubbles">
            <div class="wallet-bubble"><div class="bub-ic">🎬</div><div class="bub-tx"><div class="bub-v">306</div><div class="bub-l">Veja o vídeo<br>(1 min assistindo)</div></div><button class="bub-btn" onclick="goWatch()">Assistir</button></div>
            <div class="wallet-bubble"><div class="bub-ic">📅</div><div class="bub-tx"><div class="bub-v">475</div><div class="bub-l">Check-in diário</div></div>${checkinBtn}</div>
            <div class="wallet-bubble"><div class="bub-ic">🎁</div><div class="bub-tx"><div class="bub-v">50</div><div class="bub-l">Bônus Diário</div></div><button class="bub-btn" onclick="dailyBonus('bonus50')">Coletar</button></div>
            <div class="wallet-bubble"><div class="bub-ic">🔥</div><div class="bub-tx"><div class="bub-v">30</div><div class="bub-l">Bônus Diário</div></div><button class="bub-btn" onclick="dailyBonus('bonus30')">Coletar</button></div>
          </div>

          <div class="kw-card kw-card-gold">
            <div class="task-limit-head"><span class="clock">⏰</span><b>TAREFA LIMITADA POR TEMPO</b></div>
            <div class="task-limit-body">
              <p>Complete o <b>check-in</b> e ganhe prêmio em <b>DINHEIRO</b> (R$ 15 por 28 dias · R$ 15 por 30 dias)</p>
              <div class="prize-row"><div class="prize-chip"><div class="p-v">R$ 15</div><div class="p-l">28 dias de check-in</div></div><div class="prize-chip"><div class="p-v">R$ 15</div><div class="p-l">30 dias de check-in</div></div></div>
              <button class="btn-red" onclick="doCheckin()">Ir para o Check-in</button>
            </div>
          </div>

          <div class="kw-card challenge-card">
            <div class="ch-top"><span class="ch-ic">🏆</span><b>Desafio 1 bilhão de K Golds</b><small>up to +1000</small></div>
            <div class="challenge-count">800.000.000</div>
            <div class="challenge-bar"><i></i></div>
            <div class="challenge-btns"><button class="btn-gold" onclick="openTreasure()">🎁 Abrir baú</button><button class="btn-luck" onclick="openRoulette()">🎡 Roleta SORTEAR</button></div>
          </div>

          <div class="kw-card">
            <div class="wallet-section-title" style="padding:14px 14px 0">🏆 Ranking por Hora <small>quem ganha mais presentes fica no topo</small></div>
            <div class="rank-list">${rankHtml}</div>
          </div>

          <div class="wallet-actions">
            <button class="btn btn-convert" onclick="convertGolds()">🪙 Converter<small>10.000 Golds = R$ 1</small></button>
            <button class="btn btn-pix" onclick="openWithdrawModal()">💸 Saque PIX<small>mínimo R$ 1</small></button>
          </div>

          <div class="kw-card">
            <div class="wallet-section-title" style="padding:14px 14px 0">🎁 Loja de Presentes <small>envie em lives</small></div>
            <div class="store-grid" style="padding:10px 14px 14px">${giftsHtml}</div>
          </div>
        </div>
      </div>`;
  } catch (e) {
    box.innerHTML = `<div style="padding:40px;text-align:center;color:#ff6b6b">Erro ao carregar carteira:<br>${escapeHtml(e.message)}</div>`;
  }
}

async function doCheckin() {
  if (!currentUser) { openAuth(); return; }
  try {
    const d = await api('/economy/checkin', { method: 'POST' });
    const data = d.data || d;
    showToast('✅ Check-in: +' + data.granted + ' K Golds', 'success');
    loadWallet();
  } catch (e) {
    if (e.data && e.data.alreadyDone) showToast('Check-in já feito hoje', 'error');
    else showToast(e.message, 'error');
  }
}

async function dailyBonus(key) {
  if (!currentUser) { openAuth(); return; }
  try {
    const d = await api('/economy/bonus', { method: 'POST', body: JSON.stringify({ key }) });
    const data = d.data || d;
    showToast('🎉 +' + data.granted + ' K Golds', 'success');
    loadWallet();
  } catch (e) { showToast(e.data && e.data.alreadyDone ? 'Bônus já coletado hoje' : e.message, 'error'); }
}

async function openTreasure() {
  if (!currentUser) { openAuth(); return; }
  openModal(`<div style="text-align:center;padding:10px 6px">
    <div style="font-size:64px">🎁</div>
    <h3 style="margin:8px 0">Abrir Baú do Desafio</h3>
    <p style="font-size:13px;color:var(--text2);margin-bottom:14px">Ganhe <b class="k-gold">+100 K Golds</b> no baú de hoje!</p>
    <button class="btn-gold" style="width:100%" onclick="dailyBonus('bau');closeModal()">🎁 Abrir baú</button>
  </div>`);
}
async function openRoulette() {
  if (!currentUser) { openAuth(); return; }
  openModal(`<div style="text-align:center;padding:10px 6px">
    <div style="font-size:64px">🎡</div>
    <h3 style="margin:8px 0">Roleta SORTEAR</h3>
    <p style="font-size:13px;color:var(--text2);margin-bottom:14px">Gire e ganhe de <b class="k-gold">10 a 200 K Golds</b>!</p>
    <button class="btn-luck" style="width:100%" onclick="dailyBonus('roleta');closeModal()">🎡 SORTEAR</button>
  </div>`);
}

async function convertGolds() {
  if (!currentUser) { openAuth(); return; }
  if (!walletData || walletData.golds < 10000) { showToast('Você precisa de pelo menos 10.000 K Golds', 'error'); return; }
  const amt = prompt('Quantos K Golds converter? (múltiplos de 10.000 — saldo: ' + walletData.golds + ')\n10.000 Golds = R$ 1,00');
  if (!amt) return;
  try {
    const d = await api('/economy/convert', { method: 'POST', body: JSON.stringify({ golds: parseInt(amt, 10) || 0 }) });
    const data = d.data || d;
    showToast('💰 Convertidos ' + data.converted + ' Golds → R$ ' + fmtReais(data.reais), 'success');
    loadWallet();
  } catch (e) { showToast(e.message, 'error'); }
}

function openWithdrawModal() {
  if (!currentUser) { openAuth(); return; }
  openModal(`
    <div style="max-width:400px">
      <h3 style="margin-bottom:4px">💸 Saque via PIX</h3>
      <p style="font-size:12px;color:var(--text2);margin-bottom:12px">Valor mínimo: <b>R$ 1,00</b> · Saldo disponível: <b class="k-gold">R$ ${fmtReais(walletData ? walletData.wallet.balance : 0)}</b></p>
      <input type="number" id="wdAmount" class="form-input" placeholder="Valor (R$)" min="1" step="0.01">
      <input type="text" id="wdKey" class="form-input" placeholder="Chave PIX (CPF, e-mail, telefone ou aleatória)" style="margin-top:8px">
      <select id="wdType" class="form-input" style="margin-top:8px;background:var(--card)">
        <option value="cpf">CPF</option><option value="email">E-mail</option>
        <option value="telefone">Telefone</option><option value="aleatoria">Chave aleatória</option>
      </select>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
        <button class="btn-primary" style="flex:1" onclick="submitWithdraw()">Solicitar saque</button>
      </div>
    </div>`);
}
async function submitWithdraw() {
  const amount = document.getElementById('wdAmount').value;
  const pixKey = document.getElementById('wdKey').value.trim();
  const pixType = document.getElementById('wdType').value;
  if (!amount || !pixKey) { showToast('Informe valor e chave PIX', 'error'); return; }
  try {
    const d = await api('/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount, pixKey, pixType }) });
    showToast(d.message || 'Saque solicitado!', 'success');
    closeModal(); loadWallet();
  } catch (e) { showToast(e.message, 'error'); }
}

async function sendGiftFromStore(giftId, name, emoji, price) {
  if (!currentUser) { openAuth(); return; }
  if (!liveRoomState.liveId) { showToast('Entre em uma live para enviar presentes', 'error'); switchPage('Lives'); return; }
  try {
    await sendGift(giftId, name, emoji, price);
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// NOTIFICAÇÕES — popup recompensa K +1500 (uma vez por sessão)
// ============================================================
let notifPopupShown = false;
function showNotifRewardPopupOnce() {
  if (notifPopupShown) return;
  notifPopupShown = true;
  try {
    setTimeout(() => { document.getElementById('notifRewardPopup').classList.remove('hidden'); }, 9000);
  } catch (e) {}
}
function closeNotifPopup() { document.getElementById('notifRewardPopup').classList.add('hidden'); }
async function claimNotifReward() {
  try {
    const d = await api('/economy/notif-reward', { method: 'POST' });
    const data = d.data || d;
    showToast('🔔 +' + data.granted + ' K Golds!', 'success');
  } catch (e) { showToast(e.data && e.data.alreadyDone ? 'Recompensa já resgatada' : e.message, 'error'); }
  closeNotifPopup();
  loadWallet();
}

// ============================================================
// K GOLDS — TEMPO ASSISTINDO (306 por minuto)
// ============================================================
let watchAccum = 0;
function startWatchTracker() {
  if (window.__watchTimer) return;
  window.__watchTimer = setInterval(() => {
    if (!currentUser) return;
    if (document.hidden) return;
    const page = document.querySelector('.page.active');
    if (!page) return;
    const id = page.id;
    if (id !== 'pageFeed' && id !== 'pageLives') return;
    watchAccum += 30;
    if (watchAccum >= 60) {
      sendWatch(watchAccum);
      watchAccum = 0;
    }
  }, 30000);
}
async function sendWatch(seconds) {
  try {
    await api('/economy/watch', { method: 'POST', body: JSON.stringify({ seconds }) });
  } catch (e) {}
}

// ============================================================
// LIVE ÁUDIO (estilo Poppo) — sala com host gigante + convidados
// ============================================================
function openAudioLiveRoom(live, d, isStreamer) {
  liveRoomState = { liveId: live.id, isStreamer, cameraStream: null, frameTimer: null, heartTimer: null };
  const hostName = escapeHtml(live.display_name || live.username || 'Anfitrião');
  const hostInitial = (live.display_name || live.username || '?')[0].toUpperCase();
  const hostTag = live.family_tag ? '<span class="vip-badge" style="background:linear-gradient(90deg,#7C3AED,#06B6D4);color:#fff">[' + escapeHtml(live.family_tag) + ']</span>' : (live.agency_tag ? '<span class="vip-badge" style="background:linear-gradient(90deg,#FFB300,#FFC700);color:#221a00">[' + escapeHtml(live.agency_tag) + ']</span>' : '');
  const avatarHtml = live.avatar_url ? `<img src="${live.avatar_url}" alt="">` : hostInitial;
  openModal(`
    <div class="audio-live-room">
      <div class="audio-live-top">
        <div class="audio-host-row">
          <div class="audio-host-av">${live.avatar_url ? `<img src="${live.avatar_url}" alt="">` : hostInitial}</div>
          <div class="audio-host-info">
            <div class="audio-host-name">${hostTag} ${hostName} <span class="vip-badge">VIP ${live.vip_tier ? live.vip_tier.replace('vip','') : '1'}</span></div>
            <div class="audio-host-stats"><span class="fire">🔥 ${fmtK(3479 + (live.viewer_count || 0))}</span><span>👑 ${25 + (d.likes_count || 0)}</span><span>🎧 <span id="audioViewerCount">${live.viewer_count || 0}</span> espectadores</span></div>
          </div>
          <button class="audio-live-close" onclick="closeModal()">✕</button>
        </div>
        <div class="audio-live-subbar">
          <span class="chip hot">🏆 Ranking por Hora</span>
          <span class="chip">🎙 Áudio</span>
          <span class="chip" style="cursor:pointer;background:linear-gradient(90deg,#FF3B30,#ff8a3d);color:#fff;border:0" onclick="startPkBattle()">⚔️ PK</span>
        </div>
        <div class="festival-banner"><span class="fb-ic">💎</span><div><b>Festival de Diamantes</b><small>Envie presentes e suba no ranking</small></div></div>
        <div class="gift-goal">
          <div class="gg-top"><span>🎯 Meta de presentes <b>Desej... 5/500</b></span><span>0%</span></div>
          <div class="gg-bar"><i></i></div>
          <div class="gg-recv"><span style="font-size:11px;color:var(--text2)">Receber presentes</span><button onclick="liveGift()">🎁 Presentes</button></div>
        </div>
      </div>

      <div class="audio-stage">
        <span class="audio-live-chip">🔴 AO VIVO</span>
        <span class="audio-tag">ÁUDIO</span>
        <div class="big-av">${avatarHtml}</div>
        <div class="wave-wrap"><span></span><span></span><span></span><span></span><span></span></div>
        <div class="guest-slots">
          <div class="guest-slot"><div class="gs-av">😀<span class="gs-add" onclick="inviteGuest()">+</span></div><div class="gs-n">Convidar</div><div class="gs-g">0</div></div>
          <div class="guest-slot"><div class="gs-av">🙂<span class="gs-add" onclick="inviteGuest()">+</span></div><div class="gs-n">Convidar</div><div class="gs-g">0</div></div>
          <div class="guest-slot"><div class="gs-av">😎<span class="gs-add" onclick="inviteGuest()">+</span></div><div class="gs-n">Convidar</div><div class="gs-g">0</div></div>
        </div>
      </div>

      <div class="audio-chat-area">
        <div class="audio-chat-list" id="audioChatList"></div>
        <div class="audio-input-row">
          <input type="text" id="audioChatInput" placeholder="Diga algo..." onkeydown="if(event.key==='Enter')sendAudioComment()">
          <button onclick="sendAudioComment()">➤</button>
          <button class="mic ${isStreamer ? 'on' : ''}" onclick="audioMicToggle(this)" title="Microfone">🎤</button>
          <button onclick="liveGift()" title="Presentes">🎁</button>
          <button onclick="liveLike()" title="Curtir">❤️</button>
        </div>
      </div>
    </div>`);
  renderLiveComments(d.messages || []);
  if (live.family_id) loadFamilyGuests(live.family_id);
  connectLiveWs(live.id, isStreamer, true);
}

async function loadFamilyGuests(familyId) {
  try {
    const d = await api('/familias/' + familyId);
    const f = d.data;
    if (!f || !f.membros || !f.membros.length) return;
    const slots = f.membros.slice(1, 4); // convidados (sem o host)
    const wrap = document.querySelector('.guest-slots');
    if (!wrap || !slots.length) return;
    const html = slots.map(m => `
      <div class="guest-slot">
        <div class="gs-av">${m.avatar && m.avatar !== '/default-avatar.png' ? `<img src="${m.avatar}" alt="">` : (m.nome || m.username || '?')[0].toUpperCase()}<span class="gs-add" onclick="inviteGuest()">+</span></div>
        <div class="gs-n">${escapeHtml((m.nome || m.username || '').slice(0, 12))}</div>
        <div class="gs-g">🪙 ${m.golds}</div>
      </div>`).join('');
    wrap.innerHTML = html + '<div class="guest-slot"><div class="gs-av">➕<span class="gs-add" onclick="inviteGuest()">+</span></div><div class="gs-n">Convidar</div><div class="gs-g">0</div></div>';
  } catch (e) {}
}
function startPkBattle() {
  if (!liveRoomState.liveId) return;
  openModal(`<div style="text-align:center;padding:10px">
    <div style="font-size:56px">⚔️</div>
    <h3 style="margin:8px 0">Batalha PK de Famílias</h3>
    <p style="font-size:13px;color:var(--text2);margin-bottom:14px">Desafie outra família! Os presentes enviados nesta live contam pontos para o ranking.</p>
    <div style="display:flex;gap:10px">
      <button class="btn-primary" style="flex:1" onclick="closeModal()">Desafiar família</button>
      <button class="btn-secondary" style="flex:1" onclick="closeModal()">Cancelar</button>
    </div>
  </div>`);
}
function sendAudioComment() {
  const input = document.getElementById('audioChatInput');
  const text = input?.value?.trim();
  if (!text) return;
  if (!currentUser) { openAuth(); return; }
  if (liveWs && liveWs.readyState === 1) {
    liveWs.send(JSON.stringify({ type: 'live:comment', liveId: liveRoomState.liveId, text }));
    input.value = '';
  } else { showToast('Desconectado da live', 'error'); }
}
function audioMicToggle(btn) {
  if (!liveRoomState.isStreamer) { showToast('Só o anfitrião controla o microfone', 'error'); return; }
  btn.classList.toggle('on');
  showToast(btn.classList.contains('on') ? '🎤 Microfone ligado' : '🎤 Microfone desligado', 'success');
}
function inviteGuest() { showToast('Convide um amigo pelo chat para entrar no palco', 'success'); }

// ============================================================
// FAMÍLIAS + AGÊNCIAS (Poppo Live)
// ============================================================
function openCreatorCenter() {
  openModal(`
    <div style="max-width:430px">
      <h3 style="margin-bottom:4px">🎯 Central do Criador</h3>
      <p style="font-size:12.5px;color:var(--text2);margin-bottom:14px">Famílias, agências e campanhas.</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn-primary btn-full" onclick="closeModal();openCampaigns()">🎯 Campanhas</button>
        <button class="btn-primary btn-full" style="background:linear-gradient(90deg,#7C3AED,#06B6D4)" onclick="location.href='/familia'">👥 Famílias (ranking)</button>
        <button class="btn-gold btn-full" style="background:linear-gradient(90deg,#FFB300,#FFC700);color:#221a00" onclick="location.href='/familia/criar'">➕ Criar Família — R$ 0</button>
        <button class="btn-primary btn-full" style="background:linear-gradient(90deg,#06B6D4,#3d7bff)" onclick="location.href='/agencia'">🏢 Agências</button>
        <button class="btn-gold btn-full" style="background:linear-gradient(90deg,#FFB300,#FFC700);color:#221a00" onclick="location.href='/agencia/criar'">➕ Solicitar Agência</button>
      </div>
    </div>`);
}
async function openFamilyDetail(id) {
  if (!id) return;
  try {
    const d = await api('/familias/' + id);
    const f = d.data;
    openModal(`
      <div style="max-width:430px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div class="kw-avatar-diamond" style="width:56px;height:56px"><div class="in">${f.logo ? `<img src="${f.logo}" alt="">` : (f.nome || '?')[0]}</div></div>
          <div><h3 style="font-size:1.05rem">${escapeHtml(f.nome)} <span style="color:#FFC700;font-weight:800">[${escapeHtml(f.tag)}]</span></h3>
          <div style="font-size:11.5px;color:var(--text3)">Nível ${f.nivel} · Ranking #${f.ranking} · ${f.membros.length} membros · 🪙 ${f.totalGolds} Golds</div></div>
        </div>
        ${f.descricao ? `<p style="font-size:12.5px;color:var(--text2);margin-bottom:10px">${escapeHtml(f.descricao)}</p>` : ''}
        <div style="max-height:200px;overflow-y:auto;margin-bottom:12px">
          ${f.membros.map(m => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
            <div class="rk-av" style="width:30px;height:30px">${m.avatar && m.avatar !== '/default-avatar.png' ? `<img src="${m.avatar}" alt="">` : (m.nome || m.username || '?')[0].toUpperCase()}</div>
            <div style="flex:1;font-size:12.5px"><b>${escapeHtml(m.nome || m.username)}</b> ${m.role === 'owner' ? '<span class="gold-seal">DONO</span>' : ''}</div>
            <span style="font-size:11px;color:#FFC700;font-weight:800">🪙 ${m.golds}</span></div>`).join('')}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-gold" style="flex:1;background:linear-gradient(90deg,#FFB300,#FFC700);color:#221a00;border:0;border-radius:40px;padding:12px;font-weight:800" onclick="joinFamilyFromModal('${f.id}')">➕ Entrar</button>
          <button class="btn-secondary" style="flex:1" onclick="closeModal()">Fechar</button>
        </div>
      </div>`);
  } catch (e) { showToast(e.message, 'error'); }
}
async function joinFamilyFromModal(id) {
  if (!currentUser) { openAuth(); return; }
  try {
    const d = await api('/familias/' + id + '/entrar', { method: 'POST' });
    showToast(d.data.message, 'success');
    closeModal();
    if (currentPage === 'Profile') loadProfile(currentUser.id);
  } catch (e) { showToast(e.message, 'error'); }
}

// ============================================================
// VIBEAI CREATOR — Criar vídeos com IA
// ============================================================
let aiState = { style: 'shorts', draft: null, generating: false, timer: null };

function aiInit() {
  if (!currentUser) { openAuth(); return; }
  loadAIConfig();
  loadAIHistory();
  const idea = document.getElementById('aiIdea');
  if (idea) idea.oninput = () => {
    const c = document.getElementById('aiIdeaCount');
    if (c) c.textContent = idea.value.length + '/500';
  };
}

async function loadAIConfig() {
  try {
    const d = await api('/ai/config');
    const bal = document.getElementById('aiBalance');
    if (bal) bal.innerHTML = `💎 <b>${d.balance}</b> moedas · <span style="color:var(--text3)">${d.dailyUsed}/${d.dailyLimit} hoje</span> <button class="ai-bal-btn" onclick="openEconomy()">+ Recarregar</button>`;
    const cost = document.getElementById('aiCostText');
    if (cost) cost.textContent = `Cada geração custa ${d.cost} moedas · limite diário: ${d.dailyLimit} vídeos`;
    const box = document.getElementById('aiStyles');
    if (box) {
      box.innerHTML = d.styles.map(st => `
        <button class="ai-style ${st.key === aiState.style ? 'active' : ''}" data-key="${st.key}" style="--c1:${st.colors[0]};--c2:${st.colors[st.colors.length - 1]}" onclick="aiSelectStyle('${st.key}', this)">
          ${st.emoji} ${st.label}
        </button>`).join('');
    }
  } catch (e) { /* sessão expirada */ }
}

function aiSelectStyle(key, el) {
  aiState.style = key;
  document.querySelectorAll('.ai-style').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
}

function aiProgress(percent, text) {
  const box = document.getElementById('aiProgress');
  const fill = document.getElementById('aiProgressFill');
  const label = document.getElementById('aiProgressText');
  if (!box) return;
  box.style.display = 'block';
  if (fill) fill.style.width = percent + '%';
  if (label) label.textContent = text;
}

async function aiGenerate() {
  if (aiState.generating) return;
  const idea = document.getElementById('aiIdea').value.trim();
  if (idea.length < 10) { showToast('Escreva uma ideia com pelo menos 10 caracteres', 'error'); return; }
  aiState.generating = true;
  const btn = document.getElementById('aiGenerateBtn');
  if (btn) { btn.disabled = true; btn.textContent = '✦ Gerando…'; }
  aiProgress(5, 'Analisando a ideia…');
  const stages = [
    [20, 'Criando roteiro…'],
    [45, 'Gerando título e descrição…'],
    [65, 'Criando hashtags e legenda…'],
    [85, 'Desenhando a capa…']
  ];
  let i = 0;
  aiState.timer = setInterval(() => {
    if (i < stages.length) { aiProgress(stages[i][0], stages[i][1]); i++; }
  }, 900);
  try {
    const d = await api('/ai/generate', { method: 'POST', body: JSON.stringify({ idea, style: aiState.style }) });
    clearInterval(aiState.timer);
    aiProgress(100, 'Vídeo criado! ✦');
    setTimeout(() => { const p = document.getElementById('aiProgress'); if (p) p.style.display = 'none'; }, 900);
    aiState.draft = d.draft;
    renderAIPreview(d.draft);
    loadAIConfig();
    loadAIHistory();
    showToast(d.message || 'Vídeo criado!', 'success');
  } catch (e) {
    clearInterval(aiState.timer);
    aiProgress(100, 'Falha na geração');
    setTimeout(() => { const p = document.getElementById('aiProgress'); if (p) p.style.display = 'none'; }, 1200);
    if (e.status === 402) {
      openModal(`<div style="max-width:400px;text-align:center;padding:8px">
        <h3>💎 Moedas insuficientes</h3>
        <p style="color:var(--text2);font-size:14px;margin:12px 0">A geração com IA custa ${e.data?.cost || 300} moedas. Recarregue para continuar criando.</p>
        <button class="btn-primary btn-full" onclick="closeModal();openEconomy()">💎 Recarregar moedas</button>
      </div>`);
    } else { showToast(e.message, 'error'); }
  } finally {
    aiState.generating = false;
    if (btn) { btn.disabled = false; btn.textContent = '✦ Gerar Vídeo com IA'; }
  }
}

function renderAIPreview(d) {
  if (!d) return;
  let scriptHtml = '';
  try {
    const sc = typeof d.script === 'string' ? JSON.parse(d.script) : d.script;
    scriptHtml = (sc.scenes || []).map(s => `
      <div class="ai-scene">
        <span class="ai-scene-num">▶</span>
        <div><b>${escapeHtml(s.hook || '')}</b><small>${escapeHtml(s.visual || '')}</small></div>
      </div>`).join('');
  } catch (e) {}
  let htags = d.hashtags;
  if (typeof htags === 'string') { try { htags = JSON.parse(htags); } catch (e) { htags = []; } }
  const tags = (htags || []).map(h => '#' + escapeHtml(h)).join(' ');
  document.getElementById('aiPreview').innerHTML = `
    <div class="ai-preview">
      <h3>👀 Pré-visualização <span class="ai-chip">VibeAI ✦</span></h3>
      <div class="ai-preview-grid">
        <div class="ai-cover"><img src="${d.cover_url || ''}" alt="Capa gerada"><span class="ai-cover-tag">${(aiState.draft && aiState.draft.style) ? '' : ''}✨ Capa gerada pela IA</span></div>
        <div class="ai-preview-fields">
          <label class="ai-label">Título</label>
          <input id="aiEditTitle" class="form-input" value="${escapeHtml(d.title || '')}" maxlength="120">
          <label class="ai-label">Descrição</label>
          <textarea id="aiEditDesc" class="form-input" rows="3" maxlength="1000">${escapeHtml(d.description || '')}</textarea>
          <label class="ai-label">Legenda</label>
          <input id="aiEditCaption" class="form-input" value="${escapeHtml(d.caption || '')}" maxlength="300">
          <label class="ai-label">Hashtags</label>
          <input id="aiEditTags" class="form-input" value="${escapeHtml(tags)}" maxlength="200">
          <div class="ai-scenes">${scriptHtml}</div>
        </div>
      </div>
      <div class="ai-actions">
        <button class="ai-btn-ghost" onclick="aiGenerate()">✦ Regenerar</button>
        <button class="ai-btn-publish" onclick="aiPublish()">🎬 Publicar no Feed</button>
        <button class="ai-btn-ghost danger" onclick="aiReport('${d.id}')">🚨 Denunciar</button>
      </div>
      <p class="ai-note">Você pode editar tudo antes de publicar. O vídeo é montado no seu aparelho e publicado no Feed.</p>
    </div>`;
}

function aiPublish() {
  const d = aiState.draft;
  if (!d) return;
  const title = document.getElementById('aiEditTitle')?.value || d.title;
  const description = document.getElementById('aiEditDesc')?.value || d.description;
  const caption = document.getElementById('aiEditCaption')?.value || d.caption;
  const tagsRaw = document.getElementById('aiEditTags')?.value || '';
  const hashtags = tagsRaw.split(/[,\s#]+/).map(h => h.trim()).filter(Boolean).slice(0, 10);
  openModal(`
    <div class="report-modal" style="max-width:420px">
      <h3>🎬 Gerando seu vídeo</h3>
      <p style="color:var(--text2);font-size:13px;margin:10px 0">A IA está montando o vídeo com seu roteiro… <b>não feche esta janela.</b></p>
      <div class="ai-progress" style="display:block">
        <div class="ai-progress-bar"><i id="pubProgressFill" style="width:10%"></i></div>
        <p id="pubProgressText" style="font-size:12px;color:var(--text3)">Renderizando cenas…</p>
      </div>
    </div>
  `);
  makeAIVideo(d, title)
    .then(async (videoDataUrl) => {
      const p = document.getElementById('pubProgressFill');
      const t = document.getElementById('pubProgressText');
      if (p) p.style.width = '70%';
      if (t) t.textContent = 'Enviando para o servidor…';
      const up = await api('/media', { method: 'POST', body: JSON.stringify({ dataUrl: videoDataUrl }) });
      if (p) p.style.width = '90%';
      if (t) t.textContent = 'Publicando no Feed…';
      const pub = await api(`/ai/drafts/${d.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ videoUrl: up.url, title, description, caption, hashtags })
      });
      if (p) p.style.width = '100%';
      if (t) t.textContent = 'Publicado! ✦';
      closeModal();
      showToast('🎬 Vídeo publicado no Feed!', 'success');
      document.getElementById('aiPreview').innerHTML = '';
      aiState.draft = null;
      loadAIHistory();
      loadAIConfig();
    })
    .catch((e) => {
      closeModal();
      showToast(e.message || 'Falha ao gerar o vídeo', 'error');
    });
}

// Monta o vídeo no canvas (tipografia animada estilo IA) e devolve dataURL webm
function makeAIVideo(d, title) {
  return new Promise((resolve, reject) => {
    const W = 720, H = 1280;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const styleMap = {
      realista: ['#0f2027', '#203a43', '#2c5364'],
      animacao: ['#6a11cb', '#2575fc'],
      cinematografico: ['#141e30', '#243b55', '#0b0f1a'],
      trailer: ['#20002c', '#cbb4d4'],
      shorts: ['#ff0084', '#33001b']
    };
    const colors = styleMap[d.style] || styleMap.shorts;
    let scenes = [];
    try { scenes = (typeof d.script === 'string' ? JSON.parse(d.script) : d.script).scenes || []; } catch (e) {}
    const lines = [title, ...scenes.map(s => s.hook || '')].slice(0, 6);
    const stream = canvas.captureStream(30);
    const mime = (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) ? 'video/webm;codecs=vp9' : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('Erro ao ler o vídeo gerado'));
      fr.readAsDataURL(blob);
    };
    rec.start();
    const totalFrames = 30 * 8; // 8 segundos
    let frame = 0;
    const draw = () => {
      const t = frame / totalFrames;
      const grad = ctx.createLinearGradient(0, 0, W, H);
      colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1 || 1), c));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      // brilho
      ctx.fillStyle = 'rgba(124,58,237,0.25)';
      ctx.beginPath();
      ctx.arc(W * 0.2, H * 0.25, 180 + 40 * Math.sin(t * 6), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(6,182,212,0.2)';
      ctx.beginPath();
      ctx.arc(W * 0.85, H * 0.8, 200 + 40 * Math.cos(t * 5), 0, Math.PI * 2);
      ctx.fill();
      // marca
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('✦ VibeAI', 40, 70);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '18px sans-serif';
      ctx.fillText('VibeStream · Conectando pessoas', 40, 100);
      // texto central
      const lineIdx = Math.min(Math.floor(t * lines.length), lines.length - 1);
      const line = lines[lineIdx] || '';
      const appear = Math.min(1, (t * lines.length - lineIdx) * 3);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * appear) + ')';
      ctx.fillRect(W / 2 - 320, H / 2 - 190, 640, 260);
      ctx.strokeStyle = 'rgba(124,58,237,0.9)';
      ctx.lineWidth = 3;
      ctx.strokeRect(W / 2 - 320, H / 2 - 190, 640, 260);
      ctx.fillStyle = 'rgba(255,255,255,' + appear + ')';
      ctx.font = 'bold 34px sans-serif';
      wrapText(ctx, line, W / 2, H / 2 - 60, 560, 44);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.8 * appear) + ')';
      ctx.font = '20px sans-serif';
      ctx.fillText('✦', W / 2, H / 2 + 150 + Math.sin(t * 8) * 8);
      // progresso
      ctx.fillStyle = 'rgba(124,58,237,0.9)';
      ctx.fillRect(40, H - 60, (W - 80) * t, 6);
      frame++;
      if (frame <= totalFrames) requestAnimationFrame(draw);
      else rec.stop();
    };
    draw();
    const timer = setTimeout(() => { try { rec.stop(); } catch (e) {} }, 15000);
    rec.onstop = (ev) => {
      clearTimeout(timer);
      const blob = new Blob(chunks, { type: 'video/webm' });
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('Erro ao ler o vídeo gerado'));
      fr.readAsDataURL(blob);
    };
  });
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = String(text).split(' ');
  let line = '';
  let ly = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, ly);
      line = w; ly += lineH;
    } else line = test;
  }
  ctx.fillText(line, x, ly);
}

async function loadAIHistory() {
  const box = document.getElementById('aiHistory');
  if (!box) return;
  try {
    const d = await api('/ai/drafts');
    if (!d.drafts || !d.drafts.length) {
      box.innerHTML = `<div class="ai-history-title">📂 Histórico</div><p class="ai-empty">Você ainda não criou vídeos com IA.</p>`;
      return;
    }
    const statusMap = { ready: 'Pronto', published: 'Publicado ✓', generating: 'Gerando…', denied: 'Bloqueado', deleted: 'Removido' };
    box.innerHTML = `<div class="ai-history-title">📂 Histórico (${d.drafts.length})</div>` + d.drafts.map(v => `
      <div class="ai-hist-item" onclick="${v.status === 'ready' ? `aiLoadDraft('${v.id}')` : ''}" style="${v.status === 'ready' ? 'cursor:pointer' : ''}">
        <div class="ai-hist-cover">${v.cover_url ? `<img src="${v.cover_url}" alt="">` : '✦'}</div>
        <div style="flex:1;min-width:0">
          <b>${escapeHtml(v.title || v.idea || 'Sem título')}</b>
          <small>${escapeHtml(v.idea || '').slice(0, 60)}</small>
        </div>
        <span class="ai-status st-${v.status}">${statusMap[v.status] || v.status}</span>
      </div>`).join('');
  } catch (e) {}
}

async function aiLoadDraft(id) {
  try {
    const d = await api('/ai/drafts/' + id);
    aiState.draft = d.draft;
    renderAIPreview(d.draft);
    document.getElementById('aiPreview').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { showToast(e.message, 'error'); }
}

async function aiReport(id) {
  if (!currentUser) { openAuth(); return; }
  openModal(`
    <div class="report-modal">
      <h3>🚨 Denunciar vídeo VibeAI</h3>
      <p style="font-size:13px;color:var(--text2)">Descreva o motivo da denúncia. Vídeos que violam as regras são removidos e o autor pode ser punido.</p>
      <textarea id="aiReportReason" class="form-input" rows="4" placeholder="Ex: conteúdo proibido pelas regras da plataforma"></textarea>
      <button class="btn-primary btn-full" onclick="submitAIReport('${id}')">Enviar denúncia</button>
    </div>
  `);
}

async function submitAIReport(id) {
  const reason = document.getElementById('aiReportReason')?.value;
  if (!reason || reason.trim().length < 5) { showToast('Descreva o motivo da denúncia', 'error'); return; }
  try {
    const d = await api(`/ai/drafts/${id}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
    closeModal();
    showToast(d.message || 'Denúncia enviada!', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

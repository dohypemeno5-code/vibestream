// ============================================================
// VIBEAI CREATOR — Motor de criação com IA do VibeStream
// Gera roteiro, título, descrição, hashtags, legenda e capa.
// A chave de provedor de vídeo fica SOMENTE no servidor (env).
// ============================================================
const crypto = require('crypto');

const STYLES = {
  realista:         { label: 'Realista',       colors: ['#0f2027', '#203a43', '#2c5364'], emoji: '🎬' },
  animacao:         { label: 'Animação',       colors: ['#6a11cb', '#2575fc'],             emoji: '✨' },
  cinematografico:  { label: 'Cinemático',     colors: ['#141e30', '#243b55', '#0b0f1a'],  emoji: '🎥' },
  trailer:          { label: 'Trailer',        colors: ['#20002c', '#cbb4d4'],             emoji: '🍿' },
  shorts:           { label: 'Shorts',         colors: ['#ff0084', '#33001b'],             emoji: '📱' }
};

const COST_PER_GENERATION = 300;       // moedas por vídeo gerado
const DAILY_LIMIT_USER = 3;            // gerações/dia (usuário comum)
const DAILY_LIMIT_VIP = 15;            // gerações/dia (VIP)

// Palavras de segurança para o conteúdo gerado (nunca gerar algo proibido)
const FORBIDDEN_WORDS = ['novinha','novinho','pedof','lolicon','menor','criança','nude','sexo','porn','apologia','arma de fogo','golpe','hacker','trafic','sequestr'];

function hashSeed(str) {
  return crypto.createHash('sha256').update(String(str || '')).digest('hex');
}

function pick(seed, arr) {
  if (!arr.length) return '';
  const n = parseInt(seed.slice(0, 8), 16);
  return arr[n % arr.length];
}

function cleanIdea(idea) {
  return String(idea || '').trim().replace(/\s+/g, ' ').slice(0, 500);
}

// ============================================================
// GERAÇÃO DE ROTEIRO (cena por cena)
// ============================================================
function generateScript(idea, styleKey) {
  const seed = hashSeed(idea + ':' + styleKey);
  const openers = {
    realista: ['A vida real tem detalhes que ninguém vê. Hoje a gente mostra um deles.', 'Começa mais um dia comum — e é exatamente aí que a história mora.'],
    animacao: ['Num mundo de cores impossíveis, alguém resolveu sonhar de verdade.', 'Toda grande aventura começa com um pulo no desconhecido.'],
    cinematografico: ['No silêncio da cidade, um plano muda tudo.', 'Câmera lenta. Respiração presa. O momento que define a história.'],
    trailer: ['Eles avisaram que era impossível.', 'Ninguém acreditava. Até o dia em que tudo mudou.'],
    shorts: ['Você não vai acreditar no que aconteceu.', '3 segundos para entender. 60 segundos para nunca esquecer.']
  };
  const endings = {
    realista: ['E é assim, todo dia, que a cidade continua viva.', 'No fim, o que importa são as pessoas e as histórias que ficam.'],
    animacao: ['E viveram mais uma aventura — até o próximo sonho.', 'No mundo da imaginação, nada termina de verdade.'],
    cinematografico: ['Fim. Ou melhor: o começo de tudo.', 'Alguns finais são apenas o próximo plano.'],
    trailer: ['Este é só o começo. Vem aí.', 'Agora, o resto da história depende de você.'],
    shorts: ['Compartilha pra alguém que precisa ver isso hoje!', 'Se chegou até aqui, esse vídeo é pra você. Segue o perfil!']
  };
  const scenes = [
    { hook: pick(seed, openers[styleKey] || openers.shorts), visual: 'Abertura: ' + idea },
    { hook: 'O cenário se revela: cada detalhe conta uma parte da história.', visual: 'Planos de ambiente com luz e movimento' },
    { hook: 'Aí acontece o momento que muda tudo.', visual: 'Ação principal do tema: ' + idea },
    { hook: 'Olhar atento. Silêncio que fala. Decisão tomada.', visual: 'Close emocional com trilha em crescendo' },
    { hook: pick(seed, endings[styleKey] || endings.shorts), visual: 'Fecho: impacto visual com a assinatura VibeStream' }
  ];
  return { scenes, hook: scenes[0].hook, outro: scenes[4].hook };
}

function generateTitle(idea, styleKey) {
  const seed = hashSeed('t:' + idea + ':' + styleKey);
  const firstWords = idea.split(' ').slice(0, 5).join(' ');
  const templates = {
    realista: [firstWords + ' — a história que ninguém contou', 'Vida real: ' + firstWords],
    animacao: ['Aventura em ' + firstWords, firstWords + ' — edição animada'],
    cinematografico: [firstWords.toUpperCase() + ' | TRAILER', 'O filme de ' + firstWords],
    trailer: [firstWords.toUpperCase() + ': o trailer', 'Em breve: ' + firstWords],
    shorts: [firstWords + ' #Shorts', 'POV: ' + firstWords]
  };
  return pick(seed, templates[styleKey] || templates.shorts).slice(0, 90);
}

function generateDescription(idea, styleKey) {
  return ('🎬 Criado com VibeAI Creator — estilo ' + (STYLES[styleKey]?.label || 'Shorts') + '.\n' +
    '💡 Ideia: ' + idea + '\n' +
    '✨ Roteiro, título, legenda e capa gerados automaticamente pela IA do VibeStream.\n' +
    '📲 Compartilha com quem você acha que vai curtir!').slice(0, 500);
}

function generateHashtags(idea) {
  const words = idea.toLowerCase().replace(/[^a-zà-ú0-9\s]/g, '').split(/\s+/).filter(w => w.length >= 4).slice(0, 4);
  const tags = ['vibestream', 'vibeai', 'criatividade'];
  for (const w of words) if (!tags.includes(w)) tags.push(w);
  return tags.slice(0, 8);
}

function generateCaption(idea) {
  const seed = hashSeed('c:' + idea);
  const caps = [
    'Feito com IA no VibeStream ✦',
    'A IA criou, eu só publiquei 😎',
    'Roteiro, capa e legenda: tudo da VibeAI ✨',
    'Novo vídeo do VibeAI Creator 🎬'
  ];
  return pick(seed, caps);
}

// ============================================================
// CAPA (SVG gerada no servidor — nunca expõe chave)
// ============================================================
function xmlEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateCover(idea, title, styleKey) {
  const st = STYLES[styleKey] || STYLES.shorts;
  const colors = st.colors;
  const stops = colors.map((c, i) => `<stop offset="${i * (100 / (colors.length - 1 || 1))}%" stop-color="${c}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7C3AED"/><stop offset="100%" stop-color="#06B6D4"/>
    </linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="60"/></filter>
  </defs>
  <rect width="720" height="960" fill="url(#bg)"/>
  <circle cx="120" cy="180" r="160" fill="#7C3AED" opacity="0.35" filter="url(#blur)"/>
  <circle cx="640" cy="760" r="190" fill="#06B6D4" opacity="0.30" filter="url(#blur)"/>
  <rect x="30" y="30" width="170" height="52" rx="26" fill="url(#glow)"/>
  <text x="115" y="64" font-family="Arial Black, sans-serif" font-size="22" fill="#fff" text-anchor="middle">✦ VibeAI</text>
  <text x="46" y="300" font-family="Arial Black, sans-serif" font-size="52" fill="#ffffff" font-weight="900">${xmlEsc(title).slice(0, 34)}</text>
  <text x="46" y="380" font-family="Arial, sans-serif" font-size="28" fill="#e2e8f0">${st.emoji} ${xmlEsc(st.label)} · VibeStream</text>
  <rect x="46" y="820" width="628" height="6" rx="3" fill="url(#glow)"/>
  <text x="46" y="880" font-family="Arial, sans-serif" font-size="24" fill="#94a3b8">Conectando pessoas · ${xmlEsc(idea).slice(0, 52)}</text>
</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// ============================================================
// SEGURANÇA: verificação de conteúdo + abuso
// ============================================================
function checkContentSafety(db, text) {
  const moderation = require('./moderation');
  const childSafety = require('./child-safety');
  const lower = String(text || '').toLowerCase();
  for (const w of FORBIDDEN_WORDS) {
    if (lower.includes(w)) return { ok: false, reason: 'Conteúdo proibido pela IA: "' + w + '"' };
  }
  const child = childSafety.matchChild(text);
  if (child) return { ok: false, reason: 'Conteúdo proibido por segurança (' + child + ')' };
  const mod = moderation.moderateText(text, 'post');
  if (mod.status === 'blocked') return { ok: false, reason: mod.reason || 'Conteúdo bloqueado pela moderação' };
  return { ok: true };
}

// ============================================================
// CRÉDITOS, LIMITES E LOGS
// ============================================================
function getBalance(db, userId) {
  const u = db().get('SELECT coins FROM users WHERE id = ?', [userId]);
  return u ? (u.coins || 0) : 0;
}

function getVipTier(db, userId) {
  const u = db().get('SELECT vip_tier, vip_until FROM users WHERE id = ?', [userId]);
  if (!u || !u.vip_tier) return '';
  if (u.vip_until && new Date(u.vip_until) < new Date()) return '';
  return u.vip_tier;
}

function dailyLimit(db, userId) {
  return getVipTier(db, userId) ? DAILY_LIMIT_VIP : DAILY_LIMIT_USER;
}

function usedToday(db, userId) {
  const day = new Date().toISOString().slice(0, 10);
  const r = db().get('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?', [userId, day]);
  return r ? (r.count || 0) : 0;
}

function bumpUsage(db, userId) {
  const day = new Date().toISOString().slice(0, 10);
  db().run('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1', [userId, day]);
}

function spendCredits(db, userId, cost) {
  db().run('UPDATE users SET coins = MAX(coins - ?, 0) WHERE id = ?', [cost, userId]);
}

function log(db, userId, action, status, details, ip) {
  try {
    db().run('INSERT INTO ai_logs (id, user_id, action, status, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))',
      [require('uuid').v4(), userId || '', action, status, String(details || '').slice(0, 300), String(ip || '').slice(0, 64)]);
  } catch (e) {}
}

// ============================================================
// ORQUESTRAÇÃO: gera o pacote completo do vídeo
// ============================================================
function generateBundle(idea, styleKey) {
  const clean = cleanIdea(idea);
  const script = generateScript(clean, styleKey);
  const title = generateTitle(clean, styleKey);
  const description = generateDescription(clean, styleKey);
  const hashtags = generateHashtags(clean);
  const caption = generateCaption(clean);
  const cover = generateCover(clean, title, styleKey);
  return {
    idea: clean, style: styleKey,
    title, description, caption, hashtags,
    cover_url: cover,
    script: JSON.stringify(script),
    hook: script.hook, outro: script.outro
  };
}

module.exports = {
  STYLES, COST_PER_GENERATION, DAILY_LIMIT_USER, DAILY_LIMIT_VIP,
  generateBundle, checkContentSafety, getBalance, getVipTier,
  dailyLimit, usedToday, bumpUsage, spendCredits, log
};

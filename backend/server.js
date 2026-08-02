require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const bcrypt = require('bcryptjs');
const uuid = require('uuid');

const SecureDatabase = require('./database');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Banco de dados seguro
const dbDir = path.join(__dirname, '.data');
const db = new SecureDatabase(dbDir);

// ============================================================
// FIREWALL INTERNO - Proteção contra ataques
// ============================================================
class Firewall {
  constructor() {
    this.blockedIPs = new Set();
    this.requestCount = new Map();
    this.suspiciousPatterns = [
      /(\b)(union\s+select|select\s+.*\s+from|insert\s+into|drop\s+table|--\s|;.*--)(\b)/i,
      /(\b)(<script|javascript:|onerror=|onload=|<iframe|<embed)(\b)/i,
      /(\/proc\/|\/etc\/passwd|\/bin\/sh|\/usr\/bin)/i,
      /(%00|%0d%0a|\.\.\/|\.\\\\)/i,
      /(\b)(cmd=|exec=|eval=|system\(|passthru|shell_exec)(\b)/i,
    ];
    this.loadBlockedList();
    // Whitelist do dono (nunca bloqueado): IPs ou subnets separados por vírgula
    this.whitelist = (process.env.FIREWALL_WHITELIST || '')
      .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    setInterval(() => this.cleanup(), 60000);
  }

  loadBlockedList() {
    try {
      const blockedFile = path.join(__dirname, '.blocked.json');
      if (fs.existsSync(blockedFile)) {
        const data = JSON.parse(fs.readFileSync(blockedFile, 'utf8'));
        if (data.ips) data.ips.forEach(ip => this.blockedIPs.add(ip));
      }
    } catch (e) {}
  }

  saveBlockedList() {
    try {
      fs.writeFileSync(path.join(__dirname, '.blocked.json'), JSON.stringify({ ips: Array.from(this.blockedIPs), updatedAt: new Date().toISOString() }));
    } catch (e) {}
  }

  isWhitelisted(ip) {
    if (!ip) return false;
    const i = String(ip).toLowerCase();
    return this.whitelist.some(w => {
      if (w.includes('/')) {
        const [net, bits] = w.split('/');
        const b = parseInt(bits, 10);
        if (i.includes(':') && b === 64) return i.startsWith(net.replace(/:+$/, '') + ':');
        if (!i.includes(':') && b === 24) return i.split('.').slice(0, 3).join('.') === net.split('.').slice(0, 3).join('.');
        return i === net;
      }
      return i === w;
    });
  }

  blockIP(ip, reason = 'Ataque detectado') {
    if (this.isWhitelisted(ip)) {
      console.log(`[FIREWALL] IP na whitelist do dono — bloqueio ignorado: ${ip}`);
      return;
    }
    this.blockedIPs.add(ip);
    this.saveBlockedList();
    console.log(`[FIREWALL] IP bloqueado: ${ip} - ${reason}`);
    try {
      if (db.initialized) {
        const sec = require('./security');
        sec.createAlert(db.getInstance(), 'ip_bloqueado', 'critico', 'Firewall bloqueou IP ' + ip + ' — ' + reason, ip);
      }
    } catch (e) {}
  }

  checkRequest(ip, pathname, userAgent) {
    const owner = this.isWhitelisted(ip);
    if (this.blockedIPs.has(ip)) {
      if (owner) return { blocked: false }; // dono desbloqueado automaticamente
      return { blocked: true, reason: 'IP bloqueado' };
    }
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(pathname) || pattern.test(userAgent || '')) {
        this.blockIP(ip, 'Padrão suspeito');
        return { blocked: true, reason: 'Ataque detectado' };
      }
    }
    const now = Date.now();
    const windowMs = 60000;
    const maxRequests = 100;
    if (!this.requestCount.has(ip)) this.requestCount.set(ip, []);
    const timestamps = this.requestCount.get(ip);
    const recent = timestamps.filter(t => now - t < windowMs);
    recent.push(now);
    this.requestCount.set(ip, recent);
    if (recent.length > maxRequests && !owner) {
      this.blockIP(ip, 'Rate limit excedido');
      return { blocked: true, reason: 'Muitas requisições' };
    }
    return { blocked: false };
  }

  cleanup() {
    const now = Date.now();
    const windowMs = 60000;
    for (const [ip, timestamps] of this.requestCount.entries()) {
      const recent = timestamps.filter(t => now - t < windowMs);
      if (recent.length === 0) this.requestCount.delete(ip);
      else this.requestCount.set(ip, recent);
    }
  }
}

const firewall = new Firewall();

// Middleware de segurança
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const check = firewall.checkRequest(ip, req.originalUrl, req.headers['user-agent']);
  if (check.blocked) return res.status(403).json({ error: 'Acesso bloqueado' });
  next();
});

app.set('trust proxy', 1);

// CORS: allowlist estrita de origens (apenas domínios próprios e ambientes autorizados).
// Requisições da MESMA origem (site + API juntos) não passam por CORS e continuam funcionando.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://vibestream.com.br,https://www.vibestream.com.br')
  .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // mesma origem / curl / apps nativos
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false); // origem fora da lista: navegador bloqueia
  },
  credentials: true,
  exposedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret']
}));

app.use(express.json({ limit: '16mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// ============================================================
// HEADERS DE SEGURANÇA (Play Store / auditoria)
// ============================================================
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' ws: wss: https:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '));
  next();
});

// Sessão
const sessionMiddleware = session({
  name: 'melhora.sid',
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: 'auto', // Secure automático quando a conexão é HTTPS (via tunnel/cloudflare)
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  }
});
app.use(sessionMiddleware);

// Salas de live em tempo real
const liveRooms = require('./live-rooms');
const gaming = require('./routes-gaming');
const childSafety = require('./child-safety');
const security = require('./security');
const auth = require('./auth');

// Autenticação híbrida: sessão express + token persistente (header/cookie)
app.use((req, res, next) => auth.syncSession(db.getInstance(), req, res, next));

// Backup automático: no boot + a cada 6 horas
const projectDir = path.join(__dirname, '..');
try {
  security.autoBackup(projectDir, 'boot');
  setInterval(() => security.autoBackup(projectDir), 6 * 60 * 60 * 1000);
  console.log('[SECURITY] Backup automático ativo (a cada 6h + boot)');
} catch (e) { console.error('[SECURITY] Backup init:', e.message); }

liveRooms.init(() => db.getInstance());

// ============================================================
// PAINEL FALSO (ISCAS) — registra invasores; o painel real é secreto
// ============================================================
function logDecoyHit(req, action, extra) {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const d = db.getInstance();
    d.run("INSERT INTO security_logs (id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
      [require('uuid').v4(), String(action).slice(0, 40), String(ip || '').slice(0, 64),
       String((extra || req.headers['user-agent'] || '')).slice(0, 200)]);
    const sec = require('./security');
    sec.createAlert(d, 'painel_falso', 'critico', 'Acesso ao painel falso (provável ataque): ' + String(req.originalUrl || '').slice(0, 80) + ' — IP ' + ip, ip, '');
  } catch (e) {}
}

// Login falso (público) — nunca autentica, só registra e bloqueia atacantes
app.post('/api/admin/decoysession', (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const { username, password } = (req.body || {});
    const userAgent = String(req.headers['user-agent'] || '');
    logDecoyHit(req, 'decoy_login');
    try {
      db.getInstance().run("INSERT INTO security_logs (id, action, ip_address, user_agent) VALUES (?, 'decoy_login_cred', ?, ?)",
        [require('uuid').v4(), String(ip).slice(0, 64), 'user=' + String(username || '').slice(0, 60) + ' | pass=' + String(password || '').slice(0, 20) + ' | ' + userAgent.slice(0, 120)]);
    } catch (e) {}
    const count = (db.getInstance().get("SELECT COUNT(*) as c FROM security_logs WHERE action = 'decoy_login_cred' AND ip_address = ? AND created_at > datetime('now', '-10 minutes')", [ip]) || {}).c || 0;
    if (count >= 2) firewall.blockIP(ip, 'Tentativas repetidas no painel falso (ataque)');
  } catch (e) {}
  res.status(401).json({ error: 'Credenciais inválidas' });
});

// Rotas principais da API
app.use('/api', routes(db, firewall));

// Admin - rota secreta escondida
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin_melhora_sup3r_s3cr3t0_2024';
const ADMIN_ROUTE = `/admin-${ADMIN_SECRET}`;

function adminAuth(req, res, next) {
  // 1) Sessão express com usuário
  if (req.session?.userId) {
    const u = db.get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
    if (u && (u.role === 'admin' || u.role === 'moderator')) {
      req.session.role = u.role;
      return next();
    }
    return res.status(403).json({ error: 'Acesso negado - sem permissão administrativa' });
  }
  // 2) Token persistente (sobrevive a reinícios do servidor)
  const resolved = auth.resolve(db, req);
  if (resolved) {
    const u = db.get('SELECT role FROM users WHERE id = ?', [resolved.userId]);
    if (u && (u.role === 'admin' || u.role === 'moderator')) {
      req.session.userId = u.id;
      req.session.role = u.role;
      return next();
    }
    return res.status(403).json({ error: 'Acesso negado - sem permissão administrativa' });
  }
  // 3) Secret de administrador (somente sem sessão de usuário comum)
  if (req.headers['x-admin-secret'] === ADMIN_SECRET && !req.session?.userId) {
    req.session.adminId = ADMIN_SECRET;
    req.session.role = 'admin';
    return next();
  }
  return res.status(401).json({ error: 'Acesso restrito - Área administrativa' });
}

// Página do admin - rota secreta (escondida)
app.get(ADMIN_ROUTE, (req, res) => {
  const token = req.headers['x-admin-secret'] || req.query.secret;
  if (token && token === ADMIN_SECRET) {
    req.session.adminId = ADMIN_SECRET;
    req.session.role = 'admin';
  }
  if (req.session?.userId) {
    const user = db.get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
    if (user && (user.role === 'admin' || user.role === 'moderator')) {
      req.session.role = user.role;
    }
  }
  const adminPath = path.join(__dirname, '..', 'frontend', 'admin', 'index.html');
  // Sem redirect: a própria página mostra a tela de login (checkLogin) ou o painel
  const authed = req.session?.role === 'admin' || req.session?.role === 'moderator';
  fs.readFile(adminPath, 'utf8', (err, html) => {
    if (err) return res.status(500).send('Admin panel not found');
    const injected = html.replace('</head>', `<script>window.__ADMIN_SECRET='${ADMIN_SECRET}';window.__ADMIN_ROUTE='${ADMIN_ROUTE}';window.__VITE_API_URL='${process.env.VITE_API_URL || ''}';window.__ADMIN_AUTH=${authed};window.__ADMIN_ROLE='${req.session?.role || 'user'}';</script></head>`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(injected);
  });
});

// Garante Content-Type JSON em TODAS as respostas de API
app.use('/api', (req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return origJson(body);
  };
  next();
});

// API do admin
app.use(`${ADMIN_ROUTE}/api`, adminAuth, require('./admin-routes')(db, ADMIN_SECRET));

// Catch-all: qualquer rota /api do admin inexistente -> JSON 404 (nunca HTML)
app.use(`${ADMIN_ROUTE}/api`, (req, res) => {
  if (!res.headersSent) { console.log('[404 admin] PID=' + process.pid + ' ' + req.method + ' ' + req.originalUrl); res.status(404).json({ error: 'Endpoint administrativo não encontrado' }); }
});

// VibeGaming: convidados/moderação/estatísticas (antes do :id das lives)
app.use('/api', require('./routes-gaming')(db));

// VibeStream routes
app.use('/api', require('./routes-vibestream')(db));

// Criadores: agências, carteira, saque PIX, campanhas
app.use('/api', require('./creators')(db));
app.use('/api', require('./routes-families')(db));
app.use('/api', require('./routes-moderation')(db));
app.use('/api', require('./routes-ai')(db));
app.use('/api', require('./routes-drama')(db));

// Economia: presentes, moedas, VIP e recargas
app.use('/api', require('./routes-economy')(db, firewall));

// Assets do painel admin: servidos com MIME correto (nunca caem no fallback SPA)
const adminDir = path.join(__dirname, '..', 'frontend', 'admin');
app.get(`${ADMIN_ROUTE}/admin.js`, (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(adminDir, 'admin.js'));
});
app.get(`${ADMIN_ROUTE}/admin.css`, (req, res) => {
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(adminDir, 'admin.css'));
});

function decoyPage() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel Administrativo</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;background:#0f0f1a;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#1a1a2e;border:1px solid #2a2a44;border-radius:16px;padding:36px 32px;width:360px;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.logo{width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#6C5CE7,#3B82F6);display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;margin:0 auto 12px}
h1{font-size:20px;text-align:center;margin-bottom:4px}
.sub{text-align:center;color:#8a8aa3;font-size:13px;margin-bottom:24px}
label{display:block;font-size:12px;color:#a0a0b8;margin:14px 0 6px}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #2a2a44;background:#12121f;color:#fff;font-size:14px;outline:none}
input:focus{border-color:#6C5CE7}
button{width:100%;margin-top:22px;padding:13px;border:0;border-radius:10px;background:linear-gradient(135deg,#6C5CE7,#3B82F6);color:#fff;font-size:15px;font-weight:700;cursor:pointer}
button:active{opacity:.85}
#err{color:#ff6b6b;font-size:13px;text-align:center;margin-top:12px;min-height:18px}
.foot{text-align:center;color:#56567a;font-size:11px;margin-top:20px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">VS</div>
  <h1>VibeStream Admin</h1>
  <div class="sub">Painel Administrativo — acesso restrito</div>
  <label>Usuário</label><input id="u" autocomplete="off">
  <label>Senha</label><input id="p" type="password" autocomplete="off">
  <button onclick="tryLogin()">Entrar</button>
  <div id="err"></div>
  <div class="foot">VibeStream © 2026</div>
</div>
<script>
async function tryLogin(){
  const u=document.getElementById('u').value, p=document.getElementById('p').value;
  document.getElementById('err').textContent='Validando...';
  try{
    const r=await fetch('/api/admin/decoysession',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
    const d=await r.json();
    document.getElementById('err').textContent=(d&&d.error)||'Credenciais inválidas';
  }catch(e){ document.getElementById('err').textContent='Credenciais inválidas'; }
}
document.addEventListener('keydown',e=>{if(e.key==='Enter')tryLogin();});
</script>
</body>
</html>`;
}

const DECOY_PATHS = ['/admin', '/admin/', '/admin/login', '/admin/usuarios', '/admin/dashboard', '/administrador', '/painel', '/painel-admin', '/painel/login', '/admin/painel'];

// Qualquer /admin-* que NÃO seja o painel real -> isca registrada
app.use((req, res, next) => {
  const p = req.path || '';
  if (p.startsWith('/admin-') && p !== ADMIN_ROUTE && !p.startsWith(ADMIN_ROUTE + '/')) {
    logDecoyHit(req, 'decoy_admin_route');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(decoyPage());
  }
  next();
});

// Páginas comuns que atacantes tentam -> isca registrada
app.get(DECOY_PATHS, (req, res) => {
  logDecoyHit(req, 'decoy_page');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(decoyPage());
});



// API 404 handler - sempre retorna JSON, nunca HTML
app.all('/api/*', (req, res) => {
  if (!res.headersSent) { console.log('[404 api/*] PID=' + process.pid + ' ' + req.method + ' ' + req.originalUrl); res.status(404).json({ error: 'Endpoint não encontrado' }); }
});

// Error handler global: nunca vaza stack/detalhes internos
app.use((err, req, res, next) => {
  try {
    console.error('[ERROR]', err && err.message);
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Arquivo muito grande' });
    }
  } catch (e) {}
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Arquivos estáticos
express.static.mime.define({ 'application/vnd.android.package-archive': ['apk'] });
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/apk', express.static(path.join(__dirname, '..', 'frontend', 'apk')));
app.use('/icons', express.static(path.join(__dirname, '..', 'frontend', 'icons')));
app.use('/pwa', express.static(path.join(__dirname, '..', 'frontend', 'pwa')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Páginas
app.get('/download', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'download.html')));
app.get('/gerador.html', (req, res) => res.redirect('/'));
app.get('/promocao', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'promocao.html')));
app.get('/anuncio', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'promocao.html')));
app.get('/regras', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'rules.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'terms.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'contact.html')));
app.get('/delete-account', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'delete-account.html')));
app.get('/familia/criar', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'familia-criar.html')));
app.get('/agencia/criar', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'agencia-criar.html')));
app.get('/familia', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'familia.html')));
app.get('/agencia', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'agencia.html')));

// Rede de segurança: caminhos de API nunca recebem HTML
app.use((req, res, next) => {
  if ((req.path.startsWith('/api/') || req.path.includes('/api/')) && !res.headersSent) {
    console.log('[404 safety] PID=' + process.pid + ' ' + req.method + ' ' + req.originalUrl);
    return res.status(404).json({ error: 'Endpoint não encontrado' });
  }
  next();
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

// Servidor HTTP + WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 1024 * 100, clientTracking: true });

function wsAuth(req) {
  return new Promise((resolvePromise) => {
    sessionMiddleware(req, {}, () => {
      try {
        if (!req.session.userId) {
          const resolved = auth.resolve(db.getInstance(), req);
          if (resolved) {
            req.session.userId = resolved.userId;
            const u = db.getInstance().get('SELECT role FROM users WHERE id = ?', [resolved.userId]);
            if (u) req.session.role = u.role;
          }
        }
      } catch (e) {}
      resolvePromise();
    });
  });
}

function isBlockedText(text) {
  try {
    const terms = db.getInstance().query("SELECT term FROM blocked_terms WHERE is_active = 1");
    const lower = (text || '').toLowerCase();
    for (const t of terms) {
      if (t.term && lower.includes(t.term.toLowerCase())) return t.term;
    }
  } catch (e) {}
  return null;
}

wss.on('connection', async (ws, req) => {
  const ip = req.socket.remoteAddress;
  await wsAuth(req);
  const userId = req.session?.userId || null;
  ws.userId = userId;
  liveRooms.registerUser(ws, userId);
  ws.send(JSON.stringify({ type: 'connected', userId, timestamp: new Date().toISOString() }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const uid = ws.userId;
      const d = () => db.getInstance();

      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }

      if (msg.type === 'live:heartbeat') { liveRooms.heartbeat(msg.liveId); return; }

      if (msg.type === 'live:join') {
        const live = d().get("SELECT * FROM lives WHERE id = ? AND status = 'live'", [msg.liveId]);
        if (!live) { liveRooms.send(ws, { type: 'live:ended', liveId: msg.liveId, reason: 'Live não encontrada ou encerrada' }); return; }
        const room = liveRooms.joinRoom(ws, msg.liveId, uid, live);
        liveRooms.send(ws, {
          type: 'live:joined',
          liveId: msg.liveId,
          live: { id: live.id, title: live.title, category: live.category, type: live.type, user_id: live.user_id },
          viewers: room.sockets.size
        });
        return;
      }

      if (msg.type === 'live:leave') { liveRooms.leaveRoom(ws, msg.liveId); return; }

      if (msg.type === 'live:frame') {
        const room = liveRooms.getRoom(msg.liveId);
        if (!room || room.live.user_id !== uid) return;
        const repeats = liveRooms.setFrame(msg.liveId, msg.data, msg.hash || null);
        liveRooms.heartbeat(msg.liveId);
        liveRooms.broadcast(msg.liveId, { type: 'live:frame', liveId: msg.liveId, data: msg.data });
        if (repeats >= 45) liveRooms.endLive(msg.liveId, 'Transmissão parada detectada (anti-live fake)', 'sistema');
        return;
      }

      if (msg.type === 'live:comment') {
        if (!uid) { liveRooms.send(ws, { type: 'live:error', error: 'Faça login para comentar' }); return; }
        const text = String(msg.text || '').trim().slice(0, 300);
        if (!text) return;
        const blocked = isBlockedText(text);
        if (blocked) { liveRooms.send(ws, { type: 'live:error', error: 'Mensagem não permitida' }); return; }
        const allow = gaming.chatAllowed(msg.liveId, uid, text);
        if (!allow.allowed) {
          liveRooms.send(ws, { type: 'live:error', error: allow.reason });
          if (allow.child) { try { childSafety.applyChildBan(d, { userId: uid, autorId: uid, texto: text, ip: ws.ip || '', userAgent: ws.ua || '', matchedTerm: allow.reason }); } catch (e) {} }
          return;
        }
        const id = uuid.v4();
        const user = d().get('SELECT username, display_name, avatar_url FROM users WHERE id = ?', [uid]);
        d().run('INSERT INTO live_comments (id, live_id, user_id, message) VALUES (?, ?, ?, ?)', [id, msg.liveId, uid, text]);
        liveRooms.broadcast(msg.liveId, {
          type: 'live:comment', liveId: msg.liveId,
          comment: { id, live_id: msg.liveId, user_id: uid, username: user?.username, display_name: user?.display_name, avatar_url: user?.avatar_url, message: text, created_at: new Date().toISOString() }
        });
        return;
      }

      if (msg.type === 'live:reaction') {
        if (!uid) { liveRooms.send(ws, { type: 'live:error', error: 'Faça login para reagir' }); return; }
        const emoji = String(msg.emoji || '').slice(0, 8);
        if (!emoji) return;
        try { d().run('INSERT OR IGNORE INTO live_reactions (id, live_id, user_id, emoji) VALUES (?, ?, ?, ?)', [uuid.v4(), msg.liveId, uid, emoji]); } catch (e) {}
        const counts = d().query('SELECT emoji, COUNT(*) as c FROM live_reactions WHERE live_id = ? GROUP BY emoji ORDER BY c DESC LIMIT 10', [msg.liveId]);
        liveRooms.broadcast(msg.liveId, { type: 'live:reaction', liveId: msg.liveId, emoji, user: uid, counts });
        return;
      }

      if (msg.type === 'live:like' || msg.type === 'live:gift') {
        if (!uid) { liveRooms.send(ws, { type: 'live:error', error: 'Faça login para interagir' }); return; }
        const user = d().get('SELECT username, display_name FROM users WHERE id = ?', [uid]);
        if (msg.type === 'live:like') {
          try { d().run('INSERT OR IGNORE INTO live_likes (id, live_id, user_id) VALUES (?, ?, ?)', [uuid.v4(), msg.liveId, uid]); } catch (e) {}
          const count = (d().get('SELECT COUNT(*) as c FROM live_likes WHERE live_id = ?', [msg.liveId]) || {}).c || 0;
          liveRooms.broadcast(msg.liveId, { type: 'live:like', liveId: msg.liveId, user: { id: uid, username: user?.username, display_name: user?.display_name }, count });
        } else {
          liveRooms.broadcast(msg.liveId, { type: 'live:gift', liveId: msg.liveId, user: { id: uid, username: user?.username, display_name: user?.display_name } });
        }
        return;
      }
    } catch (e) {
      console.error('[WS] erro:', e.message);
    }
  });

  ws.on('close', () => {
    liveRooms.leaveAll(ws);
  });
});

// Watchdog anti-live fake: encerra transmissões sem sinal ou com frame parado
setInterval(() => {
  try {
    const d = db.getInstance();
    const active = d.query("SELECT id, user_id, title FROM lives WHERE status = 'live'");
    for (const l of active) {
      const room = liveRooms.getRoom(l.id);
      if (!room) {
        // Live criada mas ninguém nunca conectou -> encerra após 3 min
        const created = d.get("SELECT created_at FROM lives WHERE id = ?", [l.id]);
        if (created && created.created_at) {
          const t = new Date(created.created_at.replace(' ', 'T') + 'Z').getTime();
          if (Date.now() - t > 180000) liveRooms.endLive(l.id, 'Nenhum sinal de transmissão (anti-live fake)', 'sistema');
        }
        continue;
      }
      if (room.sockets.size === 0 && (Date.now() - room.createdAt) > 180000) {
        liveRooms.endLive(l.id, 'Nenhum sinal de transmissão (anti-live fake)', 'sistema');
        continue;
      }
      if (liveRooms.isStale(l.id)) {
        liveRooms.endLive(l.id, 'Conexão da transmissão perdida (anti-live fake)', 'sistema');
      }
    }
  } catch (e) {}
}, 20000);

async function start() {
  try {
    await db.initialize();
    require('./routes-drama').seedDrama();

    // Aplica migrações do banco de dados
    try {
      require("./migration")(db);
      global.__db = db.getInstance(); // Disponibilizar db global
    } catch(e) {
      console.error("[SERVER] Erro na migração:", e.message);
    }

    // Cria admin automaticamente se não existir
    const adminUser = db.get("SELECT id FROM users WHERE role = 'admin'");
    if (!adminUser) {
      console.log('[SERVER] Criando conta admin...');
      const adminPass = process.env.ADMIN_PASSWORD || 'Admin@2024!MelhoraSecure';
      const hash = await bcrypt.hash(adminPass, 10);
      db.run(
        `INSERT INTO users (id, username, email, password_hash, display_name, role, is_verified, status, diamonds, coins)
         VALUES (?, ?, ?, ?, ?, 'admin', 1, 'active', 999999, 999999)`,
        [uuid.v4(), 'admin', 'admin@melhora.app', hash, 'Administrador']
      );
      console.log(`[SERVER] ✅ Admin criado! User: admin / Pass: ${adminPass}`);
    } else {
      // Atualiza senha do admin no .env
      const adminPass = process.env.ADMIN_PASSWORD || 'Admin@2024!MelhoraSecure';
      const hash = await bcrypt.hash(adminPass, 10);
      db.run('UPDATE users SET password_hash = ? WHERE role = ?', [hash, 'admin']);
    }

    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { mode: 0o755 });

    server.listen(PORT, '0.0.0.0', () => { console.log('[SERVER] Listen PID=' + process.pid);
      console.log(`\n╔══════════════════════════════════════╗`);
      console.log(`║   🔥 MELHORA APP LIVE - ONLINE      ║`);
      console.log(`╠══════════════════════════════════════╣`);
      console.log(`║  📡 Porta: ${PORT}`);
      console.log(`║  🔗 Site: http://localhost:${PORT}`);
      console.log(`║  🔐 Admin: http://localhost:${PORT}${ADMIN_ROUTE}`);
      console.log(`║  🛡️  Firewall: Ativo                ║`);
      console.log(`║  🚫 Anti-DDoS: Configurado          ║`);
      console.log(`╚══════════════════════════════════════╝\n`);
    });
  } catch (error) {
    console.error('[SERVER] Erro fatal:', error);
    process.exit(1);
  }
}

start();

process.on('SIGTERM', () => { db.close(); server.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); server.close(); process.exit(0); });

// Keep Alive
setInterval(() => {
  try {
    db.get("SELECT 1 as alive");
  } catch(e) {}
}, 30000);

// Error handlers
process.on('uncaughtException', (err) => {
  console.error('[SERVER] Erro não tratado:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[SERVER] Promise rejeitada:', err.message);
});

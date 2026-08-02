// ============================================================
// MODERAÇÃO VibeStream — Motor "AnyClaw" (moderação automática 24h)
// Regras da comunidade, anti-abuso, punições progressivas
// ============================================================
const crypto = require('crypto');

// ------------------------------------------------------------
// PADRÕES DE ANÁLISE DE TEXTO
// ------------------------------------------------------------

// Bloqueio TOTAL (conteúdo extremamente proibido)
const HARD_BLOCK_PATTERNS = [
  /estupro/i, /pedofil/i, /cpf falso/i, /rg falso/i, /documento falso/i,
  /amea[çc]a de morte/i, /vou te matar/i, /te mato/i, /te matar/i,
  /vou matar/i, /matar (todos|todas|geral|gays|negros|imigrantes|judeus|mulheres|pobres)/i,
  /mat[oa] (os|as|gays|negros|imigrantes|judeus|mulheres)/i,
  /vou atirar/i, /vou esfaquear/i, /vou atropelar/i, /vou enforcar/i, /vou explodir/i,
  /explodir (a|o|a casa|escola|igreja)/i,
  /morte (aos|as|a os|a as|para)/i,
  /justi[çc]a com as pr[óo]prias m[ãa]os/i,
  /explorar sexual/i, /abuso infantil/i, /nudez infantil/i, /cpf do /i,
  /tirar a vida de/i, /atropelar/i, /esfaquear/i, /enforcar/i
];

// Apologia a crimes / atividades ilegais
const APOLOGIA_PATTERNS = [
  /apologia/i, /viva o tr[áa]fico/i, /viva o crime/i, /como matar/i,
  /como roubar/i, /como fazer bomba/i, /encomendar/i, /tentativa de homic[ií]dio/i,
  /latroc[ií]nio/i, /seqüestro/i, /sequestro de/i
];

// Discurso de ódio (racismo, homofobia, xenofobia, ataques a grupos)
const HATE_PATTERNS = [
  /racista/i, /racismo/i, /negro (?!de bem)/i, /preto (?!bonito|lindo|maravilhoso)/i,
  /macaco/i, /viad[oa]/i, /bicha/i, /sapat[ãa]o/i, /nazista/i, /hitler/i,
  /kkk/i, /xenofob/i, /gordofob/i, /fora (negros|gays|imigrantes|pobres|nordestinos)/i,
  /morte a (os |as )?(negros|gays|judeus|imigrantes|mulheres)/i,
  /(negros|gays|imigrantes|judeus|mulheres|nordestinos) (devem|deveriam|merecem) (morrer|sumir|sair)/i,
  /odeio (negros|gays|imigrantes|judeus|mulheres|nordestinos)/i
];

// Conteúdo para REVISÃO manual
const REVIEW_PATTERNS = [
  /porn/i, /nude/i, /sexo/i, /sex\b/i, /pack/i, /onlyfans/i, /violen/i, /arma/i,
  /trafic/i, /droga/i, /matar/i, /morre/i, /ódio/i, /odio/i, /golpe/i, /roubar/i,
  /novinh/i, /menor de idade/i, /menor de 1[0-9]/i, /adolescent/i,
  /criança/i, /crianca/i, /infantil/i, /sequestr/i, /estupro/i, /privacy/i,
  /conte[úu]do adulto/i, /maior de 18/i, /18 anos/i
];

// Nomes proibidos / impersonação de equipe
const IMPERSONATION_PATTERNS = [
  /(^|[\s_.-])(admin|administrador|moderador|moderator|suporte|support|oficial|official|staff|equipe|sistema|vibestream)([\s_.-]|$)/i,
  /^admin/i, /^moder/i, /^suporte/i, /^oficial/i, /^hacker/i, /^staff/i, /^equipe/i,
  /hacker/i, /hackeando/i, /invas[ií]on/i, /roubar conta/i, /recuperar conta/i,
  /vibestream$/i, /^vibestream/i, /_admin$/i, /_mod$/i
];

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------
function matchHardBlock(text) {
  const lower = String(text || '').toLowerCase();
  for (const p of HARD_BLOCK_PATTERNS) if (p.test(lower)) return p.source;
  return null;
}
function matchApologia(text) {
  const lower = String(text || '').toLowerCase();
  for (const p of APOLOGIA_PATTERNS) if (p.test(lower)) return p.source;
  return null;
}
function matchHate(text) {
  const lower = String(text || '').toLowerCase();
  for (const p of HATE_PATTERNS) if (p.test(lower)) return p.source;
  return null;
}
function matchReview(text) {
  const lower = String(text || '').toLowerCase();
  for (const p of REVIEW_PATTERNS) if (p.test(lower)) return p.source;
  return null;
}
function matchImpersonation(text) {
  const lower = String(text || '').toLowerCase();
  for (const p of IMPERSONATION_PATTERNS) if (p.test(lower)) return p.source;
  return null;
}

// ------------------------------------------------------------
// MODERAÇÃO DE TEXTO (posts, comentários, títulos, bios)
// status: approved | review | blocked  (com motivo claro)
// ------------------------------------------------------------
function moderateText(text, category) {
  const blocked = matchHardBlock(text);
  if (blocked) return { status: 'blocked', reason: 'Conteúdo proibido pelas regras da comunidade', pattern: blocked, severity: 'block' };

  const hate = matchHate(text);
  if (hate) return { status: 'blocked', reason: 'Discurso de ódio é proibido — respeito entre usuários', pattern: hate, severity: 'block' };

  const apologia = matchApologia(text);
  if (apologia) return { status: 'blocked', reason: 'Apologia a crimes ou atividades ilegais é proibida', pattern: apologia, severity: 'block' };

  const imp = matchImpersonation(text);
  if (imp && category === 'name') {
    return { status: 'blocked', reason: 'Nome de usuário não permitido (semelhante a equipe/sistema)', pattern: imp, severity: 'auto_ban' };
  }

  const review = matchReview(text);
  if (review) return { status: 'review', reason: 'Conteúdo enviado para revisão da moderação (AnyClaw)', pattern: review, severity: 'review' };

  return { status: 'approved', reason: '', severity: 'none' };
}

// ------------------------------------------------------------
// MODERAÇÃO DE MÍDIA (imagens/vídeos) — hash + política
// Detecta reenvio de mídia já bloqueada e validações básicas
// ------------------------------------------------------------
function computeMediaHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Registra o hash de uma mídia publicada (tabela media_hashes)
function registerMedia(db, hash, status, reason, userId) {
  if (!db || !hash) return null;
  try {
    db.run(
      "INSERT OR IGNORE INTO media_hashes (hash, status, reason, user_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
      [hash, status || 'ok', reason || '', userId || '']
    );
    const row = db.get('SELECT status, reason FROM media_hashes WHERE hash = ?', [hash]);
    return row || null;
  } catch (e) { return null; }
}

// Analisa mídia: rejeita se o hash já foi bloqueado; revisa se desconhecido
function moderateMedia(db, hash, mime, size) {
  if (!hash) return { status: 'approved', reason: '' };
  try {
    const known = db.get('SELECT status, reason FROM media_hashes WHERE hash = ?', [hash]);
    if (known && known.status === 'blocked') {
      return { status: 'blocked', reason: 'Mídia previamente removida pelas regras da comunidade' };
    }
    if (known && known.status === 'review') {
      return { status: 'review', reason: 'Mídia aguardando revisão da moderação' };
    }
    // Política básica: tamanhos fora do padrão de mídia
    if (mime && size) {
      if (String(mime).startsWith('image/') && size > 10 * 1024 * 1024) return { status: 'review', reason: 'Imagem grande — revisão manual' };
      if (String(mime).startsWith('video/') && size < 1024) return { status: 'blocked', reason: 'Vídeo inválido (arquivo muito pequeno)' };
    }
    return { status: 'approved', reason: '' };
  } catch (e) { return { status: 'approved', reason: '' }; }
}

// ------------------------------------------------------------
// PUNIÇÕES PROGRESSIVAS (aviso -> remoção -> suspensão -> ban)
// ------------------------------------------------------------
const PUNISHMENT_STEPS = [
  { level: 1, action: 'warning', label: 'Aviso', hours: 0 },
  { level: 2, action: 'content_removed', label: 'Remoção de conteúdo', hours: 0 },
  { level: 3, action: 'suspension', label: 'Suspensão temporária', hours: 72 },
  { level: 4, action: 'ban', label: 'Banimento', hours: 0 }
];

function getPunishmentLevel(db, userId) {
  try {
    return Number((db.get('SELECT punishment_level FROM users WHERE id = ?', [userId]) || {}).punishment_level || 0);
  } catch (e) { return 0; }
}

// Aplica punição progressiva e registra tudo
function applyPunishment(db, userId, reason, moderatedBy) {
  if (!db || !userId) return { action: 'none' };
  const level = getPunishmentLevel(db, userId);
  const step = PUNISHMENT_STEPS[Math.min(level, PUNISHMENT_STEPS.length - 1)];
  const newLevel = Math.min(level + 1, 4);
  const uuid = require('uuid').v4;

  try {
    db.run('UPDATE users SET punishment_level = ?, warnings_count = COALESCE(warnings_count, 0) + 1 WHERE id = ?', [newLevel, userId]);
    db.run(
      "INSERT INTO moderation_logs (id, action_type, target_user_id, reason, moderated_by, duration_hours) VALUES (?, ?, ?, ?, ?, ?)",
      [uuid(), step.action, userId, String(reason || 'Violação das regras').slice(0, 300), moderatedBy || 'anyclaw', step.hours]
    );

    if (step.action === 'suspension') {
      db.run("INSERT INTO bans (id, user_id, banned_by, reason, ban_type, expires_at) VALUES (?, ?, ?, ?, 'temporario', datetime('now', '+72 hours'))",
        [uuid(), userId, moderatedBy || 'anyclaw', String(reason || 'Suspensão temporária').slice(0, 300)]);
      db.run("UPDATE users SET status = 'banned' WHERE id = ?", [userId]);
    }
    if (step.action === 'ban') {
      db.run("INSERT INTO bans (id, user_id, banned_by, reason, ban_type) VALUES (?, ?, ?, ?, 'permanente')",
        [uuid(), userId, moderatedBy || 'anyclaw', String(reason || 'Banimento por violações repetidas').slice(0, 300)]);
      db.run("UPDATE users SET status = 'banned' WHERE id = ?", [userId]);
    }

    // Notificação ao usuário + alerta de segurança
    notifyUser(db, userId, 'moderation', '⚠️ ' + step.label + ' — ' + String(reason || 'violação das regras').slice(0, 140));
    const security = require('./security');
    try {
      security.createAlert(db, 'punicion_' + step.action, 'alto', step.label + ' aplicado ao usuário ' + String(userId).slice(0, 12) + ' — ' + String(reason || '').slice(0, 120), '', userId);
    } catch (e) {}

    return { action: step.action, level: newLevel, reason };
  } catch (e) {
    console.error('[MODERATION] applyPunishment error:', e.message);
    return { action: 'none', error: e.message };
  }
}

// ------------------------------------------------------------
// NOTIFICAÇÕES DE MODERAÇÃO
// ------------------------------------------------------------
function notifyUser(db, userId, type, text) {
  try {
    db.run(
      "INSERT INTO notifications (id, user_id, actor_id, type, content_id, text, is_read) VALUES (?, ?, 'sistema', ?, '', ?, 0)",
      [require('uuid').v4(), userId, String(type).slice(0, 30), String(text).slice(0, 300)]
    );
  } catch (e) {}
}

// ------------------------------------------------------------
// ANTI-DENÚNCIA EM MASSA
// Cada usuário só pode reportar dentro de limites razoáveis e
// nunca repetir a mesma denúncia. Bloqueia campanhas de reportes.
// ------------------------------------------------------------
const REPORT_LIMITS = {
  hourlyMax: 5,        // máx. denúncias por usuário na última hora
  dailyMax: 15,        // máx. por dia
  pendingMax: 3,       // máx. denúncias em aberto ao mesmo tempo
  dedupHours: 72,      // mesma denúncia não pode ser repetida
  ipHourlyMax: 10      // máx. por IP na última hora (multi-contas)
};

// Mapa em memória de denúncias por IP (prune automático)
const ipReportTimes = new Map();

function checkIpReportAbuse(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown').slice(0, 64);
  let times = (ipReportTimes.get(key) || []).filter(t => now - t < 3600000);
  if (times.length >= REPORT_LIMITS.ipHourlyMax) {
    ipReportTimes.set(key, times);
    return { blocked: true, error: 'Limite de denúncias atingido. Aguarde um pouco e tente novamente.' };
  }
  times.push(now);
  ipReportTimes.set(key, times);
  if (ipReportTimes.size > 5000) {
    for (const [k, v] of ipReportTimes) {
      const fresh = v.filter(t => now - t < 3600000);
      if (fresh.length) ipReportTimes.set(k, fresh); else ipReportTimes.delete(k);
    }
  }
  return { blocked: false };
}

// contentKey identifica o alvo para dedup:
//   { contentType, contentId, userId } — userId é o dono do conteúdo
function checkReportAbuse(db, reporterId, contentKey) {
  try {
    const hourly = db().get(
      "SELECT COUNT(*) as c FROM reports WHERE reporter_id = ? AND created_at > datetime('now', '-1 hour')",
      [reporterId]
    );
    if ((hourly && hourly.c) > REPORT_LIMITS.hourlyMax) {
      return { blocked: true, error: 'Você atingiu o limite de denúncias por hora (' + REPORT_LIMITS.hourlyMax + '). Tente novamente mais tarde.' };
    }

    const daily = db().get(
      "SELECT COUNT(*) as c FROM reports WHERE reporter_id = ? AND created_at > datetime('now', '-1 day')",
      [reporterId]
    );
    if ((daily && daily.c) > REPORT_LIMITS.dailyMax) {
      return { blocked: true, error: 'Você atingiu o limite diário de denúncias (' + REPORT_LIMITS.dailyMax + '). Denúncias legítimas são analisadas uma a uma.' };
    }

    const pending = db().get(
      "SELECT COUNT(*) as c FROM reports WHERE reporter_id = ? AND status = 'pending'",
      [reporterId]
    );
    if ((pending && pending.c) >= REPORT_LIMITS.pendingMax) {
      return { blocked: true, error: 'Você já tem ' + REPORT_LIMITS.pendingMax + ' denúncias aguardando análise. Conclua-as antes de enviar novas.' };
    }

    if (contentKey) {
      const ck = contentKey || {};
      const dedup = db().get(
        "SELECT COUNT(*) as c FROM reports WHERE reporter_id = ? AND created_at > datetime('now', '-' || ? || ' hours') AND (" +
        " (content_id = ? AND content_type = ?) OR (reported_user_id IS NOT NULL AND reported_user_id = ?)" +
        ")",
        [reporterId, REPORT_LIMITS.dedupHours, ck.contentId || '', ck.contentType || '', ck.userId || '']
      );
      if (dedup && dedup.c > 0) {
        return { blocked: true, error: 'Esta denúncia já foi registrada recentemente. Nossa equipe vai analisar.' };
      }
    }
    return { blocked: false };
  } catch (e) {
    return { blocked: false };
  }
}

// ------------------------------------------------------------
// API PÚBLICA DO MÓDULO
// ------------------------------------------------------------

// ------------------------------------------------------------
// REGRA 1 — CONTEÚDO POLÍTICO (PROIBIDO: BAN PERMANENTE AUTOMÁTICO)
// Foto de perfil, capa ou vídeo com menção a políticos/eleições
// ------------------------------------------------------------
const POLITICAL_PATTERNS = [
  /bolsonaro/i, /lula/i, /mito 22/i, /pt 13/i, /comunista/i, /fascista/i,
  /elei[çc][ãa]o roubada/i, /lula ladr[ãa]o/i, /bolsonaro genocida/i,
  /pol[íi]tic[oa]/i, /pol[íi]tica/i, /elei[çc][ãa]o/i, /elei[çc][õo]es/i,
  /b17/i, /candidat[oa]/i, /voto (obrigat[óo]rio|nele|nela|22|13)/i
];
// Termos que dão contexto para números de campanha (22/13) — evita falso positivo
const POLITICAL_CONTEXT_PATTERNS = [
  /bolsonaro/i, /lula/i, /\bpt\b/i, /mito/i, /elei[çc][ãa]o/i, /pol[íi]tic/i,
  /candidat/i, /presidente/i, /governador/i, /partido/i, /voto/i, /urna/i,
  /comunista/i, /fascista/i, /b17/i
];

// ------------------------------------------------------------
// AMEAÇAS — remove vídeo na hora + strikes (3 = ban permanente)
// ------------------------------------------------------------
const THREAT_PATTERNS = [
  /vou te matar/i, /vou te pegar/i, /vou te bater/i, /te arrebento/i,
  /vou atr[áa]s de voc[êe]/i, /te mato/i, /te matar/i, /te pego/i,
  /vou te (encontrar|achar|ca[çc]ar)/i
];

function matchPolitical(text) {
  const lower = String(text || '').toLowerCase();
  for (const p of POLITICAL_PATTERNS) if (p.test(lower)) return p.source;
  const hasContext = POLITICAL_CONTEXT_PATTERNS.some(p => p.test(lower));
  if (hasContext && /\b22\b/.test(lower)) return 'numero-campanha-22';
  if (hasContext && /\b13\b/.test(lower)) return 'numero-campanha-13';
  if (hasContext && /\bpt\b/.test(lower)) return 'pt';
  return null;
}
function matchThreat(text) {
  const lower = String(text || '').toLowerCase();
  for (const p of THREAT_PATTERNS) if (p.test(lower)) return p.source;
  return null;
}

function getStrikes(db, userId) {
  try { return db.get('SELECT * FROM strikes WHERE user_id = ?', [userId]) || { user_id: userId, count: 0, ultimo_motivo: '' }; }
  catch (e) { return { user_id: userId, count: 0, ultimo_motivo: '' }; }
}

// Registra um strike; ao chegar em 3 -> ban permanente
function addStrike(db, userId, motivo) {
  if (!db || !userId) return { count: 0, banned: false };
  try {
    const s = getStrikes(db, userId);
    const count = Number(s.count || 0) + 1;
    db.run(
      `INSERT INTO strikes (user_id, count, ultimo_motivo, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET count = excluded.count, ultimo_motivo = excluded.ultimo_motivo, updated_at = datetime('now')`,
      [userId, count, String(motivo || '').slice(0, 200)]
    );
    const banned = count >= 3;
    if (banned) permanentBan(db, userId, '3 strikes por conteúdo com ameaça (regra de segurança)', '', 'anyclaw');
    return { count, banned };
  } catch (e) { return { count: 0, banned: false }; }
}

// Ban permanente: cria registro, bloqueia conta (users.status) e notifica
function permanentBan(db, userId, motivo, provaUrl, bannedBy) {
  if (!db || !userId) return { ok: false };
  try {
    db.run("INSERT INTO bans (id, user_id, banned_by, reason, ban_type, prova_url) VALUES (?, ?, ?, ?, 'permanente', ?)",
      [require('uuid').v4(), userId, bannedBy || 'anyclaw', String(motivo || 'Violação das regras da plataforma').slice(0, 300), String(provaUrl || '').slice(0, 300)]);
    db.run("UPDATE users SET status = 'banned' WHERE id = ?", [userId]);
    notifyUser(db, userId, 'ban', '🚫 ' + String(motivo || 'Sua conta foi banida permanentemente por violação das regras da plataforma').slice(0, 220));
    const security = require('./security');
    try { security.createAlert(db, 'ban_permanente', 'critico', 'Banimento permanente: ' + String(motivo || '').slice(0, 120) + ' (user ' + String(userId).slice(0, 12) + ')', '', userId); } catch (e) {}
    return { ok: true };
  } catch (e) {
    console.error('[MODERATION] permanentBan error:', e.message);
    return { ok: false, error: e.message };
  }
}

// ============================================================
// FOTO POLÍTICA -> BAN + REMOVE FOTO + DEIXA COMO USUÁRIO COMUM
// ============================================================
function banPoliticalPhoto(db, userId, url) {
  if (!db || !userId) return { ok: false };
  try {
    const u = db.get('SELECT avatar_url FROM users WHERE id = ?', [userId]);
    const mediaUrl = String(url || '');
    // 1) Remove a foto de perfil se for a mídia denunciada (ou qualquer avatar ao banir por foto)
    if (u && u.avatar_url && u.avatar_url !== '/default-avatar.png') {
      const matches = !mediaUrl || u.avatar_url === mediaUrl || (mediaUrl && u.avatar_url.endsWith(mediaUrl.slice(-40)));
      if (matches) db.run("UPDATE users SET avatar_url = '/default-avatar.png' WHERE id = ?", [userId]);
    }
    // 2) Remove posts (fotos/vídeos) com essa mídia
    if (mediaUrl) {
      db.run("UPDATE posts SET is_deleted = 1, moderation_reason = ? WHERE media_url = ?", ['Removido: conteúdo político proibido (regra 1)', mediaUrl]);
    }
    // 3) Deixa como USUÁRIO COMUM (perde admin/moderador)
    db.run("UPDATE users SET role = 'user' WHERE id = ?", [userId]);
    // 4) Ban permanente
    const res = permanentBan(db, userId, 'Sua conta foi banida permanentemente por violar regra 1: Proibido conteúdo político (Bolsonaro/Lula). Contate suporte: suportevibestream@gmail.com', mediaUrl, 'anyclaw');
    // 5) Encerra lives ativas
    try {
      db.run("UPDATE lives SET status = 'ended', ended_at = datetime('now') WHERE user_id = ? AND status = 'live'", [userId]);
      db.run("UPDATE users SET is_live = 0 WHERE id = ?", [userId]);
    } catch (e) {}
    return { ok: true, fotoRemovida: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// filename extraído da URL para checar junto com o texto
function urlFileName(url) {
  try { return decodeURIComponent(String(url || '').split('?')[0].split('/').pop() || ''); }
  catch (e) { return String(url || ''); }
}

// ------------------------------------------------------------
// CHECK CENTRAL: POST /api/moderation/check
// tipo: foto | video | legenda — url + texto
// Retorna { aprovado, motivo, politica?, ameaca?, banido? }
// ------------------------------------------------------------
function checkContent(db, { tipo, url, texto }) {
  const t = String(tipo || '');
  const text = String(texto || '');
  const u = String(url || '');
  const prova = u || (urlFileName(text) && t !== 'legenda' ? text : '');

  // REGRA 1: político -> BAN PERMANENTE
  const pol = matchPolitical(text + ' ' + u + ' ' + urlFileName(u));
  if (pol) {
    return {
      aprovado: false,
      banido: true,
      politica: true,
      pattern: pol,
      motivo: 'Sua conta foi banida permanentemente por violar regra 1: Proibido conteúdo político (Bolsonaro/Lula). Contate suporte: suportevibestream@gmail.com',
      prova_url: prova
    };
  }

  // AMEAÇAS: vídeo/legenda -> remove + strike
  if (t === 'video' || t === 'legenda') {
    const threat = matchThreat(text);
    if (threat) {
      return {
        aprovado: false,
        ameaca: true,
        pattern: threat,
        motivo: 'Vídeo removido por ameaça. 3 strikes = ban permanente',
        prova_url: prova
      };
    }
  }

  // Demais regras da comunidade
  const mod = moderateText(text, 'post');
  if (mod.status === 'blocked') return { aprovado: false, motivo: mod.reason, pattern: mod.pattern };
  if (mod.status === 'review') return { aprovado: true, motivo: '', revisao: true };
  return { aprovado: true, motivo: '' };
}

module.exports = {
  HARD_BLOCK_PATTERNS, APOLOGIA_PATTERNS, HATE_PATTERNS, REVIEW_PATTERNS, IMPERSONATION_PATTERNS,
  matchHardBlock, matchApologia, matchHate, matchReview, matchImpersonation, moderateText,
  computeMediaHash, registerMedia, moderateMedia,
  getPunishmentLevel, applyPunishment, notifyUser,
  POLITICAL_PATTERNS, THREAT_PATTERNS, matchPolitical, matchThreat,
  getStrikes, addStrike, permanentBan, checkContent, banPoliticalPhoto,
  REPORT_LIMITS, checkReportAbuse, checkIpReportAbuse
};

/**
 * VibeStream — Moderação automática (AnyClaw) + Visitas de Perfil.
 * REGRA DE OURO: toda resposta é JSON puro {success, data} — nunca HTML.
 */
const express = require('express');
const router = express.Router();
const uuid = require('uuid');
const moderation = require('./moderation');
const childSafety = require('./child-safety');
const security = require('./security');

let db; // definido pelo factory abaixo

function ok(res, data) {
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({ success: true, data });
}
function err(res, status, message, code) {
  res.setHeader('Content-Type', 'application/json');
  return res.status(status).json({ success: false, error: message, code: code || '' });
}
function getUser(req) {
  return req.session?.userId ? db().get('SELECT * FROM users WHERE id = ?', [req.session.userId]) : null;
}
function notif(userId, actorId, type, text) {
  try {
    db().run("INSERT INTO notifications (id, user_id, actor_id, type, content_id, text, is_read) VALUES (?, ?, ?, ?, '', ?, 0)",
      [uuid.v4(), userId, actorId || 'sistema', String(type).slice(0, 30), String(text).slice(0, 300)]);
  } catch (e) {}
}

// ============================================================
// POST /api/moderation/check — { tipo: foto|video|legenda, url, texto }
// ============================================================
router.post('/moderation/check', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const user = getUser(req);
    if (!user) return err(res, 401, 'Não autenticado');
    const { tipo, url, texto } = req.body || {};
    const result = moderation.checkContent(db(), { tipo, url, texto });
    if (result.banido) {
      if (String(tipo || '') === 'foto') {
        // Foto política: BAN + remove a foto + deixa a conta como usuário comum
        moderation.banPoliticalPhoto(db(), user.id, url || '');
      } else {
        moderation.permanentBan(db(), user.id, result.motivo, result.prova_url || url || '', 'anyclaw');
      }
      return ok(res, { aprovado: false, motivo: result.motivo, banido: true, politica: true, fotoRemovida: String(tipo || '') === 'foto' });
    }
    if (result.ameaca) {
      const st = moderation.addStrike(db(), user.id, 'Ameaça: ' + (result.pattern || ''));
      if (url) {
        try { db().run("UPDATE posts SET is_deleted = 1, moderation_reason = ? WHERE media_url = ? AND user_id = ?", ['Ameaça — removido pela moderação', url, user.id]); } catch (e) {}
      }
      notif(user.id, 'sistema', 'moderation', result.motivo + (st.banned ? ' — conta banida (3 strikes)' : ' (strike ' + st.count + '/3)'));
      return ok(res, { aprovado: false, motivo: result.motivo + (st.banned ? ' — sua conta foi banida (3 strikes)' : ' (strike ' + st.count + '/3)'), ameaca: true, strikes: st.count, banido: st.banned });
    }
    if (result.revisao) return ok(res, { aprovado: true, motivo: '', revisao: true });
    if (!result.aprovado) return ok(res, { aprovado: false, motivo: result.motivo });
    return ok(res, { aprovado: true, motivo: '' });
  } catch (e) { return err(res, 500, e.message); }
});

// ============================================================
// POST /api/moderation/child-check — foto de perfil / conteúdo
// Heurística de segurança: reprova mídia com nome/legenda suspeita
// ============================================================
router.post('/moderation/child-check', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!req.session?.userId) return err(res, 401, 'Não autenticado');
    const { tipo, url, texto } = req.body || {};
    const hay = String(texto || '') + ' ' + String(url || '');
    const term = childSafety.matchChild(hay);
    if (term) {
      return ok(res, {
        aprovado: false,
        motivo: 'Foto reprovada por segurança. Use foto com rosto visível maior de 18 anos',
        infantil: true
      });
    }
    // Heurísticas de mídia suspeita (nome do arquivo / legenda)
    const lower = hay.toLowerCase();
    const suspeito = /pelad|nu[ao]|s[ée]xy|sensual|menor|novinha|biqu[ií]ni|s[oó] de calcinha/i;
    if (suspeito.test(lower)) {
      return ok(res, {
        aprovado: false,
        motivo: 'Foto reprovada por segurança. Use foto com rosto visível maior de 18 anos',
        infantil: false
      });
    }
    return ok(res, { aprovado: true, motivo: '' });
  } catch (e) { return err(res, 500, e.message); }
});

module.exports = function (database) {
  db = () => database.getInstance();
  return router;
};

/**
 * Rotas do Admin Panel - Melhora App Live
 * Com proteção reforçada - login com senha forte, rate limiting
 */

const express = require('express');
const router = express.Router();
const uuid = require('uuid');
const bcrypt = require('bcryptjs');
const security = require('./security');

// Sanitizador de input
const sanitizeInput = (str) => {
  if (typeof str !== 'string') return str;
  return str.replace(/['"\\;()\-\-]/g, '').replace(/<[^>]*>/g, '').trim();
};

// Admin login handler - requer admin_routes.js para ter acesso ao db
module.exports = function(database, adminSecret) {
  const db = () => database.getInstance();

  // ============================================================
  // ADMIN AUTH - Login com senha forte
  // ============================================================

  router.post('/auth', async (req, res) => {
    try {
      const { username, password } = req.body;
      
      // Verifica se é admin (tenta autenticar)
      const adminUser = db().get(
        'SELECT id, username, password_hash, role FROM users WHERE role IN (?, ?) AND username = ?',
        ['admin', 'moderator', sanitizeInput(username || '')]
      );

      if (!adminUser || !password) {
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      // Verify admin password
      const valid = await bcrypt.compare(password, adminUser.password_hash);
      if (!valid) {
        // Log failed attempt
        db().run(
          'INSERT INTO security_logs (id, action, user_id, ip_address) VALUES (?, ?, ?, ?)',
          [uuid.v4(), 'admin_login_failed', adminUser.id, req.ip || req.connection.remoteAddress]
        );
        const failed = (db().get("SELECT COUNT(*) as c FROM security_logs WHERE action = 'admin_login_failed' AND ip_address = ? AND created_at > datetime('now', '-5 minutes')", [req.ip || req.connection.remoteAddress]) || {}).c || 0;
        if (failed >= 4) security.createAlert(db(), 'admin_login_suspeito', 'critico', 'Múltiplas tentativas de login admin falhando no IP ' + (req.ip || req.connection.remoteAddress), req.ip);
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      // Set admin session
      req.session.adminId = adminUser.id;
      req.session.role = adminUser.role;
      
      // Log success
      db().run(
        'INSERT INTO security_logs (id, action, user_id, ip_address) VALUES (?, ?, ?, ?)',
        [uuid.v4(), 'admin_login', adminUser.id, req.ip || req.connection.remoteAddress]
      );

      res.json({ verified: true, message: 'Admin autenticado' });
    } catch (error) {
      console.error('[ADMIN] Auth error:', error);
      res.status(500).json({ error: 'Erro interno' });
    }
  });

  // ============================================================
  // DASHBOARD (requer auth)
  // ============================================================
  router.get('/dashboard', requireAdmin, (req, res) => {
    const count = (q) => (db().get(q) || {}).count || 0;
    const stats = {
      totalUsers: count("SELECT COUNT(*) as count FROM users"),
      activeUsers: count("SELECT COUNT(*) as count FROM users WHERE status = 'active'"),
      activeLives: count("SELECT COUNT(*) as count FROM lives WHERE status = 'live'"),
      totalFamilies: count("SELECT COUNT(*) as count FROM families"),
      openTickets: count("SELECT COUNT(*) as count FROM tickets WHERE status IN ('aberto', 'em_andamento')"),
      totalLives: count("SELECT COUNT(*) as count FROM lives"),
      bannedUsers: count("SELECT COUNT(*) as count FROM bans"),
      pendingPosts: count("SELECT COUNT(*) as count FROM posts WHERE status = 'review' AND is_deleted = 0"),
      pendingReports: count("SELECT COUNT(*) as count FROM reports WHERE status IN ('pending', 'analyzing')"),
      pendingAppeals: count("SELECT COUNT(*) as count FROM appeals WHERE status = 'pendente'"),
      pendingChatReports: count("SELECT COUNT(*) as count FROM chat_reports WHERE status = 'pendente'"),
      pendingWithdrawals: count("SELECT COUNT(*) as count FROM withdrawals WHERE status = 'pendente'"),
      agencies: count("SELECT COUNT(*) as count FROM agencies"),
      creators: count("SELECT COUNT(*) as count FROM agency_members WHERE status = 'ativo'"),
      totalViews: count("SELECT COUNT(*) as count FROM video_views"),
      todayLogins: count("SELECT COUNT(*) as count FROM security_logs WHERE action = 'user_login' AND date(created_at) = date('now')"),
      openAlerts: count("SELECT COUNT(*) as count FROM security_alerts WHERE is_read = 0")
    };

    const recentUsers = db().query('SELECT id, username, display_name, avatar_url, created_at, last_login FROM users ORDER BY created_at DESC LIMIT 10');
    const recentLives = db().query(
      `SELECT l.*, u.username, u.display_name, u.avatar_url FROM lives l JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC LIMIT 10`
    );
    const pendingTickets = db().query(
      `SELECT t.*, u.username FROM tickets t JOIN users u ON t.user_id = u.id
       WHERE t.status IN ('aberto', 'em_andamento')
       ORDER BY t.priority = 'urgente' DESC, t.created_at ASC LIMIT 10`
    );
    const recentPosts = db().query(
      `SELECT p.id, p.text, p.status, p.created_at, u.username FROM posts p JOIN users u ON p.user_id = u.id WHERE p.is_deleted = 0 ORDER BY p.created_at DESC LIMIT 10`
    );
    const topCreators = db().query(
      `SELECT am.total_earnings, u.username, u.display_name FROM agency_members am JOIN users u ON am.user_id = u.id WHERE am.status = 'ativo' ORDER BY am.total_earnings DESC LIMIT 5`
    );
    const alerts = db().query('SELECT id, alert_type, severity, message, is_read, created_at FROM security_alerts ORDER BY created_at DESC LIMIT 5');

    res.json({ stats, recentUsers, recentLives, pendingTickets, recentPosts, topCreators, alerts });
  });

  // ============================================================
  // USERS (Admin)
  // ============================================================
  
  router.get('/users', requireAdmin, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;
    const search = sanitizeInput(req.query.search || '');

    let query = 'SELECT id, username, email, display_name, avatar_url, role, status, coins, diamonds, is_verified, is_live, created_at, last_login FROM users';
    let countQuery = 'SELECT COUNT(*) as count FROM users';
    let params = [];

    if (search) {
      const clause = ' WHERE username LIKE ? OR email LIKE ? OR display_name LIKE ? OR profile_id LIKE ?';
      query += clause;
      countQuery += clause;
      const term = `%${search}%`;
      params = [term, term, term, term];
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    
    const users = db().query(query, [...params, limit, offset]);
    const total = (db().get(countQuery, params) || {}).count || 0;

    res.json({ users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  });

  router.post('/users/:id/ban', requireAdmin, (req, res) => {
    const { reason, banType, expiresAt } = req.body;
    if (!reason) return res.status(400).json({ error: 'Motivo é obrigatório' });

    const user = db().get('SELECT id, username FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    db().run(
      'INSERT INTO bans (id, user_id, banned_by, reason, ban_type, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid.v4(), req.params.id, req.session.adminId || 'admin', sanitizeInput(reason), banType || 'temporario', expiresAt || null]
    );

    // Bloqueia acesso + encerra lives em QUALQUER banimento (permanente ou temporário)
    db().run("UPDATE users SET status = 'banned' WHERE id = ?", [req.params.id]);
    db().run("UPDATE lives SET status = 'ended', ended_at = datetime('now') WHERE user_id = ? AND status = 'live'", [req.params.id]);
    db().run('UPDATE users SET is_live = 0 WHERE id = ?', [req.params.id]);

    res.json({ message: `Usuário ${user.username} banido com sucesso` });
  });

  router.post('/users/:id/ban-political-photo', requireAdmin, (req, res) => {
    const user = db().get('SELECT id, username FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const moderation = require('./moderation');
    const result = moderation.banPoliticalPhoto(db(), user.id, (req.body || {}).url || '');
    if (!result.ok) return res.status(500).json({ error: result.error || 'Falha ao aplicar punição' });
    security.createAlert(db(), 'ban_foto_politica', 'critico', 'Ban por foto política: ' + user.username + ' — foto removida, conta deixada como usuário', req.ip, user.id);
    res.json({ message: user.username + ' banido, foto removida e conta deixada como usuário comum' });
  });

  router.post('/users/:id/unban', requireAdmin, (req, res) => {
    const user = db().get('SELECT id, username FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    db().run('DELETE FROM bans WHERE user_id = ?', [req.params.id]);

  router.post("/users/:id/mute", requireAdmin, (req, res) => {
    const { reason } = req.body;
    const user = db().get("SELECT id, username FROM users WHERE id = ?", [req.params.id]);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    db().run("UPDATE users SET status = ? WHERE id = ?", ["muted", req.params.id]);
    db().run(
      "INSERT INTO bans (id, user_id, banned_by, reason, ban_type) VALUES (?, ?, ?, ?, ?)",
      [uuid.v4(), req.params.id, req.session.adminId || "admin", sanitizeInput(reason || "Sem motivo"), "temporario"]
    );
    res.json({ message: "Usuário " + user.username + " mutado" });
  });

    db().run("UPDATE users SET status = 'active' WHERE id = ?", [req.params.id]);
    res.json({ message: `Usuário ${user.username} desbanido` });
  });

  // ============================================================
  // TICKETS (Admin)  
  // ============================================================
  
  router.get('/tickets', requireAdmin, (req, res) => {
    const status = sanitizeInput(req.query.status || '');
    let query = 'SELECT t.*, u.username, u.display_name FROM tickets t JOIN users u ON t.user_id = u.id';
    let params = [];
    if (status) {
      query += ' WHERE t.status = ?';
      params.push(status);
    }
    query += " ORDER BY t.priority = 'urgente' DESC, t.created_at ASC";
    const tickets = db().query(query, params);
    res.json({ tickets });
  });

  router.post('/tickets/:id/respond', requireAdmin, (req, res) => {
    const { response, status, punish } = req.body;
    if (!response) return res.status(400).json({ error: 'Resposta é obrigatória' });

    const ticket = db().get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado' });

    db().run(
      "UPDATE tickets SET response = ?, status = ?, assigned_to = ?, updated_at = datetime('now') WHERE id = ?",
      [sanitizeInput(response), sanitizeInput(status || 'resolvido'), req.session.adminId || 'admin', req.params.id]
    );

    if (status === 'resolvido') {
      db().run("UPDATE tickets SET resolved_at = datetime('now') WHERE id = ?", [req.params.id]);
    }

    // Punição opcional direto do ticket (apenas admin)
    if (punish && req.session?.role === 'admin' && ticket.user_id) {
      const reason = sanitizeInput(punish.reason || 'Violação das regras - denúncia via ticket');
      db().run('INSERT INTO bans (id, user_id, banned_by, reason, ban_type) VALUES (?, ?, ?, ?, ?)',
        [uuid.v4(), ticket.user_id, req.session.adminId || 'admin', reason, punish.permanent ? 'permanente' : 'temporario']);
      db().run("UPDATE users SET status = 'banned' WHERE id = ?", [ticket.user_id]);
      db().run("UPDATE lives SET status = 'ended' WHERE user_id = ? AND status = 'live'", [ticket.user_id]);
      db().run('UPDATE users SET is_live = 0 WHERE id = ?', [ticket.user_id]);
      db().run("INSERT INTO moderation_logs (id, action_type, target_user_id, reason, moderated_by) VALUES (?, 'ban', ?, ?, ?)",
        [uuid.v4(), ticket.user_id, reason, req.session.adminId || 'admin']);
      db().run("INSERT INTO notifications (id, user_id, type, text) VALUES (?, ?, 'ban', ?)",
        [uuid.v4(), ticket.user_id, 'Sua conta foi banida após análise do ticket: ' + reason]);
    }

    res.json({ message: 'Ticket respondido com sucesso' });
  });

  // ============================================================
  // LIVES (Admin)
  // ============================================================
  
  router.get('/lives', requireAdmin, (req, res) => {
    const lives = db().query(
      `SELECT l.*, u.username, u.display_name FROM lives l JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC LIMIT 50`
    );
    res.json({ lives });
  });

  router.post('/lives/:id/end', requireAdmin, (req, res) => {
    const live = db().get('SELECT * FROM lives WHERE id = ?', [req.params.id]);
    if (!live) return res.status(404).json({ error: 'Live não encontrada' });
    db().run("UPDATE lives SET status = 'ended', ended_at = datetime('now') WHERE id = ?", [req.params.id]);
    db().run('UPDATE users SET is_live = 0 WHERE id = ?', [live.user_id]);
    res.json({ message: 'Live encerrada pelo admin' });
  });

  // ============================================================
  // FAMILIES (Admin)
  // ============================================================
  
  router.get('/families', requireAdmin, (req, res) => {
    const families = db().query(
      `SELECT f.*, u.username as owner_name FROM families f JOIN users u ON f.owner_id = u.id ORDER BY f.total_diamonds DESC LIMIT 50`
    );
    res.json({ families });
  });

  router.delete('/families/:id', requireAdmin, (req, res) => {
    const family = db().get('SELECT * FROM families WHERE id = ?', [req.params.id]);
    if (!family) return res.status(404).json({ error: 'Família não encontrada' });
    db().run('DELETE FROM family_members WHERE family_id = ?', [req.params.id]);
    db().run('DELETE FROM families WHERE id = ?', [req.params.id]);
    res.json({ message: 'Família excluída' });
  });

  // ============================================================
  // SECURITY
  // ============================================================
  
  router.get('/security-logs', requireAdmin, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const logs = db().query('SELECT * FROM security_logs ORDER BY created_at DESC LIMIT ?', [limit]);
    res.json({ logs });
  });

  router.get('/blocked-ips', requireAdmin, (req, res) => {
    const blockedIPs = db().query(
      "SELECT * FROM security_logs WHERE action = 'block_ip' ORDER BY created_at DESC LIMIT 100"
    );
    res.json({ blockedIPs });
  });

  // ============================================================
  // USER MANAGEMENT
  // ============================================================
  
  router.post('/users/:id/update-coins', requireAdmin, (req, res) => {
    const { coins, diamonds } = req.body;
    const user = db().get('SELECT id, username FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    if (coins !== undefined) db().run('UPDATE users SET coins = ? WHERE id = ?', [parseInt(coins) || 0, req.params.id]);
    if (diamonds !== undefined) db().run('UPDATE users SET diamonds = ? WHERE id = ?', [parseInt(diamonds) || 0, req.params.id]);
    res.json({ message: `Recursos de ${user.username} atualizados` });
  });

  router.post('/users/:id/verify', requireAdmin, (req, res) => {
    const user = db().get('SELECT id, username FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const current = (db().get('SELECT is_verified FROM users WHERE id = ?', [req.params.id]) || {}).is_verified || 0;
    db().run('UPDATE users SET is_verified = ? WHERE id = ?', [current ? 0 : 1, req.params.id]);
    res.json({ message: `Verificação de ${user.username} ${current ? 'removida' : 'ativada'}`, verified: !current });
  });

  // ============================================================
  // Middleware de autenticação
  // ============================================================
  function requireAdmin(req, res, next) {
    let role = req.session?.role || 'user';
    if (req.session?.userId) {
      const u = db().get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
      if (u) role = u.role;
    }
    if (role === 'admin' || role === 'moderator') return next();
    security.createAlert(db(), 'acesso_negado', 'alto', 'Acesso negado: role ' + role + ' tentou acessar ' + (req.originalUrl || '').slice(0, 80), req.ip, req.session?.userId || '');
    return res.status(403).json({ error: 'Acesso negado' });
  }

  // Permissões: 'admin' = acesso total; 'moderador' = apenas moderação de conteúdo
  function requireRole(...roles) {
    return (req, res, next) => {
      let role = req.session?.role || 'user';
      if (req.session?.userId) {
        const u = db().get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
        if (u) role = u.role;
      }
      if (roles.includes(role)) return next();
      security.createAlert(db(), 'acesso_negado', 'alto', 'Acesso negado: role ' + role + ' tentou acessar ' + (req.originalUrl || '').slice(0, 80), req.ip, req.session?.userId || '');
      return res.status(403).json({ error: 'Acesso negado - sem permissão para esta ferramenta' });
    };
  }

  // ============================================================
  // CONTEÚDO (Admin) - Moderação de publicações
  // ============================================================

  router.get('/posts', requireAdmin, (req, res) => {
    const status = sanitizeInput(req.query.status || '');
    let query = `SELECT p.*, u.username, u.display_name, u.avatar_url,
      (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
      (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) as comments_count
      FROM posts p JOIN users u ON p.user_id = u.id`;
    const params = [];
    if (status) {
      query += ' WHERE p.status = ? AND p.is_deleted = 0';
      params.push(status);
    } else {
      query += ' WHERE p.is_deleted = 0';
    }
    query += ' ORDER BY p.created_at DESC LIMIT 100';
    const posts = db().query(query, params);
    res.json({ posts });
  });

  router.post('/posts/:id/review', requireAdmin, (req, res) => {
    const { action } = req.body; // 'approve' | 'block'
    const post = db().get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Post não encontrado' });
    if (action === 'approve') {
      db().run("UPDATE posts SET status = 'approved', moderation_reason = '' WHERE id = ?", [req.params.id]);
      db().run("INSERT INTO content_reviews (id, post_id, user_id, action, reason, moderated_by) VALUES (?, ?, ?, 'approved', 'Aprovado pelo admin', ?)",
        [uuid.v4(), post.id, post.user_id, req.session.adminId || 'admin']);
      res.json({ message: 'Publicação aprovada' });
    } else if (action === 'block') {
      const reason = sanitizeInput(req.body.reason || 'Violação das regras da plataforma');
      db().run("UPDATE posts SET status = 'blocked', moderation_reason = ? WHERE id = ?", [reason, req.params.id]);
      db().run('UPDATE users SET warnings_count = COALESCE(warnings_count, 0) + 1 WHERE id = ?', [post.user_id]);
      db().run("INSERT INTO content_reviews (id, post_id, user_id, action, reason, moderated_by) VALUES (?, ?, ?, 'blocked', ?, ?)",
        [uuid.v4(), post.id, post.user_id, reason, req.session.adminId || 'admin']);
      db().run("INSERT INTO moderation_logs (id, action_type, target_user_id, content_type, reason, moderated_by) VALUES (?, 'content_removed', ?, 'post', ?, ?)",
        [uuid.v4(), post.user_id, reason, req.session.adminId || 'admin']);
      db().run("INSERT INTO notifications (id, user_id, actor_id, type, content_id, text) VALUES (?, ?, '', 'post_blocked', ?, ?)",
        [uuid.v4(), post.user_id, post.id, 'Sua publicação foi removida: ' + reason]);
      res.json({ message: 'Publicação bloqueada' });
    } else {
      res.status(400).json({ error: 'Ação inválida' });
    }
  });

  // ============================================================
  // RECURSOS (Admin) - Análise de banimento
  // ============================================================

  router.get('/appeals', requireAdmin, (req, res) => {
    const appeals = db().query(`
      SELECT a.*, u.username, u.display_name, u.email FROM appeals a
      JOIN users u ON a.user_id = u.id ORDER BY (a.status = 'pendente') DESC, a.created_at ASC LIMIT 100
    `);
    res.json({ appeals });
  });

  router.post('/appeals/:id/review', requireAdmin, (req, res) => {
    const { action, response } = req.body; // 'approve' | 'reject'
    const appeal = db().get('SELECT * FROM appeals WHERE id = ?', [req.params.id]);
    if (!appeal) return res.status(404).json({ error: 'Recurso não encontrado' });
    if (action === 'approve') {
      db().run("UPDATE appeals SET status = 'aprovado', admin_response = ?, reviewed_at = datetime('now') WHERE id = ?", [sanitizeInput(response || 'Recurso aceito. Conta reativada.'), appeal.id]);
      db().run("UPDATE users SET status = 'active' WHERE id = ?", [appeal.user_id]);
      db().run('DELETE FROM bans WHERE user_id = ?', [appeal.user_id]);
      db().run("INSERT INTO moderation_logs (id, action_type, target_user_id, reason, moderated_by) VALUES (?, 'unban', ?, 'Recurso aceito pelo admin', ?)",
        [uuid.v4(), appeal.user_id, req.session.adminId || 'admin']);
      db().run("INSERT INTO notifications (id, user_id, type, text) VALUES (?, ?, 'appeal', ?)",
        [uuid.v4(), appeal.user_id, '✅ Seu recurso foi aceito! Sua conta foi reativada.']);
      res.json({ message: 'Recurso aceito — conta reativada' });
    } else if (action === 'reject') {
      db().run("UPDATE appeals SET status = 'rejeitado', admin_response = ?, reviewed_at = datetime('now') WHERE id = ?", [sanitizeInput(response || 'Recurso negado'), appeal.id]);
      db().run("INSERT INTO notifications (id, user_id, type, text) VALUES (?, ?, 'appeal', ?)",
        [uuid.v4(), appeal.user_id, '❌ Seu recurso foi negado.']);
      res.json({ message: 'Recurso negado' });
    } else {
      res.status(400).json({ error: 'Ação inválida' });
    }
  });

  // ============================================================
  // ECONOMIA (Admin): presentes, pacotes, pedidos, transações, VIP
  // ============================================================
  router.get('/gifts', requireAdmin, (req, res) => {
    res.json({ gifts: db().query('SELECT * FROM gifts ORDER BY price_coins ASC LIMIT 100') });
  });

  router.post('/gifts', requireRole('admin'), (req, res) => {
    const { name, priceCoins, priceDiamonds, category, imageUrl, animationUrl } = req.body;
    if (!name || !priceCoins) return res.status(400).json({ error: 'Nome e preço são obrigatórios' });
    const id = req.body.id || uuid.v4();
    db().run("INSERT INTO gifts (id, name, image_url, price_coins, price_diamonds, animation_url, category, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      [id, sanitizeInput(String(name).slice(0, 40)), imageUrl || '', Math.max(1, parseInt(priceCoins) || 1), Math.max(0, parseInt(priceDiamonds) || 0), animationUrl || '', ['normal','animado','vip','premium','lendario'].includes(category) ? category : 'normal']);
    res.status(201).json({ message: 'Presente criado', id });
  });

  router.post('/gifts/:id/toggle', requireRole('admin'), (req, res) => {
    const g = db().get('SELECT * FROM gifts WHERE id = ?', [req.params.id]);
    if (!g) return res.status(404).json({ error: 'Presente não encontrado' });
    db().run('UPDATE gifts SET is_active = ? WHERE id = ?', [g.is_active ? 0 : 1, g.id]);
    res.json({ message: g.is_active ? 'Presente desativado' : 'Presente ativado' });
  });

  router.get('/recharge-orders', requireAdmin, (req, res) => {
    res.json({ orders: db().query(`
      SELECT r.*, u.username FROM recharge_orders r JOIN users u ON r.user_id = u.id
      ORDER BY (r.status = 'pendente') DESC, r.created_at DESC LIMIT 100`) });
  });

  router.post('/recharge-orders/:id/confirm', requireRole('admin'), (req, res) => {
    const o = db().get('SELECT * FROM recharge_orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (o.status !== 'pendente') return res.status(400).json({ error: 'Pedido já processado' });
    db().run("UPDATE recharge_orders SET status = 'pago', paid_at = datetime('now') WHERE id = ?", [o.id]);
    const total = o.coins + (o.bonus || 0);
    db().run('UPDATE users SET coins = coins + ? WHERE id = ?', [total, o.user_id]);
    db().run("INSERT INTO wallet_transactions (id, user_id, type, amount, description, status, ref_id) VALUES (?, ?, 'recharge', ?, ?, 'concluido', ?)",
      [uuid.v4(), o.user_id, total, 'Recarga confirmada pelo admin (R$ ' + Number(o.amount).toFixed(2) + ')', o.id]);
    db().run("INSERT INTO notifications (id, user_id, type, text) VALUES (?, ?, 'recharge', ?)",
      [uuid.v4(), o.user_id, '💰 ' + total + ' moedas adicionadas à sua conta!']);
    res.json({ message: 'Pedido confirmado — moedas creditadas' });
  });

  router.get('/economy-transactions', requireAdmin, (req, res) => {
    const txs = db().query(`
      SELECT w.*, u.username FROM wallet_transactions w JOIN users u ON w.user_id = u.id
      ORDER BY w.created_at DESC LIMIT 150`);
    const gifts = db().query(`
      SELECT gt.*, g.name as gift_name, su.username as sender_name, ru.username as receiver_name
      FROM gift_transactions gt JOIN gifts g ON gt.gift_id = g.id
      LEFT JOIN users su ON gt.sender_id = su.id LEFT JOIN users ru ON gt.receiver_id = ru.id
      ORDER BY gt.created_at DESC LIMIT 100`);
    res.json({ transactions: txs, gifts });
  });

  router.get('/vip-users', requireAdmin, (req, res) => {
    res.json({ users: db().query("SELECT id, username, display_name, vip_tier, vip_until, coins FROM users WHERE vip_tier != '' ORDER BY vip_until DESC LIMIT 100") });
  });

  // ============================================================
  // DENÚNCIAS DE CONVERSA (Admin)
  // ============================================================

  router.get('/chat-reports', requireAdmin, (req, res) => {
    const reports = db().query(`
      SELECT cr.*, u.username as reporter_username, c.user1_id, c.user2_id FROM chat_reports cr
      JOIN users u ON cr.reporter_id = u.id
      JOIN chats c ON cr.chat_id = c.id
      ORDER BY (cr.status = 'pendente') DESC, cr.created_at ASC LIMIT 100
    `);
    res.json({ reports });
  });

  router.post('/chat-reports/:id/review', requireAdmin, (req, res) => {
    const { status, response } = req.body; // 'analisado' | 'rejeitado'
    const report = db().get('SELECT * FROM chat_reports WHERE id = ?', [req.params.id]);
    if (!report) return res.status(404).json({ error: 'Denúncia não encontrada' });
    db().run("UPDATE chat_reports SET status = ?, reason = ? WHERE id = ?", [status === 'rejeitado' ? 'rejeitado' : 'analisado', sanitizeInput(response || report.reason), report.id]);
    res.json({ message: 'Denúncia atualizada' });
  });

  // ============================================================
  // DENÚNCIAS (admin) — moderação AnyClaw + revisão manual
  // ============================================================
  router.get('/reports', requireAdmin, (req, res) => {
    const status = sanitizeInput(req.query.status || '');
    const params = [];
    let where = '';
    if (status === 'pending' || status === 'accepted' || status === 'rejected' || status === 'analyzing') {
      where = 'WHERE r.status = ?';
      params.push(status);
    }
    const reports = db().query(`
      SELECT r.*, ru.username as reporter_username, rru.username as reported_username,
             (SELECT COUNT(*) FROM reports r2 WHERE r2.reported_user_id = r.reported_user_id AND r2.status = 'accepted') as accepted_count
      FROM reports r
      JOIN users ru ON r.reporter_id = ru.id
      LEFT JOIN users rru ON r.reported_user_id = rru.id
      ${where}
      ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 100
    `, params);
    res.json({ reports });
  });

  router.post('/reports/:id/review', requireAdmin, (req, res) => {
    const { action, notes } = req.body; // 'accept' | 'reject' | 'analyzing'
    const report = db().get('SELECT * FROM reports WHERE id = ?', [req.params.id]);
    if (!report) return res.status(404).json({ error: 'Denúncia não encontrada' });

    const statusMap = { accept: 'accepted', reject: 'rejected', analyzing: 'analyzing' };
    const status = statusMap[action];
    if (!status) return res.status(400).json({ error: 'Ação inválida' });

    const reviewedBy = req.session?.userId || req.session?.adminId || 'admin';
    db().run(
      "UPDATE reports SET status = ?, reviewed_by = ?, review_notes = ?, reviewed_at = datetime('now'), is_false_report = ? WHERE id = ?",
      [status, String(reviewedBy).slice(0, 64), String(notes || '').slice(0, 500), action === 'reject' ? 1 : 0, report.id]
    );

    // Registro de histórico
    db().run(
      "INSERT INTO moderation_logs (id, action_type, target_user_id, target_content_id, content_type, reason, moderated_by) VALUES (?, 'content_removed', ?, ?, ?, ?, ?)",
      [uuid.v4(), report.reported_user_id || report.reporter_id, report.content_id || null, report.content_type || 'post', String(notes || 'Denúncia ' + status).slice(0, 300), reviewedBy]
    );

    // Se denúncia confirmada e há usuário denunciado -> punição progressiva (apenas admin)
    if (action === 'accept' && report.reported_user_id && req.session?.role === 'admin') {
      const moderation = require('./moderation');
      const result = moderation.applyPunishment(db(), report.reported_user_id, 'Denúncia confirmada: ' + String(report.report_reason || 'violação das regras'), reviewedBy);
      // Remove conteúdo denunciado se for post
      if (report.content_type === 'post' && report.content_id) {
        db().run("UPDATE posts SET is_deleted = 1, status = 'removed' WHERE id = ?", [report.content_id]);
      }
      return res.json({ message: 'Denúncia confirmada — ' + (result.action || 'ação aplicada'), punishment: result });
    }

    if (action === 'reject') {
      db().run("INSERT INTO notifications (id, user_id, type, text) VALUES (?, ?, 'moderation', ?)",
        [uuid.v4(), report.reporter_id, 'Sua denúncia foi analisada e não foi confirmada. Obrigado pelo zelo com a comunidade.']);
    } else if (action === 'accept') {
      db().run("INSERT INTO notifications (id, user_id, type, text) VALUES (?, ?, 'moderation', ?)",
        [uuid.v4(), report.reporter_id, '✅ Sua denúncia foi confirmada pela moderação.']);
    }

    res.json({ message: 'Denúncia ' + (status === 'accepted' ? 'confirmada' : status === 'rejected' ? 'rejeitada' : 'em análise') + ' com sucesso' });
  });

  // ============================================================
  // HISTÓRICO DE MODERAÇÃO (admin)
  // ============================================================
  router.get('/moderation-logs', requireAdmin, (req, res) => {
    const logs = db().query(`
      SELECT m.*, u.username as target_username, mu.username as moderator_username
      FROM moderation_logs m
      LEFT JOIN users u ON m.target_user_id = u.id
      LEFT JOIN users mu ON m.moderated_by = mu.id
      ORDER BY m.created_at DESC LIMIT 150
    `);
    const reviews = db().query(`
      SELECT cr.*, u.username, p.text as post_preview
      FROM content_reviews cr
      LEFT JOIN users u ON cr.user_id = u.id
      LEFT JOIN posts p ON cr.post_id = p.id
      ORDER BY cr.created_at DESC LIMIT 100
    `);
    res.json({ logs, reviews });
  });

  // ============================================================
  // ALERTAS DE SEGURANÇA (admin)
  // ============================================================
  router.get('/alerts', requireRole('admin'), (req, res) => {
    const alerts = db().query('SELECT * FROM security_alerts ORDER BY created_at DESC LIMIT 100');
    res.json({ alerts });
  });

  router.post('/alerts/:id/read', requireRole('admin'), (req, res) => {
    db().run('UPDATE security_alerts SET is_read = 1 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Alerta marcado como lido' });
  });

  // ============================================================
  // SAQUES PIX (admin)
  // ============================================================
  router.get('/withdrawals', requireRole('admin'), (req, res) => {
    const status = sanitizeInput(req.query.status || '');
    const w = status
      ? db().query("SELECT w.*, u.username, u.display_name FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.status = ? ORDER BY w.created_at DESC LIMIT 100", [status])
      : db().query("SELECT w.*, u.username, u.display_name FROM withdrawals w JOIN users u ON w.user_id = u.id ORDER BY (w.status = 'pendente') DESC, w.created_at DESC LIMIT 100");
    res.json({ withdrawals: w });
  });

  router.post('/withdrawals/:id/review', requireRole('admin'), (req, res) => {
    const { action, response } = req.body; // 'approve' | 'reject'
    const w = db().get('SELECT * FROM withdrawals WHERE id = ?', [req.params.id]);
    if (!w) return res.status(404).json({ error: 'Saque não encontrado' });
    if (w.status !== 'pendente') return res.status(400).json({ error: 'Saque já foi analisado' });
    if (action === 'approve') {
      db().run("UPDATE withdrawals SET status = 'aprovado', admin_response = ?, reviewed_at = datetime('now') WHERE id = ?", [sanitizeInput(response || 'Saque aprovado'), w.id]);
      db().run("UPDATE wallet_transactions SET status = 'concluido' WHERE user_id = ? AND type = 'saque' AND amount = ? AND status = 'pendente' ORDER BY created_at DESC LIMIT 1", [w.user_id, w.amount]);
      db().run("INSERT INTO notifications (id, user_id, type, text) VALUES (?, ?, 'saque', ?)", [uuid.v4(), w.user_id, '✅ Saque de R$ ' + w.amount.toFixed(2) + ' aprovado!']);
    } else if (action === 'reject') {
      db().run("UPDATE withdrawals SET status = 'rejeitado', admin_response = ?, reviewed_at = datetime('now') WHERE id = ?", [sanitizeInput(response || 'Saque rejeitado'), w.id]);
      // Estorna saldo
      db().run('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', [w.amount, w.user_id]);
      db().run("INSERT INTO wallet_transactions (id, user_id, type, amount, description) VALUES (?, ?, 'estorno', ?, ?)", [uuid.v4(), w.user_id, w.amount, 'Estorno de saque rejeitado']);
      db().run("INSERT INTO notifications (id, user_id, type, text) VALUES (?, ?, 'saque', ?)", [uuid.v4(), w.user_id, '❌ Saque de R$ ' + w.amount.toFixed(2) + ' rejeitado: ' + sanitizeInput(response || '')]);
    } else {
      return res.status(400).json({ error: 'Ação inválida' });
    }
    res.json({ message: 'Saque ' + (action === 'approve' ? 'aprovado' : 'rejeitado') });
  });

  // ============================================================
  // AGÊNCIAS (admin)
  // ============================================================
  router.get('/agencies', requireAdmin, (req, res) => {
    const agencies = db().query(`SELECT a.*, u.username as owner_name FROM agencies a JOIN users u ON a.owner_id = u.id ORDER BY a.total_earnings DESC LIMIT 50`);
    const enriched = agencies.map(a => ({
      ...a,
      members: (db().get('SELECT COUNT(*) as c FROM agency_members WHERE agency_id = ? AND status = ?', [a.id, 'ativo']) || {}).c || 0
    }));
    res.json({ agencies: enriched });
  });

  router.delete('/agencies/:id', requireRole('admin'), (req, res) => {
    const a = db().get('SELECT * FROM agencies WHERE id = ?', [req.params.id]);
    if (!a) return res.status(404).json({ error: 'Agência não encontrada' });
    db().run('DELETE FROM agency_invites WHERE agency_id = ?', [a.id]);
    db().run('DELETE FROM agency_members WHERE agency_id = ?', [a.id]);
    db().run('DELETE FROM agencies WHERE id = ?', [a.id]);
    res.json({ message: 'Agência excluída' });
  });

  // ============================================================
  // CRIADOR: definir role moderador (admin)
  // ============================================================
  router.post('/users/:id/role', requireRole('admin'), (req, res) => {
    const { role } = req.body;
    const allowed = ['user', 'moderator'];
    if (!allowed.includes(role)) return res.status(400).json({ error: 'Role inválido' });
    const u = db().get('SELECT id, username FROM users WHERE id = ?', [req.params.id]);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    db().run('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    db().run("INSERT INTO security_logs (id, action, user_id, ip_address) VALUES (?, ?, ?, ?)",
      [uuid.v4(), 'role_change_to_' + role, u.id, req.ip || req.connection.remoteAddress]);
    security.createAlert(db(), 'role_alterada', 'alto', 'Role de ' + u.username + ' alterado para ' + role + ' pelo admin', req.ip, u.id);
    res.json({ message: 'Role de ' + u.username + ' alterado para ' + role });
  });

  // ============================================================
  // PROTEÇÃO INFANTIL (admin) — fila prioritária de análise
  // ============================================================
  router.get('/security/child-bans', requireAdmin, (req, res) => {
    const rows = db().query(`SELECT dg.*, u.username as autor, u.avatar_url as autor_avatar,
        v.username as vitima, v.avatar_url as vitima_avatar
      FROM denuncias_graves dg
      LEFT JOIN users u ON dg.autor_id = u.id
      LEFT JOIN users v ON dg.vitima_id = v.id
      ORDER BY dg.created_at DESC LIMIT 100`);
    // Mostra IP, dispositivo e todas as mensagens do autor
    const detalhes = rows.map(r => {
      let mensagens = [];
      try {
        mensagens = db().query("SELECT text, type, media_url, created_at FROM chat_messages WHERE sender_id = ? ORDER BY created_at DESC LIMIT 20", [r.autor_id]);
      } catch (e) {}
      let banInfo = null;
      try { banInfo = db().get("SELECT reason, created_at, prova_url FROM bans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", [r.autor_id]); } catch (e) {}
      return {
        id: r.id, autorId: r.autor_id, autor: r.autor || 'deletado', autorAvatar: r.autor_avatar || '',
        vitimaId: r.vitima_id, vitima: r.vitima || '—', texto: r.texto || '', prova: r.prova || '',
        tipo: r.tipo || 'infantil', status: r.status || 'enviado_para_analise',
        ip: r.ip || '', device_fp: r.device_fp || '',
        created_at: r.created_at, mensagens, ban: banInfo
      };
    });
    res.json({ denuncias: detalhes });
  });

  router.get('/security/child-bans/export', requireAdmin, (req, res) => {
    const rows = db().query(`SELECT dg.*, u.username as autor FROM denuncias_graves dg
      LEFT JOIN users u ON dg.autor_id = u.id ORDER BY dg.created_at DESC LIMIT 500`);
    const payload = {
      gerado_em: new Date().toISOString(),
      plataforma: 'VibeStream',
      nota: 'Provas exportadas para autoridades — incluem IP, dispositivo, mensagens e mídia',
      denuncias: rows.map(r => ({
        id: r.id, autor: r.autor, autor_id: r.autor_id, vitima_id: r.vitima_id,
        texto: r.texto, prova: r.prova, tipo: r.tipo, status: r.status,
        ip: r.ip, device_fp: r.device_fp, created_at: r.created_at
      }))
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="vibestream-provas-seguranca-infantil.json"');
    return res.status(200).json(payload);
  });

  return router;
};

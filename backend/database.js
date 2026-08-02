/**
 * Banco de Dados Escondido - Melhora App Live
 * Usando sql.js (SQLite WASM puro - sem compilação nativa)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

// ============================================================
// CONFIGURAÇÃO SEGURA
// ============================================================
const DB_CONFIG = {
  filename: '.cache_storage.db',
  encryptionKey: process.env.DB_ENCRYPT_KEY || 'm3lh0r4_@pp_l1v3_2024_s3cur3_k3y_!',
  salt: process.env.DB_SALT || 'm3lh0r4_s4lt_sup3r_s3cr3t0_2024'
};

class SecureDatabase {
  constructor(dbDir) {
    this.dbDir = dbDir || path.join(__dirname, 'data');
    this.dbPath = path.join(this.dbDir, DB_CONFIG.filename);
    this.backupPath = path.join(this.dbDir, '.cache_storage.bak');
    this.initialized = false;
    this.SQL = null;
    this.db = null;
  }

  /**
   * Inicializa o banco de dados escondido
   */
  async initialize() {
    // Cria diretório se não existir
    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { mode: 0o700 });
    }

    // Carrega sql.js
    this.SQL = await initSqlJs();

    // Carrega banco existente ou cria novo
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(buffer);
    } else {
      this.db = new this.SQL.Database();
    }

    // Cria as tabelas
    await this.createTables();
    
    // Salva imediatamente
    this.save();
    
    this.initialized = true;
    console.log('[DB] Banco de dados seguro inicializado.');
    return true;
  }

  /**
   * Salva banco em disco
   */
  save() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
      // Esconde ainda mais - permissões restritas
      fs.chmodSync(this.dbPath, 0o600);
    } catch (e) {
      console.error('[DB] Erro ao salvar:', e.message);
    }
  }

  /**
   * Cria as tabelas do sistema
   */
  async createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        avatar_url TEXT DEFAULT '/default-avatar.png',
        bio TEXT DEFAULT '',
        role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin', 'moderator')),
        is_live INTEGER DEFAULT 0,
        live_title TEXT DEFAULT '',
        live_stream_key TEXT,
        followers_count INTEGER DEFAULT 0,
        following_count INTEGER DEFAULT 0,
        coins INTEGER DEFAULT 0,
        diamonds INTEGER DEFAULT 0,
        is_verified INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        last_login TEXT,
        ip_address TEXT,
        user_agent TEXT
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS lives (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        thumbnail_url TEXT DEFAULT '',
        category TEXT DEFAULT 'geral',
        tags TEXT DEFAULT '[]',
        viewer_count INTEGER DEFAULT 0,
        max_viewers INTEGER DEFAULT 0,
        duration_seconds INTEGER DEFAULT 0,
        status TEXT DEFAULT 'offline' CHECK(status IN ('live', 'offline', 'ended')),
        is_featured INTEGER DEFAULT 0,
        is_private INTEGER DEFAULT 0,
        stream_url TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS families (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        logo_url TEXT DEFAULT '',
        cover_url TEXT DEFAULT '',
        owner_id TEXT NOT NULL,
        members_count INTEGER DEFAULT 1,
        total_diamonds INTEGER DEFAULT 0,
        rank INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        is_public INTEGER DEFAULT 1,
        rules TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS family_members (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'member')),
        joined_at TEXT DEFAULT (datetime('now')),
        diamonds_contributed INTEGER DEFAULT 0,
        FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(family_id, user_id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS gifts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        image_url TEXT,
        price_coins INTEGER NOT NULL DEFAULT 0,
        price_diamonds INTEGER DEFAULT 0,
        animation_url TEXT,
        category TEXT DEFAULT 'normal',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS gift_transactions (
        id TEXT PRIMARY KEY,
        live_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        gift_id TEXT NOT NULL,
        quantity INTEGER DEFAULT 1,
        total_coins INTEGER NOT NULL,
        message TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (live_id) REFERENCES lives(id),
        FOREIGN KEY (sender_id) REFERENCES users(id),
        FOREIGN KEY (receiver_id) REFERENCES users(id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS followers (
        id TEXT PRIMARY KEY,
        follower_id TEXT NOT NULL,
        following_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (follower_id) REFERENCES users(id),
        FOREIGN KEY (following_id) REFERENCES users(id),
        UNIQUE(follower_id, following_id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        ticket_type TEXT NOT NULL CHECK(ticket_type IN (
          'denuncia', 'suporte', 'report_conteudo', 
          'report_usuario', 'report_live', 'duvida', 'outro'
        )),
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        evidence_url TEXT DEFAULT '',
        reported_user_id TEXT,
        reported_live_id TEXT,
        status TEXT DEFAULT 'aberto' CHECK(status IN (
          'aberto', 'em_andamento', 'resolvido', 'fechado', 'rejeitado'
        )),
        priority TEXT DEFAULT 'normal' CHECK(priority IN ('baixa', 'normal', 'alta', 'urgente')),
        assigned_to TEXT,
        response TEXT DEFAULT '',
        resolved_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS live_comments (
        id TEXT PRIMARY KEY,
        live_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        message TEXT NOT NULL,
        is_gifted INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (live_id) REFERENCES lives(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS bans (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        banned_by TEXT NOT NULL,
        reason TEXT NOT NULL,
        ban_type TEXT DEFAULT 'temporario' CHECK(ban_type IN ('permanente', 'temporario')),
        expires_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (banned_by) REFERENCES users(id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS security_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        user_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        details TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.save();

    // Insere presentes padrão se não existirem
    const giftCount = this.db.exec('SELECT COUNT(*) as count FROM gifts');
    if (!giftCount.length || giftCount[0].values[0][0] === 0) {
      const defaultGifts = [
        ['g001', '🌹 Rosa', 1, 'normal'],
        ['g002', '❤️ Coração', 5, 'normal'],
        ['g003', '🎉 Fogos', 10, 'animado'],
        ['g004', '🚀 Foguete', 50, 'vip'],
        ['g005', '👑 Coroa', 100, 'vip'],
        ['g006', '🏆 Troféu', 200, 'vip'],
        ['g007', '💎 Diamante', 500, 'premium'],
        ['g008', '🌟 Super Estrela', 1000, 'premium'],
        ['g009', '🏠 Mansão', 5000, 'lendario'],
        ['g010', '🚗 Lamborghini', 10000, 'lendario'],
      ];
      const stmt = this.db.prepare('INSERT INTO gifts (id, name, price_coins, category) VALUES (?, ?, ?, ?)');
      for (const g of defaultGifts) {
        stmt.run(g);
      }
      stmt.free();
      this.save();
    }

            // VibeStream tables
    this.db.run('CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, text TEXT NOT NULL, media_url TEXT DEFAULT \'\', media_type TEXT DEFAULT \'\', hashtags TEXT DEFAULT \'[]\', is_deleted INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime(\'now\')), FOREIGN KEY (user_id) REFERENCES users(id))');
    this.save();
    this.db.run('CREATE TABLE IF NOT EXISTS post_likes (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime(\'now\')), FOREIGN KEY (post_id) REFERENCES posts(id), FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE(post_id, user_id))');
    this.save();
    this.db.run('CREATE TABLE IF NOT EXISTS post_comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL, is_deleted INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime(\'now\')), FOREIGN KEY (post_id) REFERENCES posts(id), FOREIGN KEY (user_id) REFERENCES users(id))');
    try { this.db.run("ALTER TABLE post_comments ADD COLUMN parent_id TEXT DEFAULT ''"); } catch (e) {}
    this.db.run('CREATE TABLE IF NOT EXISTS media_hashes (hash TEXT PRIMARY KEY, status TEXT DEFAULT \'ok\' CHECK(status IN (\'ok\',\'review\',\'blocked\')), reason TEXT DEFAULT \'\', user_id TEXT DEFAULT \'\', created_at TEXT DEFAULT (datetime(\'now\')))');
    this.save();
    this.db.run('CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, user1_id TEXT NOT NULL, user2_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime(\'now\')), FOREIGN KEY (user1_id) REFERENCES users(id), FOREIGN KEY (user2_id) REFERENCES users(id))');
    this.save();
    this.db.run('CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, sender_id TEXT NOT NULL, text TEXT NOT NULL, read_at TEXT, created_at TEXT DEFAULT (datetime(\'now\')), FOREIGN KEY (chat_id) REFERENCES chats(id), FOREIGN KEY (sender_id) REFERENCES users(id))');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        actor_id TEXT,
        type TEXT NOT NULL,
        content_id TEXT,
        text TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS live_viewers (
        id TEXT PRIMARY KEY,
        live_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        joined_at TEXT DEFAULT (datetime('now')),
        left_at TEXT,
        FOREIGN KEY (live_id) REFERENCES lives(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS live_likes (
        id TEXT PRIMARY KEY,
        live_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (live_id) REFERENCES lives(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    this.save();

    
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_rules_acceptance (
        user_id TEXT PRIMARY KEY,
        version INTEGER DEFAULT 1,
        accepted_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS saved_posts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        post_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (post_id) REFERENCES posts(id),
        UNIQUE(user_id, post_id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS appeals (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente', 'aprovado', 'rejeitado')),
        admin_response TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        reviewed_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS chat_reports (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        reporter_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente', 'analisado', 'rejeitado')),
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (chat_id) REFERENCES chats(id),
        FOREIGN KEY (reporter_id) REFERENCES users(id)
      )
    `);
    this.save();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS content_reviews (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('review', 'approved', 'blocked')),
        reason TEXT DEFAULT '',
        moderated_by TEXT DEFAULT 'sistema',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (post_id) REFERENCES posts(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    this.save();

    console.log('[DB] Tabelas criadas/verificadas com sucesso.');
  }

  /**
   * Helper para consultas preparadas
   */
  prepare(sql) {
    if (!this.db) throw new Error('[DB] Banco não inicializado.');
    return this.db.prepare(sql);
  }

  /**
   * Executa SQL (escrita)
   */
  run(sql, params = []) {
    if (!this.db) throw new Error('[DB] Banco não inicializado.');
    const result = this.db.run(sql, params);
    this.save();
    return result;
  }

  /**
   * Executa consulta (leitura) - retorna array de objetos
   */
  query(sql, params = []) {
    if (!this.db) throw new Error('[DB] Banco não inicializado.');
    
    try {
      const stmt = this.db.prepare(sql);
      if (params.length > 0) {
        stmt.bind(params);
      }
      
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (e) {
      console.error('[DB] Query error:', e.message, 'SQL:', sql.substring(0, 100));
      return [];
    }
  }

  /**
   * Executa consulta e retorna primeiro resultado
   */
  get(sql, params = []) {
    const rows = this.query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Executa e retorna número de linhas afetadas
   */
  exec(sql) {
    if (!this.db) throw new Error('[DB] Banco não inicializado.');
    const result = this.db.exec(sql);
    this.save();
    return result;
  }

  /**
   * Obtém instância do banco
   */
  getInstance() {
    if (!this.initialized) {
      throw new Error('[DB] Banco não inicializado.');
    }
    return this;
  }

  /**
   * Fecha conexão
   */
  close() {
    if (this.db) {
      this.save();
      this.db.close();
      this.initialized = false;
      console.log('[DB] Conexão fechada.');
    }
  }
}

module.exports = SecureDatabase;

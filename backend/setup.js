/**
 * Setup - Melhora App Live
 * Cria admin e dados iniciais automaticamente
 */
require('dotenv').config({ path: '../.env' });
const path = require('path');
const bcrypt = require('bcryptjs');
const uuid = require('uuid');
const SecureDatabase = require('./database');

async function setup() {
  const dbDir = path.join(__dirname, '.data');
  const db = new SecureDatabase(dbDir);
  await db.initialize();
  const dbInst = db.getInstance();

  // Verifica se já existe admin
  const existingAdmin = dbInst.get("SELECT id FROM users WHERE role = 'admin'");
  if (existingAdmin) {
    console.log('[SETUP] Admin já existe. Pulando criação.');
    
    // Atualiza senha do admin
    const adminPass = process.env.ADMIN_PASSWORD || 'Admin@2024!MelhoraSecure';
    const hash = await bcrypt.hash(adminPass, 10);
    dbInst.run('UPDATE users SET password_hash = ? WHERE role = ?', [hash, 'admin']);
    console.log('[SETUP] Senha do admin atualizada.');
  } else {
    // Cria admin
    const adminId = uuid.v4();
    const adminUser = process.env.ADMIN_EMAIL || 'admin@melhora.app';
    const adminPass = process.env.ADMIN_PASSWORD || 'Admin@2024!MelhoraSecure';
    const hash = await bcrypt.hash(adminPass, 10);
    
    dbInst.run(
      `INSERT INTO users (id, username, email, password_hash, display_name, role, is_verified, status, diamonds, coins)
       VALUES (?, ?, ?, ?, ?, 'admin', 1, 'active', 999999, 999999)`,
      [adminId, 'admin', adminUser, hash, 'Administrador']
    );
    console.log('[SETUP] ✅ Conta admin criada!');
    console.log(`  Usuário: admin`);
    console.log(`  Email: ${adminUser}`);
    console.log(`  Senha: ${adminPass}`);
  }

  // Garante que admin não pode ser banido
  const admin = dbInst.get("SELECT id FROM users WHERE role = 'admin'");
  if (admin) {
    dbInst.run("DELETE FROM bans WHERE user_id = ?", [admin.id]);
  }

  // Verifica se existem dados demo
  const postCount = (dbInst.get('SELECT COUNT(*) as c FROM posts') || {}).c || 0;
  if (postCount === 0) {
    const admin = dbInst.get("SELECT id, username FROM users WHERE role = 'admin'");
    if (admin) {
      console.log('[SETUP] Criando posts de exemplo...');
      dbInst.run(
        "INSERT INTO posts (id, user_id, text, hashtags) VALUES (?, ?, ?, ?)",
        [uuid.v4(), admin.id, 'VibeStream está no ar! 🚀 Conectando pessoas com lives e conteúdo incrível!', '["VibeStream","lancamento"]']
      );
      dbInst.run(
        "INSERT INTO posts (id, user_id, text, hashtags) VALUES (?, ?, ?, ?)",
        [uuid.v4(), admin.id, 'VibeStream - A nova rede social de lives! Crie sua família, faça lives e conecte com pessoas do mundo todo! 🌍', '["VibeStream","Comunidade"]']
      );
      console.log('[SETUP] ✅ Posts de exemplo criados!');
    }
  }

  // Verifica se existem lives
  const liveCount = (dbInst.get('SELECT COUNT(*) as c FROM lives') || {}).c || 0;
  if (liveCount === 0) {
    const admin = dbInst.get("SELECT id, username FROM users WHERE role = 'admin'");
    if (admin) {
      console.log('[SETUP] Criando lives de demonstração...');
      const streamKey1 = require('crypto').randomBytes(16).toString('hex');
      const streamKey2 = require('crypto').randomBytes(16).toString('hex');
      dbInst.run(
        "INSERT INTO lives (id, user_id, title, category, status, stream_url, viewer_count, started_at) VALUES (?, ?, ?, ?, 'live', ?, ?, datetime('now'))",
        [uuid.v4(), admin.id, '📺 VibeStream Ao Vivo!', 'geral', '/stream/' + streamKey1, 3]
      );
      dbInst.run(
        "INSERT INTO lives (id, user_id, title, category, status, stream_url, viewer_count, started_at) VALUES (?, ?, ?, ?, 'live', ?, ?, datetime('now'))",
        [uuid.v4(), admin.id, '🎵 Música ao Vivo', 'musica', '/stream/' + streamKey2, 1]
      );
      dbInst.run('UPDATE users SET is_live = 1 WHERE id = ?', [admin.id]);
      console.log('[SETUP] ✅ Lives de demonstração criadas!');
    }
  }

  // Garante tabela de followers
  dbInst.run(`CREATE TABLE IF NOT EXISTS followers (
    id TEXT PRIMARY KEY,
    follower_id TEXT NOT NULL,
    following_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (follower_id) REFERENCES users(id),
    FOREIGN KEY (following_id) REFERENCES users(id),
    UNIQUE(follower_id, following_id)
  )`);
  db.initialize(); // Re-save

  db.close();
  console.log('[SETUP] ✅ Setup concluído!');
}

setup().catch(err => {
  console.error('[SETUP] Erro:', err);
  process.exit(1);
});

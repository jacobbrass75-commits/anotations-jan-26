const Database = require('better-sqlite3');
const db = new Database('./data/sourceannotator.db');

// Create conversations table
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT NOT NULL DEFAULT 'New Chat',
    model TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);

// Create messages table
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tokens_used INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )
`);

// Update users table if needed
const userCols = db.pragma('table_info(users)').map(c => c.name);
if (!userCols.includes('email')) {
  db.exec('ALTER TABLE users ADD COLUMN email TEXT');
  db.exec('ALTER TABLE users ADD COLUMN first_name TEXT');
  db.exec('ALTER TABLE users ADD COLUMN last_name TEXT');
  db.exec("ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'");
  db.exec('ALTER TABLE users ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE users ADD COLUMN token_limit INTEGER NOT NULL DEFAULT 50000');
  db.exec('ALTER TABLE users ADD COLUMN storage_used INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE users ADD COLUMN storage_limit INTEGER NOT NULL DEFAULT 52428800');
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0');
  db.exec('ALTER TABLE users ADD COLUMN billing_cycle_start INTEGER');
  db.exec('ALTER TABLE users ADD COLUMN created_at INTEGER');
  db.exec('ALTER TABLE users ADD COLUMN updated_at INTEGER');
  console.log('Users table updated with new columns');
}

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
console.log('Tables:', tables.join(', '));
db.close();
console.log('Migration complete');

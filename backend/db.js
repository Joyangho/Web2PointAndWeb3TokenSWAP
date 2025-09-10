// backend/db.js - Updated for Voucher System
const Database = require('better-sqlite3');

const db = new Database(process.env.DATABASE_URL || './points.db');

// users 테이블
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  address TEXT PRIMARY KEY,
  points  INTEGER NOT NULL DEFAULT 0
);
`);

// vouchers 테이블
db.exec(`
CREATE TABLE IF NOT EXISTS vouchers (
  nonce TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  points_deducted INTEGER NOT NULL,
  token_amount TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (user_address) REFERENCES users(address)
);
`);

// 인덱스 추가
db.exec(`
CREATE INDEX IF NOT EXISTS idx_vouchers_user_status 
ON vouchers(user_address, status);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_vouchers_deadline 
ON vouchers(deadline);
`);

// 만료된 바우처 정리 함수
function cleanupExpiredVouchers() {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    UPDATE vouchers 
    SET status = 'expired', updated_at = datetime('now')
    WHERE status = 'pending' AND deadline < ?
  `).run(now);

  if (result.changes > 0) {
    console.log(`Cleaned up ${result.changes} expired vouchers`);
  }
  return result.changes;
}

// 주기적 정리 (5분마다)
setInterval(cleanupExpiredVouchers, 5 * 60 * 1000);

module.exports = db;
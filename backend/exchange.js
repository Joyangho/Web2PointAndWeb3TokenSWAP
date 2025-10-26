// backend/exchange.js - burn 영수증 검증 + 만료 환급 + 재적립
const { ethers } = require('ethers');
const db = require('./db');
const { ADDRESS, ABI } = require('./smartcontracts');

// ===== Provider =====
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);

// ===== PRIVATE KEY 안전 파싱/검증 =====
let pk = (process.env.SERVER_PRIVATE_KEY || '').trim();
if ((pk.startsWith('"') && pk.endsWith('"')) || (pk.startsWith("'") && pk.endsWith("'"))) {
  pk = pk.slice(1, -1).trim();
}
if (!pk.startsWith('0x')) pk = '0x' + pk;
if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  throw new Error('Invalid SERVER_PRIVATE_KEY format: expected 0x + 64 hex characters');
}
const wallet = new ethers.Wallet(pk, provider);

// ===== 상수 =====
const tokenAddress = ADDRESS.token; // 읽기 주소만 필요 (이 파일에서는 컨트랙트 인스턴스 직접 사용 안 함)
const DECIMALS = 18;
const POINTS_PER_TOKEN = Math.max(1, Number(process.env.RATE_POINTS_PER_TOKEN || '1'));

// ===== DB helpers =====
function getPoints(address) {
  const row = db.prepare('SELECT points FROM users WHERE address = ?').get(address.toLowerCase());
  return row ? row.points : 0;
}
function setPoints(address, value) {
  const addr = address.toLowerCase();
  db.prepare(`
    INSERT INTO users(address, points)
    VALUES(?, ?)
    ON CONFLICT(address) DO UPDATE SET points = excluded.points
  `).run(addr, value);
  return value;
}
function addPoints(address, delta) {
  return setPoints(address, getPoints(address) + delta);
}

// ===== Voucher helpers =====
function generateUniqueNonceBig() {
  const t = BigInt(Date.now());
  const r = BigInt(Math.floor(Math.random() * 1_000_000));
  return (t * 1_000_000n) + r; // bigint
}

// 환급 전까지 만료 바우처도 목록에 남김
function getVouchers(address) {
  const addr = address.toLowerCase();
  return db.prepare(`
    SELECT * FROM vouchers 
    WHERE user_address = ?
      AND status IN ('pending','expired')
    ORDER BY created_at DESC
  `).all(addr);
}

function saveVoucher(v) {
  db.prepare(`
    INSERT INTO vouchers (
      nonce, user_address, points_deducted, token_amount, 
      deadline, signature, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    v.nonce,
    v.user.toLowerCase(),
    v.pointsDeducted,
    v.tokenAmount,
    v.deadline,
    v.signature,
    'pending'
  );
}
function updateVoucherStatus(nonce, status) {
  db.prepare(`
    UPDATE vouchers SET status = ?, updated_at = datetime('now') 
    WHERE nonce = ?
  `).run(status, nonce);
}

// ===== EIP-712 서명 =====
async function signVoucher(voucher) {
  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);

  const domain = {
    name: 'BloomingGov',
    version: '1',
    chainId,
    verifyingContract: tokenAddress
  };
  const types = {
    ExchangeVoucher: [
      { name: 'user',           type: 'address'  },
      { name: 'pointsDeducted', type: 'uint256'  },
      { name: 'tokenAmount',    type: 'uint256'  },
      { name: 'nonce',          type: 'uint256'  },
      { name: 'deadline',       type: 'uint256'  },
    ]
  };
  // v5에서는 문자열/숫자/BN 모두 허용되지만, 교차환경 안전을 위해 문자열로 고정
  const value = {
    user: voucher.user,
    pointsDeducted: voucher.pointsDeducted.toString(),
    tokenAmount: voucher.tokenAmount.toString(),
    nonce: voucher.nonce.toString(),
    deadline: voucher.deadline.toString()
  };

  return await wallet._signTypedData(domain, types, value);
}

// ===== 바우처 생성 (포인트 → 토큰) =====
async function createExchangeVoucher(address, pointsToSpend) {
  if (!address) throw new Error('missing address');
  if (!Number.isFinite(pointsToSpend) || pointsToSpend <= 0) {
    throw new Error('invalid points');
  }

  const addr = address.toLowerCase();
  const current = getPoints(addr);
  if (current < pointsToSpend) throw new Error('insufficient points');

  const tokens = Math.floor(pointsToSpend / POINTS_PER_TOKEN);
  if (tokens <= 0) throw new Error(`points must be >= ${POINTS_PER_TOKEN}`);

  const tokenAmountBN = ethers.utils.parseUnits(tokens.toString(), DECIMALS); // BigNumber
  const used = tokens * POINTS_PER_TOKEN;
  const nonceBig = generateUniqueNonceBig(); // bigint
  const deadlineBig = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1시간

  const voucher = db.transaction(() => {
    db.prepare('UPDATE users SET points = points - ? WHERE address = ?').run(used, addr);
    return {
      user: address,
      pointsDeducted: used,                      // number
      tokenAmount: tokenAmountBN.toString(),     // string (BN → string)
      nonce: nonceBig.toString(),                // string
      deadline: deadlineBig.toString()           // string
    };
  })();

  const signature = await signVoucher({
    user: voucher.user,
    pointsDeducted: voucher.pointsDeducted,        // string으로 변환은 signVoucher 내부에서 처리
    tokenAmount: voucher.tokenAmount,
    nonce: voucher.nonce,
    deadline: voucher.deadline,
  });

  saveVoucher({ ...voucher, signature });

  return {
    voucher,
    signature,
    usedPoints: used,
    ratePointsPerToken: POINTS_PER_TOKEN
  };
}

// ===== 토큰 → 포인트: 사용자 burn TX 검증 =====
async function creditFromBurnTx(userAddress, tokensAmount, txHash) {
  const addr = userAddress.toLowerCase();
  if (!addr) throw new Error('missing address');
  if (!Number.isFinite(tokensAmount) || tokensAmount <= 0) throw new Error('invalid tokens');
  if (!txHash || !/^0x([0-9a-fA-F]{64})$/.test(txHash)) throw new Error('invalid tx hash');

  // 1) tx receipt
  const rec = await provider.getTransactionReceipt(txHash);
  if (!rec || rec.status !== 1) throw new Error('transaction not found or failed');

  // 2) 대상 컨트랙트 확인
  if (!rec.to || rec.to.toLowerCase() !== tokenAddress.toLowerCase()) {
    throw new Error('tx target mismatch');
  }

  // 3) Burned 이벤트 파싱
  const iface = new ethers.utils.Interface(ABI.token);
  let burnedFrom = null, burnedAmountBN = null;

  for (const log of rec.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'Burned') {
        burnedFrom = parsed.args.from.toLowerCase();
        burnedAmountBN = ethers.BigNumber.from(parsed.args.amount);
        break;
      }
    } catch (_) {}
  }
  if (!burnedFrom) throw new Error('burn event not found');
  if (burnedFrom !== addr) throw new Error('burned-from mismatch');

  // 4) 금액 일치
  const expectedBN = ethers.utils.parseUnits(tokensAmount.toString(), DECIMALS);
  if (!burnedAmountBN.eq(expectedBN)) throw new Error('burn amount mismatch');

  // 5) 포인트 적립
  const credit = tokensAmount * POINTS_PER_TOKEN;
  const newPoints = addPoints(addr, credit);
  return { credited: credit, points: newPoints, ratePointsPerToken: POINTS_PER_TOKEN };
}

// ===== 만료 바우처 환급 =====
function refundExpiredVoucher(address, nonce) {
  const addr = address.toLowerCase();
  const row = db.prepare(`SELECT * FROM vouchers WHERE nonce = ? AND user_address = ?`).get(String(nonce), addr);
  if (!row) throw new Error('voucher not found');

  const now = Math.floor(Date.now() / 1000);
  if (!(row.status === 'expired' || (row.status === 'pending' && Number(row.deadline) < now))) {
    throw new Error('voucher not expired');
  }

  const refunded = Number(row.points_deducted);
  addPoints(addr, refunded);
  updateVoucherStatus(row.nonce, 'expired_refunded');

  return { refunded, points: getPoints(addr) };
}

// ===== 만료 전 재적립 =====
function redepositVoucher(address, nonce) {
  const addr = address.toLowerCase();
  const row = db.prepare(`SELECT * FROM vouchers WHERE nonce = ? AND user_address = ?`).get(String(nonce), addr);
  if (!row) throw new Error('voucher not found');

  if (row.status !== 'pending') {
    throw new Error('only pending vouchers can be re-deposited');
  }

  const restored = Number(row.points_deducted);
  addPoints(addr, restored);
  updateVoucherStatus(row.nonce, 'redeposited');

  return { restored, points: getPoints(addr) };
}

module.exports = {
  // Points
  getPoints,
  addPoints,

  // Vouchers
  getVouchers,
  createExchangeVoucher,
  refundExpiredVoucher,
  redepositVoucher,

  // Exchange
  creditFromBurnTx,

  // Utils
  walletAddress: wallet.address,
};

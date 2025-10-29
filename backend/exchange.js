// backend/exchange.js - burn 영수증 검증 + 만료 환급 + 재적립
const { ethers } = require('ethers');
const db = require('./db');
const { ADDRESS, ABI } = require('./smartcontracts');

// ===== Provider =====
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);

// PRIVATE KEY 안전 파싱/검증
let pk = (process.env.SERVER_PRIVATE_KEY || '').trim();
if ((pk.startsWith('"') && pk.endsWith('"')) || (pk.startsWith("'") && pk.endsWith("'"))) {
  pk = pk.slice(1, -1).trim();
}
if (!pk.startsWith('0x')) pk = '0x' + pk;
if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  throw new Error('Invalid SERVER_PRIVATE_KEY format: expected 0x + 64 hex characters');
}
const wallet = new ethers.Wallet(pk, provider);

const tokenAddress = ADDRESS.token;
const token = new ethers.Contract(tokenAddress, ABI.token, provider);
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
  const timestampNonce = BigInt(Date.now());
  const randomComponent = BigInt(Math.floor(Math.random() * 1_000_000));
  const NONCE_MULTIPLIER = 1_000_000n;

  return (timestampNonce * NONCE_MULTIPLIER) + randomComponent;
}

token.on('VoucherRedeemed', async (user, nonce, pointsDeducted, tokenAmount, deadline, event) => {
  try {
    const nonceStr = String(nonce?.toString ? nonce.toString() : nonce);
    const row = db.prepare('SELECT status FROM vouchers WHERE nonce = ?').get(nonceStr);
    if (row && row.status !== 'used') {
      db.prepare(`UPDATE vouchers SET status = 'used', updated_at = datetime('now') WHERE nonce = ?`)
        .run(nonceStr);
      console.log(`[db] voucher ${nonceStr} -> used (on-chain)`);
    }
  } catch (e) {
    console.error('VoucherRedeemed handler error:', e);
  }
});

// 환급 전까지 만료 바우처도 목록에 남김
function getVouchersAwaitingRefund(address) {
  const addr = address.toLowerCase();
  const REFUNDABLE_STATUSES = ['pending', 'expired'];

  return db.prepare(`
    SELECT * FROM vouchers 
    WHERE user_address = ?
      AND status IN (?, ?)
  `).all(addr, ...REFUNDABLE_STATUSES);
}

function saveVoucher(v) {
  if (!v.signature) throw new Error('missing signature');
  if (!/^0x[0-9a-fA-F]{130}$/.test(v.signature))
    throw new Error('invalid signature format');

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
      { name: 'user', type: 'address' },
      { name: 'pointsDeducted', type: 'uint256' },
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ]
  };
  const value = {
    user: voucher.user,
    pointsDeducted: voucher.pointsDeducted.toString(),
    tokenAmount: voucher.tokenAmount.toString(),
    nonce: voucher.nonce.toString(),
    deadline: voucher.deadline.toString()
  };

  return await wallet._signTypedData(domain, types, value);
}

// ===== 온체인 논스 사용여부 체크 (공통) =====
async function isNonceUsedOnChain(nonce) {
  if (typeof token.isNonceUsed === 'function') {
    return await token.isNonceUsed(ethers.BigNumber.from(String(nonce)));
  }
  if (typeof token.usedNonces === 'function') {
    return await token.usedNonces(ethers.BigNumber.from(String(nonce)));
  }
  throw new Error('contract missing isNonceUsed/usedNonces');
}

// ===== DB 원자적 처리 (포인트 증감 + 상태변경) =====
function atomicPointsAndStatus(addr, pointsDelta, nonce, newStatus) {
  return db.transaction(() => {
    if (pointsDelta !== 0) {
      db.prepare(`UPDATE users SET points = points + ? WHERE address = ?`)
        .run(pointsDelta, addr);
    }
    updateVoucherStatus(nonce, newStatus);
    const cur = db.prepare(`SELECT points FROM users WHERE address = ?`).get(addr);
    return cur?.points ?? 0;
  })();
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

  const tokenAmountBN = ethers.utils.parseUnits(tokens.toString(), DECIMALS);
  const used = tokens * POINTS_PER_TOKEN;
  const nonceBig = generateUniqueNonceBig();
  const deadlineBig = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const tempVoucher = {
    user: address,
    pointsDeducted: used,
    tokenAmount: tokenAmountBN.toString(),
    nonce: nonceBig.toString(),
    deadline: deadlineBig.toString()
  };

  const signature = await signVoucher(tempVoucher);
  const voucherRow = { ...tempVoucher, signature };

  db.transaction(() => {
    db.prepare('UPDATE users SET points = points - ? WHERE address = ?')
      .run(used, addr);

    saveVoucher(voucherRow);
  })();

  return {
    voucher: voucherRow,
    signature,
    usedPoints: used,
    ratePointsPerToken: POINTS_PER_TOKEN
  };
}

// Burned 이벤트 파싱 로직
function parseBurnedEventFromReceipt(receipt, expectedAddress) {
  const iface = new ethers.utils.Interface(ABI.token);
  let burnedFrom = null, burnedAmountBN = null;

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'Burned') {
        burnedFrom = parsed.args.from.toLowerCase();
        burnedAmountBN = ethers.BigNumber.from(parsed.args.amount);
        break;
      }
    } catch (_) { }
  }

  if (!burnedFrom) throw new Error('burn event not found');
  if (burnedFrom !== expectedAddress.toLowerCase()) throw new Error('burned-from mismatch');

  return { from: burnedFrom, amount: burnedAmountBN };
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

  // 3) Burned 이벤트 파싱 및 검증
  const { amount: burnedAmountBN } = parseBurnedEventFromReceipt(rec, addr);

  // 4) 금액 일치
  const expectedBN = ethers.utils.parseUnits(tokensAmount.toString(), DECIMALS);
  if (!burnedAmountBN.eq(expectedBN)) throw new Error('burn amount mismatch');

  // 5) 포인트 적립
  const credit = tokensAmount * POINTS_PER_TOKEN;
  const newPoints = addPoints(addr, credit);
  return { credited: credit, points: newPoints, ratePointsPerToken: POINTS_PER_TOKEN };
}

// ===== 환급/재적립 공통 파이프 =====
async function processVoucher(address, nonceInput, mode) {
  const addr = address.toLowerCase();
  const nonce = String(nonceInput);
  const row = db.prepare(`
    SELECT * FROM vouchers WHERE nonce = ? AND user_address = ?
  `).get(nonce, addr);
  if (!row) throw new Error('voucher not found');

  const now = Math.floor(Date.now() / 1000);
  const isExpired = Number(row.deadline) < now;

  if (mode === 'refund') {
    if (!(row.status === 'expired' || (row.status === 'pending' && isExpired))) {
      throw new Error('voucher not expired');
    }
  } else if (mode === 'redeposit') {
    if (row.status !== 'pending') throw new Error('only pending vouchers can be re-deposited');
    if (isExpired) throw new Error('cannot redeposit expired voucher');
  } else {
    throw new Error('invalid action');
  }

  const usedOnChain = await isNonceUsedOnChain(row.nonce);
  if (usedOnChain) {
    updateVoucherStatus(row.nonce, 'used');
    throw new Error('voucher already used on-chain');
  }

  const delta = Number(row.points_deducted);
  const newStatus = (mode === 'refund') ? 'expired_refunded' : 'redeposited';
  const pointsAfter = atomicPointsAndStatus(addr, delta, row.nonce, newStatus);

  return mode === 'refund'
    ? { refunded: delta, points: pointsAfter }
    : { restored: delta, points: pointsAfter };
}

async function refundExpiredVoucher(address, nonce) {
  return await processVoucher(address, nonce, 'refund');
}

async function redepositVoucher(address, nonce) {
  return await processVoucher(address, nonce, 'redeposit');
}

module.exports = {
  // Points
  getPoints,
  addPoints,

  // Vouchers
  getVouchersAwaitingRefund,
  createExchangeVoucher,
  refundExpiredVoucher,
  redepositVoucher,

  // Exchange
  creditFromBurnTx,

  // Utils
  walletAddress: wallet.address,
};

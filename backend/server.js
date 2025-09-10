// backend/server.js - burn TX 검증 & 만료 환급 & 재적립 라우트 포함
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const {
  getPoints,
  addPoints,
  getVouchers,
  createExchangeVoucher,
  creditFromBurnTx,     // 사용자 burn 검증 -> 포인트 적립
  refundExpiredVoucher, // 만료 환급
  redepositVoucher,     // 만료 전 재적립
  walletAddress,
} = require('./exchange');
const { ADDRESS, ABI } = require('./smartcontracts');

const app = express();

// ===== Middlewares =====
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ===== Health =====
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// ===== Config =====
app.get('/config', (_req, res) => {
  res.json({
    tokenAddress: ADDRESS.token,
    tokenAbi: ABI.token,
    spender: walletAddress,
    serverSigner: walletAddress, // 바우처 서명자
  });
});

// ===== Points =====
app.get('/points/:address', (req, res) => {
  const address = String(req.params.address || '').trim();
  if (!address) return res.status(400).json({ error: 'missing address' });
  const p = getPoints(address);
  res.json({ address, points: p });
});

app.post('/points/grant', (req, res) => {
  const address = String(req.body.address || '').trim();
  const amount = Number(req.body.amount);
  if (!address || !Number.isFinite(amount)) {
    return res.status(400).json({ error: 'invalid params' });
  }
  const p = addPoints(address, amount);
  res.json({ address, points: p });
});

app.post('/points/earn', (req, res) => {
  const address = String(req.body.address || '').trim();
  if (!address) return res.status(400).json({ error: 'missing address' });
  const p = addPoints(address, 50);
  res.json({ address, points: p, earned: 50 });
});

// ===== Vouchers =====

// 목록: pending + expired(미환급) 유지
app.get('/vouchers/:address', (req, res) => {
  const address = String(req.params.address || '').trim();
  if (!address) return res.status(400).json({ error: 'missing address' });
  try {
    const vouchers = getVouchers(address);
    res.json({ address, vouchers });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to get vouchers' });
  }
});

// 생성 (포인트 → 바우처)
app.post('/vouchers/create', async (req, res) => {
  try {
    const address = String(req.body.address || '').trim();
    const points = Number(req.body.points);
    if (!address || !Number.isFinite(points)) {
      return res.status(400).json({ error: 'invalid params' });
    }
    const result = await createExchangeVoucher(address, points);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message || 'voucher creation failed' });
  }
});

// 만료 바우처 환급
app.post('/vouchers/refund-expired', (req, res) => {
  try {
    const address = String(req.body.address || '').trim();
    const nonce = String(req.body.nonce || '').trim();
    if (!address || !nonce) return res.status(400).json({ error: 'invalid params' });
    const out = refundExpiredVoucher(address, nonce);
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message || 'refund failed' });
  }
});

// 만료 전 재적립
app.post('/vouchers/redeposit', (req, res) => {
  try {
    const address = String(req.body.address || '').trim();
    const nonce = String(req.body.nonce || '').trim();
    if (!address || !nonce) return res.status(400).json({ error: 'invalid params' });
    const out = redepositVoucher(address, nonce);
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message || 'redeposit failed' });
  }
});

// ===== Exchange (Token -> Points) =====

// 사용자 burn() 트랜잭션 검증 → 포인트 적립
app.post('/exchange/burn-to-points', async (req, res) => {
  try {
    const address = String(req.body.address || '').trim();
    const tokens = Number(req.body.tokens);
    const txHash = String(req.body.txHash || '').trim();
    if (!address || !Number.isFinite(tokens) || !txHash) {
      return res.status(400).json({ error: 'invalid params' });
    }
    const out = await creditFromBurnTx(address, tokens, txHash);
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message || 'exchange failed' });
  }
});

// 404
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

// Start
const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`API on :${port}`);
  console.log(`Server wallet: ${walletAddress}`);
});

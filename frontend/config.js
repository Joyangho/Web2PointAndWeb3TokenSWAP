// frontend/config.js - 설정 및 초기화
const API = 'http://localhost:3001';

// 전역 변수들
let provider, signer, addr;
let tokenAddress, tokenAbi, spender, serverSigner;

// ===== 설정 로드 =====
async function loadConfig() {
  const cfg = await fetch(`${API}/config`).then(r => r.json());
  tokenAddress = cfg.tokenAddress;
  tokenAbi = cfg.tokenAbi;
  spender = cfg.spender;
  serverSigner = cfg.serverSigner;

  // UI 업데이트
  const spenderElement = $('#spender');
  if (spenderElement) spenderElement.textContent = spender;

  const scan = `https://sepolia.etherscan.io/address/${tokenAddress}`;
  const etherscanLink = $('#linkEtherscan');
  if (etherscanLink) etherscanLink.href = scan;

  const scanBtn = $('#btnScan');
  if (scanBtn) scanBtn.href = scan;
}

// ===== 전역 변수 접근자 함수들 =====
function getProvider() { return provider; }
function getSigner() { return signer; }
function getAddress() { return addr; }
function getTokenAddress() { return tokenAddress; }
function getTokenAbi() { return tokenAbi; }
function getSpender() { return spender; }

function setProvider(p) { provider = p; }
function setSigner(s) { signer = s; }
function setAddress(a) { addr = a; }
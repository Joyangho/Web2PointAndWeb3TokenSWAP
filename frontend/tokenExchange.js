// frontend/tokenExchange.js - 토큰 교환 기능 (approve 제거(burnfrom) → 직접 burn)
async function getTokenBalanceOnly() {
  const addr = getAddress();
  const provider = getProvider();

  if (!addr || !provider || !getTokenAddress() || !getTokenAbi()) {
    return { balance: '0', error: null };
  }

  try {
    const contract = new ethers.Contract(getTokenAddress(), getTokenAbi(), provider);
    const balance = await contract.balanceOf(addr);
    return { balance: ethers.formatUnits(balance, 18), error: null };
  } catch (error) {
    console.warn('Failed to get balance:', error);
    return { balance: '0', error: error.message };
  }
}

// UI 업데이트
async function updateTokenInfo() {
  const { balance, error } = await getTokenBalanceOnly();
  const balanceEl = $('#tokenBalance');
  if (error) { if (balanceEl) balanceEl.textContent = '-'; return; }
  if (balanceEl) balanceEl.textContent = Number(balance).toFixed(2);
}

// 토큰 → 포인트: 직접 burn 후, TX 해시로 적립 요청
async function exchangeTokensToPoints(tokens) {
  const addr = getAddress();
  const signer = getSigner();

  if (!addr || !signer) {
    alert('지갑 연결이 필요합니다.');
    return;
  }

  try {
    // 1) 잔액 확인
    showOverlay('토큰 잔액 확인 중…');
    const { balance } = await getTokenBalanceOnly();
    const tokenBalance = Number(balance);
    if (!Number.isFinite(tokens) || tokens <= 0 || !Number.isInteger(tokens)) {
      throw new Error('유효한 토큰 수량(정수)을 입력해주세요.');
    }
    if (tokenBalance < tokens) {
      throw new Error(`토큰 잔액이 부족합니다. 보유: ${tokenBalance.toFixed(2)}, 필요: ${tokens}`);
    }

    const amountWei = ethers.parseUnits(tokens.toString(), 18);

    // 2) 온체인 직접 소각
    showOverlay('토큰 소각 중…');
    const tWrite = new ethers.Contract(getTokenAddress(), getTokenAbi(), signer);
    const burnTx = await tWrite.burn(amountWei);
    await burnTx.wait(1);

    // 3) 백엔드에 소각 TX 해시 제출 → 포인트 적립
    showOverlay('소각 확인 및 포인트 적립 중…');
    const r = await fetch(`${API}/exchange/burn-to-points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr, tokens, txHash: burnTx.hash })
    }).then(r => r.json());

    if (r.error) throw new Error(r.error);

    $('#txExchange').className = 'status ok';
    $('#txExchange').textContent = `✅ 교환 완료! 소각 TX: ${burnTx.hash.slice(0, 10)}..., 적립 포인트: ${r.credited}`;

    // 4) 새로고침
    await Promise.allSettled([
      refreshPoints(),
      refreshGovernanceInfo(),
      updateTokenInfo()
    ]);

    hideOverlay('교환 완료');
    setTimeout(checkWalletConnection, 2000);

  } catch (error) {
    hideOverlay();
    $('#txExchange').className = 'status error';
    $('#txExchange').textContent = '❌ ' + friendlyError(error);
  }
}

// 이벤트 바인딩
function initExchangeEventHandlers() {
  $('#exchangeTokens').onclick = async (e) => {
    e.preventDefault();
    const tokens = Number($('#tokensToSpend').value || '0');
    await exchangeTokensToPoints(tokens);
  };

  $('#refreshTokenInfo').onclick = async (e) => {
    e.preventDefault();
    if (!getAddress()) { alert('지갑 연결이 필요합니다.'); return; }
    try {
      showOverlay('토큰 정보 새로고침 중…');
      await updateTokenInfo();
      hideOverlay();
    } catch (error) {
      hideOverlay();
      alert(friendlyError(error));
    }
  };
}

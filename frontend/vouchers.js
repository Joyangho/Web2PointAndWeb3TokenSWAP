// frontend/vouchers.js - 바우처 시스템 (만료 환급 버튼 추가)
async function refreshVouchers() {
  const addr = getAddress();
  if (!addr) return;

  try {
    const r = await fetch(`${API}/vouchers/${addr}`).then(r => r.json());
    if (r.error) throw new Error(r.error);
    displayVouchers(r.vouchers || []);
  } catch (error) {
    console.warn('Failed to refresh vouchers:', error);
  }
}

function displayVouchers(vouchers) {
  const container = $('#voucherList');
  if (!container) return;

  if (vouchers.length === 0) {
    container.innerHTML = '<div class="no-vouchers">사용 가능한 바우처가 없습니다</div>';
    return;
  }

  const html = vouchers.map(voucher => `
    <div class="voucher-card" data-nonce="${voucher.nonce}">
      <div class="voucher-header">
        <div class="voucher-amount">${formatTokenAmount(voucher.token_amount)} BGOV</div>
        <div class="voucher-status ${getVoucherStatusClass(voucher)}">${getVoucherStatusText(voucher)}</div>
      </div>
      <div class="voucher-details">
        <div class="voucher-info">
          <span>사용된 포인트: ${voucher.points_deducted}</span>
          <span>만료: ${formatTimeLeft(voucher.deadline)}</span>
        </div>
        <div class="voucher-actions">
          ${getVoucherActions(voucher)}
        </div>
      </div>
    </div>
  `).join('');

  container.innerHTML = html;
  container.querySelectorAll('.btn-claim').forEach(btn => {
    btn.onclick = (ev) => { ev.preventDefault(); claimVoucher(btn.dataset.nonce); };
  });
  container.querySelectorAll('.btn-refund').forEach(btn => {
    btn.onclick = (ev) => { ev.preventDefault(); refundExpiredVoucher(btn.dataset.nonce); };
  });
  container.querySelectorAll('.btn-redeposit').forEach(btn => {
    btn.onclick = (ev) => { ev.preventDefault(); redepositVoucher(btn.dataset.nonce); };
  });

}

function getVoucherStatusClass(voucher) {
  const now = Math.floor(Date.now() / 1000);
  if (Number(voucher.deadline) < now) return 'expired';
  if (voucher.status === 'used') return 'used';
  return 'pending';
}

function getVoucherStatusText(voucher) {
  const now = Math.floor(Date.now() / 1000);
  if (Number(voucher.deadline) < now) return '만료됨';
  if (voucher.status === 'used') return '사용됨';
  return '사용 가능';
}

function getVoucherActions(voucher) {
  const now = Math.floor(Date.now() / 1000);
  if (voucher.status === 'used') {
    return '<span class="disabled-text">사용 불가</span>';
  }
  if (Number(voucher.deadline) < now) {
    // 만료 바우처에 환급 버튼 표시 (재적립 전에는 카드 유지)
    return `<button class="btn ghost btn-refund" data-nonce="${voucher.nonce}" type="button">만료 포인트 받기</button>`;
  }
  return `<button class="btn primary btn-claim" data-nonce="${voucher.nonce}" type="button">토큰 받기</button>`;
}

async function createVoucher(points) {
  const addr = getAddress();
  if (!addr) { alert('지갑 연결이 필요합니다.'); return; }

  try {
    showOverlay('바우처 생성 중…');
    const r = await fetch(`${API}/vouchers/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr, points })
    }).then(r => r.json());
    if (r.error) throw new Error(r.error);

    $('#tx').className = 'status ok';
    $('#tx').textContent = `✅ 바우처 생성 완료! 토큰: ${formatTokenAmount(r.voucher.tokenAmount)} BGOV`;

    await Promise.allSettled([refreshPoints(), refreshVouchers()]);
    hideOverlay('바우처 생성 완료');
    setTimeout(checkWalletConnection, 1000);
  } catch (error) {
    hideOverlay();
    $('#tx').className = 'status error';
    $('#tx').textContent = '❌ ' + friendlyError(error);
  }
}

async function claimVoucher(nonce) {
  const addr = getAddress();
  const signer = getSigner();
  if (!addr || !signer) { alert('지갑 연결이 필요합니다.'); return; }

  try {
    showOverlay('바우처 조회 중…');
    const vouchersResponse = await fetch(`${API}/vouchers/${addr}`).then(r => r.json());
    if (vouchersResponse.error) throw new Error(vouchersResponse.error);

    const voucher = vouchersResponse.vouchers.find(v => String(v.nonce) === String(nonce));
    if (!voucher) throw new Error('바우처를 찾을 수 없습니다');

    const now = Math.floor(Date.now() / 1000);
    if (Number(voucher.deadline) < now) throw new Error('바우처가 만료되었습니다');

    const contract = new ethers.Contract(getTokenAddress(), getTokenAbi(), signer);
    const voucherStruct = {
      user: voucher.user_address,
      pointsDeducted: voucher.points_deducted,
      tokenAmount: voucher.token_amount,
      nonce: voucher.nonce,
      deadline: voucher.deadline
    };

    showOverlay('토큰 민팅 트랜잭션 전송 중…');
    const tx = await contract.mintWithVoucher(voucherStruct, voucher.signature);

    showOverlay('트랜잭션 확인 중…');
    await tx.wait();

    $('#tx').className = 'status ok';
    $('#tx').textContent = `✅ 토큰 받기 완료! TX: ${tx.hash.slice(0, 10)}...`;

    await Promise.allSettled([refreshGovernanceInfo(), refreshVouchers()]);
    hideOverlay('토큰 받기 완료');
    setTimeout(checkWalletConnection, 2000);
  } catch (error) {
    hideOverlay();
    alert(friendlyError(error));
  }
}

// 만료된 바우처 환급
async function refundExpiredVoucher(nonce) {
  const addr = getAddress();
  if (!addr) { alert('지갑 연결이 필요합니다.'); return; }

  try {
    showOverlay('만료 바우처 확인 및 환급 중…');
    const r = await fetch(`${API}/vouchers/refund-expired`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr, nonce })
    }).then(r => r.json());
    if (r.error) throw new Error(r.error);

    $('#tx').className = 'status ok';
    $('#tx').textContent = `✅ 만료 바우처 환급 완료! 적립 포인트: ${r.refunded}`;

    await Promise.allSettled([refreshPoints(), refreshVouchers()]);
    hideOverlay('환급 완료');
  } catch (error) {
    hideOverlay();
    alert(friendlyError(error));
  }
}

function getVoucherActions(voucher) {
  const now = Math.floor(Date.now() / 1000);

  // 이미 종료된 상태면 버튼 없음
  if (['used', 'redeposited', 'expired_refunded'].includes(voucher.status)) {
    return '<span class="disabled-text">사용 불가</span>';
  }

  // 만료된 경우: 만료 포인트 환급 버튼
  if (Number(voucher.deadline) < now || voucher.status === 'expired') {
    return `<button class="btn ghost btn-refund" data-nonce="${voucher.nonce}" type="button">만료 포인트 받기</button>`;
  }

  // 그 외(pending & 미만료): 두 가지 액션 제공
  return `
    <button class="btn primary btn-claim" data-nonce="${voucher.nonce}" type="button">웹3 토큰 받기</button>
    <button class="btn ghost btn-redeposit" data-nonce="${voucher.nonce}" type="button">포인트 재적립</button>
  `;
}

// 만료 전 바우처 재적립
async function redepositVoucher(nonce) {
  const addr = getAddress();
  if (!addr) { alert('지갑 연결이 필요합니다.'); return; }

  try {
    showOverlay('바우처 재적립 처리 중…');

    const r = await fetch(`${API}/vouchers/redeposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr, nonce })
    }).then(r => r.json());

    if (r.error) throw new Error(r.error);

    $('#tx').className = 'status ok';
    $('#tx').textContent = `✅ 재적립 완료! 복원 포인트: ${r.restored}`;

    await Promise.allSettled([refreshPoints(), refreshVouchers()]);
    hideOverlay('재적립 완료');
  } catch (error) {
    hideOverlay();
    alert(friendlyError(error));
  }
}

// 이벤트 핸들러
function initVouchersEventHandlers() {
  $('#createVoucher').onclick = async (e) => {
    e.preventDefault();
    const pts = Number($('#pointsToSpend').value || '0');
    if (!Number.isFinite(pts) || pts <= 0 || !Number.isInteger(pts)) {
      alert('유효한 포인트(정수)를 입력해주세요.');
      return;
    }
    await createVoucher(pts);
  };

  $('#refreshVouchers').onclick = async (e) => {
    e.preventDefault();
    if (!getAddress()) { alert('지갑 연결이 필요합니다.'); return; }
    try {
      showOverlay('바우처 목록 새로고침 중…');
      await refreshVouchers();
      hideOverlay();
    } catch (error) {
      hideOverlay();
      alert(friendlyError(error));
    }
  };
}
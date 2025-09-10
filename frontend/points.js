// frontend/points.js - 포인트 관리
async function refreshPoints() {
  const addr = getAddress();
  if (!addr) return;

  try {
    const r = await fetch(`${API}/points/${addr}`).then(r => r.json());
    if (r && typeof r.points !== 'undefined') {
      $('#points').textContent = r.points;
    }
  } catch (error) {
    console.warn('Failed to refresh points:', error);
  }
}

async function earnPoints() {
  const addr = getAddress();
  if (!addr) {
    alert('지갑 연결이 필요합니다.');
    return;
  }

  try {
    showOverlay('포인트 적립 중…');

    const r = await fetch(`${API}/points/earn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr })
    }).then(r => r.json());

    if (r.error) throw new Error(r.error);

    $('#points').textContent = r.points;
    hideOverlay('적립 완료');

    // 적립 후 연결 상태 재확인
    setTimeout(checkWalletConnection, 1000);

  } catch (error) {
    hideOverlay();
    alert(friendlyError(error));
  }
}

// ===== 이벤트 핸들러 =====
function initPointsEventHandlers() {
  $('#refreshPoints').onclick = async (e) => {
    e.preventDefault();

    if (!getAddress()) {
      alert('지갑 연결이 필요합니다.');
      return;
    }

    try {
      showOverlay('포인트 불러오는 중…');
      await refreshPoints();
      hideOverlay();
    } catch (error) {
      hideOverlay();
      alert(friendlyError(error));
    }
  };

  $('#earn50').onclick = async (e) => {
    e.preventDefault();
    await earnPoints();
  };
}
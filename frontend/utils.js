// frontend/utils.js - 유틸리티 함수들
const $ = (sel) => document.querySelector(sel);

// ===== 에러 처리 =====
function friendlyError(e) {
  try {
    if (e && (e.code === 4001 || e.code === 'ACTION_REJECTED' || (e.message || '').toLowerCase().includes('user rejected')))
      return '트랜잭션을 취소하였습니다.';
    const msg = (e?.data?.message) || (e?.error?.message) || e?.reason || e?.message || String(e);
    if (/insufficient funds/i.test(msg)) return '지갑 잔액이 부족합니다. 소량의 ETH가 필요합니다.';
    if (/invalid address/i.test(msg)) return '잘못된 주소 형식입니다.';
    if (/network|chain|unsupported/i.test(msg)) return '네트워크 오류입니다. Sepolia에 연결해주세요.';
    if (/execution reverted/i.test(msg)) {
      const m = msg.match(/reverted with reason string ['"]([^'"]+)['"]/i);
      return '컨트랙트 실행이 거부되었습니다' + (m ? `: ${m[1]}` : '');
    }
    return '오류: ' + msg;
  } catch { return '알 수 없는 오류가 발생했습니다.' }
}

// ===== UI 오버레이 =====
function showOverlay(msg) {
  const o = $('#overlay'); const m = $('#overlayMsg');
  if (o) { o.classList.remove('hidden'); if (m) m.textContent = msg || '처리 중…'; }
}

function hideOverlay(msg) {
  const o = $('#overlay'); const m = $('#overlayMsg');
  if (o) { if (m && msg) m.textContent = msg; setTimeout(() => o.classList.add('hidden'), 600); }
}

// ===== 포맷팅 함수들 =====
function formatTokenAmount(wei) {
  return Number(ethers.formatUnits(wei, 18)).toFixed(2);
}

function formatTimeLeft(deadline) {
  const now = Math.floor(Date.now() / 1000);
  const left = Number(deadline) - now;
  if (left <= 0) return '만료됨';
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  return `${hours}시간 ${minutes}분 남음`;
}
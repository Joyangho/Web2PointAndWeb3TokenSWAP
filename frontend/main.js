// frontend/main.js - 메인 초기화 및 통합
// 안전한 데이터 새로고침
async function safeRefreshAll() {
  const addr = getAddress();
  if (!addr || !getTokenAddress() || !getTokenAbi()) return;

  try {
    await Promise.allSettled([
      refreshPoints(),
      refreshGovernanceInfo(),
      refreshVouchers(),
      updateTokenInfo()
    ]);
  } catch (error) {
    console.warn('Refresh failed:', error);
  }
}

// ===== 지갑 연결 버튼 이벤트 =====
function initWalletConnectHandler() {
  $('#connect').onclick = async (e) => {
    e.preventDefault();
    await connectWallet();
  };
}

// ===== 모든 이벤트 핸들러 초기화 =====
function initAllEventHandlers() {
  initWalletConnectHandler();
  initPointsEventHandlers();
  initVouchersEventHandlers();
  initExchangeEventHandlers();
  initGovernanceEventHandlers();
}

// ===== 페이지 로드 시 초기화 =====
window.addEventListener('load', async () => {
  console.log('Initializing blockchain application...');

  // 이벤트 핸들러 초기화
  initAllEventHandlers();

  // MetaMask 이벤트 바인딩
  bindProviderEvents();

  // 설정 로드
  try {
    await loadConfig();
    console.log('Config loaded successfully');
  } catch (error) {
    console.warn('Config load failed:', error);
  }

  // 이미 연결된 상태인지 확인
  checkWalletConnection().then(connected => {
    if (connected) {
      console.log('Already connected on page load');
      startConnectionMonitoring();
      safeRefreshAll();
    }
  });
});

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  stopConnectionMonitoring();
});
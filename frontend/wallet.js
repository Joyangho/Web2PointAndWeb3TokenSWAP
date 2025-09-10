// frontend/wallet.js - 지갑 연결 및 관리
let connectionCheckInterval;
let isConnecting = false;

// ===== 지갑 연결 상태 관리 =====
async function checkWalletConnection() {
  if (!window.ethereum) return false;

  try {
    const accounts = await window.ethereum.request({
      method: 'eth_accounts'
    });

    if (accounts && accounts.length > 0) {
      const currentAddr = accounts[0];

      // 주소가 변경되었거나 provider가 없는 경우에만 재초기화
      if (!getAddress() || !getProvider() || getAddress().toLowerCase() !== currentAddr.toLowerCase()) {
        setProvider(new ethers.BrowserProvider(window.ethereum));
        setSigner(await getProvider().getSigner());
        setAddress(await getSigner().getAddress());

        // UI 업데이트
        updateWalletUI();
      }
      return true;
    }
  } catch (error) {
    console.warn('Connection check failed:', error);
  }

  // 연결이 끊어진 경우
  setAddress(null);
  setProvider(null);
  setSigner(null);
  updateWalletUI();
  return false;
}

// 지갑 UI 업데이트
function updateWalletUI() {
  const addr = getAddress();
  const provider = getProvider();

  if (addr) {
    $('#addr').textContent = addr.slice(0, 6) + '…' + addr.slice(-4);

    // ETH 잔액 업데이트 (에러 발생해도 계속 진행)
    if (provider) {
      provider.getBalance(addr)
        .then(bal => {
          $('#ethBal').textContent = `${Number(ethers.formatEther(bal)).toFixed(4)} ETH`;
        })
        .catch(err => {
          console.warn('Failed to get balance:', err);
          $('#ethBal').textContent = '– ETH';
        });
    }
  } else {
    $('#addr').textContent = '연결되지 않음';
    $('#ethBal').textContent = '– ETH';
  }
}

// 주기적 연결 상태 확인 시작
function startConnectionMonitoring() {
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
  }

  // 5초마다 연결 상태 확인
  connectionCheckInterval = setInterval(async () => {
    if (!isConnecting) {
      await checkWalletConnection();
    }
  }, 5000);
}

// 연결 상태 확인 중지
function stopConnectionMonitoring() {
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
    connectionCheckInterval = null;
  }
}

// ===== 메타마스크 이벤트 핸들링 =====
let _eventsBound = false;

async function bindProviderEvents() {
  if (_eventsBound || !window.ethereum) return;
  _eventsBound = true;

  window.ethereum.on('accountsChanged', async (accounts) => {
    console.log('Accounts changed:', accounts);

    try {
      if (!accounts || accounts.length === 0) {
        // 실제 연결 해제
        setAddress(null);
        setProvider(null);
        setSigner(null);
        updateWalletUI();
        stopConnectionMonitoring();
        return;
      }

      const newAddr = accounts[0];

      // 동일한 주소면 UI만 새로고침
      if (getAddress() && getAddress().toLowerCase() === newAddr.toLowerCase()) {
        await safeRefreshAll();
        return;
      }

      // 다른 주소로 변경된 경우
      isConnecting = true;

      setProvider(new ethers.BrowserProvider(window.ethereum));
      setSigner(await getProvider().getSigner());
      setAddress(await getSigner().getAddress());

      updateWalletUI();
      await safeRefreshAll();

      isConnecting = false;

    } catch (error) {
      console.error('Account change handling failed:', error);
      isConnecting = false;
    }
  });

  window.ethereum.on('chainChanged', async (chainId) => {
    console.log('Chain changed:', chainId);

    try {
      if (getAddress() && getProvider()) {
        setProvider(new ethers.BrowserProvider(window.ethereum));
        setSigner(await getProvider().getSigner());
        updateWalletUI();
        await safeRefreshAll();
      }
    } catch (error) {
      console.error('Chain change handling failed:', error);
    }
  });

  window.ethereum.on('disconnect', async (error) => {
    console.log('MetaMask disconnect event:', error);

    // disconnect 이벤트 발생 시 실제 연결 상태 재확인
    setTimeout(async () => {
      const stillConnected = await checkWalletConnection();
      if (!stillConnected) {
        console.log('Actually disconnected');
        stopConnectionMonitoring();
      } else {
        console.log('False disconnect event - still connected');
      }
    }, 1000);
  });

  console.log('Provider events bound');
}

// ===== 지갑 연결 함수 =====
async function connectWallet() {
  if (!window.ethereum) {
    alert('MetaMask가 필요합니다. MetaMask를 설치해주세요.');
    return false;
  }

  try {
    isConnecting = true;
    showOverlay('지갑 연결 중…');

    await loadConfig();

    // 세폴리아 강제 전환/추가
    const target = { chainId: '0xaa36a7' };
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [target]
      });
    } catch (err) {
      if (err && err.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0xaa36a7',
            chainName: 'Sepolia',
            nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://rpc.sepolia.org'],
            blockExplorerUrls: ['https://sepolia.etherscan.io']
          }]
        });
      }
    }

    // 계정 연결 요청
    await window.ethereum.request({ method: 'eth_requestAccounts' });

    // Provider 초기화
    setProvider(new ethers.BrowserProvider(window.ethereum));
    setSigner(await getProvider().getSigner());
    setAddress(await getSigner().getAddress());

    updateWalletUI();
    await safeRefreshAll();

    // 연결 모니터링 시작
    startConnectionMonitoring();

    hideOverlay('연결 완료');
    isConnecting = false;
    return true;

  } catch (error) {
    console.error('Connection failed:', error);
    hideOverlay();
    alert(friendlyError(error));
    isConnecting = false;
    return false;
  }
}
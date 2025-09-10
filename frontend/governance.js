// frontend/governance.js - 거버넌스 기능
let govCache = { timestamp: 0 };

async function refreshGovernanceInfo() {
  const addr = getAddress();
  const provider = getProvider();

  if (!addr || !provider || !getTokenAddress() || !getTokenAbi()) return;

  try {
    const contract = new ethers.Contract(getTokenAddress(), getTokenAbi(), provider);

    const [balance, votes, delegatee] = await Promise.all([
      contract.balanceOf(addr),
      contract.getVotes(addr),
      contract.delegates(addr)
    ]);

    const balanceFormatted = Number(ethers.formatUnits(balance, 18)).toFixed(2);
    const votesFormatted = Number(ethers.formatUnits(votes, 18)).toFixed(2);

    // UI 업데이트
    $('#gov').textContent = balanceFormatted;
    $('#votingPower').textContent = votesFormatted;

    // 위임 대상 표시
    if (delegatee === '0x0000000000000000000000000000000000000000') {
      $('#delegatedTo').textContent = '위임 안함';
      $('#delegatedTo').className = 'delegate-status none';
    } else if (delegatee.toLowerCase() === addr.toLowerCase()) {
      $('#delegatedTo').textContent = '나에게 위임';
      $('#delegatedTo').className = 'delegate-status self';
    } else {
      $('#delegatedTo').textContent = `${delegatee.slice(0, 6)}...${delegatee.slice(-4)}`;
      $('#delegatedTo').className = 'delegate-status other';
    }

    // 위임 필요 알림
    const balanceNum = Number(balanceFormatted);
    const votesNum = Number(votesFormatted);
    const undelegated = balanceNum - votesNum;

    const alertEl = $('#delegationAlert');
    const undelegatedEl = $('#undelegatedAmount');

    if (balanceNum > 0 && undelegated > 0.01) {
      if (alertEl) alertEl.style.display = 'block';
      if (undelegatedEl) undelegatedEl.textContent = undelegated.toFixed(2);
    } else {
      if (alertEl) alertEl.style.display = 'none';
    }

  } catch (error) {
    console.warn('Failed to refresh governance info:', error);
    $('#gov').textContent = '-';
    const votingPowerEl = $('#votingPower');
    const delegatedToEl = $('#delegatedTo');
    if (votingPowerEl) votingPowerEl.textContent = '-';
    if (delegatedToEl) delegatedToEl.textContent = '오류';
  }
}

async function delegateToSelf() {
  const addr = getAddress();
  const signer = getSigner();

  if (!addr || !signer) {
    alert('지갑 연결이 필요합니다.');
    return;
  }

  try {
    showOverlay('나에게 위임 중…');

    const contract = new ethers.Contract(getTokenAddress(), getTokenAbi(), signer);
    const tx = await contract.selfDelegate();
    await tx.wait();

    $('#txDeleg').className = 'status ok';
    $('#txDeleg').textContent = `✅ 자기 위임 완료! TX: ${tx.hash.slice(0, 10)}...`;

    // 위임 후 거버넌스 정보 새로고침
    await refreshGovernanceInfo();

    hideOverlay('위임 완료');

    // 위임 후 연결 상태 재확인
    setTimeout(checkWalletConnection, 1000);

  } catch (error) {
    hideOverlay();
    $('#txDeleg').className = 'status error';
    $('#txDeleg').textContent = '❌ ' + friendlyError(error);
  }
}

async function delegateToOther(delegateAddr) {
  const addr = getAddress();
  const signer = getSigner();

  if (!addr || !signer) {
    alert('지갑 연결이 필요합니다.');
    return;
  }

  try {
    showOverlay('위임 중…');

    const contract = new ethers.Contract(getTokenAddress(), getTokenAbi(), signer);
    const tx = await contract.delegate(delegateAddr);
    await tx.wait();

    $('#txDeleg').className = 'status ok';
    $('#txDeleg').textContent = `✅ ${delegateAddr.slice(0, 6)}...에게 위임 완료! TX: ${tx.hash.slice(0, 10)}...`;

    // 위임 후 거버넌스 정보 새로고침
    await refreshGovernanceInfo();

    hideOverlay('위임 완료');

    // 위임 후 연결 상태 재확인
    setTimeout(checkWalletConnection, 1000);

  } catch (error) {
    hideOverlay();
    $('#txDeleg').className = 'status error';
    $('#txDeleg').textContent = '❌ ' + friendlyError(error);
  }
}

// ===== 이벤트 핸들러 =====
function initGovernanceEventHandlers() {
  $('#refreshGov').onclick = async (e) => {
    e.preventDefault();

    if (!getAddress()) {
      alert('지갑 연결이 필요합니다.');
      return;
    }

    try {
      showOverlay('거버넌스 정보 새로고침 중…');
      await refreshGovernanceInfo();
      hideOverlay();
    } catch (error) {
      hideOverlay();
      alert(friendlyError(error));
    }
  };

  $('#delegateSelf').onclick = async (e) => {
    e.preventDefault();
    await delegateToSelf();
  };

  $('#delegateOther').onclick = async (e) => {
    e.preventDefault();

    const delegateAddr = ($('#delegateAddr').value || '').trim();
    if (!delegateAddr) {
      alert('위임 대상 주소를 입력해주세요.');
      return;
    }

    await delegateToOther(delegateAddr);
  };
}
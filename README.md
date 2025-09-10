# 블록체인 과제시험: 재화 교환 서비스

## 목표

- Web2 기반의 포인트 재화를 개발합니다.
- 블록체인 기반의 토큰을 개발합니다. 이 토큰은 거버넌스 토큰이며 투표 기능을 제공해야합니다.
- 포인트는 고정 비율로 토큰과 교환할 수 있습니다.
- 모든 기능을 테스트할 수 있는 웹 어플리케이션을 개발합니다.

## 메인넷

- Ethereum

## 참고사항

- 사용한 언어, 프레임워크, 코딩스타일, 개발환경을 사용한 이유를 명시해 주시면 좋습니다.
- 테스트 케이스를 작성해 주시면 좋습니다.
- 작성한 코드는 과제시험을 위해 실행 가능해야 합니다.
- 과제는 Pull Request를 통해 제출하면 됩니다.
- 과제 평가는 프론트엔드 또는 백엔드 중 한 분야와 블록체인 분야에서 진행됩니다. 희망하는 평가 분야를 선택하여 알려주시기 바랍니다.

---------------------------------------------------------------------------------------------------------------------------------------------

## 패키지 설치
- npm init -y
- npm install express cors dotenv ethers better-sqlite3
- node backend/server.js

# 블록체인 과제시험: 재화 교환 서비스

## 목표 달성 확인

✅ Web2 포인트 시스템 (SQLite 기반)  
✅ Web3 거버넌스 토큰 (ERC20Votes)  
✅ 고정 비율 교환 (1:1, 환경변수 조정 가능)  
✅ 웹 애플리케이션 (모든 기능 테스트 가능)

## 기술 스택 및 선택 이유

**백엔드: Node.js + Express + SQLite**
- JavaScript 풀스택으로 일관성 유지
- ethers.js와 완벽 호환
- SQLite로 설치 없이 즉시 실행 가능

**프론트엔드: Vanilla JavaScript**
- 번들링 없이 CDN으로 빠른 로딩
- 의존성 최소화로 안정성 확보
- 브라우저 네이티브 API 활용

**블록체인: Solidity + OpenZeppelin**
- 검증된 보안 라이브러리 활용
- ERC20Votes로 거버넌스 기능
- 바우처 시스템으로 보안성 강화

## 핵심: 바우처 시스템

서버가 직접 민팅하는 대신 EIP-712 서명 바우처를 발급하여:
- 서버 키 유출 시 피해를 포인트 한도로 제한
- 사용자가 직접 트랜잭션 제어
- 가스비 폭탄 위험 제거

## 실행 방법

```bash
# 1. 패키지 설치
npm install express cors dotenv ethers better-sqlite3

# 2. 환경변수 설정 (.env)
RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
SERVER_PRIVATE_KEY=0x테스트용개인키
RATE_POINTS_PER_TOKEN=1
DATABASE_URL=./points.db

# 3. 백엔드 실행
node backend/server.js

# 4. 프론트엔드 실행 (별도 터미널)
npx http-server frontend -p 8080
```

## 테스트 절차

### 1. 기본 환경 확인
- MetaMask 설치 및 Sepolia 테스트넷 설정
- Sepolia ETH 확보 (faucet 사용)
- 백엔드 서버 실행 확인 (localhost:3001)

### 2. 포인트 → 토큰 교환 테스트
1. 웹앱에서 지갑 연결
2. "포인트 받기 +50" 여러 번 클릭하여 포인트 적립
3. 포인트 수량 입력 후 "바우처 생성"
4. 생성된 바우처에서 "토큰 받기" 클릭
5. MetaMask에서 트랜잭션 승인
6. 토큰 민팅 완료 확인

### 3. 거버넌스 테스트
1. "나에게 위임" 버튼으로 투표권 활성화
2. 토큰 잔액과 투표력 일치 확인
3. 위임 상태 표시 확인

### 4. 토큰 → 포인트 교환 테스트
1. 소각할 토큰 수량 입력
2. "소각 + 포인트 받기" 클릭
3. 소각 트랜잭션 승인
4. 자동으로 포인트 적립 확인

### 5. 예외 상황 테스트
- 바우처 만료 후 "만료 포인트 받기" 기능
- 만료 전 "포인트 재적립" 기능
- 가스비 부족 시 에러 처리
- 캐시 에러시 Ctrl+Shift+R

## 테스트 케이스 (권장 구현)

```javascript
// 포인트 시스템
test('포인트 적립 정상 동작', () => {
  const result = addPoints('0x123...', 100);
  expect(result).toBe(100);
});

// 바우처 서명 검증
test('EIP-712 서명 검증', async () => {
  const voucher = createTestVoucher();
  const signature = await signVoucher(voucher);
  const isValid = verifySignature(voucher, signature);
  expect(isValid).toBe(true);
});

// 소각 이벤트 파싱
test('소각 이벤트 검증', async () => {
  const events = parseBurnEvents(txHash);
  expect(events[0].amount).toBe(burnAmount);
});
```

## 파일 구조

```
webapp/
├── backend/                    # 백엔드 서버
│   ├── .env                   # 환경 변수 설정 파일
│   ├── db.js                  # 포인트 DB 연동 모듈
│   ├── exchange.js            # 포인트 ↔ 토큰 교환 로직
│   ├── server.js              # Express 서버 실행 파일
│   └── smartcontracts.js      # 스마트컨트랙트 ABI 및 주소 관리
│
├── frontend/                   # 프론트엔드 웹앱
│   ├── utils.js               # 유틸리티 함수들
│   ├── config.js              # 설정 및 전역 변수 관리
│   ├── wallet.js              # 지갑 연결 및 MetaMask 이벤트
│   ├── points.js              # 포인트 시스템
│   ├── vouchers.js            # 바우처 시스템
│   ├── tokenExchange.js       # 토큰 교환 기능
│   ├── governance.js          # 거버넌스 기능
│   ├── main.js                # 메인 초기화 및 통합
│   ├── index.html             # 메인 페이지
│   ├── guide.html             # 설명 페이지
│   └── styles.css             # 스타일시트
│
└── contracts/                  # 스마트 컨트랙트
    └── BloomingGov.sol        # ERC20 토큰 컨트랙트
```

## 평가 분야

**희망 평가 분야: 백엔드 + 블록체인**

백엔드 API 설계와 스마트컨트랙트 통합, 특히 바우처 시스템을 통한 Web2-Web3 브리지 구현에 집중했습니다.


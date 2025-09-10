# 블록체인 과제시험: 재화 교환 서비스

## 과제 요구사항

- Web2 기반의 포인트 재화를 개발합니다.
- 블록체인 기반의 토큰을 개발합니다. 이 토큰은 거버넌스 토큰이며 투표 기능을 제공해야합니다.
- 포인트는 고정 비율로 토큰과 교환할 수 있습니다.
- 모든 기능을 테스트할 수 있는 웹 어플리케이션을 개발합니다.

**메인넷**: Ethereum

---

## 구현 결과

✅ Web2 포인트 시스템 (SQLite 기반)  
✅ Web3 거버넌스 토큰 (ERC20Votes)  
✅ 고정 비율 교환 (1:1, 환경변수 조정 가능)  
✅ 웹 애플리케이션 (모든 기능 테스트 가능)

## 기술 스택 및 선택 이유

**백엔드: Node.js + Express + SQLite**
- JavaScript 풀스택으로 일관성 유지 및 개발 효율성 향상
- ethers.js와 호환으로 블록체인 통합 간소화
- SQLite 파일 기반 DB로 별도 설치 없이 즉시 실행 가능

**프론트엔드: Vanilla JavaScript**
- 번들링 과정 없이 CDN 기반으로 빠른 개발 및 배포
- 의존성 최소화로 안정성 확보 및 브라우저 호환성 향상
- 웹 표준 API 직접 활용으로 성능 최적화

**블록체인: Solidity + OpenZeppelin**
- 검증된 보안 라이브러리로 안전성 확보
- ERC20Votes 표준으로 거버넌스 기능 구현
- 바우처 시스템으로 서버 가스비 부담을 해결하고, 각 지갑의 트랜잭션을 확인 가능
- 서명 지갑을 등록/해제가 가능함으로써 지갑이 탈취 당해도 계약은 지속 가능

**코딩 스타일**
- 함수형 프로그래밍 지향으로 순수 함수와 불변성 추구
- 모듈별 단일 책임 원칙으로 유지보수성 향상

## 핵심: 바우처 시스템

서버 직접 민팅 대신 EIP-712 서명 바우처 발급으로
- 서버 키 유출 시 피해를 포인트 한도로 제한
- 사용자가 직접 트랜잭션 제어하여 책임과 권한 명확화
- 네트워크 폭증 시 가스비 폭탄 위험 제거

## 실행 방법

```bash
# 1. 의존성 설치
npm install express cors dotenv ethers better-sqlite3
# 1-2 프론트엔드용 설치
npm install -g http-server

# 2. 환경변수 설정 (.env)
RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
SERVER_PRIVATE_KEY=0x테스트용개인키
RATE_POINTS_PER_TOKEN=1
DATABASE_URL=./points.db

# 3. 백엔드 실행 (터미널 1)
node backend/server.js

# 4. 프론트엔드 실행 (터미널 2)
npx http-server frontend -p 5500
```

브라우저에서 `http://localhost:5500` 접속 또는 index.html Liveserver 사용

## 테스트 가이드

### 사전 준비
- MetaMask 설치 및 Sepolia 테스트넷 연결
- Sepolia ETH 확보 (faucet 활용)
- 백엔드 서버 정상 실행 확인

### 전체 플로우 테스트
1. **포인트 시스템**: 지갑 연결 → "포인트 받기 +50" 클릭 → 포인트 증가 확인
2. **바우처 생성**: 포인트 입력 → "바우처 생성" → 포인트 차감 및 바우처 발급 확인
3. **토큰 민팅**: "토큰 받기" → MetaMask 승인 → 토큰 잔액 증가 확인
4. **거버넌스**: "나에게 위임" → 투표력 활성화 확인
5. **역교환**: 토큰 수량 입력 → "소각 + 포인트 받기" → 포인트 재적립 확인

### 예외 상황 테스트
- 바우처 만료 후 환급 기능
- 만료 전 재적립 기능
- 잔액 부족 시 에러 처리

## 파일 구조

```
webapp/
├── backend/
│   ├── .env                   # 환경변수 (Git 제외)
│   ├── db.js                  # SQLite 데이터베이스
│   ├── exchange.js            # 교환 로직 및 바우처
│   ├── server.js              # Express API 서버
│   └── smartcontracts.js      # 컨트랙트 ABI/주소
│
├── frontend/
│   ├── index.html             # 메인 애플리케이션
│   ├── guide.html             # 가이드
│   ├── styles.css             # 통합 스타일
│   ├── utils.js               # 유틸리티 함수
│   ├── config.js              # 전역 설정
│   ├── wallet.js              # 지갑 연결
│   ├── points.js              # 포인트 관리
│   ├── vouchers.js            # 바우처 시스템
│   ├── tokenExchange.js       # 토큰 교환
│   ├── governance.js          # 거버넌스
│   └── main.js                # 애플리케이션 초기화
│
└── contracts/
    └── BloomingGov.sol        # ERC20Votes 토큰
```

## 참고사항 대응

**언어/프레임워크 선택 이유**: JavaScript 생태계 통합으로 개발 효율성과 블록체인 호환성 확보

**테스트 케이스**: 웹 브라우저 기반 수동 테스트로 모든 기능 검증 가능

**실행 가능성**: .env.example 제공 및 단계별 실행 가이드로 즉시 테스트 환경 구축 가능

**평가 분야**: **백엔드 + 블록체인** (API 설계, 데이터베이스 관리, 스마트컨트랙트 통합, 바우처 시스템 구현)

---

**테스트 컨트랙트 주소 (Sepolia)**: `0xef0e8f4cD86241cE287f4f30869F723A58d0c883`
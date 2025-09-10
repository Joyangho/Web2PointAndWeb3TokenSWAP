// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * BloomingGov (BGOV) - Voucher System
 * - ERC20Votes: 온체인 거버넌스 투표권(위임/체크포인트)
 * - ERC20Permit: EIP-2612 서명 승인(permit)
 * - ERC20Burnable: 사용자 소각 지원
 * - Voucher System: 서버 서명 기반 바우처 민팅
 * - ReentrancyGuard: 교환 경로 재진입 보호
 *
 * 핵심 변경사항:
 * - MINTER_ROLE 제거 → 서버 서명 검증으로 변경
 * - mint() 함수 제거 → mintWithVoucher() 함수로 대체
 * - 바우처 기반 일회성 민팅 시스템
 */

import "@openzeppelin/contracts@5.0.2/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts@5.0.2/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts@5.0.2/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts@5.0.2/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts@5.0.2/access/Ownable.sol";
import "@openzeppelin/contracts@5.0.2/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts@5.0.2/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts@5.0.2/utils/Nonces.sol";

/// @title BloomingGov (BGOV) - Voucher System
/// @notice 바우처 기반 포인트↔토큰 교환, 거버넌스 투표를 지원하는 ERC20 토큰
contract BloomingGov is
    ERC20,
    ERC20Burnable,
    ERC20Permit,
    ERC20Votes,
    Ownable,
    ReentrancyGuard
{
    using ECDSA for bytes32;

    // -----------------------------
    // EIP-712 Domain
    // -----------------------------

    bytes32 private immutable DOMAIN_SEPARATOR;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    // -----------------------------
    // Voucher Structure
    // -----------------------------

    struct ExchangeVoucher {
        address user;           // 바우처 사용자
        uint256 pointsDeducted; // 차감된 포인트
        uint256 tokenAmount;    // 받을 토큰 수량 (18 decimals)
        uint256 nonce;          // 바우처 고유 번호
        uint256 deadline;       // 만료 시간
    }

    bytes32 private constant VOUCHER_TYPEHASH = keccak256(
        "ExchangeVoucher(address user,uint256 pointsDeducted,uint256 tokenAmount,uint256 nonce,uint256 deadline)"
    );

    // -----------------------------
    // State Variables
    // -----------------------------

    address public serverSigner;
    mapping(uint256 => bool) public usedNonces;
    uint256 public minUnit = 1e18;

    // -----------------------------
    // Custom Errors
    // -----------------------------

    error ZeroAddress();
    error ZeroAmount();
    error AmountBelowMin(uint256 minUnit);
    error NotMultipleOfUnit(uint256 minUnit);
    error InvalidMinUnit(uint256 minUnit);
    error VoucherExpired(uint256 deadline);
    error VoucherAlreadyUsed(uint256 nonce);
    error InvalidVoucherSignature();
    error NotVoucherOwner();

    // -----------------------------
    // Events
    // -----------------------------

    event VoucherRedeemed(
        address indexed user,
        uint256 indexed nonce,
        uint256 pointsDeducted,
        uint256 tokenAmount,
        uint256 deadline
    );

    event Burned(address indexed caller, address indexed from, uint256 amount);
    event PermitUsed(address indexed owner, address indexed spender, uint256 value, uint256 deadline);
    event ServerSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event MinUnitUpdated(uint256 oldMinUnit, uint256 newMinUnit);

    // -----------------------------
    // Constructor
    // -----------------------------

    constructor(address _serverSigner)
        ERC20("BloomingGov", "BGOV")
        ERC20Permit("BloomingGov")
        Ownable(msg.sender)
    {
        if (_serverSigner == address(0)) revert ZeroAddress();
        serverSigner = _serverSigner;
        
        // EIP-712 도메인 구분자 초기화
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("BloomingGov")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    // -----------------------------
    // Admin Functions
    // -----------------------------

    function setServerSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        
        address oldSigner = serverSigner;
        serverSigner = newSigner;
        
        emit ServerSignerUpdated(oldSigner, newSigner);
    }

    function setMinUnit(uint256 newMinUnit) external onlyOwner {
        if (newMinUnit < 1e18) revert InvalidMinUnit(newMinUnit);
        if (newMinUnit % 1e18 != 0) revert InvalidMinUnit(newMinUnit);

        uint256 old = minUnit;
        minUnit = newMinUnit;

        emit MinUnitUpdated(old, newMinUnit);
    }

    // -----------------------------
    // Core Function: Voucher Minting
    // -----------------------------

    function mintWithVoucher(
        ExchangeVoucher calldata voucher,
        bytes calldata signature
    ) external nonReentrant {
        // 기본 검증
        if (voucher.user != msg.sender) revert NotVoucherOwner();
        if (voucher.tokenAmount == 0) revert ZeroAmount();
        if (block.timestamp > voucher.deadline) revert VoucherExpired(voucher.deadline);
        if (usedNonces[voucher.nonce]) revert VoucherAlreadyUsed(voucher.nonce);

        // 최소 단위 검증
        if (voucher.tokenAmount < minUnit) revert AmountBelowMin(minUnit);
        if (voucher.tokenAmount % minUnit != 0) revert NotMultipleOfUnit(minUnit);

        // 서명 검증
        if (!_verifyVoucherSignature(voucher, signature)) {
            revert InvalidVoucherSignature();
        }

        // 바우처 사용 처리
        usedNonces[voucher.nonce] = true;

        // 토큰 민팅
        _mint(voucher.user, voucher.tokenAmount);

        emit VoucherRedeemed(
            voucher.user,
            voucher.nonce,
            voucher.pointsDeducted,
            voucher.tokenAmount,
            voucher.deadline
        );
    }

    function _verifyVoucherSignature(
        ExchangeVoucher calldata voucher,
        bytes calldata signature
    ) internal view returns (bool) {
        bytes32 structHash = keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            voucher.user,
            voucher.pointsDeducted,
            voucher.tokenAmount,
            voucher.nonce,
            voucher.deadline
        ));

        bytes32 hash = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            structHash
        ));
        
        address recoveredSigner = hash.recover(signature);
        return recoveredSigner == serverSigner;
    }

    // -----------------------------
    // Burn Functions (토큰 → 포인트)
    // -----------------------------

    function burn(uint256 value) public override nonReentrant {
        if (value == 0) revert ZeroAmount();
        if (value < minUnit) revert AmountBelowMin(minUnit);
        if (value % minUnit != 0) revert NotMultipleOfUnit(minUnit);

        super.burn(value);
        emit Burned(msg.sender, msg.sender, value);
    }

    function burnFrom(address account, uint256 value) public override nonReentrant {
        if (account == address(0)) revert ZeroAddress();
        if (value == 0) revert ZeroAmount();
        if (value < minUnit) revert AmountBelowMin(minUnit);
        if (value % minUnit != 0) revert NotMultipleOfUnit(minUnit);

        super.burnFrom(account, value);
        emit Burned(msg.sender, account, value);
    }

    // -----------------------------
    // Permit
    // -----------------------------

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
    ) public override nonReentrant {
        super.permit(owner, spender, value, deadline, v, r, s);
        emit PermitUsed(owner, spender, value, deadline);
    }

    // -----------------------------
    // View Functions
    // -----------------------------

    function isValidVoucher(
        ExchangeVoucher calldata voucher,
        bytes calldata signature
    ) external view returns (bool isSignatureValid, bool isUsable) {
        isSignatureValid = _verifyVoucherSignature(voucher, signature);
        
        isUsable = isSignatureValid && 
                   !usedNonces[voucher.nonce] && 
                   block.timestamp <= voucher.deadline &&
                   voucher.tokenAmount >= minUnit &&
                   voucher.tokenAmount % minUnit == 0;
    }

    function isNonceUsed(uint256 nonce) external view returns (bool) {
        return usedNonces[nonce];
    }

    // -----------------------------
    // ERC20Votes Integration
    // -----------------------------

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }

    // -----------------------------
    // Convenience Functions
    // -----------------------------

    function selfDelegate() external {
        _delegate(msg.sender, msg.sender);
    }
}
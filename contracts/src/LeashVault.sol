// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title LeashVault
/// @notice Holds USDC for an AI trading agent and enforces spending limits onchain.
contract LeashVault is EIP712 {
    using SafeERC20 for IERC20;

    struct Limits {
        uint256 autoApproveMax;
        uint256 perTradeCap;
        uint256 dailyBudget;
    }

    bytes32 public constant APPROVAL_TYPEHASH = keccak256(
        "Approval(string market,bool outcomeYes,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    IERC20 public immutable usdc;
    address public owner;
    address public agent;
    address public broker;
    Limits public limits;
    uint256 public positionCount;
    uint256 public approvalNonce;
    /// @dev UTC day index (block.timestamp / 1 days) that `spentToday` refers to.
    uint256 public spendDay;
    uint256 public spentToday;
    bool public paused;

    event PositionAuthorized(
        uint256 indexed positionId,
        address indexed broker,
        string market,
        bool outcomeYes,
        uint256 amount,
        bool ownerApproved
    );

    event Paused(bool isPaused);
    event LimitsUpdated(uint256 autoApproveMax, uint256 perTradeCap, uint256 dailyBudget);
    event AgentUpdated(address indexed agent);
    event BrokerUpdated(address indexed broker);
    event Withdrawn(address indexed to, uint256 amount);
    event ApprovalsRevoked(uint256 newNonce);

    error NotAgent();
    error NotOwner();
    error VaultPaused();
    error InvalidLimits();
    error ZeroAddress();
    error ZeroAmount();
    error NeedsOwnerApproval(uint256 amount, uint256 autoApproveMax);
    error InvalidOwnerSignature();
    error ApprovalExpired(uint256 deadline);
    error OverPerTradeCap(uint256 amount, uint256 perTradeCap);
    error OverDailyBudget(uint256 amount, uint256 remaining);

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        if (paused) revert VaultPaused();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address owner_,
        address agent_,
        address broker_,
        address usdc_,
        Limits memory limits_
    ) EIP712("LeashVault", "1") {
        if (
            owner_ == address(0) || agent_ == address(0) || broker_ == address(0)
                || usdc_ == address(0)
        ) revert ZeroAddress();
        owner = owner_;
        agent = agent_;
        broker = broker_;
        usdc = IERC20(usdc_);
        _setLimits(limits_);
    }

    /// @notice Agent spends on its own authority, up to `limits.autoApproveMax`.
    function spend(string calldata market, bool outcomeYes, uint256 amount)
        external
        onlyAgent
        returns (uint256 positionId)
    {
        if (amount > limits.autoApproveMax) {
            revert NeedsOwnerApproval(amount, limits.autoApproveMax);
        }
        return _authorize(market, outcomeYes, amount, false);
    }

    /// @notice Agent spends with an EIP-712 approval signed by the owner.
    function spendWithApproval(
        string calldata market,
        bool outcomeYes,
        uint256 amount,
        uint256 deadline,
        bytes calldata ownerSig
    ) external onlyAgent returns (uint256 positionId) {
        if (block.timestamp > deadline) revert ApprovalExpired(deadline);
        bytes32 structHash = keccak256(
            abi.encode(
                APPROVAL_TYPEHASH,
                keccak256(bytes(market)),
                outcomeYes,
                amount,
                approvalNonce,
                deadline
            )
        );
        if (ECDSA.recover(_hashTypedDataV4(structHash), ownerSig) != owner) {
            revert InvalidOwnerSignature();
        }
        approvalNonce++;
        return _authorize(market, outcomeYes, amount, true);
    }

    // ---------------------------------------------------------------- owner controls

    /// @notice Kill switch: blocks every agent spend until `unpause`.
    function pause() external onlyOwner {
        paused = true;
        emit Paused(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
    }

    function setLimits(Limits calldata newLimits) external onlyOwner {
        _setLimits(newLimits);
    }

    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        agent = newAgent;
        emit AgentUpdated(newAgent);
    }

    function setBroker(address newBroker) external onlyOwner {
        if (newBroker == address(0)) revert ZeroAddress();
        broker = newBroker;
        emit BrokerUpdated(newBroker);
    }

    /// @notice Owner pulls USDC out to any address. Works while paused.
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Invalidates every approval signed so far but not yet used.
    function revokeApprovals() external onlyOwner {
        approvalNonce++;
        emit ApprovalsRevoked(approvalNonce);
    }

    /// @notice USDC the agent may still spend before the next UTC midnight.
    function remainingDailyBudget() public view returns (uint256) {
        uint256 spent = (block.timestamp / 1 days == spendDay) ? spentToday : 0;
        return spent >= limits.dailyBudget ? 0 : limits.dailyBudget - spent;
    }

    function _setLimits(Limits memory newLimits) private {
        if (
            newLimits.autoApproveMax > newLimits.perTradeCap
                || newLimits.perTradeCap > newLimits.dailyBudget
        ) revert InvalidLimits();
        limits = newLimits;
        emit LimitsUpdated(newLimits.autoApproveMax, newLimits.perTradeCap, newLimits.dailyBudget);
    }

    function _authorize(string calldata market, bool outcomeYes, uint256 amount, bool ownerApproved)
        private
        returns (uint256 positionId)
    {
        if (amount == 0) revert ZeroAmount();
        if (amount > limits.perTradeCap) revert OverPerTradeCap(amount, limits.perTradeCap);
        uint256 remaining = remainingDailyBudget();
        if (amount > remaining) revert OverDailyBudget(amount, remaining);

        uint256 today = block.timestamp / 1 days;
        if (today != spendDay) {
            spendDay = today;
            spentToday = 0;
        }
        spentToday += amount;
        positionId = ++positionCount;
        usdc.safeTransfer(broker, amount);
        emit PositionAuthorized(positionId, broker, market, outcomeYes, amount, ownerApproved);
    }
}

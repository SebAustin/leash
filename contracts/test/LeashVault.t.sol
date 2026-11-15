// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {LeashVault} from "../src/LeashVault.sol";

/// @dev Stand-in for Arc's USDC ERC-20 interface (6 decimals).
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract LeashVaultTest is Test {
    uint256 internal constant USDC = 1e6;
    uint256 internal constant AUTO_APPROVE_MAX = 2 * USDC;
    uint256 internal constant PER_TRADE_CAP = 10 * USDC;
    uint256 internal constant DAILY_BUDGET = 20 * USDC;

    MockUSDC internal usdc;
    LeashVault internal vault;

    uint256 internal ownerKey = 0xA11CE;
    address internal owner;
    address internal agent = makeAddr("agent");
    address internal broker = makeAddr("broker");

    function setUp() public {
        owner = vm.addr(ownerKey);
        usdc = new MockUSDC();
        vault = new LeashVault(
            owner,
            agent,
            broker,
            address(usdc),
            LeashVault.Limits({
                autoApproveMax: AUTO_APPROVE_MAX,
                perTradeCap: PER_TRADE_CAP,
                dailyBudget: DAILY_BUDGET
            })
        );
        usdc.mint(address(vault), 100 * USDC);
    }

    // ---------------------------------------------------------------- seam 1: agent spend

    function test_agentSpendWithinAutoApproveMovesUsdcToBrokerAndEmitsPosition() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit LeashVault.PositionAuthorized(1, broker, "GEMI-BTC15M-UP", true, 2 * USDC, false);

        vm.prank(agent);
        uint256 positionId = vault.spend("GEMI-BTC15M-UP", true, 2 * USDC);

        assertEq(positionId, 1);
        assertEq(usdc.balanceOf(broker), 2 * USDC);
        assertEq(usdc.balanceOf(address(vault)), 98 * USDC);
    }

    function test_spendFromAnyoneButAgentReverts() public {
        address stranger = makeAddr("stranger");
        vm.expectRevert(LeashVault.NotAgent.selector);
        vm.prank(stranger);
        vault.spend("GEMI-BTC15M-UP", true, 1 * USDC);

        vm.expectRevert(LeashVault.NotAgent.selector);
        vm.prank(owner);
        vault.spend("GEMI-BTC15M-UP", true, 1 * USDC);
    }

    function test_unapprovedSpendAboveAutoApproveMaxReverts() public {
        uint256 amount = 2 * USDC + 1;
        vm.expectRevert(
            abi.encodeWithSelector(LeashVault.NeedsOwnerApproval.selector, amount, AUTO_APPROVE_MAX)
        );
        vm.prank(agent);
        vault.spend("GEMI-BTC15M-UP", true, amount);
    }

    // ---------------------------------------------------------------- seam 2: owner-approved spend

    bytes32 internal constant APPROVAL_TYPEHASH = keccak256(
        "Approval(string market,bool outcomeYes,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    function _signApproval(
        uint256 signerKey,
        string memory market,
        bool outcomeYes,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("LeashVault"),
                keccak256("1"),
                block.chainid,
                address(vault)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                APPROVAL_TYPEHASH, keccak256(bytes(market)), outcomeYes, amount, nonce, deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_ownerApprovedSpendAboveAutoApproveSucceeds() public {
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _signApproval(ownerKey, "GEMI-BTC15M-UP", true, 8 * USDC, 0, deadline);

        vm.expectEmit(true, false, false, true, address(vault));
        emit LeashVault.PositionAuthorized(1, broker, "GEMI-BTC15M-UP", true, 8 * USDC, true);

        vm.prank(agent);
        vault.spendWithApproval("GEMI-BTC15M-UP", true, 8 * USDC, deadline, sig);

        assertEq(usdc.balanceOf(broker), 8 * USDC);
        assertEq(vault.approvalNonce(), 1);
    }

    function test_approvalSignedByNonOwnerReverts() public {
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _signApproval(0xBEEF, "GEMI-BTC15M-UP", true, 8 * USDC, 0, deadline);

        vm.expectRevert(LeashVault.InvalidOwnerSignature.selector);
        vm.prank(agent);
        vault.spendWithApproval("GEMI-BTC15M-UP", true, 8 * USDC, deadline, sig);
    }

    function test_replayedApprovalReverts() public {
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _signApproval(ownerKey, "GEMI-BTC15M-UP", true, 5 * USDC, 0, deadline);

        vm.startPrank(agent);
        vault.spendWithApproval("GEMI-BTC15M-UP", true, 5 * USDC, deadline, sig);
        vm.expectRevert(LeashVault.InvalidOwnerSignature.selector);
        vault.spendWithApproval("GEMI-BTC15M-UP", true, 5 * USDC, deadline, sig);
        vm.stopPrank();
    }

    function test_expiredApprovalReverts() public {
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _signApproval(ownerKey, "GEMI-BTC15M-UP", true, 8 * USDC, 0, deadline);
        vm.warp(deadline + 1);

        vm.expectRevert(abi.encodeWithSelector(LeashVault.ApprovalExpired.selector, deadline));
        vm.prank(agent);
        vault.spendWithApproval("GEMI-BTC15M-UP", true, 8 * USDC, deadline, sig);
    }

    function test_ownerApprovedSpendAbovePerTradeCapStillReverts() public {
        uint256 amount = 10 * USDC + 1;
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _signApproval(ownerKey, "GEMI-BTC15M-UP", true, amount, 0, deadline);

        vm.expectRevert(
            abi.encodeWithSelector(LeashVault.OverPerTradeCap.selector, amount, PER_TRADE_CAP)
        );
        vm.prank(agent);
        vault.spendWithApproval("GEMI-BTC15M-UP", true, amount, deadline, sig);
    }

    // ---------------------------------------------------------------- seam 3: daily budget

    uint256 internal constant NOV_15_2026_NOON_UTC = 1_794_744_000;

    function _approvedSpend(uint256 amount) internal {
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _signApproval(
            ownerKey, "GEMI-BTC15M-UP", true, amount, vault.approvalNonce(), deadline
        );
        vm.prank(agent);
        vault.spendWithApproval("GEMI-BTC15M-UP", true, amount, deadline, sig);
    }

    function test_spendsAccumulateAndAreRejectedPastDailyBudget() public {
        vm.warp(NOV_15_2026_NOON_UTC);
        assertEq(vault.remainingDailyBudget(), 20 * USDC);

        _approvedSpend(10 * USDC);
        _approvedSpend(8 * USDC);
        vm.prank(agent);
        vault.spend("GEMI-BTC15M-UP", true, 2 * USDC); // exactly hits the $20 budget
        assertEq(vault.remainingDailyBudget(), 0);

        vm.expectRevert(abi.encodeWithSelector(LeashVault.OverDailyBudget.selector, 1, 0));
        vm.prank(agent);
        vault.spend("GEMI-BTC15M-UP", true, 1);
    }

    function test_dailyBudgetResetsAtUtcMidnightNotBefore() public {
        vm.warp(NOV_15_2026_NOON_UTC);
        _approvedSpend(10 * USDC);
        _approvedSpend(10 * USDC);

        vm.warp(NOV_15_2026_NOON_UTC + 12 hours - 1); // 23:59:59 UTC, same day
        assertEq(vault.remainingDailyBudget(), 0);

        vm.warp(NOV_15_2026_NOON_UTC + 12 hours); // 00:00:00 UTC Nov 16
        assertEq(vault.remainingDailyBudget(), 20 * USDC);
        vm.prank(agent);
        vault.spend("GEMI-BTC15M-UP", false, 2 * USDC);
        assertEq(vault.remainingDailyBudget(), 18 * USDC);
    }

    // ---------------------------------------------------------------- seam 4: owner controls

    function test_pausedVaultRejectsBothSpendPathsUntilUnpaused() public {
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _signApproval(ownerKey, "GEMI-BTC15M-UP", true, 8 * USDC, 0, deadline);

        vm.prank(owner);
        vault.pause();

        vm.startPrank(agent);
        vm.expectRevert(LeashVault.VaultPaused.selector);
        vault.spend("GEMI-BTC15M-UP", true, 1 * USDC);
        vm.expectRevert(LeashVault.VaultPaused.selector);
        vault.spendWithApproval("GEMI-BTC15M-UP", true, 8 * USDC, deadline, sig);
        vm.stopPrank();

        vm.prank(owner);
        vault.unpause();
        vm.prank(agent);
        vault.spend("GEMI-BTC15M-UP", true, 1 * USDC);
        assertEq(usdc.balanceOf(broker), 1 * USDC);
    }

    function test_ownerControlsRejectNonOwner() public {
        address stranger = makeAddr("stranger");
        LeashVault.Limits memory l = LeashVault.Limits(1 * USDC, 5 * USDC, 10 * USDC);

        vm.startPrank(stranger);
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.pause();
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.unpause();
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.setLimits(l);
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.setAgent(stranger);
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.setBroker(stranger);
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.withdraw(stranger, 1 * USDC);
        vm.stopPrank();

        vm.prank(agent); // the agent is not the owner either
        vm.expectRevert(LeashVault.NotOwner.selector);
        vault.setLimits(l);
    }

    function test_newLimitsTakeEffectImmediately() public {
        LeashVault.Limits memory tighter = LeashVault.Limits(1 * USDC, 5 * USDC, 10 * USDC);
        vm.expectEmit(false, false, false, true, address(vault));
        emit LeashVault.LimitsUpdated(1 * USDC, 5 * USDC, 10 * USDC);
        vm.prank(owner);
        vault.setLimits(tighter);

        vm.expectRevert(
            abi.encodeWithSelector(LeashVault.NeedsOwnerApproval.selector, 2 * USDC, 1 * USDC)
        );
        vm.prank(agent);
        vault.spend("GEMI-BTC15M-UP", true, 2 * USDC);
        assertEq(vault.remainingDailyBudget(), 10 * USDC);
    }

    function test_setLimitsRejectsInconsistentValues() public {
        vm.startPrank(owner);
        vm.expectRevert(LeashVault.InvalidLimits.selector); // auto-approve above per-trade cap
        vault.setLimits(LeashVault.Limits(6 * USDC, 5 * USDC, 10 * USDC));
        vm.expectRevert(LeashVault.InvalidLimits.selector); // per-trade cap above daily budget
        vault.setLimits(LeashVault.Limits(1 * USDC, 11 * USDC, 10 * USDC));
        vm.stopPrank();
    }

    function test_swappingAgentLocksOutOldKey() public {
        address newAgent = makeAddr("newAgent");
        vm.prank(owner);
        vault.setAgent(newAgent);

        vm.expectRevert(LeashVault.NotAgent.selector);
        vm.prank(agent);
        vault.spend("GEMI-BTC15M-UP", true, 1 * USDC);

        vm.prank(newAgent);
        vault.spend("GEMI-BTC15M-UP", true, 1 * USDC);
        assertEq(usdc.balanceOf(broker), 1 * USDC);
    }

    function test_setBrokerRedirectsFutureSpends() public {
        address newBroker = makeAddr("newBroker");
        vm.prank(owner);
        vault.setBroker(newBroker);

        vm.prank(agent);
        vault.spend("GEMI-BTC15M-UP", true, 1 * USDC);
        assertEq(usdc.balanceOf(newBroker), 1 * USDC);
        assertEq(usdc.balanceOf(broker), 0);
    }

    function test_ownerWithdrawsUsdcEvenWhilePaused() public {
        vm.startPrank(owner);
        vault.pause();
        vault.withdraw(owner, 30 * USDC);
        vm.stopPrank();

        assertEq(usdc.balanceOf(owner), 30 * USDC);
        assertEq(usdc.balanceOf(address(vault)), 70 * USDC);
    }

    function test_zeroAddressesAreRejected() public {
        LeashVault.Limits memory l =
            LeashVault.Limits(AUTO_APPROVE_MAX, PER_TRADE_CAP, DAILY_BUDGET);

        vm.expectRevert(LeashVault.ZeroAddress.selector);
        new LeashVault(address(0), agent, broker, address(usdc), l);
        vm.expectRevert(LeashVault.ZeroAddress.selector);
        new LeashVault(owner, address(0), broker, address(usdc), l);
        vm.expectRevert(LeashVault.ZeroAddress.selector);
        new LeashVault(owner, agent, address(0), address(usdc), l);
        vm.expectRevert(LeashVault.ZeroAddress.selector);
        new LeashVault(owner, agent, broker, address(0), l);

        vm.startPrank(owner);
        vm.expectRevert(LeashVault.ZeroAddress.selector);
        vault.setAgent(address(0));
        vm.expectRevert(LeashVault.ZeroAddress.selector);
        vault.setBroker(address(0));
        vm.expectRevert(LeashVault.ZeroAddress.selector);
        vault.withdraw(address(0), 1 * USDC);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- review follow-ups

    function test_ownerWithdrawsToAnotherAddress() public {
        address coldWallet = makeAddr("coldWallet");
        vm.prank(owner);
        vault.withdraw(coldWallet, 40 * USDC);
        assertEq(usdc.balanceOf(coldWallet), 40 * USDC);
    }

    function test_ownerCanRevokeOutstandingApprovals() public {
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _signApproval(ownerKey, "GEMI-BTC15M-UP", true, 8 * USDC, 0, deadline);

        vm.prank(owner);
        vault.revokeApprovals();
        assertEq(vault.approvalNonce(), 1);

        vm.expectRevert(LeashVault.InvalidOwnerSignature.selector);
        vm.prank(agent);
        vault.spendWithApproval("GEMI-BTC15M-UP", true, 8 * USDC, deadline, sig);

        vm.expectRevert(LeashVault.NotOwner.selector);
        vm.prank(agent);
        vault.revokeApprovals();
    }

    function test_zeroAmountSpendReverts() public {
        vm.expectRevert(LeashVault.ZeroAmount.selector);
        vm.prank(agent);
        vault.spend("GEMI-BTC15M-UP", true, 0);
    }

    function test_approvalCannotBeReusedForDifferentTradeDetails() public {
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _signApproval(ownerKey, "GEMI-BTC15M-UP", true, 5 * USDC, 0, deadline);

        vm.startPrank(agent);
        vm.expectRevert(LeashVault.InvalidOwnerSignature.selector);
        vault.spendWithApproval("GEMI-BTC15M-UP", true, 9 * USDC, deadline, sig); // amount
        vm.expectRevert(LeashVault.InvalidOwnerSignature.selector);
        vault.spendWithApproval("GEMI-BTC15M-UP", false, 5 * USDC, deadline, sig); // outcome
        vm.expectRevert(LeashVault.InvalidOwnerSignature.selector);
        vault.spendWithApproval("GEMI-ETH15M-UP", true, 5 * USDC, deadline, sig); // market
        vm.stopPrank();
    }

    function test_failedApprovedSpendDoesNotConsumeTheApproval() public {
        vm.prank(owner);
        vault.pause();
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _signApproval(ownerKey, "GEMI-BTC15M-UP", true, 5 * USDC, 0, deadline);

        vm.prank(agent);
        vm.expectRevert(LeashVault.VaultPaused.selector);
        vault.spendWithApproval("GEMI-BTC15M-UP", true, 5 * USDC, deadline, sig);

        vm.prank(owner);
        vault.unpause();
        vm.prank(agent);
        vault.spendWithApproval("GEMI-BTC15M-UP", true, 5 * USDC, deadline, sig);
        assertEq(usdc.balanceOf(broker), 5 * USDC);
    }
}

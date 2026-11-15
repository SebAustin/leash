// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {LeashVault} from "../src/LeashVault.sol";

/// @notice Deploys LeashVault to Arc testnet.
/// Required env: OWNER_ADDRESS, AGENT_ADDRESS, BROKER_ADDRESS.
/// Usage:
///   forge script script/DeployLeashVault.s.sol --rpc-url arc_testnet \
///     --account <keystore-name> --broadcast
contract DeployLeashVault is Script {
    /// @dev Arc's ERC-20 interface to native USDC (6 decimals).
    address internal constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant ONE_USDC = 1e6;

    function run() external returns (LeashVault vault) {
        address owner = vm.envAddress("OWNER_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");
        address broker = vm.envAddress("BROKER_ADDRESS");
        address usdc = vm.envOr("USDC_ADDRESS", ARC_TESTNET_USDC);

        LeashVault.Limits memory limits = LeashVault.Limits({
            autoApproveMax: vm.envOr("AUTO_APPROVE_MAX", 2 * ONE_USDC),
            perTradeCap: vm.envOr("PER_TRADE_CAP", 10 * ONE_USDC),
            dailyBudget: vm.envOr("DAILY_BUDGET", 20 * ONE_USDC)
        });

        vm.startBroadcast();
        vault = new LeashVault(owner, agent, broker, usdc, limits);
        vm.stopBroadcast();

        console.log("LeashVault deployed at", address(vault));
    }
}

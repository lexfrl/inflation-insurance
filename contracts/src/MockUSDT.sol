// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDT
/// @notice Testnet-only stand-in for USDT. 6 decimals, open mint so anyone can
///         fund the demo (LPs, buyers). NEVER deploy this to a network where
///         it could be mistaken for real USDT.
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "mUSDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open mint for testnet demo purposes only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

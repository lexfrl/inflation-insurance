// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IInflationOracle
/// @notice V2 seam for CPI settlement. Not wired into `InflationHedge` today --
///         `postSettlement` is still a direct trusted-owner call (see that
///         function's NatSpec). This interface exists so the pitch can name a
///         concrete swap-in path -- INDEC -> a resolver implementing this
///         interface -- without pretending a decentralized oracle is built.
///         A production resolver (signed INDEC attestor, UMA, GenLayer, ...)
///         would implement this and `postSettlement` would read from it
///         instead of taking `cpiBps` as a raw admin argument. Swapping the
///         resolver never needs to touch pricing or settlement math.
interface IInflationOracle {
    /// @notice Whether periodId's CPI print has been resolved by this oracle.
    function resolved(uint256 periodId) external view returns (bool);

    /// @notice The resolved CPI value for periodId, in bps. Reverts (or is
    ///         undefined) if `resolved(periodId)` is false.
    function cpiBps(uint256 periodId) external view returns (uint256);
}

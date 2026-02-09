// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Simple Agent Logic
/// @notice A minimal logic contract for BAP-578 demonstration. Licensed under MIT.
contract SimpleAgentLogic {
    event Hello(string message);

    /// @notice A simple action that emits an event.
    /// @dev This function is intended to be delegatecall-ed by the NFA contract.
    function sayHello(string calldata message) external {
        emit Hello(message);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {NFA} from "../src/NFA.sol";

contract DeployNFA is Script {
    function run() public returns (NFA) {
        vm.startBroadcast();

        // For a real deployment, load owner/signer from env vars or a config
        address initialOwner = vm.envAddress("INITIAL_OWNER");
        address initialSigner = vm.envAddress("INITIAL_SIGNER");
        
        require(initialOwner != address(0), "DeployNFA: INITIAL_OWNER not set");
        require(initialSigner != address(0), "DeployNFA: INITIAL_SIGNER not set");

        NFA nfa = new NFA(initialOwner, initialSigner);

        console2.log("NFA contract deployed at:", address(nfa));
        console2.log("Initial Owner:", nfa.owner());
        console2.log("Initial Signer:", nfa.signerAddress());
        
        vm.stopBroadcast();
        return nfa;
    }
}

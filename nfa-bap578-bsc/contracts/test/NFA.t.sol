// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {NFA} from "../src/NFA.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract NFATest is Test {
    NFA nfa;
    uint256 signerPrivateKey;
    address signerAddress;
    address owner;
    address user1;

    // EIP712 domain separator and type hash for minting
    bytes32 DOMAIN_SEPARATOR;
    bytes32 MINT_TYPEHASH = keccak256("Mint(address to,uint256 nonce,uint256 deadline)");

    function setUp() public {
        owner = makeAddr("owner");
        user1 = makeAddr("user1");
        
        // Setup signer wallet
        signerPrivateKey = 0x1234;
        signerAddress = vm.addr(signerPrivateKey);

        vm.startPrank(owner);
        nfa = new NFA(owner, signerAddress);
        vm.stopPrank();

        DOMAIN_SEPARATOR = nfa.domainSeparator();
    }

    function testMintWithValidSignature() public {
        uint256 nonce = nfa.nonces(user1);
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 structHash = keccak256(abi.encode(MINT_TYPEHASH, user1, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(user1);
        nfa.mintWithSig(user1, deadline, signature);

        assertEq(nfa.ownerOf(0), user1);
        assertEq(nfa.balanceOf(user1), 1);
        assertEq(nfa.nonces(user1), nonce + 1);
    }

    function test_RevertWhen_InvalidSignature() public {
        uint256 nonce = nfa.nonces(user1);
        uint256 deadline = block.timestamp + 1 hours;

        uint256 wrongPrivateKey = 0x5678;
        bytes32 structHash = keccak256(abi.encode(MINT_TYPEHASH, user1, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vm.prank(user1);
        vm.expectRevert("NFA: Invalid signature");
        nfa.mintWithSig(user1, deadline, signature);
    }
    
    function test_RevertWhen_ExpiredDeadline() public {
        uint256 nonce = nfa.nonces(user1);
        uint256 deadline = block.timestamp - 1 seconds;

        bytes32 structHash = keccak256(abi.encode(MINT_TYPEHASH, user1, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(user1);
        vm.expectRevert("NFA: Signature expired");
        nfa.mintWithSig(user1, deadline, signature);
    }
}

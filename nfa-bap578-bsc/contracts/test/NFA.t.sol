// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {NFA} from "../src/NFA.sol";
import {IBAP578} from "../src/IBAP578.sol";

contract EchoLogic {
    event Hello(string message);

    uint256 public callCount;

    function sayHello(string calldata message) external returns (bytes32) {
        callCount += 1;
        emit Hello(message);
        return keccak256(bytes(message));
    }
}

contract NFATest is Test {
    NFA nfa;
    EchoLogic logic;

    uint256 signerPrivateKey;
    address signerAddress;
    address owner;
    address user1;
    address user2;
    address executor;

    bytes32 domainSeparator;
    bytes32 constant MINT_TYPEHASH = keccak256("Mint(address to,uint256 nonce,uint256 deadline)");

    function setUp() public {
        owner = makeAddr("owner");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        executor = makeAddr("executor");

        signerPrivateKey = 0x1234;
        signerAddress = vm.addr(signerPrivateKey);

        vm.prank(owner);
        nfa = new NFA(owner, signerAddress);

        logic = new EchoLogic();

        domainSeparator = nfa.domainSeparator();
    }

    function testMintWithValidSignature() public {
        _mintFor(user1);

        assertEq(nfa.ownerOf(0), user1);
        assertEq(nfa.balanceOf(user1), 1);
        assertEq(nfa.nonces(user1), 1);
    }

    function test_RevertWhen_InvalidSignature() public {
        uint256 nonce = nfa.nonces(user1);
        uint256 deadline = block.timestamp + 1 hours;

        uint256 wrongPrivateKey = 0x5678;
        bytes32 structHash = keccak256(abi.encode(MINT_TYPEHASH, user1, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(user1);
        vm.expectRevert("NFA: Invalid signature");
        nfa.mintWithSig(user1, deadline, signature);
    }

    function test_RevertWhen_ExpiredDeadline() public {
        uint256 nonce = nfa.nonces(user1);
        uint256 deadline = block.timestamp - 1;

        bytes memory signature = _buildMintSignature(user1, nonce, deadline);

        vm.prank(user1);
        vm.expectRevert("NFA: Signature expired");
        nfa.mintWithSig(user1, deadline, signature);
    }

    function testExecuteActionAsOwner() public {
        _mintFor(user1);

        vm.prank(owner);
        nfa.setAllowedLogicContract(address(logic), true);

        vm.prank(user1);
        nfa.setLogicAddress(0, address(logic));

        bytes memory data = abi.encodeWithSignature("sayHello(string)", "hello");

        vm.prank(user1);
        nfa.executeAction(0, data);

        assertEq(logic.callCount(), 1);
    }

    function testExecuteActionAsDelegatedExecutor() public {
        _mintFor(user1);

        vm.prank(owner);
        nfa.setAllowedLogicContract(address(logic), true);

        vm.prank(user1);
        nfa.setLogicAddress(0, address(logic));

        vm.prank(user1);
        nfa.setActionExecutor(0, executor);

        bytes memory data = abi.encodeWithSignature("sayHello(string)", "delegated");

        vm.prank(executor);
        nfa.executeAction(0, data);

        assertEq(logic.callCount(), 1);
    }

    function testRevertWhen_LogicNotAllowed() public {
        _mintFor(user1);

        vm.prank(user1);
        vm.expectRevert("NFA: Logic not allowed");
        nfa.setLogicAddress(0, address(logic));
    }

    function testTransferUpdatesStateOwnerAndClearsExecutor() public {
        _mintFor(user1);

        vm.prank(user1);
        nfa.setActionExecutor(0, executor);

        vm.prank(user1);
        nfa.transferFrom(user1, user2, 0);

        IBAP578.State memory stateAfterTransfer = nfa.getState(0);
        assertEq(stateAfterTransfer.balance, 0);
        assertEq(stateAfterTransfer.owner, user2);
        assertEq(nfa.getActionExecutor(0), address(0));
    }

    function testTerminateRefundsAgentBalance() public {
        _mintFor(user1);
        vm.deal(user1, 1 ether);

        vm.prank(user1);
        nfa.fundAgent{value: 0.5 ether}(0);

        uint256 before = user1.balance;

        vm.prank(user1);
        nfa.terminate(0);

        IBAP578.State memory stateAfterTermination = nfa.getState(0);
        assertEq(stateAfterTermination.balance, 0);
        assertEq(user1.balance, before + 0.5 ether);
        assertEq(nfa.totalAgentBalances(), 0);
    }

    function _mintFor(address to) internal {
        uint256 nonce = nfa.nonces(to);
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _buildMintSignature(to, nonce, deadline);

        vm.prank(to);
        nfa.mintWithSig(to, deadline, signature);
    }

    function _buildMintSignature(address to, uint256 nonce, uint256 deadline) internal returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(MINT_TYPEHASH, to, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}

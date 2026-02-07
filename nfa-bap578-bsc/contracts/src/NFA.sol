// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IBAP578} from "./IBAP578.sol";

/// @title Non-Fungible Agent
/// @author Your Name
/// @notice Implements a minimal, transferable BAP-578 NFA with an agent-gated free mint.
contract NFA is ERC721, EIP712, Ownable, ReentrancyGuard, IBAP578 {
    // --- Constants ---
    uint256 public constant MAX_SUPPLY = 1000;

    // --- State ---
    uint256 private _nextTokenId;

    address public signerAddress;
    mapping(address => uint256) public nonces;

    mapping(uint256 => State) private _states;
    mapping(uint256 => AgentMetadata) private _agentMetadata;
    
    // --- EIP712 ---
    bytes32 private constant MINT_TYPEHASH = keccak256("Mint(address to,uint256 nonce,uint256 deadline)");

    constructor(address initialOwner, address initialSigner)
        ERC721("Non-Fungible Agent", "NFA")
        EIP712("NFA", "1")
        Ownable(initialOwner)
    {
        signerAddress = initialSigner;
    }

    // --- Agent-Gated Mint ---

    /// @notice Mints an NFA for `to` by verifying a signature from the backend.
    function mintWithSig(address to, uint256 deadline, bytes calldata signature) external nonReentrant {
        require(block.timestamp <= deadline, "NFA: Signature expired");
        require(_nextTokenId < MAX_SUPPLY, "NFA: Max supply reached");

        uint256 nonce = nonces[to]++;
        bytes32 structHash = keccak256(abi.encode(MINT_TYPEHASH, to, nonce, deadline));
        bytes32 digest = _hashTypedDataV4(structHash);

        address recoveredSigner = ECDSA.recover(digest, signature);
        require(recoveredSigner == signerAddress, "NFA: Invalid signature");

        _internalMint(to);
    }

    function _internalMint(address to) private {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        // Initialize default BAP-578 state
        _states[tokenId] = State({
            balance: 0,
            status: Status.Active,
            owner: to, // ownerOf(tokenId) can also be used
            logicAddress: address(0), // No default logic for MVP
            lastActionTimestamp: block.timestamp
        });
    }

    // --- BAP-578 Implementation ---

    function executeAction(uint256 tokenId, bytes calldata data) external override {
        require(ownerOf(tokenId) == msg.sender, "NFA: Not owner");
        State storage agentState = _states[tokenId];
        require(agentState.status == Status.Active, "NFA: Agent not active");
        require(agentState.logicAddress != address(0), "NFA: No logic address set");

        agentState.lastActionTimestamp = block.timestamp;

        // In a real implementation, add gas limits and error handling
        (bool success, bytes memory result) = agentState.logicAddress.delegatecall(data);
        require(success, "NFA: Action failed");

        emit ActionExecuted(address(this), result);
    }
    
    function setLogicAddress(uint256 tokenId, address newLogic) external override {
        require(ownerOf(tokenId) == msg.sender, "NFA: Not owner");
        address oldLogic = _states[tokenId].logicAddress;
        _states[tokenId].logicAddress = newLogic;
        emit LogicUpgraded(address(this), oldLogic, newLogic);
    }
    
    function fundAgent(uint256 tokenId) external payable override {
        // Just tracks balance for now. A real implementation might use this for gas.
        _states[tokenId].balance += msg.value;
        emit AgentFunded(address(this), msg.sender, msg.value);
    }
    
    function getState(uint256 tokenId) external view override returns (State memory) {
        require(ownerOf(tokenId) != address(0), "NFA: Token does not exist");
        return _states[tokenId];
    }
    
    function getAgentMetadata(uint256 tokenId) external view override returns (AgentMetadata memory) {
        require(ownerOf(tokenId) != address(0), "NFA: Token does not exist");
        return _agentMetadata[tokenId];
    }
    
    function updateAgentMetadata(uint256 tokenId, AgentMetadata memory metadata) external override {
        require(ownerOf(tokenId) == msg.sender, "NFA: Not owner");
        _agentMetadata[tokenId] = metadata;
        // The spec mentions metadataURI, but the struct is passed directly.
        // Emitting with a placeholder or serialized string would be an option.
        emit MetadataUpdated(tokenId, ""); 
    }
    
    function pause(uint256 tokenId) external override {
        require(ownerOf(tokenId) == msg.sender, "NFA: Not owner");
        _states[tokenId].status = Status.Paused;
        emit StatusChanged(address(this), Status.Paused);
    }

    function unpause(uint256 tokenId) external override {
        require(ownerOf(tokenId) == msg.sender, "NFA: Not owner");
        _states[tokenId].status = Status.Active;
        emit StatusChanged(address(this), Status.Active);
    }

    function terminate(uint256 tokenId) external override {
        require(ownerOf(tokenId) == msg.sender, "NFA: Not owner");
        _states[tokenId].status = Status.Terminated;
        // Optional: refund logic for agentState.balance
        emit StatusChanged(address(this), Status.Terminated);
    }

    // --- Admin ---
    function setSignerAddress(address newSigner) external onlyOwner {
        signerAddress = newSigner;
    }

    function withdraw() external onlyOwner {
        (bool success, ) = owner().call{value: address(this).balance}("");
        require(success, "NFA: Transfer failed");
    }

    // --- URI Storage ---
    // For MVP, we use a placeholder URI.
    function _baseURI() internal pure override returns (string memory) {
        return "https://api.example.com/nfa/metadata/";
    }
}

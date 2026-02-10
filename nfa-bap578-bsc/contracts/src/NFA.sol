// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IBAP578} from "./IBAP578.sol";

/// @title Non-Fungible Agent
/// @notice Implements a transferable BAP-578 NFA with agent-gated minting.
contract NFA is ERC721, EIP712, Ownable, ReentrancyGuard, IBAP578 {
    // --- Constants ---
    uint256 public constant MAX_SUPPLY = 1000;
    uint256 public constant MAX_GAS_FOR_ACTION_CALL = 3_000_000;

    // --- State ---
    uint256 private _nextTokenId;

    address public signerAddress;
    mapping(address => uint256) public nonces;
    mapping(address => bool) public allowedLogicContracts;

    mapping(uint256 => State) private _states;
    mapping(uint256 => AgentMetadata) private _agentMetadata;
    mapping(uint256 => address) private _actionExecutor;

    string private _baseTokenURI;
    uint256 public totalAgentBalances;

    // --- EIP712 ---
    bytes32 private constant MINT_TYPEHASH = keccak256("Mint(address to,uint256 nonce,uint256 deadline)");

    // --- Extended Events ---
    event ActionExecutedV2(uint256 indexed tokenId, address indexed caller, address indexed logicAddress, bytes result);
    event AllowedLogicContractUpdated(address indexed logic, bool allowed);
    event ActionExecutorUpdated(uint256 indexed tokenId, address oldExecutor, address newExecutor);
    event BaseURIUpdated(string newBaseURI);

    constructor(address initialOwner, address initialSigner)
        ERC721("Non-Fungible Agent", "NFA")
        EIP712("NFA", "1")
        Ownable(initialOwner)
    {
        signerAddress = initialSigner;
        _baseTokenURI = "https://api.example.com/nfa/metadata/";
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

        _states[tokenId] = State({
            balance: 0,
            status: Status.Active,
            owner: to,
            logicAddress: address(0),
            lastActionTimestamp: block.timestamp
        });
    }

    // --- BAP-578 Implementation ---

    function executeAction(uint256 tokenId, bytes calldata data) external override nonReentrant {
        address tokenOwner = ownerOf(tokenId);
        require(
            msg.sender == tokenOwner || msg.sender == _actionExecutor[tokenId],
            "NFA: Not authorized executor"
        );

        State storage agentState = _states[tokenId];
        require(agentState.status == Status.Active, "NFA: Agent not active");

        address logicAddress = agentState.logicAddress;
        require(logicAddress != address(0), "NFA: No logic address set");
        require(allowedLogicContracts[logicAddress], "NFA: Logic not allowed");

        agentState.lastActionTimestamp = block.timestamp;

        (bool success, bytes memory result) = logicAddress.call{gas: MAX_GAS_FOR_ACTION_CALL}(data);
        if (!success) {
            _revertWithReason(result);
        }

        emit ActionExecuted(address(this), result);
        emit ActionExecutedV2(tokenId, msg.sender, logicAddress, result);
    }

    function setLogicAddress(uint256 tokenId, address newLogic) external override {
        require(ownerOf(tokenId) == msg.sender, "NFA: Not owner");
        require(newLogic == address(0) || allowedLogicContracts[newLogic], "NFA: Logic not allowed");

        address oldLogic = _states[tokenId].logicAddress;
        _states[tokenId].logicAddress = newLogic;

        emit LogicUpgraded(address(this), oldLogic, newLogic);
    }

    function fundAgent(uint256 tokenId) external payable override {
        _requireOwned(tokenId);

        _states[tokenId].balance += msg.value;
        totalAgentBalances += msg.value;

        emit AgentFunded(address(this), msg.sender, msg.value);
    }

    function getState(uint256 tokenId) external view override returns (State memory) {
        _requireOwned(tokenId);
        return _states[tokenId];
    }

    function getAgentMetadata(uint256 tokenId) external view override returns (AgentMetadata memory) {
        _requireOwned(tokenId);
        return _agentMetadata[tokenId];
    }

    function updateAgentMetadata(uint256 tokenId, AgentMetadata memory metadata) external override {
        require(ownerOf(tokenId) == msg.sender, "NFA: Not owner");
        _agentMetadata[tokenId] = metadata;
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

    function terminate(uint256 tokenId) external override nonReentrant {
        require(ownerOf(tokenId) == msg.sender, "NFA: Not owner");
        State storage agentState = _states[tokenId];
        agentState.status = Status.Terminated;

        uint256 refund = agentState.balance;
        if (refund > 0) {
            agentState.balance = 0;
            totalAgentBalances -= refund;
            (bool success, ) = msg.sender.call{value: refund}("");
            require(success, "NFA: Refund failed");
        }

        emit StatusChanged(address(this), Status.Terminated);
    }

    // --- Agent Execution Delegation ---

    function setActionExecutor(uint256 tokenId, address executor) external {
        require(ownerOf(tokenId) == msg.sender, "NFA: Not owner");

        address oldExecutor = _actionExecutor[tokenId];
        _actionExecutor[tokenId] = executor;

        emit ActionExecutorUpdated(tokenId, oldExecutor, executor);
    }

    function getActionExecutor(uint256 tokenId) external view returns (address) {
        _requireOwned(tokenId);
        return _actionExecutor[tokenId];
    }

    // --- Logic Governance ---

    function setAllowedLogicContract(address logic, bool allowed) external onlyOwner {
        require(logic != address(0), "NFA: Zero logic");
        if (allowed) {
            require(logic.code.length > 0, "NFA: Logic must be contract");
        }

        allowedLogicContracts[logic] = allowed;
        emit AllowedLogicContractUpdated(logic, allowed);
    }

    // --- URI Storage ---

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // --- Admin ---

    function setSignerAddress(address newSigner) external onlyOwner {
        require(newSigner != address(0), "NFA: Zero signer");
        signerAddress = newSigner;
    }

    function withdraw() external onlyOwner nonReentrant {
        require(address(this).balance >= totalAgentBalances, "NFA: Accounting mismatch");
        uint256 available = address(this).balance - totalAgentBalances;

        (bool success, ) = owner().call{value: available}("");
        require(success, "NFA: Transfer failed");
    }

    // --- ERC721 Hooks ---

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = super._update(to, tokenId, auth);

        _states[tokenId].owner = to;

        if (from != to && _actionExecutor[tokenId] != address(0)) {
            address oldExecutor = _actionExecutor[tokenId];
            _actionExecutor[tokenId] = address(0);
            emit ActionExecutorUpdated(tokenId, oldExecutor, address(0));
        }

        return from;
    }

    // --- EIP712 Inspector ---

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // --- Internal ---

    function _revertWithReason(bytes memory returndata) private pure {
        if (returndata.length == 0) {
            revert("NFA: Action failed");
        }

        assembly ("memory-safe") {
            revert(add(returndata, 32), mload(returndata))
        }
    }
}

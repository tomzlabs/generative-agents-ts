# NFA2 Contract Skill

## Contract Overview
This document outlines the skill set required to deploy and interact with the `NFA2.sol` contract. The contract supports Non-Fungible Agents with capabilities such as ownership management, metadata updating, and agent actions.

### Contract Information
- **Contract Address**: `0xef8710D576fbb1320C210A06c265a1cB2C07123e`
- **Token Name**: Non-Fungible Agent
- **Symbol**: NFA

## Key Functionalities

- **Minting**: Tokens can be minted by calling the `mint()` function, subject to balance and mint limit checks.
- **Metadata Management**: Update agent metadata using `updateAgentMetadata()`.
- **Agent Actions**: Execute agent actions with `executeAction()` if the agent's state is active.

## Deployment
Deploy the contract using tools like Hardhat or Truffle, ensuring compatibility with Solidity ^0.8.20. After deployment, configure the contract as needed.

## Interaction Steps

1. **Minting Tokens**: Ensure the user has the required ERC20 token balance and call `mint()`.
2. **Managing Metadata**: Use `getAgentMetadata()` and `updateAgentMetadata()` to interact with agent details.
3. **Executing Logic**: Assign a logic address and call `executeAction()` with the desired data.

## Usage Considerations
- **ERC20 Requirement**: Check the balance of `REQUIRED_TOKEN` before minting.
- **State Management**: Tokens can be paused, unpaused, or terminated using `pause()`, `unpause()`, or `terminate()` respectively.

## Key Events
- `ActionExecuted`
- `LogicUpgraded`
- `AgentFunded`
- `StatusChanged`
- `MetadataUpdated`

Website: https://www.aitown.club/
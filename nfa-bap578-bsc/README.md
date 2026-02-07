# NFA (BAP-578) on BSC — Agent-Gated Free Mint

This folder contains a monorepo-style project to build an **agent-gated free mint** NFT on **BSC**, inspired by clawsnft.com, but using the **BAP-578 Non-Fungible Agent (NFA)** standard (extends ERC-721 with agent functionality).

## Goals (MVP)
- Total supply: **1000**
- **Free mint** (users pay gas)
- **Agent-gated** mint: users/agents solve a simple PoW challenge to obtain a mint signature
- NFT is **transferable** (standard ERC-721 transfers)
- Minimal BAP-578 core: state/metadata/logicAddress + executeAction

## Structure
- `apps/web` — frontend website (claws-like landing + instructions)
- `apps/api` — API (PoW challenge + mint signature)
- `contracts` — Solidity contracts + deploy scripts

## Notes
- LLM/API keys should never be committed. Use env vars or per-user inputs.

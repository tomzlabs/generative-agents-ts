# NFA -> AI Agent Integration (BAP-578 Path)

This repo now includes the minimum on-chain controls to run an off-chain AI runtime safely:

- `setAllowedLogicContract(address,bool)` (owner): logic contract allowlist
- `setLogicAddress(tokenId,address)` (token owner): bind approved logic
- `setActionExecutor(tokenId,address)` (token owner): delegate runtime wallet
- `executeAction(tokenId,bytes)` (owner or delegated executor): call logic
- `setBaseURI(string)` (owner): metadata endpoint for `tokenURI`

## Recommended Runtime Architecture

1. User owns NFA (`tokenId`) on-chain.
2. User sets metadata (`persona`, `experience`, `vaultURI`, `vaultHash`).
3. Project owner allowlists logic contract.
4. User binds that logic via `setLogicAddress`.
5. User assigns runtime wallet via `setActionExecutor`.
6. Runtime loop:
   - read NFA state/metadata
   - run LLM planning off-chain
   - encode action calldata
   - submit `executeAction(tokenId,data)`
   - update vault + hash if memory changed

## Quick Runner

Use `scripts/agent-runner.ts`:

```bash
RPC_URL=https://bsc-dataseed.binance.org/ \
PRIVATE_KEY=0x... \
NFA_ADDRESS=0x68f6c3d8a3B4e6Bdd21f589C852A998338466C5A \
AGENT_ID=0 \
LOGIC_ADDRESS=0x... \
SAY_MESSAGE="Hello from runtime" \
node --loader ts-node/esm scripts/agent-runner.ts
```

Notes:
- Caller must be token owner or registered action executor.
- Logic must be allowlisted by contract owner first.
- Current implementation uses `call` (not `delegatecall`) for safer isolation.

## Frontend Environment Variables

Frontend chain endpoints/addresses are now centralized in `src/config/chain.ts` and can be overridden via Vite env:

```bash
VITE_NFA_ADDRESS=0x...
VITE_TOKEN_ADDRESS=0x...
VITE_BSC_RPC_URL=https://...
```

Create your local env from project root:

```bash
cp .env.example .env
```

## Legacy NFA2 Contract (Already Minted) Integration

If your project is already live on the old `NFA2` contract, you can still connect AI runtime.

What changes in legacy mode:
- owner-only execution (no `setActionExecutor/getActionExecutor`)
- still supports `setLogicAddress` + `executeAction`

Steps:
1. Contract owner allowlists logic via `setAllowedLogicContract(logic, true)`.
2. NFT holder sets token logic via `setLogicAddress(tokenId, logic)`.
3. Run runtime script with owner wallet and `LEGACY_MODE=1`.

Example:

```bash
RPC_URL=https://bsc-dataseed.binance.org/ \
PRIVATE_KEY=0x... \
NFA_ADDRESS=0x... \
AGENT_ID=0 \
LEGACY_MODE=1 \
LOGIC_ADDRESS=0x... \
SAY_MESSAGE="Hello from legacy runtime" \
node --loader ts-node/esm scripts/agent-runner.ts
```

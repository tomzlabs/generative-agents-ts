import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_URL ?? 'https://bsc-dataseed.binance.org/';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const NFA_ADDRESS = process.env.NFA_ADDRESS ?? '0x68f6c3d8a3B4e6Bdd21f589C852A998338466C5A';
const AGENT_ID = Number(process.env.AGENT_ID ?? '0');
const LOGIC_ADDRESS = process.env.LOGIC_ADDRESS;
const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS;
const SAY_MESSAGE = process.env.SAY_MESSAGE ?? 'Hello from AI Runtime';
const LEGACY_MODE = /^(1|true|yes)$/i.test(process.env.LEGACY_MODE ?? '');

const NFA_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getActionExecutor(uint256 tokenId) view returns (address)',
  'function setActionExecutor(uint256 tokenId, address executor) external',
  'function setLogicAddress(uint256 tokenId, address newLogic) external',
  'function executeAction(uint256 tokenId, bytes calldata data) external',
];

const LOGIC_ABI = ['function sayHello(string calldata message) external'];

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error('Missing PRIVATE_KEY env var');
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const nfa = new ethers.Contract(NFA_ADDRESS, NFA_ABI, wallet);

  const tokenOwner: string = await nfa.ownerOf(AGENT_ID);
  const isOwner = wallet.address.toLowerCase() === tokenOwner.toLowerCase();

  let legacy = LEGACY_MODE;
  let actionExecutor = ethers.ZeroAddress;

  if (!legacy) {
    try {
      actionExecutor = (await nfa.getActionExecutor(AGENT_ID)) as string;
    } catch {
      legacy = true;
      console.log('Auto-detected legacy NFA contract (no getActionExecutor). Switching to owner-only mode.');
    }
  }

  console.log(`Wallet: ${wallet.address}`);
  console.log(`Agent #${AGENT_ID} owner: ${tokenOwner}`);
  console.log(`Mode: ${legacy ? 'LEGACY (owner-only)' : 'MODERN (owner/executor)'}`);

  if (!legacy) {
    console.log(`Current executor: ${actionExecutor}`);
    const isExecutor = wallet.address.toLowerCase() === actionExecutor.toLowerCase();

    if (!isOwner && !isExecutor) {
      throw new Error('Current wallet is neither token owner nor registered action executor');
    }

    if (EXECUTOR_ADDRESS && isOwner) {
      console.log(`Setting executor address: ${EXECUTOR_ADDRESS}`);
      const tx = await nfa.setActionExecutor(AGENT_ID, EXECUTOR_ADDRESS);
      await tx.wait();
      console.log(`Executor linked tx: ${tx.hash}`);
    }
  } else if (!isOwner) {
    throw new Error('Legacy mode requires token owner wallet to execute actions');
  }

  if (LOGIC_ADDRESS && isOwner) {
    console.log(`Setting logic address: ${LOGIC_ADDRESS}`);
    const tx = await nfa.setLogicAddress(AGENT_ID, LOGIC_ADDRESS);
    await tx.wait();
    console.log(`Logic linked tx: ${tx.hash}`);
  }

  const iface = new ethers.Interface(LOGIC_ABI);
  const data = iface.encodeFunctionData('sayHello', [SAY_MESSAGE]);

  console.log(`Executing action sayHello('${SAY_MESSAGE}')`);
  const tx = await nfa.executeAction(AGENT_ID, data);
  await tx.wait();
  console.log(`Action executed tx: ${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

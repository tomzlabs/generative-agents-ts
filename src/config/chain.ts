const DEFAULT_NFA_ADDRESS = '0x68f6c3d8a3B4e6Bdd21f589C852A998338466C5A';
const DEFAULT_FARM_ADDRESS = '0xc2933391a475A0aad4fa94C657F4372e058DcbF9';
const DEFAULT_TOKEN_ADDRESS = '0x7Bf7e3F3bE243F7A3cF009A1253e8e9fbD2a1AC3';
const DEFAULT_BSC_RPC_URL = 'https://bsc-rpc.publicnode.com/';

function pickEnvString(value: string | undefined, fallback: string): string {
  const v = value?.trim();
  return v && v.length > 0 ? v : fallback;
}

function normalizeAddress(value: string, fallback: string): string {
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value : fallback;
}

function normalizeRpcUrl(value: string): string | null {
  const v = value.trim();
  if (!/^https?:\/\/\S+/i.test(v)) return null;
  return v.endsWith('/') ? v : `${v}/`;
}

const rpcUrl = normalizeRpcUrl(pickEnvString(import.meta.env.VITE_BSC_RPC_URL, DEFAULT_BSC_RPC_URL)) ?? DEFAULT_BSC_RPC_URL;

export const CHAIN_CONFIG = Object.freeze({
  // NFA is pinned to the legacy contract by product decision.
  nfaAddress: DEFAULT_NFA_ADDRESS,
  farmAddress: normalizeAddress(pickEnvString(import.meta.env.VITE_FARM_ADDRESS, DEFAULT_FARM_ADDRESS), DEFAULT_FARM_ADDRESS),
  tokenAddress: normalizeAddress(pickEnvString(import.meta.env.VITE_TOKEN_ADDRESS, DEFAULT_TOKEN_ADDRESS), DEFAULT_TOKEN_ADDRESS),
  rpcUrl,
  rpcUrls: [rpcUrl],
});

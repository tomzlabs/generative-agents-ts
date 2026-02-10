const DEFAULT_NFA_ADDRESS = '0x68f6c3d8a3B4e6Bdd21f589C852A998338466C5A';
const DEFAULT_TOKEN_ADDRESS = '0xe83606959340915fbf88633c69d206fbf40fffff';
const DEFAULT_BSC_RPC_URL = 'https://bsc-dataseed.binance.org/';

function pickEnvString(value: string | undefined, fallback: string): string {
  const v = value?.trim();
  return v && v.length > 0 ? v : fallback;
}

function normalizeAddress(value: string, fallback: string): string {
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value : fallback;
}

export const CHAIN_CONFIG = Object.freeze({
  nfaAddress: normalizeAddress(pickEnvString(import.meta.env.VITE_NFA_ADDRESS, DEFAULT_NFA_ADDRESS), DEFAULT_NFA_ADDRESS),
  tokenAddress: normalizeAddress(pickEnvString(import.meta.env.VITE_TOKEN_ADDRESS, DEFAULT_TOKEN_ADDRESS), DEFAULT_TOKEN_ADDRESS),
  rpcUrl: pickEnvString(import.meta.env.VITE_BSC_RPC_URL, DEFAULT_BSC_RPC_URL),
});


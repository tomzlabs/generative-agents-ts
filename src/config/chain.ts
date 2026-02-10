const DEFAULT_NFA_ADDRESS = '0x68f6c3d8a3B4e6Bdd21f589C852A998338466C5A';
const DEFAULT_FARM_ADDRESS = '0x07CF9f355E78ebA0D71B8d0699577E284ed19cF2';
const DEFAULT_TOKEN_ADDRESS = '0x7Bf7e3F3bE243F7A3cF009A1253e8e9fbD2a1AC3';
const DEFAULT_BSC_RPC_URLS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.binance.org/',
  'https://bsc-dataseed2.binance.org/',
] as const;

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

function parseRpcUrls(value: string | undefined, fallbacks: readonly string[]): string[] {
  const source = value && value.trim().length > 0 ? value.split(',') : [...fallbacks];
  const normalized = source
    .map((item) => normalizeRpcUrl(item))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(normalized));
}

const envPrimaryRpc = pickEnvString(import.meta.env.VITE_BSC_RPC_URL, DEFAULT_BSC_RPC_URLS[0]);
const rpcUrls = parseRpcUrls(import.meta.env.VITE_BSC_RPC_URLS, [envPrimaryRpc, ...DEFAULT_BSC_RPC_URLS]);

export const CHAIN_CONFIG = Object.freeze({
  nfaAddress: normalizeAddress(pickEnvString(import.meta.env.VITE_NFA_ADDRESS, DEFAULT_NFA_ADDRESS), DEFAULT_NFA_ADDRESS),
  farmAddress: normalizeAddress(pickEnvString(import.meta.env.VITE_FARM_ADDRESS, DEFAULT_FARM_ADDRESS), DEFAULT_FARM_ADDRESS),
  tokenAddress: normalizeAddress(pickEnvString(import.meta.env.VITE_TOKEN_ADDRESS, DEFAULT_TOKEN_ADDRESS), DEFAULT_TOKEN_ADDRESS),
  rpcUrl: rpcUrls[0] ?? DEFAULT_BSC_RPC_URLS[0],
  rpcUrls: rpcUrls.length > 0 ? rpcUrls : [...DEFAULT_BSC_RPC_URLS],
});

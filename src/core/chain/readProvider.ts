import { ethers } from 'ethers';
import { CHAIN_CONFIG } from '../../config/chain';

let cachedKey: string | null = null;
let cachedProvider: ethers.AbstractProvider | null = null;

export function getReadProvider(): ethers.AbstractProvider {
  const urls = CHAIN_CONFIG.rpcUrls.length > 0 ? CHAIN_CONFIG.rpcUrls : [CHAIN_CONFIG.rpcUrl];
  const key = urls.join('|');
  if (cachedProvider && cachedKey === key) {
    return cachedProvider;
  }

  if (urls.length === 1) {
    cachedProvider = new ethers.JsonRpcProvider(urls[0]);
    cachedKey = key;
    return cachedProvider;
  }

  const fallbackConfigs = urls.map((url, index) => ({
    provider: new ethers.JsonRpcProvider(url),
    priority: index + 1,
    stallTimeout: 900 + index * 300,
    weight: 1,
  }));

  cachedProvider = new ethers.FallbackProvider(fallbackConfigs, undefined, { quorum: 1 });
  cachedKey = key;
  return cachedProvider;
}

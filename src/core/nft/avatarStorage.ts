import { loadFromStorage, saveToStorage } from '../persistence/storage';

const NFT_AVATAR_STORAGE_KEY = 'ga:nft:custom-avatar-v1';

export type NftAvatarMap = Record<string, string>;

export function loadCustomNftAvatars(): NftAvatarMap {
  const loaded = loadFromStorage<NftAvatarMap>(NFT_AVATAR_STORAGE_KEY);
  if (!loaded || typeof loaded !== 'object') return {};
  return loaded;
}

export function getCustomNftAvatar(tokenId: number): string | null {
  const key = String(tokenId);
  const map = loadCustomNftAvatars();
  const value = map[key];
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}

export function setCustomNftAvatar(tokenId: number, dataUrl: string): void {
  const key = String(tokenId);
  const map = loadCustomNftAvatars();
  map[key] = dataUrl;
  saveToStorage(NFT_AVATAR_STORAGE_KEY, map);
}

export function removeCustomNftAvatar(tokenId: number): void {
  const key = String(tokenId);
  const map = loadCustomNftAvatars();
  if (!(key in map)) return;
  delete map[key];
  saveToStorage(NFT_AVATAR_STORAGE_KEY, map);
}

import { z } from 'zod';
import { TiledMapSchema, type TiledMap } from './tilemapSchema';

export class AssetLoadError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'AssetLoadError';
  }
}

export async function loadJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new AssetLoadError(`Fetch failed: ${url}`, err);
  }

  if (!res.ok) {
    throw new AssetLoadError(`HTTP ${res.status} loading ${url}`);
  }

  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AssetLoadError(`Invalid JSON schema for ${url}: ${parsed.error.message}`);
  }

  return parsed.data;
}

export async function loadVillageTilemap(): Promise<TiledMap> {
  return loadJson('/static/assets/village/tilemap/tilemap.json', TiledMapSchema);
}

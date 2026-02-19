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

type LoadVillageTilemapOptions = {
  expandWorld?: boolean;
  targetWidth?: number;
  targetHeight?: number;
  remixWorld?: boolean;
};

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function hash32(a: number, b: number, c = 0): number {
  let n = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
  n ^= n >>> 13;
  n = Math.imul(n, 1274126177) >>> 0;
  n ^= n >>> 16;
  return n >>> 0;
}

function tileLayerDataToSize(
  source: number[],
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): number[] {
  const out = new Array<number>(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y++) {
    const sy = mod(y, sourceHeight);
    const srcRowOffset = sy * sourceWidth;
    const dstRowOffset = y * targetWidth;
    for (let x = 0; x < targetWidth; x++) {
      const sx = mod(x, sourceWidth);
      out[dstRowOffset + x] = source[srcRowOffset + sx] ?? 0;
    }
  }
  return out;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function hash01(a: number, b: number, seed: number): number {
  return hash32(a + seed * 31, b + seed * 17, seed * 13) / 4294967295;
}

function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const v00 = hash01(ix, iy, seed);
  const v10 = hash01(ix + 1, iy, seed);
  const v01 = hash01(ix, iy + 1, seed);
  const v11 = hash01(ix + 1, iy + 1, seed);
  const sx = smoothstep(fx);
  const sy = smoothstep(fy);
  return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
}

function buildLayerBySmoothRemix(
  source: number[],
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  seed: number,
): number[] {
  const out = new Array<number>(targetWidth * targetHeight);
  const warpScaleA = Math.max(30, Math.min(68, Math.floor(Math.max(sourceWidth, sourceHeight) * 0.42)));
  const warpScaleB = Math.max(16, Math.floor(warpScaleA * 0.58));
  const warpScaleC = Math.max(12, Math.floor(warpScaleA * 0.42));

  for (let y = 0; y < targetHeight; y++) {
    const rowOffset = y * targetWidth;
    for (let x = 0; x < targetWidth; x++) {
      const nA = valueNoise2D((x + 13) / warpScaleA, (y + 17) / warpScaleA, seed + 11);
      const nB = valueNoise2D((x + 7) / warpScaleB, (y + 5) / warpScaleB, seed + 29);
      const nC = valueNoise2D((x + 3) / warpScaleC, (y + 19) / warpScaleC, seed + 47);
      const driftX = (nA - 0.5) * sourceWidth * 0.12 + (nB - 0.5) * sourceWidth * 0.06 + (nC - 0.5) * sourceWidth * 0.03;
      const driftY = (nA - 0.5) * sourceHeight * 0.1 + (nB - 0.5) * sourceHeight * 0.05 + (nC - 0.5) * sourceHeight * 0.03;
      const sx = mod(Math.floor(x + driftX), sourceWidth);
      const sy = mod(Math.floor(y + driftY), sourceHeight);
      out[rowOffset + x] = source[(sy * sourceWidth) + sx] ?? 0;
    }
  }

  return out;
}

type OrganicDistrict = {
  srcX: number;
  srcY: number;
  patchW: number;
  patchH: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  mirrorX: boolean;
  mirrorY: boolean;
  seed: number;
};

function buildOrganicDistricts(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  count: number,
): OrganicDistrict[] {
  const districts: OrganicDistrict[] = [];
  for (let i = 0; i < count; i++) {
    const h = hash32(i + 41, targetWidth + i * 7, targetHeight + sourceWidth * 3);
    districts.push({
      srcX: (h >>> 19) % sourceWidth,
      srcY: (h >>> 5) % sourceHeight,
      patchW: Math.max(14, Math.min(sourceWidth, 16 + ((h >>> 9) % 44))),
      patchH: Math.max(12, Math.min(sourceHeight, 14 + ((h >>> 14) % 34))),
      cx: 18 + ((h >>> 21) % Math.max(1, targetWidth - 36)),
      cy: 18 + ((h >>> 25) % Math.max(1, targetHeight - 36)),
      rx: 10 + ((h >>> 3) % 28),
      ry: 9 + ((h >>> 11) % 24),
      mirrorX: ((h >>> 1) & 1) === 1,
      mirrorY: ((h >>> 2) & 1) === 1,
      seed: h,
    });
  }
  return districts;
}

function stampPatch(
  target: number[],
  targetWidth: number,
  targetHeight: number,
  source: number[],
  sourceWidth: number,
  sourceHeight: number,
  srcX: number,
  srcY: number,
  width: number,
  height: number,
  dstX: number,
  dstY: number,
): void {
  for (let y = 0; y < height; y++) {
    const ty = dstY + y;
    if (ty < 0 || ty >= targetHeight) continue;
    const sy = mod(srcY + y, sourceHeight);
    for (let x = 0; x < width; x++) {
      const tx = dstX + x;
      if (tx < 0 || tx >= targetWidth) continue;
      const sx = mod(srcX + x, sourceWidth);
      target[(ty * targetWidth) + tx] = source[(sy * sourceWidth) + sx] ?? 0;
    }
  }
}

function stampOrganicDistrict(
  target: number[],
  targetWidth: number,
  targetHeight: number,
  source: number[],
  sourceWidth: number,
  sourceHeight: number,
  district: OrganicDistrict,
  layerSeed: number,
): void {
  const { srcX, srcY, patchW, patchH, cx, cy, rx, ry, mirrorX, mirrorY, seed } = district;
  const minX = Math.max(0, Math.floor(cx - rx - 2));
  const maxX = Math.min(targetWidth - 1, Math.ceil(cx + rx + 2));
  const minY = Math.max(0, Math.floor(cy - ry - 2));
  const maxY = Math.min(targetHeight - 1, Math.ceil(cy + ry + 2));

  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const nx = (tx - cx) / Math.max(1, rx);
      const ny = (ty - cy) / Math.max(1, ry);
      const d = Math.sqrt((nx * nx) + (ny * ny));
      if (d > 1.1) continue;

      const edgeFactor = d <= 0.72 ? 1 : Math.max(0, (1.1 - d) / 0.38);
      if (edgeFactor < 0.999) {
        const noise = valueNoise2D((tx + (seed & 255)) / 5.2, (ty + ((seed >>> 8) & 255)) / 5.2, layerSeed + 131);
        if (noise > (edgeFactor + 0.09)) continue;
      }

      let ox = mod(tx - Math.floor(cx - rx), patchW);
      let oy = mod(ty - Math.floor(cy - ry), patchH);
      if (mirrorX) ox = patchW - 1 - ox;
      if (mirrorY) oy = patchH - 1 - oy;
      const sx = mod(srcX + ox, sourceWidth);
      const sy = mod(srcY + oy, sourceHeight);
      target[(ty * targetWidth) + tx] = source[(sy * sourceWidth) + sx] ?? 0;
    }
  }
}

function remixVillageTilemap(baseMap: TiledMap, targetWidth: number, targetHeight: number): TiledMap {
  const srcWidth = baseMap.width;
  const srcHeight = baseMap.height;
  const nextWidth = Math.max(srcWidth, Math.floor(targetWidth));
  const nextHeight = Math.max(srcHeight, Math.floor(targetHeight));
  const worldSeed = hash32(srcWidth + nextWidth, srcHeight + nextHeight, 907);

  const corePatchW = Math.max(24, Math.min(srcWidth - 4, Math.floor(srcWidth * 0.7)));
  const corePatchH = Math.max(20, Math.min(srcHeight - 4, Math.floor(srcHeight * 0.64)));
  const coreSrcX = Math.floor((srcWidth - corePatchW) / 2);
  const coreSrcY = Math.floor((srcHeight - corePatchH) / 2);
  const coreDstX = Math.floor((nextWidth - corePatchW) / 2);
  const coreDstY = Math.floor((nextHeight - corePatchH) / 2);

  const districts = buildOrganicDistricts(srcWidth, srcHeight, nextWidth, nextHeight, 14);

  const nextLayers = baseMap.layers.map((layer) => {
    if (layer.type !== 'tilelayer' || !Array.isArray(layer.data) || layer.data.length !== (srcWidth * srcHeight)) {
      return layer;
    }
    const layerName = String(layer.name ?? '').toLowerCase();
    const isCollisionLike = layerName.includes('collision') || layerName.includes('block');
    const isInteriorLike = layerName.includes('interior');
    const isDetailLike = layerName.includes('foreground') || layerName.includes('wall');

    if (isCollisionLike) {
      return {
        ...layer,
        width: nextWidth,
        height: nextHeight,
        data: tileLayerDataToSize(layer.data, srcWidth, srcHeight, nextWidth, nextHeight),
      };
    }

    let remixed = buildLayerBySmoothRemix(layer.data, srcWidth, srcHeight, nextWidth, nextHeight, worldSeed);
    if (isInteriorLike) {
      remixed = new Array<number>(nextWidth * nextHeight).fill(0);
    }

    // Stable core area to keep a recognizable town center.
    stampPatch(
      remixed,
      nextWidth,
      nextHeight,
      layer.data,
      srcWidth,
      srcHeight,
      coreSrcX,
      coreSrcY,
      corePatchW,
      corePatchH,
      coreDstX,
      coreDstY,
    );

    // Organic district overlays with soft edges to avoid hard seam cutoffs.
    const districtLimit = isInteriorLike ? 5 : isDetailLike ? 10 : districts.length;
    for (let i = 0; i < districtLimit; i++) {
      const district = districts[i];
      if (!district) continue;
      stampOrganicDistrict(
        remixed,
        nextWidth,
        nextHeight,
        layer.data,
        srcWidth,
        srcHeight,
        district,
        worldSeed,
      );
    }

    return {
      ...layer,
      width: nextWidth,
      height: nextHeight,
      data: remixed,
    };
  });

  return {
    ...baseMap,
    width: nextWidth,
    height: nextHeight,
    layers: nextLayers,
  };
}

function expandVillageTilemap(baseMap: TiledMap, targetWidth: number, targetHeight: number): TiledMap {
  const srcWidth = baseMap.width;
  const srcHeight = baseMap.height;
  if (targetWidth <= srcWidth && targetHeight <= srcHeight) return baseMap;
  const nextWidth = Math.max(srcWidth, Math.floor(targetWidth));
  const nextHeight = Math.max(srcHeight, Math.floor(targetHeight));
  const nextLayers = baseMap.layers.map((layer) => {
    if (layer.type !== 'tilelayer' || !Array.isArray(layer.data) || layer.data.length !== (srcWidth * srcHeight)) {
      return layer;
    }
    return {
      ...layer,
      width: nextWidth,
      height: nextHeight,
      data: tileLayerDataToSize(layer.data, srcWidth, srcHeight, nextWidth, nextHeight),
    };
  });
  return {
    ...baseMap,
    width: nextWidth,
    height: nextHeight,
    layers: nextLayers,
  };
}

function normalizeTileSizeForScaleOne(map: TiledMap, maxDimension = 16384): TiledMap {
  const safeTile = Math.max(8, Math.floor(maxDimension / Math.max(map.width, map.height)));
  if (safeTile >= map.tilewidth && safeTile >= map.tileheight) return map;
  const nextTile = Math.min(map.tilewidth, map.tileheight, safeTile);
  return {
    ...map,
    tilewidth: nextTile,
    tileheight: nextTile,
  };
}

export async function loadVillageTilemapWithOptions(options: LoadVillageTilemapOptions = {}): Promise<TiledMap> {
  const baseMap = await loadVillageTilemap();
  if (!options.expandWorld) return baseMap;
  const targetWidth = Math.max(baseMap.width, Math.floor(options.targetWidth ?? 540));
  const targetHeight = Math.max(baseMap.height, Math.floor(options.targetHeight ?? 500));
  if (options.remixWorld ?? true) {
    const remixed = remixVillageTilemap(baseMap, targetWidth, targetHeight);
    return normalizeTileSizeForScaleOne(remixed);
  }
  const expanded = expandVillageTilemap(baseMap, targetWidth, targetHeight);
  return normalizeTileSizeForScaleOne(expanded);
}

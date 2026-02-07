import type { TiledMap } from './tilemapSchema';

export type EmbeddedTileset = {
  firstgid: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth?: number;
  tileheight?: number;
  tilecount?: number;
  columns?: number;
  name?: string;
};

export type ResolvedTileset = {
  firstgid: number;
  imageUrl: string;
  image: HTMLImageElement;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  tileCount: number;
};

export function basename(path: string): string {
  const clean = path.replace(/\\/g, '/');
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

export function mapTilesetImageUrl(imagePath: string): string {
  // tilemap.json contains paths like: map_assets/.../CuteRPG_Village_B.png
  // In this repo we store them at: /static/assets/village/tilemap/<basename>
  return `/static/assets/village/tilemap/${basename(imagePath)}`;
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

export async function resolveTilesets(map: TiledMap): Promise<ResolvedTileset[]> {
  const tilesets = (map.tilesets ?? []) as unknown as EmbeddedTileset[];
  const out: ResolvedTileset[] = [];

  for (const ts of tilesets) {
    if (!ts.image) continue; // ignore tilesets without embedded image for MVP
    const imageUrl = mapTilesetImageUrl(ts.image);
    const image = await loadImage(imageUrl);

    out.push({
      firstgid: ts.firstgid,
      imageUrl,
      image,
      tileWidth: ts.tilewidth ?? map.tilewidth,
      tileHeight: ts.tileheight ?? map.tileheight,
      columns: ts.columns ?? Math.floor((ts.imagewidth ?? image.width) / (ts.tilewidth ?? map.tilewidth)),
      tileCount: ts.tilecount ?? 0,
    });
  }

  // Ensure ascending by firstgid
  out.sort((a, b) => a.firstgid - b.firstgid);
  return out;
}

export function pickTileset(tilesets: ResolvedTileset[], gid: number): ResolvedTileset | null {
  // tilesets sorted asc; pick the last ts with firstgid <= gid
  let chosen: ResolvedTileset | null = null;
  for (const ts of tilesets) {
    if (ts.firstgid <= gid) chosen = ts;
    else break;
  }
  return chosen;
}

export function drawTileLayer(opts: {
  ctx: CanvasRenderingContext2D;
  map: TiledMap;
  tilesets: ResolvedTileset[];
  layerData: number[];
  scale: number;
}): void {
  const { ctx, map, tilesets, layerData, scale } = opts;
  const tw = map.tilewidth;
  const th = map.tileheight;

  // Pixel-art crisp
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctx as any).imageSmoothingEnabled = false;

  const w = map.width;

  for (let i = 0; i < layerData.length; i++) {
    const gidRaw = layerData[i] ?? 0;
    // Tiled uses high bits for flip flags. Mask them out.
    const FLIP_MASK = 0x1fffffff;
    const gid = gidRaw & FLIP_MASK;

    if (gid === 0) continue;

    const ts = pickTileset(tilesets, gid);
    if (!ts) continue;

    const localId = gid - ts.firstgid;
    const sx = (localId % ts.columns) * ts.tileWidth;
    const sy = Math.floor(localId / ts.columns) * ts.tileHeight;

    const x = (i % w) * tw;
    const y = Math.floor(i / w) * th;

    ctx.drawImage(
      ts.image,
      sx,
      sy,
      ts.tileWidth,
      ts.tileHeight,
      x * scale,
      y * scale,
      tw * scale,
      th * scale,
    );
  }
}

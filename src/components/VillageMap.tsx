import { useEffect, useMemo, useRef, useState } from 'react';
import { loadVillageTilemap } from '../core/assets/loadTilemap';
import type { TiledMap } from '../core/assets/tilemapSchema';
import { drawTileLayer, loadImage, resolveTilesets, type ResolvedTileset } from '../core/assets/tileRendering';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pickDefaultRenderableLayer(map: TiledMap): { name: string; data: number[] } | null {
  // Prefer the first visible tilelayer with data.
  for (const layer of map.layers) {
    if (layer.type !== 'tilelayer') continue;
    if (!layer.data || layer.data.length === 0) continue;
    if (layer.visible === false) continue;
    return { name: layer.name, data: layer.data };
  }

  // Fallback: any tilelayer with data.
  for (const layer of map.layers) {
    if (layer.type !== 'tilelayer') continue;
    if (!layer.data || layer.data.length === 0) continue;
    return { name: layer.name, data: layer.data };
  }

  return null;
}

type AgentMarker = {
  id: string;
  name: string;
  img: HTMLImageElement;
  // position in tile coords
  tx: number;
  ty: number;
};

export function VillageMap() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tilesetsRef = useRef<ResolvedTileset[] | null>(null);

  const [map, setMap] = useState<TiledMap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [layerName, setLayerName] = useState<string | null>(null);
  const [renderErr, setRenderErr] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentMarker[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const m = await loadVillageTilemap();
        if (cancelled) return;

        setMap(m);
        const picked = pickDefaultRenderableLayer(m);
        // Default to render all tile layers; user can pick visible-only or a single layer.
        setLayerName(picked ? '__ALL__' : null);

        // Resolve tilesets once and cache.
        tilesetsRef.current = await resolveTilesets(m);
        if (cancelled) return;

        // Load a few demo agent portraits and place them on the map.
        const demoAgents = [
          { id: 'tom', name: 'Tom', tx: 70, ty: 55 },
          { id: 'mei', name: 'Mei', tx: 72, ty: 55 },
          { id: 'sam', name: 'Sam', tx: 74, ty: 55 },
        ];

        const loaded = await Promise.all(
          demoAgents.map(async (a) => {
            const img = await loadImage(`/static/assets/village/agents/${a.name}/portrait.png`);
            return { ...a, img };
          }),
        );

        if (cancelled) return;
        setAgents(loaded);
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const dims = useMemo(() => {
    if (!map) return null;
    return {
      w: map.width * map.tilewidth,
      h: map.height * map.tileheight,
    };
  }, [map]);

  const selectedLayer = useMemo(() => {
    if (!map || !layerName || layerName === '__ALL__') return null;
    const layer = map.layers.find((l) => l.type === 'tilelayer' && l.name === layerName);
    if (!layer?.data) return null;
    return { name: layer.name, data: layer.data };
  }, [map, layerName]);

  const allTileLayers = useMemo(() => {
    if (!map) return [] as { name: string; data: number[]; visible: boolean }[];
    return map.layers
      .filter((l) => l.type === 'tilelayer' && Array.isArray(l.data) && l.data.length > 0)
      .map((l) => ({ name: l.name, data: l.data as number[], visible: l.visible !== false }));
  }, [map]);

  const visibleLayers = useMemo(() => {
    return allTileLayers.filter((l) => l.visible).map(({ name, data }) => ({ name, data }));
  }, [allTileLayers]);

  const renderLayers = useMemo(() => {
    if (!map) return [] as { name: string; data: number[] }[];
    if (!layerName || layerName === '__ALL__') {
      // Render all tile layers by default; some important layers are marked invisible in exports.
      return allTileLayers.map(({ name, data }) => ({ name, data }));
    }
    if (layerName === '__VISIBLE__') return visibleLayers;
    return selectedLayer ? [selectedLayer] : visibleLayers;
  }, [map, layerName, selectedLayer, visibleLayers, allTileLayers]);

  // Render base map to canvas when map/scale/layer changes.
  useEffect(() => {
    if (!map || !dims || renderLayers.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    setRenderErr(null);

    try {
      const tilesets = tilesetsRef.current;
      if (!tilesets || tilesets.length === 0) {
        throw new Error('No tilesets resolved (images may still be loading)');
      }

      canvas.width = dims.w * scale;
      canvas.height = dims.h * scale;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw selected layer or all visible layers.
      for (const layer of renderLayers) {
        drawTileLayer({ ctx, map, tilesets, layerData: layer.data, scale });
      }

      // Overlay agent markers (MVP)
      for (const a of agents) {
        const px = a.tx * map.tilewidth * scale;
        const py = a.ty * map.tileheight * scale;
        const size = map.tilewidth * scale;

        ctx.drawImage(a.img, px, py, size, size);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(px, py + size - 14, size, 14);
        ctx.fillStyle = '#fff';
        ctx.font = `${10 * scale}px ui-monospace`;
        ctx.fillText(a.name, px + 2, py + size - 4);
      }
    } catch (e) {
      setRenderErr(e instanceof Error ? e.message : String(e));
    }
  }, [map, dims, renderLayers, scale, agents]);

  // Minimal tick: move agents slightly every second.
  useEffect(() => {
    if (!map) return;
    const t = window.setInterval(() => {
      setAgents((prev) =>
        prev.map((a, idx) => ({
          ...a,
          tx: (a.tx + (idx % 2 === 0 ? 1 : -1) + map.width) % map.width,
        })),
      );
    }, 1000);
    return () => window.clearInterval(t);
  }, [map]);

  if (err) {
    return (
      <div style={{ padding: 16, color: '#b91c1c', fontFamily: 'ui-monospace' }}>
        Failed to load village tilemap:
        <pre style={{ whiteSpace: 'pre-wrap' }}>{err}</pre>
      </div>
    );
  }

  if (!map || !dims) {
    return <div style={{ padding: 16 }}>Loading tilemap…</div>;
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <strong>Village Map (Canvas MVP)</strong>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          Scale
          <input
            type="range"
            min={1}
            max={3}
            value={scale}
            onChange={(e) => setScale(clamp(Number(e.target.value), 1, 4))}
          />
          <span style={{ fontFamily: 'ui-monospace' }}>{scale}×</span>
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          Layer
          <select value={layerName ?? ''} onChange={(e) => setLayerName(e.target.value)}>
            <option value="__ALL__">(All layers)</option>
            <option value="__VISIBLE__">(Visible layers only)</option>
            {map.layers
              .filter((l) => l.type === 'tilelayer' && Array.isArray(l.data))
              .map((l) => (
                <option key={l.id} value={l.name}>
                  {l.name}
                </option>
              ))}
          </select>
        </label>

        <span style={{ fontFamily: 'ui-monospace', fontSize: 12, opacity: 0.8 }}>
          tiles {map.width}×{map.height} @ {map.tilewidth}×{map.tileheight}px
        </span>
      </div>

      {renderErr ? (
        <div style={{ marginBottom: 12, color: '#b91c1c', fontFamily: 'ui-monospace' }}>{renderErr}</div>
      ) : null}

      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          overflow: 'auto',
          maxHeight: '70vh',
          background: '#111827',
          padding: 12,
        }}
      >
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>tilemap.json (debug)</summary>
        <pre
          style={{
            background: '#0b1020',
            color: '#e5e7eb',
            padding: 12,
            borderRadius: 8,
            overflow: 'auto',
            maxHeight: 420,
            fontSize: 12,
          }}
        >
          {JSON.stringify(map, null, 2)}
        </pre>
      </details>
    </div>
  );
}

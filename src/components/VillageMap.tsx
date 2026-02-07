import { useEffect, useMemo, useRef, useState } from 'react';
import { loadVillageTilemap } from '../core/assets/loadTilemap';
import type { TiledMap } from '../core/assets/tilemapSchema';
import { drawTileLayer, resolveTilesets } from '../core/assets/tileRendering';

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

export function VillageMap() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [map, setMap] = useState<TiledMap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scale, setScale] = useState(2);
  const [layerName, setLayerName] = useState<string | null>(null);
  const [renderErr, setRenderErr] = useState<string | null>(null);

  useEffect(() => {
    loadVillageTilemap()
      .then((m) => {
        setMap(m);
        const picked = pickDefaultRenderableLayer(m);
        setLayerName(picked?.name ?? null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const dims = useMemo(() => {
    if (!map) return null;
    return {
      w: map.width * map.tilewidth,
      h: map.height * map.tileheight,
    };
  }, [map]);

  const selectedLayer = useMemo(() => {
    if (!map || !layerName) return null;
    const layer = map.layers.find((l) => l.type === 'tilelayer' && l.name === layerName);
    if (!layer?.data) return null;
    return { name: layer.name, data: layer.data };
  }, [map, layerName]);

  // Render to canvas when map/scale/layer changes.
  useEffect(() => {
    if (!map || !dims || !selectedLayer) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    setRenderErr(null);

    (async () => {
      try {
        const tilesets = await resolveTilesets(map);
        if (cancelled) return;

        canvas.width = dims.w * scale;
        canvas.height = dims.h * scale;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawTileLayer({ ctx, map, tilesets, layerData: selectedLayer.data, scale });
      } catch (e) {
        if (cancelled) return;
        setRenderErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [map, dims, selectedLayer, scale]);

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
            max={4}
            value={scale}
            onChange={(e) => setScale(clamp(Number(e.target.value), 1, 4))}
          />
          <span style={{ fontFamily: 'ui-monospace' }}>{scale}×</span>
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          Layer
          <select value={layerName ?? ''} onChange={(e) => setLayerName(e.target.value)}>
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

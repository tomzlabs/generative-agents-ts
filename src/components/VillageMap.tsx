import { useEffect, useMemo, useState } from 'react';
import { loadVillageTilemap } from '../core/assets/loadTilemap';
import type { TiledMap } from '../core/assets/tilemapSchema';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function VillageMap() {
  const [map, setMap] = useState<TiledMap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scale, setScale] = useState(2);

  useEffect(() => {
    loadVillageTilemap()
      .then(setMap)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const dims = useMemo(() => {
    if (!map) return null;
    return {
      w: map.width * map.tilewidth,
      h: map.height * map.tileheight,
    };
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

  // MVP: show the map JSON + ensure static assets are reachable.
  // Next: parse tilesets + render canvas.
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <strong>Village Map (MVP)</strong>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          Scale
          <input
            type="range"
            min={1}
            max={6}
            value={scale}
            onChange={(e) => setScale(clamp(Number(e.target.value), 1, 6))}
          />
          <span style={{ fontFamily: 'ui-monospace' }}>{scale}×</span>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 12,
            minWidth: 280,
            flex: '0 0 auto',
          }}
        >
          <div style={{ fontFamily: 'ui-monospace', fontSize: 12, opacity: 0.8 }}>
            tiles: {map.width}×{map.height} @ {map.tilewidth}×{map.tileheight}px
            <br />
            pixels: {dims.w}×{dims.h}
          </div>
          <div style={{ marginTop: 12 }}>
            <img
              alt="tileset sample"
              src="/static/assets/village/tilemap/CuteRPG_Village_B.png"
              style={{ width: 256 * scale, imageRendering: 'pixelated' as any }}
            />
          </div>
        </div>

        <div style={{ flex: '1 1 520px', minWidth: 320 }}>
          <details open>
            <summary>tilemap.json (debug)</summary>
            <pre
              style={{
                background: '#0b1020',
                color: '#e5e7eb',
                padding: 12,
                borderRadius: 8,
                overflow: 'auto',
                maxHeight: 520,
                fontSize: 12,
              }}
            >
              {JSON.stringify(map, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}

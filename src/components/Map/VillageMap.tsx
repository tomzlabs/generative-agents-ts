import { useEffect, useMemo, useRef, useState } from 'react';
import { loadVillageTilemap } from '../../core/assets/loadTilemap';
import type { TiledMap } from '../../core/assets/tilemapSchema';
import { drawTileLayer, loadImage, resolveTilesets, type ResolvedTileset } from '../../core/assets/tileRendering';
import { SettingsPanel } from '../SettingsPanel';
import { STORAGE_KEYS } from '../../core/persistence/keys';
import { loadFromStorage, removeFromStorage, saveToStorage } from '../../core/persistence/storage';
import { DEFAULT_SETTINGS, type AppSettings } from '../../core/settings/types';
import { DEFAULT_WORLD_STATE, type PersistedWorldState } from '../../core/world/persistedTypes';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}



type AgentMarker = {
  id: string;
  name: string;
  img: HTMLImageElement;
  // position in tile coords
  tx: number;
  ty: number;
  status: string;
};

export function VillageMap() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tilesetsRef = useRef<ResolvedTileset[] | null>(null);

  const [map, setMap] = useState<TiledMap | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings>(() => loadFromStorage<AppSettings>(STORAGE_KEYS.settings) ?? DEFAULT_SETTINGS);
  const [world, setWorld] = useState<PersistedWorldState>(
    () => loadFromStorage<PersistedWorldState>(STORAGE_KEYS.world) ?? DEFAULT_WORLD_STATE,
  );

  const [scale, setScale] = useState(settings.ui.scale);
  const [layerName, setLayerName] = useState<string | null>(settings.ui.layerMode);
  const [renderErr, setRenderErr] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentMarker[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const m = await loadVillageTilemap();
        if (cancelled) return;

        setMap(m);
        // Default to render visible layers only (hides collisions)
        setLayerName('__VISIBLE__');

        // Resolve tilesets once and cache.
        tilesetsRef.current = await resolveTilesets(m);
        if (cancelled) return;

        // Load a few demo agent portraits and place them on the map.
        const loaded = await Promise.all(
          world.agents.map(async (a) => {
            const img = await loadImage(`/static/assets/village/agents/${a.name}/portrait.png`);
            return { id: a.id, name: a.name, tx: a.tx, ty: a.ty, status: a.status, img };
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
    return allTileLayers
      .filter((l) => l.visible && l.name !== 'Collisions')
      .map(({ name, data }) => ({ name, data }));
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

      // Fill with a fallback background so missing tiles don't look like black holes.
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw selected layer or all/visible layers.
      for (const layer of renderLayers) {
        drawTileLayer({ ctx, map, tilesets, layerData: layer.data, scale });
      }

      // Overlay agent markers (MVP)
      for (const a of agents) {
        const px = a.tx * map.tilewidth * scale;
        const py = a.ty * map.tileheight * scale;
        const size = map.tilewidth * scale;

        // Draw agent sprite
        ctx.drawImage(a.img, px, py, size, size);

        // Name tag with text shadow for readability
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(10, 10 * scale)}px "Space Mono", monospace`;

        const textX = px + size / 2;
        const textY = py + size + (4 * scale);

        // Text Outline/Shadow
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeText(a.name, textX, textY);
        ctx.fillText(a.name, textX, textY);
      }
    } catch (e) {
      setRenderErr(e instanceof Error ? e.message : String(e));
    }
  }, [map, dims, renderLayers, scale, agents]);

  // Save settings (localStorage)
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.settings, settings);
  }, [settings]);

  // Save world state (localStorage)
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.world, world);
  }, [world]);

  // Minimal tick: update world + reflect into rendered agents
  useEffect(() => {
    if (!map) return;
    const t = window.setInterval(() => {
      setWorld((prev) => {
        const tick = prev.tick + 1;
        const agentsNext = prev.agents.map((a, idx) => {
          const dx = idx % 2 === 0 ? 1 : -1;
          return {
            ...a,
            tx: (a.tx + dx + map.width) % map.width,
            status: 'walking',
          };
        });

        const msg = `[t=${tick}] ${agentsNext[0]?.name ?? 'agent'} tick`;
        const events = [...prev.events, { t: tick, ts: Date.now(), message: msg }].slice(-200);

        return { ...prev, tick, agents: agentsNext, events };
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [map]);

  // Keep rendered agent markers in sync with world positions
  useEffect(() => {
    setAgents((prev) =>
      prev.map((m) => {
        const a = world.agents.find((x) => x.id === m.id);
        return a ? { ...m, tx: a.tx, ty: a.ty, status: a.status } : m;
      }),
    );
  }, [world.agents]);

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
    <div style={{ padding: 16, boxSizing: 'border-box', width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      {/* Top Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2vh',
        fontSize: 'clamp(10px, 1.5vh, 14px)',
        color: '#666',
        borderBottom: '1px solid #222',
        paddingBottom: '1vh'
      }}>
        <div style={{ display: 'flex', gap: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '8px', height: '8px', backgroundColor: '#00FF41', borderRadius: '50%', boxShadow: '0 0 8px #00FF41' }}></div>
            <span>SYSTEM ONLINE</span>
          </div>
          <div className="desktop-only">//</div>
          <div className="desktop-only">VILLAGE MAP</div>
          <div className="desktop-only">//</div>
          <div className="desktop-only">AI小镇</div>
        </div>
        <div style={{ fontFamily: "'Press Start 2P', cursive", fontSize: '0.8em', color: '#00FF41' }}>
          EARTH YEAR 2026
        </div>
      </div>

      <SettingsPanel
        settings={settings}
        onChange={(next) => {
          setSettings(next);
          setScale(next.ui.scale);
          setLayerName(next.ui.layerMode);
        }}
        onResetWorld={() => {
          removeFromStorage(STORAGE_KEYS.world);
          setWorld(DEFAULT_WORLD_STATE);
        }}
        onClearKey={() => {
          const next = { ...settings, llm: { ...settings.llm, apiKey: '' } };
          setSettings(next);
        }}
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <strong>Village Map (Canvas MVP)</strong>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          Scale
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.1}
            value={scale}
            onChange={(e) => {
              const v = round1(clamp(Number(e.target.value), 0.1, 3));
              setScale(v);
              setSettings((s) => ({ ...s, ui: { ...s.ui, scale: v } }));
            }}
          />
          <span style={{ fontFamily: 'ui-monospace' }}>{scale}×</span>
        </label>

        {/* Layer selection removed, default to visible only */}

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
          overflow: 'hidden', // Hide overflow
          maxWidth: '100%', // Constrain width
          maxHeight: '70vh',
          background: '#111827',
          padding: 12,
        }}
      >
        <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
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

      {/* Footer / Community Links */}
      <div style={{
        marginTop: '4vh',
        paddingTop: '3vh',
        borderTop: '1px solid #222',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1rem'
      }}>
        <div style={{
          fontFamily: "'Press Start 2P', cursive",
          fontSize: '12px',
          color: '#666',
          marginBottom: '10px'
        }}>JOIN THE SIMULATION</div>

        <div style={{ display: 'flex', gap: '2rem' }}>
          <a href="https://x.com/i/communities/2019361555687887238" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#E0E0E0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: '#00FF41' }}>&gt;</span> TWITTER_COMMUNITY
          </a>
          <a href="https://github.com/tomzlabs/generative-agents-ts" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#E0E0E0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: '#00FF41' }}>&gt;</span> GITHUB_REPO
          </a>
        </div>
      </div>

      {/* Basic Mobile CSS */}
      <style>{`
          @media (max-width: 900px) {
              .desktop-only { display: none; }
          }
      `}</style>
    </div>
  );
}

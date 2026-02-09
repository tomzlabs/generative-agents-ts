import { useEffect, useMemo, useRef, useState } from 'react';
import { loadVillageTilemap } from '../../core/assets/loadTilemap';
import type { TiledMap } from '../../core/assets/tilemapSchema';
import { drawTileLayer, loadImage, resolveTilesets, type ResolvedTileset } from '../../core/assets/tileRendering';
import { SettingsPanel } from '../SettingsPanel';
import { STORAGE_KEYS } from '../../core/persistence/keys';
import { loadFromStorage, removeFromStorage, saveToStorage } from '../../core/persistence/storage';
import { DEFAULT_SETTINGS, type AppSettings } from '../../core/settings/types';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

type AgentMarker = {
  id: string;
  name: string;
  img: HTMLImageElement | null;
  // position in tile coords
  tx: number;
  ty: number;
  // Target position for autonomous movement
  targetTx?: number;
  targetTy?: number;
  lastMoveTime: number;
  status: string;
  thought?: string;
  thoughtTimer?: number;
};

const AGENT_THOUGHTS = [
  "Analyzing market data...",
  "Searching for alpha...",
  "Scanning mempool...",
  "Verifying block hash...",
  "Constructing portfolio...",
  "Observing liquidity...",
  "Calculating yield...",
  "Syncing with chain...",
  "Debugging smart contract...",
  "Optimizing gas fees...",
  "HODLing...",
  "Looking for bugs...",
  "Reviewing whitepaper...",
  "Checking wallet balance..."
];

export function VillageMap() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tilesetsRef = useRef<ResolvedTileset[] | null>(null);
  const staticMapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const agentsRef = useRef<AgentMarker[]>([]);

  const [map, setMap] = useState<TiledMap | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings>(() => loadFromStorage<AppSettings>(STORAGE_KEYS.settings) ?? DEFAULT_SETTINGS);

  // We don't use persisted world state for this dynamic NFT view anymore, 
  // but keeping the type for compatibility if needed later.
  // const [world, setWorld] = useState<PersistedWorldState>(DEFAULT_WORLD_STATE);

  const [scale, setScale] = useState(settings.ui.scale);
  const [layerName, setLayerName] = useState<string | null>(settings.ui.layerMode);
  const [renderErr, setRenderErr] = useState<string | null>(null);

  // UI-only state; actual moving positions live in refs to avoid 20FPS re-render.
  const [agentCount, setAgentCount] = useState(0);

  // Fetch NFTs on mount
  useEffect(() => {
    const fetchNFTs = async () => {
      try {
        // 1. Skip NFT fetching for now as requested
        // const totalSupply = ...

        // 2. Load Special NPCs only (CZ & He Yi)
        const czImg = await loadImage('/static/assets/npc/cz_sprite.png').catch(() => null);
        const heyiImg = await loadImage('/static/assets/npc/heyi_sprite.png').catch(() => null);

        const specialNPCs: AgentMarker[] = [
          {
            id: 'npc_cz',
            name: 'CZ',
            img: czImg,
            tx: 18,
            ty: 18,
            targetTx: 18,
            targetTy: 18,
            lastMoveTime: Date.now(),
            status: 'building',
            thought: 'Funds are SAI...',
            thoughtTimer: Date.now() + 1000000 // Keep thought visible
          },
          {
            id: 'npc_heyi',
            name: 'Yi He',
            img: heyiImg,
            tx: 22,
            ty: 22,
            targetTx: 22,
            targetTy: 22,
            lastMoveTime: Date.now(),
            status: 'building',
            thought: 'Building ecosystem...',
            thoughtTimer: Date.now() + 1000000 // Keep thought visible
          }
        ];

        agentsRef.current = specialNPCs;
        setAgentCount(specialNPCs.length);

      } catch (e) {
        console.error("Failed to fetch NFTs for map", e);
        // Fallback: Spawn demo agents so the map isn't empty
        const demoAgents: AgentMarker[] = Array.from({ length: 5 }).map((_, i) => ({
          id: `demo_${i}`,
          name: `Ghost #${i}`,
          img: null, // Will use placeholder
          tx: 10 + (Math.random() * 10 - 5),
          ty: 10 + (Math.random() * 10 - 5),
          targetTx: Math.floor(10 + (Math.random() * 20 - 10)),
          targetTy: Math.floor(10 + (Math.random() * 20 - 10)),
          lastMoveTime: Date.now(),
          status: 'idle',
          thought: 'Connection lost...',
          thoughtTimer: Date.now() + 10000
        }));
        agentsRef.current = demoAgents;
        setAgentCount(demoAgents.length);
      }
    };

    fetchNFTs();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const m = await loadVillageTilemap();
        if (cancelled) return;

        setMap(m);
        setLayerName('__VISIBLE__');
        tilesetsRef.current = await resolveTilesets(m);

      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { cancelled = true; };
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
    const DEBUG_LAYERS = [
      'Collisions', 'Object Interaction Blocks', 'Arena Blocks', 'Sector Blocks',
      'World Blocks', 'Spawning Blocks', 'Special Blocks Registry', 'Utilities'
    ];

    return allTileLayers
      .filter((l) => {
        if (DEBUG_LAYERS.includes(l.name) || l.name.startsWith('_')) return false;
        return l.visible;
      })
      .map(({ name, data }) => ({ name, data }));
  }, [allTileLayers]);

  const renderLayers = useMemo(() => {
    if (!map) return [] as { name: string; data: number[] }[];
    if (!layerName || layerName === '__ALL__') return visibleLayers;
    if (layerName === '__VISIBLE__') return visibleLayers;
    return selectedLayer ? [selectedLayer] : visibleLayers;
  }, [map, layerName, selectedLayer, visibleLayers]);

  // Autonomous Behavior Loop
  useEffect(() => {
    if (!map) return;
    const interval = setInterval(() => {
      agentsRef.current = agentsRef.current.map(agent => {
          const now = Date.now();
          let { tx, ty, targetTx, targetTy, thought, thoughtTimer } = agent;

          // 1. Move towards target
          if (targetTx !== undefined && targetTy !== undefined) {
            const dx = targetTx - tx;
            const dy = targetTy - ty;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 0.5) {
              // Reached target, pick new one
              targetTx = Math.floor(Math.random() * map.width);
              targetTy = Math.floor(Math.random() * map.height);
              // Clamp to map bounds (roughly)
              targetTx = clamp(targetTx, 0, map.width - 1);
              targetTy = clamp(targetTy, 0, map.height - 1);
            } else {
              // Move
              const speed = 0.05; // Tiles per tick
              tx += (dx / dist) * speed;
              ty += (dy / dist) * speed;
            }
          }

          // 2. Manage Thoughts
          if (thoughtTimer && now > thoughtTimer) {
            thought = undefined;
            thoughtTimer = undefined;
          }

          // Random chance to think
          if (!thought && Math.random() < 0.005) {
            thought = AGENT_THOUGHTS[Math.floor(Math.random() * AGENT_THOUGHTS.length)];
            thoughtTimer = now + 3000; // Show for 3s
          }

          return { ...agent, tx, ty, targetTx, targetTy, thought, thoughtTimer };
      });
    }, 50); // 20 FPS updates

    return () => clearInterval(interval);
  }, [map]);


  // Build static map layer cache when scale/layers/map changes.
  useEffect(() => {
    if (!map || !dims || renderLayers.length === 0) return;
    let cancelled = false;
    let retryTimer: number | null = null;

    const buildStaticMap = () => {
      if (cancelled) return;
      const tilesets = tilesetsRef.current;
      if (!tilesets || tilesets.length === 0) {
        retryTimer = window.setTimeout(buildStaticMap, 100);
        return;
      }

      const allLoaded = tilesets.every((ts) => ts.image && ts.image.complete && ts.image.naturalWidth > 0);
      if (!allLoaded) {
        retryTimer = window.setTimeout(buildStaticMap, 100);
        return;
      }

      const staticCanvas = document.createElement('canvas');
      staticCanvas.width = dims.w * scale;
      staticCanvas.height = dims.h * scale;
      const sctx = staticCanvas.getContext('2d');
      if (!sctx) return;

      sctx.fillStyle = '#d8efb3';
      sctx.fillRect(0, 0, staticCanvas.width, staticCanvas.height);
      for (const layer of renderLayers) {
        drawTileLayer({ ctx: sctx, map, tilesets, layerData: layer.data, scale });
      }

      staticMapCanvasRef.current = staticCanvas;
    };

    buildStaticMap();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [map, dims, renderLayers, scale]);

  // Render Loop: draw cached static map + dynamic agents.
  useEffect(() => {
    if (!map || !dims || renderLayers.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = dims.w * scale;
    canvas.height = dims.h * scale;

    setRenderErr(null);

    const render = () => {
      try {
        const staticCanvas = staticMapCanvasRef.current;
        if (!staticCanvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');

        // Draw cached static map in one operation.
        ctx.drawImage(staticCanvas, 0, 0);

        // Draw Agents
        for (const a of agentsRef.current) {
          const px = a.tx * map.tilewidth * scale;
          const py = a.ty * map.tileheight * scale;
          const size = map.tilewidth * scale;

          // Shadow
          ctx.fillStyle = 'rgba(246, 255, 226, 0.78)';
          ctx.beginPath();
          ctx.ellipse(px + size / 2, py + size - 2, size / 3, size / 6, 0, 0, Math.PI * 2);
          ctx.fill();

          if (a.img && a.img.complete && a.img.naturalWidth > 0) {
            ctx.drawImage(a.img, px, py, size, size);
          } else {
            // Fallback placeholder
            ctx.fillStyle = '#f00';
            ctx.fillRect(px, py, size, size);
          }

          // Name Tag
          ctx.textAlign = 'center';
          ctx.font = `${Math.max(10, 8 * scale)}px "Space Mono", monospace`;
          const textX = px + size / 2;
          const textY = py + size + (12 * scale);

          ctx.strokeStyle = '#000';
          ctx.lineWidth = 3;
          ctx.strokeText(a.name, textX, textY);
          ctx.fillStyle = '#fff';
          ctx.fillText(a.name, textX, textY);

          // Thought Bubble
          if (a.thought) {
            ctx.font = `${Math.max(10, 10 * scale)}px "Press Start 2P", cursive`;
            const bubbleY = py - (10 * scale);
            const padding = 8 * scale;
            const metrics = ctx.measureText(a.thought);
            const bw = metrics.width + (padding * 2);
            const bh = 20 * scale;

            // Bubble Background
            ctx.fillStyle = '#fff';
            ctx.fillRect(textX - bw / 2, bubbleY - bh, bw, bh);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(textX - bw / 2, bubbleY - bh, bw, bh);

            // Text
            ctx.fillStyle = '#000';
            ctx.fillText(a.thought, textX, bubbleY - (bh / 2) + (5 * scale)); // approximate vertical center
          }
        }
      } catch (e) {
        setRenderErr(e instanceof Error ? e.message : String(e));
      }
    };

    // Use requestAnimationFrame for smoother animation
    let animationFrameId: number;
    const loop = () => {
      render();
      animationFrameId = requestAnimationFrame(loop);
    }
    loop();

    return () => cancelAnimationFrame(animationFrameId);

  }, [map, dims, renderLayers, scale]);

  // Save settings (localStorage)
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.settings, settings);
  }, [settings]);


  if (err) {
    return (
      <div style={{ padding: 16, color: '#b91c1c', fontFamily: 'ui-monospace' }}>
        Failed to load village tilemap:
        <pre style={{ whiteSpace: 'pre-wrap' }}>{err}</pre>
      </div>
    );
  }

  if (!map || !dims) {
    return <div style={{ padding: 16 }}>Loading AI Town Region...</div>;
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
        color: '#4f6f4f',
        borderBottom: '1px solid #8bb175',
        paddingBottom: '1vh',
        background: 'rgba(245, 255, 220, 0.84)',
        border: '2px solid #7ea46a',
        borderRadius: 6,
        paddingInline: 10,
        paddingTop: 8
      }}>
        <div style={{ display: 'flex', gap: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '8px', height: '8px', backgroundColor: '#4f9b55', borderRadius: '50%' }}></div>
            <span>LIVE SIMULATION</span>
          </div>



          <div className="desktop-only">//</div>
          <div className="desktop-only">VILLAGE MAP</div>
          <div className="desktop-only">//</div>
          <div className="desktop-only">AI小镇</div>
        </div>
        <div style={{ fontFamily: "'Press Start 2P', cursive", fontSize: '0.8em', color: '#4f9b55' }}>
          POPULATION: {agentCount || 'SCANNING...'}
        </div>
      </div>

      {/* CA Banner - Prominent & Above Config */}
      <div
        onClick={() => navigator.clipboard.writeText("0xe83606959340915fbf88633c69d206fbf40fffff")}
        style={{
          width: '100%',
          background: 'linear-gradient(180deg, #f8ffdb 0%, #e9f6c3 100%)',
          border: '2px solid #7ea46a',
          padding: '12px 0',
          textAlign: 'center',
          marginBottom: '20px',
          cursor: 'pointer',
          boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.12)',
          fontFamily: "'Press Start 2P', cursive",
          fontSize: 'clamp(10px, 2vw, 14px)',
          color: '#355337'
        }}
        title="CLICK TO COPY ADDRESS"
      >
        <div style={{ marginBottom: '5px', color: '#4f9b55' }}>CONTRACT ADDRESS</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.8em', wordBreak: 'break-all', padding: '0 10px' }}>0xe83606959340915fbf88633c69d206fbf40fffff</div>
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
          // setWorld(DEFAULT_WORLD_STATE); // Removed as world state is no longer used
        }}
        onClearKey={() => {
          const next = { ...settings, llm: { ...settings.llm, apiKey: '' } };
          setSettings(next);
        }}
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
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
        <span style={{ fontFamily: 'ui-monospace', fontSize: 12, opacity: 0.8 }}>
          tiles {map.width}×{map.height}
        </span>
      </div>

      {renderErr ? (
        <div style={{ marginBottom: 12, color: '#b91c1c', fontFamily: 'ui-monospace' }}>{renderErr}</div>
      ) : null}

      <div
        style={{
          border: '2px solid #7ea46a',
          borderRadius: 8,
          overflow: 'hidden',
          width: '100%',
          height: '70vh',
          background: '#d8efb3',
          padding: 0,
          position: 'relative',
          boxShadow: '0 8px 20px rgba(65, 109, 67, 0.16)'
        }}
      >
        <canvas ref={canvasRef} style={{ display: 'block' }} />

        {/* Overlay Helper Text */}
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          color: '#4f9b55',
          fontFamily: "'Space Mono', monospace",
          fontSize: '10px',
          background: 'rgba(233, 246, 201, 0.9)',
          padding: '5px',
          border: '1px solid #7ea46a'
        }}>
          AGENTS ARE AUTONOMOUS // OBSERVATION MODE ONLY
        </div>
      </div>

      {/* Footer / Community Links */}
      <div style={{
        marginTop: '4vh',
        paddingTop: '3vh',
        borderTop: '1px solid #8bb175',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1rem'
      }}>
        {/* Footer Links */}


        <div style={{ display: 'flex', gap: '2rem' }}>
          <a href="https://x.com/i/communities/2019361555687887238" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#2f4a31', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: '#4f9b55' }}>&gt;</span> TWITTER_COMMUNITY
          </a>
          <a href="https://github.com/tomzlabs/generative-agents-ts" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#2f4a31', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: '#4f9b55' }}>&gt;</span> GITHUB_REPO
          </a>
        </div>
      </div>

      <style>{`
          @media (max-width: 900px) {
              .desktop-only { display: none; }
          }
      `}</style>
    </div>
  );
}

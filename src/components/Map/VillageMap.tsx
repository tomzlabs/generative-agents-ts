import { useEffect, useMemo, useRef, useState } from 'react';
import { loadVillageTilemap } from '../../core/assets/loadTilemap';
import type { TiledMap } from '../../core/assets/tilemapSchema';
import { drawTileLayer, loadImage, resolveTilesets, type ResolvedTileset } from '../../core/assets/tileRendering';
import { SettingsPanel } from '../SettingsPanel';
import { STORAGE_KEYS } from '../../core/persistence/keys';
import { loadFromStorage, removeFromStorage, saveToStorage } from '../../core/persistence/storage';
import { DEFAULT_SETTINGS, type AppSettings } from '../../core/settings/types';
import { CHAIN_CONFIG } from '../../config/chain';

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
  const shortTokenAddress = `${CHAIN_CONFIG.tokenAddress.slice(0, 8)}...${CHAIN_CONFIG.tokenAddress.slice(-6)}`;
  const handleCopyTokenAddress = async () => {
    try {
      await navigator.clipboard.writeText(CHAIN_CONFIG.tokenAddress);
    } catch {
      window.alert('Failed to copy contract address. Please copy it manually from the panel.');
    }
  };

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

  const maxCanvasScale = useMemo(() => {
    if (!dims) return 3;
    const limitByWidth = 8192 / dims.w;
    const limitByHeight = 8192 / dims.h;
    return round1(clamp(Math.min(3, limitByWidth, limitByHeight), 0.1, 3));
  }, [dims]);

  const effectiveScale = useMemo(
    () => round1(clamp(scale, 0.1, maxCanvasScale)),
    [scale, maxCanvasScale]
  );

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

  useEffect(() => {
    if (scale === effectiveScale) return;
    setScale(effectiveScale);
    setSettings((s) => ({ ...s, ui: { ...s.ui, scale: effectiveScale } }));
  }, [scale, effectiveScale]);

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
      staticCanvas.width = dims.w * effectiveScale;
      staticCanvas.height = dims.h * effectiveScale;
      const sctx = staticCanvas.getContext('2d');
      if (!sctx) return;

      sctx.fillStyle = '#d8efb3';
      sctx.fillRect(0, 0, staticCanvas.width, staticCanvas.height);
      for (const layer of renderLayers) {
        drawTileLayer({ ctx: sctx, map, tilesets, layerData: layer.data, scale: effectiveScale });
      }

      staticMapCanvasRef.current = staticCanvas;
    };

    buildStaticMap();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [map, dims, renderLayers, effectiveScale]);

  // Render Loop: draw cached static map + dynamic agents.
  useEffect(() => {
    if (!map || !dims || renderLayers.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = dims.w * effectiveScale;
    canvas.height = dims.h * effectiveScale;

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
          const px = a.tx * map.tilewidth * effectiveScale;
          const py = a.ty * map.tileheight * effectiveScale;
          const size = map.tilewidth * effectiveScale;

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
          ctx.font = `${Math.max(10, 8 * effectiveScale)}px "Space Mono", monospace`;
          const textX = px + size / 2;
          const textY = py + size + (12 * effectiveScale);

          ctx.strokeStyle = '#000';
          ctx.lineWidth = 3;
          ctx.strokeText(a.name, textX, textY);
          ctx.fillStyle = '#fff';
          ctx.fillText(a.name, textX, textY);

          // Thought Bubble
          if (a.thought) {
            ctx.font = `${Math.max(10, 10 * effectiveScale)}px "Press Start 2P", cursive`;
            const bubbleY = py - (10 * effectiveScale);
            const padding = 8 * effectiveScale;
            const metrics = ctx.measureText(a.thought);
            const bw = metrics.width + (padding * 2);
            const bh = 20 * effectiveScale;

            // Bubble Background
            ctx.fillStyle = '#fff';
            ctx.fillRect(textX - bw / 2, bubbleY - bh, bw, bh);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(textX - bw / 2, bubbleY - bh, bw, bh);

            // Text
            ctx.fillStyle = '#000';
            ctx.fillText(a.thought, textX, bubbleY - (bh / 2) + (5 * effectiveScale)); // approximate vertical center
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

  }, [map, dims, renderLayers, effectiveScale]);

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
    <div className="village-shell">
      <div className="village-inner">
        <div className="village-header-card ga-card-surface">
          <div className="village-header-left">
            <span className="village-live-dot" />
            <span>LIVE SIMULATION</span>
            <span className="village-header-divider">/</span>
            <span>VILLAGE MAP</span>
            <span className="village-header-divider">/</span>
            <span>AI小镇</span>
          </div>
          <div className="village-population">POPULATION: {agentCount || 'SCANNING...'}</div>
        </div>

        <div className="village-kpi-grid">
          <div className="village-kpi-card ga-card-surface">
            <div className="village-kpi-label">MAP SIZE</div>
            <div className="village-kpi-value">{map.width} x {map.height}</div>
          </div>
          <div className="village-kpi-card ga-card-surface">
            <div className="village-kpi-label">RENDER LAYERS</div>
            <div className="village-kpi-value">{renderLayers.length}</div>
          </div>
          <div className="village-kpi-card ga-card-surface">
            <div className="village-kpi-label">VIEW SCALE</div>
            <div className="village-kpi-value">{effectiveScale.toFixed(1)}x</div>
          </div>
          <div className="village-kpi-card ga-card-surface">
            <div className="village-kpi-label">TOKEN</div>
            <div className="village-kpi-value">{shortTokenAddress}</div>
          </div>
        </div>

        <button
          type="button"
          className="village-contract-card ga-card-surface"
          onClick={handleCopyTokenAddress}
          title="CLICK TO COPY ADDRESS"
        >
          <div className="village-contract-label">CONTRACT ADDRESS (CLICK TO COPY)</div>
          <div className="village-contract-value">{CHAIN_CONFIG.tokenAddress}</div>
        </button>

        <div className="village-control-grid">
          <div className="village-config-card ga-card-surface">
            <SettingsPanel
              settings={settings}
              onChange={(next) => {
                setSettings(next);
                setScale(next.ui.scale);
                setLayerName(next.ui.layerMode);
              }}
              onResetWorld={() => {
                removeFromStorage(STORAGE_KEYS.world);
              }}
              onClearKey={() => {
                const next = { ...settings, llm: { ...settings.llm, apiKey: '' } };
                setSettings(next);
              }}
            />
          </div>

          <div className="village-controls-card ga-card-surface">
            <div className="village-controls-title">RENDER CONTROL</div>
            <label className="village-scale-row">
              <span>Scale</span>
              <input
                type="range"
                min={0.1}
                max={maxCanvasScale}
                step={0.1}
                value={effectiveScale}
                onChange={(e) => {
                  const v = round1(clamp(Number(e.target.value), 0.1, maxCanvasScale));
                  setScale(v);
                  setSettings((s) => ({ ...s, ui: { ...s.ui, scale: v } }));
                }}
              />
              <span>{effectiveScale.toFixed(1)}×</span>
            </label>
            <div className="village-scale-sub">
              <span>tiles {map.width}×{map.height}</span>
              {effectiveScale !== scale ? (
                <span>AUTO CAPPED TO {maxCanvasScale.toFixed(1)}× FOR STABLE RENDER</span>
              ) : null}
            </div>
            {renderErr ? (
              <div className="village-render-error">{renderErr}</div>
            ) : null}
          </div>
        </div>

        <div className="village-canvas-card ga-card-surface">
          <div className="village-canvas-wrap">
            <canvas ref={canvasRef} className="village-canvas" />
            <div className="village-overlay-note">
              AGENTS ARE AUTONOMOUS // OBSERVATION MODE ONLY
            </div>
          </div>
        </div>

        <div className="village-footer">
          <div className="village-footer-links">
            <a
              className="village-footer-link"
              href="https://x.com/i/communities/2019361555687887238"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>&gt;</span> TWITTER_COMMUNITY
            </a>
            <a
              className="village-footer-link"
              href="https://github.com/tomzlabs/generative-agents-ts"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>&gt;</span> GITHUB_REPO
            </a>
          </div>
        </div>
      </div>

      <style>{`
          .village-shell {
              min-height: 100%;
              background:
                radial-gradient(circle at 14% 12%, rgba(255,255,255,0.48), transparent 24%),
                radial-gradient(circle at 86% 8%, rgba(255,255,255,0.34), transparent 20%),
                linear-gradient(180deg, #def4c0 0%, #d5efb1 52%, #cae6a5 100%);
              box-sizing: border-box;
              width: 100%;
              overflow-x: hidden;
          }

          .village-inner {
              padding: 16px;
          }

          .village-header-card,
          .village-contract-card,
          .village-config-card,
          .village-controls-card,
          .village-canvas-card {
              border: 2px solid #7ea46a;
              border-radius: 10px;
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.45), 0 8px 18px rgba(59, 87, 50, 0.12);
          }

          .village-header-card {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 12px;
              margin-bottom: 12px;
              padding: 10px 12px;
              color: #3a5d3d;
              font-size: 11px;
              font-family: 'Press Start 2P', cursive;
              background: linear-gradient(180deg, rgba(247,255,228,0.88), rgba(236,248,204,0.88));
          }

          .village-header-left {
              display: flex;
              align-items: center;
              gap: 8px;
              min-width: 0;
              white-space: nowrap;
              overflow-x: auto;
              scrollbar-width: none;
          }

          .village-header-left::-webkit-scrollbar {
              display: none;
          }

          .village-live-dot {
              width: 8px;
              height: 8px;
              border-radius: 999px;
              background: #4f9b55;
              box-shadow: 0 0 0 2px rgba(79, 155, 85, 0.2);
          }

          .village-header-divider {
              opacity: 0.45;
          }

          .village-population {
              color: #3d8a42;
              white-space: nowrap;
          }

          .village-kpi-grid {
              display: grid;
              grid-template-columns: repeat(4, minmax(0, 1fr));
              gap: 10px;
              margin-bottom: 12px;
          }

          .village-kpi-card {
              border: 2px solid #7ea46a;
              border-radius: 8px;
              background: linear-gradient(180deg, rgba(255,255,255,0.58), rgba(237,250,204,0.88));
              padding: 10px 12px;
          }

          .village-kpi-label {
              font-family: 'Press Start 2P', cursive;
              font-size: 10px;
              color: #628062;
              letter-spacing: .08em;
              margin-bottom: 6px;
          }

          .village-kpi-value {
              font-size: 14px;
              font-weight: 700;
              color: #2f4a31;
              word-break: break-all;
          }

          .village-contract-card {
              width: 100%;
              margin-bottom: 12px;
              text-align: center;
              padding: 12px 10px;
              cursor: pointer;
              background: linear-gradient(180deg, #f9ffdf 0%, #eaf6c8 100%);
              color: #2f4a31;
              font-family: 'Press Start 2P', cursive;
          }

          .village-contract-card:hover {
              transform: translateY(-1px);
          }

          .village-contract-label {
              color: #4f9b55;
              font-size: 10px;
              margin-bottom: 6px;
          }

          .village-contract-value {
              font-family: 'Space Mono', monospace;
              font-size: 12px;
              word-break: break-all;
          }

          .village-control-grid {
              display: grid;
              grid-template-columns: minmax(0, 1fr) 320px;
              gap: 10px;
              margin-bottom: 12px;
              align-items: start;
          }

          .village-config-card {
              background: linear-gradient(180deg, rgba(246,255,221,0.88), rgba(234,248,201,0.88));
              padding: 10px;
          }

          .village-controls-card {
              background: linear-gradient(180deg, rgba(248,255,228,0.9), rgba(234,247,203,0.9));
              padding: 12px;
          }

          .village-controls-title {
              font-family: 'Press Start 2P', cursive;
              font-size: 10px;
              color: #557754;
              margin-bottom: 10px;
          }

          .village-scale-row {
              display: grid;
              grid-template-columns: auto 1fr auto;
              align-items: center;
              gap: 8px;
              font-family: 'Press Start 2P', cursive;
              font-size: 10px;
              color: #355337;
          }

          .village-scale-row input {
              width: 100%;
          }

          .village-scale-sub {
              margin-top: 10px;
              display: flex;
              flex-direction: column;
              gap: 6px;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              color: #4e6e51;
          }

          .village-render-error {
              margin-top: 10px;
              color: #b91c1c;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              word-break: break-word;
          }

          .village-canvas-card {
              background: linear-gradient(180deg, rgba(245,255,219,0.88), rgba(230,246,193,0.9));
              padding: 8px;
          }

          .village-canvas-wrap {
              position: relative;
              width: 100%;
              height: min(70vh, 880px);
              border: 2px solid #6f975f;
              border-radius: 8px;
              overflow: auto;
              background:
                repeating-linear-gradient(
                  to right,
                  rgba(255,255,255,0.03),
                  rgba(255,255,255,0.03) 1px,
                  transparent 1px,
                  transparent 6px
                ),
                linear-gradient(180deg, #d8efb3 0%, #cce7a4 100%);
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.5);
          }

          .village-canvas-wrap::before {
              content: "";
              position: absolute;
              inset: 0;
              pointer-events: none;
              background: radial-gradient(circle at 50% 45%, rgba(255,255,255,0.14), transparent 52%);
              mix-blend-mode: soft-light;
          }

          .village-canvas {
              display: block;
              image-rendering: pixelated;
          }

          .village-overlay-note {
              position: sticky;
              left: 10px;
              bottom: 10px;
              margin-top: -38px;
              width: max-content;
              max-width: calc(100% - 20px);
              color: #4f9b55;
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              background: rgba(233, 246, 201, 0.92);
              padding: 5px 7px;
              border: 1px solid #7ea46a;
              border-radius: 4px;
              pointer-events: none;
          }

          .village-footer {
              margin-top: 16px;
              padding-top: 14px;
              border-top: 1px solid #8bb175;
          }

          .village-footer-links {
              display: flex;
              gap: 12px;
              flex-wrap: wrap;
              justify-content: center;
          }

          .village-footer-link {
              text-decoration: none;
              color: #2f4a31;
              display: inline-flex;
              align-items: center;
              gap: 8px;
              border: 1px solid #7ea46a;
              background: rgba(245, 255, 220, 0.9);
              border-radius: 6px;
              padding: 8px 10px;
              transition: transform .12s ease, box-shadow .14s ease;
          }

          .village-footer-link:hover {
              transform: translateY(-1px);
              box-shadow: 0 3px 10px rgba(66, 97, 57, 0.16);
          }

          @media (max-width: 1100px) {
              .village-kpi-grid {
                  grid-template-columns: repeat(2, minmax(0, 1fr));
              }

              .village-control-grid {
                  grid-template-columns: 1fr;
              }
          }

          @media (max-width: 720px) {
              .village-inner {
                  padding: 12px;
              }

              .village-header-card {
                  flex-direction: column;
                  align-items: flex-start;
              }

              .village-population {
                  font-size: 10px;
              }

              .village-canvas-wrap {
                  height: min(62vh, 620px);
              }
          }

          @media (max-width: 560px) {
              .village-kpi-grid {
                  grid-template-columns: 1fr;
              }

              .village-contract-value {
                  font-size: 11px;
              }

              .village-overlay-note {
                  font-size: 9px;
              }
          }
      `}</style>
    </div>
  );
}

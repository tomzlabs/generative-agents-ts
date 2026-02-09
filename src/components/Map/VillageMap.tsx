import { useEffect, useMemo, useRef, useState } from 'react';
import { loadVillageTilemap } from '../../core/assets/loadTilemap';
import type { TiledMap } from '../../core/assets/tilemapSchema';
import { drawTileLayer, loadImage, resolveTilesets, type ResolvedTileset } from '../../core/assets/tileRendering';
import { SettingsPanel } from '../SettingsPanel';
import { STORAGE_KEYS } from '../../core/persistence/keys';
import { loadFromStorage, removeFromStorage, saveToStorage } from '../../core/persistence/storage';
import { DEFAULT_SETTINGS, type AppSettings } from '../../core/settings/types';
import { DEFAULT_WORLD_STATE, type PersistedWorldState } from '../../core/world/persistedTypes';
import { ethers } from 'ethers';

const CONTRACT_ADDRESS = '0x68f6c3d8a3B4e6Bdd21f589C852A998338466C5A';
const RPC_URL = 'https://bsc-dataseed.binance.org/';

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

  const [map, setMap] = useState<TiledMap | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings>(() => loadFromStorage<AppSettings>(STORAGE_KEYS.settings) ?? DEFAULT_SETTINGS);

  // We don't use persisted world state for this dynamic NFT view anymore, 
  // but keeping the type for compatibility if needed later.
  // const [world, setWorld] = useState<PersistedWorldState>(DEFAULT_WORLD_STATE);

  const [scale, setScale] = useState(settings.ui.scale);
  const [layerName, setLayerName] = useState<string | null>(settings.ui.layerMode);
  const [renderErr, setRenderErr] = useState<string | null>(null);

  // Local state for our autonomous agents
  const [agents, setAgents] = useState<AgentMarker[]>([]);

  // Fetch NFTs on mount
  useEffect(() => {
    let cancelled = false;

    const fetchNFTs = async () => {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, [
          "function MAX_SUPPLY() view returns (uint256)",
          "function ownerOf(uint256 tokenId) view returns (address)"
        ], provider);

        // 1. Get total supply (using binary search like MintPage for efficiency)
        let low = 0;
        let high = 1000;
        let lastMintedId = -1;

        // Fast check: just try to get the last known ID from our previous hardcoded list?
        // No, let's do a quick scan.
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          try {
            await contract.ownerOf(mid);
            lastMintedId = mid;
            low = mid + 1;
          } catch (e) {
            high = mid;
          }
        }

        const totalSupply = lastMintedId + 1;
        if (cancelled) return;

        // 2. Fetch last 10 agents
        const count = 10;
        const startId = Math.max(0, totalSupply - count);
        const newAgents: AgentMarker[] = [];

        for (let i = startId; i < totalSupply; i++) {
          const id = i;
          const imgUrl = `/static/assets/nft/${id}.png`;
          let img: HTMLImageElement | null = null;
          try {
            img = await loadImage(imgUrl);
          } catch (e) {
            // Fallback
            try { img = await loadImage('/static/assets/nft/0.png'); } catch { }
          }

          newAgents.push({
            id: `nft_${id}`,
            name: `Agent #${id}`,
            img,
            tx: 10 + (Math.random() * 10 - 5), // Random start pos around center
            ty: 10 + (Math.random() * 10 - 5),
            targetTx: Math.floor(10 + (Math.random() * 20 - 10)),
            targetTy: Math.floor(10 + (Math.random() * 20 - 10)),
            lastMoveTime: Date.now(),
            status: 'idle',
            thought: '',
            thoughtTimer: 0
          });
        }

        setAgents(newAgents);

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
        setAgents(demoAgents);
      }
    };

    fetchNFTs();

    return () => { cancelled = true; };
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
      setAgents(prevPoints => {
        return prevPoints.map(agent => {
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
      });
    }, 50); // 20 FPS updates

    return () => clearInterval(interval);
  }, [map]);


  // Render Loop
  useEffect(() => {
    if (!map || !dims || renderLayers.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    setRenderErr(null);

    const render = () => {
      try {
        const tilesets = tilesetsRef.current;
        if (!tilesets || tilesets.length === 0) return;

        // Check tileset loading
        const allLoaded = tilesets.every(ts => ts.image && ts.image.complete && ts.image.naturalWidth > 0);
        if (!allLoaded) {
          setTimeout(render, 100);
          return;
        }

        canvas.width = dims.w * scale;
        canvas.height = dims.h * scale;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');

        // Background
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw Map Layers
        for (const layer of renderLayers) {
          drawTileLayer({ ctx, map, tilesets, layerData: layer.data, scale });
        }

        // Draw Agents
        for (const a of agents) {
          const px = a.tx * map.tilewidth * scale;
          const py = a.ty * map.tileheight * scale;
          const size = map.tilewidth * scale;

          // Shadow
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
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

  }, [map, dims, renderLayers, scale, agents]);

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
        color: '#666',
        borderBottom: '1px solid #222',
        paddingBottom: '1vh'
      }}>
        <div style={{ display: 'flex', gap: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '8px', height: '8px', backgroundColor: '#00FF41', borderRadius: '50%', boxShadow: '0 0 8px #00FF41' }}></div>
            <span>LIVE SIMULATION</span>
          </div>
          <div className="desktop-only">//</div>
          <div className="desktop-only">VILLAGE MAP</div>
          <div className="desktop-only">//</div>
          <div className="desktop-only">AI小镇</div>
        </div>
        <div style={{ fontFamily: "'Press Start 2P', cursive", fontSize: '0.8em', color: '#00FF41' }}>
          POPULATION: {agents.length || 'SCANNING...'}
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
          border: '1px solid #00FF41',
          borderRadius: 8,
          overflow: 'hidden',
          width: '100%',
          height: '70vh',
          background: '#111827',
          padding: 0,
          position: 'relative',
          boxShadow: '0 0 20px rgba(0, 255, 65, 0.1)'
        }}
      >
        <canvas ref={canvasRef} style={{ display: 'block' }} />

        {/* Overlay Helper Text */}
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          color: '#00FF41',
          fontFamily: "'Space Mono', monospace",
          fontSize: '10px',
          background: 'rgba(0,0,0,0.7)',
          padding: '5px'
        }}>
          AGENTS ARE AUTONOMOUS // OBSERVATION MODE ONLY
        </div>
      </div>

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
        <div style={{ display: 'flex', gap: '2rem' }}>
          <a href="https://x.com/i/communities/2019361555687887238" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#E0E0E0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: '#00FF41' }}>&gt;</span> TWITTER_COMMUNITY
          </a>
          <a href="https://github.com/tomzlabs/generative-agents-ts" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#E0E0E0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: '#00FF41' }}>&gt;</span> GITHUB_REPO
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

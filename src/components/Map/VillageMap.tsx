import { useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { loadVillageTilemap } from '../../core/assets/loadTilemap';
import type { TiledMap } from '../../core/assets/tilemapSchema';
import { drawTileLayer, loadImage, resolveTilesets, type ResolvedTileset } from '../../core/assets/tileRendering';
import { SettingsPanel } from '../SettingsPanel';
import { STORAGE_KEYS } from '../../core/persistence/keys';
import { loadFromStorage, removeFromStorage, saveToStorage } from '../../core/persistence/storage';
import { DEFAULT_SETTINGS, type AppSettings } from '../../core/settings/types';
import { CHAIN_CONFIG } from '../../config/chain';
import { FARM_CONTRACT_ABI } from '../../config/farmAbi';
import { useI18n } from '../../i18n/I18nContext';
import { getReadProvider } from '../../core/chain/readProvider';
import { getCustomNftAvatar } from '../../core/nft/avatarStorage';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

type AgentMarker = {
  id: string;
  name: string;
  source: 'npc' | 'nft' | 'demo';
  tokenId?: number;
  spriteKey?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  img: HTMLImageElement | null;
  walkFrames?: HTMLImageElement[];
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
  isMoving?: boolean;
  walkOffset?: number;
  ownerAddress?: string;
};

type AgentActionLog = {
  tokenId: number;
  tx: number;
  ty: number;
  txHash: string;
  createdAt: number;
};

type MapFarmSeed = 'WHEAT' | 'CORN' | 'CARROT';

type MapFarmPlot = {
  id: number;
  crop: MapFarmSeed | null;
  plantedAt: number | null;
  matureAt: number | null;
};

type MapFarmPlantStage = 'SEED' | 'SPROUT' | 'MATURE' | 'RIPE';

type MapFarmState = {
  plots: MapFarmPlot[];
  bag: Record<MapFarmSeed, number>;
  selectedSeed: MapFarmSeed;
  exp: number;
  level: number;
  notice: string;
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

const AGENT_CHAT_PAIRS = [
  ['gm!', 'gm gm!'],
  ['How is yield?', 'APY looks healthy.'],
  ['Need more seeds.', 'Let us farm harder.'],
  ['Any alpha?', 'Stay on-chain and patient.'],
  ['Gas is stable.', 'Good time to build.'],
  ['Who won lottery?', 'Check the latest round.'],
  ['Map looks alive.', 'Agents are online.'],
  ['Ready to plant?', 'Always ready.'],
  ['XP grind today?', 'Level up incoming.'],
  ['BAP-578 synced?', 'Identity verified.'],
] as const;

const MAP_FARM_STORAGE_KEY = 'ga:map:farm-v1';
const MAP_NFT_LAYOUT_STORAGE_KEY = 'ga:map:nft-layout-v1';
const MAP_AGENT_ACTION_LOG_STORAGE_KEY = 'ga:map:agent-actions-v1';
const MAP_FARM_PLOT_COUNT = 9;
const MAP_NFT_AGENT_COUNT = 1000;
const MAP_AGENT_IMAGE_CACHE_LIMIT = 80;
const MAP_HUMAN_SPRITE_KEYS = [
  'Abigail', 'Adam', 'Arthur', 'Ayesha', 'Carlos', 'Carmen', 'Eddy', 'Francisco', 'George',
  'Hailey', 'Isabella', 'Jane', 'Jennifer', 'John', 'Klaus', 'Latoya', 'Maria', 'Mei', 'Rajiv',
  'Ryan', 'Sam', 'Tamara', 'Tom', 'Wolfgang', 'Yuriko_Yamamoto',
] as const;
const MAP_FARM_EXP_BASE = 500;
const MAP_FARM_WAD = 1_000_000_000_000_000_000n;
const MAP_FARM_TIME_MULTIPLIER_WAD = 950_000_000_000_000_000n;
const MAP_FARM_BASE_MATURE_TIME_SEC = 2 * 60 * 60;
const MAP_FARM_SEED_META: Record<MapFarmSeed, { growMs: number; exp: number; color: string }> = {
  WHEAT: { growMs: 12_000, exp: 100, color: '#f5c542' },
  CORN: { growMs: 20_000, exp: 500, color: '#f59e0b' },
  CARROT: { growMs: 28_000, exp: 1000, color: '#f97316' },
};
const MAP_FARM_TICKET_REWARD: Record<MapFarmSeed, number> = {
  WHEAT: 1,
  CORN: 5,
  CARROT: 10,
};

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function defaultAgentPosition(tokenId: number, mapWidth: number, mapHeight: number): { tx: number; ty: number } {
  const cols = Math.max(20, Math.floor(Math.sqrt(MAP_NFT_AGENT_COUNT * (mapWidth / Math.max(1, mapHeight)))));
  const rows = Math.max(10, Math.ceil(MAP_NFT_AGENT_COUNT / cols));
  const col = tokenId % cols;
  const row = Math.floor(tokenId / cols);
  const cellW = (mapWidth - 4) / cols;
  const cellH = (mapHeight - 4) / rows;
  const rand = createSeededRandom(tokenId + 1);
  const jitterX = (rand() - 0.5) * 0.45;
  const jitterY = (rand() - 0.5) * 0.45;
  return {
    tx: clamp(2 + col * cellW + cellW * 0.5 + jitterX, 1, mapWidth - 2),
    ty: clamp(2 + row * cellH + cellH * 0.5 + jitterY, 1, mapHeight - 2),
  };
}

const MAP_FARM_PIXEL_COLORS: Record<MapFarmSeed, { seedColor: string; stemColor: string; ripeColor: string }> = {
  WHEAT: {
    seedColor: '#d6d3d1',
    stemColor: '#7fb24a',
    ripeColor: '#facc15',
  },
  CORN: {
    seedColor: '#d9e36f',
    stemColor: '#84cc16',
    ripeColor: '#f59e0b',
  },
  CARROT: {
    seedColor: '#e5e7eb',
    stemColor: '#65a30d',
    ripeColor: '#f97316',
  },
};

function calcMapFarmTimeFactorWad(level: number): bigint {
  const safeLevel = Math.max(1, Math.floor(level));
  let factor = MAP_FARM_WAD;
  for (let i = 1; i < safeLevel; i++) {
    factor = (factor * MAP_FARM_TIME_MULTIPLIER_WAD) / MAP_FARM_WAD;
  }
  return factor;
}

const MAP_FARM_TOKEN_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
] as const;

type DexScreenerTokenPairsResponse = {
  pairs?: Array<{
    chainId?: string;
    priceUsd?: string;
    liquidity?: {
      usd?: number;
    };
  }>;
};

function mapSeedToSeedType(seed: MapFarmSeed): number {
  if (seed === 'WHEAT') return 1;
  if (seed === 'CORN') return 2;
  return 3;
}

function seedTypeToMapSeed(seedType: number): MapFarmSeed | null {
  if (seedType === 1) return 'WHEAT';
  if (seedType === 2) return 'CORN';
  if (seedType === 3) return 'CARROT';
  return null;
}

function pickErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'shortMessage' in error && typeof (error as { shortMessage?: unknown }).shortMessage === 'string') {
    return (error as { shortMessage: string }).shortMessage;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function isAllowanceOrDecodeError(error: unknown): boolean {
  const msg = pickErrorMessage(error).toLowerCase();
  return (
    msg.includes('could not decode result data') ||
    msg.includes('insufficient allowance') ||
    msg.includes('transfer amount exceeds allowance') ||
    (msg.includes('allowance') && msg.includes('insufficient'))
  );
}

function createDefaultMapFarmPlots(count = MAP_FARM_PLOT_COUNT): MapFarmPlot[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    crop: null,
    plantedAt: null,
    matureAt: null,
  }));
}

function loadMapFarmState(): MapFarmState {
  const loaded = loadFromStorage<MapFarmState>(MAP_FARM_STORAGE_KEY);
  if (!loaded || !Array.isArray(loaded.plots)) {
    return {
      plots: createDefaultMapFarmPlots(),
      bag: { WHEAT: 6, CORN: 4, CARROT: 2 },
      selectedSeed: 'WHEAT',
      exp: 0,
      level: 1,
      notice: '',
    };
  }

  const plotCount = Math.max(MAP_FARM_PLOT_COUNT, loaded.plots.length);
  return {
    plots: createDefaultMapFarmPlots(plotCount).map((_, idx) => {
      const source = loaded.plots[idx];
      return {
        id: idx,
        crop: source?.crop ?? null,
        plantedAt: source?.plantedAt ?? null,
        matureAt: source?.matureAt ?? null,
      };
    }),
    bag: {
      WHEAT: Math.max(0, Number(loaded.bag?.WHEAT ?? 0)),
      CORN: Math.max(0, Number(loaded.bag?.CORN ?? 0)),
      CARROT: Math.max(0, Number(loaded.bag?.CARROT ?? 0)),
    },
    selectedSeed: loaded.selectedSeed ?? 'WHEAT',
    exp: Math.max(0, Number(loaded.exp ?? 0)),
    level: Math.max(1, Number(loaded.level ?? 1)),
    notice: String(loaded.notice ?? ''),
  };
}

function loadMapNftLayout(): Record<string, { tx: number; ty: number }> {
  const loaded = loadFromStorage<Record<string, { tx: number; ty: number }>>(MAP_NFT_LAYOUT_STORAGE_KEY);
  if (!loaded || typeof loaded !== 'object') return {};
  return loaded;
}

function loadAgentActionLogs(): AgentActionLog[] {
  const loaded = loadFromStorage<AgentActionLog[]>(MAP_AGENT_ACTION_LOG_STORAGE_KEY);
  if (!Array.isArray(loaded)) return [];
  return loaded
    .filter((item) => item && Number.isFinite(item.tokenId) && Number.isFinite(item.tx) && Number.isFinite(item.ty) && typeof item.txHash === 'string')
    .slice(0, 20);
}

function formatFarmCountdown(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSec = Math.floor(safeMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatMapTokenAmount(raw: bigint, decimals: number): string {
  const full = ethers.formatUnits(raw, decimals);
  const [intPart, fracPart = ''] = full.split('.');
  const trimmedFrac = fracPart.slice(0, 4).replace(/0+$/, '');
  return trimmedFrac ? `${intPart}.${trimmedFrac}` : intPart;
}

function resolveMapFarmPlantStage(plot: MapFarmPlot, nowMs: number): MapFarmPlantStage | null {
  if (!plot.crop) return null;
  if (!plot.plantedAt || !plot.matureAt) return 'SEED';
  if (nowMs >= plot.matureAt) return 'RIPE';
  const total = Math.max(1, plot.matureAt - plot.plantedAt);
  const ratio = (nowMs - plot.plantedAt) / total;
  if (ratio >= 0.66) return 'MATURE';
  if (ratio >= 0.33) return 'SPROUT';
  return 'SEED';
}

function MapPixelPlant(props: { stage: MapFarmPlantStage; crop: MapFarmSeed }) {
  const { stage, crop } = props;
  const conf = MAP_FARM_PIXEL_COLORS[crop];

  if (stage === 'SEED') {
    return (
      <span
        aria-hidden
        style={{
          width: 3,
          height: 3,
          background: conf.seedColor,
          boxShadow: `3px 0 ${conf.seedColor}, 1.5px 3px ${conf.seedColor}`,
          imageRendering: 'pixelated',
        }}
      />
    );
  }

  if (stage === 'SPROUT') {
    return (
      <span
        aria-hidden
        style={{
          width: 3,
          height: 3,
          background: conf.stemColor,
          boxShadow: `0 -3px ${conf.stemColor}, -3px -6px ${conf.stemColor}, 3px -6px ${conf.stemColor}`,
          imageRendering: 'pixelated',
        }}
      />
    );
  }

  if (stage === 'MATURE') {
    return (
      <span
        aria-hidden
        style={{
          width: 3,
          height: 3,
          background: conf.stemColor,
          boxShadow: `0 -3px ${conf.stemColor}, 0 -6px ${conf.stemColor}, -3px -9px ${conf.stemColor}, 3px -9px ${conf.stemColor}, -6px -12px ${conf.stemColor}, 0 -12px ${conf.stemColor}, 6px -12px ${conf.stemColor}`,
          imageRendering: 'pixelated',
        }}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{
        width: 4,
        height: 4,
        background: conf.ripeColor,
        boxShadow: `4px 0 ${conf.ripeColor}, 2px -4px ${conf.ripeColor}, 2px 4px ${conf.ripeColor}, -2px -4px ${conf.ripeColor}, -2px 4px ${conf.ripeColor}, 0 -8px ${conf.stemColor}`,
        imageRendering: 'pixelated',
      }}
    />
  );
}

type VillageMapProps = {
  mode?: 'default' | 'test';
  account?: string | null;
  ownedTokens?: number[];
};

export function VillageMap(props: VillageMapProps = {}) {
  const { mode = 'default', account = null, ownedTokens = [] } = props;
  const isTestMap = mode === 'test';
  const isTestChainMode = isTestMap && Boolean(account);
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const tilesetsRef = useRef<ResolvedTileset[] | null>(null);
  const staticMapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const agentsRef = useRef<AgentMarker[]>([]);
  const nftImageCacheRef = useRef<Map<number, HTMLImageElement | null>>(new Map());
  const nftImageLoadingRef = useRef<Set<number>>(new Set());
  const humanSpriteCacheRef = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const humanSpriteLoadingRef = useRef<Set<string>>(new Set());
  const mapDragRef = useRef<{ active: boolean; pointerId: number | null; startX: number; startY: number; startLeft: number; startTop: number }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
  });

  const [map, setMap] = useState<TiledMap | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings>(() => loadFromStorage<AppSettings>(STORAGE_KEYS.settings) ?? DEFAULT_SETTINGS);
  const [scale, setScale] = useState(() => (isTestMap ? 2.6 : settings.ui.scale));
  const [layerName, setLayerName] = useState<string | null>(() => (isTestMap ? '__VISIBLE__' : settings.ui.layerMode));
  const [renderErr, setRenderErr] = useState<string | null>(null);
  const [agentCount, setAgentCount] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [placeMode, setPlaceMode] = useState(false);
  const [placementTokenId, setPlacementTokenId] = useState<number | null>(null);
  const [agentPanelNotice, setAgentPanelNotice] = useState('');
  const [agentActionLogs, setAgentActionLogs] = useState<AgentActionLog[]>(() => loadAgentActionLogs());
  const [agentActionPending, setAgentActionPending] = useState(false);

  // UI-only state; actual moving positions live in refs to avoid 20FPS re-render.
  const [farmNowMs, setFarmNowMs] = useState(() => Date.now());
  const [mapFarm, setMapFarm] = useState<MapFarmState>(() => loadMapFarmState());
  const [mapFarmLandIds, setMapFarmLandIds] = useState<number[]>([]);
  const [mapFarmTxPending, setMapFarmTxPending] = useState(false);
  const [mapFarmSyncing, setMapFarmSyncing] = useState(false);
  const [mapFarmSyncErr, setMapFarmSyncErr] = useState<string | null>(null);
  const [mapFarmExpThresholdBase, setMapFarmExpThresholdBase] = useState(MAP_FARM_EXP_BASE);
  const [mapFarmCurrentRound, setMapFarmCurrentRound] = useState<number | null>(null);
  const [mapFarmCurrentRoundTickets, setMapFarmCurrentRoundTickets] = useState<number | null>(null);
  const [mapFarmLandPriceRaw, setMapFarmLandPriceRaw] = useState<bigint | null>(null);
  const [mapFarmSeedPriceRaw, setMapFarmSeedPriceRaw] = useState<Record<MapFarmSeed, bigint>>({
    WHEAT: 0n,
    CORN: 0n,
    CARROT: 0n,
  });
  const [mapFarmPrizePoolRaw, setMapFarmPrizePoolRaw] = useState<bigint | null>(null);
  const [mapFarmWalletTokenRaw, setMapFarmWalletTokenRaw] = useState<bigint | null>(null);
  const [mapFarmLandBuyCount, setMapFarmLandBuyCount] = useState(1);
  const [mapFarmSeedBuyCount, setMapFarmSeedBuyCount] = useState<Record<MapFarmSeed, number>>({
    WHEAT: 1,
    CORN: 1,
    CARROT: 1,
  });
  const [mapFarmGuideOpen, setMapFarmGuideOpen] = useState(false);
  const [mapFarmTokenDecimals, setMapFarmTokenDecimals] = useState(18);
  const [mapFarmTokenSymbol, setMapFarmTokenSymbol] = useState(t('代币', 'Token'));
  const [mapFarmTokenUsdPrice, setMapFarmTokenUsdPrice] = useState<number | null>(null);
  const mapFarmTokenPriceCacheRef = useRef<{ tokenAddress: string; priceUsd: number | null; updatedAt: number }>({
    tokenAddress: '',
    priceUsd: null,
    updatedAt: 0,
  });
  const handleCopyTokenAddress = async () => {
    try {
      await navigator.clipboard.writeText(CHAIN_CONFIG.tokenAddress);
    } catch {
      window.alert('Failed to copy contract address. Please copy it manually from the panel.');
    }
  };

  const effectiveExpBase = isTestChainMode ? Math.max(1, mapFarmExpThresholdBase) : MAP_FARM_EXP_BASE;
  const expToNextLevel = mapFarm.level * effectiveExpBase;
  const canLevelUp = mapFarm.exp >= expToNextLevel;
  const levelProgress = Math.min(100, Math.round((mapFarm.exp / expToNextLevel) * 100));
  const visibleLandCount = isTestChainMode ? mapFarmLandIds.length : mapFarm.plots.length;
  const mapFarmRoundText = mapFarmCurrentRound === null ? '--' : String(mapFarmCurrentRound);
  const mapFarmRoundTicketText = mapFarmCurrentRoundTickets === null ? '--' : String(mapFarmCurrentRoundTickets);
  const safeMapFarmLandBuyCount = Math.max(1, Math.floor(mapFarmLandBuyCount || 1));
  const mapFarmLandTotalPriceRaw = mapFarmLandPriceRaw === null ? null : mapFarmLandPriceRaw * BigInt(safeMapFarmLandBuyCount);
  const mapFarmLandPriceText =
    mapFarmLandPriceRaw === null
      ? '--'
      : `${formatMapTokenAmount(mapFarmLandPriceRaw, mapFarmTokenDecimals)} ${mapFarmTokenSymbol}`;
  const mapFarmSeedPriceText = (seed: MapFarmSeed) => `${formatMapTokenAmount(mapFarmSeedPriceRaw[seed] ?? 0n, mapFarmTokenDecimals)} ${mapFarmTokenSymbol}`;
  const mapFarmLandTotalPriceText =
    mapFarmLandTotalPriceRaw === null
      ? '--'
      : `${formatMapTokenAmount(mapFarmLandTotalPriceRaw, mapFarmTokenDecimals)} ${mapFarmTokenSymbol}`;
  const mapFarmPrizePoolText =
    mapFarmPrizePoolRaw === null
      ? '--'
      : `${formatMapTokenAmount(mapFarmPrizePoolRaw, mapFarmTokenDecimals)} ${mapFarmTokenSymbol}`;
  const mapFarmPrizePoolUsdText = (() => {
    if (mapFarmPrizePoolRaw === null || mapFarmTokenUsdPrice === null) return '--';
    const poolTokenAmount = Number(ethers.formatUnits(mapFarmPrizePoolRaw, mapFarmTokenDecimals));
    if (!Number.isFinite(poolTokenAmount) || poolTokenAmount < 0) return '--';
    const usd = poolTokenAmount * mapFarmTokenUsdPrice;
    if (!Number.isFinite(usd) || usd < 0) return '--';
    const fixed = usd >= 1 ? usd.toFixed(2) : usd.toFixed(4);
    return `${fixed} U`;
  })();
  const mapFarmWalletTokenText = account
    ? (mapFarmWalletTokenRaw === null
      ? '--'
      : `${formatMapTokenAmount(mapFarmWalletTokenRaw, mapFarmTokenDecimals)} ${mapFarmTokenSymbol}`)
    : t('未连接钱包', 'Wallet not connected');
  const mapFarmSeedTotalPriceText = (seed: MapFarmSeed) => {
    const count = Math.max(1, Math.floor(mapFarmSeedBuyCount[seed] || 1));
    const totalRaw = (mapFarmSeedPriceRaw[seed] ?? 0n) * BigInt(count);
    return `${formatMapTokenAmount(totalRaw, mapFarmTokenDecimals)} ${mapFarmTokenSymbol}`;
  };
  const mapSeedLabel = (seed: MapFarmSeed): string => {
    if (seed === 'WHEAT') return t('小麦', 'Wheat');
    if (seed === 'CORN') return t('玉米', 'Corn');
    return t('胡萝卜', 'Carrot');
  };
  const mapStageLabel = (stage: MapFarmPlantStage): string => {
    if (stage === 'SEED') return t('种子', 'Seed');
    if (stage === 'SPROUT') return t('发芽', 'Sprout');
    if (stage === 'MATURE') return t('成熟', 'Mature');
    return t('可收获', 'Harvestable');
  };
  const nftAgentCount = agentsRef.current.reduce((count, agent) => (agent.source === 'nft' ? count + 1 : count), 0);

  const setFarmNotice = (notice: string) => {
    setMapFarm((prev) => ({ ...prev, notice }));
  };

  const normalizeBuyCountInput = (value: string): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(1, Math.min(999, Math.floor(parsed)));
  };

  const selectedAgent = selectedAgentId
    ? agentsRef.current.find((agent) => agent.id === selectedAgentId) ?? null
    : null;

  const persistNftAgentLayout = (agents: AgentMarker[]) => {
    const payload: Record<string, { tx: number; ty: number }> = {};
    for (const agent of agents) {
      if (agent.source !== 'nft' || agent.tokenId === undefined) continue;
      payload[String(agent.tokenId)] = {
        tx: round1(agent.tx),
        ty: round1(agent.ty),
      };
    }
    saveToStorage(MAP_NFT_LAYOUT_STORAGE_KEY, payload);
  };

  const placeOwnedTokenOnMap = (tokenId: number, tx: number, ty: number) => {
    if (!map) return false;
    const safeTx = clamp(tx, 1, map.width - 2);
    const safeTy = clamp(ty, 1, map.height - 2);
    let updated = false;
    agentsRef.current = agentsRef.current.map((agent) => {
      if (agent.source !== 'nft' || agent.tokenId !== tokenId) return agent;
      updated = true;
      return {
        ...agent,
        tx: safeTx,
        ty: safeTy,
        targetTx: safeTx,
        targetTy: safeTy,
        thought: t('已部署到地图', 'Placed on map'),
        thoughtTimer: Date.now() + 1800,
      };
    });
    if (!updated) return false;
    persistNftAgentLayout(agentsRef.current);
    setSelectedAgentId(`nft_${tokenId}`);
    setAgentPanelNotice(t('已放置到地图，位置已保存。', 'Placed on map and saved.'));
    return true;
  };

  const pushAgentActionLog = (entry: AgentActionLog) => {
    setAgentActionLogs((prev) => {
      const next = [entry, ...prev].slice(0, 20);
      saveToStorage(MAP_AGENT_ACTION_LOG_STORAGE_KEY, next);
      return next;
    });
  };

  const handleVerifySelectedAgent = async () => {
    if (!selectedAgent || selectedAgent.tokenId === undefined) {
      setAgentPanelNotice(t('请先选中一个 NFT Agent。', 'Select an NFT agent first.'));
      return;
    }
    try {
      const provider = getReadProvider();
      const nfa = new ethers.Contract(CHAIN_CONFIG.nfaAddress, ['function ownerOf(uint256 tokenId) view returns (address)'], provider);
      const owner = String(await nfa.ownerOf(selectedAgent.tokenId));
      agentsRef.current = agentsRef.current.map((agent) => (
        agent.tokenId === selectedAgent.tokenId ? { ...agent, ownerAddress: owner } : agent
      ));
      setSelectedAgentId(`nft_${selectedAgent.tokenId}`);
      setAgentPanelNotice(
        `${t('身份已验证，持有人', 'Identity verified, owner')}: ${owner.slice(0, 8)}...${owner.slice(-6)}`,
      );
    } catch (error) {
      setAgentPanelNotice(`${t('身份验证失败', 'Identity verification failed')}: ${pickErrorMessage(error)}`);
    }
  };

  const handleExecuteSelectedAction = async () => {
    if (!selectedAgent || selectedAgent.tokenId === undefined) {
      setAgentPanelNotice(t('请先选中一个 NFT Agent。', 'Select an NFT agent first.'));
      return;
    }
    if (!account) {
      setAgentPanelNotice(t('请先连接钱包。', 'Connect wallet first.'));
      return;
    }
    if (agentActionPending) return;
    try {
      setAgentActionPending(true);
      setAgentPanelNotice(t('正在提交 executeAction...', 'Submitting executeAction...'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(window as any).ethereum) throw new Error('Wallet not detected');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const signerAddr = (await signer.getAddress()).toLowerCase();
      if (!ownedTokens.includes(selectedAgent.tokenId) && (selectedAgent.ownerAddress?.toLowerCase() !== signerAddr)) {
        throw new Error(t('当前钱包不是该 Agent 的持有人。', 'Current wallet does not own this agent.'));
      }

      const payload = {
        protocol: 'BAP-578',
        action: 'MAP_PLACE',
        tokenId: selectedAgent.tokenId,
        map: 'village',
        position: {
          tx: round1(selectedAgent.tx),
          ty: round1(selectedAgent.ty),
        },
        timestamp: Date.now(),
      };
      const data = ethers.toUtf8Bytes(JSON.stringify(payload));
      const nfa = new ethers.Contract(
        CHAIN_CONFIG.nfaAddress,
        ['function executeAction(uint256 tokenId, bytes data) external'],
        signer,
      );
      const tx = await nfa.executeAction(selectedAgent.tokenId, data);
      await tx.wait();
      pushAgentActionLog({
        tokenId: selectedAgent.tokenId,
        tx: round1(selectedAgent.tx),
        ty: round1(selectedAgent.ty),
        txHash: tx.hash,
        createdAt: Date.now(),
      });
      setAgentPanelNotice(t('行为已上链，可审计凭证已生成。', 'Action committed on-chain with auditable proof.'));
    } catch (error) {
      const msg = pickErrorMessage(error);
      if (msg.toLowerCase().includes('executeaction')) {
        setAgentPanelNotice(t('当前 NFA 合约未开放 executeAction。', 'Current NFA contract does not expose executeAction.'));
      } else {
        setAgentPanelNotice(`${t('上链失败', 'On-chain action failed')}: ${msg}`);
      }
    } finally {
      setAgentActionPending(false);
    }
  };

  const syncMapPrizePool = async () => {
    try {
      const provider = getReadProvider();
      const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_CONTRACT_ABI, provider);
      const farmTokenAddress = String((await farm.ERC20_TOKEN().catch(() => CHAIN_CONFIG.tokenAddress)) ?? CHAIN_CONFIG.tokenAddress);
      const token = new ethers.Contract(farmTokenAddress, MAP_FARM_TOKEN_ABI, provider);

      const [decimalsRaw, symbolRaw] = await Promise.all([
        token.decimals().catch(() => 18),
        token.symbol().catch(() => t('代币', 'Token')),
      ]);
      setMapFarmTokenDecimals(Math.max(0, Number(decimalsRaw ?? 18)));
      setMapFarmTokenSymbol(String(symbolRaw ?? t('代币', 'Token')));

      const normalizedTokenAddress = farmTokenAddress.toLowerCase();
      const now = Date.now();
      const cache = mapFarmTokenPriceCacheRef.current;
      if (cache.tokenAddress === normalizedTokenAddress && now - cache.updatedAt < 60_000) {
        setMapFarmTokenUsdPrice(cache.priceUsd);
      } else {
        let priceUsd: number | null = null;
        try {
          const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${farmTokenAddress}`);
          if (res.ok) {
            const json = (await res.json()) as DexScreenerTokenPairsResponse;
            const pairs = Array.isArray(json.pairs) ? json.pairs : [];
            const sorted = pairs
              .filter((pair) => pair && typeof pair.priceUsd === 'string' && pair.chainId === 'bsc')
              .sort((a, b) => (Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0)));
            const picked = sorted[0] ?? null;
            const next = picked ? Number(picked.priceUsd) : NaN;
            if (Number.isFinite(next) && next > 0) {
              priceUsd = next;
            }
          }
        } catch {
          // ignore price fetch failure
        }
        mapFarmTokenPriceCacheRef.current = {
          tokenAddress: normalizedTokenAddress,
          priceUsd,
          updatedAt: now,
        };
        setMapFarmTokenUsdPrice(priceUsd);
      }

      try {
        const poolRaw = BigInt(await farm.getContractTokenBalance(farmTokenAddress));
        setMapFarmPrizePoolRaw(poolRaw);
      } catch {
        const poolRaw = BigInt(await token.balanceOf(CHAIN_CONFIG.farmAddress));
        setMapFarmPrizePoolRaw(poolRaw);
      }

      if (account) {
        try {
          const walletRaw = BigInt(await token.balanceOf(account));
          setMapFarmWalletTokenRaw(walletRaw);
        } catch {
          setMapFarmWalletTokenRaw(null);
        }
      } else {
        setMapFarmWalletTokenRaw(null);
      }
    } catch {
      // keep previous value on read failures
    }
  };

  const syncMapFarmFromChain = async () => {
    if (!isTestChainMode || !account) return;

    setMapFarmSyncing(true);
    setMapFarmSyncErr(null);
    try {
      const provider = getReadProvider();
      const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_CONTRACT_ABI, provider);
      const [
        userInfoRaw,
        landIdsRaw,
        expThresholdRaw,
        currentRoundRaw,
        landPriceRaw,
        wheatSeedPriceRaw,
        cornSeedPriceRaw,
        carrotSeedPriceRaw,
        farmTokenAddress,
      ] = await Promise.all([
        farm.getUserInfo(account),
        farm.getUserAllLandIds(account),
        farm.expThresholdBase().catch(() => BigInt(MAP_FARM_EXP_BASE)),
        farm.currentLotteryRound().catch(() => 0n),
        farm.landPrice().catch(() => null),
        farm.seedPrice(0).catch(() => 0n),
        farm.seedPrice(1).catch(() => 0n),
        farm.seedPrice(2).catch(() => 0n),
        farm.ERC20_TOKEN().catch(() => CHAIN_CONFIG.tokenAddress),
      ]);
      const currentRound = Math.max(0, Number(currentRoundRaw ?? 0n));
      let currentRoundTickets: number | null = null;
      if (currentRound > 0) {
        try {
          const ticketRaw = await farm.getUserLotteryCount(account, currentRound);
          currentRoundTickets = Math.max(0, Number(ticketRaw ?? 0n));
        } catch {
          currentRoundTickets = null;
        }
      }

      const landIds: number[] = (Array.isArray(landIdsRaw) ? landIdsRaw : [])
        .map((landId) => Number(landId))
        .filter((landId) => Number.isFinite(landId) && landId >= 0);
      const userLevel = Math.max(1, Number(userInfoRaw?.[0] ?? 1));
      const userTimeFactor = calcMapFarmTimeFactorWad(userLevel);

      const slotLandIds = landIds;
      const nextPlots = createDefaultMapFarmPlots(slotLandIds.length);

      await Promise.all(
        slotLandIds.map(async (landId, idx) => {
          if (landId === null || landId === undefined) return;
          try {
            const planted = await farm.getUserPlantedSeed(account, landId);
            const seedType = Number(planted?.seedType ?? planted?.[0] ?? 0);
            const plantTime = BigInt(planted?.plantTime ?? planted?.[1] ?? 0n);
            const baseDuration = BigInt(planted?.baseDuration ?? planted?.[2] ?? 0n);
            const isMatured = Boolean(planted?.isMatured ?? planted?.[3] ?? false);
            const isHarvested = Boolean(planted?.isHarvested ?? planted?.[4] ?? false);
            const crop = seedTypeToMapSeed(seedType);
            if (!crop || isHarvested || plantTime <= 0n) return;
            const safeBaseDuration = baseDuration > 0n ? baseDuration : BigInt(MAP_FARM_BASE_MATURE_TIME_SEC);
            const actualDuration = (safeBaseDuration * userTimeFactor) / MAP_FARM_WAD;
            const matureAtSec = plantTime + actualDuration;
            nextPlots[idx] = {
              id: idx,
              crop,
              plantedAt: Number(plantTime) * 1000,
              matureAt: isMatured ? Date.now() : Number(matureAtSec) * 1000,
            };
          } catch {
            // ignore a single slot read failure
          }
        }),
      );

      const readSeedBagByType = async (fnName: string): Promise<Record<MapFarmSeed, number>> => {
        const c = new ethers.Contract(
          CHAIN_CONFIG.farmAddress,
          [`function ${fnName}(address,uint8) view returns (uint256)`],
          provider,
        );
        const [w, c1, c2] = await Promise.all([
          c[fnName](account, 1),
          c[fnName](account, 2),
          c[fnName](account, 3),
        ]);
        return {
          WHEAT: Math.max(0, Number(w ?? 0n)),
          CORN: Math.max(0, Number(c1 ?? 0n)),
          CARROT: Math.max(0, Number(c2 ?? 0n)),
        };
      };

      const seedGetterCandidates = [
        'getUserSeedCount',
        'getUserSeedBalance',
        'userSeedCount',
        'userSeedBalance',
        'seedBalanceOf',
      ];
      let chainBag: Record<MapFarmSeed, number> | null = null;
      for (const fnName of seedGetterCandidates) {
        try {
          chainBag = await readSeedBagByType(fnName);
          break;
        } catch {
          // continue probing
        }
      }

      let tokenDecimals = 18;
      let tokenSymbol = t('代币', 'Token');
      let farmTokenAddressNormalized = String(farmTokenAddress ?? CHAIN_CONFIG.tokenAddress);
      let walletTokenRaw: bigint | null = null;
      try {
        const token = new ethers.Contract(farmTokenAddressNormalized, MAP_FARM_TOKEN_ABI, provider);
        const [decimalsRaw, symbolRaw, walletRawMaybe] = await Promise.all([
          token.decimals().catch(() => 18),
          token.symbol().catch(() => tokenSymbol),
          token.balanceOf(account).catch(() => null),
        ]);
        tokenDecimals = Math.max(0, Number(decimalsRaw ?? 18));
        tokenSymbol = String(symbolRaw ?? tokenSymbol);
        walletTokenRaw = walletRawMaybe === null ? null : BigInt(walletRawMaybe);
      } catch {
        tokenDecimals = 18;
      }

      let prizePoolRaw: bigint | null = null;
      try {
        prizePoolRaw = BigInt(await farm.getContractTokenBalance(farmTokenAddressNormalized));
      } catch {
        try {
          const token = new ethers.Contract(farmTokenAddressNormalized, MAP_FARM_TOKEN_ABI, provider);
          prizePoolRaw = BigInt(await token.balanceOf(CHAIN_CONFIG.farmAddress));
        } catch {
          prizePoolRaw = null;
        }
      }

      setMapFarmLandIds(slotLandIds);
      setMapFarmExpThresholdBase(Math.max(1, Number(expThresholdRaw ?? MAP_FARM_EXP_BASE)));
      setMapFarmCurrentRound(currentRound > 0 ? currentRound : null);
      setMapFarmCurrentRoundTickets(currentRoundTickets);
      setMapFarmLandPriceRaw(landPriceRaw === null ? null : BigInt(landPriceRaw));
      setMapFarmSeedPriceRaw({
        WHEAT: BigInt(wheatSeedPriceRaw ?? 0n),
        CORN: BigInt(cornSeedPriceRaw ?? 0n),
        CARROT: BigInt(carrotSeedPriceRaw ?? 0n),
      });
      setMapFarmPrizePoolRaw(prizePoolRaw);
      setMapFarmWalletTokenRaw(walletTokenRaw);
      setMapFarmTokenDecimals(tokenDecimals);
      setMapFarmTokenSymbol(tokenSymbol);
      setMapFarm((prev) => ({
        ...prev,
        plots: nextPlots,
        level: userLevel,
        exp: Math.max(0, Number(userInfoRaw?.[1] ?? 0)),
        bag: chainBag ?? prev.bag,
      }));
    } catch (error) {
      setMapFarmSyncErr(pickErrorMessage(error));
    } finally {
      setMapFarmSyncing(false);
    }
  };

  const handleMapFarmLevelUp = () => {
    if (!canLevelUp) {
      setFarmNotice(t('经验不足，暂时无法升级。', 'Insufficient EXP, cannot level up yet.'));
      return;
    }
    if (!isTestChainMode || !account) {
      setMapFarm((prev) => ({
        ...prev,
        exp: prev.exp - prev.level * MAP_FARM_EXP_BASE,
        level: prev.level + 1,
        notice: t('升级成功，作物成长更快了。', 'Level up complete. Crop growth is now faster.'),
      }));
      return;
    }

    if (mapFarmTxPending) return;
    setMapFarmTxPending(true);
    setFarmNotice(t('升级交易提交中...', 'Submitting level-up transaction...'));
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!(window as any).ethereum) throw new Error('Wallet not detected');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_CONTRACT_ABI, signer);
        const runLevelUp = async () => {
          const tx = await farm.levelUp();
          await tx.wait();
        };
        try {
          await runLevelUp();
        } catch (error) {
          if (!isAllowanceOrDecodeError(error)) throw error;
          setFarmNotice(t('检测到授权异常，正在重新授权后重试...', 'Authorization issue detected, re-approving and retrying...'));
          await ensureMapFarmTokenAllowance(signer, farm, 1n, true);
          await runLevelUp();
        }
        setFarmNotice(t('升级成功，已同步链上状态。', 'Level-up successful, synced on-chain state.'));
        await syncMapFarmFromChain();
      } catch (error) {
        setFarmNotice(`${t('升级失败', 'Level-up failed')}: ${pickErrorMessage(error)}`);
      } finally {
        setMapFarmTxPending(false);
      }
    })();
  };

  const ensureMapFarmTokenAllowance = async (
    signer: ethers.Signer,
    farm: ethers.Contract,
    requiredAmount: bigint,
    forceApprove = false,
  ) => {
    if (requiredAmount <= 0n && !forceApprove) return;
    const owner = await signer.getAddress();
    const tokenAddress = String((await farm.ERC20_TOKEN().catch(() => CHAIN_CONFIG.tokenAddress)) ?? CHAIN_CONFIG.tokenAddress);
    const token = new ethers.Contract(tokenAddress, MAP_FARM_TOKEN_ABI, signer);
    if (!forceApprove) {
      const allowance = BigInt(await token.allowance(owner, CHAIN_CONFIG.farmAddress));
      if (allowance >= requiredAmount) return;
    }
    const approveTx = await token.approve(CHAIN_CONFIG.farmAddress, ethers.MaxUint256);
    await approveTx.wait();
  };

  const handleMapFarmPurchaseLand = async (countInput?: number) => {
    const count = Math.max(1, Math.floor(countInput ?? mapFarmLandBuyCount ?? 1));
    setMapFarmLandBuyCount(count);
    if (!isTestChainMode || !account) {
      setMapFarm((prev) => ({
        ...prev,
        plots: [
          ...prev.plots,
          ...Array.from({ length: count }, (_, i) => ({
            id: prev.plots.length + i,
            crop: null as MapFarmSeed | null,
            plantedAt: null,
            matureAt: null,
          })),
        ],
        notice: t('本地模式已新增土地。', 'Added land plots in local mode.'),
      }));
      return;
    }
    if (mapFarmTxPending) return;
    try {
      setMapFarmTxPending(true);
      setFarmNotice(t('土地购买交易提交中...', 'Submitting land purchase transaction...'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(window as any).ethereum) throw new Error('Wallet not detected');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_CONTRACT_ABI, signer);
      const unitPrice = mapFarmLandPriceRaw ?? BigInt(await farm.landPrice());
      const runPurchaseLand = async () => {
        const tx = await farm.purchaseLand(count);
        await tx.wait();
      };
      try {
        await ensureMapFarmTokenAllowance(signer, farm, unitPrice * BigInt(count));
        await runPurchaseLand();
      } catch (error) {
        if (!isAllowanceOrDecodeError(error)) throw error;
        setFarmNotice(t('检测到授权异常，正在重新授权后重试...', 'Authorization issue detected, re-approving and retrying...'));
        await ensureMapFarmTokenAllowance(signer, farm, 1n, true);
        await runPurchaseLand();
      }
      setFarmNotice(t('土地购买成功，已同步最新地块。', 'Land purchased, syncing latest plots.'));
      await syncMapFarmFromChain();
    } catch (error) {
      setFarmNotice(`${t('购买土地失败', 'Land purchase failed')}: ${pickErrorMessage(error)}`);
    } finally {
      setMapFarmTxPending(false);
    }
  };

  const handleMapFarmPurchaseSeed = async (seed: MapFarmSeed, countInput?: number) => {
    const count = Math.max(1, Math.floor(countInput ?? mapFarmSeedBuyCount[seed] ?? 1));
    setMapFarmSeedBuyCount((prev) => ({ ...prev, [seed]: count }));
    if (!isTestChainMode || !account) {
      setMapFarm((prev) => ({
        ...prev,
        bag: { ...prev.bag, [seed]: (prev.bag[seed] ?? 0) + count },
        notice: t('本地模式已添加种子库存。', 'Seed stock added in local mode.'),
      }));
      return;
    }
    if (mapFarmTxPending) return;
    try {
      setMapFarmTxPending(true);
      setFarmNotice(t('种子购买交易提交中...', 'Submitting seed purchase transaction...'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(window as any).ethereum) throw new Error('Wallet not detected');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_CONTRACT_ABI, signer);
      const unitPrice = mapFarmSeedPriceRaw[seed] ?? 0n;
      const runPurchaseSeed = async () => {
        const tx = await farm.purchaseSeed(mapSeedToSeedType(seed), count);
        await tx.wait();
      };
      try {
        await ensureMapFarmTokenAllowance(signer, farm, unitPrice * BigInt(count));
        await runPurchaseSeed();
      } catch (error) {
        if (!isAllowanceOrDecodeError(error)) throw error;
        setFarmNotice(t('检测到授权异常，正在重新授权后重试...', 'Authorization issue detected, re-approving and retrying...'));
        await ensureMapFarmTokenAllowance(signer, farm, 1n, true);
        await runPurchaseSeed();
      }
      setFarmNotice(t('种子购买成功，已同步链上库存。', 'Seed purchased, synced on-chain inventory.'));
      await syncMapFarmFromChain();
    } catch (error) {
      setFarmNotice(`${t('购买种子失败', 'Seed purchase failed')}: ${pickErrorMessage(error)}`);
    } finally {
      setMapFarmTxPending(false);
    }
  };

  const handleMapFarmPlotClick = async (plotId: number) => {
    const now = Date.now();
    if (isTestChainMode && mapFarmTxPending) return;

    if (isTestChainMode && account) {
      const landId = mapFarmLandIds[plotId];
      if (landId === undefined) {
        setFarmNotice(t('该地块没有链上土地。', 'This slot has no on-chain land.'));
        return;
      }

      const plot = mapFarm.plots[plotId];
      if (!plot) return;

      if (!plot.crop) {
        if ((mapFarm.bag[mapFarm.selectedSeed] ?? 0) <= 0) {
          setFarmNotice(t('该种子库存不足，请先购买或切换种子。', 'Selected seed is out of stock. Buy more or switch seed.'));
          return;
        }

        try {
          setMapFarmTxPending(true);
          setFarmNotice(t('种植交易提交中...', 'Submitting planting transaction...'));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (!(window as any).ethereum) throw new Error('Wallet not detected');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const provider = new ethers.BrowserProvider((window as any).ethereum);
          const signer = await provider.getSigner();
          const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_CONTRACT_ABI, signer);
          const tx = await farm.plantSeed(landId, mapSeedToSeedType(mapFarm.selectedSeed));
          await tx.wait();
          setFarmNotice(t('种植成功，正在同步链上状态。', 'Plant success, syncing on-chain state.'));
          await syncMapFarmFromChain();
        } catch (error) {
          setFarmNotice(`${t('种植失败', 'Plant failed')}: ${pickErrorMessage(error)}`);
        } finally {
          setMapFarmTxPending(false);
        }
        return;
      }

      const remaining = (plot.matureAt ?? 0) - now;
      if (remaining > 0) {
        setFarmNotice(`${t('作物尚未成熟，剩余', 'Crop not mature yet, remaining')} ${formatFarmCountdown(remaining)}`);
        return;
      }

      try {
        setMapFarmTxPending(true);
        setFarmNotice(t('收获交易提交中...', 'Submitting harvest transaction...'));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!(window as any).ethereum) throw new Error('Wallet not detected');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_CONTRACT_ABI, signer);
        const tx = await farm.harvestSeed(landId);
        await tx.wait();
        setFarmNotice(t('收获成功，正在同步链上状态。', 'Harvest success, syncing on-chain state.'));
        await syncMapFarmFromChain();
      } catch (error) {
        setFarmNotice(`${t('收获失败', 'Harvest failed')}: ${pickErrorMessage(error)}`);
      } finally {
        setMapFarmTxPending(false);
      }
      return;
    }

    setMapFarm((prev) => {
      const plot = prev.plots[plotId];
      if (!plot) return prev;

      if (!plot.crop) {
        if ((prev.bag[prev.selectedSeed] ?? 0) <= 0) {
          return {
            ...prev,
            notice: t('该种子库存不足，请先收获或切换种子。', 'Selected seed is out of stock. Harvest or switch seed.'),
          };
        }
        const growBase = MAP_FARM_SEED_META[prev.selectedSeed].growMs;
        const speedFactor = Math.pow(0.95, Math.max(0, prev.level - 1));
        const growMs = Math.max(4_000, Math.floor(growBase * speedFactor));
        const nextPlots = prev.plots.slice();
        nextPlots[plotId] = {
          id: plotId,
          crop: prev.selectedSeed,
          plantedAt: now,
          matureAt: now + growMs,
        };
        return {
          ...prev,
          plots: nextPlots,
          bag: { ...prev.bag, [prev.selectedSeed]: prev.bag[prev.selectedSeed] - 1 },
          exp: prev.exp + MAP_FARM_SEED_META[prev.selectedSeed].exp,
          notice: t('已种植，等待成熟后可收获。', 'Planted. Wait until mature to harvest.'),
        };
      }

      const remaining = (plot.matureAt ?? 0) - now;
      if (remaining > 0) {
        return {
          ...prev,
          notice: `${t('作物尚未成熟，剩余', 'Crop not mature yet, remaining')} ${formatFarmCountdown(remaining)}`,
        };
      }

      const nextPlots = prev.plots.slice();
      nextPlots[plotId] = { id: plotId, crop: null, plantedAt: null, matureAt: null };
      return {
        ...prev,
        plots: nextPlots,
        bag: {
          ...prev.bag,
          [plot.crop]: prev.bag[plot.crop] + 1,
        },
        notice: t('收获成功，种子已返还到库存。', 'Harvest complete, seed returned to inventory.'),
      };
    });
  };

  // Build map agents (1000 NFT agents + special NPCs)
  useEffect(() => {
    const loadAgents = async () => {
      try {
        const [czFramesRaw, heyiFramesRaw] = await Promise.all([
          Promise.all(
            Array.from({ length: 4 }, (_, i) => loadImage(`/static/assets/npc/cz_walk_${i}.png`).catch(() => null)),
          ),
          Promise.all(
            Array.from({ length: 4 }, (_, i) => loadImage(`/static/assets/npc/heyi_walk_${i}.png`).catch(() => null)),
          ),
        ]);
        const czFrames = czFramesRaw.filter((img): img is HTMLImageElement => Boolean(img));
        const heyiFrames = heyiFramesRaw.filter((img): img is HTMLImageElement => Boolean(img));
        const czImg = czFrames[0] ?? null;
        const heyiImg = heyiFrames[0] ?? null;

        const mw = map?.width ?? 140;
        const mh = map?.height ?? 100;
        const savedLayout = loadMapNftLayout();
        const nftAgents: AgentMarker[] = Array.from({ length: MAP_NFT_AGENT_COUNT }, (_, tokenId) => {
          const saved = savedLayout[String(tokenId)];
          const fallback = defaultAgentPosition(tokenId, mw, mh);
          const spriteKey = MAP_HUMAN_SPRITE_KEYS[tokenId % MAP_HUMAN_SPRITE_KEYS.length];
          return {
            id: `nft_${tokenId}`,
            name: `#${tokenId}`,
            source: 'nft',
            tokenId,
            spriteKey,
            direction: 'down',
            img: null,
            tx: clamp(saved?.tx ?? fallback.tx, 1, mw - 2),
            ty: clamp(saved?.ty ?? fallback.ty, 1, mh - 2),
            targetTx: undefined,
            targetTy: undefined,
            lastMoveTime: Date.now(),
            status: 'idle',
          };
        });

        const specialNPCs: AgentMarker[] = [
          {
            id: 'npc_cz',
            name: 'CZ',
            source: 'npc',
            img: czImg,
            direction: 'down',
            tx: isTestMap ? 6 : 18,
            ty: isTestMap ? 6 : 18,
            targetTx: isTestMap ? 9 : 21,
            targetTy: isTestMap ? 8 : 20,
            lastMoveTime: Date.now(),
            status: 'building',
            thought: 'Funds are SAI...',
            thoughtTimer: Date.now() + 1000000,
            walkFrames: czFrames,
            walkOffset: 0,
          },
          {
            id: 'npc_heyi',
            name: 'Yi He',
            source: 'npc',
            img: heyiImg,
            direction: 'down',
            tx: isTestMap ? 8 : 22,
            ty: isTestMap ? 9 : 22,
            targetTx: isTestMap ? 11 : 24,
            targetTy: isTestMap ? 7 : 19,
            lastMoveTime: Date.now(),
            status: 'building',
            thought: 'Building ecosystem...',
            thoughtTimer: Date.now() + 1000000,
            walkFrames: heyiFrames,
            walkOffset: 2,
          },
        ];

        agentsRef.current = isTestMap ? specialNPCs : [...specialNPCs, ...nftAgents];
        setAgentCount(agentsRef.current.length);
      } catch (e) {
        console.error('Failed to initialize map agents', e);
        const demoAgents: AgentMarker[] = Array.from({ length: 5 }).map((_, i) => ({
          id: `demo_${i}`,
          name: `Ghost #${i}`,
          source: 'demo',
          img: null,
          direction: 'down',
          tx: 10 + (Math.random() * 10 - 5),
          ty: 10 + (Math.random() * 10 - 5),
          targetTx: Math.floor(10 + (Math.random() * 20 - 10)),
          targetTy: Math.floor(10 + (Math.random() * 20 - 10)),
          lastMoveTime: Date.now(),
          status: 'idle',
          thought: 'Connection lost...',
          thoughtTimer: Date.now() + 10000,
          walkOffset: i % 4,
        }));
        agentsRef.current = demoAgents;
        setAgentCount(demoAgents.length);
      }
    };

    void loadAgents();
  }, [isTestMap, map?.width, map?.height]);

  useEffect(() => {
    if (ownedTokens.length === 0) {
      setPlacementTokenId(null);
      setPlaceMode(false);
      return;
    }
    setPlacementTokenId((prev) => (prev !== null && ownedTokens.includes(prev) ? prev : ownedTokens[0]));
  }, [ownedTokens]);

  useEffect(() => {
    const onAvatarUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ tokenId?: number }>).detail;
      const tokenId = detail?.tokenId;
      if (typeof tokenId === 'number' && Number.isFinite(tokenId)) {
        nftImageCacheRef.current.delete(tokenId);
      } else {
        nftImageCacheRef.current.clear();
      }
    };
    window.addEventListener('ga:nft-avatar-updated', onAvatarUpdated as EventListener);
    return () => window.removeEventListener('ga:nft-avatar-updated', onAvatarUpdated as EventListener);
  }, []);

  useEffect(() => {
    if (isTestMap) return;
    for (const key of MAP_HUMAN_SPRITE_KEYS) {
      if (humanSpriteCacheRef.current.has(key) || humanSpriteLoadingRef.current.has(key)) continue;
      humanSpriteLoadingRef.current.add(key);
      void loadImage(`/static/assets/village/agents/${key}/texture.png`)
        .then((img) => {
          humanSpriteCacheRef.current.set(key, img);
        })
        .catch(() => {
          humanSpriteCacheRef.current.set(key, null);
        })
        .finally(() => {
          humanSpriteLoadingRef.current.delete(key);
        });
    }
  }, [isTestMap]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const m = await loadVillageTilemap();
        if (cancelled) return;

        setMap(m);
        setLayerName(isTestMap ? '__VISIBLE__' : (settings.ui.layerMode || '__VISIBLE__'));
        tilesetsRef.current = await resolveTilesets(m);

      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { cancelled = true; };
  }, [isTestMap, settings.ui.layerMode]);

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

  const minCanvasScale = isTestMap ? 1.2 : 0.1;
  const effectiveScale = useMemo(
    () => round1(clamp(scale, minCanvasScale, maxCanvasScale)),
    [scale, minCanvasScale, maxCanvasScale]
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
    if (!isTestMap) {
      setSettings((s) => ({ ...s, ui: { ...s.ui, scale: effectiveScale } }));
    }
  }, [scale, effectiveScale, isTestMap]);

  useEffect(() => {
    if (isTestMap) return;
    saveToStorage(STORAGE_KEYS.settings, settings);
  }, [isTestMap, settings]);

  // Autonomous Behavior Loop
  useEffect(() => {
    if (!map) return;
    const pickNextTarget = (agent: AgentMarker, minTx: number, maxTx: number, minTy: number, maxTy: number) => {
      if (isTestMap && (agent.id === 'npc_cz' || agent.id === 'npc_heyi')) {
        return {
          targetTx: Math.floor(minTx + (Math.random() * Math.max(1, (maxTx - minTx + 1)))),
          targetTy: Math.floor(minTy + (Math.random() * Math.max(1, (maxTy - minTy + 1)))),
        };
      }
      return {
        targetTx: clamp(Math.floor(Math.random() * map.width), 1, map.width - 2),
        targetTy: clamp(Math.floor(Math.random() * map.height), 1, map.height - 2),
      };
    };

    const interval = setInterval(() => {
      agentsRef.current = agentsRef.current.map(agent => {
          const now = Date.now();
          const shouldSimulateMovement = !isTestMap || agent.source !== 'nft' || agent.id === selectedAgentId;
          if (!shouldSimulateMovement) {
            if (agent.thought && agent.thoughtTimer && now > agent.thoughtTimer) {
              return { ...agent, thought: undefined, thoughtTimer: undefined, isMoving: false };
            }
            return agent;
          }
          let { tx, ty, targetTx, targetTy, thought, thoughtTimer } = agent;
          let direction = agent.direction ?? 'down';
          const isTopLeftNpc = isTestMap && (agent.id === 'npc_cz' || agent.id === 'npc_heyi');
          const wrapEl = canvasWrapRef.current;
          const tilePxW = map.tilewidth * effectiveScale;
          const tilePxH = map.tileheight * effectiveScale;
          let minTx = 1;
          let maxTx = Math.min(map.width - 1, 14);
          let minTy = 1;
          let maxTy = Math.min(map.height - 1, 14);
          if (wrapEl && tilePxW > 0 && tilePxH > 0) {
            const left = Math.floor(wrapEl.scrollLeft / tilePxW);
            const right = Math.ceil((wrapEl.scrollLeft + wrapEl.clientWidth) / tilePxW) - 1;
            const top = Math.floor(wrapEl.scrollTop / tilePxH);
            const bottom = Math.ceil((wrapEl.scrollTop + wrapEl.clientHeight) / tilePxH) - 1;
            minTx = clamp(left, 0, map.width - 1);
            maxTx = clamp(right, 0, map.width - 1);
            minTy = clamp(top, 0, map.height - 1);
            maxTy = clamp(bottom, 0, map.height - 1);
          }

          if (targetTx === undefined || targetTy === undefined) {
            const nextTarget = pickNextTarget(agent, minTx, maxTx, minTy, maxTy);
            targetTx = nextTarget.targetTx;
            targetTy = nextTarget.targetTy;
          }

          // 1. Move towards target
          if (targetTx !== undefined && targetTy !== undefined) {
            const dx = targetTx - tx;
            const dy = targetTy - ty;
            const dist = Math.sqrt(dx * dx + dy * dy);
            let movingNow = false;

            if (dist < 0.5) {
              // Reached target, pick new one
              const nextTarget = pickNextTarget(agent, minTx, maxTx, minTy, maxTy);
              targetTx = nextTarget.targetTx;
              targetTy = nextTarget.targetTy;
              movingNow = false;
            } else {
              // Move
              const speed = agent.source === 'nft' ? 0.018 : 0.05; // Tiles per tick
              tx += (dx / dist) * speed;
              ty += (dy / dist) * speed;
              if (Math.abs(dx) >= Math.abs(dy)) {
                direction = dx >= 0 ? 'right' : 'left';
              } else {
                direction = dy >= 0 ? 'down' : 'up';
              }
              if (isTopLeftNpc) {
                tx = clamp(tx, minTx, maxTx);
                ty = clamp(ty, minTy, maxTy);
              }
              movingNow = true;
            }

            agent.isMoving = movingNow;
          } else {
            agent.isMoving = false;
          }

          // 2. Manage Thoughts
          if (thoughtTimer && now > thoughtTimer) {
            thought = undefined;
            thoughtTimer = undefined;
          }

          // Random chance to think
          if (!thought && agent.source !== 'nft' && Math.random() < 0.004) {
            thought = AGENT_THOUGHTS[Math.floor(Math.random() * AGENT_THOUGHTS.length)];
            thoughtTimer = now + 3000; // Show for 3s
          }

          return { ...agent, tx, ty, targetTx, targetTy, thought, thoughtTimer, direction };
      });
    }, 50); // 20 FPS updates

    return () => clearInterval(interval);
  }, [map, effectiveScale, isTestMap, selectedAgentId]);

  useEffect(() => {
    if (!map || isTestMap) return;
    const canvas = canvasRef.current;
    const wrap = canvasWrapRef.current;
    if (!canvas || !wrap) return;

    const toTilePos = (event: MouseEvent | PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left + wrap.scrollLeft;
      const py = event.clientY - rect.top + wrap.scrollTop;
      const tx = px / (map.tilewidth * effectiveScale);
      const ty = py / (map.tileheight * effectiveScale);
      return { tx, ty };
    };

    const pickClosestAgent = (tx: number, ty: number): AgentMarker | null => {
      let picked: AgentMarker | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const agent of agentsRef.current) {
        const dx = agent.tx - tx;
        const dy = agent.ty - ty;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          picked = agent;
        }
      }
      if (!picked || bestDist > 1.3) return null;
      return picked;
    };

    const onCanvasClick = (event: MouseEvent) => {
      const { tx, ty } = toTilePos(event);
      if (placeMode && placementTokenId !== null) {
        if (!ownedTokens.includes(placementTokenId)) {
          setAgentPanelNotice(t('只能放置你钱包拥有的 NFT。', 'Only NFTs owned by your wallet can be placed.'));
          return;
        }
        const placed = placeOwnedTokenOnMap(placementTokenId, tx, ty);
        if (placed) {
          setPlaceMode(false);
        } else {
          setAgentPanelNotice(t('未找到该 NFT Agent。', 'NFT agent not found.'));
        }
        return;
      }
      const picked = pickClosestAgent(tx, ty);
      if (!picked) {
        setSelectedAgentId(null);
        return;
      }
      setSelectedAgentId(picked.id);
      if (picked.tokenId !== undefined) {
        setAgentPanelNotice(`${t('已选中 Agent', 'Selected agent')} #${picked.tokenId}`);
      } else {
        setAgentPanelNotice(`${t('已选中角色', 'Selected role')} ${picked.name}`);
      }
    };

    const onCanvasMove = (event: PointerEvent) => {
      const { tx, ty } = toTilePos(event);
      const picked = pickClosestAgent(tx, ty);
      const next = picked?.id ?? null;
      setHoveredAgentId((prev) => (prev === next ? prev : next));
    };

    const onCanvasLeave = () => setHoveredAgentId(null);

    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('pointermove', onCanvasMove);
    canvas.addEventListener('pointerleave', onCanvasLeave);
    return () => {
      canvas.removeEventListener('click', onCanvasClick);
      canvas.removeEventListener('pointermove', onCanvasMove);
      canvas.removeEventListener('pointerleave', onCanvasLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestMap, map, effectiveScale, placeMode, placementTokenId, ownedTokens.join(',')]);

  // Nearby agent chat loop (for lively map interactions)
  useEffect(() => {
    if (!map || isTestMap) return;
    const interval = window.setInterval(() => {
      const wrap = canvasWrapRef.current;
      if (!wrap) return;
      const now = Date.now();
      const tilePxW = map.tilewidth * effectiveScale;
      const tilePxH = map.tileheight * effectiveScale;
      if (tilePxW <= 0 || tilePxH <= 0) return;
      const marginTiles = 4;
      const left = wrap.scrollLeft / tilePxW - marginTiles;
      const right = (wrap.scrollLeft + wrap.clientWidth) / tilePxW + marginTiles;
      const top = wrap.scrollTop / tilePxH - marginTiles;
      const bottom = (wrap.scrollTop + wrap.clientHeight) / tilePxH + marginTiles;

      const visible = agentsRef.current.filter((agent) => (
        agent.tx >= left
        && agent.tx <= right
        && agent.ty >= top
        && agent.ty <= bottom
      ));
      if (visible.length < 2) return;

      const bucketSize = 6;
      const buckets = new Map<string, AgentMarker[]>();
      for (const agent of visible) {
        const bx = Math.floor(agent.tx / bucketSize);
        const by = Math.floor(agent.ty / bucketSize);
        const key = `${bx},${by}`;
        const group = buckets.get(key);
        if (group) {
          group.push(agent);
        } else {
          buckets.set(key, [agent]);
        }
      }

      const spoken = new Set<string>();
      const maxChats = 6;
      let chatCount = 0;
      const nextAgents = agentsRef.current.slice();
      const indexById = new Map(nextAgents.map((agent, idx) => [agent.id, idx]));

      const tryPair = (a: AgentMarker, b: AgentMarker) => {
        if (chatCount >= maxChats) return;
        if (a.id === b.id) return;
        if (spoken.has(a.id) || spoken.has(b.id)) return;
        if ((a.thoughtTimer && a.thoughtTimer > now + 900) || (b.thoughtTimer && b.thoughtTimer > now + 900)) return;
        const dx = a.tx - b.tx;
        const dy = a.ty - b.ty;
        if ((dx * dx + dy * dy) > 10) return;
        if (Math.random() > 0.11) return;
        const pair = AGENT_CHAT_PAIRS[Math.floor(Math.random() * AGENT_CHAT_PAIRS.length)];
        const aIdx = indexById.get(a.id);
        const bIdx = indexById.get(b.id);
        if (aIdx === undefined || bIdx === undefined) return;
        nextAgents[aIdx] = {
          ...nextAgents[aIdx],
          thought: pair[0],
          thoughtTimer: now + 2400 + Math.floor(Math.random() * 800),
        };
        nextAgents[bIdx] = {
          ...nextAgents[bIdx],
          thought: pair[1],
          thoughtTimer: now + 2400 + Math.floor(Math.random() * 800),
        };
        spoken.add(a.id);
        spoken.add(b.id);
        chatCount += 1;
      };

      for (const [key, group] of buckets.entries()) {
        if (chatCount >= maxChats) break;
        const [bxStr, byStr] = key.split(',');
        const bx = Number(bxStr);
        const by = Number(byStr);
        const nearby = [
          ...group,
          ...(buckets.get(`${bx + 1},${by}`) ?? []),
          ...(buckets.get(`${bx},${by + 1}`) ?? []),
          ...(buckets.get(`${bx + 1},${by + 1}`) ?? []),
        ];
        if (nearby.length < 2) continue;
        for (let i = 0; i < nearby.length && chatCount < maxChats; i++) {
          const a = nearby[i];
          const b = nearby[(i + 1 + Math.floor(Math.random() * Math.max(1, nearby.length - 1))) % nearby.length];
          tryPair(a, b);
        }
      }

      if (chatCount > 0) {
        agentsRef.current = nextAgents;
      }
    }, 1300);
    return () => window.clearInterval(interval);
  }, [map, effectiveScale, isTestMap]);


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

        const wrap = canvasWrapRef.current;
        const tilePxW = map.tilewidth * effectiveScale;
        const tilePxH = map.tileheight * effectiveScale;
        const marginTiles = 2.5;
        const viewLeft = wrap ? wrap.scrollLeft / tilePxW - marginTiles : -Infinity;
        const viewTop = wrap ? wrap.scrollTop / tilePxH - marginTiles : -Infinity;
        const viewRight = wrap ? (wrap.scrollLeft + wrap.clientWidth) / tilePxW + marginTiles : Infinity;
        const viewBottom = wrap ? (wrap.scrollTop + wrap.clientHeight) / tilePxH + marginTiles : Infinity;

        const requestNftImage = (tokenId: number) => {
          if (nftImageCacheRef.current.has(tokenId) || nftImageLoadingRef.current.has(tokenId)) return;
          nftImageLoadingRef.current.add(tokenId);
          const customAvatarSrc = getCustomNftAvatar(tokenId);
          if (!customAvatarSrc) {
            nftImageCacheRef.current.set(tokenId, null);
            nftImageLoadingRef.current.delete(tokenId);
            return;
          }
          void loadImage(customAvatarSrc)
            .then((img) => {
              nftImageCacheRef.current.set(tokenId, img);
            })
            .catch(() => {
              nftImageCacheRef.current.set(tokenId, null);
            })
            .finally(() => {
              nftImageLoadingRef.current.delete(tokenId);
              if (nftImageCacheRef.current.size > MAP_AGENT_IMAGE_CACHE_LIMIT) {
                const keys = Array.from(nftImageCacheRef.current.keys());
                for (const k of keys) {
                  if (k === placementTokenId) continue;
                  if (selectedAgentId === `nft_${k}`) continue;
                  nftImageCacheRef.current.delete(k);
                  if (nftImageCacheRef.current.size <= MAP_AGENT_IMAGE_CACHE_LIMIT) break;
                }
              }
            });
        };

        const requestHumanSprite = (spriteKey: string) => {
          if (humanSpriteCacheRef.current.has(spriteKey) || humanSpriteLoadingRef.current.has(spriteKey)) return;
          humanSpriteLoadingRef.current.add(spriteKey);
          void loadImage(`/static/assets/village/agents/${spriteKey}/texture.png`)
            .then((img) => {
              humanSpriteCacheRef.current.set(spriteKey, img);
            })
            .catch(() => {
              humanSpriteCacheRef.current.set(spriteKey, null);
            })
            .finally(() => {
              humanSpriteLoadingRef.current.delete(spriteKey);
            });
        };

        for (const a of agentsRef.current) {
          if (a.tx < viewLeft || a.tx > viewRight || a.ty < viewTop || a.ty > viewBottom) continue;
          const px = a.tx * tilePxW;
          const py = a.ty * tilePxH;
          const size = a.source === 'nft' ? tilePxW * 0.88 : tilePxW;
          const offsetX = (tilePxW - size) / 2;
          const isSelected = selectedAgentId === a.id;
          const isHovered = hoveredAgentId === a.id;

          ctx.fillStyle = 'rgba(246, 255, 226, 0.6)';
          ctx.beginPath();
          ctx.ellipse(px + tilePxW / 2, py + tilePxH - 2, tilePxW / 3, tilePxH / 7, 0, 0, Math.PI * 2);
          ctx.fill();

          let sprite: HTMLImageElement | null = null;
          let usedHumanSprite = false;
          if (a.source === 'nft' && a.tokenId !== undefined) {
            const cached = nftImageCacheRef.current.get(a.tokenId);
            if (cached === undefined) {
              requestNftImage(a.tokenId);
            } else {
              sprite = cached;
            }
            if (!sprite) {
              const spriteKey = a.spriteKey ?? MAP_HUMAN_SPRITE_KEYS[a.tokenId % MAP_HUMAN_SPRITE_KEYS.length];
              const spriteSheet = humanSpriteCacheRef.current.get(spriteKey);
              if (spriteSheet === undefined) {
                requestHumanSprite(spriteKey);
              } else if (spriteSheet) {
                sprite = spriteSheet;
                usedHumanSprite = true;
              }
            }
          } else {
            sprite =
              a.isMoving && a.walkFrames && a.walkFrames.length > 0
                ? a.walkFrames[(Math.floor(Date.now() / 180) + (a.walkOffset ?? 0)) % a.walkFrames.length]
                : a.img;
          }

          if (sprite && sprite.complete && sprite.naturalWidth > 0) {
            if (usedHumanSprite) {
              const direction = a.direction ?? 'down';
              const rowMap: Record<'down' | 'left' | 'right' | 'up', number> = { down: 0, left: 1, right: 2, up: 3 };
              const frameCycle = [0, 32, 64, 32];
              const standX = 32;
              const movingFrame = frameCycle[(Math.floor(Date.now() / 170) + (a.walkOffset ?? 0)) % frameCycle.length];
              const sx = a.isMoving ? movingFrame : standX;
              const sy = rowMap[direction] * 32;
              const spriteScale = tilePxW * 0.96;
              const spriteOffsetX = (tilePxW - spriteScale) / 2;
              const spriteOffsetY = tilePxH * 0.02;
              ctx.drawImage(sprite, sx, sy, 32, 32, px + spriteOffsetX, py + spriteOffsetY, spriteScale, spriteScale);
            } else {
              ctx.drawImage(sprite, px + offsetX, py + (a.source === 'nft' ? tilePxH * 0.08 : 0), size, size);
            }
          } else {
            if (a.source === 'nft' && a.tokenId !== undefined) {
              const r = (a.tokenId * 37) % 255;
              const g = (a.tokenId * 73) % 255;
              const b = (a.tokenId * 131) % 255;
              ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
              ctx.fillRect(px + offsetX + size * 0.1, py + tilePxH * 0.2, size * 0.8, size * 0.62);
              ctx.fillStyle = '#173225';
              ctx.font = `${Math.max(8, 7 * effectiveScale)}px "Press Start 2P", cursive`;
              ctx.textAlign = 'center';
              ctx.fillText(String(a.tokenId), px + tilePxW / 2, py + tilePxH * 0.7);
            } else {
              ctx.fillStyle = '#b21f1f';
              ctx.fillRect(px + offsetX, py, size, size);
            }
          }

          if (isSelected || isHovered) {
            ctx.strokeStyle = isSelected ? '#ffd25b' : '#9ddf67';
            ctx.lineWidth = Math.max(1.5, 2 * effectiveScale);
            ctx.strokeRect(px + offsetX, py + (a.source === 'nft' ? tilePxH * 0.08 : 0), size, size);
          }

          const shouldShowName = a.source !== 'nft' || isSelected || isHovered;
          if (shouldShowName) {
            ctx.textAlign = 'center';
            ctx.font = `${Math.max(10, 8 * effectiveScale)}px "Space Mono", monospace`;
            const textX = px + tilePxW / 2;
            const textY = py + tilePxH + (12 * effectiveScale);

            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.strokeText(a.name, textX, textY);
            ctx.fillStyle = '#fff';
            ctx.fillText(a.name, textX, textY);
          }

          if (a.thought) {
            ctx.font = `${Math.max(10, 10 * effectiveScale)}px "Press Start 2P", cursive`;
            const bubbleY = py - (10 * effectiveScale);
            const padding = 8 * effectiveScale;
            const metrics = ctx.measureText(a.thought);
            const bw = metrics.width + (padding * 2);
            const bh = 20 * effectiveScale;

            ctx.fillStyle = '#fff';
            ctx.fillRect(px + tilePxW / 2 - bw / 2, bubbleY - bh, bw, bh);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + tilePxW / 2 - bw / 2, bubbleY - bh, bw, bh);
            ctx.fillStyle = '#000';
            ctx.fillText(a.thought, px + tilePxW / 2, bubbleY - (bh / 2) + (5 * effectiveScale));
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

  }, [map, dims, renderLayers, effectiveScale, selectedAgentId, hoveredAgentId, placementTokenId]);

  useEffect(() => {
    if (!isTestMap) return;
    const timer = window.setInterval(() => {
      setFarmNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isTestMap]);

  useEffect(() => {
    if (!isTestMap || isTestChainMode) return;
    saveToStorage(MAP_FARM_STORAGE_KEY, mapFarm);
  }, [isTestMap, isTestChainMode, mapFarm]);

  useEffect(() => {
    if (isTestMap) return;
    const wrap = canvasWrapRef.current;
    if (!wrap) return;

    const isInteractiveTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return Boolean(target.closest('button, input, select, textarea, label, a, [role="dialog"]'));
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (placeMode) return;
      if (isInteractiveTarget(event.target)) return;
      mapDragRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: wrap.scrollLeft,
        startTop: wrap.scrollTop,
      };
      wrap.classList.add('is-dragging');
      try {
        wrap.setPointerCapture(event.pointerId);
      } catch {
        // Ignore unsupported capture edge cases.
      }
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!mapDragRef.current.active) return;
      if (mapDragRef.current.pointerId !== null && event.pointerId !== mapDragRef.current.pointerId) return;
      const dx = event.clientX - mapDragRef.current.startX;
      const dy = event.clientY - mapDragRef.current.startY;
      wrap.scrollLeft = mapDragRef.current.startLeft - dx;
      wrap.scrollTop = mapDragRef.current.startTop - dy;
      event.preventDefault();
    };

    const stopDrag = (event?: PointerEvent) => {
      if (!mapDragRef.current.active) return;
      if (event && mapDragRef.current.pointerId !== null && event.pointerId !== mapDragRef.current.pointerId) return;
      const pointerId = mapDragRef.current.pointerId;
      mapDragRef.current.active = false;
      mapDragRef.current.pointerId = null;
      wrap.classList.remove('is-dragging');
      if (pointerId !== null) {
        try {
          wrap.releasePointerCapture(pointerId);
        } catch {
          // Ignore capture release errors.
        }
      }
    };

    const onWindowBlur = () => {
      stopDrag();
    };

    wrap.addEventListener('pointerdown', onPointerDown);
    wrap.addEventListener('pointermove', onPointerMove);
    wrap.addEventListener('pointerup', stopDrag);
    wrap.addEventListener('pointercancel', stopDrag);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      wrap.removeEventListener('pointerdown', onPointerDown);
      wrap.removeEventListener('pointermove', onPointerMove);
      wrap.removeEventListener('pointerup', stopDrag);
      wrap.removeEventListener('pointercancel', stopDrag);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [isTestMap, placeMode]);

  useEffect(() => {
    if (!isTestMap) return;
    void syncMapPrizePool();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestMap, account]);

  useEffect(() => {
    if (!isTestMap) return;
    if (!isTestChainMode || !account) {
      setMapFarmLandIds([]);
      setMapFarmSyncErr(null);
      setMapFarmSyncing(false);
      setMapFarmExpThresholdBase(MAP_FARM_EXP_BASE);
      setMapFarmCurrentRound(null);
      setMapFarmCurrentRoundTickets(null);
      setMapFarmLandPriceRaw(null);
      setMapFarmSeedPriceRaw({ WHEAT: 0n, CORN: 0n, CARROT: 0n });
      setMapFarmWalletTokenRaw(null);
      setMapFarmTokenDecimals(18);
      setMapFarmTokenSymbol(t('代币', 'Token'));
      void syncMapPrizePool();
      return;
    }
    void syncMapFarmFromChain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestMap, isTestChainMode, account]);


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
        {!isTestMap ? (
          <div className="village-header-card ga-card-surface">
            <div className="village-header-left">
              <span className="village-live-dot" />
              <span>LIVE SIMULATION</span>
              <span className="village-header-divider">/</span>
              <span>VILLAGE MAP</span>
              <span className="village-header-divider">/</span>
              <span>{t('AI小镇', 'AI Town')}</span>
            </div>
            <div className="village-population">POPULATION: {agentCount || 'SCANNING...'}</div>
          </div>
        ) : null}

        {!isTestMap ? (
          <button
            type="button"
            className="village-contract-card ga-card-surface"
            onClick={handleCopyTokenAddress}
            title="CLICK TO COPY ADDRESS"
          >
            <div className="village-contract-label">CONTRACT ADDRESS (CLICK TO COPY)</div>
            <div className="village-contract-value">{CHAIN_CONFIG.tokenAddress}</div>
          </button>
        ) : null}

        {!isTestMap ? (
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
        ) : null}

        {!isTestMap ? (
          <div className="village-agent-control-card ga-card-surface">
            <div className="village-agent-control-title">AGENT OPS / BAP-578</div>
            <div className="village-agent-control-grid">
              <div className="village-agent-stat-row">
                <span>{t('地图 Agent', 'Map Agents')}</span>
                <strong>{agentCount}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('NFT Agent', 'NFT Agents')}</span>
                <strong>{nftAgentCount}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('我的 NFT', 'Owned NFTs')}</span>
                <strong>{ownedTokens.length}</strong>
              </div>

              <label className="village-agent-picker">
                <span>{t('选择放置 NFT', 'Placement NFT')}</span>
                <select
                  value={placementTokenId ?? ''}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      setPlacementTokenId(v);
                      setSelectedAgentId(`nft_${v}`);
                    }
                  }}
                >
                  {ownedTokens.length === 0 ? <option value="">{t('无可用 NFT', 'No NFT')}</option> : null}
                  {ownedTokens.map((tokenId) => (
                    <option key={`placement-token-${tokenId}`} value={tokenId}>{`#${tokenId}`}</option>
                  ))}
                </select>
              </label>

              <div className="village-agent-action-row">
                <button
                  type="button"
                  className={`village-agent-btn ${placeMode ? 'active' : ''}`}
                  onClick={() => {
                    if (ownedTokens.length === 0) {
                      setAgentPanelNotice(t('当前钱包没有可放置 NFT。', 'No NFT available in current wallet.'));
                      return;
                    }
                    const next = !placeMode;
                    setPlaceMode(next);
                    setAgentPanelNotice(next ? t('放置模式已开启：点击地图放置。', 'Place mode enabled: click map to place.') : t('放置模式已关闭。', 'Place mode disabled.'));
                  }}
                >
                  {placeMode ? t('取消放置', 'Cancel Place') : t('放置到地图', 'Place On Map')}
                </button>
                <button type="button" className="village-agent-btn" onClick={() => void handleVerifySelectedAgent()}>
                  {t('验证身份', 'Verify Identity')}
                </button>
                <button type="button" className="village-agent-btn" disabled={agentActionPending} onClick={() => void handleExecuteSelectedAction()}>
                  {agentActionPending ? t('提交中', 'Pending') : 'executeAction'}
                </button>
              </div>

              <div className="village-agent-selected">
                <div className="village-agent-selected-title">{t('当前选中', 'Selected')}</div>
                {selectedAgent ? (
                  <>
                    <div>{selectedAgent.tokenId !== undefined ? `#${selectedAgent.tokenId}` : selectedAgent.name}</div>
                    <div>{t('位置', 'Position')}: ({round1(selectedAgent.tx)}, {round1(selectedAgent.ty)})</div>
                    <div>{t('持有人', 'Owner')}: {selectedAgent.ownerAddress ? `${selectedAgent.ownerAddress.slice(0, 8)}...${selectedAgent.ownerAddress.slice(-6)}` : '--'}</div>
                  </>
                ) : (
                  <div>{t('点击地图中的 Agent 进行选择。', 'Click an agent on map to select.')}</div>
                )}
              </div>

              <div className="village-agent-log">
                <div className="village-agent-selected-title">{t('可审计行为记录', 'Auditable Action Logs')}</div>
                {agentActionLogs.length === 0 ? (
                  <div>{t('暂无链上记录。', 'No on-chain logs yet.')}</div>
                ) : (
                  <div className="village-agent-log-list">
                    {agentActionLogs.slice(0, 4).map((log) => (
                      <a
                        key={`agent-log-${log.txHash}`}
                        className="village-agent-log-item"
                        href={`https://bscscan.com/tx/${log.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {`#${log.tokenId} @ (${log.tx}, ${log.ty}) / ${log.txHash.slice(0, 10)}...`}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {agentPanelNotice ? <div className="village-agent-notice">{agentPanelNotice}</div> : null}
          </div>
        ) : null}

        <div className="village-canvas-card ga-card-surface">
          <div className={`village-canvas-wrap ${isTestMap ? 'is-test-map' : ''} ${!isTestMap && placeMode ? 'is-place-mode' : ''}`} ref={canvasWrapRef}>
            <canvas ref={canvasRef} className="village-canvas" />
            {!isTestMap && placeMode ? (
              <div className="village-place-hint">
                {t('放置模式：点击地图任意位置，把选中的 NFT 放上去。', 'Placement mode: click anywhere on map to place selected NFT.')}
              </div>
            ) : null}
            {isTestMap ? (
              <div className="village-top-left-actions">
                <div className="village-top-chip">
                  <span>{t('奖池', 'Prize Pool')}</span>
                  <strong>{mapFarmPrizePoolText}</strong>
                  <em className="village-top-chip-sub">≈ {mapFarmPrizePoolUsdText}</em>
                </div>
                <div className="village-top-chip">
                  <span>{t('我的代币', 'My Token')}</span>
                  <strong>{mapFarmWalletTokenText}</strong>
                </div>
                <button type="button" className="village-top-chip village-top-chip-btn" onClick={() => setMapFarmGuideOpen(true)}>
                  <span>{t('玩法指南', 'Gameplay Guide')}</span>
                  <strong>{t('点击查看', 'Tap to open')}</strong>
                </button>
              </div>
            ) : null}
            {isTestMap ? (
              <div className="testmap-farm-overlay">
                <div className="testmap-farm-topbar">
                  <div className="testmap-farm-topbar-left">
                    <div className="testmap-farm-badge">{t('农场区', 'Farm')}</div>
                    <span className="testmap-farm-mode-chip">{isTestChainMode ? t('链上模式', 'On-chain mode') : t('本地模式', 'Local mode')}</span>
                  </div>
                  <div className="testmap-farm-meta-grid">
                    <span className="testmap-farm-meta-chip">{t('等级', 'LV')} {mapFarm.level}</span>
                    <span className="testmap-farm-meta-chip">{t('经验', 'EXP')} {mapFarm.exp}/{expToNextLevel}</span>
                    <span className="testmap-farm-meta-chip">{t('土地', 'Land')} {visibleLandCount}</span>
                    {isTestChainMode ? (
                      <>
                        <span className="testmap-farm-meta-chip">{t('期数', 'Round')} #{mapFarmRoundText}</span>
                        <span className="testmap-farm-meta-chip testmap-farm-meta-strong">{t('本期彩票', 'Round Tickets')} {mapFarmRoundTicketText}</span>
                      </>
                    ) : (
                      <span className="testmap-farm-meta-chip">{t('经验基数', 'EXP Base')} {effectiveExpBase}</span>
                    )}
                  </div>
                </div>

                <div className="testmap-farm-main">
                  <div className="testmap-farm-left">
                    <div className="testmap-seed-row">
                      {(['WHEAT', 'CORN', 'CARROT'] as MapFarmSeed[]).map((seed) => (
                        <div key={`seed-${seed}`} className="testmap-seed-btn-wrap">
                          <button
                            type="button"
                            className={`testmap-seed-btn ${mapFarm.selectedSeed === seed ? 'active' : ''}`}
                            disabled={mapFarmTxPending}
                            onClick={() => setMapFarm((prev) => ({ ...prev, selectedSeed: seed }))}
                          >
                            <span className="seed-dot" style={{ background: MAP_FARM_SEED_META[seed].color }} />
                            <span>{mapSeedLabel(seed)}</span>
                            <span>x{mapFarm.bag[seed]}</span>
                          </button>
                          <div className="testmap-seed-tooltip" role="tooltip" aria-hidden="true">
                            <div className="testmap-seed-tooltip-title">{mapSeedLabel(seed)} {t('规则', 'Rules')}</div>
                            <div>{t('单价', 'Unit Price')}: {mapFarmSeedPriceText(seed)}</div>
                            <div>{t('收获彩票', 'Harvest Tickets')}: {MAP_FARM_TICKET_REWARD[seed]} {t('张', 'tickets')}</div>
                            <div>EXP: +{MAP_FARM_SEED_META[seed].exp}</div>
                            <div>{t('持有数量', 'Owned')}: {mapFarm.bag[seed]}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {isTestChainMode && mapFarm.plots.length === 0 ? (
                      <div className="testmap-empty-land">
                        <div>{t('暂无土地', 'No land yet')}</div>
                        <button
                          type="button"
                          className="testmap-empty-buy-btn"
                          disabled={mapFarmTxPending}
                          onClick={() => handleMapFarmPurchaseLand(safeMapFarmLandBuyCount)}
                        >
                          <span className="plot-buy-plus">+</span>
                          <span>{t('购买第一块土地', 'Buy first land')}</span>
                          <span className="plot-buy-price">{t('单价', 'Unit')}: {mapFarmLandPriceText}</span>
                        </button>
                      </div>
                    ) : (
                      <div className="testmap-farm-grid">
                        {mapFarm.plots.map((plot) => {
                          const stage = resolveMapFarmPlantStage(plot, farmNowMs);
                          const remaining = plot.matureAt ? plot.matureAt - farmNowMs : 0;
                          const mature = stage === 'RIPE';
                          return (
                            <button
                              key={`plot-${plot.id}`}
                              type="button"
                              className={`testmap-plot ${mature ? 'mature' : ''}`}
                              disabled={mapFarmTxPending}
                              onClick={() => handleMapFarmPlotClick(plot.id)}
                            >
                              {plot.crop ? (
                                <>
                                  {stage ? (
                                    <span className="plot-pixel-wrap">
                                      <MapPixelPlant stage={stage} crop={plot.crop} />
                                    </span>
                                  ) : null}
                                  <span className="plot-label">{mapSeedLabel(plot.crop)}</span>
                                  {stage ? (
                                    <span className={`plot-stage stage-${stage.toLowerCase()}`}>{mapStageLabel(stage)}</span>
                                  ) : null}
                                  <span className="plot-time">
                                    {mature ? t('可收获', 'Harvest') : formatFarmCountdown(remaining)}
                                  </span>
                                </>
                              ) : (
                                <span className="plot-empty">{t('空地', 'Empty')}</span>
                              )}
                            </button>
                          );
                        })}
                        {isTestChainMode ? (
                          <button
                            type="button"
                            className="testmap-plot testmap-plot-buy"
                            disabled={mapFarmTxPending}
                            onClick={() => handleMapFarmPurchaseLand(safeMapFarmLandBuyCount)}
                          >
                            <span className="plot-buy-plus">+</span>
                            <span className="plot-buy-label">{t('购买土地', 'Buy Land')}</span>
                            <span className="plot-buy-price">{t('单价', 'Unit')}: {mapFarmLandPriceText}</span>
                          </button>
                        ) : null}
                      </div>
                    )}

                    <div className="testmap-exp-row">
                      <div className="testmap-exp-track">
                        <div className="testmap-exp-fill" style={{ width: `${levelProgress}%` }} />
                      </div>
                      <button type="button" className="testmap-levelup-btn" disabled={mapFarmTxPending} onClick={handleMapFarmLevelUp}>
                        {mapFarmTxPending ? t('处理中', 'Pending') : t('升级', 'Level Up')}
                      </button>
                    </div>
                  </div>

                  <aside className="testmap-shop-panel">
                    <div className="testmap-shop-title">{t('商店', 'Shop')}</div>
                    <div className="testmap-shop-land-card">
                      <div className="testmap-shop-land-head">
                        <span className="plot-buy-plus">+</span>
                        <span>{t('购买土地', 'Buy Land')}</span>
                      </div>
                      <label className="testmap-shop-qty-row">
                        <span>{t('数量', 'Qty')}</span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          max={999}
                          value={safeMapFarmLandBuyCount}
                          disabled={mapFarmTxPending}
                          onChange={(e) => setMapFarmLandBuyCount(normalizeBuyCountInput(e.target.value))}
                          className="testmap-shop-input"
                        />
                      </label>
                      <div className="testmap-shop-price-row">
                        <span>{t('单价', 'Unit')}: {mapFarmLandPriceText}</span>
                        <span>{t('总价', 'Total')}: {mapFarmLandTotalPriceText}</span>
                      </div>
                      <button
                        type="button"
                        className="testmap-shop-land-btn"
                        disabled={mapFarmTxPending}
                        onClick={() => handleMapFarmPurchaseLand(safeMapFarmLandBuyCount)}
                      >
                        {t('确认购买', 'Confirm Buy')}
                      </button>
                    </div>
                    <div className="testmap-shop-seed-list">
                      {(['WHEAT', 'CORN', 'CARROT'] as MapFarmSeed[]).map((seed) => (
                        <div key={`shop-seed-${seed}`} className="testmap-shop-seed-item">
                          <div className="testmap-shop-seed-meta">
                            <span className="seed-dot" style={{ background: MAP_FARM_SEED_META[seed].color }} />
                            <span>{mapSeedLabel(seed)}</span>
                            <span>x{mapFarm.bag[seed]}</span>
                          </div>
                          <label className="testmap-shop-qty-row">
                            <span>{t('数量', 'Qty')}</span>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              max={999}
                              value={Math.max(1, Math.floor(mapFarmSeedBuyCount[seed] || 1))}
                              disabled={mapFarmTxPending}
                              onChange={(e) => {
                                const nextCount = normalizeBuyCountInput(e.target.value);
                                setMapFarmSeedBuyCount((prev) => ({ ...prev, [seed]: nextCount }));
                              }}
                              className="testmap-shop-input"
                            />
                          </label>
                          <div className="testmap-shop-price-row">
                            <span>{t('单价', 'Unit')}: {mapFarmSeedPriceText(seed)}</span>
                            <span>{t('总价', 'Total')}: {mapFarmSeedTotalPriceText(seed)}</span>
                          </div>
                          <button
                            type="button"
                            className="testmap-shop-seed-buy-btn"
                            disabled={mapFarmTxPending}
                            onClick={() => handleMapFarmPurchaseSeed(seed, mapFarmSeedBuyCount[seed])}
                          >
                            <span>{t('购买', 'Buy')}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </aside>
                </div>

                {isTestChainMode && mapFarmSyncing ? (
                  <div className="testmap-farm-notice">{t('同步链上农场中...', 'Syncing on-chain farm...')}</div>
                ) : null}
                {isTestChainMode && mapFarmSyncErr ? (
                  <div className="testmap-farm-notice">{t('农场同步失败', 'Farm sync failed')}: {mapFarmSyncErr}</div>
                ) : null}
                {isTestMap && !isTestChainMode ? (
                  <div className="testmap-farm-notice">{t('当前为本地测试模式，连接钱包后将读取链上农场。', 'Local test mode. Connect wallet to load on-chain farm.')}</div>
                ) : null}
                {mapFarm.notice ? <div className="testmap-farm-notice">{mapFarm.notice}</div> : null}

                {mapFarmGuideOpen ? (
                  <div className="testmap-guide-modal-backdrop" role="dialog" aria-modal="true" onClick={() => setMapFarmGuideOpen(false)}>
                    <div className="testmap-guide-modal" onClick={(e) => e.stopPropagation()}>
                      <div className="testmap-guide-title">{t('农场玩法指南', 'Farm Gameplay Guide')}</div>
                      <div className="testmap-guide-body">
                        <section className="testmap-guide-section">
                          <h3>{t('一、先知道你在玩什么', 'I. What You Are Playing')}</h3>
                          <p>{t('这是一个“种地 + 开奖 + 成长”的循环游戏。你的目标很简单：扩大土地、提升效率、冲击奖池。', 'This is a loop game of farming + lottery + progression. Your goal is simple: expand land, improve efficiency, and compete for the prize pool.')}</p>
                          <ul>
                            <li>{t('先买地和种子，地越多，单轮能种得越多。', 'Buy land and seeds first. More land means more crops per round.')}</li>
                            <li>{t('成熟后收获，拿到彩票编号参与当期抽奖。', 'Harvest when mature to receive ticket numbers for the current lottery round.')}</li>
                            <li>{t('不断种植累积经验，升级后成熟更快。', 'Keep planting to gain EXP. Higher level means faster maturity.')}</li>
                          </ul>
                        </section>

                        <section className="testmap-guide-section">
                          <h3>{t('二、新手 30 秒上手', 'II. 30-Second Quick Start')}</h3>
                          <ul>
                            <li>{t('连接钱包并切到 BSC。', 'Connect your wallet and switch to BSC.')}</li>
                            <li>{t('准备代币后，先买 1-3 块地和一批小麦种子。', 'Prepare tokens, then buy 1-3 lands and a batch of wheat seeds.')}</li>
                            <li>{t('把空地全部种满，成熟后立即收获。', 'Fill all empty plots, then harvest as soon as crops mature.')}</li>
                            <li>{t('有了稳定节奏后，再逐步换成玉米/胡萝卜提高收益。', 'After your loop stabilizes, gradually switch to corn/carrot for higher returns.')}</li>
                            <li>{t('开奖页可查看每一期结果和你的参与情况。', 'Lottery page shows each round result and your participation.')}</li>
                          </ul>
                        </section>

                        <section className="testmap-guide-section">
                          <h3>{t('三、三种作物怎么选', 'III. Which Seed to Choose')}</h3>
                          <p>{t('三种作物定位不同，核心差异是“开奖票数”和“经验效率”。', 'Each seed has a different role. The key difference is ticket output and EXP efficiency.')}</p>
                          <ul>
                            <li>{t('小麦：稳健入门，收获 1 张彩票，种植 +100 EXP。', 'Wheat: beginner-friendly, 1 ticket on harvest, +100 EXP on plant.')}</li>
                            <li>{t('玉米：中阶效率，收获 5 张彩票，种植 +500 EXP。', 'Corn: mid-tier efficiency, 5 tickets on harvest, +500 EXP on plant.')}</li>
                            <li>{t('胡萝卜：高收益路线，收获 10 张彩票，种植 +1000 EXP。', 'Carrot: high-reward route, 10 tickets on harvest, +1000 EXP on plant.')}</li>
                            <li>{t('基础成熟时间约 2 小时；等级越高，成熟越快。', 'Base mature time is about 2 hours; higher level means faster growth.')}</li>
                            <li>{t('成熟时间公式：每升 1 级再乘 0.95。示例：3级 = baseMatureTime x 0.95 x 0.95。', 'Maturity formula: multiply by 0.95 for each level up. Example: Level 3 = baseMatureTime x 0.95 x 0.95.')}</li>
                          </ul>
                        </section>

                        <section className="testmap-guide-section">
                          <h3>{t('四、升级有什么用', 'IV. Why Level Up')}</h3>
                          <ul>
                            <li>{t('经验主要来自“种植动作”，不是收获动作。', 'Most EXP comes from planting, not harvesting.')}</li>
                            <li>{t('满足经验条件并支付升级费用后，可提升等级。', 'After reaching EXP requirement and paying the fee, you can level up.')}</li>
                            <li>{t('等级提升会缩短后续作物成熟时间，长期收益会更高。', 'Higher level shortens crop maturity time and improves long-term return.')}</li>
                            <li>{t('建议：先保证地块持续满种，再考虑冲级。', 'Tip: keep plots fully planted first, then push levels.')}</li>
                          </ul>
                        </section>

                        <section className="testmap-guide-section">
                          <h3>{t('五、开奖怎么进行', 'V. How Lottery Works')}</h3>
                          <ul>
                            <li>{t('每次收获都会给你当前期的彩票编号。', 'Every harvest gives you ticket numbers in the current round.')}</li>
                            <li>{t('达到开奖条件后，系统发起随机开奖并确定中奖号。', 'When conditions are met, the system requests randomness and determines the winning number.')}</li>
                            <li>{t('中奖者获得当期全部奖池。', 'The winner receives the full round prize pool.')}</li>
                            <li>{t('开奖后自动进入下一期，继续循环。', 'After draw, a new round starts automatically.')}</li>
                          </ul>
                        </section>

                        <section className="testmap-guide-section">
                          <h3>{t('六、费用与奖池去向', 'VI. Cost and Prize Pool Flow')}</h3>
                          <p>{t('买地、买种、升级等支付会进入系统分配：一部分销毁，一部分进入奖池。', 'Payments from land/seed/level-up are split by the system: one part burned, one part into prize pool.')}</p>
                          <ul>
                            <li>{t('默认比例为 50% 销毁 + 50% 进入奖池。', 'Default split is 50% burn + 50% to prize pool.')}</li>
                            <li>{t('奖池越高，单期中奖吸引力越强。', 'Larger prize pool means stronger round incentive.')}</li>
                            <li>{t('所有结果以上链数据为准，请注意链上交易确认时间。', 'All results follow on-chain data; consider transaction confirmation latency.')}</li>
                          </ul>
                        </section>
                      </div>
                      <button type="button" className="testmap-guide-close-btn" onClick={() => setMapFarmGuideOpen(false)}>
                        {t('关闭指南', 'Close Guide')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {!isTestMap ? (
              <div className="village-overlay-note">
                {renderErr || 'AGENTS ARE AUTONOMOUS // OBSERVATION MODE ONLY'}
              </div>
            ) : null}
          </div>
        </div>

        {!isTestMap ? (
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
        ) : null}
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

          .village-agent-control-card {
              margin-bottom: 12px;
              border: 2px solid #7ea46a;
              border-radius: 10px;
              background: linear-gradient(180deg, rgba(245, 255, 220, 0.92), rgba(229, 245, 188, 0.92));
              padding: 10px 12px;
          }

          .village-agent-control-title {
              font-family: 'Press Start 2P', cursive;
              font-size: 10px;
              color: #456745;
              margin-bottom: 8px;
          }

          .village-agent-control-grid {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 8px;
              align-items: start;
          }

          .village-agent-stat-row {
              border: 1px solid #7ea46a;
              background: rgba(255, 255, 255, 0.58);
              border-radius: 6px;
              padding: 6px 8px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              color: #335034;
          }

          .village-agent-stat-row strong {
              font-size: 12px;
              color: #294429;
          }

          .village-agent-picker {
              grid-column: span 2;
              border: 1px solid #7ea46a;
              background: rgba(255, 255, 255, 0.6);
              border-radius: 6px;
              padding: 6px 8px;
              display: flex;
              flex-direction: column;
              gap: 6px;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              color: #355537;
          }

          .village-agent-picker select {
              border: 1px solid #7ea46a;
              background: #f5fce7;
              color: #2f4a31;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              padding: 4px 6px;
          }

          .village-agent-action-row {
              grid-column: span 3;
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 6px;
          }

          .village-agent-btn {
              border: 1px solid #6f975f;
              background: linear-gradient(180deg, rgba(238, 250, 208, 0.95), rgba(211, 236, 159, 0.95));
              color: #294a2d;
              padding: 6px 8px;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              cursor: pointer;
          }

          .village-agent-btn.active {
              border-color: #e7b843;
              box-shadow: 0 0 0 1px rgba(231, 184, 67, 0.38) inset;
              color: #5f3f12;
          }

          .village-agent-btn:disabled {
              opacity: 0.7;
              cursor: not-allowed;
          }

          .village-agent-selected,
          .village-agent-log {
              border: 1px solid #7ea46a;
              background: rgba(255, 255, 255, 0.56);
              border-radius: 6px;
              padding: 6px 8px;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              line-height: 1.45;
              color: #355537;
          }

          .village-agent-selected-title {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #456745;
              margin-bottom: 4px;
          }

          .village-agent-log-list {
              display: flex;
              flex-direction: column;
              gap: 4px;
          }

          .village-agent-log-item {
              color: #345b37;
              text-decoration: none;
              border: 1px solid rgba(126, 164, 106, 0.75);
              border-radius: 4px;
              background: rgba(240, 252, 211, 0.62);
              padding: 4px 6px;
              font-size: 10px;
          }

          .village-agent-log-item:hover {
              background: rgba(230, 246, 191, 0.8);
          }

          .village-agent-notice {
              margin-top: 8px;
              border: 1px solid rgba(126, 164, 106, 0.9);
              background: rgba(248, 255, 225, 0.82);
              color: #355537;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              padding: 5px 7px;
              border-radius: 6px;
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
              height: min(82vh, 1040px);
              border: 2px solid #6f975f;
              border-radius: 8px;
              overflow: auto;
              cursor: grab;
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

          .village-canvas-wrap.is-test-map {
              height: min(90vh, 1180px);
              overflow: hidden;
              cursor: default;
              touch-action: auto;
          }

          .village-canvas-wrap.is-dragging {
              cursor: grabbing;
          }

          .village-canvas-wrap.is-place-mode {
              cursor: crosshair;
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

          .village-place-hint {
              position: absolute;
              right: 10px;
              top: 10px;
              z-index: 6;
              border: 1px solid #6f975f;
              background: rgba(246, 255, 225, 0.94);
              color: #2f4a31;
              border-radius: 6px;
              padding: 6px 8px;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              max-width: min(300px, calc(100% - 20px));
              line-height: 1.5;
              box-shadow: 0 4px 12px rgba(59, 87, 50, 0.15);
          }

          .village-top-left-actions {
              position: absolute;
              left: 10px;
              top: 10px;
              z-index: 5;
              display: inline-flex;
              align-items: flex-start;
              gap: 8px;
              flex-wrap: wrap;
              max-width: calc(100% - 20px);
              pointer-events: none;
          }

          .village-top-chip {
              display: inline-flex;
              flex-direction: column;
              gap: 3px;
              border: 1px solid rgba(126, 164, 106, 0.92);
              background: linear-gradient(180deg, rgba(246, 255, 223, 0.94), rgba(229, 246, 184, 0.94));
              color: #355537;
              padding: 6px 8px;
              border-radius: 6px;
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.45), 0 4px 12px rgba(59,87,50,0.14);
              pointer-events: none;
              max-width: min(260px, 42vw);
          }

          .village-top-chip-btn {
              pointer-events: auto;
              cursor: pointer;
              text-align: left;
          }

          .village-top-chip span {
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              letter-spacing: .04em;
              opacity: 0.92;
          }

          .village-top-chip strong {
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              line-height: 1.25;
              word-break: break-all;
          }

          .village-top-chip-sub {
              font-family: 'Space Mono', monospace;
              font-size: 9px;
              font-style: normal;
              opacity: 0.9;
              color: #3f663f;
          }

          .testmap-farm-overlay {
              position: absolute;
              left: 50%;
              top: 52%;
              transform: translate(-50%, -50%);
              width: min(780px, calc(100% - 54px));
              border: 1px solid rgba(71, 104, 44, 0.66);
              background:
                radial-gradient(circle at 50% 0%, rgba(255,255,255,0.14), transparent 48%),
                linear-gradient(180deg, rgba(56, 84, 41, 0.78), rgba(43, 67, 31, 0.82));
              box-shadow: 0 6px 16px rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.18);
              border-radius: 10px;
              padding: 8px;
              color: #fff6d8;
              pointer-events: auto;
          }

          .testmap-farm-topbar {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              gap: 8px;
              margin-bottom: 6px;
              flex-wrap: wrap;
          }

          .testmap-farm-topbar-left {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              flex-wrap: wrap;
          }

          .testmap-farm-badge {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #1f391c;
              border: 1px solid rgba(60, 96, 45, 0.62);
              background: linear-gradient(180deg, rgba(240, 253, 195, 0.92), rgba(213, 239, 156, 0.92));
              padding: 4px 6px;
          }

          .testmap-farm-mode-chip {
              border: 1px solid rgba(120, 162, 84, 0.55);
              background: rgba(232, 248, 191, 0.88);
              color: #2f4f2e;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              padding: 4px 6px;
              text-shadow: none;
          }

          .testmap-farm-meta-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              flex-wrap: wrap;
              gap: 6px;
              justify-items: stretch;
              width: min(410px, 100%);
          }

          .testmap-farm-meta-chip {
              border: 1px solid rgba(255,255,255,0.16);
              background: rgba(22, 37, 18, 0.34);
              padding: 4px 6px;
              font-size: 10px;
              text-align: center;
              font-family: 'Space Mono', monospace;
              color: #fff6d6;
              text-shadow: 0 1px 0 rgba(0,0,0,0.5), 0 0 6px rgba(0,0,0,0.2);
          }

          .testmap-farm-meta-strong {
              color: #ffe88a;
              border-color: rgba(255, 216, 107, 0.28);
              text-shadow: 0 1px 0 rgba(0,0,0,0.58), 0 0 8px rgba(255, 215, 99, 0.24);
          }

          .testmap-farm-main {
              display: grid;
              grid-template-columns: minmax(0, 1fr) 236px;
              gap: 8px;
              align-items: stretch;
              min-height: min(52vh, 520px);
          }

          .testmap-farm-left {
              min-width: 0;
              min-height: 100%;
              display: flex;
              flex-direction: column;
          }

          .testmap-seed-row {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 6px;
              margin-bottom: 6px;
          }

          .testmap-seed-btn-wrap {
              position: relative;
              display: inline-flex;
              min-width: 0;
          }

          .testmap-seed-btn {
              border: 1px solid rgba(72, 107, 50, 0.78);
              background: linear-gradient(180deg, rgba(248, 255, 219, 0.93), rgba(221, 241, 171, 0.9));
              color: #1e3411;
              display: inline-flex;
              align-items: center;
              justify-content: space-between;
              gap: 6px;
              font-size: 9px;
              font-family: 'Press Start 2P', cursive;
              padding: 5px 6px;
              cursor: pointer;
              text-shadow: 0 1px 0 rgba(255,255,255,0.35);
          }

          .testmap-seed-btn.active {
              border-color: #f3ce63;
              box-shadow: 0 0 0 1px rgba(243,206,99,0.42) inset;
              transform: translateY(-1px);
          }

          .testmap-seed-btn:disabled {
              opacity: 0.65;
              cursor: not-allowed;
          }

          .testmap-seed-tooltip {
              position: absolute;
              left: 50%;
              bottom: calc(100% + 8px);
              transform: translateX(-50%) translateY(4px);
              min-width: 176px;
              max-width: 220px;
              padding: 8px 10px;
              border: 2px solid #7d5f39;
              background: linear-gradient(180deg, rgba(44, 37, 27, 0.97), rgba(35, 30, 22, 0.96));
              color: #effad4;
              box-shadow: 0 8px 14px rgba(0, 0, 0, 0.35);
              font-size: 10px;
              line-height: 1.55;
              white-space: nowrap;
              opacity: 0;
              visibility: hidden;
              pointer-events: none;
              transition: opacity .12s ease, transform .12s ease;
              z-index: 30;
              font-family: 'Space Mono', monospace;
          }

          .testmap-seed-tooltip-title {
              font-family: 'Press Start 2P', cursive;
              color: #ffe28b;
              margin-bottom: 4px;
              font-size: 8px;
              letter-spacing: .03em;
          }

          .testmap-seed-btn-wrap:hover .testmap-seed-tooltip,
          .testmap-seed-btn-wrap:focus-within .testmap-seed-tooltip {
              opacity: 1;
              visibility: visible;
              transform: translateX(-50%) translateY(0);
          }

          .seed-dot {
              width: 8px;
              height: 8px;
              border-radius: 999px;
              box-shadow: 0 0 0 1px rgba(0,0,0,0.25);
              flex-shrink: 0;
          }

          .testmap-farm-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(74px, 104px));
              gap: 7px;
              margin-bottom: 6px;
              max-height: none;
              overflow: auto;
              padding-right: 2px;
              flex: 1;
              align-content: start;
              justify-content: flex-start;
          }

          .testmap-empty-land {
              margin-bottom: 6px;
              border: 1px dashed rgba(255,255,255,0.35);
              background: rgba(20, 35, 18, 0.3);
              padding: 14px 8px;
              text-align: center;
              font-family: 'Press Start 2P', cursive;
              font-size: 9px;
              color: #fff3ca;
              text-shadow: 0 1px 0 rgba(0,0,0,0.45);
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 8px;
          }

          .testmap-empty-buy-btn {
              border: 1px solid #caa95a;
              background: linear-gradient(180deg, rgba(121, 84, 50, 0.95), rgba(95, 65, 39, 0.96));
              color: #fff4d0;
              padding: 6px 8px;
              width: 100%;
              max-width: 220px;
              display: inline-flex;
              flex-direction: column;
              align-items: center;
              gap: 4px;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              text-shadow: 0 1px 0 rgba(0,0,0,0.6);
          }

          .testmap-empty-buy-btn:disabled {
              opacity: 0.65;
          }

          .testmap-plot {
              aspect-ratio: 1 / 1;
              border: 1px solid #5b3f27;
              background:
                radial-gradient(circle at 28% 22%, rgba(255,255,255,0.08), transparent 38%),
                repeating-linear-gradient(
                  180deg,
                  #8d5e37 0px,
                  #8d5e37 5px,
                  #7b4f2f 5px,
                  #7b4f2f 10px
                );
              color: #fdf6d4;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 4px;
              padding: 4px 3px;
              cursor: pointer;
              position: relative;
          }

          .testmap-plot.mature {
              border-color: #f3cd53;
              box-shadow: 0 0 12px rgba(243, 205, 83, 0.35);
          }

          .testmap-plot:disabled {
              cursor: not-allowed;
          }

          .testmap-plot-buy {
              border-color: #caa95a;
              background:
                radial-gradient(circle at 50% 24%, rgba(255, 235, 167, 0.22), transparent 38%),
                repeating-linear-gradient(
                  180deg,
                  #71512f 0px,
                  #71512f 5px,
                  #634527 5px,
                  #634527 10px
                );
          }

          .plot-buy-plus {
              font-family: 'Press Start 2P', cursive;
              font-size: 18px;
              line-height: 1;
              color: #ffe18f;
              text-shadow: 0 1px 0 rgba(0,0,0,0.65);
          }

          .plot-buy-label {
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              color: #fff4d2;
              text-shadow: 0 1px 0 rgba(0,0,0,0.58);
          }

          .plot-buy-price {
              font-family: 'Space Mono', monospace;
              font-size: 8px;
              color: #ffedb8;
              text-align: center;
              line-height: 1.35;
              text-shadow: 0 1px 0 rgba(0,0,0,0.58);
              word-break: break-word;
          }

          .plot-pixel-wrap {
              height: 14px;
              display: inline-flex;
              align-items: flex-end;
              justify-content: center;
              margin-bottom: 1px;
          }

          .plot-label {
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              line-height: 1.4;
              color: #fff6d0;
              text-shadow: 0 1px 0 rgba(0,0,0,0.6);
              opacity: 1;
          }

          .plot-stage {
              font-family: 'Press Start 2P', cursive;
              font-size: 6px;
              line-height: 1.3;
              padding: 1px 3px;
              border: 1px solid rgba(255,255,255,0.18);
              background: rgba(0, 0, 0, 0.42);
              text-shadow: 0 1px 0 rgba(0,0,0,0.55);
          }

          .plot-stage.stage-seed {
              color: #d4d4d4;
          }

          .plot-stage.stage-sprout {
              color: #9be06d;
          }

          .plot-stage.stage-mature {
              color: #ffd76f;
          }

          .plot-stage.stage-ripe {
              color: #ffe98f;
              border-color: rgba(255, 214, 102, 0.4);
              background: rgba(79, 52, 9, 0.38);
          }

          .plot-time {
              font-family: 'Space Mono', monospace;
              font-size: 9px;
              color: #ffe9bb;
              text-shadow: 0 1px 0 rgba(0,0,0,0.55);
              opacity: 1;
          }

          .plot-empty {
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              color: #fff0c2;
              text-shadow: 0 1px 0 rgba(0,0,0,0.55);
              opacity: 1;
          }

          .testmap-exp-row {
              display: grid;
              grid-template-columns: 1fr auto;
              gap: 8px;
              align-items: center;
              margin-top: auto;
              padding-top: 14px;
          }

          .testmap-exp-track {
              height: 12px;
              border: 1px solid #7f9b6e;
              background: #d9e7c9;
              overflow: hidden;
          }

          .testmap-exp-fill {
              height: 100%;
              background: linear-gradient(90deg, #74bb52, #9ddf67);
              transition: width .2s ease;
          }

          .testmap-levelup-btn {
              border: 1px solid #deac3f;
              background: linear-gradient(180deg, #ffe89f, #f4c84d);
              color: #5f3c12;
              padding: 5px 7px;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              cursor: pointer;
          }

          .testmap-levelup-btn:disabled {
              opacity: 0.65;
              cursor: not-allowed;
          }

          .testmap-shop-panel {
              border: 1px solid rgba(126, 164, 106, 0.9);
              background: linear-gradient(180deg, rgba(246, 255, 223, 0.95), rgba(227, 244, 186, 0.95));
              padding: 6px;
              display: flex;
              flex-direction: column;
              gap: 6px;
              box-shadow: inset 0 0 0 1px rgba(255,255,255,0.4);
          }

          .testmap-shop-title {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #355537;
              text-shadow: 0 1px 0 rgba(255,255,255,0.35);
              letter-spacing: .04em;
          }

          .testmap-shop-land-card {
              border: 1px solid rgba(111, 151, 95, 0.78);
              background: linear-gradient(180deg, rgba(255,255,255,0.6), rgba(234, 248, 201, 0.9));
              padding: 6px;
              display: flex;
              flex-direction: column;
              gap: 6px;
          }

          .testmap-shop-land-head {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              color: #355537;
          }

          .testmap-shop-qty-row {
              display: grid;
              grid-template-columns: auto 1fr;
              align-items: center;
              gap: 6px;
              font-size: 9px;
              color: #355537;
              font-family: 'Space Mono', monospace;
          }

          .testmap-shop-input {
              width: 100%;
              border: 1px solid #7ea46a;
              background: #f4fbe4;
              color: #2f4a31;
              font-size: 10px;
              font-family: 'Space Mono', monospace;
              padding: 3px 4px;
              box-sizing: border-box;
          }

          .testmap-shop-price-row {
              display: flex;
              flex-direction: column;
              gap: 2px;
              font-family: 'Space Mono', monospace;
              font-size: 8px;
              color: #426244;
          }

          .testmap-shop-land-btn,
          .testmap-shop-seed-buy-btn {
              border: 1px solid #6f975f;
              background: linear-gradient(180deg, rgba(238, 250, 208, 0.95), rgba(211, 236, 159, 0.95));
              color: #28452c;
              width: 100%;
              padding: 5px 6px;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              line-height: 1.3;
              cursor: pointer;
              text-shadow: 0 1px 0 rgba(255,255,255,0.35);
          }

          .testmap-shop-seed-list {
              display: flex;
              flex-direction: column;
              gap: 6px;
          }

          .testmap-shop-seed-item {
              border: 1px solid rgba(111, 151, 95, 0.7);
              background: linear-gradient(180deg, rgba(255,255,255,0.52), rgba(228, 244, 186, 0.75));
              padding: 5px;
              display: flex;
              flex-direction: column;
              gap: 5px;
          }

          .testmap-shop-seed-meta {
              display: inline-flex;
              align-items: center;
              justify-content: space-between;
              gap: 6px;
              font-size: 9px;
              color: #355537;
              font-family: 'Space Mono', monospace;
          }

          .testmap-shop-price {
              font-family: 'Space Mono', monospace;
              font-size: 8px;
              color: #426244;
              text-shadow: none;
          }

          .testmap-shop-land-btn:disabled,
          .testmap-shop-seed-buy-btn:disabled {
              opacity: 0.65;
              cursor: not-allowed;
          }

          .testmap-farm-notice {
              margin-top: 6px;
              border: 1px solid rgba(255,255,255,0.18);
              background: rgba(28, 48, 24, 0.35);
              padding: 5px 7px;
              font-size: 10px;
              line-height: 1.45;
              font-family: 'Space Mono', monospace;
              color: #fff4cf;
              text-shadow: 0 1px 0 rgba(0,0,0,0.5);
          }

          .testmap-guide-modal-backdrop {
              position: fixed;
              inset: 0;
              background: rgba(11, 18, 9, 0.48);
              display: flex;
              align-items: center;
              justify-content: center;
              z-index: 90;
              padding: 12px;
          }

          .testmap-guide-modal {
              width: min(520px, calc(100vw - 24px));
              max-height: min(74vh, 620px);
              overflow: auto;
              border: 2px solid rgba(126, 164, 106, 0.95);
              background: linear-gradient(180deg, rgba(247, 255, 227, 0.98), rgba(226, 244, 184, 0.98));
              border-radius: 8px;
              padding: 10px;
              box-shadow: 0 10px 22px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.45);
          }

          .testmap-guide-title {
              font-family: 'Press Start 2P', cursive;
              color: #355537;
              font-size: 10px;
              margin-bottom: 8px;
          }

          .testmap-guide-body {
              color: #365938;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              line-height: 1.65;
          }

          .testmap-guide-section {
              margin-bottom: 10px;
          }

          .testmap-guide-section h3 {
              margin: 0 0 6px;
              font-family: 'Press Start 2P', cursive;
              color: #355537;
              font-size: 9px;
              line-height: 1.4;
          }

          .testmap-guide-body p {
              margin: 0 0 8px;
          }

          .testmap-guide-section ul {
              margin: 0;
              padding-left: 18px;
          }

          .testmap-guide-section li {
              margin-bottom: 4px;
          }

          .testmap-guide-section code {
              color: #27462e;
              background: rgba(255,255,255,0.5);
              border: 1px solid rgba(126, 164, 106, 0.6);
              padding: 0 3px;
          }

          .testmap-guide-close-btn {
              margin-top: 4px;
              border: 1px solid #6f975f;
              background: linear-gradient(180deg, rgba(238, 250, 208, 0.95), rgba(211, 236, 159, 0.95));
              color: #28452c;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              padding: 6px 10px;
              cursor: pointer;
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

              .village-agent-control-grid {
                  grid-template-columns: repeat(2, minmax(0, 1fr));
              }

              .village-agent-action-row {
                  grid-column: span 2;
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

              .village-agent-control-grid {
                  grid-template-columns: 1fr;
              }

              .village-agent-picker,
              .village-agent-action-row {
                  grid-column: span 1;
              }

              .village-agent-action-row {
                  grid-template-columns: 1fr;
              }

              .village-canvas-wrap {
                  height: min(76vh, 860px);
              }

              .village-canvas-wrap.is-test-map {
                  height: min(78vh, 900px);
              }

              .testmap-farm-overlay {
                  width: min(360px, calc(100% - 30px));
                  top: 58%;
              }

              .testmap-farm-meta-grid {
                  grid-template-columns: 1fr;
                  width: 100%;
              }

              .testmap-farm-main {
                  grid-template-columns: 1fr;
              }
          }

          @media (min-width: 1360px) {
              .village-inner {
                  padding: 18px 22px;
              }

              .village-canvas-wrap.is-test-map {
                  height: min(92vh, 1320px);
              }

              .testmap-farm-overlay {
                  width: min(980px, calc(100% - 70px));
                  top: 50%;
                  padding: 10px;
              }

              .testmap-farm-main {
                  grid-template-columns: minmax(0, 1fr) 276px;
                  min-height: min(58vh, 640px);
              }

              .testmap-farm-grid {
                  grid-template-columns: repeat(auto-fit, minmax(82px, 112px));
                  gap: 8px;
              }
          }

          @media (min-width: 1800px) {
              .testmap-farm-overlay {
                  width: min(1150px, calc(100% - 96px));
              }

              .testmap-farm-main {
                  grid-template-columns: minmax(0, 1fr) 308px;
                  min-height: min(62vh, 760px);
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

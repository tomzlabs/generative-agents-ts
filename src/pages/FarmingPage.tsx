import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { loadFromStorage, saveToStorage } from '../core/persistence/storage';
import { CHAIN_CONFIG } from '../config/chain';
import { getReadProvider } from '../core/chain/readProvider';

type CropType = 'WHEAT' | 'CORN' | 'CARROT';
type GrowthStage = 'SEED' | 'SPROUT' | 'MATURE' | 'RIPE';
type FarmAction = 'PLANT' | 'HARVEST';

type Plot = {
  id: number;
  crop: CropType | null;
  stage: GrowthStage | null;
  plantedAt: number | null;
  matureAt: number | null;
};

type FarmIntent = {
  action: FarmAction;
  plotId: number;
  crop: CropType;
  createdAt: number;
};

type FarmProfile = {
  level: number;
  exp: number;
  items: Record<CropType, number>;
  tools: {
    hoe: number;
    waterCan: number;
    fertilizer: number;
  };
};

type TokenHolding = {
  raw: bigint;
  formatted: string;
  symbol: string;
  decimals: number;
};

type SeedType = 1 | 2 | 3;

const PROFILE_KEY = 'ga:farm:profile-v5';
const PLOTS_KEY = 'ga:farm:plots-v2';
const GRID_COLS = 3;
const GRID_ROWS = 3;
const TOTAL_PLOTS = GRID_COLS * GRID_ROWS;

const DEFAULT_PROFILE: FarmProfile = {
  level: 1,
  exp: 60,
  items: {
    WHEAT: 8,
    CORN: 6,
    CARROT: 5,
  },
  tools: {
    hoe: 1,
    waterCan: 1,
    fertilizer: 3,
  },
};

const CROP_CONFIG: Record<CropType, { seedColor: string; stemColor: string; ripeColor: string; timings: { sprout: number; mature: number; ripe: number } }> = {
  WHEAT: {
    seedColor: '#d6d3d1',
    stemColor: '#7fb24a',
    ripeColor: '#facc15',
    timings: { sprout: 2500, mature: 6000, ripe: 11000 },
  },
  CORN: {
    seedColor: '#d9e36f',
    stemColor: '#84cc16',
    ripeColor: '#f59e0b',
    timings: { sprout: 2000, mature: 5000, ripe: 9500 },
  },
  CARROT: {
    seedColor: '#e5e7eb',
    stemColor: '#65a30d',
    ripeColor: '#f97316',
    timings: { sprout: 1800, mature: 4500, ripe: 8500 },
  },
};

type SpriteName =
  | 'flower_red'
  | 'flower_white'
  | 'fence_h'
  | 'fence_v'
  | 'rock_small'
  | 'rock_big'
  | 'tuft'
  | 'seed_wheat'
  | 'seed_corn'
  | 'seed_carrot';

const SPRITE_SHEET_PATH = '/static/assets/farm/farm-spritesheet.png';
const SPRITE_SHEET_SIZE = 128;
const SPRITE_TILE = 16;

const SPRITE_FRAMES: Record<SpriteName, { x: number; y: number }> = {
  rock_small: { x: 112, y: 0 },
  rock_big: { x: 0, y: 16 },
  fence_h: { x: 80, y: 0 },
  fence_v: { x: 96, y: 0 },
  flower_red: { x: 32, y: 16 },
  flower_white: { x: 48, y: 16 },
  tuft: { x: 64, y: 16 },
  seed_wheat: { x: 80, y: 16 },
  seed_corn: { x: 96, y: 16 },
  seed_carrot: { x: 112, y: 16 },
};

const ITEM_SPRITE: Record<CropType, SpriteName> = {
  WHEAT: 'seed_wheat',
  CORN: 'seed_corn',
  CARROT: 'seed_carrot',
};

const LOTTERY_REWARD_PER_SEED: Record<CropType, number> = {
  WHEAT: 1,
  CORN: 5,
  CARROT: 10,
};

const DEFAULT_SEED_EXP: Record<CropType, number> = {
  WHEAT: 100,
  CORN: 500,
  CARROT: 1000,
};

const CROP_LABELS: Record<CropType, string> = {
  WHEAT: '小麦',
  CORN: '玉米',
  CARROT: '胡萝卜',
};

const CLOUD_DECOR = [
  { left: '10%', top: '9%', scale: 0.95, speed: 26 },
  { left: '26%', top: '6%', scale: 1.1, speed: 33 },
  { left: '56%', top: '10%', scale: 1.0, speed: 30 },
  { left: '78%', top: '7%', scale: 1.05, speed: 35 },
];

const TREE_DECOR = [
  { left: '6%', top: '34%', scale: 0.95 },
  { left: '14%', top: '37%', scale: 1.0 },
  { left: '84%', top: '35%', scale: 1.0 },
  { left: '92%', top: '33%', scale: 0.95 },
  { left: '8%', top: '78%', scale: 0.9 },
  { left: '18%', top: '82%', scale: 1.05 },
  { left: '82%', top: '80%', scale: 1.0 },
  { left: '92%', top: '76%', scale: 0.95 },
];

const FLOWER_DECOR = [
  { left: '24%', top: '48%' }, { left: '28%', top: '52%' }, { left: '32%', top: '49%' },
  { left: '66%', top: '50%' }, { left: '70%', top: '54%' }, { left: '74%', top: '50%' },
  { left: '40%', top: '74%' }, { left: '44%', top: '78%' }, { left: '48%', top: '74%' },
  { left: '52%', top: '74%' }, { left: '56%', top: '78%' }, { left: '60%', top: '74%' },
];

const GRASS_DECOR = [
  { left: '18%', top: '56%', scale: 0.9 }, { left: '22%', top: '60%', scale: 0.85 }, { left: '30%', top: '58%', scale: 0.95 },
  { left: '64%', top: '58%', scale: 0.9 }, { left: '70%', top: '61%', scale: 0.85 }, { left: '76%', top: '58%', scale: 0.95 },
  { left: '36%', top: '86%', scale: 0.85 }, { left: '42%', top: '88%', scale: 0.8 }, { left: '58%', top: '88%', scale: 0.8 }, { left: '64%', top: '86%', scale: 0.85 },
];

const ROCK_DECOR = [
  { left: '9%', top: '62%', scale: 1.0, sprite: 'rock_big' as const },
  { left: '86%', top: '58%', scale: 0.95, sprite: 'rock_big' as const },
  { left: '48%', top: '88%', scale: 0.75, sprite: 'rock_small' as const },
  { left: '57%', top: '86%', scale: 0.8, sprite: 'rock_small' as const },
];

const FARMER_A_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="24" viewBox="0 0 20 24"><rect width="20" height="24" fill="none"/><rect x="6" y="2" width="8" height="2" fill="#7d5a33"/><rect x="5" y="4" width="10" height="2" fill="#9a7245"/><rect x="6" y="6" width="8" height="2" fill="#f2d1a8"/><rect x="6" y="8" width="8" height="4" fill="#f2d1a8"/><rect x="8" y="8" width="1" height="1" fill="#3c2a1e"/><rect x="11" y="8" width="1" height="1" fill="#3c2a1e"/><rect x="8" y="10" width="4" height="1" fill="#d19f71"/><rect x="5" y="12" width="10" height="5" fill="#4f9b55"/><rect x="7" y="13" width="2" height="3" fill="#6dbf73"/><rect x="10" y="13" width="2" height="3" fill="#6dbf73"/><rect x="6" y="17" width="3" height="4" fill="#355f9d"/><rect x="11" y="17" width="3" height="4" fill="#355f9d"/><rect x="6" y="21" width="3" height="2" fill="#2d3138"/><rect x="11" y="21" width="3" height="2" fill="#2d3138"/></svg>`;
const FARMER_B_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="24" viewBox="0 0 20 24"><rect width="20" height="24" fill="none"/><rect x="6" y="3" width="8" height="2" fill="#6d8ea9"/><rect x="5" y="5" width="10" height="2" fill="#8eb5d6"/><rect x="6" y="7" width="8" height="2" fill="#f2d1a8"/><rect x="6" y="9" width="8" height="4" fill="#f2d1a8"/><rect x="8" y="9" width="1" height="1" fill="#3c2a1e"/><rect x="11" y="9" width="1" height="1" fill="#3c2a1e"/><rect x="8" y="11" width="4" height="1" fill="#d19f71"/><rect x="5" y="13" width="10" height="5" fill="#5f7cc1"/><rect x="7" y="14" width="2" height="3" fill="#87a4e5"/><rect x="10" y="14" width="2" height="3" fill="#87a4e5"/><rect x="6" y="18" width="3" height="4" fill="#754b2f"/><rect x="11" y="18" width="3" height="4" fill="#754b2f"/><rect x="6" y="22" width="3" height="2" fill="#2d3138"/><rect x="11" y="22" width="3" height="2" fill="#2d3138"/></svg>`;
const FARMER_A_URI = `data:image/svg+xml;utf8,${encodeURIComponent(FARMER_A_SVG)}`;
const FARMER_B_URI = `data:image/svg+xml;utf8,${encodeURIComponent(FARMER_B_SVG)}`;

const FARM_WALKERS = [
  { id: 'walker-a', src: FARMER_A_URI, size: 28, route: 'farm-walker-route-a', duration: 22, delay: '-2s' },
  { id: 'walker-b', src: FARMER_B_URI, size: 30, route: 'farm-walker-route-b', duration: 24, delay: '-9s' },
  { id: 'walker-c', src: FARMER_A_URI, size: 26, route: 'farm-walker-route-c', duration: 20, delay: '-14s' },
];

const FARM_ABI = [
  'function plantSeed(uint256 _landId, uint8 _type) external',
  'function harvestSeed(uint256 _landId) external',
  'function levelUp() external',
  'function purchaseLand(uint256 _count) external',
  'function purchaseSeed(uint8 _type, uint256 _count) external',
  'function landPrice() view returns (uint256)',
  'function seedPrice(uint256) view returns (uint256)',
  'function expPerSeed(uint256) view returns (uint256)',
  'function ERC20_TOKEN() view returns (address)',
  'function getContractTokenBalance(address _token) view returns (uint256)',
  'function expThresholdBase() view returns (uint256)',
  'function getUserInfo(address _user) view returns (uint256 level, uint256 exp, uint256 landCount)',
  'function getUserAllLandIds(address _user) view returns (uint256[])',
  'function getUserPlantedSeed(address _user, uint256 _landId) view returns ((uint8 seedType, uint256 plantTime, uint256 baseDuration, bool isMatured, bool isHarvested))',
  'function getSeedMatureTime(address _user, uint256 _landId) view returns (uint256)',
  'function currentLotteryRound() view returns (uint256)',
  'function getUserLotteryCount(address _user, uint256 _round) view returns (uint256)',
] as const;

const TOKEN_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
] as const;

function createDefaultPlots(count = TOTAL_PLOTS): Plot[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    crop: null,
    stage: null,
    plantedAt: null,
    matureAt: null,
  }));
}

function normalizePlots(value: Plot[] | null): Plot[] {
  const base = createDefaultPlots();
  if (!value || !Array.isArray(value)) return base;
  for (let i = 0; i < Math.min(value.length, TOTAL_PLOTS); i++) {
    const item = value[i];
    if (!item || typeof item !== 'object') continue;
    base[i] = {
      id: i,
      crop: item.crop ?? null,
      stage: item.stage ?? null,
      plantedAt: item.plantedAt ?? null,
      matureAt: item.matureAt ?? null,
    };
  }
  return base;
}

function normalizeProfile(value: FarmProfile | null): FarmProfile {
  if (!value) return DEFAULT_PROFILE;
  return {
    level: Math.max(1, Number(value.level) || 1),
    exp: Math.max(0, Number(value.exp) || 0),
    items: {
      WHEAT: Math.max(0, Number(value.items?.WHEAT) || DEFAULT_PROFILE.items.WHEAT),
      CORN: Math.max(0, Number(value.items?.CORN) || DEFAULT_PROFILE.items.CORN),
      CARROT: Math.max(0, Number(value.items?.CARROT) || DEFAULT_PROFILE.items.CARROT),
    },
    tools: {
      hoe: Math.max(0, Number(value.tools?.hoe) || DEFAULT_PROFILE.tools.hoe),
      waterCan: Math.max(0, Number(value.tools?.waterCan) || DEFAULT_PROFILE.tools.waterCan),
      fertilizer: Math.max(0, Number(value.tools?.fertilizer) || DEFAULT_PROFILE.tools.fertilizer),
    },
  };
}

function getStageByAge(crop: CropType, age: number): GrowthStage {
  const t = CROP_CONFIG[crop].timings;
  if (age >= t.ripe) return 'RIPE';
  if (age >= t.mature) return 'MATURE';
  if (age >= t.sprout) return 'SPROUT';
  return 'SEED';
}

function formatTokenAmount(raw: bigint, decimals: number): string {
  const full = ethers.formatUnits(raw, decimals);
  const [intPart, fracPart = ''] = full.split('.');
  const trimmedFrac = fracPart.slice(0, 4).replace(/0+$/, '');
  return trimmedFrac ? `${intPart}.${trimmedFrac}` : intPart;
}

function formatCountdown(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSec = Math.floor(safeMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function cropToSeedType(crop: CropType): SeedType {
  if (crop === 'WHEAT') return 1;
  if (crop === 'CORN') return 2;
  return 3;
}

function seedTypeToCrop(seedType: number): CropType | null {
  if (seedType === 1) return 'WHEAT';
  if (seedType === 2) return 'CORN';
  if (seedType === 3) return 'CARROT';
  return null;
}

function seedTypeToPriceIndex(seedType: SeedType): number {
  return seedType - 1;
}

function cropLabel(crop: CropType): string {
  return CROP_LABELS[crop] ?? crop;
}

function stageLabel(stage: GrowthStage): string {
  if (stage === 'SEED') return '种子';
  if (stage === 'SPROUT') return '发芽';
  if (stage === 'MATURE') return '成熟';
  return '可收获';
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'shortMessage' in error && typeof (error as { shortMessage?: unknown }).shortMessage === 'string') {
    return (error as { shortMessage: string }).shortMessage;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function isTransientRpcError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();
  return (
    message.includes('missing response for request') ||
    message.includes('timeout') ||
    message.includes('network error') ||
    message.includes('failed to fetch') ||
    message.includes('socket hang up') ||
    message.includes('429')
  );
}

async function withRpcRetry<T>(call: () => Promise<T>, attempts = 3, baseDelayMs = 220): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
      const canRetry = i < attempts - 1 && isTransientRpcError(error);
      if (!canRetry) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (i + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseErrorMessage(error: unknown): string {
  const message = extractErrorMessage(error);
  if (message.toLowerCase().includes('missing response for request')) {
    return 'RPC 无响应（节点拥堵或限流），请稍后重试';
  }
  return message;
}

async function submitFarmIntentToContract(intent: FarmIntent, landId: number): Promise<void> {
  if (!window.ethereum) {
    throw new Error('未检测到钱包，请先安装并连接 MetaMask');
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const contract = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_ABI, signer);

  if (intent.action === 'PLANT') {
    const tx = await contract.plantSeed(landId, cropToSeedType(intent.crop));
    await tx.wait();
    return;
  }

  const tx = await contract.harvestSeed(landId);
  await tx.wait();
}

async function submitLevelUpToContract(): Promise<void> {
  if (!window.ethereum) {
    throw new Error('未检测到钱包，请先安装并连接 MetaMask');
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const contract = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_ABI, signer);
  const tx = await contract.levelUp();
  await tx.wait();
}

function PixelPlant(props: { stage: GrowthStage | null; crop: CropType | null }) {
  const { stage, crop } = props;
  if (!stage || !crop) return null;

  const conf = CROP_CONFIG[crop];
  if (stage === 'SEED') {
    return <div style={{ width: 4, height: 4, background: conf.seedColor, boxShadow: `4px 0 ${conf.seedColor}, 2px 4px ${conf.seedColor}` }} />;
  }
  if (stage === 'SPROUT') {
    return <div style={{ width: 4, height: 4, background: conf.stemColor, boxShadow: `0 -4px ${conf.stemColor}, -4px -8px ${conf.stemColor}, 4px -8px ${conf.stemColor}` }} />;
  }
  if (stage === 'MATURE') {
    return (
      <div
        style={{
          width: 4,
          height: 4,
          background: conf.stemColor,
          boxShadow: `0 -4px ${conf.stemColor}, 0 -8px ${conf.stemColor}, -4px -12px ${conf.stemColor}, 4px -12px ${conf.stemColor}, -8px -16px ${conf.stemColor}, 0 -16px ${conf.stemColor}, 8px -16px ${conf.stemColor}`,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: 6,
        height: 6,
        background: conf.ripeColor,
        boxShadow: `6px 0 ${conf.ripeColor}, 3px -6px ${conf.ripeColor}, 3px 6px ${conf.ripeColor}, -3px -6px ${conf.ripeColor}, -3px 6px ${conf.ripeColor}, 0 -12px ${conf.stemColor}`,
      }}
    />
  );
}

function SpriteIcon(props: { name: SpriteName; size?: number; style?: CSSProperties }) {
  const { name, size = 16, style } = props;
  const frame = SPRITE_FRAMES[name];
  const scale = size / SPRITE_TILE;
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        backgroundImage: `url(${SPRITE_SHEET_PATH})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${SPRITE_SHEET_SIZE * scale}px ${SPRITE_SHEET_SIZE * scale}px`,
        backgroundPosition: `-${frame.x * scale}px -${frame.y * scale}px`,
        imageRendering: 'pixelated',
        ...style,
      }}
    />
  );
}

function FarmPanelTitle(props: { label: string; icon: SpriteName; tone: 'mint' | 'sky' | 'sun' | 'soil' }) {
  const { label, icon, tone } = props;
  const toneBg: Record<'mint' | 'sky' | 'sun' | 'soil', string> = {
    mint: '#e8ffd4',
    sky: '#e3f4ff',
    sun: '#fff4c5',
    soil: '#f8e7cf',
  };
  const toneBorder: Record<'mint' | 'sky' | 'sun' | 'soil', string> = {
    mint: '#8cb376',
    sky: '#82a9ca',
    sun: '#caa95c',
    soil: '#b59263',
  };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 10,
        padding: '6px 8px',
        border: `1px solid ${toneBorder[tone]}`,
        background: `linear-gradient(180deg, ${toneBg[tone]}, rgba(255,255,255,0.8))`,
      }}
    >
      <SpriteIcon name={icon} size={14} />
      <span
        style={{
          color: '#355537',
          fontSize: 10,
          letterSpacing: 0.08,
          fontFamily: "'Press Start 2P', cursive",
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function FarmingPage(props: { ownedTokens: number[]; account: string | null }) {
  const { ownedTokens, account } = props;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedSeed, setSelectedSeed] = useState<CropType>('WHEAT');
  const [plots, setPlots] = useState<Plot[]>(() => normalizePlots(loadFromStorage<Plot[]>(PLOTS_KEY)));
  const [profile, setProfile] = useState<FarmProfile>(() => normalizeProfile(loadFromStorage<FarmProfile>(PROFILE_KEY)));
  const [plotLandIds, setPlotLandIds] = useState<Array<number | null>>(() => Array.from({ length: TOTAL_PLOTS }, () => null));
  const [pendingPlotId, setPendingPlotId] = useState<number | null>(null);
  const [seedEmptyDialogOpen, setSeedEmptyDialogOpen] = useState(false);
  const [guideDialogOpen, setGuideDialogOpen] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [loadingFarm, setLoadingFarm] = useState(false);
  const [farmErr, setFarmErr] = useState<string | null>(null);
  const [expThresholdBase, setExpThresholdBase] = useState(120);
  const [landPriceRaw, setLandPriceRaw] = useState<bigint | null>(null);
  const [seedPriceRaw, setSeedPriceRaw] = useState<Record<CropType, bigint>>({
    WHEAT: 0n,
    CORN: 0n,
    CARROT: 0n,
  });
  const [seedExpRaw, setSeedExpRaw] = useState<Record<CropType, number>>(DEFAULT_SEED_EXP);
  const [prizePoolRaw, setPrizePoolRaw] = useState<bigint | null>(null);
  const [loadingPrizePool, setLoadingPrizePool] = useState(false);
  const [prizePoolErr, setPrizePoolErr] = useState<string | null>(null);
  const [landPurchaseCount, setLandPurchaseCount] = useState(1);
  const [seedPurchaseCount, setSeedPurchaseCount] = useState(1);
  const [isPurchasingLand, setIsPurchasingLand] = useState(false);
  const [isPurchasingSeed, setIsPurchasingSeed] = useState(false);
  const [holding, setHolding] = useState<TokenHolding | null>(null);
  const [loadingHolding, setLoadingHolding] = useState(false);
  const [holdingErr, setHoldingErr] = useState<string | null>(null);
  const [totalLandOwned, setTotalLandOwned] = useState(0);
  const [currentLotteryRound, setCurrentLotteryRound] = useState<number | null>(null);
  const [currentRoundTickets, setCurrentRoundTickets] = useState<number | null>(null);
  const farmSyncSeqRef = useRef(0);
  const farmSyncInFlightRef = useRef(false);
  const prizePoolSyncInFlightRef = useRef(false);
  const holdingSyncInFlightRef = useRef(false);
  const isChainMode = Boolean(account);

  useEffect(() => {
    saveToStorage(PLOTS_KEY, plots);
  }, [plots]);

  useEffect(() => {
    saveToStorage(PROFILE_KEY, profile);
  }, [profile]);

  useEffect(() => {
    const tick = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    const timer = setInterval(() => {
      setPlots((prev) =>
        prev.map((plot) => {
          if (!plot.crop || !plot.plantedAt || plot.stage === 'RIPE') return plot;
          const now = Date.now();
          let nextStage: GrowthStage;

          if (plot.matureAt && plot.matureAt > plot.plantedAt) {
            if (now >= plot.matureAt) {
              nextStage = 'RIPE';
            } else {
              const ratio = (now - plot.plantedAt) / Math.max(1, plot.matureAt - plot.plantedAt);
              if (ratio >= 0.66) nextStage = 'MATURE';
              else if (ratio >= 0.33) nextStage = 'SPROUT';
              else nextStage = 'SEED';
            }
          } else {
            nextStage = getStageByAge(plot.crop, now - plot.plantedAt);
          }

          return nextStage === plot.stage ? plot : { ...plot, stage: nextStage };
        }),
      );
    }, 1000);
    return () => {
      clearInterval(tick);
      clearInterval(timer);
    };
  }, []);

  const syncFarmFromChain = useCallback(async () => {
    if (farmSyncInFlightRef.current) return;
    farmSyncInFlightRef.current = true;

    const syncSeq = ++farmSyncSeqRef.current;
    if (!account) {
      if (syncSeq === farmSyncSeqRef.current) {
        setLoadingFarm(false);
        setFarmErr(null);
        setPlotLandIds(Array.from({ length: TOTAL_PLOTS }, () => null));
        setTotalLandOwned(0);
        setCurrentLotteryRound(null);
        setCurrentRoundTickets(null);
      }
      farmSyncInFlightRef.current = false;
      return;
    }

    setLoadingFarm(true);
    setFarmErr(null);
    try {
      const provider = getReadProvider();
      const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_ABI, provider);

      const [
        userInfoRaw,
        landIdsRaw,
        thresholdRaw,
        landPriceValue,
        wheatSeedPrice,
        cornSeedPrice,
        carrotSeedPrice,
        wheatSeedExp,
        cornSeedExp,
        carrotSeedExp,
        currentRoundRaw,
      ] = await Promise.all([
        withRpcRetry(() => farm.getUserInfo(account)),
        withRpcRetry(() => farm.getUserAllLandIds(account)),
        withRpcRetry(() => farm.expThresholdBase()),
        withRpcRetry(() => farm.landPrice()),
        withRpcRetry(() => farm.seedPrice(0)),
        withRpcRetry(() => farm.seedPrice(1)),
        withRpcRetry(() => farm.seedPrice(2)),
        withRpcRetry(() => farm.expPerSeed(0)),
        withRpcRetry(() => farm.expPerSeed(1)),
        withRpcRetry(() => farm.expPerSeed(2)),
        withRpcRetry(() => farm.currentLotteryRound()),
      ]);

      const level = Number(userInfoRaw[0]);
      const exp = Number(userInfoRaw[1]);
      const landCount = Number(userInfoRaw[2] ?? 0);
      const expThreshold = Number(thresholdRaw);
      const round = Number(currentRoundRaw ?? 0n);
      let roundTickets = 0;
      if (round > 0) {
        try {
          roundTickets = Number(await withRpcRetry(() => farm.getUserLotteryCount(account, round)));
        } catch {
          roundTickets = 0;
        }
      }
      const ownedLandIds = (landIdsRaw as bigint[]).map((id) => Number(id)).filter((id) => Number.isFinite(id));
      const nextLandIds = [...ownedLandIds];
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      const nextPlots = createDefaultPlots(nextLandIds.length);

      const batchSize = 16;
      for (let i = 0; i < nextLandIds.length; i += batchSize) {
        const batch = nextLandIds.slice(i, i + batchSize);
        const batchData = await Promise.all(
          batch.map(async (landId) => {
            const [seedRaw, matureRaw] = await Promise.all([
              withRpcRetry(() => farm.getUserPlantedSeed(account, landId)),
              withRpcRetry(() => farm.getSeedMatureTime(account, landId)),
            ]);
            return { seedRaw, matureRaw };
          }),
        );

        for (let j = 0; j < batchData.length; j++) {
          const index = i + j;
          const { seedRaw, matureRaw } = batchData[j];

          const seedType = Number(seedRaw.seedType ?? seedRaw[0] ?? 0);
          const crop = seedTypeToCrop(seedType);
          const isHarvested = Boolean(seedRaw.isHarvested ?? seedRaw[4] ?? false);
          const plantTime = BigInt(seedRaw.plantTime ?? seedRaw[1] ?? 0n);

          if (!crop || isHarvested || plantTime === 0n) continue;

          const matureTime = BigInt(matureRaw ?? 0n);
          let stage: GrowthStage = 'SEED';

          if (matureTime > 0n && nowSec >= matureTime) {
            stage = 'RIPE';
          } else if (matureTime > plantTime) {
            const elapsed = Number(nowSec - plantTime);
            const total = Number(matureTime - plantTime);
            const ratio = total <= 0 ? 0 : elapsed / total;
            if (ratio >= 0.66) stage = 'MATURE';
            else if (ratio >= 0.33) stage = 'SPROUT';
          }

          nextPlots[index] = {
            id: index,
            crop,
            stage,
            plantedAt: Number(plantTime) * 1000,
            matureAt: matureTime > 0n ? Number(matureTime) * 1000 : null,
          };
        }
      }

      if (syncSeq !== farmSyncSeqRef.current) return;

      setProfile((prev) => ({
        ...prev,
        level: Math.max(1, level || 1),
        exp: Math.max(0, exp || 0),
      }));
      setTotalLandOwned(Math.max(0, landCount || 0));
      setExpThresholdBase(Math.max(1, expThreshold || 120));
      setLandPriceRaw(BigInt(landPriceValue ?? 0n));
      setSeedPriceRaw({
        WHEAT: BigInt(wheatSeedPrice ?? 0n),
        CORN: BigInt(cornSeedPrice ?? 0n),
        CARROT: BigInt(carrotSeedPrice ?? 0n),
      });
      setSeedExpRaw({
        WHEAT: Number(wheatSeedExp ?? DEFAULT_SEED_EXP.WHEAT),
        CORN: Number(cornSeedExp ?? DEFAULT_SEED_EXP.CORN),
        CARROT: Number(carrotSeedExp ?? DEFAULT_SEED_EXP.CARROT),
      });
      setCurrentLotteryRound(round > 0 ? round : null);
      setCurrentRoundTickets(Math.max(0, roundTickets || 0));
      setPlotLandIds(nextLandIds);
      setPlots(nextPlots);
    } catch (error) {
      if (syncSeq === farmSyncSeqRef.current) {
        setFarmErr(parseErrorMessage(error));
      }
    } finally {
      if (syncSeq === farmSyncSeqRef.current) {
        setLoadingFarm(false);
      }
      farmSyncInFlightRef.current = false;
    }
  }, [account]);

  const syncPrizePoolFromChain = useCallback(async () => {
    if (prizePoolSyncInFlightRef.current) return;
    prizePoolSyncInFlightRef.current = true;

    setLoadingPrizePool(true);
    setPrizePoolErr(null);
    try {
      const provider = getReadProvider();
      const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_ABI, provider);

      const tokenCandidates: string[] = [];
      try {
        const onChainToken = (await withRpcRetry(() => farm.ERC20_TOKEN())) as string;
        if (/^0x[a-fA-F0-9]{40}$/.test(onChainToken) && onChainToken !== ethers.ZeroAddress) {
          tokenCandidates.push(onChainToken);
        }
      } catch {
        // fallback to configured token address
      }

      if (/^0x[a-fA-F0-9]{40}$/.test(CHAIN_CONFIG.tokenAddress) && CHAIN_CONFIG.tokenAddress !== ethers.ZeroAddress) {
        tokenCandidates.push(CHAIN_CONFIG.tokenAddress);
      }

      const uniqueCandidates = Array.from(new Set(tokenCandidates));
      if (uniqueCandidates.length === 0) {
        throw new Error('未配置可用的代币地址，无法读取奖池');
      }

      let lastError: unknown = null;
      for (const tokenAddress of uniqueCandidates) {
        try {
          const contractTokenBalance = BigInt(await withRpcRetry(() => farm.getContractTokenBalance(tokenAddress)));
          setPrizePoolRaw(contractTokenBalance);
          return;
        } catch (firstError) {
          try {
            const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
            const fallbackBalance = BigInt(await withRpcRetry(() => token.balanceOf(CHAIN_CONFIG.farmAddress)));
            setPrizePoolRaw(fallbackBalance);
            return;
          } catch (secondError) {
            lastError = secondError ?? firstError;
          }
        }
      }

      throw lastError ?? new Error('读取奖池失败');
    } catch (error) {
      setPrizePoolErr(parseErrorMessage(error));
    } finally {
      setLoadingPrizePool(false);
      prizePoolSyncInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isChainMode) return;
    void syncFarmFromChain();
  }, [isChainMode, syncFarmFromChain]);

  useEffect(() => {
    if (!isChainMode) {
      setPrizePoolRaw(null);
      setPrizePoolErr(null);
      setLoadingPrizePool(false);
      return;
    }
    void syncPrizePoolFromChain();
  }, [isChainMode, syncPrizePoolFromChain]);

  const syncHoldingFromChain = useCallback(async () => {
    if (holdingSyncInFlightRef.current) return;
    holdingSyncInFlightRef.current = true;

    if (!account) {
      setHolding(null);
      setHoldingErr(null);
      setLoadingHolding(false);
      holdingSyncInFlightRef.current = false;
      return;
    }

    setLoadingHolding(true);
    setHoldingErr(null);
    try {
      const provider = getReadProvider();
      const contract = new ethers.Contract(CHAIN_CONFIG.tokenAddress, TOKEN_ABI, provider);

      let decimals = 18;
      let symbol = '代币';
      try {
        decimals = Number(await withRpcRetry(() => contract.decimals()));
      } catch {
        // fallback defaults
      }
      try {
        symbol = await withRpcRetry(() => contract.symbol());
      } catch {
        // fallback defaults
      }

      const raw = (await withRpcRetry(() => contract.balanceOf(account))) as bigint;
      setHolding({
        raw,
        decimals,
        symbol,
        formatted: formatTokenAmount(raw, decimals),
      });
    } catch (e) {
      setHoldingErr(parseErrorMessage(e));
    } finally {
      setLoadingHolding(false);
      holdingSyncInFlightRef.current = false;
    }
  }, [account]);

  useEffect(() => {
    void syncHoldingFromChain();
  }, [syncHoldingFromChain]);

  const expToNext = useMemo(() => profile.level * expThresholdBase, [expThresholdBase, profile.level]);
  const canUpgrade = isChainMode && profile.exp >= expToNext;
  const progressPct = Math.min(100, Math.round((profile.exp / expToNext) * 100));
  const itemTotal = profile.items.WHEAT + profile.items.CORN + profile.items.CARROT;
  const toolTotal = profile.tools.hoe + profile.tools.waterCan + profile.tools.fertilizer;
  const chainPlantedByType = useMemo<Record<CropType, number>>(
    () =>
      plots.reduce(
        (acc, plot) => {
          if (plot.crop) acc[plot.crop] += 1;
          return acc;
        },
        { WHEAT: 0, CORN: 0, CARROT: 0 },
      ),
    [plots],
  );
  const displayItems = isChainMode ? chainPlantedByType : profile.items;
  const displayItemTotal = displayItems.WHEAT + displayItems.CORN + displayItems.CARROT;
  const plantedCount = plots.filter((p) => p.crop).length;
  const usablePlotCount = plotLandIds.filter((landId) => landId !== null).length;
  const ripeCount = plots.filter((p) => p.stage === 'RIPE').length;
  const selectedSeedCount = profile.items[selectedSeed];
  const selectedSeedEmpty = !isChainMode && selectedSeedCount <= 0;
  const expSegmentCount = 14;
  const filledExpSegments = Math.max(0, Math.min(expSegmentCount, Math.round((progressPct / 100) * expSegmentCount)));
  const tokenDecimals = holding?.decimals ?? 18;
  const tokenSymbol = holding?.symbol ?? '代币';
  const selectedSeedType = cropToSeedType(selectedSeed);
  const selectedSeedUnitPrice = seedPriceRaw[selectedSeed] ?? 0n;
  const landTotalCost = landPriceRaw ? landPriceRaw * BigInt(landPurchaseCount) : null;
  const seedTotalCost = selectedSeedUnitPrice > 0n ? selectedSeedUnitPrice * BigInt(seedPurchaseCount) : null;
  const hasAnyLand = !isChainMode || usablePlotCount > 0;

  const ensureTokenAllowance = useCallback(
    async (requiredAmount: bigint) => {
      if (!window.ethereum) throw new Error('未检测到钱包，请先安装并连接 MetaMask');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const owner = await signer.getAddress();
      const token = new ethers.Contract(CHAIN_CONFIG.tokenAddress, TOKEN_ABI, signer);
      const allowance = (await token.allowance(owner, CHAIN_CONFIG.farmAddress)) as bigint;
      if (allowance >= requiredAmount) return;
      const approveTx = await token.approve(CHAIN_CONFIG.farmAddress, ethers.MaxUint256);
      await approveTx.wait();
    },
    [],
  );

  const handlePlotClick = async (plotId: number) => {
    if (pendingPlotId !== null) return;
    const current = plots.find((p) => p.id === plotId);
    if (!current) return;
    const landId = plotLandIds[plotId];
    if (isChainMode && landId === null) return;

    if (!isChainMode && !current.crop && profile.items[selectedSeed] <= 0) {
      setSeedEmptyDialogOpen(true);
      return;
    }

    if (current.stage === 'RIPE' && current.crop) {
      const harvestedCrop: CropType = current.crop;
      const intent: FarmIntent = { action: 'HARVEST', plotId, crop: harvestedCrop, createdAt: Date.now() };
      try {
        setPendingPlotId(plotId);
        if (isChainMode) {
          await submitFarmIntentToContract(intent, landId as number);
          await syncFarmFromChain();
        } else {
          setProfile((prev) => ({
            ...prev,
            exp: prev.exp + 20,
            items: { ...prev.items, [harvestedCrop]: prev.items[harvestedCrop] + 1 },
          }));
          setPlots((prev) => prev.map((p) => (p.id === plotId ? { ...p, crop: null, stage: null, plantedAt: null, matureAt: null } : p)));
        }
      } catch (error) {
        window.alert(`收获失败: ${parseErrorMessage(error)}`);
      } finally {
        setPendingPlotId(null);
      }
      return;
    }

    if (!current.crop && (isChainMode || profile.items[selectedSeed] > 0)) {
      const intent: FarmIntent = { action: 'PLANT', plotId, crop: selectedSeed, createdAt: Date.now() };
      try {
        setPendingPlotId(plotId);
        if (isChainMode) {
          await submitFarmIntentToContract(intent, landId as number);
          await syncFarmFromChain();
        } else {
          setProfile((prev) => ({
            ...prev,
            exp: prev.exp + 3,
            items: { ...prev.items, [selectedSeed]: Math.max(0, prev.items[selectedSeed] - 1) },
          }));
          setPlots((prev) =>
            prev.map((p) =>
              p.id === plotId
                ? {
                    ...p,
                    crop: selectedSeed,
                    stage: 'SEED',
                    plantedAt: Date.now(),
                    matureAt: Date.now() + CROP_CONFIG[selectedSeed].timings.ripe,
                  }
                : p,
            ),
          );
        }
      } catch (error) {
        window.alert(`种植失败: ${parseErrorMessage(error)}`);
      } finally {
        setPendingPlotId(null);
      }
    }
  };

  const handleUpgrade = async () => {
    if (!account) {
      window.alert('请先连接钱包');
      return;
    }
    if (profile.exp < expToNext) return;
    setIsUpgrading(true);
    try {
      await submitLevelUpToContract();
      await Promise.all([syncFarmFromChain(), syncHoldingFromChain(), syncPrizePoolFromChain()]);
    } catch (error) {
      window.alert(`升级失败: ${parseErrorMessage(error)}`);
    } finally {
      setIsUpgrading(false);
    }
  };

  const handlePurchaseLand = async () => {
    if (!account) {
      window.alert('请先连接钱包');
      return;
    }
    const count = Math.max(1, Math.floor(landPurchaseCount));
    setLandPurchaseCount(count);
    setIsPurchasingLand(true);
    try {
      if (!window.ethereum) throw new Error('未检测到钱包，请先安装并连接 MetaMask');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_ABI, signer);

      const unitPrice = landPriceRaw ?? BigInt(await farm.landPrice());
      const totalCost = unitPrice * BigInt(count);
      await ensureTokenAllowance(totalCost);

      const tx = await farm.purchaseLand(count);
      const receipt = await tx.wait();

      // Optimistically fill newly purchased land ids from tx logs, so grid updates immediately.
      const purchasedIds: number[] = [];
      if (receipt) {
        for (const log of receipt.logs) {
          try {
            const parsed = farm.interface.parseLog(log);
            if (parsed && parsed.name === 'LandPurchased') {
              const ids = (parsed.args?.[3] as bigint[] | undefined) ?? [];
              for (const id of ids) {
                const n = Number(id);
                if (Number.isFinite(n)) purchasedIds.push(n);
              }
            }
          } catch {
            // ignore non-farm logs
          }
        }
      }
      if (purchasedIds.length > 0) {
        setPlots((prev) => {
          const existing = prev.length;
          const target = existing + purchasedIds.length;
          if (target <= existing) return prev;
          const next = [...prev];
          for (let i = existing; i < target; i++) {
            next.push({
              id: i,
              crop: null,
              stage: null,
              plantedAt: null,
              matureAt: null,
            });
          }
          return next;
        });
        setPlotLandIds((prev) => {
          const next = [...prev];
          for (const id of purchasedIds) {
            if (!next.includes(id)) {
              next.push(id);
            }
          }
          return next;
        });
        setTotalLandOwned((prev) => prev + purchasedIds.length);
      }

      await Promise.all([syncFarmFromChain(), syncHoldingFromChain(), syncPrizePoolFromChain()]);
      setTimeout(() => {
        void Promise.all([syncFarmFromChain(), syncPrizePoolFromChain()]);
      }, 1500);
    } catch (error) {
      window.alert(`购买土地失败: ${parseErrorMessage(error)}`);
    } finally {
      setIsPurchasingLand(false);
    }
  };

  const handlePurchaseSeed = async () => {
    if (!account) {
      window.alert('请先连接钱包');
      return;
    }
    const count = Math.max(1, Math.floor(seedPurchaseCount));
    setSeedPurchaseCount(count);
    setIsPurchasingSeed(true);
    try {
      if (!window.ethereum) throw new Error('未检测到钱包，请先安装并连接 MetaMask');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_ABI, signer);

      const priceIndex = seedTypeToPriceIndex(selectedSeedType);
      const unitPrice = selectedSeedUnitPrice > 0n ? selectedSeedUnitPrice : BigInt(await farm.seedPrice(priceIndex));
      const totalCost = unitPrice * BigInt(count);
      await ensureTokenAllowance(totalCost);

      const tx = await farm.purchaseSeed(selectedSeedType, count);
      await tx.wait();
      await Promise.all([syncHoldingFromChain(), syncPrizePoolFromChain(), syncFarmFromChain()]);
    } catch (error) {
      window.alert(`购买种子失败: ${parseErrorMessage(error)}`);
    } finally {
      setIsPurchasingSeed(false);
    }
  };

  return (
    <div
      className="farm-page-shell"
      style={{
        width: '100%',
        minHeight: '100%',
        padding: '18px 14px 32px',
        boxSizing: 'border-box',
        color: '#2f4a31',
        fontFamily: "'Space Mono', monospace",
        background:
          'radial-gradient(circle at 18% 10%, rgba(255,255,255,0.5), transparent 25%), radial-gradient(circle at 82% 8%, rgba(255,255,255,0.45), transparent 20%), linear-gradient(180deg, #8fd3ff 0%, #bdf0ff 36%, #b6eb86 36%, #9fd974 100%)',
      }}
    >
      <div className="farm-page-content" style={{ maxWidth: 1520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <section
          className="farm-card farm-hero-card ga-card-surface"
          style={{
            padding: '12px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                color: '#355537',
                fontFamily: "'Press Start 2P', cursive",
                fontSize: 'clamp(16px, 2.1vw, 24px)',
                lineHeight: 1.3,
              }}
            >
              阳光农场 // 3x3
            </h1>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
              点击空地种植，成熟后再次点击收获
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
            <div className="ga-chip farm-chip">
              已种植 {plantedCount}/{isChainMode ? usablePlotCount : TOTAL_PLOTS}
            </div>
            <div className="ga-chip farm-chip farm-chip-warn">
              可收获 {ripeCount}
            </div>
            <div className="ga-chip farm-chip farm-chip-info">
              等级 {profile.level}
            </div>
            <div className="ga-chip farm-chip">
              {isChainMode ? '链上: 已连接' : '模式: 本地演示'}
            </div>
            <button
              className="farm-harvest-btn ga-btn"
              onClick={() => setGuideDialogOpen(true)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
              }}
            >
              玩法指南
            </button>
          </div>
        </section>

        <section className="farm-kpi-grid">
          <article className="farm-kpi-card ga-card-surface">
            <div className="farm-kpi-label">地块</div>
            <div className="farm-kpi-value">{plantedCount}/{isChainMode ? usablePlotCount : TOTAL_PLOTS}</div>
            <div className="farm-kpi-sub">已启用农田</div>
          </article>
          <article className="farm-kpi-card ga-card-surface">
            <div className="farm-kpi-label">可收获</div>
            <div className="farm-kpi-value">{ripeCount}</div>
            <div className="farm-kpi-sub">当前可收获数量</div>
          </article>
          <article className="farm-kpi-card ga-card-surface">
            <div className="farm-kpi-label">等级</div>
            <div className="farm-kpi-value">等级 {profile.level}</div>
            <div className="farm-kpi-sub">进度 {progressPct}%</div>
          </article>
          <article className="farm-kpi-card ga-card-surface">
            <div className="farm-kpi-label">库存</div>
            <div className="farm-kpi-value">{displayItemTotal}</div>
            <div className="farm-kpi-sub">
              {isChainMode ? `链上种植数 / 彩票 ${currentRoundTickets ?? '--'}` : `道具 / 工具 ${toolTotal}`}
            </div>
          </article>
        </section>

        <section className="farm-card farm-seed-panel ga-card-surface" style={{ padding: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {(['WHEAT', 'CORN', 'CARROT'] as CropType[]).map((seed) => {
              const seedUnitPrice = seedPriceRaw[seed] ?? 0n;
              const seedExp = seedExpRaw[seed] ?? DEFAULT_SEED_EXP[seed];
              const lotteryReward = LOTTERY_REWARD_PER_SEED[seed];
              return (
                <div className="seed-btn-wrap" key={seed}>
                  <button
                    className={`seed-btn ga-btn ${selectedSeed === seed ? 'is-selected' : ''}`}
                    onClick={() => setSelectedSeed(seed)}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      opacity: isChainMode || profile.items[seed] > 0 ? 1 : 0.6,
                    }}
                  >
                    <SpriteIcon name={ITEM_SPRITE[seed]} size={18} />
                    {isChainMode ? cropLabel(seed) : `${cropLabel(seed)} (${profile.items[seed]})`}
                  </button>
                  <div className="seed-rule-tooltip" role="tooltip" aria-hidden="true">
                    <div className="seed-rule-title">{cropLabel(seed)} 规则</div>
                    <div>收益: 收获兑换彩票 {lotteryReward} 张</div>
                    <div>经验: +{seedExp}</div>
                    <div>
                      单价:{' '}
                      {seedUnitPrice > 0n
                        ? `${formatTokenAmount(seedUnitPrice, tokenDecimals)} ${tokenSymbol}`
                        : '--'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', fontSize: 11 }}>
            <span style={{ opacity: 0.8 }}>当前种子: {cropLabel(selectedSeed)}</span>
            <span style={{ opacity: 0.55 }}>|</span>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><PixelPlant stage="SEED" crop={selectedSeed} /> 种子</span>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><PixelPlant stage="SPROUT" crop={selectedSeed} /> 发芽</span>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><PixelPlant stage="MATURE" crop={selectedSeed} /> 成熟</span>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><PixelPlant stage="RIPE" crop={selectedSeed} /> 可收获</span>
          </div>
          {selectedSeedEmpty ? (
            <div style={{ marginTop: 8, textAlign: 'center', fontSize: 11, color: '#8b5a3a' }}>
              当前种子库存不足，请先收获或切换种子
            </div>
          ) : null}
        </section>

        <div className="farm-layout">
          <div>
            <div
              className="farm-scene"
              style={{
                width: '100%',
                aspectRatio: isChainMode ? '3 / 2' : '16 / 10',
                minHeight: isChainMode ? 'clamp(420px, 58vh, 760px)' : 'clamp(380px, 52vh, 680px)',
                position: 'relative',
                border: '3px solid #7aa852',
                borderRadius: 10,
                overflow: 'hidden',
                boxShadow: '0 10px 20px rgba(66, 101, 58, 0.2)',
                background: 'linear-gradient(180deg, #79ccff 0%, #79ccff 34%, #a8ef77 34%, #95e36b 100%)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 10,
                  top: 10,
                  zIndex: 12,
                  minWidth: 188,
                  maxWidth: '42%',
                  padding: '7px 9px',
                  border: '2px solid #d4a13f',
                  borderRadius: 6,
                  background: 'linear-gradient(180deg, rgba(255,245,199,0.95), rgba(255,229,147,0.9))',
                  boxShadow: '0 2px 0 rgba(145,96,31,0.35), inset 0 0 0 1px rgba(255,255,255,0.45)',
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 9,
                    lineHeight: 1.2,
                    fontFamily: "'Press Start 2P', cursive",
                    color: '#7a4a1f',
                    textTransform: 'uppercase',
                  }}
                >
                  <SpriteIcon name="flower_white" size={12} />
                  奖池(合约余额)
                </div>
                <div style={{ marginTop: 5, fontSize: 13, fontWeight: 800, color: '#5b350e', wordBreak: 'break-all' }}>
                  {loadingPrizePool ? '加载中...' : prizePoolRaw !== null ? `${formatTokenAmount(prizePoolRaw, tokenDecimals)} ${tokenSymbol}` : '--'}
                </div>
                {prizePoolErr ? (
                  <div style={{ marginTop: 4, fontSize: 9, color: '#b91c1c', lineHeight: 1.2 }}>
                    读取失败: {prizePoolErr}
                  </div>
                ) : null}
              </div>

              <div
                style={{
                  position: 'absolute',
                  left: '7%',
                  top: '58%',
                  width: '86%',
                  height: '8%',
                  background: '#ecd997',
                  border: '2px solid #d6c07f',
                  borderRadius: 2,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: '47%',
                  top: '37%',
                  width: '6%',
                  height: '45%',
                  background: '#ecd997',
                  border: '2px solid #d6c07f',
                  borderRadius: 2,
                }}
              />

              {CLOUD_DECOR.map((c, i) => (
                <img
                  key={`${c.left}-${c.top}-${i}`}
                  src="/static/assets/farm/cloud-pixel.svg"
                  alt=""
                  style={{
                    position: 'absolute',
                    left: c.left,
                    top: c.top,
                    width: 96,
                    height: 40,
                    imageRendering: 'pixelated',
                    transform: `translate(-50%, -50%) scale(${c.scale})`,
                    animation: `farm-cloud-drift ${c.speed}s linear infinite`,
                    pointerEvents: 'none',
                  }}
                />
              ))}

              {TREE_DECOR.map((t, i) => (
                <img
                  key={`${t.left}-${t.top}-${i}`}
                  src="/static/assets/farm/tree-pixel.svg"
                  alt=""
                  style={{
                    position: 'absolute',
                    left: t.left,
                    top: t.top,
                    width: 52,
                    height: 60,
                    imageRendering: 'pixelated',
                    transform: `translate(-50%, -50%) scale(${t.scale})`,
                    pointerEvents: 'none',
                  }}
                />
              ))}

              {FLOWER_DECOR.map((f, i) => (
                <div
                  key={`${f.left}-${f.top}-${i}`}
                  style={{
                    position: 'absolute',
                    left: f.left,
                    top: f.top,
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                  }}
                >
                  <SpriteIcon name={i % 3 === 0 ? 'flower_white' : 'flower_red'} size={18} />
                </div>
              ))}

              {GRASS_DECOR.map((g, i) => (
                <div
                  key={`${g.left}-${g.top}-${i}`}
                  style={{
                    position: 'absolute',
                    left: g.left,
                    top: g.top,
                    transform: 'translate(-50%, -50%)',
                    opacity: 0.85,
                    pointerEvents: 'none',
                  }}
                >
                  <SpriteIcon name="tuft" size={Math.round(16 * g.scale)} />
                </div>
              ))}

              {ROCK_DECOR.map((r, i) => (
                <div
                  key={`${r.left}-${r.top}-${i}`}
                  style={{
                    position: 'absolute',
                    left: r.left,
                    top: r.top,
                    transform: 'translate(-50%, -50%)',
                    opacity: 0.95,
                    pointerEvents: 'none',
                  }}
                >
                  <SpriteIcon name={r.sprite} size={Math.round(18 * r.scale)} />
                </div>
              ))}

              {FARM_WALKERS.map((w) => (
                <div
                  key={w.id}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: w.size,
                    height: Math.round(w.size * 1.2),
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                    zIndex: 5,
                    animation: `${w.route} ${w.duration}s linear infinite`,
                    animationDelay: w.delay,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: -2,
                      width: '60%',
                      height: 4,
                      borderRadius: 999,
                      transform: 'translateX(-50%)',
                      background: 'rgba(34, 48, 34, 0.3)',
                    }}
                  />
                  <img
                    src={w.src}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      imageRendering: 'pixelated',
                      animation: 'farm-walker-bob .55s steps(2, end) infinite',
                    }}
                  />
                </div>
              ))}

              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '64%',
                  transform: 'translate(-50%, -50%)',
                  width: isChainMode ? 'min(86%, 980px)' : 'min(72%, 760px)',
                  border: '4px solid #9a6a3b',
                  borderRadius: 6,
                  background: '#875430',
                  padding: 12,
                  maxHeight: isChainMode ? '66%' : undefined,
                  overflowY: isChainMode ? 'auto' : 'visible',
                  boxShadow: 'inset 0 0 0 2px rgba(66,41,23,0.55)',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 8,
                    right: 8,
                    top: -10,
                    display: 'flex',
                    justifyContent: 'space-between',
                    pointerEvents: 'none',
                  }}
                >
                  {Array.from({ length: 10 }, (_, i) => (
                    <SpriteIcon key={`fence-top-${i}`} name="fence_h" size={14} />
                  ))}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    left: 8,
                    right: 8,
                    bottom: -10,
                    display: 'flex',
                    justifyContent: 'space-between',
                    pointerEvents: 'none',
                  }}
                >
                  {Array.from({ length: 10 }, (_, i) => (
                    <SpriteIcon key={`fence-bottom-${i}`} name="fence_h" size={14} />
                  ))}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    top: 8,
                    bottom: 8,
                    left: -10,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    pointerEvents: 'none',
                  }}
                >
                  {Array.from({ length: 6 }, (_, i) => (
                    <SpriteIcon key={`fence-left-${i}`} name="fence_v" size={14} />
                  ))}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    top: 8,
                    bottom: 8,
                    right: -10,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    pointerEvents: 'none',
                  }}
                >
                  {Array.from({ length: 6 }, (_, i) => (
                    <SpriteIcon key={`fence-right-${i}`} name="fence_v" size={14} />
                  ))}
                </div>

                {!hasAnyLand ? (
                  <div
                    style={{
                      minHeight: 140,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: "'Press Start 2P', cursive",
                      fontSize: 10,
                      color: '#f7f5d3',
                      border: '1px dashed rgba(255,255,255,0.35)',
                      background: 'rgba(0,0,0,0.22)',
                    }}
                  >
                    暂无土地
                  </div>
                ) : (
                  <div
                    style={{
                      width: '100%',
                      margin: '0 auto',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 118px))',
                      gap: 8,
                      justifyContent: 'center',
                      justifyItems: 'center',
                      alignItems: 'start',
                    }}
                  >
                    {plots.map((plot) => {
                    const landId = plotLandIds[plot.id];
                    const hasLand = !isChainMode || landId !== null;
                    const isBusy = pendingPlotId === plot.id || (isChainMode && loadingFarm);
                    const targetMatureAt =
                      plot.crop && plot.stage !== 'RIPE'
                        ? (plot.matureAt ?? (plot.plantedAt ? plot.plantedAt + CROP_CONFIG[plot.crop].timings.ripe : null))
                        : null;
                    const remainingMs = targetMatureAt !== null ? targetMatureAt - nowMs : null;
                      return (
                      <button
                        className="farm-plot-btn"
                        key={plot.id}
                        onClick={() => void handlePlotClick(plot.id)}
                        disabled={!hasLand || isBusy}
                        title={
                          hasLand
                            ? plot.crop
                              ? `${cropLabel(plot.crop)} - ${stageLabel(plot.stage ?? 'SEED')} / 地块 #${landId ?? plot.id + 1}`
                              : `空地 #${plot.id + 1} / 地块 #${landId ?? plot.id + 1}`
                            : '该位置暂无链上土地'
                        }
                        style={{
                          border: plot.stage === 'RIPE' ? '1px solid #facc15' : '1px solid rgba(91, 52, 29, 0.6)',
                          borderRadius: 4,
                          backgroundColor: hasLand ? (plot.crop ? '#7f4f2d' : '#7a4a2b') : '#4f3a2d',
                          backgroundImage:
                            "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.06), rgba(0,0,0,0) 40%), url('/static/assets/farm/soil-tile.svg')",
                          backgroundSize: 'auto, 32px 32px',
                          imageRendering: 'pixelated',
                          cursor: hasLand && !isBusy ? 'pointer' : 'not-allowed',
                          position: 'relative',
                          width: '100%',
                          maxWidth: 118,
                          aspectRatio: '1 / 1',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: plot.stage === 'RIPE' ? '0 0 8px rgba(250, 204, 21, 0.45)' : 'inset 0 0 0 1px rgba(0,0,0,0.22)',
                          opacity: !hasLand ? 0.55 : isBusy ? 0.7 : 1,
                          transition: 'transform .08s ease-out, box-shadow .12s ease-out',
                        }}
                      >
                        <PixelPlant stage={plot.stage} crop={plot.crop} />
                        {plot.crop && plot.stage !== 'RIPE' && remainingMs !== null ? (
                          <span
                            style={{
                              position: 'absolute',
                              top: 4,
                              right: 4,
                              padding: '1px 3px',
                              fontSize: 8,
                              lineHeight: '10px',
                              color: '#ecfccb',
                              background: 'rgba(0,0,0,0.42)',
                              border: '1px solid rgba(236,252,203,0.35)',
                            }}
                          >
                            {remainingMs <= 0 ? '可收获' : formatCountdown(remainingMs)}
                          </span>
                        ) : null}
                        {plot.crop ? (
                          <span
                            style={{
                              position: 'absolute',
                              bottom: 4,
                              left: 4,
                              right: 4,
                              fontSize: 9,
                              lineHeight: '10px',
                              color: '#f8fafc',
                              background: 'rgba(0,0,0,0.35)',
                            }}
                          >
                            {cropLabel(plot.crop)}
                          </span>
                        ) : null}
                        {!hasLand ? (
                          <span
                            style={{
                              position: 'absolute',
                              inset: 'auto 4px 4px 4px',
                              fontSize: 8,
                              lineHeight: '10px',
                              color: '#f8fafc',
                              background: 'rgba(0,0,0,0.45)',
                            }}
                          >
                            无土地
                          </span>
                        ) : null}
                      </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="farm-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <section className="farm-card farm-side-panel ga-card-surface" style={{ padding: 12 }}>
              <FarmPanelTitle label="代币持仓（链上）" icon="flower_white" tone="sky" />
              <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.3 }}>
                {!account ? '--' : loadingHolding ? '加载中...' : holding ? `${holding.formatted} ${holding.symbol}` : '--'}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, wordBreak: 'break-all' }}>合约: {CHAIN_CONFIG.tokenAddress}</div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.9, wordBreak: 'break-all' }}>农场: {CHAIN_CONFIG.farmAddress}</div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.9 }}>
                钱包: {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : '未连接钱包'}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>NFT 持有数: {ownedTokens.length}</div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                农场状态: {isChainMode ? (loadingFarm ? '同步中...' : '已连接链上') : '本地演示'}
              </div>
              {holdingErr ? <div style={{ marginTop: 6, color: '#b91c1c', fontSize: 12 }}>读取失败: {holdingErr}</div> : null}
              {farmErr ? <div style={{ marginTop: 6, color: '#b91c1c', fontSize: 12 }}>农场读取失败: {farmErr}</div> : null}
            </section>

            <section className="farm-card farm-side-panel ga-card-surface" style={{ padding: 12 }}>
              <FarmPanelTitle label="链上商店" icon="seed_wheat" tone="soil" />
              <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
                先授权代币，再执行购买（授权会自动处理）
              </div>

              <div style={{ border: '1px solid #d6c6a8', padding: 8, marginBottom: 10, background: 'rgba(255, 252, 240, 0.65)' }}>
                <div style={{ fontSize: 11, marginBottom: 6, opacity: 0.85 }}>购买土地</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={landPurchaseCount}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setLandPurchaseCount(Number.isFinite(next) && next > 0 ? Math.floor(next) : 1);
                    }}
                    style={{
                      width: 72,
                      height: 32,
                      border: '1px solid #a48a63',
                      background: '#fffdf5',
                      color: '#2f4a31',
                      fontFamily: "'Space Mono', monospace",
                      padding: '0 8px',
                    }}
                  />
                  <button
                    className="ga-btn"
                    onClick={() => void handlePurchaseLand()}
                    disabled={!isChainMode || isPurchasingLand || loadingFarm}
                    style={{
                      flex: 1,
                      minHeight: 32,
                      cursor: !isChainMode || isPurchasingLand || loadingFarm ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isPurchasingLand ? '购买中...' : '购买土地'}
                  </button>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, opacity: 0.82 }}>
                  单价: {landPriceRaw !== null ? `${formatTokenAmount(landPriceRaw, tokenDecimals)} ${tokenSymbol}` : '--'}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, opacity: 0.82 }}>
                  预计总价: {landTotalCost !== null ? `${formatTokenAmount(landTotalCost, tokenDecimals)} ${tokenSymbol}` : '--'}
                </div>
              </div>

              <div style={{ border: '1px solid #d6c6a8', padding: 8, background: 'rgba(255, 252, 240, 0.65)' }}>
                <div style={{ fontSize: 11, marginBottom: 6, opacity: 0.85 }}>购买种子（当前选中: {cropLabel(selectedSeed)}）</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={seedPurchaseCount}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setSeedPurchaseCount(Number.isFinite(next) && next > 0 ? Math.floor(next) : 1);
                    }}
                    style={{
                      width: 72,
                      height: 32,
                      border: '1px solid #a48a63',
                      background: '#fffdf5',
                      color: '#2f4a31',
                      fontFamily: "'Space Mono', monospace",
                      padding: '0 8px',
                    }}
                  />
                  <button
                    className="ga-btn"
                    onClick={() => void handlePurchaseSeed()}
                    disabled={!isChainMode || isPurchasingSeed || loadingFarm}
                    style={{
                      flex: 1,
                      minHeight: 32,
                      cursor: !isChainMode || isPurchasingSeed || loadingFarm ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isPurchasingSeed ? '购买中...' : '购买种子'}
                  </button>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, opacity: 0.82 }}>
                  单价: {selectedSeedUnitPrice > 0n ? `${formatTokenAmount(selectedSeedUnitPrice, tokenDecimals)} ${tokenSymbol}` : '--'}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, opacity: 0.82 }}>
                  预计总价: {seedTotalCost !== null ? `${formatTokenAmount(seedTotalCost, tokenDecimals)} ${tokenSymbol}` : '--'}
                </div>
              </div>
            </section>

            <section className="farm-card farm-side-panel ga-card-surface" style={{ padding: 12 }}>
              <FarmPanelTitle label="道具与农场状态" icon="tuft" tone="mint" />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                <SpriteIcon name={ITEM_SPRITE.WHEAT} size={16} />
                <span>{isChainMode ? '小麦(种植中)' : '小麦'}: {displayItems.WHEAT}</span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                <SpriteIcon name={ITEM_SPRITE.CORN} size={16} />
                <span>{isChainMode ? '玉米(种植中)' : '玉米'}: {displayItems.CORN}</span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                <SpriteIcon name={ITEM_SPRITE.CARROT} size={16} />
                <span>{isChainMode ? '胡萝卜(种植中)' : '胡萝卜'}: {displayItems.CARROT}</span>
              </div>
              {isChainMode ? (
                <>
                  <div style={{ fontSize: 12, opacity: 0.82, marginBottom: 4 }}>
                    当前轮次: {currentLotteryRound ?? '--'} | 本期彩票: {currentRoundTickets ?? '--'}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.72, marginBottom: 4 }}>
                    链上合约不记录“种子背包/工具背包”数量，这里展示的是链上地块里的实时作物状态。
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, opacity: 0.82, marginBottom: 4 }}>
                  总道具: {itemTotal} | 工具: {toolTotal}
                </div>
              )}
              <div style={{ fontSize: 12, opacity: 0.82 }}>
                当前选择: {cropLabel(selectedSeed)}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.82 }}>
                可用土地: {isChainMode ? usablePlotCount : TOTAL_PLOTS}
              </div>
              {isChainMode ? (
                <div style={{ marginTop: 2, fontSize: 12, opacity: 0.82 }}>
                  总土地(链上): {totalLandOwned}
                </div>
              ) : null}
              {isChainMode && usablePlotCount === 0 ? (
                <div style={{ marginTop: 6, fontSize: 11, color: '#8b5a3a' }}>
                  当前钱包暂无土地，先在合约中购买或铸造土地
                </div>
              ) : null}
            </section>

            <section className="farm-card farm-side-panel ga-card-surface" style={{ padding: 12 }}>
              <FarmPanelTitle label="等级与经验" icon="seed_corn" tone="sun" />
              <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>等级 {profile.level}</div>
              <div style={{ fontSize: 13, marginBottom: 8 }}>经验: {profile.exp} / {expToNext}</div>
              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${expSegmentCount}, 1fr)`,
                    gap: 4,
                    padding: 4,
                    border: '1px solid #9bb8cf',
                    background: '#dff0ff',
                  }}
                >
                  {Array.from({ length: expSegmentCount }, (_, i) => (
                    <span
                      key={`exp-seg-${i}`}
                      style={{
                        height: 8,
                        background: i < filledExpSegments ? '#6fb35f' : '#bcd3e7',
                        border: '1px solid rgba(70, 112, 78, 0.35)',
                        boxSizing: 'border-box',
                      }}
                    />
                  ))}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8 }}>进度 {progressPct}%</div>
              </div>
              <button
                className="farm-upgrade-btn ga-btn"
                onClick={() => void handleUpgrade()}
                disabled={!canUpgrade || isUpgrading}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  cursor: canUpgrade && !isUpgrading ? 'pointer' : 'not-allowed',
                }}
              >
                {isUpgrading
                  ? '升级中...'
                  : !isChainMode
                    ? '连接钱包后升级'
                    : canUpgrade
                      ? '升级'
                      : `经验不足 (还差 ${expToNext - profile.exp})`}
              </button>
            </section>

            <section className="farm-card farm-side-panel ga-card-surface" style={{ padding: 12, fontSize: 12 }}>
              <FarmPanelTitle label="操作提示" icon="rock_small" tone="soil" />
              <div style={{ opacity: 0.85, lineHeight: 1.7 }}>
                1. 在链上商店先购买土地和种子。<br />
                2. 先选种子，再点击空地种植。<br />
                3. 地块发光时表示可收获。<br />
                4. {isChainMode ? '链上模式会发起钱包交易。' : '本地模式仅用于演示。'}<br />
                5. 点击右上角「玩法指南」查看完整规则。
              </div>
            </section>
          </aside>
        </div>

        {seedEmptyDialogOpen ? (
          <div className="farm-modal-backdrop" onClick={() => setSeedEmptyDialogOpen(false)}>
            <div
              className="farm-modal-card ga-card-surface"
              role="dialog"
              aria-modal="true"
              aria-label="种子不足提示"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="farm-modal-title">种子不足</div>
              <div className="farm-modal-text">
                当前没有「{cropLabel(selectedSeed)}」种子，无法种植。
                <br />
                请先收获作物补充库存，或切换到有库存的种子。
              </div>
              <button className="ga-btn farm-modal-btn" onClick={() => setSeedEmptyDialogOpen(false)}>
                我知道了
              </button>
            </div>
          </div>
        ) : null}

        {guideDialogOpen ? (
          <div className="farm-modal-backdrop" onClick={() => setGuideDialogOpen(false)}>
            <div
              className="farm-modal-card farm-guide-modal-card ga-card-surface"
              role="dialog"
              aria-modal="true"
              aria-label="玩法指南"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="farm-modal-title">农场玩法指南</div>
              <div className="farm-guide-content">
                <section className="farm-guide-section">
                  <h3>一、核心玩法循环</h3>
                  <p>从买地开始，到种植、收获、开奖，再到升级提速，形成完整循环。</p>
                  <ul>
                    <li>购买土地：<code>purchaseLand(count)</code></li>
                    <li>购买种子：<code>purchaseSeed(type, count)</code>（1=小麦，2=玉米，3=胡萝卜）</li>
                    <li>在你的土地上种植：<code>plantSeed(landId, type)</code></li>
                    <li>等待成熟后收获：<code>harvestSeed(landId)</code></li>
                    <li>收获后获得彩票号，参与当期开奖</li>
                    <li>累积经验并升级：<code>levelUp()</code></li>
                  </ul>
                </section>

                <section className="farm-guide-section">
                  <h3>二、新手上手步骤</h3>
                  <ul>
                    <li>连接钱包到 BSC 网络。</li>
                    <li>准备足够的测试代币。</li>
                    <li>首次操作前先授权代币给 Farm 合约（前端已自动处理授权）。</li>
                    <li>先买地，再种植，成熟后收获。</li>
                    <li>前往开奖页查看每一期中奖结果。</li>
                  </ul>
                </section>

                <section className="farm-guide-section">
                  <h3>三、种子与收益规则</h3>
                  <p>种子价值越高，收获后换得的彩票越多，经验也越高。</p>
                  <ul>
                    <li>WHEAT(1)：收获得 1 张彩票</li>
                    <li>CORN(2)：收获得 5 张彩票</li>
                    <li>CARROT(3)：收获得 10 张彩票</li>
                    <li>成熟时间基础值：<code>baseMatureTime = 6 小时</code></li>
                    <li>等级越高，成熟越快（时间系数每级约 0.95）</li>
                    <li>经验在“种植时”增加（不是收获时）：
                      小麦 +100 EXP，玉米 +500 EXP，胡萝卜 +1000 EXP
                    </li>
                  </ul>
                </section>

                <section className="farm-guide-section">
                  <h3>四、升级规则</h3>
                  <ul>
                    <li>升级条件：<code>exp &gt;= expThresholdBase * 当前等级</code></li>
                    <li>升级费用：<code>levelUpFeeBase</code>（代币支付）</li>
                    <li>升级成功后进入下一等级，后续作物成熟时间更短。</li>
                  </ul>
                </section>

                <section className="farm-guide-section">
                  <h3>五、开奖规则（每一期）</h3>
                  <ul>
                    <li>玩家收获会向当前期注入彩票号码。</li>
                    <li>满足开奖条件后调用 <code>requestLotteryDraw()</code> 请求随机数。</li>
                    <li><code>fulfillRandomWords()</code> 计算中奖号码并选出赢家。</li>
                    <li>当期奖池 <code>prizePool</code> 全部发给赢家。</li>
                    <li>期数自动 +1，进入下一轮。</li>
                  </ul>
                </section>

                <section className="farm-guide-section">
                  <h3>六、资金分配机制</h3>
                  <p>买地、买种、升级等关键付费操作都会进入资金分配逻辑 <code>_distributeFunds</code>：</p>
                  <ul>
                    <li>一部分按 <code>burnRatio</code> 销毁。</li>
                    <li>一部分按 <code>poolRatio</code> 进入奖池。</li>
                    <li>默认比例为 <strong>50% 销毁 + 50% 奖池</strong>。</li>
                  </ul>
                </section>
              </div>
              <button className="ga-btn farm-modal-btn" onClick={() => setGuideDialogOpen(false)}>
                关闭指南
              </button>
            </div>
          </div>
        ) : null}

        <style>{`
          .farm-page-shell {
            background:
              radial-gradient(circle at 14% 8%, rgba(255,255,255,0.5), transparent 26%),
              radial-gradient(circle at 80% 10%, rgba(255,255,255,0.42), transparent 22%),
              linear-gradient(180deg, #97d8ff 0%, #baf0ff 36%, #b8eb89 36%, #9fda72 100%);
          }

          .farm-page-content {
            animation: farm-page-entry .34s ease-out;
          }

          .farm-card {
            border-radius: var(--ga-card-radius);
            box-shadow: var(--ga-card-shadow);
            backdrop-filter: blur(1px);
          }

          .farm-hero-card {
            background: linear-gradient(180deg, rgba(246,255,222,0.95), rgba(234,248,201,0.9)) !important;
          }

          .farm-kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
          }

          .farm-kpi-card {
            background: linear-gradient(180deg, rgba(255,255,255,0.52), rgba(239,252,208,0.82));
            padding: 10px 12px;
          }

          .farm-kpi-label {
            font-size: 10px;
            letter-spacing: .08em;
            color: #5c7b58;
            font-family: 'Press Start 2P', cursive;
            margin-bottom: 6px;
          }

          .farm-kpi-value {
            font-size: 18px;
            color: #26472e;
            font-weight: 700;
            line-height: 1.15;
          }

          .farm-kpi-sub {
            margin-top: 4px;
            font-size: 11px;
            color: #547257;
          }

          .farm-seed-panel {
            background: linear-gradient(180deg, rgba(248,255,228,0.96), rgba(236,250,204,0.9)) !important;
          }

          .farm-side-panel {
            background: linear-gradient(180deg, rgba(255,255,255,0.78), rgba(244,255,220,0.72)) !important;
            transition: transform .14s ease, box-shadow .14s ease;
          }

          .farm-side-panel:hover {
            transform: translateY(-1px);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.45), 0 12px 20px rgba(52,81,47,0.12);
          }

          .farm-chip {
            border-radius: 4px;
            font-size: 12px;
          }

          .farm-chip-warn {
            background: linear-gradient(180deg, rgba(255, 250, 212, 0.95), rgba(249, 238, 181, 0.92));
          }

          .farm-chip-info {
            background: linear-gradient(180deg, rgba(230, 244, 255, 0.95), rgba(211, 235, 251, 0.92));
          }

          .farm-harvest-btn,
          .farm-upgrade-btn {
            min-height: 34px;
          }

          .farm-upgrade-btn {
            width: 100%;
          }

          .seed-btn {
            min-height: 38px;
            font-family: 'Press Start 2P', cursive;
            font-size: 10px;
            color: #355537;
          }

          .seed-btn-wrap {
            position: relative;
            display: inline-flex;
          }

          .seed-rule-tooltip {
            position: absolute;
            left: 50%;
            bottom: calc(100% + 8px);
            transform: translateX(-50%) translateY(4px);
            min-width: 190px;
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
            z-index: 20;
          }

          .seed-rule-title {
            font-family: 'Press Start 2P', cursive;
            color: #ffe28b;
            margin-bottom: 4px;
            font-size: 9px;
            letter-spacing: 0.05em;
          }

          .seed-btn-wrap:hover .seed-rule-tooltip,
          .seed-btn-wrap:focus-within .seed-rule-tooltip {
            opacity: 1;
            visibility: visible;
            transform: translateX(-50%) translateY(0);
          }

          .seed-btn.is-selected {
            border-color: #b7963f;
            background: linear-gradient(180deg, #fff2be 0%, #ffe28b 100%);
            color: #2f4b31;
          }

          .farm-layout {
            display: grid;
            grid-template-columns: minmax(0, 2.2fr) minmax(300px, 0.95fr);
            gap: 14px;
            align-items: start;
          }

          .farm-scene::after {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            background-image: repeating-linear-gradient(
              to bottom,
              rgba(255, 255, 255, 0.045),
              rgba(255, 255, 255, 0.045) 1px,
              transparent 1px,
              transparent 3px
            );
          }

          .farm-scene::before {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            background: radial-gradient(circle at 50% 62%, rgba(255,255,255,0.12), transparent 45%);
            mix-blend-mode: soft-light;
          }

          .seed-btn:not(:disabled):hover {
            filter: brightness(1.02);
          }

          .seed-btn:not(:disabled):active {
            transform: translateY(1px);
          }

          .farm-plot-btn:not(:disabled):hover {
            transform: translateY(-1px) scale(1.02);
          }

          .farm-plot-btn:not(:disabled):active {
            transform: translateY(1px);
          }

          .farm-sidebar {
            position: sticky;
            top: 90px;
          }

          .farm-modal-backdrop {
            position: fixed;
            inset: 0;
            z-index: 12000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 14px;
            background: rgba(20, 30, 22, 0.42);
            backdrop-filter: blur(1px);
          }

          .farm-modal-card {
            width: min(92vw, 430px);
            border: 2px solid #7ea46a;
            background: linear-gradient(180deg, rgba(249,255,228,0.98), rgba(236,248,205,0.96));
            padding: 14px 14px 12px;
          }

          .farm-modal-title {
            font-family: 'Press Start 2P', cursive;
            font-size: 12px;
            color: #355537;
            margin-bottom: 10px;
          }

          .farm-modal-text {
            font-size: 12px;
            line-height: 1.7;
            color: #3d5f3a;
            margin-bottom: 12px;
          }

          .farm-modal-btn {
            width: 100%;
            min-height: 34px;
          }

          .farm-guide-modal-card {
            width: min(94vw, 760px);
            max-height: min(86vh, 860px);
            display: flex;
            flex-direction: column;
          }

          .farm-guide-content {
            overflow-y: auto;
            margin-bottom: 10px;
            padding-right: 4px;
            font-size: 12px;
            line-height: 1.72;
            color: #355537;
          }

          .farm-guide-section + .farm-guide-section {
            margin-top: 10px;
            padding-top: 8px;
            border-top: 1px dashed rgba(102, 138, 92, 0.45);
          }

          .farm-guide-section h3 {
            margin: 0 0 6px 0;
            font-size: 12px;
            color: #2f4a31;
            font-family: 'Press Start 2P', cursive;
            line-height: 1.45;
          }

          .farm-guide-section p {
            margin: 0 0 6px 0;
          }

          .farm-guide-section ul {
            margin: 0;
            padding-left: 18px;
            display: grid;
            gap: 3px;
          }

          @media (max-width: 980px) {
            .farm-kpi-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .farm-layout {
              grid-template-columns: 1fr;
            }

            .farm-sidebar {
              position: static;
            }
          }

          @media (max-width: 560px) {
            .farm-kpi-grid {
              grid-template-columns: 1fr;
            }

            .seed-rule-tooltip {
              white-space: normal;
              min-width: 170px;
              max-width: 200px;
            }
          }

          @keyframes farm-page-entry {
            0% { opacity: 0; transform: translateY(8px); }
            100% { opacity: 1; transform: translateY(0); }
          }

          @keyframes farm-cloud-drift {
            0% { margin-left: 0; }
            50% { margin-left: 16px; }
            100% { margin-left: 0; }
          }

          @keyframes farm-walker-bob {
            0% { transform: translateY(0); }
            50% { transform: translateY(-1px); }
            100% { transform: translateY(0); }
          }

          @keyframes farm-walker-route-a {
            0% { left: 12%; top: 60%; }
            24% { left: 38%; top: 60%; }
            40% { left: 52%; top: 49%; }
            58% { left: 52%; top: 74%; }
            78% { left: 74%; top: 60%; }
            100% { left: 12%; top: 60%; }
          }

          @keyframes farm-walker-route-b {
            0% { left: 86%; top: 62%; }
            28% { left: 64%; top: 62%; }
            46% { left: 48%; top: 76%; }
            68% { left: 32%; top: 62%; }
            100% { left: 86%; top: 62%; }
          }

          @keyframes farm-walker-route-c {
            0% { left: 48%; top: 84%; }
            24% { left: 48%; top: 52%; }
            48% { left: 64%; top: 60%; }
            74% { left: 34%; top: 60%; }
            100% { left: 48%; top: 84%; }
          }
        `}</style>
      </div>
    </div>
  );
}

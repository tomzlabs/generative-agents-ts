import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { loadFromStorage, saveToStorage } from '../core/persistence/storage';
import { CHAIN_CONFIG } from '../config/chain';
import { getReadProvider } from '../core/chain/readProvider';
import { useI18n, type Language } from '../i18n/I18nContext';

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

type SeedInventory = Record<CropType, number>;

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

const CROP_LABELS_ZH: Record<CropType, string> = {
  WHEAT: '小麦',
  CORN: '玉米',
  CARROT: '胡萝卜',
};

const CROP_LABELS_EN: Record<CropType, string> = {
  WHEAT: 'Wheat',
  CORN: 'Corn',
  CARROT: 'Carrot',
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

const FARM_SEED_EVENT_ABI = [
  'event SeedPurchased(address indexed user, uint8 type_, uint256 count, uint256 cost)',
  'event SeedPlanted(address indexed user, uint256 landId, uint8 type_, uint256 baseDuration)',
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

function cropLabel(crop: CropType, lang: Language = 'zh'): string {
  return (lang === 'zh' ? CROP_LABELS_ZH : CROP_LABELS_EN)[crop] ?? crop;
}

function stageLabel(stage: GrowthStage, lang: Language = 'zh'): string {
  if (lang === 'zh') {
    if (stage === 'SEED') return '种子';
    if (stage === 'SPROUT') return '发芽';
    if (stage === 'MATURE') return '成熟';
    return '可收获';
  }
  if (stage === 'SEED') return 'Seed';
  if (stage === 'SPROUT') return 'Sprout';
  if (stage === 'MATURE') return 'Mature';
  return 'Harvestable';
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

async function withRpcRetry<T>(call: () => Promise<T>, attempts = 2, baseDelayMs = 260): Promise<T> {
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

function parseErrorMessage(error: unknown, lang: Language = 'zh'): string {
  const message = extractErrorMessage(error);
  if (message.toLowerCase().includes('missing response for request')) {
    return lang === 'zh'
      ? 'RPC 无响应（节点拥堵或限流），请稍后重试'
      : 'RPC no response (node congested or rate-limited), please retry.';
  }
  return message;
}

function isSeedInsufficientError(error: unknown): boolean {
  const msg = extractErrorMessage(error).toLowerCase();
  return (
    msg.includes('no seed') ||
    msg.includes('seed not enough') ||
    msg.includes('not enough seed') ||
    msg.includes('insufficient') && msg.includes('seed')
  );
}

const WAD = 1_000_000_000_000_000_000n;
const TIME_MULTIPLIER_WAD = 950_000_000_000_000_000n;
const BASE_MATURE_TIME_SEC = 2 * 60 * 60;

function calcTimeFactorWad(level: number): bigint {
  const safeLevel = Math.max(1, Math.floor(level));
  let factor = WAD;
  for (let i = 1; i < safeLevel; i++) {
    factor = (factor * TIME_MULTIPLIER_WAD) / WAD;
  }
  return factor;
}

function calcEstimatedMatureMs(level: number): number {
  const factor = calcTimeFactorWad(level);
  const baseMs = BigInt(BASE_MATURE_TIME_SEC * 1000);
  const durationMs = (baseMs * factor) / WAD;
  return Number(durationMs);
}

async function submitFarmIntentToContract(intent: FarmIntent, landId: number): Promise<void> {
  if (!window.ethereum) {
    throw new Error('Wallet not found. Install and connect MetaMask first.');
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
    throw new Error('Wallet not found. Install and connect MetaMask first.');
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
  const { lang, t } = useI18n();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedSeed, setSelectedSeed] = useState<CropType>('WHEAT');
  const [plots, setPlots] = useState<Plot[]>(() => normalizePlots(loadFromStorage<Plot[]>(PLOTS_KEY)));
  const [profile, setProfile] = useState<FarmProfile>(() => normalizeProfile(loadFromStorage<FarmProfile>(PROFILE_KEY)));
  const [plotLandIds, setPlotLandIds] = useState<Array<number | null>>(() => Array.from({ length: TOTAL_PLOTS }, () => null));
  const [pendingPlotIds, setPendingPlotIds] = useState<number[]>([]);
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
  const [farmMetaLoaded, setFarmMetaLoaded] = useState(false);
  const farmSyncSeqRef = useRef(0);
  const farmSyncTaskRef = useRef<Promise<void> | null>(null);
  const prizePoolSyncTaskRef = useRef<Promise<void> | null>(null);
  const holdingSyncTaskRef = useRef<Promise<void> | null>(null);
  const seedInventoryReadModeRef = useRef<'unknown' | 'none' | 'getterByType' | 'getterTuple'>('unknown');
  const seedInventoryGetterNameRef = useRef<string>('');
  const isChainMode = Boolean(account);
  const cropLabelText = useCallback((crop: CropType) => cropLabel(crop, lang), [lang]);
  const stageLabelText = useCallback((stage: GrowthStage) => stageLabel(stage, lang), [lang]);
  const parseErrText = useCallback((error: unknown) => parseErrorMessage(error, lang), [lang]);

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

  const syncFarmMetaFromChain = useCallback(async () => {
    if (!isChainMode) return;
    try {
      const provider = getReadProvider();
      const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_ABI, provider);
      const [
        thresholdRaw,
        landPriceValue,
        wheatSeedPrice,
        cornSeedPrice,
        carrotSeedPrice,
        wheatSeedExp,
        cornSeedExp,
        carrotSeedExp,
      ] = await Promise.all([
        withRpcRetry(() => farm.expThresholdBase()),
        withRpcRetry(() => farm.landPrice()),
        withRpcRetry(() => farm.seedPrice(0)),
        withRpcRetry(() => farm.seedPrice(1)),
        withRpcRetry(() => farm.seedPrice(2)),
        withRpcRetry(() => farm.expPerSeed(0)),
        withRpcRetry(() => farm.expPerSeed(1)),
        withRpcRetry(() => farm.expPerSeed(2)),
      ]);

      setExpThresholdBase(Math.max(1, Number(thresholdRaw) || 120));
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
      setFarmMetaLoaded(true);
    } catch (error) {
      setFarmErr((prev) => prev ?? parseErrText(error));
    }
  }, [isChainMode, parseErrText]);

  const syncSeedInventoryFromChain = useCallback(
    async (provider: ethers.AbstractProvider, user: string): Promise<SeedInventory> => {
      const directGetterByTypeCandidates = [
        'getUserSeedCount',
        'getUserSeedBalance',
        'userSeedCount',
        'userSeedBalance',
        'seedBalanceOf',
      ];
      const directGetterTupleCandidates = [
        'getUserSeeds',
        'getUserSeedInventory',
        'getUserSeedBalances',
      ];

      const readByTypeGetter = async (fnName: string): Promise<SeedInventory> => {
        const c = new ethers.Contract(CHAIN_CONFIG.farmAddress, [`function ${fnName}(address,uint8) view returns (uint256)`], provider);
        const [w, c1, c2] = await Promise.all([
          withRpcRetry(() => c[fnName](user, 1)),
          withRpcRetry(() => c[fnName](user, 2)),
          withRpcRetry(() => c[fnName](user, 3)),
        ]);
        return {
          WHEAT: Math.max(0, Number(w ?? 0n)),
          CORN: Math.max(0, Number(c1 ?? 0n)),
          CARROT: Math.max(0, Number(c2 ?? 0n)),
        };
      };

      const readTupleGetter = async (fnName: string): Promise<SeedInventory> => {
        const c = new ethers.Contract(CHAIN_CONFIG.farmAddress, [`function ${fnName}(address) view returns (uint256,uint256,uint256)`], provider);
        const tuple = await withRpcRetry(() => c[fnName](user));
        return {
          WHEAT: Math.max(0, Number(tuple?.[0] ?? 0n)),
          CORN: Math.max(0, Number(tuple?.[1] ?? 0n)),
          CARROT: Math.max(0, Number(tuple?.[2] ?? 0n)),
        };
      };

      if (seedInventoryReadModeRef.current === 'getterByType' && seedInventoryGetterNameRef.current) {
        try {
          return await readByTypeGetter(seedInventoryGetterNameRef.current);
        } catch {
          seedInventoryReadModeRef.current = 'unknown';
          seedInventoryGetterNameRef.current = '';
        }
      }
      if (seedInventoryReadModeRef.current === 'getterTuple' && seedInventoryGetterNameRef.current) {
        try {
          return await readTupleGetter(seedInventoryGetterNameRef.current);
        } catch {
          seedInventoryReadModeRef.current = 'unknown';
          seedInventoryGetterNameRef.current = '';
        }
      }

      if (seedInventoryReadModeRef.current === 'unknown') {
        for (const fnName of directGetterByTypeCandidates) {
          try {
            const v = await readByTypeGetter(fnName);
            seedInventoryReadModeRef.current = 'getterByType';
            seedInventoryGetterNameRef.current = fnName;
            return v;
          } catch {
            // continue probing
          }
        }
        for (const fnName of directGetterTupleCandidates) {
          try {
            const v = await readTupleGetter(fnName);
            seedInventoryReadModeRef.current = 'getterTuple';
            seedInventoryGetterNameRef.current = fnName;
            return v;
          } catch {
            // continue probing
          }
        }
        seedInventoryReadModeRef.current = 'none';
      }

      const eventContract = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_SEED_EVENT_ABI, provider);
      const purchasedFilter = eventContract.filters.SeedPurchased(user);
      const plantedFilter = eventContract.filters.SeedPlanted(user);
      const cacheKey = `ga:farm:seed-ledger:${CHAIN_CONFIG.farmAddress.toLowerCase()}:${user.toLowerCase()}`;
      const readCache = (): { lastBlock: number; purchased: SeedInventory; planted: SeedInventory } => {
        if (typeof window === 'undefined') {
          return {
            lastBlock: -1,
            purchased: { WHEAT: 0, CORN: 0, CARROT: 0 },
            planted: { WHEAT: 0, CORN: 0, CARROT: 0 },
          };
        }
        try {
          const raw = window.localStorage.getItem(cacheKey);
          if (!raw) throw new Error('empty');
          const parsed = JSON.parse(raw);
          return {
            lastBlock: Number(parsed?.lastBlock ?? -1),
            purchased: {
              WHEAT: Math.max(0, Number(parsed?.purchased?.WHEAT ?? 0)),
              CORN: Math.max(0, Number(parsed?.purchased?.CORN ?? 0)),
              CARROT: Math.max(0, Number(parsed?.purchased?.CARROT ?? 0)),
            },
            planted: {
              WHEAT: Math.max(0, Number(parsed?.planted?.WHEAT ?? 0)),
              CORN: Math.max(0, Number(parsed?.planted?.CORN ?? 0)),
              CARROT: Math.max(0, Number(parsed?.planted?.CARROT ?? 0)),
            },
          };
        } catch {
          return {
            lastBlock: -1,
            purchased: { WHEAT: 0, CORN: 0, CARROT: 0 },
            planted: { WHEAT: 0, CORN: 0, CARROT: 0 },
          };
        }
      };
      const writeCache = (next: { lastBlock: number; purchased: SeedInventory; planted: SeedInventory }) => {
        if (typeof window === 'undefined') return;
        try {
          window.localStorage.setItem(cacheKey, JSON.stringify(next));
        } catch {
          // ignore localStorage quota errors
        }
      };
      const parseType = (v: unknown): CropType | null => {
        const t = Number(v ?? 0);
        return seedTypeToCrop(t);
      };
      const parseCount = (v: unknown): number => Math.max(0, Number(v ?? 0n));

      const latest = await withRpcRetry(() => provider.getBlockNumber());
      const cached = readCache();
      const fromBlock = Math.max(0, cached.lastBlock + 1);
      if (fromBlock > latest) {
        return {
          WHEAT: Math.max(0, cached.purchased.WHEAT - cached.planted.WHEAT),
          CORN: Math.max(0, cached.purchased.CORN - cached.planted.CORN),
          CARROT: Math.max(0, cached.purchased.CARROT - cached.planted.CARROT),
        };
      }

      const chunkQuery = async (baseFilter: any): Promise<any[]> => {
        let from = fromBlock;
        let step = 200_000;
        const out: any[] = [];
        while (from <= latest) {
          const to = Math.min(latest, from + step - 1);
          try {
            const logs = await withRpcRetry(() => eventContract.queryFilter(baseFilter, from, to));
            out.push(...logs);
            from = to + 1;
          } catch (error) {
            if (step <= 2_000) throw error;
            step = Math.floor(step / 2);
          }
        }
        return out;
      };

      const [purchasedLogs, plantedLogs] = await Promise.all([
        chunkQuery(purchasedFilter),
        chunkQuery(plantedFilter),
      ]);

      const purchased: SeedInventory = { ...cached.purchased };
      const planted: SeedInventory = { ...cached.planted };

      for (const log of purchasedLogs) {
        const crop = parseType(log?.args?.[1]);
        if (!crop) continue;
        purchased[crop] += parseCount(log?.args?.[2]);
      }
      for (const log of plantedLogs) {
        const crop = parseType(log?.args?.[2]);
        if (!crop) continue;
        planted[crop] += 1;
      }

      writeCache({
        lastBlock: latest,
        purchased,
        planted,
      });

      return {
        WHEAT: Math.max(0, purchased.WHEAT - planted.WHEAT),
        CORN: Math.max(0, purchased.CORN - planted.CORN),
        CARROT: Math.max(0, purchased.CARROT - planted.CARROT),
      };
    },
    [],
  );

  const syncFarmFromChain = useCallback(async () => {
    if (farmSyncTaskRef.current) {
      return farmSyncTaskRef.current;
    }

    const task = (async () => {
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
        return;
      }

      setLoadingFarm(true);
      setFarmErr(null);
      try {
        const provider = getReadProvider();
        const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_ABI, provider);

        const [userInfoRaw, landIdsRaw, currentRoundRaw] = await Promise.all([
          withRpcRetry(() => farm.getUserInfo(account)),
          withRpcRetry(() => farm.getUserAllLandIds(account)),
          withRpcRetry(() => farm.currentLotteryRound()),
        ]);
        const seedInventory = await syncSeedInventoryFromChain(provider, account);

        const level = Number(userInfoRaw[0]);
        const exp = Number(userInfoRaw[1]);
        const landCount = Number(userInfoRaw[2] ?? 0);
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
        const userTimeFactor = calcTimeFactorWad(level);

        const batchSize = 18;
        for (let i = 0; i < nextLandIds.length; i += batchSize) {
          const batch = nextLandIds.slice(i, i + batchSize);
          const batchData = await Promise.all(
            batch.map((landId) => withRpcRetry(() => farm.getUserPlantedSeed(account, landId))),
          );

          for (let j = 0; j < batchData.length; j++) {
            const index = i + j;
            const seedRaw = batchData[j];
            const seedType = Number(seedRaw.seedType ?? seedRaw[0] ?? 0);
            const crop = seedTypeToCrop(seedType);
            const isHarvested = Boolean(seedRaw.isHarvested ?? seedRaw[4] ?? false);
            const plantTime = BigInt(seedRaw.plantTime ?? seedRaw[1] ?? 0n);
            const baseDuration = BigInt(seedRaw.baseDuration ?? seedRaw[2] ?? 0n);

            if (!crop || isHarvested || plantTime === 0n || baseDuration === 0n) continue;

            const actualDuration = (baseDuration * userTimeFactor) / WAD;
            const matureTime = plantTime + actualDuration;
            let stage: GrowthStage = 'SEED';

            if (nowSec >= matureTime) {
              stage = 'RIPE';
            } else {
              const elapsed = Number(nowSec - plantTime);
              const total = Number(actualDuration);
              const ratio = total <= 0 ? 0 : elapsed / total;
              if (ratio >= 0.66) stage = 'MATURE';
              else if (ratio >= 0.33) stage = 'SPROUT';
            }

            nextPlots[index] = {
              id: index,
              crop,
              stage,
              plantedAt: Number(plantTime) * 1000,
              matureAt: Number(matureTime) * 1000,
            };
          }
        }

        if (syncSeq !== farmSyncSeqRef.current) return;

        setProfile((prev) => ({
          ...prev,
          level: Math.max(1, level || 1),
          exp: Math.max(0, exp || 0),
          items: seedInventory,
        }));
        setTotalLandOwned(Math.max(0, landCount || 0));
        setCurrentLotteryRound(round > 0 ? round : null);
        setCurrentRoundTickets(Math.max(0, roundTickets || 0));
        setPlotLandIds(nextLandIds);
        setPlots(nextPlots);
      } catch (error) {
        if (syncSeq === farmSyncSeqRef.current) {
          setFarmErr(parseErrText(error));
        }
      } finally {
        if (syncSeq === farmSyncSeqRef.current) {
          setLoadingFarm(false);
        }
      }
    })();

    farmSyncTaskRef.current = task;
    try {
      await task;
    } finally {
      farmSyncTaskRef.current = null;
    }
  }, [account, parseErrText, syncSeedInventoryFromChain]);

  const syncPrizePoolFromChain = useCallback(async () => {
    if (prizePoolSyncTaskRef.current) {
      return prizePoolSyncTaskRef.current;
    }

    const task = (async () => {
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
          throw new Error(t('未配置可用的代币地址，无法读取奖池', 'No valid token address configured for reading prize pool.'));
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

        throw lastError ?? new Error(t('读取奖池失败', 'Failed to read prize pool.'));
      } catch (error) {
        setPrizePoolErr(parseErrText(error));
      } finally {
        setLoadingPrizePool(false);
      }
    })();

    prizePoolSyncTaskRef.current = task;
    try {
      await task;
    } finally {
      prizePoolSyncTaskRef.current = null;
    }
  }, [parseErrText, t]);

  useEffect(() => {
    if (!isChainMode) {
      setFarmMetaLoaded(false);
      return;
    }
    if (!farmMetaLoaded) {
      void syncFarmMetaFromChain();
    }
  }, [farmMetaLoaded, isChainMode, syncFarmMetaFromChain]);

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
    if (holdingSyncTaskRef.current) {
      return holdingSyncTaskRef.current;
    }

    const task = (async () => {
      if (!account) {
        setHolding(null);
        setHoldingErr(null);
        setLoadingHolding(false);
        return;
      }

      setLoadingHolding(true);
      setHoldingErr(null);
      try {
        const provider = getReadProvider();
        const contract = new ethers.Contract(CHAIN_CONFIG.tokenAddress, TOKEN_ABI, provider);

        let decimals = 18;
        let symbol = t('代币', 'Token');
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
        setHoldingErr(parseErrText(e));
      } finally {
        setLoadingHolding(false);
      }
    })();

    holdingSyncTaskRef.current = task;
    try {
      await task;
    } finally {
      holdingSyncTaskRef.current = null;
    }
  }, [account, parseErrText, t]);

  useEffect(() => {
    void syncHoldingFromChain();
  }, [syncHoldingFromChain]);

  const expToNext = useMemo(() => profile.level * expThresholdBase, [expThresholdBase, profile.level]);
  const canUpgrade = isChainMode && profile.exp >= expToNext;
  const progressPct = Math.min(100, Math.round((profile.exp / expToNext) * 100));
  const toolTotal = profile.tools.hoe + profile.tools.waterCan + profile.tools.fertilizer;
  const displayItems = profile.items;
  const displayItemTotal = displayItems.WHEAT + displayItems.CORN + displayItems.CARROT;
  const plantedCount = plots.filter((p) => p.crop).length;
  const usablePlotCount = plotLandIds.filter((landId) => landId !== null).length;
  const ripeCount = plots.filter((p) => p.stage === 'RIPE').length;
  const selectedSeedCount = profile.items[selectedSeed];
  const selectedSeedEmpty = selectedSeedCount <= 0;
  const expSegmentCount = 14;
  const filledExpSegments = Math.max(0, Math.min(expSegmentCount, Math.round((progressPct / 100) * expSegmentCount)));
  const tokenDecimals = holding?.decimals ?? 18;
  const tokenSymbol = holding?.symbol ?? t('代币', 'Token');
  const selectedSeedType = cropToSeedType(selectedSeed);
  const selectedSeedUnitPrice = seedPriceRaw[selectedSeed] ?? 0n;
  const landTotalCost = landPriceRaw ? landPriceRaw * BigInt(landPurchaseCount) : null;
  const seedTotalCost = selectedSeedUnitPrice > 0n ? selectedSeedUnitPrice * BigInt(seedPurchaseCount) : null;
  const hasAnyLand = !isChainMode || usablePlotCount > 0;

  const ensureTokenAllowance = useCallback(
    async (requiredAmount: bigint) => {
      if (!window.ethereum) throw new Error(t('未检测到钱包，请先安装并连接 MetaMask', 'Wallet not detected. Install and connect MetaMask.'));
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const owner = await signer.getAddress();
      const token = new ethers.Contract(CHAIN_CONFIG.tokenAddress, TOKEN_ABI, signer);
      const allowance = (await token.allowance(owner, CHAIN_CONFIG.farmAddress)) as bigint;
      if (allowance >= requiredAmount) return;
      const approveTx = await token.approve(CHAIN_CONFIG.farmAddress, ethers.MaxUint256);
      await approveTx.wait();
    },
    [t],
  );

  const handlePlotClick = async (plotId: number) => {
    if (pendingPlotIds.includes(plotId)) return;
    const current = plots.find((p) => p.id === plotId);
    if (!current) return;
    const landId = plotLandIds[plotId];
    if (isChainMode && landId === null) return;

    if (!current.crop && profile.items[selectedSeed] <= 0) {
      setSeedEmptyDialogOpen(true);
      return;
    }

    if (current.stage === 'RIPE' && current.crop) {
      const harvestedCrop: CropType = current.crop;
      const intent: FarmIntent = { action: 'HARVEST', plotId, crop: harvestedCrop, createdAt: Date.now() };
      try {
        setPendingPlotIds((prev) => (prev.includes(plotId) ? prev : [...prev, plotId]));
        if (isChainMode) {
          await submitFarmIntentToContract(intent, landId as number);
          setPlots((prev) =>
            prev.map((p) => (p.id === plotId ? { ...p, crop: null, stage: null, plantedAt: null, matureAt: null } : p)),
          );
          void syncFarmFromChain();
        } else {
          setProfile((prev) => ({
            ...prev,
            exp: prev.exp + 20,
            items: { ...prev.items, [harvestedCrop]: prev.items[harvestedCrop] + 1 },
          }));
          setPlots((prev) => prev.map((p) => (p.id === plotId ? { ...p, crop: null, stage: null, plantedAt: null, matureAt: null } : p)));
        }
      } catch (error) {
        window.alert(`${t('收获失败', 'Harvest failed')}: ${parseErrText(error)}`);
      } finally {
        setPendingPlotIds((prev) => prev.filter((id) => id !== plotId));
      }
      return;
    }

    if (!current.crop && profile.items[selectedSeed] > 0) {
      const intent: FarmIntent = { action: 'PLANT', plotId, crop: selectedSeed, createdAt: Date.now() };
      try {
        setPendingPlotIds((prev) => (prev.includes(plotId) ? prev : [...prev, plotId]));
        if (isChainMode) {
          await submitFarmIntentToContract(intent, landId as number);
          const now = Date.now();
          const matureAt = now + calcEstimatedMatureMs(profile.level);
          setPlots((prev) =>
            prev.map((p) =>
              p.id === plotId
                ? {
                    ...p,
                    crop: selectedSeed,
                    stage: 'SEED',
                    plantedAt: now,
                    matureAt,
                  }
                : p,
            ),
          );
          void syncFarmFromChain();
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
        if (isSeedInsufficientError(error)) {
          setSeedEmptyDialogOpen(true);
        } else {
          window.alert(`${t('种植失败', 'Plant failed')}: ${parseErrText(error)}`);
        }
      } finally {
        setPendingPlotIds((prev) => prev.filter((id) => id !== plotId));
      }
    }
  };

  const handleUpgrade = async () => {
    if (!account) {
      window.alert(t('请先连接钱包', 'Connect wallet first.'));
      return;
    }
    if (profile.exp < expToNext) return;
    setIsUpgrading(true);
    try {
      await submitLevelUpToContract();
      void syncFarmFromChain();
    } catch (error) {
      window.alert(`${t('升级失败', 'Level-up failed')}: ${parseErrText(error)}`);
    } finally {
      setIsUpgrading(false);
    }
  };

  const handlePurchaseLand = async () => {
    if (!account) {
      window.alert(t('请先连接钱包', 'Connect wallet first.'));
      return;
    }
    const count = Math.max(1, Math.floor(landPurchaseCount));
    setLandPurchaseCount(count);
    setIsPurchasingLand(true);
    try {
      if (!window.ethereum) throw new Error(t('未检测到钱包，请先安装并连接 MetaMask', 'Wallet not detected. Install and connect MetaMask.'));
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

      void syncFarmFromChain();
    } catch (error) {
      window.alert(`${t('购买土地失败', 'Land purchase failed')}: ${parseErrText(error)}`);
    } finally {
      setIsPurchasingLand(false);
    }
  };

  const handlePurchaseSeed = async () => {
    if (!account) {
      window.alert(t('请先连接钱包', 'Connect wallet first.'));
      return;
    }
    const count = Math.max(1, Math.floor(seedPurchaseCount));
    setSeedPurchaseCount(count);
    setIsPurchasingSeed(true);
    try {
      if (!window.ethereum) throw new Error(t('未检测到钱包，请先安装并连接 MetaMask', 'Wallet not detected. Install and connect MetaMask.'));
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_ABI, signer);

      const priceIndex = seedTypeToPriceIndex(selectedSeedType);
      const unitPrice = selectedSeedUnitPrice > 0n ? selectedSeedUnitPrice : BigInt(await farm.seedPrice(priceIndex));
      const totalCost = unitPrice * BigInt(count);
      await ensureTokenAllowance(totalCost);

      const tx = await farm.purchaseSeed(selectedSeedType, count);
      await tx.wait();
      void Promise.all([syncFarmFromChain(), syncPrizePoolFromChain()]);
    } catch (error) {
      window.alert(`${t('购买种子失败', 'Seed purchase failed')}: ${parseErrText(error)}`);
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
      <div className="farm-page-content" style={{ maxWidth: 1620, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
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
          <div className="farm-hero-left">
            <div className="farm-status-pill">
              <span className={`farm-status-dot ${isChainMode ? 'is-online' : 'is-local'}`} />
              {isChainMode ? t('链上模式 ONLINE', 'On-chain Mode ONLINE') : t('本地模式 DEMO', 'Local Mode DEMO')}
            </div>
            <h1
              className="farm-hero-title"
              style={{
                margin: 0,
                color: '#355537',
                fontFamily: "'Press Start 2P', cursive",
                fontSize: 'clamp(16px, 2.1vw, 24px)',
                lineHeight: 1.3,
              }}
            >
              {t('阳光农场 // 3x3', 'Sunny Farm // 3x3')}
            </h1>
            <div className="farm-hero-sub" style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
              {t('点击空地种植，成熟后再次点击收获', 'Click empty land to plant, then click again to harvest when mature')}
            </div>
          </div>

          <div className="farm-hero-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
            <div className="ga-chip farm-chip">
              {t('已种植', 'Planted')} {plantedCount}/{isChainMode ? usablePlotCount : TOTAL_PLOTS}
            </div>
            <div className="ga-chip farm-chip farm-chip-warn">
              {t('可收获', 'Harvestable')} {ripeCount}
            </div>
            <div className="ga-chip farm-chip farm-chip-info">
              {t('等级', 'Level')} {profile.level}
            </div>
            <div className="ga-chip farm-chip">
              {isChainMode ? t('链上: 已连接', 'Chain: Connected') : t('模式: 本地演示', 'Mode: Local Demo')}
            </div>
            <button
              className="farm-harvest-btn farm-guide-open-btn ga-btn"
              onClick={() => setGuideDialogOpen(true)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
              }}
            >
              {t('玩法指南', 'Gameplay Guide')}
            </button>
          </div>
        </section>

        <section className="farm-kpi-grid">
          <article className="farm-kpi-card ga-card-surface">
            <div className="farm-kpi-label">{t('地块', 'Plots')}</div>
            <div className="farm-kpi-value">{plantedCount}/{isChainMode ? usablePlotCount : TOTAL_PLOTS}</div>
            <div className="farm-kpi-sub">{t('已启用农田', 'Active farmlands')}</div>
          </article>
          <article className="farm-kpi-card ga-card-surface">
            <div className="farm-kpi-label">{t('可收获', 'Harvestable')}</div>
            <div className="farm-kpi-value">{ripeCount}</div>
            <div className="farm-kpi-sub">{t('当前可收获数量', 'Currently harvestable count')}</div>
          </article>
          <article className="farm-kpi-card ga-card-surface">
            <div className="farm-kpi-label">{t('等级', 'Level')}</div>
            <div className="farm-kpi-value">{t('等级', 'Level')} {profile.level}</div>
            <div className="farm-kpi-sub">{t('进度', 'Progress')} {progressPct}%</div>
          </article>
          <article className="farm-kpi-card ga-card-surface">
            <div className="farm-kpi-label">{t('库存', 'Inventory')}</div>
            <div className="farm-kpi-value">{displayItemTotal}</div>
            <div className="farm-kpi-sub">
              {isChainMode
                ? `${t('链上种植数 / 彩票', 'On-chain planted / Tickets')} ${currentRoundTickets ?? '--'}`
                : `${t('道具 / 工具', 'Items / Tools')} ${toolTotal}`}
            </div>
          </article>
        </section>

        <section className="farm-card farm-seed-panel ga-card-surface" style={{ padding: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {(['WHEAT', 'CORN', 'CARROT'] as CropType[]).map((seed) => {
              const seedUnitPrice = seedPriceRaw[seed] ?? 0n;
              const seedExp = seedExpRaw[seed] ?? DEFAULT_SEED_EXP[seed];
              const lotteryReward = LOTTERY_REWARD_PER_SEED[seed];
              const seedCount = displayItems[seed];
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
                    {cropLabelText(seed)}（{seedCount}）
                  </button>
                  <div className="seed-rule-tooltip" role="tooltip" aria-hidden="true">
                    <div className="seed-rule-title">{cropLabelText(seed)} {t('规则', 'Rules')}</div>
                    <div>{t('收益: 收获兑换彩票', 'Yield: tickets per harvest')} {lotteryReward} {t('张', '')}</div>
                    <div>{t('经验', 'EXP')}: +{seedExp}</div>
                    <div>{t('库存数量', 'Owned')}: {seedCount}</div>
                    <div>
                      {t('单价', 'Unit Price')}:{' '}
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
            <span style={{ opacity: 0.8 }}>{t('当前种子', 'Current Seed')}: {cropLabelText(selectedSeed)}</span>
            <span style={{ opacity: 0.55 }}>|</span>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><PixelPlant stage="SEED" crop={selectedSeed} /> {t('种子', 'Seed')}</span>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><PixelPlant stage="SPROUT" crop={selectedSeed} /> {t('发芽', 'Sprout')}</span>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><PixelPlant stage="MATURE" crop={selectedSeed} /> {t('成熟', 'Mature')}</span>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><PixelPlant stage="RIPE" crop={selectedSeed} /> {t('可收获', 'Harvestable')}</span>
          </div>
          {selectedSeedEmpty ? (
            <div style={{ marginTop: 8, textAlign: 'center', fontSize: 11, color: '#8b5a3a' }}>
              {t('当前种子库存不足，请先收获或切换种子', 'Seed stock is insufficient. Harvest first or switch seed type.')}
            </div>
          ) : null}
        </section>

        <div className="farm-layout">
          <div>
            <div
              className="farm-scene farm-scene-surface"
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
                  {t('奖池(合约余额)', 'Prize Pool (Contract Balance)')}
                </div>
                <div style={{ marginTop: 5, fontSize: 13, fontWeight: 800, color: '#5b350e', wordBreak: 'break-all' }}>
                  {loadingPrizePool ? t('加载中...', 'Loading...') : prizePoolRaw !== null ? `${formatTokenAmount(prizePoolRaw, tokenDecimals)} ${tokenSymbol}` : '--'}
                </div>
                {prizePoolErr ? (
                  <div style={{ marginTop: 4, fontSize: 9, color: '#b91c1c', lineHeight: 1.2 }}>
                    {t('读取失败', 'Read failed')}: {prizePoolErr}
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
                className="farm-grid-bed"
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
                    {t('暂无土地', 'No Land')}
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
                    const isBusy = pendingPlotIds.includes(plot.id);
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
                              ? `${cropLabelText(plot.crop)} - ${stageLabelText(plot.stage ?? 'SEED')} / ${t('地块', 'Land')} #${landId ?? plot.id + 1}`
                              : `${t('空地', 'Empty Plot')} #${plot.id + 1} / ${t('地块', 'Land')} #${landId ?? plot.id + 1}`
                            : t('该位置暂无链上土地', 'No on-chain land for this slot')
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
                            {remainingMs <= 0 ? t('可收获', 'Harvestable') : formatCountdown(remainingMs)}
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
                            {cropLabelText(plot.crop)}
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
                            {t('无土地', 'No Land')}
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

          <aside className="farm-sidebar farm-sidebar-stack" style={{ gap: 10 }}>
            <section className="farm-card farm-side-panel farm-side-panel-wallet ga-card-surface" style={{ padding: 12 }}>
              <FarmPanelTitle label={t('代币持仓（链上）', 'Token Holding (On-chain)')} icon="flower_white" tone="sky" />
              <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.3 }}>
                {!account ? '--' : loadingHolding ? t('加载中...', 'Loading...') : holding ? `${holding.formatted} ${holding.symbol}` : '--'}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, wordBreak: 'break-all' }}>{t('合约', 'Contract')}: {CHAIN_CONFIG.tokenAddress}</div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.9, wordBreak: 'break-all' }}>{t('农场', 'Farm')}: {CHAIN_CONFIG.farmAddress}</div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.9 }}>
                {t('钱包', 'Wallet')}: {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : t('未连接钱包', 'Not connected')}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>{t('NFT 持有数', 'NFT Count')}: {ownedTokens.length}</div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                {t('农场状态', 'Farm Status')}: {isChainMode ? (loadingFarm ? t('同步中...', 'Syncing...') : t('已连接链上', 'On-chain connected')) : t('本地演示', 'Local Demo')}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                {t('当前轮次', 'Current Round')}: {currentLotteryRound ?? '--'} | {t('总土地', 'Total Land')}: {totalLandOwned}
              </div>
              {holdingErr ? <div style={{ marginTop: 6, color: '#b91c1c', fontSize: 12 }}>{t('读取失败', 'Read failed')}: {holdingErr}</div> : null}
              {farmErr ? <div style={{ marginTop: 6, color: '#b91c1c', fontSize: 12 }}>{t('农场读取失败', 'Farm read failed')}: {farmErr}</div> : null}
            </section>

            <section className="farm-card farm-side-panel farm-side-panel-shop farm-hud-col ga-card-surface" style={{ padding: 12 }}>
              <FarmPanelTitle label={t('链上商店', 'On-chain Shop')} icon="seed_wheat" tone="soil" />
              <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
                {t('先授权代币，再执行购买（授权会自动处理）', 'Approve token first, then purchase (approval is auto-handled)')}
              </div>

              <div style={{ border: '1px solid #d6c6a8', padding: 8, marginBottom: 10, background: 'rgba(255, 252, 240, 0.65)' }}>
                <div style={{ fontSize: 11, marginBottom: 6, opacity: 0.85 }}>{t('购买土地', 'Buy Land')}</div>
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
                    {isPurchasingLand ? t('购买中...', 'Purchasing...') : t('购买土地', 'Buy Land')}
                  </button>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, opacity: 0.82 }}>
                  {t('单价', 'Unit Price')}: {landPriceRaw !== null ? `${formatTokenAmount(landPriceRaw, tokenDecimals)} ${tokenSymbol}` : '--'}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, opacity: 0.82 }}>
                  {t('预计总价', 'Estimated Total')}: {landTotalCost !== null ? `${formatTokenAmount(landTotalCost, tokenDecimals)} ${tokenSymbol}` : '--'}
                </div>
              </div>

              <div style={{ border: '1px solid #d6c6a8', padding: 8, background: 'rgba(255, 252, 240, 0.65)' }}>
                <div style={{ fontSize: 11, marginBottom: 6, opacity: 0.85 }}>
                  {t('购买种子（当前选中: ', 'Buy Seeds (selected: ')}{cropLabelText(selectedSeed)}{t('）', ')')}
                </div>
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
                    {isPurchasingSeed ? t('购买中...', 'Purchasing...') : t('购买种子', 'Buy Seeds')}
                  </button>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, opacity: 0.82 }}>
                  {t('单价', 'Unit Price')}: {selectedSeedUnitPrice > 0n ? `${formatTokenAmount(selectedSeedUnitPrice, tokenDecimals)} ${tokenSymbol}` : '--'}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, opacity: 0.82 }}>
                  {t('预计总价', 'Estimated Total')}: {seedTotalCost !== null ? `${formatTokenAmount(seedTotalCost, tokenDecimals)} ${tokenSymbol}` : '--'}
                </div>
              </div>
            </section>

            <section className="farm-card farm-side-panel farm-side-panel-level farm-hud-col ga-card-surface" style={{ padding: 12 }}>
              <FarmPanelTitle label={t('等级与经验', 'Level & EXP')} icon="seed_corn" tone="sun" />
              <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>{t('等级', 'Level')} {profile.level}</div>
              <div style={{ fontSize: 13, marginBottom: 8 }}>{t('经验', 'EXP')}: {profile.exp} / {expToNext}</div>
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
                <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8 }}>{t('进度', 'Progress')} {progressPct}%</div>
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
                  ? t('升级中...', 'Upgrading...')
                  : !isChainMode
                    ? t('连接钱包后升级', 'Connect wallet to upgrade')
                    : canUpgrade
                      ? t('升级', 'Level Up')
                      : t(`经验不足 (还差 ${expToNext - profile.exp})`, `Insufficient EXP (${expToNext - profile.exp} short)`)}
              </button>
            </section>

            <section className="farm-card farm-side-panel farm-side-panel-tips ga-card-surface" style={{ padding: 12, fontSize: 12 }}>
              <FarmPanelTitle label={t('操作提示', 'Operation Tips')} icon="rock_small" tone="soil" />
              <div style={{ opacity: 0.85, lineHeight: 1.7 }}>
                {t('1. 在链上商店先购买土地和种子。', '1. Buy land and seeds in the on-chain shop first.')}<br />
                {t('2. 先选种子，再点击空地种植。', '2. Select seed type, then click empty land to plant.')}<br />
                {t('3. 地块发光时表示可收获。', '3. A glowing plot means it is harvestable.')}<br />
                4. {isChainMode ? t('链上模式会发起钱包交易。', 'On-chain mode triggers wallet transactions.') : t('本地模式仅用于演示。', 'Local mode is for demo only.')}<br />
                {t('5. 点击右上角「玩法指南」查看完整规则。', '5. Click “Gameplay Guide” at top-right for full rules.')}
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
              aria-label={t('种子不足提示', 'Seed Insufficient Notice')}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="farm-modal-title">{t('种子不足', 'Seed Insufficient')}</div>
              <div className="farm-modal-text">
                {t('当前没有「', 'You currently have no "')}{cropLabelText(selectedSeed)}{t('」种子，无法种植。', '" seed, cannot plant.')}
                <br />
                {t('请先收获作物补充库存，或切换到有库存的种子。', 'Harvest crops first to replenish inventory, or switch to a seed type you own.')}
              </div>
              <button className="ga-btn farm-modal-btn" onClick={() => setSeedEmptyDialogOpen(false)}>
                {t('我知道了', 'Got it')}
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
              aria-label={t('玩法指南', 'Gameplay Guide')}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="farm-modal-title">{t('农场玩法指南', 'Farm Gameplay Guide')}</div>
              <div className="farm-guide-content">
                <section className="farm-guide-section">
                  <h3>{t('一、先知道你在玩什么', 'I. What You Are Playing')}</h3>
                  <p>{t('这是一个“种地 + 开奖 + 成长”的循环游戏。你的目标很简单：扩大土地、提升效率、冲击奖池。', 'This is a loop game of farming + lottery + progression. Your goal is simple: expand land, improve efficiency, and compete for the prize pool.')}</p>
                  <ul>
                    <li>{t('先买地和种子，地越多，单轮能种得越多。', 'Buy land and seeds first. More land means more crops per round.')}</li>
                    <li>{t('成熟后收获，拿到彩票编号参与当期抽奖。', 'Harvest when mature to receive ticket numbers for the current lottery round.')}</li>
                    <li>{t('不断种植累积经验，升级后成熟更快。', 'Keep planting to gain EXP. Higher level means faster maturity.')}</li>
                  </ul>
                </section>

                <section className="farm-guide-section">
                  <h3>{t('二、新手 30 秒上手', 'II. 30-Second Quick Start')}</h3>
                  <ul>
                    <li>{t('连接钱包并切到 BSC。', 'Connect your wallet and switch to BSC.')}</li>
                    <li>{t('准备代币后，先买 1-3 块地和一批小麦种子。', 'Prepare tokens, then buy 1-3 lands and a batch of wheat seeds.')}</li>
                    <li>{t('把空地全部种满，成熟后立即收获。', 'Fill all empty plots, then harvest as soon as crops mature.')}</li>
                    <li>{t('有了稳定节奏后，再逐步换成玉米/胡萝卜提高收益。', 'After your loop stabilizes, gradually switch to corn/carrot for higher returns.')}</li>
                    <li>{t('开奖页可查看每一期结果和你的参与情况。', 'Lottery page shows each round result and your participation.')}</li>
                  </ul>
                </section>

                <section className="farm-guide-section">
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

                <section className="farm-guide-section">
                  <h3>{t('四、升级有什么用', 'IV. Why Level Up')}</h3>
                  <ul>
                    <li>{t('经验主要来自“种植动作”，不是收获动作。', 'Most EXP comes from planting, not harvesting.')}</li>
                    <li>{t('满足经验条件并支付升级费用后，可提升等级。', 'After reaching EXP requirement and paying the fee, you can level up.')}</li>
                    <li>{t('等级提升会缩短后续作物成熟时间，长期收益会更高。', 'Higher level shortens crop maturity time and improves long-term return.')}</li>
                    <li>{t('建议：先保证地块持续满种，再考虑冲级。', 'Tip: keep plots fully planted first, then push levels.')}</li>
                  </ul>
                </section>

                <section className="farm-guide-section">
                  <h3>{t('五、开奖怎么进行', 'V. How Lottery Works')}</h3>
                  <ul>
                    <li>{t('每次收获都会给你当前期的彩票编号。', 'Every harvest gives you ticket numbers in the current round.')}</li>
                    <li>{t('达到开奖条件后，系统发起随机开奖并确定中奖号。', 'When conditions are met, the system requests randomness and determines the winning number.')}</li>
                    <li>{t('中奖者获得当期全部奖池。', 'The winner receives the full round prize pool.')}</li>
                    <li>{t('开奖后自动进入下一期，继续循环。', 'After draw, a new round starts automatically.')}</li>
                  </ul>
                </section>

                <section className="farm-guide-section">
                  <h3>{t('六、费用与奖池去向', 'VI. Cost and Prize Pool Flow')}</h3>
                  <p>{t('买地、买种、升级等支付会进入系统分配：一部分销毁，一部分进入奖池。', 'Payments from land/seed/level-up are split by the system: one part burned, one part into prize pool.')}</p>
                  <ul>
                    <li>{t('默认比例为 50% 销毁 + 50% 进入奖池。', 'Default split is 50% burn + 50% to prize pool.')}</li>
                    <li>{t('奖池越高，单期中奖吸引力越强。', 'Larger prize pool means stronger round incentive.')}</li>
                    <li>{t('所有结果以上链数据为准，请注意链上交易确认时间。', 'All results follow on-chain data; consider transaction confirmation latency.')}</li>
                  </ul>
                </section>
              </div>
              <button className="ga-btn farm-modal-btn" onClick={() => setGuideDialogOpen(false)}>
                {t('关闭指南', 'Close Guide')}
              </button>
            </div>
          </div>
        ) : null}

        <style>{`
          .farm-page-shell {
            background:
              radial-gradient(circle at 14% 6%, rgba(255,255,255,0.56), transparent 24%),
              radial-gradient(circle at 86% 10%, rgba(255,255,255,0.46), transparent 22%),
              radial-gradient(circle at 50% 110%, rgba(43, 90, 64, 0.2), transparent 38%),
              linear-gradient(180deg, #8fcfff 0%, #b9ecff 34%, #b6ea87 34%, #9dd871 100%);
          }

          .farm-page-content {
            animation: farm-page-entry .34s ease-out;
          }

          .farm-card {
            border-radius: var(--ga-card-radius);
            box-shadow: var(--ga-card-shadow);
            backdrop-filter: blur(2px);
            position: relative;
          }

          .farm-card::after {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            background:
              radial-gradient(circle at 100% 0%, rgba(255,255,255,0.22), transparent 32%);
          }

          .farm-hero-card {
            background: linear-gradient(180deg, rgba(248,255,230,0.96), rgba(235,248,203,0.9)) !important;
            border-color: rgba(112, 154, 98, 0.9) !important;
          }

          .farm-hero-left {
            display: grid;
            gap: 6px;
          }

          .farm-status-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            width: fit-content;
            padding: 5px 8px;
            border: 1px solid rgba(103, 141, 91, 0.55);
            border-radius: 999px;
            background: linear-gradient(180deg, rgba(255,255,255,0.42), rgba(240,250,211,0.5));
            font-family: 'Press Start 2P', cursive;
            font-size: 8px;
            color: #406542;
            letter-spacing: 0.04em;
          }

          .farm-status-dot {
            width: 7px;
            height: 7px;
            border-radius: 999px;
            box-shadow: 0 0 0 2px rgba(255,255,255,0.35);
          }

          .farm-status-dot.is-online {
            background: #41bb65;
            box-shadow: 0 0 0 2px rgba(255,255,255,0.35), 0 0 10px rgba(65, 187, 101, 0.58);
          }

          .farm-status-dot.is-local {
            background: #e8af4b;
            box-shadow: 0 0 0 2px rgba(255,255,255,0.35), 0 0 10px rgba(232, 175, 75, 0.58);
          }

          .farm-hero-title {
            text-shadow: 0 1px 0 rgba(255,255,255,0.44);
          }

          .farm-hero-sub {
            color: #4f7155;
          }

          .farm-hero-actions {
            position: relative;
            z-index: 2;
          }

          .farm-guide-open-btn {
            background: linear-gradient(180deg, #fff8d3 0%, #ffe696 100%) !important;
            border-color: #b9903f !important;
            color: #4b3a1c !important;
          }

          .farm-kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
          }

          .farm-kpi-card {
            background: linear-gradient(180deg, rgba(255,255,255,0.62), rgba(239,252,208,0.86));
            padding: 10px 12px;
            border-color: rgba(117, 159, 102, 0.86) !important;
          }

          .farm-kpi-label {
            font-size: 10px;
            letter-spacing: .08em;
            color: #5c7b58;
            font-family: 'Press Start 2P', cursive;
            margin-bottom: 6px;
          }

          .farm-kpi-value {
            font-size: 19px;
            color: #26472e;
            font-weight: 700;
            line-height: 1.15;
            letter-spacing: .01em;
          }

          .farm-kpi-sub {
            margin-top: 4px;
            font-size: 11px;
            color: #547257;
          }

          .farm-seed-panel {
            background: linear-gradient(180deg, rgba(250,255,235,0.96), rgba(236,250,204,0.9)) !important;
            border-color: rgba(116, 157, 101, 0.86) !important;
          }

          .farm-side-panel {
            background: linear-gradient(180deg, rgba(255,255,255,0.8), rgba(244,255,220,0.76)) !important;
            transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease;
            border-color: rgba(118, 158, 104, 0.84) !important;
            padding: 14px !important;
            line-height: 1.55;
          }

          .farm-side-panel:hover {
            transform: translateY(-1px);
            border-color: rgba(95, 136, 86, 0.95) !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.45), 0 14px 24px rgba(52,81,47,0.13);
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
            grid-template-columns: minmax(0, 2.2fr) minmax(420px, 1.1fr);
            gap: 16px;
            align-items: start;
          }

          .farm-scene-surface {
            border-color: rgba(113, 156, 84, 0.92) !important;
            box-shadow:
              0 12px 24px rgba(58, 95, 57, 0.24),
              inset 0 1px 0 rgba(255,255,255,0.42),
              inset 0 0 0 2px rgba(255,255,255,0.12) !important;
          }

          .farm-grid-bed {
            background: linear-gradient(180deg, #9a6337, #855230) !important;
            border-color: #8f5e35 !important;
            box-shadow: inset 0 0 0 2px rgba(59, 35, 20, 0.5), 0 8px 14px rgba(0,0,0,0.16) !important;
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

          .farm-sidebar-stack {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            align-items: start;
            max-height: calc(100vh - 112px);
            overflow-y: auto;
            padding-right: 2px;
            gap: 12px;
          }

          .farm-side-panel-wallet,
          .farm-side-panel-tips {
            grid-column: 1 / -1;
          }

          .farm-hud-col {
            min-height: 100%;
            min-width: 0;
          }

          .farm-side-panel-shop {
            background: linear-gradient(180deg, rgba(255, 251, 237, 0.82), rgba(248, 238, 215, 0.76)) !important;
          }

          .farm-side-panel-bag {
            background: linear-gradient(180deg, rgba(244, 255, 238, 0.84), rgba(228, 247, 207, 0.76)) !important;
          }

          .farm-side-panel-level {
            background: linear-gradient(180deg, rgba(246, 251, 255, 0.84), rgba(225, 241, 255, 0.76)) !important;
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

            .farm-sidebar-stack {
              grid-template-columns: 1fr 1fr;
              max-height: none;
              overflow: visible;
              padding-right: 0;
              gap: 10px;
            }

            .farm-side-panel-wallet,
            .farm-side-panel-tips {
              grid-column: 1 / -1;
            }
          }

          @media (max-width: 560px) {
            .farm-kpi-grid {
              grid-template-columns: 1fr;
            }

            .farm-sidebar-stack {
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

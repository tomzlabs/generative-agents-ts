import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { loadFromStorage, saveToStorage } from '../core/persistence/storage';

type CropType = 'WHEAT' | 'CORN' | 'CARROT';
type GrowthStage = 'SEED' | 'SPROUT' | 'MATURE' | 'RIPE';
type FarmAction = 'PLANT' | 'HARVEST';

type Plot = {
  id: number;
  crop: CropType | null;
  stage: GrowthStage | null;
  plantedAt: number | null;
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

const TOKEN_CONTRACT = '0xe83606959340915fbf88633c69d206fbf40fffff';
const RPC_URL = 'https://bsc-dataseed.binance.org/';
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

const FARM_WALKERS = [
  { id: 'walker-a', src: '/static/assets/farm/farmer-a.svg', size: 28, route: 'farm-walker-route-a', duration: 22, delay: '-2s' },
  { id: 'walker-b', src: '/static/assets/farm/farmer-b.svg', size: 30, route: 'farm-walker-route-b', duration: 24, delay: '-9s' },
  { id: 'walker-c', src: '/static/assets/farm/farmer-a.svg', size: 26, route: 'farm-walker-route-c', duration: 20, delay: '-14s' },
];

function createDefaultPlots(): Plot[] {
  return Array.from({ length: TOTAL_PLOTS }, (_, i) => ({
    id: i,
    crop: null,
    stage: null,
    plantedAt: null,
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

async function submitFarmIntentToContract(_intent: FarmIntent): Promise<void> {
  // TODO: Replace with on-chain farm actions when contract ABI is available.
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
        marginBottom: 8,
        padding: '5px 7px',
        border: `1px solid ${toneBorder[tone]}`,
        background: toneBg[tone],
      }}
    >
      <SpriteIcon name={icon} size={14} />
      <span style={{ fontWeight: 700, color: '#355537', fontSize: 12, letterSpacing: 0.2 }}>{label}</span>
    </div>
  );
}

export function FarmingPage(props: { ownedTokens: number[]; account: string | null }) {
  const { ownedTokens, account } = props;
  const [selectedSeed, setSelectedSeed] = useState<CropType>('WHEAT');
  const [plots, setPlots] = useState<Plot[]>(() => normalizePlots(loadFromStorage<Plot[]>(PLOTS_KEY)));
  const [profile, setProfile] = useState<FarmProfile>(() => normalizeProfile(loadFromStorage<FarmProfile>(PROFILE_KEY)));
  const [pendingPlotId, setPendingPlotId] = useState<number | null>(null);
  const [isHarvestingAll, setIsHarvestingAll] = useState(false);
  const [holding, setHolding] = useState<TokenHolding | null>(null);
  const [loadingHolding, setLoadingHolding] = useState(false);
  const [holdingErr, setHoldingErr] = useState<string | null>(null);

  useEffect(() => {
    saveToStorage(PLOTS_KEY, plots);
  }, [plots]);

  useEffect(() => {
    saveToStorage(PROFILE_KEY, profile);
  }, [profile]);

  useEffect(() => {
    const timer = setInterval(() => {
      setPlots((prev) =>
        prev.map((plot) => {
          if (!plot.crop || !plot.plantedAt || plot.stage === 'RIPE') return plot;
          const nextStage = getStageByAge(plot.crop, Date.now() - plot.plantedAt);
          return nextStage === plot.stage ? plot : { ...plot, stage: nextStage };
        }),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!account) {
      setHolding(null);
      setHoldingErr(null);
      setLoadingHolding(false);
      return;
    }

    let active = true;
    const loadHolding = async () => {
      setLoadingHolding(true);
      setHoldingErr(null);
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(
          TOKEN_CONTRACT,
          [
            'function balanceOf(address owner) view returns (uint256)',
            'function decimals() view returns (uint8)',
            'function symbol() view returns (string)',
          ],
          provider,
        );

        let decimals = 18;
        let symbol = 'TOKEN';
        try {
          decimals = Number(await contract.decimals());
        } catch {
          // fallback defaults
        }
        try {
          symbol = await contract.symbol();
        } catch {
          // fallback defaults
        }

        const raw = (await contract.balanceOf(account)) as bigint;
        if (!active) return;
        setHolding({
          raw,
          decimals,
          symbol,
          formatted: formatTokenAmount(raw, decimals),
        });
      } catch (e) {
        if (!active) return;
        setHoldingErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoadingHolding(false);
      }
    };

    void loadHolding();
    return () => {
      active = false;
    };
  }, [account]);

  const expToNext = useMemo(() => profile.level * 120, [profile.level]);
  const canUpgrade = profile.exp >= expToNext;
  const progressPct = Math.min(100, Math.round((profile.exp / expToNext) * 100));
  const itemTotal = profile.items.WHEAT + profile.items.CORN + profile.items.CARROT;
  const toolTotal = profile.tools.hoe + profile.tools.waterCan + profile.tools.fertilizer;
  const plantedCount = plots.filter((p) => p.crop).length;
  const ripeCount = plots.filter((p) => p.stage === 'RIPE').length;
  const canHarvestAll = ripeCount > 0 && pendingPlotId === null && !isHarvestingAll;
  const selectedSeedCount = profile.items[selectedSeed];
  const selectedSeedEmpty = selectedSeedCount <= 0;
  const expSegmentCount = 14;
  const filledExpSegments = Math.max(0, Math.min(expSegmentCount, Math.round((progressPct / 100) * expSegmentCount)));

  const handlePlotClick = async (plotId: number) => {
    if (pendingPlotId !== null) return;
    const current = plots.find((p) => p.id === plotId);
    if (!current) return;

    if (current.stage === 'RIPE' && current.crop) {
      const harvestedCrop: CropType = current.crop;
      const intent: FarmIntent = { action: 'HARVEST', plotId, crop: harvestedCrop, createdAt: Date.now() };
      try {
        setPendingPlotId(plotId);
        await submitFarmIntentToContract(intent);
        setProfile((prev) => ({
          ...prev,
          exp: prev.exp + 20,
          items: { ...prev.items, [harvestedCrop]: prev.items[harvestedCrop] + 1 },
        }));
        setPlots((prev) => prev.map((p) => (p.id === plotId ? { ...p, crop: null, stage: null, plantedAt: null } : p)));
      } finally {
        setPendingPlotId(null);
      }
      return;
    }

    if (!current.crop && profile.items[selectedSeed] > 0) {
      const intent: FarmIntent = { action: 'PLANT', plotId, crop: selectedSeed, createdAt: Date.now() };
      try {
        setPendingPlotId(plotId);
        await submitFarmIntentToContract(intent);
        setProfile((prev) => ({
          ...prev,
          exp: prev.exp + 3,
          items: { ...prev.items, [selectedSeed]: Math.max(0, prev.items[selectedSeed] - 1) },
        }));
        setPlots((prev) => prev.map((p) => (p.id === plotId ? { ...p, crop: selectedSeed, stage: 'SEED', plantedAt: Date.now() } : p)));
      } finally {
        setPendingPlotId(null);
      }
    }
  };

  const handleUpgrade = () => {
    if (!canUpgrade) return;
    setProfile((prev) => {
      const required = prev.level * 120;
      if (prev.exp < required) return prev;
      return {
        ...prev,
        level: prev.level + 1,
        exp: prev.exp - required,
      };
    });
  };

  const handleHarvestAll = async () => {
    if (!canHarvestAll) return;
    const ripePlots = plots.filter((p): p is Plot & { crop: CropType; stage: 'RIPE' } => p.stage === 'RIPE' && p.crop !== null);
    if (ripePlots.length === 0) return;

    setIsHarvestingAll(true);
    try {
      for (const plot of ripePlots) {
        const intent: FarmIntent = { action: 'HARVEST', plotId: plot.id, crop: plot.crop, createdAt: Date.now() };
        // Keep contract hook path identical to single harvest flow.
        await submitFarmIntentToContract(intent);
      }

      const harvestedByType = ripePlots.reduce(
        (acc, plot) => {
          acc[plot.crop] += 1;
          return acc;
        },
        { WHEAT: 0, CORN: 0, CARROT: 0 } as Record<CropType, number>,
      );

      setProfile((prev) => ({
        ...prev,
        exp: prev.exp + ripePlots.length * 20,
        items: {
          WHEAT: prev.items.WHEAT + harvestedByType.WHEAT,
          CORN: prev.items.CORN + harvestedByType.CORN,
          CARROT: prev.items.CARROT + harvestedByType.CARROT,
        },
      }));
      setPlots((prev) => prev.map((plot) => (plot.stage === 'RIPE' ? { ...plot, crop: null, stage: null, plantedAt: null } : plot)));
    } finally {
      setIsHarvestingAll(false);
    }
  };

  return (
    <div
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
      <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <section
          className="farm-card"
          style={{
            border: '2px solid #7ea46a',
            borderRadius: 8,
            background: 'rgba(244, 255, 217, 0.9)',
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
              SUNNY FARM // 3x3
            </h1>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
              点击空地种植，成熟后再次点击收获
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
            <div style={{ border: '2px solid #7ea46a', background: '#ecffd0', padding: '6px 10px', fontSize: 12 }}>
              已种植 {plantedCount}/{TOTAL_PLOTS}
            </div>
            <div style={{ border: '2px solid #7ea46a', background: '#fff8d2', padding: '6px 10px', fontSize: 12 }}>
              可收获 {ripeCount}
            </div>
            <div style={{ border: '2px solid #7ea46a', background: '#e6f4ff', padding: '6px 10px', fontSize: 12 }}>
              Lv.{profile.level}
            </div>
            <button
              onClick={() => void handleHarvestAll()}
              disabled={!canHarvestAll}
              style={{
                padding: '8px 12px',
                border: '2px solid #6d9768',
                background: canHarvestAll ? '#f4ffd6' : '#e7f0da',
                color: canHarvestAll ? '#355537' : '#7a8b79',
                fontFamily: "'Press Start 2P', cursive",
                fontSize: 10,
                cursor: canHarvestAll ? 'pointer' : 'not-allowed',
                boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.12)',
              }}
            >
              {isHarvestingAll ? 'HARVESTING...' : 'HARVEST ALL'}
            </button>
          </div>
        </section>

        <section className="farm-card" style={{ border: '2px solid #7ea46a', borderRadius: 8, background: 'rgba(248, 255, 228, 0.88)', padding: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {(['WHEAT', 'CORN', 'CARROT'] as CropType[]).map((seed) => (
              <button
                className="seed-btn"
                key={seed}
                onClick={() => setSelectedSeed(seed)}
                style={{
                  padding: '10px 14px',
                  border: '2px solid #6f9b7a',
                  background: selectedSeed === seed ? '#ffffff' : '#e9ffd9',
                  color: '#355537',
                  fontWeight: 700,
                  fontFamily: "'Space Mono', monospace",
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.08)',
                  opacity: profile.items[seed] > 0 ? 1 : 0.6,
                }}
              >
                <SpriteIcon name={ITEM_SPRITE[seed]} size={18} />
                {seed} ({profile.items[seed]})
              </button>
            ))}
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', fontSize: 11 }}>
            <span style={{ opacity: 0.8 }}>当前种子: {selectedSeed}</span>
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
                aspectRatio: '16 / 10',
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
                  top: '62%',
                  transform: 'translate(-50%, -50%)',
                  width: '56%',
                  border: '4px solid #9a6a3b',
                  borderRadius: 6,
                  background: '#875430',
                  padding: 10,
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

                <div style={{ width: '100%', aspectRatio: '3 / 2', margin: '0 auto', display: 'grid', gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gap: 8 }}>
                  {plots.map((plot) => (
                    <button
                      className="farm-plot-btn"
                      key={plot.id}
                      onClick={() => void handlePlotClick(plot.id)}
                      disabled={pendingPlotId === plot.id || isHarvestingAll}
                      title={plot.crop ? `${plot.crop} - ${plot.stage}` : `Empty Plot #${plot.id + 1}`}
                      style={{
                        border: plot.stage === 'RIPE' ? '1px solid #facc15' : '1px solid rgba(91, 52, 29, 0.6)',
                        borderRadius: 4,
                        backgroundColor: plot.crop ? '#7f4f2d' : '#7a4a2b',
                        backgroundImage:
                          "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.06), rgba(0,0,0,0) 40%), url('/static/assets/farm/soil-tile.svg')",
                        backgroundSize: 'auto, 32px 32px',
                        imageRendering: 'pixelated',
                        cursor: 'pointer',
                        position: 'relative',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: plot.stage === 'RIPE' ? '0 0 8px rgba(250, 204, 21, 0.45)' : 'inset 0 0 0 1px rgba(0,0,0,0.22)',
                        opacity: pendingPlotId === plot.id || isHarvestingAll ? 0.7 : 1,
                        transition: 'transform .08s ease-out, box-shadow .12s ease-out',
                      }}
                    >
                      <PixelPlant stage={plot.stage} crop={plot.crop} />
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
                          {plot.crop}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <aside className="farm-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <section className="farm-card" style={{ border: '2px solid #7ea46a', background: 'rgba(255,255,255,0.74)', padding: 12, borderRadius: 6 }}>
              <FarmPanelTitle label="代币持仓（链上）" icon="flower_white" tone="sky" />
              <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.3 }}>
                {!account ? '--' : loadingHolding ? 'Loading...' : holding ? `${holding.formatted} ${holding.symbol}` : '--'}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, wordBreak: 'break-all' }}>合约: {TOKEN_CONTRACT}</div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.9 }}>
                钱包: {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : '未连接钱包'}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>NFT 持有数: {ownedTokens.length}</div>
              {holdingErr ? <div style={{ marginTop: 6, color: '#b91c1c', fontSize: 12 }}>读取失败: {holdingErr}</div> : null}
            </section>

            <section className="farm-card" style={{ border: '2px solid #7ea46a', background: 'rgba(255,255,255,0.74)', padding: 12, borderRadius: 6 }}>
              <FarmPanelTitle label="道具与农场状态" icon="tuft" tone="mint" />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                <SpriteIcon name={ITEM_SPRITE.WHEAT} size={16} />
                <span>WHEAT: {profile.items.WHEAT}</span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                <SpriteIcon name={ITEM_SPRITE.CORN} size={16} />
                <span>CORN: {profile.items.CORN}</span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                <SpriteIcon name={ITEM_SPRITE.CARROT} size={16} />
                <span>CARROT: {profile.items.CARROT}</span>
              </div>
              <div style={{ fontSize: 12, opacity: 0.82, marginBottom: 4 }}>
                总道具: {itemTotal} | 工具: {toolTotal}
              </div>
              <div style={{ fontSize: 12, opacity: 0.82 }}>
                当前选择: {selectedSeed}
              </div>
            </section>

            <section className="farm-card" style={{ border: '2px solid #7ea46a', background: 'rgba(255,255,255,0.74)', padding: 12, borderRadius: 6 }}>
              <FarmPanelTitle label="等级与经验" icon="seed_corn" tone="sun" />
              <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Lv.{profile.level}</div>
              <div style={{ fontSize: 13, marginBottom: 8 }}>EXP: {profile.exp} / {expToNext}</div>
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
                onClick={handleUpgrade}
                disabled={!canUpgrade}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontWeight: 700,
                  border: '2px solid #6d9768',
                  background: canUpgrade ? '#f4ffd6' : '#e7f0da',
                  color: canUpgrade ? '#355537' : '#6f8193',
                  cursor: canUpgrade ? 'pointer' : 'not-allowed',
                  fontFamily: "'Space Mono', monospace",
                }}
              >
                {canUpgrade ? '升级' : `经验不足 (还差 ${expToNext - profile.exp})`}
              </button>
            </section>

            <section className="farm-card" style={{ border: '2px solid #7ea46a', background: 'rgba(255,255,255,0.74)', padding: 12, borderRadius: 6, fontSize: 12 }}>
              <FarmPanelTitle label="操作提示" icon="rock_small" tone="soil" />
              <div style={{ opacity: 0.85, lineHeight: 1.7 }}>
                1. 先选种子，再点击空地种植。<br />
                2. 地块发光时表示可收获。<br />
                3. 可收获数量大于 0 时，使用右上角一键收获。
              </div>
            </section>
          </aside>
        </div>

        <style>{`
          .farm-card {
            box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.1), 0 2px 0 rgba(126, 164, 106, 0.28);
          }

          .farm-layout {
            display: grid;
            grid-template-columns: minmax(0, 1.75fr) minmax(280px, 1fr);
            gap: 12px;
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

          .seed-btn:not(:disabled):hover {
            transform: translateY(-1px);
            box-shadow: inset 0 -2px 0 rgba(0,0,0,0.14), 0 1px 0 rgba(0,0,0,0.12);
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
            top: 80px;
          }

          @media (max-width: 980px) {
            .farm-layout {
              grid-template-columns: 1fr;
            }

            .farm-sidebar {
              position: static;
            }
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

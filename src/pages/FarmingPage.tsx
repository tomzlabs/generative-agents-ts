import { useEffect, useMemo, useState } from 'react';
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
const PROFILE_KEY = 'ga:farm:profile-v4';
const PLOTS_KEY = 'ga:farm:plots-v1';
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

const ITEM_ICON: Record<CropType, string> = {
  WHEAT: '/static/assets/farm/seed-wheat.svg',
  CORN: '/static/assets/farm/seed-corn.svg',
  CARROT: '/static/assets/farm/seed-carrot.svg',
};

const CLOUD_DECOR = [
  { left: '10%', top: '9%', scale: 0.9 },
  { left: '30%', top: '6%', scale: 1.1 },
  { left: '54%', top: '10%', scale: 0.95 },
  { left: '76%', top: '7%', scale: 1.05 },
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

const GRASS_TUFTS = [
  { left: '8%', top: '10%' }, { left: '17%', top: '18%' }, { left: '24%', top: '8%' },
  { left: '74%', top: '11%' }, { left: '83%', top: '19%' }, { left: '90%', top: '8%' },
  { left: '8%', top: '84%' }, { left: '16%', top: '92%' }, { left: '26%', top: '86%' },
  { left: '74%', top: '87%' }, { left: '84%', top: '93%' }, { left: '90%', top: '85%' },
];

const ROCK_DECOR = [
  { left: '6%', top: '30%', scale: 1.2 },
  { left: '13%', top: '72%', scale: 0.9 },
  { left: '86%', top: '28%', scale: 1.1 },
  { left: '80%', top: '74%', scale: 1.0 },
  { left: '50%', top: '9%', scale: 0.8 },
  { left: '46%', top: '90%', scale: 0.85 },
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

export function FarmingPage(props: { ownedTokens: number[]; account: string | null }) {
  const { ownedTokens, account } = props;
  const [selectedSeed, setSelectedSeed] = useState<CropType>('WHEAT');
  const [plots, setPlots] = useState<Plot[]>(() => normalizePlots(loadFromStorage<Plot[]>(PLOTS_KEY)));
  const [profile, setProfile] = useState<FarmProfile>(() => normalizeProfile(loadFromStorage<FarmProfile>(PROFILE_KEY)));
  const [pendingPlotId, setPendingPlotId] = useState<number | null>(null);
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

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100%',
        padding: '20px 18px 32px',
        boxSizing: 'border-box',
        color: '#1f2937',
        fontFamily: "'Space Mono', monospace",
        background:
          'linear-gradient(180deg, #7dceff 0%, #7dceff 30%, #b6f785 30%, #9be76a 100%)',
      }}
    >
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <h1
          style={{
            margin: '4px 0 14px',
            color: '#1b4f7d',
            fontFamily: "'Press Start 2P', cursive",
            fontSize: 'clamp(17px, 2.4vw, 28px)',
            textShadow: '0 1px 0 rgba(255,255,255,0.5)',
          }}
        >
          TOWN FARM // 9 PLOTS
        </h1>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 12 }}>
          {(['WHEAT', 'CORN', 'CARROT'] as CropType[]).map((seed) => (
            <button
              key={seed}
              onClick={() => setSelectedSeed(seed)}
              style={{
                padding: '10px 14px',
                border: '2px solid #4d6f8d',
                background: selectedSeed === seed ? '#ffffff' : '#dff2ff',
                color: '#274057',
                fontWeight: 700,
                fontFamily: 'inherit',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.08)',
              }}
            >
              <img src={ITEM_ICON[seed]} alt={`${seed} seed`} width={18} height={18} style={{ imageRendering: 'pixelated' }} />
              {seed} ({profile.items[seed]})
            </button>
          ))}
        </div>

        <div
          style={{
            width: 'min(96vw, 980px)',
            aspectRatio: '16 / 9',
            margin: '0 auto 18px',
            position: 'relative',
            border: '4px solid #7aa852',
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 8px 22px rgba(24, 58, 89, 0.2)',
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
            <img
              key={`${f.left}-${f.top}-${i}`}
              src="/static/assets/farm/flower-pixel.svg"
              alt=""
              style={{
                position: 'absolute',
                left: f.left,
                top: f.top,
                width: 18,
                height: 18,
                imageRendering: 'pixelated',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            />
          ))}

          {GRASS_TUFTS.map((t, i) => (
            <img
              key={`${t.left}-${t.top}-${i}`}
              src="/static/assets/farm/grass-tuft.svg"
              alt=""
              style={{
                position: 'absolute',
                left: t.left,
                top: t.top,
                width: 20,
                height: 20,
                imageRendering: 'pixelated',
                transform: 'translate(-50%, -50%)',
                opacity: 0.9,
                pointerEvents: 'none',
              }}
            />
          ))}

          {ROCK_DECOR.map((r, i) => (
            <img
              key={`${r.left}-${r.top}-${i}`}
              src="/static/assets/farm/rock-cluster.svg"
              alt=""
              style={{
                position: 'absolute',
                left: r.left,
                top: r.top,
                width: 28,
                height: 22,
                imageRendering: 'pixelated',
                transform: `translate(-50%, -50%) scale(${r.scale})`,
                opacity: 0.9,
                pointerEvents: 'none',
              }}
            />
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
            <div style={{ width: '100%', aspectRatio: '3 / 2', margin: '0 auto', display: 'grid', gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gap: 8 }}>
              {plots.map((plot) => (
                <button
                  key={plot.id}
                  onClick={() => void handlePlotClick(plot.id)}
                  disabled={pendingPlotId === plot.id}
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
                    opacity: pendingPlotId === plot.id ? 0.7 : 1,
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <section style={{ border: '2px solid #8cb2cf', background: 'rgba(255,255,255,0.75)', padding: 12 }}>
            <div style={{ fontWeight: 700, color: '#2f5878', marginBottom: 8 }}>代币持仓（链上）</div>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.3 }}>
              {!account ? '--' : loadingHolding ? 'Loading...' : holding ? `${holding.formatted} ${holding.symbol}` : '--'}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>合约: {TOKEN_CONTRACT}</div>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
              钱包: {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : '未连接钱包'}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>NFT 持有数: {ownedTokens.length}</div>
            {holdingErr ? <div style={{ marginTop: 6, color: '#b91c1c', fontSize: 12 }}>读取失败: {holdingErr}</div> : null}
          </section>

          <section style={{ border: '2px solid #8cb2cf', background: 'rgba(255,255,255,0.75)', padding: 12 }}>
            <div style={{ fontWeight: 700, color: '#2f5878', marginBottom: 8 }}>道具个数</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
              <img src={ITEM_ICON.WHEAT} alt="Wheat seed" width={16} height={16} style={{ imageRendering: 'pixelated' }} />
              <span>WHEAT: {profile.items.WHEAT}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
              <img src={ITEM_ICON.CORN} alt="Corn seed" width={16} height={16} style={{ imageRendering: 'pixelated' }} />
              <span>CORN: {profile.items.CORN}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <img src={ITEM_ICON.CARROT} alt="Carrot seed" width={16} height={16} style={{ imageRendering: 'pixelated' }} />
              <span>CARROT: {profile.items.CARROT}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
              总道具: {itemTotal} | 工具: {toolTotal}
            </div>
          </section>

          <section style={{ border: '2px solid #8cb2cf', background: 'rgba(255,255,255,0.75)', padding: 12 }}>
            <div style={{ fontWeight: 700, color: '#2f5878', marginBottom: 8 }}>等级与经验</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Lv.{profile.level}</div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>EXP: {profile.exp} / {expToNext}</div>
            <div style={{ height: 10, background: '#d7e7f4', border: '1px solid #9bb8cf', marginBottom: 10 }}>
              <div style={{ width: `${progressPct}%`, height: '100%', background: '#6fb35f' }} />
            </div>
            <button
              onClick={handleUpgrade}
              disabled={!canUpgrade}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontWeight: 700,
                border: '2px solid #4f7ea3',
                background: canUpgrade ? '#f7fbff' : '#dbe8f3',
                color: canUpgrade ? '#24435f' : '#6f8193',
                cursor: canUpgrade ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
              }}
            >
              {canUpgrade ? '升级' : `经验不足 (还差 ${expToNext - profile.exp})`}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

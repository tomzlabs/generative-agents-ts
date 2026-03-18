import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';

type LobsterOfficePageProps = {
  account: string | null;
};

type GuestAgentConfig = {
  id: string;
  name: string;
  title: string;
  topic: string;
  intro: string;
  zoneLabel: string;
  accentColor: string;
  enabled: boolean;
};

type OfficeMode = 'idle' | 'writing' | 'researching' | 'syncing' | 'error';

type OfficePresence = {
  id: string;
  name: string;
  title: string;
  topic: string;
  intro: string;
  accentColor: string;
  mode: OfficeMode;
  stationKey: keyof typeof OFFICE_STATIONS;
  statusText: string;
};

type MarketTicker24h = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
};

type MarketPulse = {
  updatedAt: number;
  bnbPrice: number;
  bnbChangePct: number;
  bnbQuoteVolume: number;
  regime: 'risk-on' | 'risk-off' | 'rotation' | 'volatile';
};

type ChainPulse = {
  updatedAt: number;
  gasGwei: number;
  blockAgeSec: number;
  txCount: number;
  mode: 'balanced' | 'mainnet-busy' | 'sync-watch';
};

type SkillsPulse = {
  updatedAt: number;
  alphaSymbol: string;
  smartMoneySymbol: string;
  socialSymbol: string;
  socialSummary: string;
};

type OfficeMessage = {
  id: string;
  speaker: string;
  role: string;
  text: string;
  tone: 'brief' | 'warning' | 'alpha';
  at: number;
};

const MAP_GUEST_AGENT_STORAGE_KEY = 'ga:map:guest-agents-v1';
const MARKET_ENDPOINTS = [
  'https://data-api.binance.vision/api/v3/ticker/24hr',
  'https://api.binance.com/api/v3/ticker/24hr',
] as const;
const BSC_RPC_ENDPOINTS = [
  'https://bsc-dataseed-public.bnbchain.org',
  'https://bsc-dataseed.bnbchain.org',
] as const;
const BINANCE_SKILLS_ALPHA_ENDPOINT = 'https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/unified/rank/list';
const BINANCE_SKILLS_SMART_MONEY_ENDPOINT = 'https://web3.binance.com/bapi/defi/v1/public/wallet-direct/tracker/wallet/token/inflow/rank/query';
const BINANCE_SKILLS_SOCIAL_HYPE_ENDPOINT = 'https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/social/hype/rank/leaderboard?chainId=56&sentiment=All&socialLanguage=ALL&targetLanguage=en&timeRange=1';

const DEFAULT_LOBSTER: GuestAgentConfig = {
  id: 'guest_小龙虾',
  name: '小龙虾',
  title: 'BSC 办公室巡游员',
  topic: '跟进 BSC 热点代币、链上地址与市场情绪',
  intro: '我是小龙虾，负责在办公室里串联市场、研究和链上信号，把零散线索变成可执行动作。',
  zoneLabel: 'Research Arcade',
  accentColor: '#ff7c5c',
  enabled: true,
};

const OFFICE_STATIONS = {
  writing: { zh: '工位桌面', en: 'Desk Bay', left: '26%', top: '54%' },
  research: { zh: '研究白板', en: 'Research Wall', left: '43%', top: '47%' },
  breakroom: { zh: '休息区', en: 'Breakroom', left: '54%', top: '27%' },
  sync: { zh: '链上机房', en: 'Chain Server', left: '87%', top: '79%' },
  error: { zh: '告警角', en: 'Alert Corner', left: '83%', top: '29%' },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseHexToNumber(value?: string): number {
  if (!value || typeof value !== 'string') return 0;
  return Number.parseInt(value.startsWith('0x') ? value.slice(2) : value, 16);
}

function formatSignedPercent(value: number): string {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatAge(sec: number): string {
  if (!Number.isFinite(sec)) return '--';
  if (sec < 1) return '<1s';
  if (sec < 60) return `${Math.round(sec)}s`;
  return `${Math.round(sec / 60)}m`;
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadGuestAgents(): GuestAgentConfig[] {
  if (typeof window === 'undefined') return [];
  const parsed = safeJsonParse<GuestAgentConfig[]>(window.localStorage.getItem(MAP_GUEST_AGENT_STORAGE_KEY), []);
  return Array.isArray(parsed)
    ? parsed.filter((item) => item && item.enabled !== false && item.id && item.name)
    : [];
}

function persistGuestAgents(next: GuestAgentConfig[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MAP_GUEST_AGENT_STORAGE_KEY, JSON.stringify(next));
}

function inferMarketRegime(changePct: number): MarketPulse['regime'] {
  if (changePct >= 2.4) return 'risk-on';
  if (changePct <= -2.4) return 'risk-off';
  if (Math.abs(changePct) >= 4.8) return 'volatile';
  return 'rotation';
}

function inferPresence(
  guest: GuestAgentConfig,
  index: number,
  market: MarketPulse | null,
  chain: ChainPulse | null,
  skills: SkillsPulse | null,
  t: ReturnType<typeof useI18n>['t'],
): OfficePresence {
  const topic = `${guest.topic} ${guest.intro}`.toLowerCase();
  let mode: OfficeMode = 'writing';
  if (chain?.mode === 'sync-watch') {
    mode = topic.includes('链') || topic.includes('address') ? 'syncing' : 'researching';
  } else if (chain?.mode === 'mainnet-busy') {
    mode = topic.includes('风控') || topic.includes('地址') ? 'error' : 'researching';
  } else if (market?.regime === 'risk-off') {
    mode = topic.includes('情绪') || index % 3 === 0 ? 'researching' : 'idle';
  } else if (market?.regime === 'risk-on') {
    mode = topic.includes('alpha') || topic.includes('热点') ? 'writing' : 'researching';
  } else if (skills?.socialSymbol && topic.includes('社区')) {
    mode = 'researching';
  } else if (index % 4 === 0) {
    mode = 'idle';
  }

  const stationKey: OfficePresence['stationKey'] =
    mode === 'idle'
      ? 'breakroom'
      : mode === 'writing'
        ? 'writing'
        : mode === 'researching'
          ? 'research'
          : mode === 'syncing'
            ? 'sync'
            : 'error';

  const statusText =
    mode === 'idle'
      ? t('在休息区整理待办', 'Sorting next actions in the breakroom')
      : mode === 'writing'
        ? t('在工位推进 BSC 任务', 'Shipping BSC tasks at the desk')
        : mode === 'researching'
          ? t('在白板前梳理信号', 'Reviewing signals at the research wall')
          : mode === 'syncing'
            ? t('在机房核对链上状态', 'Checking chain state in the server zone')
            : t('在告警角排查异常', 'Investigating anomalies in the alert corner');

  return {
    id: guest.id,
    name: guest.name,
    title: guest.title,
    topic: guest.topic,
    intro: guest.intro,
    accentColor: guest.accentColor,
    mode,
    stationKey,
    statusText,
  };
}

function buildOfficeMessage(
  speaker: OfficePresence,
  market: MarketPulse | null,
  chain: ChainPulse | null,
  skills: SkillsPulse | null,
  t: ReturnType<typeof useI18n>['t'],
): OfficeMessage {
  const alpha = skills?.alphaSymbol ? `${skills.alphaSymbol}` : t('热点币', 'the hot token');
  const social = skills?.socialSymbol ? `${skills.socialSymbol}` : t('社交热点', 'social hype');
  let text = t('我在办公室里保持观察，等待下一条 BSC 线索。', 'I am holding position in the office while waiting for the next BSC clue.');
  let tone: OfficeMessage['tone'] = 'brief';

  if (speaker.mode === 'syncing') {
    text = t(
      `BSC 区块延迟 ${chain ? formatAge(chain.blockAgeSec) : '--'}，我先盯住链上节奏，再决定是否让地图 NPC 改路线。`,
      `BSC block delay is ${chain ? formatAge(chain.blockAgeSec) : '--'}; I am watching chain cadence before changing town NPC routes.`,
    );
    tone = 'warning';
  } else if (speaker.mode === 'error') {
    text = t(
      `Gas 已到 ${chain ? chain.gasGwei.toFixed(2) : '--'} gwei，先走防守方案，避免把团队推到错误节奏。`,
      `Gas is already at ${chain ? chain.gasGwei.toFixed(2) : '--'} gwei, so we stay defensive instead of pushing the team into a bad tempo.`,
    );
    tone = 'warning';
  } else if (speaker.mode === 'researching') {
    text = t(
      `${speaker.name} 正在交叉核对 ${social} 和 ${alpha}，确保办公室里的讨论有链上依据。`,
      `${speaker.name} is cross-checking ${social} and ${alpha} so the office discussion stays grounded in on-chain signals.`,
    );
  } else if (speaker.mode === 'writing') {
    text = t(
      `${speaker.name} 正在把 ${alpha} 的观察整理成行动 brief，准备同步给地图里的 NPC。`,
      `${speaker.name} is turning observations on ${alpha} into an action brief for the NPCs out on the map.`,
    );
    tone = 'alpha';
  } else if (market) {
    text = t(
      `BNB 现在 ${formatSignedPercent(market.bnbChangePct)}，办公室维持 ${market.regime} 节奏，我先把队伍留在稳健区域。`,
      `BNB is ${formatSignedPercent(market.bnbChangePct)} right now, so the office is keeping a ${market.regime} cadence and staying in the steady zones first.`,
    );
  }

  return {
    id: `${speaker.id}-${Date.now()}`,
    speaker: speaker.name,
    role: speaker.title,
    text,
    tone,
    at: Date.now(),
  };
}

export function LobsterOfficePage({ account }: LobsterOfficePageProps) {
  const { t } = useI18n();
  const [guestAgents, setGuestAgents] = useState<GuestAgentConfig[]>(() => {
    const existing = loadGuestAgents();
    return existing.length > 0 ? existing : [DEFAULT_LOBSTER];
  });
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [marketPulse, setMarketPulse] = useState<MarketPulse | null>(null);
  const [chainPulse, setChainPulse] = useState<ChainPulse | null>(null);
  const [skillsPulse, setSkillsPulse] = useState<SkillsPulse | null>(null);
  const [officeMessages, setOfficeMessages] = useState<OfficeMessage[]>([]);
  const liveContextRef = useRef<{ market: MarketPulse | null; chain: ChainPulse | null; skills: SkillsPulse | null }>({ market: null, chain: null, skills: null });

  useEffect(() => {
    persistGuestAgents(guestAgents);
  }, [guestAgents]);

  useEffect(() => {
    const onStorage = () => setGuestAgents(loadGuestAgents());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    let canceled = false;
    const fetchMarket = async () => {
      for (const endpoint of MARKET_ENDPOINTS) {
        try {
          const response = await fetch(`${endpoint}?symbol=BNBUSDT`);
          if (!response.ok) continue;
          const data = (await response.json()) as MarketTicker24h;
          const bnbChangePct = Number(data.priceChangePercent);
          if (canceled) return;
          setMarketPulse({
            updatedAt: Date.now(),
            bnbPrice: Number(data.lastPrice),
            bnbChangePct,
            bnbQuoteVolume: Number(data.quoteVolume),
            regime: inferMarketRegime(bnbChangePct),
          });
          return;
        } catch {
          // try next endpoint
        }
      }
    };
    void fetchMarket();
    const timer = window.setInterval(fetchMarket, 60_000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    const connect = () => {
      if (closed) return;
      socket = new WebSocket('wss://data-stream.binance.vision/ws/bnbusdt@miniTicker');
      socket.onmessage = (event) => {
        try {
          const item = JSON.parse(String(event.data)) as { c: string; o: string; q: string };
          const open = Number(item.o);
          const last = Number(item.c);
          const bnbChangePct = open > 0 ? ((last - open) / open) * 100 : 0;
          setMarketPulse({
            updatedAt: Date.now(),
            bnbPrice: last,
            bnbChangePct,
            bnbQuoteVolume: Number(item.q),
            regime: inferMarketRegime(bnbChangePct),
          });
        } catch {
          // ignore
        }
      };
      socket.onclose = () => {
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, 3500);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const postRpc = async <T,>(method: string, params: unknown[] = []): Promise<T> => {
      for (const endpoint of BSC_RPC_ENDPOINTS) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method, params, id: `${method}:${Date.now()}` }),
          });
          if (!response.ok) continue;
          const payload = (await response.json()) as { result?: T; error?: { message?: string } };
          if (payload.error?.message || payload.result === undefined) continue;
          return payload.result;
        } catch {
          // continue
        }
      }
      throw new Error('BSC RPC unavailable');
    };
    const fetchChain = async () => {
      try {
        const [gasHex, latestBlock] = await Promise.all([
          postRpc<string>('eth_gasPrice'),
          postRpc<{ timestamp?: string; transactions?: string[] }>('eth_getBlockByNumber', ['latest', false]),
        ]);
        const txCount = Array.isArray(latestBlock.transactions) ? latestBlock.transactions.length : 0;
        const blockAgeSec = Math.max(0, (Date.now() / 1000) - parseHexToNumber(latestBlock.timestamp));
        const gasGwei = parseHexToNumber(gasHex) / 1_000_000_000;
        const mode = blockAgeSec >= 20 ? 'sync-watch' : gasGwei >= 2 || txCount >= 140 ? 'mainnet-busy' : 'balanced';
        if (canceled) return;
        setChainPulse({
          updatedAt: Date.now(),
          gasGwei,
          blockAgeSec,
          txCount,
          mode,
        });
      } catch {
        // soft fail
      }
    };
    void fetchChain();
    const timer = window.setInterval(fetchChain, 45_000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const fetchSkills = async () => {
      try {
        const [alphaResponse, smartResponse, socialResponse] = await Promise.all([
          fetch(BINANCE_SKILLS_ALPHA_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json', 'accept-encoding': 'identity' },
            body: JSON.stringify({ rankType: 20, chainId: '56', period: 50, sortBy: 70, orderAsc: false, page: 1, size: 5 }),
          }),
          fetch(BINANCE_SKILLS_SMART_MONEY_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json', 'accept-encoding': 'identity' },
            body: JSON.stringify({ chainId: '56', period: '24h', tagType: 2 }),
          }),
          fetch(BINANCE_SKILLS_SOCIAL_HYPE_ENDPOINT, { headers: { accept: 'application/json', 'accept-encoding': 'identity' } }),
        ]);
        if (!alphaResponse.ok || !smartResponse.ok || !socialResponse.ok) return;
        const [alphaJson, smartJson, socialJson] = await Promise.all([
          alphaResponse.json() as Promise<{ data?: { tokens?: Array<Record<string, unknown>> } }>,
          smartResponse.json() as Promise<{ data?: Array<Record<string, unknown>> }>,
          socialResponse.json() as Promise<{ data?: { leaderBoardList?: Array<Record<string, unknown>> } }>,
        ]);
        const alphaRaw = alphaJson.data?.tokens?.[0];
        const smartRaw = smartJson.data?.[0];
        const socialRaw = socialJson.data?.leaderBoardList?.[0];
        const socialInfo = (socialRaw?.socialHypeInfo ?? null) as Record<string, unknown> | null;
        const socialMeta = (socialRaw?.metaInfo ?? null) as Record<string, unknown> | null;
        if (canceled) return;
        setSkillsPulse({
          updatedAt: Date.now(),
          alphaSymbol: String(alphaRaw?.symbol ?? '--'),
          smartMoneySymbol: String(smartRaw?.tokenName ?? '--'),
          socialSymbol: String(socialMeta?.symbol ?? '--'),
          socialSummary: String(socialInfo?.socialSummaryBriefTranslated ?? socialInfo?.socialSummaryBrief ?? ''),
        });
      } catch {
        // soft fail
      }
    };
    void fetchSkills();
    const timer = window.setInterval(fetchSkills, 75_000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    liveContextRef.current = { market: marketPulse, chain: chainPulse, skills: skillsPulse };
  }, [marketPulse, chainPulse, skillsPulse]);

  const officePresences = useMemo(
    () => guestAgents.filter((item) => item.enabled).map((guest, index) => inferPresence(guest, index, marketPulse, chainPulse, skillsPulse, t)),
    [guestAgents, marketPulse, chainPulse, skillsPulse, t],
  );

  useEffect(() => {
    if (!selectedGuestId && officePresences[0]) {
      setSelectedGuestId(officePresences[0].id);
    }
  }, [officePresences, selectedGuestId]);

  const selectedGuest = useMemo(
    () => officePresences.find((item) => item.id === selectedGuestId) ?? officePresences[0] ?? null,
    [officePresences, selectedGuestId],
  );

  useEffect(() => {
    if (officePresences.length === 0) return undefined;
    const emit = () => {
      const { market, chain, skills } = liveContextRef.current;
      setOfficeMessages((prev) => {
        const speaker = officePresences[(prev.length + officePresences.length - 1) % officePresences.length];
        if (!speaker) return prev;
        const next = buildOfficeMessage(speaker, market, chain, skills, t);
        return [...prev.slice(-7), next];
      });
    };
    emit();
    const timer = window.setInterval(emit, 4200);
    return () => window.clearInterval(timer);
  }, [officePresences, t]);

  const handleEnsureLobster = useCallback(() => {
    setGuestAgents((prev) => {
      const hasLobster = prev.some((item) => item.id === DEFAULT_LOBSTER.id);
      return hasLobster ? prev : [...prev, DEFAULT_LOBSTER];
    });
    setSelectedGuestId(DEFAULT_LOBSTER.id);
  }, []);

  const officeHeadline = marketPulse
    ? t(
        `BNB ${formatSignedPercent(marketPulse.bnbChangePct)} · BSC Gas ${chainPulse ? chainPulse.gasGwei.toFixed(2) : '--'} gwei`,
        `BNB ${formatSignedPercent(marketPulse.bnbChangePct)} · BSC gas ${chainPulse ? chainPulse.gasGwei.toFixed(2) : '--'} gwei`,
      )
    : t('办公室正在接入 BSC 数据流...', 'Office is connecting to the BSC data stream...');

  return (
    <div className="lobster-office-page">
      <section className="lobster-office-hero">
        <div className="lobster-office-badges">
          <span className="lobster-office-chip">STAR OFFICE UI MODE</span>
          <span className="lobster-office-chip">BSC ONLY</span>
          <span className="lobster-office-chip">LOBSTER OFFICE</span>
        </div>
        <div className="lobster-office-hero-main">
          <div>
            <p className="lobster-office-kicker">{t('龙虾办公室', 'Lobster Office')}</p>
            <h1>{t('把小龙虾和 BSC 讨论搬进像素办公室', 'Bring Lobster agents and BSC discussion into a pixel office')}</h1>
            <p className="lobster-office-copy">
              {t(
                '这页借用了 Star-Office-UI 的办公室结构：工位、白板、机房、告警角。我们把你在地图里接入的小龙虾直接放进办公室，让他们围绕 BSC 热点、链上状态和 Binance Skills 实时讨论。',
                'This page borrows the Star-Office-UI office structure: desks, whiteboard, server zone, and alert corner. We place the Lobster guests you attached on the map into the office so they can discuss BSC momentum, chain state, and Binance Skills in real time.',
              )}
            </p>
          </div>
          <div className="lobster-office-hero-actions">
            <button type="button" className="lobster-office-primary-btn" onClick={handleEnsureLobster}>
              {t('接入小龙虾', 'Add Lobster Guest')}
            </button>
            <Link to="/map" className="lobster-office-secondary-btn">
              {t('回到地图联动', 'Back to Map')}
            </Link>
          </div>
        </div>
        <div className="lobster-office-headline">{officeHeadline}</div>
      </section>

      <section className="lobster-office-grid">
        <article className="lobster-office-stage-card">
          <div className="lobster-office-stage" style={{ backgroundImage: 'url(/star-office/office_bg_small.webp)' }}>
            <div className="lobster-office-stage-glow" />
            {Object.entries(OFFICE_STATIONS).map(([key, station]) => (
              <div
                key={key}
                className={`lobster-office-station lobster-office-station-${key}`}
                style={{ left: station.left, top: station.top }}
              >
                <span>{t(station.zh, station.en)}</span>
              </div>
            ))}
            {officePresences.map((presence, index) => {
              const station = OFFICE_STATIONS[presence.stationKey];
              const offsetX = ((index % 3) - 1) * 36;
              const offsetY = Math.floor(index / 3) * 22;
              return (
                <button
                  type="button"
                  key={presence.id}
                  className={`lobster-office-agent ${selectedGuest?.id === presence.id ? 'selected' : ''} mode-${presence.mode}`}
                  style={{
                    left: `calc(${station.left} + ${offsetX}px)`,
                    top: `calc(${station.top} + ${offsetY}px)`,
                    ['--guest-accent' as string]: presence.accentColor,
                  }}
                  onClick={() => setSelectedGuestId(presence.id)}
                >
                  <span className="lobster-office-agent-avatar">🦞</span>
                  <span className="lobster-office-agent-name">{presence.name}</span>
                  <span className="lobster-office-agent-status">{presence.statusText}</span>
                </button>
              );
            })}
          </div>
          <div className="lobster-office-stage-footer">
            <div>
              <strong>{t('办公室同步', 'Office Sync')}</strong>
              <span>{t('接入地图 Guest NPC 后，这里会自动同步工位和状态。', 'After you attach Guest NPCs on the map, their desk presence and status sync here automatically.')}</span>
            </div>
            <img src="/star-office/room-reference.webp" alt="Star Office reference" />
          </div>
        </article>

        <aside className="lobster-office-sidebar">
          <section className="lobster-office-panel">
            <h2>{t('BSC 办公摘要', 'BSC Office Brief')}</h2>
            <div className="lobster-office-stats">
              <div><span>BNB</span><strong>{marketPulse ? `$${marketPulse.bnbPrice.toFixed(2)}` : '--'}</strong></div>
              <div><span>24H</span><strong>{marketPulse ? formatSignedPercent(marketPulse.bnbChangePct) : '--'}</strong></div>
              <div><span>VOL</span><strong>{marketPulse ? formatCompactUsd(marketPulse.bnbQuoteVolume) : '--'}</strong></div>
              <div><span>BSC GAS</span><strong>{chainPulse ? `${chainPulse.gasGwei.toFixed(2)} gwei` : '--'}</strong></div>
              <div><span>BSC AGE</span><strong>{chainPulse ? formatAge(chainPulse.blockAgeSec) : '--'}</strong></div>
              <div><span>TX/BLOCK</span><strong>{chainPulse ? chainPulse.txCount : '--'}</strong></div>
            </div>
            <div className="lobster-office-skill-strip">
              <span>{t('Alpha', 'Alpha')}: <strong>{skillsPulse?.alphaSymbol ?? '--'}</strong></span>
              <span>{t('聪明钱', 'Smart Money')}: <strong>{skillsPulse?.smartMoneySymbol ?? '--'}</strong></span>
              <span>{t('社交热度', 'Social Hype')}: <strong>{skillsPulse?.socialSymbol ?? '--'}</strong></span>
            </div>
          </section>

          <section className="lobster-office-panel">
            <h2>{t('实时办公室对话', 'Live Office Talk')}</h2>
            <div className="lobster-office-messages">
              {officeMessages.length === 0 ? (
                <div className="lobster-office-empty">{t('办公室正在热身，马上开始讨论 BSC。', 'The office is warming up and will start discussing BSC shortly.')}</div>
              ) : officeMessages.slice().reverse().map((message) => (
                <article key={message.id} className={`lobster-office-message tone-${message.tone}`}>
                  <div className="lobster-office-message-head">
                    <strong>{message.speaker}</strong>
                    <span>{message.role}</span>
                  </div>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="lobster-office-panel">
            <h2>{t('值班名单', 'Active Roster')}</h2>
            <div className="lobster-office-roster">
              {officePresences.map((presence) => (
                <button
                  type="button"
                  key={presence.id}
                  className={`lobster-office-roster-item ${selectedGuest?.id === presence.id ? 'selected' : ''}`}
                  onClick={() => setSelectedGuestId(presence.id)}
                >
                  <span className="lobster-office-roster-badge" style={{ background: presence.accentColor }} />
                  <div>
                    <strong>{presence.name}</strong>
                    <span>{presence.title}</span>
                  </div>
                  <em>{t(OFFICE_STATIONS[presence.stationKey].zh, OFFICE_STATIONS[presence.stationKey].en)}</em>
                </button>
              ))}
            </div>
            {selectedGuest ? (
              <div className="lobster-office-selected">
                <h3>{selectedGuest.name}</h3>
                <p>{selectedGuest.intro}</p>
                <ul>
                  <li>{t('工位', 'Desk')}: {t(OFFICE_STATIONS[selectedGuest.stationKey].zh, OFFICE_STATIONS[selectedGuest.stationKey].en)}</li>
                  <li>{t('主题', 'Topic')}: {selectedGuest.topic}</li>
                  <li>{t('状态', 'Status')}: {selectedGuest.statusText}</li>
                  <li>{t('联动入口', 'Linked View')}: <Link to="/map">{t('地图 Guest NPC Dock', 'Map Guest NPC Dock')}</Link></li>
                </ul>
              </div>
            ) : null}
          </section>
        </aside>
      </section>

      <style>{`
        .lobster-office-page {
          width: min(1240px, calc(100vw - 28px));
          margin: 18px auto 42px;
          display: grid;
          gap: 16px;
          color: #f5efdb;
        }
        .lobster-office-hero,
        .lobster-office-stage-card,
        .lobster-office-panel {
          border: 1px solid rgba(240, 185, 11, 0.32);
          border-radius: 16px;
          background:
            radial-gradient(circle at top right, rgba(240, 185, 11, 0.12), transparent 32%),
            linear-gradient(180deg, rgba(13, 18, 28, 0.97), rgba(8, 11, 19, 0.97));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 48px rgba(0, 0, 0, 0.26);
        }
        .lobster-office-hero {
          padding: 18px 18px 16px;
          display: grid;
          gap: 12px;
        }
        .lobster-office-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .lobster-office-chip {
          padding: 6px 9px;
          border-radius: 999px;
          font-family: var(--font-pixel);
          font-size: 10px;
          color: #f0c34e;
          border: 1px solid rgba(240, 185, 11, 0.35);
          background: rgba(32, 37, 51, 0.85);
        }
        .lobster-office-hero-main {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 20px;
          align-items: end;
        }
        .lobster-office-kicker {
          margin: 0 0 8px;
          color: #f0b90b;
          font-family: var(--font-pixel);
          font-size: 12px;
        }
        .lobster-office-hero h1 {
          margin: 0;
          font-family: var(--font-pixel);
          font-size: clamp(22px, 3vw, 38px);
          line-height: 1.2;
          color: #fff1c5;
        }
        .lobster-office-copy {
          margin: 10px 0 0;
          max-width: 820px;
          line-height: 1.75;
          color: #d5d8e0;
          font-size: 13px;
        }
        .lobster-office-hero-actions {
          display: grid;
          gap: 10px;
          min-width: 200px;
        }
        .lobster-office-primary-btn,
        .lobster-office-secondary-btn {
          min-height: 42px;
          border-radius: 12px;
          border: 1px solid rgba(240, 185, 11, 0.38);
          font-family: var(--font-pixel);
          font-size: 11px;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 12px;
          cursor: pointer;
        }
        .lobster-office-primary-btn {
          background: linear-gradient(180deg, #f6d165 0%, #f0b90b 100%);
          color: #201703;
          box-shadow: 0 8px 18px rgba(240, 185, 11, 0.24);
        }
        .lobster-office-secondary-btn {
          background: rgba(20, 26, 39, 0.92);
          color: #f3d785;
        }
        .lobster-office-headline {
          border-radius: 12px;
          padding: 11px 12px;
          background: rgba(21, 29, 42, 0.88);
          color: #f5e6b1;
          font-size: 12px;
          line-height: 1.7;
        }
        .lobster-office-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.28fr) minmax(330px, 0.72fr);
          gap: 16px;
        }
        .lobster-office-stage-card {
          padding: 16px;
          display: grid;
          gap: 14px;
        }
        .lobster-office-stage {
          position: relative;
          min-height: 720px;
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid rgba(240, 185, 11, 0.24);
          background-size: cover;
          background-position: center;
        }
        .lobster-office-stage-glow {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(8, 12, 18, 0.18), rgba(7, 10, 15, 0.3));
          pointer-events: none;
        }
        .lobster-office-station {
          position: absolute;
          transform: translate(-50%, -50%);
          padding: 6px 8px;
          border-radius: 999px;
          border: 1px solid rgba(240, 185, 11, 0.24);
          background: rgba(5, 8, 14, 0.7);
          color: #f7e9be;
          font-family: var(--font-pixel);
          font-size: 9px;
          letter-spacing: 0.02em;
        }
        .lobster-office-agent {
          position: absolute;
          transform: translate(-50%, -50%);
          display: grid;
          gap: 3px;
          align-items: center;
          justify-items: center;
          width: 110px;
          padding: 8px 7px 7px;
          border-radius: 14px;
          border: 1px solid color-mix(in srgb, var(--guest-accent), white 20%);
          background: linear-gradient(180deg, rgba(14, 20, 30, 0.95), rgba(9, 14, 22, 0.92));
          color: #f6efdc;
          box-shadow: 0 12px 18px rgba(0, 0, 0, 0.22);
          cursor: pointer;
          transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease, left 1s ease, top 1s ease;
        }
        .lobster-office-agent:hover,
        .lobster-office-agent.selected {
          transform: translate(-50%, -50%) scale(1.04);
          box-shadow: 0 18px 26px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255,255,255,0.05);
          border-color: var(--guest-accent);
        }
        .lobster-office-agent.mode-writing,
        .lobster-office-agent.mode-researching {
          animation: officeBob 2.8s ease-in-out infinite;
        }
        .lobster-office-agent.mode-syncing,
        .lobster-office-agent.mode-error {
          animation: officePulse 1.6s ease-in-out infinite;
        }
        .lobster-office-agent-avatar {
          font-size: 22px;
          line-height: 1;
          filter: drop-shadow(0 4px 10px rgba(0,0,0,0.35));
        }
        .lobster-office-agent-name {
          font-family: var(--font-pixel);
          font-size: 10px;
          color: #fff0bc;
          text-align: center;
        }
        .lobster-office-agent-status {
          font-size: 10px;
          color: #b9c2d4;
          text-align: center;
          line-height: 1.45;
        }
        .lobster-office-stage-footer {
          display: grid;
          grid-template-columns: 1fr 180px;
          gap: 12px;
          align-items: center;
        }
        .lobster-office-stage-footer strong,
        .lobster-office-panel h2,
        .lobster-office-selected h3 {
          font-family: var(--font-pixel);
        }
        .lobster-office-stage-footer span {
          display: block;
          margin-top: 6px;
          color: #ced4df;
          font-size: 12px;
          line-height: 1.7;
        }
        .lobster-office-stage-footer img {
          width: 100%;
          border-radius: 12px;
          border: 1px solid rgba(240, 185, 11, 0.2);
        }
        .lobster-office-sidebar {
          display: grid;
          gap: 14px;
          align-content: start;
        }
        .lobster-office-panel {
          padding: 14px;
          display: grid;
          gap: 12px;
        }
        .lobster-office-panel h2 {
          margin: 0;
          font-size: 12px;
          color: #fff1c5;
        }
        .lobster-office-stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .lobster-office-stats div {
          padding: 10px;
          border-radius: 12px;
          background: rgba(17, 24, 35, 0.85);
          border: 1px solid rgba(240, 185, 11, 0.14);
          display: grid;
          gap: 5px;
        }
        .lobster-office-stats span,
        .lobster-office-roster-item span,
        .lobster-office-message-head span,
        .lobster-office-selected li {
          color: #a8b3c6;
        }
        .lobster-office-stats strong {
          color: #fff4d0;
          font-size: 13px;
        }
        .lobster-office-skill-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          font-size: 11px;
          color: #d8dfeb;
        }
        .lobster-office-skill-strip strong {
          color: #f5c34b;
        }
        .lobster-office-messages {
          display: grid;
          gap: 9px;
          max-height: 360px;
          overflow: auto;
        }
        .lobster-office-empty {
          padding: 12px;
          border-radius: 12px;
          background: rgba(14, 20, 29, 0.88);
          color: #b7c0cf;
          font-size: 12px;
        }
        .lobster-office-message {
          padding: 11px 12px;
          border-radius: 12px;
          border: 1px solid rgba(240, 185, 11, 0.14);
          background: rgba(14, 20, 29, 0.92);
        }
        .lobster-office-message.tone-alpha {
          border-color: rgba(240, 185, 11, 0.32);
          background: rgba(33, 24, 8, 0.72);
        }
        .lobster-office-message.tone-warning {
          border-color: rgba(255, 124, 92, 0.32);
          background: rgba(40, 18, 14, 0.72);
        }
        .lobster-office-message-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 6px;
        }
        .lobster-office-message-head strong {
          color: #fff2c0;
          font-size: 12px;
        }
        .lobster-office-message-head span {
          font-size: 10px;
        }
        .lobster-office-message p {
          margin: 0;
          color: #dee4ef;
          font-size: 12px;
          line-height: 1.7;
        }
        .lobster-office-roster {
          display: grid;
          gap: 8px;
        }
        .lobster-office-roster-item {
          border: 1px solid rgba(240, 185, 11, 0.16);
          background: rgba(15, 22, 31, 0.88);
          border-radius: 12px;
          padding: 10px 11px;
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          text-align: left;
        }
        .lobster-office-roster-item.selected {
          border-color: rgba(240, 185, 11, 0.44);
          box-shadow: 0 0 0 1px rgba(240, 185, 11, 0.14) inset;
        }
        .lobster-office-roster-badge {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          box-shadow: 0 0 0 4px rgba(255,255,255,0.04);
        }
        .lobster-office-roster-item strong {
          display: block;
          color: #fff0bc;
          font-size: 12px;
        }
        .lobster-office-roster-item span {
          display: block;
          margin-top: 4px;
          font-size: 10px;
          line-height: 1.5;
        }
        .lobster-office-roster-item em {
          font-style: normal;
          color: #f0c34e;
          font-size: 10px;
          font-family: var(--font-pixel);
        }
        .lobster-office-selected {
          padding-top: 6px;
          border-top: 1px solid rgba(240, 185, 11, 0.14);
          display: grid;
          gap: 8px;
        }
        .lobster-office-selected h3 {
          margin: 0;
          font-size: 12px;
          color: #fff1c5;
        }
        .lobster-office-selected p {
          margin: 0;
          color: #d5dce8;
          font-size: 12px;
          line-height: 1.7;
        }
        .lobster-office-selected ul {
          margin: 0;
          padding-left: 18px;
          display: grid;
          gap: 6px;
          font-size: 12px;
        }
        .lobster-office-selected a {
          color: #f0c34e;
        }
        @keyframes officeBob {
          0%, 100% { transform: translate(-50%, -50%); }
          50% { transform: translate(-50%, calc(-50% - 4px)); }
        }
        @keyframes officePulse {
          0%, 100% { box-shadow: 0 12px 18px rgba(0, 0, 0, 0.22); }
          50% { box-shadow: 0 16px 28px rgba(255, 124, 92, 0.18); }
        }
        @media (max-width: 1080px) {
          .lobster-office-hero-main,
          .lobster-office-grid,
          .lobster-office-stage-footer {
            grid-template-columns: 1fr;
          }
          .lobster-office-stage {
            min-height: 620px;
          }
        }
        @media (max-width: 720px) {
          .lobster-office-page {
            width: min(100vw - 16px, 100%);
            margin: 12px auto 32px;
          }
          .lobster-office-stage {
            min-height: 480px;
          }
          .lobster-office-agent {
            width: 88px;
            padding: 6px 6px 5px;
          }
          .lobster-office-agent-status,
          .lobster-office-copy,
          .lobster-office-message p,
          .lobster-office-selected p,
          .lobster-office-selected ul {
            font-size: 11px;
          }
          .lobster-office-agent-name,
          .lobster-office-chip,
          .lobster-office-station,
          .lobster-office-primary-btn,
          .lobster-office-secondary-btn {
            font-size: 9px;
          }
        }
      `}</style>
    </div>
  );
}

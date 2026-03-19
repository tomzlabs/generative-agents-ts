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
  source?: 'ai' | 'fallback';
};

type OfficeChatResponse = {
  ok?: boolean;
  provider?: string;
  model?: string;
  messages?: Array<{
    speaker?: string;
    role?: string;
    text?: string;
    tone?: OfficeMessage['tone'];
  }>;
};

type OfficeBackendConfig = {
  enabled: boolean;
  baseUrl: string;
  joinKey: string;
};

type RemoteOfficeRegistration = {
  localGuestId: string;
  agentId: string;
  name: string;
  title: string;
  topic: string;
  intro: string;
  zoneLabel: string;
  accentColor: string;
  joinKey: string;
  backendBaseUrl: string;
  lastPushAt: number;
};

type RemoteOfficeAgent = {
  agentId: string;
  name: string;
  state?: string;
  detail?: string;
  authStatus?: string;
  area?: string;
  avatar?: string;
  isMain?: boolean;
  updated_at?: string;
  lastPushAt?: string;
};

type LocalLobsterDraft = {
  name: string;
  title: string;
  topic: string;
  zoneLabel: string;
};

const MAP_GUEST_AGENT_STORAGE_KEY = 'ga:map:guest-agents-v1';
const OFFICE_BACKEND_CONFIG_STORAGE_KEY = 'ga:office:backend-config-v1';
const OFFICE_BACKEND_REGISTRATIONS_STORAGE_KEY = 'ga:office:backend-registrations-v1';
const DEFAULT_STAR_OFFICE_API_BASE = 'https://star-office-api-production.up.railway.app';
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

const LOCAL_LOBSTER_ZONE_OPTIONS = [
  'Research Arcade',
  'Spot Plaza',
  'Launch Sands',
  'BSC Hub',
] as const;

const LOCAL_LOBSTER_ACCENTS = ['#ff7c5c', '#f0b90b', '#60d3ff', '#8de17f', '#e087ff'] as const;

const OFFICE_STATIONS = {
  writing: { zh: '工位桌面', en: 'Desk Bay', left: '26%', top: '54%' },
  research: { zh: '研究白板', en: 'Research Wall', left: '43%', top: '47%' },
  breakroom: { zh: '休息区', en: 'Breakroom', left: '54%', top: '27%' },
  sync: { zh: '链上机房', en: 'Chain Server', left: '87%', top: '79%' },
  error: { zh: '告警角', en: 'Alert Corner', left: '83%', top: '29%' },
} as const;


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

function normalizeOfficeBackendBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/api/star-office' || /127\.0\.0\.1:19000/.test(trimmed) || /localhost:19000/.test(trimmed)) return DEFAULT_STAR_OFFICE_API_BASE;
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function buildOfficeBackendUrl(baseUrl: string, path: string): string {
  const normalizedBase = normalizeOfficeBackendBaseUrl(baseUrl);
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
}

function loadOfficeBackendConfig(): OfficeBackendConfig {
  const parsed = safeJsonParse<OfficeBackendConfig>(
    typeof window === 'undefined' ? null : window.localStorage.getItem(OFFICE_BACKEND_CONFIG_STORAGE_KEY),
    {
      enabled: false,
      baseUrl: DEFAULT_STAR_OFFICE_API_BASE,
      joinKey: '',
    },
  );
  return {
    ...parsed,
    baseUrl: normalizeOfficeBackendBaseUrl(parsed.baseUrl || ''),
  };
}

function persistOfficeBackendConfig(next: OfficeBackendConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OFFICE_BACKEND_CONFIG_STORAGE_KEY, JSON.stringify(next));
}

function loadRemoteOfficeRegistrations(): RemoteOfficeRegistration[] {
  if (typeof window === 'undefined') return [];
  const parsed = safeJsonParse<RemoteOfficeRegistration[]>(
    window.localStorage.getItem(OFFICE_BACKEND_REGISTRATIONS_STORAGE_KEY),
    [],
  );
  return Array.isArray(parsed) ? parsed.filter((item) => item && item.agentId && item.localGuestId) : [];
}

function persistRemoteOfficeRegistrations(next: RemoteOfficeRegistration[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OFFICE_BACKEND_REGISTRATIONS_STORAGE_KEY, JSON.stringify(next));
}

function slugifyLocalGuestId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
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

function mapAgentStateToOfficeMode(state?: string, authStatus?: string): OfficeMode {
  if (authStatus === 'offline') return 'idle';
  switch (state) {
    case 'writing':
      return 'writing';
    case 'researching':
      return 'researching';
    case 'executing':
      return 'writing';
    case 'syncing':
      return 'syncing';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

function mapModeToBackendState(mode: OfficeMode): 'idle' | 'writing' | 'researching' | 'syncing' | 'error' {
  switch (mode) {
    case 'writing':
      return 'writing';
    case 'researching':
      return 'researching';
    case 'syncing':
      return 'syncing';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

function inferRemotePresence(
  agent: RemoteOfficeAgent,
  metadata: RemoteOfficeRegistration | undefined,
  t: ReturnType<typeof useI18n>['t'],
): OfficePresence {
  const mode = mapAgentStateToOfficeMode(agent.state, agent.authStatus);
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
  const detailText = (agent.detail || '').trim();
  const fallbackStatus =
    mode === 'idle'
      ? t('在休息区待命', 'Standing by in the breakroom')
      : mode === 'writing'
        ? t('在工位推进任务', 'Pushing tasks at the desk')
        : mode === 'researching'
          ? t('在白板前做研究', 'Researching at the board')
          : mode === 'syncing'
            ? t('在机房同步状态', 'Syncing status in the server zone')
            : t('在告警角排查异常', 'Investigating anomalies in the alert corner');

  return {
    id: metadata?.localGuestId ?? `remote:${agent.agentId}`,
    name: metadata?.name ?? agent.name,
    title: metadata?.title ?? (agent.isMain ? t('办公室主持人', 'Office Host') : t('远程龙虾', 'Remote Lobster')),
    topic: metadata?.topic ?? (detailText || t('接入办公室后端同步状态', 'Syncing state through the office backend')),
    intro: metadata?.intro ?? t(
      `${agent.name} 正通过 Star Office 后端接入办公室，当前状态会随着 join-agent / agent-push 同步到场景。`,
      `${agent.name} is connected through the Star Office backend, and their office state now syncs through join-agent / agent-push.`,
    ),
    accentColor: metadata?.accentColor ?? '#f0b90b',
    mode,
    stationKey,
    statusText: detailText || fallbackStatus,
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
  const smartMoney = skills?.smartMoneySymbol ? `${skills.smartMoneySymbol}` : t('聪明钱目标', 'smart money target');
  let text = t('我先在办公室里盯住 BSC 节奏。', 'I am watching the BSC rhythm from the office first.');
  let tone: OfficeMessage['tone'] = 'brief';

  if (speaker.mode === 'syncing') {
    text = t(
      `先盯 BSC 区块，当前延迟 ${chain ? formatAge(chain.blockAgeSec) : '--'}，地图那边先别追高频动作。`,
      `Watch the BSC blocks first. Delay is ${chain ? formatAge(chain.blockAgeSec) : '--'}, so the town should avoid high-frequency moves for now.`,
    );
    tone = 'warning';
  } else if (speaker.mode === 'error') {
    text = t(
      `Gas 到了 ${chain ? chain.gasGwei.toFixed(2) : '--'} gwei，先走防守路线，暂停高频推进。`,
      `Gas is at ${chain ? chain.gasGwei.toFixed(2) : '--'} gwei, so we switch to a defensive route and pause high-frequency pushes.`,
    );
    tone = 'warning';
  } else if (speaker.mode === 'researching') {
    text = t(
      `${speaker.name} 在白板复核 ${social}、${alpha} 和 ${smartMoney}，看热度有没有链上支撑。`,
      `${speaker.name} is reviewing ${social}, ${alpha}, and ${smartMoney} on the board to see whether hype is backed by on-chain flow.`,
    );
  } else if (speaker.mode === 'writing') {
    text = t(
      `${speaker.name} 正在把 ${alpha} 的观察整理成 briefing，准备发给地图里的 NPC。`,
      `${speaker.name} is turning observations on ${alpha} into a briefing for the NPCs out on the map.`,
    );
    tone = 'alpha';
  } else if (market) {
    text = t(
      `BNB ${formatSignedPercent(market.bnbChangePct)}，办公室先维持 ${market.regime} 节奏，把队伍留在稳健区域。`,
      `BNB is ${formatSignedPercent(market.bnbChangePct)}, so the office keeps a ${market.regime} cadence and holds the team in steadier zones.`,
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
  const [officeBackendConfig, setOfficeBackendConfig] = useState<OfficeBackendConfig>(() => loadOfficeBackendConfig());
  const [remoteRegistrations, setRemoteRegistrations] = useState<RemoteOfficeRegistration[]>(() => loadRemoteOfficeRegistrations());
  const [remoteAgents, setRemoteAgents] = useState<RemoteOfficeAgent[]>([]);
  const [officeBackendState, setOfficeBackendState] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [officeBackendMessage, setOfficeBackendMessage] = useState<string>('');
  const [officeBackendOfficeName, setOfficeBackendOfficeName] = useState<string>('');
  const [isJoiningAgent, setIsJoiningAgent] = useState(false);
  const [officeChatMode, setOfficeChatMode] = useState<'ai' | 'fallback' | 'idle'>('idle');
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [marketPulse, setMarketPulse] = useState<MarketPulse | null>(null);
  const [chainPulse, setChainPulse] = useState<ChainPulse | null>(null);
  const [skillsPulse, setSkillsPulse] = useState<SkillsPulse | null>(null);
  const [officeMessages, setOfficeMessages] = useState<OfficeMessage[]>([]);
  const [localLobsterDraft, setLocalLobsterDraft] = useState<LocalLobsterDraft>({
    name: '',
    title: t('BSC 本地助理', 'BSC Local Assistant'),
    topic: t('跟进我本地最关心的 BSC 任务和代币', 'Track the BSC tasks and tokens I care about locally'),
    zoneLabel: 'Research Arcade',
  });
  const liveContextRef = useRef<{ market: MarketPulse | null; chain: ChainPulse | null; skills: SkillsPulse | null }>({ market: null, chain: null, skills: null });
  const officeMessagesRef = useRef<OfficeMessage[]>([]);
  const officeMessageSeqRef = useRef(0);
  const officeChatInFlightRef = useRef(false);

  useEffect(() => {
    persistGuestAgents(guestAgents);
  }, [guestAgents]);

  useEffect(() => {
    persistOfficeBackendConfig(officeBackendConfig);
  }, [officeBackendConfig]);

  useEffect(() => {
    persistRemoteOfficeRegistrations(remoteRegistrations);
  }, [remoteRegistrations]);

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

  useEffect(() => {
    officeMessagesRef.current = officeMessages;
  }, [officeMessages]);

  const localOfficePresences = useMemo(
    () => guestAgents.filter((item) => item.enabled).map((guest, index) => inferPresence(guest, index, marketPulse, chainPulse, skillsPulse, t)),
    [guestAgents, marketPulse, chainPulse, skillsPulse, t],
  );

  const localPresenceById = useMemo(() => new Map(localOfficePresences.map((item) => [item.id, item])), [localOfficePresences]);
  const remoteRegistrationByAgentId = useMemo(() => new Map(remoteRegistrations.map((item) => [item.agentId, item])), [remoteRegistrations]);
  const effectiveBackendBaseUrl = useMemo(
    () => normalizeOfficeBackendBaseUrl(officeBackendConfig.baseUrl),
    [officeBackendConfig.baseUrl],
  );

  const officeBackendFetch = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(buildOfficeBackendUrl(effectiveBackendBaseUrl, path), {
      cache: 'no-store',
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { ok: false, msg: text || `HTTP ${response.status}` };
    }
    if (!response.ok) {
      const msg = typeof data === 'object' && data && 'msg' in data ? String((data as { msg?: unknown }).msg ?? '') : '';
      throw new Error(msg || `HTTP ${response.status}`);
    }
    return data as T;
  }, [effectiveBackendBaseUrl]);

  const refreshOfficeBackendSnapshot = useCallback(async () => {
    if (!officeBackendConfig.enabled) {
      setRemoteAgents([]);
      setOfficeBackendState('idle');
      setOfficeBackendMessage('');
      setOfficeBackendOfficeName('');
      return;
    }

    setOfficeBackendState('connecting');
    try {
      const [status, agents] = await Promise.all([
        officeBackendFetch<{ officeName?: string; detail?: string }>('/status').catch(() => null),
        officeBackendFetch<RemoteOfficeAgent[]>('/agents'),
      ]);
      setRemoteAgents(Array.isArray(agents) ? agents : []);
      setOfficeBackendOfficeName(status?.officeName?.trim() ?? '');
      setOfficeBackendState('connected');
      setOfficeBackendMessage(t('Star Office 后端已连接。', 'Star Office backend connected.'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isProxyUrl = effectiveBackendBaseUrl.startsWith('/api/star-office');
      setOfficeBackendState('error');
      setOfficeBackendMessage(isProxyUrl
        ? t(
            `后端连接失败：${message || '请检查 STAR_OFFICE_API_BASE 是否已配置。'}`,
            `Backend connection failed: ${message || 'Check whether STAR_OFFICE_API_BASE is configured.'}`,
          )
        : t(
            `后端连接失败：${message || '请检查地址或跨域配置。'}`,
            `Backend connection failed: ${message || 'Check the backend URL or CORS configuration.'}`,
          ));
      setRemoteAgents([]);
    }
  }, [effectiveBackendBaseUrl, officeBackendConfig.enabled, officeBackendFetch, t]);

  useEffect(() => {
    void refreshOfficeBackendSnapshot();
    if (!officeBackendConfig.enabled) return undefined;
    const timer = window.setInterval(() => {
      void refreshOfficeBackendSnapshot();
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [officeBackendConfig.enabled, refreshOfficeBackendSnapshot]);

  useEffect(() => {
    if (!officeBackendConfig.enabled || remoteRegistrations.length === 0) return undefined;

    let canceled = false;
    const pushStatuses = async () => {
      for (const registration of remoteRegistrations) {
        const presence = localPresenceById.get(registration.localGuestId);
        if (!presence) continue;
        try {
          await officeBackendFetch<{ ok?: boolean }>('/agent-push', {
            method: 'POST',
            body: JSON.stringify({
              agentId: registration.agentId,
              joinKey: registration.joinKey,
              name: registration.name,
              state: mapModeToBackendState(presence.mode),
              detail: `${presence.title} · ${presence.statusText}`,
            }),
          });
          if (canceled) return;
          setRemoteRegistrations((prev) => prev.map((item) => item.agentId === registration.agentId ? { ...item, lastPushAt: Date.now() } : item));
        } catch {
          // ignore transient push errors; the connection panel already surfaces them on refresh
        }
      }
    };

    void pushStatuses();
    const timer = window.setInterval(() => {
      void pushStatuses();
    }, 18_000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [localPresenceById, officeBackendConfig.enabled, officeBackendFetch, remoteRegistrations]);

  const officePresences = useMemo(() => {
    if (!officeBackendConfig.enabled) return localOfficePresences;
    const remotePresences = remoteAgents
      .map((agent) => inferRemotePresence(agent, remoteRegistrationByAgentId.get(agent.agentId), t))
      .filter((presence) => presence.name);
    const remotePresenceIds = new Set(remotePresences.map((item) => item.id));
    const pendingLocalPresences = localOfficePresences.filter((item) => !remotePresenceIds.has(item.id));
    return remotePresences.length > 0 ? [...remotePresences, ...pendingLocalPresences] : localOfficePresences;
  }, [localOfficePresences, officeBackendConfig.enabled, remoteAgents, remoteRegistrationByAgentId, t]);

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

    let canceled = false;
    const emitFallback = () => {
      const { market, chain, skills } = liveContextRef.current;
      setOfficeMessages((prev) => {
        const speaker = officePresences[(prev.length + officePresences.length - 1) % officePresences.length];
        if (!speaker) return prev;
        const next = {
          ...buildOfficeMessage(speaker, market, chain, skills, t),
          id: `${speaker.id}-${Date.now()}-${officeMessageSeqRef.current++}`,
          source: 'fallback' as const,
        };
        return [...prev.slice(-7), next];
      });
      setOfficeChatMode('fallback');
    };

    const emitAi = async () => {
      if (officeChatInFlightRef.current) return;
      officeChatInFlightRef.current = true;
      try {
        const { market, chain, skills } = liveContextRef.current;
        const response = await officeBackendFetch<OfficeChatResponse>('/office-chat', {
          method: 'POST',
          body: JSON.stringify({
            officeName: officeBackendOfficeName || t('龙虾办公室', 'Lobster Office'),
            lang: document.documentElement.lang?.toLowerCase().startsWith('zh') ? 'zh' : 'en',
            market,
            chain,
            skills,
            roster: officePresences.map((presence) => ({
              name: presence.name,
              title: presence.title,
              topic: presence.topic,
              statusText: presence.statusText,
              stationLabel: t(OFFICE_STATIONS[presence.stationKey].zh, OFFICE_STATIONS[presence.stationKey].en),
            })),
            recentMessages: officeMessagesRef.current.slice(-4).map((message) => ({
              speaker: message.speaker,
              text: message.text,
            })),
          }),
        });

        if (canceled || !response?.ok || !Array.isArray(response.messages) || response.messages.length === 0) {
          emitFallback();
          return;
        }

        setOfficeMessages((prev) => {
          const nextMessages = response.messages
            ?.map((message, index) => {
              const matched = officePresences.find((presence) => presence.name === (message.speaker || '').trim());
              const text = String(message.text || '').trim();
              if (!text) return null;
              return {
                id: `${matched?.id || message.speaker || 'office'}-${Date.now()}-${officeMessageSeqRef.current++}-${index}`,
                speaker: matched?.name || String(message.speaker || t('办公室成员', 'Office Member')),
                role: String(message.role || matched?.title || t('办公室成员', 'Office Member')),
                text,
                tone: message.tone === 'warning' || message.tone === 'alpha' ? message.tone : 'brief',
                at: Date.now() + index,
                source: response.provider === 'fallback' ? 'fallback' : 'ai',
              } satisfies OfficeMessage;
            })
            .filter(Boolean) as OfficeMessage[];

          if (nextMessages.length === 0) return prev;
          return [...prev.slice(-(8 - nextMessages.length)), ...nextMessages];
        });
        setOfficeChatMode(response.provider === 'fallback' ? 'fallback' : 'ai');
      } catch {
        if (!canceled) emitFallback();
      } finally {
        officeChatInFlightRef.current = false;
      }
    };

    void emitAi();
    const timer = window.setInterval(() => {
      void emitAi();
    }, 12_000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [officeBackendFetch, officeBackendOfficeName, officePresences, t]);

  const handleEnsureLobster = useCallback(() => {
    setGuestAgents((prev) => {
      const hasLobster = prev.some((item) => item.id === DEFAULT_LOBSTER.id);
      return hasLobster ? prev : [...prev, DEFAULT_LOBSTER];
    });
    setLocalLobsterDraft({
      name: DEFAULT_LOBSTER.name,
      title: DEFAULT_LOBSTER.title,
      topic: DEFAULT_LOBSTER.topic,
      zoneLabel: DEFAULT_LOBSTER.zoneLabel,
    });
    setSelectedGuestId(DEFAULT_LOBSTER.id);
  }, []);

  const handleAddLocalLobster = useCallback(() => {
    const run = async () => {
      const trimmedName = localLobsterDraft.name.trim();
      if (!trimmedName || isJoiningAgent) return;

      const slug = slugifyLocalGuestId(trimmedName) || `entry-${Date.now()}`;
      const nextGuest: GuestAgentConfig = {
        id: `guest_${slug}`,
        name: trimmedName,
        title: localLobsterDraft.title.trim() || t('BSC 本地助理', 'BSC Local Assistant'),
        topic: localLobsterDraft.topic.trim() || t('跟进我本地最关心的 BSC 任务和代币', 'Track the BSC tasks and tokens I care about locally'),
        intro: t(
          `${trimmedName} 会通过 Star Office 后端接入办公室，同时也会同步到地图里的 Guest NPC Dock。`,
          `${trimmedName} will join the office through the Star Office backend and will also sync into the map Guest NPC Dock.`,
        ),
        zoneLabel: localLobsterDraft.zoneLabel,
        accentColor: LOCAL_LOBSTER_ACCENTS[guestAgents.length % LOCAL_LOBSTER_ACCENTS.length],
        enabled: true,
      };

      const backendEnabled = officeBackendConfig.enabled && officeBackendConfig.joinKey.trim();

      if (!backendEnabled) {
        setGuestAgents((prev) => {
          const deduped = prev.filter((item) => item.id !== nextGuest.id);
          return [...deduped, nextGuest];
        });
        setSelectedGuestId(nextGuest.id);
        setLocalLobsterDraft((prev) => ({ ...prev, name: '' }));
        setOfficeMessages((prev) => [
          ...prev.slice(-7),
          {
            id: `${nextGuest.id}-${Date.now()}-${officeMessageSeqRef.current++}`,
            speaker: nextGuest.name,
            role: nextGuest.title,
            text: t(
              `${nextGuest.name} 已从当前浏览器接入本地办公室，并同步到地图里的 Guest NPC Dock。`,
              `${nextGuest.name} joined this browser's local office and synced to the map Guest NPC Dock.`,
            ),
            tone: 'alpha',
            at: Date.now(),
          },
        ]);
        setOfficeBackendMessage(t('当前是本地模式：龙虾只在你的浏览器和地图联动，不经过后端。', 'Local mode is active: the lobster only syncs with this browser and the map, without using the backend.'));
        return;
      }

      setIsJoiningAgent(true);
      try {
        setGuestAgents((prev) => {
          const deduped = prev.filter((item) => item.id !== nextGuest.id);
          return [...deduped, nextGuest];
        });

        const initialPresence = inferPresence(nextGuest, guestAgents.length, marketPulse, chainPulse, skillsPulse, t);
        const joinResult = await officeBackendFetch<{ ok?: boolean; agentId?: string; msg?: string }>('/join-agent', {
          method: 'POST',
          body: JSON.stringify({
            name: nextGuest.name,
            joinKey: officeBackendConfig.joinKey.trim(),
            state: mapModeToBackendState(initialPresence.mode),
            detail: `${nextGuest.title} · ${initialPresence.statusText}`,
          }),
        });

        if (!joinResult?.ok || !joinResult.agentId) {
          throw new Error(joinResult?.msg || t('join-agent 没有返回 agentId。', 'join-agent did not return an agentId.'));
        }
        const agentId = joinResult.agentId;

        await officeBackendFetch<{ ok?: boolean; msg?: string }>('/agent-push', {
          method: 'POST',
          body: JSON.stringify({
            agentId,
            joinKey: officeBackendConfig.joinKey.trim(),
            name: nextGuest.name,
            state: mapModeToBackendState(initialPresence.mode),
            detail: `${nextGuest.title} · ${initialPresence.statusText}`,
          }),
        });

        setRemoteRegistrations((prev) => {
          const deduped = prev.filter((item) => item.localGuestId !== nextGuest.id && item.agentId !== agentId);
          return [...deduped, {
            localGuestId: nextGuest.id,
            agentId,
            name: nextGuest.name,
            title: nextGuest.title,
            topic: nextGuest.topic,
            intro: nextGuest.intro,
            zoneLabel: nextGuest.zoneLabel,
            accentColor: nextGuest.accentColor,
            joinKey: officeBackendConfig.joinKey.trim(),
            backendBaseUrl: effectiveBackendBaseUrl,
            lastPushAt: Date.now(),
          }];
        });
        setSelectedGuestId(nextGuest.id);
        setLocalLobsterDraft((prev) => ({ ...prev, name: '' }));
        setOfficeBackendState('connected');
        setOfficeBackendMessage(t(`${nextGuest.name} 已接入办公室后端。`, `${nextGuest.name} joined the office backend.`));
        setOfficeMessages((prev) => [
          ...prev.slice(-7),
          {
            id: `${nextGuest.id}-${Date.now()}-${officeMessageSeqRef.current++}`,
            speaker: nextGuest.name,
            role: nextGuest.title,
            text: t(
              `${nextGuest.name} 已通过 join-agent / agent-push 接入办公室，现在会和地图里的 NPC 一起讨论 BSC。`,
              `${nextGuest.name} joined the office through join-agent / agent-push and will now discuss BSC with the map NPCs.`,
            ),
            tone: 'alpha',
            at: Date.now(),
          },
        ]);
        await refreshOfficeBackendSnapshot();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setOfficeBackendState('error');
        setOfficeBackendMessage(t(
          `接入失败：${message || '请检查后端地址、Join Key 或代理配置。'}`,
          `Join failed: ${message || 'Check the backend URL, join key, or proxy configuration.'}`,
        ));
      } finally {
        setIsJoiningAgent(false);
      }
    };

    void run();
  }, [chainPulse, effectiveBackendBaseUrl, guestAgents.length, isJoiningAgent, localLobsterDraft, marketPulse, officeBackendConfig.enabled, officeBackendConfig.joinKey, officeBackendFetch, refreshOfficeBackendSnapshot, skillsPulse, t]);

  const officeHeadline = marketPulse
    ? t(
        `BNB ${formatSignedPercent(marketPulse.bnbChangePct)} · BSC Gas ${chainPulse ? chainPulse.gasGwei.toFixed(2) : '--'} gwei`,
        `BNB ${formatSignedPercent(marketPulse.bnbChangePct)} · BSC gas ${chainPulse ? chainPulse.gasGwei.toFixed(2) : '--'} gwei`,
      )
    : t('办公室正在接入 BSC 数据流...', 'Office is connecting to the BSC data stream...');

  useEffect(() => {
    const renderToText = () => JSON.stringify({
      page: 'lobster-office',
      account: account ? `${account.slice(0, 6)}...${account.slice(-4)}` : null,
      market: marketPulse ? { price: marketPulse.bnbPrice, changePct: marketPulse.bnbChangePct, regime: marketPulse.regime } : null,
      chain: chainPulse ? { gasGwei: chainPulse.gasGwei, blockAgeSec: chainPulse.blockAgeSec, txCount: chainPulse.txCount, mode: chainPulse.mode } : null,
      skills: skillsPulse ? { alpha: skillsPulse.alphaSymbol, smartMoney: skillsPulse.smartMoneySymbol, social: skillsPulse.socialSymbol } : null,
      guests: officePresences.map((item) => ({ id: item.id, name: item.name, station: item.stationKey, mode: item.mode })),
      officeBackend: {
        enabled: officeBackendConfig.enabled,
        baseUrl: effectiveBackendBaseUrl,
        state: officeBackendState,
        officeName: officeBackendOfficeName || null,
        remoteAgents: remoteAgents.map((item) => ({ agentId: item.agentId, name: item.name, state: item.state, authStatus: item.authStatus })),
      },
      officeChatMode,
      selectedGuestId: selectedGuest?.id ?? null,
      latestMessage: officeMessages[officeMessages.length - 1] ?? null,
    });
    const advanceTime = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
    Object.assign(window as Window & typeof globalThis & { render_game_to_text?: () => string; advanceTime?: (ms: number) => Promise<void> }, {
      render_game_to_text: renderToText,
      advanceTime,
    });
    return () => {
      delete (window as Window & typeof globalThis & { render_game_to_text?: () => string; advanceTime?: (ms: number) => Promise<void> }).render_game_to_text;
      delete (window as Window & typeof globalThis & { render_game_to_text?: () => string; advanceTime?: (ms: number) => Promise<void> }).advanceTime;
    };
  }, [account, chainPulse, effectiveBackendBaseUrl, marketPulse, officeBackendConfig.enabled, officeBackendOfficeName, officeBackendState, officeChatMode, officeMessages, officePresences, remoteAgents, selectedGuest, skillsPulse]);

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
        <div className="lobster-office-headline">
          {officeHeadline}
          {account ? ` · ${t('值班钱包', 'Duty wallet')}: ${account.slice(0, 6)}...${account.slice(-4)}` : ''}
        </div>
      </section>

      <section className="lobster-office-grid">
        <article className="lobster-office-stage-card">
          <div className="lobster-office-stage" style={{ backgroundImage: 'url(/star-office/office_bg_small.webp)' }}>
            <img
              className="lobster-office-material-overlay"
              src="/star-office/room-reference.webp"
              alt="Star Office material guide"
            />
            <div className="lobster-office-stage-glow" />
            <img
              className="lobster-office-prop lobster-office-prop-sofa"
              src="/star-office/sofa-idle-v3.png"
              alt="Office sofa"
            />
            <img
              className="lobster-office-prop lobster-office-prop-desk"
              src="/star-office/desk-v3.webp"
              alt="Office desk"
            />
            <div className="lobster-office-prop lobster-office-prop-server" aria-hidden="true" />
            <div className="lobster-office-prop lobster-office-prop-poster" aria-hidden="true" />
            <div className="lobster-office-prop lobster-office-prop-plant plant-a" aria-hidden="true" />
            <div className="lobster-office-prop lobster-office-prop-plant plant-b" aria-hidden="true" />
            <div className="lobster-office-prop lobster-office-prop-plant plant-c" aria-hidden="true" />
            <div className="lobster-office-prop lobster-office-prop-flower" aria-hidden="true" />
            <div className="lobster-office-prop lobster-office-prop-coffee" aria-hidden="true" />
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
            <div className="lobster-office-panel-head">
              <h2>{t('实时办公室对话', 'Live Office Talk')}</h2>
              <span className={`lobster-office-ai-badge mode-${officeChatMode}`}>
                {officeChatMode === 'ai'
                  ? t('真 AI', 'Live AI')
                  : officeChatMode === 'fallback'
                    ? t('规则回退', 'Fallback')
                    : t('准备中', 'Booting')}
              </span>
            </div>
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
            <div className="lobster-office-material-note">
              {t('办公室场景已接入 Star-Office-UI 的背景、布局参考、办公桌和咖啡机素材层。', 'The office scene now wires in Star-Office-UI background, layout reference, desk, and coffee-machine material layers.')}
            </div>
          </section>

          <section className="lobster-office-panel">
            <h2>{t('办公室后端连接', 'Office Backend')}</h2>
            <div className="lobster-office-onboard-note">
              {t(
                '这里是可选项。你可以完全不填，直接走本地模式；只有需要让外部龙虾通过 join-agent / agent-push 真接入时，才打开这个后端连接。',
                'This section is optional. You can leave it empty and stay in local mode; only enable it when you want external lobsters to join through real join-agent / agent-push calls.',
              )}
            </div>
            <label className="lobster-office-form-field">
              <span>{t('后端地址', 'Backend URL')}</span>
              <input
                value={officeBackendConfig.baseUrl}
                onChange={(event) => setOfficeBackendConfig((prev) => ({ ...prev, baseUrl: event.target.value }))}
                placeholder="/api/star-office"
              />
            </label>
            <label className="lobster-office-form-field">
              <span>{t('Join Key', 'Join Key')}</span>
              <input
                value={officeBackendConfig.joinKey}
                onChange={(event) => setOfficeBackendConfig((prev) => ({ ...prev, joinKey: event.target.value }))}
                placeholder="ocj_example_team_01"
              />
            </label>
            <div className="lobster-office-toggle-row">
              <label className="lobster-office-checkbox">
                <input
                  type="checkbox"
                  checked={officeBackendConfig.enabled}
                  onChange={(event) => setOfficeBackendConfig((prev) => ({ ...prev, enabled: event.target.checked }))}
                />
                <span>{t('启用真实后端同步', 'Enable live backend sync')}</span>
              </label>
              <button type="button" className="lobster-office-secondary-btn" onClick={() => void refreshOfficeBackendSnapshot()}>
                {t('刷新连接', 'Refresh')}
              </button>
            </div>
            <div className={`lobster-office-backend-status state-${officeBackendState}`}>
              <strong>{officeBackendOfficeName || t('Star Office Backend', 'Star Office Backend')}</strong>
              <span>
                {officeBackendState === 'connected'
                  ? t('已连接', 'Connected')
                  : officeBackendState === 'connecting'
                    ? t('连接中', 'Connecting')
                    : officeBackendState === 'error'
                      ? t('连接失败', 'Connection failed')
                      : t('未启用', 'Disabled')}
              </span>
            </div>
            {officeBackendMessage ? <div className="lobster-office-backend-note">{officeBackendMessage}</div> : null}
          </section>

          <section className="lobster-office-panel">
            <h2>{t('接入我的本地龙虾', 'Add My Local Lobster')}</h2>
            <div className="lobster-office-onboard-note">
              {t(
                '默认不走后端，直接把你的本地龙虾接进当前浏览器和地图。如果你开启了后端连接并填好 Join Key，这里会自动升级成真实的 join-agent / agent-push 模式。',
                'By default this does not use the backend and simply adds your lobster to this browser and the map. If backend sync is enabled and a join key is present, it automatically upgrades to real join-agent / agent-push mode.',
              )}
            </div>
            <label className="lobster-office-form-field">
              <span>{t('龙虾名字', 'Lobster Name')}</span>
              <input
                value={localLobsterDraft.name}
                onChange={(event) => setLocalLobsterDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder={t('例如：阿汤的龙虾', 'Example: Tommy Lobster')}
              />
            </label>
            <label className="lobster-office-form-field">
              <span>{t('职责', 'Role')}</span>
              <input
                value={localLobsterDraft.title}
                onChange={(event) => setLocalLobsterDraft((prev) => ({ ...prev, title: event.target.value }))}
                placeholder={t('例如：BSC 研究助理', 'Example: BSC Research Assistant')}
              />
            </label>
            <label className="lobster-office-form-field">
              <span>{t('讨论主题', 'Discussion Topic')}</span>
              <textarea
                rows={3}
                value={localLobsterDraft.topic}
                onChange={(event) => setLocalLobsterDraft((prev) => ({ ...prev, topic: event.target.value }))}
                placeholder={t('例如：盯住 BSC Alpha、链上资金流和今天要执行的本地任务', 'Example: Track BSC alpha, on-chain flow, and today’s local tasks')}
              />
            </label>
            <label className="lobster-office-form-field">
              <span>{t('默认区域', 'Default Zone')}</span>
              <select
                value={localLobsterDraft.zoneLabel}
                onChange={(event) => setLocalLobsterDraft((prev) => ({ ...prev, zoneLabel: event.target.value }))}
              >
                {LOCAL_LOBSTER_ZONE_OPTIONS.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
            <div className="lobster-office-onboard-actions">
              <button
                type="button"
                className="lobster-office-primary-btn"
                onClick={handleAddLocalLobster}
                disabled={!localLobsterDraft.name.trim() || isJoiningAgent}
              >
                {isJoiningAgent ? t('正在接入...', 'Joining...') : t('接入我的龙虾', 'Join My Lobster')}
              </button>
              <Link to="/map" className="lobster-office-inline-link">
                {t('去地图看同步结果', 'View Sync on Map')}
              </Link>
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
          width: min(1380px, calc(100vw - 24px));
          margin: 10px auto 42px;
          display: grid;
          gap: 12px;
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
          padding: 14px 18px 14px;
          display: grid;
          gap: 10px;
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
          grid-template-columns: minmax(0, 1.46fr) minmax(320px, 0.54fr);
          gap: 14px;
        }
        .lobster-office-stage-card {
          padding: 14px;
          display: grid;
          gap: 12px;
        }
        .lobster-office-stage {
          position: relative;
          aspect-ratio: 16 / 9;
          min-height: 780px;
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid rgba(240, 185, 11, 0.24);
          background-size: 100% 100%;
          background-position: center;
        }
        .lobster-office-material-overlay {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          opacity: 0.1;
          mix-blend-mode: lighten;
          pointer-events: none;
          image-rendering: pixelated;
        }
        .lobster-office-stage-glow {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(8, 12, 18, 0.18), rgba(7, 10, 15, 0.3));
          pointer-events: none;
        }
        .lobster-office-prop {
          position: absolute;
          z-index: 2;
          image-rendering: pixelated;
          pointer-events: none;
          filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.28));
        }
        .lobster-office-prop-sofa {
          width: 132px;
          left: 52.4%;
          top: 20%;
          transform: translate(-50%, -50%);
          z-index: 2;
        }
        .lobster-office-prop-desk {
          width: 198px;
          left: 17%;
          top: 58%;
          transform: translate(-50%, -50%);
          opacity: 0.96;
        }
        .lobster-office-prop-server {
          width: 124px;
          height: 172px;
          left: 79.8%;
          top: 19.8%;
          transform: translate(-50%, -50%);
          background-image: url('/star-office/serverroom-spritesheet.webp');
          background-size: 620px 172px;
          background-position: 0 0;
          background-repeat: no-repeat;
          opacity: 0.96;
        }
        .lobster-office-prop-poster {
          width: 78px;
          height: 156px;
          left: 19.8%;
          top: 10.8%;
          transform: translate(-50%, -50%);
          background-image: url('/star-office/posters-spritesheet.webp');
          background-size: 312px 624px;
          background-position: -78px 0;
          background-repeat: no-repeat;
          opacity: 0.9;
        }
        .lobster-office-prop-plant {
          width: 72px;
          height: 72px;
          background-image: url('/star-office/plants-spritesheet.webp');
          background-size: 288px 288px;
          background-repeat: no-repeat;
        }
        .lobster-office-prop-plant.plant-a {
          left: 44.2%;
          top: 24.5%;
          transform: translate(-50%, -50%);
          background-position: 0 0;
        }
        .lobster-office-prop-plant.plant-b {
          left: 18.3%;
          top: 25.4%;
          transform: translate(-50%, -50%);
          background-position: -72px 0;
        }
        .lobster-office-prop-plant.plant-c {
          left: 76.4%;
          top: 69.1%;
          transform: translate(-50%, -50%);
          background-position: -144px 0;
        }
        .lobster-office-prop-flower {
          width: 58px;
          height: 58px;
          left: 24.3%;
          top: 54.1%;
          transform: translate(-50%, -50%);
          background-image: url('/star-office/flowers-bloom-v2.webp');
          background-size: 58px 58px;
          background-repeat: no-repeat;
          opacity: 0.96;
        }
        .lobster-office-prop-coffee {
          width: 86px;
          height: 86px;
          left: 51.5%;
          top: 55.2%;
          transform: translate(-50%, -50%);
          background-image: url('/star-office/coffee-machine-v3-grid.webp');
          background-size: 860px 573px;
          background-position: 0 0;
          background-repeat: no-repeat;
          opacity: 0.95;
        }
        .lobster-office-station {
          position: absolute;
          z-index: 3;
          transform: translate(-50%, -50%);
          padding: 6px 8px;
          border-radius: 999px;
          border: 1px solid rgba(240, 185, 11, 0.24);
          background: rgba(5, 8, 14, 0.7);
          color: #f7e9be;
          font-family: var(--font-pixel);
          font-size: 9px;
          letter-spacing: 0.02em;
          box-shadow: 0 8px 14px rgba(0, 0, 0, 0.18);
        }
        .lobster-office-agent {
          position: absolute;
          z-index: 4;
          transform: translate(-50%, -50%);
          display: grid;
          gap: 3px;
          align-items: center;
          justify-items: center;
          width: 116px;
          padding: 8px 7px 7px;
          border-radius: 14px;
          border: 1px solid color-mix(in srgb, var(--guest-accent), white 20%);
          background: linear-gradient(180deg, rgba(18, 22, 30, 0.92), rgba(9, 14, 22, 0.84));
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
        .lobster-office-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
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
        .lobster-office-ai-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 26px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid rgba(240, 185, 11, 0.22);
          background: rgba(17, 24, 35, 0.85);
          color: #f8e8b6;
          font-size: 10px;
          font-family: var(--font-pixel);
        }
        .lobster-office-ai-badge.mode-ai {
          border-color: rgba(120, 224, 140, 0.35);
          background: rgba(22, 48, 26, 0.8);
          color: #c9ffd0;
        }
        .lobster-office-ai-badge.mode-fallback {
          border-color: rgba(255, 124, 92, 0.3);
          background: rgba(48, 23, 18, 0.8);
          color: #ffd0c3;
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
        .lobster-office-material-note {
          padding: 10px 11px;
          border-radius: 12px;
          background: rgba(17, 24, 35, 0.74);
          border: 1px dashed rgba(240, 185, 11, 0.16);
          color: #c9d2e1;
          font-size: 11px;
          line-height: 1.65;
        }
        .lobster-office-onboard-note {
          padding: 10px 11px;
          border-radius: 12px;
          background: rgba(17, 24, 35, 0.74);
          border: 1px solid rgba(240, 185, 11, 0.14);
          color: #d6ddeb;
          font-size: 11px;
          line-height: 1.7;
        }
        .lobster-office-toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .lobster-office-checkbox {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #d6ddeb;
          font-size: 12px;
        }
        .lobster-office-backend-status {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 11px;
          border-radius: 12px;
          border: 1px solid rgba(240, 185, 11, 0.16);
          background: rgba(17, 24, 35, 0.78);
        }
        .lobster-office-backend-status strong {
          color: #fff0bc;
          font-size: 12px;
          letter-spacing: 0.04em;
        }
        .lobster-office-backend-status span {
          color: #d6ddeb;
          font-size: 11px;
        }
        .lobster-office-backend-status.state-connected {
          border-color: rgba(120, 224, 140, 0.3);
          background: rgba(32, 58, 34, 0.42);
        }
        .lobster-office-backend-status.state-error {
          border-color: rgba(255, 124, 92, 0.34);
          background: rgba(56, 26, 20, 0.48);
        }
        .lobster-office-backend-note {
          padding: 10px 11px;
          border-radius: 12px;
          background: rgba(17, 24, 35, 0.74);
          border: 1px dashed rgba(240, 185, 11, 0.14);
          color: #d6ddeb;
          font-size: 11px;
          line-height: 1.6;
        }
        .lobster-office-form-field {
          display: grid;
          gap: 6px;
        }
        .lobster-office-form-field span {
          color: #fff0bc;
          font-size: 11px;
          font-family: var(--font-pixel);
        }
        .lobster-office-form-field input,
        .lobster-office-form-field textarea,
        .lobster-office-form-field select {
          width: 100%;
          box-sizing: border-box;
          border-radius: 12px;
          border: 1px solid rgba(240, 185, 11, 0.14);
          background: rgba(15, 22, 31, 0.92);
          color: #f4f6fb;
          padding: 10px 11px;
          font-size: 12px;
          font-family: inherit;
          resize: vertical;
        }
        .lobster-office-form-field textarea {
          min-height: 72px;
        }
        .lobster-office-onboard-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
        }
        .lobster-office-inline-link {
          color: #f0c34e;
          text-decoration: none;
          font-size: 11px;
        }
        .lobster-office-skill-strip strong {
          color: #f5c34b;
        }
        .lobster-office-messages {
          display: grid;
          gap: 9px;
          max-height: 320px;
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
            min-height: 500px;
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

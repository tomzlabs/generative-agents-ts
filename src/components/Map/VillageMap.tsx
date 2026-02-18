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
  pathWaypoints?: Array<{ tx: number; ty: number }>;
  lastMoveTime: number;
  status: string;
  thought?: string;
  thoughtTimer?: number;
  isMoving?: boolean;
  pauseUntil?: number;
  stuckTicks?: number;
  walkOffset?: number;
  ownerAddress?: string;
  mind: AgentMindState;
};

type AgentMindRole = 'strategist' | 'operator' | 'farmer' | 'explorer' | 'guardian' | 'social';
type AgentMindIntent = 'patrol' | 'observe' | 'chat' | 'farm' | 'trade' | 'rest';
type AgentTemperament = 'calm' | 'bold' | 'careful' | 'curious';

type AgentMindState = {
  role: AgentMindRole;
  temperament: AgentTemperament;
  intent: AgentMindIntent;
  energy: number;
  sociability: number;
  focus: number;
  nextDecisionAt: number;
  memory: string[];
  taskQueue: AgentMindIntent[];
  currentTask?: AgentMindIntent;
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

type DailyQuestId = 'plant' | 'harvest' | 'buy' | 'social';

type MapFarmDailyQuestState = {
  dayKey: string;
  progress: Record<DailyQuestId, number>;
  claimed: Record<DailyQuestId, boolean>;
};

type MapFarmGameState = {
  townPoints: number;
  daily: MapFarmDailyQuestState;
  stats: {
    plantActions: number;
    harvestActions: number;
    buyActions: number;
    socialActions: number;
  };
  achievementClaimed: Record<FarmAchievementId, boolean>;
  season: MapFarmSeasonState;
  boosts: {
    growthBoostUntil: number;
    socialBoostUntil: number;
  };
  economy: {
    minted: number;
    burned: number;
  };
};

type FarmAchievementId = 'sprout_begins' | 'harvest_rookie' | 'supply_chain' | 'social_rookie' | 'level_climber' | 'town_star';

type MapFarmSeasonState = {
  seasonKey: string;
  passXp: number;
  proOwned: boolean;
  freeClaimedLevels: number[];
  proClaimedLevels: number[];
};

type MapFarmEventId = 'breeze' | 'festival' | 'rain' | 'starlight';

type MapFarmLiveEvent = {
  id: MapFarmEventId;
  startsAt: number;
  endsAt: number;
  localGrowMultiplier: number;
  actionPointBonus: number;
};

type MapFarmFxKind = 'event' | 'quest' | 'harvest' | 'plant' | 'lottery' | 'buy';

type MapFarmFx = {
  id: string;
  text: string;
  kind: MapFarmFxKind;
  createdAt: number;
};

type MapFarmPanelSectionId = 'quest' | 'achievement' | 'leaderboard' | 'pass' | 'boost' | 'economy' | 'shop';

type MapFarmPanelState = Record<MapFarmPanelSectionId, boolean>;

type MapCollisionGrid = {
  width: number;
  height: number;
  blocked: Uint8Array;
};

type MapExpansionState = {
  level: number;
  progress: number;
  totalProjects: number;
  lastUpgradeAt: number;
};

type MapExpansionBounds = {
  minTx: number;
  maxTx: number;
  minTy: number;
  maxTy: number;
};

type MapExpansionLog = {
  id: string;
  level: number;
  zoneLabelZh: string;
  zoneLabelEn: string;
  unlockedPct: number;
  createdAt: number;
};

type MapExpansionMissionMetric = 'plant' | 'harvest' | 'buy' | 'social' | 'townPoints' | 'level';

type MapExpansionMissionItem = {
  metric: MapExpansionMissionMetric;
  need: number;
  labelZh: string;
  labelEn: string;
};

type MapExpansionMission = {
  level: number;
  titleZh: string;
  titleEn: string;
  items: MapExpansionMissionItem[];
};

type MapExpansionMissionProgress = {
  mission: MapExpansionMission;
  done: boolean;
  doneCount: number;
  totalCount: number;
  statusTextZh: string;
  statusTextEn: string;
  unmetHintZh: string;
  unmetHintEn: string;
};

type MapExpansionDecorationKind = 'grass' | 'flower' | 'rock' | 'sapling' | 'lantern';

type MapExpansionDecoration = {
  tx: number;
  ty: number;
  kind: MapExpansionDecorationKind;
  phase: number;
  size: number;
};

type MapExpansionLandmarkKind = 'signboard' | 'windmill' | 'barn' | 'tower' | 'market' | 'beacon';

type MapExpansionLandmarkMeta = {
  kind: MapExpansionLandmarkKind;
  nameZh: string;
  nameEn: string;
};

type MapExpansionLandmark = {
  level: number;
  tx: number;
  ty: number;
  kind: MapExpansionLandmarkKind;
  nameZh: string;
  nameEn: string;
};

type MapExpansionLandmarkActionKey = 'guide' | 'boost' | 'supply' | 'patrol' | 'shop' | 'upgrade';

type AgentProfile = {
  displayName: string;
  subtitle: string;
  personality: string;
  traits: string[];
  specialties: string[];
  bio: string;
  motto: string;
};

const AGENT_THOUGHTS = [
  '正在分析市场数据…',
  '在寻找新的机会…',
  '正在扫描内存池…',
  '校验区块哈希中…',
  '组合策略计算中…',
  '观察流动性变化…',
  '收益模型推演中…',
  '链上状态同步中…',
  '正在排查合约问题…',
  '优化 Gas 成本中…',
  '继续长期持有…',
  '在找潜在漏洞…',
  '复盘白皮书中…',
  '检查钱包余额中…',
];

const AGENT_CHAT_PAIRS = [
  ['早上好！', '早上好，开工吧！'],
  ['今天收益怎么样？', '还不错，曲线很稳。'],
  ['种子快不够了。', '那就先去补货。'],
  ['有新情报吗？', '有，但要先验证。'],
  ['Gas 现在稳定吗？', '稳定，适合执行。'],
  ['这期谁会中奖？', '等开奖结果吧。'],
  ['地图越来越热闹了。', '所有 Agent 都在线。'],
  ['准备种地了吗？', '随时可以开始。'],
  ['今天冲经验吗？', '冲，争取快升级。'],
  ['BAP-578 同步了吗？', '已同步，身份可验证。'],
] as const;

const AGENT_ROLE_LABEL: Record<AgentMindRole, string> = {
  strategist: '策略统筹',
  operator: '执行运营',
  farmer: '农场管家',
  explorer: '地图探索',
  guardian: '安全巡逻',
  social: '社交连接',
};

const AGENT_INTENT_STATUS: Record<AgentMindIntent, string> = {
  patrol: '巡逻中',
  observe: '观察中',
  chat: '交流中',
  farm: '种植规划中',
  trade: '交易评估中',
  rest: '短暂休整',
};

const AGENT_TEMPERAMENT_LABEL: Record<AgentTemperament, string> = {
  calm: '冷静',
  bold: '果断',
  careful: '谨慎',
  curious: '好奇',
};

const AGENT_ROLE_THOUGHT_BANK: Record<AgentMindRole, Record<AgentMindIntent, string[]>> = {
  strategist: {
    patrol: ['巡查资源分布，准备下一轮动作。', '先看全局，再决定发力点。'],
    observe: ['正在复盘当前回合的收益结构。', '关注链上波动，等待更优时机。'],
    chat: ['跟队友同步策略，统一节奏。', '先把规则讲清楚，再开干。'],
    farm: ['优先保证地块满种，提高周转率。', '种植节奏稳定，经验曲线更健康。'],
    trade: ['对比买地与买种收益，寻找最优解。', '控制成本，奖池效率优先。'],
    rest: ['暂停几秒，重新校准策略。', '回收注意力，准备下一次决策。'],
  },
  operator: {
    patrol: ['我先跑一圈，看看哪里需要补位。', '执行链路正常，继续推进。'],
    observe: ['在看交易确认，马上给反馈。', '流程都在线，暂时无阻塞。'],
    chat: ['收到，我这边立刻协同。', '先沟通再执行，减少返工。'],
    farm: ['优先补种空地，别让地块闲着。', '先小麦稳节奏，再切高收益种子。'],
    trade: ['清点代币和种子库存中。', '先核算预算，再提交交易。'],
    rest: ['我缓一下，马上继续。', '短暂停顿，防止误操作。'],
  },
  farmer: {
    patrol: ['巡地中，优先处理成熟地块。', '看一圈土壤状态，准备下一轮。'],
    observe: ['盯着成熟倒计时，不错过收获点。', '观察每块地的节奏差异。'],
    chat: ['提醒一下：先种满再升级。', '分享经验：等级越高成熟越快。'],
    farm: ['开始播种，冲经验和彩票。', '这轮重点拉满产出。'],
    trade: ['计算种子性价比，准备补货。', '对比三种作物的票数收益。'],
    rest: ['先歇一会儿，等下一批成熟。', '短休后继续耕作循环。'],
  },
  explorer: {
    patrol: ['地图边缘有新动静，我去看看。', '继续扩展视野，收集情报。'],
    observe: ['记录环境变化，更新路线。', '观察人流热点和互动密度。'],
    chat: ['我把探索情报同步给大家。', '附近角色状态已收集完成。'],
    farm: ['路过农区，顺手检查地块效率。', '探索与耕作一起做，节奏更稳。'],
    trade: ['我在看哪条路径资源更多。', '先找高价值区域再做投入。'],
    rest: ['停一下，整理刚才采样的信息。', '休整后继续探路。'],
  },
  guardian: {
    patrol: ['安全巡逻中，异常会立刻上报。', '保持警戒，优先稳定运行。'],
    observe: ['正在审查可疑波动。', '先确认风险，再允许动作。'],
    chat: ['提醒队友：别忽略风控细节。', '风险提示已同步到小队。'],
    farm: ['农区安全正常，可继续种植。', '保障农场主流程稳定。'],
    trade: ['先看授权和余额，再交易。', '风控通过，允许继续执行。'],
    rest: ['短暂待机，安全监控持续。', '保持低频观察，不离线。'],
  },
  social: {
    patrol: ['边走边看，顺便连接大家。', '在找可协作的小队。'],
    observe: ['我在看谁需要帮助。', '观察互动氛围，准备发起话题。'],
    chat: ['来聊聊这轮怎么打更稳。', '同步一下：你们这边进度如何？'],
    farm: ['我来提醒：空地优先补种。', '大家一起把节奏拉起来。'],
    trade: ['互通库存信息，避免浪费。', '先交流策略，再统一买入。'],
    rest: ['我先安静一下，稍后继续。', '休息一下，等会继续社交联动。'],
  },
};

const MAP_FARM_STORAGE_KEY = 'ga:map:farm-v1';
const MAP_FARM_GAME_STORAGE_KEY = 'ga:map:farm-game-v1';
const MAP_FARM_PANEL_STORAGE_KEY = 'ga:map:farm-panel-v1';
const MAP_FARM_SIDEBAR_STORAGE_KEY = 'ga:map:farm-sidebar-v1';
const MAP_EXPANSION_STORAGE_KEY = 'ga:map:expansion-v1';
const MAP_EXPANSION_LOG_STORAGE_KEY = 'ga:map:expansion-log-v1';
const MAP_NFT_LAYOUT_STORAGE_KEY = 'ga:map:nft-layout-v1';
const MAP_AGENT_ACTION_LOG_STORAGE_KEY = 'ga:map:agent-actions-v1';
const MAP_FARM_PANEL_DEFAULT: MapFarmPanelState = {
  quest: true,
  achievement: false,
  leaderboard: false,
  pass: true,
  boost: true,
  economy: false,
  shop: true,
};
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
const MAP_FARM_DAILY_QUEST_TARGET: Record<DailyQuestId, number> = {
  plant: 5,
  harvest: 3,
  buy: 2,
  social: 3,
};
const MAP_FARM_DAILY_QUEST_REWARD: Record<DailyQuestId, number> = {
  plant: 120,
  harvest: 180,
  buy: 140,
  social: 110,
};
const MAP_FARM_ACHIEVEMENT_REWARD: Record<FarmAchievementId, number> = {
  sprout_begins: 220,
  harvest_rookie: 260,
  supply_chain: 280,
  social_rookie: 180,
  level_climber: 320,
  town_star: 500,
};
const MAP_FARM_ACHIEVEMENT_IDS: FarmAchievementId[] = [
  'sprout_begins',
  'harvest_rookie',
  'supply_chain',
  'social_rookie',
  'level_climber',
  'town_star',
];
const MAP_FARM_PASS_XP_PER_LEVEL = 120;
const MAP_FARM_PASS_MAX_LEVEL = 20;
const MAP_FARM_PRO_PASS_COST = 960;
const MAP_FARM_GROWTH_BOOST_COST = 140;
const MAP_FARM_GROWTH_BOOST_MS = 20 * 60 * 1000;
const MAP_FARM_SOCIAL_BOOST_COST = 90;
const MAP_FARM_SOCIAL_BOOST_MS = 15 * 60 * 1000;
const MAP_COLLISION_LAYER_KEYWORDS = ['collisions', 'object interaction blocks', 'arena blocks'] as const;
const MAP_EXPANSION_STAGES = [
  { minXRatio: 0.42, maxXRatio: 0.58, minYRatio: 0.38, maxYRatio: 0.62, need: 90 },
  { minXRatio: 0.34, maxXRatio: 0.66, minYRatio: 0.3, maxYRatio: 0.7, need: 140 },
  { minXRatio: 0.26, maxXRatio: 0.74, minYRatio: 0.22, maxYRatio: 0.78, need: 200 },
  { minXRatio: 0.18, maxXRatio: 0.82, minYRatio: 0.14, maxYRatio: 0.86, need: 280 },
  { minXRatio: 0.1, maxXRatio: 0.9, minYRatio: 0.08, maxYRatio: 0.92, need: 360 },
  { minXRatio: 0.02, maxXRatio: 0.98, minYRatio: 0.02, maxYRatio: 0.98, need: 999999 },
] as const;
const MAP_EXPANSION_ZONE_LABELS = [
  { zh: '中央苗圃', en: 'Central Nursery' },
  { zh: '绿径农廊', en: 'Greenwalk Belt' },
  { zh: '溪湾种植区', en: 'Creek Bay Fields' },
  { zh: '风车农环', en: 'Windmill Ring' },
  { zh: '森畔农场', en: 'Forest Edge Farm' },
  { zh: '全域小镇', en: 'Full Town Area' },
] as const;
const MAP_EXPANSION_MISSIONS: MapExpansionMission[] = [
  {
    level: 1,
    titleZh: '社区动员',
    titleEn: 'Community Mobilization',
    items: [
      { metric: 'plant', need: 3, labelZh: '种植', labelEn: 'Plant' },
      { metric: 'social', need: 2, labelZh: '社交互动', labelEn: 'Social' },
    ],
  },
  {
    level: 2,
    titleZh: '补给联动',
    titleEn: 'Supply Linkup',
    items: [
      { metric: 'plant', need: 8, labelZh: '种植', labelEn: 'Plant' },
      { metric: 'buy', need: 2, labelZh: '商店购买', labelEn: 'Purchases' },
    ],
  },
  {
    level: 3,
    titleZh: '产出验证',
    titleEn: 'Yield Verification',
    items: [
      { metric: 'harvest', need: 6, labelZh: '收获', labelEn: 'Harvest' },
      { metric: 'social', need: 6, labelZh: '社交互动', labelEn: 'Social' },
    ],
  },
  {
    level: 4,
    titleZh: '城镇繁荣',
    titleEn: 'Town Prosperity',
    items: [
      { metric: 'townPoints', need: 1200, labelZh: '城镇点数', labelEn: 'Town Points' },
      { metric: 'level', need: 2, labelZh: '农场等级', labelEn: 'Farm Lv' },
    ],
  },
  {
    level: 5,
    titleZh: '全域整备',
    titleEn: 'Full Region Preparation',
    items: [
      { metric: 'plant', need: 20, labelZh: '种植', labelEn: 'Plant' },
      { metric: 'harvest', need: 14, labelZh: '收获', labelEn: 'Harvest' },
      { metric: 'level', need: 3, labelZh: '农场等级', labelEn: 'Farm Lv' },
    ],
  },
] as const;
const MAP_EXPANSION_LANDMARKS: MapExpansionLandmarkMeta[] = [
  { kind: 'signboard', nameZh: '开拓公告牌', nameEn: 'Frontier Board' },
  { kind: 'windmill', nameZh: '风车站', nameEn: 'Windmill Post' },
  { kind: 'barn', nameZh: '储粮仓', nameEn: 'Storage Barn' },
  { kind: 'tower', nameZh: '巡逻塔', nameEn: 'Watch Tower' },
  { kind: 'market', nameZh: '集市角', nameEn: 'Market Corner' },
  { kind: 'beacon', nameZh: '全域信标', nameEn: 'Town Beacon' },
] as const;
const MAP_FARM_EVENT_PRESETS: Array<{
  id: MapFarmEventId;
  localGrowMultiplier: number;
  actionPointBonus: number;
}> = [
  { id: 'breeze', localGrowMultiplier: 0.86, actionPointBonus: 2 },
  { id: 'festival', localGrowMultiplier: 0.92, actionPointBonus: 4 },
  { id: 'rain', localGrowMultiplier: 0.8, actionPointBonus: 3 },
  { id: 'starlight', localGrowMultiplier: 0.95, actionPointBonus: 5 },
];

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function pickByRandom<T>(list: readonly T[], rnd: () => number): T {
  return list[Math.floor(rnd() * list.length) % list.length];
}

function getRoleByAgentId(agentId: string, source: AgentMarker['source'], seedRnd: () => number): AgentMindRole {
  if (agentId === 'npc_cz') return 'strategist';
  if (agentId === 'npc_heyi') return 'operator';
  if (source === 'demo') return 'explorer';
  const rolePool: AgentMindRole[] = ['farmer', 'explorer', 'guardian', 'social', 'operator', 'strategist'];
  return pickByRandom(rolePool, seedRnd);
}

function createAgentMind(input: { id: string; source: AgentMarker['source']; tokenId?: number }): AgentMindState {
  const seedBase = input.tokenId ?? Array.from(input.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const rnd = createSeededRandom(seedBase + 101);
  const role = getRoleByAgentId(input.id, input.source, rnd);
  const temperamentPool: AgentTemperament[] = ['calm', 'bold', 'careful', 'curious'];
  const temperament = input.id === 'npc_cz'
    ? 'calm'
    : input.id === 'npc_heyi'
      ? 'bold'
      : pickByRandom(temperamentPool, rnd);
  const now = Date.now();
  return {
    role,
    temperament,
    intent: 'observe',
    energy: clamp01(0.55 + rnd() * 0.35),
    sociability: clamp01(0.25 + rnd() * 0.6),
    focus: clamp01(0.3 + rnd() * 0.65),
    nextDecisionAt: now + 800 + Math.floor(rnd() * 2200),
    memory: [],
    taskQueue: [],
    currentTask: undefined,
  };
}

function pickAgentIntent(mind: AgentMindState, rnd: () => number): AgentMindIntent {
  if (mind.energy < 0.2 && rnd() < 0.72) return 'rest';
  const roleIntentPool: Record<AgentMindRole, AgentMindIntent[]> = {
    strategist: ['observe', 'trade', 'patrol', 'chat', 'farm'],
    operator: ['patrol', 'farm', 'chat', 'observe', 'trade'],
    farmer: ['farm', 'patrol', 'observe', 'trade', 'chat'],
    explorer: ['patrol', 'observe', 'chat', 'farm', 'trade'],
    guardian: ['patrol', 'observe', 'trade', 'chat', 'farm'],
    social: ['chat', 'patrol', 'observe', 'farm', 'trade'],
  };
  const pool = roleIntentPool[mind.role];
  if (mind.sociability > 0.68 && rnd() < 0.35) return 'chat';
  if (mind.focus > 0.75 && rnd() < 0.32) return 'observe';
  if (mind.role === 'farmer' && rnd() < 0.4) return 'farm';
  return pickByRandom(pool, rnd);
}

function buildAgentTaskQueue(role: AgentMindRole, rnd: () => number): AgentMindIntent[] {
  const templates: Record<AgentMindRole, AgentMindIntent[][]> = {
    strategist: [
      ['observe', 'trade', 'chat', 'patrol'],
      ['patrol', 'observe', 'trade', 'farm'],
    ],
    operator: [
      ['patrol', 'farm', 'chat', 'observe'],
      ['farm', 'trade', 'patrol', 'chat'],
    ],
    farmer: [
      ['farm', 'farm', 'observe', 'trade'],
      ['patrol', 'farm', 'farm', 'chat'],
    ],
    explorer: [
      ['patrol', 'observe', 'chat', 'patrol'],
      ['observe', 'patrol', 'trade', 'chat'],
    ],
    guardian: [
      ['patrol', 'observe', 'patrol', 'trade'],
      ['observe', 'chat', 'patrol', 'observe'],
    ],
    social: [
      ['chat', 'patrol', 'chat', 'observe'],
      ['patrol', 'chat', 'farm', 'chat'],
    ],
  };
  const picked = pickByRandom(templates[role], rnd).slice();
  if (rnd() < 0.35) picked.push('rest');
  return picked;
}

function pickThoughtForMind(mind: AgentMindState, intent: AgentMindIntent, rnd: () => number): string {
  const bank = AGENT_ROLE_THOUGHT_BANK[mind.role]?.[intent];
  if (bank && bank.length > 0) return pickByRandom(bank, rnd);
  return AGENT_THOUGHTS[Math.floor(rnd() * AGENT_THOUGHTS.length) % AGENT_THOUGHTS.length];
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

function pickIntentTarget(
  agent: AgentMarker,
  intent: AgentMindIntent,
  map: TiledMap,
  minTx: number,
  maxTx: number,
  minTy: number,
  maxTy: number,
  rnd: () => number,
): { targetTx: number; targetTy: number } {
  const pickRect = (x0: number, x1: number, y0: number, y1: number) => {
    const safeMinTx = clamp(Math.min(x0, x1), minTx, maxTx);
    const safeMaxTx = clamp(Math.max(x0, x1), minTx, maxTx);
    const safeMinTy = clamp(Math.min(y0, y1), minTy, maxTy);
    const safeMaxTy = clamp(Math.max(y0, y1), minTy, maxTy);
    return {
      targetTx: clamp(
        Math.floor(safeMinTx + rnd() * Math.max(1, safeMaxTx - safeMinTx + 1)),
        minTx,
        maxTx,
      ),
      targetTy: clamp(
        Math.floor(safeMinTy + rnd() * Math.max(1, safeMaxTy - safeMinTy + 1)),
        minTy,
        maxTy,
      ),
    };
  };
  const viewportRect = () => ({
    targetTx: clamp(Math.floor(minTx + rnd() * Math.max(1, (maxTx - minTx + 1))), minTx, maxTx),
    targetTy: clamp(Math.floor(minTy + rnd() * Math.max(1, (maxTy - minTy + 1))), minTy, maxTy),
  });
  if (agent.id === 'npc_cz' || agent.id === 'npc_heyi') {
    return viewportRect();
  }
  switch (intent) {
    case 'farm':
      return pickRect(
        Math.floor(map.width * 0.36),
        Math.floor(map.width * 0.66),
        Math.floor(map.height * 0.52),
        Math.floor(map.height * 0.86),
      );
    case 'trade':
      return pickRect(
        Math.floor(map.width * 0.45),
        Math.floor(map.width * 0.78),
        Math.floor(map.height * 0.24),
        Math.floor(map.height * 0.56),
      );
    case 'chat':
      return viewportRect();
    case 'observe':
      return pickRect(
        Math.floor(map.width * 0.18),
        Math.floor(map.width * 0.88),
        Math.floor(map.height * 0.14),
        Math.floor(map.height * 0.82),
      );
    case 'rest':
      return {
        targetTx: clamp(Math.floor(agent.tx + (rnd() - 0.5) * 8), minTx, maxTx),
        targetTy: clamp(Math.floor(agent.ty + (rnd() - 0.5) * 8), minTy, maxTy),
      };
    case 'patrol':
    default:
      return {
        targetTx: clamp(Math.floor(minTx + rnd() * Math.max(1, (maxTx - minTx + 1))), minTx, maxTx),
        targetTy: clamp(Math.floor(minTy + rnd() * Math.max(1, (maxTy - minTy + 1))), minTy, maxTy),
      };
  }
}

function buildMapCollisionGrid(map: TiledMap): MapCollisionGrid {
  const blocked = new Uint8Array(map.width * map.height);
  for (const layer of map.layers) {
    if (layer.type !== 'tilelayer' || !Array.isArray(layer.data) || layer.data.length !== map.width * map.height) continue;
    const lowerName = layer.name.toLowerCase();
    const isCollisionLayer = MAP_COLLISION_LAYER_KEYWORDS.some((keyword) => lowerName.includes(keyword));
    if (!isCollisionLayer) continue;
    for (let i = 0; i < layer.data.length; i++) {
      if (layer.data[i] > 0) blocked[i] = 1;
    }
  }
  return {
    width: map.width,
    height: map.height,
    blocked,
  };
}

function isBlockedTile(grid: MapCollisionGrid, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.blocked[(ty * grid.width) + tx] === 1;
}

function isPositionWalkable(
  grid: MapCollisionGrid,
  x: number,
  y: number,
  clearance = 0.22,
): boolean {
  const minX = Math.floor(x - clearance);
  const maxX = Math.floor(x + clearance);
  const minY = Math.floor(y - clearance);
  const maxY = Math.floor(y + clearance);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (isBlockedTile(grid, tx, ty)) return false;
    }
  }
  return true;
}

function normalizeWalkableTarget(
  map: TiledMap,
  grid: MapCollisionGrid,
  targetTx: number,
  targetTy: number,
  rnd: () => number,
): { targetTx: number; targetTy: number } {
  const baseTx = clamp(Math.floor(targetTx), 1, map.width - 2);
  const baseTy = clamp(Math.floor(targetTy), 1, map.height - 2);
  if (isPositionWalkable(grid, baseTx, baseTy)) {
    return { targetTx: baseTx, targetTy: baseTy };
  }

  for (let radius = 1; radius <= 7; radius++) {
    const samples = 10 + radius * 6;
    for (let i = 0; i < samples; i++) {
      const angle = ((i / samples) * Math.PI * 2) + (rnd() * 0.35);
      const tx = clamp(Math.round(baseTx + Math.cos(angle) * radius), 1, map.width - 2);
      const ty = clamp(Math.round(baseTy + Math.sin(angle) * radius), 1, map.height - 2);
      if (isPositionWalkable(grid, tx, ty)) {
        return { targetTx: tx, targetTy: ty };
      }
    }
  }

  for (let i = 0; i < 32; i++) {
    const tx = clamp(Math.floor(rnd() * map.width), 1, map.width - 2);
    const ty = clamp(Math.floor(rnd() * map.height), 1, map.height - 2);
    if (isPositionWalkable(grid, tx, ty)) {
      return { targetTx: tx, targetTy: ty };
    }
  }

  return { targetTx: baseTx, targetTy: baseTy };
}

function buildShortSteerWaypoints(
  map: TiledMap,
  grid: MapCollisionGrid,
  startTx: number,
  startTy: number,
  targetTx: number,
  targetTy: number,
  rnd: () => number,
  maxSteps = 3,
): Array<{ tx: number; ty: number }> {
  let curX = clamp(Math.round(startTx), 1, map.width - 2);
  let curY = clamp(Math.round(startTy), 1, map.height - 2);
  const goalX = clamp(Math.round(targetTx), 1, map.width - 2);
  const goalY = clamp(Math.round(targetTy), 1, map.height - 2);
  const visited = new Set<string>([`${curX},${curY}`]);
  const path: Array<{ tx: number; ty: number }> = [];

  for (let step = 0; step < maxSteps; step++) {
    const dx = goalX - curX;
    const dy = goalY - curY;
    if (dx === 0 && dy === 0) break;
    const sx = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
    const sy = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
    const candidates: Array<{ x: number; y: number }> = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (sx !== 0) candidates.push({ x: curX + sx, y: curY });
      if (sy !== 0) candidates.push({ x: curX, y: curY + sy });
      if (sx !== 0 && sy !== 0) candidates.push({ x: curX + sx, y: curY + sy });
    } else {
      if (sy !== 0) candidates.push({ x: curX, y: curY + sy });
      if (sx !== 0) candidates.push({ x: curX + sx, y: curY });
      if (sx !== 0 && sy !== 0) candidates.push({ x: curX + sx, y: curY + sy });
    }

    const side = rnd() > 0.5 ? 1 : -1;
    candidates.push({ x: curX + side, y: curY });
    candidates.push({ x: curX - side, y: curY });
    candidates.push({ x: curX, y: curY + side });
    candidates.push({ x: curX, y: curY - side });

    let picked: { x: number; y: number } | null = null;
    for (const candidate of candidates) {
      const nx = clamp(candidate.x, 1, map.width - 2);
      const ny = clamp(candidate.y, 1, map.height - 2);
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (!isPositionWalkable(grid, nx, ny, 0.18)) continue;
      picked = { x: nx, y: ny };
      break;
    }
    if (!picked) break;

    path.push({ tx: picked.x, ty: picked.y });
    visited.add(`${picked.x},${picked.y}`);
    curX = picked.x;
    curY = picked.y;

    if (curX === goalX && curY === goalY) break;
  }

  return path;
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
    msg.includes('execution reverted (no data present') ||
    msg.includes('missing revert data') ||
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

function toDayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getSeasonStartMs(ts: number): number {
  const now = new Date(ts);
  const day = now.getDay();
  const offset = day === 0 ? 6 : day - 1;
  now.setDate(now.getDate() - offset);
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

function toSeasonKey(ts: number): string {
  return toDayKey(getSeasonStartMs(ts));
}

function createDefaultDailyQuestState(dayKey: string): MapFarmDailyQuestState {
  return {
    dayKey,
    progress: { plant: 0, harvest: 0, buy: 0, social: 0 },
    claimed: { plant: false, harvest: false, buy: false, social: false },
  };
}

function ensureDailyQuestStateDay(state: MapFarmDailyQuestState, dayKey: string): MapFarmDailyQuestState {
  if (state.dayKey === dayKey) return state;
  return createDefaultDailyQuestState(dayKey);
}

function createDefaultSeasonState(seasonKey: string): MapFarmSeasonState {
  return {
    seasonKey,
    passXp: 0,
    proOwned: false,
    freeClaimedLevels: [],
    proClaimedLevels: [],
  };
}

function ensureSeasonStateKey(state: MapFarmSeasonState, seasonKey: string): MapFarmSeasonState {
  if (state.seasonKey === seasonKey) return state;
  return createDefaultSeasonState(seasonKey);
}

function loadMapFarmGameState(): MapFarmGameState {
  const dayKey = toDayKey(Date.now());
  const seasonKey = toSeasonKey(Date.now());
  const loaded = loadFromStorage<MapFarmGameState>(MAP_FARM_GAME_STORAGE_KEY);
  if (!loaded || typeof loaded !== 'object') {
    const defaultClaimed: Record<FarmAchievementId, boolean> = {
      sprout_begins: false,
      harvest_rookie: false,
      supply_chain: false,
      social_rookie: false,
      level_climber: false,
      town_star: false,
    };
    return {
      townPoints: 0,
      daily: createDefaultDailyQuestState(dayKey),
      stats: {
        plantActions: 0,
        harvestActions: 0,
        buyActions: 0,
        socialActions: 0,
      },
      achievementClaimed: defaultClaimed,
      season: createDefaultSeasonState(seasonKey),
      boosts: {
        growthBoostUntil: 0,
        socialBoostUntil: 0,
      },
      economy: {
        minted: 0,
        burned: 0,
      },
    };
  }
  const safeDaily = ensureDailyQuestStateDay(
    loaded.daily ?? createDefaultDailyQuestState(dayKey),
    dayKey,
  );
  const defaultClaimed: Record<FarmAchievementId, boolean> = {
    sprout_begins: false,
    harvest_rookie: false,
    supply_chain: false,
    social_rookie: false,
    level_climber: false,
    town_star: false,
  };
  return {
    townPoints: Math.max(0, Number(loaded.townPoints ?? 0)),
    daily: {
      dayKey: safeDaily.dayKey,
      progress: {
        plant: Math.max(0, Number(safeDaily.progress?.plant ?? 0)),
        harvest: Math.max(0, Number(safeDaily.progress?.harvest ?? 0)),
        buy: Math.max(0, Number(safeDaily.progress?.buy ?? 0)),
        social: Math.max(0, Number(safeDaily.progress?.social ?? 0)),
      },
      claimed: {
        plant: Boolean(safeDaily.claimed?.plant),
        harvest: Boolean(safeDaily.claimed?.harvest),
        buy: Boolean(safeDaily.claimed?.buy),
        social: Boolean(safeDaily.claimed?.social),
      },
    },
    stats: {
      plantActions: Math.max(0, Number(loaded.stats?.plantActions ?? 0)),
      harvestActions: Math.max(0, Number(loaded.stats?.harvestActions ?? 0)),
      buyActions: Math.max(0, Number(loaded.stats?.buyActions ?? 0)),
      socialActions: Math.max(0, Number(loaded.stats?.socialActions ?? 0)),
    },
    achievementClaimed: {
      ...defaultClaimed,
      sprout_begins: Boolean(loaded.achievementClaimed?.sprout_begins),
      harvest_rookie: Boolean(loaded.achievementClaimed?.harvest_rookie),
      supply_chain: Boolean(loaded.achievementClaimed?.supply_chain),
      social_rookie: Boolean(loaded.achievementClaimed?.social_rookie),
      level_climber: Boolean(loaded.achievementClaimed?.level_climber),
      town_star: Boolean(loaded.achievementClaimed?.town_star),
    },
    season: ensureSeasonStateKey({
      seasonKey: String(loaded.season?.seasonKey ?? seasonKey),
      passXp: Math.max(0, Number(loaded.season?.passXp ?? 0)),
      proOwned: Boolean(loaded.season?.proOwned),
      freeClaimedLevels: Array.isArray(loaded.season?.freeClaimedLevels) ? loaded.season!.freeClaimedLevels.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0) : [],
      proClaimedLevels: Array.isArray(loaded.season?.proClaimedLevels) ? loaded.season!.proClaimedLevels.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0) : [],
    }, seasonKey),
    boosts: {
      growthBoostUntil: Math.max(0, Number(loaded.boosts?.growthBoostUntil ?? 0)),
      socialBoostUntil: Math.max(0, Number(loaded.boosts?.socialBoostUntil ?? 0)),
    },
    economy: {
      minted: Math.max(0, Number(loaded.economy?.minted ?? 0)),
      burned: Math.max(0, Number(loaded.economy?.burned ?? 0)),
    },
  };
}

function loadMapFarmPanelState(): MapFarmPanelState {
  const loaded = loadFromStorage<Partial<MapFarmPanelState>>(MAP_FARM_PANEL_STORAGE_KEY);
  if (!loaded || typeof loaded !== 'object') return { ...MAP_FARM_PANEL_DEFAULT };
  return {
    quest: typeof loaded.quest === 'boolean' ? loaded.quest : MAP_FARM_PANEL_DEFAULT.quest,
    achievement: typeof loaded.achievement === 'boolean' ? loaded.achievement : MAP_FARM_PANEL_DEFAULT.achievement,
    leaderboard: typeof loaded.leaderboard === 'boolean' ? loaded.leaderboard : MAP_FARM_PANEL_DEFAULT.leaderboard,
    pass: typeof loaded.pass === 'boolean' ? loaded.pass : MAP_FARM_PANEL_DEFAULT.pass,
    boost: typeof loaded.boost === 'boolean' ? loaded.boost : MAP_FARM_PANEL_DEFAULT.boost,
    economy: typeof loaded.economy === 'boolean' ? loaded.economy : MAP_FARM_PANEL_DEFAULT.economy,
    shop: typeof loaded.shop === 'boolean' ? loaded.shop : MAP_FARM_PANEL_DEFAULT.shop,
  };
}

function loadMapExpansionState(): MapExpansionState {
  const loaded = loadFromStorage<Partial<MapExpansionState>>(MAP_EXPANSION_STORAGE_KEY);
  if (!loaded || typeof loaded !== 'object') {
    return {
      level: 1,
      progress: 0,
      totalProjects: 0,
      lastUpgradeAt: 0,
    };
  }
  const maxLevel = MAP_EXPANSION_STAGES.length;
  return {
    level: clamp(Math.floor(Number(loaded.level ?? 1)), 1, maxLevel),
    progress: Math.max(0, Math.floor(Number(loaded.progress ?? 0))),
    totalProjects: Math.max(0, Math.floor(Number(loaded.totalProjects ?? 0))),
    lastUpgradeAt: Math.max(0, Math.floor(Number(loaded.lastUpgradeAt ?? 0))),
  };
}

function loadMapExpansionLogs(): MapExpansionLog[] {
  const loaded = loadFromStorage<MapExpansionLog[]>(MAP_EXPANSION_LOG_STORAGE_KEY);
  if (!Array.isArray(loaded)) return [];
  return loaded
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const safeLevel = Math.max(1, Math.floor(Number(item.level ?? 1)));
      const safeIndex = clamp(safeLevel - 1, 0, MAP_EXPANSION_ZONE_LABELS.length - 1);
      const defaultZone = MAP_EXPANSION_ZONE_LABELS[safeIndex];
      return {
        id: String(item.id ?? `exp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
        level: safeLevel,
        zoneLabelZh: String(item.zoneLabelZh ?? defaultZone.zh),
        zoneLabelEn: String(item.zoneLabelEn ?? defaultZone.en),
        unlockedPct: Math.max(1, Math.min(100, Math.floor(Number(item.unlockedPct ?? 1)))),
        createdAt: Math.max(0, Math.floor(Number(item.createdAt ?? 0))),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 16);
}

function getMapExpansionBounds(map: TiledMap, level: number): MapExpansionBounds {
  const stage = MAP_EXPANSION_STAGES[clamp(level - 1, 0, MAP_EXPANSION_STAGES.length - 1)];
  const minTx = clamp(Math.floor(map.width * stage.minXRatio), 1, map.width - 2);
  const maxTx = clamp(Math.ceil(map.width * stage.maxXRatio), minTx, map.width - 2);
  const minTy = clamp(Math.floor(map.height * stage.minYRatio), 1, map.height - 2);
  const maxTy = clamp(Math.ceil(map.height * stage.maxYRatio), minTy, map.height - 2);
  return { minTx, maxTx, minTy, maxTy };
}

function getMapExpansionZoneLabel(level: number): { zh: string; en: string } {
  const idx = clamp(level - 1, 0, MAP_EXPANSION_ZONE_LABELS.length - 1);
  return MAP_EXPANSION_ZONE_LABELS[idx];
}

function formatClockTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '--:--';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getMapExpansionMission(level: number, maxLevel: number): MapExpansionMission | null {
  if (level >= maxLevel) return null;
  return MAP_EXPANSION_MISSIONS.find((item) => item.level === level) ?? null;
}

function readExpansionMissionMetric(
  metric: MapExpansionMissionMetric,
  game: MapFarmGameState,
  farmLevel: number,
): number {
  if (metric === 'plant') return Math.max(0, game.stats.plantActions);
  if (metric === 'harvest') return Math.max(0, game.stats.harvestActions);
  if (metric === 'buy') return Math.max(0, game.stats.buyActions);
  if (metric === 'social') return Math.max(0, game.stats.socialActions);
  if (metric === 'townPoints') return Math.max(0, game.townPoints);
  return Math.max(1, farmLevel);
}

function buildMapExpansionMissionProgress(
  mission: MapExpansionMission | null,
  game: MapFarmGameState,
  farmLevel: number,
): MapExpansionMissionProgress | null {
  if (!mission) return null;
  let doneCount = 0;
  const rows = mission.items.map((item) => {
    const current = readExpansionMissionMetric(item.metric, game, farmLevel);
    const reached = current >= item.need;
    if (reached) doneCount += 1;
    return { ...item, current, reached };
  });
  const firstUnmet = rows.find((row) => !row.reached);
  const totalCount = rows.length;
  const done = doneCount >= totalCount;
  return {
    mission,
    done,
    doneCount,
    totalCount,
    statusTextZh: `${doneCount}/${totalCount}`,
    statusTextEn: `${doneCount}/${totalCount}`,
    unmetHintZh: firstUnmet
      ? `${firstUnmet.labelZh} ${firstUnmet.current}/${firstUnmet.need}`
      : '条件已满足，等待扩建',
    unmetHintEn: firstUnmet
      ? `${firstUnmet.labelEn} ${firstUnmet.current}/${firstUnmet.need}`
      : 'Conditions met, waiting for expansion',
  };
}

function getMapExpansionLandmarkMeta(level: number): MapExpansionLandmarkMeta {
  const idx = clamp(level - 1, 0, MAP_EXPANSION_LANDMARKS.length - 1);
  return MAP_EXPANSION_LANDMARKS[idx];
}

function pickLandmarkAnchor(bounds: MapExpansionBounds, level: number): { tx: number; ty: number } {
  const cx = Math.floor((bounds.minTx + bounds.maxTx) / 2);
  const cy = Math.floor((bounds.minTy + bounds.maxTy) / 2);
  if (level === 1) return { tx: cx, ty: bounds.minTy + 2 };
  if (level === 2) return { tx: bounds.minTx + 2, ty: cy };
  if (level === 3) return { tx: bounds.maxTx - 2, ty: cy };
  if (level === 4) return { tx: cx, ty: bounds.maxTy - 2 };
  if (level === 5) return { tx: bounds.minTx + 3, ty: bounds.minTy + 3 };
  return { tx: bounds.maxTx - 3, ty: bounds.maxTy - 3 };
}

function buildMapExpansionLandmarks(map: TiledMap, level: number): MapExpansionLandmark[] {
  const maxLevel = Math.min(level, MAP_EXPANSION_STAGES.length);
  const out: MapExpansionLandmark[] = [];
  for (let lv = 1; lv <= maxLevel; lv++) {
    const bounds = getMapExpansionBounds(map, lv);
    const anchor = pickLandmarkAnchor(bounds, lv);
    const meta = getMapExpansionLandmarkMeta(lv);
    out.push({
      level: lv,
      tx: clamp(anchor.tx, 1, map.width - 2),
      ty: clamp(anchor.ty, 1, map.height - 2),
      kind: meta.kind,
      nameZh: meta.nameZh,
      nameEn: meta.nameEn,
    });
  }
  return out;
}

function buildMapExpansionDecorations(map: TiledMap, level: number): MapExpansionDecoration[] {
  const bounds = getMapExpansionBounds(map, level);
  const ringMinX = Math.max(1, bounds.minTx - 5);
  const ringMaxX = Math.min(map.width - 2, bounds.maxTx + 5);
  const ringMinY = Math.max(1, bounds.minTy - 5);
  const ringMaxY = Math.min(map.height - 2, bounds.maxTy + 5);
  const count = 12 + level * 7;
  const rnd = createSeededRandom((map.width * 97) + (map.height * 53) + (level * 1231));
  const used = new Set<string>();
  const out: MapExpansionDecoration[] = [];
  let guard = 0;
  while (out.length < count && guard < count * 24) {
    guard += 1;
    const tx = ringMinX + Math.floor(rnd() * Math.max(1, ringMaxX - ringMinX + 1));
    const ty = ringMinY + Math.floor(rnd() * Math.max(1, ringMaxY - ringMinY + 1));
    const key = `${tx},${ty}`;
    if (used.has(key)) continue;
    if (tx > bounds.minTx + 1 && tx < bounds.maxTx - 1 && ty > bounds.minTy + 1 && ty < bounds.maxTy - 1) continue;
    used.add(key);
    const pick = rnd();
    const kind: MapExpansionDecorationKind = pick < 0.36
      ? 'grass'
      : pick < 0.58
        ? 'flower'
        : pick < 0.78
          ? 'rock'
          : pick < 0.93
            ? 'sapling'
            : 'lantern';
    out.push({
      tx,
      ty,
      kind,
      phase: rnd() * Math.PI * 2,
      size: 0.68 + (rnd() * 0.42),
    });
  }
  return out;
}

function drawMapExpansionLandmark(
  ctx: CanvasRenderingContext2D,
  item: MapExpansionLandmark,
  tilePxW: number,
  tilePxH: number,
  now: number,
): void {
  const px = item.tx * tilePxW;
  const py = item.ty * tilePxH;
  const bx = px + tilePxW * 0.2;
  const by = py + tilePxH * 0.16;
  const bw = tilePxW * 0.6;
  const bh = tilePxH * 0.68;
  const pulse = 0.55 + (Math.sin((now / 620) + item.level) * 0.25);
  ctx.fillStyle = 'rgba(40, 30, 16, 0.2)';
  ctx.fillRect(px + tilePxW * 0.22, py + tilePxH * 0.86, tilePxW * 0.56, tilePxH * 0.12);

  if (item.kind === 'signboard') {
    ctx.fillStyle = '#7e5d35';
    ctx.fillRect(bx + bw * 0.46, by + bh * 0.4, bw * 0.08, bh * 0.56);
    ctx.fillStyle = '#d9c189';
    ctx.fillRect(bx, by, bw, bh * 0.48);
    ctx.fillStyle = '#8b6c3d';
    ctx.fillRect(bx + bw * 0.08, by + bh * 0.12, bw * 0.84, bh * 0.08);
    return;
  }
  if (item.kind === 'windmill') {
    ctx.fillStyle = '#a78052';
    ctx.fillRect(bx + bw * 0.42, by + bh * 0.3, bw * 0.16, bh * 0.68);
    ctx.fillStyle = '#d6dbde';
    ctx.fillRect(bx + bw * 0.44, by + bh * 0.22, bw * 0.12, bh * 0.1);
    ctx.fillRect(bx + bw * 0.26, by + bh * 0.24, bw * 0.48, bh * 0.06);
    ctx.fillRect(bx + bw * 0.47, by, bw * 0.06, bh * 0.34);
    return;
  }
  if (item.kind === 'barn') {
    ctx.fillStyle = '#b55e3e';
    ctx.fillRect(bx, by + bh * 0.3, bw, bh * 0.64);
    ctx.fillStyle = '#865234';
    ctx.fillRect(bx + bw * 0.18, by + bh * 0.54, bw * 0.24, bh * 0.4);
    ctx.fillRect(bx + bw * 0.58, by + bh * 0.54, bw * 0.24, bh * 0.4);
    ctx.fillStyle = '#7e4a2d';
    ctx.fillRect(bx + bw * 0.08, by + bh * 0.18, bw * 0.84, bh * 0.16);
    return;
  }
  if (item.kind === 'tower') {
    ctx.fillStyle = '#8d8069';
    ctx.fillRect(bx + bw * 0.24, by + bh * 0.22, bw * 0.52, bh * 0.74);
    ctx.fillStyle = '#c7bca6';
    ctx.fillRect(bx + bw * 0.2, by + bh * 0.1, bw * 0.6, bh * 0.16);
    ctx.fillStyle = '#5f5648';
    ctx.fillRect(bx + bw * 0.44, by + bh * 0.52, bw * 0.12, bh * 0.2);
    return;
  }
  if (item.kind === 'market') {
    ctx.fillStyle = '#875636';
    ctx.fillRect(bx + bw * 0.04, by + bh * 0.54, bw * 0.92, bh * 0.4);
    ctx.fillStyle = '#e4b45d';
    ctx.fillRect(bx + bw * 0.02, by + bh * 0.28, bw * 0.96, bh * 0.2);
    ctx.fillStyle = '#5f943f';
    ctx.fillRect(bx + bw * 0.09, by + bh * 0.32, bw * 0.16, bh * 0.12);
    ctx.fillRect(bx + bw * 0.42, by + bh * 0.32, bw * 0.16, bh * 0.12);
    ctx.fillRect(bx + bw * 0.74, by + bh * 0.32, bw * 0.16, bh * 0.12);
    return;
  }
  ctx.fillStyle = '#4f5f9c';
  ctx.fillRect(bx + bw * 0.42, by + bh * 0.16, bw * 0.16, bh * 0.8);
  ctx.fillStyle = `rgba(255, 223, 110, ${Math.max(0.2, pulse)})`;
  ctx.fillRect(bx + bw * 0.3, by, bw * 0.4, bh * 0.2);
}

function getMapExpansionLandmarkAction(kind: MapExpansionLandmarkKind): MapExpansionLandmarkActionKey {
  if (kind === 'signboard') return 'guide';
  if (kind === 'windmill') return 'boost';
  if (kind === 'barn') return 'supply';
  if (kind === 'tower') return 'patrol';
  if (kind === 'market') return 'shop';
  return 'upgrade';
}

function drawMapExpansionDecoration(
  ctx: CanvasRenderingContext2D,
  item: MapExpansionDecoration,
  tilePxW: number,
  tilePxH: number,
  now: number,
): void {
  const px = item.tx * tilePxW;
  const py = item.ty * tilePxH;
  const sway = Math.sin((now / 560) + item.phase) * tilePxW * 0.032;
  const baseY = py + tilePxH * 0.84;
  const size = Math.max(1, tilePxW * 0.07 * item.size);
  if (item.kind === 'grass') {
    ctx.fillStyle = '#5ca84b';
    ctx.fillRect(px + tilePxW * 0.38 + sway, baseY - size * 2.2, size, size * 2.2);
    ctx.fillRect(px + tilePxW * 0.46 + sway, baseY - size * 2.8, size, size * 2.8);
    ctx.fillRect(px + tilePxW * 0.54 + sway, baseY - size * 2.1, size, size * 2.1);
    return;
  }
  if (item.kind === 'flower') {
    ctx.fillStyle = '#58a253';
    ctx.fillRect(px + tilePxW * 0.48 + sway, baseY - size * 2.6, size, size * 2.6);
    ctx.fillStyle = '#f49ac1';
    ctx.fillRect(px + tilePxW * 0.42 + sway, baseY - size * 3.35, size * 2.2, size * 1.4);
    ctx.fillStyle = '#ffdb70';
    ctx.fillRect(px + tilePxW * 0.5 + sway, baseY - size * 3.1, size, size);
    return;
  }
  if (item.kind === 'sapling') {
    ctx.fillStyle = '#8f6b3f';
    ctx.fillRect(px + tilePxW * 0.48 + sway, baseY - size * 2.8, size * 1.2, size * 2.8);
    ctx.fillStyle = '#74bf60';
    ctx.fillRect(px + tilePxW * 0.4 + sway, baseY - size * 4.1, size * 2.8, size * 1.8);
    ctx.fillRect(px + tilePxW * 0.34 + sway, baseY - size * 3.45, size * 3.8, size * 1.4);
    return;
  }
  if (item.kind === 'lantern') {
    ctx.fillStyle = '#6f4f2e';
    ctx.fillRect(px + tilePxW * 0.49, baseY - size * 3.6, size, size * 3.6);
    const glow = 0.55 + Math.sin((now / 440) + item.phase) * 0.25;
    ctx.fillStyle = `rgba(255, 214, 104, ${Math.max(0.2, glow)})`;
    ctx.fillRect(px + tilePxW * 0.44, baseY - size * 4.7, size * 2.2, size * 1.2);
    return;
  }
  ctx.fillStyle = '#9ea4aa';
  ctx.fillRect(px + tilePxW * 0.38, baseY - size * 1.8, size * 2.4, size * 1.2);
  ctx.fillStyle = '#c7cdd2';
  ctx.fillRect(px + tilePxW * 0.45, baseY - size * 2.3, size * 1.8, size * 0.9);
}

function createRandomFarmEvent(now: number): MapFarmLiveEvent {
  const picked = MAP_FARM_EVENT_PRESETS[Math.floor(Math.random() * MAP_FARM_EVENT_PRESETS.length)];
  const durationMs = 70_000 + Math.floor(Math.random() * 35_000);
  return {
    id: picked.id,
    startsAt: now,
    endsAt: now + durationMs,
    localGrowMultiplier: picked.localGrowMultiplier,
    actionPointBonus: picked.actionPointBonus,
  };
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

function formatLongCountdown(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSec = Math.floor(safeMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}h`;
  return `${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`;
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

type MapPlayStats = {
  score: number;
  talks: number;
  questRewardClaimed: boolean;
};

const MAP_PLAY_TALK_TARGET = 3;

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
  const mapCollisionGridRef = useRef<MapCollisionGrid | null>(null);
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
  const [agentProfileOpen, setAgentProfileOpen] = useState(false);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [placeMode, setPlaceMode] = useState(false);
  const [placementTokenId, setPlacementTokenId] = useState<number | null>(null);
  const [agentPanelNotice, setAgentPanelNotice] = useState('');
  const [agentActionLogs, setAgentActionLogs] = useState<AgentActionLog[]>(() => loadAgentActionLogs());
  const [agentActionPending, setAgentActionPending] = useState(false);
  const [playModeEnabled, setPlayModeEnabled] = useState(true);
  const [controlledAgentId, setControlledAgentId] = useState<string | null>('npc_heyi');
  const [mapPlayStats, setMapPlayStats] = useState<MapPlayStats>({
    score: 0,
    talks: 0,
    questRewardClaimed: false,
  });
  const playInputRef = useRef<{ up: boolean; down: boolean; left: boolean; right: boolean; run: boolean }>({
    up: false,
    down: false,
    left: false,
    right: false,
    run: false,
  });
  const playInteractRequestAtRef = useRef(0);
  const playInteractHandledAtRef = useRef(0);

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
  const [mapFarmGame, setMapFarmGame] = useState<MapFarmGameState>(() => loadMapFarmGameState());
  const [mapFarmPanelState, setMapFarmPanelState] = useState<MapFarmPanelState>(() => loadMapFarmPanelState());
  const [mapFarmSidebarOpen, setMapFarmSidebarOpen] = useState<boolean>(() => {
    const loaded = loadFromStorage<boolean>(MAP_FARM_SIDEBAR_STORAGE_KEY);
    return typeof loaded === 'boolean' ? loaded : false;
  });
  const [mapExpansion, setMapExpansion] = useState<MapExpansionState>(() => loadMapExpansionState());
  const [mapExpansionLogs, setMapExpansionLogs] = useState<MapExpansionLog[]>(() => loadMapExpansionLogs());
  const [mapExpansionPulseActive, setMapExpansionPulseActive] = useState(false);
  const [mapExpansionLandmarkOpen, setMapExpansionLandmarkOpen] = useState(false);
  const [mapExpansionLandmarkPending, setMapExpansionLandmarkPending] = useState(false);
  const [selectedLandmark, setSelectedLandmark] = useState<MapExpansionLandmark | null>(null);
  const [mapFarmActiveEvent, setMapFarmActiveEvent] = useState<MapFarmLiveEvent | null>(null);
  const [mapFarmNextEventAt, setMapFarmNextEventAt] = useState(() => Date.now() + 48_000);
  const [mapFarmFx, setMapFarmFx] = useState<MapFarmFx[]>([]);
  const mapFarmTokenPriceCacheRef = useRef<{ tokenAddress: string; priceUsd: number | null; updatedAt: number }>({
    tokenAddress: '',
    priceUsd: null,
    updatedAt: 0,
  });
  const mapFarmEventSyncTimerRef = useRef<number | null>(null);
  const mapFarmLastSyncAtRef = useRef(0);
  const mapFarmLastRoundRef = useRef<number | null>(null);
  const mapFarmLastSocialQuestRef = useRef<{ agentId: string | null; at: number }>({ agentId: null, at: 0 });
  const mapExpansionLastLevelRef = useRef(mapExpansion.level);
  const mapExpansionMotionRef = useRef<Map<string, { tx: number; ty: number }>>(new Map());
  const mapExpansionMissionHintAtRef = useRef(0);
  const setMapFarmPanels = (next: MapFarmPanelState) => setMapFarmPanelState(next);
  const setMapFarmPanelAll = (open: boolean) => {
    setMapFarmPanels({
      quest: open,
      achievement: open,
      leaderboard: open,
      pass: open,
      boost: open,
      economy: open,
      shop: open,
    });
  };
  const resetMapFarmPanelLayout = () => setMapFarmPanels({ ...MAP_FARM_PANEL_DEFAULT });
  const toggleMapFarmPanel = (section: MapFarmPanelSectionId) => {
    setMapFarmPanelState((prev) => ({ ...prev, [section]: !prev[section] }));
  };
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
  const questLabel = (id: DailyQuestId): string => {
    if (id === 'plant') return t('种植达人', 'Plant Master');
    if (id === 'harvest') return t('收获快手', 'Harvest Runner');
    if (id === 'buy') return t('补给专家', 'Supply Expert');
    return t('社交达人', 'Social Spark');
  };
  const questDesc = (id: DailyQuestId): string => {
    if (id === 'plant') return t('完成 5 次播种', 'Complete 5 planting actions');
    if (id === 'harvest') return t('完成 3 次收获', 'Complete 3 harvest actions');
    if (id === 'buy') return t('完成 2 次购买', 'Complete 2 purchase actions');
    return t('与地图角色互动 3 次', 'Interact with map agents 3 times');
  };
  const eventLabel = (id: MapFarmEventId): string => {
    if (id === 'breeze') return t('丰收微风', 'Harvest Breeze');
    if (id === 'festival') return t('农场庆典', 'Farm Festival');
    if (id === 'rain') return t('及时春雨', 'Timely Rain');
    return t('星夜祝福', 'Starlight Blessing');
  };
  const eventDesc = (id: MapFarmEventId): string => {
    if (id === 'breeze') return t('本地模式成长加速，行动奖励提升。', 'Faster growth in local mode with extra action points.');
    if (id === 'festival') return t('全场活跃提升，任务推进更容易。', 'Higher activity and easier quest progression.');
    if (id === 'rain') return t('作物生长显著提速，适合冲节奏。', 'Significantly faster crop growth for tempo runs.');
    return t('行动积分更高，适合冲今日任务。', 'Higher action points, ideal for daily quest push.');
  };
  const achievementLabel = (id: FarmAchievementId): string => {
    if (id === 'sprout_begins') return t('初露锋芒', 'Sprout Begins');
    if (id === 'harvest_rookie') return t('收割新秀', 'Harvest Rookie');
    if (id === 'supply_chain') return t('补给大师', 'Supply Chain');
    if (id === 'social_rookie') return t('社交火花', 'Social Spark');
    if (id === 'level_climber') return t('成长加速器', 'Level Climber');
    return t('小镇之星', 'Town Star');
  };
  const achievementDesc = (id: FarmAchievementId): string => {
    if (id === 'sprout_begins') return t('累计种植 20 次', 'Plant 20 times in total');
    if (id === 'harvest_rookie') return t('累计收获 15 次', 'Harvest 15 times in total');
    if (id === 'supply_chain') return t('累计购买 10 次', 'Purchase 10 times in total');
    if (id === 'social_rookie') return t('累计互动 12 次', 'Interact with agents 12 times');
    if (id === 'level_climber') return t('等级达到 5 级', 'Reach level 5');
    return t('活跃点达到 3000', 'Reach 3000 town points');
  };
  const dailyQuestIds: DailyQuestId[] = ['plant', 'harvest', 'buy', 'social'];
  const activeEventRemainingMs = mapFarmActiveEvent ? Math.max(0, mapFarmActiveEvent.endsAt - farmNowMs) : 0;
  const nextEventRemainingMs = Math.max(0, mapFarmNextEventAt - farmNowMs);
  const activeEventActionBonus = mapFarmActiveEvent?.actionPointBonus ?? 0;
  const activeEventGrowMultiplier = mapFarmActiveEvent?.localGrowMultiplier ?? 1;
  const growthBoostActive = mapFarmGame.boosts.growthBoostUntil > farmNowMs;
  const socialBoostActive = mapFarmGame.boosts.socialBoostUntil > farmNowMs;
  const seasonStartMs = useMemo(() => getSeasonStartMs(farmNowMs), [farmNowMs]);
  const seasonKeyNow = useMemo(() => toSeasonKey(farmNowMs), [farmNowMs]);
  const seasonEndMs = seasonStartMs + (7 * 24 * 60 * 60 * 1000);
  const seasonRemainingMs = Math.max(0, seasonEndMs - farmNowMs);
  const seasonState = ensureSeasonStateKey(mapFarmGame.season, seasonKeyNow);
  const passLevel = Math.min(MAP_FARM_PASS_MAX_LEVEL, Math.max(1, Math.floor(seasonState.passXp / MAP_FARM_PASS_XP_PER_LEVEL) + 1));
  const passXpInLevel = seasonState.passXp % MAP_FARM_PASS_XP_PER_LEVEL;
  const passProgress = Math.min(100, Math.round((passXpInLevel / MAP_FARM_PASS_XP_PER_LEVEL) * 100));
  const passIsMaxLevel = passLevel >= MAP_FARM_PASS_MAX_LEVEL;
  const passNextLevelNeedXp = passIsMaxLevel ? 0 : Math.max(0, MAP_FARM_PASS_XP_PER_LEVEL - passXpInLevel);
  const growthBoostRemainingMs = Math.max(0, mapFarmGame.boosts.growthBoostUntil - farmNowMs);
  const socialBoostRemainingMs = Math.max(0, mapFarmGame.boosts.socialBoostUntil - farmNowMs);
  const freeClaimedSet = new Set(seasonState.freeClaimedLevels);
  const proClaimedSet = new Set(seasonState.proClaimedLevels);
  let seasonFreeClaimableCount = 0;
  let seasonProClaimableCount = 0;
  for (let lv = 1; lv <= passLevel; lv++) {
    if (!freeClaimedSet.has(lv)) seasonFreeClaimableCount += 1;
    if (seasonState.proOwned && !proClaimedSet.has(lv)) seasonProClaimableCount += 1;
  }
  const seasonClaimableTotal = seasonFreeClaimableCount + seasonProClaimableCount;
  const faucetTotal = mapFarmGame.economy.minted;
  const sinkTotal = mapFarmGame.economy.burned;
  const sinkFaucetRatio = faucetTotal <= 0 ? 0 : sinkTotal / faucetTotal;
  const sinkFaucetText = faucetTotal <= 0 ? '--' : sinkFaucetRatio.toFixed(2);
  const economyHealthTone: 'healthy' | 'balanced' | 'inflating' = sinkFaucetRatio >= 1.02
    ? 'healthy'
    : sinkFaucetRatio >= 0.85
      ? 'balanced'
      : 'inflating';
  const economyHealthLabel = sinkFaucetRatio >= 1.02
    ? t('健康', 'Healthy')
    : sinkFaucetRatio >= 0.85
      ? t('平衡', 'Balanced')
      : t('偏通胀', 'Inflating');
  const nftAgentCount = agentsRef.current.reduce((count, agent) => (agent.source === 'nft' ? count + 1 : count), 0);

  const setFarmNotice = (notice: string) => {
    setMapFarm((prev) => ({ ...prev, notice }));
  };

  const pushFarmFx = (text: string, kind: MapFarmFxKind) => {
    const createdAt = Date.now();
    const id = `${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
    setMapFarmFx((prev) => [{ id, text, kind, createdAt }, ...prev].slice(0, 8));
  };

  const grantTownPoints = (basePoints: number, reason: string) => {
    const total = Math.max(0, basePoints + activeEventActionBonus);
    if (total <= 0) return;
    setMapFarmGame((prev) => ({
      ...prev,
      townPoints: prev.townPoints + total,
      economy: {
        ...prev.economy,
        minted: prev.economy.minted + total,
      },
    }));
    pushFarmFx(`${reason} +${total} ${t('活跃点', 'Points')}`, 'event');
  };

  const grantPassXp = (amount: number) => {
    if (amount <= 0) return;
    const seasonKey = toSeasonKey(Date.now());
    setMapFarmGame((prev) => {
      const season = ensureSeasonStateKey(prev.season, seasonKey);
      return {
        ...prev,
        season: {
          ...season,
          passXp: season.passXp + amount,
        },
      };
    });
  };

  const trySpendTownPoints = (cost: number, reason: string): boolean => {
    if (cost <= 0) return true;
    if (mapFarmGame.townPoints < cost) {
      setFarmNotice(`${t('活跃点不足', 'Not enough points')}: ${reason}`);
      return false;
    }
    setMapFarmGame((prev) => ({
      ...prev,
      townPoints: Math.max(0, prev.townPoints - cost),
      economy: {
        ...prev.economy,
        burned: prev.economy.burned + cost,
      },
    }));
    pushFarmFx(`${reason} -${cost} ${t('活跃点', 'Points')}`, 'buy');
    return true;
  };

  const incrementGameStat = (kind: 'plantActions' | 'harvestActions' | 'buyActions' | 'socialActions', amount = 1) => {
    setMapFarmGame((prev) => ({
      ...prev,
      stats: {
        ...prev.stats,
        [kind]: (prev.stats[kind] ?? 0) + amount,
      },
    }));
  };

  const advanceDailyQuest = (questId: DailyQuestId, amount = 1) => {
    const dayKey = toDayKey(Date.now());
    setMapFarmGame((prev) => {
      const normalizedDaily = ensureDailyQuestStateDay(prev.daily, dayKey);
      const target = MAP_FARM_DAILY_QUEST_TARGET[questId];
      const current = normalizedDaily.progress[questId] ?? 0;
      if (current >= target) return { ...prev, daily: normalizedDaily };
      const nextVal = Math.min(target, current + amount);
      const nextDaily: MapFarmDailyQuestState = {
        ...normalizedDaily,
        progress: {
          ...normalizedDaily.progress,
          [questId]: nextVal,
        },
      };
      return {
        ...prev,
        daily: nextDaily,
      };
    });
  };

  const claimDailyQuestReward = (questId: DailyQuestId) => {
    const dayKey = toDayKey(Date.now());
    const target = MAP_FARM_DAILY_QUEST_TARGET[questId];
    const reward = MAP_FARM_DAILY_QUEST_REWARD[questId];
    let claimed = false;
    setMapFarmGame((prev) => {
      const normalizedDaily = ensureDailyQuestStateDay(prev.daily, dayKey);
      const progress = normalizedDaily.progress[questId] ?? 0;
      if (progress < target || normalizedDaily.claimed[questId]) return { ...prev, daily: normalizedDaily };
      claimed = true;
      return {
        ...prev,
        townPoints: prev.townPoints + reward,
        economy: {
          ...prev.economy,
          minted: prev.economy.minted + reward,
        },
        daily: {
          ...normalizedDaily,
          claimed: {
            ...normalizedDaily.claimed,
            [questId]: true,
          },
        },
      };
    });
    if (claimed) {
      pushFarmFx(`${questLabel(questId)} +${reward} ${t('活跃点', 'Points')}`, 'quest');
      setFarmNotice(`${t('任务奖励已领取', 'Quest reward claimed')}: ${questLabel(questId)} +${reward} ${t('活跃点', 'Points')}`);
    }
  };

  const getAchievementProgress = (id: FarmAchievementId): { progress: number; target: number } => {
    if (id === 'sprout_begins') return { progress: mapFarmGame.stats.plantActions, target: 20 };
    if (id === 'harvest_rookie') return { progress: mapFarmGame.stats.harvestActions, target: 15 };
    if (id === 'supply_chain') return { progress: mapFarmGame.stats.buyActions, target: 10 };
    if (id === 'social_rookie') return { progress: mapFarmGame.stats.socialActions, target: 12 };
    if (id === 'level_climber') return { progress: mapFarm.level, target: 5 };
    return { progress: mapFarmGame.townPoints, target: 3000 };
  };

  const claimAchievementReward = (id: FarmAchievementId) => {
    const progressInfo = getAchievementProgress(id);
    const canClaim = progressInfo.progress >= progressInfo.target && !mapFarmGame.achievementClaimed[id];
    if (!canClaim) return;
    const reward = MAP_FARM_ACHIEVEMENT_REWARD[id];
    setMapFarmGame((prev) => ({
      ...prev,
      townPoints: prev.townPoints + reward,
      economy: {
        ...prev.economy,
        minted: prev.economy.minted + reward,
      },
      achievementClaimed: {
        ...prev.achievementClaimed,
        [id]: true,
      },
    }));
    pushFarmFx(`${achievementLabel(id)} +${reward} ${t('活跃点', 'Points')}`, 'quest');
    setFarmNotice(`${t('成就已领取', 'Achievement claimed')}: ${achievementLabel(id)}`);
  };

  const achievementRows = MAP_FARM_ACHIEVEMENT_IDS.map((id) => {
    const progressInfo = getAchievementProgress(id);
    const progress = Math.min(progressInfo.target, progressInfo.progress);
    const claimed = mapFarmGame.achievementClaimed[id];
    const canClaim = progress >= progressInfo.target && !claimed;
    return {
      id,
      progress,
      target: progressInfo.target,
      claimed,
      canClaim,
      reward: MAP_FARM_ACHIEVEMENT_REWARD[id],
    };
  });

  const claimSeasonPassRewards = () => {
    const seasonKey = toSeasonKey(Date.now());
    let totalReward = 0;
    let freeClaimCount = 0;
    let proClaimCount = 0;
    setMapFarmGame((prev) => {
      const season = ensureSeasonStateKey(prev.season, seasonKey);
      const level = Math.min(MAP_FARM_PASS_MAX_LEVEL, Math.max(1, Math.floor(season.passXp / MAP_FARM_PASS_XP_PER_LEVEL) + 1));
      const nextFree = [...season.freeClaimedLevels];
      const nextPro = [...season.proClaimedLevels];
      for (let lv = 1; lv <= level; lv++) {
        if (!nextFree.includes(lv)) {
          nextFree.push(lv);
          freeClaimCount += 1;
          totalReward += 40 + (lv * 8);
        }
        if (season.proOwned && !nextPro.includes(lv)) {
          nextPro.push(lv);
          proClaimCount += 1;
          totalReward += 30 + (lv * 10);
        }
      }
      if (totalReward <= 0) return { ...prev, season };
      return {
        ...prev,
        townPoints: prev.townPoints + totalReward,
        economy: {
          ...prev.economy,
          minted: prev.economy.minted + totalReward,
        },
        season: {
          ...season,
          freeClaimedLevels: nextFree,
          proClaimedLevels: nextPro,
        },
      };
    });
    if (totalReward > 0) {
      pushFarmFx(`${t('通行证奖励', 'Pass Rewards')} +${totalReward} ${t('活跃点', 'Points')}`, 'quest');
      setFarmNotice(`${t('通行证领取完成', 'Pass rewards claimed')} (F${freeClaimCount}${seasonState.proOwned ? ` / P${proClaimCount}` : ''})`);
    } else {
      setFarmNotice(t('暂无可领取的通行证奖励。', 'No pass rewards available right now.'));
    }
  };

  const buyProPass = () => {
    if (seasonState.proOwned) {
      setFarmNotice(t('你已经拥有进阶通行证。', 'Pro pass is already owned.'));
      return;
    }
    const ok = trySpendTownPoints(MAP_FARM_PRO_PASS_COST, t('购买进阶通行证', 'Buy Pro Pass'));
    if (!ok) return;
    const seasonKey = toSeasonKey(Date.now());
    setMapFarmGame((prev) => {
      const season = ensureSeasonStateKey(prev.season, seasonKey);
      return {
        ...prev,
        season: {
          ...season,
          proOwned: true,
        },
      };
    });
    pushFarmFx(t('进阶通行证已激活', 'Pro Pass Activated'), 'quest');
  };

  const buyGrowthBoost = () => {
    const ok = trySpendTownPoints(MAP_FARM_GROWTH_BOOST_COST, t('购买生长加速', 'Buy Growth Boost'));
    if (!ok) return;
    const now = Date.now();
    setMapFarmGame((prev) => ({
      ...prev,
      boosts: {
        ...prev.boosts,
        growthBoostUntil: Math.max(prev.boosts.growthBoostUntil, now) + MAP_FARM_GROWTH_BOOST_MS,
      },
    }));
    setFarmNotice(t('生长加速已生效。', 'Growth boost activated.'));
  };

  const buySocialBoost = () => {
    const ok = trySpendTownPoints(MAP_FARM_SOCIAL_BOOST_COST, t('购买社交增幅', 'Buy Social Boost'));
    if (!ok) return;
    const now = Date.now();
    setMapFarmGame((prev) => ({
      ...prev,
      boosts: {
        ...prev.boosts,
        socialBoostUntil: Math.max(prev.boosts.socialBoostUntil, now) + MAP_FARM_SOCIAL_BOOST_MS,
      },
    }));
    setFarmNotice(t('社交增幅已生效。', 'Social boost activated.'));
  };

  const leaderboardRows = useMemo(() => {
    const playerScore = mapFarmGame.townPoints + (mapFarm.level * 80) + (mapFarm.exp / 20);
    const playerName = account ? `${account.slice(0, 6)}...${account.slice(-4)}` : t('你（本地）', 'You (Local)');
    const npcs = [
      { id: 'npc_1', name: 'CZ', score: 2420 },
      { id: 'npc_2', name: 'HEYI', score: 2280 },
      { id: 'npc_3', name: t('农务官 A', 'Ranger A'), score: 1960 },
      { id: 'npc_4', name: t('交易员 B', 'Trader B'), score: 1740 },
      { id: 'npc_5', name: t('守卫 C', 'Guardian C'), score: 1510 },
    ];
    const merged = [
      ...npcs,
      { id: 'player', name: playerName, score: Math.round(playerScore) },
    ].sort((a, b) => b.score - a.score);
    return merged.map((item, idx) => ({ ...item, rank: idx + 1, isPlayer: item.id === 'player' }));
  }, [mapFarm.level, mapFarm.exp, mapFarmGame.townPoints, account, t]);
  const leaderboardTopRows = leaderboardRows.slice(0, 6);
  const leaderboardPlayerRow = leaderboardRows.find((row) => row.isPlayer) ?? null;
  const openPanelCount = Object.values(mapFarmPanelState).filter(Boolean).length;
  const dailyQuestClaimableCount = dailyQuestIds.reduce((count, id) => {
    const target = MAP_FARM_DAILY_QUEST_TARGET[id];
    const progress = mapFarmGame.daily.progress[id] ?? 0;
    const claimed = Boolean(mapFarmGame.daily.claimed[id]);
    return (progress >= target && !claimed) ? count + 1 : count;
  }, 0);
  const achievementClaimableCount = achievementRows.reduce((count, row) => (row.canClaim ? count + 1 : count), 0);
  const activeBoostCount = Number(growthBoostActive) + Number(socialBoostActive);
  const seedInventoryTotal = mapFarm.bag.WHEAT + mapFarm.bag.CORN + mapFarm.bag.CARROT;
  const mapExpansionMaxLevel = MAP_EXPANSION_STAGES.length;
  const mapExpansionStage = MAP_EXPANSION_STAGES[clamp(mapExpansion.level - 1, 0, mapExpansionMaxLevel - 1)];
  const mapExpansionNeed = mapExpansionStage.need;
  const mapExpansionProgressPct = mapExpansion.level >= mapExpansionMaxLevel
    ? 100
    : Math.min(100, Math.round((mapExpansion.progress / Math.max(1, mapExpansionNeed)) * 100));
  const mapExpansionMission = useMemo(
    () => getMapExpansionMission(mapExpansion.level, mapExpansionMaxLevel),
    [mapExpansion.level, mapExpansionMaxLevel],
  );
  const mapExpansionMissionProgress = useMemo(
    () => buildMapExpansionMissionProgress(mapExpansionMission, mapFarmGame, mapFarm.level),
    [mapExpansionMission, mapFarmGame, mapFarm.level],
  );
  const mapExpansionUnlockedPct = useMemo(() => {
    if (!map) return 0;
    const bounds = getMapExpansionBounds(map, mapExpansion.level);
    const total = Math.max(1, (map.width - 2) * (map.height - 2));
    const unlocked = Math.max(1, (bounds.maxTx - bounds.minTx + 1) * (bounds.maxTy - bounds.minTy + 1));
    return Math.max(1, Math.min(100, Math.round((unlocked / total) * 100)));
  }, [map, mapExpansion.level]);
  const mapExpansionDecorations = useMemo(
    () => (map ? buildMapExpansionDecorations(map, mapExpansion.level) : []),
    [map, mapExpansion.level],
  );
  const mapExpansionLandmarks = useMemo(
    () => (map ? buildMapExpansionLandmarks(map, mapExpansion.level) : []),
    [map, mapExpansion.level],
  );
  const mapExpansionCurrentLandmark = useMemo(() => {
    if (mapExpansionLandmarks.length === 0) return null;
    return mapExpansionLandmarks[mapExpansionLandmarks.length - 1];
  }, [mapExpansionLandmarks]);
  const selectedLandmarkAction = useMemo(() => {
    if (!selectedLandmark) return null;
    const key = getMapExpansionLandmarkAction(selectedLandmark.kind);
    if (key === 'guide') {
      return {
        key,
        title: t('查看开拓指南', 'Open Frontier Guide'),
        desc: t('查看当前扩建阶段的玩法与目标。', 'Read gameplay and objectives for current expansion stage.'),
      };
    }
    if (key === 'boost') {
      return {
        key,
        title: t('激活生长加速', 'Activate Growth Boost'),
        desc: t('触发生长加速效果，缩短作物成熟时间。', 'Trigger growth boost to shorten crop maturity time.'),
      };
    }
    if (key === 'supply') {
      return {
        key,
        title: t('领取补给', 'Claim Supplies'),
        desc: t('补充当前种子库存，保证种植循环不断档。', 'Replenish selected seed stock to keep planting loop running.'),
      };
    }
    if (key === 'patrol') {
      return {
        key,
        title: t('发起巡逻任务', 'Start Patrol Task'),
        desc: t('增加社交/活跃点，推动扩建任务进度。', 'Gain social activity points to push mission progress.'),
      };
    }
    if (key === 'shop') {
      return {
        key,
        title: t('打开集市', 'Open Market'),
        desc: t('快速打开商店面板进行土地和种子购买。', 'Quickly open shop panel for land and seed purchase.'),
      };
    }
    return {
      key,
      title: t('尝试升级', 'Try Level Up'),
      desc: t('检查并执行升级，提升后续种植效率。', 'Check and execute level up to improve future farming efficiency.'),
    };
  }, [selectedLandmark, t]);
  const selectedLandmarkLore = useMemo(() => {
    if (!selectedLandmark) return '';
    if (selectedLandmark.kind === 'signboard') return t('记录每次开拓成果与下一阶段目标。', 'Records each expansion result and next-stage targets.');
    if (selectedLandmark.kind === 'windmill') return t('风场驱动的灌溉系统，可临时提升生长效率。', 'Wind-driven irrigation system that temporarily boosts growth efficiency.');
    if (selectedLandmark.kind === 'barn') return t('用于快速调拨库存，避免空地闲置。', 'Used for quick inventory dispatch to avoid idle plots.');
    if (selectedLandmark.kind === 'tower') return t('维持农区秩序并汇报社区活跃度。', 'Maintains farm area order and reports community activity.');
    if (selectedLandmark.kind === 'market') return t('连接交易与供给的核心节点。', 'Core hub connecting trading and supply.');
    return t('全域解锁后点亮，用于标记小镇成熟阶段。', 'Activated after full unlock to mark town maturity.');
  }, [selectedLandmark, t]);
  const mapExpansionZone = useMemo(() => {
    const zone = getMapExpansionZoneLabel(mapExpansion.level);
    return {
      zh: zone.zh,
      en: zone.en,
      label: t(zone.zh, zone.en),
    };
  }, [mapExpansion.level, t]);
  const mapExpansionRecentLogs = mapExpansionLogs.slice(0, 5);
  const mapExpansionLastUpgradeText = mapExpansion.lastUpgradeAt > 0 ? formatClockTime(mapExpansion.lastUpgradeAt) : '--:--';

  useEffect(() => {
    if (!selectedLandmark) return;
    const matched = mapExpansionLandmarks.find((item) => item.level === selectedLandmark.level);
    if (!matched) {
      setSelectedLandmark(null);
      setMapExpansionLandmarkOpen(false);
      return;
    }
    if (
      matched.tx !== selectedLandmark.tx
      || matched.ty !== selectedLandmark.ty
      || matched.kind !== selectedLandmark.kind
    ) {
      setSelectedLandmark(matched);
    }
  }, [selectedLandmark, mapExpansionLandmarks]);

  const normalizeBuyCountInput = (value: string): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(1, Math.min(999, Math.floor(parsed)));
  };

  const selectedAgent = selectedAgentId
    ? agentsRef.current.find((agent) => agent.id === selectedAgentId) ?? null
    : null;
  const controlledAgent = controlledAgentId
    ? agentsRef.current.find((agent) => agent.id === controlledAgentId) ?? null
    : null;
  const mapPlayTalkProgress = Math.min(MAP_PLAY_TALK_TARGET, mapPlayStats.talks);
  const mapPlayQuestDone = mapPlayStats.questRewardClaimed || mapPlayTalkProgress >= MAP_PLAY_TALK_TARGET;
  const selectedAgentProfile = useMemo<AgentProfile | null>(() => {
    if (!selectedAgent) return null;
    const ownerText = selectedAgent.ownerAddress
      ? `${selectedAgent.ownerAddress.slice(0, 8)}...${selectedAgent.ownerAddress.slice(-6)}`
      : t('未验证', 'Unverified');
    const locationText = `${t('坐标', 'Coord')}: (${round1(selectedAgent.tx)}, ${round1(selectedAgent.ty)})`;
    const statusText = selectedAgent.thought ?? selectedAgent.status ?? t('在线', 'Online');

    if (selectedAgent.id === 'npc_cz') {
      return {
        displayName: 'CZ',
        subtitle: t('链上策略总监', 'On-chain Strategy Director'),
        personality: t('冷静、数据驱动、偏长期主义', 'Calm, data-driven, long-term oriented'),
        traits: [t('执行力强', 'Execution-focused'), t('风险敏感', 'Risk-aware'), t('节奏稳定', 'Steady pace')],
        specialties: [t('资金管理', 'Treasury Ops'), t('流动性观察', 'Liquidity Watch'), t('策略调度', 'Strategy Scheduling')],
        bio: t(
          '负责统筹小镇链上策略与奖池节奏，优先保证系统稳定运行，再追求收益最大化。',
          'Oversees on-chain strategy and prize-pool cadence, prioritizing stability before maximizing yield.',
        ),
        motto: t('先活下来，再赢下来。', 'Survive first, then win.'),
      };
    }

    if (selectedAgent.id === 'npc_heyi') {
      return {
        displayName: 'HEYI',
        subtitle: t('农场与运营协调官', 'Farm & Ops Coordinator'),
        personality: t('外向、务实、偏行动派', 'Outgoing, pragmatic, action-oriented'),
        traits: [t('沟通顺滑', 'Smooth communication'), t('执行迅速', 'Fast executor'), t('协作优先', 'Collab-first')],
        specialties: [t('地块调度', 'Land scheduling'), t('玩法引导', 'Gameplay guidance'), t('新人 onboarding', 'New-player onboarding')],
        bio: t(
          '负责把链上规则转换成玩家可执行步骤，保持农场节奏、资源补给和体验反馈。',
          'Turns on-chain rules into practical player steps and keeps farming pace, supplies, and UX feedback aligned.',
        ),
        motto: t('能跑通一轮，才算真正上手。', 'If one full loop works, you are truly onboarded.'),
      };
    }

    const personalityPool = [
      t('谨慎、观察型', 'Cautious observer'),
      t('激进、冲锋型', 'Aggressive charger'),
      t('均衡、协同型', 'Balanced collaborator'),
      t('冷静、计算型', 'Calm calculator'),
      t('好奇、探索型', 'Curious explorer'),
      t('稳健、复盘型', 'Stable reviewer'),
    ];
    const traitPool = [
      t('高频巡视', 'Frequent patrol'),
      t('擅长跟随热点', 'Trend following'),
      t('执行成本敏感', 'Gas-sensitive'),
      t('偏好安全路径', 'Prefers safe routes'),
      t('喜欢团队靠近', 'Likes team proximity'),
      t('主动发起对话', 'Initiates conversations'),
      t('重视收益波动', 'Tracks profit volatility'),
      t('善于长期值守', 'Strong long-watch'),
    ];
    const specialityPool = [
      t('地图巡航', 'Map patrol'),
      t('链上状态同步', 'On-chain sync'),
      t('事件捕捉', 'Event capture'),
      t('资源分配建议', 'Resource allocation hints'),
      t('开奖观察', 'Lottery observation'),
      t('农场节奏维护', 'Farm cadence'),
      t('行为上链留痕', 'Action audit trail'),
    ];
    const mottoPool = [
      t('先确认事实，再做动作。', 'Verify facts before action.'),
      t('有节奏地前进，胜率更高。', 'Rhythm improves win rate.'),
      t('每次收获都是下一轮的起点。', 'Each harvest starts the next round.'),
      t('把复杂规则变成简单循环。', 'Turn complex rules into simple loops.'),
    ];

    const seedBase = selectedAgent.tokenId ?? Array.from(selectedAgent.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const rand = createSeededRandom(seedBase + 97);
    const pick = (list: string[]) => list[Math.floor(rand() * list.length) % list.length];
    const pickTwoDistinct = (list: string[]): [string, string] => {
      const first = pick(list);
      let second = pick(list);
      let guard = 0;
      while (second === first && guard < 6) {
        second = pick(list);
        guard += 1;
      }
      return [first, second];
    };
    const [traitA, traitB] = pickTwoDistinct(traitPool);
    const [skillA, skillB] = pickTwoDistinct(specialityPool);
    const displayName = selectedAgent.tokenId !== undefined ? `NFT Agent #${selectedAgent.tokenId}` : selectedAgent.name;
    const roleText = AGENT_ROLE_LABEL[selectedAgent.mind.role];
    const temperamentText = AGENT_TEMPERAMENT_LABEL[selectedAgent.mind.temperament];
    const intentText = AGENT_INTENT_STATUS[selectedAgent.mind.intent];
    const queuedTasksText = selectedAgent.mind.taskQueue
      .slice(0, 3)
      .map((intent) => AGENT_INTENT_STATUS[intent])
      .join(' -> ');

    return {
      displayName,
      subtitle: selectedAgent.source === 'demo' ? t('演示角色', 'Demo Character') : roleText,
      personality: `${temperamentText} / ${pick(personalityPool)}`,
      traits: [traitA, traitB, locationText, `${t('当前意图', 'Intent')}: ${intentText}`],
      specialties: [
        skillA,
        skillB,
        `${t('当前状态', 'Status')}: ${statusText}`,
        `${t('任务队列', 'Task Queue')}: ${queuedTasksText || t('等待生成', 'Pending')}`,
      ],
      bio: t(
        '该角色具备独立思维节奏，会根据自身角色与性格自动决策并在地图中持续运行。',
        'This character has an independent thinking loop and continuously acts on map based on role and temperament.',
      ),
      motto: `${pick(mottoPool)} · ${t('持有人', 'Owner')}: ${ownerText}`,
    };
  }, [selectedAgent, t]);

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
    const collisionGrid = mapCollisionGridRef.current;
    if (collisionGrid && !isPositionWalkable(collisionGrid, safeTx, safeTy, 0.2)) {
      setAgentPanelNotice(t('该位置不可行走，请换一个地块。', 'That position is blocked. Pick another tile.'));
      return false;
    }
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
        pathWaypoints: [],
        thought: '已部署到地图',
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

  const scheduleMapFarmChainSync = (mode: 'full' | 'pool') => {
    if (!isTestMap || !isTestChainMode || !account) return;
    if (mapFarmEventSyncTimerRef.current !== null) {
      window.clearTimeout(mapFarmEventSyncTimerRef.current);
    }
    mapFarmEventSyncTimerRef.current = window.setTimeout(async () => {
      mapFarmEventSyncTimerRef.current = null;
      if (!isTestMap || !isTestChainMode || !account) return;
      const now = Date.now();
      if (mode === 'full') {
        if (now - mapFarmLastSyncAtRef.current < 1200) {
          return;
        }
        mapFarmLastSyncAtRef.current = now;
        await syncMapFarmFromChain();
      }
      await syncMapPrizePool();
    }, mode === 'full' ? 450 : 250);
  };

  const explainMapFarmWriteError = (
    action: 'levelUp' | 'purchaseLand' | 'purchaseSeed' | 'plant' | 'harvest',
    error: unknown,
  ): string => {
    const raw = pickErrorMessage(error);
    const msg = raw.toLowerCase();
    if (msg.includes('user rejected') || msg.includes('rejected the request')) {
      return t('你取消了钱包签名。', 'You canceled the wallet signature.');
    }
    if (msg.includes('insufficient funds')) {
      return t('Gas 不足，请补充 BNB 作为手续费。', 'Insufficient gas. Add BNB for transaction fee.');
    }
    if (msg.includes('execution reverted (no data present') || msg.includes('missing revert data') || msg.includes('require(false)')) {
      if (action === 'levelUp') {
        return t('升级条件未满足：请确认 EXP 达标、代币余额充足并已授权。', 'Level-up conditions not met: ensure EXP, token balance, and allowance are sufficient.');
      }
      if (action === 'purchaseLand' || action === 'purchaseSeed') {
        return t('购买条件未满足：请确认代币余额、授权额度和购买参数。', 'Purchase conditions not met: check token balance, allowance, and purchase parameters.');
      }
      if (action === 'plant') {
        return t('种植条件未满足：请确认该土地归你、地块为空且种子数量充足。', 'Plant conditions not met: ensure land ownership, empty plot, and enough seed.');
      }
      return t('收获条件未满足：请确认作物已成熟且未被收获。', 'Harvest conditions not met: ensure crop is mature and unharvested.');
    }
    if (msg.includes('call exception')) {
      return t('合约调用被拒绝：请检查当前网络、合约地址和参数。', 'Contract call rejected: check network, contract address, and parameters.');
    }
    return raw;
  };

  const preflightMapFarmWrite = async (
    action: 'levelUp' | 'purchaseLand' | 'purchaseSeed' | 'plant' | 'harvest',
    simulate: () => Promise<unknown>,
  ): Promise<boolean> => {
    try {
      await simulate();
      return true;
    } catch (error) {
      // Allowance/no-data failures may still pass after approve-retry path during real tx.
      if (isAllowanceOrDecodeError(error)) return true;
      const friendly = explainMapFarmWriteError(action, error);
      setFarmNotice(`${t('链上预检未通过', 'On-chain preflight failed')}: ${friendly}`);
      if (isTestChainMode && account) {
        await syncMapFarmFromChain().catch(() => undefined);
        await syncMapPrizePool().catch(() => undefined);
      }
      return false;
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
      grantPassXp(24);
      grantTownPoints(16, t('升级', 'Level Up'));
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
        const preflightOk = await preflightMapFarmWrite('levelUp', async () => {
          await farm.levelUp.staticCall();
        });
        if (!preflightOk) return;
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
        grantPassXp(28);
        grantTownPoints(22, t('升级', 'Level Up'));
      } catch (error) {
        const friendly = explainMapFarmWriteError('levelUp', error);
        setFarmNotice(`${t('升级失败', 'Level-up failed')}: ${friendly}`);
        if (isTestChainMode && account) {
          await syncMapFarmFromChain().catch(() => undefined);
          await syncMapPrizePool().catch(() => undefined);
        }
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
      advanceDailyQuest('buy', 1);
      incrementGameStat('buyActions', 1);
      grantTownPoints(8, t('购地', 'Land Buy'));
      grantPassXp(12);
      pushFarmFx(`${t('新增土地', 'Land Added')} +${count}`, 'buy');
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
      const preflightOk = await preflightMapFarmWrite('purchaseLand', async () => {
        await farm.purchaseLand.staticCall(count);
      });
      if (!preflightOk) return;
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
      advanceDailyQuest('buy', 1);
      incrementGameStat('buyActions', 1);
      grantTownPoints(12, t('购地', 'Land Buy'));
      grantPassXp(16);
      pushFarmFx(`${t('土地购买成功', 'Land Purchase Success')} +${count}`, 'buy');
    } catch (error) {
      const friendly = explainMapFarmWriteError('purchaseLand', error);
      setFarmNotice(`${t('购买土地失败', 'Land purchase failed')}: ${friendly}`);
      if (isTestChainMode && account) {
        await syncMapFarmFromChain().catch(() => undefined);
        await syncMapPrizePool().catch(() => undefined);
      }
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
      advanceDailyQuest('buy', 1);
      incrementGameStat('buyActions', 1);
      grantTownPoints(6, t('购种', 'Seed Buy'));
      grantPassXp(8);
      pushFarmFx(`${mapSeedLabel(seed)} ${t('补货', 'Restock')} +${count}`, 'buy');
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
      const preflightOk = await preflightMapFarmWrite('purchaseSeed', async () => {
        await farm.purchaseSeed.staticCall(mapSeedToSeedType(seed), count);
      });
      if (!preflightOk) return;
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
      advanceDailyQuest('buy', 1);
      incrementGameStat('buyActions', 1);
      grantTownPoints(9, t('购种', 'Seed Buy'));
      grantPassXp(10);
      pushFarmFx(`${mapSeedLabel(seed)} ${t('购买成功', 'Purchase Success')} +${count}`, 'buy');
    } catch (error) {
      const friendly = explainMapFarmWriteError('purchaseSeed', error);
      setFarmNotice(`${t('购买种子失败', 'Seed purchase failed')}: ${friendly}`);
      if (isTestChainMode && account) {
        await syncMapFarmFromChain().catch(() => undefined);
        await syncMapPrizePool().catch(() => undefined);
      }
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
          const preflightOk = await preflightMapFarmWrite('plant', async () => {
            await farm.plantSeed.staticCall(landId, mapSeedToSeedType(mapFarm.selectedSeed));
          });
          if (!preflightOk) return;
          const tx = await farm.plantSeed(landId, mapSeedToSeedType(mapFarm.selectedSeed));
          await tx.wait();
          setFarmNotice(t('种植成功，正在同步链上状态。', 'Plant success, syncing on-chain state.'));
          await syncMapFarmFromChain();
          advanceDailyQuest('plant', 1);
          incrementGameStat('plantActions', 1);
          grantTownPoints(7, t('种植', 'Plant'));
          grantPassXp(14);
          pushFarmFx(`${mapSeedLabel(mapFarm.selectedSeed)} ${t('已种下', 'Planted')}`, 'plant');
        } catch (error) {
          const friendly = explainMapFarmWriteError('plant', error);
          setFarmNotice(`${t('种植失败', 'Plant failed')}: ${friendly}`);
          await syncMapFarmFromChain().catch(() => undefined);
          await syncMapPrizePool().catch(() => undefined);
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
        const preflightOk = await preflightMapFarmWrite('harvest', async () => {
          await farm.harvestSeed.staticCall(landId);
        });
        if (!preflightOk) return;
        const tx = await farm.harvestSeed(landId);
        await tx.wait();
        setFarmNotice(t('收获成功，正在同步链上状态。', 'Harvest success, syncing on-chain state.'));
        await syncMapFarmFromChain();
        advanceDailyQuest('harvest', 1);
        incrementGameStat('harvestActions', 1);
        grantTownPoints(10, t('收获', 'Harvest'));
        grantPassXp(18);
        pushFarmFx(`${t('收获成功', 'Harvest Success')} +${MAP_FARM_TICKET_REWARD[plot.crop]} ${t('彩票', 'Tickets')}`, 'harvest');
      } catch (error) {
        const friendly = explainMapFarmWriteError('harvest', error);
        setFarmNotice(`${t('收获失败', 'Harvest failed')}: ${friendly}`);
        await syncMapFarmFromChain().catch(() => undefined);
        await syncMapPrizePool().catch(() => undefined);
      } finally {
        setMapFarmTxPending(false);
      }
      return;
    }

    const plot = mapFarm.plots[plotId];
    if (!plot) return;

    if (!plot.crop) {
      if ((mapFarm.bag[mapFarm.selectedSeed] ?? 0) <= 0) {
        setFarmNotice(t('该种子库存不足，请先收获或切换种子。', 'Selected seed is out of stock. Harvest or switch seed.'));
        return;
      }
      const growBase = MAP_FARM_SEED_META[mapFarm.selectedSeed].growMs;
      const speedFactor = Math.pow(0.95, Math.max(0, mapFarm.level - 1));
      const boostFactor = growthBoostActive ? 0.82 : 1;
      const growMs = Math.max(4_000, Math.floor(growBase * speedFactor * activeEventGrowMultiplier * boostFactor));
      const nextPlots = mapFarm.plots.slice();
      nextPlots[plotId] = {
        id: plotId,
        crop: mapFarm.selectedSeed,
        plantedAt: now,
        matureAt: now + growMs,
      };
      setMapFarm({
        ...mapFarm,
        plots: nextPlots,
        bag: { ...mapFarm.bag, [mapFarm.selectedSeed]: mapFarm.bag[mapFarm.selectedSeed] - 1 },
        exp: mapFarm.exp + MAP_FARM_SEED_META[mapFarm.selectedSeed].exp,
        notice: t('已种植，等待成熟后可收获。', 'Planted. Wait until mature to harvest.'),
      });
      advanceDailyQuest('plant', 1);
      incrementGameStat('plantActions', 1);
      grantTownPoints(5, t('种植', 'Plant'));
      grantPassXp(12);
      pushFarmFx(`${mapSeedLabel(mapFarm.selectedSeed)} ${t('已种下', 'Planted')}`, 'plant');
      return;
    }

    const remaining = (plot.matureAt ?? 0) - now;
    if (remaining > 0) {
      setFarmNotice(`${t('作物尚未成熟，剩余', 'Crop not mature yet, remaining')} ${formatFarmCountdown(remaining)}`);
      return;
    }

    const nextPlots = mapFarm.plots.slice();
    nextPlots[plotId] = { id: plotId, crop: null, plantedAt: null, matureAt: null };
    setMapFarm({
      ...mapFarm,
      plots: nextPlots,
      bag: {
        ...mapFarm.bag,
        [plot.crop]: mapFarm.bag[plot.crop] + 1,
      },
      notice: t('收获成功，种子已返还到库存。', 'Harvest complete, seed returned to inventory.'),
    });
    advanceDailyQuest('harvest', 1);
    incrementGameStat('harvestActions', 1);
    grantTownPoints(8, t('收获', 'Harvest'));
    grantPassXp(15);
    pushFarmFx(`${mapSeedLabel(plot.crop)} ${t('收获完成', 'Harvested')}`, 'harvest');
  };

  const handleLandmarkAction = async () => {
    if (!selectedLandmark || !selectedLandmarkAction || mapExpansionLandmarkPending) return;
    const action = selectedLandmarkAction.key;
    setMapExpansionLandmarkPending(true);
    try {
      if (action === 'guide') {
        setMapFarmGuideOpen(true);
        if (isTestMap) {
          setFarmNotice(t('已打开开拓指南。', 'Frontier guide opened.'));
        } else {
          setAgentPanelNotice(t('已打开扩建指南。', 'Expansion guide opened.'));
        }
        return;
      }
      if (action === 'boost') {
        if (isTestMap) {
          buyGrowthBoost();
        } else {
          setAgentPanelNotice(t('风车地标已登记，当前为观察模式。', 'Windmill landmark registered in observation mode.'));
        }
        return;
      }
      if (action === 'supply') {
        if (!isTestMap) {
          setAgentPanelNotice(t('仓库地标已登记，当前为观察模式。', 'Storage landmark registered in observation mode.'));
          return;
        }
        if (isTestChainMode && account) {
          await handleMapFarmPurchaseSeed(mapFarm.selectedSeed, 1);
        } else {
          const picked = mapFarm.selectedSeed;
          setMapFarm((prev) => ({
            ...prev,
            bag: {
              ...prev.bag,
              [picked]: prev.bag[picked] + 2,
            },
            notice: `${mapSeedLabel(picked)} ${t('补给 +2', 'supply +2')}`,
          }));
          advanceDailyQuest('buy', 1);
          incrementGameStat('buyActions', 1);
          grantTownPoints(6, t('仓库补给', 'Barn Supply'));
          grantPassXp(8);
          pushFarmFx(`${mapSeedLabel(picked)} +2`, 'buy');
        }
        return;
      }
      if (action === 'patrol') {
        if (isTestMap) {
          advanceDailyQuest('social', 1);
          incrementGameStat('socialActions', 1);
          grantTownPoints(12, t('巡逻值守', 'Patrol Duty'));
          grantPassXp(6);
          setFarmNotice(t('巡逻完成，社区活跃度提升。', 'Patrol complete. Community activity increased.'));
        } else {
          setAgentPanelNotice(t('巡逻塔任务已登记。', 'Patrol tower task registered.'));
        }
        return;
      }
      if (action === 'shop') {
        if (isTestMap) {
          setMapFarmSidebarOpen(true);
          setFarmNotice(t('已打开集市面板。', 'Market panel opened.'));
        } else {
          setAgentPanelNotice(t('集市地标已登记。', 'Market landmark registered.'));
        }
        return;
      }
      if (!isTestMap) {
        setAgentPanelNotice(t('信标动作已登记。', 'Beacon action registered.'));
        return;
      }
      if (canLevelUp) {
        handleMapFarmLevelUp();
      } else {
        setFarmNotice(t('当前经验不足，暂时无法升级。', 'Not enough EXP to level up now.'));
      }
    } finally {
      setMapExpansionLandmarkPending(false);
    }
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
            mind: createAgentMind({ id: `nft_${tokenId}`, source: 'nft', tokenId }),
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
            thought: '资金安全第一。',
            thoughtTimer: Date.now() + 1000000,
            walkFrames: czFrames,
            walkOffset: 0,
            mind: createAgentMind({ id: 'npc_cz', source: 'npc' }),
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
            thought: '一起建设生态。',
            thoughtTimer: Date.now() + 1000000,
            walkFrames: heyiFrames,
            walkOffset: 2,
            mind: createAgentMind({ id: 'npc_heyi', source: 'npc' }),
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
          thought: '连接中断，重试中…',
          thoughtTimer: Date.now() + 10000,
          walkOffset: i % 4,
          mind: createAgentMind({ id: `demo_${i}`, source: 'demo' }),
        }));
        agentsRef.current = demoAgents;
        setAgentCount(demoAgents.length);
      }
    };

    void loadAgents();
  }, [isTestMap, map?.width, map?.height]);

  useEffect(() => {
    if (isTestMap) return;
    if (agentCount <= 0) return;
    if (controlledAgentId && agentsRef.current.some((agent) => agent.id === controlledAgentId)) return;
    const fallbackId = agentsRef.current.find((agent) => agent.id === 'npc_heyi')?.id
      ?? agentsRef.current.find((agent) => agent.id === 'npc_cz')?.id
      ?? agentsRef.current[0]?.id
      ?? null;
    if (fallbackId) {
      setControlledAgentId(fallbackId);
    }
  }, [agentCount, controlledAgentId, isTestMap]);

  useEffect(() => {
    if (isTestMap) return;

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]'));
    };

    const setMovementKey = (code: string, value: boolean) => {
      if (code === 'KeyW' || code === 'ArrowUp') playInputRef.current.up = value;
      if (code === 'KeyS' || code === 'ArrowDown') playInputRef.current.down = value;
      if (code === 'KeyA' || code === 'ArrowLeft') playInputRef.current.left = value;
      if (code === 'KeyD' || code === 'ArrowRight') playInputRef.current.right = value;
      if (code === 'ShiftLeft' || code === 'ShiftRight') playInputRef.current.run = value;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!playModeEnabled) return;
      if (isEditableTarget(event.target)) return;
      const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
      if (movementCodes.has(event.code)) {
        setMovementKey(event.code, true);
        event.preventDefault();
        return;
      }
      if (event.code === 'KeyE') {
        playInteractRequestAtRef.current = Date.now();
        event.preventDefault();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      setMovementKey(event.code, false);
    };

    const clearKeys = () => {
      playInputRef.current = { up: false, down: false, left: false, right: false, run: false };
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearKeys);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearKeys);
    };
  }, [isTestMap, playModeEnabled]);

  useEffect(() => {
    if (playModeEnabled) return;
    playInputRef.current = { up: false, down: false, left: false, right: false, run: false };
  }, [playModeEnabled]);

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

  useEffect(() => {
    if (!map) return;
    mapCollisionGridRef.current = buildMapCollisionGrid(map);
  }, [map]);

  useEffect(() => {
    mapExpansionMotionRef.current.clear();
  }, [map]);

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

  useEffect(() => {
    if (isTestMap || !playModeEnabled || !map) return;
    const timer = window.setInterval(() => {
      if (mapDragRef.current.active) return;
      const wrap = canvasWrapRef.current;
      if (!wrap) return;
      const controlled = controlledAgentId
        ? agentsRef.current.find((agent) => agent.id === controlledAgentId)
        : undefined;
      if (!controlled) return;
      const tilePxW = map.tilewidth * effectiveScale;
      const tilePxH = map.tileheight * effectiveScale;
      const targetLeft = (controlled.tx * tilePxW) - (wrap.clientWidth * 0.5) + (tilePxW * 0.5);
      const targetTop = (controlled.ty * tilePxH) - (wrap.clientHeight * 0.5) + (tilePxH * 0.5);
      const maxLeft = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
      const maxTop = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
      const clampedLeft = clamp(targetLeft, 0, maxLeft);
      const clampedTop = clamp(targetTop, 0, maxTop);
      wrap.scrollLeft += (clampedLeft - wrap.scrollLeft) * 0.28;
      wrap.scrollTop += (clampedTop - wrap.scrollTop) * 0.28;
    }, 90);
    return () => window.clearInterval(timer);
  }, [isTestMap, playModeEnabled, map, effectiveScale, controlledAgentId]);

  // Autonomous Behavior Loop
  useEffect(() => {
    if (!map) return;
    const manualStatusLabel = t('手动探索中', 'Manual Exploring');
    const interval = setInterval(() => {
      const now = Date.now();
      const wrapEl = canvasWrapRef.current;
      const tilePxW = map.tilewidth * effectiveScale;
      const tilePxH = map.tileheight * effectiveScale;
      let minTx = 1;
      let maxTx = map.width - 2;
      let minTy = 1;
      let maxTy = map.height - 2;
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
      const farMargin = 10;
      const expansionBounds = getMapExpansionBounds(map, mapExpansion.level);
      const expansionMinTx = expansionBounds.minTx;
      const expansionMaxTx = expansionBounds.maxTx;
      const expansionMinTy = expansionBounds.minTy;
      const expansionMaxTy = expansionBounds.maxTy;
      const collisionGrid = mapCollisionGridRef.current;
      const previousAgents = agentsRef.current;
      const spatialBuckets = new Map<string, AgentMarker[]>();
      for (const a of previousAgents) {
        const key = `${Math.floor(a.tx)},${Math.floor(a.ty)}`;
        const existing = spatialBuckets.get(key);
        if (existing) {
          existing.push(a);
        } else {
          spatialBuckets.set(key, [a]);
        }
      }
      const isCrowdedByNearbyAgent = (x: number, y: number, selfId: string): boolean => {
        const bx = Math.floor(x);
        const by = Math.floor(y);
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const key = `${bx + ox},${by + oy}`;
            const group = spatialBuckets.get(key);
            if (!group) continue;
            for (const other of group) {
              if (other.id === selfId) continue;
              const dx = other.tx - x;
              const dy = other.ty - y;
              if ((dx * dx + dy * dy) < 0.16) return true;
            }
          }
        }
        return false;
      };

      agentsRef.current = previousAgents.map((agent) => {
        const shouldSimulateMovement = !isTestMap || agent.source !== 'nft' || agent.id === selectedAgentId;
        if (!shouldSimulateMovement) {
          if (agent.thought && agent.thoughtTimer && now > agent.thoughtTimer) {
            return { ...agent, thought: undefined, thoughtTimer: undefined, isMoving: false };
          }
          return agent;
        }

        let { tx, ty, targetTx, targetTy, pathWaypoints, thought, thoughtTimer, status, pauseUntil, stuckTicks } = agent;
        pathWaypoints = pathWaypoints ? pathWaypoints.slice(0, 4) : [];
        let mind = agent.mind ?? createAgentMind({ id: agent.id, source: agent.source, tokenId: agent.tokenId });
        let direction = agent.direction ?? 'down';
        const isTopLeftNpc = isTestMap && (agent.id === 'npc_cz' || agent.id === 'npc_heyi');
        const roamMinTx = isTopLeftNpc ? minTx : expansionMinTx;
        const roamMaxTx = isTopLeftNpc ? maxTx : expansionMaxTx;
        const roamMinTy = isTopLeftNpc ? minTy : expansionMinTy;
        const roamMaxTy = isTopLeftNpc ? maxTy : expansionMaxTy;
        const isFarNft = !isTestMap
          && agent.source === 'nft'
          && agent.id !== selectedAgentId
          && (agent.tx < (minTx - farMargin) || agent.tx > (maxTx + farMargin) || agent.ty < (minTy - farMargin) || agent.ty > (maxTy + farMargin));

        tx = clamp(tx, roamMinTx, roamMaxTx);
        ty = clamp(ty, roamMinTy, roamMaxTy);
        if (targetTx !== undefined) targetTx = clamp(targetTx, roamMinTx, roamMaxTx);
        if (targetTy !== undefined) targetTy = clamp(targetTy, roamMinTy, roamMaxTy);
        stuckTicks = Math.max(0, Math.floor(stuckTicks ?? 0));

        if (thoughtTimer && now > thoughtTimer) {
          thought = undefined;
          thoughtTimer = undefined;
        }

        const isControlledAgent = !isTestMap && playModeEnabled && controlledAgentId === agent.id;
        if (isControlledAgent) {
          const input = playInputRef.current;
          const xInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
          const yInput = (input.down ? 1 : 0) - (input.up ? 1 : 0);
          let movingNow = false;

          targetTx = undefined;
          targetTy = undefined;
          pathWaypoints = [];
          pauseUntil = undefined;
          stuckTicks = 0;

          if (xInput !== 0 || yInput !== 0) {
            const len = Math.hypot(xInput, yInput) || 1;
            const nx = xInput / len;
            const ny = yInput / len;
            const moveSpeed = (agent.source === 'nft' ? 0.055 : 0.07) * (input.run ? 1.45 : 1);
            const tryMoves = [
              { x: tx + nx * moveSpeed, y: ty + ny * moveSpeed },
              { x: tx + nx * moveSpeed, y: ty },
              { x: tx, y: ty + ny * moveSpeed },
            ];
            for (const next of tryMoves) {
              const nextX = clamp(next.x, roamMinTx, roamMaxTx);
              const nextY = clamp(next.y, roamMinTy, roamMaxTy);
              if (collisionGrid && !isPositionWalkable(collisionGrid, nextX, nextY, 0.2)) continue;
              tx = nextX;
              ty = nextY;
              movingNow = true;
              break;
            }
            if (Math.abs(nx) >= Math.abs(ny)) {
              direction = nx >= 0 ? 'right' : 'left';
            } else {
              direction = ny >= 0 ? 'down' : 'up';
            }
          }

          mind = {
            ...mind,
            currentTask: 'patrol',
            intent: 'patrol',
            nextDecisionAt: now + 1200,
          };

          return {
            ...agent,
            tx,
            ty,
            targetTx: undefined,
            targetTy: undefined,
            pathWaypoints: [],
            thought,
            thoughtTimer,
            direction,
            status: manualStatusLabel,
            mind,
            isMoving: movingNow,
            pauseUntil: undefined,
            stuckTicks: 0,
            lastMoveTime: movingNow ? now : agent.lastMoveTime,
          };
        }

        const shouldPause = typeof pauseUntil === 'number' && pauseUntil > now;
        if (!shouldPause && typeof pauseUntil === 'number' && pauseUntil <= now) {
          pauseUntil = undefined;
        }
        const shouldDecide = !shouldPause && (now >= mind.nextDecisionAt || targetTx === undefined || targetTy === undefined);
        if (shouldDecide) {
          const randSeed = (agent.tokenId ?? 0) + Math.floor(now / 777) + (agent.id.length * 97);
          const rnd = createSeededRandom(randSeed);
          let nextQueue = mind.taskQueue.slice();
          if (nextQueue.length === 0 || rnd() < 0.2) {
            nextQueue = buildAgentTaskQueue(mind.role, rnd);
          }
          const queuedIntent = nextQueue.shift();
          const nextIntent = queuedIntent ?? pickAgentIntent(mind, rnd);
          const nextTarget = pickIntentTarget(
            agent,
            nextIntent,
            map,
            roamMinTx,
            roamMaxTx,
            roamMinTy,
            roamMaxTy,
            rnd,
          );
          if (collisionGrid) {
            const normalizedTarget = normalizeWalkableTarget(map, collisionGrid, nextTarget.targetTx, nextTarget.targetTy, rnd);
            targetTx = normalizedTarget.targetTx;
            targetTy = normalizedTarget.targetTy;
            pathWaypoints = buildShortSteerWaypoints(map, collisionGrid, tx, ty, targetTx, targetTy, rnd, 3);
          } else {
            targetTx = nextTarget.targetTx;
            targetTy = nextTarget.targetTy;
            pathWaypoints = [];
          }
          thought = pickThoughtForMind(mind, nextIntent, rnd);
          thoughtTimer = now + 2600 + Math.floor(rnd() * 2200);
          status = AGENT_INTENT_STATUS[nextIntent];
          const temperMoveFactor = mind.temperament === 'bold'
            ? 0.08
            : mind.temperament === 'careful'
              ? -0.06
              : mind.temperament === 'curious'
                ? 0.04
                : 0;
          const energyDelta = nextIntent === 'rest' ? 0.16 : (-0.08 + temperMoveFactor + rnd() * 0.05);
          const sociabilityDelta = nextIntent === 'chat' ? 0.08 : (-0.015 + rnd() * 0.02);
          const focusDelta = (nextIntent === 'observe' || nextIntent === 'trade') ? 0.07 : (-0.02 + rnd() * 0.02);
          mind = {
            ...mind,
            currentTask: nextIntent,
            intent: nextIntent,
            taskQueue: nextQueue,
            energy: clamp01(mind.energy + energyDelta),
            sociability: clamp01(mind.sociability + sociabilityDelta),
            focus: clamp01(mind.focus + focusDelta),
            nextDecisionAt: now + (agent.source === 'nft' ? 2600 : 1600) + Math.floor(rnd() * 4200),
            memory: [...mind.memory.slice(-2), `${AGENT_ROLE_LABEL[mind.role]}:${status}`],
          };
          pauseUntil = undefined;
        }

        if (isFarNft) {
          return {
            ...agent,
            thought,
            thoughtTimer,
            status,
            mind,
            pathWaypoints,
            isMoving: false,
          };
        }

        let movingNow = false;
        if (!shouldPause && targetTx !== undefined && targetTy !== undefined) {
          const moveRnd = createSeededRandom((agent.tokenId ?? 0) + Math.floor(now / 130) + (agent.id.length * 157));
          const waypoint = pathWaypoints.length > 0 ? pathWaypoints[0] : null;
          const activeTargetTx = waypoint ? waypoint.tx : targetTx;
          const activeTargetTy = waypoint ? waypoint.ty : targetTy;
          const dx = activeTargetTx - tx;
          const dy = activeTargetTy - ty;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < (waypoint ? 0.34 : 0.38)) {
            if (waypoint) {
              pathWaypoints.shift();
              movingNow = pathWaypoints.length > 0;
            } else {
              targetTx = undefined;
              targetTy = undefined;
              pathWaypoints = [];
              movingNow = false;
              pauseUntil = now + 180 + Math.floor(moveRnd() * 620);
            }
          } else {
            const baseSpeed = agent.source === 'nft' ? 0.016 : 0.045;
            const intentSpeedFactor = mind.intent === 'rest'
              ? 0.45
              : mind.intent === 'chat'
                ? 0.72
                : mind.intent === 'patrol'
                  ? 1.15
                  : mind.intent === 'observe'
                    ? 1.08
                    : 1;
            const temperSpeedFactor = mind.temperament === 'bold'
              ? 1.12
              : mind.temperament === 'careful'
                ? 0.9
                : 1;
            const approachFactor = dist < 1.15 ? clamp(dist / 1.15, 0.42, 1) : 1;
            const speed = baseSpeed * intentSpeedFactor * temperSpeedFactor * approachFactor;
            const stepX = (dx / dist) * speed;
            const stepY = (dy / dist) * speed;
            const sideX = -stepY * 0.8;
            const sideY = stepX * 0.8;
            const minX = roamMinTx;
            const maxX = roamMaxTx;
            const minY = roamMinTy;
            const maxY = roamMaxTy;
            const leftFirst = moveRnd() > 0.5;
            const moveCandidates = [
              { x: tx + stepX, y: ty + stepY },
              { x: tx + stepX, y: ty },
              { x: tx, y: ty + stepY },
              leftFirst
                ? { x: tx + sideX, y: ty + sideY }
                : { x: tx - sideX, y: ty - sideY },
              leftFirst
                ? { x: tx - sideX, y: ty - sideY }
                : { x: tx + sideX, y: ty + sideY },
            ];
            let moved = false;
            for (const candidate of moveCandidates) {
              const nextX = clamp(candidate.x, minX, maxX);
              const nextY = clamp(candidate.y, minY, maxY);
              if (collisionGrid && !isPositionWalkable(collisionGrid, nextX, nextY, 0.2)) continue;
              if (isCrowdedByNearbyAgent(nextX, nextY, agent.id)) continue;
              const movedDx = nextX - tx;
              const movedDy = nextY - ty;
              tx = nextX;
              ty = nextY;
              if (Math.abs(movedDx) >= Math.abs(movedDy)) {
                direction = movedDx >= 0 ? 'right' : 'left';
              } else {
                direction = movedDy >= 0 ? 'down' : 'up';
              }
              moved = true;
              stuckTicks = 0;
              break;
            }
            if (!moved) {
              movingNow = false;
              stuckTicks += 1;
              if (collisionGrid && dist > 0.85) {
                const reroute = normalizeWalkableTarget(
                  map,
                  collisionGrid,
                  tx + Math.sign(dx) * (1.2 + moveRnd() * 2),
                  ty + Math.sign(dy) * (1.2 + moveRnd() * 2),
                  moveRnd,
                );
                targetTx = reroute.targetTx;
                targetTy = reroute.targetTy;
                pathWaypoints = buildShortSteerWaypoints(map, collisionGrid, tx, ty, targetTx, targetTy, moveRnd, 3);
                mind = { ...mind, nextDecisionAt: Math.min(mind.nextDecisionAt, now + 560 + Math.floor(moveRnd() * 520)) };
              }
              const failPauseBase = stuckTicks >= 4 ? 420 : 180;
              pauseUntil = now + failPauseBase + Math.floor(moveRnd() * 260);
              if (stuckTicks >= 8) {
                targetTx = undefined;
                targetTy = undefined;
                pathWaypoints = [];
                mind = { ...mind, nextDecisionAt: Math.min(mind.nextDecisionAt, now + 260) };
              }
            } else {
              movingNow = true;
            }
          }
        }

        return {
          ...agent,
          tx,
          ty,
          targetTx,
          targetTy,
          pathWaypoints,
          thought,
          thoughtTimer,
          direction,
          status,
          mind,
          isMoving: movingNow,
          pauseUntil,
          stuckTicks,
          lastMoveTime: movingNow ? now : agent.lastMoveTime,
        };
      });

      if (!isTestMap && playModeEnabled && playInteractRequestAtRef.current > playInteractHandledAtRef.current) {
        playInteractHandledAtRef.current = playInteractRequestAtRef.current;
        const controller = controlledAgentId
          ? agentsRef.current.find((agent) => agent.id === controlledAgentId)
          : undefined;
        if (!controller) {
          setAgentPanelNotice(t('当前没有可操控角色。', 'No controllable character right now.'));
          return;
        }
        let nearest: AgentMarker | null = null;
        let nearestDist = Number.POSITIVE_INFINITY;
        for (const candidate of agentsRef.current) {
          if (candidate.id === controller.id) continue;
          const dx = candidate.tx - controller.tx;
          const dy = candidate.ty - controller.ty;
          const d = (dx * dx) + (dy * dy);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = candidate;
          }
        }
        if (!nearest || nearestDist > 2.4) {
          setAgentPanelNotice(t('附近没有可互动角色，靠近一点再按 E。', 'No nearby character to interact with. Move closer and press E.'));
          return;
        }
        const pair = AGENT_CHAT_PAIRS[Math.floor(Math.random() * AGENT_CHAT_PAIRS.length)] ?? ['你好！', '你好。'];
        const talkNow = Date.now();
        agentsRef.current = agentsRef.current.map((agent) => {
          if (agent.id === controller.id) {
            return { ...agent, thought: pair[0], thoughtTimer: talkNow + 2200 };
          }
          if (agent.id === nearest.id) {
            return { ...agent, thought: pair[1], thoughtTimer: talkNow + 2200 };
          }
          return agent;
        });

        let questJustDone = false;
        setMapPlayStats((prev) => {
          const talks = prev.talks + 1;
          let score = prev.score + 25;
          let questRewardClaimed = prev.questRewardClaimed;
          if (!questRewardClaimed && talks >= MAP_PLAY_TALK_TARGET) {
            score += 120;
            questRewardClaimed = true;
            questJustDone = true;
          }
          return { score, talks, questRewardClaimed };
        });
        if (questJustDone) {
          setAgentPanelNotice(t('互动任务完成！奖励 +120 分。', 'Interaction quest complete! +120 score bonus.'));
        } else {
          setAgentPanelNotice(t('互动成功，继续探索。', 'Interaction successful, keep exploring.'));
        }
      }
    }, 90); // ~11 FPS logic tick (render loop remains smooth)

    return () => clearInterval(interval);
  }, [map, effectiveScale, isTestMap, selectedAgentId, mapExpansion.level, playModeEnabled, controlledAgentId, t]);

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

    const pickClosestLandmark = (tx: number, ty: number): MapExpansionLandmark | null => {
      if (mapExpansionLandmarks.length === 0) return null;
      let picked: MapExpansionLandmark | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const landmark of mapExpansionLandmarks) {
        const dx = landmark.tx - tx;
        const dy = landmark.ty - ty;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          picked = landmark;
        }
      }
      if (!picked || bestDist > 0.64) return null;
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
      const pickedLandmark = pickClosestLandmark(tx, ty);
      if (pickedLandmark) {
        setSelectedLandmark(pickedLandmark);
        setMapExpansionLandmarkOpen(true);
        setSelectedAgentId(null);
        setAgentProfileOpen(false);
        const msg = `${t('已选中地标', 'Selected landmark')}: ${t(pickedLandmark.nameZh, pickedLandmark.nameEn)}`;
        if (isTestMap) {
          setFarmNotice(msg);
        } else {
          setAgentPanelNotice(msg);
        }
        return;
      }
      const picked = pickClosestAgent(tx, ty);
      if (!picked) {
        setSelectedAgentId(null);
        setAgentProfileOpen(false);
        setMapExpansionLandmarkOpen(false);
        setSelectedLandmark(null);
        return;
      }
      setSelectedAgentId(picked.id);
      setAgentProfileOpen(true);
      setMapExpansionLandmarkOpen(false);
      setSelectedLandmark(null);
      const now = Date.now();
      const canCountSocial = mapFarmLastSocialQuestRef.current.agentId !== picked.id || (now - mapFarmLastSocialQuestRef.current.at > 6000);
      if (canCountSocial) {
        const socialGain = socialBoostActive ? 2 : 1;
        mapFarmLastSocialQuestRef.current = { agentId: picked.id, at: now };
        advanceDailyQuest('social', socialGain);
        incrementGameStat('socialActions', socialGain);
        grantPassXp(7 * socialGain);
      }
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
  }, [isTestMap, map, effectiveScale, placeMode, placementTokenId, socialBoostActive, ownedTokens.join(','), mapExpansionLandmarks]);

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
        const nowMs = Date.now();

        for (const deco of mapExpansionDecorations) {
          if (deco.tx < viewLeft || deco.tx > viewRight || deco.ty < viewTop || deco.ty > viewBottom) continue;
          drawMapExpansionDecoration(ctx, deco, tilePxW, tilePxH, nowMs);
        }
        for (const landmark of mapExpansionLandmarks) {
          if (landmark.tx < viewLeft || landmark.tx > viewRight || landmark.ty < viewTop || landmark.ty > viewBottom) continue;
          drawMapExpansionLandmark(ctx, landmark, tilePxW, tilePxH, nowMs);
        }
        if (mapExpansionLandmarkOpen && selectedLandmark) {
          const px = selectedLandmark.tx * tilePxW;
          const py = selectedLandmark.ty * tilePxH;
          ctx.strokeStyle = '#ffe067';
          ctx.lineWidth = Math.max(1.5, 2 * effectiveScale);
          ctx.strokeRect(px + tilePxW * 0.15, py + tilePxH * 0.12, tilePxW * 0.7, tilePxH * 0.74);
        }

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
          const bobOffset = a.isMoving ? Math.sin((Date.now() / 120) + (a.walkOffset ?? 0)) * tilePxH * 0.026 : 0;
          const drawPy = py + bobOffset;
          const size = a.source === 'nft' ? tilePxW * 0.88 : tilePxW;
          const offsetX = (tilePxW - size) / 2;
          const isSelected = selectedAgentId === a.id;
          const isHovered = hoveredAgentId === a.id;

          ctx.fillStyle = 'rgba(246, 255, 226, 0.6)';
          ctx.beginPath();
          ctx.ellipse(px + tilePxW / 2, drawPy + tilePxH - 2, tilePxW / 3, tilePxH / 7, 0, 0, Math.PI * 2);
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
              ctx.drawImage(sprite, sx, sy, 32, 32, px + spriteOffsetX, drawPy + spriteOffsetY, spriteScale, spriteScale);
            } else {
              ctx.drawImage(sprite, px + offsetX, drawPy + (a.source === 'nft' ? tilePxH * 0.08 : 0), size, size);
            }
          } else {
            if (a.source === 'nft' && a.tokenId !== undefined) {
              const r = (a.tokenId * 37) % 255;
              const g = (a.tokenId * 73) % 255;
              const b = (a.tokenId * 131) % 255;
              ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
              ctx.fillRect(px + offsetX + size * 0.1, drawPy + tilePxH * 0.2, size * 0.8, size * 0.62);
              ctx.fillStyle = '#173225';
              ctx.font = `${Math.max(8, 7 * effectiveScale)}px "Press Start 2P", cursive`;
              ctx.textAlign = 'center';
              ctx.fillText(String(a.tokenId), px + tilePxW / 2, drawPy + tilePxH * 0.7);
            } else {
              ctx.fillStyle = '#b21f1f';
              ctx.fillRect(px + offsetX, drawPy, size, size);
            }
          }

          if (isSelected || isHovered) {
            ctx.strokeStyle = isSelected ? '#ffd25b' : '#9ddf67';
            ctx.lineWidth = Math.max(1.5, 2 * effectiveScale);
            ctx.strokeRect(px + offsetX, drawPy + (a.source === 'nft' ? tilePxH * 0.08 : 0), size, size);
          }

          const shouldShowName = a.source !== 'nft' || isSelected || isHovered;
          if (shouldShowName) {
            ctx.textAlign = 'center';
            ctx.font = `${Math.max(10, 8 * effectiveScale)}px "Space Mono", monospace`;
            const textX = px + tilePxW / 2;
            const textY = drawPy + tilePxH + (12 * effectiveScale);

            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.strokeText(a.name, textX, textY);
            ctx.fillStyle = '#fff';
            ctx.fillText(a.name, textX, textY);
          }

          if (a.thought) {
            ctx.font = `${Math.max(10, 10 * effectiveScale)}px "Press Start 2P", cursive`;
            const bubbleY = drawPy - (10 * effectiveScale);
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

  }, [map, dims, renderLayers, effectiveScale, selectedAgentId, hoveredAgentId, placementTokenId, mapExpansionDecorations, mapExpansionLandmarks, mapExpansionLandmarkOpen, selectedLandmark]);

  useEffect(() => {
    if (!isTestMap) return;
    const timer = window.setInterval(() => {
      setFarmNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isTestMap]);

  useEffect(() => {
    if (!isTestMap) return;
    const dayKey = toDayKey(farmNowMs);
    const seasonKey = toSeasonKey(farmNowMs);
    setMapFarmGame((prev) => {
      const nextDaily = ensureDailyQuestStateDay(prev.daily, dayKey);
      const nextSeason = ensureSeasonStateKey(prev.season, seasonKey);
      if (nextDaily === prev.daily && nextSeason === prev.season) return prev;
      if (nextDaily !== prev.daily) {
        pushFarmFx(t('新的一天任务已刷新', 'Daily quests refreshed'), 'quest');
      }
      if (nextSeason !== prev.season) {
        pushFarmFx(t('新赛季已开启', 'New season started'), 'lottery');
      }
      return { ...prev, daily: nextDaily, season: nextSeason };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestMap, farmNowMs]);

  useEffect(() => {
    if (!isTestMap) return;
    saveToStorage(MAP_FARM_GAME_STORAGE_KEY, mapFarmGame);
  }, [isTestMap, mapFarmGame]);

  useEffect(() => {
    if (!isTestMap) return;
    saveToStorage(MAP_FARM_PANEL_STORAGE_KEY, mapFarmPanelState);
  }, [isTestMap, mapFarmPanelState]);

  useEffect(() => {
    if (!isTestMap) return;
    saveToStorage(MAP_FARM_SIDEBAR_STORAGE_KEY, mapFarmSidebarOpen);
  }, [isTestMap, mapFarmSidebarOpen]);

  useEffect(() => {
    saveToStorage(MAP_EXPANSION_STORAGE_KEY, mapExpansion);
  }, [mapExpansion]);

  useEffect(() => {
    saveToStorage(MAP_EXPANSION_LOG_STORAGE_KEY, mapExpansionLogs.slice(0, 16));
  }, [mapExpansionLogs]);

  useEffect(() => {
    if (!mapExpansionPulseActive) return;
    const timer = window.setTimeout(() => setMapExpansionPulseActive(false), 1650);
    return () => window.clearTimeout(timer);
  }, [mapExpansionPulseActive]);

  useEffect(() => {
    if (!map) return;
    const timer = window.setInterval(() => {
      setMapExpansion((prev) => {
        const maxLevel = MAP_EXPANSION_STAGES.length;
        if (prev.level >= maxLevel) {
          if (prev.progress === MAP_EXPANSION_STAGES[maxLevel - 1].need) return prev;
          return {
            ...prev,
            progress: MAP_EXPANSION_STAGES[maxLevel - 1].need,
          };
        }

        const activeAgents = agentsRef.current;
        const thinkingCount = activeAgents.reduce((count, agent) => (agent.thought ? count + 1 : count), 0);
        const expansionBounds = getMapExpansionBounds(map, prev.level);
        const motionCache = mapExpansionMotionRef.current;
        const activeIds = new Set<string>();
        let movingCount = 0;
        let explorationMoves = 0;
        let frontierMoves = 0;
        for (const agent of activeAgents) {
          activeIds.add(agent.id);
          if (!agent.isMoving) {
            motionCache.set(agent.id, { tx: agent.tx, ty: agent.ty });
            continue;
          }
          movingCount += 1;
          const last = motionCache.get(agent.id);
          if (last) {
            const d = Math.hypot(agent.tx - last.tx, agent.ty - last.ty);
            if (d > 0.1) {
              explorationMoves += 1;
            }
          }
          if (
            agent.tx <= expansionBounds.minTx + 2
            || agent.tx >= expansionBounds.maxTx - 2
            || agent.ty <= expansionBounds.minTy + 2
            || agent.ty >= expansionBounds.maxTy - 2
          ) {
            frontierMoves += 1;
          }
          motionCache.set(agent.id, { tx: agent.tx, ty: agent.ty });
        }
        for (const id of motionCache.keys()) {
          if (!activeIds.has(id)) {
            motionCache.delete(id);
          }
        }

        const movementScore = Math.min(26, Math.floor(Math.sqrt(movingCount + explorationMoves + 1) * 1.9));
        const frontierScore = Math.min(7, Math.floor(frontierMoves / 2));
        const socialBonus = thinkingCount > 0 ? 1 : 0;
        const quietBoost = movingCount === 0 ? 0 : 1;
        const delta = Math.max(1, movementScore + frontierScore + socialBonus + quietBoost);

        let level = prev.level;
        let progress = prev.progress + delta;
        let projects = prev.totalProjects;
        let upgraded = false;

        while (level < maxLevel) {
          const need = MAP_EXPANSION_STAGES[level - 1].need;
          const mission = getMapExpansionMission(level, maxLevel);
          const missionProgress = buildMapExpansionMissionProgress(mission, mapFarmGame, mapFarm.level);
          const missionReady = !missionProgress || missionProgress.done;
          if (progress < need || !missionReady) {
            if (!missionReady && progress > need) progress = need;
            break;
          }
          progress -= need;
          level += 1;
          projects += 1;
          upgraded = true;
          if (level >= maxLevel) {
            progress = MAP_EXPANSION_STAGES[maxLevel - 1].need;
            break;
          }
        }

        if (!upgraded && level === prev.level && progress === prev.progress) return prev;
        return {
          level,
          progress,
          totalProjects: projects,
          lastUpgradeAt: upgraded ? Date.now() : prev.lastUpgradeAt,
        };
      });
    }, 1800);
    return () => window.clearInterval(timer);
  }, [map, mapFarmGame, mapFarm.level]);

  useEffect(() => {
    const previousLevel = mapExpansionLastLevelRef.current;
    if (mapExpansion.level <= previousLevel) {
      mapExpansionLastLevelRef.current = mapExpansion.level;
      return;
    }
    mapExpansionLastLevelRef.current = mapExpansion.level;
    const zone = getMapExpansionZoneLabel(mapExpansion.level);
    const zoneText = t(zone.zh, zone.en);
    const landmark = getMapExpansionLandmarkMeta(mapExpansion.level);
    const landmarkText = t(landmark.nameZh, landmark.nameEn);
    const msg = `${t('AI 自动扩建完成，已解锁地图新区', 'AI auto-expansion complete. New map zone unlocked')} Lv.${mapExpansion.level} · ${zoneText} · ${t('地标', 'Landmark')}: ${landmarkText}`;
    const now = Date.now();
    setMapExpansionPulseActive(true);
    setMapExpansionLogs((prev) => ([
      {
        id: `exp-${now}-${mapExpansion.level}`,
        level: mapExpansion.level,
        zoneLabelZh: zone.zh,
        zoneLabelEn: zone.en,
        unlockedPct: mapExpansionUnlockedPct,
        createdAt: now,
      },
      ...prev,
    ]).slice(0, 16));
    agentsRef.current = agentsRef.current.map((agent) => {
      if (agent.id !== 'npc_cz' && agent.id !== 'npc_heyi') return agent;
      return {
        ...agent,
        thought: t('扩建完成，继续向外推进！', 'Expansion complete, pushing further!'),
        thoughtTimer: now + 3200,
      };
    });
    if (isTestMap) {
      setFarmNotice(msg);
    } else {
      setAgentPanelNotice(msg);
    }
  }, [mapExpansion.level, mapExpansionUnlockedPct, isTestMap, t]);

  useEffect(() => {
    if (!mapExpansionMissionProgress || mapExpansionMissionProgress.done) return;
    if (mapExpansion.level >= mapExpansionMaxLevel) return;
    if (mapExpansion.progress < mapExpansionNeed) return;
    const now = Date.now();
    if ((now - mapExpansionMissionHintAtRef.current) < 12_000) return;
    mapExpansionMissionHintAtRef.current = now;
    const mission = mapExpansionMissionProgress.mission;
    const msg = t(
      `扩建待命：${mission.titleZh}（${mapExpansionMissionProgress.statusTextZh}） · ${mapExpansionMissionProgress.unmetHintZh}`,
      `Expansion waiting: ${mission.titleEn} (${mapExpansionMissionProgress.statusTextEn}) · ${mapExpansionMissionProgress.unmetHintEn}`,
    );
    if (isTestMap) {
      setFarmNotice(msg);
    } else {
      setAgentPanelNotice(msg);
    }
  }, [
    mapExpansion.level,
    mapExpansion.progress,
    mapExpansionNeed,
    mapExpansionMaxLevel,
    mapExpansionMissionProgress,
    isTestMap,
    t,
  ]);

  useEffect(() => {
    if (!isTestMap) return;
    const timer = window.setInterval(() => {
      setMapFarmFx((prev) => prev.filter((item) => (Date.now() - item.createdAt) < 2800));
    }, 400);
    return () => window.clearInterval(timer);
  }, [isTestMap]);

  useEffect(() => {
    if (!isTestMap) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setMapFarmActiveEvent((prev) => {
        if (!prev) return prev;
        if (now < prev.endsAt) return prev;
        pushFarmFx(`${eventLabel(prev.id)} ${t('已结束', 'ended')}`, 'event');
        return null;
      });
      setMapFarmNextEventAt((prev) => {
        if (now < prev) return prev;
        setMapFarmActiveEvent((existing) => {
          if (existing) return existing;
          const created = createRandomFarmEvent(now);
          pushFarmFx(`${eventLabel(created.id)} ${t('已触发', 'started')}`, 'event');
          setFarmNotice(`${eventLabel(created.id)}：${eventDesc(created.id)}`);
          return created;
        });
        return now + 95_000 + Math.floor(Math.random() * 65_000);
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestMap]);

  useEffect(() => {
    if (!isTestMap || !isTestChainMode) return;
    if (mapFarmCurrentRound === null) return;
    if (mapFarmLastRoundRef.current === null) {
      mapFarmLastRoundRef.current = mapFarmCurrentRound;
      return;
    }
    if (mapFarmCurrentRound > mapFarmLastRoundRef.current) {
      pushFarmFx(`${t('开奖完成，进入新一期', 'Lottery round advanced')} #${mapFarmCurrentRound}`, 'lottery');
      setFarmNotice(`${t('开奖已更新，当前期数', 'Lottery updated, current round')}: #${mapFarmCurrentRound}`);
    }
    mapFarmLastRoundRef.current = mapFarmCurrentRound;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestMap, isTestChainMode, mapFarmCurrentRound]);

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
    if (!isTestMap || !isTestChainMode || !account) return;
    const provider = getReadProvider();
    const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_CONTRACT_ABI, provider);
    const watchEvents = [
      'LandPurchased',
      'SeedPurchased',
      'SeedPlanted',
      'SeedBalanceUpdated',
      'LevelUp',
      'LotteryExchanged',
      'LotteryDrawn',
      'AdminHarvestSeed',
      'LandMinted',
    ];

    const userLower = account.toLowerCase();
    const onFarmEvent = (...args: unknown[]) => {
      const eventPayload = args[args.length - 1] as { args?: Record<string, unknown> } | undefined;
      const maybeArgs = eventPayload?.args;
      const involvedAddress = maybeArgs?.user ?? maybeArgs?._user ?? maybeArgs?.to;
      const involvesCurrentUser = typeof involvedAddress === 'string' && involvedAddress.toLowerCase() === userLower;
      scheduleMapFarmChainSync(involvesCurrentUser ? 'full' : 'pool');
    };

    for (const eventName of watchEvents) {
      try {
        farm.on(eventName, onFarmEvent);
      } catch {
        // ignore missing event in ABI variants
      }
    }

    return () => {
      for (const eventName of watchEvents) {
        try {
          farm.off(eventName, onFarmEvent);
        } catch {
          // ignore detach errors
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestMap, isTestChainMode, account]);

  useEffect(() => () => {
    if (mapFarmEventSyncTimerRef.current !== null) {
      window.clearTimeout(mapFarmEventSyncTimerRef.current);
      mapFarmEventSyncTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isTestMap && isTestChainMode && account) return;
    if (mapFarmEventSyncTimerRef.current !== null) {
      window.clearTimeout(mapFarmEventSyncTimerRef.current);
      mapFarmEventSyncTimerRef.current = null;
    }
  }, [isTestMap, isTestChainMode, account]);

  useEffect(() => {
    if (selectedAgent) return;
    setAgentProfileOpen(false);
  }, [selectedAgent]);

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
              <div className="village-agent-stat-row">
                <span>{t('操控角色', 'Controlled')}</span>
                <strong>{controlledAgent ? (controlledAgent.tokenId !== undefined ? `#${controlledAgent.tokenId}` : controlledAgent.name) : '--'}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('探索分数', 'Play Score')}</span>
                <strong>{mapPlayStats.score}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('互动任务', 'Talk Quest')}</span>
                <strong>{`${mapPlayTalkProgress}/${MAP_PLAY_TALK_TARGET}`}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('扩建等级', 'Expansion Lv')}</span>
                <strong>{`Lv.${mapExpansion.level}/${mapExpansionMaxLevel}`}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('扩建进度', 'Expansion Progress')}</span>
                <strong>{mapExpansion.level >= mapExpansionMaxLevel ? t('已满级', 'MAX') : `${mapExpansionProgressPct}%`}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('已解锁区域', 'Unlocked Area')}</span>
                <strong>{`${mapExpansionUnlockedPct}%`}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('当前分区', 'Current Zone')}</span>
                <strong>{mapExpansionZone.label}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('最近扩建', 'Last Unlock')}</span>
                <strong>{mapExpansionLastUpgradeText}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('扩建任务', 'Expansion Mission')}</span>
                <strong>
                  {mapExpansionMissionProgress
                    ? `${mapExpansionMissionProgress.done ? t('完成', 'Done') : t('进行中', 'Ongoing')} ${t(mapExpansionMissionProgress.statusTextZh, mapExpansionMissionProgress.statusTextEn)}`
                    : t('无', 'N/A')}
                </strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('已解锁地标', 'Landmarks')}</span>
                <strong>{`${mapExpansionLandmarks.length}/${MAP_EXPANSION_LANDMARKS.length}`}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('当前地标', 'Current Landmark')}</span>
                <strong>{mapExpansionCurrentLandmark ? t(mapExpansionCurrentLandmark.nameZh, mapExpansionCurrentLandmark.nameEn) : '--'}</strong>
              </div>
              {mapExpansionMissionProgress ? (
                <div className="village-expansion-mission-card">
                  <div className="village-agent-selected-title">{t('当前目标', 'Current Objective')}</div>
                  <div className="village-expansion-mission-title">{t(mapExpansionMissionProgress.mission.titleZh, mapExpansionMissionProgress.mission.titleEn)}</div>
                  <div className="village-expansion-mission-hint">
                    {mapExpansionMissionProgress.done
                      ? t('条件已满足，扩建将自动推进。', 'Conditions met. Expansion will proceed automatically.')
                      : t(mapExpansionMissionProgress.unmetHintZh, mapExpansionMissionProgress.unmetHintEn)}
                  </div>
                </div>
              ) : null}

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
                  className={`village-agent-btn ${playModeEnabled ? 'active' : ''}`}
                  onClick={() => setPlayModeEnabled((prev) => !prev)}
                >
                  {playModeEnabled ? t('暂停操控', 'Pause Control') : t('开始操控', 'Start Control')}
                </button>
                <button
                  type="button"
                  className="village-agent-btn"
                  disabled={!selectedAgent}
                  onClick={() => {
                    if (!selectedAgent) return;
                    setControlledAgentId(selectedAgent.id);
                    setAgentPanelNotice(t('已接管当前选中角色。', 'Now controlling selected character.'));
                  }}
                >
                  {t('接管选中', 'Control Selected')}
                </button>
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
              <div className="village-expansion-log">
                <div className="village-agent-selected-title">{t('扩建记录', 'Expansion Log')}</div>
                {mapExpansionRecentLogs.length === 0 ? (
                  <div>{t('暂无扩建记录。', 'No expansion records yet.')}</div>
                ) : (
                  <div className="village-expansion-log-list">
                    {mapExpansionRecentLogs.map((item) => (
                      <div key={item.id} className="village-expansion-log-item">
                        <span>{`Lv.${item.level} · ${t(item.zoneLabelZh, item.zoneLabelEn)}`}</span>
                        <em>{`${item.unlockedPct}% · ${formatClockTime(item.createdAt)}`}</em>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {agentPanelNotice ? <div className="village-agent-notice">{agentPanelNotice}</div> : null}
          </div>
        ) : null}

        <div className="village-canvas-card ga-card-surface">
          <div
            className={`village-canvas-wrap ${isTestMap ? 'is-test-map' : ''} ${!isTestMap && placeMode ? 'is-place-mode' : ''} ${mapExpansionPulseActive ? 'is-expansion-pulse' : ''}`}
            ref={canvasWrapRef}
          >
            <canvas ref={canvasRef} className="village-canvas" />
            {mapExpansionPulseActive ? <div className="village-expansion-pulse-overlay" /> : null}
            {!isTestMap && placeMode ? (
              <div className="village-place-hint">
                {t('放置模式：点击地图任意位置，把选中的 NFT 放上去。', 'Placement mode: click anywhere on map to place selected NFT.')}
              </div>
            ) : null}
            {!isTestMap ? (
              <div className="village-play-hud">
                <div className="village-play-hud-row">
                  <span>{t('操控', 'Control')}</span>
                  <strong>{playModeEnabled ? t('已开启', 'ON') : t('已暂停', 'PAUSED')}</strong>
                </div>
                <div className="village-play-hud-row">
                  <span>{t('角色', 'Character')}</span>
                  <strong>{controlledAgent ? (controlledAgent.tokenId !== undefined ? `#${controlledAgent.tokenId}` : controlledAgent.name) : '--'}</strong>
                </div>
                <div className="village-play-hud-row">
                  <span>{t('分数', 'Score')}</span>
                  <strong>{mapPlayStats.score}</strong>
                </div>
                <div className="village-play-hud-row">
                  <span>{t('互动任务', 'Talk Quest')}</span>
                  <strong>{`${mapPlayTalkProgress}/${MAP_PLAY_TALK_TARGET}${mapPlayQuestDone ? ` ${t('完成', 'Done')}` : ''}`}</strong>
                </div>
                <div className="village-play-hud-tip">{t('WASD/方向键移动 · Shift冲刺 · E互动', 'Move: WASD/Arrows · Sprint: Shift · Interact: E')}</div>
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
                <div className={`village-top-chip ${mapExpansionPulseActive ? 'is-upgrading' : ''}`}>
                  <span>{t('地图扩建', 'Map Expansion')}</span>
                  <strong>{`Lv.${mapExpansion.level}/${mapExpansionMaxLevel}`}</strong>
                  <em className="village-top-chip-sub">
                    {mapExpansion.level >= mapExpansionMaxLevel
                      ? `${t('已满级', 'MAX')} · ${mapExpansionZone.label}`
                      : `${mapExpansionProgressPct}% · ${t('解锁', 'Area')} ${mapExpansionUnlockedPct}% · ${mapExpansionZone.label}`}
                  </em>
                </div>
                <div className="village-top-chip">
                  <span>{t('扩建任务', 'Expansion Mission')}</span>
                  <strong>
                    {mapExpansionMissionProgress
                      ? `${t(mapExpansionMissionProgress.mission.titleZh, mapExpansionMissionProgress.mission.titleEn)} · ${t(mapExpansionMissionProgress.statusTextZh, mapExpansionMissionProgress.statusTextEn)}`
                      : t('全部完成', 'All complete')}
                  </strong>
                  <em className="village-top-chip-sub">
                    {mapExpansionMissionProgress
                      ? (mapExpansionMissionProgress.done
                        ? t('条件已满足', 'Ready to unlock')
                        : t(mapExpansionMissionProgress.unmetHintZh, mapExpansionMissionProgress.unmetHintEn))
                      : t('地图已全域解锁', 'Map fully unlocked')}
                  </em>
                </div>
                <div className="village-top-chip">
                  <span>{t('扩建地标', 'Expansion Landmark')}</span>
                  <strong>
                    {mapExpansionCurrentLandmark
                      ? `${t(mapExpansionCurrentLandmark.nameZh, mapExpansionCurrentLandmark.nameEn)} · ${mapExpansionLandmarks.length}/${MAP_EXPANSION_LANDMARKS.length}`
                      : t('未解锁', 'Locked')}
                  </strong>
                  <em className="village-top-chip-sub">
                    {t('每级解锁一个固定地标', 'Unlock one fixed landmark per level')}
                  </em>
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

                <div className="testmap-event-banner">
                  {mapFarmActiveEvent ? (
                    <>
                      <span className="testmap-event-badge">{t('随机事件', 'Live Event')}</span>
                      <strong>{eventLabel(mapFarmActiveEvent.id)}</strong>
                      <span>{eventDesc(mapFarmActiveEvent.id)}</span>
                      <em>
                        {t('剩余', 'Ends in')} {formatFarmCountdown(activeEventRemainingMs)}
                        {` · ${t('活跃点加成', 'Point Bonus')} +${mapFarmActiveEvent.actionPointBonus}`}
                      </em>
                    </>
                  ) : (
                    <>
                      <span className="testmap-event-badge">{t('下一事件', 'Next Event')}</span>
                      <strong>{t('准备中', 'Preparing')}</strong>
                      <span>{t('请继续种植与互动，事件即将触发。', 'Keep farming and interacting. Event is coming soon.')}</span>
                      <em>{t('倒计时', 'Countdown')} {formatFarmCountdown(nextEventRemainingMs)}</em>
                    </>
                  )}
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

                  <aside className={`testmap-shop-panel testmap-shop-drawer ${mapFarmSidebarOpen ? 'is-open' : ''}`}>
                    <div className="testmap-panel-toolbar">
                      <span className="testmap-panel-toolbar-meta">
                        {t('面板', 'Panels')}: {openPanelCount}/7
                      </span>
                      <div className="testmap-panel-toolbar-actions">
                        <button type="button" className="testmap-panel-toolbar-btn" onClick={() => setMapFarmPanelAll(true)}>
                          {t('展开', 'Open')}
                        </button>
                        <button type="button" className="testmap-panel-toolbar-btn" onClick={() => setMapFarmPanelAll(false)}>
                          {t('收起', 'Close')}
                        </button>
                        <button type="button" className="testmap-panel-toolbar-btn" onClick={resetMapFarmPanelLayout}>
                          {t('重置', 'Reset')}
                        </button>
                      </div>
                    </div>
                    <div className="testmap-quest-card testmap-collapsible">
                      <button type="button" className="testmap-card-toggle testmap-quest-head" onClick={() => toggleMapFarmPanel('quest')}>
                        <span>{t('每日任务', 'Daily Quests')}</span>
                        <span className="testmap-card-toggle-right">
                          <span className={`testmap-card-pill ${dailyQuestClaimableCount > 0 ? 'is-hot' : ''}`}>
                            {t('可领', 'Ready')} {dailyQuestClaimableCount}
                          </span>
                          <strong>{mapFarmGame.townPoints} {t('活跃点', 'Points')}</strong>
                          <span className="testmap-card-toggle-icon">{mapFarmPanelState.quest ? '-' : '+'}</span>
                        </span>
                      </button>
                      <div className={`testmap-card-body ${mapFarmPanelState.quest ? 'is-open' : ''}`}>
                        <div className="testmap-quest-list">
                          {dailyQuestIds.map((questId) => {
                            const target = MAP_FARM_DAILY_QUEST_TARGET[questId];
                            const progress = Math.min(target, mapFarmGame.daily.progress[questId] ?? 0);
                            const claimed = Boolean(mapFarmGame.daily.claimed[questId]);
                            const canClaim = progress >= target && !claimed;
                            const reward = MAP_FARM_DAILY_QUEST_REWARD[questId];
                            return (
                              <div key={`quest-${questId}`} className="testmap-quest-item">
                                <div className="testmap-quest-title">{questLabel(questId)}</div>
                                <div className="testmap-quest-desc">{questDesc(questId)}</div>
                                <div className="testmap-quest-progress">
                                  <span>{progress}/{target}</span>
                                  <span>+{reward} {t('活跃点', 'Points')}</span>
                                </div>
                                <button
                                  type="button"
                                  className="testmap-quest-claim-btn"
                                  disabled={!canClaim}
                                  onClick={() => claimDailyQuestReward(questId)}
                                >
                                  {claimed ? t('已领取', 'Claimed') : canClaim ? t('领取奖励', 'Claim Reward') : t('未完成', 'Incomplete')}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="testmap-achievement-card testmap-collapsible">
                      <button type="button" className="testmap-card-toggle testmap-achievement-head" onClick={() => toggleMapFarmPanel('achievement')}>
                        <span>{t('成就墙', 'Achievements')}</span>
                        <span className="testmap-card-toggle-right">
                          <span className={`testmap-card-pill ${achievementClaimableCount > 0 ? 'is-hot' : ''}`}>
                            {t('可领', 'Ready')} {achievementClaimableCount}
                          </span>
                          <span className="testmap-card-toggle-icon">{mapFarmPanelState.achievement ? '-' : '+'}</span>
                        </span>
                      </button>
                      <div className={`testmap-card-body ${mapFarmPanelState.achievement ? 'is-open' : ''}`}>
                        <div className="testmap-achievement-list">
                          {achievementRows.map((row) => (
                            <div key={`achievement-${row.id}`} className="testmap-achievement-item">
                              <div className="testmap-achievement-title">{achievementLabel(row.id)}</div>
                              <div className="testmap-achievement-desc">{achievementDesc(row.id)}</div>
                              <div className="testmap-achievement-progress">
                                <span>{row.progress}/{row.target}</span>
                                <span>+{row.reward} {t('活跃点', 'Points')}</span>
                              </div>
                              <button
                                type="button"
                                className="testmap-achievement-claim-btn"
                                disabled={!row.canClaim}
                                onClick={() => claimAchievementReward(row.id)}
                              >
                                {row.claimed ? t('已领取', 'Claimed') : row.canClaim ? t('领取成就', 'Claim') : t('进行中', 'In Progress')}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="testmap-leaderboard-card testmap-collapsible">
                      <button type="button" className="testmap-card-toggle testmap-leaderboard-head" onClick={() => toggleMapFarmPanel('leaderboard')}>
                        <span>{t('赛季排行榜', 'Season Leaderboard')}</span>
                        <span className="testmap-card-toggle-right">
                          <span className="testmap-card-pill">
                            {t('我的排名', 'My Rank')} {leaderboardPlayerRow ? `#${leaderboardPlayerRow.rank}` : '--'}
                          </span>
                          <em>{t('剩余', 'Ends in')} {formatLongCountdown(seasonRemainingMs)}</em>
                          <span className="testmap-card-toggle-icon">{mapFarmPanelState.leaderboard ? '-' : '+'}</span>
                        </span>
                      </button>
                      <div className={`testmap-card-body ${mapFarmPanelState.leaderboard ? 'is-open' : ''}`}>
                        <div className="testmap-leaderboard-list">
                          {leaderboardTopRows.map((row) => (
                            <div key={`rank-${row.id}`} className={`testmap-leaderboard-item ${row.isPlayer ? 'is-player' : ''}`}>
                              <span>#{row.rank}</span>
                              <span>{row.name}</span>
                              <strong>{row.score}</strong>
                            </div>
                          ))}
                          {leaderboardPlayerRow && leaderboardPlayerRow.rank > leaderboardTopRows.length ? (
                            <div className="testmap-leaderboard-item is-player">
                              <span>#{leaderboardPlayerRow.rank}</span>
                              <span>{leaderboardPlayerRow.name}</span>
                              <strong>{leaderboardPlayerRow.score}</strong>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className={`testmap-pass-card testmap-collapsible ${seasonClaimableTotal > 0 ? 'is-claimable' : ''}`}>
                      <button type="button" className="testmap-card-toggle testmap-pass-head" onClick={() => toggleMapFarmPanel('pass')}>
                        <span>{t('赛季通行证', 'Season Pass')}</span>
                        <span className="testmap-card-toggle-right">
                          <span className={`testmap-card-pill ${seasonClaimableTotal > 0 ? 'is-hot' : ''}`}>
                            {t('可领', 'Ready')} {seasonClaimableTotal}
                          </span>
                          <strong>Lv.{passLevel}</strong>
                          <span className="testmap-card-toggle-icon">{mapFarmPanelState.pass ? '-' : '+'}</span>
                        </span>
                      </button>
                      <div className={`testmap-card-body ${mapFarmPanelState.pass ? 'is-open' : ''}`}>
                        <div className="testmap-pass-season-row">
                          <span>{t('赛季周', 'Season Week')}: {seasonState.seasonKey}</span>
                          <span>{t('剩余', 'Ends in')} {formatLongCountdown(seasonRemainingMs)}</span>
                        </div>
                        <div className="testmap-pass-progress-track">
                          <div className={`testmap-pass-progress-fill ${passIsMaxLevel ? 'is-max' : ''}`} style={{ width: `${passProgress}%` }} />
                        </div>
                        <div className="testmap-pass-progress-row">
                          <span>{passIsMaxLevel ? t('已满级', 'MAX') : `${passXpInLevel}/${MAP_FARM_PASS_XP_PER_LEVEL} XP`}</span>
                          <span>
                            {passIsMaxLevel ? t('奖励全部解锁', 'All rewards unlocked') : `${t('下一级还需', 'Need')} ${passNextLevelNeedXp} XP`}
                          </span>
                        </div>
                        <div className="testmap-pass-chip-row">
                          <span className={`testmap-pass-chip ${seasonState.proOwned ? 'is-on' : ''}`}>
                            {seasonState.proOwned ? t('进阶已激活', 'Pro Active') : t('免费轨道', 'Free Track')}
                          </span>
                          <span className="testmap-pass-chip">
                            {t('可领取', 'Claimable')}: F{seasonFreeClaimableCount}{seasonState.proOwned ? ` / P${seasonProClaimableCount}` : ''}
                          </span>
                        </div>
                        <div className="testmap-pass-btn-row">
                          <button
                            type="button"
                            className="testmap-pass-btn"
                            disabled={mapFarmTxPending || seasonClaimableTotal <= 0}
                            onClick={claimSeasonPassRewards}
                          >
                            {t('领取通行证', 'Claim Pass')}
                          </button>
                          <button
                            type="button"
                            className="testmap-pass-btn is-pro"
                            disabled={mapFarmTxPending || seasonState.proOwned}
                            onClick={buyProPass}
                          >
                            {seasonState.proOwned ? t('进阶已拥有', 'Pro Owned') : `${t('解锁进阶', 'Unlock Pro')} (${MAP_FARM_PRO_PASS_COST})`}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="testmap-boost-card testmap-collapsible">
                      <button type="button" className="testmap-card-toggle testmap-boost-head" onClick={() => toggleMapFarmPanel('boost')}>
                        <span>{t('增益商店', 'Boost Shop')}</span>
                        <span className="testmap-card-toggle-right">
                          <span className={`testmap-card-pill ${activeBoostCount > 0 ? 'is-hot' : ''}`}>
                            {t('生效中', 'Active')} {activeBoostCount}
                          </span>
                          <span className="testmap-card-toggle-icon">{mapFarmPanelState.boost ? '-' : '+'}</span>
                        </span>
                      </button>
                      <div className={`testmap-card-body ${mapFarmPanelState.boost ? 'is-open' : ''}`}>
                        <div className={`testmap-boost-item ${growthBoostActive ? 'is-active' : ''}`}>
                          <div className="testmap-boost-item-head">
                            <strong>{t('生长加速', 'Growth Boost')}</strong>
                            <span>{t('成熟时间 -18%', 'Mature Time -18%')}</span>
                          </div>
                          <div className="testmap-boost-item-foot">
                            <span>
                              {growthBoostActive
                                ? `${t('生效中', 'Active')}: ${formatFarmCountdown(growthBoostRemainingMs)}`
                                : `${MAP_FARM_GROWTH_BOOST_COST} ${t('活跃点 / 20分钟', 'points / 20 min')}`}
                            </span>
                            <button type="button" className="testmap-boost-btn" disabled={mapFarmTxPending} onClick={buyGrowthBoost}>
                              {t('购买', 'Buy')}
                            </button>
                          </div>
                        </div>
                        <div className={`testmap-boost-item ${socialBoostActive ? 'is-active' : ''}`}>
                          <div className="testmap-boost-item-head">
                            <strong>{t('社交增幅', 'Social Boost')}</strong>
                            <span>{t('互动推进 x2', 'Interaction Progress x2')}</span>
                          </div>
                          <div className="testmap-boost-item-foot">
                            <span>
                              {socialBoostActive
                                ? `${t('生效中', 'Active')}: ${formatFarmCountdown(socialBoostRemainingMs)}`
                                : `${MAP_FARM_SOCIAL_BOOST_COST} ${t('活跃点 / 15分钟', 'points / 15 min')}`}
                            </span>
                            <button type="button" className="testmap-boost-btn" disabled={mapFarmTxPending} onClick={buySocialBoost}>
                              {t('购买', 'Buy')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className={`testmap-economy-card testmap-collapsible is-${economyHealthTone}`}>
                      <button type="button" className="testmap-card-toggle testmap-economy-head" onClick={() => toggleMapFarmPanel('economy')}>
                        <span>{t('经济健康度', 'Economy Health')}</span>
                        <span className="testmap-card-toggle-right">
                          <span className="testmap-card-pill">
                            R {sinkFaucetText}
                          </span>
                          <strong className={`is-${economyHealthTone}`}>{economyHealthLabel}</strong>
                          <span className="testmap-card-toggle-icon">{mapFarmPanelState.economy ? '-' : '+'}</span>
                        </span>
                      </button>
                      <div className={`testmap-card-body ${mapFarmPanelState.economy ? 'is-open' : ''}`}>
                        <div className="testmap-economy-grid">
                          <div className="testmap-economy-cell">
                            <span>{t('产出', 'Minted')}</span>
                            <strong>{faucetTotal}</strong>
                          </div>
                          <div className="testmap-economy-cell">
                            <span>{t('消耗', 'Burned')}</span>
                            <strong>{sinkTotal}</strong>
                          </div>
                          <div className="testmap-economy-cell">
                            <span>{t('耗产比', 'Sink/Faucet')}</span>
                            <strong>{sinkFaucetText}</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="testmap-shop-land-card testmap-collapsible">
                      <button type="button" className="testmap-card-toggle testmap-shop-title" onClick={() => toggleMapFarmPanel('shop')}>
                        <span>{t('商店', 'Shop')}</span>
                        <span className="testmap-card-toggle-right">
                          <span className="testmap-card-pill">
                            {t('种子', 'Seeds')} {seedInventoryTotal}
                          </span>
                          <span className="testmap-card-toggle-icon">{mapFarmPanelState.shop ? '-' : '+'}</span>
                        </span>
                      </button>
                      <div className={`testmap-card-body ${mapFarmPanelState.shop ? 'is-open' : ''}`}>
                        <div className="testmap-shop-land-card-inner">
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
                      </div>
                    </div>
                  </aside>
                </div>

                <button
                  type="button"
                  className={`testmap-drawer-fab ${mapFarmSidebarOpen ? 'is-open' : ''}`}
                  onClick={() => setMapFarmSidebarOpen((prev) => !prev)}
                >
                  {mapFarmSidebarOpen ? t('收起面板', 'Hide Panel') : t('任务/商店', 'Panels')}
                </button>

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

                <div className="testmap-farm-fx-layer" aria-hidden="true">
                  {mapFarmFx.map((fx, idx) => (
                    <div key={fx.id} className={`testmap-farm-fx testmap-farm-fx-${fx.kind}`} style={{ ['--fx-order' as string]: idx }}>
                      {fx.text}
                    </div>
                  ))}
                </div>

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
                {renderErr || (playModeEnabled
                  ? 'PLAY MODE // MOVE WITH WASD OR ARROWS // PRESS E TO INTERACT'
                  : 'SIMULATION MODE // CLICK AGENTS TO VIEW PROFILES')}
              </div>
            ) : null}
          </div>
        </div>

        {mapExpansionLandmarkOpen && selectedLandmark ? (
          <div
            className="village-landmark-modal-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={() => setMapExpansionLandmarkOpen(false)}
          >
            <div className="village-landmark-modal ga-card-surface" onClick={(e) => e.stopPropagation()}>
              <div className="village-landmark-modal-head">
                <div>
                  <div className="village-landmark-modal-name">{t(selectedLandmark.nameZh, selectedLandmark.nameEn)}</div>
                  <div className="village-landmark-modal-sub">
                    {`Lv.${selectedLandmark.level} · ${t('坐标', 'Coord')} (${selectedLandmark.tx}, ${selectedLandmark.ty})`}
                  </div>
                </div>
                <button type="button" className="village-landmark-modal-close" onClick={() => setMapExpansionLandmarkOpen(false)}>
                  {t('关闭', 'Close')}
                </button>
              </div>
              <p className="village-landmark-modal-lore">{selectedLandmarkLore}</p>
              {selectedLandmarkAction ? (
                <div className="village-landmark-modal-action">
                  <div className="village-landmark-modal-action-label">{selectedLandmarkAction.title}</div>
                  <div className="village-landmark-modal-action-desc">{selectedLandmarkAction.desc}</div>
                  <button
                    type="button"
                    className="village-landmark-modal-action-btn"
                    disabled={mapExpansionLandmarkPending}
                    onClick={() => void handleLandmarkAction()}
                  >
                    {mapExpansionLandmarkPending ? t('执行中...', 'Running...') : selectedLandmarkAction.title}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {!isTestMap && agentProfileOpen && selectedAgent && selectedAgentProfile ? (
          <div
            className="village-agent-profile-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={() => setAgentProfileOpen(false)}
          >
            <div className="village-agent-profile-card ga-card-surface" onClick={(e) => e.stopPropagation()}>
              <div className="village-agent-profile-head">
                <div>
                  <div className="village-agent-profile-name">{selectedAgentProfile.displayName}</div>
                  <div className="village-agent-profile-subtitle">{selectedAgentProfile.subtitle}</div>
                </div>
                <button type="button" className="village-agent-profile-close" onClick={() => setAgentProfileOpen(false)}>
                  {t('关闭', 'Close')}
                </button>
              </div>

              <div className="village-agent-profile-block">
                <div className="village-agent-profile-label">{t('性格画像', 'Personality')}</div>
                <p>{selectedAgentProfile.personality}</p>
              </div>

              <div className="village-agent-profile-grid">
                <div className="village-agent-profile-block">
                  <div className="village-agent-profile-label">{t('角色标签', 'Traits')}</div>
                  <ul>
                    {selectedAgentProfile.traits.map((item) => (
                      <li key={`trait-${selectedAgent.id}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="village-agent-profile-block">
                  <div className="village-agent-profile-label">{t('擅长方向', 'Specialties')}</div>
                  <ul>
                    {selectedAgentProfile.specialties.map((item) => (
                      <li key={`skill-${selectedAgent.id}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="village-agent-profile-block">
                <div className="village-agent-profile-label">{t('角色简介', 'Bio')}</div>
                <p>{selectedAgentProfile.bio}</p>
              </div>

              <div className="village-agent-profile-motto">{selectedAgentProfile.motto}</div>
            </div>
          </div>
        ) : null}

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

          .village-expansion-mission-card {
              grid-column: 1 / -1;
              border: 1px solid rgba(126, 164, 106, 0.85);
              border-radius: 6px;
              padding: 7px 8px;
              background: linear-gradient(180deg, rgba(248, 255, 228, 0.88), rgba(238, 249, 206, 0.88));
              color: #315233;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              line-height: 1.45;
          }

          .village-expansion-mission-title {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #446645;
              margin-bottom: 4px;
          }

          .village-expansion-mission-hint {
              color: #365637;
              font-size: 10px;
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
          .village-agent-log,
          .village-expansion-log {
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

          .village-expansion-log {
              grid-column: 1 / -1;
          }

          .village-expansion-log-list {
              display: flex;
              flex-direction: column;
              gap: 4px;
          }

          .village-expansion-log-item {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 8px;
              border: 1px solid rgba(126, 164, 106, 0.75);
              border-radius: 4px;
              background: rgba(240, 252, 211, 0.62);
              padding: 4px 6px;
              font-size: 10px;
              color: #345b37;
          }

          .village-expansion-log-item em {
              font-style: normal;
              opacity: 0.88;
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

          .village-canvas-wrap.is-expansion-pulse {
              animation: villageExpansionPulse 1.65s ease-out;
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

          .village-expansion-pulse-overlay {
              position: absolute;
              inset: 0;
              pointer-events: none;
              z-index: 4;
              background:
                radial-gradient(circle at 50% 45%, rgba(255, 232, 143, 0.18), rgba(255, 214, 107, 0.09) 32%, transparent 64%),
                repeating-linear-gradient(
                  90deg,
                  rgba(255, 255, 255, 0.08) 0px,
                  rgba(255, 255, 255, 0.08) 1px,
                  transparent 1px,
                  transparent 9px
                );
              animation: villageExpansionOverlayPulse 1.65s ease-out;
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

          .village-play-hud {
              position: absolute;
              left: 10px;
              top: 10px;
              z-index: 6;
              width: min(360px, calc(100% - 20px));
              border: 1px solid #6f975f;
              background: linear-gradient(180deg, rgba(246, 255, 223, 0.95), rgba(231, 247, 189, 0.92));
              color: #2e4b31;
              border-radius: 8px;
              padding: 7px 8px;
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.42), 0 5px 13px rgba(52, 80, 42, 0.16);
              pointer-events: none;
          }

          .village-play-hud-row {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 8px;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              margin-bottom: 2px;
          }

          .village-play-hud-row span {
              opacity: 0.8;
          }

          .village-play-hud-row strong {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #355537;
          }

          .village-play-hud-tip {
              margin-top: 4px;
              border-top: 1px dashed rgba(101, 146, 88, 0.5);
              padding-top: 5px;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              letter-spacing: .04em;
              color: #416742;
              line-height: 1.45;
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

          .village-top-chip.is-upgrading {
              border-color: rgba(236, 193, 70, 0.92);
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.45), 0 0 0 1px rgba(236, 193, 70, 0.34), 0 4px 12px rgba(59,87,50,0.14);
              animation: villageChipPulse 1.65s ease-out;
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

          @keyframes villageExpansionPulse {
              0% {
                  box-shadow: 0 0 0 0 rgba(245, 202, 88, 0.42), inset 0 1px 0 rgba(255,255,255,0.5);
              }
              100% {
                  box-shadow: 0 0 0 18px rgba(245, 202, 88, 0), inset 0 1px 0 rgba(255,255,255,0.5);
              }
          }

          @keyframes villageExpansionOverlayPulse {
              0% {
                  opacity: 0.88;
              }
              100% {
                  opacity: 0;
              }
          }

          @keyframes villageChipPulse {
              0% {
                  transform: translateY(-1px);
              }
              100% {
                  transform: translateY(0);
              }
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
              overflow: hidden;
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

          .testmap-event-banner {
              border: 1px solid rgba(255, 214, 112, 0.45);
              background: linear-gradient(180deg, rgba(52, 79, 38, 0.66), rgba(40, 61, 31, 0.72));
              border-radius: 8px;
              padding: 6px 8px;
              margin-bottom: 8px;
              display: flex;
              flex-direction: column;
              gap: 3px;
              color: #fff3cd;
          }

          .testmap-event-banner strong {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #ffe9a8;
              line-height: 1.45;
          }

          .testmap-event-banner span,
          .testmap-event-banner em {
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              color: #f8f2d3;
              font-style: normal;
          }

          .testmap-event-badge {
              display: inline-flex;
              align-self: flex-start;
              border: 1px solid rgba(255, 227, 156, 0.4);
              padding: 2px 6px;
              background: rgba(255, 215, 119, 0.16);
              font-size: 9px;
              color: #ffe9b3;
          }

          .testmap-farm-main {
              display: grid;
              grid-template-columns: minmax(0, 1fr);
              gap: 8px;
              align-items: stretch;
              min-height: min(52vh, 520px);
              position: relative;
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
              min-height: 0;
              max-height: 100%;
              overflow: auto;
              box-shadow: inset 0 0 0 1px rgba(255,255,255,0.4);
          }

          .testmap-shop-drawer {
              position: absolute;
              top: 0;
              right: 0;
              bottom: 0;
              width: min(300px, 46vw);
              z-index: 24;
              transform: translateX(calc(100% + 8px));
              opacity: 0;
              pointer-events: none;
              transition: transform .2s ease, opacity .2s ease;
              border-left: 1px solid rgba(126, 164, 106, 0.72);
              box-shadow: -6px 0 16px rgba(0,0,0,0.22), inset 0 0 0 1px rgba(255,255,255,0.4);
          }

          .testmap-shop-drawer.is-open {
              transform: translateX(0);
              opacity: 1;
              pointer-events: auto;
          }

          .testmap-drawer-fab {
              position: absolute;
              right: 12px;
              bottom: 10px;
              z-index: 26;
              border: 1px solid rgba(126, 164, 106, 0.78);
              background: linear-gradient(180deg, rgba(238, 250, 208, 0.96), rgba(211, 236, 159, 0.96));
              color: #28452c;
              padding: 6px 8px;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              line-height: 1.35;
              cursor: pointer;
              box-shadow: 0 4px 12px rgba(0,0,0,0.2);
          }

          .testmap-drawer-fab.is-open {
              border-color: rgba(226, 188, 94, 0.78);
              background: linear-gradient(180deg, rgba(255, 243, 205, 0.94), rgba(239, 226, 166, 0.88));
              color: #4a3a1e;
          }

          .testmap-drawer-fab:hover {
              transform: translateY(-1px);
              box-shadow: 0 6px 14px rgba(0,0,0,0.25);
          }

          .testmap-panel-toolbar {
              position: sticky;
              top: 0;
              z-index: 2;
              border: 1px solid rgba(111, 151, 95, 0.72);
              background: linear-gradient(180deg, rgba(247, 255, 223, 0.98), rgba(232, 245, 190, 0.98));
              padding: 5px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 6px;
          }

          .testmap-panel-toolbar-meta {
              font-family: 'Space Mono', monospace;
              font-size: 9px;
              color: #3f623d;
              white-space: nowrap;
          }

          .testmap-panel-toolbar-actions {
              display: inline-flex;
              align-items: center;
              gap: 4px;
              flex-wrap: wrap;
              justify-content: flex-end;
          }

          .testmap-panel-toolbar-btn {
              border: 1px solid #6f975f;
              background: linear-gradient(180deg, rgba(238, 250, 208, 0.95), rgba(211, 236, 159, 0.95));
              color: #28452c;
              padding: 3px 5px;
              font-family: 'Press Start 2P', cursive;
              font-size: 6px;
              cursor: pointer;
              line-height: 1.4;
          }

          .testmap-panel-toolbar-btn:hover {
              transform: translateY(-1px);
              box-shadow: 0 2px 7px rgba(66, 97, 57, 0.2);
          }

          .testmap-card-toggle {
              width: 100%;
              border: none;
              background: transparent;
              padding: 0;
              margin: 0;
              text-align: left;
              display: inline-flex;
              align-items: center;
              justify-content: space-between;
              gap: 6px;
              cursor: pointer;
              appearance: none;
          }

          .testmap-card-toggle-right {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              margin-left: auto;
              flex-wrap: wrap;
              justify-content: flex-end;
          }

          .testmap-card-toggle-icon {
              width: 14px;
              height: 14px;
              border: 1px solid rgba(114, 146, 95, 0.62);
              background: rgba(255, 255, 255, 0.62);
              color: #3b5c39;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              line-height: 1;
              flex-shrink: 0;
          }

          .testmap-card-toggle:hover .testmap-card-toggle-icon {
              border-color: rgba(226, 188, 94, 0.72);
              background: rgba(255, 245, 213, 0.82);
          }

          .testmap-card-pill {
              border: 1px solid rgba(110, 148, 93, 0.72);
              background: rgba(255,255,255,0.62);
              color: #3a5a3d;
              padding: 2px 4px;
              font-family: 'Space Mono', monospace;
              font-size: 8px;
              line-height: 1.25;
          }

          .testmap-card-pill.is-hot {
              border-color: rgba(226, 188, 94, 0.78);
              background: linear-gradient(180deg, rgba(255, 243, 205, 0.86), rgba(239, 226, 166, 0.74));
              color: #4a3a1e;
          }

          .testmap-card-body {
              display: none;
          }

          .testmap-card-body.is-open {
              display: flex;
              flex-direction: column;
              gap: 6px;
              animation: testmapCardOpen .16s ease-out;
          }

          @keyframes testmapCardOpen {
              from {
                  opacity: 0;
                  transform: translateY(-3px);
              }
              to {
                  opacity: 1;
                  transform: translateY(0);
              }
          }

          .testmap-quest-card {
              border: 1px solid rgba(92, 124, 74, 0.82);
              background: linear-gradient(180deg, rgba(255,255,255,0.66), rgba(234, 248, 203, 0.92));
              padding: 6px;
              display: flex;
              flex-direction: column;
              gap: 6px;
          }

          .testmap-quest-head {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 6px;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              color: #2f4f31;
              line-height: 1.4;
          }

          .testmap-quest-head strong {
              color: #5d7f3f;
              font-size: 8px;
          }

          .testmap-quest-list {
              display: flex;
              flex-direction: column;
              gap: 6px;
          }

          .testmap-quest-item {
              border: 1px solid rgba(111, 151, 95, 0.7);
              background: rgba(255,255,255,0.54);
              padding: 5px;
              display: flex;
              flex-direction: column;
              gap: 4px;
          }

          .testmap-quest-title {
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              color: #355537;
          }

          .testmap-quest-desc {
              font-family: 'Space Mono', monospace;
              font-size: 9px;
              color: #406043;
              line-height: 1.35;
          }

          .testmap-quest-progress {
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-family: 'Space Mono', monospace;
              font-size: 9px;
              color: #3a5a3d;
          }

          .testmap-quest-claim-btn {
              border: 1px solid #6f975f;
              background: linear-gradient(180deg, rgba(238, 250, 208, 0.95), rgba(211, 236, 159, 0.95));
              color: #28452c;
              width: 100%;
              padding: 4px 6px;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              cursor: pointer;
          }

          .testmap-quest-claim-btn:disabled {
              opacity: 0.6;
              cursor: not-allowed;
          }

          .testmap-achievement-card,
          .testmap-leaderboard-card,
          .testmap-pass-card,
          .testmap-boost-card,
          .testmap-economy-card {
              border: 1px solid rgba(92, 124, 74, 0.82);
              background: linear-gradient(180deg, rgba(255,255,255,0.66), rgba(234, 248, 203, 0.92));
              padding: 6px;
              display: flex;
              flex-direction: column;
              gap: 6px;
              transition: transform .16s ease, box-shadow .2s ease, border-color .2s ease;
          }

          .testmap-pass-card {
              position: relative;
              overflow: hidden;
          }

          .testmap-pass-card.is-claimable {
              border-color: rgba(226, 188, 94, 0.82);
              box-shadow: 0 0 0 1px rgba(255, 216, 116, 0.35), 0 4px 14px rgba(110, 88, 31, 0.24);
          }

          .testmap-pass-card.is-claimable::after {
              content: '';
              position: absolute;
              top: -140%;
              left: -30%;
              width: 38%;
              height: 300%;
              background: linear-gradient(180deg, transparent 0%, rgba(255, 244, 194, 0.42) 50%, transparent 100%);
              transform: rotate(12deg);
              animation: testmapPassSweep 3.8s linear infinite;
              pointer-events: none;
          }

          .testmap-achievement-head,
          .testmap-leaderboard-head {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 6px;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              color: #2f4f31;
              line-height: 1.4;
          }

          .testmap-leaderboard-head em {
              font-family: 'Space Mono', monospace;
              font-size: 9px;
              color: #4c6d47;
              font-style: normal;
          }

          .testmap-pass-head,
          .testmap-boost-head,
          .testmap-economy-head {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 6px;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              color: #2f4f31;
              line-height: 1.4;
          }

          .testmap-pass-head strong,
          .testmap-economy-head strong {
              color: #355537;
              font-size: 8px;
          }

          .testmap-pass-season-row {
              display: flex;
              justify-content: space-between;
              gap: 6px;
              font-family: 'Space Mono', monospace;
              font-size: 9px;
              color: #4a6a48;
              flex-wrap: wrap;
          }

          .testmap-pass-progress-track {
              height: 10px;
              border: 1px solid #7f9b6e;
              background: rgba(225, 241, 193, 0.95);
              overflow: hidden;
          }

          .testmap-pass-progress-fill {
              height: 100%;
              background: linear-gradient(90deg, #74bb52, #9ddf67);
              transition: width .2s ease;
              position: relative;
              overflow: hidden;
          }

          .testmap-pass-progress-fill::after {
              content: '';
              position: absolute;
              inset: 0;
              background: linear-gradient(110deg, transparent 0%, rgba(255,255,255,0.2) 35%, rgba(255,255,255,0.52) 50%, rgba(255,255,255,0.2) 65%, transparent 100%);
              transform: translateX(-100%);
              animation: testmapProgressShine 2.8s ease-in-out infinite;
          }

          .testmap-pass-progress-fill.is-max {
              background: linear-gradient(90deg, #d4a63e, #f4d477);
          }

          .testmap-pass-progress-fill.is-max::after {
              animation-duration: 1.8s;
          }

          .testmap-pass-progress-row {
              display: flex;
              justify-content: space-between;
              gap: 6px;
              font-family: 'Space Mono', monospace;
              font-size: 9px;
              color: #3f5f42;
              flex-wrap: wrap;
          }

          .testmap-pass-chip-row {
              display: flex;
              gap: 6px;
              flex-wrap: wrap;
          }

          .testmap-pass-chip {
              border: 1px solid rgba(110, 148, 93, 0.7);
              background: rgba(255,255,255,0.58);
              color: #365738;
              font-family: 'Space Mono', monospace;
              font-size: 9px;
              padding: 3px 5px;
          }

          .testmap-pass-chip.is-on {
              border-color: rgba(226, 188, 94, 0.75);
              background: linear-gradient(180deg, rgba(255, 243, 205, 0.78), rgba(239, 226, 166, 0.66));
              color: #4a3a1e;
          }

          .testmap-pass-btn-row {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 6px;
          }

          .testmap-pass-btn,
          .testmap-boost-btn {
              border: 1px solid #6f975f;
              background: linear-gradient(180deg, rgba(238, 250, 208, 0.95), rgba(211, 236, 159, 0.95));
              color: #28452c;
              width: 100%;
              padding: 4px 6px;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              cursor: pointer;
              transition: transform .12s ease, box-shadow .15s ease, filter .15s ease;
          }

          .testmap-pass-btn.is-pro {
              border-color: #c99c3f;
              background: linear-gradient(180deg, rgba(255, 236, 178, 0.96), rgba(239, 205, 113, 0.96));
              color: #574016;
          }

          .testmap-pass-btn:disabled,
          .testmap-boost-btn:disabled {
              opacity: 0.6;
              cursor: not-allowed;
          }

          .testmap-pass-btn:hover:not(:disabled),
          .testmap-boost-btn:hover:not(:disabled),
          .testmap-shop-land-btn:hover:not(:disabled),
          .testmap-shop-seed-buy-btn:hover:not(:disabled) {
              transform: translateY(-1px);
              box-shadow: 0 3px 8px rgba(66, 97, 57, 0.22);
              filter: saturate(1.05);
          }

          .testmap-boost-item {
              border: 1px solid rgba(111, 151, 95, 0.7);
              background: rgba(255,255,255,0.54);
              padding: 5px;
              display: flex;
              flex-direction: column;
              gap: 4px;
          }

          .testmap-boost-item.is-active {
              border-color: rgba(226, 188, 94, 0.75);
              background: linear-gradient(180deg, rgba(255, 244, 211, 0.82), rgba(238, 226, 174, 0.72));
              box-shadow: inset 0 0 0 1px rgba(255, 235, 170, 0.28), 0 0 0 1px rgba(255, 216, 116, 0.2);
              animation: testmapBoostPulse 2.2s ease-in-out infinite;
          }

          .testmap-boost-item-head {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 6px;
              flex-wrap: wrap;
              font-family: 'Space Mono', monospace;
          }

          .testmap-boost-item-head strong {
              font-size: 10px;
              color: #365638;
          }

          .testmap-boost-item-head span {
              font-size: 9px;
              color: #4b6b49;
          }

          .testmap-boost-item-foot {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 6px;
              font-family: 'Space Mono', monospace;
              font-size: 9px;
              color: #3a5a3d;
          }

          .testmap-economy-grid {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 6px;
          }

          .testmap-economy-cell {
              border: 1px solid rgba(111, 151, 95, 0.7);
              background: rgba(255,255,255,0.56);
              padding: 4px 5px;
              display: flex;
              flex-direction: column;
              gap: 2px;
          }

          .testmap-economy-cell span {
              font-family: 'Space Mono', monospace;
              font-size: 8px;
              color: #4b6a49;
          }

          .testmap-economy-cell strong {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #355537;
              line-height: 1.3;
          }

          .testmap-economy-head strong.is-healthy {
              color: #2f6a3c;
              text-shadow: 0 0 8px rgba(95, 193, 126, 0.24);
          }

          .testmap-economy-head strong.is-balanced {
              color: #6f6b2e;
              text-shadow: 0 0 8px rgba(214, 193, 98, 0.2);
          }

          .testmap-economy-head strong.is-inflating {
              color: #8c3a2f;
              text-shadow: 0 0 8px rgba(214, 114, 98, 0.2);
          }

          .testmap-economy-card.is-healthy {
              border-color: rgba(84, 155, 100, 0.82);
          }

          .testmap-economy-card.is-balanced {
              border-color: rgba(174, 154, 84, 0.82);
          }

          .testmap-economy-card.is-inflating {
              border-color: rgba(174, 102, 84, 0.84);
          }

          @keyframes testmapPassSweep {
              0% { left: -34%; opacity: 0; }
              8% { opacity: .8; }
              38% { opacity: .45; }
              56% { opacity: 0; }
              100% { left: 132%; opacity: 0; }
          }

          @keyframes testmapProgressShine {
              0% { transform: translateX(-100%); }
              45% { transform: translateX(120%); }
              100% { transform: translateX(120%); }
          }

          @keyframes testmapBoostPulse {
              0% { box-shadow: inset 0 0 0 1px rgba(255, 235, 170, 0.28), 0 0 0 1px rgba(255, 216, 116, 0.15); }
              50% { box-shadow: inset 0 0 0 1px rgba(255, 235, 170, 0.4), 0 0 12px rgba(255, 216, 116, 0.38); }
              100% { box-shadow: inset 0 0 0 1px rgba(255, 235, 170, 0.28), 0 0 0 1px rgba(255, 216, 116, 0.15); }
          }

          .testmap-achievement-list,
          .testmap-leaderboard-list {
              display: flex;
              flex-direction: column;
              gap: 6px;
          }

          .testmap-achievement-item {
              border: 1px solid rgba(111, 151, 95, 0.7);
              background: rgba(255,255,255,0.54);
              padding: 5px;
              display: flex;
              flex-direction: column;
              gap: 4px;
          }

          .testmap-achievement-title {
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              color: #355537;
          }

          .testmap-achievement-desc {
              font-family: 'Space Mono', monospace;
              font-size: 9px;
              color: #406043;
              line-height: 1.35;
          }

          .testmap-achievement-progress {
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-family: 'Space Mono', monospace;
              font-size: 9px;
              color: #3a5a3d;
          }

          .testmap-achievement-claim-btn {
              border: 1px solid #6f975f;
              background: linear-gradient(180deg, rgba(238, 250, 208, 0.95), rgba(211, 236, 159, 0.95));
              color: #28452c;
              width: 100%;
              padding: 4px 6px;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              cursor: pointer;
          }

          .testmap-achievement-claim-btn:disabled {
              opacity: 0.6;
              cursor: not-allowed;
          }

          .testmap-leaderboard-item {
              border: 1px solid rgba(111, 151, 95, 0.7);
              background: rgba(255,255,255,0.54);
              padding: 5px 6px;
              display: grid;
              grid-template-columns: 32px 1fr auto;
              gap: 6px;
              align-items: center;
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              color: #375539;
          }

          .testmap-leaderboard-item strong {
              color: #2e4b2f;
              font-size: 10px;
          }

          .testmap-leaderboard-item.is-player {
              border-color: rgba(226, 188, 94, 0.75);
              background: linear-gradient(180deg, rgba(255, 243, 205, 0.78), rgba(239, 226, 166, 0.66));
              color: #4a3a1e;
          }

          .testmap-shop-title {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #355537;
              text-shadow: 0 1px 0 rgba(255,255,255,0.35);
              letter-spacing: .04em;
              align-items: center;
          }

          .testmap-shop-land-card {
              border: 1px solid rgba(111, 151, 95, 0.78);
              background: linear-gradient(180deg, rgba(255,255,255,0.6), rgba(234, 248, 201, 0.9));
              padding: 6px;
              display: flex;
              flex-direction: column;
              gap: 6px;
          }

          .testmap-shop-land-card-inner {
              border: 1px solid rgba(111, 151, 95, 0.6);
              background: rgba(255,255,255,0.52);
              padding: 5px;
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

          .testmap-farm-fx-layer {
              position: absolute;
              right: 10px;
              top: 74px;
              z-index: 12;
              pointer-events: none;
              display: flex;
              flex-direction: column;
              gap: 4px;
              max-width: min(320px, 46vw);
          }

          .testmap-farm-fx {
              border: 1px solid rgba(255,255,255,0.22);
              background: rgba(28, 46, 22, 0.78);
              padding: 4px 6px;
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              color: #fff2c6;
              text-shadow: 0 1px 0 rgba(0,0,0,0.5);
              opacity: 0;
              transform: translateY(8px);
              animation: testmap-fx-float 2.5s ease forwards;
              animation-delay: calc(var(--fx-order, 0) * 60ms);
          }

          .testmap-farm-fx-event {
              border-color: rgba(255, 219, 133, 0.4);
              color: #ffedbc;
          }

          .testmap-farm-fx-quest {
              border-color: rgba(161, 255, 175, 0.45);
              color: #d7ffd1;
          }

          .testmap-farm-fx-harvest {
              border-color: rgba(255, 229, 139, 0.48);
              color: #fff2bf;
          }

          .testmap-farm-fx-plant {
              border-color: rgba(158, 223, 121, 0.45);
              color: #dcffd0;
          }

          .testmap-farm-fx-lottery {
              border-color: rgba(248, 178, 255, 0.46);
              color: #ffe1ff;
          }

          .testmap-farm-fx-buy {
              border-color: rgba(157, 208, 255, 0.44);
              color: #dff1ff;
          }

          @keyframes testmap-fx-float {
              0% {
                  opacity: 0;
                  transform: translateY(10px) scale(0.98);
              }
              12% {
                  opacity: 1;
                  transform: translateY(0) scale(1);
              }
              85% {
                  opacity: 1;
                  transform: translateY(-6px) scale(1);
              }
              100% {
                  opacity: 0;
                  transform: translateY(-14px) scale(1.01);
              }
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

          .village-landmark-modal-backdrop {
              position: fixed;
              inset: 0;
              z-index: 115;
              background: rgba(14, 22, 12, 0.5);
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 12px;
          }

          .village-landmark-modal {
              width: min(460px, calc(100vw - 24px));
              border: 2px solid #7ea46a;
              border-radius: 10px;
              background: linear-gradient(180deg, rgba(248, 255, 226, 0.98), rgba(228, 245, 192, 0.98));
              box-shadow: 0 12px 24px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.44);
              padding: 11px;
          }

          .village-landmark-modal-head {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              gap: 8px;
              margin-bottom: 8px;
          }

          .village-landmark-modal-name {
              font-family: 'Press Start 2P', cursive;
              font-size: 10px;
              color: #2e4b31;
              line-height: 1.45;
          }

          .village-landmark-modal-sub {
              margin-top: 4px;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              color: #456a49;
          }

          .village-landmark-modal-close {
              border: 1px solid #6f975f;
              background: linear-gradient(180deg, rgba(238, 250, 208, 0.95), rgba(211, 236, 159, 0.95));
              color: #28452c;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              padding: 6px 10px;
              cursor: pointer;
              flex-shrink: 0;
          }

          .village-landmark-modal-lore {
              margin: 0 0 8px;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              line-height: 1.6;
              color: #365839;
          }

          .village-landmark-modal-action {
              border: 1px solid rgba(126, 164, 106, 0.86);
              border-radius: 7px;
              background: rgba(255,255,255,0.56);
              padding: 8px 9px;
          }

          .village-landmark-modal-action-label {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #3f643f;
              margin-bottom: 6px;
          }

          .village-landmark-modal-action-desc {
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              line-height: 1.55;
              color: #375a3a;
              margin-bottom: 8px;
          }

          .village-landmark-modal-action-btn {
              border: 1px solid #6f975f;
              background: linear-gradient(180deg, rgba(238, 250, 208, 0.95), rgba(211, 236, 159, 0.95));
              color: #28452c;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              padding: 7px 10px;
              cursor: pointer;
              width: 100%;
          }

          .village-landmark-modal-action-btn:disabled {
              opacity: 0.72;
              cursor: not-allowed;
          }

          .village-agent-profile-backdrop {
              position: fixed;
              inset: 0;
              z-index: 120;
              background: rgba(15, 24, 11, 0.52);
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 12px;
          }

          .village-agent-profile-card {
              width: min(560px, calc(100vw - 24px));
              max-height: min(78vh, 720px);
              overflow: auto;
              border: 2px solid #7ea46a;
              border-radius: 10px;
              background: linear-gradient(180deg, rgba(248, 255, 226, 0.98), rgba(229, 245, 191, 0.98));
              box-shadow: 0 12px 26px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.44);
              padding: 12px;
          }

          .village-agent-profile-head {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              gap: 10px;
              margin-bottom: 10px;
          }

          .village-agent-profile-name {
              font-family: 'Press Start 2P', cursive;
              font-size: 11px;
              color: #2f4a31;
              line-height: 1.5;
          }

          .village-agent-profile-subtitle {
              margin-top: 4px;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              color: #436946;
          }

          .village-agent-profile-close {
              border: 1px solid #6f975f;
              background: linear-gradient(180deg, rgba(238, 250, 208, 0.95), rgba(211, 236, 159, 0.95));
              color: #28452c;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              padding: 6px 10px;
              cursor: pointer;
              flex-shrink: 0;
          }

          .village-agent-profile-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 8px;
          }

          .village-agent-profile-block {
              border: 1px solid rgba(126, 164, 106, 0.86);
              border-radius: 7px;
              background: rgba(255,255,255,0.56);
              padding: 8px 9px;
              margin-bottom: 8px;
              color: #2f4f34;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              line-height: 1.6;
          }

          .village-agent-profile-block p {
              margin: 0;
          }

          .village-agent-profile-label {
              margin-bottom: 5px;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #456745;
          }

          .village-agent-profile-block ul {
              margin: 0;
              padding-left: 17px;
          }

          .village-agent-profile-block li {
              margin-bottom: 2px;
          }

          .village-agent-profile-motto {
              border: 1px dashed rgba(101, 142, 82, 0.86);
              border-radius: 7px;
              padding: 8px 10px;
              color: #365a3a;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              background: rgba(244, 253, 216, 0.78);
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

              .village-play-hud {
                  width: min(300px, calc(100% - 20px));
              }

              .village-play-hud-row {
                  font-size: 10px;
              }

              .village-play-hud-row strong {
                  font-size: 7px;
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

              .testmap-shop-drawer {
                  width: min(320px, calc(100% - 12px));
              }

              .testmap-event-banner {
                  padding: 5px 6px;
              }

              .testmap-farm-fx-layer {
                  right: 8px;
                  top: 66px;
                  max-width: min(240px, 58vw);
              }

              .testmap-farm-fx {
                  font-size: 9px;
              }

              .village-agent-profile-grid {
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
                  min-height: min(58vh, 640px);
              }

              .testmap-shop-drawer {
                  width: min(320px, 38vw);
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
                  min-height: min(62vh, 760px);
              }

              .testmap-shop-drawer {
                  width: min(350px, 34vw);
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

              .testmap-farm-fx-layer {
                  display: none;
              }
          }
      `}</style>
    </div>
  );
}

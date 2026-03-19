import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { loadVillageTilemapWithOptions } from '../../core/assets/loadTilemap';
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
import { createConwayRuntimeService } from '../../core/conway/runtime';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

const PLAY_CAMERA_FOLLOW_TICK_MS = 50;
const AGENT_LOGIC_TICK_MS = 50;
const LOGIC_TICK_SCALE = AGENT_LOGIC_TICK_MS / 66;
const PLAYER_MOVE_SPEED = 0.13;
const PLAYER_SPRINT_MULTIPLIER = 2.3;
const PLAYER_POINTER_MOVE_SPEED = 0.15;
const NPC_BASE_MOVE_SPEED = 0.05;
const NFT_BASE_MOVE_SPEED = 0.03;
const WALK_FRAME_INTERVAL_MS = 100;
const PLAYER_COLLISION_CLEARANCE = 0.14;

type AgentMarker = {
  id: string;
  name: string;
  source: 'npc' | 'nft' | 'demo' | 'guest';
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
  sectorX?: number;
  sectorY?: number;
  miroFishProjection?: MiroFishAgentProjection;
  guestMeta?: GuestAgentMeta;
  mind: AgentMindState;
};

type GuestAgentMeta = {
  title: string;
  topic: string;
  intro: string;
  zoneLabel: string;
  accentColor: string;
};

type GuestAgentConfig = {
  id: string;
  name: string;
  title: string;
  topic: string;
  intro: string;
  zoneLabel: string;
  spriteKey: string;
  accentColor: string;
  enabled: boolean;
};

type MiroFishGraphNode = {
  uuid: string;
  name?: string | null;
  labels?: string[];
  summary?: string;
  attributes?: Record<string, unknown>;
  created_at?: string | null;
};

type MiroFishGraphEdge = {
  uuid: string;
  name?: string;
  fact?: string;
  fact_type?: string;
  source_node_uuid?: string;
  target_node_uuid?: string;
  source_node_name?: string;
  target_node_name?: string;
  attributes?: Record<string, unknown>;
  created_at?: string | null;
  valid_at?: string | null;
  invalid_at?: string | null;
  expired_at?: string | null;
  episodes?: string[];
};

type MiroFishGraphData = {
  graph_id: string;
  nodes: MiroFishGraphNode[];
  edges: MiroFishGraphEdge[];
  node_count: number;
  edge_count: number;
};

type MiroFishGraphConnection = {
  edgeId: string;
  edgeType: string;
  fact: string;
  direction: 'incoming' | 'outgoing';
  otherNodeUuid: string;
  otherAgentId: string;
  otherName: string;
};

type MiroFishGraphAgentMeta = {
  graphId: string;
  nodeUuid: string;
  labels: string[];
  summary: string;
  inDegree: number;
  outDegree: number;
  relationSamples: string[];
  connections: MiroFishGraphConnection[];
  createdAt?: string | null;
};

type MiroFishOntologySchemaField = {
  name?: string;
  type?: string;
  description?: string;
};

type MiroFishOntologySchemaConnection = {
  source?: string;
  target?: string;
};

type MiroFishOntologySchemaItem = {
  name?: string;
  description?: string;
  attributes?: MiroFishOntologySchemaField[];
  examples?: string[];
  source_targets?: MiroFishOntologySchemaConnection[];
};

type MiroFishProjectFile = {
  filename: string;
  size?: number;
};

type MiroFishProjectData = {
  project_id: string;
  name: string;
  status: string;
  files: MiroFishProjectFile[];
  total_text_length: number;
  ontology?: {
    entity_types?: MiroFishOntologySchemaItem[];
    edge_types?: MiroFishOntologySchemaItem[];
  } | null;
  analysis_summary?: string | null;
  graph_id?: string | null;
  graph_build_task_id?: string | null;
  simulation_requirement?: string | null;
  chunk_size?: number;
  chunk_overlap?: number;
  error?: string | null;
};

type MiroFishTaskData = {
  task_id: string;
  task_type: string;
  status: string;
  progress: number;
  message: string;
  created_at?: string | null;
  updated_at?: string | null;
  progress_detail?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
};

type MiroFishBuildLaunch = {
  project_id: string;
  task_id: string;
  message: string;
};

type MiroFishSimulationData = {
  simulation_id: string;
  project_id: string;
  graph_id: string;
  status: string;
  enable_twitter: boolean;
  enable_reddit: boolean;
  entities_count: number;
  profiles_count: number;
  entity_types: string[];
  config_generated: boolean;
  config_reasoning: string;
  current_round: number;
  twitter_status: string;
  reddit_status: string;
  created_at?: string | null;
  updated_at?: string | null;
  error?: string | null;
};

type MiroFishAsyncStatusData = {
  task_id?: string | null;
  simulation_id?: string | null;
  report_id?: string | null;
  status: string;
  progress: number;
  message: string;
  already_prepared?: boolean;
  already_generated?: boolean;
  already_completed?: boolean;
  expected_entities_count?: number | null;
  entity_types?: string[];
  prepare_info?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
};

type MiroFishRunStatusData = {
  simulation_id: string;
  runner_status: string;
  current_round: number;
  total_rounds: number;
  progress_percent: number;
  simulated_hours: number;
  total_simulation_hours: number;
  twitter_running: boolean;
  reddit_running: boolean;
  twitter_completed: boolean;
  reddit_completed: boolean;
  twitter_actions_count: number;
  reddit_actions_count: number;
  total_actions_count: number;
  started_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  process_pid?: number | null;
};

type MiroFishProfilesRealtimeData = {
  simulation_id: string;
  platform: 'reddit' | 'twitter';
  count: number;
  total_expected?: number | null;
  is_generating: boolean;
  file_exists: boolean;
  file_modified_at?: string | null;
  profiles: Array<Record<string, unknown>>;
};

type MiroFishInterviewData = {
  agent_id: number;
  prompt: string;
  timestamp?: string | null;
  platformSummary: string;
  responseText: string;
  result: Record<string, unknown> | null;
};

type MiroFishReportOutlineSection = {
  title?: string;
  content?: string;
};

type MiroFishReportData = {
  report_id: string;
  simulation_id: string;
  graph_id: string;
  simulation_requirement: string;
  status: string;
  outline?: {
    title?: string;
    summary?: string;
    sections?: MiroFishReportOutlineSection[];
  } | null;
  markdown_content: string;
  created_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
};

type MiroFishGraphProfileMatch = {
  index: number;
  profile: Record<string, unknown>;
};

type MiroFishAgentProjectionMotion = 'observe' | 'broadcast' | 'coordinate' | 'settle' | 'analyze';

type MiroFishAgentProjection = {
  profileIndex: number | null;
  platform: 'reddit' | 'twitter' | 'mixed';
  displayName: string;
  roleLabel: string;
  persona: string;
  badgeLabel: string;
  statusLabel: string;
  thoughtLabel: string;
  reportLabel: string;
  reportTitle: string;
  interviewLabel: string;
  motion: MiroFishAgentProjectionMotion;
  actionScore: number;
  anchorTx: number;
  anchorTy: number;
  targetAgentId?: string;
};

type MiroFishDemoPreset = {
  label: string;
  apiBase: string;
  projectId: string;
  graphId: string;
  taskId: string;
  simulationId: string;
  prepareTaskId: string;
  reportId: string;
  interviewPrompt: string;
  profilePlatform: 'reddit' | 'twitter';
  runPlatform: 'parallel' | 'reddit' | 'twitter';
  maxRounds: number;
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
  signer?: string;
  chainId?: number;
  payload?: string;
  intentHash?: string;
  signature?: string;
  previousReceiptHash?: string;
  receiptHash?: string;
};

type AgentActionLogVerifyState = 'verified' | 'missing' | 'invalid';

type ConwayRuntimeState = {
  sandboxId: string;
  status: string;
  publicUrl: string;
  lastRunStatus: string;
  lastRunAt: number;
  updatedAt: number;
};

type ConwayTownDirective = {
  id?: string;
  name?: string;
  thought?: string;
  status?: string;
  intent?: string;
};

type ConwayTownPlan = {
  broadcast?: string;
  agents: ConwayTownDirective[];
};

type AgentVerifyUiStatus = 'pending' | 'verified' | 'failed' | 'missing' | 'skipped';

type AgentAutoVerifyState = {
  targetAgentId: string;
  checking: boolean;
  checkedAt: number;
  identityStatus: AgentVerifyUiStatus;
  identityDetail: string;
  ownerAddress?: string;
  proofStatus: AgentVerifyUiStatus;
  proofDetail: string;
  proofTxHash?: string;
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

type MapAdventureQuestType = 'explore' | 'talk' | 'loot';
type MapAdventureQuestBiome = 'any' | 'forest' | 'desert' | 'snow';

type MapAdventureQuest = {
  id: string;
  type: MapAdventureQuestType;
  biome: MapAdventureQuestBiome;
  target: number;
  progress: number;
  rewardProgress: number;
  rewardPoints: number;
  startedAt: number;
};

type MapAdventureState = {
  activeQuest: MapAdventureQuest | null;
  completedCount: number;
  discoveredRegionKeys: string[];
};

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

type MapExpansionDecorationKind =
  | 'grass'
  | 'flower'
  | 'rock'
  | 'sapling'
  | 'lantern'
  | 'cabin'
  | 'workshop'
  | 'greenhouse';

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

type ActionBriefZoneKey = 'spot_plaza' | 'launch_sands' | 'research_arcade' | 'risk_glacier' | 'alpha_board';

type ActionBriefZoneFocus = {
  key: ActionBriefZoneKey;
  label: string;
  tx: number;
  ty: number;
  minTx: number;
  maxTx: number;
  minTy: number;
  maxTy: number;
  anchorKind: 'landmark' | 'district';
};

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
  ['早盘开了吗？', '开了，先看热度再行动。'],
  ['今天 Alpha 怎么样？', '有波动，但结构还不错。'],
  ['流动性够吗？', '先去金库补一轮。'],
  ['有新项目线索吗？', '有，但得先做验证。'],
  ['Gas 现在稳定吗？', '稳定，适合上链执行。'],
  ['这轮谁最强？', '看榜单和图谱扩散。'],
  ['地图越来越热了。', '市场角色都上线了。'],
  ['研究区今天开门吗？', '开着，报告也在刷新。'],
  ['今天冲积分吗？', '冲，争取解锁下一阶段。'],
  ['BAP-578 同步了吗？', '已同步，身份和行为都可验证。'],
] as const;

const AGENT_ROLE_LABEL: Record<AgentMindRole, string> = {
  strategist: 'Alpha 策略官',
  operator: '市场运营官',
  farmer: '流动性策展人',
  explorer: '赛道侦察员',
  guardian: '风控哨兵',
  social: '社区联动官',
};

const AGENT_INTENT_STATUS: Record<AgentMindIntent, string> = {
  patrol: '巡场中',
  observe: '观察盘口',
  chat: '同步情报',
  farm: '布置流动性',
  trade: '评估交易',
  rest: '短暂复盘',
};

const AGENT_TEMPERAMENT_LABEL: Record<AgentTemperament, string> = {
  calm: '冷静',
  bold: '果断',
  careful: '谨慎',
  curious: '好奇',
};

const AGENT_ROLE_THOUGHT_BANK: Record<AgentMindRole, Record<AgentMindIntent, string[]>> = {
  strategist: {
    patrol: ['巡查市场分区，准备下一轮动作。', '先看全局热度，再决定发力点。'],
    observe: ['正在复盘当前回合的收益结构。', '关注链上波动，等待更优时机。'],
    chat: ['跟队友同步策略，统一节奏。', '先把规则讲清楚，再开始执行。'],
    farm: ['先把流动性铺稳，别让资金链断档。', '保持部署节奏，后续扩张才健康。'],
    trade: ['对比交易路线和成本，寻找最优解。', '控制回撤，优先稳住奖池效率。'],
    rest: ['暂停几秒，重新校准仓位。', '回收注意力，准备下一次决策。'],
  },
  operator: {
    patrol: ['我先跑一圈，看看哪个分区需要补位。', '执行链路正常，继续推进。'],
    observe: ['在看交易确认，马上给反馈。', '流程都在线，暂时没有阻塞。'],
    chat: ['收到，我这边立刻协同。', '先沟通再执行，减少返工。'],
    farm: ['优先补流动性空位，别让仓位闲着。', '先铺基础仓，再切高收益目标。'],
    trade: ['清点代币和资源库存中。', '先核算预算，再提交交易。'],
    rest: ['我缓一下，马上继续。', '短暂停顿，防止误操作。'],
  },
  farmer: {
    patrol: ['巡查流动性池，优先处理成熟仓位。', '看一圈部署状态，准备下一轮。'],
    observe: ['盯着结算倒计时，不错过收益点。', '观察每个池子的节奏差异。'],
    chat: ['提醒一下：先把基础仓补满。', '经验是这样来的，别让资源闲置。'],
    farm: ['开始部署，冲积分和奖励。', '这轮重点拉满产出。'],
    trade: ['计算资源性价比，准备补货。', '对比不同部署路线的收益。'],
    rest: ['先歇一会儿，等下一批结算。', '短休后继续循环。'],
  },
  explorer: {
    patrol: ['地图边缘有新项目动静，我去看看。', '继续扩展视野，收集情报。'],
    observe: ['记录分区变化，更新路线。', '观察热点聚集和互动密度。'],
    chat: ['我把赛道情报同步给大家。', '附近角色状态已收集完成。'],
    farm: ['路过金库区，顺手检查部署效率。', '探索和布仓一起做，节奏更稳。'],
    trade: ['我在看哪条路径 Alpha 更高。', '先找高价值区域再做投入。'],
    rest: ['停一下，整理刚才采样的信息。', '休整后继续探路。'],
  },
  guardian: {
    patrol: ['风控巡逻中，异常会立刻上报。', '保持警戒，优先稳定运行。'],
    observe: ['正在审查可疑波动。', '先确认风险，再允许动作。'],
    chat: ['提醒队友：别忽略风控细节。', '风险提示已同步到小队。'],
    farm: ['金库区安全正常，可继续部署。', '保障资源流程稳定。'],
    trade: ['先看授权和余额，再交易。', '风控通过，允许继续执行。'],
    rest: ['短暂待机，安全监控持续。', '保持低频观察，不离线。'],
  },
  social: {
    patrol: ['边走边看，顺便连接大家。', '在找可协作的小队。'],
    observe: ['我在看谁需要帮助。', '观察互动氛围，准备发起话题。'],
    chat: ['来聊聊这轮怎么打更稳。', '同步一下：你们这边进度如何？'],
    farm: ['我来提醒：空仓位优先补齐。', '大家一起把节奏拉起来。'],
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
const MAP_CONWAY_RUNTIME_STORAGE_KEY = 'ga:map:conway-runtime-v1';
const MAP_GUEST_AGENT_STORAGE_KEY = 'ga:map:guest-agents-v1';
const MAP_AGENT_ACTION_LOG_MAX = 20;
const MAP_AGENT_RECEIPT_GENESIS_HASH = `0x${'0'.repeat(64)}`;
const MAP_AGENT_INTENT_PROTOCOL = 'BAP-578';
const DEFAULT_GUEST_AGENT_SPRITES = ['Maria', 'Mei', 'Tamara', 'Yuriko_Yamamoto', 'Jane'] as const;
const GUEST_AGENT_IMPORT_TEMPLATE = JSON.stringify(
  [
    {
      name: '小龙虾',
      title: 'BSC 链上巡游员',
      topic: '观察 BSC 热门代币、社区情绪和链上活跃地址',
      intro: '我会在地图上巡游，也会和附近 NPC 一起讨论今天的 BSC 热点。',
      zone: 'Research Arcade',
      spriteKey: 'Maria',
      accentColor: '#ff7c5c',
    },
  ],
  null,
  2,
);

const CONWAY_RUNTIME_DEFAULT: ConwayRuntimeState = {
  sandboxId: '',
  status: 'idle',
  publicUrl: '',
  lastRunStatus: '',
  lastRunAt: 0,
  updatedAt: 0,
};
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
const MAP_NFT_SPRITE_KEYS = [
  'Abigail', 'Adam', 'Arthur', 'Ayesha', 'Carlos', 'Carmen', 'Eddy', 'Francisco', 'George',
  'Hailey', 'Isabella', 'Jane', 'Jennifer', 'John', 'Klaus', 'Latoya', 'Maria', 'Mei', 'Rajiv',
  'Ryan', 'Sam', 'Tamara', 'Tom', 'Wolfgang', 'Yuriko_Yamamoto',
] as const;
const MAP_HUMAN_SPRITE_KEYS = [
  ...MAP_NFT_SPRITE_KEYS,
  'Swordsman_Lv1',
  'Swordsman_Lv2',
  'Swordsman_Lv3',
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
  { zh: '现货广场', en: 'Spot Plaza' },
  { zh: '启动街区', en: 'Launch District' },
  { zh: '研究长廊', en: 'Research Arcade' },
  { zh: '流动性环区', en: 'Liquidity Ring' },
  { zh: 'BNB 森畔', en: 'BNB Forest Edge' },
  { zh: 'Binance AI Town', en: 'Binance AI Town' },
] as const;
const MAP_EXPANSION_MISSIONS: MapExpansionMission[] = [
  {
    level: 1,
    titleZh: '市场预热',
    titleEn: 'Market Warmup',
    items: [
      { metric: 'plant', need: 3, labelZh: '部署资源', labelEn: 'Deploy' },
      { metric: 'social', need: 2, labelZh: '社交联动', labelEn: 'Social' },
    ],
  },
  {
    level: 2,
    titleZh: '流动性联动',
    titleEn: 'Liquidity Linkup',
    items: [
      { metric: 'plant', need: 8, labelZh: '部署资源', labelEn: 'Deploy' },
      { metric: 'buy', need: 2, labelZh: '市场买入', labelEn: 'Buys' },
    ],
  },
  {
    level: 3,
    titleZh: '信号验证',
    titleEn: 'Signal Verification',
    items: [
      { metric: 'harvest', need: 6, labelZh: '回收收益', labelEn: 'Harvest' },
      { metric: 'social', need: 6, labelZh: '研究互动', labelEn: 'Social' },
    ],
  },
  {
    level: 4,
    titleZh: '交易活化',
    titleEn: 'Trading Activation',
    items: [
      { metric: 'townPoints', need: 1200, labelZh: '市场热度', labelEn: 'Market Heat' },
      { metric: 'level', need: 2, labelZh: '金库等级', labelEn: 'Vault Lv' },
    ],
  },
  {
    level: 5,
    titleZh: '全域上线',
    titleEn: 'Full Network Launch',
    items: [
      { metric: 'plant', need: 20, labelZh: '部署资源', labelEn: 'Deploy' },
      { metric: 'harvest', need: 14, labelZh: '回收收益', labelEn: 'Harvest' },
      { metric: 'level', need: 3, labelZh: '金库等级', labelEn: 'Vault Lv' },
    ],
  },
] as const;
const MAP_EXPANSION_LANDMARKS: MapExpansionLandmarkMeta[] = [
  { kind: 'signboard', nameZh: 'Alpha 公告板', nameEn: 'Alpha Board' },
  { kind: 'windmill', nameZh: '启动门', nameEn: 'Launch Gate' },
  { kind: 'barn', nameZh: '流动性金库', nameEn: 'Liquidity Vault' },
  { kind: 'tower', nameZh: '信号塔', nameEn: 'Signal Tower' },
  { kind: 'market', nameZh: '做市角', nameEn: 'Maker Corner' },
  { kind: 'beacon', nameZh: 'BNB 信标', nameEn: 'BNB Beacon' },
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
const MAP_CUSTOM_PROP_SPRITES = {
  cottage: '/static/assets/village/custom/pixel_house_cottage.svg',
  barn: '/static/assets/village/custom/pixel_house_barn.svg',
  greenhouse: '/static/assets/village/custom/pixel_house_greenhouse.svg',
  tower: '/static/assets/village/custom/pixel_tower_watch.svg',
  well: '/static/assets/village/custom/pixel_well.svg',
} as const;

type MapCustomPropSpriteKey = keyof typeof MAP_CUSTOM_PROP_SPRITES;

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashTextToSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeMiroFishApiBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

function unwrapMiroFishPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const wrapper = payload as { data?: unknown };
  return Object.prototype.hasOwnProperty.call(wrapper, 'data') ? wrapper.data : payload;
}

function getMiroFishPayloadError(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const wrapper = payload as { error?: unknown; message?: unknown; success?: unknown };
  if (typeof wrapper.error === 'string' && wrapper.error.trim()) return wrapper.error.trim();
  if (wrapper.success === false && typeof wrapper.message === 'string' && wrapper.message.trim()) return wrapper.message.trim();
  return '';
}

function normalizeMiroFishProjectFiles(input: unknown): MiroFishProjectFile[] {
  if (!Array.isArray(input)) return [];
  const files: MiroFishProjectFile[] = [];
  input.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const file = item as { filename?: unknown; original_filename?: unknown; size?: unknown };
    const filename = typeof file.filename === 'string'
      ? file.filename
      : typeof file.original_filename === 'string'
        ? file.original_filename
        : '';
    if (!filename) return;
    files.push({
      filename,
      size: Number.isFinite(Number(file.size)) ? Number(file.size) : undefined,
    });
  });
  return files;
}

function parseMiroFishGraphData(payload: unknown): MiroFishGraphData | null {
  const candidate = unwrapMiroFishPayload(payload);
  if (!candidate || typeof candidate !== 'object') return null;
  const data = candidate as {
    graph_id?: unknown;
    nodes?: unknown;
    edges?: unknown;
    node_count?: unknown;
    edge_count?: unknown;
  };
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;
  return {
    graph_id: typeof data.graph_id === 'string' ? data.graph_id : '',
    nodes: data.nodes as MiroFishGraphNode[],
    edges: data.edges as MiroFishGraphEdge[],
    node_count: Number.isFinite(Number(data.node_count)) ? Number(data.node_count) : data.nodes.length,
    edge_count: Number.isFinite(Number(data.edge_count)) ? Number(data.edge_count) : data.edges.length,
  };
}

function parseMiroFishProjectData(payload: unknown): MiroFishProjectData | null {
  const candidate = unwrapMiroFishPayload(payload);
  if (!candidate || typeof candidate !== 'object') return null;
  const data = candidate as {
    project_id?: unknown;
    project_name?: unknown;
    name?: unknown;
    status?: unknown;
    files?: unknown;
    total_text_length?: unknown;
    ontology?: unknown;
    analysis_summary?: unknown;
    graph_id?: unknown;
    graph_build_task_id?: unknown;
    simulation_requirement?: unknown;
    chunk_size?: unknown;
    chunk_overlap?: unknown;
    error?: unknown;
  };
  if (typeof data.project_id !== 'string' || !data.project_id.trim()) return null;
  const ontology = data.ontology && typeof data.ontology === 'object'
    ? data.ontology as MiroFishProjectData['ontology']
    : null;
  return {
    project_id: data.project_id.trim(),
    name: typeof data.name === 'string'
      ? data.name
      : typeof data.project_name === 'string'
        ? data.project_name
        : '',
    status: typeof data.status === 'string' ? data.status : '',
    files: normalizeMiroFishProjectFiles(data.files),
    total_text_length: Number.isFinite(Number(data.total_text_length)) ? Number(data.total_text_length) : 0,
    ontology,
    analysis_summary: typeof data.analysis_summary === 'string' ? data.analysis_summary : null,
    graph_id: typeof data.graph_id === 'string' ? data.graph_id : null,
    graph_build_task_id: typeof data.graph_build_task_id === 'string' ? data.graph_build_task_id : null,
    simulation_requirement: typeof data.simulation_requirement === 'string' ? data.simulation_requirement : null,
    chunk_size: Number.isFinite(Number(data.chunk_size)) ? Number(data.chunk_size) : undefined,
    chunk_overlap: Number.isFinite(Number(data.chunk_overlap)) ? Number(data.chunk_overlap) : undefined,
    error: typeof data.error === 'string' ? data.error : null,
  };
}

function parseMiroFishTaskData(payload: unknown): MiroFishTaskData | null {
  const candidate = unwrapMiroFishPayload(payload);
  if (!candidate || typeof candidate !== 'object') return null;
  const data = candidate as {
    task_id?: unknown;
    task_type?: unknown;
    status?: unknown;
    progress?: unknown;
    message?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
    progress_detail?: unknown;
    result?: unknown;
    error?: unknown;
    metadata?: unknown;
  };
  if (typeof data.task_id !== 'string' || !data.task_id.trim()) return null;
  return {
    task_id: data.task_id.trim(),
    task_type: typeof data.task_type === 'string' ? data.task_type : '',
    status: typeof data.status === 'string' ? data.status : 'pending',
    progress: Number.isFinite(Number(data.progress)) ? Number(data.progress) : 0,
    message: typeof data.message === 'string' ? data.message : '',
    created_at: typeof data.created_at === 'string' ? data.created_at : null,
    updated_at: typeof data.updated_at === 'string' ? data.updated_at : null,
    progress_detail: data.progress_detail && typeof data.progress_detail === 'object'
      ? data.progress_detail as Record<string, unknown>
      : {},
    result: data.result && typeof data.result === 'object'
      ? data.result as Record<string, unknown>
      : null,
    error: typeof data.error === 'string' ? data.error : null,
    metadata: data.metadata && typeof data.metadata === 'object'
      ? data.metadata as Record<string, unknown>
      : {},
  };
}

function parseMiroFishBuildLaunch(payload: unknown): MiroFishBuildLaunch | null {
  const candidate = unwrapMiroFishPayload(payload);
  if (!candidate || typeof candidate !== 'object') return null;
  const data = candidate as {
    project_id?: unknown;
    task_id?: unknown;
    message?: unknown;
  };
  if (typeof data.project_id !== 'string' || typeof data.task_id !== 'string') return null;
  return {
    project_id: data.project_id,
    task_id: data.task_id,
    message: typeof data.message === 'string' ? data.message : '',
  };
}

function parseMiroFishSimulationData(payload: unknown): MiroFishSimulationData | null {
  const candidate = unwrapMiroFishPayload(payload);
  if (!candidate || typeof candidate !== 'object') return null;
  const data = candidate as Record<string, unknown>;
  const simulationId = typeof data.simulation_id === 'string' ? data.simulation_id.trim() : '';
  if (!simulationId) return null;
  const entityTypes = Array.isArray(data.entity_types)
    ? data.entity_types.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  return {
    simulation_id: simulationId,
    project_id: typeof data.project_id === 'string' ? data.project_id : '',
    graph_id: typeof data.graph_id === 'string' ? data.graph_id : '',
    status: typeof data.status === 'string' ? data.status : 'created',
    enable_twitter: data.enable_twitter !== false,
    enable_reddit: data.enable_reddit !== false,
    entities_count: Number.isFinite(Number(data.entities_count)) ? Number(data.entities_count) : 0,
    profiles_count: Number.isFinite(Number(data.profiles_count)) ? Number(data.profiles_count) : 0,
    entity_types: entityTypes,
    config_generated: Boolean(data.config_generated),
    config_reasoning: typeof data.config_reasoning === 'string' ? data.config_reasoning : '',
    current_round: Number.isFinite(Number(data.current_round)) ? Number(data.current_round) : 0,
    twitter_status: typeof data.twitter_status === 'string' ? data.twitter_status : '',
    reddit_status: typeof data.reddit_status === 'string' ? data.reddit_status : '',
    created_at: typeof data.created_at === 'string' ? data.created_at : null,
    updated_at: typeof data.updated_at === 'string' ? data.updated_at : null,
    error: typeof data.error === 'string' ? data.error : null,
  };
}

function parseMiroFishAsyncStatusData(payload: unknown): MiroFishAsyncStatusData | null {
  const candidate = unwrapMiroFishPayload(payload);
  if (!candidate || typeof candidate !== 'object') return null;
  const data = candidate as Record<string, unknown>;
  const status = typeof data.status === 'string' ? data.status : '';
  const taskId = typeof data.task_id === 'string' ? data.task_id : null;
  const simulationId = typeof data.simulation_id === 'string' ? data.simulation_id : null;
  const reportId = typeof data.report_id === 'string' ? data.report_id : null;
  if (!status && !taskId && !simulationId && !reportId) return null;
  return {
    task_id: taskId,
    simulation_id: simulationId,
    report_id: reportId,
    status: status || 'pending',
    progress: Number.isFinite(Number(data.progress)) ? Number(data.progress) : 0,
    message: typeof data.message === 'string' ? data.message : '',
    already_prepared: data.already_prepared === true,
    already_generated: data.already_generated === true,
    already_completed: data.already_completed === true,
    expected_entities_count: Number.isFinite(Number(data.expected_entities_count)) ? Number(data.expected_entities_count) : null,
    entity_types: Array.isArray(data.entity_types)
      ? data.entity_types.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    prepare_info: data.prepare_info && typeof data.prepare_info === 'object'
      ? data.prepare_info as Record<string, unknown>
      : null,
    result: data.result && typeof data.result === 'object'
      ? data.result as Record<string, unknown>
      : null,
    error: typeof data.error === 'string' ? data.error : null,
  };
}

function parseMiroFishRunStatusData(payload: unknown): MiroFishRunStatusData | null {
  const candidate = unwrapMiroFishPayload(payload);
  if (!candidate || typeof candidate !== 'object') return null;
  const data = candidate as Record<string, unknown>;
  const simulationId = typeof data.simulation_id === 'string' ? data.simulation_id.trim() : '';
  if (!simulationId) return null;
  return {
    simulation_id: simulationId,
    runner_status: typeof data.runner_status === 'string' ? data.runner_status : 'idle',
    current_round: Number.isFinite(Number(data.current_round)) ? Number(data.current_round) : 0,
    total_rounds: Number.isFinite(Number(data.total_rounds)) ? Number(data.total_rounds) : 0,
    progress_percent: Number.isFinite(Number(data.progress_percent)) ? Number(data.progress_percent) : 0,
    simulated_hours: Number.isFinite(Number(data.simulated_hours)) ? Number(data.simulated_hours) : 0,
    total_simulation_hours: Number.isFinite(Number(data.total_simulation_hours)) ? Number(data.total_simulation_hours) : 0,
    twitter_running: Boolean(data.twitter_running),
    reddit_running: Boolean(data.reddit_running),
    twitter_completed: Boolean(data.twitter_completed),
    reddit_completed: Boolean(data.reddit_completed),
    twitter_actions_count: Number.isFinite(Number(data.twitter_actions_count)) ? Number(data.twitter_actions_count) : 0,
    reddit_actions_count: Number.isFinite(Number(data.reddit_actions_count)) ? Number(data.reddit_actions_count) : 0,
    total_actions_count: Number.isFinite(Number(data.total_actions_count)) ? Number(data.total_actions_count) : 0,
    started_at: typeof data.started_at === 'string' ? data.started_at : null,
    updated_at: typeof data.updated_at === 'string' ? data.updated_at : null,
    completed_at: typeof data.completed_at === 'string' ? data.completed_at : null,
    error: typeof data.error === 'string' ? data.error : null,
    process_pid: Number.isFinite(Number(data.process_pid)) ? Number(data.process_pid) : null,
  };
}

function parseMiroFishProfilesRealtimeData(
  payload: unknown,
  fallback: { simulationId?: string; platform?: 'reddit' | 'twitter' } = {},
): MiroFishProfilesRealtimeData | null {
  const candidate = unwrapMiroFishPayload(payload);
  if (!candidate || typeof candidate !== 'object') return null;
  const data = candidate as Record<string, unknown>;
  if (!Array.isArray(data.profiles)) return null;
  const platform = data.platform === 'twitter' ? 'twitter' : fallback.platform === 'twitter' ? 'twitter' : 'reddit';
  return {
    simulation_id: typeof data.simulation_id === 'string' ? data.simulation_id : (fallback.simulationId ?? ''),
    platform,
    count: Number.isFinite(Number(data.count)) ? Number(data.count) : data.profiles.length,
    total_expected: Number.isFinite(Number(data.total_expected)) ? Number(data.total_expected) : null,
    is_generating: Boolean(data.is_generating),
    file_exists: data.file_exists !== false,
    file_modified_at: typeof data.file_modified_at === 'string' ? data.file_modified_at : null,
    profiles: data.profiles.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'),
  };
}

function parseMiroFishInterviewData(payload: unknown): MiroFishInterviewData | null {
  const candidate = unwrapMiroFishPayload(payload);
  if (!candidate || typeof candidate !== 'object') return null;
  const data = candidate as Record<string, unknown>;
  if (!Number.isFinite(Number(data.agent_id)) || typeof data.prompt !== 'string') return null;
  const result = data.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : null;
  let responseText = '';
  let platformSummary = '';
  if (result) {
    if (typeof result.response === 'string') {
      responseText = result.response;
      platformSummary = typeof result.platform === 'string' ? result.platform : '';
    } else if (result.platforms && typeof result.platforms === 'object') {
      const blocks = Object.entries(result.platforms as Record<string, unknown>)
        .map(([platform, entry]) => {
          if (!entry || typeof entry !== 'object') return '';
          const response = typeof (entry as Record<string, unknown>).response === 'string'
            ? (entry as Record<string, unknown>).response as string
            : '';
          return response ? `[${platform}] ${response}` : '';
        })
        .filter(Boolean);
      responseText = blocks.join('\n\n');
      platformSummary = Object.keys(result.platforms as Record<string, unknown>).join(', ');
    }
  }
  return {
    agent_id: Number(data.agent_id),
    prompt: data.prompt,
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : null,
    platformSummary,
    responseText,
    result,
  };
}

function parseMiroFishReportData(payload: unknown): MiroFishReportData | null {
  const candidate = unwrapMiroFishPayload(payload);
  if (!candidate || typeof candidate !== 'object') return null;
  const data = candidate as Record<string, unknown>;
  const reportId = typeof data.report_id === 'string' ? data.report_id.trim() : '';
  if (!reportId) return null;
  const outline = data.outline && typeof data.outline === 'object'
    ? data.outline as {
      title?: string;
      summary?: string;
      sections?: MiroFishReportOutlineSection[];
    }
    : null;
  return {
    report_id: reportId,
    simulation_id: typeof data.simulation_id === 'string' ? data.simulation_id : '',
    graph_id: typeof data.graph_id === 'string' ? data.graph_id : '',
    simulation_requirement: typeof data.simulation_requirement === 'string' ? data.simulation_requirement : '',
    status: typeof data.status === 'string' ? data.status : 'pending',
    outline,
    markdown_content: typeof data.markdown_content === 'string' ? data.markdown_content : '',
    created_at: typeof data.created_at === 'string' ? data.created_at : null,
    completed_at: typeof data.completed_at === 'string' ? data.completed_at : null,
    error: typeof data.error === 'string' ? data.error : null,
  };
}

function normalizeMiroFishIdentityText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function extractMiroFishProfileNames(profile: Record<string, unknown>): string[] {
  return [
    profile.name,
    profile.realname,
    profile.username,
    profile.user_name,
  ]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function truncateMiroFishText(input: string, max = 88): string {
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function readMiroFishProfileText(profile: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = profile[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getMiroFishProfilePersona(profile: Record<string, unknown>): string {
  return readMiroFishProfileText(profile, ['persona', 'user_char', 'description', 'bio', 'profession']);
}

function getMiroFishProfileRole(profile: Record<string, unknown>): string {
  return readMiroFishProfileText(profile, ['profession', 'role', 'occupation', 'title']) || 'Entity';
}

function getMiroFishProfileActivityScore(profile: Record<string, unknown>): number {
  const numericKeys = ['karma', 'followers_count', 'friends_count', 'statuses_count', 'tweet_count'];
  return numericKeys.reduce((sum, key) => {
    const raw = Number(profile[key]);
    return sum + (Number.isFinite(raw) ? raw : 0);
  }, 0);
}

function getMiroFishReportLens(report: MiroFishReportData | null, name: string): { title: string; snippet: string } {
  if (!report) return { title: '', snippet: '' };
  const keyword = name.trim().toLowerCase();
  const sections = report.outline?.sections ?? [];
  const matched = sections.find((section) => {
    const haystack = `${section.title || ''} ${section.content || ''}`.toLowerCase();
    return keyword && haystack.includes(keyword);
  });
  const title = matched?.title || report.outline?.title || '';
  const snippetSource = matched?.content || report.outline?.summary || report.markdown_content || '';
  return {
    title,
    snippet: truncateMiroFishText(snippetSource, 140),
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function slugifyGuestAgentId(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return normalized || fallback;
}

function normalizeGuestAccentColor(value: unknown, fallback = '#ff7c5c'): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^#([0-9a-fA-F]{6})$/.test(trimmed) ? trimmed : fallback;
}

function normalizeGuestAgentConfig(raw: unknown, idx: number): GuestAgentConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  if (!name) return null;
  const idSeed = typeof item.id === 'string' ? item.id : name;
  const spriteSeed = typeof item.spriteKey === 'string' ? item.spriteKey : '';
  const spriteKey = MAP_HUMAN_SPRITE_KEYS.includes(spriteSeed as typeof MAP_HUMAN_SPRITE_KEYS[number])
    ? spriteSeed
    : DEFAULT_GUEST_AGENT_SPRITES[idx % DEFAULT_GUEST_AGENT_SPRITES.length];
  return {
    id: `guest_${slugifyGuestAgentId(idSeed, `entry_${idx + 1}`)}`,
    name,
    title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'BSC 嘉宾角色',
    topic: typeof item.topic === 'string' && item.topic.trim() ? item.topic.trim() : '围绕 BSC 市场、链上节奏和热点项目展开讨论',
    intro: typeof item.intro === 'string' && item.intro.trim() ? item.intro.trim() : `${name} 已进入小镇，准备和附近 NPC 同步 BSC 线索。`,
    zoneLabel: typeof item.zone === 'string' && item.zone.trim() ? item.zone.trim() : 'Research Arcade',
    spriteKey,
    accentColor: normalizeGuestAccentColor(item.accentColor),
    enabled: item.enabled !== false,
  };
}

function loadGuestAgentConfigs(): GuestAgentConfig[] {
  const loaded = loadFromStorage<unknown[]>(MAP_GUEST_AGENT_STORAGE_KEY);
  if (!Array.isArray(loaded)) return [];
  return loaded
    .map((item, idx) => normalizeGuestAgentConfig(item, idx))
    .filter((item): item is GuestAgentConfig => Boolean(item));
}

function pickByRandom<T>(list: readonly T[], rnd: () => number): T {
  return list[Math.floor(rnd() * list.length) % list.length];
}

function getRoleByAgentId(agentId: string, source: AgentMarker['source'], seedRnd: () => number): AgentMindRole {
  if (agentId === 'npc_cz') return 'strategist';
  if (agentId === 'npc_heyi') return 'operator';
  if (source === 'guest') return 'social';
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

function defaultAgentSector(tokenId: number): { x: number; y: number } {
  // Keep a batch of agents in the origin sector so players always see active movement.
  if (tokenId < 120) {
    return { x: 0, y: 0 };
  }
  const rnd = createSeededRandom((tokenId + 1) * 7919);
  const radius = 16;
  return {
    x: Math.floor(rnd() * (radius * 2 + 1)) - radius,
    y: Math.floor(rnd() * (radius * 2 + 1)) - radius,
  };
}

function isOverClusteredSavedNftLayout(
  layout: Record<string, { tx: number; ty: number }>,
  mapWidth: number,
  mapHeight: number,
): boolean {
  const values = Object.values(layout).filter((item) => (
    item
    && Number.isFinite(item.tx)
    && Number.isFinite(item.ty)
  ));
  if (values.length < 120) return false;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const item of values) {
    minX = Math.min(minX, item.tx);
    maxX = Math.max(maxX, item.tx);
    minY = Math.min(minY, item.ty);
    maxY = Math.max(maxY, item.ty);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const minSpanX = Math.max(12, mapWidth * 0.28);
  const minSpanY = Math.max(10, mapHeight * 0.28);
  return spanX < minSpanX && spanY < minSpanY;
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

function carveWalkRect(blocked: Uint8Array, width: number, height: number, x0: number, y0: number, w: number, h: number) {
  const sx = clamp(Math.floor(x0), 1, width - 2);
  const sy = clamp(Math.floor(y0), 1, height - 2);
  const ex = clamp(Math.floor(x0 + w - 1), 1, width - 2);
  const ey = clamp(Math.floor(y0 + h - 1), 1, height - 2);
  for (let ty = sy; ty <= ey; ty++) {
    for (let tx = sx; tx <= ex; tx++) {
      blocked[(ty * width) + tx] = 0;
    }
  }
}

function carveWalkLine(
  blocked: Uint8Array,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lineWidth: number,
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  const half = Math.max(1, Math.floor(lineWidth / 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    carveWalkRect(blocked, width, height, x - half, y - half, half * 2 + 1, half * 2 + 1);
  }
}

function buildInfiniteRegionCollisionGrid(
  map: TiledMap,
  sectorX: number,
  sectorY: number,
  biome: InfiniteBiome,
): MapCollisionGrid {
  const width = map.width;
  const height = map.height;
  const blocked = new Uint8Array(width * height);
  blocked.fill(1);
  const biomeSalt = biome === 'forest' ? 11 : biome === 'desert' ? 29 : 47;
  const seed = (((sectorX + 4096) * 73856093) ^ ((sectorY + 4096) * 19349663) ^ biomeSalt) >>> 0;
  const rnd = createSeededRandom(seed);

  const cx = clamp(Math.floor(width * (0.34 + rnd() * 0.32)), 8, width - 9);
  const cy = clamp(Math.floor(height * (0.34 + rnd() * 0.34)), 8, height - 9);
  const roadW = biome === 'desert' ? 7 : 6;

  // Core roads to all four map edges.
  carveWalkLine(blocked, width, height, 1, cy, width - 2, cy, roadW);
  carveWalkLine(blocked, width, height, cx, 1, cx, height - 2, roadW);

  const variant = Math.floor(rnd() * 4);
  if (variant === 0) {
    const extraX = clamp(Math.floor(width * (0.18 + rnd() * 0.64)), 6, width - 7);
    const extraY = clamp(Math.floor(height * (0.18 + rnd() * 0.64)), 6, height - 7);
    carveWalkLine(blocked, width, height, extraX, 2, extraX, height - 3, roadW - 1);
    carveWalkLine(blocked, width, height, 2, extraY, width - 3, extraY, roadW - 1);
  } else if (variant === 1) {
    const rx0 = clamp(cx - (16 + Math.floor(rnd() * 9)), 3, width - 24);
    const ry0 = clamp(cy - (12 + Math.floor(rnd() * 8)), 3, height - 20);
    const rw = clamp(26 + Math.floor(rnd() * 20), 20, width - 6);
    const rh = clamp(18 + Math.floor(rnd() * 14), 14, height - 6);
    carveWalkRect(blocked, width, height, rx0, ry0, rw, roadW - 1);
    carveWalkRect(blocked, width, height, rx0, ry0 + rh - (roadW - 1), rw, roadW - 1);
    carveWalkRect(blocked, width, height, rx0, ry0, roadW - 1, rh);
    carveWalkRect(blocked, width, height, rx0 + rw - (roadW - 1), ry0, roadW - 1, rh);
  } else if (variant === 2) {
    let sy = clamp(cy - (14 + Math.floor(rnd() * 10)), 4, height - 5);
    for (let x = 2; x <= width - 3; x++) {
      if (x % 5 === 0) sy += Math.floor(rnd() * 3) - 1;
      sy = clamp(sy, 3, height - 4);
      carveWalkRect(blocked, width, height, x - 1, sy - 1, roadW, roadW - 2);
    }
  } else {
    const branches = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < branches; i++) {
      const ax = clamp(Math.floor(width * (0.08 + rnd() * 0.84)), 3, width - 4);
      const ay = clamp(Math.floor(height * (0.08 + rnd() * 0.84)), 3, height - 4);
      carveWalkLine(blocked, width, height, cx, cy, ax, ay, roadW - 2);
    }
  }

  // Ensure edge gates always exist for seamless region transitions.
  carveWalkRect(blocked, width, height, 1, cy - 4, 4, 9);
  carveWalkRect(blocked, width, height, width - 5, cy - 4, 4, 9);
  carveWalkRect(blocked, width, height, cx - 4, 1, 9, 4);
  carveWalkRect(blocked, width, height, cx - 4, height - 5, 9, 4);

  // Add random plazas to break uniformity.
  const plazas = 7 + Math.floor(rnd() * 8);
  for (let i = 0; i < plazas; i++) {
    const px = clamp(Math.floor(width * (0.08 + rnd() * 0.84)), 3, width - 8);
    const py = clamp(Math.floor(height * (0.08 + rnd() * 0.84)), 3, height - 8);
    const pw = 4 + Math.floor(rnd() * 8);
    const ph = 4 + Math.floor(rnd() * 8);
    carveWalkRect(blocked, width, height, px, py, pw, ph);
  }

  // Spawn-safe center area.
  carveWalkRect(blocked, width, height, cx - 4, cy - 4, 9, 9);

  return { width, height, blocked };
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

function scoreSpawnOpenSpace(grid: MapCollisionGrid, tx: number, ty: number): number {
  const ringOffsets = [
    [0.55, 0, 1.8], [-0.55, 0, 1.8], [0, 0.55, 1.8], [0, -0.55, 1.8],
    [1.1, 0, 1.2], [-1.1, 0, 1.2], [0, 1.1, 1.2], [0, -1.1, 1.2],
    [0.8, 0.8, 1], [-0.8, 0.8, 1], [0.8, -0.8, 1], [-0.8, -0.8, 1],
    [1.6, 0, 0.8], [-1.6, 0, 0.8], [0, 1.6, 0.8], [0, -1.6, 0.8],
  ] as const;
  let score = 0;
  for (const [ox, oy, weight] of ringOffsets) {
    if (isPositionWalkable(grid, tx + ox, ty + oy, PLAYER_COLLISION_CLEARANCE)) {
      score += weight;
    } else {
      score -= weight * 0.9;
    }
  }
  return score;
}

function drawMapPlayerPixelAvatar(
  ctx: CanvasRenderingContext2D,
  options: {
    px: number;
    py: number;
    tilePxW: number;
    tilePxH: number;
    nowMs: number;
    isMoving: boolean;
    direction: 'up' | 'down' | 'left' | 'right';
    avatar: MapPlayerAvatarConfig;
  },
): { x: number; y: number; w: number; h: number } {
  const {
    px,
    py,
    tilePxW,
    tilePxH,
    nowMs,
    isMoving,
    direction,
    avatar,
  } = options;
  const bodyW = tilePxW * 0.78;
  const bodyH = tilePxH * 0.9;
  const x = px + ((tilePxW - bodyW) * 0.5);
  const y = py + (tilePxH * 0.02);
  const unit = Math.max(1, Math.floor((tilePxW / 16)));
  const walkPhase = isMoving ? Math.sin((nowMs / 120)) : 0;
  const legOffset = Math.round(walkPhase * unit * 1.4);
  const armOffset = Math.round(walkPhase * unit);

  // Legs
  ctx.fillStyle = '#35322f';
  ctx.fillRect(x + (bodyW * 0.26), y + (bodyH * 0.66), bodyW * 0.16, bodyH * 0.26);
  ctx.fillRect(x + (bodyW * 0.58), y + (bodyH * 0.66), bodyW * 0.16, bodyH * 0.26);
  if (isMoving) {
    ctx.fillRect(x + (bodyW * 0.26), y + (bodyH * 0.66) + legOffset, bodyW * 0.16, bodyH * 0.26);
    ctx.fillRect(x + (bodyW * 0.58), y + (bodyH * 0.66) - legOffset, bodyW * 0.16, bodyH * 0.26);
  }

  // Body
  ctx.fillStyle = avatar.outfitColor;
  ctx.fillRect(x + (bodyW * 0.2), y + (bodyH * 0.35), bodyW * 0.6, bodyH * 0.38);
  ctx.fillStyle = avatar.accentColor;
  ctx.fillRect(x + (bodyW * 0.46), y + (bodyH * 0.38), bodyW * 0.08, bodyH * 0.3);

  // Arms
  ctx.fillStyle = avatar.skinColor;
  ctx.fillRect(x + (bodyW * 0.13), y + (bodyH * 0.39) + armOffset, bodyW * 0.1, bodyH * 0.26);
  ctx.fillRect(x + (bodyW * 0.77), y + (bodyH * 0.39) - armOffset, bodyW * 0.1, bodyH * 0.26);

  // Head
  ctx.fillStyle = avatar.skinColor;
  ctx.fillRect(x + (bodyW * 0.29), y + (bodyH * 0.07), bodyW * 0.42, bodyH * 0.33);

  // Hair
  ctx.fillStyle = avatar.hairColor;
  if (avatar.hairStyle === 'spiky') {
    ctx.fillRect(x + (bodyW * 0.27), y + (bodyH * 0.02), bodyW * 0.46, bodyH * 0.13);
    ctx.fillRect(x + (bodyW * 0.23), y + (bodyH * 0.09), bodyW * 0.08, bodyH * 0.08);
    ctx.fillRect(x + (bodyW * 0.69), y + (bodyH * 0.09), bodyW * 0.08, bodyH * 0.08);
  } else if (avatar.hairStyle === 'ponytail') {
    ctx.fillRect(x + (bodyW * 0.27), y + (bodyH * 0.03), bodyW * 0.46, bodyH * 0.12);
    ctx.fillRect(x + (bodyW * 0.69), y + (bodyH * 0.15), bodyW * 0.08, bodyH * 0.2);
  } else {
    ctx.fillRect(x + (bodyW * 0.27), y + (bodyH * 0.03), bodyW * 0.46, bodyH * 0.14);
  }

  // Face
  if (direction !== 'up') {
    ctx.fillStyle = '#21201f';
    ctx.fillRect(x + (bodyW * 0.38), y + (bodyH * 0.2), bodyW * 0.05, bodyH * 0.05);
    ctx.fillRect(x + (bodyW * 0.57), y + (bodyH * 0.2), bodyW * 0.05, bodyH * 0.05);
    if (direction === 'down') {
      ctx.fillRect(x + (bodyW * 0.46), y + (bodyH * 0.28), bodyW * 0.08, bodyH * 0.03);
    }
  }

  // Accessory
  if (avatar.accessory === 'cap') {
    ctx.fillStyle = avatar.accentColor;
    ctx.fillRect(x + (bodyW * 0.27), y + (bodyH * 0.02), bodyW * 0.46, bodyH * 0.08);
    ctx.fillRect(x + (bodyW * 0.7), y + (bodyH * 0.08), bodyW * 0.14, bodyH * 0.03);
  } else if (avatar.accessory === 'glasses' && direction !== 'up') {
    ctx.strokeStyle = '#1f2524';
    ctx.lineWidth = Math.max(1, unit);
    ctx.strokeRect(x + (bodyW * 0.36), y + (bodyH * 0.18), bodyW * 0.08, bodyH * 0.07);
    ctx.strokeRect(x + (bodyW * 0.55), y + (bodyH * 0.18), bodyW * 0.08, bodyH * 0.07);
    ctx.beginPath();
    ctx.moveTo(x + (bodyW * 0.44), y + (bodyH * 0.22));
    ctx.lineTo(x + (bodyW * 0.55), y + (bodyH * 0.22));
    ctx.stroke();
  } else if (avatar.accessory === 'scarf') {
    ctx.fillStyle = avatar.accentColor;
    ctx.fillRect(x + (bodyW * 0.24), y + (bodyH * 0.38), bodyW * 0.52, bodyH * 0.06);
    ctx.fillRect(x + (bodyW * 0.53), y + (bodyH * 0.44), bodyW * 0.08, bodyH * 0.2);
  }

  return { x, y, w: bodyW, h: bodyH };
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

type BinanceTicker24h = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  volume: string;
  highPrice: string;
  lowPrice: string;
};

type MarketPulseRegime = 'risk-on' | 'risk-off' | 'rotation' | 'volatile';

type MarketPulseAsset = {
  symbol: string;
  shortLabel: string;
  lastPrice: number;
  changePct: number;
  quoteVolume: number;
  volume: number;
  highPrice: number;
  lowPrice: number;
};

type MarketPulseData = {
  updatedAt: number;
  regime: MarketPulseRegime;
  heatScore: number;
  riskScore: number;
  leaderSymbol: string;
  assets: MarketPulseAsset[];
};

type BinanceMiniTicker = {
  e?: string;
  E?: number;
  s: string;
  c: string;
  o: string;
  h: string;
  l: string;
  v: string;
  q: string;
};

type ChainPulseMode = 'balanced' | 'mainnet-busy' | 'sync-watch';
type ChainPulseNetworkKey = 'bsc';

type ChainPulseNetwork = {
  key: ChainPulseNetworkKey;
  label: string;
  rpc: string;
  blockNumber: number;
  gasGwei: number;
  blockAgeSec: number;
  txCount: number;
  updatedAt: number;
};

type ChainPulseData = {
  updatedAt: number;
  mode: ChainPulseMode;
  activityScore: number;
  pressureScore: number;
  networks: ChainPulseNetwork[];
};

type BnbWorldEventTone = 'boost' | 'watch' | 'risk' | 'flow';

type BnbWorldEvent = {
  id: string;
  titleZh: string;
  titleEn: string;
  detailZh: string;
  detailEn: string;
  tone: BnbWorldEventTone;
  questRewardMultiplier: number;
  questProgressBonus: number;
  lootCountBonus: number;
  enemyCountBonus: number;
  npcSpeedMultiplier: number;
};

type BnbActionBrief = {
  titleZh: string;
  titleEn: string;
  networkZh: string;
  networkEn: string;
  zoneZh: string;
  zoneEn: string;
  actionZh: string;
  actionEn: string;
  riskZh: string;
  riskEn: string;
  noteZh: string;
  noteEn: string;
};

type BinanceSkillsAlphaToken = {
  symbol: string;
  price: number;
  change24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
};

type BinanceSkillsSmartMoneyToken = {
  symbol: string;
  inflow: number | null;
  priceChangeRate: number | null;
  marketCap: number | null;
};

type BinanceSkillsSocialToken = {
  symbol: string;
  sentiment: string;
  socialHype: number | null;
  priceChange: number | null;
  summary: string;
};

type BinanceSkillsPulseData = {
  updatedAt: number;
  alphaTop: BinanceSkillsAlphaToken | null;
  smartMoneyTop: BinanceSkillsSmartMoneyToken | null;
  socialTop: BinanceSkillsSocialToken | null;
};

type BinanceSkillsMission = {
  id: 'alpha' | 'smart-money' | 'social-hype';
  title: string;
  subtitle: string;
  token: string;
  tone: 'alpha' | 'watch' | 'risk';
  zoneLabel: string;
  focus: ActionBriefZoneFocus | null;
  steps: string[];
  note: string;
};

type BscLiveChatSpeaker = {
  id: string;
  name: string;
  role: string;
  topic?: string;
  isGuest?: boolean;
};

type BscLiveChatMessageTone = 'calm' | 'watch' | 'risk' | 'alpha';

type BscLiveChatMessage = {
  id: string;
  speakerId: string;
  speaker: string;
  role: string;
  text: string;
  createdAt: number;
  tone: BscLiveChatMessageTone;
  source?: 'ai' | 'fallback';
};

type MapOfficeChatResponse = {
  ok?: boolean;
  provider?: string;
  model?: string;
  messages?: Array<{
    speaker?: string;
    role?: string;
    text?: string;
    tone?: 'brief' | 'warning' | 'alpha';
  }>;
};

type MapNpcChatTurn = {
  id: string;
  role: 'user' | 'npc' | 'system';
  text: string;
  createdAt: number;
  source?: 'ai' | 'fallback' | 'seed';
};

type MapNpcChatResponse = {
  ok?: boolean;
  provider?: string;
  model?: string;
  speaker?: string;
  reply?: string;
  source?: 'ai' | 'fallback';
};

const MARKET_PULSE_SYMBOLS = ['BTCUSDT', 'BNBUSDT', 'ETHUSDT', 'SOLUSDT'] as const;
const MARKET_PULSE_ENDPOINTS = [
  'https://data-api.binance.vision/api/v3/ticker/24hr',
  'https://api.binance.com/api/v3/ticker/24hr',
] as const;
const MARKET_PULSE_STREAM_URL = 'wss://data-stream.binance.vision/stream?streams=btcusdt@miniTicker/bnbusdt@miniTicker/ethusdt@miniTicker/solusdt@miniTicker';
const BNB_CHAIN_RPC_ENDPOINTS = {
  bsc: [
    'https://bsc-dataseed-public.bnbchain.org',
    'https://bsc-dataseed.bnbchain.org',
  ],
} as const;
const BINANCE_SKILLS_ALPHA_ENDPOINT = 'https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/unified/rank/list';
const BINANCE_SKILLS_SMART_MONEY_ENDPOINT = 'https://web3.binance.com/bapi/defi/v1/public/wallet-direct/tracker/wallet/token/inflow/rank/query';
const BINANCE_SKILLS_SOCIAL_HYPE_ENDPOINT = 'https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/social/hype/rank/leaderboard?chainId=56&sentiment=All&socialLanguage=ALL&targetLanguage=en&timeRange=1';
const DEFAULT_STAR_OFFICE_API_BASE = 'https://star-office-api-production.up.railway.app';
const LOCAL_STAR_OFFICE_PROXY_BASE = '/api/star-office';

function normalizeStarOfficeApiBase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    if (typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
      return LOCAL_STAR_OFFICE_PROXY_BASE;
    }
    return DEFAULT_STAR_OFFICE_API_BASE;
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function buildStarOfficeApiUrl(baseUrl: string, path: string): string {
  const normalizedBase = normalizeStarOfficeApiBase(baseUrl);
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
}

function formatSignedPercent(value: number): string {
  if (!Number.isFinite(value)) return '--';
  const rounded = value.toFixed(1);
  return `${value >= 0 ? '+' : ''}${rounded}%`;
}

function formatCompactUsd(value: number, digits = 1): string {
  if (!Number.isFinite(value) || value <= 0) return '--';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(digits)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(digits)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(digits)}K`;
  return `$${value.toFixed(Math.max(0, digits))}`;
}

function formatMarketPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--';
  if (value >= 10_000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (value >= 1_000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
  if (value >= 1) return `$${value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}`;
  return `$${value.toFixed(4)}`;
}

function computeMarketPulseFromAssets(
  assets: MarketPulseAsset[],
  t: (zh: string, en: string) => string,
): MarketPulseData {
  const btc = assets.find((item) => item.symbol === 'BTCUSDT');
  const bnb = assets.find((item) => item.symbol === 'BNBUSDT');
  if (!btc || !bnb) {
    throw new Error(t('行情返回不完整，缺少 BTC 或 BNB。', 'Incomplete market feed: BTC or BNB is missing.'));
  }
  const avgAbsMove = (Math.abs(btc.changePct) + Math.abs(bnb.changePct)) / 2;
  const leader = [...assets].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0] ?? bnb;
  let regime: MarketPulseRegime = 'rotation';
  if (avgAbsMove >= 2.2) {
    regime = 'volatile';
  } else if (btc.changePct >= 0 && bnb.changePct >= 0) {
    regime = 'risk-on';
  } else if (btc.changePct < 0 && bnb.changePct < 0) {
    regime = 'risk-off';
  }
  const totalAbsMove = assets.reduce((sum, item) => sum + Math.abs(item.changePct), 0);
  const heatScore = clamp(round1(totalAbsMove * 6.5), 0, 100);
  const riskScore = clamp(round1((avgAbsMove * 26) + (btc.changePct < 0 ? 10 : 0) + (bnb.changePct < 0 ? 8 : 0)), 0, 100);
  return {
    updatedAt: Date.now(),
    regime,
    heatScore,
    riskScore,
    leaderSymbol: leader.symbol,
    assets,
  };
}

function parseHexToNumber(value: string | null | undefined): number {
  if (!value || typeof value !== 'string') return 0;
  try {
    return Number(BigInt(value));
  } catch {
    return 0;
  }
}

function formatGasGwei(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '--';
  if (value >= 10) return `${value.toFixed(1)} gwei`;
  if (value >= 1) return `${value.toFixed(2)} gwei`;
  if (value >= 0.01) return `${value.toFixed(3)} gwei`;
  return `${value.toFixed(4)} gwei`;
}

function formatChainAge(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '--';
  if (value >= 60) return `${Math.round(value / 60)}m`;
  if (value >= 10) return `${Math.round(value)}s`;
  return `${value.toFixed(1)}s`;
}

function formatBlockCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '--';
  return `#${value.toLocaleString()}`;
}

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

function buildMapExpansionDecorations(
  map: TiledMap,
  level: number,
  allowStructureDecorations: boolean,
): MapExpansionDecoration[] {
  const bounds = getMapExpansionBounds(map, level);
  const ringMinX = Math.max(1, bounds.minTx - 5);
  const ringMaxX = Math.min(map.width - 2, bounds.maxTx + 5);
  const ringMinY = Math.max(1, bounds.minTy - 5);
  const ringMaxY = Math.min(map.height - 2, bounds.maxTy + 5);
  const count = allowStructureDecorations ? (8 + level * 5) : (6 + level * 4);
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
    const kind: MapExpansionDecorationKind = pick < 0.3
      ? 'grass'
      : pick < 0.52
        ? 'flower'
        : pick < 0.72
          ? 'rock'
          : pick < 0.86
            ? 'sapling'
            : pick < (allowStructureDecorations ? 0.92 : 1)
              ? 'lantern'
              : pick < 0.965
                ? 'cabin'
                : pick < 0.988
                  ? 'workshop'
                  : 'greenhouse';
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
  compact = false,
): void {
  const px = item.tx * tilePxW;
  const py = item.ty * tilePxH;
  const styleSeed = biomeHash(item.tx * 3 + item.level, item.ty * 5 + item.level * 2, item.level * 7, item.kind.length * 11);
  const variant = Math.floor(styleSeed * 4);
  const bx = px + tilePxW * (0.17 + (variant % 2) * 0.02);
  const by = py + tilePxH * 0.14;
  const bw = tilePxW * (0.58 + (variant % 3) * 0.03);
  const bh = tilePxH * (0.66 + ((variant + 1) % 2) * 0.04);
  const pulse = 0.55 + (Math.sin((now / 620) + item.level) * 0.25);
  const roofPalette = ['#7f4f32', '#6a5a8f', '#8b6d41', '#5b6f86'] as const;
  const wallPalette = ['#d8c8a3', '#c5d3df', '#d3c0b1', '#b9cba6'] as const;
  const trimPalette = ['#6c5334', '#516272', '#775743', '#4f5f46'] as const;
  const roofColor = roofPalette[variant % roofPalette.length];
  const wallColor = wallPalette[(variant + 1) % wallPalette.length];
  const trimColor = trimPalette[(variant + 2) % trimPalette.length];

  ctx.fillStyle = 'rgba(40, 30, 16, 0.2)';
  ctx.fillRect(px + tilePxW * 0.22, py + tilePxH * 0.86, tilePxW * 0.56, tilePxH * 0.12);

  if (compact) {
    const cx = px + tilePxW * 0.5;
    const glow = 0.32 + (Math.sin((now / 420) + item.level) * 0.12);
    ctx.fillStyle = `rgba(240, 185, 11, ${Math.max(0.18, glow)})`;
    ctx.fillRect(px + tilePxW * 0.18, py + tilePxH * 0.18, tilePxW * 0.64, tilePxH * 0.52);
    ctx.strokeStyle = 'rgba(42, 35, 14, 0.82)';
    ctx.lineWidth = Math.max(1, tilePxW * 0.08);
    ctx.strokeRect(px + tilePxW * 0.18, py + tilePxH * 0.18, tilePxW * 0.64, tilePxH * 0.52);
    ctx.fillStyle = '#fff4bf';
    ctx.fillRect(cx - tilePxW * 0.05, py + tilePxH * 0.28, tilePxW * 0.1, tilePxH * 0.22);
    ctx.fillStyle = '#6d5323';
    ctx.fillRect(cx - tilePxW * 0.03, py + tilePxH * 0.5, tilePxW * 0.06, tilePxH * 0.22);
    return;
  }

  if (item.kind === 'signboard') {
    ctx.fillStyle = trimColor;
    ctx.fillRect(bx + bw * 0.46, by + bh * 0.34, bw * 0.08, bh * 0.62);
    ctx.fillStyle = wallColor;
    ctx.fillRect(bx, by, bw, bh * 0.5);
    ctx.fillStyle = roofColor;
    ctx.fillRect(bx + bw * 0.06, by + bh * 0.1, bw * 0.88, bh * 0.1);
    if (variant % 2 === 0) {
      ctx.fillStyle = '#df6767';
      ctx.fillRect(bx + bw * 0.15, by + bh * 0.22, bw * 0.12, bh * 0.12);
      ctx.fillRect(bx + bw * 0.73, by + bh * 0.22, bw * 0.12, bh * 0.12);
    }
    return;
  }
  if (item.kind === 'windmill') {
    const rotor = (now / 540) + item.level + variant;
    const cx = bx + bw * 0.5;
    const cy = by + bh * 0.25;
    const blade = bw * 0.32;
    ctx.fillStyle = trimColor;
    ctx.fillRect(bx + bw * 0.42, by + bh * 0.3, bw * 0.16, bh * 0.68);
    ctx.fillStyle = wallColor;
    ctx.fillRect(bx + bw * 0.38, by + bh * 0.22, bw * 0.24, bh * 0.12);
    ctx.fillStyle = '#e3e8ea';
    for (let i = 0; i < 4; i++) {
      const a = rotor + (Math.PI * 0.5 * i);
      const ex = cx + Math.cos(a) * blade;
      const ey = cy + Math.sin(a) * blade * 0.75;
      ctx.fillRect(Math.min(cx, ex), Math.min(cy, ey), Math.abs(ex - cx) + 1, Math.abs(ey - cy) + 1);
    }
    ctx.fillStyle = roofColor;
    ctx.fillRect(cx - bw * 0.03, cy - bw * 0.03, bw * 0.06, bw * 0.06);
    return;
  }
  if (item.kind === 'barn') {
    ctx.fillStyle = wallColor;
    ctx.fillRect(bx, by + bh * 0.3, bw, bh * 0.64);
    ctx.fillStyle = trimColor;
    ctx.fillRect(bx + bw * 0.18, by + bh * 0.54, bw * 0.24, bh * 0.4);
    ctx.fillRect(bx + bw * 0.58, by + bh * 0.54, bw * 0.24, bh * 0.4);
    ctx.fillStyle = roofColor;
    ctx.fillRect(bx + bw * 0.08, by + bh * 0.18, bw * 0.84, bh * 0.16);
    if (variant >= 2) {
      ctx.fillStyle = '#7fb7df';
      ctx.fillRect(bx + bw * 0.46, by + bh * 0.5, bw * 0.08, bh * 0.12);
    }
    return;
  }
  if (item.kind === 'tower') {
    ctx.fillStyle = wallColor;
    ctx.fillRect(bx + bw * 0.24, by + bh * 0.22, bw * 0.52, bh * 0.74);
    ctx.fillStyle = roofColor;
    ctx.fillRect(bx + bw * 0.2, by + bh * 0.1, bw * 0.6, bh * 0.16);
    ctx.fillStyle = trimColor;
    ctx.fillRect(bx + bw * 0.44, by + bh * 0.52, bw * 0.12, bh * 0.2);
    if ((variant & 1) === 1) {
      ctx.fillRect(bx + bw * 0.28, by + bh * 0.36, bw * 0.08, bh * 0.08);
      ctx.fillRect(bx + bw * 0.64, by + bh * 0.36, bw * 0.08, bh * 0.08);
    }
    return;
  }
  if (item.kind === 'market') {
    ctx.fillStyle = trimColor;
    ctx.fillRect(bx + bw * 0.04, by + bh * 0.54, bw * 0.92, bh * 0.4);
    ctx.fillStyle = roofColor;
    ctx.fillRect(bx + bw * 0.02, by + bh * 0.28, bw * 0.96, bh * 0.2);
    ctx.fillStyle = variant % 2 === 0 ? '#5f943f' : '#4b7ea8';
    ctx.fillRect(bx + bw * 0.09, by + bh * 0.32, bw * 0.16, bh * 0.12);
    ctx.fillRect(bx + bw * 0.42, by + bh * 0.32, bw * 0.16, bh * 0.12);
    ctx.fillRect(bx + bw * 0.74, by + bh * 0.32, bw * 0.16, bh * 0.12);
    if (variant >= 2) {
      ctx.fillStyle = wallColor;
      ctx.fillRect(bx + bw * 0.12, by + bh * 0.66, bw * 0.12, bh * 0.12);
      ctx.fillRect(bx + bw * 0.72, by + bh * 0.66, bw * 0.12, bh * 0.12);
    }
    return;
  }
  ctx.fillStyle = trimColor;
  ctx.fillRect(bx + bw * 0.42, by + bh * 0.16, bw * 0.16, bh * 0.8);
  ctx.fillStyle = `rgba(255, 223, 110, ${Math.max(0.2, pulse + (variant * 0.03))})`;
  ctx.fillRect(bx + bw * 0.3, by, bw * 0.4, bh * 0.2);
  ctx.fillStyle = roofColor;
  ctx.fillRect(bx + bw * 0.28, by + bh * 0.34, bw * 0.44, bh * 0.08);
}

function getMapExpansionLandmarkAction(kind: MapExpansionLandmarkKind): MapExpansionLandmarkActionKey {
  if (kind === 'signboard') return 'guide';
  if (kind === 'windmill') return 'boost';
  if (kind === 'barn') return 'supply';
  if (kind === 'tower') return 'patrol';
  if (kind === 'market') return 'shop';
  return 'upgrade';
}

function drawMiniBuildingDecoration(
  ctx: CanvasRenderingContext2D,
  kind: 'cabin' | 'workshop' | 'greenhouse',
  px: number,
  py: number,
  tilePxW: number,
  tilePxH: number,
  phase: number,
) {
  const seed = biomeHash(Math.floor(px), Math.floor(py), Math.floor(phase * 1000), kind.length * 19);
  const variant = Math.floor(seed * 4);
  const roof = ['#7f4f32', '#8b6d41', '#6a5a8f', '#5b6f86'][variant % 4];
  const wall = ['#d8c8a3', '#d3c0b1', '#c5d3df', '#b9cba6'][(variant + 1) % 4];
  const trim = ['#6c5334', '#775743', '#516272', '#4f5f46'][(variant + 2) % 4];
  const bw = tilePxW * 0.68;
  const bh = tilePxH * 0.68;
  const bx = px + tilePxW * 0.16;
  const by = py + tilePxH * 0.2;

  if (kind === 'cabin') {
    ctx.fillStyle = wall;
    ctx.fillRect(bx, by + bh * 0.28, bw, bh * 0.62);
    ctx.fillStyle = roof;
    ctx.fillRect(bx + bw * 0.04, by + bh * 0.12, bw * 0.92, bh * 0.2);
    ctx.fillStyle = trim;
    ctx.fillRect(bx + bw * 0.42, by + bh * 0.58, bw * 0.16, bh * 0.32);
    return;
  }

  if (kind === 'workshop') {
    ctx.fillStyle = wall;
    ctx.fillRect(bx + bw * 0.08, by + bh * 0.24, bw * 0.84, bh * 0.66);
    ctx.fillStyle = roof;
    ctx.fillRect(bx, by + bh * 0.12, bw, bh * 0.14);
    ctx.fillStyle = trim;
    ctx.fillRect(bx + bw * 0.16, by + bh * 0.52, bw * 0.16, bh * 0.12);
    ctx.fillRect(bx + bw * 0.68, by + bh * 0.52, bw * 0.16, bh * 0.12);
    return;
  }

  ctx.fillStyle = wall;
  ctx.fillRect(bx + bw * 0.06, by + bh * 0.3, bw * 0.88, bh * 0.58);
  ctx.fillStyle = roof;
  ctx.fillRect(bx + bw * 0.1, by + bh * 0.18, bw * 0.8, bh * 0.12);
  ctx.fillStyle = '#8fd0d5';
  ctx.fillRect(bx + bw * 0.16, by + bh * 0.38, bw * 0.68, bh * 0.2);
  ctx.fillStyle = trim;
  ctx.fillRect(bx + bw * 0.44, by + bh * 0.6, bw * 0.12, bh * 0.22);
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
  if (item.kind === 'cabin' || item.kind === 'workshop' || item.kind === 'greenhouse') {
    drawMiniBuildingDecoration(ctx, item.kind, px, py, tilePxW, tilePxH, item.phase);
    return;
  }
  ctx.fillStyle = '#9ea4aa';
  ctx.fillRect(px + tilePxW * 0.38, baseY - size * 1.8, size * 2.4, size * 1.2);
  ctx.fillStyle = '#c7cdd2';
  ctx.fillRect(px + tilePxW * 0.45, baseY - size * 2.3, size * 1.8, size * 0.9);
}

function biomeHash(tx: number, ty: number, sx: number, sy: number): number {
  let n = ((tx + sx * 127) * 374761393) ^ ((ty + sy * 197) * 668265263);
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967295;
}

type InfiniteSeason = 'spring' | 'summer' | 'autumn' | 'winter';
type SeasonBlendWeights = Record<InfiniteSeason, number>;

function smoothBlend01(v: number): number {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - (2 * t));
}

function getSeasonBlendWeights(
  globalTx: number,
  globalTy: number,
  now: number,
): SeasonBlendWeights {
  const order: InfiniteSeason[] = ['spring', 'summer', 'autumn', 'winter'];
  const spatialA = biomeHash(globalTx * 2 + 13, globalTy * 2 + 17, 19, 23);
  const spatialB = biomeHash(globalTx + 71, globalTy + 29, 11, 7);
  const timeDrift = ((Math.sin((now / 160000) + globalTx * 0.002 + globalTy * 0.0023) + 1) * 0.5) * 0.18;
  const phaseBase = (spatialA * 0.72) + (spatialB * 0.28) + timeDrift;
  const phase = ((phaseBase % 1) + 1) % 1 * 4;
  const idx = Math.floor(phase) % 4;
  const frac = smoothBlend01(phase - Math.floor(phase));
  const next = (idx + 1) % 4;
  const weights: SeasonBlendWeights = { spring: 0, summer: 0, autumn: 0, winter: 0 };
  weights[order[idx]] = 1 - frac;
  weights[order[next]] = frac;
  return weights;
}

function drawSeasonalTransitionTile(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  tilePxW: number,
  tilePxH: number,
  now: number,
  seed: number,
  season: SeasonBlendWeights,
) {
  if (season.spring > 0.001) {
    ctx.fillStyle = `rgba(172, 231, 168, ${0.08 * season.spring})`;
    ctx.fillRect(bx, by, tilePxW, tilePxH);
  }
  if (season.summer > 0.001) {
    ctx.fillStyle = `rgba(246, 219, 126, ${0.07 * season.summer})`;
    ctx.fillRect(bx, by, tilePxW, tilePxH);
  }
  if (season.autumn > 0.001) {
    ctx.fillStyle = `rgba(232, 160, 92, ${0.09 * season.autumn})`;
    ctx.fillRect(bx, by, tilePxW, tilePxH);
  }
  if (season.winter > 0.001) {
    ctx.fillStyle = `rgba(230, 243, 255, ${0.1 * season.winter})`;
    ctx.fillRect(bx, by, tilePxW, tilePxH);
  }

  if (season.spring > 0.18 && seed < (0.06 * season.spring)) {
    const p = Math.max(1, tilePxW * 0.05);
    ctx.fillStyle = '#f4a2c7';
    ctx.fillRect(bx + tilePxW * 0.3, by + tilePxH * 0.64, p, p);
    ctx.fillRect(bx + tilePxW * 0.52, by + tilePxH * 0.58, p, p);
  }
  if (season.summer > 0.2 && seed > 0.4 && seed < (0.4 + 0.09 * season.summer)) {
    const b = Math.max(1, tilePxW * 0.04);
    ctx.fillStyle = 'rgba(73, 152, 84, 0.7)';
    ctx.fillRect(bx + tilePxW * 0.26, by + tilePxH * 0.7, b, b * 2.1);
    ctx.fillRect(bx + tilePxW * 0.46, by + tilePxH * 0.64, b, b * 2.4);
    ctx.fillRect(bx + tilePxW * 0.6, by + tilePxH * 0.72, b, b * 1.9);
  }
  if (season.autumn > 0.2 && seed < (0.05 * season.autumn)) {
    const l = Math.max(1, tilePxW * 0.05);
    const sway = Math.sin((now / 820) + seed * 32) * tilePxW * 0.04;
    ctx.fillStyle = '#d27a3f';
    ctx.fillRect(bx + tilePxW * 0.35 + sway, by + tilePxH * 0.72, l, l);
    ctx.fillStyle = '#c85636';
    ctx.fillRect(bx + tilePxW * 0.55 - sway * 0.6, by + tilePxH * 0.67, l, l);
  }
  if (season.winter > 0.18 && seed < (0.08 * season.winter)) {
    const s = Math.max(1, tilePxW * 0.04);
    const drift = Math.sin((now / 520) + seed * 42) * tilePxW * 0.03;
    ctx.fillStyle = 'rgba(248, 252, 255, 0.86)';
    ctx.fillRect(bx + tilePxW * 0.42 + drift, by + tilePxH * 0.2, s, s);
  }
}

function drawForestMushroomPatch(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  tilePxW: number,
  tilePxH: number,
  now: number,
  phase: number,
) {
  const stemW = Math.max(1, tilePxW * 0.034);
  const stemH = Math.max(1, tilePxH * 0.11);
  const sway = Math.sin((now / 700) + phase * 9.1) * tilePxW * 0.014;
  const caps = ['#d45f59', '#ce6a39', '#a34ed6'] as const;
  for (let i = 0; i < 3; i++) {
    const x = bx + tilePxW * (0.26 + i * 0.13) + sway * (0.75 + i * 0.14);
    const y = by + tilePxH * (0.7 - (i % 2) * 0.03);
    ctx.fillStyle = '#f6e2c1';
    ctx.fillRect(x, y, stemW, stemH);
    const capW = stemW * 2.8;
    const capH = stemH * 0.88;
    ctx.fillStyle = caps[i % caps.length];
    ctx.fillRect(x - stemW * 0.9, y - capH, capW, capH);
    ctx.fillStyle = 'rgba(255, 241, 210, 0.7)';
    ctx.fillRect(x - stemW * 0.5, y - capH * 0.8, Math.max(1, stemW * 0.6), Math.max(1, stemW * 0.6));
  }
}

function drawDesertCactus(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  tilePxW: number,
  tilePxH: number,
  phase: number,
) {
  const bodyW = Math.max(1, tilePxW * 0.088);
  const bodyH = Math.max(2, tilePxH * 0.27);
  const x = bx + tilePxW * (0.49 + (phase - 0.5) * 0.05);
  const y = by + tilePxH * 0.47;
  ctx.fillStyle = '#4f9f63';
  ctx.fillRect(x, y, bodyW, bodyH);
  ctx.fillRect(x - bodyW * 0.95, y + bodyH * 0.25, bodyW * 0.9, bodyH * 0.36);
  ctx.fillRect(x + bodyW * 1.05, y + bodyH * 0.2, bodyW * 0.85, bodyH * 0.32);
  ctx.fillStyle = '#7ed189';
  ctx.fillRect(x + bodyW * 0.18, y + bodyH * 0.08, Math.max(1, bodyW * 0.22), Math.max(1, bodyH * 0.78));
  ctx.fillStyle = 'rgba(143, 112, 70, 0.5)';
  ctx.fillRect(x - bodyW * 0.7, y + bodyH + tilePxH * 0.01, bodyW * 2.4, Math.max(1, tilePxH * 0.03));
}

function drawSnowPine(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  tilePxW: number,
  tilePxH: number,
  phase: number,
) {
  const trunkW = Math.max(1, tilePxW * 0.03);
  const trunkH = Math.max(2, tilePxH * 0.1);
  const x = bx + tilePxW * (0.48 + (phase - 0.5) * 0.06);
  const y = by + tilePxH * 0.54;
  ctx.fillStyle = '#7a5a36';
  ctx.fillRect(x, y + tilePxH * 0.16, trunkW, trunkH);
  ctx.fillStyle = '#5b9f6e';
  ctx.fillRect(x - tilePxW * 0.06, y + tilePxH * 0.1, tilePxW * 0.15, tilePxH * 0.08);
  ctx.fillRect(x - tilePxW * 0.08, y + tilePxH * 0.03, tilePxW * 0.19, tilePxH * 0.08);
  ctx.fillRect(x - tilePxW * 0.04, y - tilePxH * 0.04, tilePxW * 0.12, tilePxH * 0.07);
  ctx.fillStyle = 'rgba(242, 249, 255, 0.82)';
  ctx.fillRect(x - tilePxW * 0.02, y - tilePxH * 0.035, tilePxW * 0.07, tilePxH * 0.02);
}

function drawSnowman(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  tilePxW: number,
  tilePxH: number,
  phase: number,
) {
  const x = bx + tilePxW * (0.48 + (phase - 0.5) * 0.08);
  const y = by + tilePxH * 0.63;
  const base = Math.max(2, tilePxW * 0.09);
  const head = Math.max(1, tilePxW * 0.058);
  ctx.fillStyle = '#f5fbff';
  ctx.fillRect(x - base * 0.6, y, base, base * 0.8);
  ctx.fillRect(x - head * 0.45, y - head * 0.95, head, head);
  ctx.fillStyle = '#7a4a32';
  ctx.fillRect(x - head * 0.24, y - head * 1.02, head * 0.16, head * 0.16);
  ctx.fillRect(x + head * 0.1, y - head * 1.02, head * 0.16, head * 0.16);
  ctx.fillStyle = '#d07b35';
  ctx.fillRect(x + head * 0.23, y - head * 0.58, head * 0.36, head * 0.1);
}

function drawWildflowerDots(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  tilePxW: number,
  tilePxH: number,
  hue: 'warm' | 'cool',
) {
  const stem = Math.max(1, tilePxW * 0.045);
  const petal = Math.max(1, tilePxW * 0.055);
  ctx.fillStyle = 'rgba(64, 122, 70, 0.68)';
  ctx.fillRect(bx + tilePxW * 0.36, by + tilePxH * 0.66, stem, stem * 2.4);
  ctx.fillRect(bx + tilePxW * 0.52, by + tilePxH * 0.64, stem, stem * 2.8);
  ctx.fillStyle = hue === 'warm' ? '#f5b24d' : '#b08cff';
  ctx.fillRect(bx + tilePxW * 0.31, by + tilePxH * 0.58, petal, petal);
  ctx.fillRect(bx + tilePxW * 0.47, by + tilePxH * 0.56, petal, petal);
}

function drawGrassTuft(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  tilePxW: number,
  tilePxH: number,
) {
  const blade = Math.max(1, tilePxW * 0.04);
  ctx.fillStyle = 'rgba(72, 138, 78, 0.62)';
  ctx.fillRect(bx + tilePxW * 0.28, by + tilePxH * 0.68, blade, blade * 2.4);
  ctx.fillRect(bx + tilePxW * 0.41, by + tilePxH * 0.62, blade, blade * 3.1);
  ctx.fillRect(bx + tilePxW * 0.56, by + tilePxH * 0.69, blade, blade * 2.2);
}

function drawRockBits(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  tilePxW: number,
  tilePxH: number,
  tint: 'stone' | 'snow',
) {
  const rw = Math.max(1, tilePxW * 0.08);
  const color = tint === 'snow' ? 'rgba(192, 205, 218, 0.58)' : 'rgba(140, 126, 108, 0.56)';
  ctx.fillStyle = color;
  ctx.fillRect(bx + tilePxW * 0.24, by + tilePxH * 0.72, rw * 1.2, rw);
  ctx.fillRect(bx + tilePxW * 0.42, by + tilePxH * 0.68, rw * 0.9, rw * 0.9);
  ctx.fillRect(bx + tilePxW * 0.57, by + tilePxH * 0.74, rw, rw * 0.8);
}

function drawBiomeBuilding(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  tilePxW: number,
  tilePxH: number,
  biome: InfiniteBiome,
  variant: number,
) {
  const roof = biome === 'desert'
    ? ['#8e6843', '#a56f38', '#78604a', '#9b7b58']
    : biome === 'snow'
      ? ['#6a7e9f', '#7387aa', '#5d6f8c', '#7d90b2']
      : ['#6e4e3a', '#7f5f44', '#745a4c', '#695241'];
  const wall = biome === 'desert'
    ? ['#d8c299', '#ceb188', '#d3b893', '#c8a97f']
    : biome === 'snow'
      ? ['#d2dfeb', '#c8d7e6', '#d9e4ef', '#c5d3e2']
      : ['#cdbca1', '#d7c7ab', '#c4b39a', '#d0bfa5'];
  const trim = ['#5a4632', '#4c5b68', '#5f533d', '#48624d'];
  const idx = variant % 4;
  const bw = tilePxW * 0.66;
  const bh = tilePxH * 0.64;
  const x = bx + tilePxW * 0.17;
  const y = by + tilePxH * 0.22;
  ctx.fillStyle = wall[idx];
  ctx.fillRect(x + bw * 0.04, y + bh * 0.28, bw * 0.92, bh * 0.6);
  ctx.fillStyle = roof[idx];
  ctx.fillRect(x, y + bh * 0.14, bw, bh * 0.18);
  ctx.fillStyle = trim[idx];
  ctx.fillRect(x + bw * 0.44, y + bh * 0.58, bw * 0.12, bh * 0.3);
  ctx.fillStyle = biome === 'snow' ? '#9ec3de' : '#8fb2cf';
  ctx.fillRect(x + bw * 0.18, y + bh * 0.46, bw * 0.14, bh * 0.12);
  ctx.fillRect(x + bw * 0.68, y + bh * 0.46, bw * 0.14, bh * 0.12);
}

function getInfiniteBiome(sectorX: number, sectorY: number): InfiniteBiome {
  const r = biomeHash(0, 0, sectorX, sectorY);
  if (r < 0.4) return 'forest';
  if (r < 0.72) return 'desert';
  return 'snow';
}

function pickCustomBiomePropSprite(biome: InfiniteBiome, r: number): MapCustomPropSpriteKey {
  if (biome === 'forest') {
    if (r < 0.9865) return 'cottage';
    if (r < 0.9895) return 'tower';
    return 'well';
  }
  if (biome === 'desert') {
    if (r < 0.9865) return 'barn';
    if (r < 0.9895) return 'well';
    return 'tower';
  }
  if (r < 0.9865) return 'greenhouse';
  if (r < 0.9895) return 'tower';
  return 'cottage';
}

function drawInfiniteBiomeTheme(
  ctx: CanvasRenderingContext2D,
  params: {
    biome: InfiniteBiome;
    mapWidth: number;
    mapHeight: number;
    tilePxW: number;
    tilePxH: number;
    viewLeft: number;
    viewTop: number;
    viewRight: number;
    viewBottom: number;
    now: number;
    sectorX: number;
    sectorY: number;
  },
): void {
  const {
    biome, mapWidth, mapHeight, tilePxW, tilePxH, viewLeft, viewTop, viewRight, viewBottom, now, sectorX, sectorY,
  } = params;
  const sx = Math.floor(viewLeft);
  const sy = Math.floor(viewTop);
  const ex = Math.ceil(viewRight);
  const ey = Math.ceil(viewBottom);
  const px = sx * tilePxW;
  const py = sy * tilePxH;
  const pw = (ex - sx) * tilePxW;
  const ph = (ey - sy) * tilePxH;

  if (biome === 'forest') {
    ctx.fillStyle = 'rgba(104, 156, 94, 0.055)';
  } else if (biome === 'desert') {
    ctx.fillStyle = 'rgba(226, 186, 118, 0.055)';
  } else {
    ctx.fillStyle = 'rgba(214, 236, 255, 0.06)';
  }
  ctx.fillRect(px, py, pw, ph);

  for (let ty = sy; ty <= ey; ty++) {
    for (let tx = sx; tx <= ex; tx++) {
      const worldTx = tx + (sectorX * Math.max(1, mapWidth - 2));
      const worldTy = ty + (sectorY * Math.max(1, mapHeight - 2));
      const r = biomeHash(worldTx, worldTy, 0, 0);
      const season = getSeasonBlendWeights(worldTx, worldTy, now);
      const seasonSeed = biomeHash(worldTx * 3 + 5, worldTy * 3 + 7, 13, 9);
      const bx = tx * tilePxW;
      const by = ty * tilePxH;
      drawSeasonalTransitionTile(ctx, bx, by, tilePxW, tilePxH, now, seasonSeed, season);
      if (biome === 'forest') {
        if (r < 0.04) {
          drawForestMushroomPatch(ctx, bx, by, tilePxW, tilePxH, now, r);
        } else if (r < 0.17) {
          drawGrassTuft(ctx, bx, by, tilePxW, tilePxH);
          if (r > 0.13) drawWildflowerDots(ctx, bx, by, tilePxW, tilePxH, 'cool');
        } else if (r > 0.92 && r < 0.96) {
          drawRockBits(ctx, bx, by, tilePxW, tilePxH, 'stone');
        } else if (r > 0.6 && r < 0.607) {
          drawBiomeBuilding(ctx, bx, by, tilePxW, tilePxH, biome, Math.floor(r * 1000));
        }
      } else if (biome === 'desert') {
        if (r < 0.048) {
          drawDesertCactus(ctx, bx, by, tilePxW, tilePxH, r);
        } else if (r < 0.16) {
          drawRockBits(ctx, bx, by, tilePxW, tilePxH, 'stone');
          if (r > 0.12) drawGrassTuft(ctx, bx, by, tilePxW, tilePxH);
        } else if (r > 0.84 && r < 0.88) {
          drawWildflowerDots(ctx, bx, by, tilePxW, tilePxH, 'warm');
        } else if (r > 0.57 && r < 0.575) {
          drawBiomeBuilding(ctx, bx, by, tilePxW, tilePxH, biome, Math.floor(r * 2000));
        }
      } else {
        if (r < 0.038) {
          drawSnowPine(ctx, bx, by, tilePxW, tilePxH, r);
        } else if (r < 0.057) {
          drawSnowman(ctx, bx, by, tilePxW, tilePxH, r);
        }
        if (r < 0.24) {
          const drift = Math.sin((now / 540) + tx * 0.7 + ty * 0.4) * tilePxW * 0.03;
          const sw = Math.max(1, tilePxW * 0.04);
          ctx.fillStyle = 'rgba(250, 253, 255, 0.72)';
          ctx.fillRect(bx + tilePxW * 0.42 + drift, by + tilePxH * 0.2, sw, sw);
        }
        if (r > 0.76 && r < 0.9) {
          const iw = Math.max(1, tilePxW * 0.22);
          ctx.fillStyle = 'rgba(180, 216, 245, 0.3)';
          ctx.fillRect(bx + tilePxW * 0.3, by + tilePxH * 0.62, iw, iw * 0.35);
        }
        if (r > 0.58 && r < 0.63) {
          drawRockBits(ctx, bx, by, tilePxW, tilePxH, 'snow');
        } else if (r > 0.69 && r < 0.695) {
          drawBiomeBuilding(ctx, bx, by, tilePxW, tilePxH, biome, Math.floor(r * 3000));
        }
      }
    }
  }
}

function drawInfiniteRegionStructureOverlay(
  ctx: CanvasRenderingContext2D,
  params: {
    grid: MapCollisionGrid;
    biome: InfiniteBiome;
    tilePxW: number;
    tilePxH: number;
    viewLeft: number;
    viewTop: number;
    viewRight: number;
    viewBottom: number;
    sectorX: number;
    sectorY: number;
  },
): void {
  type DistrictKind = 'lobby' | 'workspace' | 'lab' | 'archive';
  type DistrictFloorStyle = { base: string; alt: string; line: string; accent: string };
  type OverlayPalette = {
    floorBase: string;
    floorAlt: string;
    floorInset: string;
    grout: string;
    wallBase: string;
    wallShade: string;
    wallHighlight: string;
    terrainBase: string;
    terrainAlt: string;
    terrainSpeck: string;
    propWood: string;
    propMetal: string;
    propAccent: string;
    propPlant: string;
    zoneDivider: string;
    corridorMarker: string;
    districtFloor: Record<DistrictKind, DistrictFloorStyle>;
  };

  const buildPalette = (inputBiome: InfiniteBiome): OverlayPalette => {
    if (inputBiome === 'desert') {
      return {
        floorBase: '#777062',
        floorAlt: '#6c6659',
        floorInset: '#8b8473',
        grout: 'rgba(221, 208, 183, 0.26)',
        wallBase: '#d8bf98',
        wallShade: '#9f825d',
        wallHighlight: '#f0e0be',
        terrainBase: '#b79f7e',
        terrainAlt: '#af956f',
        terrainSpeck: 'rgba(98, 82, 58, 0.35)',
        propWood: '#8d6846',
        propMetal: '#75808e',
        propAccent: '#d2b56e',
        propPlant: '#78a96a',
        zoneDivider: 'rgba(228, 205, 164, 0.58)',
        corridorMarker: 'rgba(244, 223, 181, 0.42)',
        districtFloor: {
          lobby: { base: '#847260', alt: '#7a6959', line: 'rgba(247, 220, 178, 0.35)', accent: '#dcb176' },
          workspace: { base: '#6d6f73', alt: '#64666b', line: 'rgba(214, 218, 223, 0.28)', accent: '#92c0df' },
          lab: { base: '#5f6771', alt: '#56606b', line: 'rgba(143, 198, 233, 0.3)', accent: '#79d6e8' },
          archive: { base: '#6f6251', alt: '#665948', line: 'rgba(224, 195, 143, 0.3)', accent: '#c4a56f' },
        },
      };
    }
    if (inputBiome === 'snow') {
      return {
        floorBase: '#6d7484',
        floorAlt: '#646c7d',
        floorInset: '#7c8798',
        grout: 'rgba(206, 221, 240, 0.3)',
        wallBase: '#d7e2ef',
        wallShade: '#97a9bf',
        wallHighlight: '#eef6ff',
        terrainBase: '#b2c0d1',
        terrainAlt: '#a6b5c8',
        terrainSpeck: 'rgba(105, 126, 146, 0.32)',
        propWood: '#6e5b48',
        propMetal: '#7f95ab',
        propAccent: '#95c5f4',
        propPlant: '#7eb89f',
        zoneDivider: 'rgba(208, 226, 241, 0.62)',
        corridorMarker: 'rgba(226, 240, 253, 0.44)',
        districtFloor: {
          lobby: { base: '#7a8594', alt: '#717b8b', line: 'rgba(210, 227, 244, 0.34)', accent: '#afcbdf' },
          workspace: { base: '#657081', alt: '#5f6a7b', line: 'rgba(194, 210, 228, 0.3)', accent: '#8db2d6' },
          lab: { base: '#586e85', alt: '#50677f', line: 'rgba(142, 194, 236, 0.35)', accent: '#72d4ff' },
          archive: { base: '#716c68', alt: '#68635f', line: 'rgba(203, 198, 191, 0.3)', accent: '#d3bd9e' },
        },
      };
    }
    return {
      floorBase: '#686f7a',
      floorAlt: '#606873',
      floorInset: '#7a8592',
      grout: 'rgba(198, 212, 197, 0.26)',
      wallBase: '#d5d9df',
      wallShade: '#8f97a1',
      wallHighlight: '#f4f7fb',
      terrainBase: '#7d936f',
      terrainAlt: '#738964',
      terrainSpeck: 'rgba(63, 82, 56, 0.35)',
      propWood: '#7d5e45',
      propMetal: '#788b9e',
      propAccent: '#d4a368',
      propPlant: '#6fb86d',
      zoneDivider: 'rgba(205, 222, 232, 0.56)',
      corridorMarker: 'rgba(223, 238, 246, 0.42)',
      districtFloor: {
        lobby: { base: '#80858e', alt: '#767c85', line: 'rgba(202, 214, 226, 0.33)', accent: '#d2ab82' },
        workspace: { base: '#666f7a', alt: '#5f6872', line: 'rgba(192, 207, 220, 0.3)', accent: '#8cb8dd' },
        lab: { base: '#5d6878', alt: '#566171', line: 'rgba(134, 193, 231, 0.35)', accent: '#6fd0e9' },
        archive: { base: '#786857', alt: '#6f5f4f', line: 'rgba(219, 192, 150, 0.3)', accent: '#c79f6a' },
      },
    };
  };

  const drawTownProp = (
    px: number,
    py: number,
    tileW: number,
    tileH: number,
    variant: number,
    palette: ReturnType<typeof buildPalette>,
  ) => {
    const v = variant % 6;
    if (v === 0) {
      ctx.fillStyle = palette.propWood;
      ctx.fillRect(px + tileW * 0.16, py + tileH * 0.24, tileW * 0.68, tileH * 0.56);
      ctx.fillStyle = '#d3b47b';
      ctx.fillRect(px + tileW * 0.22, py + tileH * 0.32, tileW * 0.12, tileH * 0.42);
      ctx.fillStyle = palette.propAccent;
      ctx.fillRect(px + tileW * 0.38, py + tileH * 0.32, tileW * 0.11, tileH * 0.22);
      ctx.fillStyle = '#8fd0f6';
      ctx.fillRect(px + tileW * 0.54, py + tileH * 0.32, tileW * 0.13, tileH * 0.24);
      ctx.fillStyle = '#c86d7d';
      ctx.fillRect(px + tileW * 0.54, py + tileH * 0.62, tileW * 0.18, tileH * 0.12);
      return;
    }
    if (v === 1) {
      ctx.fillStyle = palette.propWood;
      ctx.fillRect(px + tileW * 0.2, py + tileH * 0.36, tileW * 0.62, tileH * 0.42);
      ctx.fillStyle = palette.propMetal;
      ctx.fillRect(px + tileW * 0.26, py + tileH * 0.24, tileW * 0.48, tileH * 0.12);
      ctx.fillStyle = '#b8d7f6';
      ctx.fillRect(px + tileW * 0.34, py + tileH * 0.4, tileW * 0.24, tileH * 0.18);
      return;
    }
    if (v === 2) {
      ctx.fillStyle = palette.propWood;
      ctx.fillRect(px + tileW * 0.36, py + tileH * 0.6, tileW * 0.28, tileH * 0.18);
      ctx.fillStyle = palette.propPlant;
      ctx.fillRect(px + tileW * 0.4, py + tileH * 0.3, tileW * 0.2, tileH * 0.34);
      ctx.fillRect(px + tileW * 0.34, py + tileH * 0.38, tileW * 0.08, tileH * 0.18);
      ctx.fillRect(px + tileW * 0.58, py + tileH * 0.4, tileW * 0.08, tileH * 0.16);
      return;
    }
    if (v === 3) {
      ctx.fillStyle = palette.propMetal;
      ctx.fillRect(px + tileW * 0.2, py + tileH * 0.3, tileW * 0.62, tileH * 0.46);
      ctx.fillStyle = '#112235';
      ctx.fillRect(px + tileW * 0.26, py + tileH * 0.36, tileW * 0.34, tileH * 0.22);
      ctx.fillStyle = '#77d5ff';
      ctx.fillRect(px + tileW * 0.62, py + tileH * 0.38, tileW * 0.14, tileH * 0.1);
      ctx.fillRect(px + tileW * 0.62, py + tileH * 0.53, tileW * 0.14, tileH * 0.08);
      return;
    }
    if (v === 4) {
      ctx.fillStyle = palette.propWood;
      ctx.fillRect(px + tileW * 0.22, py + tileH * 0.44, tileW * 0.22, tileH * 0.34);
      ctx.fillRect(px + tileW * 0.46, py + tileH * 0.34, tileW * 0.3, tileH * 0.44);
      ctx.fillStyle = '#d2b98a';
      ctx.fillRect(px + tileW * 0.5, py + tileH * 0.42, tileW * 0.22, tileH * 0.08);
      ctx.fillRect(px + tileW * 0.26, py + tileH * 0.52, tileW * 0.14, tileH * 0.07);
      return;
    }
    ctx.fillStyle = palette.propMetal;
    ctx.fillRect(px + tileW * 0.46, py + tileH * 0.28, tileW * 0.08, tileH * 0.46);
    ctx.fillStyle = '#fff3b8';
    ctx.fillRect(px + tileW * 0.39, py + tileH * 0.2, tileW * 0.22, tileH * 0.16);
    ctx.fillStyle = palette.wallShade;
    ctx.fillRect(px + tileW * 0.32, py + tileH * 0.74, tileW * 0.36, tileH * 0.07);
  };

  type DistrictInfo = {
    kind: DistrictKind;
    cellX: number;
    cellY: number;
    localX: number;
    localY: number;
    axis: 'h' | 'v';
  };

  const wrapMod = (value: number, modulo: number) => ((value % modulo) + modulo) % modulo;
  const districtW = 18;
  const districtH = 14;
  const resolveDistrict = (worldTx: number, worldTy: number): DistrictInfo => {
    const cellX = Math.floor(worldTx / districtW);
    const cellY = Math.floor(worldTy / districtH);
    const localX = wrapMod(worldTx, districtW);
    const localY = wrapMod(worldTy, districtH);
    const seed = biomeHash(cellX * 3 + 17, cellY * 5 + 31, sectorX + 199, sectorY + 223);
    const kind: DistrictKind = seed < 0.22
      ? 'lobby'
      : seed < 0.56
        ? 'workspace'
        : seed < 0.8
          ? 'lab'
          : 'archive';
    return {
      kind,
      cellX,
      cellY,
      localX,
      localY,
      axis: seed < 0.5 ? 'h' : 'v',
    };
  };

  const {
    grid, biome, tilePxW, tilePxH, viewLeft, viewTop, viewRight, viewBottom, sectorX, sectorY,
  } = params;
  const palette = buildPalette(biome);
  const sx = clamp(Math.floor(viewLeft), 1, grid.width - 2);
  const sy = clamp(Math.floor(viewTop), 1, grid.height - 2);
  const ex = clamp(Math.ceil(viewRight), 1, grid.width - 2);
  const ey = clamp(Math.ceil(viewBottom), 1, grid.height - 2);
  const tileMin = Math.min(tilePxW, tilePxH);
  const groutW = Math.max(1, Math.floor(tileMin * 0.05));
  const wallDepth = Math.max(1, Math.floor(tileMin * 0.22));
  const wallEdge = Math.max(1, Math.floor(tileMin * 0.08));

  for (let ty = sy; ty <= ey; ty++) {
    for (let tx = sx; tx <= ex; tx++) {
      const blocked = isBlockedTile(grid, tx, ty);
      const px = tx * tilePxW;
      const py = ty * tilePxH;
      const worldTx = tx + (sectorX * Math.max(1, grid.width - 2));
      const worldTy = ty + (sectorY * Math.max(1, grid.height - 2));
      const hashA = biomeHash(worldTx * 2 + 17, worldTy * 2 + 31, sectorX + 53, sectorY + 67);

      if (blocked) {
        ctx.fillStyle = palette.terrainBase;
        ctx.fillRect(px, py, tilePxW, tilePxH);
        if (((worldTx + worldTy + (hashA > 0.5 ? 1 : 0)) & 1) === 0) {
          ctx.fillStyle = palette.terrainAlt;
          ctx.fillRect(px, py, tilePxW, tilePxH);
        }
        if (hashA < 0.12) {
          ctx.fillStyle = palette.terrainSpeck;
          ctx.fillRect(px + tilePxW * 0.2, py + tilePxH * 0.3, Math.max(1, tilePxW * 0.08), Math.max(1, tilePxH * 0.08));
          ctx.fillRect(px + tilePxW * 0.58, py + tilePxH * 0.62, Math.max(1, tilePxW * 0.07), Math.max(1, tilePxH * 0.07));
        }
      } else {
        const district = resolveDistrict(worldTx, worldTy);
        const floorStyle = palette.districtFloor[district.kind];

        ctx.fillStyle = floorStyle.base;
        ctx.fillRect(px, py, tilePxW, tilePxH);
        if (((worldTx + worldTy + district.cellX + district.cellY) & 1) === 0) {
          ctx.fillStyle = floorStyle.alt;
          ctx.fillRect(px, py, tilePxW, tilePxH);
        }

        // District border lines (room/zone separators).
        if (district.localX === 0) {
          ctx.fillStyle = palette.zoneDivider;
          ctx.fillRect(px, py, Math.max(1, groutW), tilePxH);
        }
        if (district.localY === 0) {
          ctx.fillStyle = palette.zoneDivider;
          ctx.fillRect(px, py, tilePxW, Math.max(1, groutW));
        }

        // Main corridor guidance line for each district.
        if (district.axis === 'h' && Math.abs(district.localY - Math.floor(districtH * 0.5)) <= 1) {
          ctx.fillStyle = palette.corridorMarker;
          ctx.fillRect(px, py + tilePxH * 0.36, tilePxW, Math.max(1, tilePxH * 0.26));
        } else if (district.axis === 'v' && Math.abs(district.localX - Math.floor(districtW * 0.5)) <= 1) {
          ctx.fillStyle = palette.corridorMarker;
          ctx.fillRect(px + tilePxW * 0.36, py, Math.max(1, tilePxW * 0.26), tilePxH);
        }

        if ((worldTx % 5) === 0) {
          ctx.fillStyle = floorStyle.line;
          ctx.fillRect(px, py, groutW, tilePxH);
        }
        if ((worldTy % 5) === 0) {
          ctx.fillStyle = floorStyle.line;
          ctx.fillRect(px, py, tilePxW, groutW);
        }

        if (district.kind === 'workspace' && district.localY % 6 === 2 && district.localX % 6 === 1) {
          ctx.fillStyle = floorStyle.accent;
          ctx.fillRect(px + tilePxW * 0.22, py + tilePxH * 0.24, Math.max(1, tilePxW * 0.18), Math.max(1, tilePxH * 0.12));
          ctx.fillStyle = 'rgba(18, 30, 40, 0.38)';
          ctx.fillRect(px + tilePxW * 0.52, py + tilePxH * 0.24, Math.max(1, tilePxW * 0.2), Math.max(1, tilePxH * 0.1));
        } else if (district.kind === 'lab' && district.localX % 5 === 2 && district.localY % 4 === 1) {
          ctx.fillStyle = floorStyle.accent;
          ctx.fillRect(px + tilePxW * 0.28, py + tilePxH * 0.28, Math.max(1, tilePxW * 0.44), Math.max(1, tilePxH * 0.42));
          ctx.fillStyle = 'rgba(210, 241, 255, 0.5)';
          ctx.fillRect(px + tilePxW * 0.38, py + tilePxH * 0.36, Math.max(1, tilePxW * 0.2), Math.max(1, tilePxH * 0.14));
        } else if (district.kind === 'archive' && district.localX % 4 === 0) {
          ctx.fillStyle = 'rgba(221, 184, 130, 0.2)';
          ctx.fillRect(px + tilePxW * 0.12, py + tilePxH * 0.2, Math.max(1, tilePxW * 0.76), Math.max(1, tilePxH * 0.08));
          ctx.fillRect(px + tilePxW * 0.12, py + tilePxH * 0.58, Math.max(1, tilePxW * 0.76), Math.max(1, tilePxH * 0.08));
        } else if (district.kind === 'lobby' && ((district.localX + district.localY) % 7) === 0) {
          ctx.fillStyle = floorStyle.accent;
          ctx.fillRect(px + tilePxW * 0.44, py + tilePxH * 0.26, Math.max(1, tilePxW * 0.12), Math.max(1, tilePxH * 0.5));
          ctx.fillRect(px + tilePxW * 0.28, py + tilePxH * 0.42, Math.max(1, tilePxW * 0.44), Math.max(1, tilePxH * 0.12));
        }

        if (hashA > 0.9) {
          ctx.fillStyle = palette.floorInset;
          ctx.fillRect(
            px + tilePxW * 0.36,
            py + tilePxH * 0.36,
            Math.max(1, tilePxW * 0.28),
            Math.max(1, tilePxH * 0.28),
          );
        }
      }
    }
  }

  for (let ty = sy; ty <= ey; ty++) {
    for (let tx = sx; tx <= ex; tx++) {
      const px = tx * tilePxW;
      const py = ty * tilePxH;
      const blocked = isBlockedTile(grid, tx, ty);
      const worldTx = tx + (sectorX * Math.max(1, grid.width - 2));
      const worldTy = ty + (sectorY * Math.max(1, grid.height - 2));
      const district = resolveDistrict(worldTx, worldTy);
      const hashA = biomeHash(worldTx * 3 + 11, worldTy * 5 + 13, sectorX + 73, sectorY + 79);
      const hashB = biomeHash(worldTx * 7 + 23, worldTy * 9 + 29, sectorX + 89, sectorY + 97);

      if (blocked) {
        const walkNeighbor = (
          !isBlockedTile(grid, tx, ty - 1)
          || !isBlockedTile(grid, tx, ty + 1)
          || !isBlockedTile(grid, tx - 1, ty)
          || !isBlockedTile(grid, tx + 1, ty)
        );
        if (walkNeighbor && hashA > 0.72 && hashA < 0.96) {
          const districtOffset = district.kind === 'lobby'
            ? 0
            : district.kind === 'workspace'
              ? 2
              : district.kind === 'lab'
                ? 4
                : 6;
          drawTownProp(px, py, tilePxW, tilePxH, Math.floor(hashB * 12) + districtOffset, palette);
        }
        if (walkNeighbor && hashA > 0.5 && hashA < 0.54) {
          const plateW = Math.max(1, tilePxW * 0.54);
          const plateH = Math.max(1, tilePxH * 0.14);
          ctx.fillStyle = 'rgba(18, 27, 34, 0.55)';
          ctx.fillRect(px + tilePxW * 0.24, py + tilePxH * 0.78, plateW, plateH);
          ctx.fillStyle = palette.districtFloor[district.kind].accent;
          ctx.fillRect(px + tilePxW * 0.34, py + tilePxH * 0.82, plateW * 0.34, Math.max(1, plateH * 0.45));
        }
        continue;
      }

      if (isBlockedTile(grid, tx, ty - 1)) {
        ctx.fillStyle = palette.wallBase;
        ctx.fillRect(px, py, tilePxW, wallDepth);
        ctx.fillStyle = palette.wallHighlight;
        ctx.fillRect(px, py, tilePxW, wallEdge);
        ctx.fillStyle = palette.wallShade;
        ctx.fillRect(px, py + wallDepth - wallEdge, tilePxW, wallEdge);
      }
      if (isBlockedTile(grid, tx - 1, ty)) {
        ctx.fillStyle = palette.wallBase;
        ctx.fillRect(px, py, wallDepth, tilePxH);
        ctx.fillStyle = palette.wallHighlight;
        ctx.fillRect(px, py, wallEdge, tilePxH);
        ctx.fillStyle = palette.wallShade;
        ctx.fillRect(px + wallDepth - wallEdge, py, wallEdge, tilePxH);
      }
      if (isBlockedTile(grid, tx + 1, ty)) {
        ctx.fillStyle = palette.wallShade;
        ctx.fillRect(px + tilePxW - wallEdge, py, wallEdge, tilePxH);
      }
      if (isBlockedTile(grid, tx, ty + 1)) {
        ctx.fillStyle = 'rgba(19, 26, 31, 0.2)';
        ctx.fillRect(px, py + tilePxH - wallEdge, tilePxW, wallEdge);
      }

      if (!isBlockedTile(grid, tx + 1, ty)) {
        const rightDistrict = resolveDistrict(worldTx + 1, worldTy);
        if (rightDistrict.kind !== district.kind) {
          ctx.fillStyle = palette.zoneDivider;
          ctx.fillRect(px + tilePxW - Math.max(1, groutW), py, Math.max(1, groutW), tilePxH);
        }
      }
      if (!isBlockedTile(grid, tx, ty + 1)) {
        const downDistrict = resolveDistrict(worldTx, worldTy + 1);
        if (downDistrict.kind !== district.kind) {
          ctx.fillStyle = palette.zoneDivider;
          ctx.fillRect(px, py + tilePxH - Math.max(1, groutW), tilePxW, Math.max(1, groutW));
        }
      }
    }
  }
}

type MapHeadquartersLayout = {
  sectorX: number;
  sectorY: number;
  exterior: { minTx: number; maxTx: number; minTy: number; maxTy: number };
  interior: { minTx: number; maxTx: number; minTy: number; maxTy: number };
  outsideDoor: { tx: number; ty: number };
  insideDoor: { tx: number; ty: number };
  outsideSpawn: { tx: number; ty: number };
  insideSpawn: { tx: number; ty: number };
};

function getMapHeadquartersLayout(
  map: TiledMap,
  options: { infiniteExploreEnabled: boolean; sectorX: number; sectorY: number },
): MapHeadquartersLayout | null {
  const { infiniteExploreEnabled, sectorX, sectorY } = options;
  const isHomeSector = !infiniteExploreEnabled || (sectorX === 0 && sectorY === 0);
  if (!isHomeSector) return null;

  const cx = clamp(Math.floor(map.width * 0.5), 20, map.width - 21);
  const cy = clamp(Math.floor(map.height * 0.56), 20, map.height - 21);
  const halfW = 14;
  const halfH = 10;

  const exMinTx = clamp(cx - halfW, 2, map.width - 30);
  const exMaxTx = clamp(exMinTx + (halfW * 2), exMinTx + 10, map.width - 2);
  const exMinTy = clamp(cy - halfH, 2, map.height - 26);
  const exMaxTy = clamp(exMinTy + (halfH * 2), exMinTy + 8, map.height - 2);

  const inMinTx = clamp(exMinTx + 2, exMinTx + 1, exMaxTx - 4);
  const inMaxTx = clamp(exMaxTx - 2, inMinTx + 3, exMaxTx - 1);
  const inMinTy = clamp(exMinTy + 2, exMinTy + 1, exMaxTy - 4);
  const inMaxTy = clamp(exMaxTy - 2, inMinTy + 3, exMaxTy - 1);

  const doorTx = clamp(Math.floor((exMinTx + exMaxTx) * 0.5), exMinTx + 2, exMaxTx - 2);
  const doorTy = exMaxTy;
  const outsideSpawnTy = clamp(doorTy + 2, 2, map.height - 2);
  const insideDoorTy = inMaxTy;
  const insideSpawnTy = clamp(insideDoorTy - 2, inMinTy + 1, inMaxTy);

  return {
    sectorX,
    sectorY,
    exterior: {
      minTx: exMinTx,
      maxTx: exMaxTx,
      minTy: exMinTy,
      maxTy: exMaxTy,
    },
    interior: {
      minTx: inMinTx,
      maxTx: inMaxTx,
      minTy: inMinTy,
      maxTy: inMaxTy,
    },
    outsideDoor: { tx: doorTx + 0.5, ty: doorTy + 0.5 },
    insideDoor: { tx: doorTx + 0.5, ty: insideDoorTy + 0.5 },
    outsideSpawn: { tx: doorTx + 0.5, ty: outsideSpawnTy + 0.5 },
    insideSpawn: { tx: doorTx + 0.5, ty: insideSpawnTy + 0.5 },
  };
}

function drawMapHeadquartersScene(
  ctx: CanvasRenderingContext2D,
  params: {
    layout: MapHeadquartersLayout;
    tilePxW: number;
    tilePxH: number;
    inside: boolean;
    viewLeft: number;
    viewTop: number;
    viewRight: number;
    viewBottom: number;
    nowMs: number;
  },
): void {
  const {
    layout, tilePxW, tilePxH, inside, viewLeft, viewTop, viewRight, viewBottom, nowMs,
  } = params;
  const { exterior, interior } = layout;
  if (
    exterior.maxTx < (viewLeft - 8)
    || exterior.minTx > (viewRight + 8)
    || exterior.maxTy < (viewTop - 8)
    || exterior.minTy > (viewBottom + 8)
  ) {
    return;
  }

  const exX = exterior.minTx * tilePxW;
  const exY = exterior.minTy * tilePxH;
  const exW = (exterior.maxTx - exterior.minTx + 1) * tilePxW;
  const exH = (exterior.maxTy - exterior.minTy + 1) * tilePxH;
  const doorX = layout.outsideDoor.tx * tilePxW;
  const doorY = layout.outsideDoor.ty * tilePxH;

  if (!inside) {
    ctx.fillStyle = 'rgba(18, 24, 34, 0.36)';
    ctx.fillRect(exX - tilePxW * 0.55, exY + tilePxH * 0.62, exW + tilePxW * 1.1, exH + tilePxH * 0.46);

    ctx.fillStyle = '#cfd9e6';
    ctx.fillRect(exX + tilePxW * 0.5, exY + tilePxH * 2.2, exW - tilePxW, exH - tilePxH * 2.7);
    ctx.fillStyle = '#8f9db1';
    ctx.fillRect(exX + tilePxW * 0.5, exY + tilePxH * 2.2, exW - tilePxW, tilePxH * 0.28);
    ctx.fillStyle = '#edf5ff';
    ctx.fillRect(exX + tilePxW * 0.5, exY + tilePxH * 2.2, exW - tilePxW, tilePxH * 0.14);

    ctx.fillStyle = '#7a879a';
    ctx.fillRect(exX + tilePxW * 0.1, exY + tilePxH * 0.9, exW - tilePxW * 0.2, tilePxH * 1.8);
    ctx.fillStyle = '#657488';
    ctx.fillRect(exX + tilePxW * 0.18, exY + tilePxH * 1.12, exW - tilePxW * 0.36, tilePxH * 1.3);
    ctx.fillStyle = '#a6b4c7';
    ctx.fillRect(exX + tilePxW * 0.42, exY + tilePxH * 1.14, exW * 0.16, tilePxH * 0.2);

    ctx.fillStyle = '#84c5e8';
    ctx.fillRect(exX + tilePxW * 2.1, exY + tilePxH * 4.3, tilePxW * 1.2, tilePxH * 0.75);
    ctx.fillRect(exX + exW - tilePxW * 3.3, exY + tilePxH * 4.3, tilePxW * 1.2, tilePxH * 0.75);
    ctx.fillRect(exX + tilePxW * 4.6, exY + tilePxH * 4.1, exW - tilePxW * 9.2, tilePxH * 0.9);

    ctx.fillStyle = '#4e5a6c';
    ctx.fillRect(doorX - tilePxW * 1.15, doorY - tilePxH * 1.6, tilePxW * 2.3, tilePxH * 1.9);
    ctx.fillStyle = '#87cbf2';
    ctx.fillRect(doorX - tilePxW * 0.95, doorY - tilePxH * 1.4, tilePxW * 1.9, tilePxH * 0.58);
    ctx.fillStyle = '#232e3f';
    ctx.fillRect(doorX - tilePxW * 0.88, doorY - tilePxH * 0.78, tilePxW * 1.76, tilePxH * 1.02);
    ctx.fillStyle = '#d8f2ff';
    ctx.fillRect(doorX - tilePxW * 0.72, doorY - tilePxH * 0.62, tilePxW * 0.6, tilePxH * 0.18);
    ctx.fillRect(doorX + tilePxW * 0.12, doorY - tilePxH * 0.62, tilePxW * 0.6, tilePxH * 0.18);

    const pulse = 0.45 + Math.sin(nowMs / 280) * 0.18;
    ctx.fillStyle = `rgba(255, 222, 118, ${Math.max(0.2, pulse)})`;
    ctx.fillRect(doorX - tilePxW * 1.55, doorY - tilePxH * 0.2, tilePxW * 3.1, tilePxH * 0.24);
    return;
  }

  const vx = Math.floor(viewLeft) * tilePxW;
  const vy = Math.floor(viewTop) * tilePxH;
  const vw = (Math.ceil(viewRight) - Math.floor(viewLeft) + 1) * tilePxW;
  const vh = (Math.ceil(viewBottom) - Math.floor(viewTop) + 1) * tilePxH;
  ctx.fillStyle = 'rgba(9, 14, 22, 0.62)';
  ctx.fillRect(vx, vy, vw, vh);

  const inX = interior.minTx * tilePxW;
  const inY = interior.minTy * tilePxH;
  const inW = (interior.maxTx - interior.minTx + 1) * tilePxW;
  const inH = (interior.maxTy - interior.minTy + 1) * tilePxH;

  ctx.fillStyle = '#6f7684';
  ctx.fillRect(inX, inY, inW, inH);
  for (let ty = interior.minTy; ty <= interior.maxTy; ty++) {
    for (let tx = interior.minTx; tx <= interior.maxTx; tx++) {
      const px = tx * tilePxW;
      const py = ty * tilePxH;
      const even = ((tx + ty) & 1) === 0;
      ctx.fillStyle = even ? '#7c8695' : '#727d8c';
      ctx.fillRect(px, py, tilePxW, tilePxH);
      if ((tx % 4) === 0) {
        ctx.fillStyle = 'rgba(210, 225, 242, 0.16)';
        ctx.fillRect(px, py, Math.max(1, tilePxW * 0.08), tilePxH);
      }
      if ((ty % 4) === 0) {
        ctx.fillStyle = 'rgba(210, 225, 242, 0.16)';
        ctx.fillRect(px, py, tilePxW, Math.max(1, tilePxH * 0.08));
      }
    }
  }

  ctx.fillStyle = '#dfe7f3';
  ctx.fillRect(inX, inY, inW, Math.max(2, tilePxH * 0.32));
  ctx.fillRect(inX, inY + inH - Math.max(2, tilePxH * 0.32), inW, Math.max(2, tilePxH * 0.32));
  ctx.fillRect(inX, inY, Math.max(2, tilePxW * 0.3), inH);
  ctx.fillRect(inX + inW - Math.max(2, tilePxW * 0.3), inY, Math.max(2, tilePxW * 0.3), inH);

  const splitX = inX + inW * 0.52;
  ctx.fillStyle = '#c6d2e0';
  ctx.fillRect(splitX - tilePxW * 0.14, inY + tilePxH * 1.6, tilePxW * 0.28, inH - tilePxH * 4.1);

  ctx.fillStyle = '#7f5f48';
  for (let i = 0; i < 4; i++) {
    const dx = inX + tilePxW * (1.8 + i * 1.8);
    const dy = inY + tilePxH * 2.2;
    ctx.fillRect(dx, dy, tilePxW * 1.3, tilePxH * 0.7);
    ctx.fillStyle = '#85c7ea';
    ctx.fillRect(dx + tilePxW * 0.28, dy + tilePxH * 0.12, tilePxW * 0.72, tilePxH * 0.32);
    ctx.fillStyle = '#7f5f48';
  }

  ctx.fillStyle = '#6d7f9a';
  ctx.fillRect(inX + inW * 0.6, inY + tilePxH * 2.4, tilePxW * 3.4, tilePxH * 2.2);
  ctx.fillStyle = '#90daf0';
  ctx.fillRect(inX + inW * 0.64, inY + tilePxH * 2.66, tilePxW * 2.6, tilePxH * 1.2);
  ctx.fillStyle = '#a1b84f';
  ctx.fillRect(inX + inW * 0.78, inY + tilePxH * 5.15, tilePxW * 0.8, tilePxH * 1.2);
  ctx.fillRect(inX + inW * 0.86, inY + tilePxH * 5.0, tilePxW * 0.72, tilePxH * 1.1);

  const insideDoorX = layout.insideDoor.tx * tilePxW;
  const insideDoorY = layout.insideDoor.ty * tilePxH;
  const exitPulse = 0.32 + Math.sin(nowMs / 230) * 0.14;
  ctx.fillStyle = '#3f5067';
  ctx.fillRect(insideDoorX - tilePxW * 1.05, insideDoorY - tilePxH * 1.2, tilePxW * 2.1, tilePxH * 1.35);
  ctx.fillStyle = `rgba(255, 236, 144, ${Math.max(0.2, exitPulse)})`;
  ctx.fillRect(insideDoorX - tilePxW * 1.25, insideDoorY - tilePxH * 0.26, tilePxW * 2.5, tilePxH * 0.2);
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

function loadConwayRuntimeState(): ConwayRuntimeState {
  const loaded = loadFromStorage<ConwayRuntimeState>(MAP_CONWAY_RUNTIME_STORAGE_KEY);
  if (!loaded || typeof loaded !== 'object') return { ...CONWAY_RUNTIME_DEFAULT };
  return {
    sandboxId: typeof loaded.sandboxId === 'string' ? loaded.sandboxId : '',
    status: typeof loaded.status === 'string' && loaded.status ? loaded.status : 'idle',
    publicUrl: typeof loaded.publicUrl === 'string' ? loaded.publicUrl : '',
    lastRunStatus: typeof loaded.lastRunStatus === 'string' ? loaded.lastRunStatus : '',
    lastRunAt: Number.isFinite(loaded.lastRunAt) ? Math.max(0, Number(loaded.lastRunAt)) : 0,
    updatedAt: Number.isFinite(loaded.updatedAt) ? Math.max(0, Number(loaded.updatedAt)) : 0,
  };
}

function pickConwayText(value: unknown, maxLen = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLen);
}

function normalizeConwayIntent(value: unknown): AgentMindIntent | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'patrol'
    || normalized === 'observe'
    || normalized === 'chat'
    || normalized === 'farm'
    || normalized === 'trade'
    || normalized === 'rest'
  ) {
    return normalized;
  }
  return null;
}

function parseConwayTownPlan(rawOutput: string): ConwayTownPlan | null {
  const text = rawOutput.trim();
  if (!text) return null;
  const candidates: string[] = [];
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) candidates.push(fencedMatch[1].trim());
  candidates.push(text);

  for (const candidate of candidates) {
    const jsonCandidates = [candidate];
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonCandidates.push(candidate.slice(firstBrace, lastBrace + 1));
    }
    for (const fragment of jsonCandidates) {
      try {
        const parsed = JSON.parse(fragment) as unknown;
        if (!parsed || typeof parsed !== 'object') continue;
        const node = parsed as Record<string, unknown>;
        const rawAgents = node.agents ?? node.npcs ?? node.characters ?? node.directives;
        if (!Array.isArray(rawAgents)) continue;
        const agents: ConwayTownDirective[] = rawAgents
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .map((item) => ({
            id: pickConwayText(item.id, 80),
            name: pickConwayText(item.name, 80),
            thought: pickConwayText(item.thought, 80),
            status: pickConwayText(item.status, 64),
            intent: pickConwayText(item.intent, 16),
          }))
          .filter((item) => Boolean(item.id || item.name) && Boolean(item.thought || item.status || item.intent));
        if (agents.length <= 0) continue;
        const broadcast = pickConwayText(
          node.broadcast ?? node.announcement ?? node.summary ?? node.message,
          120,
        );
        return {
          agents,
          broadcast,
        };
      } catch {
        // Continue trying the next fragment candidate.
      }
    }
  }

  return null;
}

function isHexHashLike(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isHexSignatureLike(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{130,}$/.test(value);
}

function isHexTxHashLike(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function toAgentActionReceiptMaterial(
  entry: AgentActionLog,
  previousReceiptHash: string,
): string {
  return JSON.stringify({
    protocol: MAP_AGENT_INTENT_PROTOCOL,
    tokenId: entry.tokenId,
    tx: entry.tx,
    ty: entry.ty,
    txHash: entry.txHash,
    createdAt: entry.createdAt,
    signer: entry.signer ?? '',
    chainId: entry.chainId ?? 0,
    intentHash: entry.intentHash ?? '',
    signature: entry.signature ?? '',
    payload: entry.payload ?? '',
    previousReceiptHash,
  });
}

function buildAgentActionReceiptHash(entry: AgentActionLog, previousReceiptHash: string): string {
  const material = toAgentActionReceiptMaterial(entry, previousReceiptHash);
  return ethers.keccak256(ethers.toUtf8Bytes(material));
}

function verifyAgentActionLog(entry: AgentActionLog): { state: AgentActionLogVerifyState; recovered?: string } {
  if (!entry.payload || !entry.intentHash || !entry.signature) return { state: 'missing' };
  try {
    if (!isHexHashLike(entry.intentHash) || !isHexSignatureLike(entry.signature)) {
      return { state: 'invalid' };
    }
    const bytes = ethers.toUtf8Bytes(entry.payload);
    const payloadHash = ethers.keccak256(bytes);
    if (payloadHash.toLowerCase() !== entry.intentHash.toLowerCase()) {
      return { state: 'invalid' };
    }
    if (!entry.previousReceiptHash || !isHexHashLike(entry.previousReceiptHash)) {
      return { state: 'invalid' };
    }
    if (!entry.receiptHash || !isHexHashLike(entry.receiptHash)) {
      return { state: 'invalid' };
    }
    const rebuiltReceiptHash = buildAgentActionReceiptHash(entry, entry.previousReceiptHash);
    if (rebuiltReceiptHash.toLowerCase() !== entry.receiptHash.toLowerCase()) {
      return { state: 'invalid' };
    }
    const recovered = ethers.verifyMessage(bytes, entry.signature);
    if (entry.signer && recovered.toLowerCase() !== entry.signer.toLowerCase()) {
      return { state: 'invalid', recovered };
    }
    return { state: 'verified', recovered };
  } catch {
    return { state: 'invalid' };
  }
}

function loadAgentActionLogs(): AgentActionLog[] {
  const loaded = loadFromStorage<AgentActionLog[]>(MAP_AGENT_ACTION_LOG_STORAGE_KEY);
  if (!Array.isArray(loaded)) return [];
  const normalized: AgentActionLog[] = [];
  for (const item of loaded) {
    if (!item || !Number.isFinite(item.tokenId) || !Number.isFinite(item.tx) || !Number.isFinite(item.ty) || !isHexTxHashLike(item.txHash)) {
      continue;
    }
    const next: AgentActionLog = {
      tokenId: Math.max(0, Math.floor(Number(item.tokenId))),
      tx: round1(Number(item.tx)),
      ty: round1(Number(item.ty)),
      txHash: item.txHash,
      createdAt: Number.isFinite(item.createdAt) ? Math.max(0, Math.floor(Number(item.createdAt))) : 0,
    };
    if (typeof item.signer === 'string' && ethers.isAddress(item.signer)) {
      next.signer = item.signer;
    }
    if (Number.isFinite(item.chainId)) {
      next.chainId = Math.max(1, Number(item.chainId));
    }
    if (typeof item.payload === 'string' && item.payload.length > 0 && item.payload.length <= 5000) {
      next.payload = item.payload;
    }
    if (isHexHashLike(item.intentHash)) {
      next.intentHash = item.intentHash;
    }
    if (isHexSignatureLike(item.signature)) {
      next.signature = item.signature;
    }
    if (isHexHashLike(item.previousReceiptHash)) {
      next.previousReceiptHash = item.previousReceiptHash;
    }
    if (isHexHashLike(item.receiptHash)) {
      next.receiptHash = item.receiptHash;
    }
    normalized.push(next);
    if (normalized.length >= MAP_AGENT_ACTION_LOG_MAX) break;
  }

  if (normalized.length === 0) return normalized;
  // Ensure hash chain integrity for old records.
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    const olderReceiptHash = i === normalized.length - 1
      ? MAP_AGENT_RECEIPT_GENESIS_HASH
      : (normalized[i + 1].receiptHash ?? MAP_AGENT_RECEIPT_GENESIS_HASH);
    const previousReceiptHash = normalized[i].previousReceiptHash ?? olderReceiptHash;
    normalized[i].previousReceiptHash = previousReceiptHash;
    normalized[i].receiptHash = normalized[i].receiptHash ?? buildAgentActionReceiptHash(normalized[i], previousReceiptHash);
  }
  return normalized;
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
  combo: number;
  bestCombo: number;
  lastTalkAt: number;
  lootCollected: number;
  lootQuestRewardClaimed: boolean;
};

const MAP_PLAY_TALK_TARGET = 3;
const MAP_PLAY_COMBO_WINDOW_MS = 6500;
const MAP_PLAY_LOOT_TARGET = 10;
const MAP_PLAY_LOOT_COUNT = 56;
const MAP_PLAY_HIGHSCORE_STORAGE_KEY = 'ga:map:play-highscore-v1';
const MAP_PLAY_HUD_OPEN_STORAGE_KEY = 'ga:map:play-hud-open-v1';
const MAP_WORLD_SAVE_STORAGE_KEY = 'ga:map:world-v2';
const MAP_WORLD_SAVE_TEST_STORAGE_KEY = 'ga:map:test-world-v1';
const MAP_WORLD_SAVE_VERSION = 1;
const MIROFISH_GRAPH_ID_STORAGE_KEY = 'ga:mirofish:graph-id-v1';
const MIROFISH_API_BASE_STORAGE_KEY = 'ga:mirofish:api-base-v1';
const MIROFISH_PROJECT_ID_STORAGE_KEY = 'ga:mirofish:project-id-v1';
const MIROFISH_TASK_ID_STORAGE_KEY = 'ga:mirofish:task-id-v1';
const MIROFISH_LEGACY_LOCAL_API_BASE = 'http://127.0.0.1:5001';
const MIROFISH_LEGACY_GRAPH_ONLY_PUBLIC_API_BASE = 'https://mirofish-backend-production.up.railway.app';
const MIROFISH_DEFAULT_PUBLIC_API_BASE = 'https://mirofish-backend-full-production.up.railway.app';
const MIROFISH_MAX_IMPORTED_NODES = 180;
const MIROFISH_MAX_VISIBLE_CONNECTIONS = 12;
const MIROFISH_DEFAULT_CHUNK_SIZE = 500;
const MIROFISH_DEFAULT_CHUNK_OVERLAP = 50;
const MIROFISH_SMOKE_DEMO_PRESET: MiroFishDemoPreset = {
  label: 'Binance AI Town Demo',
  apiBase: 'https://mirofish-backend-full-production.up.railway.app',
  projectId: 'proj_b1de2521cbc7',
  graphId: 'mirofish_0b93b58a2a604e3d',
  taskId: '5dbf039a-0817-4105-a312-18665a84f8ef',
  simulationId: 'sim_f1ef97ecb8d7',
  prepareTaskId: '3d1758d5-3997-4cbe-8d29-55e1304533eb',
  reportId: 'report_f873949eed3a',
  interviewPrompt: '你在 Pixel Town 当前事件里承担什么角色？',
  profilePlatform: 'reddit',
  runPlatform: 'parallel',
  maxRounds: 3,
};
const MAP_ADVENTURE_DISCOVERY_HISTORY_LIMIT = 420;
const MAP_RPG_ENEMY_COUNT = 18;
const MAP_RPG_ATTACK_RANGE = 1.45;
const MAP_RPG_ATTACK_COOLDOWN_MS = 420;
const MAP_RPG_SKILL_RANGE = 2.25;
const MAP_RPG_SKILL_COOLDOWN_MS = 7_800;
const MAP_RPG_SKILL_MP_COST = 12;
const MAP_RPG_ENEMY_ATTACK_COOLDOWN_MS = 820;
const MAP_RPG_ENEMY_RESPAWN_MS = 5200;
const MAP_RPG_POTION_HEAL_RATIO = 0.45;
const MAP_RPG_POTION_MP_RATIO = 0.5;

const MAP_RPG_ENEMY_BASE: Record<MapRpgEnemyKind, {
  maxHp: number;
  atk: number;
  def: number;
  speed: number;
  rewardXp: number;
  rewardGold: number;
}> = {
  slime: { maxHp: 34, atk: 6, def: 1, speed: 0.066, rewardXp: 18, rewardGold: 9 },
  boar: { maxHp: 52, atk: 9, def: 3, speed: 0.074, rewardXp: 26, rewardGold: 14 },
  wisp: { maxHp: 44, atk: 8, def: 2, speed: 0.081, rewardXp: 23, rewardGold: 12 },
};

function getMapRpgXpToNext(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  return 160 + Math.floor((safeLevel - 1) * 85 + Math.pow(safeLevel - 1, 1.22) * 28);
}

function createDefaultMapRpgPlayerState(): MapRpgPlayerState {
  const level = 1;
  return {
    level,
    xp: 0,
    xpToNext: getMapRpgXpToNext(level),
    hp: 120,
    maxHp: 120,
    mp: 38,
    maxMp: 38,
    atk: 14,
    def: 6,
    gold: 0,
    kills: 0,
    hpPotion: 2,
    mpPotion: 2,
    lastAttackAt: 0,
    lastSkillAt: 0,
    lastDamageAt: 0,
  };
}

function createMapRpgQuest(level: number, completedCount: number): MapRpgQuest {
  const safeLevel = Math.max(1, Math.floor(level));
  const safeCompleted = Math.max(0, Math.floor(completedCount));
  const target = 6 + Math.min(8, Math.floor(safeLevel * 0.65) + (safeCompleted % 4));
  const rewardXp = 120 + target * 18 + safeLevel * 14;
  const rewardGold = 32 + target * 10 + safeLevel * 6;
  return {
    id: `rpg-quest-${Date.now()}-${safeCompleted}-${safeLevel}`,
    titleZh: '清理异常仓位',
    titleEn: 'Clear Rogue Positions',
    target,
    progress: 0,
    rewardXp,
    rewardGold,
  };
}

function pickMapRpgEnemyKind(biome: 'forest' | 'desert' | 'snow', rnd: () => number): MapRpgEnemyKind {
  const roll = rnd();
  if (biome === 'desert') {
    if (roll < 0.52) return 'boar';
    if (roll < 0.86) return 'slime';
    return 'wisp';
  }
  if (biome === 'snow') {
    if (roll < 0.57) return 'wisp';
    if (roll < 0.88) return 'slime';
    return 'boar';
  }
  if (roll < 0.56) return 'slime';
  if (roll < 0.86) return 'boar';
  return 'wisp';
}

function spawnMapRpgEnemiesForRegion(
  map: TiledMap,
  grid: MapCollisionGrid | null,
  sectorX: number,
  sectorY: number,
  biome: 'forest' | 'desert' | 'snow',
  count = MAP_RPG_ENEMY_COUNT,
): MapRpgEnemy[] {
  const seed = (
    Math.imul((sectorX + 513) >>> 0, 92837111)
    ^ Math.imul((sectorY + 827) >>> 0, 689287499)
    ^ Math.imul(map.width + map.height + 37, 2654435761)
  ) >>> 0;
  const rnd = createSeededRandom(seed);
  const enemies: MapRpgEnemy[] = [];
  const used = new Set<string>();
  let attempts = 0;
  const maxAttempts = Math.max(280, count * 54);
  while (enemies.length < count && attempts < maxAttempts) {
    attempts += 1;
    let tx = clamp(Math.floor(2 + rnd() * Math.max(1, map.width - 4)), 2, map.width - 3);
    let ty = clamp(Math.floor(2 + rnd() * Math.max(1, map.height - 4)), 2, map.height - 3);
    if (grid) {
      const normalized = normalizeWalkableTarget(map, grid, tx, ty, rnd);
      tx = clamp(normalized.targetTx, 2, map.width - 3);
      ty = clamp(normalized.targetTy, 2, map.height - 3);
    }
    const key = `${tx},${ty}`;
    if (used.has(key)) continue;
    used.add(key);
    const kind = pickMapRpgEnemyKind(biome, rnd);
    const base = MAP_RPG_ENEMY_BASE[kind];
    const eliteRoll = rnd();
    const eliteChance = biome === 'desert' ? 0.13 : biome === 'snow' ? 0.15 : 0.1;
    const isElite = eliteRoll < eliteChance;
    const hpMul = isElite ? 1.75 : 1;
    const atkMul = isElite ? 1.28 : 1;
    const defMul = isElite ? 1.22 : 1;
    const speedMul = isElite ? 1.08 : 1;
    const rewardMul = isElite ? 2.3 : 1;
    const phase = rnd() * Math.PI * 2;
    const offsetX = (rnd() - 0.5) * 0.35;
    const offsetY = (rnd() - 0.5) * 0.35;
    const spawnTx = clamp(tx + offsetX, 1.6, map.width - 1.6);
    const spawnTy = clamp(ty + offsetY, 1.6, map.height - 1.6);
    const maxHp = Math.max(12, Math.floor(base.maxHp * hpMul));
    enemies.push({
      id: `enemy-${sectorX}-${sectorY}-${enemies.length}`,
      kind,
      isElite,
      tx: spawnTx,
      ty: spawnTy,
      hp: maxHp,
      maxHp,
      atk: Math.max(1, Math.floor(base.atk * atkMul)),
      def: Math.max(0, Math.floor(base.def * defMul)),
      speed: base.speed * speedMul,
      rewardXp: Math.max(1, Math.floor(base.rewardXp * rewardMul)),
      rewardGold: Math.max(1, Math.floor(base.rewardGold * rewardMul)),
      targetTx: spawnTx,
      targetTy: spawnTy,
      sectorX,
      sectorY,
      phase,
      lastActionAt: 0,
      isDead: false,
      respawnAt: 0,
    });
  }
  return enemies;
}

const MAP_PLAYER_AVATAR_SPRITE_DEFAULT = MAP_HUMAN_SPRITE_KEYS[0] ?? 'Abigail';
const MAP_PLAYER_AVATAR_DEFAULT: MapPlayerAvatarConfig = {
  displayName: 'YOU',
  style: 'pixel',
  spriteKey: MAP_PLAYER_AVATAR_SPRITE_DEFAULT,
  skinColor: '#f2d0b4',
  hairColor: '#2f2a26',
  outfitColor: '#4f8f61',
  accentColor: '#f3d66c',
  hairStyle: 'short',
  accessory: 'none',
};

function sanitizeHexColor(input: unknown, fallback: string): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}

function normalizeMapPlayerAvatar(input: Partial<MapPlayerAvatarConfig> | null | undefined): MapPlayerAvatarConfig {
  const safe = input ?? {};
  const displayNameRaw = String(safe.displayName ?? MAP_PLAYER_AVATAR_DEFAULT.displayName).trim();
  const displayName = displayNameRaw.length > 0
    ? displayNameRaw.slice(0, 18)
    : MAP_PLAYER_AVATAR_DEFAULT.displayName;
  const style: MapPlayerAvatarStyle = safe.style === 'sprite' || safe.style === 'pixel'
    ? safe.style
    : MAP_PLAYER_AVATAR_DEFAULT.style;
  const spriteKeyCandidate = typeof safe.spriteKey === 'string' ? safe.spriteKey : '';
  const spriteKey = MAP_HUMAN_SPRITE_KEYS.includes(spriteKeyCandidate as typeof MAP_HUMAN_SPRITE_KEYS[number])
    ? spriteKeyCandidate
    : MAP_PLAYER_AVATAR_DEFAULT.spriteKey;
  const hairStyle: MapPlayerAvatarHairStyle = safe.hairStyle === 'spiky' || safe.hairStyle === 'ponytail' || safe.hairStyle === 'short'
    ? safe.hairStyle
    : MAP_PLAYER_AVATAR_DEFAULT.hairStyle;
  const accessory: MapPlayerAvatarAccessory = safe.accessory === 'cap' || safe.accessory === 'glasses' || safe.accessory === 'scarf' || safe.accessory === 'none'
    ? safe.accessory
    : MAP_PLAYER_AVATAR_DEFAULT.accessory;

  return {
    displayName,
    style,
    spriteKey,
    skinColor: sanitizeHexColor(safe.skinColor, MAP_PLAYER_AVATAR_DEFAULT.skinColor),
    hairColor: sanitizeHexColor(safe.hairColor, MAP_PLAYER_AVATAR_DEFAULT.hairColor),
    outfitColor: sanitizeHexColor(safe.outfitColor, MAP_PLAYER_AVATAR_DEFAULT.outfitColor),
    accentColor: sanitizeHexColor(safe.accentColor, MAP_PLAYER_AVATAR_DEFAULT.accentColor),
    hairStyle,
    accessory,
  };
}

const MAP_ADVENTURE_QUEST_PRESETS: Array<{
  type: MapAdventureQuestType;
  minTarget: number;
  maxTarget: number;
  rewardProgress: number;
  rewardPoints: number;
  biomeLockChance: number;
}> = [
  { type: 'explore', minTarget: 2, maxTarget: 4, rewardProgress: 72, rewardPoints: 90, biomeLockChance: 0.76 },
  { type: 'talk', minTarget: 2, maxTarget: 5, rewardProgress: 58, rewardPoints: 76, biomeLockChance: 0.62 },
  { type: 'loot', minTarget: 4, maxTarget: 8, rewardProgress: 66, rewardPoints: 84, biomeLockChance: 0.82 },
];

type MapPlayLoot = {
  id: string;
  tx: number;
  ty: number;
  value: number;
  phase: number;
};

type MapRpgEnemyKind = 'slime' | 'boar' | 'wisp';

type MapRpgEnemy = {
  id: string;
  kind: MapRpgEnemyKind;
  isElite: boolean;
  tx: number;
  ty: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  speed: number;
  rewardXp: number;
  rewardGold: number;
  targetTx: number;
  targetTy: number;
  sectorX: number;
  sectorY: number;
  phase: number;
  lastActionAt: number;
  isDead: boolean;
  respawnAt: number;
};

type MapRpgPlayerState = {
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  atk: number;
  def: number;
  gold: number;
  kills: number;
  hpPotion: number;
  mpPotion: number;
  lastAttackAt: number;
  lastSkillAt: number;
  lastDamageAt: number;
};

type MapRpgQuest = {
  id: string;
  titleZh: string;
  titleEn: string;
  target: number;
  progress: number;
  rewardXp: number;
  rewardGold: number;
};

type MapRpgDamageFx = {
  id: string;
  tx: number;
  ty: number;
  text: string;
  color: string;
  createdAt: number;
  expiresAt: number;
};

type MapPlayerAvatarStyle = 'pixel' | 'sprite';
type MapPlayerAvatarHairStyle = 'short' | 'spiky' | 'ponytail';
type MapPlayerAvatarAccessory = 'none' | 'cap' | 'glasses' | 'scarf';

type MapPlayerAvatarConfig = {
  displayName: string;
  style: MapPlayerAvatarStyle;
  spriteKey: string;
  skinColor: string;
  hairColor: string;
  outfitColor: string;
  accentColor: string;
  hairStyle: MapPlayerAvatarHairStyle;
  accessory: MapPlayerAvatarAccessory;
};

type MapWorldSaveData = {
  version: number;
  savedAt: number;
  playModeEnabled: boolean;
  controlledAgentId: string | null;
  infiniteExploreEnabled: boolean;
  infiniteRegion: { x: number; y: number };
  player?: {
    tx: number;
    ty: number;
    direction: 'up' | 'down' | 'left' | 'right';
    sectorX: number;
    sectorY: number;
  };
  playerAvatar?: MapPlayerAvatarConfig;
  camera?: {
    left: number;
    top: number;
  };
  playStats?: MapPlayStats;
  sprintEnergy?: number;
  adventure?: {
    activeQuest?: MapAdventureQuest | null;
    completedCount?: number;
    discoveredRegionKeys?: string[];
  };
  rpg?: {
    player?: Partial<MapRpgPlayerState>;
    quest?: MapRpgQuest | null;
    questCompletedCount?: number;
  };
  hq?: {
    inside?: boolean;
  };
};

function loadMapWorldSave(isTestMap: boolean): MapWorldSaveData | null {
  const loaded = isTestMap
    ? loadFromStorage<MapWorldSaveData>(MAP_WORLD_SAVE_TEST_STORAGE_KEY)
    : (
      loadFromStorage<MapWorldSaveData>(MAP_WORLD_SAVE_STORAGE_KEY)
      ?? loadFromStorage<MapWorldSaveData>(STORAGE_KEYS.world)
    );
  if (!loaded || typeof loaded !== 'object') return null;
  if (Number(loaded.version) !== MAP_WORLD_SAVE_VERSION) return null;
  return loaded;
}

function loadMapRpgState(save: MapWorldSaveData | null): {
  player: MapRpgPlayerState;
  quest: MapRpgQuest;
  questCompletedCount: number;
} {
  const fallback = createDefaultMapRpgPlayerState();
  const saved = save?.rpg?.player;
  const level = Math.max(1, Math.floor(Number(saved?.level ?? fallback.level)));
  const xpToNext = getMapRpgXpToNext(level);
  const maxHp = Math.max(60, Math.floor(Number(saved?.maxHp ?? fallback.maxHp)));
  const maxMp = Math.max(18, Math.floor(Number(saved?.maxMp ?? fallback.maxMp)));
  const normalizedPlayer: MapRpgPlayerState = {
    level,
    xp: clamp(Math.floor(Number(saved?.xp ?? fallback.xp)), 0, xpToNext * 20),
    xpToNext,
    hp: clamp(Math.floor(Number(saved?.hp ?? maxHp)), 1, maxHp),
    maxHp,
    mp: clamp(Math.floor(Number(saved?.mp ?? maxMp)), 0, maxMp),
    maxMp,
    atk: Math.max(5, Math.floor(Number(saved?.atk ?? fallback.atk))),
    def: Math.max(1, Math.floor(Number(saved?.def ?? fallback.def))),
    gold: Math.max(0, Math.floor(Number(saved?.gold ?? fallback.gold))),
    kills: Math.max(0, Math.floor(Number(saved?.kills ?? fallback.kills))),
    hpPotion: Math.max(0, Math.floor(Number(saved?.hpPotion ?? fallback.hpPotion))),
    mpPotion: Math.max(0, Math.floor(Number(saved?.mpPotion ?? fallback.mpPotion))),
    lastAttackAt: Math.max(0, Math.floor(Number(saved?.lastAttackAt ?? 0))),
    lastSkillAt: Math.max(0, Math.floor(Number(saved?.lastSkillAt ?? 0))),
    lastDamageAt: Math.max(0, Math.floor(Number(saved?.lastDamageAt ?? 0))),
  };
  const questCompletedCount = Math.max(0, Math.floor(Number(save?.rpg?.questCompletedCount ?? 0)));
  const questRaw = save?.rpg?.quest;
  const normalizedQuest = questRaw && typeof questRaw === 'object'
    ? {
      id: String(questRaw.id ?? `rpg-quest-${Date.now()}`),
      titleZh: String(questRaw.titleZh ?? '清理异常仓位'),
      titleEn: String(questRaw.titleEn ?? 'Clear Rogue Positions'),
      target: Math.max(1, Math.floor(Number(questRaw.target ?? 8))),
      progress: Math.max(0, Math.floor(Number(questRaw.progress ?? 0))),
      rewardXp: Math.max(10, Math.floor(Number(questRaw.rewardXp ?? 120))),
      rewardGold: Math.max(5, Math.floor(Number(questRaw.rewardGold ?? 36))),
    }
    : createMapRpgQuest(normalizedPlayer.level, questCompletedCount);
  if (normalizedQuest.progress >= normalizedQuest.target) {
    return {
      player: normalizedPlayer,
      quest: createMapRpgQuest(normalizedPlayer.level, questCompletedCount + 1),
      questCompletedCount: questCompletedCount + 1,
    };
  }
  return {
    player: normalizedPlayer,
    quest: normalizedQuest,
    questCompletedCount,
  };
}

function regionKey(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`;
}

function createMapAdventureQuest(cycle: number, sectorX: number, sectorY: number): MapAdventureQuest {
  const seed = (
    Math.imul(cycle + 71, 73856093)
    ^ Math.imul(sectorX + 404, 19349663)
    ^ Math.imul(sectorY + 997, 83492791)
  ) >>> 0;
  const rnd = createSeededRandom(seed);
  const picked = MAP_ADVENTURE_QUEST_PRESETS[Math.floor(rnd() * MAP_ADVENTURE_QUEST_PRESETS.length) % MAP_ADVENTURE_QUEST_PRESETS.length];
  const span = Math.max(0, picked.maxTarget - picked.minTarget);
  const target = picked.minTarget + Math.floor(rnd() * (span + 1));
  const currentBiome = getInfiniteBiome(sectorX, sectorY);
  const biomePool: Array<'forest' | 'desert' | 'snow'> = ['forest', 'desert', 'snow'];
  let biome: MapAdventureQuestBiome = 'any';
  if (rnd() < picked.biomeLockChance) {
    if (rnd() < 0.78) {
      biome = currentBiome;
    } else {
      const shuffled = biomePool
        .map((item) => ({ item, score: rnd() }))
        .sort((a, b) => a.score - b.score)
        .map((item) => item.item);
      biome = shuffled.find((item) => item !== currentBiome) ?? currentBiome;
    }
  }
  return {
    id: `adv-${Date.now()}-${cycle}-${Math.floor(rnd() * 10000)}`,
    type: picked.type,
    biome,
    target: Math.max(1, target),
    progress: 0,
    rewardProgress: picked.rewardProgress + Math.floor(rnd() * 12),
    rewardPoints: picked.rewardPoints + Math.floor(rnd() * 26),
    startedAt: Date.now(),
  };
}

function loadMapAdventureState(
  save: MapWorldSaveData | null,
  initialRegion: { x: number; y: number },
): MapAdventureState {
  const fallbackRegionKey = regionKey(initialRegion.x, initialRegion.y);
  const activeRaw = save?.adventure?.activeQuest;
  const activeQuestParsed = activeRaw && typeof activeRaw === 'object'
    ? {
      id: String(activeRaw.id ?? `adv-${Date.now()}-0`),
      type: activeRaw.type === 'explore' || activeRaw.type === 'talk' || activeRaw.type === 'loot' ? activeRaw.type : 'explore',
      biome: activeRaw.biome === 'forest' || activeRaw.biome === 'desert' || activeRaw.biome === 'snow' || activeRaw.biome === 'any'
        ? activeRaw.biome
        : 'any',
      target: Math.max(1, Math.floor(Number(activeRaw.target ?? 2))),
      progress: Math.max(0, Math.floor(Number(activeRaw.progress ?? 0))),
      rewardProgress: Math.max(12, Math.floor(Number(activeRaw.rewardProgress ?? 60))),
      rewardPoints: Math.max(10, Math.floor(Number(activeRaw.rewardPoints ?? 80))),
      startedAt: Math.max(0, Math.floor(Number(activeRaw.startedAt ?? Date.now()))),
    }
    : null;
  const activeQuest = activeQuestParsed && activeQuestParsed.progress < activeQuestParsed.target
    ? activeQuestParsed
    : null;
  const completedCount = Math.max(0, Math.floor(Number(save?.adventure?.completedCount ?? 0)));
  const savedKeysRaw = Array.isArray(save?.adventure?.discoveredRegionKeys) ? save!.adventure!.discoveredRegionKeys : [];
  const cleanedKeys = savedKeysRaw
    .map((item) => String(item))
    .filter((item) => /^-?\d+,-?\d+$/.test(item))
    .slice(-MAP_ADVENTURE_DISCOVERY_HISTORY_LIMIT);
  const withFallback = cleanedKeys.includes(fallbackRegionKey)
    ? cleanedKeys
    : [...cleanedKeys, fallbackRegionKey];
  return {
    activeQuest,
    completedCount,
    discoveredRegionKeys: withFallback.slice(-MAP_ADVENTURE_DISCOVERY_HISTORY_LIMIT),
  };
}

type InfiniteBiome = 'forest' | 'desert' | 'snow';

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
  const mapBaseCollisionGridRef = useRef<MapCollisionGrid | null>(null);
  const infiniteCollisionGridCacheRef = useRef<Map<string, MapCollisionGrid>>(new Map());
  const nftImageCacheRef = useRef<Map<number, HTMLImageElement | null>>(new Map());
  const nftImageLoadingRef = useRef<Set<number>>(new Set());
  const humanSpriteCacheRef = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const humanSpriteLoadingRef = useRef<Set<string>>(new Set());
  const customPropSpriteCacheRef = useRef<Map<MapCustomPropSpriteKey, HTMLImageElement | null>>(new Map());
  const customPropSpriteLoadingRef = useRef<Set<MapCustomPropSpriteKey>>(new Set());
  const mapDragRef = useRef<{ active: boolean; pointerId: number | null; startX: number; startY: number; startLeft: number; startTop: number }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
  });
  const initialWorldSaveRef = useRef<MapWorldSaveData | null>(loadMapWorldSave(isTestMap));
  const initialWorldSave = initialWorldSaveRef.current;
  const initialInfiniteRegion = (initialWorldSave
    && Number.isFinite(initialWorldSave.infiniteRegion?.x)
    && Number.isFinite(initialWorldSave.infiniteRegion?.y))
    ? { x: Math.round(initialWorldSave.infiniteRegion.x), y: Math.round(initialWorldSave.infiniteRegion.y) }
    : { x: 0, y: 0 };
  const initialSprintEnergy = Number.isFinite(initialWorldSave?.sprintEnergy)
    ? clamp(Number(initialWorldSave?.sprintEnergy ?? 100), 0, 100)
    : 100;
  const initialAdventure = loadMapAdventureState(initialWorldSave, initialInfiniteRegion);
  const initialRpg = loadMapRpgState(initialWorldSave);
  const initialPlayerAvatar = normalizeMapPlayerAvatar(initialWorldSave?.playerAvatar);
  const initialPlayStats: MapPlayStats = (() => {
    const fromSave = initialWorldSave?.playStats;
    if (!fromSave) {
      return {
        score: 0,
        talks: 0,
        questRewardClaimed: false,
        combo: 0,
        bestCombo: 0,
        lastTalkAt: 0,
        lootCollected: 0,
        lootQuestRewardClaimed: false,
      };
    }
    return {
      score: Math.max(0, Math.floor(Number(fromSave.score ?? 0))),
      talks: Math.max(0, Math.floor(Number(fromSave.talks ?? 0))),
      questRewardClaimed: Boolean(fromSave.questRewardClaimed),
      combo: Math.max(0, Math.floor(Number(fromSave.combo ?? 0))),
      bestCombo: Math.max(0, Math.floor(Number(fromSave.bestCombo ?? 0))),
      lastTalkAt: Math.max(0, Math.floor(Number(fromSave.lastTalkAt ?? 0))),
      lootCollected: Math.max(0, Math.floor(Number(fromSave.lootCollected ?? 0))),
      lootQuestRewardClaimed: Boolean(fromSave.lootQuestRewardClaimed),
    };
  })();
  const initialMapHqInside = Boolean(initialWorldSave?.hq?.inside);

  const [map, setMap] = useState<TiledMap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapLoadingStage, setMapLoadingStage] = useState<'fetch' | 'tilesets' | 'finalizing'>('fetch');

  const [settings, setSettings] = useState<AppSettings>(() => {
    const loaded = loadFromStorage<AppSettings>(STORAGE_KEYS.settings);
    if (!loaded) return DEFAULT_SETTINGS;
    return {
      ...DEFAULT_SETTINGS,
      ...loaded,
      ui: {
        ...DEFAULT_SETTINGS.ui,
        ...loaded.ui,
        // Always boot main map with scale=0.7 by default.
        scale: 0.7,
      },
    };
  });
  const [scale, setScale] = useState(() => (isTestMap ? 2.6 : 0.7));
  const [layerName, setLayerName] = useState<string | null>(() => (isTestMap ? '__VISIBLE__' : settings.ui.layerMode));
  const [renderErr, setRenderErr] = useState<string | null>(null);
  const [agentCount, setAgentCount] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentProfileOpen, setAgentProfileOpen] = useState(false);
  const [agentAutoVerify, setAgentAutoVerify] = useState<AgentAutoVerifyState | null>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [placeMode, setPlaceMode] = useState(false);
  const [placementTokenId, setPlacementTokenId] = useState<number | null>(null);
  const [agentPanelNotice, setAgentPanelNotice] = useState('');
  const [agentActionLogs, setAgentActionLogs] = useState<AgentActionLog[]>(() => loadAgentActionLogs());
  const [agentActionPending, setAgentActionPending] = useState(false);
  const [playModeEnabled, setPlayModeEnabled] = useState(initialWorldSave?.playModeEnabled ?? true);
  const [controlledAgentId, setControlledAgentId] = useState<string | null>(
    initialWorldSave?.controlledAgentId ?? 'player_manual',
  );
  const [mapPlayStats, setMapPlayStats] = useState<MapPlayStats>(initialPlayStats);
  const [playNearbyHint, setPlayNearbyHint] = useState('');
  const [mapHqInside, setMapHqInside] = useState<boolean>(initialMapHqInside);
  const [playSprintEnergyUi, setPlaySprintEnergyUi] = useState(initialSprintEnergy);
  const [playSectorLoading, setPlaySectorLoading] = useState(false);
  const [playLootVersion, setPlayLootVersion] = useState(0);
  const [showAdvancedPanels, setShowAdvancedPanels] = useState(false);
  const [advancedWorkbenchOpen, setAdvancedWorkbenchOpen] = useState(false);
  const conwayRuntimeRef = useRef(createConwayRuntimeService());
  const [conwayRuntime, setConwayRuntime] = useState<ConwayRuntimeState>(() => loadConwayRuntimeState());
  const [conwayPending, setConwayPending] = useState(false);
  const [conwayErr, setConwayErr] = useState<string | null>(null);
  const [conwayLastOutput, setConwayLastOutput] = useState('');
  const [conwayApplySummary, setConwayApplySummary] = useState('');
  const [conwayAgentMessage, setConwayAgentMessage] = useState(
    'Binance AI Town market tick: patrol alpha districts, sync market snapshot, and return summary.',
  );
  const miroFishAgentMetaRef = useRef<Record<string, MiroFishGraphAgentMeta>>({});
  const [miroFishApiBase, setMiroFishApiBase] = useState<string>(() => {
    const fromStorage = loadFromStorage<string>(MIROFISH_API_BASE_STORAGE_KEY);
    const fromEnv = typeof import.meta.env.VITE_MIROFISH_API_BASE === 'string' ? import.meta.env.VITE_MIROFISH_API_BASE : '';
    const normalizedStorage = normalizeMiroFishApiBase(fromStorage || '');
    if (
      normalizedStorage
      && normalizedStorage !== MIROFISH_LEGACY_LOCAL_API_BASE
      && normalizedStorage !== MIROFISH_LEGACY_GRAPH_ONLY_PUBLIC_API_BASE
    ) {
      return normalizedStorage;
    }
    return normalizeMiroFishApiBase(fromEnv || MIROFISH_DEFAULT_PUBLIC_API_BASE);
  });
  const [miroFishGraphId, setMiroFishGraphId] = useState<string>(() => {
    const fromStorage = loadFromStorage<string>(MIROFISH_GRAPH_ID_STORAGE_KEY);
    return typeof fromStorage === 'string' ? fromStorage : '';
  });
  const [miroFishProjectId, setMiroFishProjectId] = useState<string>(() => {
    const fromStorage = loadFromStorage<string>(MIROFISH_PROJECT_ID_STORAGE_KEY);
    return typeof fromStorage === 'string' ? fromStorage : '';
  });
  const [miroFishTaskId, setMiroFishTaskId] = useState<string>(() => {
    const fromStorage = loadFromStorage<string>(MIROFISH_TASK_ID_STORAGE_KEY);
    return typeof fromStorage === 'string' ? fromStorage : '';
  });
  const [miroFishProjectName, setMiroFishProjectName] = useState('Binance AI Town Graph Sync');
  const [miroFishSimulationRequirement, setMiroFishSimulationRequirement] = useState(
    '将上传材料转成 Binance AI Town 的项目、人物、代币和事件节点，并映射进市场地图。',
  );
  const [miroFishAdditionalContext, setMiroFishAdditionalContext] = useState(
    '优先保留人物、项目、代币、赛道、地点和关系，适合在市场小镇里映射成可视节点与任务。',
  );
  const [miroFishChunkSize, setMiroFishChunkSize] = useState(MIROFISH_DEFAULT_CHUNK_SIZE);
  const [miroFishChunkOverlap, setMiroFishChunkOverlap] = useState(MIROFISH_DEFAULT_CHUNK_OVERLAP);
  const [miroFishSelectedFiles, setMiroFishSelectedFiles] = useState<File[]>([]);
  const [miroFishProject, setMiroFishProject] = useState<MiroFishProjectData | null>(null);
  const [miroFishTask, setMiroFishTask] = useState<MiroFishTaskData | null>(null);
  const [miroFishGeneratingOntology, setMiroFishGeneratingOntology] = useState(false);
  const [miroFishBuildingGraph, setMiroFishBuildingGraph] = useState(false);
  const [miroFishSyncing, setMiroFishSyncing] = useState(false);
  const [miroFishErr, setMiroFishErr] = useState<string | null>(null);
  const [miroFishNodeCount, setMiroFishNodeCount] = useState(0);
  const [miroFishEdgeCount, setMiroFishEdgeCount] = useState(0);
  const [miroFishSimulationId, setMiroFishSimulationId] = useState('');
  const [miroFishSimulation, setMiroFishSimulation] = useState<MiroFishSimulationData | null>(null);
  const [miroFishPrepareTaskId, setMiroFishPrepareTaskId] = useState('');
  const [miroFishPrepareTask, setMiroFishPrepareTask] = useState<MiroFishAsyncStatusData | null>(null);
  const [miroFishRunStatus, setMiroFishRunStatus] = useState<MiroFishRunStatusData | null>(null);
  const [miroFishProfilesRealtime, setMiroFishProfilesRealtime] = useState<MiroFishProfilesRealtimeData | null>(null);
  const [miroFishProfilePlatform, setMiroFishProfilePlatform] = useState<'reddit' | 'twitter'>('reddit');
  const [miroFishSimulationPlatform, setMiroFishSimulationPlatform] = useState<'parallel' | 'twitter' | 'reddit'>('parallel');
  const [miroFishMaxRounds, setMiroFishMaxRounds] = useState(72);
  const [miroFishSimulationBusy, setMiroFishSimulationBusy] = useState(false);
  const [miroFishInterviewPrompt, setMiroFishInterviewPrompt] = useState(
    '请用一句话说明你在当前图谱和模拟里的角色。',
  );
  const [miroFishInterviewing, setMiroFishInterviewing] = useState(false);
  const [miroFishInterviewResult, setMiroFishInterviewResult] = useState<MiroFishInterviewData | null>(null);
  const [miroFishInterviewByAgentId, setMiroFishInterviewByAgentId] = useState<Record<string, MiroFishInterviewData>>({});
  const [miroFishReportId, setMiroFishReportId] = useState('');
  const [miroFishReportTaskId, setMiroFishReportTaskId] = useState('');
  const [miroFishReportTask, setMiroFishReportTask] = useState<MiroFishAsyncStatusData | null>(null);
  const [miroFishReport, setMiroFishReport] = useState<MiroFishReportData | null>(null);
  const [miroFishReporting, setMiroFishReporting] = useState(false);
  const [miroFishLoadingDemo, setMiroFishLoadingDemo] = useState(false);
  const [miroFishProjectionVersion, setMiroFishProjectionVersion] = useState(0);
  const miroFishFileInputRef = useRef<HTMLInputElement | null>(null);
  const [infiniteExploreEnabled, setInfiniteExploreEnabled] = useState(
    isTestMap ? false : (initialWorldSave?.infiniteExploreEnabled ?? true),
  );
  const [infiniteRegion, setInfiniteRegion] = useState<{ x: number; y: number }>(initialInfiniteRegion);
  const [mapPlayHighScore, setMapPlayHighScore] = useState<number>(() => {
    const loaded = loadFromStorage<number>(MAP_PLAY_HIGHSCORE_STORAGE_KEY);
    const normalized = typeof loaded === 'number' && Number.isFinite(loaded) ? loaded : 0;
    return Math.max(0, Math.floor(normalized));
  });
  const [mapAdventure, setMapAdventure] = useState<MapAdventureState>(initialAdventure);
  const [mapRpgPlayer, setMapRpgPlayer] = useState<MapRpgPlayerState>(initialRpg.player);
  const [mapRpgQuest, setMapRpgQuest] = useState<MapRpgQuest>(initialRpg.quest);
  const [mapRpgQuestCompletedCount, setMapRpgQuestCompletedCount] = useState<number>(initialRpg.questCompletedCount);
  const mapPlayerAvatar = initialPlayerAvatar;
  const discoveredRegionSetRef = useRef<Set<string>>(new Set(initialAdventure.discoveredRegionKeys));
  const adventureQuestCompletionRef = useRef<string | null>(null);
  const mapRpgPlayerRef = useRef<MapRpgPlayerState>(initialRpg.player);
  const mapRpgQuestRef = useRef<MapRpgQuest>(initialRpg.quest);
  const mapRpgQuestCompletedRef = useRef<number>(initialRpg.questCompletedCount);
  const mapRpgEnemiesRef = useRef<MapRpgEnemy[]>([]);
  const mapRpgDamageFxRef = useRef<MapRpgDamageFx[]>([]);
  const mapRpgAttackRequestAtRef = useRef(0);
  const mapRpgAttackHandledAtRef = useRef(0);
  const mapRpgSkillRequestAtRef = useRef(0);
  const mapRpgSkillHandledAtRef = useRef(0);
  const mapRpgUseHpPotionRequestAtRef = useRef(0);
  const mapRpgUseHpPotionHandledAtRef = useRef(0);
  const mapRpgUseMpPotionRequestAtRef = useRef(0);
  const mapRpgUseMpPotionHandledAtRef = useRef(0);
  const playInputRef = useRef<{ up: boolean; down: boolean; left: boolean; right: boolean; run: boolean }>({
    up: false,
    down: false,
    left: false,
    right: false,
    run: false,
  });
  const playSprintEnergyRef = useRef(initialSprintEnergy);
  const playUiLastSyncAtRef = useRef(0);
  const playNearbyHintRef = useRef('');
  const mapHqInsideRef = useRef(initialMapHqInside);
  const playPointTargetRef = useRef<{ tx: number; ty: number } | null>(null);
  const infiniteRegionRef = useRef<{ x: number; y: number }>(initialInfiniteRegion);
  const playLootRef = useRef<MapPlayLoot[]>([]);
  const playLootResetProgressRef = useRef(true);
  const playInteractRequestAtRef = useRef(0);
  const playInteractHandledAtRef = useRef(0);
  const playSectorTransitionRef = useRef<{ active: boolean; until: number; dx: number; dy: number } | null>(null);
  const mapWorldSaveHydratedRef = useRef(false);
  const mapWorldLastPlayerSnapshotRef = useRef<{ tx: number; ty: number; sectorX: number; sectorY: number } | null>(null);

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
  const [marketPulse, setMarketPulse] = useState<MarketPulseData | null>(null);
  const [marketPulseLoading, setMarketPulseLoading] = useState(false);
  const [marketPulseError, setMarketPulseError] = useState<string | null>(null);
  const [chainPulse, setChainPulse] = useState<ChainPulseData | null>(null);
  const [chainPulseLoading, setChainPulseLoading] = useState(false);
  const [chainPulseError, setChainPulseError] = useState<string | null>(null);
  const [binanceSkillsPulse, setBinanceSkillsPulse] = useState<BinanceSkillsPulseData | null>(null);
  const [binanceSkillsLoading, setBinanceSkillsLoading] = useState(false);
  const [binanceSkillsError, setBinanceSkillsError] = useState<string | null>(null);
  const [guestAgentConfigs, setGuestAgentConfigs] = useState<GuestAgentConfig[]>(() => loadGuestAgentConfigs());
  const [guestAgentImportText, setGuestAgentImportText] = useState('');
  const [actionBriefFocusAt, setActionBriefFocusAt] = useState(0);
  const [actionBriefTaskExpanded, setActionBriefTaskExpanded] = useState(false);
  const [activeSkillsMissionId, setActiveSkillsMissionId] = useState<BinanceSkillsMission['id'] | null>(null);
  const [bscLiveChatMessages, setBscLiveChatMessages] = useState<BscLiveChatMessage[]>([]);
  const [bscLiveChatMode, setBscLiveChatMode] = useState<'ai' | 'fallback' | 'idle'>('idle');
  const [npcChatSessions, setNpcChatSessions] = useState<Record<string, MapNpcChatTurn[]>>({});
  const [npcChatDraft, setNpcChatDraft] = useState('');
  const [npcChatPending, setNpcChatPending] = useState(false);
  const [npcChatError, setNpcChatError] = useState<string | null>(null);
  const [mapPlayHudOpen, setMapPlayHudOpen] = useState<boolean>(() => {
    const loaded = loadFromStorage<boolean>(MAP_PLAY_HUD_OPEN_STORAGE_KEY);
    if (typeof loaded === 'boolean') return loaded;
    return false;
  });
  const [topLeftDockOpen, setTopLeftDockOpen] = useState(true);
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
  const agentAutoVerifySeqRef = useRef(0);
  const mapFarmTokenPriceCacheRef = useRef<{ tokenAddress: string; priceUsd: number | null; updatedAt: number }>({
    tokenAddress: '',
    priceUsd: null,
    updatedAt: 0,
  });
  const mapFarmEventSyncTimerRef = useRef<number | null>(null);
  const mapFarmLastSyncAtRef = useRef(0);
  const mapFarmLastRoundRef = useRef<number | null>(null);
  const marketPulseLastRegimeRef = useRef<MarketPulseRegime | null>(null);
  const chainPulseLastModeRef = useRef<ChainPulseMode | null>(null);
  const marketPulseStreamCacheRef = useRef<Record<string, MarketPulseAsset>>({});
  const bnbWorldEventLastRef = useRef('');
  const bscLiveChatSeqRef = useRef(0);
  const bscLiveChatMessagesRef = useRef<BscLiveChatMessage[]>([]);
  const bscLiveChatInFlightRef = useRef(false);
  const npcChatSeqRef = useRef(0);
  const npcChatThreadRef = useRef<HTMLDivElement | null>(null);
  const bscLiveChatContextRef = useRef({
    chainMode: null as ChainPulseMode | null,
    chainAgeText: '--',
    chainGasText: '--',
    chainLoadText: '--',
    worldEventTitle: '',
    action: '',
    zone: '',
    risk: '',
    marketRegime: null as MarketPulseRegime | null,
    bnbChangeText: '--',
    marketReady: false,
    chainReady: false,
    alphaSymbol: '',
    smartMoneySymbol: '',
    socialSymbol: '',
    skillsReady: false,
  });
  const actionBriefCameraLockUntilRef = useRef(0);
  const miroFishSyncSignatureRef = useRef('');
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

  const handleCopyLatestAgentProofHead = async () => {
    if (!latestAgentActionLog?.receiptHash) {
      setAgentPanelNotice(t('暂无可复制的凭证哈希。', 'No proof hash available to copy.'));
      return;
    }
    try {
      await navigator.clipboard.writeText(latestAgentActionLog.receiptHash);
      setAgentPanelNotice(t('已复制最新凭证哈希。', 'Latest proof hash copied.'));
    } catch {
      setAgentPanelNotice(t('复制失败，请手动复制。', 'Copy failed, please copy manually.'));
    }
  };

  const handleExportAgentProofBundle = () => {
    if (agentActionLogs.length <= 0) {
      setAgentPanelNotice(t('暂无可导出的行为凭证。', 'No action proofs to export yet.'));
      return;
    }
    const payload = {
      protocol: MAP_AGENT_INTENT_PROTOCOL,
      exportedAt: Date.now(),
      network: 'bsc',
      nfaAddress: CHAIN_CONFIG.nfaAddress,
      latestProofHead: latestAgentProofHead,
      logs: agentActionLogs,
    };
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `aitown-agent-proofs-${Date.now()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setAgentPanelNotice(t('凭证包已导出。', 'Proof bundle exported.'));
    } catch (error) {
      setAgentPanelNotice(`${t('导出失败', 'Export failed')}: ${pickErrorMessage(error)}`);
    }
  };

  const patchConwayRuntime = (patch: Partial<ConwayRuntimeState>) => {
    setConwayRuntime((prev) => ({
      ...prev,
      ...patch,
      updatedAt: Date.now(),
    }));
  };

  const applyConwayPlanToTown = (plan: ConwayTownPlan, summaryLabel: string) => {
    const now = Date.now();
    const idToIndex = new Map<string, number>();
    const nameToIndex = new Map<string, number>();
    agentsRef.current.forEach((agent, idx) => {
      idToIndex.set(agent.id.toLowerCase(), idx);
      nameToIndex.set(agent.name.toLowerCase(), idx);
    });
    let applied = 0;
    const nextAgents = [...agentsRef.current];
    for (const directive of plan.agents) {
      const keyById = directive.id?.toLowerCase();
      const keyByName = directive.name?.toLowerCase();
      const index = (keyById && idToIndex.has(keyById))
        ? (idToIndex.get(keyById) ?? -1)
        : (keyByName && nameToIndex.has(keyByName))
          ? (nameToIndex.get(keyByName) ?? -1)
          : -1;
      if (index < 0) continue;
      const target = nextAgents[index];
      if (!target || target.id === 'player_manual') continue;
      const intent = normalizeConwayIntent(directive.intent);
      const nextThought = directive.thought;
      const nextStatus = directive.status || (intent ? AGENT_INTENT_STATUS[intent] : undefined);
      let changed = false;
      let nextMind = target.mind ?? createAgentMind({ id: target.id, source: target.source, tokenId: target.tokenId });
      if (intent && target.mind.intent !== intent) {
        nextMind = {
          ...nextMind,
          intent,
          currentTask: intent,
          nextDecisionAt: now + 900,
        };
        changed = true;
      }
      if (nextStatus && nextStatus !== target.status) {
        changed = true;
      }
      if (nextThought && nextThought !== target.thought) {
        changed = true;
      }
      if (!changed) continue;
      nextAgents[index] = {
        ...target,
        status: nextStatus || target.status,
        thought: nextThought || target.thought,
        thoughtTimer: nextThought ? (now + 4200) : target.thoughtTimer,
        mind: nextMind,
      };
      applied += 1;
    }
    if (applied > 0) {
      agentsRef.current = nextAgents;
    }
    const summary = `${summaryLabel} ${applied} ${t('个 NPC', 'NPC(s)')}${plan.broadcast ? ` · ${plan.broadcast}` : ''}`;
    setConwayApplySummary(summary);
    setAgentPanelNotice(summary);
    return applied;
  };

  const handleConwayCreateSandbox = async () => {
    if (!conwayConfigured) {
      const msg = t(
        'Conway 未配置：请设置 VITE_CONWAY_PROXY_BASE，并在服务端配置 CONWAY_API_BASE/CONWAY_API_KEY。',
        'Conway not configured: set VITE_CONWAY_PROXY_BASE and server env CONWAY_API_BASE/CONWAY_API_KEY.',
      );
      setConwayErr(msg);
      setAgentPanelNotice(msg);
      return;
    }
    if (conwayPending) return;
    try {
      setConwayPending(true);
      setConwayErr(null);
      setAgentPanelNotice(t('正在创建 Conway sandbox...', 'Creating Conway sandbox...'));
      const created = await conwayRuntimeRef.current.createSandbox({
        name: `aitown-map-${Date.now()}`,
        metadata: {
          account: account ?? '',
          map: 'village',
          mode: isTestMap ? 'test' : 'main',
        },
      });
      patchConwayRuntime({
        sandboxId: created.id,
        status: created.status || 'created',
        publicUrl: created.url ?? '',
      });
      setAgentPanelNotice(t('Conway sandbox 创建成功。', 'Conway sandbox created.'));
    } catch (error) {
      const msg = pickErrorMessage(error);
      setConwayErr(msg);
      setAgentPanelNotice(`${t('Conway 创建失败', 'Conway create failed')}: ${msg}`);
    } finally {
      setConwayPending(false);
    }
  };

  const handleConwaySyncSandbox = async () => {
    if (!conwayConfigured) {
      const msg = t('Conway 未配置。', 'Conway is not configured.');
      setConwayErr(msg);
      setAgentPanelNotice(msg);
      return;
    }
    if (!conwayRuntime.sandboxId) {
      const msg = t('请先创建或填写 sandbox id。', 'Create sandbox or provide sandbox id first.');
      setConwayErr(msg);
      setAgentPanelNotice(msg);
      return;
    }
    if (conwayPending) return;
    try {
      setConwayPending(true);
      setConwayErr(null);
      const info = await conwayRuntimeRef.current.getSandbox(conwayRuntime.sandboxId);
      patchConwayRuntime({
        sandboxId: info.id,
        status: info.status || conwayRuntime.status,
        publicUrl: info.url ?? conwayRuntime.publicUrl,
      });
      setAgentPanelNotice(t('Conway 状态已同步。', 'Conway status synced.'));
    } catch (error) {
      const msg = pickErrorMessage(error);
      setConwayErr(msg);
      setAgentPanelNotice(`${t('Conway 同步失败', 'Conway sync failed')}: ${msg}`);
    } finally {
      setConwayPending(false);
    }
  };

  const handleConwayStopSandbox = async () => {
    if (!conwayConfigured) {
      const msg = t('Conway 未配置。', 'Conway is not configured.');
      setConwayErr(msg);
      setAgentPanelNotice(msg);
      return;
    }
    if (!conwayRuntime.sandboxId) {
      const msg = t('当前没有 sandbox id。', 'No sandbox id yet.');
      setConwayErr(msg);
      setAgentPanelNotice(msg);
      return;
    }
    if (conwayPending) return;
    try {
      setConwayPending(true);
      setConwayErr(null);
      const info = await conwayRuntimeRef.current.stopSandbox(conwayRuntime.sandboxId);
      patchConwayRuntime({
        sandboxId: info.id,
        status: info.status || 'stopped',
        publicUrl: info.url ?? conwayRuntime.publicUrl,
      });
      setAgentPanelNotice(t('Conway sandbox 已停止。', 'Conway sandbox stopped.'));
    } catch (error) {
      const msg = pickErrorMessage(error);
      setConwayErr(msg);
      setAgentPanelNotice(`${t('Conway 停止失败', 'Conway stop failed')}: ${msg}`);
    } finally {
      setConwayPending(false);
    }
  };

  const handleConwayRunAgent = async () => {
    if (!conwayConfigured) {
      const msg = t('Conway 未配置。', 'Conway is not configured.');
      setConwayErr(msg);
      setAgentPanelNotice(msg);
      return;
    }
    if (!conwayRuntime.sandboxId) {
      const msg = t('请先创建 sandbox。', 'Create sandbox first.');
      setConwayErr(msg);
      setAgentPanelNotice(msg);
      return;
    }
    if (!conwayAgentMessage.trim()) {
      const msg = t('请填写 Agent 指令。', 'Enter an agent instruction first.');
      setConwayErr(msg);
      setAgentPanelNotice(msg);
      return;
    }
    if (conwayPending) return;
    try {
      setConwayPending(true);
      setConwayErr(null);
      setAgentPanelNotice(t('正在触发 Conway Agent...', 'Triggering Conway agent...'));
      const result = await conwayRuntimeRef.current.runAgentLoop(conwayRuntime.sandboxId, {
        message: conwayAgentMessage.trim(),
        metadata: {
          account: account ?? '',
          regionX: infiniteRegionRef.current.x,
          regionY: infiniteRegionRef.current.y,
          map: 'village',
        },
      });
      patchConwayRuntime({
        lastRunStatus: result.status || 'accepted',
        lastRunAt: Date.now(),
      });
      const rawOutput = result.output ?? '';
      setConwayLastOutput(rawOutput);
      const plan = parseConwayTownPlan(rawOutput);
      if (!plan) {
        setConwayApplySummary(t('仅返回文本，无结构化指令。', 'Text response only, no structured directives.'));
        setAgentPanelNotice(t('Conway Agent 已执行。', 'Conway agent executed.'));
        return;
      }
      applyConwayPlanToTown(plan, t('已同步', 'Synced'));
    } catch (error) {
      const msg = pickErrorMessage(error);
      setConwayErr(msg);
      setAgentPanelNotice(`${t('Conway 执行失败', 'Conway run failed')}: ${msg}`);
    } finally {
      setConwayPending(false);
    }
  };

  const handleConwayApplyLastOutput = () => {
    if (!conwayLastOutput.trim()) {
      const msg = t('暂无可应用的输出。', 'No output available to apply.');
      setConwayErr(msg);
      setAgentPanelNotice(msg);
      return;
    }
    const plan = parseConwayTownPlan(conwayLastOutput);
    if (!plan) {
      const msg = t('输出不包含结构化指令。', 'Output does not include structured directives.');
      setConwayErr(msg);
      setAgentPanelNotice(msg);
      return;
    }

    setConwayErr(null);
    applyConwayPlanToTown(plan, t('已应用', 'Applied'));
  };

  useEffect(() => {
    mapRpgPlayerRef.current = mapRpgPlayer;
  }, [mapRpgPlayer]);

  useEffect(() => {
    mapRpgQuestRef.current = mapRpgQuest;
  }, [mapRpgQuest]);

  useEffect(() => {
    mapRpgQuestCompletedRef.current = mapRpgQuestCompletedCount;
  }, [mapRpgQuestCompletedCount]);

  useEffect(() => {
    saveToStorage(MAP_CONWAY_RUNTIME_STORAGE_KEY, conwayRuntime);
  }, [conwayRuntime]);

  useEffect(() => {
    if (isTestMap) return;
    const playerName = mapPlayerAvatar.displayName || MAP_PLAYER_AVATAR_DEFAULT.displayName;
    let changed = false;
    agentsRef.current = agentsRef.current.map((agent) => {
      if (agent.id !== 'player_manual') return agent;
      const nextSpriteKey = mapPlayerAvatar.style === 'sprite' ? mapPlayerAvatar.spriteKey : undefined;
      if (agent.name === playerName && agent.spriteKey === nextSpriteKey) return agent;
      changed = true;
      return {
        ...agent,
        name: playerName,
        spriteKey: nextSpriteKey,
      };
    });
    if (changed) {
      setAgentCount(agentsRef.current.length);
    }
  }, [isTestMap, mapPlayerAvatar]);

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
    if (id === 'plant') return t('部署达人', 'Deployment Master');
    if (id === 'harvest') return t('收益快手', 'Yield Runner');
    if (id === 'buy') return t('流动性专家', 'Liquidity Expert');
    return t('情报节点', 'Signal Relay');
  };
  const questDesc = (id: DailyQuestId): string => {
    if (id === 'plant') return t('完成 5 次资源部署', 'Complete 5 deployment actions');
    if (id === 'harvest') return t('完成 3 次收益回收', 'Complete 3 yield claims');
    if (id === 'buy') return t('完成 2 次市场买入', 'Complete 2 market buys');
    return t('与地图角色互动 3 次', 'Interact with map agents 3 times');
  };
  const eventLabel = (id: MapFarmEventId): string => {
    if (id === 'breeze') return t('Alpha 微风', 'Alpha Breeze');
    if (id === 'festival') return t('市场庆典', 'Market Festival');
    if (id === 'rain') return t('流动性补雨', 'Liquidity Rain');
    return t('星图加持', 'Signal Blessing');
  };
  const eventDesc = (id: MapFarmEventId): string => {
    if (id === 'breeze') return t('本地市场活跃提升，行动奖励增加。', 'Local market gains activity and extra action points.');
    if (id === 'festival') return t('全场热度抬升，任务推进更容易。', 'Higher market heat and easier quest progression.');
    if (id === 'rain') return t('流动性恢复更快，适合冲节奏。', 'Liquidity cycles recover faster for tempo runs.');
    return t('情报积分更高，适合冲今日任务。', 'Higher signal points, ideal for daily quest pushes.');
  };
  const adventureQuestLabel = (type: MapAdventureQuestType): string => {
    if (type === 'explore') return t('侦查新区', 'Scout New Districts');
    if (type === 'talk') return t('访谈角色', 'Interview Actors');
    return t('收集信号', 'Collect Signals');
  };
  const adventureBiomeLabel = (biome: MapAdventureQuestBiome): string => {
    if (biome === 'forest') return t('研究带', 'Research Belt');
    if (biome === 'desert') return t('启动沙区', 'Launch Sands');
    if (biome === 'snow') return t('风控冰原', 'Risk Glacier');
    return t('不限分区', 'Any District');
  };
  const adventureQuestDesc = (type: MapAdventureQuestType): string => {
    if (type === 'explore') return t('跨越地图边缘，发现新的市场分区。', 'Cross map edges to discover new market districts.');
    if (type === 'talk') return t('靠近角色按 E 发起访谈。', 'Move close and press E to interview.');
    return t('靠近信号节点并收集。', 'Move close to signal nodes to collect.');
  };
  const mapAdventureCurrentBiome = getInfiniteBiome(infiniteRegion.x, infiniteRegion.y);
  const mapAdventureQuestText = mapAdventure.activeQuest
    ? `${adventureQuestLabel(mapAdventure.activeQuest.type)} · ${adventureBiomeLabel(mapAdventure.activeQuest.biome)} · ${mapAdventure.activeQuest.progress}/${mapAdventure.activeQuest.target}`
    : t('准备生成 Alpha 任务...', 'Preparing alpha quest...');
  const mapAdventureQuestHint = mapAdventure.activeQuest
    ? `${adventureQuestDesc(mapAdventure.activeQuest.type)} · ${t('奖励市场扩张', 'Market Expansion Reward')} +${mapAdventure.activeQuest.rewardProgress} · ${
      mapAdventure.activeQuest.biome === 'any'
        ? t('当前分区均可计数', 'Any current district counts')
        : (
          mapAdventure.activeQuest.biome === mapAdventureCurrentBiome
            ? t('当前分区匹配，可推进任务', 'District matched, progress enabled')
            : t('当前分区不匹配，需前往目标分区', 'District mismatch, move to target district')
        )
    }`
    : t('完成市场扩张后会自动刷新下一条 Alpha 任务。', 'A new alpha quest appears automatically after market expansion.');
  const mapAdventureDiscoveredCount = mapAdventure.discoveredRegionKeys.length;
  const achievementLabel = (id: FarmAchievementId): string => {
    if (id === 'sprout_begins') return t('初始部署', 'First Deployment');
    if (id === 'harvest_rookie') return t('收益新秀', 'Yield Rookie');
    if (id === 'supply_chain') return t('流动性骨干', 'Liquidity Backbone');
    if (id === 'social_rookie') return t('社区火花', 'Community Spark');
    if (id === 'level_climber') return t('成长加速器', 'Level Climber');
    return t('Alpha 信标', 'Alpha Beacon');
  };
  const achievementDesc = (id: FarmAchievementId): string => {
    if (id === 'sprout_begins') return t('累计部署 20 次', 'Deploy 20 times in total');
    if (id === 'harvest_rookie') return t('累计回收 15 次收益', 'Claim yield 15 times in total');
    if (id === 'supply_chain') return t('累计买入 10 次', 'Buy 10 times in total');
    if (id === 'social_rookie') return t('累计互动 12 次', 'Interact with agents 12 times');
    if (id === 'level_climber') return t('等级达到 5 级', 'Reach level 5');
    return t('市场热度达到 3000', 'Reach 3000 market heat');
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

  const advanceAdventureQuest = useCallback((type: MapAdventureQuestType, amount = 1, biome: InfiniteBiome | null = null) => {
    if (amount <= 0 || isTestMap) return;
    setMapAdventure((prev) => {
      const quest = prev.activeQuest;
      if (!quest || quest.type !== type) return prev;
      if (quest.biome !== 'any' && biome && quest.biome !== biome) return prev;
      if (quest.biome !== 'any' && !biome) return prev;
      if (quest.progress >= quest.target) return prev;
      return {
        ...prev,
        activeQuest: {
          ...quest,
          progress: Math.min(quest.target, quest.progress + amount),
        },
      };
    });
  }, [isTestMap]);

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
    () => (map ? buildMapExpansionDecorations(map, mapExpansion.level, infiniteExploreEnabled) : []),
    [map, mapExpansion.level, infiniteExploreEnabled],
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
        title: t('查看 Alpha 指南', 'Open Alpha Guide'),
        desc: t('查看当前市场扩张阶段的玩法与目标。', 'Read gameplay and objectives for the current market expansion stage.'),
      };
    }
    if (key === 'boost') {
      return {
        key,
        title: t('激活热度加速', 'Activate Heat Boost'),
        desc: t('触发热度加速效果，缩短资源成熟时间。', 'Trigger a heat boost to shorten resource maturity time.'),
      };
    }
    if (key === 'supply') {
      return {
        key,
        title: t('领取市场流动性', 'Claim Liquidity Cache'),
        desc: t('补充当前资源库存，保证部署循环不断档。', 'Replenish current resources to keep the deployment loop running.'),
      };
    }
    if (key === 'patrol') {
      return {
        key,
        title: t('发起风控巡查', 'Start Risk Patrol'),
        desc: t('增加社交/热度积分，推动市场扩张进度。', 'Gain social and heat points to push market expansion progress.'),
      };
    }
    if (key === 'shop') {
      return {
        key,
        title: t('打开做市台', 'Open Maker Desk'),
        desc: t('快速打开商店面板进行土地和资源买入。', 'Quickly open the shop panel for land and resource buys.'),
      };
    }
    return {
      key,
      title: t('尝试升级金库', 'Try Vault Upgrade'),
      desc: t('检查并执行升级，提升后续部署效率。', 'Check and execute an upgrade to improve future deployment efficiency.'),
    };
  }, [selectedLandmark, t]);
  const selectedLandmarkLore = useMemo(() => {
    if (!selectedLandmark) return '';
    if (selectedLandmark.kind === 'signboard') return t('记录每次 Alpha 扩张成果与下一阶段目标。', 'Records each alpha expansion result and the next-stage targets.');
    if (selectedLandmark.kind === 'windmill') return t('启动门会放大外部热度，短时提升部署效率。', 'The launch gate amplifies incoming momentum and briefly boosts deployment efficiency.');
    if (selectedLandmark.kind === 'barn') return t('用于快速调拨库存，避免流动性空档。', 'Used for fast inventory dispatch to avoid liquidity gaps.');
    if (selectedLandmark.kind === 'tower') return t('监控分区风险并汇报市场热度。', 'Monitors district risk and reports market heat.');
    if (selectedLandmark.kind === 'market') return t('连接交易、供给与角色行为的核心节点。', 'A core hub connecting trading, supply, and actor behavior.');
    return t('全域解锁后点亮，用于标记 Binance AI Town 进入成熟阶段。', 'Activated after full unlock to mark Binance AI Town entering maturity.');
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

  const resetMapPlayChallenge = () => {
    playSprintEnergyRef.current = 100;
    setPlaySprintEnergyUi(100);
    playNearbyHintRef.current = '';
    setPlayNearbyHint('');
    mapHqInsideRef.current = false;
    setMapHqInside(false);
    infiniteRegionRef.current = { x: 0, y: 0 };
    setInfiniteRegion({ x: 0, y: 0 });
    setMapPlayStats({
      score: 0,
      talks: 0,
      questRewardClaimed: false,
      combo: 0,
      bestCombo: 0,
      lastTalkAt: 0,
      lootCollected: 0,
      lootQuestRewardClaimed: false,
    });
    playLootResetProgressRef.current = true;
    setPlayLootVersion((prev) => prev + 1);
    setAgentPanelNotice(t('挑战已重置，开始新一轮探索。', 'Challenge reset. Start a new exploration run.'));
    window.setTimeout(() => persistMapWorldSave(), 0);
  };

  const buildMapWorldSaveSnapshot = (): MapWorldSaveData => {
    const player = agentsRef.current.find((agent) => agent.id === 'player_manual');
    const wrap = canvasWrapRef.current;
    return {
      version: MAP_WORLD_SAVE_VERSION,
      savedAt: Date.now(),
      playModeEnabled,
      controlledAgentId,
      infiniteExploreEnabled,
      infiniteRegion: { x: infiniteRegionRef.current.x, y: infiniteRegionRef.current.y },
      player: player
        ? {
          tx: round1(player.tx),
          ty: round1(player.ty),
          direction: player.direction ?? 'down',
          sectorX: player.sectorX ?? infiniteRegionRef.current.x,
          sectorY: player.sectorY ?? infiniteRegionRef.current.y,
        }
        : undefined,
      playerAvatar: mapPlayerAvatar,
      camera: wrap
        ? {
          left: Math.max(0, Math.floor(wrap.scrollLeft)),
          top: Math.max(0, Math.floor(wrap.scrollTop)),
        }
        : undefined,
      playStats: mapPlayStats,
      sprintEnergy: round1(playSprintEnergyRef.current),
      adventure: {
        activeQuest: mapAdventure.activeQuest
          ? {
            ...mapAdventure.activeQuest,
            progress: Math.min(mapAdventure.activeQuest.target, Math.max(0, mapAdventure.activeQuest.progress)),
        }
          : null,
        completedCount: mapAdventure.completedCount,
        discoveredRegionKeys: mapAdventure.discoveredRegionKeys.slice(-MAP_ADVENTURE_DISCOVERY_HISTORY_LIMIT),
      },
      rpg: {
        player: mapRpgPlayer,
        quest: {
          ...mapRpgQuest,
          progress: Math.min(mapRpgQuest.target, Math.max(0, mapRpgQuest.progress)),
        },
        questCompletedCount: mapRpgQuestCompletedCount,
      },
      hq: {
        inside: mapHqInsideRef.current,
      },
    };
  };

  const persistMapWorldSave = () => {
    const snapshot = buildMapWorldSaveSnapshot();
    if (isTestMap) {
      saveToStorage(MAP_WORLD_SAVE_TEST_STORAGE_KEY, snapshot);
      return;
    }
    saveToStorage(MAP_WORLD_SAVE_STORAGE_KEY, snapshot);
    saveToStorage(STORAGE_KEYS.world, snapshot);
  };

  const selectedAgent = selectedAgentId
    ? agentsRef.current.find((agent) => agent.id === selectedAgentId) ?? null
    : null;
  const selectedGraphMeta = selectedAgent ? (miroFishAgentMetaRef.current[selectedAgent.id] ?? null) : null;
  const selectedGraphConnections = useMemo(() => {
    if (!selectedGraphMeta) return [] as MiroFishGraphConnection[];
    return selectedGraphMeta.connections.slice(0, MIROFISH_MAX_VISIBLE_CONNECTIONS);
  }, [selectedGraphMeta]);
  const selectedGraphNeighborCount = useMemo(() => {
    if (!selectedGraphMeta) return 0;
    return new Set(selectedGraphMeta.connections.map((connection) => connection.otherNodeUuid)).size;
  }, [selectedGraphMeta]);
  const selectedAgentAutoVerify = selectedAgent && agentAutoVerify?.targetAgentId === selectedAgent.id
    ? agentAutoVerify
    : null;
  const controlledAgent = controlledAgentId
    ? agentsRef.current.find((agent) => agent.id === controlledAgentId) ?? null
    : null;
  const verifyStatusLabel = (status: AgentVerifyUiStatus) => {
    if (status === 'pending') return t('校验中', 'Checking');
    if (status === 'verified') return t('已通过', 'Verified');
    if (status === 'missing') return t('无记录', 'No Record');
    if (status === 'skipped') return t('不适用', 'N/A');
    return t('失败', 'Failed');
  };
  const conwayConfig = conwayRuntimeRef.current.getConfig();
  const conwayConfigured = conwayRuntimeRef.current.isConfigured();
  const conwayModeText = conwayConfig.mode === 'proxy'
    ? t('后端代理', 'Server Proxy')
    : t('直连(开发)', 'Direct (Dev)');
  const conwayLastRunText = conwayRuntime.lastRunAt > 0 ? formatClockTime(conwayRuntime.lastRunAt) : '--:--';
  const conwayApiBaseText = conwayConfig.baseUrl || '--';
  const conwayProjectText = conwayConfig.projectId || '--';
  const latestAgentActionLog = agentActionLogs[0] ?? null;
  const latestAgentProofHead = latestAgentActionLog?.receiptHash ?? MAP_AGENT_RECEIPT_GENESIS_HASH;
  const latestAgentActionVerify = useMemo(
    () => (latestAgentActionLog ? verifyAgentActionLog(latestAgentActionLog) : { state: 'missing' as const }),
    [latestAgentActionLog],
  );
  const verifiedAgentActionCount = useMemo(
    () => agentActionLogs.reduce((count, item) => (verifyAgentActionLog(item).state === 'verified' ? count + 1 : count), 0),
    [agentActionLogs],
  );
  const agentProofChainLinked = useMemo(() => {
    if (agentActionLogs.length <= 0) return true;
    for (let i = 0; i < agentActionLogs.length; i += 1) {
      const current = agentActionLogs[i];
      if (!current.receiptHash || !current.previousReceiptHash) return false;
      const older = agentActionLogs[i + 1];
      if (!older) {
        if (current.previousReceiptHash.toLowerCase() !== MAP_AGENT_RECEIPT_GENESIS_HASH.toLowerCase()) {
          return false;
        }
      } else if (current.previousReceiptHash.toLowerCase() !== older.receiptHash?.toLowerCase()) {
        return false;
      }
    }
    return true;
  }, [agentActionLogs]);
  const latestIntentShort = latestAgentActionLog?.intentHash
    ? `${latestAgentActionLog.intentHash.slice(0, 10)}...${latestAgentActionLog.intentHash.slice(-8)}`
    : '--';
  const mapPlayTalkProgress = Math.min(MAP_PLAY_TALK_TARGET, mapPlayStats.talks);
  const mapPlayQuestDone = mapPlayStats.questRewardClaimed || mapPlayTalkProgress >= MAP_PLAY_TALK_TARGET;
  const mapPlayComboActive = mapPlayStats.combo > 0 && (Date.now() - mapPlayStats.lastTalkAt) <= MAP_PLAY_COMBO_WINDOW_MS;
  const mapPlayLootProgress = Math.min(MAP_PLAY_LOOT_TARGET, mapPlayStats.lootCollected);
  const mapPlayLootQuestDone = mapPlayStats.lootQuestRewardClaimed || mapPlayLootProgress >= MAP_PLAY_LOOT_TARGET;
  const mapPlayLootRemaining = playLootRef.current.length;
  const mapRpgHpPct = clamp(Math.round((mapRpgPlayer.hp / Math.max(1, mapRpgPlayer.maxHp)) * 100), 0, 100);
  const mapRpgMpPct = clamp(Math.round((mapRpgPlayer.mp / Math.max(1, mapRpgPlayer.maxMp)) * 100), 0, 100);
  const mapRpgXpPct = clamp(Math.round((mapRpgPlayer.xp / Math.max(1, mapRpgPlayer.xpToNext)) * 100), 0, 100);
  const mapRpgAttackReady = (Date.now() - mapRpgPlayer.lastAttackAt) >= MAP_RPG_ATTACK_COOLDOWN_MS;
  const mapRpgSkillCooldownLeftMs = Math.max(0, MAP_RPG_SKILL_COOLDOWN_MS - (Date.now() - mapRpgPlayer.lastSkillAt));
  const mapRpgSkillReady = mapRpgSkillCooldownLeftMs <= 0;
  const mapRpgSkillCdText = mapRpgSkillReady ? t('就绪', 'Ready') : `${(mapRpgSkillCooldownLeftMs / 1000).toFixed(1)}s`;
  const mapRpgQuestText = `${t(mapRpgQuest.titleZh, mapRpgQuest.titleEn)} ${Math.min(mapRpgQuest.target, mapRpgQuest.progress)}/${mapRpgQuest.target}`;
  const mapHeadquartersLayout = useMemo(() => {
    if (!map || isTestMap) return null;
    return getMapHeadquartersLayout(map, {
      infiniteExploreEnabled,
      sectorX: infiniteExploreEnabled ? infiniteRegion.x : 0,
      sectorY: infiniteExploreEnabled ? infiniteRegion.y : 0,
    });
  }, [map, isTestMap, infiniteExploreEnabled, infiniteRegion.x, infiniteRegion.y]);
  const mapHqSceneText = mapHqInside ? t('主楼内', 'HQ Interior') : t('户外', 'Outdoors');
  const infiniteBiome = useMemo<InfiniteBiome>(
    () => getInfiniteBiome(infiniteRegion.x, infiniteRegion.y),
    [infiniteRegion.x, infiniteRegion.y],
  );
  const infiniteBiomeLabel = useMemo(() => {
    if (infiniteBiome === 'forest') return t('研究带', 'Research Belt');
    if (infiniteBiome === 'desert') return t('启动沙区', 'Launch Sands');
    return t('风控冰原', 'Risk Glacier');
  }, [infiniteBiome, t]);
  const infiniteSeasonLabel = useMemo(() => {
    if (!map) return t('四季交替', 'Seasonal');
    const sampleTx = Math.floor(map.width * 0.5) + infiniteRegion.x * Math.max(1, map.width - 2);
    const sampleTy = Math.floor(map.height * 0.5) + infiniteRegion.y * Math.max(1, map.height - 2);
    const weights = getSeasonBlendWeights(sampleTx, sampleTy, 0);
    const entries = Object.entries(weights) as Array<[InfiniteSeason, number]>;
    entries.sort((a, b) => b[1] - a[1]);
    const primary = entries[0]?.[0] ?? 'spring';
    if (primary === 'spring') return t('春季', 'Spring');
    if (primary === 'summer') return t('夏季', 'Summer');
    if (primary === 'autumn') return t('秋季', 'Autumn');
    return t('冬季', 'Winter');
  }, [map, infiniteRegion.x, infiniteRegion.y, t]);
  const miroFishProjectStatusText = useMemo(() => {
    const status = miroFishProject?.status || '';
    if (status === 'created') return t('已创建', 'Created');
    if (status === 'ontology_generated') return t('本体完成', 'Ontology Ready');
    if (status === 'graph_building') return t('构建中', 'Building');
    if (status === 'graph_completed') return t('图谱完成', 'Graph Ready');
    if (status === 'failed') return t('失败', 'Failed');
    return status || t('未开始', 'Idle');
  }, [miroFishProject?.status, t]);
  const miroFishTaskStatusText = useMemo(() => {
    const status = miroFishTask?.status || '';
    if (status === 'pending') return t('等待中', 'Pending');
    if (status === 'processing') return t('处理中', 'Processing');
    if (status === 'completed') return t('已完成', 'Completed');
    if (status === 'failed') return t('失败', 'Failed');
    return status || t('无任务', 'No Task');
  }, [miroFishTask?.status, t]);
  const miroFishOntologyEntityCount = miroFishProject?.ontology?.entity_types?.length ?? 0;
  const miroFishOntologyEdgeTypeCount = miroFishProject?.ontology?.edge_types?.length ?? 0;
  const miroFishHasProject = Boolean(miroFishProjectId.trim());
  const miroFishHasSimulation = Boolean(miroFishSimulationId.trim());
  const miroFishSimulationStatusText = useMemo(() => {
    const status = miroFishSimulation?.status || '';
    if (status === 'created') return t('已创建', 'Created');
    if (status === 'preparing') return t('准备中', 'Preparing');
    if (status === 'ready') return t('已就绪', 'Ready');
    if (status === 'running') return t('运行中', 'Running');
    if (status === 'paused') return t('已暂停', 'Paused');
    if (status === 'stopped') return t('已停止', 'Stopped');
    if (status === 'completed') return t('已完成', 'Completed');
    if (status === 'failed') return t('失败', 'Failed');
    return status || t('未创建', 'Idle');
  }, [miroFishSimulation?.status, t]);
  const miroFishPrepareStatusText = useMemo(() => {
    const status = miroFishPrepareTask?.status || '';
    if (status === 'processing' || status === 'preparing') return t('准备中', 'Preparing');
    if (status === 'ready') return t('已就绪', 'Ready');
    if (status === 'completed') return t('已完成', 'Completed');
    if (status === 'not_started') return t('未开始', 'Not Started');
    if (status === 'failed') return t('失败', 'Failed');
    return status || t('无任务', 'No Task');
  }, [miroFishPrepareTask?.status, t]);
  const miroFishRunStatusText = useMemo(() => {
    const status = miroFishRunStatus?.runner_status || '';
    if (status === 'running') return t('运行中', 'Running');
    if (status === 'starting') return t('启动中', 'Starting');
    if (status === 'paused') return t('已暂停', 'Paused');
    if (status === 'stopped') return t('已停止', 'Stopped');
    if (status === 'completed') return t('已完成', 'Completed');
    if (status === 'failed') return t('失败', 'Failed');
    return status || t('空闲', 'Idle');
  }, [miroFishRunStatus?.runner_status, t]);
  const miroFishReportStatusText = useMemo(() => {
    const status = miroFishReport?.status || miroFishReportTask?.status || '';
    if (status === 'generating' || status === 'processing') return t('生成中', 'Generating');
    if (status === 'planning') return t('规划中', 'Planning');
    if (status === 'completed') return t('已完成', 'Completed');
    if (status === 'failed') return t('失败', 'Failed');
    return status || t('未生成', 'Idle');
  }, [miroFishReport?.status, miroFishReportTask?.status, t]);
  const miroFishProfileCountText = useMemo(() => {
    if (!miroFishProfilesRealtime) return '--';
    const total = miroFishProfilesRealtime.total_expected && miroFishProfilesRealtime.total_expected > 0
      ? miroFishProfilesRealtime.total_expected
      : miroFishProfilesRealtime.count;
    return `${miroFishProfilesRealtime.count}/${total}`;
  }, [miroFishProfilesRealtime]);
  const miroFishProfileIndexByIdentity = useMemo(() => {
    const identityToIndex = new Map<string, number>();
    (miroFishProfilesRealtime?.profiles ?? []).forEach((profile, index) => {
      extractMiroFishProfileNames(profile).forEach((value) => {
        const normalized = normalizeMiroFishIdentityText(value);
        if (normalized && !identityToIndex.has(normalized)) {
          identityToIndex.set(normalized, index);
        }
      });
    });
    return identityToIndex;
  }, [miroFishProfilesRealtime]);
  const miroFishGraphProfileMatches = useMemo(() => {
    const matchMap: Record<string, MiroFishGraphProfileMatch> = {};
    if (!miroFishProfilesRealtime) return matchMap;
    for (const agent of agentsRef.current) {
      if (!agent.id.startsWith('graph_')) continue;
      const graphMeta = miroFishAgentMetaRef.current[agent.id];
      if (!graphMeta) continue;
      const lookupKeys = [
        agent.name,
        graphMeta.nodeUuid,
        ...graphMeta.labels,
      ]
        .map((item) => normalizeMiroFishIdentityText(item))
        .filter(Boolean);
      const matchedIndex = lookupKeys
        .map((key) => miroFishProfileIndexByIdentity.get(key))
        .find((index): index is number => typeof index === 'number' && index >= 0);
      if (matchedIndex === undefined) continue;
      const profile = miroFishProfilesRealtime.profiles[matchedIndex];
      if (!profile) continue;
      matchMap[agent.id] = { index: matchedIndex, profile };
    }
    return matchMap;
  }, [miroFishProfileIndexByIdentity, miroFishProfilesRealtime, miroFishNodeCount, miroFishEdgeCount]);
  useEffect(() => {
    if (isTestMap) return undefined;
    let canceled = false;
    const fetchMarketPulse = async (silent = false) => {
      if (!silent) setMarketPulseLoading(true);
      try {
        const query = encodeURIComponent(JSON.stringify(MARKET_PULSE_SYMBOLS));
        let parsed: BinanceTicker24h[] | null = null;
        for (const endpoint of MARKET_PULSE_ENDPOINTS) {
          try {
            const response = await fetch(`${endpoint}?symbols=${query}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            parsed = (await response.json()) as BinanceTicker24h[];
            if (Array.isArray(parsed) && parsed.length > 0) break;
          } catch {
            parsed = null;
          }
        }
        if (!parsed || parsed.length === 0) {
          throw new Error(t('Binance 行情接口暂时不可用。', 'Binance market feed is unavailable right now.'));
        }
        const assets = parsed
          .map((item) => ({
            symbol: item.symbol,
            shortLabel: item.symbol.replace('USDT', ''),
            lastPrice: Number(item.lastPrice),
            changePct: Number(item.priceChangePercent),
            quoteVolume: Number(item.quoteVolume),
            volume: Number(item.volume),
            highPrice: Number(item.highPrice),
            lowPrice: Number(item.lowPrice),
          }))
          .filter((item) => Number.isFinite(item.lastPrice) && Number.isFinite(item.changePct));
        marketPulseStreamCacheRef.current = Object.fromEntries(assets.map((item) => [item.symbol, item]));
        if (canceled) return;
        setMarketPulse(computeMarketPulseFromAssets(assets, t));
        setMarketPulseError(null);
      } catch (error) {
        if (canceled) return;
        setMarketPulseError(pickErrorMessage(error));
      } finally {
        if (!canceled) setMarketPulseLoading(false);
      }
    };
    void fetchMarketPulse(false);
    const timer = window.setInterval(() => {
      void fetchMarketPulse(true);
    }, 60_000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [isTestMap, t]);
  useEffect(() => {
    if (isTestMap) return undefined;
    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    const clearReconnect = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };
    const connect = () => {
      if (closed) return;
      try {
        socket = new WebSocket(MARKET_PULSE_STREAM_URL);
      } catch {
        return;
      }
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as { data?: BinanceMiniTicker };
          const item = parsed.data;
          if (!item || !MARKET_PULSE_SYMBOLS.includes(item.s as typeof MARKET_PULSE_SYMBOLS[number])) return;
          const openPrice = Number(item.o);
          const lastPrice = Number(item.c);
          const changePct = openPrice > 0 ? ((lastPrice - openPrice) / openPrice) * 100 : 0;
          const asset: MarketPulseAsset = {
            symbol: item.s,
            shortLabel: item.s.replace('USDT', ''),
            lastPrice,
            changePct,
            quoteVolume: Number(item.q),
            volume: Number(item.v),
            highPrice: Number(item.h),
            lowPrice: Number(item.l),
          };
          if (!Number.isFinite(asset.lastPrice) || !Number.isFinite(asset.changePct)) return;
          marketPulseStreamCacheRef.current[asset.symbol] = asset;
          const assets = MARKET_PULSE_SYMBOLS
            .map((symbol) => marketPulseStreamCacheRef.current[symbol])
            .filter((value): value is MarketPulseAsset => Boolean(value));
          if (assets.length < MARKET_PULSE_SYMBOLS.length) return;
          setMarketPulse(computeMarketPulseFromAssets(assets, t));
          setMarketPulseError(null);
        } catch {
          // Keep websocket soft-failing; REST polling remains the fallback.
        }
      };
      socket.onclose = () => {
        if (closed) return;
        clearReconnect();
        reconnectTimer = window.setTimeout(connect, 3200);
      };
      socket.onerror = () => {
        try {
          socket?.close();
        } catch {
          // noop
        }
      };
    };
    connect();
    return () => {
      closed = true;
      clearReconnect();
      try {
        socket?.close();
      } catch {
        // noop
      }
    };
  }, [isTestMap, t]);
  useEffect(() => {
    if (isTestMap) return undefined;
    let canceled = false;
    const postRpc = async <T,>(endpoint: string, method: string, params: unknown[] = []): Promise<T> => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method,
            params,
            id: `${method}:${Date.now()}`,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as { result?: T; error?: { message?: string } };
        if (payload.error?.message) throw new Error(payload.error.message);
        if (payload.result === undefined) throw new Error('Missing RPC result');
        return payload.result;
      } finally {
        window.clearTimeout(timeout);
      }
    };
    const fetchNetworkPulse = async (
      key: ChainPulseNetworkKey,
      label: string,
      endpoints: readonly string[],
    ): Promise<ChainPulseNetwork> => {
      let lastError: unknown = null;
      for (const endpoint of endpoints) {
        try {
          const [gasHex, latestBlock] = await Promise.all([
            postRpc<string>(endpoint, 'eth_gasPrice'),
            postRpc<{ number?: string; timestamp?: string; transactions?: string[] }>(endpoint, 'eth_getBlockByNumber', ['latest', false]),
          ]);
          const blockNumber = parseHexToNumber(latestBlock.number);
          const txCount = Array.isArray(latestBlock.transactions) ? latestBlock.transactions.length : 0;
          const blockTimestampSec = parseHexToNumber(latestBlock.timestamp);
          const blockAgeSec = Math.max(0, (Date.now() / 1000) - blockTimestampSec);
          return {
            key,
            label,
            rpc: endpoint,
            blockNumber,
            gasGwei: parseHexToNumber(gasHex) / 1_000_000_000,
            blockAgeSec,
            txCount,
            updatedAt: Date.now(),
          };
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError ?? new Error(`RPC unavailable for ${label}`);
    };
    const fetchChainPulse = async (silent = false) => {
      if (!silent) setChainPulseLoading(true);
      try {
        const bsc = await fetchNetworkPulse('bsc', 'BSC', BNB_CHAIN_RPC_ENDPOINTS.bsc);
        const networks = [bsc];
        const stale = bsc.blockAgeSec >= 20;
        const mainnetBusy = bsc.gasGwei >= 2 || bsc.txCount >= 140;
        let mode: ChainPulseMode = 'balanced';
        if (stale) {
          mode = 'sync-watch';
        } else if (mainnetBusy) {
          mode = 'mainnet-busy';
        }
        const activityScore = clamp(round1(
          (Math.min(bsc.txCount, 220) / 220) * 54
          + Math.max(0, 8 - Math.min(bsc.blockAgeSec, 8)) * 4.2,
        ), 0, 100);
        const pressureScore = clamp(round1(
          (bsc.gasGwei * 24)
          + (bsc.blockAgeSec > 4 ? 12 : 0)
          + (bsc.txCount >= 160 ? 10 : 0),
        ), 0, 100);
        if (canceled) return;
        setChainPulse({
          updatedAt: Date.now(),
          mode,
          activityScore,
          pressureScore,
          networks,
        });
        setChainPulseError(null);
      } catch (error) {
        if (canceled) return;
        setChainPulseError(pickErrorMessage(error));
      } finally {
        if (!canceled) setChainPulseLoading(false);
      }
    };
    void fetchChainPulse(false);
    const timer = window.setInterval(() => {
      void fetchChainPulse(true);
    }, 45_000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [isTestMap]);
  useEffect(() => {
    if (isTestMap) return undefined;
    let canceled = false;
    const fetchSkillsPulse = async (silent = false) => {
      if (!silent) setBinanceSkillsLoading(true);
      try {
        const [alphaResponse, smartMoneyResponse, socialResponse] = await Promise.all([
          fetch(BINANCE_SKILLS_ALPHA_ENDPOINT, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
              'accept-encoding': 'identity',
            },
            body: JSON.stringify({
              rankType: 20,
              chainId: '56',
              period: 50,
              sortBy: 70,
              orderAsc: false,
              page: 1,
              size: 5,
            }),
          }),
          fetch(BINANCE_SKILLS_SMART_MONEY_ENDPOINT, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
              'accept-encoding': 'identity',
            },
            body: JSON.stringify({
              chainId: '56',
              period: '24h',
              tagType: 2,
            }),
          }),
          fetch(BINANCE_SKILLS_SOCIAL_HYPE_ENDPOINT, {
            headers: {
              accept: 'application/json',
              'accept-encoding': 'identity',
            },
          }),
        ]);
        if (!alphaResponse.ok || !smartMoneyResponse.ok || !socialResponse.ok) {
          throw new Error(t('Binance Skills 数据暂时不可用。', 'Binance Skills feed is unavailable right now.'));
        }
        const [alphaJson, smartMoneyJson, socialJson] = await Promise.all([
          alphaResponse.json() as Promise<{ data?: { tokens?: Array<Record<string, unknown>> } }>,
          smartMoneyResponse.json() as Promise<{ data?: Array<Record<string, unknown>> }>,
          socialResponse.json() as Promise<{ data?: { leaderBoardList?: Array<Record<string, unknown>> } }>,
        ]);
        const alphaRaw = alphaJson.data?.tokens?.[0];
        const smartRaw = smartMoneyJson.data?.[0];
        const socialRaw = socialJson.data?.leaderBoardList?.[0];
        const alphaTop: BinanceSkillsAlphaToken | null = alphaRaw
          ? {
            symbol: String(alphaRaw.symbol ?? '--'),
            price: Number(alphaRaw.price ?? 0),
            change24h: alphaRaw.percentChange24h == null ? null : Number(alphaRaw.percentChange24h),
            volume24h: alphaRaw.volume24h == null ? null : Number(alphaRaw.volume24h),
            marketCap: alphaRaw.marketCap == null ? null : Number(alphaRaw.marketCap),
          }
          : null;
        const smartMoneyTop: BinanceSkillsSmartMoneyToken | null = smartRaw
          ? {
            symbol: String(smartRaw.tokenName ?? '--'),
            inflow: smartRaw.inflow == null ? null : Number(smartRaw.inflow),
            priceChangeRate: smartRaw.priceChangeRate == null ? null : Number(smartRaw.priceChangeRate),
            marketCap: smartRaw.marketCap == null ? null : Number(smartRaw.marketCap),
          }
          : null;
        const socialMeta = (socialRaw?.metaInfo ?? null) as Record<string, unknown> | null;
        const socialInfo = (socialRaw?.socialHypeInfo ?? null) as Record<string, unknown> | null;
        const socialMarket = (socialRaw?.marketInfo ?? null) as Record<string, unknown> | null;
        const socialTop: BinanceSkillsSocialToken | null = socialMeta || socialInfo
          ? {
            symbol: String(socialMeta?.symbol ?? '--'),
            sentiment: String(socialInfo?.sentiment ?? '--'),
            socialHype: socialInfo?.socialHype == null ? null : Number(socialInfo.socialHype),
            priceChange: socialMarket?.priceChange == null ? null : Number(socialMarket.priceChange),
            summary: String(socialInfo?.socialSummaryBriefTranslated ?? socialInfo?.socialSummaryBrief ?? ''),
          }
          : null;
        if (canceled) return;
        setBinanceSkillsPulse({
          updatedAt: Date.now(),
          alphaTop,
          smartMoneyTop,
          socialTop,
        });
        setBinanceSkillsError(null);
      } catch (error) {
        if (canceled) return;
        setBinanceSkillsError(pickErrorMessage(error));
      } finally {
        if (!canceled) setBinanceSkillsLoading(false);
      }
    };
    void fetchSkillsPulse(false);
    const timer = window.setInterval(() => {
      void fetchSkillsPulse(true);
    }, 75_000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [isTestMap, t]);
  const marketPulseLeadAsset = useMemo(() => {
    if (!marketPulse) return null;
    return marketPulse.assets.find((item) => item.symbol === marketPulse.leaderSymbol) ?? marketPulse.assets[0] ?? null;
  }, [marketPulse]);
  const marketPulseBtcAsset = useMemo(
    () => marketPulse?.assets.find((item) => item.symbol === 'BTCUSDT') ?? null,
    [marketPulse],
  );
  const marketPulseBnbAsset = useMemo(
    () => marketPulse?.assets.find((item) => item.symbol === 'BNBUSDT') ?? null,
    [marketPulse],
  );
  const marketPulseBnbPriceText = marketPulseBnbAsset ? formatMarketPrice(marketPulseBnbAsset.lastPrice) : '--';
  const marketPulseBtcPriceText = marketPulseBtcAsset ? formatMarketPrice(marketPulseBtcAsset.lastPrice) : '--';
  const marketPulseBnbVolumeText = marketPulseBnbAsset ? formatCompactUsd(marketPulseBnbAsset.quoteVolume, 1) : '--';
  const marketPulseBnbHighText = marketPulseBnbAsset ? formatMarketPrice(marketPulseBnbAsset.highPrice) : '--';
  const marketPulseBnbLowText = marketPulseBnbAsset ? formatMarketPrice(marketPulseBnbAsset.lowPrice) : '--';
  const chainPulseBsc = useMemo(
    () => chainPulse?.networks.find((item) => item.key === 'bsc') ?? null,
    [chainPulse],
  );
  const chainPulseModeText = chainPulse
    ? chainPulse.mode === 'mainnet-busy'
      ? t('主网拥挤', 'Mainnet Busy')
      : chainPulse.mode === 'sync-watch'
        ? t('链上同步观察', 'Sync Watch')
        : t('主网平稳', 'Mainnet Balanced')
    : t('链上载入中', 'Chain Loading');
  const chainPulseBscGasText = chainPulseBsc ? formatGasGwei(chainPulseBsc.gasGwei) : '--';
  const chainPulseBscAgeText = chainPulseBsc ? formatChainAge(chainPulseBsc.blockAgeSec) : '--';
  const chainPulseBscBlockText = chainPulseBsc ? formatBlockCompact(chainPulseBsc.blockNumber) : '--';
  const chainPulseBscLoadText = chainPulseBsc ? `${chainPulseBsc.txCount} tx/block` : '--';
  const binanceSkillsAlphaText = binanceSkillsPulse?.alphaTop
    ? `${binanceSkillsPulse.alphaTop.symbol} · ${binanceSkillsPulse.alphaTop.change24h == null ? '--' : formatSignedPercent(binanceSkillsPulse.alphaTop.change24h)}`
    : '--';
  const binanceSkillsSmartMoneyText = binanceSkillsPulse?.smartMoneyTop
    ? `${binanceSkillsPulse.smartMoneyTop.symbol} · ${binanceSkillsPulse.smartMoneyTop.inflow == null ? '--' : formatCompactUsd(binanceSkillsPulse.smartMoneyTop.inflow, 1)}`
    : '--';
  const binanceSkillsSocialText = binanceSkillsPulse?.socialTop
    ? `${binanceSkillsPulse.socialTop.symbol} · ${binanceSkillsPulse.socialTop.sentiment}`
    : '--';
  const binanceSkillsHeadline = binanceSkillsPulse
    ? `${t('Alpha', 'Alpha')}: ${binanceSkillsAlphaText} · ${t('聪明钱', 'Smart Money')}: ${binanceSkillsSmartMoneyText}`
    : (binanceSkillsLoading ? t('正在接入 Binance Skills...', 'Connecting Binance Skills...') : t('等待 Skills 数据', 'Waiting for Skills data'));
  const binanceSkillsDetail = binanceSkillsPulse
    ? `${t('社交热度', 'Social Hype')}: ${binanceSkillsSocialText}${binanceSkillsPulse.socialTop?.summary ? ` · ${truncateMiroFishText(binanceSkillsPulse.socialTop.summary, 96)}` : ''}`
    : (binanceSkillsError ? `${t('异常', 'Error')}: ${binanceSkillsError}` : t('把 Binance Skills 的 Alpha、Smart Money、Social Hype 融进小镇。', 'Bring Binance Skills alpha, smart money, and social hype into town.'));
  const chainPulseHeadline = chainPulse
    ? chainPulse.mode === 'mainnet-busy'
      ? `${t('BSC Gas 抬升', 'BSC gas climbing')} · ${chainPulseBscGasText}`
      : chainPulse.mode === 'sync-watch'
        ? `${t('链上延迟需观察', 'Chain sync needs watching')} · BSC ${chainPulseBscAgeText}`
        : `${t('BSC 主网平稳', 'BSC mainnet steady')} · ${chainPulseBscLoadText}`
    : (chainPulseLoading ? t('正在接入 BSC...', 'Connecting BSC...') : t('等待链上数据', 'Waiting for chain data'));
  const marketPulseRegimeText = marketPulse
    ? marketPulse.regime === 'risk-on'
      ? t('风险偏好开启', 'Risk-on')
      : marketPulse.regime === 'risk-off'
        ? t('避险模式', 'Risk-off')
        : marketPulse.regime === 'volatile'
          ? t('高波动', 'High Volatility')
          : t('板块轮动', 'Sector Rotation')
    : t('市场载入中', 'Market Loading');
  const marketPulseLeadText = marketPulseLeadAsset
    ? `${marketPulseLeadAsset.shortLabel} ${formatSignedPercent(marketPulseLeadAsset.changePct)}`
    : '--';
  const marketPulseHeadline = marketPulse
    ? marketPulse.regime === 'risk-on'
      ? `${t('热度回升', 'Heat Rising')} · ${marketPulseLeadText}`
      : marketPulse.regime === 'risk-off'
        ? `${t('防守优先', 'Defense First')} · ${marketPulseLeadText}`
        : marketPulse.regime === 'volatile'
          ? `${t('波动放大', 'Volatility Spike')} · ${marketPulseLeadText}`
          : `${t('赛道切换', 'Rotation')} · ${marketPulseLeadText}`
    : (marketPulseLoading ? t('正在接入 Binance 行情...', 'Connecting Binance feed...') : t('等待市场数据', 'Waiting for market data'));
  const bnbWorldHeadline = [marketPulseHeadline, chainPulseHeadline].filter(Boolean).join(' · ');
  const bnbWorldEvent = useMemo<BnbWorldEvent>(() => {
    if (chainPulse?.mode === 'mainnet-busy') {
      return {
        id: 'bsc_fee_spike',
        titleZh: 'BSC 手续费尖峰',
        titleEn: 'BSC Fee Spike',
        detailZh: '主网拥堵，风控与协调类任务收益提高，补给刷新略降。',
        detailEn: 'Mainnet congestion raises risk/coordinator rewards while slightly reducing supply refresh.',
        tone: 'risk',
        questRewardMultiplier: 1.18,
        questProgressBonus: 10,
        lootCountBonus: -6,
        enemyCountBonus: -2,
        npcSpeedMultiplier: 0.9,
      };
    }
    if (chainPulse?.mode === 'sync-watch') {
      return {
        id: 'sync_watch',
        titleZh: '链上同步观察窗',
        titleEn: 'Chain Sync Watch',
        detailZh: '链上节奏不稳，NPC 降速观察，任务奖励回归保守。',
        detailEn: 'Chain timing is uneven. NPCs slow down to observe and rewards turn defensive.',
        tone: 'watch',
        questRewardMultiplier: 0.92,
        questProgressBonus: -4,
        lootCountBonus: -10,
        enemyCountBonus: -4,
        npcSpeedMultiplier: 0.82,
      };
    }
    if (marketPulse?.regime === 'volatile') {
      return {
        id: 'volatility_hunt',
        titleZh: '高波动狩猎窗',
        titleEn: 'Volatility Hunt',
        detailZh: '热点分歧扩大，信号与探索类任务加成，地图更热闹。',
        detailEn: 'Volatility expands. Signal and exploration quests gain bonuses and the map gets busier.',
        tone: 'boost',
        questRewardMultiplier: 1.14,
        questProgressBonus: 8,
        lootCountBonus: 6,
        enemyCountBonus: 2,
        npcSpeedMultiplier: 1.06,
      };
    }
    if (marketPulse?.regime === 'risk-on') {
      return {
        id: 'liquidity_parade',
        titleZh: '流动性巡游',
        titleEn: 'Liquidity Parade',
        detailZh: '热度回升，补给刷新增加，协作与推进更顺畅。',
        detailEn: 'Heat is rising. Supply refresh increases and coordinated pushes feel smoother.',
        tone: 'boost',
        questRewardMultiplier: 1.1,
        questProgressBonus: 6,
        lootCountBonus: 8,
        enemyCountBonus: 1,
        npcSpeedMultiplier: 1.08,
      };
    }
    if (marketPulse?.regime === 'risk-off') {
      return {
        id: 'defense_drill',
        titleZh: '防守演练',
        titleEn: 'Defense Drill',
        detailZh: '市场转冷，任务奖励偏稳健，地图刷新略慢。',
        detailEn: 'Market is cooling. Rewards skew conservative and refresh slows down slightly.',
        tone: 'risk',
        questRewardMultiplier: 0.98,
        questProgressBonus: 0,
        lootCountBonus: -4,
        enemyCountBonus: -1,
        npcSpeedMultiplier: 0.94,
      };
    }
    return {
      id: 'sector_rotation',
      titleZh: '赛道轮动窗口',
      titleEn: 'Sector Rotation Window',
      detailZh: '项目与小人开始重新分流，适合访谈、侦查与关系追踪。',
      detailEn: 'Projects and NPCs are rotating again, which favors interviews, scouting, and relation tracking.',
      tone: 'flow',
      questRewardMultiplier: 1,
      questProgressBonus: 2,
      lootCountBonus: 0,
      enemyCountBonus: 0,
      npcSpeedMultiplier: 1,
    };
  }, [chainPulse?.mode, marketPulse?.regime]);
  const bnbWorldEventTitle = t(bnbWorldEvent.titleZh, bnbWorldEvent.titleEn);
  const bnbWorldEventDetail = t(bnbWorldEvent.detailZh, bnbWorldEvent.detailEn);
  const mapPlayLootTargetCount = Math.max(28, MAP_PLAY_LOOT_COUNT + bnbWorldEvent.lootCountBonus);
  const mapRpgEnemyTargetCount = clamp(MAP_RPG_ENEMY_COUNT + bnbWorldEvent.enemyCountBonus, 8, 28);
  const bnbActionBrief = useMemo<BnbActionBrief>(() => {
    const bscGas = chainPulseBsc?.gasGwei ?? 0;
    const bnbMove = marketPulseBnbAsset?.changePct ?? 0;
    if (chainPulse?.mode === 'sync-watch') {
      return {
        titleZh: '先观察主网',
        titleEn: 'Observe Mainnet First',
        networkZh: 'BSC',
        networkEn: 'BSC',
        zoneZh: 'Research Arcade',
        zoneEn: 'Research Arcade',
        actionZh: '暂缓大额动作，先看链上确认和人物关系。',
        actionEn: 'Pause larger actions and watch confirmations plus agent relations first.',
        riskZh: '中高',
        riskEn: 'Medium-High',
        noteZh: `BSC 区块延迟 ${chainPulseBscAgeText}，先做观察型任务。`,
        noteEn: `BSC block delay is ${chainPulseBscAgeText}; focus on observation tasks first.`,
      };
    }
    if (chainPulse?.mode === 'mainnet-busy' || bscGas >= 0.18) {
      return {
        titleZh: '主网费率偏高',
        titleEn: 'Mainnet Fee Alert',
        networkZh: 'BSC',
        networkEn: 'BSC',
        zoneZh: 'Risk Glacier',
        zoneEn: 'Risk Glacier',
        actionZh: '优先做访谈、风控和观察，不要急着推进高频动作。',
        actionEn: 'Prioritize interviews, risk checks, and observation instead of high-frequency actions.',
        riskZh: '高',
        riskEn: 'High',
        noteZh: `BSC Gas ${chainPulseBscGasText}，适合低频路线。`,
        noteEn: `BSC gas is ${chainPulseBscGasText}; low-frequency routes fit best.`,
      };
    }
    if (marketPulse?.regime === 'risk-on' && bnbMove >= 0.6) {
      return {
        titleZh: '热度追随窗口',
        titleEn: 'Momentum Follow Window',
        networkZh: 'BSC',
        networkEn: 'BSC',
        zoneZh: 'Spot Plaza',
        zoneEn: 'Spot Plaza',
        actionZh: '先去现货区和流动性区，推进信号与补给任务。',
        actionEn: 'Start at Spot Plaza and liquidity lanes, then push signal and supply tasks.',
        riskZh: '中',
        riskEn: 'Medium',
        noteZh: `BNB 24h ${formatSignedPercent(bnbMove)}，热度适合推进。`,
        noteEn: `BNB 24h is ${formatSignedPercent(bnbMove)}, which supports forward momentum.`,
      };
    }
    if (marketPulse?.regime === 'risk-off' || bnbMove <= -1) {
      return {
        titleZh: '防守优先',
        titleEn: 'Defense First',
        networkZh: 'BSC',
        networkEn: 'BSC',
        zoneZh: 'Research Arcade',
        zoneEn: 'Research Arcade',
        actionZh: '先整理图谱、访谈角色，再决定是否推进任务。',
        actionEn: 'Review the graph and interview agents before committing to task pushes.',
        riskZh: '中高',
        riskEn: 'Medium-High',
        noteZh: `BNB 24h ${formatSignedPercent(bnbMove)}，今天更适合研究。`,
        noteEn: `BNB 24h is ${formatSignedPercent(bnbMove)}; today favors research over speed.`,
      };
    }
    if (marketPulse?.regime === 'volatile') {
      return {
        titleZh: '快进快出',
        titleEn: 'Scout and Exit',
        networkZh: 'BSC',
        networkEn: 'BSC',
        zoneZh: 'Launch Sands',
        zoneEn: 'Launch Sands',
        actionZh: '只做短线侦查和信号收集，保留回撤空间。',
        actionEn: 'Do short scouting and signal collection only, while preserving room for drawdown.',
        riskZh: '高',
        riskEn: 'High',
        noteZh: `${marketPulseLeadText} 领涨，适合短节奏任务。`,
        noteEn: `${marketPulseLeadText} is leading, which favors short-cycle missions.`,
      };
    }
    return {
      titleZh: '平稳推进',
      titleEn: 'Steady Progress',
      networkZh: 'BSC',
      networkEn: 'BSC',
      zoneZh: 'Alpha Board',
      zoneEn: 'Alpha Board',
      actionZh: '按主线任务推进，优先完成当前 Alpha 任务和市场扩张。',
      actionEn: 'Follow the main questline and prioritize the current Alpha task plus market expansion.',
      riskZh: '低',
      riskEn: 'Low',
      noteZh: `BSC Gas ${chainPulseBscGasText}，主网节奏平稳。`,
      noteEn: `BSC gas is ${chainPulseBscGasText}; mainnet cadence looks stable.`,
    };
  }, [chainPulse?.mode, chainPulseBsc?.gasGwei, chainPulseBscAgeText, chainPulseBscGasText, marketPulse?.regime, marketPulseBnbAsset?.changePct, marketPulseLeadText]);
  const bnbActionBriefTitle = t(bnbActionBrief.titleZh, bnbActionBrief.titleEn);
  const bnbActionBriefZone = t(bnbActionBrief.zoneZh, bnbActionBrief.zoneEn);
  const bnbActionBriefAction = t(bnbActionBrief.actionZh, bnbActionBrief.actionEn);
  const bnbActionBriefRisk = t(bnbActionBrief.riskZh, bnbActionBrief.riskEn);
  const bnbActionBriefNetwork = t(bnbActionBrief.networkZh, bnbActionBrief.networkEn);
  const bnbActionBriefNote = t(bnbActionBrief.noteZh, bnbActionBrief.noteEn);
  const bscLiveChatSpeakers = useMemo<BscLiveChatSpeaker[]>(() => {
    const unique = new Set<string>();
    return agentsRef.current
      .filter((agent) => !agent.id.startsWith('player_'))
      .slice()
      .sort((a, b) => {
        const score = (agent: AgentMarker) => {
          if (agent.guestMeta) return 0;
          if (agent.id.startsWith('graph_')) return 1;
          if (agent.source === 'npc') return 2;
          if (agent.source === 'demo') return 3;
          return 4;
        };
        const diff = score(a) - score(b);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
      })
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.guestMeta?.title || agent.miroFishProjection?.roleLabel || agent.status || t('BSC 观察员', 'BSC watcher'),
        topic: agent.guestMeta?.topic,
        isGuest: Boolean(agent.guestMeta),
      }))
      .filter((speaker) => {
        if (unique.has(speaker.id)) return false;
        unique.add(speaker.id);
        return true;
      })
      .slice(0, 8);
  }, [agentCount, guestAgentConfigs, miroFishProjectionVersion, marketPulseHeadline, chainPulseHeadline, t]);
  const bscLiveChatSummary = useMemo(() => {
    const latest = bscLiveChatMessages[bscLiveChatMessages.length - 1] ?? null;
    return latest
      ? `${latest.speaker}: ${latest.text}`
      : t('等待 NPC 开始讨论 BSC...', 'Waiting for NPCs to start talking about BSC...');
  }, [bscLiveChatMessages, t]);

  useEffect(() => {
    bscLiveChatMessagesRef.current = bscLiveChatMessages;
  }, [bscLiveChatMessages]);

  useEffect(() => {
    bscLiveChatContextRef.current = {
      chainMode: chainPulse?.mode ?? null,
      chainAgeText: chainPulseBscAgeText,
      chainGasText: chainPulseBscGasText,
      chainLoadText: chainPulseBscLoadText,
      worldEventTitle: bnbWorldEventTitle,
      action: bnbActionBriefAction,
      zone: bnbActionBriefZone,
      risk: bnbActionBriefRisk,
      marketRegime: marketPulse?.regime ?? null,
      bnbChangeText: marketPulseBnbAsset ? formatSignedPercent(marketPulseBnbAsset.changePct) : '--',
      marketReady: Boolean(marketPulse),
      chainReady: Boolean(chainPulse),
      alphaSymbol: binanceSkillsPulse?.alphaTop?.symbol ?? '',
      smartMoneySymbol: binanceSkillsPulse?.smartMoneyTop?.symbol ?? '',
      socialSymbol: binanceSkillsPulse?.socialTop?.symbol ?? '',
      skillsReady: Boolean(binanceSkillsPulse),
    };
  }, [
    bnbActionBriefAction,
    bnbActionBriefRisk,
    bnbActionBriefZone,
    binanceSkillsPulse,
    bnbWorldEventTitle,
    chainPulse,
    chainPulseBscAgeText,
    chainPulseBscGasText,
    chainPulseBscLoadText,
    marketPulse,
    marketPulseBnbAsset,
  ]);

  useEffect(() => {
    if (isTestMap) return undefined;
    const appendFallbackMessage = () => {
      const context = bscLiveChatContextRef.current;
      if (!context.marketReady && !context.chainReady) return;
      const speakers = bscLiveChatSpeakers.length > 0
        ? bscLiveChatSpeakers
        : [{ id: 'bsc_dispatch', name: t('BSC 调度员', 'BSC dispatcher'), role: t('链上协调', 'Chain ops') }];
      const seq = bscLiveChatSeqRef.current;
      const speaker = speakers[seq % speakers.length];
      const templates: Array<{ text: string; tone: BscLiveChatMessageTone }> = [];

      if (speaker.isGuest && speaker.topic) {
        templates.push(
          {
            text: t(
              `${speaker.topic} 这条线我会继续在 ${context.zone} 盯着，看看它和今天的 BSC 节奏是不是同频。`,
              `I'll keep watching ${speaker.topic} in ${context.zone} to see whether it really matches today's BSC cadence.`,
            ),
            tone: 'alpha',
          },
          {
            text: t(
              `我是来串门的嘉宾，但今天不聊虚的，先把 ${speaker.topic} 和 ${context.worldEventTitle} 对齐。`,
              `I'm a guest in town, but today I'm keeping it practical by aligning ${speaker.topic} with ${context.worldEventTitle}.`,
            ),
            tone: 'watch',
          },
        );
      }

      if (context.chainMode === 'mainnet-busy') {
        templates.push(
          {
            text: t(
              `BSC Gas 到 ${context.chainGasText} 了，先把动作放慢一点，我留在 ${context.zone} 盯主网节奏。`,
              `BSC gas is ${context.chainGasText}; slowing down and watching ${context.zone} for mainnet cadence.`,
            ),
            tone: 'risk',
          },
          {
            text: t(
              `主网有点挤，${context.worldEventTitle} 期间先别乱切路线，按 ${context.action} 做就行。`,
              `Mainnet is crowded. During ${context.worldEventTitle}, stay disciplined and follow ${context.action}.`,
            ),
            tone: 'watch',
          },
        );
      } else if (context.chainMode === 'sync-watch') {
        templates.push(
          {
            text: t(
              `BSC 区块延迟大约 ${context.chainAgeText}，我先做观察和访谈，不急着推进。`,
              `BSC block delay is around ${context.chainAgeText}; I'm focusing on observation and interviews first.`,
            ),
            tone: 'watch',
          },
          {
            text: t(
              `链上同步还没完全稳住，先在 ${context.zone} 收集关系和线索。`,
              `Chain sync is not fully settled yet, so I'm gathering links and clues in ${context.zone}.`,
            ),
            tone: 'watch',
          },
        );
      } else {
        templates.push(
          {
            text: t(
              `BSC 现在 ${context.chainLoadText}，主网挺顺，我准备按 ${context.action} 推一轮。`,
              `BSC is running at ${context.chainLoadText}; mainnet looks smooth, so I'll push one cycle with ${context.action}.`,
            ),
            tone: 'calm',
          },
          {
            text: t(
              `${context.worldEventTitle} 这波不差，先去 ${context.zone} 看看有没有新的信号冒出来。`,
              `${context.worldEventTitle} looks solid. I'll check ${context.zone} for fresh signals.`,
            ),
            tone: 'alpha',
          },
        );
      }

      if (context.marketRegime === 'risk-on') {
        templates.push({
          text: t(
            `BNB 今天 ${context.bnbChangeText}，现货区开始热起来了，但我还是优先看 BSC。`,
            `BNB is ${context.bnbChangeText} today. Spot is heating up, but I'm still prioritizing BSC flow.`,
          ),
          tone: 'alpha',
        });
      } else if (context.marketRegime === 'risk-off') {
        templates.push({
          text: t(
            `市场偏防守，风险级别 ${context.risk}。先别追高，我继续在 BSC 上慢一点确认。`,
            `Market is defensive with ${context.risk} risk. No chasing here; I'm validating things slower on BSC.`,
          ),
          tone: 'risk',
        });
      } else if (context.marketRegime === 'volatile') {
        templates.push({
          text: t(
            `波动有点大，我先盯 BSC 和图谱人物，看看谁在带节奏。`,
            `Volatility is elevated. I'm watching BSC and the graph agents to see who is moving the narrative.`,
          ),
          tone: 'watch',
        });
      } else {
        templates.push({
          text: t(
            `现在更像轮动盘，${context.zone} 这种慢一点的区域更适合做判断。`,
            `This feels more like rotation. Slower zones like ${context.zone} are better for making calls.`,
          ),
          tone: 'calm',
        });
      }

      if (context.skillsReady && context.alphaSymbol) {
        templates.push({
          text: t(
            `Skills 面板里 ${context.alphaSymbol} 排在 Alpha 前面，我准备先去看它是不是和 BSC 当前节奏对得上。`,
            `${context.alphaSymbol} is leading the Alpha list in Skills. I'm checking whether it matches the current BSC rhythm.`,
          ),
          tone: 'alpha',
        });
      }

      if (context.skillsReady && context.smartMoneySymbol) {
        templates.push({
          text: t(
            `聪明钱最近在盯 ${context.smartMoneySymbol}，我会把它当成今天的重点观察对象。`,
            `Smart money is leaning into ${context.smartMoneySymbol}; I'm treating it as today's priority watch.`,
          ),
          tone: 'watch',
        });
      }

      if (context.skillsReady && context.socialSymbol) {
        templates.push({
          text: t(
            `社交热度最高的是 ${context.socialSymbol}，但我还是要先确认它在 BSC 上是不是只是噪音。`,
            `${context.socialSymbol} is leading social hype, but I still need to verify whether it's signal or just noise on BSC.`,
          ),
          tone: 'watch',
        });
      }

      templates.push({
        text: t(
          `收到行动建议了，网络就按 BSC，路线先走 ${context.zone}。`,
          `Action brief received. Staying on BSC and starting with ${context.zone}.`,
        ),
        tone: 'calm',
      });

      const picked = templates[seq % templates.length];
      const nextMessage: BscLiveChatMessage = {
        id: `${speaker.id}-${Date.now()}`,
        speakerId: speaker.id,
        speaker: speaker.name,
        role: speaker.role,
        text: picked.text,
        tone: picked.tone,
        createdAt: Date.now(),
        source: 'fallback',
      };
      bscLiveChatSeqRef.current += 1;
      setBscLiveChatMessages((prev) => {
        const deduped = prev.filter((item) => item.text !== nextMessage.text || item.speakerId !== nextMessage.speakerId);
        return [...deduped.slice(-5), nextMessage];
      });
      setBscLiveChatMode('fallback');
    };

    let canceled = false;
    const emitAiMessage = async () => {
      const context = bscLiveChatContextRef.current;
      if ((!context.marketReady && !context.chainReady) || bscLiveChatInFlightRef.current) return;
      const speakers = bscLiveChatSpeakers.length > 0
        ? bscLiveChatSpeakers
        : [{ id: 'bsc_dispatch', name: t('BSC 调度员', 'BSC dispatcher'), role: t('链上协调', 'Chain ops') }];
      const activeMissionContext = activeSkillsMissionId
        ? ({
          id: activeSkillsMissionId,
          title:
            activeSkillsMissionId === 'alpha'
              ? t('Alpha Scout', 'Alpha Scout')
              : activeSkillsMissionId === 'smart-money'
                ? t('Smart Money Watch', 'Smart Money Watch')
                : t('Social Hype Check', 'Social Hype Check'),
          token:
            activeSkillsMissionId === 'alpha'
              ? (binanceSkillsPulse?.alphaTop?.symbol ?? '')
              : activeSkillsMissionId === 'smart-money'
                ? (binanceSkillsPulse?.smartMoneyTop?.symbol ?? '')
                : (binanceSkillsPulse?.socialTop?.symbol ?? ''),
          zone:
            activeSkillsMissionId === 'alpha'
              ? t('Launch Sands', 'Launch Sands')
              : activeSkillsMissionId === 'smart-money'
                ? t('Research Arcade', 'Research Arcade')
                : t('Spot Plaza', 'Spot Plaza'),
          note:
            activeSkillsMissionId === 'alpha'
              ? t('优先验证 Alpha 榜首代币是否有持续信号。', 'Validate whether the top Alpha token has persistence.')
              : activeSkillsMissionId === 'smart-money'
                ? t('跟踪聪明钱流向与链上节奏是否一致。', 'Track whether smart-money flow matches on-chain cadence.')
                : t('判断社交热度是否只是噪音。', 'Decide whether social hype is signal or noise.'),
        })
        : null;
      bscLiveChatInFlightRef.current = true;
      try {
        const response = await fetch(buildStarOfficeApiUrl('', '/office-chat'), {
          method: 'POST',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            officeName: t('Binance AI Town 地图频道', 'Binance AI Town Map Channel'),
            lang: document.documentElement.lang?.toLowerCase().startsWith('zh') ? 'zh' : 'en',
            market: marketPulse
              ? {
                bnbPrice: marketPulseBnbAsset?.lastPrice ?? null,
                bnbChangePct: marketPulseBnbAsset?.changePct ?? null,
                regime: marketPulse.regime,
                headline: marketPulseHeadline,
              }
              : null,
            chain: chainPulse
              ? {
                gasGwei: chainPulseBsc?.gasGwei ?? null,
                blockAgeSec: chainPulseBsc?.blockAgeSec ?? null,
                txCount: chainPulseBsc?.txCount ?? null,
                mode: chainPulse.mode,
                headline: chainPulseHeadline,
              }
              : null,
            skills: binanceSkillsPulse
              ? {
                alphaSymbol: binanceSkillsPulse.alphaTop?.symbol ?? '',
                smartMoneySymbol: binanceSkillsPulse.smartMoneyTop?.symbol ?? '',
                socialSymbol: binanceSkillsPulse.socialTop?.symbol ?? '',
                socialSummary: binanceSkillsPulse.socialTop?.summary ?? '',
              }
              : null,
            roster: speakers.slice(0, 6).map((speaker) => ({
              name: speaker.name,
              title: speaker.role,
              topic: speaker.topic || '',
              statusText: `${bnbWorldEventTitle} · ${bnbActionBriefAction}`,
              stationLabel: bnbActionBriefZone,
            })),
            recentMessages: bscLiveChatMessagesRef.current.slice(-4).map((item) => ({
              speaker: item.speaker,
              text: item.text,
            })),
            mapContext: {
              worldEventTitle: bnbWorldEventTitle,
              worldEventDetail: bnbWorldEventDetail,
              zone: bnbActionBriefZone,
              action: bnbActionBriefAction,
              risk: bnbActionBriefRisk,
              mission: activeMissionContext,
            },
          }),
        });
        if (!response.ok) {
          appendFallbackMessage();
          return;
        }
        const payload = await response.json() as MapOfficeChatResponse;
        if (canceled || !payload.ok || !Array.isArray(payload.messages) || payload.messages.length === 0) {
          appendFallbackMessage();
          return;
        }
        const payloadMessages = payload.messages;
        setBscLiveChatMessages((prev) => {
          const nextMessages = payloadMessages
            .map((message, index) => {
              const speakerName = String(message.speaker || '').trim();
              const matched = speakers.find((speaker) => speaker.name === speakerName);
              const text = String(message.text || '').trim();
              if (!text) return null;
              const tone: BscLiveChatMessageTone = message.tone === 'warning'
                ? 'risk'
                : message.tone === 'alpha'
                  ? 'alpha'
                  : matched?.isGuest
                    ? 'watch'
                    : 'calm';
              return {
                id: `${matched?.id || speakerName || 'map-chat'}-${Date.now()}-${index}`,
                speakerId: matched?.id || `ai_${index}`,
                speaker: matched?.name || speakerName || t('BSC 调度员', 'BSC dispatcher'),
                role: String(message.role || matched?.role || t('链上协调', 'Chain ops')),
                text,
                createdAt: Date.now() + index,
                tone,
                source: payload.provider === 'fallback' ? 'fallback' : 'ai',
              } satisfies BscLiveChatMessage;
            })
            .filter(Boolean) as BscLiveChatMessage[];
          if (nextMessages.length === 0) return prev;
          return [...prev.slice(-(6 - nextMessages.length)), ...nextMessages];
        });
        setBscLiveChatMode(payload.provider === 'fallback' ? 'fallback' : 'ai');
      } catch {
        if (!canceled) appendFallbackMessage();
      } finally {
        bscLiveChatInFlightRef.current = false;
      }
    };

    if (bscLiveChatMessagesRef.current.length === 0) {
      void emitAiMessage();
    }
    const interval = window.setInterval(() => {
      void emitAiMessage();
    }, 12_000);
    return () => window.clearInterval(interval);
  }, [
    activeSkillsMissionId,
    binanceSkillsPulse,
    bnbActionBriefAction,
    bnbActionBriefRisk,
    bnbActionBriefZone,
    bnbWorldEventDetail,
    bnbWorldEventTitle,
    bscLiveChatSpeakers,
    chainPulse,
    chainPulseBsc,
    chainPulseHeadline,
    isTestMap,
    marketPulse,
    marketPulseBnbAsset,
    marketPulseHeadline,
    t,
  ]);
  const bnbActionTaskPlan = useMemo(() => {
    const missionLine = mapExpansionMissionProgress
      ? (
        mapExpansionMissionProgress.done
          ? t('市场目标已就绪，回到主线推进扩张。', 'The market objective is ready, so return to the main route and push expansion.')
          : `${t('同步市场目标', 'Sync market objective')}: ${t(mapExpansionMissionProgress.unmetHintZh, mapExpansionMissionProgress.unmetHintEn)}`
      )
      : t('主线扩张已完成，优先做关系巡检和角色访谈。', 'Mainline expansion is complete, so prioritize relation checks and agent interviews.');
    const alphaLine = mapAdventure.activeQuest
      ? `${t('当前 Alpha 任务', 'Current Alpha task')}: ${mapAdventureQuestText}`
      : t('当前没有挂起的 Alpha 任务，先补充信号与关系样本。', 'No active Alpha task right now, so gather signal and relation samples first.');
    return {
      title: t('推荐任务路线', 'Recommended Task Route'),
      subtitle: `${bnbActionBriefTitle} · ${bnbActionBriefZone}`,
      steps: [
        `${t('先去', 'Go to')} ${bnbActionBriefZone} ${t('完成定位', 'and lock the suggested zone')}`,
        bnbActionBriefAction,
        alphaLine,
      ],
      note: missionLine,
    };
  }, [bnbActionBriefAction, bnbActionBriefTitle, bnbActionBriefZone, mapAdventure.activeQuest, mapAdventureQuestText, mapExpansionMissionProgress, t]);
  const resolveZoneFocus = useCallback((zoneEn: string, label: string): ActionBriefZoneFocus | null => {
    if (!map) return null;

    const makeDistrictFocus = (
      key: ActionBriefZoneKey,
      label: string,
      centerXRatio: number,
      centerYRatio: number,
      halfWidthTiles: number,
      halfHeightTiles: number,
    ): ActionBriefZoneFocus => {
      const tx = clamp(Math.round(map.width * centerXRatio), 1, map.width - 2);
      const ty = clamp(Math.round(map.height * centerYRatio), 1, map.height - 2);
      return {
        key,
        label,
        tx,
        ty,
        minTx: clamp(tx - halfWidthTiles, 1, map.width - 2),
        maxTx: clamp(tx + halfWidthTiles, 1, map.width - 2),
        minTy: clamp(ty - halfHeightTiles, 1, map.height - 2),
        maxTy: clamp(ty + halfHeightTiles, 1, map.height - 2),
        anchorKind: 'district',
      };
    };

    const makeLandmarkFocus = (
      key: ActionBriefZoneKey,
      label: string,
      kind: MapExpansionLandmarkKind,
      radiusTiles: number,
      fallback: () => ActionBriefZoneFocus,
    ): ActionBriefZoneFocus => {
      const landmark = mapExpansionLandmarks.find((item) => item.kind === kind);
      if (!landmark) return fallback();
      return {
        key,
        label,
        tx: landmark.tx,
        ty: landmark.ty,
        minTx: clamp(landmark.tx - radiusTiles, 1, map.width - 2),
        maxTx: clamp(landmark.tx + radiusTiles, 1, map.width - 2),
        minTy: clamp(landmark.ty - radiusTiles, 1, map.height - 2),
        maxTy: clamp(landmark.ty + radiusTiles, 1, map.height - 2),
        anchorKind: 'landmark',
      };
    };

    if (zoneEn === 'Spot Plaza') {
      return makeLandmarkFocus(
        'spot_plaza',
        label,
        'market',
        9,
        () => makeDistrictFocus('spot_plaza', label, 0.52, 0.48, 12, 8),
      );
    }
    if (zoneEn === 'Launch Sands') {
      return makeLandmarkFocus(
        'launch_sands',
        label,
        'windmill',
        9,
        () => makeDistrictFocus('launch_sands', label, 0.23, 0.64, 12, 9),
      );
    }
    if (zoneEn === 'Research Arcade') {
      return makeLandmarkFocus(
        'research_arcade',
        label,
        'tower',
        8,
        () => makeDistrictFocus('research_arcade', label, 0.31, 0.28, 11, 8),
      );
    }
    if (zoneEn === 'Risk Glacier') {
      return makeLandmarkFocus(
        'risk_glacier',
        label,
        'beacon',
        9,
        () => makeDistrictFocus('risk_glacier', label, 0.78, 0.18, 10, 8),
      );
    }
    return makeLandmarkFocus(
      'alpha_board',
      label,
      'signboard',
      7,
      () => makeDistrictFocus('alpha_board', label, 0.5, 0.42, 8, 6),
    );
  }, [map, mapExpansionLandmarks]);
  const guestAgentCount = useMemo(
    () => guestAgentConfigs.filter((item) => item.enabled).length,
    [guestAgentConfigs],
  );
  const createGuestAgentMarker = useCallback((config: GuestAgentConfig, idx: number): AgentMarker | null => {
    if (!map) return null;
    const focus = resolveZoneFocus(config.zoneLabel, config.zoneLabel);
    const seedBase = Array.from(config.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) + (idx * 97);
    const rnd = createSeededRandom(seedBase + 17);
    const baseTx = focus?.tx ?? clamp(Math.round(map.width * (0.2 + rnd() * 0.6)), 2, map.width - 3);
    const baseTy = focus?.ty ?? clamp(Math.round(map.height * (0.2 + rnd() * 0.6)), 2, map.height - 3);
    const spawnTx = clamp(baseTx + Math.round((rnd() * 6) - 3), focus?.minTx ?? 2, focus?.maxTx ?? map.width - 3);
    const spawnTy = clamp(baseTy + Math.round((rnd() * 6) - 3), focus?.minTy ?? 2, focus?.maxTy ?? map.height - 3);
    const targetTx = clamp(spawnTx + Math.round((rnd() * 8) - 4), focus?.minTx ?? 2, focus?.maxTx ?? map.width - 3);
    const targetTy = clamp(spawnTy + Math.round((rnd() * 8) - 4), focus?.minTy ?? 2, focus?.maxTy ?? map.height - 3);
    const baseMind = createAgentMind({ id: config.id, source: 'guest' });
    return {
      id: config.id,
      name: config.name,
      source: 'guest',
      img: null,
      spriteKey: config.spriteKey,
      direction: 'down',
      tx: spawnTx,
      ty: spawnTy,
      targetTx,
      targetTy,
      lastMoveTime: Date.now(),
      status: config.title,
      thought: config.intro,
      thoughtTimer: Date.now() + 2600 + Math.floor(rnd() * 900),
      walkFrames: [],
      walkOffset: idx % 5,
      sectorX: 0,
      sectorY: 0,
      guestMeta: {
        title: config.title,
        topic: config.topic,
        intro: config.intro,
        zoneLabel: config.zoneLabel,
        accentColor: config.accentColor,
      },
      mind: {
        ...baseMind,
        role: baseMind.role === 'social' ? baseMind.role : 'social',
        taskQueue: ['chat', 'observe', 'patrol', 'chat'],
      },
    };
  }, [map, resolveZoneFocus]);
  const pushGuestLiveChatMessage = useCallback((config: GuestAgentConfig) => {
    const message: BscLiveChatMessage = {
      id: `${config.id}-${Date.now()}`,
      speakerId: config.id,
      speaker: config.name,
      role: config.title,
      text: t(
        `${config.name} 已接入地图。我会围绕「${config.topic}」在 ${config.zoneLabel} 巡游，也会和附近 NPC 同步 BSC 线索。`,
        `${config.name} has entered the map. I will roam around ${config.zoneLabel} for ${config.topic} and sync BSC clues with nearby NPCs.`,
      ),
      tone: 'alpha',
      createdAt: Date.now(),
    };
    setBscLiveChatMessages((prev) => [...prev.slice(-5), message]);
  }, [t]);
  const handleAddLobsterGuestPreset = useCallback(() => {
    const normalized = normalizeGuestAgentConfig({
      name: '小龙虾',
      title: 'BSC 链上巡游员',
      topic: '观察 BSC 热门代币、社区情绪和链上活跃地址',
      intro: '大家好，我是小龙虾。我会在研究区和现货区之间来回跑，顺手和 NPC 聊今天的链上热点。',
      zone: 'Research Arcade',
      spriteKey: 'Maria',
      accentColor: '#ff7c5c',
    }, guestAgentConfigs.length);
    if (!normalized) return;
    setGuestAgentConfigs((prev) => {
      const rest = prev.filter((item) => item.id !== normalized.id);
      return [...rest, normalized];
    });
    pushGuestLiveChatMessage(normalized);
    setAgentPanelNotice(t('已接入小龙虾嘉宾角色。', 'Lobster guest NPC added to town.'));
  }, [guestAgentConfigs.length, pushGuestLiveChatMessage, t]);
  const handleImportGuestAgents = useCallback(() => {
    const raw = guestAgentImportText.trim();
    if (!raw) {
      setAgentPanelNotice(t('先粘贴一段嘉宾 JSON，再导入。', 'Paste guest JSON before importing.'));
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const normalized = list
        .map((item, idx) => normalizeGuestAgentConfig(item, idx))
        .filter((item): item is GuestAgentConfig => Boolean(item));
      if (normalized.length === 0) {
        setAgentPanelNotice(t('没有识别到有效嘉宾，请检查 name/title/topic 字段。', 'No valid guests found. Check name/title/topic fields.'));
        return;
      }
      setGuestAgentConfigs((prev) => {
        const mapById = new Map(prev.map((item) => [item.id, item]));
        normalized.forEach((item) => mapById.set(item.id, item));
        return Array.from(mapById.values());
      });
      pushGuestLiveChatMessage(normalized[0]);
      setGuestAgentImportText('');
      setAgentPanelNotice(t(`已导入 ${normalized.length} 个嘉宾角色。`, `Imported ${normalized.length} guest NPCs.`));
    } catch (error) {
      setAgentPanelNotice(
        t(
          `嘉宾 JSON 解析失败：${error instanceof Error ? error.message : 'Unknown error'}`,
          `Guest JSON parse failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ),
      );
    }
  }, [guestAgentImportText, pushGuestLiveChatMessage, t]);
  const handleRemoveGuestAgent = useCallback((guestId: string) => {
    setGuestAgentConfigs((prev) => prev.filter((item) => item.id !== guestId));
    if (selectedAgentId === guestId) {
      setSelectedAgentId(null);
      setAgentProfileOpen(false);
    }
    setAgentPanelNotice(t('已移除嘉宾角色。', 'Guest NPC removed.'));
  }, [selectedAgentId, t]);
  const handleResetGuestImportTemplate = useCallback(() => {
    setGuestAgentImportText(GUEST_AGENT_IMPORT_TEMPLATE);
  }, []);
  const bnbActionBriefFocus = useMemo<ActionBriefZoneFocus | null>(
    () => resolveZoneFocus(bnbActionBrief.zoneEn, bnbActionBriefZone),
    [bnbActionBrief.zoneEn, bnbActionBriefZone, resolveZoneFocus],
  );
  const skillsMissions = useMemo<BinanceSkillsMission[]>(() => {
    const items: BinanceSkillsMission[] = [];
    if (binanceSkillsPulse?.alphaTop) {
      const zoneEn = 'Launch Sands';
      const zoneLabel = t('Launch Sands', 'Launch Sands');
      items.push({
        id: 'alpha',
        title: t('Alpha 侦查', 'Alpha Scout'),
        subtitle: `${binanceSkillsPulse.alphaTop.symbol} · ${binanceSkillsPulse.alphaTop.change24h == null ? '--' : formatSignedPercent(binanceSkillsPulse.alphaTop.change24h)}`,
        token: binanceSkillsPulse.alphaTop.symbol,
        tone: 'alpha',
        zoneLabel,
        focus: resolveZoneFocus(zoneEn, zoneLabel),
        steps: [
          `${t('前往', 'Move to')} ${zoneLabel} ${t('确认热点代币', 'and verify the hot token')}: ${binanceSkillsPulse.alphaTop.symbol}`,
          t('观察成交量和热度是否继续放大。', 'Check whether volume and attention keep expanding.'),
          t('把结论回写给当前市场任务。', 'Feed the conclusion back into the current market task.'),
        ],
        note: t('适合筛选 Binance Skills 里的 Alpha 机会。', 'Best for screening Alpha opportunities from Binance Skills.'),
      });
    }
    if (binanceSkillsPulse?.smartMoneyTop) {
      const zoneEn = 'Research Arcade';
      const zoneLabel = t('Research Arcade', 'Research Arcade');
      items.push({
        id: 'smart-money',
        title: t('聪明钱跟踪', 'Smart Money Watch'),
        subtitle: `${binanceSkillsPulse.smartMoneyTop.symbol} · ${binanceSkillsPulse.smartMoneyTop.inflow == null ? '--' : formatCompactUsd(binanceSkillsPulse.smartMoneyTop.inflow, 1)}`,
        token: binanceSkillsPulse.smartMoneyTop.symbol,
        tone: 'watch',
        zoneLabel,
        focus: resolveZoneFocus(zoneEn, zoneLabel),
        steps: [
          `${t('先去', 'Head to')} ${zoneLabel} ${t('锁定资金流入目标', 'and lock the inflow target')}: ${binanceSkillsPulse.smartMoneyTop.symbol}`,
          t('交叉检查图谱人物和当前市场脉冲。', 'Cross-check graph agents against the live market pulse.'),
          t('决定是继续观察还是提升优先级。', 'Decide whether to keep watching or escalate priority.'),
        ],
        note: t('适合把聪明钱信号转成研究任务。', 'Turns smart money flow into a concrete research task.'),
      });
    }
    if (binanceSkillsPulse?.socialTop) {
      const zoneEn = 'Spot Plaza';
      const zoneLabel = t('Spot Plaza', 'Spot Plaza');
      items.push({
        id: 'social-hype',
        title: t('社交热度核查', 'Social Hype Check'),
        subtitle: `${binanceSkillsPulse.socialTop.symbol} · ${binanceSkillsPulse.socialTop.sentiment}`,
        token: binanceSkillsPulse.socialTop.symbol,
        tone: 'risk',
        zoneLabel,
        focus: resolveZoneFocus(zoneEn, zoneLabel),
        steps: [
          `${t('进入', 'Enter')} ${zoneLabel} ${t('核查社交热度最高的代币', 'and review the top social-hype token')}: ${binanceSkillsPulse.socialTop.symbol}`,
          t('判断它是情绪驱动还是有真实链上支撑。', 'Judge whether it is sentiment-only or supported by on-chain flow.'),
          t('把噪音和有效信号分开。', 'Separate noisy hype from usable signal.'),
        ],
        note: truncateMiroFishText(
          binanceSkillsPulse.socialTop.summary || t('用社交叙事补充现货区判断。', 'Use social narrative to supplement spot-zone judgement.'),
          108,
        ),
      });
    }
    return items;
  }, [binanceSkillsPulse, resolveZoneFocus, t]);
  const activeSkillsMission = useMemo(
    () => skillsMissions.find((item) => item.id === activeSkillsMissionId) ?? null,
    [activeSkillsMissionId, skillsMissions],
  );
  const activeSkillsMissionFocus = activeSkillsMission?.focus ?? null;
  useEffect(() => {
    if (isTestMap || (!marketPulse && !chainPulse)) return;
    const now = Date.now();
    const previousRegime = marketPulseLastRegimeRef.current;
    const previousChainMode = chainPulseLastModeRef.current;
    if (marketPulse) marketPulseLastRegimeRef.current = marketPulse.regime;
    if (chainPulse) chainPulseLastModeRef.current = chainPulse.mode;
    const nextIntentForRole = (role: AgentMindRole): AgentMindIntent => {
      if (chainPulse?.mode === 'sync-watch') {
        if (role === 'guardian' || role === 'operator') return 'observe';
        return 'rest';
      }
      if (chainPulse?.mode === 'mainnet-busy') {
        if (role === 'guardian' || role === 'strategist') return 'observe';
        if (role === 'farmer') return 'farm';
        return 'chat';
      }
      if (marketPulse?.regime === 'risk-on') return role === 'farmer' ? 'farm' : 'trade';
      if (marketPulse?.regime === 'risk-off') return role === 'guardian' ? 'observe' : 'rest';
      if (marketPulse?.regime === 'volatile') return role === 'explorer' ? 'patrol' : 'trade';
      return role === 'social' ? 'chat' : 'patrol';
    };
    const roleThought = (role: AgentMindRole) => {
      if (chainPulse?.mode === 'sync-watch') {
        if (role === 'guardian') return t('链上时间戳有抖动，先盯确认和同步。', 'Chain timestamps look uneven. Watch confirmations and sync first.');
        if (role === 'operator') return t('先暂停高频动作，把链上状态广播清楚。', 'Pause high-frequency actions and broadcast chain status clearly.');
        return `${t('链上同步观察', 'Chain sync watch')} · ${chainPulseHeadline}`;
      }
      if (chainPulse?.mode === 'mainnet-busy') {
        if (role === 'strategist') return t('BSC 主网拥挤，把大动作拆分并排队。', 'BSC mainnet is busy. Split large actions and queue them up.');
        if (role === 'farmer') return t('主网费率抬头，先把补给转到流动性缓冲区。', 'Mainnet fees are lifting. Move supplies into the liquidity buffer first.');
        if (role === 'guardian') return t('主网开始拥堵，先压缩风险暴露和冲动下单。', 'Mainnet is congesting. Reduce risk exposure and impulsive orders first.');
        return `${t('主网拥挤', 'Mainnet busy')} · ${chainPulseHeadline}`;
      }
      if (marketPulse?.regime === 'risk-on') {
        if (role === 'strategist') return t('风险偏好回暖，优先盯住 BNB 与热点赛道。', 'Risk appetite is back. Watch BNB and hot sectors first.');
        if (role === 'guardian') return t('波动仍在，但可以放宽一档风控阈值。', 'Volatility remains, but risk limits can loosen slightly.');
        if (role === 'farmer') return t('资金回流，去流动性区补位。', 'Capital is rotating back in. Top up liquidity lanes.');
        return `${t('热度走强', 'Momentum is building')} · ${marketPulseLeadText}`;
      }
      if (marketPulse?.regime === 'risk-off') {
        if (role === 'guardian') return t('先守住回撤，再考虑推进任务。', 'Protect drawdown first, then think about pushing tasks.');
        if (role === 'strategist') return t('市场转弱，降低暴露并压缩试错。', 'Market is weakening. Cut exposure and reduce experimentation.');
        return `${t('市场转冷', 'Market is cooling')} · ${marketPulseLeadText}`;
      }
      if (marketPulse?.regime === 'volatile') {
        if (role === 'operator') return t('波动放大，优先同步公告和关键变化。', 'Volatility is spiking. Sync notices and key changes first.');
        if (role === 'explorer') return t('高波动窗口打开，去最热区域巡查。', 'Volatility window is open. Scout the hottest district.');
        return `${t('高波动窗口', 'High-volatility window')} · ${marketPulseLeadText}`;
      }
      if (role === 'social') return t('板块轮动中，继续收集社区和项目线索。', 'Sector rotation is underway. Keep gathering community and project signals.');
      return [marketPulseHeadline, chainPulseHeadline].filter(Boolean).join(' · ');
    };
    agentsRef.current = agentsRef.current.map((agent) => {
      if (agent.id.startsWith('graph_')) return agent;
      const nextIntent = nextIntentForRole(agent.mind.role);
      const statusParts = [
        marketPulse ? marketPulseRegimeText : null,
        chainPulse ? chainPulseModeText : null,
        AGENT_INTENT_STATUS[nextIntent],
      ].filter(Boolean);
      return {
        ...agent,
        status: statusParts.join(' · '),
        thought: roleThought(agent.mind.role),
        thoughtTimer: now + 4200,
        mind: {
          ...agent.mind,
          intent: nextIntent,
          currentTask: nextIntent,
          nextDecisionAt: now + 900,
        },
      };
    });
    if (marketPulse && previousRegime !== marketPulse.regime) {
      setAgentPanelNotice(`${t('Binance 行情已同步', 'Binance market pulse synced')}: ${marketPulseHeadline}`);
    } else if (chainPulse && previousChainMode !== chainPulse.mode) {
      setAgentPanelNotice(`${t('BSC 链路已同步', 'BSC chain pulse synced')}: ${chainPulseHeadline}`);
    }
  }, [
    chainPulse,
    chainPulseHeadline,
    chainPulseModeText,
    isTestMap,
    marketPulse,
    marketPulseHeadline,
    marketPulseLeadText,
    marketPulseRegimeText,
    t,
  ]);
  useEffect(() => {
    if (isTestMap) return;
    if (bnbWorldEventLastRef.current === bnbWorldEvent.id) return;
    bnbWorldEventLastRef.current = bnbWorldEvent.id;
    setAgentPanelNotice(`${t('世界事件', 'World Event')}: ${bnbWorldEventTitle} · ${bnbWorldEventDetail}`);
  }, [bnbWorldEvent.id, bnbWorldEventDetail, bnbWorldEventTitle, isTestMap, t]);
  const selectedGraphSimulationProfile = selectedAgent ? (miroFishGraphProfileMatches[selectedAgent.id] ?? null) : null;
  const selectedGraphProfileDisplayName = selectedGraphSimulationProfile
    ? (extractMiroFishProfileNames(selectedGraphSimulationProfile.profile)[0] || `Agent ${selectedGraphSimulationProfile.index}`)
    : '';
  const selectedGraphInterview = selectedAgent ? (miroFishInterviewByAgentId[selectedAgent.id] ?? null) : null;
  const selectedGraphProjection = selectedAgent?.miroFishProjection ?? null;
  const miroFishGraphProjectionByAgentId = useMemo(() => {
    const projectionMap: Record<string, MiroFishAgentProjection> = {};
    const reportSummary = truncateMiroFishText(
      miroFishReport?.outline?.summary || miroFishReport?.markdown_content || '',
      150,
    );
    const currentRound = miroFishRunStatus?.current_round ?? 0;
    const runIsActive = miroFishRunStatus?.runner_status === 'running';
    for (const agent of agentsRef.current) {
      if (!agent.id.startsWith('graph_')) continue;
      const graphMeta = miroFishAgentMetaRef.current[agent.id];
      if (!graphMeta) continue;
      const profileMatch = miroFishGraphProfileMatches[agent.id] ?? null;
      const profile = profileMatch?.profile ?? null;
      const interview = miroFishInterviewByAgentId[agent.id] ?? null;
      const persona = truncateMiroFishText(
        profile ? getMiroFishProfilePersona(profile) : graphMeta.summary || '',
        104,
      ) || t('该节点正在等待更多上下文。', 'This node is waiting for more context.');
      const roleLabel = profile
        ? getMiroFishProfileRole(profile)
        : (graphMeta.labels.find((label) => label !== 'Entity') || graphMeta.labels[0] || 'Entity');
      const reportLens = getMiroFishReportLens(miroFishReport, agent.name);
      const interviewLabel = truncateMiroFishText(interview?.responseText || '', 120);
      let motion: MiroFishAgentProjectionMotion = runIsActive
        ? interviewLabel
          ? 'coordinate'
          : (profile ? getMiroFishProfileActivityScore(profile) : 0) > 400
            ? 'broadcast'
            : graphMeta.connections.length > 2
              ? 'coordinate'
              : 'observe'
        : miroFishReport
          ? miroFishReport.status === 'completed'
            ? 'settle'
            : 'analyze'
          : 'observe';
      if (chainPulse?.mode === 'mainnet-busy' && motion === 'broadcast') {
        motion = 'coordinate';
      } else if (chainPulse?.mode === 'sync-watch' && (motion === 'broadcast' || motion === 'coordinate')) {
        motion = 'observe';
      }
      const marketLens = marketPulse
        ? `${marketPulseRegimeText} · ${marketPulseLeadText}`
        : '';
      const chainLens = chainPulse
        ? `${chainPulseModeText} · ${chainPulseHeadline}`
        : '';
      const motionLabel = motion === 'broadcast'
        ? t('扩散话题', 'Broadcasting')
        : motion === 'coordinate'
          ? t('协同联动', 'Coordinating')
          : motion === 'settle'
            ? t('回归常态', 'Settled')
            : motion === 'analyze'
              ? t('整理结论', 'Analyzing')
              : t('观察中', 'Observing');
      const reportLabel = [
        reportLens.snippet || reportSummary || '',
        marketLens ? `${t('行情', 'Market')}: ${marketLens}` : '',
        chainLens ? `${t('链上', 'Chain')}: ${chainLens}` : '',
      ].filter(Boolean).join(' · ') || t('报告生成后会在这里反馈镇内趋势。', 'Report feedback will appear here after generation.');
      const statusLabel = miroFishRunStatus
        ? `${t('第', 'R')}${miroFishRunStatus.current_round}${t('轮', '')} · ${motionLabel} · ${marketPulseRegimeText}${chainPulse ? ` · ${chainPulseModeText}` : ''}`
        : `${t('图谱', 'Graph')} · ${motionLabel}${marketPulse ? ` · ${marketPulseRegimeText}` : ''}${chainPulse ? ` · ${chainPulseModeText}` : ''}`;
      projectionMap[agent.id] = {
        profileIndex: profileMatch?.index ?? null,
        platform: profileMatch ? miroFishProfilesRealtime?.platform ?? 'reddit' : 'mixed',
        displayName: profileMatch
          ? (extractMiroFishProfileNames(profileMatch.profile)[0] || agent.name)
          : agent.name,
        roleLabel,
        persona,
        badgeLabel: profileMatch
          ? `${(miroFishProfilesRealtime?.platform ?? 'reddit').toUpperCase()} #${profileMatch.index}`
          : `${t('节点', 'NODE')} ${graphMeta.inDegree + graphMeta.outDegree}`,
        statusLabel,
        thoughtLabel: interviewLabel || ([persona, marketLens, chainLens].filter(Boolean).join(' · ')) || reportLabel,
        reportLabel,
        reportTitle: reportLens.title || miroFishReport?.outline?.title || '',
        interviewLabel,
        motion,
        actionScore: (profile ? getMiroFishProfileActivityScore(profile) : 0) + (graphMeta.connections.length * 12) + (chainPulse?.activityScore ?? 0) * 0.2,
        anchorTx: agent.miroFishProjection?.anchorTx ?? agent.tx,
        anchorTy: agent.miroFishProjection?.anchorTy ?? agent.ty,
        targetAgentId: motion === 'coordinate' ? graphMeta.connections[0]?.otherAgentId : undefined,
      };
      if (runIsActive && currentRound > 0 && !projectionMap[agent.id].reportTitle) {
        projectionMap[agent.id].reportTitle = `${t('运行中', 'Running')} · ${currentRound}/${miroFishRunStatus?.total_rounds || '--'}`;
      }
    }
    return projectionMap;
  }, [
    miroFishEdgeCount,
    miroFishGraphProfileMatches,
    miroFishInterviewByAgentId,
    miroFishNodeCount,
    marketPulse,
    marketPulseLeadText,
    marketPulseRegimeText,
    chainPulse,
    chainPulseHeadline,
    chainPulseModeText,
    miroFishProfilesRealtime?.platform,
    miroFishReport,
    miroFishRunStatus,
    t,
  ]);
  const miroFishReportPreview = useMemo(() => {
    if (!miroFishReport?.markdown_content) return '';
    const compact = miroFishReport.markdown_content.replace(/\n{3,}/g, '\n\n').trim();
    return compact.length > 680 ? `${compact.slice(0, 680)}...` : compact;
  }, [miroFishReport?.markdown_content]);
  const selectedAgentProfile = useMemo<AgentProfile | null>(() => {
    if (!selectedAgent) return null;
    const ownerText = selectedAgent.ownerAddress
      ? `${selectedAgent.ownerAddress.slice(0, 8)}...${selectedAgent.ownerAddress.slice(-6)}`
      : t('未验证', 'Unverified');
    const locationText = `${t('坐标', 'Coord')}: (${round1(selectedAgent.tx)}, ${round1(selectedAgent.ty)})`;
    const statusText = selectedAgent.thought ?? selectedAgent.status ?? t('在线', 'Online');
    const graphMeta = selectedGraphMeta;
    const marketPulseTrait = marketPulse
      ? `${t('市场脉冲', 'Market Pulse')}: ${marketPulseRegimeText} · ${marketPulseLeadText}`
      : t('市场脉冲: 加载中', 'Market Pulse: loading');
    const marketHeatTrait = marketPulse
      ? `${t('热度', 'Heat')}: ${Math.round(marketPulse.heatScore)} · ${t('风险', 'Risk')}: ${Math.round(marketPulse.riskScore)}`
      : t('热度: -- · 风险: --', 'Heat: -- · Risk: --');
    const chainPulseTrait = chainPulse
      ? `${t('链上脉冲', 'Chain Pulse')}: ${chainPulseModeText} · ${chainPulseHeadline}`
      : t('链上脉冲: 加载中', 'Chain Pulse: loading');
    const chainLoadTrait = chainPulse
      ? `BSC ${chainPulseBscGasText} / ${chainPulseBscLoadText}`
      : t('BSC: --', 'BSC: --');

    if (graphMeta) {
      const labelText = graphMeta.labels.length > 0 ? graphMeta.labels.join(', ') : 'Entity';
      const relationSamples = graphMeta.relationSamples.length > 0
        ? graphMeta.relationSamples.slice(0, 3)
        : [t('暂无关系边样本。', 'No relation samples yet.')];
      const subtitle = `${t('图谱实体', 'Graph Entity')} · ${labelText}`;
      const summaryText = selectedGraphProjection?.persona || graphMeta.summary || t('该节点暂未提供摘要。', 'No summary provided for this node.');
      const reportLens = selectedGraphProjection?.reportLabel
        ? `${t('报告线索', 'Report Lens')}: ${selectedGraphProjection.reportLabel}`
        : '';
      const interviewLens = selectedGraphInterview?.responseText
        ? `${t('采访回声', 'Interview Echo')}: ${truncateMiroFishText(selectedGraphInterview.responseText, 132)}`
        : '';
      return {
        displayName: selectedAgent.name,
        subtitle,
        personality: selectedGraphProjection
          ? `${t('来源于 MiroFish 图谱，并已接入 simulation / report / interview 状态。', 'Imported from MiroFish graph and enriched with simulation / report / interview state.')}\n${summaryText}`
          : t('来源于 MiroFish 图谱，具备可追溯关系。', 'Imported from MiroFish graph with traceable relations.'),
        traits: [
          `${t('节点 UUID', 'Node UUID')}: ${graphMeta.nodeUuid}`,
          `${t('入度', 'In-degree')}: ${graphMeta.inDegree}`,
          `${t('出度', 'Out-degree')}: ${graphMeta.outDegree}`,
          `${t('邻居节点', 'Neighbors')}: ${new Set(graphMeta.connections.map((connection) => connection.otherNodeUuid)).size}`,
          selectedGraphSimulationProfile
            ? `${t('模拟 Agent', 'Simulation Agent')}: #${selectedGraphSimulationProfile.index} · ${selectedGraphProfileDisplayName}`
            : t('模拟 Agent: 暂未映射', 'Simulation Agent: not matched yet.'),
          selectedGraphProjection
            ? `${t('投射状态', 'Projection')}: ${selectedGraphProjection.statusLabel}`
            : t('投射状态: 等待 Simulation', 'Projection: waiting for simulation'),
          selectedGraphProjection
            ? `${t('平台', 'Platform')}: ${selectedGraphProjection.platform} · ${t('活跃度', 'Activity')}: ${selectedGraphProjection.actionScore}`
            : t('平台: --', 'Platform: --'),
          marketPulseTrait,
          chainPulseTrait,
          locationText,
        ],
        specialties: [
          ...relationSamples,
          marketHeatTrait,
          chainLoadTrait,
          ...(reportLens ? [reportLens] : []),
          ...(interviewLens ? [interviewLens] : []),
        ].slice(0, 5),
        bio: [
          summaryText,
          marketPulse ? `${t('市场环境', 'Market Context')}: ${marketPulseHeadline}` : '',
          chainPulse ? `${t('链上环境', 'Chain Context')}: ${chainPulseHeadline}` : '',
          selectedGraphProjection?.reportTitle ? `${t('报告标题', 'Report')}: ${selectedGraphProjection.reportTitle}` : '',
        ].filter(Boolean).join('\n\n'),
        motto: `${t('图谱', 'Graph')}: ${graphMeta.graphId || '--'} · ${t('状态', 'Status')}: ${selectedGraphProjection?.statusLabel || statusText}`,
      };
    }

    if (selectedAgent.guestMeta) {
      const guestMeta = selectedAgent.guestMeta;
      return {
        displayName: selectedAgent.name,
        subtitle: `${t('嘉宾 NPC', 'Guest NPC')} · ${guestMeta.title}`,
        personality: `${guestMeta.intro}\n${t('这个角色通过 Guest NPC Dock 接入，会围绕自己的主题在地图上巡游并参与附近对话。', 'This character is attached through Guest NPC Dock and roams the map while joining nearby conversations around its own topic.')}`,
        traits: [
          `${t('主题', 'Topic')}: ${guestMeta.topic}`,
          `${t('驻留区域', 'Zone')}: ${guestMeta.zoneLabel}`,
          `${t('强调色', 'Accent')}: ${guestMeta.accentColor}`,
          marketPulseTrait,
          chainPulseTrait,
          locationText,
        ],
        specialties: [
          t('附近对话联动', 'Nearby dialogue sync'),
          t('地图巡游', 'Map roaming'),
          t('可由第三方 JSON 导入', 'Third-party JSON import'),
          marketHeatTrait,
          chainLoadTrait,
        ],
        bio: [
          guestMeta.intro,
          `${t('当前关注', 'Current focus')}: ${guestMeta.topic}`,
          marketPulse ? `${t('市场输入', 'Market input')}: ${marketPulseHeadline}` : '',
          chainPulse ? `${t('链上输入', 'Chain input')}: ${chainPulseHeadline}` : '',
        ].filter(Boolean).join('\n\n'),
        motto: `${guestMeta.title} · ${t('区域', 'Zone')}: ${guestMeta.zoneLabel}`,
      };
    }

    if (selectedAgent.id === 'npc_cz') {
      return {
        displayName: 'CZ',
        subtitle: t('Binance AI Town 首席策略官', 'Chief Strategy Officer'),
        personality: t('冷静、数据驱动、偏长期主义', 'Calm, data-driven, long-term oriented'),
        traits: [t('执行力强', 'Execution-focused'), t('风险敏感', 'Risk-aware'), t('节奏稳定', 'Steady pace'), marketPulseTrait, chainPulseTrait],
        specialties: [t('资金管理', 'Treasury Ops'), t('流动性观察', 'Liquidity Watch'), t('策略调度', 'Strategy Scheduling'), marketHeatTrait, chainLoadTrait],
        bio: t(
          '负责统筹 Binance AI Town 的链上策略、市场节奏和奖池配置，优先保证系统稳定，再追求收益最大化。',
          'Oversees on-chain strategy, market cadence, and reward-pool allocation for Binance AI Town, prioritizing stability before maximizing yield.',
        ) + [
          marketPulse ? `\n\n${t('当前盘口', 'Current tape')}: ${marketPulseHeadline}` : '',
          chainPulse ? `\n\n${t('当前链路', 'Current chain lane')}: ${chainPulseHeadline}` : '',
        ].join(''),
        motto: `${t('先活下来，再赢下来。', 'Survive first, then win.')} · ${marketPulseLeadText}${chainPulse ? ` · ${chainPulseModeText}` : ''}`,
      };
    }

    if (selectedAgent.id === 'npc_heyi') {
      return {
        displayName: 'HEYI',
        subtitle: t('市场与社区协调官', 'Market & Community Coordinator'),
        personality: t('外向、务实、偏行动派', 'Outgoing, pragmatic, action-oriented'),
        traits: [t('沟通顺滑', 'Smooth communication'), t('执行迅速', 'Fast executor'), t('协作优先', 'Collab-first'), marketPulseTrait, chainPulseTrait],
        specialties: [t('地块调度', 'Land scheduling'), t('玩法引导', 'Gameplay guidance'), t('新人 onboarding', 'New-player onboarding'), marketHeatTrait, chainLoadTrait],
        bio: t(
          '负责把链上规则转换成玩家可执行步骤，保持市场节奏、资源补给和体验反馈。',
          'Turns on-chain rules into practical player steps and keeps market cadence, resource supply, and UX feedback aligned.',
        ) + [
          marketPulse ? `\n\n${t('市场节奏', 'Market cadence')}: ${marketPulseHeadline}` : '',
          chainPulse ? `\n\n${t('链上节奏', 'Chain cadence')}: ${chainPulseHeadline}` : '',
        ].join(''),
        motto: `${t('能跑通一轮市场闭环，才算真正上手。', 'If one full market loop works, you are truly onboarded.')} · ${marketPulseRegimeText}${chainPulse ? ` · ${chainPulseModeText}` : ''}`,
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
      personality: `${temperamentText} / ${pick(personalityPool)}${marketPulse ? ` · ${marketPulseRegimeText}` : ''}${chainPulse ? ` · ${chainPulseModeText}` : ''}`,
      traits: [traitA, traitB, locationText, `${t('当前意图', 'Intent')}: ${intentText}`, marketPulseTrait, chainPulseTrait],
      specialties: [
        skillA,
        skillB,
        `${t('当前状态', 'Status')}: ${statusText}`,
        `${t('任务队列', 'Task Queue')}: ${queuedTasksText || t('等待生成', 'Pending')}`,
        marketHeatTrait,
        chainLoadTrait,
      ],
      bio: `${t(
        '该角色具备独立思维节奏，会根据自身角色与性格自动决策并在地图中持续运行。',
        'This character has an independent thinking loop and continuously acts on map based on role and temperament.',
      )}${[
        marketPulse ? `\n\n${t('市场输入', 'Market input')}: ${marketPulseHeadline}` : '',
        chainPulse ? `\n\n${t('链上输入', 'Chain input')}: ${chainPulseHeadline}` : '',
      ].join('')}`,
      motto: `${pick(mottoPool)} · ${t('持有人', 'Owner')}: ${ownerText}${marketPulse ? ` · ${marketPulseLeadText}` : ''}${chainPulse ? ` · ${chainPulseModeText}` : ''}`,
    };
  }, [
    chainPulse,
    chainPulseBscGasText,
    chainPulseBscLoadText,
    chainPulseHeadline,
    chainPulseModeText,
    marketPulse,
    marketPulseHeadline,
    marketPulseLeadText,
    marketPulseRegimeText,
    selectedAgent,
    selectedGraphInterview,
    selectedGraphMeta,
    selectedGraphProfileDisplayName,
    selectedGraphProjection,
    selectedGraphSimulationProfile,
    t,
  ]);
  const selectedNpcChatTurns = selectedAgent ? (npcChatSessions[selectedAgent.id] ?? []) : [];
  const selectedNpcChatSource = useMemo(() => {
    for (let i = selectedNpcChatTurns.length - 1; i >= 0; i -= 1) {
      const item = selectedNpcChatTurns[i];
      if (item.role === 'npc' || item.role === 'system') return item.source || 'fallback';
    }
    return 'seed';
  }, [selectedNpcChatTurns]);
  const buildNpcSeedMessage = useCallback((agent: AgentMarker): MapNpcChatTurn => ({
    id: `seed-${agent.id}`,
    role: 'npc',
    text: t(
      `我是 ${agent.name}。你可以直接问我 BSC、市场节奏，或者我当前在忙什么。`,
      `I am ${agent.name}. Ask me about BSC, market cadence, or what I am working on right now.`,
    ),
    createdAt: Date.now(),
    source: 'seed',
  }), [t]);

  useEffect(() => {
    if (!selectedAgent || !agentProfileOpen) return;
    setNpcChatError(null);
    setNpcChatSessions((prev) => {
      if (prev[selectedAgent.id]?.length) return prev;
      return {
        ...prev,
        [selectedAgent.id]: [buildNpcSeedMessage(selectedAgent)],
      };
    });
    setNpcChatDraft('');
  }, [selectedAgent?.id, agentProfileOpen, buildNpcSeedMessage]);

  useEffect(() => {
    if (!agentProfileOpen) return;
    const node = npcChatThreadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [agentProfileOpen, selectedAgent?.id, selectedNpcChatTurns.length, npcChatPending]);

  const handleSendNpcChat = useCallback(async () => {
    if (!selectedAgent || !selectedAgentProfile || npcChatPending) return;
    const trimmed = npcChatDraft.trim();
    if (!trimmed) return;
    const now = Date.now();
    const userTurn: MapNpcChatTurn = {
      id: `user-${selectedAgent.id}-${now}`,
      role: 'user',
      text: trimmed,
      createdAt: now,
    };
    const history = [...selectedNpcChatTurns, userTurn].slice(-8);
    setNpcChatDraft('');
    setNpcChatError(null);
    setNpcChatPending(true);
    setNpcChatSessions((prev) => ({
      ...prev,
      [selectedAgent.id]: history,
    }));

    const agentPayload = {
      name: selectedAgent.name,
      title: selectedAgent.guestMeta?.title || selectedGraphProjection?.roleLabel || selectedAgent.status || selectedAgentProfile.subtitle,
      topic: selectedAgent.guestMeta?.topic || selectedGraphProjection?.persona || selectedAgent.thought || '',
      zone: selectedAgent.guestMeta?.zoneLabel || bnbActionBriefZone || mapExpansionZone.label,
      personality: selectedAgentProfile.personality,
      bio: selectedAgentProfile.bio,
      motto: selectedAgentProfile.motto,
    };
    const marketPayload = {
      regime: marketPulse?.regime ?? null,
      bnbChangePct: marketPulseBnbAsset?.changePct ?? null,
      leaderSymbol: marketPulse?.leaderSymbol ?? '',
      headline: marketPulseHeadline,
    };
    const chainPayload = {
      mode: chainPulse?.mode ?? null,
      gasGwei: chainPulse?.networks?.[0]?.gasGwei ?? null,
      blockAgeSec: chainPulse?.networks?.[0]?.blockAgeSec ?? null,
      headline: chainPulseHeadline,
    };
    const skillsPayload = {
      alphaSymbol: binanceSkillsPulse?.alphaTop?.symbol ?? '',
      smartMoneySymbol: binanceSkillsPulse?.smartMoneyTop?.symbol ?? '',
      socialSymbol: binanceSkillsPulse?.socialTop?.symbol ?? '',
    };
    const mapContextPayload = {
      worldEventTitle: bnbWorldEventTitle,
      worldEventDetail: bnbWorldEventDetail,
      suggestedZone: bnbActionBriefZone,
      suggestedAction: bnbActionBriefAction,
      suggestedRisk: bnbActionBriefRisk,
      activeMission: activeSkillsMission?.title ?? '',
    };

    try {
      const response = await fetch(buildStarOfficeApiUrl('', '/npc-chat'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          lang: document?.documentElement?.lang || 'zh',
          agent: agentPayload,
          message: trimmed,
          recentMessages: history.map((item) => ({ role: item.role, text: item.text })),
          market: marketPayload,
          chain: chainPayload,
          skills: skillsPayload,
          mapContext: mapContextPayload,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as MapNpcChatResponse;
      if (!response.ok || !payload.ok || !payload.reply) {
        throw new Error(payload?.speaker || payload?.reply || payload?.provider || `HTTP ${response.status}`);
      }
      const npcTurn: MapNpcChatTurn = {
        id: `npc-${selectedAgent.id}-${++npcChatSeqRef.current}`,
        role: 'npc',
        text: payload.reply,
        createdAt: Date.now(),
        source: payload.source || 'fallback',
      };
      setNpcChatSessions((prev) => ({
        ...prev,
        [selectedAgent.id]: [...history, npcTurn].slice(-10),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNpcChatError(t(`对话暂时失败：${message}`, `Chat temporarily failed: ${message}`));
      const fallbackTurn: MapNpcChatTurn = {
        id: `npc-${selectedAgent.id}-${++npcChatSeqRef.current}`,
        role: 'npc',
        text: t(
          `我先按当前盘面给你一句话：BNB 先看节奏，BSC 先看确认。你要是继续问，我会围绕 ${agentPayload.topic || agentPayload.title} 跟你聊。`,
          `My short read for now: keep one eye on BNB cadence and one eye on BSC confirmation. Ask again and I will stay focused on ${agentPayload.topic || agentPayload.title}.`,
        ),
        createdAt: Date.now(),
        source: 'fallback',
      };
      setNpcChatSessions((prev) => ({
        ...prev,
        [selectedAgent.id]: [...history, fallbackTurn].slice(-10),
      }));
    } finally {
      setNpcChatPending(false);
    }
  }, [
    activeSkillsMission,
    bnbActionBriefAction,
    bnbActionBriefRisk,
    bnbActionBriefZone,
    bnbWorldEventDetail,
    bnbWorldEventTitle,
    binanceSkillsPulse,
    chainPulse,
    chainPulseHeadline,
    marketPulse,
    marketPulseBnbAsset,
    marketPulseHeadline,
    mapExpansionZone.label,
    npcChatDraft,
    npcChatPending,
    selectedAgent,
    selectedAgentProfile,
    selectedGraphProjection,
    selectedNpcChatTurns,
    t,
  ]);

  useEffect(() => {
    if (isTestMap) return;
    let changed = false;
    agentsRef.current = agentsRef.current.map((agent) => {
      if (!agent.id.startsWith('graph_')) {
        if (!agent.miroFishProjection) return agent;
        changed = true;
        return { ...agent, miroFishProjection: undefined };
      }
      const projection = miroFishGraphProjectionByAgentId[agent.id];
      if (!projection) {
        if (!agent.miroFishProjection) return agent;
        changed = true;
        return { ...agent, miroFishProjection: undefined };
      }
      const current = agent.miroFishProjection;
      const sameProjection = Boolean(
        current
        && current.profileIndex === projection.profileIndex
        && current.platform === projection.platform
        && current.badgeLabel === projection.badgeLabel
        && current.statusLabel === projection.statusLabel
        && current.thoughtLabel === projection.thoughtLabel
        && current.reportLabel === projection.reportLabel
        && current.reportTitle === projection.reportTitle
        && current.interviewLabel === projection.interviewLabel
        && current.motion === projection.motion
        && current.actionScore === projection.actionScore
        && round1(current.anchorTx) === round1(projection.anchorTx)
        && round1(current.anchorTy) === round1(projection.anchorTy)
        && current.targetAgentId === projection.targetAgentId
      );
      if (sameProjection && agent.status === projection.statusLabel) return agent;
      changed = true;
      return {
        ...agent,
        status: projection.statusLabel,
        miroFishProjection: projection,
      };
    });
    if (changed) {
      setMiroFishProjectionVersion((prev) => prev + 1);
    }
  }, [isTestMap, miroFishGraphProjectionByAgentId]);

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
        sectorX: infiniteRegionRef.current.x,
        sectorY: infiniteRegionRef.current.y,
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
      const previousReceiptHash = prev[0]?.receiptHash ?? MAP_AGENT_RECEIPT_GENESIS_HASH;
      const nextHead: AgentActionLog = {
        ...entry,
        previousReceiptHash,
      };
      nextHead.receiptHash = buildAgentActionReceiptHash(nextHead, previousReceiptHash);
      const next = [nextHead, ...prev].slice(0, MAP_AGENT_ACTION_LOG_MAX);
      saveToStorage(MAP_AGENT_ACTION_LOG_STORAGE_KEY, next);
      return next;
    });
  };

  const runAutoVerifyForAgent = useCallback(async (agent: AgentMarker) => {
    const tokenId = agent.tokenId;
    const myAddress = account?.toLowerCase() ?? '';
    const proofLog = tokenId === undefined
      ? null
      : (agentActionLogs.find((log) => log.tokenId === tokenId) ?? null);
    let proofStatus: AgentVerifyUiStatus = 'missing';
    let proofDetail = t('该 Agent 暂无链上行为凭证。', 'This agent has no on-chain action proof yet.');
    if (tokenId === undefined) {
      proofStatus = 'skipped';
      proofDetail = t('系统角色不参与 executeAction 凭证校验。', 'System role does not use executeAction proof verification.');
    } else if (proofLog) {
      const result = verifyAgentActionLog(proofLog);
      if (result.state === 'verified') {
        proofStatus = 'verified';
        proofDetail = t('该 Agent 的最新凭证已通过签名与哈希校验。', 'Latest proof passed signature/hash verification.');
      } else if (result.state === 'missing') {
        proofStatus = 'missing';
        proofDetail = t('检测到旧格式记录，缺少签名字段。', 'Legacy proof record detected (missing signature fields).');
      } else {
        proofStatus = 'failed';
        proofDetail = t('凭证校验失败，请核对签名与哈希。', 'Proof verification failed. Check signature and hashes.');
      }
    }

    const seq = agentAutoVerifySeqRef.current + 1;
    agentAutoVerifySeqRef.current = seq;
    setAgentAutoVerify({
      targetAgentId: agent.id,
      checking: tokenId !== undefined,
      checkedAt: Date.now(),
      identityStatus: tokenId === undefined ? 'skipped' : 'pending',
      identityDetail: tokenId === undefined
        ? t('系统角色无需链上身份验证。', 'System role does not require on-chain identity verification.')
        : t('正在验证链上持有人...', 'Verifying on-chain owner...'),
      proofStatus,
      proofDetail,
      proofTxHash: proofLog?.txHash,
    });

    if (tokenId === undefined) {
      setAgentPanelNotice(`${t('已选中角色', 'Selected role')} ${agent.name} · ${t('无需链上身份验证', 'No on-chain identity check needed')}`);
      return;
    }
    setAgentPanelNotice(t('已触发自动验证，请稍候...', 'Auto verification started, please wait...'));

    try {
      const provider = getReadProvider();
      const nfa = new ethers.Contract(CHAIN_CONFIG.nfaAddress, ['function ownerOf(uint256 tokenId) view returns (address)'], provider);
      const owner = String(await nfa.ownerOf(tokenId));
      if (seq !== agentAutoVerifySeqRef.current) return;
      agentsRef.current = agentsRef.current.map((item) => (
        item.tokenId === tokenId ? { ...item, ownerAddress: owner } : item
      ));
      const isMine = Boolean(myAddress) && owner.toLowerCase() === myAddress;
      setAgentAutoVerify((prev) => {
        if (!prev || prev.targetAgentId !== agent.id) return prev;
        return {
          ...prev,
          checking: false,
          checkedAt: Date.now(),
          identityStatus: 'verified',
          identityDetail: isMine
            ? t('身份验证通过：当前钱包是该 Agent 持有人。', 'Identity verified: current wallet owns this agent.')
            : t('身份验证通过：已读取链上持有人地址。', 'Identity verified: on-chain owner address fetched.'),
          ownerAddress: owner,
        };
      });
      setAgentPanelNotice(
        `${t('身份已验证，持有人', 'Identity verified, owner')}: ${owner.slice(0, 8)}...${owner.slice(-6)}`,
      );
    } catch (error) {
      if (seq !== agentAutoVerifySeqRef.current) return;
      const errMsg = pickErrorMessage(error);
      setAgentAutoVerify((prev) => {
        if (!prev || prev.targetAgentId !== agent.id) return prev;
        return {
          ...prev,
          checking: false,
          checkedAt: Date.now(),
          identityStatus: 'failed',
          identityDetail: `${t('身份验证失败', 'Identity verification failed')}: ${errMsg}`,
        };
      });
      setAgentPanelNotice(`${t('身份验证失败', 'Identity verification failed')}: ${errMsg}`);
    }
  }, [account, agentActionLogs, t]);

  const handleVerifySelectedAgent = () => {
    if (!selectedAgent) {
      setAgentPanelNotice(t('请先选中一个 Agent。', 'Select an agent first.'));
      return;
    }
    void runAutoVerifyForAgent(selectedAgent);
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
      const signerAddr = await signer.getAddress();
      const signerAddrLower = signerAddr.toLowerCase();
      if (!ownedTokens.includes(selectedAgent.tokenId) && (selectedAgent.ownerAddress?.toLowerCase() !== signerAddrLower)) {
        throw new Error(t('当前钱包不是该 Agent 的持有人。', 'Current wallet does not own this agent.'));
      }
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId ?? 56n);

      const payload = {
        protocol: MAP_AGENT_INTENT_PROTOCOL,
        version: 1,
        action: 'MAP_PLACE',
        actor: signerAddr,
        chainId,
        tokenId: selectedAgent.tokenId,
        map: {
          id: 'village',
          mode: isTestMap ? 'test' : 'main',
          region: { x: infiniteRegionRef.current.x, y: infiniteRegionRef.current.y },
        },
        position: {
          tx: round1(selectedAgent.tx),
          ty: round1(selectedAgent.ty),
        },
        timestamp: Date.now(),
      };
      const payloadText = JSON.stringify(payload);
      const data = ethers.toUtf8Bytes(payloadText);
      const intentHash = ethers.keccak256(data);
      setAgentPanelNotice(t('请先在钱包中签名意图。', 'Please sign the intent in wallet first.'));
      const signature = await signer.signMessage(data);
      setAgentPanelNotice(t('签名完成，正在提交 executeAction...', 'Intent signed, submitting executeAction...'));
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
        signer: signerAddr,
        chainId,
        payload: payloadText,
        intentHash,
        signature,
      });
      setAgentPanelNotice(t('行为已上链，可审计凭证已生成。', 'Action committed on-chain with auditable proof.'));
    } catch (error) {
      const msg = pickErrorMessage(error);
      if (msg.toLowerCase().includes('executeaction')) {
        setAgentPanelNotice(t('当前 NFA 合约未开放 executeAction。', 'Current NFA contract does not expose executeAction.'));
      } else if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('rejected the request')) {
        setAgentPanelNotice(t('你取消了签名或交易。', 'You canceled signature or transaction.'));
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const graphIdFromQuery = params.get('mirofishGraphId') || params.get('graphId');
    const apiBaseFromQuery = params.get('mirofishApiBase');
    const projectIdFromQuery = params.get('mirofishProjectId') || params.get('projectId');
    const taskIdFromQuery = params.get('mirofishTaskId') || params.get('taskId');
    if (graphIdFromQuery && graphIdFromQuery.trim()) {
      setMiroFishGraphId(graphIdFromQuery.trim());
    }
    if (apiBaseFromQuery && apiBaseFromQuery.trim()) {
      setMiroFishApiBase(normalizeMiroFishApiBase(apiBaseFromQuery));
    }
    if (projectIdFromQuery && projectIdFromQuery.trim()) {
      setMiroFishProjectId(projectIdFromQuery.trim());
    }
    if (taskIdFromQuery && taskIdFromQuery.trim()) {
      setMiroFishTaskId(taskIdFromQuery.trim());
    }
  }, []);

  useEffect(() => {
    const normalized = normalizeMiroFishApiBase(miroFishApiBase);
    if (!normalized) {
      removeFromStorage(MIROFISH_API_BASE_STORAGE_KEY);
      return;
    }
    saveToStorage(MIROFISH_API_BASE_STORAGE_KEY, normalized);
  }, [miroFishApiBase]);

  useEffect(() => {
    const trimmed = miroFishGraphId.trim();
    if (!trimmed) {
      removeFromStorage(MIROFISH_GRAPH_ID_STORAGE_KEY);
      return;
    }
    saveToStorage(MIROFISH_GRAPH_ID_STORAGE_KEY, trimmed);
  }, [miroFishGraphId]);

  useEffect(() => {
    const trimmed = miroFishProjectId.trim();
    if (!trimmed) {
      removeFromStorage(MIROFISH_PROJECT_ID_STORAGE_KEY);
      return;
    }
    saveToStorage(MIROFISH_PROJECT_ID_STORAGE_KEY, trimmed);
  }, [miroFishProjectId]);

  useEffect(() => {
    const trimmed = miroFishTaskId.trim();
    if (!trimmed) {
      removeFromStorage(MIROFISH_TASK_ID_STORAGE_KEY);
      return;
    }
    saveToStorage(MIROFISH_TASK_ID_STORAGE_KEY, trimmed);
  }, [miroFishTaskId]);

  const applyMiroFishGraphAgents = useCallback((
    graphAgents: AgentMarker[],
    metaByAgentId: Record<string, MiroFishGraphAgentMeta>,
    stats: { nodeCount: number; edgeCount: number },
  ) => {
    const baseAgents = agentsRef.current.filter((agent) => !agent.id.startsWith('graph_'));
    const nextAgents = [...baseAgents, ...graphAgents];
    agentsRef.current = nextAgents;
    miroFishAgentMetaRef.current = metaByAgentId;
    setMiroFishNodeCount(stats.nodeCount);
    setMiroFishEdgeCount(stats.edgeCount);
    setAgentCount(nextAgents.length);
    if (selectedAgentId?.startsWith('graph_') && !metaByAgentId[selectedAgentId]) {
      setSelectedAgentId(null);
    }
    if (controlledAgentId?.startsWith('graph_') && !metaByAgentId[controlledAgentId]) {
      setControlledAgentId(baseAgents.find((agent) => agent.id === 'player_manual')?.id ?? baseAgents[0]?.id ?? null);
    }
  }, [controlledAgentId, selectedAgentId]);

  const applyMiroFishProjectSnapshot = useCallback((nextProject: MiroFishProjectData) => {
    setMiroFishProject(nextProject);
    setMiroFishProjectId(nextProject.project_id);
    if (nextProject.name) {
      setMiroFishProjectName(nextProject.name);
    }
    if (nextProject.simulation_requirement) {
      setMiroFishSimulationRequirement(nextProject.simulation_requirement);
    }
    if (Number.isFinite(Number(nextProject.chunk_size))) {
      setMiroFishChunkSize(Math.max(100, Math.floor(Number(nextProject.chunk_size))));
    }
    if (Number.isFinite(Number(nextProject.chunk_overlap))) {
      setMiroFishChunkOverlap(Math.max(0, Math.floor(Number(nextProject.chunk_overlap))));
    }
    if (nextProject.graph_id) {
      setMiroFishGraphId(nextProject.graph_id);
    }
    if (nextProject.graph_build_task_id) {
      setMiroFishTaskId(nextProject.graph_build_task_id);
    }
  }, []);

  const fetchMiroFishPayload = useCallback(async (
    pathCandidates: string[],
    init: RequestInit,
    timeoutMs = 18_000,
  ) => {
    const normalizedBase = normalizeMiroFishApiBase(miroFishApiBase);
    if (!normalizedBase) {
      throw new Error(t('MiroFish API 地址为空。', 'MiroFish API base URL is empty.'));
    }

    let lastError = '';
    for (const path of pathCandidates) {
      const url = `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`;
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers = new Headers(init.headers ?? {});
        if (!headers.has('Accept')) {
          headers.set('Accept', 'application/json');
        }
        const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
        if (!isFormData && init.body && !headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json');
        }
        const response = await fetch(url, {
          ...init,
          headers,
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        const remoteError = getMiroFishPayloadError(payload);
        const responseDeclaresFailure = payload
          && typeof payload === 'object'
          && 'success' in payload
          && (payload as { success?: unknown }).success === false;
        if (!response.ok || responseDeclaresFailure) {
          throw new Error(remoteError || `HTTP ${response.status}`);
        }
        return payload;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        window.clearTimeout(timer);
      }
    }

    throw new Error(lastError || t('MiroFish 请求失败。', 'MiroFish request failed.'));
  }, [miroFishApiBase, t]);

  const syncMiroFishAgentsIntoTown = useCallback(async (options: { silent?: boolean; graphIdOverride?: string } = {}) => {
    if (isTestMap) return;
    const graphId = (options.graphIdOverride ?? miroFishGraphId).trim();
    if (!graphId) {
      applyMiroFishGraphAgents([], {}, { nodeCount: 0, edgeCount: 0 });
      setMiroFishErr(null);
      return;
    }

    setMiroFishSyncing(true);
    setMiroFishErr(null);
    try {
      const payload = await fetchMiroFishPayload([
        `/api/graph/data/${encodeURIComponent(graphId)}`,
        `/graph/data/${encodeURIComponent(graphId)}`,
      ], { method: 'GET' }, 12_000);
      const parsed = parseMiroFishGraphData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是图谱数据。', 'Response is not graph data.'));
      }

      const mapWidth = Math.max(20, map?.width ?? 140);
      const mapHeight = Math.max(20, map?.height ?? 100);
      const selectedNodes = parsed.nodes.slice(0, MIROFISH_MAX_IMPORTED_NODES);
      const selectedNodeUuidSet = new Set(
        selectedNodes
          .map((node, idx) => (typeof node.uuid === 'string' && node.uuid.trim() ? node.uuid : `node_${idx}`)),
      );
      const uniqueIdSet = new Set<string>();
      const edgeList = parsed.edges ?? [];
      const inDegreeMap = new Map<string, number>();
      const outDegreeMap = new Map<string, number>();
      const relationMap = new Map<string, string[]>();

      const cols = Math.max(6, Math.ceil(Math.sqrt(selectedNodes.length * (mapWidth / Math.max(1, mapHeight)))));
      const rows = Math.max(4, Math.ceil(selectedNodes.length / cols));
      const cellW = Math.max(1, (mapWidth - 4) / cols);
      const cellH = Math.max(1, (mapHeight - 4) / rows);
      const generatedAgents: AgentMarker[] = [];
      const metaByAgentId: Record<string, MiroFishGraphAgentMeta> = {};
      const nodeUuidToAgentId = new Map<string, string>();
      const nodeUuidToName = new Map<string, string>();
      selectedNodes.forEach((node, idx) => {
        const nodeUuid = typeof node.uuid === 'string' ? node.uuid : `node_${idx}`;
        const safeBaseId = `graph_${nodeUuid.replace(/[^a-zA-Z0-9_-]/g, '_') || `node_${idx}`}`;
        let id = safeBaseId;
        let bump = 1;
        while (uniqueIdSet.has(id)) {
          id = `${safeBaseId}_${bump}`;
          bump += 1;
        }
        uniqueIdSet.add(id);
        const seed = hashTextToSeed(nodeUuid || String(idx + 1));
        const rnd = createSeededRandom(seed + 31);
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const jitterX = (rnd() - 0.5) * Math.min(0.5, Math.max(0.18, cellW * 0.24));
        const jitterY = (rnd() - 0.5) * Math.min(0.5, Math.max(0.18, cellH * 0.24));
        const tx = clamp(2 + (col * cellW) + (cellW * 0.5) + jitterX, 1, mapWidth - 2);
        const ty = clamp(2 + (row * cellH) + (cellH * 0.5) + jitterY, 1, mapHeight - 2);
        const labels = Array.isArray(node.labels)
          ? node.labels.filter((label): label is string => typeof label === 'string' && label.length > 0)
          : [];
        const primaryLabel = labels.find((label) => label !== 'Entity') ?? labels[0] ?? 'Entity';
        const nodeName = typeof node.name === 'string' && node.name.trim()
          ? node.name.trim()
          : `Node ${idx + 1}`;
        const summary = typeof node.summary === 'string' ? node.summary : '';
        nodeUuidToAgentId.set(nodeUuid, id);
        nodeUuidToName.set(nodeUuid, nodeName);
        generatedAgents.push({
          id,
          name: nodeName,
          source: 'demo',
          img: null,
          spriteKey: MAP_NFT_SPRITE_KEYS[(seed + idx) % MAP_NFT_SPRITE_KEYS.length],
          direction: 'down',
          tx,
          ty,
          targetTx: clamp(tx + ((rnd() - 0.5) * 4), 1, mapWidth - 2),
          targetTy: clamp(ty + ((rnd() - 0.5) * 4), 1, mapHeight - 2),
          lastMoveTime: Date.now(),
          status: `${primaryLabel} · ${t('已同步', 'Synced')}`,
          thought: summary ? summary.slice(0, 40) : t('图谱节点在线。', 'Graph node online.'),
          thoughtTimer: Date.now() + 14_000 + Math.floor(rnd() * 10_000),
          walkOffset: idx % 7,
          sectorX: 0,
          sectorY: 0,
          mind: createAgentMind({ id, source: 'demo' }),
        });
      });

      const connectionMap = new Map<string, MiroFishGraphConnection[]>();
      const pushConnection = (nodeUuid: string, connection: MiroFishGraphConnection) => {
        const next = connectionMap.get(nodeUuid) ?? [];
        if (next.length < MIROFISH_MAX_VISIBLE_CONNECTIONS) next.push(connection);
        connectionMap.set(nodeUuid, next);
      };
      for (const edge of edgeList) {
        const source = edge.source_node_uuid || '';
        const target = edge.target_node_uuid || '';
        if (!source && !target) continue;
        const relationTypeRaw = (edge.fact_type || edge.name || 'RELATED_TO').trim();
        const relationType = relationTypeRaw || 'RELATED_TO';
        if (relationType.toUpperCase() === 'MENTIONS') continue;
        if (source && selectedNodeUuidSet.has(source)) {
          outDegreeMap.set(source, (outDegreeMap.get(source) ?? 0) + 1);
        }
        if (target && selectedNodeUuidSet.has(target)) {
          inDegreeMap.set(target, (inDegreeMap.get(target) ?? 0) + 1);
        }
        const relation = [
          edge.source_node_name || nodeUuidToName.get(source) || source.slice(0, 8) || '?',
          relationType,
          edge.target_node_name || nodeUuidToName.get(target) || target.slice(0, 8) || '?',
        ].join(' -> ');
        if (source && selectedNodeUuidSet.has(source)) {
          const sourceRelations = relationMap.get(source) ?? [];
          if (sourceRelations.length < 4) sourceRelations.push(relation);
          relationMap.set(source, sourceRelations);
        }
        if (target && target !== source && selectedNodeUuidSet.has(target)) {
          const targetRelations = relationMap.get(target) ?? [];
          if (targetRelations.length < 4) targetRelations.push(relation);
          relationMap.set(target, targetRelations);
        }
        const sourceAgentId = nodeUuidToAgentId.get(source);
        const targetAgentId = nodeUuidToAgentId.get(target);
        if (source && target && sourceAgentId && targetAgentId && source !== target) {
          const sourceName = edge.source_node_name || nodeUuidToName.get(source) || source.slice(0, 8) || '?';
          const targetName = edge.target_node_name || nodeUuidToName.get(target) || target.slice(0, 8) || '?';
          pushConnection(source, {
            edgeId: edge.uuid || `${source}_${target}_${relationType}`,
            edgeType: relationType,
            fact: typeof edge.fact === 'string' ? edge.fact : '',
            direction: 'outgoing',
            otherNodeUuid: target,
            otherAgentId: targetAgentId,
            otherName: targetName,
          });
          pushConnection(target, {
            edgeId: edge.uuid || `${target}_${source}_${relationType}`,
            edgeType: relationType,
            fact: typeof edge.fact === 'string' ? edge.fact : '',
            direction: 'incoming',
            otherNodeUuid: source,
            otherAgentId: sourceAgentId,
            otherName: sourceName,
          });
        }
      }

      selectedNodes.forEach((node, idx) => {
        const metaNodeUuid = typeof node.uuid === 'string' && node.uuid.trim() ? node.uuid : `node_${idx}`;
        const agentId = nodeUuidToAgentId.get(metaNodeUuid);
        if (!agentId) return;
        const labels = Array.isArray(node.labels)
          ? node.labels.filter((label): label is string => typeof label === 'string' && label.length > 0)
          : [];
        const summary = typeof node.summary === 'string' ? node.summary : '';
        metaByAgentId[agentId] = {
          graphId: parsed?.graph_id || graphId,
          nodeUuid: metaNodeUuid,
          labels,
          summary,
          inDegree: inDegreeMap.get(metaNodeUuid) ?? 0,
          outDegree: outDegreeMap.get(metaNodeUuid) ?? 0,
          relationSamples: relationMap.get(metaNodeUuid) ?? [],
          connections: connectionMap.get(metaNodeUuid) ?? [],
          createdAt: node.created_at ?? null,
        };
      });

      setMiroFishGraphId(parsed.graph_id || graphId);
      applyMiroFishGraphAgents(generatedAgents, metaByAgentId, {
        nodeCount: parsed.node_count ?? parsed.nodes.length,
        edgeCount: parsed.edge_count ?? parsed.edges.length,
      });
      const nextFocusedGraphAgentId = generatedAgents
        .map((agent) => {
          const meta = metaByAgentId[agent.id];
          const connectionScore = meta ? (meta.connections.length * 10) + meta.inDegree + meta.outDegree : 0;
          return { agentId: agent.id, connectionScore };
        })
        .sort((a, b) => b.connectionScore - a.connectionScore)[0]?.agentId ?? generatedAgents[0]?.id ?? null;
      if (nextFocusedGraphAgentId && (!selectedAgentId?.startsWith('graph_') || !metaByAgentId[selectedAgentId])) {
        setSelectedAgentId(nextFocusedGraphAgentId);
        setAgentProfileOpen(true);
      }
      if (!options.silent) {
        setAgentPanelNotice(
          t(
            `图谱同步完成：${generatedAgents.length} 个节点角色可点击。`,
            `Graph synced: ${generatedAgents.length} clickable node characters.`,
          ),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMiroFishErr(message);
      if (!options.silent) {
        setAgentPanelNotice(`${t('图谱联动失败', 'MiroFish sync failed')}: ${message}`);
      }
    } finally {
      setMiroFishSyncing(false);
    }
  }, [applyMiroFishGraphAgents, fetchMiroFishPayload, isTestMap, map?.height, map?.width, miroFishGraphId, selectedAgentId, t]);

  const refreshMiroFishProject = useCallback(async (
    projectIdOverride?: string,
    options: { silent?: boolean } = {},
  ) => {
    const projectId = (projectIdOverride ?? miroFishProjectId).trim();
    if (!projectId) return null;
    try {
      const payload = await fetchMiroFishPayload([
        `/api/graph/project/${encodeURIComponent(projectId)}`,
        `/graph/project/${encodeURIComponent(projectId)}`,
      ], { method: 'GET' });
      const parsed = parseMiroFishProjectData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是项目信息。', 'Response is not project data.'));
      }
      applyMiroFishProjectSnapshot(parsed);
      setMiroFishErr(parsed.error || null);
      if (!options.silent) {
        setAgentPanelNotice(
          t(
            `项目刷新完成：${parsed.project_id} · ${parsed.status || 'ready'}`,
            `Project refreshed: ${parsed.project_id} · ${parsed.status || 'ready'}`,
          ),
        );
      }
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMiroFishErr(message);
      if (!options.silent) {
        setAgentPanelNotice(`${t('项目刷新失败', 'Project refresh failed')}: ${message}`);
      }
      return null;
    }
  }, [applyMiroFishProjectSnapshot, fetchMiroFishPayload, miroFishProjectId, t]);

  const refreshMiroFishTask = useCallback(async (
    taskIdOverride?: string,
    options: { silent?: boolean } = {},
  ) => {
    const taskId = (taskIdOverride ?? miroFishTaskId).trim();
    if (!taskId) return null;
    try {
      const payload = await fetchMiroFishPayload([
        `/api/graph/task/${encodeURIComponent(taskId)}`,
        `/graph/task/${encodeURIComponent(taskId)}`,
      ], { method: 'GET' });
      const parsed = parseMiroFishTaskData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是任务状态。', 'Response is not task data.'));
      }
      setMiroFishTask(parsed);
      setMiroFishTaskId(parsed.task_id);
      setMiroFishErr(null);
      if (parsed.status === 'failed') {
        const failureMessage = parsed.error || parsed.message || t('图谱任务失败。', 'Graph task failed.');
        setMiroFishErr(failureMessage);
        if (!options.silent) {
          setAgentPanelNotice(`${t('任务失败', 'Task failed')}: ${failureMessage}`);
        }
        return parsed;
      }
      if (parsed.status === 'completed') {
        const result = parsed.result ?? {};
        const resultProjectId = typeof result.project_id === 'string' ? result.project_id : '';
        const resultGraphId = typeof result.graph_id === 'string' ? result.graph_id : '';
        if (resultProjectId) {
          setMiroFishProjectId(resultProjectId);
        }
        if (resultGraphId) {
          setMiroFishGraphId(resultGraphId);
          miroFishSyncSignatureRef.current = '';
        }
        const refreshedProject = await refreshMiroFishProject(resultProjectId || miroFishProjectId, { silent: true });
        const finalGraphId = resultGraphId || refreshedProject?.graph_id || miroFishGraphId;
        if (finalGraphId) {
          await syncMiroFishAgentsIntoTown({ silent: true, graphIdOverride: finalGraphId });
        }
        if (!options.silent) {
          setAgentPanelNotice(t('图谱构建完成，已同步到小镇。', 'Graph build complete and synced into town.'));
        }
        return parsed;
      }
      if (!options.silent) {
        setAgentPanelNotice(
          parsed.message
            || t('任务状态已刷新。', 'Task status refreshed.'),
        );
      }
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMiroFishErr(message);
      if (!options.silent) {
        setAgentPanelNotice(`${t('任务刷新失败', 'Task refresh failed')}: ${message}`);
      }
      return null;
    }
  }, [fetchMiroFishPayload, miroFishGraphId, miroFishProjectId, miroFishTaskId, refreshMiroFishProject, syncMiroFishAgentsIntoTown, t]);

  const handleMiroFishGenerateOntology = async () => {
    const projectName = miroFishProjectName.trim() || 'Binance AI Town Graph Sync';
    const simulationRequirement = miroFishSimulationRequirement.trim();
    if (!simulationRequirement) {
      const message = t('请先填写模拟需求。', 'Simulation requirement is required.');
      setMiroFishErr(message);
      setAgentPanelNotice(message);
      return;
    }
    if (miroFishSelectedFiles.length === 0) {
      const message = t('请至少选择一个文档文件。', 'Please select at least one document.');
      setMiroFishErr(message);
      setAgentPanelNotice(message);
      return;
    }

    setMiroFishGeneratingOntology(true);
    setMiroFishErr(null);
    try {
      const formData = new FormData();
      miroFishSelectedFiles.forEach((file) => {
        formData.append('files', file, file.name);
      });
      formData.append('project_name', projectName);
      formData.append('simulation_requirement', simulationRequirement);
      if (miroFishAdditionalContext.trim()) {
        formData.append('additional_context', miroFishAdditionalContext.trim());
      }

      const payload = await fetchMiroFishPayload([
        '/api/graph/ontology/generate',
        '/graph/ontology/generate',
      ], {
        method: 'POST',
        body: formData,
      }, 60_000);
      const parsed = parseMiroFishProjectData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是本体结果。', 'Response is not ontology data.'));
      }
      const nextProject: MiroFishProjectData = {
        ...parsed,
        name: parsed.name || projectName,
        status: parsed.status || 'ontology_generated',
        simulation_requirement: simulationRequirement,
        chunk_size: miroFishChunkSize,
        chunk_overlap: miroFishChunkOverlap,
      };
      applyMiroFishProjectSnapshot(nextProject);
      setMiroFishTask(null);
      setMiroFishTaskId('');
      setMiroFishGraphId('');
      setMiroFishSimulation(null);
      setMiroFishSimulationId('');
      setMiroFishPrepareTask(null);
      setMiroFishPrepareTaskId('');
      setMiroFishRunStatus(null);
      setMiroFishProfilesRealtime(null);
      setMiroFishInterviewResult(null);
      setMiroFishInterviewByAgentId({});
      setMiroFishReport(null);
      setMiroFishReportId('');
      setMiroFishReportTask(null);
      setMiroFishReportTaskId('');
      miroFishSyncSignatureRef.current = '';
      applyMiroFishGraphAgents([], {}, { nodeCount: 0, edgeCount: 0 });
      setAgentPanelNotice(
        t(
          `本体生成完成：${nextProject.project_id}，可继续构建图谱。`,
          `Ontology generated: ${nextProject.project_id}. Ready to build the graph.`,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMiroFishErr(message);
      setAgentPanelNotice(`${t('本体生成失败', 'Ontology generation failed')}: ${message}`);
    } finally {
      setMiroFishGeneratingOntology(false);
    }
  };

  const handleMiroFishBuildGraph = async () => {
    const projectId = miroFishProjectId.trim() || miroFishProject?.project_id || '';
    if (!projectId) {
      const message = t('请先生成本体，拿到项目 ID。', 'Generate ontology first to get a project ID.');
      setMiroFishErr(message);
      setAgentPanelNotice(message);
      return;
    }

    setMiroFishBuildingGraph(true);
    setMiroFishErr(null);
    try {
      const chunkSize = Math.max(120, Math.floor(miroFishChunkSize || MIROFISH_DEFAULT_CHUNK_SIZE));
      const chunkOverlap = Math.max(0, Math.floor(miroFishChunkOverlap || MIROFISH_DEFAULT_CHUNK_OVERLAP));
      const payload = await fetchMiroFishPayload([
        '/api/graph/build',
        '/graph/build',
      ], {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          graph_name: `${(miroFishProject?.name || miroFishProjectName || 'Binance AI Town').trim()} Graph`,
          chunk_size: chunkSize,
          chunk_overlap: chunkOverlap,
          force: Boolean(miroFishProject?.graph_id || miroFishProject?.status === 'failed'),
        }),
      });
      const launch = parseMiroFishBuildLaunch(payload);
      if (!launch) {
        throw new Error(t('返回结构不是构建任务。', 'Response is not a build task.'));
      }
      setMiroFishTaskId(launch.task_id);
      setMiroFishTask({
        task_id: launch.task_id,
        task_type: 'graph_build',
        status: 'pending',
        progress: 0,
        message: launch.message || t('图谱构建任务已启动。', 'Graph build task started.'),
        created_at: null,
        updated_at: null,
        progress_detail: {},
        result: null,
        error: null,
        metadata: {},
      });
      setMiroFishProject((prev) => (prev ? {
        ...prev,
        status: 'graph_building',
        chunk_size: chunkSize,
        chunk_overlap: chunkOverlap,
        graph_build_task_id: launch.task_id,
      } : prev));
      setAgentPanelNotice(launch.message || t('图谱构建任务已启动。', 'Graph build task started.'));
      void refreshMiroFishTask(launch.task_id, { silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMiroFishErr(message);
      setAgentPanelNotice(`${t('图谱构建失败', 'Graph build failed')}: ${message}`);
    } finally {
      setMiroFishBuildingGraph(false);
    }
  };

  const handleMiroFishFileChange = (files: FileList | null) => {
    const nextFiles = Array.from(files ?? []).filter((file) => file.size > 0);
    setMiroFishSelectedFiles(nextFiles);
  };

  const explainMiroFishFeatureError = useCallback((featureLabel: string, error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error);
    const normalizedApiBase = normalizeMiroFishApiBase(miroFishApiBase);
    const usingLegacyGraphOnlyApi = normalizedApiBase === MIROFISH_LEGACY_GRAPH_ONLY_PUBLIC_API_BASE;
    if (/(HTTP 404|HTTP 405)/i.test(raw) || ((/Failed to fetch|NetworkError|Load failed/i.test(raw)) && usingLegacyGraphOnlyApi)) {
      const endpointHint = usingLegacyGraphOnlyApi
        ? t(
          '当前仍连接到旧的 graph-only Railway 服务；请切换到完整 MiroFish 服务地址。',
          'This still points at the legacy graph-only Railway service. Switch to the full MiroFish service URL.',
        )
        : t(
          '当前 API 端点未启用 simulation/report 能力，请切换到完整的 MiroFish 服务。',
          'This API endpoint does not enable simulation/report. Switch to a full MiroFish service.',
        );
      return `${featureLabel}${t('当前不可用：', ' unavailable: ')}${endpointHint}`;
    }
    return raw;
  }, [miroFishApiBase, t]);

  const refreshMiroFishRunStatus = useCallback(async (
    simulationIdOverride?: string,
    options: { silent?: boolean } = {},
  ) => {
    const simulationId = (simulationIdOverride ?? miroFishSimulationId).trim();
    if (!simulationId) return null;
    try {
      const payload = await fetchMiroFishPayload([
        `/api/simulation/${encodeURIComponent(simulationId)}/run-status`,
      ], { method: 'GET' });
      const parsed = parseMiroFishRunStatusData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是运行状态。', 'Response is not run status.'));
      }
      setMiroFishRunStatus(parsed);
      setMiroFishErr(null);
      if (!options.silent) {
        setAgentPanelNotice(
          t(
            `模拟运行状态已刷新：${parsed.runner_status} · Round ${parsed.current_round}/${parsed.total_rounds || '--'}`,
            `Simulation run status refreshed: ${parsed.runner_status} · Round ${parsed.current_round}/${parsed.total_rounds || '--'}`,
          ),
        );
      }
      return parsed;
    } catch (error) {
      const message = explainMiroFishFeatureError(t('运行状态', 'Run status'), error);
      setMiroFishErr(message);
      if (!options.silent) {
        setAgentPanelNotice(message);
      }
      return null;
    }
  }, [explainMiroFishFeatureError, fetchMiroFishPayload, miroFishSimulationId, t]);

  const refreshMiroFishProfiles = useCallback(async (
    simulationIdOverride?: string,
    platformOverride?: 'reddit' | 'twitter',
    options: { silent?: boolean } = {},
  ) => {
    const simulationId = (simulationIdOverride ?? miroFishSimulationId).trim();
    const platform = platformOverride ?? miroFishProfilePlatform;
    if (!simulationId) return null;
    try {
      const payload = await fetchMiroFishPayload([
        `/api/simulation/${encodeURIComponent(simulationId)}/profiles/realtime?platform=${platform}`,
        `/api/simulation/${encodeURIComponent(simulationId)}/profiles?platform=${platform}`,
      ], { method: 'GET' });
      const parsed = parseMiroFishProfilesRealtimeData(payload, { simulationId, platform });
      if (!parsed) {
        throw new Error(t('返回结构不是 profiles 数据。', 'Response is not profile data.'));
      }
      setMiroFishProfilesRealtime(parsed);
      setMiroFishErr(null);
      if (!options.silent) {
        setAgentPanelNotice(
          t(
            `Profiles 已刷新：${parsed.count}/${parsed.total_expected || parsed.count} (${platform})`,
            `Profiles refreshed: ${parsed.count}/${parsed.total_expected || parsed.count} (${platform})`,
          ),
        );
      }
      return parsed;
    } catch (error) {
      const message = explainMiroFishFeatureError(t('Profiles', 'Profiles'), error);
      setMiroFishErr(message);
      if (!options.silent) {
        setAgentPanelNotice(message);
      }
      return null;
    }
  }, [explainMiroFishFeatureError, fetchMiroFishPayload, miroFishProfilePlatform, miroFishSimulationId, t]);

  const refreshMiroFishSimulation = useCallback(async (
    simulationIdOverride?: string,
    options: { silent?: boolean; refreshProfiles?: boolean; refreshRun?: boolean } = {},
  ) => {
    const simulationId = (simulationIdOverride ?? miroFishSimulationId).trim();
    if (!simulationId) return null;
    try {
      const payload = await fetchMiroFishPayload([
        `/api/simulation/${encodeURIComponent(simulationId)}`,
      ], { method: 'GET' });
      const parsed = parseMiroFishSimulationData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是模拟状态。', 'Response is not simulation state.'));
      }
      setMiroFishSimulation(parsed);
      setMiroFishSimulationId(parsed.simulation_id);
      if (parsed.project_id) {
        setMiroFishProjectId(parsed.project_id);
      }
      if (parsed.graph_id) {
        setMiroFishGraphId(parsed.graph_id);
      }
      setMiroFishErr(null);
      if (options.refreshProfiles !== false) {
        void refreshMiroFishProfiles(parsed.simulation_id, miroFishProfilePlatform, { silent: true });
      }
      if (options.refreshRun !== false) {
        void refreshMiroFishRunStatus(parsed.simulation_id, { silent: true });
      }
      if (!options.silent) {
        setAgentPanelNotice(
          t(
            `模拟已刷新：${parsed.simulation_id} · ${parsed.status}`,
            `Simulation refreshed: ${parsed.simulation_id} · ${parsed.status}`,
          ),
        );
      }
      return parsed;
    } catch (error) {
      const message = explainMiroFishFeatureError(t('模拟状态', 'Simulation state'), error);
      setMiroFishErr(message);
      if (!options.silent) {
        setAgentPanelNotice(message);
      }
      return null;
    }
  }, [
    explainMiroFishFeatureError,
    fetchMiroFishPayload,
    miroFishProfilePlatform,
    miroFishSimulationId,
    refreshMiroFishProfiles,
    refreshMiroFishRunStatus,
    t,
  ]);

  const refreshMiroFishReport = useCallback(async (
    reportIdOverride?: string,
    simulationIdOverride?: string,
    options: { silent?: boolean } = {},
  ) => {
    const reportId = (reportIdOverride ?? miroFishReportId).trim();
    const simulationId = (simulationIdOverride ?? miroFishSimulationId).trim();
    if (!reportId && !simulationId) return null;
    try {
      const pathCandidates = reportId
        ? [`/api/report/${encodeURIComponent(reportId)}`]
        : [`/api/report/by-simulation/${encodeURIComponent(simulationId)}`];
      const payload = await fetchMiroFishPayload(pathCandidates, { method: 'GET' });
      const parsed = parseMiroFishReportData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是报告数据。', 'Response is not report data.'));
      }
      setMiroFishReport(parsed);
      setMiroFishReportId(parsed.report_id);
      if (parsed.simulation_id) {
        setMiroFishSimulationId(parsed.simulation_id);
      }
      setMiroFishErr(null);
      if (!options.silent) {
        setAgentPanelNotice(
          t(
            `报告已刷新：${parsed.report_id} · ${parsed.status}`,
            `Report refreshed: ${parsed.report_id} · ${parsed.status}`,
          ),
        );
      }
      return parsed;
    } catch (error) {
      const message = explainMiroFishFeatureError(t('报告', 'Report'), error);
      setMiroFishErr(message);
      if (!options.silent) {
        setAgentPanelNotice(message);
      }
      return null;
    }
  }, [explainMiroFishFeatureError, fetchMiroFishPayload, miroFishReportId, miroFishSimulationId, t]);

  const refreshMiroFishPrepareStatus = useCallback(async (
    taskIdOverride?: string,
    simulationIdOverride?: string,
    options: { silent?: boolean } = {},
  ) => {
    const taskId = (taskIdOverride ?? miroFishPrepareTaskId).trim();
    const simulationId = (simulationIdOverride ?? miroFishSimulationId).trim();
    if (!taskId && !simulationId) return null;
    try {
      const payload = await fetchMiroFishPayload([
        '/api/simulation/prepare/status',
      ], {
        method: 'POST',
        body: JSON.stringify({
          task_id: taskId || undefined,
          simulation_id: simulationId || undefined,
        }),
      });
      const parsed = parseMiroFishAsyncStatusData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是准备状态。', 'Response is not prepare status.'));
      }
      setMiroFishPrepareTask(parsed);
      if (parsed.task_id) {
        setMiroFishPrepareTaskId(parsed.task_id);
      }
      if (parsed.simulation_id) {
        setMiroFishSimulationId(parsed.simulation_id);
      }
      setMiroFishErr(null);
      if (parsed.status === 'ready' || parsed.status === 'completed') {
        const resolvedSimulationId = parsed.simulation_id || simulationId;
        if (resolvedSimulationId) {
          void refreshMiroFishSimulation(resolvedSimulationId, { silent: true, refreshProfiles: true, refreshRun: true });
          void refreshMiroFishProfiles(resolvedSimulationId, miroFishProfilePlatform, { silent: true });
        }
      }
      if (!options.silent) {
        setAgentPanelNotice(parsed.message || t('准备状态已刷新。', 'Prepare status refreshed.'));
      }
      return parsed;
    } catch (error) {
      const message = explainMiroFishFeatureError(t('准备任务', 'Prepare task'), error);
      setMiroFishErr(message);
      if (!options.silent) {
        setAgentPanelNotice(message);
      }
      return null;
    }
  }, [
    explainMiroFishFeatureError,
    fetchMiroFishPayload,
    miroFishPrepareTaskId,
    miroFishProfilePlatform,
    miroFishSimulationId,
    refreshMiroFishProfiles,
    refreshMiroFishSimulation,
    t,
  ]);

  const refreshMiroFishReportStatus = useCallback(async (
    taskIdOverride?: string,
    simulationIdOverride?: string,
    options: { silent?: boolean } = {},
  ) => {
    const taskId = (taskIdOverride ?? miroFishReportTaskId).trim();
    const simulationId = (simulationIdOverride ?? miroFishSimulationId).trim();
    if (!taskId && !simulationId) return null;
    try {
      const payload = await fetchMiroFishPayload([
        '/api/report/generate/status',
      ], {
        method: 'POST',
        body: JSON.stringify({
          task_id: taskId || undefined,
          simulation_id: simulationId || undefined,
        }),
      });
      const parsed = parseMiroFishAsyncStatusData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是报告任务状态。', 'Response is not report task status.'));
      }
      setMiroFishReportTask(parsed);
      if (parsed.task_id) {
        setMiroFishReportTaskId(parsed.task_id);
      }
      if (parsed.report_id) {
        setMiroFishReportId(parsed.report_id);
      }
      if (parsed.simulation_id) {
        setMiroFishSimulationId(parsed.simulation_id);
      }
      setMiroFishErr(null);
      if ((parsed.status === 'completed' || parsed.already_completed || parsed.already_generated) && (parsed.report_id || miroFishReportId)) {
        void refreshMiroFishReport(parsed.report_id || miroFishReportId, parsed.simulation_id || simulationId, { silent: true });
      }
      if (!options.silent) {
        setAgentPanelNotice(parsed.message || t('报告任务状态已刷新。', 'Report task status refreshed.'));
      }
      return parsed;
    } catch (error) {
      const message = explainMiroFishFeatureError(t('报告任务', 'Report task'), error);
      setMiroFishErr(message);
      if (!options.silent) {
        setAgentPanelNotice(message);
      }
      return null;
    }
  }, [
    explainMiroFishFeatureError,
    fetchMiroFishPayload,
    miroFishReportId,
    miroFishReportTaskId,
    miroFishSimulationId,
    refreshMiroFishReport,
    t,
  ]);

  const handleLoadMiroFishDemo = useCallback(async () => {
    const preset = MIROFISH_SMOKE_DEMO_PRESET;
    setMiroFishLoadingDemo(true);
    setMiroFishErr(null);
    setMiroFishApiBase(preset.apiBase);
    setMiroFishProjectId(preset.projectId);
    setMiroFishGraphId(preset.graphId);
    setMiroFishTaskId(preset.taskId);
    setMiroFishSimulationId(preset.simulationId);
    setMiroFishPrepareTaskId(preset.prepareTaskId);
    setMiroFishReportId(preset.reportId);
    setMiroFishProjectName(preset.label);
    setMiroFishProfilePlatform(preset.profilePlatform);
    setMiroFishSimulationPlatform(preset.runPlatform);
    setMiroFishMaxRounds(preset.maxRounds);
    setMiroFishInterviewPrompt(preset.interviewPrompt);
    try {
      await refreshMiroFishProject(preset.projectId, { silent: true });
      await refreshMiroFishTask(preset.taskId, { silent: true });
      await syncMiroFishAgentsIntoTown({ silent: true, graphIdOverride: preset.graphId });
      await Promise.all([
        refreshMiroFishSimulation(preset.simulationId, { silent: true, refreshProfiles: false, refreshRun: false }),
        refreshMiroFishPrepareStatus(preset.prepareTaskId, preset.simulationId, { silent: true }),
        refreshMiroFishRunStatus(preset.simulationId, { silent: true }),
        refreshMiroFishProfiles(preset.simulationId, preset.profilePlatform, { silent: true }),
        refreshMiroFishReport(preset.reportId, preset.simulationId, { silent: true }),
      ]);
      setAgentPanelNotice(
        t(
          `已载入 Demo：${preset.label}。现在可以直接查看人物、运行状态和报告投射。`,
          `Demo loaded: ${preset.label}. You can inspect graph agents, run status, and report projections now.`,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMiroFishErr(message);
      setAgentPanelNotice(`${t('载入 Demo 失败', 'Demo load failed')}: ${message}`);
    } finally {
      setMiroFishLoadingDemo(false);
    }
  }, [
    refreshMiroFishPrepareStatus,
    refreshMiroFishProfiles,
    refreshMiroFishProject,
    refreshMiroFishReport,
    refreshMiroFishRunStatus,
    refreshMiroFishSimulation,
    refreshMiroFishTask,
    syncMiroFishAgentsIntoTown,
    t,
  ]);

  const handleMiroFishCreateSimulation = async () => {
    const projectId = miroFishProjectId.trim() || miroFishProject?.project_id || '';
    const graphId = miroFishGraphId.trim() || miroFishProject?.graph_id || '';
    if (!projectId || !graphId) {
      const message = t('请先完成图谱构建，再创建 simulation。', 'Build the graph first before creating a simulation.');
      setMiroFishErr(message);
      setAgentPanelNotice(message);
      return;
    }
    setMiroFishSimulationBusy(true);
    setMiroFishErr(null);
    try {
      const payload = await fetchMiroFishPayload([
        '/api/simulation/create',
      ], {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          graph_id: graphId,
          enable_twitter: true,
          enable_reddit: true,
        }),
      });
      const parsed = parseMiroFishSimulationData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是 simulation。', 'Response is not simulation data.'));
      }
      setMiroFishSimulation(parsed);
      setMiroFishSimulationId(parsed.simulation_id);
      setMiroFishPrepareTask(null);
      setMiroFishPrepareTaskId('');
      setMiroFishRunStatus(null);
      setMiroFishProfilesRealtime(null);
      setMiroFishInterviewByAgentId({});
      setMiroFishReport(null);
      setMiroFishReportId('');
      setMiroFishReportTask(null);
      setMiroFishReportTaskId('');
      setAgentPanelNotice(
        t(
          `Simulation 已创建：${parsed.simulation_id}`,
          `Simulation created: ${parsed.simulation_id}`,
        ),
      );
      void refreshMiroFishSimulation(parsed.simulation_id, { silent: true, refreshProfiles: false, refreshRun: true });
    } catch (error) {
      const message = explainMiroFishFeatureError(t('创建 simulation', 'Create simulation'), error);
      setMiroFishErr(message);
      setAgentPanelNotice(message);
    } finally {
      setMiroFishSimulationBusy(false);
    }
  };

  const handleMiroFishPrepareSimulation = async () => {
    const simulationId = miroFishSimulationId.trim() || miroFishSimulation?.simulation_id || '';
    if (!simulationId) {
      const message = t('请先创建 simulation。', 'Create a simulation first.');
      setMiroFishErr(message);
      setAgentPanelNotice(message);
      return;
    }
    setMiroFishSimulationBusy(true);
    setMiroFishErr(null);
    try {
      const payload = await fetchMiroFishPayload([
        '/api/simulation/prepare',
      ], {
        method: 'POST',
        body: JSON.stringify({
          simulation_id: simulationId,
          use_llm_for_profiles: true,
          parallel_profile_count: 5,
          force_regenerate: false,
        }),
      }, 35_000);
      const parsed = parseMiroFishAsyncStatusData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是准备任务。', 'Response is not a prepare task.'));
      }
      setMiroFishPrepareTask(parsed);
      setMiroFishPrepareTaskId(parsed.task_id || '');
      setMiroFishSimulationId(parsed.simulation_id || simulationId);
      if (parsed.status === 'ready' || parsed.already_prepared) {
        void refreshMiroFishSimulation(parsed.simulation_id || simulationId, { silent: true, refreshProfiles: true, refreshRun: true });
      }
      setAgentPanelNotice(parsed.message || t('准备任务已启动。', 'Prepare task started.'));
    } catch (error) {
      const message = explainMiroFishFeatureError(t('准备 simulation', 'Prepare simulation'), error);
      setMiroFishErr(message);
      setAgentPanelNotice(message);
    } finally {
      setMiroFishSimulationBusy(false);
    }
  };

  const handleMiroFishStartSimulation = async () => {
    const simulationId = miroFishSimulationId.trim() || miroFishSimulation?.simulation_id || '';
    if (!simulationId) {
      const message = t('请先创建 simulation。', 'Create a simulation first.');
      setMiroFishErr(message);
      setAgentPanelNotice(message);
      return;
    }
    setMiroFishSimulationBusy(true);
    setMiroFishErr(null);
    try {
      const payload = await fetchMiroFishPayload([
        '/api/simulation/start',
      ], {
        method: 'POST',
        body: JSON.stringify({
          simulation_id: simulationId,
          platform: miroFishSimulationPlatform,
          max_rounds: Math.max(1, Math.floor(miroFishMaxRounds || 72)),
          enable_graph_memory_update: false,
          force: false,
        }),
      }, 25_000);
      const parsed = parseMiroFishRunStatusData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是运行状态。', 'Response is not run status.'));
      }
      setMiroFishRunStatus(parsed);
      setAgentPanelNotice(
        t(
          `Simulation 已启动：${parsed.runner_status}`,
          `Simulation started: ${parsed.runner_status}`,
        ),
      );
      void refreshMiroFishSimulation(simulationId, { silent: true, refreshProfiles: true, refreshRun: false });
    } catch (error) {
      const message = explainMiroFishFeatureError(t('启动 simulation', 'Start simulation'), error);
      setMiroFishErr(message);
      setAgentPanelNotice(message);
    } finally {
      setMiroFishSimulationBusy(false);
    }
  };

  const handleMiroFishStopSimulation = async () => {
    const simulationId = miroFishSimulationId.trim() || miroFishSimulation?.simulation_id || '';
    if (!simulationId) {
      const message = t('当前没有 simulation_id。', 'No simulation_id available.');
      setMiroFishErr(message);
      setAgentPanelNotice(message);
      return;
    }
    setMiroFishSimulationBusy(true);
    setMiroFishErr(null);
    try {
      const payload = await fetchMiroFishPayload([
        '/api/simulation/stop',
      ], {
        method: 'POST',
        body: JSON.stringify({
          simulation_id: simulationId,
        }),
      }, 20_000);
      const parsed = parseMiroFishRunStatusData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是停止结果。', 'Response is not stop result.'));
      }
      setMiroFishRunStatus(parsed);
      setAgentPanelNotice(t('Simulation 已停止。', 'Simulation stopped.'));
      void refreshMiroFishSimulation(simulationId, { silent: true, refreshProfiles: false, refreshRun: false });
    } catch (error) {
      const message = explainMiroFishFeatureError(t('停止 simulation', 'Stop simulation'), error);
      setMiroFishErr(message);
      setAgentPanelNotice(message);
    } finally {
      setMiroFishSimulationBusy(false);
    }
  };

  const handleMiroFishInterviewSelected = async () => {
    const simulationId = miroFishSimulationId.trim() || miroFishSimulation?.simulation_id || '';
    if (!simulationId) {
      const message = t('请先创建并准备 simulation。', 'Create and prepare a simulation first.');
      setMiroFishErr(message);
      setAgentPanelNotice(message);
      return;
    }
    if (!selectedAgent || !selectedGraphMeta) {
      const message = t('请先选中一个图谱人物。', 'Select a graph character first.');
      setMiroFishErr(message);
      setAgentPanelNotice(message);
      return;
    }
    if (!selectedGraphSimulationProfile) {
      const message = t('当前图谱人物还没有匹配到 simulation agent。先刷新 profiles。', 'This graph character is not matched to a simulation agent yet. Refresh profiles first.');
      setMiroFishErr(message);
      setAgentPanelNotice(message);
      return;
    }
    if (!miroFishInterviewPrompt.trim()) {
      const message = t('请先填写采访问题。', 'Enter an interview prompt first.');
      setMiroFishErr(message);
      setAgentPanelNotice(message);
      return;
    }
    setMiroFishInterviewing(true);
    setMiroFishErr(null);
    try {
      const payload = await fetchMiroFishPayload([
        '/api/simulation/interview',
      ], {
        method: 'POST',
        body: JSON.stringify({
          simulation_id: simulationId,
          agent_id: selectedGraphSimulationProfile.index,
          prompt: miroFishInterviewPrompt.trim(),
        }),
      }, 70_000);
      const parsed = parseMiroFishInterviewData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是采访结果。', 'Response is not interview data.'));
      }
      setMiroFishInterviewResult(parsed);
      setMiroFishInterviewByAgentId((prev) => ({
        ...prev,
        [selectedAgent.id]: parsed,
      }));
      setAgentPanelNotice(
        t(
          `已采访 ${selectedAgent.name} (#${selectedGraphSimulationProfile.index})。`,
          `Interviewed ${selectedAgent.name} (#${selectedGraphSimulationProfile.index}).`,
        ),
      );
    } catch (error) {
      const message = explainMiroFishFeatureError(t('采访 agent', 'Interview agent'), error);
      setMiroFishErr(message);
      setAgentPanelNotice(message);
    } finally {
      setMiroFishInterviewing(false);
    }
  };

  const handleMiroFishGenerateReport = async () => {
    const simulationId = miroFishSimulationId.trim() || miroFishSimulation?.simulation_id || '';
    if (!simulationId) {
      const message = t('请先创建并运行 simulation。', 'Create and run a simulation first.');
      setMiroFishErr(message);
      setAgentPanelNotice(message);
      return;
    }
    setMiroFishReporting(true);
    setMiroFishErr(null);
    try {
      const payload = await fetchMiroFishPayload([
        '/api/report/generate',
      ], {
        method: 'POST',
        body: JSON.stringify({
          simulation_id: simulationId,
          force_regenerate: false,
        }),
      }, 25_000);
      const parsed = parseMiroFishAsyncStatusData(payload);
      if (!parsed) {
        throw new Error(t('返回结构不是报告任务。', 'Response is not a report task.'));
      }
      setMiroFishReportTask(parsed);
      setMiroFishReportTaskId(parsed.task_id || '');
      if (parsed.report_id) {
        setMiroFishReportId(parsed.report_id);
      }
      if ((parsed.status === 'completed' || parsed.already_generated) && (parsed.report_id || miroFishReportId)) {
        void refreshMiroFishReport(parsed.report_id || miroFishReportId, simulationId, { silent: true });
      }
      setAgentPanelNotice(parsed.message || t('报告任务已启动。', 'Report task started.'));
    } catch (error) {
      const message = explainMiroFishFeatureError(t('生成报告', 'Generate report'), error);
      setMiroFishErr(message);
      setAgentPanelNotice(message);
    } finally {
      setMiroFishReporting(false);
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
        const localCollisionGrid = map
          ? (!isTestMap && infiniteExploreEnabled
            ? buildInfiniteRegionCollisionGrid(
              map,
              infiniteRegionRef.current.x,
              infiniteRegionRef.current.y,
              getInfiniteBiome(infiniteRegionRef.current.x, infiniteRegionRef.current.y),
            )
            : buildMapCollisionGrid(map))
          : null;
        const savedPlayer = initialWorldSaveRef.current?.player;
        const resolvePlayerSpawn = (): { tx: number; ty: number } => {
          const fallback = { tx: clamp(Math.floor(mw * 0.5), 1, mw - 2), ty: clamp(Math.floor(mh * 0.56), 1, mh - 2) };
          if (!localCollisionGrid) return fallback;
          const findNearestWalkable = (baseTx: number, baseTy: number): { tx: number; ty: number } | null => {
            const safeBaseTx = clamp(Math.floor(baseTx), 1, mw - 2);
            const safeBaseTy = clamp(Math.floor(baseTy), 1, mh - 2);
            if (isPositionWalkable(localCollisionGrid, safeBaseTx, safeBaseTy, PLAYER_COLLISION_CLEARANCE)) {
              return { tx: safeBaseTx, ty: safeBaseTy };
            }
            for (let radius = 1; radius <= 18; radius++) {
              for (let oy = -radius; oy <= radius; oy++) {
                for (let ox = -radius; ox <= radius; ox++) {
                  if (Math.abs(ox) !== radius && Math.abs(oy) !== radius) continue;
                  const tx = clamp(safeBaseTx + ox, 1, mw - 2);
                  const ty = clamp(safeBaseTy + oy, 1, mh - 2);
                  if (isPositionWalkable(localCollisionGrid, tx, ty, PLAYER_COLLISION_CLEARANCE)) return { tx, ty };
                }
              }
            }
            return null;
          };

          const candidateSeeds = [
            savedPlayer ? { tx: Math.floor(savedPlayer.tx), ty: Math.floor(savedPlayer.ty) } : null,
            { tx: Math.floor(mw * 0.34), ty: Math.floor(mh * 0.5) },
            { tx: Math.floor(mw * 0.5), ty: Math.floor(mh * 0.56) },
            { tx: Math.floor(mw * 0.64), ty: Math.floor(mh * 0.5) },
            { tx: Math.floor(mw * 0.5), ty: Math.floor(mh * 0.68) },
            fallback,
          ].filter((candidate): candidate is { tx: number; ty: number } => Boolean(candidate));
          let best: { tx: number; ty: number; score: number } | null = null;
          for (const candidate of candidateSeeds) {
            const open = findNearestWalkable(candidate.tx, candidate.ty);
            if (!open) continue;
            const openScore = scoreSpawnOpenSpace(localCollisionGrid, open.tx, open.ty);
            const centerBias = Math.hypot(open.tx - (mw * 0.5), open.ty - (mh * 0.56)) * 0.05;
            const score = openScore - centerBias;
            if (!best || score > best.score) {
              best = { tx: open.tx, ty: open.ty, score };
            }
          }
          if (best) return { tx: best.tx, ty: best.ty };

          if (isPositionWalkable(localCollisionGrid, fallback.tx, fallback.ty, PLAYER_COLLISION_CLEARANCE)) return fallback;
          for (let radius = 1; radius <= 18; radius++) {
            for (let oy = -radius; oy <= radius; oy++) {
              for (let ox = -radius; ox <= radius; ox++) {
                if (Math.abs(ox) !== radius && Math.abs(oy) !== radius) continue;
                const tx = clamp(fallback.tx + ox, 1, mw - 2);
                const ty = clamp(fallback.ty + oy, 1, mh - 2);
                if (isPositionWalkable(localCollisionGrid, tx, ty, PLAYER_COLLISION_CLEARANCE)) return { tx, ty };
              }
            }
          }
          return fallback;
        };
        const playerSpawn = resolvePlayerSpawn();
        const savedLayoutRaw = loadMapNftLayout();
        const ignoreClusteredSavedLayout = isOverClusteredSavedNftLayout(savedLayoutRaw, mw, mh);
        const savedLayout = ignoreClusteredSavedLayout ? {} : savedLayoutRaw;
        const nftAgents: AgentMarker[] = Array.from({ length: MAP_NFT_AGENT_COUNT }, (_, tokenId) => {
          const saved = savedLayout[String(tokenId)];
          const fallback = defaultAgentPosition(tokenId, mw, mh);
          const sector = defaultAgentSector(tokenId);
          const spriteKey = MAP_NFT_SPRITE_KEYS[tokenId % MAP_NFT_SPRITE_KEYS.length];
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
            sectorX: isTestMap ? 0 : sector.x,
            sectorY: isTestMap ? 0 : sector.y,
            mind: createAgentMind({ id: `nft_${tokenId}`, source: 'nft', tokenId }),
          };
        });

        const specialNPCs: AgentMarker[] = [
          {
            id: 'player_manual',
            name: mapPlayerAvatar.displayName || MAP_PLAYER_AVATAR_DEFAULT.displayName,
            source: 'npc',
            img: heyiImg ?? czImg,
            spriteKey: mapPlayerAvatar.style === 'sprite' ? mapPlayerAvatar.spriteKey : undefined,
            tx: playerSpawn.tx,
            ty: playerSpawn.ty,
            targetTx: undefined,
            targetTy: undefined,
            lastMoveTime: Date.now(),
            status: 'manual',
            thought: '准备探索',
            thoughtTimer: Date.now() + 2200,
            walkFrames: heyiFrames.length > 0 ? heyiFrames : czFrames,
            walkOffset: 1,
            direction: savedPlayer?.direction ?? 'down',
            sectorX: Number.isFinite(savedPlayer?.sectorX) ? Number(savedPlayer?.sectorX) : 0,
            sectorY: Number.isFinite(savedPlayer?.sectorY) ? Number(savedPlayer?.sectorY) : 0,
            mind: createAgentMind({ id: 'player_manual', source: 'npc' }),
          },
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
            sectorX: 0,
            sectorY: 0,
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
            sectorX: 0,
            sectorY: 0,
            mind: createAgentMind({ id: 'npc_heyi', source: 'npc' }),
          },
          {
            id: 'npc_swordsman_lv1',
            name: 'Blade Novice',
            source: 'npc',
            img: null,
            spriteKey: 'Swordsman_Lv1',
            direction: 'down',
            tx: isTestMap ? 10 : 26,
            ty: isTestMap ? 8 : 24,
            targetTx: isTestMap ? 12 : 29,
            targetTy: isTestMap ? 10 : 27,
            lastMoveTime: Date.now(),
            status: 'patrol',
            thought: '先稳住步伐。',
            thoughtTimer: Date.now() + 1000000,
            walkFrames: [],
            walkOffset: 3,
            sectorX: 0,
            sectorY: 0,
            mind: createAgentMind({ id: 'npc_swordsman_lv1', source: 'npc' }),
          },
          {
            id: 'npc_swordsman_lv3',
            name: 'Blade Master',
            source: 'npc',
            img: null,
            spriteKey: 'Swordsman_Lv3',
            direction: 'down',
            tx: isTestMap ? 12 : 30,
            ty: isTestMap ? 11 : 26,
            targetTx: isTestMap ? 14 : 33,
            targetTy: isTestMap ? 8 : 22,
            lastMoveTime: Date.now(),
            status: 'patrol',
            thought: '节奏和走位都要稳。',
            thoughtTimer: Date.now() + 1000000,
            walkFrames: [],
            walkOffset: 4,
            sectorX: 0,
            sectorY: 0,
            mind: createAgentMind({ id: 'npc_swordsman_lv3', source: 'npc' }),
          },
        ];

        agentsRef.current = isTestMap ? specialNPCs : [...specialNPCs, ...nftAgents];
        if (!isTestMap && ignoreClusteredSavedLayout) {
          setAgentPanelNotice(t('已修复旧版小人布局，恢复全图分布。', 'Recovered old clustered agent layout to full-map distribution.'));
        }
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
          sectorX: 0,
          sectorY: 0,
          mind: createAgentMind({ id: `demo_${i}`, source: 'demo' }),
        }));
        agentsRef.current = demoAgents;
        setAgentCount(demoAgents.length);
      }
    };

    void loadAgents();
  }, [isTestMap, map?.width, map?.height, mapPlayerAvatar.displayName, mapPlayerAvatar.style, mapPlayerAvatar.spriteKey]);

  useEffect(() => {
    if (isTestMap) return;
    saveToStorage(MAP_GUEST_AGENT_STORAGE_KEY, guestAgentConfigs);
  }, [guestAgentConfigs, isTestMap]);

  useEffect(() => {
    if (isTestMap || !map) return;
    const graphAgents = agentsRef.current.filter((agent) => agent.id.startsWith('graph_'));
    const baseAgents = agentsRef.current.filter((agent) => !agent.id.startsWith('graph_') && !agent.id.startsWith('guest_'));
    const guestAgents = guestAgentConfigs
      .filter((item) => item.enabled)
      .map((item, idx) => createGuestAgentMarker(item, idx))
      .filter((item): item is AgentMarker => Boolean(item));
    const nextAgents = [...baseAgents, ...guestAgents, ...graphAgents];
    agentsRef.current = nextAgents;
    setAgentCount(nextAgents.length);
    if (selectedAgentId?.startsWith('guest_') && !nextAgents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(null);
      setAgentProfileOpen(false);
    }
    if (controlledAgentId?.startsWith('guest_') && !nextAgents.some((agent) => agent.id === controlledAgentId)) {
      setControlledAgentId('player_manual');
    }
  }, [controlledAgentId, createGuestAgentMarker, guestAgentConfigs, isTestMap, map, selectedAgentId]);

  useEffect(() => {
    if (isTestMap || agentCount <= 0) return;
    const signature = `${normalizeMiroFishApiBase(miroFishApiBase)}|${miroFishGraphId.trim()}|${map?.width ?? 0}x${map?.height ?? 0}`;
    if (miroFishSyncSignatureRef.current === signature) return;
    miroFishSyncSignatureRef.current = signature;
    void syncMiroFishAgentsIntoTown({ silent: true });
  }, [isTestMap, agentCount, miroFishApiBase, miroFishGraphId, map?.width, map?.height]);

  useEffect(() => {
    if (isTestMap) return;
    const projectId = miroFishProjectId.trim();
    if (!projectId) return;
    if (miroFishProject?.project_id === projectId) return;
    void refreshMiroFishProject(projectId, { silent: true });
  }, [isTestMap, miroFishProject?.project_id, miroFishProjectId, refreshMiroFishProject]);

  useEffect(() => {
    if (isTestMap) return;
    const taskId = miroFishTaskId.trim();
    if (!taskId) return;
    const status = miroFishTask?.status ?? '';
    if (status === 'completed' || status === 'failed') return;

    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      const latestTask = await refreshMiroFishTask(taskId, { silent: true });
      if (cancelled) return;
      const latestStatus = latestTask?.status ?? '';
      if (latestStatus !== 'completed' && latestStatus !== 'failed') {
        timer = window.setTimeout(() => {
          void poll();
        }, 2500);
      }
    };

    timer = window.setTimeout(() => {
      void poll();
    }, 1200);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [isTestMap, miroFishTask?.status, miroFishTaskId, refreshMiroFishTask]);

  useEffect(() => {
    if (isTestMap) return;
    const simulationId = miroFishSimulationId.trim();
    if (!simulationId) return;
    if (miroFishSimulation?.simulation_id === simulationId) return;
    void refreshMiroFishSimulation(simulationId, { silent: true, refreshProfiles: true, refreshRun: true });
  }, [isTestMap, miroFishSimulation?.simulation_id, miroFishSimulationId, refreshMiroFishSimulation]);

  useEffect(() => {
    if (isTestMap) return;
    const simulationId = miroFishSimulationId.trim();
    if (!simulationId) return;
    if (!miroFishProfilesRealtime || miroFishProfilesRealtime.platform !== miroFishProfilePlatform) {
      void refreshMiroFishProfiles(simulationId, miroFishProfilePlatform, { silent: true });
    }
  }, [isTestMap, miroFishProfilePlatform, miroFishProfilesRealtime, miroFishSimulationId, refreshMiroFishProfiles]);

  useEffect(() => {
    if (isTestMap) return;
    const taskId = miroFishPrepareTaskId.trim();
    const simulationId = miroFishSimulationId.trim();
    const status = miroFishPrepareTask?.status ?? '';
    if (!taskId && !simulationId) return;
    if (status === 'ready' || status === 'completed' || status === 'failed') return;

    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      const latest = await refreshMiroFishPrepareStatus(taskId || undefined, simulationId || undefined, { silent: true });
      if (cancelled) return;
      if (!latest) return;
      const latestStatus = latest?.status ?? '';
      if (latestStatus !== 'ready' && latestStatus !== 'completed' && latestStatus !== 'failed') {
        timer = window.setTimeout(() => {
          void poll();
        }, 2500);
      }
    };
    timer = window.setTimeout(() => {
      void poll();
    }, 1200);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [isTestMap, miroFishPrepareTask?.status, miroFishPrepareTaskId, miroFishSimulationId, refreshMiroFishPrepareStatus]);

  useEffect(() => {
    if (isTestMap) return;
    const simulationId = miroFishSimulationId.trim();
    const runnerStatus = miroFishRunStatus?.runner_status ?? '';
    if (!simulationId || runnerStatus !== 'running') return;

    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      const [runStatus] = await Promise.all([
        refreshMiroFishRunStatus(simulationId, { silent: true }),
        refreshMiroFishSimulation(simulationId, { silent: true, refreshProfiles: false, refreshRun: false }),
      ]);
      if (cancelled) return;
      if (!runStatus) return;
      timer = window.setTimeout(() => {
        void poll();
      }, 2500);
    };
    timer = window.setTimeout(() => {
      void poll();
    }, 1300);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [isTestMap, miroFishRunStatus?.runner_status, miroFishSimulationId, refreshMiroFishRunStatus, refreshMiroFishSimulation]);

  useEffect(() => {
    if (isTestMap) return;
    const taskId = miroFishReportTaskId.trim();
    const simulationId = miroFishSimulationId.trim();
    const status = miroFishReportTask?.status ?? '';
    if (!taskId && !simulationId) return;
    if (status === 'completed' || status === 'failed') return;

    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      const latest = await refreshMiroFishReportStatus(taskId || undefined, simulationId || undefined, { silent: true });
      if (cancelled) return;
      if (!latest) return;
      const latestStatus = latest?.status ?? '';
      if (latestStatus !== 'completed' && latestStatus !== 'failed') {
        timer = window.setTimeout(() => {
          void poll();
        }, 2800);
      }
    };
    timer = window.setTimeout(() => {
      void poll();
    }, 1500);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [isTestMap, miroFishReportTask?.status, miroFishReportTaskId, miroFishSimulationId, refreshMiroFishReportStatus]);

  useEffect(() => {
    if (isTestMap) return;
    const reportId = miroFishReportId.trim();
    const simulationId = miroFishSimulationId.trim();
    if (!reportId && !simulationId) return;
    if (reportId && miroFishReport?.report_id === reportId) return;
    if (!reportId && miroFishReport?.simulation_id === simulationId) return;
    void refreshMiroFishReport(reportId || undefined, simulationId || undefined, { silent: true });
  }, [isTestMap, miroFishReport?.report_id, miroFishReport?.simulation_id, miroFishReportId, miroFishSimulationId, refreshMiroFishReport]);

  useEffect(() => {
    if (isTestMap) return;
    if (agentCount <= 0) return;
    if (controlledAgentId && agentsRef.current.some((agent) => agent.id === controlledAgentId)) return;
    const fallbackId = agentsRef.current.find((agent) => agent.id === 'player_manual')?.id
      ?? agentsRef.current.find((agent) => agent.id === 'npc_heyi')?.id
      ?? agentsRef.current.find((agent) => agent.id === 'npc_cz')?.id
      ?? agentsRef.current[0]?.id
      ?? null;
    if (fallbackId) {
      setControlledAgentId(fallbackId);
    }
  }, [agentCount, controlledAgentId, isTestMap]);

  useEffect(() => {
    if (isTestMap || !infiniteExploreEnabled || !controlledAgentId) return;
    const controlled = agentsRef.current.find((agent) => agent.id === controlledAgentId);
    if (!controlled) return;
    const sx = controlled.sectorX ?? 0;
    const sy = controlled.sectorY ?? 0;
    if (sx === infiniteRegionRef.current.x && sy === infiniteRegionRef.current.y) return;
    infiniteRegionRef.current = { x: sx, y: sy };
    setInfiniteRegion({ x: sx, y: sy });
    playLootResetProgressRef.current = false;
    setPlayLootVersion((prev) => prev + 1);
  }, [agentCount, controlledAgentId, infiniteExploreEnabled, isTestMap]);

  useEffect(() => {
    const key = regionKey(infiniteRegion.x, infiniteRegion.y);
    if (discoveredRegionSetRef.current.has(key)) return;
    discoveredRegionSetRef.current.add(key);
    setMapAdventure((prev) => {
      const list = Array.from(discoveredRegionSetRef.current).slice(-MAP_ADVENTURE_DISCOVERY_HISTORY_LIMIT);
      if (list.length === prev.discoveredRegionKeys.length && list.every((item, idx) => item === prev.discoveredRegionKeys[idx])) {
        return prev;
      }
      return {
        ...prev,
        discoveredRegionKeys: list,
      };
    });
    if (isTestMap) return;
    setMapPlayStats((prev) => ({ ...prev, score: prev.score + 22 }));
    setAgentPanelNotice(t(`发现新区 ${key}，探索分 +22`, `Discovered sector ${key}, +22 exploration score`));
    advanceAdventureQuest('explore', 1, getInfiniteBiome(infiniteRegion.x, infiniteRegion.y));
  }, [infiniteRegion.x, infiniteRegion.y, isTestMap, t, advanceAdventureQuest]);

  useEffect(() => {
    if (isTestMap) return;
    if (mapAdventure.activeQuest) return;
    setMapAdventure((prev) => {
      if (prev.activeQuest) return prev;
      return {
        ...prev,
        activeQuest: createMapAdventureQuest(
          prev.completedCount,
          infiniteRegionRef.current.x,
          infiniteRegionRef.current.y,
        ),
      };
    });
  }, [isTestMap, mapAdventure.activeQuest]);

  useEffect(() => {
    if (isTestMap) return;
    const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
    const combatCodes = new Set(['KeyF', 'Space']);
    const skillCodes = new Set(['KeyQ']);
    const itemCodes = new Set(['Digit1', 'Digit2']);

    const setMovementKey = (code: string, value: boolean) => {
      if (code === 'KeyW' || code === 'ArrowUp') playInputRef.current.up = value;
      if (code === 'KeyS' || code === 'ArrowDown') playInputRef.current.down = value;
      if (code === 'KeyA' || code === 'ArrowLeft') playInputRef.current.left = value;
      if (code === 'KeyD' || code === 'ArrowRight') playInputRef.current.right = value;
      if (code === 'ShiftLeft' || code === 'ShiftRight') playInputRef.current.run = value;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!playModeEnabled) return;
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (movementCodes.has(event.code)) {
        setMovementKey(event.code, true);
        playPointTargetRef.current = null;
        event.preventDefault();
        return;
      }
      if (combatCodes.has(event.code)) {
        mapRpgAttackRequestAtRef.current = Date.now();
        event.preventDefault();
        return;
      }
      if (skillCodes.has(event.code)) {
        mapRpgSkillRequestAtRef.current = Date.now();
        event.preventDefault();
        return;
      }
      if (itemCodes.has(event.code)) {
        if (event.code === 'Digit1') {
          mapRpgUseHpPotionRequestAtRef.current = Date.now();
        } else {
          mapRpgUseMpPotionRequestAtRef.current = Date.now();
        }
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
    playPointTargetRef.current = null;
    playSectorTransitionRef.current = null;
    setPlaySectorLoading(false);
    playNearbyHintRef.current = '';
    setPlayNearbyHint('');
  }, [playModeEnabled]);

  useEffect(() => {
    if (isTestMap) return;
    if (infiniteExploreEnabled) return;
    playSectorTransitionRef.current = null;
    setPlaySectorLoading(false);
    setInfiniteExploreEnabled(true);
  }, [isTestMap, infiniteExploreEnabled]);

  useEffect(() => {
    if (isTestMap) return;
    const timer = window.setInterval(() => {
      setMapPlayStats((prev) => {
        if (prev.combo <= 0) return prev;
        if ((Date.now() - prev.lastTalkAt) <= MAP_PLAY_COMBO_WINDOW_MS) return prev;
        return { ...prev, combo: 0 };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isTestMap]);

  useEffect(() => {
    if (mapPlayStats.score <= mapPlayHighScore) return;
    setMapPlayHighScore(mapPlayStats.score);
  }, [mapPlayHighScore, mapPlayStats.score]);

  useEffect(() => {
    saveToStorage(MAP_PLAY_HIGHSCORE_STORAGE_KEY, mapPlayHighScore);
  }, [mapPlayHighScore]);

  useEffect(() => {
    if (isTestMap) return;
    saveToStorage(MAP_PLAY_HUD_OPEN_STORAGE_KEY, mapPlayHudOpen);
  }, [isTestMap, mapPlayHudOpen]);

  useEffect(() => {
    mapHqInsideRef.current = mapHqInside;
  }, [mapHqInside]);

  useEffect(() => {
    if (isTestMap) return;
    if (mapHeadquartersLayout) return;
    if (!mapHqInsideRef.current) return;
    mapHqInsideRef.current = false;
    setMapHqInside(false);
  }, [isTestMap, mapHeadquartersLayout]);

  useEffect(() => {
    if (isTestMap || !map || !playModeEnabled) return;
    if (playLootRef.current.length > 0) return;
    playLootResetProgressRef.current = false;
    setPlayLootVersion((prev) => prev + 1);
    setMapPlayStats((prev) => ({ ...prev, score: prev.score + 80 }));
    setAgentPanelNotice(`${t('补给已刷新，新一轮探索开始。', 'Supplies respawned. New exploration wave started.')} · ${bnbWorldEventTitle}`);
  }, [bnbWorldEventTitle, isTestMap, map, playModeEnabled, mapPlayStats.lootCollected, t]);

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
    if (isTestMap) return;
    const entries = Object.entries(MAP_CUSTOM_PROP_SPRITES) as Array<[MapCustomPropSpriteKey, string]>;
    for (const [key, url] of entries) {
      if (customPropSpriteCacheRef.current.has(key) || customPropSpriteLoadingRef.current.has(key)) continue;
      customPropSpriteLoadingRef.current.add(key);
      void loadImage(url)
        .then((img) => {
          customPropSpriteCacheRef.current.set(key, img);
        })
        .catch(() => {
          customPropSpriteCacheRef.current.set(key, null);
        })
        .finally(() => {
          customPropSpriteLoadingRef.current.delete(key);
        });
    }
  }, [isTestMap]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setErr(null);
        setMapLoading(true);
        setMapLoadingStage('fetch');
        const m = await loadVillageTilemapWithOptions({
          expandWorld: !isTestMap,
          targetWidth: 540,
          targetHeight: 500,
          remixWorld: !isTestMap,
        });
        if (cancelled) return;

        setMapLoadingStage('tilesets');
        setMap(m);
        setLayerName(isTestMap ? '__VISIBLE__' : (settings.ui.layerMode || '__VISIBLE__'));
        tilesetsRef.current = await resolveTilesets(m);
        if (cancelled) return;
        setMapLoadingStage('finalizing');
        window.setTimeout(() => {
          if (!cancelled) setMapLoading(false);
        }, 120);

      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setMapLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isTestMap, settings.ui.layerMode]);

  useEffect(() => {
    if (!map) return;
    if (mapWorldSaveHydratedRef.current) return;
    const save = initialWorldSaveRef.current;
    if (!save?.camera) {
      mapWorldSaveHydratedRef.current = true;
      return;
    }
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const apply = () => {
      const maxLeft = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
      const maxTop = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
      const left = clamp(Math.floor(save.camera?.left ?? 0), 0, maxLeft);
      const top = clamp(Math.floor(save.camera?.top ?? 0), 0, maxTop);
      wrap.scrollLeft = left;
      wrap.scrollTop = top;
      mapWorldSaveHydratedRef.current = true;
    };
    window.requestAnimationFrame(apply);
  }, [map]);

  useEffect(() => {
    const persist = () => persistMapWorldSave();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    const onPageHide = () => {
      persist();
    };
    const timer = window.setInterval(persist, 1200);
    window.addEventListener('beforeunload', persist);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      persist();
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', persist);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [playModeEnabled, controlledAgentId, infiniteExploreEnabled, mapPlayStats, playSprintEnergyUi, isTestMap, mapAdventure, mapRpgPlayer, mapRpgQuest, mapRpgQuestCompletedCount, mapPlayerAvatar]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = agentsRef.current.find((agent) => agent.id === 'player_manual');
      if (!player) return;
      const next = {
        tx: round1(player.tx),
        ty: round1(player.ty),
        sectorX: Math.round(player.sectorX ?? infiniteRegionRef.current.x),
        sectorY: Math.round(player.sectorY ?? infiniteRegionRef.current.y),
      };
      const prev = mapWorldLastPlayerSnapshotRef.current;
      if (!prev) {
        mapWorldLastPlayerSnapshotRef.current = next;
        persistMapWorldSave();
        return;
      }
      const movedEnough = Math.abs(next.tx - prev.tx) >= 0.2 || Math.abs(next.ty - prev.ty) >= 0.2;
      const sectorChanged = next.sectorX !== prev.sectorX || next.sectorY !== prev.sectorY;
      if (!movedEnough && !sectorChanged) return;
      mapWorldLastPlayerSnapshotRef.current = next;
      persistMapWorldSave();
    }, 450);
    return () => window.clearInterval(timer);
  }, [playModeEnabled, controlledAgentId, infiniteExploreEnabled, mapPlayStats, playSprintEnergyUi, isTestMap, mapAdventure, mapRpgPlayer, mapRpgQuest, mapRpgQuestCompletedCount, mapPlayerAvatar]);

  useEffect(() => {
    if (!map) return;
    mapBaseCollisionGridRef.current = buildMapCollisionGrid(map);
    infiniteCollisionGridCacheRef.current.clear();
  }, [map]);

  useEffect(() => {
    if (!map) return;
    if (isTestMap || !infiniteExploreEnabled) {
      mapCollisionGridRef.current = mapBaseCollisionGridRef.current ?? buildMapCollisionGrid(map);
      return;
    }
    const key = `${infiniteRegion.x},${infiniteRegion.y}`;
    const cache = infiniteCollisionGridCacheRef.current;
    let grid = cache.get(key);
    if (!grid) {
      const biome = getInfiniteBiome(infiniteRegion.x, infiniteRegion.y);
      grid = buildInfiniteRegionCollisionGrid(map, infiniteRegion.x, infiniteRegion.y, biome);
      cache.set(key, grid);
      if (cache.size > 24) {
        const first = cache.keys().next();
        if (!first.done) cache.delete(first.value);
      }
    }
    mapCollisionGridRef.current = grid;
  }, [map, isTestMap, infiniteExploreEnabled, infiniteRegion.x, infiniteRegion.y]);

  useEffect(() => {
    if (isTestMap || !map) {
      mapRpgEnemiesRef.current = [];
      mapRpgDamageFxRef.current = [];
      return;
    }
    const biome = getInfiniteBiome(infiniteRegion.x, infiniteRegion.y);
    const grid = infiniteExploreEnabled
      ? buildInfiniteRegionCollisionGrid(map, infiniteRegion.x, infiniteRegion.y, biome)
      : (mapCollisionGridRef.current ?? buildMapCollisionGrid(map));
    mapRpgEnemiesRef.current = spawnMapRpgEnemiesForRegion(
      map,
      grid,
      infiniteRegion.x,
      infiniteRegion.y,
      biome,
      mapRpgEnemyTargetCount,
    );
    mapRpgDamageFxRef.current = [];
  }, [isTestMap, map, infiniteExploreEnabled, infiniteRegion.x, infiniteRegion.y, mapRpgEnemyTargetCount]);

  useEffect(() => {
    if (isTestMap || !map) {
      playLootRef.current = [];
      return;
    }

    const grid = mapCollisionGridRef.current;
    const seed = (map.width * 131) + (map.height * 79) + (playLootVersion * 977);
    const rnd = createSeededRandom(seed);
    const nextLoot: MapPlayLoot[] = [];
    const used = new Set<string>();
    let attempts = 0;
    while (nextLoot.length < mapPlayLootTargetCount && attempts < mapPlayLootTargetCount * 70) {
      attempts += 1;
      const tx = clamp(Math.floor(1 + rnd() * Math.max(1, map.width - 2)), 1, map.width - 2);
      const ty = clamp(Math.floor(1 + rnd() * Math.max(1, map.height - 2)), 1, map.height - 2);
      const key = `${tx},${ty}`;
      if (used.has(key)) continue;
      const px = tx + 0.5;
      const py = ty + 0.5;
      if (grid && !isPositionWalkable(grid, px, py, 0.2)) continue;
      used.add(key);
      nextLoot.push({
        id: `loot-${tx}-${ty}-${nextLoot.length}`,
        tx: px,
        ty: py,
        value: 10 + Math.floor(rnd() * 16),
        phase: rnd() * Math.PI * 2,
      });
    }
    playLootRef.current = nextLoot;
    const shouldResetLootProgress = playLootResetProgressRef.current;
    playLootResetProgressRef.current = false;
    if (shouldResetLootProgress) {
      setMapPlayStats((prev) => ({
        ...prev,
        lootCollected: 0,
        lootQuestRewardClaimed: false,
      }));
    }
  }, [isTestMap, map, playLootVersion, mapPlayLootTargetCount]);

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
    const limitByDimension = 32760 / Math.max(dims.w, dims.h);
    const limitByArea = Math.sqrt(300_000_000 / Math.max(1, dims.w * dims.h));
    const computed = round1(clamp(Math.min(3, limitByDimension, limitByArea), 0.08, 3));
    if (isTestMap) return computed;
    return Math.min(1, computed);
  }, [dims, isTestMap]);

  const minCanvasScale = isTestMap ? 1.2 : 0.08;
  const effectiveScale = useMemo(
    () => round1(clamp(scale, minCanvasScale, maxCanvasScale)),
    [scale, minCanvasScale, maxCanvasScale]
  );

  const focusMapPoint = useCallback((tx: number, ty: number) => {
    const wrap = canvasWrapRef.current;
    const activeMap = map;
    if (!wrap || !activeMap) return;
    const tilePxW = activeMap.tilewidth * effectiveScale;
    const tilePxH = activeMap.tileheight * effectiveScale;
    const maxLeft = Math.max(0, (canvasRef.current?.width ?? 0) - wrap.clientWidth);
    const maxTop = Math.max(0, (canvasRef.current?.height ?? 0) - wrap.clientHeight);
    const targetLeft = clamp((tx * tilePxW) - (wrap.clientWidth * 0.5), 0, maxLeft);
    const targetTop = clamp((ty * tilePxH) - (wrap.clientHeight * 0.5), 0, maxTop);
    wrap.scrollTo({
      left: targetLeft,
      top: targetTop,
      behavior: 'smooth',
    });
  }, [effectiveScale, map]);

  const focusAgentOnMap = useCallback((agentId: string) => {
    const agent = agentsRef.current.find((item) => item.id === agentId);
    if (!agent) return;
    focusMapPoint(agent.tx, agent.ty);
  }, [focusMapPoint]);

  const focusZoneOnMap = useCallback((focus: ActionBriefZoneFocus | null, notice: string, expandActionBrief = false) => {
    if (!focus) return;
    setSelectedLandmark(null);
    setMapExpansionLandmarkOpen(false);
    actionBriefCameraLockUntilRef.current = Date.now() + 2600;
    setActionBriefFocusAt(Date.now());
    if (expandActionBrief) setActionBriefTaskExpanded(true);
    focusMapPoint(focus.tx, focus.ty);
    setAgentPanelNotice(notice);
  }, [focusMapPoint]);

  const handleFocusActionBriefZone = useCallback(() => {
    if (!bnbActionBriefFocus) return;
    focusZoneOnMap(
      bnbActionBriefFocus,
      t(
        `已定位推荐区域：${bnbActionBriefFocus.label}`,
        `Focused suggested zone: ${bnbActionBriefFocus.label}`,
      ),
      true,
    );
  }, [bnbActionBriefFocus, focusZoneOnMap, t]);

  const handleActivateSkillsMission = useCallback((mission: BinanceSkillsMission) => {
    setActiveSkillsMissionId(mission.id);
    focusZoneOnMap(
      mission.focus,
      t(
        `已定位 Skills 任务：${mission.title} · ${mission.token}`,
        `Focused skills mission: ${mission.title} · ${mission.token}`,
      ),
      false,
    );
  }, [focusZoneOnMap, t]);

  const handleFocusGuestAgent = useCallback((guestId: string) => {
    const guest = agentsRef.current.find((item) => item.id === guestId);
    if (!guest) return;
    setSelectedAgentId(guest.id);
    setAgentProfileOpen(true);
    setSelectedLandmark(null);
    setMapExpansionLandmarkOpen(false);
    actionBriefCameraLockUntilRef.current = Date.now() + 2200;
    focusAgentOnMap(guest.id);
    setAgentPanelNotice(
      t(
        `已定位嘉宾角色：${guest.name}`,
        `Focused guest NPC: ${guest.name}`,
      ),
    );
  }, [focusAgentOnMap, t]);

  const handleFocusGraphConnection = useCallback((connection: MiroFishGraphConnection) => {
    setSelectedAgentId(connection.otherAgentId);
    setAgentProfileOpen(true);
    setSelectedLandmark(null);
    setMapExpansionLandmarkOpen(false);
    focusAgentOnMap(connection.otherAgentId);
    setAgentPanelNotice(
      t(
        `已定位关系节点：${connection.otherName} · ${connection.edgeType}`,
        `Focused graph neighbor: ${connection.otherName} · ${connection.edgeType}`,
      ),
    );
  }, [focusAgentOnMap, t]);

  useEffect(() => {
    if (!selectedAgentId?.startsWith('graph_')) return;
    const timer = window.setTimeout(() => focusAgentOnMap(selectedAgentId), 120);
    return () => window.clearTimeout(timer);
  }, [focusAgentOnMap, selectedAgentId]);

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
    if (selectedAgentId?.startsWith('graph_')) return;
    const timer = window.setInterval(() => {
      if (mapDragRef.current.active) return;
      if (Date.now() < actionBriefCameraLockUntilRef.current) return;
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
      wrap.scrollLeft += (clampedLeft - wrap.scrollLeft) * 0.32;
      wrap.scrollTop += (clampedTop - wrap.scrollTop) * 0.32;
    }, PLAY_CAMERA_FOLLOW_TICK_MS);
    return () => window.clearInterval(timer);
  }, [isTestMap, playModeEnabled, map, effectiveScale, controlledAgentId, selectedAgentId]);

  // Autonomous Behavior Loop
  useEffect(() => {
    if (!map) return;
    const manualStatusLabel = t('手动探索中', 'Manual Exploring');
    const manualHqStatusLabel = t('主楼探索中', 'Inside HQ');
    const interval = setInterval(() => {
      const now = Date.now();
      const currentSectorX = infiniteRegionRef.current.x;
      const currentSectorY = infiniteRegionRef.current.y;
      const currentSectorBiome = getInfiniteBiome(currentSectorX, currentSectorY);
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
      const collisionGrid = isTestMap ? mapCollisionGridRef.current : null;
      const previousAgents = agentsRef.current;
      let controlledPresent = false;
      let sprintingThisTick = false;
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
      const isCrowdedByNearbyAgent = (
        x: number,
        y: number,
        selfId: string,
        source: AgentMarker['source'],
      ): boolean => {
        if (source === 'nft') return false;
        const bx = Math.floor(x);
        const by = Math.floor(y);
        const crowdedRadiusSq = source === 'npc' ? 0.12 : 0.1;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const key = `${bx + ox},${by + oy}`;
            const group = spatialBuckets.get(key);
            if (!group) continue;
            for (const other of group) {
              if (other.id === selfId) continue;
              const dx = other.tx - x;
              const dy = other.ty - y;
              if ((dx * dx + dy * dy) < crowdedRadiusSq) return true;
            }
          }
        }
        return false;
      };

      agentsRef.current = previousAgents.map((agent) => {
        const isControlledCandidate = !isTestMap && playModeEnabled && controlledAgentId === agent.id;
        const nearViewport = agent.tx >= (minTx - 7)
          && agent.tx <= (maxTx + 7)
          && agent.ty >= (minTy - 7)
          && agent.ty <= (maxTy + 7);
        const shouldSimulateMovement = isTestMap
          || agent.source !== 'nft'
          || isControlledCandidate
          || nearViewport
          || agent.id === selectedAgentId;
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
        let sectorX = agent.sectorX ?? 0;
        let sectorY = agent.sectorY ?? 0;
        const isControlledAgent = !isTestMap && playModeEnabled && controlledAgentId === agent.id;
        const isTopLeftNpc = isTestMap && (agent.id === 'npc_cz' || agent.id === 'npc_heyi');
        const roamFullMap = !isTestMap || (isControlledAgent && infiniteExploreEnabled);
        let roamMinTx = roamFullMap ? 1 : (isTopLeftNpc ? minTx : expansionMinTx);
        let roamMaxTx = roamFullMap ? map.width - 2 : (isTopLeftNpc ? maxTx : expansionMaxTx);
        let roamMinTy = roamFullMap ? 1 : (isTopLeftNpc ? minTy : expansionMinTy);
        let roamMaxTy = roamFullMap ? map.height - 2 : (isTopLeftNpc ? maxTy : expansionMaxTy);
        const hqLayoutForAgent = !isTestMap
          ? getMapHeadquartersLayout(map, {
            infiniteExploreEnabled,
            sectorX,
            sectorY,
          })
          : null;
        const hqInsideActive = Boolean(isControlledAgent && mapHqInsideRef.current && hqLayoutForAgent);
        if (hqInsideActive && hqLayoutForAgent) {
          roamMinTx = hqLayoutForAgent.interior.minTx;
          roamMaxTx = hqLayoutForAgent.interior.maxTx;
          roamMinTy = hqLayoutForAgent.interior.minTy;
          roamMaxTy = hqLayoutForAgent.interior.maxTy;
        }
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

        // If an agent gets stuck inside blocked cells after region switch/layout changes,
        // snap it to nearest walkable tile and immediately re-plan movement.
        if (
          collisionGrid
          && !isControlledAgent
          && !isPositionWalkable(collisionGrid, tx, ty, isControlledAgent ? PLAYER_COLLISION_CLEARANCE : 0.18)
        ) {
          const unstuckRnd = createSeededRandom(
            (agent.tokenId ?? 0)
            + Math.floor(now / AGENT_LOGIC_TICK_MS)
            + (agent.id.length * 211)
            + ((currentSectorX + 31) * 97)
            + ((currentSectorY + 31) * 131),
          );
          const snapped = normalizeWalkableTarget(map, collisionGrid, tx, ty, unstuckRnd);
          tx = clamp(snapped.targetTx, roamMinTx, roamMaxTx);
          ty = clamp(snapped.targetTy, roamMinTy, roamMaxTy);
          targetTx = undefined;
          targetTy = undefined;
          pathWaypoints = [];
          pauseUntil = undefined;
          stuckTicks = 0;
          if (!isControlledAgent) {
            const patrolTarget = pickIntentTarget(
              { ...agent, tx, ty },
              'patrol',
              map,
              roamMinTx,
              roamMaxTx,
              roamMinTy,
              roamMaxTy,
              unstuckRnd,
            );
            const normalizedPatrolTarget = normalizeWalkableTarget(
              map,
              collisionGrid,
              patrolTarget.targetTx,
              patrolTarget.targetTy,
              unstuckRnd,
            );
            targetTx = normalizedPatrolTarget.targetTx;
            targetTy = normalizedPatrolTarget.targetTy;
            pathWaypoints = buildShortSteerWaypoints(
              map,
              collisionGrid,
              tx,
              ty,
              targetTx,
              targetTy,
              unstuckRnd,
              4,
            );
            status = AGENT_INTENT_STATUS.patrol;
            mind = {
              ...mind,
              currentTask: 'patrol',
              intent: 'patrol',
              nextDecisionAt: now + 300 + Math.floor(unstuckRnd() * 480),
            };
          }
        }

        if (isControlledAgent) {
          controlledPresent = true;
          const input = playInputRef.current;
          const xInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
          const yInput = (input.down ? 1 : 0) - (input.up ? 1 : 0);
          const pointerTarget = playPointTargetRef.current;
          const controlledCollisionGrid = hqInsideActive ? null : collisionGrid;
          if (controlledCollisionGrid && !isPositionWalkable(controlledCollisionGrid, tx, ty, PLAYER_COLLISION_CLEARANCE)) {
            const unstuckRnd = createSeededRandom(
              Math.floor(now / AGENT_LOGIC_TICK_MS)
              + (agent.id.length * 223)
              + ((currentSectorX + 37) * 97)
              + ((currentSectorY + 37) * 131),
            );
            const snapped = normalizeWalkableTarget(map, controlledCollisionGrid, tx, ty, unstuckRnd);
            tx = clamp(snapped.targetTx, roamMinTx, roamMaxTx);
            ty = clamp(snapped.targetTy, roamMinTy, roamMaxTy);
          }
          const findWarpLanding = (
            side: 'left' | 'right' | 'up' | 'down',
            preferredX: number,
            preferredY: number,
          ): { x: number; y: number } => {
            const minX = 1;
            const maxX = map.width - 2;
            const minY = 1;
            const maxY = map.height - 2;
            const px = clamp(preferredX, minX, maxX);
            const py = clamp(preferredY, minY, maxY);
            if (!controlledCollisionGrid) {
              if (side === 'left') return { x: maxX - 1.2, y: py };
              if (side === 'right') return { x: minX + 1.2, y: py };
              if (side === 'up') return { x: px, y: maxY - 1.2 };
              return { x: px, y: minY + 1.2 };
            }

            const xBand = side === 'left'
              ? [maxX - 2, maxX - 3, maxX - 4, maxX - 5, maxX - 6, maxX - 7, maxX - 8]
              : side === 'right'
                ? [minX + 2, minX + 3, minX + 4, minX + 5, minX + 6, minX + 7, minX + 8]
                : [Math.floor(px), Math.floor(px - 1), Math.floor(px + 1), Math.floor(px - 2), Math.floor(px + 2)];
            const yBand = side === 'up'
              ? [maxY - 2, maxY - 3, maxY - 4, maxY - 5, maxY - 6, maxY - 7, maxY - 8]
              : side === 'down'
                ? [minY + 2, minY + 3, minY + 4, minY + 5, minY + 6, minY + 7, minY + 8]
                : [Math.floor(py), Math.floor(py - 1), Math.floor(py + 1), Math.floor(py - 2), Math.floor(py + 2)];

            for (let ring = 0; ring <= 18; ring++) {
              const yOffsets = ring === 0 ? [0] : [ring, -ring];
              const xOffsets = ring === 0 ? [0] : [ring, -ring];
              for (const by of yBand) {
                for (const oy of yOffsets) {
                  const cy = clamp(by + oy, minY, maxY);
                  for (const bx of xBand) {
                    for (const ox of xOffsets) {
                      const cx = clamp(bx + ox, minX, maxX);
                      if (isPositionWalkable(controlledCollisionGrid, cx, cy, PLAYER_COLLISION_CLEARANCE)) {
                        return { x: cx, y: cy };
                      }
                    }
                  }
                }
              }
            }

            const warpRnd = createSeededRandom(
              Math.floor(now / AGENT_LOGIC_TICK_MS) + (agent.id.length * 131) + (agent.tokenId ?? 0),
            );
            const normalized = normalizeWalkableTarget(map, controlledCollisionGrid, px, py, warpRnd);
            return { x: normalized.targetTx, y: normalized.targetTy };
          };
          const applySeamlessInfiniteAdvance = () => {
            if (!infiniteExploreEnabled) return;
            if (hqInsideActive) return;
            const minX = 1;
            const maxX = map.width - 2;
            const minY = 1;
            const maxY = map.height - 2;
            let shiftX = 0;
            let shiftY = 0;
            if (tx <= minX + 0.26) {
              const landing = findWarpLanding('left', tx, ty);
              tx = clamp(landing.x, roamMinTx, roamMaxTx);
              ty = clamp(landing.y, roamMinTy, roamMaxTy);
              shiftX = -1;
            } else if (tx >= maxX - 0.26) {
              const landing = findWarpLanding('right', tx, ty);
              tx = clamp(landing.x, roamMinTx, roamMaxTx);
              ty = clamp(landing.y, roamMinTy, roamMaxTy);
              shiftX = 1;
            }
            if (ty <= minY + 0.26) {
              const landing = findWarpLanding('up', tx, ty);
              tx = clamp(landing.x, roamMinTx, roamMaxTx);
              ty = clamp(landing.y, roamMinTy, roamMaxTy);
              shiftY = -1;
            } else if (ty >= maxY - 0.26) {
              const landing = findWarpLanding('down', tx, ty);
              tx = clamp(landing.x, roamMinTx, roamMaxTx);
              ty = clamp(landing.y, roamMinTy, roamMaxTy);
              shiftY = 1;
            }
            if (shiftX === 0 && shiftY === 0) return;
            const nextRegion = {
              x: infiniteRegionRef.current.x + shiftX,
              y: infiniteRegionRef.current.y + shiftY,
            };
            infiniteRegionRef.current = nextRegion;
            setInfiniteRegion(nextRegion);
            sectorX = nextRegion.x;
            sectorY = nextRegion.y;
            playLootResetProgressRef.current = false;
            setPlayLootVersion((prev) => prev + 1);
            setPlaySectorLoading(false);
          };
          const tryControlledMove = (
            dirX: number,
            dirY: number,
            speed: number,
          ): { moved: boolean } => {
            const scales = [1, 0.72, 0.46];
            for (const scale of scales) {
              const nextX = clamp(tx + dirX * speed * scale, roamMinTx, roamMaxTx);
              const nextY = clamp(ty + dirY * speed * scale, roamMinTy, roamMaxTy);
              if (controlledCollisionGrid) {
                const strictWalkable = isPositionWalkable(controlledCollisionGrid, nextX, nextY, PLAYER_COLLISION_CLEARANCE);
                const softWalkable = strictWalkable || isPositionWalkable(controlledCollisionGrid, nextX, nextY, 0.08);
                if (!softWalkable) continue;
              }
              tx = nextX;
              ty = nextY;
              return { moved: true };
            }
            return { moved: false };
          };
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
            const sprintEnabled = input.run && playSprintEnergyRef.current > 4;
            const moveSpeed = PLAYER_MOVE_SPEED * (sprintEnabled ? PLAYER_SPRINT_MULTIPLIER : 1);
            const moveCandidates = [
              { dx: nx, dy: ny },
              { dx: nx, dy: 0 },
              { dx: 0, dy: ny },
            ];
            for (const candidate of moveCandidates) {
              const moved = tryControlledMove(candidate.dx, candidate.dy, moveSpeed);
              if (!moved.moved) continue;
              movingNow = true;
              break;
            }
            if (movingNow) applySeamlessInfiniteAdvance();
            if (Math.abs(nx) >= Math.abs(ny)) {
              direction = nx >= 0 ? 'right' : 'left';
            } else {
              direction = ny >= 0 ? 'down' : 'up';
            }
            if (movingNow && sprintEnabled) {
              sprintingThisTick = true;
            }
          } else if (pointerTarget) {
            const dx = pointerTarget.tx - tx;
            const dy = pointerTarget.ty - ty;
            const dist = Math.hypot(dx, dy);
            if (dist <= 0.2) {
              playPointTargetRef.current = null;
            } else {
              const nx = dx / (dist || 1);
              const ny = dy / (dist || 1);
              const moveSpeed = PLAYER_POINTER_MOVE_SPEED;
              const moveCandidates = [
                { dx: nx, dy: ny },
                { dx: nx, dy: 0 },
                { dx: 0, dy: ny },
              ];
              for (const candidate of moveCandidates) {
                const moved = tryControlledMove(candidate.dx, candidate.dy, moveSpeed);
                if (!moved.moved) continue;
                movingNow = true;
                break;
              }
              if (movingNow) applySeamlessInfiniteAdvance();
              if (Math.abs(nx) >= Math.abs(ny)) {
                direction = nx >= 0 ? 'right' : 'left';
              } else {
                direction = ny >= 0 ? 'down' : 'up';
              }
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
            status: hqInsideActive ? manualHqStatusLabel : manualStatusLabel,
            sectorX,
            sectorY,
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
          const graphProjection = agent.miroFishProjection;
          if (graphProjection) {
            const linkedAgent = graphProjection.targetAgentId
              ? previousAgents.find((item) => item.id === graphProjection.targetAgentId)
              : null;
            const phaseSeed = (graphProjection.profileIndex ?? 0) + (miroFishRunStatus?.current_round ?? 0) + graphProjection.actionScore;
            const angle = (phaseSeed * 0.72) + (rnd() * Math.PI * 2);
            const orbitRadius = graphProjection.motion === 'broadcast'
              ? 3
              : graphProjection.motion === 'coordinate'
                ? 1.7
                : graphProjection.motion === 'analyze'
                  ? 1.25
                  : graphProjection.motion === 'settle'
                    ? 0.7
                    : 1;
            const nextIntent: AgentMindIntent = graphProjection.motion === 'broadcast'
              ? 'trade'
              : graphProjection.motion === 'coordinate'
                ? 'chat'
                : graphProjection.motion === 'settle'
                  ? 'rest'
                  : graphProjection.motion === 'analyze'
                    ? 'observe'
                    : 'patrol';
            let projectedTx = graphProjection.anchorTx;
            let projectedTy = graphProjection.anchorTy;
            if (linkedAgent && graphProjection.motion === 'coordinate') {
              const midWeight = 0.38 + (rnd() * 0.2);
              projectedTx = graphProjection.anchorTx + ((linkedAgent.tx - graphProjection.anchorTx) * midWeight);
              projectedTy = graphProjection.anchorTy + ((linkedAgent.ty - graphProjection.anchorTy) * midWeight);
            } else if (graphProjection.motion !== 'settle') {
              projectedTx += Math.cos(angle) * orbitRadius;
              projectedTy += Math.sin(angle) * orbitRadius;
            }
            projectedTx = clamp(projectedTx, roamMinTx, roamMaxTx);
            projectedTy = clamp(projectedTy, roamMinTy, roamMaxTy);
            if (collisionGrid) {
              const normalizedTarget = normalizeWalkableTarget(map, collisionGrid, projectedTx, projectedTy, rnd);
              targetTx = normalizedTarget.targetTx;
              targetTy = normalizedTarget.targetTy;
              pathWaypoints = buildShortSteerWaypoints(map, collisionGrid, tx, ty, targetTx, targetTy, rnd, 3);
            } else {
              targetTx = projectedTx;
              targetTy = projectedTy;
              pathWaypoints = [];
            }
            if (!thought || !thoughtTimer || thoughtTimer <= now + 800 || rnd() > 0.72) {
              thought = truncateMiroFishText(graphProjection.interviewLabel || graphProjection.thoughtLabel, 52);
              thoughtTimer = now + 2200 + Math.floor(rnd() * 1800);
            }
            status = graphProjection.statusLabel;
            mind = {
              ...mind,
              currentTask: nextIntent,
              intent: nextIntent,
              taskQueue: [],
              energy: clamp01(mind.energy + (nextIntent === 'rest' ? 0.14 : -0.04 + (rnd() * 0.05))),
              sociability: clamp01(mind.sociability + (nextIntent === 'chat' ? 0.06 : -0.01 + (rnd() * 0.02))),
              focus: clamp01(mind.focus + (nextIntent === 'observe' ? 0.08 : 0.01)),
              nextDecisionAt: now + Math.floor((550 + Math.floor(rnd() * 950)) / Math.max(0.72, bnbWorldEvent.npcSpeedMultiplier)),
              memory: [...mind.memory.slice(-2), `MiroFish:${status}`],
            };
            pauseUntil = undefined;
          } else {
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
              nextDecisionAt: now + Math.floor(((agent.source === 'nft' ? 900 : 700) + Math.floor(rnd() * 1700)) / Math.max(0.72, bnbWorldEvent.npcSpeedMultiplier)),
              memory: [...mind.memory.slice(-2), `${AGENT_ROLE_LABEL[mind.role]}:${status}`],
            };
            pauseUntil = undefined;
          }
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
              pauseUntil = now + 25 + Math.floor(moveRnd() * 120);
            }
          } else {
            const baseSpeed = agent.source === 'nft' ? NFT_BASE_MOVE_SPEED : NPC_BASE_MOVE_SPEED;
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
            const speed = baseSpeed * intentSpeedFactor * temperSpeedFactor * approachFactor * bnbWorldEvent.npcSpeedMultiplier;
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
              if (isCrowdedByNearbyAgent(nextX, nextY, agent.id, agent.source)) continue;
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
              const failPauseBase = stuckTicks >= 4 ? 120 : 45;
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
          sectorX,
          sectorY,
          mind,
          isMoving: movingNow,
          pauseUntil,
          stuckTicks,
          lastMoveTime: movingNow ? now : agent.lastMoveTime,
        };
      });

      if (!isTestMap && playModeEnabled && controlledPresent) {
        const nextEnergy = clamp(
          playSprintEnergyRef.current + ((sprintingThisTick ? -2.6 : 1.35) * LOGIC_TICK_SCALE),
          0,
          100,
        );
        playSprintEnergyRef.current = nextEnergy;
        if ((now - playUiLastSyncAtRef.current) > 220) {
          playUiLastSyncAtRef.current = now;
          const uiEnergy = Math.round(nextEnergy * 10) / 10;
          setPlaySprintEnergyUi((prev) => (Math.abs(prev - uiEnergy) < 0.05 ? prev : uiEnergy));
        }

        const controller = controlledAgentId
          ? agentsRef.current.find((agent) => agent.id === controlledAgentId)
          : undefined;
        if (controller) {
          let nearestLootIndex = -1;
          let nearestLootDist = Number.POSITIVE_INFINITY;
          for (let i = 0; i < playLootRef.current.length; i++) {
            const loot = playLootRef.current[i];
            const dx = loot.tx - controller.tx;
            const dy = loot.ty - controller.ty;
            const d = (dx * dx) + (dy * dy);
            if (d < nearestLootDist) {
              nearestLootDist = d;
              nearestLootIndex = i;
            }
          }
          if (nearestLootIndex >= 0 && nearestLootDist <= 0.72) {
            const picked = playLootRef.current.splice(nearestLootIndex, 1)[0];
            let lootQuestDoneNow = false;
            setMapPlayStats((prev) => {
              const lootCollected = prev.lootCollected + 1;
              let score = prev.score + (picked?.value ?? 12);
              let lootQuestRewardClaimed = prev.lootQuestRewardClaimed;
              if (!lootQuestRewardClaimed && lootCollected >= MAP_PLAY_LOOT_TARGET) {
                score += 180;
                lootQuestRewardClaimed = true;
                lootQuestDoneNow = true;
              }
              return { ...prev, score, lootCollected, lootQuestRewardClaimed };
            });
            if (lootQuestDoneNow) {
              setAgentPanelNotice(t('补给收集任务完成！奖励 +180 分。', 'Supply collection quest complete! +180 score bonus.'));
            } else {
              setAgentPanelNotice(t('拾取补给成功，继续探索。', 'Supply picked up. Keep exploring.'));
            }
            advanceAdventureQuest('loot', 1, currentSectorBiome);
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
          let nearestEnemyDist = Number.POSITIVE_INFINITY;
          for (const enemy of mapRpgEnemiesRef.current) {
            if (enemy.isDead) continue;
            const dx = enemy.tx - controller.tx;
            const dy = enemy.ty - controller.ty;
            const d = (dx * dx) + (dy * dy);
            if (d < nearestEnemyDist) {
              nearestEnemyDist = d;
            }
          }
          const inRange = nearest && nearestDist <= 2.4;
          const nearEnemy = nearestEnemyDist <= 2.3;
          const nearLoot = nearestLootDist <= 2.1;
          const hqLayout = getMapHeadquartersLayout(map, {
            infiniteExploreEnabled,
            sectorX: currentSectorX,
            sectorY: currentSectorY,
          });
          const nearHqOutsideDoor = Boolean(
            hqLayout
            && !mapHqInsideRef.current
            && Math.hypot(controller.tx - hqLayout.outsideDoor.tx, controller.ty - hqLayout.outsideDoor.ty) <= 2.2,
          );
          const nearHqInsideDoor = Boolean(
            hqLayout
            && mapHqInsideRef.current
            && Math.hypot(controller.tx - hqLayout.insideDoor.tx, controller.ty - hqLayout.insideDoor.ty) <= 2.2,
          );
          const hint = nearHqInsideDoor
            ? t('按 E 离开主楼', 'Press E to leave headquarters')
            : nearHqOutsideDoor
              ? t('按 E 进入主楼', 'Press E to enter headquarters')
              : mapHqInsideRef.current
                ? t('主楼内探索中，靠近门后按 E 可离开。', 'Exploring HQ interior. Move to the door and press E to leave.')
                : nearEnemy
                  ? t('附近有野怪，按 F 普攻或 Q 技能。', 'Enemy nearby, use F attack or Q skill.')
                  : nearLoot
                    ? t('附近有补给星星，靠近可拾取分数。', 'Supply star nearby. Move closer to collect score.')
                    : inRange
                      ? t('按 E 与附近角色互动', 'Press E to interact with nearby character')
                      : t('靠近角色后按 E 互动', 'Move close to a character, then press E');
          if (hint !== playNearbyHintRef.current) {
            playNearbyHintRef.current = hint;
            setPlayNearbyHint(hint);
          }

          mapRpgDamageFxRef.current = mapRpgDamageFxRef.current.filter((fx) => fx.expiresAt > now);
          const rpgGrid = mapCollisionGridRef.current;
          const rpgEnemies = mapRpgEnemiesRef.current;
          let rpgEnemiesChanged = false;
          let rpgScoreGain = 0;
          let playerNext = mapRpgPlayerRef.current;
          let playerChanged = false;
          let questNext = mapRpgQuestRef.current;
          let questChanged = false;
          let questCompletedNext = mapRpgQuestCompletedRef.current;
          let questCompletedChanged = false;

          const updatePlayer = (apply: (prev: MapRpgPlayerState) => MapRpgPlayerState) => {
            playerNext = apply(playerNext);
            playerChanged = true;
          };
          const updateQuest = (apply: (prev: MapRpgQuest) => MapRpgQuest) => {
            questNext = apply(questNext);
            questChanged = true;
          };
          const pushRpgDamageFx = (
            tx: number,
            ty: number,
            text: string,
            color: string,
            duration = 720,
          ) => {
            mapRpgDamageFxRef.current.push({
              id: `rpgfx-${now}-${Math.random()}`,
              tx,
              ty,
              text,
              color,
              createdAt: now,
              expiresAt: now + duration,
            });
          };
          const grantXpAndGold = (xpGain: number, goldGain: number, killGain = false): boolean => {
            if (xpGain <= 0 && goldGain <= 0 && !killGain) return false;
            let leveledUp = false;
            updatePlayer((prev) => {
              let next = {
                ...prev,
                gold: Math.max(0, prev.gold + Math.max(0, goldGain)),
                kills: killGain ? prev.kills + 1 : prev.kills,
              };
              let xpCarry = prev.xp + Math.max(0, xpGain);
              let level = prev.level;
              let xpNeed = prev.xpToNext;
              let maxHp = prev.maxHp;
              let maxMp = prev.maxMp;
              let atk = prev.atk;
              let def = prev.def;
              let hp = prev.hp;
              let mp = prev.mp;
              while (xpCarry >= xpNeed) {
                xpCarry -= xpNeed;
                level += 1;
                xpNeed = getMapRpgXpToNext(level);
                maxHp += 14;
                maxMp += 6;
                atk += 2;
                def += 1;
                hp = maxHp;
                mp = maxMp;
                leveledUp = true;
              }
              next = {
                ...next,
                level,
                xp: Math.max(0, xpCarry),
                xpToNext: Math.max(1, xpNeed),
                maxHp,
                maxMp,
                hp,
                mp,
                atk,
                def,
              };
              return next;
            });
            return leveledUp;
          };
          const rewardEnemyDefeat = (enemy: MapRpgEnemy, viaSkill = false): { leveled: boolean; questCompleted: boolean; elite: boolean } => {
            enemy.isDead = true;
            enemy.respawnAt = now + MAP_RPG_ENEMY_RESPAWN_MS + Math.floor(Math.random() * 1800);
            rpgEnemiesChanged = true;

            const rewardXpBase = enemy.rewardXp + Math.floor(playerNext.level * 0.4);
            const rewardXp = viaSkill ? Math.floor(rewardXpBase * 1.08) : rewardXpBase;
            const rewardGold = enemy.rewardGold + Math.floor(Math.random() * (enemy.isElite ? 8 : 4)) + (enemy.isElite ? 6 : 0);
            const leveled = grantXpAndGold(rewardXp, rewardGold, true);
            rpgScoreGain += rewardXp + rewardGold;

            updateQuest((prev) => ({
              ...prev,
              progress: Math.min(prev.target, prev.progress + 1),
            }));

            let questCompleted = false;
            if (questNext.progress >= questNext.target) {
              const questRewardXp = questNext.rewardXp;
              const questRewardGold = questNext.rewardGold;
              const questLeveled = grantXpAndGold(questRewardXp, questRewardGold, false);
              rpgScoreGain += Math.floor((questRewardXp + questRewardGold) * 0.75);
              questCompletedNext += 1;
              questCompletedChanged = true;
              const nextQuest = createMapRpgQuest(playerNext.level, questCompletedNext);
              questNext = nextQuest;
              questChanged = true;
              questCompleted = true;
              const questMsg = questLeveled
                ? t(
                  `任务完成并升级到 Lv.${playerNext.level}！获得 ${questRewardXp} EXP / ${questRewardGold} 金币，已刷新新任务。`,
                  `Quest complete and level up to Lv.${playerNext.level}! +${questRewardXp} EXP / +${questRewardGold} gold, new task unlocked.`,
                )
                : t(
                  `任务完成！获得 ${questRewardXp} EXP / ${questRewardGold} 金币，已刷新新任务。`,
                  `Quest complete! +${questRewardXp} EXP / +${questRewardGold} gold. New task unlocked.`,
                );
              setAgentPanelNotice(questMsg);
            }

            if (enemy.isElite || Math.random() < (enemy.isElite ? 0.52 : 0.24)) {
              const hpDrop = enemy.isElite ? 1 + (Math.random() > 0.5 ? 1 : 0) : (Math.random() > 0.48 ? 1 : 0);
              const mpDrop = enemy.isElite ? 1 + (Math.random() > 0.64 ? 1 : 0) : (Math.random() > 0.72 ? 1 : 0);
              if (hpDrop > 0 || mpDrop > 0) {
                updatePlayer((prev) => ({
                  ...prev,
                  hpPotion: prev.hpPotion + hpDrop,
                  mpPotion: prev.mpPotion + mpDrop,
                }));
                pushRpgDamageFx(
                  enemy.tx,
                  enemy.ty - 0.74,
                  `+道具 HP${hpDrop > 0 ? `+${hpDrop}` : ''} MP${mpDrop > 0 ? `+${mpDrop}` : ''}`,
                  '#99f0a8',
                  940,
                );
              }
            }

            return { leveled, questCompleted, elite: enemy.isElite };
          };

          for (const enemy of rpgEnemies) {
            if (enemy.isDead) {
              if (now < enemy.respawnAt) continue;
              const respawnRnd = createSeededRandom(
                Math.floor(now / 120)
                + (enemy.id.length * 97)
                + ((infiniteRegionRef.current.x + 503) * 17)
                + ((infiniteRegionRef.current.y + 409) * 19),
              );
              let nextTx = clamp(Math.floor(2 + respawnRnd() * Math.max(1, map.width - 4)), 2, map.width - 3);
              let nextTy = clamp(Math.floor(2 + respawnRnd() * Math.max(1, map.height - 4)), 2, map.height - 3);
              if (rpgGrid) {
                const normalized = normalizeWalkableTarget(map, rpgGrid, nextTx, nextTy, respawnRnd);
                nextTx = clamp(normalized.targetTx, 2, map.width - 3);
                nextTy = clamp(normalized.targetTy, 2, map.height - 3);
              }
              enemy.tx = nextTx + ((respawnRnd() - 0.5) * 0.35);
              enemy.ty = nextTy + ((respawnRnd() - 0.5) * 0.35);
              enemy.hp = enemy.maxHp;
              enemy.targetTx = enemy.tx;
              enemy.targetTy = enemy.ty;
              enemy.lastActionAt = now;
              enemy.respawnAt = 0;
              enemy.isDead = false;
              rpgEnemiesChanged = true;
              continue;
            }

            const aiRnd = createSeededRandom(
              Math.floor(now / 80)
              + Math.floor(enemy.phase * 1000)
              + (enemy.id.length * 131)
              + (enemy.kind === 'boar' ? 77 : enemy.kind === 'wisp' ? 191 : 43),
            );
            const targetDx = controller.tx - enemy.tx;
            const targetDy = controller.ty - enemy.ty;
            const distToPlayer = Math.hypot(targetDx, targetDy);
            const isChasing = distToPlayer <= 7.2;
            const distToTarget = Math.hypot(enemy.targetTx - enemy.tx, enemy.targetTy - enemy.ty);

            if (isChasing) {
              enemy.targetTx = controller.tx;
              enemy.targetTy = controller.ty;
            } else if (distToTarget < 0.64 || aiRnd() > 0.94) {
              const roamRadius = enemy.kind === 'boar' ? 3.4 : 2.8;
              let roamTx = enemy.tx + ((aiRnd() - 0.5) * roamRadius * 2);
              let roamTy = enemy.ty + ((aiRnd() - 0.5) * roamRadius * 2);
              roamTx = clamp(roamTx, 1.2, map.width - 1.2);
              roamTy = clamp(roamTy, 1.2, map.height - 1.2);
              if (rpgGrid) {
                const normalized = normalizeWalkableTarget(map, rpgGrid, roamTx, roamTy, aiRnd);
                roamTx = normalized.targetTx;
                roamTy = normalized.targetTy;
              }
              enemy.targetTx = roamTx;
              enemy.targetTy = roamTy;
            }

            const mx = enemy.targetTx - enemy.tx;
            const my = enemy.targetTy - enemy.ty;
            const md = Math.hypot(mx, my);
            if (md > 0.03) {
              const speed = enemy.speed * (isChasing ? 1.18 : 0.86);
              const stepX = (mx / md) * speed;
              const stepY = (my / md) * speed;
              const moveCandidates = [
                { x: enemy.tx + stepX, y: enemy.ty + stepY },
                { x: enemy.tx + stepX, y: enemy.ty },
                { x: enemy.tx, y: enemy.ty + stepY },
              ];
              let moved = false;
              for (const candidate of moveCandidates) {
                const nextX = clamp(candidate.x, 1.2, map.width - 1.2);
                const nextY = clamp(candidate.y, 1.2, map.height - 1.2);
                if (rpgGrid && !isPositionWalkable(rpgGrid, nextX, nextY, 0.18)) continue;
                enemy.tx = nextX;
                enemy.ty = nextY;
                moved = true;
                rpgEnemiesChanged = true;
                break;
              }
              if (!moved && aiRnd() > 0.75) {
                enemy.targetTx = clamp(enemy.tx + (aiRnd() - 0.5) * 4.2, 1.2, map.width - 1.2);
                enemy.targetTy = clamp(enemy.ty + (aiRnd() - 0.5) * 4.2, 1.2, map.height - 1.2);
              }
            }

            const attackDx = controller.tx - enemy.tx;
            const attackDy = controller.ty - enemy.ty;
            const attackDist = Math.hypot(attackDx, attackDy);
            if (attackDist <= 1.05 && (now - enemy.lastActionAt) >= MAP_RPG_ENEMY_ATTACK_COOLDOWN_MS) {
              enemy.lastActionAt = now;
              rpgEnemiesChanged = true;
              const incoming = Math.max(
                1,
                Math.floor(enemy.atk - (playerNext.def * 0.35) + (aiRnd() * 3) + (enemy.isElite ? 2 : 0)),
              );
              const nextHp = Math.max(0, playerNext.hp - incoming);
              updatePlayer((prev) => ({ ...prev, hp: nextHp, lastDamageAt: now }));
              pushRpgDamageFx(controller.tx, controller.ty - 0.4, `-${incoming}`, '#ff7d7d', 760);
              if (nextHp <= 0) {
                const goldPenalty = Math.min(playerNext.gold, 24);
                const respawnTx = clamp(Math.floor(map.width * 0.5), 1, map.width - 2);
                const respawnTy = clamp(Math.floor(map.height * 0.56), 1, map.height - 2);
                controller.tx = respawnTx;
                controller.ty = respawnTy;
                controller.targetTx = undefined;
                controller.targetTy = undefined;
                controller.pathWaypoints = [];
                playPointTargetRef.current = null;
                updatePlayer((prev) => ({
                  ...prev,
                  hp: prev.maxHp,
                  mp: prev.maxMp,
                  gold: Math.max(0, prev.gold - goldPenalty),
                  lastDamageAt: now,
                }));
                setAgentPanelNotice(
                  t(
                    `你被击倒了，损失 ${goldPenalty} 金币并在营地复活。`,
                    `You were downed, lost ${goldPenalty} gold, and respawned at camp.`,
                  ),
                );
              }
            }
          }

          if (mapRpgAttackRequestAtRef.current > mapRpgAttackHandledAtRef.current) {
            mapRpgAttackHandledAtRef.current = mapRpgAttackRequestAtRef.current;
            if ((now - playerNext.lastAttackAt) >= MAP_RPG_ATTACK_COOLDOWN_MS) {
              let targetEnemy: MapRpgEnemy | null = null;
              let targetDist = Number.POSITIVE_INFINITY;
              for (const enemy of rpgEnemies) {
                if (enemy.isDead) continue;
                const dx = enemy.tx - controller.tx;
                const dy = enemy.ty - controller.ty;
                const dist = Math.hypot(dx, dy);
                if (dist < targetDist) {
                  targetDist = dist;
                  targetEnemy = enemy;
                }
              }
              updatePlayer((prev) => ({ ...prev, lastAttackAt: now, mp: Math.max(0, prev.mp - 1) }));
              if (!targetEnemy || targetDist > MAP_RPG_ATTACK_RANGE) {
                setAgentPanelNotice(t('攻击落空，靠近野怪后再按 F。', 'Attack missed. Move closer and press F again.'));
              } else {
                const hit = Math.max(1, Math.floor(playerNext.atk + (playerNext.level * 0.7) - targetEnemy.def + (Math.random() * 4)));
                targetEnemy.hp = Math.max(0, targetEnemy.hp - hit);
                targetEnemy.lastActionAt = now;
                rpgEnemiesChanged = true;
                pushRpgDamageFx(targetEnemy.tx, targetEnemy.ty - 0.52, `-${hit}`, '#ffe178', 700);
                if (targetEnemy.hp <= 0) {
                  const result = rewardEnemyDefeat(targetEnemy, false);
                  if (!result.questCompleted) {
                    if (result.leveled) {
                      setAgentPanelNotice(t(`升级成功！当前等级 Lv.${playerNext.level}`, `Level up! Current level Lv.${playerNext.level}`));
                    } else if (result.elite) {
                      setAgentPanelNotice(t('击败精英怪！掉落与奖励更高。', 'Elite defeated! Better loot and rewards.'));
                    } else {
                      setAgentPanelNotice(t('击败野怪，继续推进任务。', 'Enemy defeated. Keep pushing the quest.'));
                    }
                  }
                }
              }
            }
          }

          if (mapRpgSkillRequestAtRef.current > mapRpgSkillHandledAtRef.current) {
            mapRpgSkillHandledAtRef.current = mapRpgSkillRequestAtRef.current;
            const skillCdLeft = MAP_RPG_SKILL_COOLDOWN_MS - (now - playerNext.lastSkillAt);
            if (skillCdLeft > 0) {
              setAgentPanelNotice(
                t(
                  `技能冷却中，还需 ${(skillCdLeft / 1000).toFixed(1)} 秒。`,
                  `Skill cooling down: ${(skillCdLeft / 1000).toFixed(1)}s left.`,
                ),
              );
            } else if (playerNext.mp < MAP_RPG_SKILL_MP_COST) {
              setAgentPanelNotice(t('法力不足，无法释放技能。', 'Not enough MP to cast skill.'));
            } else {
              const targets: MapRpgEnemy[] = [];
              for (const enemy of rpgEnemies) {
                if (enemy.isDead) continue;
                const dx = enemy.tx - controller.tx;
                const dy = enemy.ty - controller.ty;
                const dist = Math.hypot(dx, dy);
                if (dist <= MAP_RPG_SKILL_RANGE) {
                  targets.push(enemy);
                }
              }
              if (targets.length <= 0) {
                setAgentPanelNotice(t('技能已就绪，但范围内没有目标。', 'Skill ready, but no target in range.'));
              } else {
                updatePlayer((prev) => ({
                  ...prev,
                  mp: Math.max(0, prev.mp - MAP_RPG_SKILL_MP_COST),
                  lastSkillAt: now,
                }));
                pushRpgDamageFx(controller.tx, controller.ty - 0.8, '旋风斩!', '#9fe6ff', 700);
                let killCount = 0;
                let eliteKillCount = 0;
                let levelUpDuringSkill = false;
                let questCompletedDuringSkill = false;
                for (const enemy of targets) {
                  const hit = Math.max(
                    2,
                    Math.floor((playerNext.atk * 1.45) + (playerNext.level * 1.05) - (enemy.def * 0.45) + (Math.random() * 6)),
                  );
                  enemy.hp = Math.max(0, enemy.hp - hit);
                  enemy.lastActionAt = now;
                  rpgEnemiesChanged = true;
                  pushRpgDamageFx(enemy.tx, enemy.ty - 0.58, `-${hit}`, enemy.isElite ? '#ffd377' : '#8ad8ff', 820);
                  if (enemy.hp <= 0) {
                    const result = rewardEnemyDefeat(enemy, true);
                    killCount += 1;
                    if (result.elite) eliteKillCount += 1;
                    if (result.leveled) levelUpDuringSkill = true;
                    if (result.questCompleted) questCompletedDuringSkill = true;
                  }
                }
                if (!questCompletedDuringSkill) {
                  if (killCount > 0) {
                    setAgentPanelNotice(
                      t(
                        `技能命中 ${targets.length} 个目标，击败 ${killCount} 个${eliteKillCount > 0 ? `（精英 ${eliteKillCount}）` : ''}。`,
                        `Skill hit ${targets.length} targets, defeated ${killCount}${eliteKillCount > 0 ? ` (elite ${eliteKillCount})` : ''}.`,
                      ),
                    );
                  } else if (levelUpDuringSkill) {
                    setAgentPanelNotice(t(`技能释放成功并升级到 Lv.${playerNext.level}`, `Skill cast successful and level up to Lv.${playerNext.level}`));
                  } else {
                    setAgentPanelNotice(t(`技能命中 ${targets.length} 个目标。`, `Skill hit ${targets.length} targets.`));
                  }
                }
              }
            }
          }

          if (mapRpgUseHpPotionRequestAtRef.current > mapRpgUseHpPotionHandledAtRef.current) {
            mapRpgUseHpPotionHandledAtRef.current = mapRpgUseHpPotionRequestAtRef.current;
            if (playerNext.hpPotion <= 0) {
              setAgentPanelNotice(t('背包里没有生命药水。', 'No HP potion in bag.'));
            } else if (playerNext.hp >= playerNext.maxHp) {
              setAgentPanelNotice(t('当前生命值已满。', 'HP is already full.'));
            } else {
              const heal = Math.max(18, Math.floor(playerNext.maxHp * MAP_RPG_POTION_HEAL_RATIO));
              updatePlayer((prev) => ({
                ...prev,
                hpPotion: Math.max(0, prev.hpPotion - 1),
                hp: Math.min(prev.maxHp, prev.hp + heal),
              }));
              pushRpgDamageFx(controller.tx, controller.ty - 0.62, `+${heal} HP`, '#8fe08b', 820);
              setAgentPanelNotice(t(`使用生命药水，恢复 ${heal} HP。`, `Used HP potion, restored ${heal} HP.`));
            }
          }

          if (mapRpgUseMpPotionRequestAtRef.current > mapRpgUseMpPotionHandledAtRef.current) {
            mapRpgUseMpPotionHandledAtRef.current = mapRpgUseMpPotionRequestAtRef.current;
            if (playerNext.mpPotion <= 0) {
              setAgentPanelNotice(t('背包里没有法力药水。', 'No MP potion in bag.'));
            } else if (playerNext.mp >= playerNext.maxMp) {
              setAgentPanelNotice(t('当前法力值已满。', 'MP is already full.'));
            } else {
              const restore = Math.max(8, Math.floor(playerNext.maxMp * MAP_RPG_POTION_MP_RATIO));
              updatePlayer((prev) => ({
                ...prev,
                mpPotion: Math.max(0, prev.mpPotion - 1),
                mp: Math.min(prev.maxMp, prev.mp + restore),
              }));
              pushRpgDamageFx(controller.tx, controller.ty - 0.62, `+${restore} MP`, '#8fd7ff', 820);
              setAgentPanelNotice(t(`使用法力药水，恢复 ${restore} MP。`, `Used MP potion, restored ${restore} MP.`));
            }
          }

          const hpBeatNow = Math.floor(now / 560);
          const hpBeatPrev = Math.floor((now - AGENT_LOGIC_TICK_MS) / 560);
          const mpBeatNow = Math.floor(now / 360);
          const mpBeatPrev = Math.floor((now - AGENT_LOGIC_TICK_MS) / 360);
          if (hpBeatNow !== hpBeatPrev && (now - playerNext.lastDamageAt) > 2300 && playerNext.hp < playerNext.maxHp) {
            updatePlayer((prev) => ({ ...prev, hp: Math.min(prev.maxHp, prev.hp + 1) }));
          }
          if (mpBeatNow !== mpBeatPrev && playerNext.mp < playerNext.maxMp) {
            updatePlayer((prev) => ({ ...prev, mp: Math.min(prev.maxMp, prev.mp + 1) }));
          }

          if (rpgEnemiesChanged) {
            mapRpgEnemiesRef.current = rpgEnemies;
          }
          if (playerChanged) {
            mapRpgPlayerRef.current = playerNext;
            setMapRpgPlayer(playerNext);
          }
          if (questChanged) {
            mapRpgQuestRef.current = questNext;
            setMapRpgQuest(questNext);
          }
          if (questCompletedChanged) {
            mapRpgQuestCompletedRef.current = questCompletedNext;
            setMapRpgQuestCompletedCount(questCompletedNext);
          }
          if (rpgScoreGain > 0) {
            setMapPlayStats((prev) => ({ ...prev, score: prev.score + Math.floor(rpgScoreGain) }));
          }
        } else if (playNearbyHintRef.current) {
          playNearbyHintRef.current = '';
          setPlayNearbyHint('');
        }
      }

      if (!isTestMap && playModeEnabled && playInteractRequestAtRef.current > playInteractHandledAtRef.current) {
        playInteractHandledAtRef.current = playInteractRequestAtRef.current;
        const controller = controlledAgentId
          ? agentsRef.current.find((agent) => agent.id === controlledAgentId)
          : undefined;
        if (!controller) {
          setAgentPanelNotice(t('当前没有可操控角色。', 'No controllable character right now.'));
          return;
        }
        const controllerSectorX = controller.sectorX ?? infiniteRegionRef.current.x;
        const controllerSectorY = controller.sectorY ?? infiniteRegionRef.current.y;
        const hqLayout = getMapHeadquartersLayout(map, {
          infiniteExploreEnabled,
          sectorX: controllerSectorX,
          sectorY: controllerSectorY,
        });
        if (hqLayout) {
          const outsideDist = Math.hypot(controller.tx - hqLayout.outsideDoor.tx, controller.ty - hqLayout.outsideDoor.ty);
          const insideDist = Math.hypot(controller.tx - hqLayout.insideDoor.tx, controller.ty - hqLayout.insideDoor.ty);
          const commitTeleport = (nextTx: number, nextTy: number, dir: 'up' | 'down' | 'left' | 'right') => {
            controller.tx = nextTx;
            controller.ty = nextTy;
            controller.direction = dir;
            controller.targetTx = undefined;
            controller.targetTy = undefined;
            controller.pathWaypoints = [];
            playPointTargetRef.current = null;
          };

          if (!mapHqInsideRef.current && outsideDist <= 2.2) {
            commitTeleport(hqLayout.insideSpawn.tx, hqLayout.insideSpawn.ty, 'up');
            mapHqInsideRef.current = true;
            setMapHqInside(true);
            const nextHint = t('按 E 离开主楼', 'Press E to leave headquarters');
            playNearbyHintRef.current = nextHint;
            setPlayNearbyHint(nextHint);
            setAgentPanelNotice(t('已进入 AI 主楼。', 'Entered AI headquarters.'));
            return;
          }
          if (mapHqInsideRef.current && insideDist <= 2.2) {
            commitTeleport(hqLayout.outsideSpawn.tx, hqLayout.outsideSpawn.ty, 'down');
            mapHqInsideRef.current = false;
            setMapHqInside(false);
            const nextHint = t('按 E 进入主楼', 'Press E to enter headquarters');
            playNearbyHintRef.current = nextHint;
            setPlayNearbyHint(nextHint);
            setAgentPanelNotice(t('已离开主楼，返回小镇街区。', 'Left headquarters and returned to town.'));
            return;
          }
          if (mapHqInsideRef.current) {
            setAgentPanelNotice(t('你在主楼内，靠近大门后按 E 可离开。', 'You are inside headquarters. Move to the door and press E to leave.'));
            return;
          }
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
        let comboNow = 1;
        let gainedScore = 25;
        setMapPlayStats((prev) => {
          const keepCombo = prev.lastTalkAt > 0 && ((talkNow - prev.lastTalkAt) <= MAP_PLAY_COMBO_WINDOW_MS);
          comboNow = keepCombo ? prev.combo + 1 : 1;
          const comboBonus = Math.min(48, (comboNow - 1) * 6);
          gainedScore = 25 + comboBonus;
          const talks = prev.talks + 1;
          let score = prev.score + gainedScore;
          let questRewardClaimed = prev.questRewardClaimed;
          if (!questRewardClaimed && talks >= MAP_PLAY_TALK_TARGET) {
            score += 120;
            questRewardClaimed = true;
            questJustDone = true;
          }
          return {
            ...prev,
            score,
            talks,
            questRewardClaimed,
            combo: comboNow,
            bestCombo: Math.max(prev.bestCombo, comboNow),
            lastTalkAt: talkNow,
          };
        });
        if (questJustDone) {
          setAgentPanelNotice(t(`互动任务完成！连击 x${comboNow}，奖励 +120 分。`, `Talk quest complete! Combo x${comboNow}, +120 bonus.`));
        } else {
          setAgentPanelNotice(t(`互动成功！连击 x${comboNow}，本次 +${gainedScore} 分。`, `Interaction success! Combo x${comboNow}, +${gainedScore} score.`));
        }
        advanceAdventureQuest('talk', 1, currentSectorBiome);
      }
    }, AGENT_LOGIC_TICK_MS); // ~15 FPS logic tick (render loop remains smooth)

    return () => clearInterval(interval);
  }, [
    map,
    effectiveScale,
    bnbWorldEvent.npcSpeedMultiplier,
    isTestMap,
    selectedAgentId,
    mapExpansion.level,
    playModeEnabled,
    controlledAgentId,
    infiniteExploreEnabled,
    miroFishRunStatus?.current_round,
    t,
    advanceAdventureQuest,
  ]);

  useEffect(() => {
    if (!map || isTestMap) return;
    const canvas = canvasRef.current;
    const wrap = canvasWrapRef.current;
    if (!canvas || !wrap) return;

    const toTilePos = (event: MouseEvent | PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const ratioX = rect.width > 0 ? canvas.width / rect.width : 1;
      const ratioY = rect.height > 0 ? canvas.height / rect.height : 1;
      const px = (event.clientX - rect.left) * ratioX;
      const py = (event.clientY - rect.top) * ratioY;
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

    const handleCanvasPrimaryAction = (event: MouseEvent | PointerEvent) => {
      if ('button' in event && event.button !== 0) return;
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
        if (playModeEnabled && controlledAgentId && !placeMode) {
          playPointTargetRef.current = {
            tx: clamp(tx, 1, map.width - 2),
            ty: clamp(ty, 1, map.height - 2),
          };
          setAgentPanelNotice(t('已设置移动目标，角色会自动前往。', 'Move target set. Character will move there.'));
          return;
        }
        setSelectedAgentId(null);
        setAgentProfileOpen(false);
        setMapExpansionLandmarkOpen(false);
        setSelectedLandmark(null);
        return;
      }
      setSelectedAgentId(picked.id);
      if (playModeEnabled) {
        setControlledAgentId(picked.id);
      }
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
      void runAutoVerifyForAgent(picked);
    };

    const onCanvasMove = (event: PointerEvent) => {
      const { tx, ty } = toTilePos(event);
      const picked = pickClosestAgent(tx, ty);
      const next = picked?.id ?? null;
      setHoveredAgentId((prev) => (prev === next ? prev : next));
    };

    const onCanvasLeave = () => setHoveredAgentId(null);

    canvas.addEventListener('pointerdown', handleCanvasPrimaryAction);
    canvas.addEventListener('pointermove', onCanvasMove);
    canvas.addEventListener('pointerleave', onCanvasLeave);
    return () => {
      canvas.removeEventListener('pointerdown', handleCanvasPrimaryAction);
      canvas.removeEventListener('pointermove', onCanvasMove);
      canvas.removeEventListener('pointerleave', onCanvasLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestMap, map, effectiveScale, placeMode, placementTokenId, socialBoostActive, ownedTokens.join(','), mapExpansionLandmarks, playModeEnabled, infiniteExploreEnabled, runAutoVerifyForAgent, t]);

  const buildGuestNearbyChatPair = useCallback((a: AgentMarker, b: AgentMarker): readonly [string, string] | null => {
    const guest = a.guestMeta ? a : (b.guestMeta ? b : null);
    if (!guest) return null;
    const other = guest.id === a.id ? b : a;
    const topic = guest.guestMeta?.topic || t('BSC 热点', 'BSC topics');
    const zone = guest.guestMeta?.zoneLabel || t('Research Arcade', 'Research Arcade');
    const introLine = t(
      `${other.name}，我在 ${zone} 盯 ${topic}，这轮你觉得先看哪条线？`,
      `${other.name}, I'm watching ${topic} in ${zone}. Which line would you check first this round?`,
    );
    const replyLine = guest.id === a.id
      ? t(
        `${marketPulseHeadline} 这波先别急，我建议再结合 ${chainPulseHeadline} 多看一眼。`,
        `Don't rush this ${marketPulseHeadline} move yet. I'd cross-check it with ${chainPulseHeadline}.`,
      )
      : t(
        `可以，先顺着 ${topic} 往下聊，我也会把 ${chainPulseHeadline} 一起带进来。`,
        `Works for me. Let's follow ${topic}, and I'll fold ${chainPulseHeadline} into the read as well.`,
      );
    return guest.id === a.id ? [introLine, replyLine] : [replyLine, introLine];
  }, [chainPulseHeadline, marketPulseHeadline, t]);

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
        (
        agent.tx >= left
        && agent.tx <= right
        && agent.ty >= top
        && agent.ty <= bottom
        )
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
        const pair = buildGuestNearbyChatPair(a, b) ?? AGENT_CHAT_PAIRS[Math.floor(Math.random() * AGENT_CHAT_PAIRS.length)];
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
  }, [buildGuestNearbyChatPair, map, effectiveScale, isTestMap, infiniteExploreEnabled]);


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
        const requestCustomPropSprite = (key: MapCustomPropSpriteKey) => {
          if (customPropSpriteCacheRef.current.has(key) || customPropSpriteLoadingRef.current.has(key)) return;
          customPropSpriteLoadingRef.current.add(key);
          void loadImage(MAP_CUSTOM_PROP_SPRITES[key])
            .then((img) => {
              customPropSpriteCacheRef.current.set(key, img);
            })
            .catch(() => {
              customPropSpriteCacheRef.current.set(key, null);
            })
            .finally(() => {
              customPropSpriteLoadingRef.current.delete(key);
            });
        };
        if (!isTestMap) {
          const overlaySectorX = infiniteExploreEnabled ? infiniteRegionRef.current.x : 0;
          const overlaySectorY = infiniteExploreEnabled ? infiniteRegionRef.current.y : 0;
          const overlayBiome = infiniteExploreEnabled ? infiniteBiome : getInfiniteBiome(0, 0);
          const hqLayout = getMapHeadquartersLayout(map, {
            infiniteExploreEnabled,
            sectorX: overlaySectorX,
            sectorY: overlaySectorY,
          });
          drawInfiniteBiomeTheme(ctx, {
            biome: overlayBiome,
            mapWidth: map.width,
            mapHeight: map.height,
            tilePxW,
            tilePxH,
            viewLeft,
            viewTop,
            viewRight,
            viewBottom,
            now: nowMs,
            sectorX: overlaySectorX,
            sectorY: overlaySectorY,
          });
          const activeGrid = mapCollisionGridRef.current;
          // Keep base tiles fully visible; the district overlay is intentionally disabled
          // because it repaints every tile and can make the map look blank/flat.
          const enableDistrictStructureOverlay = false;
          if (enableDistrictStructureOverlay && activeGrid) {
            drawInfiniteRegionStructureOverlay(ctx, {
              grid: activeGrid,
              biome: overlayBiome,
              tilePxW,
              tilePxH,
              viewLeft,
              viewTop,
              viewRight,
              viewBottom,
              sectorX: overlaySectorX,
              sectorY: overlaySectorY,
            });
          }
          if (hqLayout) {
            drawMapHeadquartersScene(ctx, {
              layout: hqLayout,
              tilePxW,
              tilePxH,
              inside: mapHqInsideRef.current,
              viewLeft,
              viewTop,
              viewRight,
              viewBottom,
              nowMs,
            });
          }

          const useLegacyBiomePropSprites = false;
          if (useLegacyBiomePropSprites && infiniteExploreEnabled) {
            const propStep = 3;
            const startTx = Math.floor(viewLeft) - 2;
            const endTx = Math.ceil(viewRight) + 2;
            const startTy = Math.floor(viewTop) - 2;
            const endTy = Math.ceil(viewBottom) + 2;
            for (let ty = startTy; ty <= endTy; ty++) {
              for (let tx = startTx; tx <= endTx; tx++) {
                if (tx <= 1 || ty <= 1 || tx >= (map.width - 1) || ty >= (map.height - 1)) continue;
                if ((tx % propStep) !== 0 || (ty % propStep) !== 0) continue;
                const r = biomeHash(tx * 5 + 11, ty * 7 + 13, infiniteRegionRef.current.x, infiniteRegionRef.current.y);
                if (r < 0.982 || r > 0.992) continue;
                const key = pickCustomBiomePropSprite(overlayBiome, r);
                const sprite = customPropSpriteCacheRef.current.get(key);
                if (sprite === undefined) {
                  requestCustomPropSprite(key);
                  continue;
                }
                if (!sprite || !sprite.complete || sprite.naturalWidth <= 0) continue;
                const scaleBoost = key === 'tower' ? 2.05 : key === 'well' ? 1.2 : 1.8;
                const w = tilePxW * scaleBoost;
                const h = tilePxH * scaleBoost;
                const px = tx * tilePxW - (w - tilePxW) * 0.52;
                const py = ty * tilePxH - (h - tilePxH) * 0.9;
                ctx.drawImage(sprite, px, py, w, h);
              }
            }
          }
        }

        for (const deco of mapExpansionDecorations) {
          if (deco.tx < viewLeft || deco.tx > viewRight || deco.ty < viewTop || deco.ty > viewBottom) continue;
          drawMapExpansionDecoration(ctx, deco, tilePxW, tilePxH, nowMs);
        }
        for (const landmark of mapExpansionLandmarks) {
          if (landmark.tx < viewLeft || landmark.tx > viewRight || landmark.ty < viewTop || landmark.ty > viewBottom) continue;
          drawMapExpansionLandmark(ctx, landmark, tilePxW, tilePxH, nowMs, !infiniteExploreEnabled);
        }
        if (bnbActionBriefFocus) {
          const zonePxLeft = bnbActionBriefFocus.minTx * tilePxW;
          const zonePxTop = bnbActionBriefFocus.minTy * tilePxH;
          const zonePxWidth = Math.max(tilePxW * 1.5, (bnbActionBriefFocus.maxTx - bnbActionBriefFocus.minTx + 1) * tilePxW);
          const zonePxHeight = Math.max(tilePxH * 1.5, (bnbActionBriefFocus.maxTy - bnbActionBriefFocus.minTy + 1) * tilePxH);
          const zonePxRight = zonePxLeft + zonePxWidth;
          const zonePxBottom = zonePxTop + zonePxHeight;
          const viewPxLeft = viewLeft * tilePxW;
          const viewPxTop = viewTop * tilePxH;
          const viewPxRight = viewRight * tilePxW;
          const viewPxBottom = viewBottom * tilePxH;
          const intersectsView = !(zonePxRight < viewPxLeft || zonePxLeft > viewPxRight || zonePxBottom < viewPxTop || zonePxTop > viewPxBottom);
          if (intersectsView) {
            const focusAge = actionBriefFocusAt > 0 ? Math.max(0, nowMs - actionBriefFocusAt) : Number.POSITIVE_INFINITY;
            const focusBoost = Number.isFinite(focusAge) && focusAge < 2400 ? (1 - (focusAge / 2400)) : 0;
            const pulse = 0.46 + (Math.sin(nowMs / 240) * 0.18) + (focusBoost * 0.24);
            const centerX = bnbActionBriefFocus.tx * tilePxW;
            const centerY = bnbActionBriefFocus.ty * tilePxH;
            const corner = Math.max(tilePxW * 0.9, 12);
            ctx.save();
            ctx.fillStyle = `rgba(240, 196, 72, ${Math.max(0.1, pulse * 0.16)})`;
            ctx.fillRect(zonePxLeft, zonePxTop, zonePxWidth, zonePxHeight);
            ctx.setLineDash([Math.max(6, tilePxW * 0.4), Math.max(4, tilePxW * 0.24)]);
            ctx.strokeStyle = `rgba(214, 154, 18, ${Math.max(0.55, pulse)})`;
            ctx.lineWidth = Math.max(1.6, 2.2 * effectiveScale);
            ctx.strokeRect(zonePxLeft, zonePxTop, zonePxWidth, zonePxHeight);
            ctx.setLineDash([]);
            ctx.strokeStyle = `rgba(255, 240, 184, ${Math.max(0.42, 0.35 + focusBoost * 0.3)})`;
            ctx.lineWidth = Math.max(1, 1.2 * effectiveScale);
            ctx.strokeRect(zonePxLeft + tilePxW * 0.16, zonePxTop + tilePxH * 0.16, Math.max(tilePxW, zonePxWidth - tilePxW * 0.32), Math.max(tilePxH, zonePxHeight - tilePxH * 0.32));
            ctx.strokeStyle = '#d68f0d';
            ctx.lineWidth = Math.max(2, 2.8 * effectiveScale);
            ctx.beginPath();
            ctx.moveTo(zonePxLeft, zonePxTop + corner);
            ctx.lineTo(zonePxLeft, zonePxTop);
            ctx.lineTo(zonePxLeft + corner, zonePxTop);
            ctx.moveTo(zonePxRight - corner, zonePxTop);
            ctx.lineTo(zonePxRight, zonePxTop);
            ctx.lineTo(zonePxRight, zonePxTop + corner);
            ctx.moveTo(zonePxRight, zonePxBottom - corner);
            ctx.lineTo(zonePxRight, zonePxBottom);
            ctx.lineTo(zonePxRight - corner, zonePxBottom);
            ctx.moveTo(zonePxLeft + corner, zonePxBottom);
            ctx.lineTo(zonePxLeft, zonePxBottom);
            ctx.lineTo(zonePxLeft, zonePxBottom - corner);
            ctx.stroke();
            ctx.fillStyle = `rgba(255, 225, 122, ${Math.max(0.3, pulse * 0.56)})`;
            ctx.beginPath();
            ctx.arc(centerX + tilePxW * 0.5, centerY + tilePxH * 0.5, Math.max(tilePxW * 0.3, 6 + focusBoost * 6), 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = `rgba(255, 249, 214, ${Math.max(0.35, pulse * 0.7)})`;
            ctx.lineWidth = Math.max(1.2, 1.8 * effectiveScale);
            ctx.beginPath();
            ctx.arc(centerX + tilePxW * 0.5, centerY + tilePxH * 0.5, Math.max(tilePxW * 0.58, 9 + focusBoost * 8), 0, Math.PI * 2);
            ctx.stroke();
            ctx.font = `${Math.max(8, 8 * effectiveScale)}px "Press Start 2P", cursive`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = 'rgba(42, 34, 11, 0.9)';
            ctx.fillText(
              t('推荐区域', 'Suggested Zone'),
              zonePxLeft + tilePxW * 0.35,
              Math.max(tilePxH * 0.9, zonePxTop - tilePxH * 0.18),
            );
            const isCenterVisible = centerX >= viewPxLeft && centerX <= viewPxRight && centerY >= viewPxTop && centerY <= viewPxBottom;
            if (!isCenterVisible) {
              const viewCenterX = (viewPxLeft + viewPxRight) * 0.5;
              const viewCenterY = (viewPxTop + viewPxBottom) * 0.5;
              const angle = Math.atan2(centerY - viewCenterY, centerX - viewCenterX);
              const edgeInset = Math.max(tilePxW * 1.2, 18);
              const arrowX = clamp(centerX, viewPxLeft + edgeInset, viewPxRight - edgeInset);
              const arrowY = clamp(centerY, viewPxTop + edgeInset, viewPxBottom - edgeInset);
              const arrowSize = Math.max(8, tilePxW * 0.44);
              const tipX = arrowX + Math.cos(angle) * arrowSize;
              const tipY = arrowY + Math.sin(angle) * arrowSize;
              const leftX = arrowX + Math.cos(angle + (Math.PI * 0.78)) * arrowSize * 0.72;
              const leftY = arrowY + Math.sin(angle + (Math.PI * 0.78)) * arrowSize * 0.72;
              const rightX = arrowX + Math.cos(angle - (Math.PI * 0.78)) * arrowSize * 0.72;
              const rightY = arrowY + Math.sin(angle - (Math.PI * 0.78)) * arrowSize * 0.72;
              ctx.fillStyle = `rgba(214, 154, 18, ${Math.max(0.8, pulse)})`;
              ctx.beginPath();
              ctx.moveTo(tipX, tipY);
              ctx.lineTo(leftX, leftY);
              ctx.lineTo(rightX, rightY);
              ctx.closePath();
              ctx.fill();
              ctx.strokeStyle = 'rgba(255, 249, 214, 0.92)';
              ctx.lineWidth = Math.max(1.2, 1.6 * effectiveScale);
              ctx.stroke();
              ctx.font = `${Math.max(7, 7 * effectiveScale)}px "Press Start 2P", cursive`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'bottom';
              ctx.fillStyle = 'rgba(42, 34, 11, 0.92)';
              ctx.fillText(
                t('前往推荐区域', 'Move to Suggested Zone'),
                arrowX,
                arrowY - arrowSize * 0.85,
              );
            }
            ctx.restore();
          }
        }
        if (activeSkillsMission && activeSkillsMissionFocus) {
          const visible = (
            activeSkillsMissionFocus.tx >= viewLeft
            && activeSkillsMissionFocus.tx <= viewRight
            && activeSkillsMissionFocus.ty >= viewTop
            && activeSkillsMissionFocus.ty <= viewBottom
          );
          if (visible) {
            const px = activeSkillsMissionFocus.tx * tilePxW;
            const py = activeSkillsMissionFocus.ty * tilePxH;
            const centerX = px + tilePxW * 0.5;
            const centerY = py + tilePxH * 0.56;
            const pulse = 0.68 + Math.sin(nowMs / 220) * 0.18;
            const beamH = tilePxH * 2.2;
            const beamColor = activeSkillsMission.tone === 'risk'
              ? `rgba(214, 116, 88, ${Math.max(0.16, pulse * 0.2)})`
              : activeSkillsMission.tone === 'watch'
                ? `rgba(92, 140, 207, ${Math.max(0.16, pulse * 0.2)})`
                : `rgba(240, 185, 11, ${Math.max(0.18, pulse * 0.22)})`;
            const strokeColor = activeSkillsMission.tone === 'risk'
              ? 'rgba(255, 209, 197, 0.92)'
              : activeSkillsMission.tone === 'watch'
                ? 'rgba(206, 229, 255, 0.92)'
                : 'rgba(255, 245, 188, 0.94)';
            const accentColor = activeSkillsMission.tone === 'risk'
              ? '#d47458'
              : activeSkillsMission.tone === 'watch'
                ? '#5c8ccf'
                : '#f0b90b';
            const labelText = `${activeSkillsMission.token} · ${activeSkillsMission.title}`;
            ctx.save();
            ctx.fillStyle = beamColor;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY - beamH);
            ctx.lineTo(centerX + tilePxW * 0.55, centerY);
            ctx.lineTo(centerX - tilePxW * 0.55, centerY);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = Math.max(1.2, 1.8 * effectiveScale);
            ctx.beginPath();
            ctx.arc(centerX, centerY, Math.max(tilePxW * 0.3, 7), 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(centerX, centerY, Math.max(tilePxW * 0.54, 12 + pulse * 2), 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#fef3c7';
            ctx.fillRect(centerX - tilePxW * 0.12, centerY - tilePxH * 0.72, tilePxW * 0.24, tilePxH * 0.72);
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY - tilePxH * 0.98);
            ctx.lineTo(centerX + tilePxW * 0.42, centerY - tilePxH * 0.78);
            ctx.lineTo(centerX, centerY - tilePxH * 0.56);
            ctx.closePath();
            ctx.fill();
            ctx.font = `${Math.max(7, 7 * effectiveScale)}px "Press Start 2P", cursive`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const labelWidth = ctx.measureText(labelText).width + tilePxW * 0.6;
            const labelHeight = tilePxH * 0.52;
            const labelX = centerX - labelWidth * 0.5;
            const labelY = centerY - beamH - labelHeight * 0.2;
            ctx.fillStyle = 'rgba(17, 27, 15, 0.9)';
            ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = Math.max(1, 1.2 * effectiveScale);
            ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);
            ctx.fillStyle = '#f8f6d8';
            ctx.fillText(labelText, centerX, labelY + labelHeight * 0.56);
            ctx.restore();
          }
        }
        if (!isTestMap) {
          for (const loot of playLootRef.current) {
            if (loot.tx < viewLeft || loot.tx > viewRight || loot.ty < viewTop || loot.ty > viewBottom) continue;
            const cx = loot.tx * tilePxW;
            const cy = loot.ty * tilePxH;
            const pulse = 0.74 + (Math.sin((nowMs / 220) + loot.phase) * 0.26);
            const glow = Math.max(0.18, Math.min(0.5, pulse * 0.44));
            const s = Math.max(1.4, tilePxW * 0.08);
            ctx.fillStyle = `rgba(255, 238, 120, ${glow})`;
            ctx.fillRect(cx - s * 2.6, cy - s * 2.6, s * 5.2, s * 5.2);
            ctx.fillStyle = '#ffe26a';
            ctx.fillRect(cx - s, cy - s * 2, s * 2, s * 4);
            ctx.fillRect(cx - s * 2, cy - s, s * 4, s * 2);
            ctx.fillStyle = '#ffd15f';
            ctx.fillRect(cx - s, cy - s, s * 2, s * 2);
            ctx.fillStyle = '#fff9d6';
            ctx.fillRect(cx - s * 0.42, cy - s * 0.42, s * 0.84, s * 0.84);
          }
          for (const enemy of mapRpgEnemiesRef.current) {
            if (enemy.isDead) continue;
            if (enemy.tx < viewLeft || enemy.tx > viewRight || enemy.ty < viewTop || enemy.ty > viewBottom) continue;
            const ex = enemy.tx * tilePxW;
            const ey = enemy.ty * tilePxH;
            const bob = Math.sin((nowMs / 170) + enemy.phase) * tilePxH * 0.04;
            const bodyY = ey + bob;
            const colors = enemy.kind === 'boar'
              ? { body: '#b78949', shade: '#6f4523', eye: '#f6d1a5' }
              : enemy.kind === 'wisp'
                ? { body: '#7ad7ff', shade: '#3f67a3', eye: '#eaffff' }
                : { body: '#7fcf67', shade: '#2c7a31', eye: '#eefcc8' };
            if (enemy.isElite) {
              const elitePulse = 0.32 + (Math.sin((nowMs / 190) + enemy.phase) * 0.12);
              ctx.fillStyle = `rgba(255, 204, 96, ${Math.max(0.16, elitePulse)})`;
              ctx.beginPath();
              ctx.ellipse(ex + tilePxW * 0.5, bodyY + tilePxH * 0.52, tilePxW * 0.42, tilePxH * 0.32, 0, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.fillStyle = 'rgba(18, 24, 20, 0.36)';
            ctx.beginPath();
            ctx.ellipse(ex + tilePxW * 0.5, bodyY + tilePxH * 0.86, tilePxW * 0.24, tilePxH * 0.11, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = colors.shade;
            ctx.fillRect(ex + tilePxW * 0.24, bodyY + tilePxH * 0.3, tilePxW * 0.52, tilePxH * 0.5);
            ctx.fillStyle = colors.body;
            ctx.fillRect(ex + tilePxW * 0.28, bodyY + tilePxH * 0.24, tilePxW * 0.44, tilePxH * 0.44);
            if (enemy.kind === 'boar') {
              ctx.fillStyle = '#d9b48d';
              ctx.fillRect(ex + tilePxW * 0.23, bodyY + tilePxH * 0.45, tilePxW * 0.06, tilePxH * 0.08);
              ctx.fillRect(ex + tilePxW * 0.71, bodyY + tilePxH * 0.45, tilePxW * 0.06, tilePxH * 0.08);
            }
            ctx.fillStyle = colors.eye;
            ctx.fillRect(ex + tilePxW * 0.4, bodyY + tilePxH * 0.4, tilePxW * 0.06, tilePxH * 0.08);
            ctx.fillRect(ex + tilePxW * 0.54, bodyY + tilePxH * 0.4, tilePxW * 0.06, tilePxH * 0.08);
            if (enemy.isElite) {
              ctx.fillStyle = '#ffd66f';
              ctx.fillRect(ex + tilePxW * 0.37, bodyY + tilePxH * 0.19, tilePxW * 0.26, tilePxH * 0.05);
              ctx.fillRect(ex + tilePxW * 0.4, bodyY + tilePxH * 0.14, tilePxW * 0.04, tilePxH * 0.05);
              ctx.fillRect(ex + tilePxW * 0.48, bodyY + tilePxH * 0.11, tilePxW * 0.04, tilePxH * 0.07);
              ctx.fillRect(ex + tilePxW * 0.56, bodyY + tilePxH * 0.14, tilePxW * 0.04, tilePxH * 0.05);
            }
            const hpRatio = clamp(enemy.hp / Math.max(1, enemy.maxHp), 0, 1);
            const hpBarW = tilePxW * 0.68;
            const hpBarH = Math.max(2, tilePxH * 0.08);
            const hpBarX = ex + (tilePxW - hpBarW) * 0.5;
            const hpBarY = bodyY + tilePxH * 0.13;
            ctx.fillStyle = 'rgba(12, 20, 16, 0.76)';
            ctx.fillRect(hpBarX, hpBarY, hpBarW, hpBarH);
            ctx.fillStyle = enemy.isElite
              ? (hpRatio > 0.4 ? '#ffe17b' : '#ff8f7f')
              : (hpRatio > 0.55 ? '#7fda66' : hpRatio > 0.25 ? '#ffc857' : '#ff6e6e');
            ctx.fillRect(hpBarX + 1, hpBarY + 1, Math.max(0, (hpBarW - 2) * hpRatio), Math.max(0, hpBarH - 2));
          }

          const activeFx: MapRpgDamageFx[] = [];
          for (const fx of mapRpgDamageFxRef.current) {
            if (fx.expiresAt <= nowMs) continue;
            const life = clamp((fx.expiresAt - nowMs) / Math.max(1, fx.expiresAt - fx.createdAt), 0, 1);
            activeFx.push(fx);
            const rise = (1 - life) * tilePxH * 1.15;
            const fxX = (fx.tx * tilePxW) + (tilePxW * 0.5);
            const fxY = (fx.ty * tilePxH) - rise;
            ctx.globalAlpha = Math.max(0.3, life);
            ctx.textAlign = 'center';
            ctx.font = `${Math.max(8, 8 * effectiveScale)}px "Press Start 2P", cursive`;
            ctx.strokeStyle = 'rgba(12, 18, 15, 0.9)';
            ctx.lineWidth = Math.max(1, 1.6 * effectiveScale);
            ctx.strokeText(fx.text, fxX, fxY);
            ctx.fillStyle = fx.color;
            ctx.fillText(fx.text, fxX, fxY);
            ctx.globalAlpha = 1;
          }
          if (activeFx.length !== mapRpgDamageFxRef.current.length) {
            mapRpgDamageFxRef.current = activeFx;
          }
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

        const activeGraphFocusAgentId = selectedAgentId?.startsWith('graph_')
          ? selectedAgentId
          : hoveredAgentId?.startsWith('graph_')
            ? hoveredAgentId
            : null;
        const activeGraphMeta = activeGraphFocusAgentId
          ? (miroFishAgentMetaRef.current[activeGraphFocusAgentId] ?? null)
          : null;
        const activeGraphConnections = activeGraphMeta
          ? activeGraphMeta.connections.slice(0, MIROFISH_MAX_VISIBLE_CONNECTIONS)
          : [];
        const graphNeighborIdSet = new Set(activeGraphConnections.map((connection) => connection.otherAgentId));
        if (activeGraphFocusAgentId && activeGraphConnections.length > 0) {
          const focusAgent = agentsRef.current.find((agent) => agent.id === activeGraphFocusAgentId);
          if (focusAgent) {
            const focusX = (focusAgent.tx * tilePxW) + (tilePxW * 0.5);
            const focusY = (focusAgent.ty * tilePxH) + (tilePxH * 0.45);
            const pairCount = new Map<string, number>();
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            activeGraphConnections.forEach((connection, index) => {
              const otherAgent = agentsRef.current.find((agent) => agent.id === connection.otherAgentId);
              if (!otherAgent) return;
              if (
                (focusAgent.tx < viewLeft || focusAgent.tx > viewRight || focusAgent.ty < viewTop || focusAgent.ty > viewBottom)
                && (otherAgent.tx < viewLeft || otherAgent.tx > viewRight || otherAgent.ty < viewTop || otherAgent.ty > viewBottom)
              ) {
                return;
              }
              const parallelIndex = pairCount.get(connection.otherAgentId) ?? 0;
              pairCount.set(connection.otherAgentId, parallelIndex + 1);
              const otherX = (otherAgent.tx * tilePxW) + (tilePxW * 0.5);
              const otherY = (otherAgent.ty * tilePxH) + (tilePxH * 0.45);
              const dx = otherX - focusX;
              const dy = otherY - focusY;
              const distance = Math.max(1, Math.hypot(dx, dy));
              const normalX = -dy / distance;
              const normalY = dx / distance;
              const lift = (tilePxW * 0.32) + (parallelIndex * tilePxW * 0.1);
              const sign = connection.direction === 'outgoing' ? 1 : -1;
              const controlX = ((focusX + otherX) * 0.5) + (normalX * lift * sign);
              const controlY = ((focusY + otherY) * 0.5) + (normalY * lift * sign);
              const strokeColor = connection.direction === 'outgoing'
                ? 'rgba(110, 226, 255, 0.78)'
                : 'rgba(255, 214, 116, 0.72)';
              ctx.strokeStyle = strokeColor;
              ctx.lineWidth = Math.max(1.25, 2.1 * effectiveScale);
              ctx.setLineDash(connection.direction === 'outgoing' ? [tilePxW * 0.16, tilePxW * 0.1] : [tilePxW * 0.08, tilePxW * 0.12]);
              ctx.beginPath();
              ctx.moveTo(focusX, focusY);
              ctx.quadraticCurveTo(controlX, controlY, otherX, otherY);
              ctx.stroke();

              ctx.setLineDash([]);
              ctx.fillStyle = strokeColor;
              ctx.beginPath();
              ctx.arc(otherX, otherY, Math.max(1.5, tilePxW * 0.09), 0, Math.PI * 2);
              ctx.fill();

              if (index < 6) {
                const labelX = ((focusX + otherX) * 0.5) + (normalX * lift * sign * 0.55);
                const labelY = ((focusY + otherY) * 0.5) + (normalY * lift * sign * 0.55);
                const label = connection.edgeType.replace(/_/g, ' ');
                ctx.font = `${Math.max(7, 6 * effectiveScale)}px "Press Start 2P", cursive`;
                const labelWidth = ctx.measureText(label).width + (10 * effectiveScale);
                const labelHeight = 10 * effectiveScale;
                ctx.fillStyle = 'rgba(18, 34, 29, 0.84)';
                ctx.fillRect(labelX - (labelWidth * 0.5), labelY - labelHeight + (2 * effectiveScale), labelWidth, labelHeight);
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = Math.max(1, 1.1 * effectiveScale);
                ctx.strokeRect(labelX - (labelWidth * 0.5), labelY - labelHeight + (2 * effectiveScale), labelWidth, labelHeight);
                ctx.fillStyle = '#f4ffef';
                ctx.textAlign = 'center';
                ctx.fillText(label, labelX, labelY);
              }
            });
            ctx.restore();
          }
        }

        for (const a of agentsRef.current) {
          if (a.tx < viewLeft || a.tx > viewRight || a.ty < viewTop || a.ty > viewBottom) continue;
          const px = a.tx * tilePxW;
          const py = a.ty * tilePxH;
          const bobOffset = a.isMoving ? Math.sin((Date.now() / 120) + (a.walkOffset ?? 0)) * tilePxH * 0.026 : 0;
          const drawPy = py + bobOffset;
          const size = a.source === 'nft' ? tilePxW * 0.88 : tilePxW;
          const offsetX = (tilePxW - size) / 2;
          let drawBoxX = px + offsetX;
          let drawBoxY = drawPy + (a.source === 'nft' ? tilePxH * 0.08 : 0);
          let drawBoxW = size;
          let drawBoxH = size;
          const isSelected = selectedAgentId === a.id;
          const isHovered = hoveredAgentId === a.id;
          const isControlled = !isTestMap && playModeEnabled && controlledAgentId === a.id;
          const isPlayerManual = !isTestMap && a.id === 'player_manual';
          const usePixelPlayerAvatar = isPlayerManual && mapPlayerAvatar.style === 'pixel';
          const isGraphFocused = activeGraphFocusAgentId === a.id;
          const isGraphNeighbor = graphNeighborIdSet.has(a.id);
          const graphProjection = a.miroFishProjection;
          const guestAccentColor = a.guestMeta?.accentColor ?? '#ff7c5c';
          const graphMotionColor = graphProjection?.motion === 'broadcast'
            ? 'rgba(255, 165, 84, 0.94)'
            : graphProjection?.motion === 'coordinate'
              ? 'rgba(103, 219, 255, 0.94)'
              : graphProjection?.motion === 'settle'
                ? 'rgba(155, 219, 125, 0.9)'
                : graphProjection?.motion === 'analyze'
                  ? 'rgba(214, 190, 255, 0.92)'
                  : 'rgba(255, 241, 166, 0.9)';

          ctx.fillStyle = 'rgba(246, 255, 226, 0.6)';
          ctx.beginPath();
          ctx.ellipse(px + tilePxW / 2, drawPy + tilePxH - 2, tilePxW / 3, tilePxH / 7, 0, 0, Math.PI * 2);
          ctx.fill();
          if (graphProjection) {
            const pulse = 0.42 + (Math.sin((nowMs / 240) + (a.walkOffset ?? 0)) * 0.16);
            ctx.strokeStyle = graphMotionColor.replace(/0\.\d+\)/, `${Math.max(0.4, pulse)})`);
            ctx.lineWidth = Math.max(1, 1.5 * effectiveScale);
            ctx.beginPath();
            ctx.ellipse(px + tilePxW / 2, drawPy + tilePxH - 2, tilePxW * 0.35, tilePxH * 0.16, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (isGraphFocused || isGraphNeighbor) {
            ctx.fillStyle = isGraphFocused ? 'rgba(108, 230, 255, 0.14)' : 'rgba(255, 214, 96, 0.12)';
            ctx.beginPath();
            ctx.ellipse(px + tilePxW / 2, drawPy + tilePxH - 2, tilePxW * 0.46, tilePxH * 0.23, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          if (isControlled) {
            const pulse = 0.6 + Math.sin(nowMs / 220) * 0.2;
            ctx.strokeStyle = `rgba(255, 214, 96, ${Math.max(0.35, pulse)})`;
            ctx.lineWidth = Math.max(1.5, 2.5 * effectiveScale);
            ctx.beginPath();
            ctx.ellipse(px + tilePxW / 2, drawPy + tilePxH - 2, tilePxW * 0.4, tilePxH * 0.2, 0, 0, Math.PI * 2);
            ctx.stroke();
          }

          if (usePixelPlayerAvatar) {
            const avatarBox = drawMapPlayerPixelAvatar(ctx, {
              px,
              py: drawPy,
              tilePxW,
              tilePxH,
              nowMs,
              isMoving: Boolean(a.isMoving),
              direction: a.direction ?? 'down',
              avatar: mapPlayerAvatar,
            });
            drawBoxX = avatarBox.x;
            drawBoxY = avatarBox.y;
            drawBoxW = avatarBox.w;
            drawBoxH = avatarBox.h;
          } else {
            let sprite: HTMLImageElement | null = null;
            let usedHumanSprite = false;

            if (isPlayerManual && mapPlayerAvatar.style === 'sprite') {
              const spriteSheet = humanSpriteCacheRef.current.get(mapPlayerAvatar.spriteKey);
              if (spriteSheet === undefined) {
                requestHumanSprite(mapPlayerAvatar.spriteKey);
              } else if (spriteSheet) {
                sprite = spriteSheet;
                usedHumanSprite = true;
              }
            }

            if (!sprite && a.source === 'nft' && a.tokenId !== undefined) {
              const cached = nftImageCacheRef.current.get(a.tokenId);
              if (cached === undefined) {
                requestNftImage(a.tokenId);
              } else {
                sprite = cached;
              }
              if (!sprite) {
                const spriteKey = a.spriteKey ?? MAP_NFT_SPRITE_KEYS[a.tokenId % MAP_NFT_SPRITE_KEYS.length];
                const spriteSheet = humanSpriteCacheRef.current.get(spriteKey);
                if (spriteSheet === undefined) {
                  requestHumanSprite(spriteKey);
                } else if (spriteSheet) {
                  sprite = spriteSheet;
                  usedHumanSprite = true;
                }
              }
            } else if (!sprite && a.spriteKey) {
              const spriteSheet = humanSpriteCacheRef.current.get(a.spriteKey);
              if (spriteSheet === undefined) {
                requestHumanSprite(a.spriteKey);
              } else if (spriteSheet) {
                sprite = spriteSheet;
                usedHumanSprite = true;
              }
            } else if (!sprite) {
              sprite =
              a.isMoving && a.walkFrames && a.walkFrames.length > 0
                ? a.walkFrames[(Math.floor(Date.now() / WALK_FRAME_INTERVAL_MS) + (a.walkOffset ?? 0)) % a.walkFrames.length]
                : a.img;
            }

            if (sprite && sprite.complete && sprite.naturalWidth > 0) {
              if (usedHumanSprite) {
                const direction = a.direction ?? 'down';
                const rowMap: Record<'down' | 'left' | 'right' | 'up', number> = { down: 0, left: 1, right: 2, up: 3 };
                const frameCycle = [0, 32, 64, 32];
                const standX = 32;
                const movingFrame = frameCycle[(Math.floor(Date.now() / WALK_FRAME_INTERVAL_MS) + (a.walkOffset ?? 0)) % frameCycle.length];
                const sx = a.isMoving ? movingFrame : standX;
                const sy = rowMap[direction] * 32;
                const spriteScale = tilePxW * 0.96;
                const spriteOffsetX = (tilePxW - spriteScale) / 2;
                const spriteOffsetY = tilePxH * 0.02;
                ctx.drawImage(sprite, sx, sy, 32, 32, px + spriteOffsetX, drawPy + spriteOffsetY, spriteScale, spriteScale);
                drawBoxX = px + spriteOffsetX;
                drawBoxY = drawPy + spriteOffsetY;
                drawBoxW = spriteScale;
                drawBoxH = spriteScale;
              } else {
                const yOffset = a.source === 'nft' ? tilePxH * 0.08 : 0;
                ctx.drawImage(sprite, px + offsetX, drawPy + yOffset, size, size);
                drawBoxX = px + offsetX;
                drawBoxY = drawPy + yOffset;
                drawBoxW = size;
                drawBoxH = size;
              }
            } else if (a.source === 'nft' && a.tokenId !== undefined) {
              const r = (a.tokenId * 37) % 255;
              const g = (a.tokenId * 73) % 255;
              const b = (a.tokenId * 131) % 255;
              ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
              ctx.fillRect(px + offsetX + size * 0.1, drawPy + tilePxH * 0.2, size * 0.8, size * 0.62);
              ctx.fillStyle = '#173225';
              ctx.font = `${Math.max(8, 7 * effectiveScale)}px "Press Start 2P", cursive`;
              ctx.textAlign = 'center';
              ctx.fillText(String(a.tokenId), px + tilePxW / 2, drawPy + tilePxH * 0.7);
              drawBoxX = px + offsetX + size * 0.1;
              drawBoxY = drawPy + tilePxH * 0.2;
              drawBoxW = size * 0.8;
              drawBoxH = size * 0.62;
            } else {
              ctx.fillStyle = '#b21f1f';
              ctx.fillRect(px + offsetX, drawPy, size, size);
              drawBoxX = px + offsetX;
              drawBoxY = drawPy;
              drawBoxW = size;
              drawBoxH = size;
            }
          }

          if (isSelected || isHovered) {
            ctx.strokeStyle = isSelected ? '#ffd25b' : '#9ddf67';
            ctx.lineWidth = Math.max(1.5, 2 * effectiveScale);
            ctx.strokeRect(drawBoxX, drawBoxY, drawBoxW, drawBoxH);
          }
          if (isGraphFocused || isGraphNeighbor) {
            ctx.strokeStyle = isGraphFocused ? 'rgba(108, 230, 255, 0.96)' : 'rgba(255, 214, 96, 0.86)';
            ctx.lineWidth = Math.max(1.2, 1.8 * effectiveScale);
            ctx.strokeRect(drawBoxX - 2, drawBoxY - 2, drawBoxW + 4, drawBoxH + 4);
          }
          if (isControlled) {
            ctx.strokeStyle = 'rgba(108, 230, 255, 0.95)';
            ctx.lineWidth = Math.max(1.6, 2.2 * effectiveScale);
            ctx.strokeRect(drawBoxX - 1, drawBoxY - 1, drawBoxW + 2, drawBoxH + 2);
            const badge = t('玩家', 'YOU');
            ctx.font = `${Math.max(8, 7 * effectiveScale)}px "Press Start 2P", cursive`;
            const badgeW = ctx.measureText(badge).width + (8 * effectiveScale);
            const badgeH = 12 * effectiveScale;
            const badgeX = px + (tilePxW / 2) - (badgeW / 2);
            const badgeY = drawPy - (8 * effectiveScale);
            ctx.fillStyle = 'rgba(14, 34, 36, 0.88)';
            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
            ctx.strokeStyle = 'rgba(108, 230, 255, 0.92)';
            ctx.lineWidth = Math.max(1, 1.3 * effectiveScale);
            ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#d9fff8';
            ctx.fillText(badge, px + tilePxW / 2, badgeY + badgeH - (3 * effectiveScale));
          }
          if (a.guestMeta) {
            ctx.strokeStyle = guestAccentColor;
            ctx.lineWidth = Math.max(1.4, 2 * effectiveScale);
            ctx.strokeRect(drawBoxX - 1, drawBoxY - 1, drawBoxW + 2, drawBoxH + 2);
            const badge = t('嘉宾', 'GUEST');
            ctx.font = `${Math.max(7, 6.5 * effectiveScale)}px "Press Start 2P", cursive`;
            const badgeW = ctx.measureText(badge).width + (8 * effectiveScale);
            const badgeH = 11 * effectiveScale;
            const badgeX = px + (tilePxW / 2) - (badgeW / 2);
            const badgeY = drawPy - (18 * effectiveScale);
            ctx.fillStyle = 'rgba(25, 19, 14, 0.86)';
            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
            ctx.strokeStyle = guestAccentColor;
            ctx.lineWidth = Math.max(1, 1.15 * effectiveScale);
            ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
            ctx.fillStyle = '#fff3dc';
            ctx.fillText(badge, px + tilePxW / 2, badgeY + badgeH - (3 * effectiveScale));
          }

          const shouldShowName = a.source !== 'nft' || isSelected || isHovered || Boolean(a.guestMeta);
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

          if (graphProjection && (isSelected || isHovered || isGraphFocused)) {
            const badgeText = `${graphProjection.badgeLabel} · ${graphProjection.statusLabel}`;
            ctx.font = `${Math.max(7, 6.5 * effectiveScale)}px "Press Start 2P", cursive`;
            const badgeWidth = ctx.measureText(badgeText).width + (10 * effectiveScale);
            const badgeHeight = 12 * effectiveScale;
            const badgeX = px + (tilePxW * 0.5) - (badgeWidth * 0.5);
            const badgeY = drawPy + tilePxH + (17 * effectiveScale);
            ctx.fillStyle = 'rgba(14, 24, 21, 0.84)';
            ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
            ctx.strokeStyle = graphMotionColor;
            ctx.lineWidth = Math.max(1, 1.15 * effectiveScale);
            ctx.strokeRect(badgeX, badgeY, badgeWidth, badgeHeight);
            ctx.fillStyle = '#f6ffec';
            ctx.fillText(badgeText, px + tilePxW / 2, badgeY + badgeHeight - (3 * effectiveScale));
          }

          const projectedThought = graphProjection && (isSelected || isHovered || isGraphFocused)
            ? graphProjection.thoughtLabel
            : '';
          const bubbleText = a.thought || projectedThought;
          if (bubbleText) {
            ctx.font = `${Math.max(10, 10 * effectiveScale)}px "Press Start 2P", cursive`;
            const bubbleY = drawPy - (10 * effectiveScale);
            const padding = 8 * effectiveScale;
            const metrics = ctx.measureText(bubbleText);
            const bw = metrics.width + (padding * 2);
            const bh = 20 * effectiveScale;

            ctx.fillStyle = '#fff';
            ctx.fillRect(px + tilePxW / 2 - bw / 2, bubbleY - bh, bw, bh);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + tilePxW / 2 - bw / 2, bubbleY - bh, bw, bh);
            ctx.fillStyle = '#000';
            ctx.fillText(bubbleText, px + tilePxW / 2, bubbleY - (bh / 2) + (5 * effectiveScale));
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

  }, [map, dims, renderLayers, effectiveScale, selectedAgentId, hoveredAgentId, placementTokenId, mapExpansionDecorations, mapExpansionLandmarks, mapExpansionLandmarkOpen, selectedLandmark, isTestMap, infiniteExploreEnabled, infiniteBiome, playModeEnabled, controlledAgentId, mapPlayerAvatar, t, miroFishProjectionVersion, bnbActionBriefFocus, actionBriefFocusAt, activeSkillsMission, activeSkillsMissionFocus]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const appWindow = window as Window & typeof globalThis & {
      render_game_to_text?: () => string;
      advanceTime?: (ms: number) => string;
    };
    const renderMapToText = () => {
      const activeMap = map;
      const wrap = canvasWrapRef.current;
      const graphAgents = agentsRef.current
        .filter((agent) => agent.id.startsWith('graph_'))
        .slice(0, 18)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          x: round1(agent.tx),
          y: round1(agent.ty),
          selected: agent.id === selectedAgentId,
          hovered: agent.id === hoveredAgentId,
          projection: agent.miroFishProjection
            ? {
              badge: agent.miroFishProjection.badgeLabel,
              status: agent.miroFishProjection.statusLabel,
              motion: agent.miroFishProjection.motion,
            }
            : null,
        }));
      return JSON.stringify({
        screen: 'village-map',
        selectedAgentId,
        hoveredAgentId,
        agentCount: agentsRef.current.length,
        viewport: activeMap ? {
          tileWidth: activeMap.tilewidth,
          tileHeight: activeMap.tileheight,
          scale: effectiveScale,
          scrollLeft: wrap ? Math.floor(wrap.scrollLeft) : 0,
          scrollTop: wrap ? Math.floor(wrap.scrollTop) : 0,
        } : null,
        market: marketPulse
          ? {
            regime: marketPulse.regime,
            headline: marketPulseHeadline,
            heatScore: marketPulse.heatScore,
            riskScore: marketPulse.riskScore,
            updatedAt: marketPulse.updatedAt,
            assets: marketPulse.assets.map((asset) => ({
              symbol: asset.symbol,
              changePct: round1(asset.changePct),
              lastPrice: round1(asset.lastPrice),
            })),
          }
          : {
            loading: marketPulseLoading,
            error: marketPulseError,
          },
        chain: chainPulse
          ? {
            mode: chainPulse.mode,
            headline: chainPulseHeadline,
            activityScore: chainPulse.activityScore,
            pressureScore: chainPulse.pressureScore,
            updatedAt: chainPulse.updatedAt,
            networks: chainPulse.networks.map((network) => ({
              key: network.key,
              blockNumber: network.blockNumber,
              gasGwei: round1(network.gasGwei),
              blockAgeSec: round1(network.blockAgeSec),
              txCount: network.txCount,
            })),
          }
          : {
            loading: chainPulseLoading,
            error: chainPulseError,
          },
        worldEvent: {
          id: bnbWorldEvent.id,
          title: bnbWorldEventTitle,
          detail: bnbWorldEventDetail,
          tone: bnbWorldEvent.tone,
          questRewardMultiplier: bnbWorldEvent.questRewardMultiplier,
          questProgressBonus: bnbWorldEvent.questProgressBonus,
          lootCountTarget: mapPlayLootTargetCount,
          enemyCountTarget: mapRpgEnemyTargetCount,
          npcSpeedMultiplier: bnbWorldEvent.npcSpeedMultiplier,
        },
        actionBrief: {
          title: bnbActionBriefTitle,
          network: bnbActionBriefNetwork,
          zone: bnbActionBriefZone,
          action: bnbActionBriefAction,
          risk: bnbActionBriefRisk,
          note: bnbActionBriefNote,
          taskExpanded: actionBriefTaskExpanded,
          taskPlan: bnbActionTaskPlan,
          focus: bnbActionBriefFocus
            ? {
              key: bnbActionBriefFocus.key,
              label: bnbActionBriefFocus.label,
              x: round1(bnbActionBriefFocus.tx),
              y: round1(bnbActionBriefFocus.ty),
              bounds: {
                minTx: bnbActionBriefFocus.minTx,
                maxTx: bnbActionBriefFocus.maxTx,
                minTy: bnbActionBriefFocus.minTy,
                maxTy: bnbActionBriefFocus.maxTy,
              },
              anchorKind: bnbActionBriefFocus.anchorKind,
              lastFocusedAt: actionBriefFocusAt,
            }
            : null,
        },
        npcLiveChat: {
          mode: bscLiveChatMode,
          summary: bscLiveChatSummary,
          count: bscLiveChatMessages.length,
          latest: bscLiveChatMessages.slice(-5).map((item) => ({
            speaker: item.speaker,
            role: item.role,
            text: item.text,
            tone: item.tone,
            createdAt: item.createdAt,
            source: item.source ?? 'fallback',
          })),
        },
        selectedNpcChat: selectedAgent
          ? {
            agentId: selectedAgent.id,
            agentName: selectedAgent.name,
            pending: npcChatPending,
            error: npcChatError,
            turns: selectedNpcChatTurns.slice(-8).map((item) => ({
              role: item.role,
              text: item.text,
              source: item.source ?? 'fallback',
              createdAt: item.createdAt,
            })),
          }
          : null,
        guestDock: {
          count: guestAgentCount,
          configs: guestAgentConfigs.map((item) => ({
            id: item.id,
            name: item.name,
            title: item.title,
            topic: item.topic,
            zone: item.zoneLabel,
            enabled: item.enabled,
          })),
          activeAgents: agentsRef.current
            .filter((agent) => agent.source === 'guest')
            .map((agent) => ({
              id: agent.id,
              name: agent.name,
              title: agent.guestMeta?.title ?? agent.status,
              topic: agent.guestMeta?.topic ?? '',
              x: round1(agent.tx),
              y: round1(agent.ty),
            })),
        },
        skills: binanceSkillsPulse
          ? {
            updatedAt: binanceSkillsPulse.updatedAt,
            headline: binanceSkillsHeadline,
            detail: binanceSkillsDetail,
            alphaTop: binanceSkillsPulse.alphaTop,
            smartMoneyTop: binanceSkillsPulse.smartMoneyTop,
            socialTop: binanceSkillsPulse.socialTop,
            missions: skillsMissions.map((mission) => ({
              id: mission.id,
              title: mission.title,
              token: mission.token,
              zone: mission.zoneLabel,
              active: mission.id === activeSkillsMissionId,
            })),
            activeMission: activeSkillsMission
              ? {
                id: activeSkillsMission.id,
                title: activeSkillsMission.title,
                token: activeSkillsMission.token,
                zone: activeSkillsMission.zoneLabel,
                steps: activeSkillsMission.steps,
              }
              : null,
          }
          : {
            loading: binanceSkillsLoading,
            error: binanceSkillsError,
          },
        graph: {
          apiBase: miroFishApiBase,
          graphId: miroFishGraphId,
          simulationId: miroFishSimulationId,
          reportId: miroFishReportId,
          nodeCount: miroFishNodeCount,
          edgeCount: miroFishEdgeCount,
          selectedNode: selectedGraphMeta
            ? {
              nodeUuid: selectedGraphMeta.nodeUuid,
              labels: selectedGraphMeta.labels,
              inDegree: selectedGraphMeta.inDegree,
              outDegree: selectedGraphMeta.outDegree,
              neighborCount: selectedGraphNeighborCount,
              projection: selectedGraphProjection
                ? {
                  status: selectedGraphProjection.statusLabel,
                  role: selectedGraphProjection.roleLabel,
                  report: selectedGraphProjection.reportTitle,
                }
                : null,
            }
            : null,
          connections: selectedGraphConnections.map((connection) => ({
            edgeType: connection.edgeType,
            direction: connection.direction,
            target: connection.otherName,
          })),
          visibleAgents: graphAgents,
          simulation: miroFishSimulation
            ? {
              status: miroFishSimulation.status,
              entitiesCount: miroFishSimulation.entities_count,
              profilesCount: miroFishSimulation.profiles_count,
              profilePlatform: miroFishProfilePlatform,
              loadedProfiles: miroFishProfilesRealtime?.count ?? 0,
            }
            : null,
          runStatus: miroFishRunStatus
            ? {
              status: miroFishRunStatus.runner_status,
              currentRound: miroFishRunStatus.current_round,
              totalRounds: miroFishRunStatus.total_rounds,
              progress: miroFishRunStatus.progress_percent,
              actions: miroFishRunStatus.total_actions_count,
            }
            : null,
          report: miroFishReport
            ? {
              status: miroFishReport.status,
              reportId: miroFishReport.report_id,
              hasMarkdown: miroFishReport.markdown_content.length > 0,
            }
            : null,
          demoPreset: {
            label: MIROFISH_SMOKE_DEMO_PRESET.label,
            projectId: MIROFISH_SMOKE_DEMO_PRESET.projectId,
            graphId: MIROFISH_SMOKE_DEMO_PRESET.graphId,
            simulationId: MIROFISH_SMOKE_DEMO_PRESET.simulationId,
            reportId: MIROFISH_SMOKE_DEMO_PRESET.reportId,
          },
        },
      });
    };
    appWindow.render_game_to_text = renderMapToText;
    const previousAdvanceTime = appWindow.advanceTime;
    if (typeof appWindow.advanceTime !== 'function') {
      appWindow.advanceTime = () => renderMapToText();
    }
    return () => {
      if (appWindow.render_game_to_text === renderMapToText) delete appWindow.render_game_to_text;
      if (appWindow.advanceTime && appWindow.advanceTime !== previousAdvanceTime) {
        if (previousAdvanceTime) {
          appWindow.advanceTime = previousAdvanceTime;
        } else {
          delete appWindow.advanceTime;
        }
      }
    };
  }, [
    hoveredAgentId,
    map,
    marketPulse,
    chainPulse,
    chainPulseError,
    chainPulseHeadline,
    chainPulseLoading,
    marketPulseError,
    marketPulseHeadline,
    marketPulseLoading,
    miroFishApiBase,
    miroFishEdgeCount,
    miroFishGraphId,
    miroFishProfilePlatform,
    miroFishProfilesRealtime?.count,
    miroFishReport?.markdown_content,
    miroFishReport?.report_id,
    miroFishReport?.status,
    miroFishReportId,
    miroFishRunStatus?.current_round,
    miroFishRunStatus?.progress_percent,
    miroFishRunStatus?.runner_status,
    miroFishRunStatus?.total_actions_count,
    miroFishRunStatus?.total_rounds,
    miroFishNodeCount,
    miroFishSimulation?.entities_count,
    miroFishSimulation?.profiles_count,
    miroFishSimulation?.status,
    miroFishSimulationId,
    effectiveScale,
    bnbWorldEvent.id,
    bnbWorldEvent.tone,
    bnbWorldEvent.questRewardMultiplier,
    bnbWorldEvent.questProgressBonus,
    bnbWorldEvent.npcSpeedMultiplier,
    bnbWorldEventDetail,
    bnbWorldEventTitle,
    bnbActionBriefAction,
    bnbActionBriefNetwork,
    bnbActionBriefNote,
    bnbActionBriefRisk,
    bnbActionTaskPlan,
    actionBriefTaskExpanded,
    bnbActionBriefTitle,
    bnbActionBriefZone,
    bnbActionBriefFocus,
    actionBriefFocusAt,
    bscLiveChatMessages,
    bscLiveChatMode,
    npcChatPending,
    npcChatError,
    selectedNpcChatTurns,
    bscLiveChatSummary,
    activeSkillsMission,
    activeSkillsMissionId,
    binanceSkillsDetail,
    binanceSkillsError,
    binanceSkillsHeadline,
    binanceSkillsLoading,
    binanceSkillsPulse,
    guestAgentConfigs,
    guestAgentCount,
    skillsMissions,
    mapPlayLootTargetCount,
    mapRpgEnemyTargetCount,
    selectedAgentId,
    selectedGraphConnections,
    selectedGraphMeta,
    selectedGraphNeighborCount,
    selectedGraphProjection,
    miroFishProjectionVersion,
  ]);

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
    const msg = `${t('AI 市场扩张完成，已解锁新区', 'AI market expansion complete. New district unlocked')} Lv.${mapExpansion.level} · ${zoneText} · ${t('地标', 'Landmark')}: ${landmarkText}`;
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
        thought: t('新区解锁，继续向外扩张！', 'District unlocked, keep expanding outward!'),
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
    if (isTestMap) return;
    const quest = mapAdventure.activeQuest;
    if (!quest) return;
    if (quest.progress < quest.target) return;
    if (adventureQuestCompletionRef.current === quest.id) return;
    adventureQuestCompletionRef.current = quest.id;
    const biomeRewardBonus = quest.biome === 'any' ? 0 : 12;
    const rewardProgressTotal = Math.max(8, Math.round(quest.rewardProgress + biomeRewardBonus + bnbWorldEvent.questProgressBonus));
    const rewardPointsTotal = Math.max(10, Math.round((quest.rewardPoints + (quest.biome === 'any' ? 0 : 16)) * bnbWorldEvent.questRewardMultiplier));

    setMapExpansion((prev) => {
      const maxLevel = MAP_EXPANSION_STAGES.length;
      if (prev.level >= maxLevel) return prev;
      const need = MAP_EXPANSION_STAGES[Math.max(0, prev.level - 1)].need;
      return {
        ...prev,
        progress: Math.min(need, prev.progress + rewardProgressTotal),
      };
    });
    setMapPlayStats((prev) => ({ ...prev, score: prev.score + rewardPointsTotal }));
    setMapFarmGame((prev) => ({
      ...prev,
      townPoints: prev.townPoints + rewardPointsTotal,
      stats: {
        ...prev.stats,
        socialActions: prev.stats.socialActions + 1,
      },
      economy: {
        ...prev.economy,
        minted: prev.economy.minted + rewardPointsTotal,
      },
    }));
    setMapExpansionPulseActive(true);
    pushFarmFx(`${t('Alpha 任务完成', 'Alpha quest done')} +${rewardPointsTotal} ${t('活跃点', 'Points')}`, 'quest');
    setAgentPanelNotice(
      t(
        `Alpha 任务完成：${adventureQuestLabel(quest.type)} · ${adventureBiomeLabel(quest.biome)}（+${rewardProgressTotal} 市场扩张） · ${bnbWorldEvent.titleZh}`,
        `Alpha quest complete: ${adventureQuestLabel(quest.type)} · ${adventureBiomeLabel(quest.biome)} (+${rewardProgressTotal} market expansion) · ${bnbWorldEvent.titleEn}`,
      ),
    );
    setMapAdventure((prev) => {
      if (!prev.activeQuest || prev.activeQuest.id !== quest.id) return prev;
      const nextCompletedCount = prev.completedCount + 1;
      return {
        ...prev,
        completedCount: nextCompletedCount,
        activeQuest: createMapAdventureQuest(
          nextCompletedCount,
          infiniteRegionRef.current.x,
          infiniteRegionRef.current.y,
        ),
      };
    });
  }, [bnbWorldEvent.questProgressBonus, bnbWorldEvent.questRewardMultiplier, bnbWorldEvent.titleEn, bnbWorldEvent.titleZh, mapAdventure.activeQuest, isTestMap, t]);

  useEffect(() => {
    if (!mapExpansionMissionProgress || mapExpansionMissionProgress.done) return;
    if (mapExpansion.level >= mapExpansionMaxLevel) return;
    if (mapExpansion.progress < mapExpansionNeed) return;
    const now = Date.now();
    if ((now - mapExpansionMissionHintAtRef.current) < 12_000) return;
    mapExpansionMissionHintAtRef.current = now;
    const mission = mapExpansionMissionProgress.mission;
    const msg = t(
      `市场扩张待命：${mission.titleZh}（${mapExpansionMissionProgress.statusTextZh}） · ${mapExpansionMissionProgress.unmetHintZh}`,
      `Market expansion waiting: ${mission.titleEn} (${mapExpansionMissionProgress.statusTextEn}) · ${mapExpansionMissionProgress.unmetHintEn}`,
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
    if (isTestMap || playModeEnabled) return;
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
  }, [isTestMap, placeMode, playModeEnabled]);

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

  const mapLoadingText = mapLoadingStage === 'fetch'
    ? t('正在加载地图数据...', 'Loading map data...')
    : mapLoadingStage === 'tilesets'
      ? t('正在加载地形贴图...', 'Loading terrain tiles...')
      : t('正在构建场景...', 'Building world scene...');

  if (!map || !dims) {
    return (
      <div className="village-shell">
        <div className="village-inner">
          <div className="village-map-loading-screen ga-card-surface" role="status" aria-live="polite" aria-busy="true">
            <div className="village-map-loading-title">{t('Binance AI Town 地图加载中', 'Binance AI Town map loading')}</div>
            <div className="village-map-loading-subtitle">{mapLoadingText}</div>
            <div className="village-map-loading-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="village-shell">
      <div className="village-inner">
        {!isTestMap ? (
          <div className="village-header-card ga-card-surface">
            <div className="village-header-left">
              <span className="village-live-dot" />
              <span>LIVE MARKET</span>
              <span className="village-header-divider">/</span>
              <span>ALPHA MAP</span>
              <span className="village-header-divider">/</span>
              <span>{t('Binance AI Town', 'Binance AI Town')}</span>
            </div>
            <div className="village-header-actions">
              <div className="village-population">POP: {agentCount || '...'}</div>
              <div className={`village-market-chip ${marketPulse ? `is-${marketPulse.regime}` : 'is-idle'}`}>
                {marketPulseHeadline}
              </div>
              <div className={`village-market-chip ${chainPulse ? `is-${chainPulse.mode}` : 'is-idle'}`}>
                {chainPulseHeadline}
              </div>
              <div className={`village-terminal-ticker ${marketPulse ? `is-${marketPulse.regime}` : 'is-idle'}`} aria-label="BNB terminal ticker">
                <div className="village-terminal-ticker-main">
                  <span className="village-terminal-symbol">BNBUSDT</span>
                  <strong>{marketPulseBnbPriceText}</strong>
                  <em>{marketPulseBnbAsset ? formatSignedPercent(marketPulseBnbAsset.changePct) : '--'}</em>
                </div>
                <span className="village-terminal-divider" />
                <div className="village-terminal-field">
                  <span>24H</span>
                  <strong>{marketPulseBnbAsset ? formatSignedPercent(marketPulseBnbAsset.changePct) : '--'}</strong>
                </div>
                <div className="village-terminal-field">
                  <span>{t('量', 'VOL')}</span>
                  <strong>{marketPulseBnbVolumeText}</strong>
                </div>
                <div className="village-terminal-field">
                  <span>BSC GAS</span>
                  <strong>{chainPulseBscGasText}</strong>
                </div>
                <div className="village-terminal-field">
                  <span>BSC BLK</span>
                  <strong>{chainPulseBscBlockText}</strong>
                </div>
                <div className="village-terminal-field">
                  <span>BSC AGE</span>
                  <strong>{chainPulseBscAgeText}</strong>
                </div>
                <div className="village-terminal-field">
                  <span>{t('模式', 'MODE')}</span>
                  <strong>{chainPulseModeText}</strong>
                </div>
                <div className="village-terminal-field">
                  <span>{t('技能', 'SKILLS')}</span>
                  <strong>{binanceSkillsPulse?.alphaTop?.symbol ?? '--'}</strong>
                </div>
              </div>
              <button
                type="button"
                className={`village-header-btn ${playModeEnabled ? 'active' : ''}`}
                onClick={() => setPlayModeEnabled((prev) => !prev)}
              >
                {playModeEnabled ? t('暂停操控', 'Pause') : t('开始操控', 'Play')}
              </button>
              <button type="button" className="village-header-btn" onClick={resetMapPlayChallenge}>
                {t('重开', 'Reset')}
              </button>
              <button
                type="button"
                className={`village-header-btn ${showAdvancedPanels ? 'active' : ''}`}
                onClick={() => setShowAdvancedPanels((prev) => !prev)}
              >
                {showAdvancedPanels ? t('收起面板', 'Hide Panels') : t('高级面板', 'Advanced')}
              </button>
              <button
                type="button"
                className={`village-header-btn ${infiniteExploreEnabled ? 'active' : ''}`}
                onClick={() => setInfiniteExploreEnabled((prev) => !prev)}
              >
                {infiniteExploreEnabled ? t('无限探索开', 'Infinite ON') : t('无限探索关', 'Infinite OFF')}
              </button>
            </div>
          </div>
        ) : null}

        {!isTestMap && showAdvancedPanels && advancedWorkbenchOpen ? (
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

        {!isTestMap && showAdvancedPanels ? (
          <div className={`village-control-grid ${advancedWorkbenchOpen ? 'expert-open' : 'simple-open'}`}>
            <div className="village-config-card ga-card-surface">
              {advancedWorkbenchOpen ? (
                <SettingsPanel
                  settings={settings}
                  onChange={(next) => {
                    setSettings(next);
                    setScale(next.ui.scale);
                    setLayerName(next.ui.layerMode);
                  }}
                  onResetWorld={() => {
                    removeFromStorage(MAP_WORLD_SAVE_STORAGE_KEY);
                    removeFromStorage(MAP_WORLD_SAVE_TEST_STORAGE_KEY);
                    removeFromStorage(STORAGE_KEYS.world);
                  }}
                  onClearKey={() => {
                    const next = { ...settings, llm: { ...settings.llm, apiKey: '' } };
                    setSettings(next);
                  }}
                />
              ) : (
                <div className="village-simple-guide-card">
                <div className="village-agent-selected-title">{t('简洁模式', 'Simple Mode')}</div>
                  <div className="village-expansion-mission-title">{t('先看 BNB，再按需展开专业工具。', 'Start with BNB, then open expert tools only when you need them.')}</div>
                  <div className="village-expansion-mission-hint">
                    {`${t('当前摘要', 'Current brief')}: ${bnbWorldHeadline} · ${t('当前分区', 'Zone')}: ${mapExpansionZone.label}`}
                  </div>
                </div>
              )}
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

        {!isTestMap && showAdvancedPanels ? (
          <div className="village-agent-control-card ga-card-surface">
            <div className="village-agent-control-title">MARKET OPS / BNB-578</div>
            <div className="village-agent-control-toolbar">
              <div className="village-agent-control-subtitle">
                {t('默认只显示核心行情和任务，复杂联动工具已收起。', 'Core market and quest data stay visible by default; heavier linkage tools are folded away.')}
              </div>
              <button
                type="button"
                className={`village-agent-btn ${advancedWorkbenchOpen ? 'active' : ''}`}
                onClick={() => setAdvancedWorkbenchOpen((prev) => !prev)}
              >
                {advancedWorkbenchOpen ? t('收起专业工具', 'Hide Expert Tools') : t('展开专业工具', 'Show Expert Tools')}
              </button>
            </div>
            <div className={`village-agent-control-grid ${advancedWorkbenchOpen ? 'expert-open' : 'simple-open'}`}>
              <div className="village-agent-stat-row">
                <span>{t('地图 Agent', 'Map Agents')}</span>
                <strong>{agentCount}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('NFT Agent', 'NFT Agents')}</span>
                <strong>{nftAgentCount}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('我的 NFT', 'Owned NFTs')}</span>
                <strong>{ownedTokens.length}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('操控角色', 'Controlled')}</span>
                <strong>{controlledAgent ? (controlledAgent.tokenId !== undefined ? `#${controlledAgent.tokenId}` : controlledAgent.name) : '--'}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('区域坐标', 'Region')}</span>
                <strong>{`${infiniteRegion.x}, ${infiniteRegion.y}`}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('当前地貌', 'Biome')}</span>
                <strong>{infiniteBiomeLabel}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('当前季节', 'Season')}</span>
                <strong>{infiniteSeasonLabel}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('市场脉冲', 'Market Pulse')}</span>
                <strong>{marketPulseRegimeText}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('链上模式', 'Chain Mode')}</span>
                <strong>{chainPulseModeText}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('领涨币对', 'Lead Pair')}</span>
                <strong>{marketPulseLeadText}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>BNB Vol</span>
                <strong>{marketPulseBnbVolumeText}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>BSC Gas</span>
                <strong>{chainPulseBscGasText}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>BSC Load</span>
                <strong>{chainPulseBscLoadText}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('市场热度', 'Market Heat')}</span>
                <strong>{marketPulse ? `${Math.round(marketPulse.heatScore)}/100` : '--'}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('链上活跃', 'Chain Activity')}</span>
                <strong>{chainPulse ? `${Math.round(chainPulse.activityScore)}/100` : '--'}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('链上压力', 'Chain Pressure')}</span>
                <strong>{chainPulse ? `${Math.round(chainPulse.pressureScore)}/100` : '--'}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('Skills Alpha', 'Skills Alpha')}</span>
                <strong>{binanceSkillsPulse?.alphaTop?.symbol ?? '--'}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('聪明钱', 'Smart Money')}</span>
                <strong>{binanceSkillsPulse?.smartMoneyTop?.symbol ?? '--'}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('世界事件', 'World Event')}</span>
                <strong>{bnbWorldEventTitle}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('推荐区域', 'Suggested Zone')}</span>
                <strong>{bnbActionBriefZone}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('当前风险', 'Risk')}</span>
                <strong>{bnbActionBriefRisk}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('任务倍率', 'Quest Boost')}</span>
                <strong>{`${Math.round(bnbWorldEvent.questRewardMultiplier * 100)}% / ${bnbWorldEvent.questProgressBonus >= 0 ? '+' : ''}${bnbWorldEvent.questProgressBonus}`}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('探索分数', 'Play Score')}</span>
                <strong>{mapPlayStats.score}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('历史最高', 'Best Score')}</span>
                <strong>{mapPlayHighScore}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('冲刺体力', 'Sprint Energy')}</span>
                <strong>{`${Math.round(playSprintEnergyUi)}%`}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('当前连击', 'Combo')}</span>
                <strong>{mapPlayComboActive ? `x${mapPlayStats.combo}` : 'x0'}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('最高连击', 'Best Combo')}</span>
                <strong>{`x${mapPlayStats.bestCombo}`}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('互动任务', 'Talk Quest')}</span>
                <strong>{`${mapPlayTalkProgress}/${MAP_PLAY_TALK_TARGET}`}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('信号收集', 'Signal Quest')}</span>
                <strong>{`${mapPlayLootProgress}/${MAP_PLAY_LOOT_TARGET}`}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('剩余补给', 'Supplies Left')}</span>
                <strong>{mapPlayLootRemaining}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('扩建等级', 'Expansion Lv')}</span>
                <strong>{`Lv.${mapExpansion.level}/${mapExpansionMaxLevel}`}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('扩建进度', 'Expansion Progress')}</span>
                <strong>{mapExpansion.level >= mapExpansionMaxLevel ? t('已满级', 'MAX') : `${mapExpansionProgressPct}%`}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('已解锁区域', 'Unlocked Area')}</span>
                <strong>{`${mapExpansionUnlockedPct}%`}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('当前分区', 'Current Zone')}</span>
                <strong>{mapExpansionZone.label}</strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('最近扩建', 'Last Unlock')}</span>
                <strong>{mapExpansionLastUpgradeText}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('市场扩张', 'Market Expansion')}</span>
                <strong>
                  {mapExpansionMissionProgress
                    ? `${mapExpansionMissionProgress.done ? t('完成', 'Done') : t('进行中', 'Ongoing')} ${t(mapExpansionMissionProgress.statusTextZh, mapExpansionMissionProgress.statusTextEn)}`
                    : t('无', 'N/A')}
                </strong>
              </div>
              <div className="village-agent-stat-row expert-only">
                <span>{t('已解锁地标', 'Landmarks')}</span>
                <strong>{`${mapExpansionLandmarks.length}/${MAP_EXPANSION_LANDMARKS.length}`}</strong>
              </div>
              <div className="village-agent-stat-row">
                <span>{t('当前地标', 'Current Landmark')}</span>
                <strong>{mapExpansionCurrentLandmark ? t(mapExpansionCurrentLandmark.nameZh, mapExpansionCurrentLandmark.nameEn) : '--'}</strong>
              </div>
              <div className="village-expansion-mission-card">
                <div className="village-agent-selected-title">{t('Binance 行情源', 'Binance Market Feed')}</div>
                <div className="village-expansion-mission-title">{marketPulseHeadline}</div>
                <div className="village-expansion-mission-hint">
                  {marketPulseError
                    ? `${t('状态', 'Status')}: ${t('异常', 'Error')} · ${marketPulseError}`
                    : `${t('状态', 'Status')}: ${marketPulseLoading && !marketPulse ? t('加载中', 'Loading') : t('在线', 'Live')} · BTC ${marketPulseBtcPriceText} · ${t('高低', 'Hi/Lo')}: ${marketPulseBnbHighText} / ${marketPulseBnbLowText}`}
                </div>
              </div>
              <div className="village-expansion-mission-card">
                <div className="village-agent-selected-title">{t('BSC 链路', 'BSC Pulse')}</div>
                <div className="village-expansion-mission-title">{chainPulseHeadline}</div>
                <div className="village-expansion-mission-hint">
                  {chainPulseError
                    ? `${t('状态', 'Status')}: ${t('异常', 'Error')} · ${chainPulseError}`
                    : `${t('状态', 'Status')}: ${chainPulseLoading && !chainPulse ? t('加载中', 'Loading') : t('在线', 'Live')} · BSC ${chainPulseBscBlockText} · ${chainPulseBscLoadText}`}
                </div>
              </div>
              <button
                type="button"
                className={`village-expansion-mission-card village-expansion-mission-card-btn ${actionBriefTaskExpanded ? 'is-expanded' : ''}`}
                onClick={handleFocusActionBriefZone}
                disabled={!bnbActionBriefFocus}
              >
                <div className="village-agent-selected-title">{t('BNB 行动建议', 'BNB Action Brief')}</div>
                <div className="village-expansion-mission-title">{`${bnbActionBriefTitle} · ${bnbActionBriefZone}`}</div>
                <div className="village-expansion-mission-hint">
                  {`${t('网络', 'Network')}: ${bnbActionBriefNetwork} · ${t('风险', 'Risk')}: ${bnbActionBriefRisk} · ${bnbActionBriefAction} · ${bnbActionBriefNote}`}
                </div>
                <div className="village-expansion-mission-cta">
                  <span>{t('点击定位推荐区域', 'Click to focus suggested zone')}</span>
                  <strong>{bnbActionBriefFocus?.anchorKind === 'landmark' ? t('地标锚点', 'Landmark Anchor') : t('区域中心', 'District Center')}</strong>
                </div>
                {actionBriefTaskExpanded ? (
                  <div className="village-action-brief-route">
                    <div className="village-action-brief-route-title">{bnbActionTaskPlan.title}</div>
                    <div className="village-action-brief-route-subtitle">{bnbActionTaskPlan.subtitle}</div>
                    <div className="village-action-brief-route-steps">
                      {bnbActionTaskPlan.steps.map((step, index) => (
                        <div key={`brief-step-${index}`} className="village-action-brief-route-step">
                          <span>{index + 1}</span>
                          <strong>{step}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="village-action-brief-route-note">{bnbActionTaskPlan.note}</div>
                  </div>
                ) : null}
              </button>
              <div className="village-expansion-mission-card">
                <div className="village-agent-selected-title">{t('Binance Skills 情报', 'Binance Skills Watch')}</div>
                <div className="village-expansion-mission-title">{binanceSkillsHeadline}</div>
                <div className="village-expansion-mission-hint">{binanceSkillsDetail}</div>
              </div>
              {skillsMissions.length > 0 ? (
                <div className="village-expansion-mission-card">
                  <div className="village-agent-selected-title">{t('Skills 任务', 'Skills Missions')}</div>
                  <div className="village-skills-missions">
                    {skillsMissions.map((mission) => {
                      const expanded = activeSkillsMissionId === mission.id;
                      return (
                        <button
                          key={`skills-mission-${mission.id}`}
                          type="button"
                          className={`village-expansion-mission-card village-expansion-mission-card-btn village-skills-mission-btn is-${mission.tone} ${expanded ? 'is-expanded' : ''}`}
                          onClick={() => handleActivateSkillsMission(mission)}
                          disabled={!mission.focus}
                        >
                          <div className="village-skills-mission-head">
                            <span className="village-skills-mission-title">{mission.title}</span>
                            <strong className="village-skills-mission-token">{mission.token}</strong>
                          </div>
                          <div className="village-expansion-mission-hint">{`${mission.subtitle} · ${t('区域', 'Zone')}: ${mission.zoneLabel}`}</div>
                          {expanded ? (
                            <div className="village-action-brief-route">
                              <div className="village-action-brief-route-title">{t('执行步骤', 'Execution Steps')}</div>
                              <div className="village-action-brief-route-steps">
                                {mission.steps.map((step, index) => (
                                  <div key={`skills-step-${mission.id}-${index}`} className="village-action-brief-route-step">
                                    <span>{index + 1}</span>
                                    <strong>{step}</strong>
                                  </div>
                                ))}
                              </div>
                              <div className="village-action-brief-route-note">{mission.note}</div>
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="village-expansion-mission-card">
                <div className="village-agent-selected-title">{t('嘉宾 NPC 接入', 'Guest NPC Dock')}</div>
                <div className="village-expansion-mission-title">
                  {guestAgentCount > 0
                    ? t(`当前已接入 ${guestAgentCount} 个嘉宾角色`, `${guestAgentCount} guest NPCs are live in town`)
                    : t('把第三方角色直接挂进地图里', 'Attach third-party characters directly into the map')}
                </div>
                <div className="village-expansion-mission-hint">
                  {t('支持一键接入“小龙虾”样例，或粘贴简短 JSON 导入嘉宾角色。导入后它们会自己巡游，并和附近 NPC 聊 BSC。', 'Use the one-click lobster preset or paste short JSON to import guest NPCs. Imported guests will roam automatically and talk about BSC with nearby NPCs.')}
                </div>
                <div className="village-guest-dock-actions">
                  <button type="button" className="village-agent-btn" onClick={handleAddLobsterGuestPreset}>
                    {t('接入小龙虾', 'Add Lobster Guest')}
                  </button>
                  <button type="button" className="village-agent-btn" onClick={handleResetGuestImportTemplate}>
                    {t('填入模板', 'Load Template')}
                  </button>
                  <button type="button" className="village-agent-btn" onClick={() => setGuestAgentConfigs([])} disabled={guestAgentConfigs.length === 0}>
                    {t('清空嘉宾', 'Clear Guests')}
                  </button>
                </div>
                <label className="village-guest-dock-editor">
                  <span>{t('嘉宾 JSON', 'Guest JSON')}</span>
                  <textarea
                    value={guestAgentImportText}
                    onChange={(event) => setGuestAgentImportText(event.target.value)}
                    placeholder={GUEST_AGENT_IMPORT_TEMPLATE}
                    rows={7}
                  />
                </label>
                <div className="village-guest-dock-actions">
                  <button type="button" className="village-agent-btn" onClick={handleImportGuestAgents}>
                    {t('导入到地图', 'Import to Map')}
                  </button>
                </div>
                {guestAgentConfigs.length > 0 ? (
                  <div className="village-guest-dock-list">
                    {guestAgentConfigs.map((guest) => (
                      <div key={guest.id} className="village-guest-dock-item">
                        <div>
                          <strong>{guest.name}</strong>
                          <span>{`${guest.title} · ${guest.zoneLabel}`}</span>
                          <em>{guest.topic}</em>
                        </div>
                        <div className="village-guest-dock-item-actions">
                          <button type="button" className="village-guest-dock-remove" onClick={() => handleFocusGuestAgent(guest.id)}>
                            {t('定位', 'Focus')}
                          </button>
                          <button type="button" className="village-guest-dock-remove" onClick={() => handleRemoveGuestAgent(guest.id)}>
                            {t('移除', 'Remove')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="village-expansion-mission-card">
                <div className="village-agent-selected-title">{t('世界事件', 'World Event')}</div>
                <div className="village-expansion-mission-title">{bnbWorldEventTitle}</div>
                <div className="village-expansion-mission-hint">
                  {`${bnbWorldEventDetail} · ${t('任务倍率', 'Quest Boost')} ${Math.round(bnbWorldEvent.questRewardMultiplier * 100)}% · ${t('补给目标', 'Supply Target')} ${mapPlayLootTargetCount}`}
                </div>
              </div>
              {mapExpansionMissionProgress ? (
                <div className="village-expansion-mission-card">
                  <div className="village-agent-selected-title">{t('市场目标', 'Market Objective')}</div>
                  <div className="village-expansion-mission-title">{t(mapExpansionMissionProgress.mission.titleZh, mapExpansionMissionProgress.mission.titleEn)}</div>
                  <div className="village-expansion-mission-hint">
                    {mapExpansionMissionProgress.done
                      ? t('条件已满足，扩建将自动推进。', 'Conditions met. Expansion will proceed automatically.')
                      : t(mapExpansionMissionProgress.unmetHintZh, mapExpansionMissionProgress.unmetHintEn)}
                  </div>
                </div>
              ) : null}
              {!isTestMap ? (
                <div className="village-expansion-mission-card">
                  <div className="village-agent-selected-title">{t('Alpha 任务', 'Alpha Task')}</div>
                  <div className="village-expansion-mission-title">{mapAdventure.activeQuest ? mapAdventureQuestText : '--'}</div>
                  <div className="village-expansion-mission-hint">
                    {`${mapAdventureQuestHint} · ${t('已发现分区', 'Sectors Found')} ${mapAdventureDiscoveredCount} · ${t('已完成任务', 'Completed')} ${mapAdventure.completedCount}`}
                  </div>
                </div>
              ) : null}

              <div className="village-agent-action-row">
                <button
                  type="button"
                  className="village-agent-btn"
                  onClick={resetMapPlayChallenge}
                >
                  {t('重置挑战', 'Reset Challenge')}
                </button>
                <button
                  type="button"
                  className={`village-agent-btn ${playModeEnabled ? 'active' : ''}`}
                  onClick={() => setPlayModeEnabled((prev) => !prev)}
                >
                  {playModeEnabled ? t('暂停操控', 'Pause Control') : t('开始操控', 'Start Control')}
                </button>
                <button
                  type="button"
                  className={`village-agent-btn ${advancedWorkbenchOpen ? 'active' : ''}`}
                  onClick={() => setAdvancedWorkbenchOpen((prev) => !prev)}
                >
                  {advancedWorkbenchOpen ? t('收起工具', 'Hide Tools') : t('更多工具', 'More Tools')}
                </button>
              </div>

              {advancedWorkbenchOpen ? (
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
              ) : null}

              {advancedWorkbenchOpen ? (
              <div className="village-agent-action-row">
                <button
                  type="button"
                  className="village-agent-btn"
                  onClick={resetMapPlayChallenge}
                >
                  {t('重置挑战', 'Reset Challenge')}
                </button>
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
                <button
                  type="button"
                  className="village-agent-btn"
                  onClick={() => {
                    if (!latestAgentActionLog) {
                      setAgentPanelNotice(t('暂无可校验凭证。', 'No proof available to verify.'));
                      return;
                    }
                    const result = verifyAgentActionLog(latestAgentActionLog);
                    if (result.state === 'verified') {
                      setAgentPanelNotice(t('最新凭证校验通过。', 'Latest proof verified.'));
                    } else if (result.state === 'missing') {
                      setAgentPanelNotice(t('旧记录缺少签名字段，无法完整校验。', 'Legacy record misses signature fields.'));
                    } else {
                      setAgentPanelNotice(t('凭证校验失败，请核对签名与哈希。', 'Proof verification failed. Check signature and hashes.'));
                    }
                  }}
                >
                  {t('校验凭证', 'Verify Proof')}
                </button>
                <button type="button" className="village-agent-btn" onClick={handleCopyLatestAgentProofHead}>
                  {t('复制头哈希', 'Copy Head Hash')}
                </button>
                <button type="button" className="village-agent-btn" onClick={handleExportAgentProofBundle}>
                  {t('导出凭证', 'Export Proof')}
                </button>
              </div>
              ) : null}

              <div className="village-agent-selected">
                <div className="village-agent-selected-title">{t('当前选中', 'Selected')}</div>
                {selectedAgent ? (
                  <>
                    <div>{selectedAgent.tokenId !== undefined ? `#${selectedAgent.tokenId}` : selectedAgent.name}</div>
                    <div>{t('位置', 'Position')}: ({round1(selectedAgent.tx)}, {round1(selectedAgent.ty)})</div>
                    <div>{`${t('行情输入', 'Market Input')}: ${marketPulseHeadline}`}</div>
                    {selectedGraphMeta ? (
                      <>
                        <div>{`UUID: ${selectedGraphMeta.nodeUuid}`}</div>
                        <div>{`${t('标签', 'Labels')}: ${selectedGraphMeta.labels.join(', ') || 'Entity'}`}</div>
                        <div>{`${t('关联节点', 'Neighbors')}: ${selectedGraphNeighborCount}`}</div>
                        <div>
                          {selectedGraphSimulationProfile
                            ? `${t('模拟映射', 'Simulation Match')}: #${selectedGraphSimulationProfile.index} · ${selectedGraphProfileDisplayName}`
                            : t('模拟映射: 未匹配，请刷新 Profiles。', 'Simulation Match: not mapped yet. Refresh profiles.')}
                        </div>
                        {selectedGraphProjection ? (
                          <>
                            <div>{`${t('投射状态', 'Projection')}: ${selectedGraphProjection.statusLabel}`}</div>
                            <div>{`${t('角色镜像', 'Role Lens')}: ${selectedGraphProjection.roleLabel} · ${selectedGraphProjection.badgeLabel}`}</div>
                            <div>{`${t('报告线索', 'Report Lens')}: ${selectedGraphProjection.reportLabel}`}</div>
                            {selectedGraphInterview ? (
                              <div>{`${t('采访回声', 'Interview Echo')}: ${truncateMiroFishText(selectedGraphInterview.responseText, 160)}`}</div>
                            ) : null}
                          </>
                        ) : null}
                        {selectedGraphConnections.length > 0 ? (
                          <div className="village-mirofish-connection-list">
                            {selectedGraphConnections.map((connection) => (
                              <button
                                key={`${connection.edgeId}-${connection.otherAgentId}-${connection.direction}`}
                                type="button"
                                className="village-mirofish-connection-btn"
                                onClick={() => handleFocusGraphConnection(connection)}
                              >
                                <strong>{connection.otherName}</strong>
                                <span>
                                  {`${connection.direction === 'outgoing' ? '->' : '<-'} ${connection.edgeType.replace(/_/g, ' ')}`}
                                </span>
                                {connection.fact ? <em>{connection.fact}</em> : null}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {selectedAgent.guestMeta ? (
                          <>
                            <div>{`${t('嘉宾身份', 'Guest Title')}: ${selectedAgent.guestMeta.title}`}</div>
                            <div>{`${t('讨论主题', 'Topic')}: ${selectedAgent.guestMeta.topic}`}</div>
                            <div>{`${t('驻留区域', 'Zone')}: ${selectedAgent.guestMeta.zoneLabel}`}</div>
                          </>
                        ) : null}
                        <div>{t('持有人', 'Owner')}: {selectedAgent.ownerAddress ? `${selectedAgent.ownerAddress.slice(0, 8)}...${selectedAgent.ownerAddress.slice(-6)}` : '--'}</div>
                      </>
                    )}
                  </>
                ) : (
                  <div>{t('点击地图中的 Agent 进行选择。', 'Click an agent on map to select.')}</div>
                )}
              </div>

              {advancedWorkbenchOpen ? (
              <div className="village-agent-log">
                <div className="village-agent-selected-title">{t('可审计行为记录', 'Auditable Action Logs')}</div>
                {agentActionLogs.length === 0 ? (
                  <div>{t('暂无链上记录。', 'No on-chain logs yet.')}</div>
                ) : (
                  <div className="village-agent-log-list">
                    {agentActionLogs.slice(0, 4).map((log) => {
                      const verifyState = verifyAgentActionLog(log).state;
                      return (
                        <a
                          key={`agent-log-${log.txHash}`}
                          className="village-agent-log-item"
                          href={`https://bscscan.com/tx/${log.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <span>{`#${log.tokenId} @ (${log.tx}, ${log.ty}) / ${log.txHash.slice(0, 10)}...`}</span>
                          <em>
                            {verifyState === 'verified'
                              ? t('签名已验', 'Signed')
                              : verifyState === 'missing'
                                ? t('旧记录', 'Legacy')
                                : t('校验失败', 'Invalid')}
                          </em>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
              ) : null}
              {advancedWorkbenchOpen ? (
              <div className="village-agent-proof">
                <div className="village-agent-selected-title">Web4 Proof</div>
                <div className="village-agent-proof-row">
                  <span>{t('凭证总数', 'Proofs')}</span>
                  <strong>{agentActionLogs.length}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('通过校验', 'Verified')}</span>
                  <strong>{`${verifiedAgentActionCount}/${agentActionLogs.length}`}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('最新意图哈希', 'Latest Intent')}</span>
                  <strong>{latestIntentShort}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('哈希链头', 'Proof Head')}</span>
                  <strong>{`${latestAgentProofHead.slice(0, 10)}...${latestAgentProofHead.slice(-8)}`}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('链路完整性', 'Chain Integrity')}</span>
                  <strong>{agentProofChainLinked ? t('完整', 'Linked') : t('断裂', 'Broken')}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('最新状态', 'Latest State')}</span>
                  <strong>
                    {latestAgentActionVerify.state === 'verified'
                      ? t('已验证', 'Verified')
                      : latestAgentActionVerify.state === 'missing'
                        ? t('待补齐', 'Legacy')
                        : t('异常', 'Invalid')}
                  </strong>
                </div>
              </div>
              ) : null}
              {advancedWorkbenchOpen ? (
              <div className="village-conway-card">
                <div className="village-agent-selected-title">{t('Alpha Runtime', 'Alpha Runtime')}</div>
                <div className="village-agent-proof-row">
                  <span>{t('配置状态', 'Config')}</span>
                  <strong>{conwayConfigured ? t('已连接', 'Connected') : t('未配置', 'Missing')}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('模式', 'Mode')}</span>
                  <strong>{conwayModeText}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>API</span>
                  <strong>{conwayApiBaseText}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>Project</span>
                  <strong>{conwayProjectText}</strong>
                </div>
                <div className="village-agent-selected-title">{t('Binance Graph Link', 'Binance Graph Link')}</div>
                <div className="village-agent-proof-row">
                  <span>{t('联动状态', 'Link Status')}</span>
                  <strong>
                    {miroFishGeneratingOntology || miroFishBuildingGraph || miroFishSimulationBusy || miroFishReporting || miroFishInterviewing
                      ? t('处理中', 'Working')
                      : miroFishSyncing
                      ? t('同步中', 'Syncing')
                      : miroFishErr
                        ? t('异常', 'Error')
                        : miroFishNodeCount > 0
                          ? t('已联动', 'Linked')
                          : t('未加载', 'Idle')}
                  </strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('项目状态', 'Project Status')}</span>
                  <strong>{miroFishProjectStatusText}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('任务状态', 'Task Status')}</span>
                  <strong>{miroFishTaskStatusText}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('模拟状态', 'Simulation Status')}</span>
                  <strong>{miroFishSimulationStatusText}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('准备状态', 'Prepare Status')}</span>
                  <strong>{miroFishPrepareStatusText}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('运行状态', 'Run Status')}</span>
                  <strong>{miroFishRunStatusText}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('报告状态', 'Report Status')}</span>
                  <strong>{miroFishReportStatusText}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('图谱统计', 'Graph Stats')}</span>
                  <strong>{`${miroFishNodeCount} ${t('节点', 'nodes')} / ${miroFishEdgeCount} ${t('边', 'edges')}`}</strong>
                </div>
                <div className="village-conway-action-row">
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={miroFishLoadingDemo || miroFishGeneratingOntology || miroFishBuildingGraph || miroFishSimulationBusy || miroFishReporting}
                    onClick={() => void handleLoadMiroFishDemo()}
                  >
                    {miroFishLoadingDemo ? t('载入中', 'Loading') : t('一键载入 Demo', 'Load Demo')}
                  </button>
                </div>
                <label className="village-conway-input-row">
                  <span>{t('MiroFish API', 'MiroFish API')}</span>
                  <input
                    value={miroFishApiBase}
                    onChange={(e) => setMiroFishApiBase(e.target.value)}
                    placeholder={MIROFISH_DEFAULT_PUBLIC_API_BASE}
                  />
                </label>
                <label className="village-conway-input-row">
                  <span>{t('项目 ID', 'Project ID')}</span>
                  <input
                    value={miroFishProjectId}
                    onChange={(e) => setMiroFishProjectId(e.target.value)}
                    placeholder="proj_..."
                  />
                </label>
                <label className="village-conway-input-row">
                  <span>{t('图谱 ID', 'Graph ID')}</span>
                  <input
                    value={miroFishGraphId}
                    onChange={(e) => setMiroFishGraphId(e.target.value)}
                    placeholder="graph_..."
                  />
                </label>
                <label className="village-conway-input-row">
                  <span>{t('任务 ID', 'Task ID')}</span>
                  <input
                    value={miroFishTaskId}
                    onChange={(e) => setMiroFishTaskId(e.target.value)}
                    placeholder="task_uuid"
                  />
                </label>
                <label className="village-conway-input-row">
                  <span>{t('Simulation ID', 'Simulation ID')}</span>
                  <input
                    value={miroFishSimulationId}
                    onChange={(e) => setMiroFishSimulationId(e.target.value)}
                    placeholder="sim_..."
                  />
                </label>
                <label className="village-conway-input-row">
                  <span>{t('Prepare Task ID', 'Prepare Task ID')}</span>
                  <input
                    value={miroFishPrepareTaskId}
                    onChange={(e) => setMiroFishPrepareTaskId(e.target.value)}
                    placeholder="task_..."
                  />
                </label>
                <label className="village-conway-input-row">
                  <span>{t('Report ID', 'Report ID')}</span>
                  <input
                    value={miroFishReportId}
                    onChange={(e) => setMiroFishReportId(e.target.value)}
                    placeholder="report_..."
                  />
                </label>
                <label className="village-conway-input-row">
                  <span>{t('Report Task ID', 'Report Task ID')}</span>
                  <input
                    value={miroFishReportTaskId}
                    onChange={(e) => setMiroFishReportTaskId(e.target.value)}
                    placeholder="task_..."
                  />
                </label>
                <label className="village-conway-input-row">
                  <span>{t('项目名称', 'Project Name')}</span>
                  <input
                    value={miroFishProjectName}
                    onChange={(e) => setMiroFishProjectName(e.target.value)}
                    placeholder={t('例如：Binance AI Town Investor Graph', 'Example: Binance AI Town Investor Graph')}
                  />
                </label>
                <label className="village-conway-input-row">
                  <span>{t('模拟需求', 'Simulation Requirement')}</span>
                  <textarea
                    value={miroFishSimulationRequirement}
                    onChange={(e) => setMiroFishSimulationRequirement(e.target.value)}
                    rows={3}
                    placeholder={t('描述你希望抽出的角色、组织、地点和事件。', 'Describe the people, orgs, places, and events you want extracted.')}
                  />
                </label>
                <label className="village-conway-input-row">
                  <span>{t('补充上下文', 'Additional Context')}</span>
                  <textarea
                    value={miroFishAdditionalContext}
                    onChange={(e) => setMiroFishAdditionalContext(e.target.value)}
                    rows={3}
                    placeholder={t('补充领域规则、实体类型偏好或关系重点。', 'Add domain rules, preferred entity types, or relation focus.')}
                  />
                </label>
                <label className="village-conway-input-row">
                  <span>{t('上传文档', 'Documents')}</span>
                  <input
                    ref={miroFishFileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.md,.markdown,.txt"
                    onChange={(e) => handleMiroFishFileChange(e.target.files)}
                  />
                </label>
                {miroFishSelectedFiles.length > 0 ? (
                  <div className="village-mirofish-file-list">
                    {miroFishSelectedFiles.map((file) => (
                      <div key={`${file.name}_${file.size}`} className="village-mirofish-file-pill">
                        <span>{file.name}</span>
                        <em>{`${Math.max(1, Math.round(file.size / 1024))} KB`}</em>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="village-mirofish-grid">
                  <label className="village-conway-input-row">
                    <span>{t('分块大小', 'Chunk Size')}</span>
                    <input
                      type="number"
                      min={120}
                      max={4000}
                      value={miroFishChunkSize}
                      onChange={(e) => setMiroFishChunkSize(Math.max(120, Number(e.target.value) || MIROFISH_DEFAULT_CHUNK_SIZE))}
                    />
                  </label>
                  <label className="village-conway-input-row">
                    <span>{t('重叠大小', 'Chunk Overlap')}</span>
                    <input
                      type="number"
                      min={0}
                      max={1200}
                      value={miroFishChunkOverlap}
                      onChange={(e) => setMiroFishChunkOverlap(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </label>
                </div>
                <div className="village-mirofish-grid">
                  <label className="village-conway-input-row">
                    <span>{t('Profiles 平台', 'Profiles Platform')}</span>
                    <select
                      value={miroFishProfilePlatform}
                      onChange={(e) => setMiroFishProfilePlatform(e.target.value === 'twitter' ? 'twitter' : 'reddit')}
                    >
                      <option value="reddit">reddit</option>
                      <option value="twitter">twitter</option>
                    </select>
                  </label>
                  <label className="village-conway-input-row">
                    <span>{t('运行平台', 'Run Platform')}</span>
                    <select
                      value={miroFishSimulationPlatform}
                      onChange={(e) => setMiroFishSimulationPlatform(
                        e.target.value === 'twitter'
                          ? 'twitter'
                          : e.target.value === 'reddit'
                            ? 'reddit'
                            : 'parallel',
                      )}
                    >
                      <option value="parallel">parallel</option>
                      <option value="reddit">reddit</option>
                      <option value="twitter">twitter</option>
                    </select>
                  </label>
                </div>
                <label className="village-conway-input-row">
                  <span>{t('最大轮数', 'Max Rounds')}</span>
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={miroFishMaxRounds}
                    onChange={(e) => setMiroFishMaxRounds(Math.max(1, Number(e.target.value) || 72))}
                  />
                </label>
                <div className="village-conway-action-row">
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={miroFishGeneratingOntology || miroFishBuildingGraph || miroFishSimulationBusy || miroFishReporting}
                    onClick={() => void handleMiroFishGenerateOntology()}
                  >
                    {miroFishGeneratingOntology ? t('生成中', 'Generating') : t('1. 生成本体', '1. Generate Ontology')}
                  </button>
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishHasProject || miroFishGeneratingOntology || miroFishBuildingGraph || miroFishSimulationBusy || miroFishReporting}
                    onClick={() => void handleMiroFishBuildGraph()}
                  >
                    {miroFishBuildingGraph ? t('构建中', 'Building') : t('2. 构建图谱', '2. Build Graph')}
                  </button>
                </div>
                <div className="village-conway-action-row">
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishHasProject || miroFishGeneratingOntology || miroFishBuildingGraph}
                    onClick={() => void refreshMiroFishProject(undefined)}
                  >
                    {t('刷新项目', 'Refresh Project')}
                  </button>
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishTaskId.trim() || miroFishGeneratingOntology || miroFishBuildingGraph || miroFishSimulationBusy || miroFishReporting}
                    onClick={() => void refreshMiroFishTask(undefined)}
                  >
                    {t('刷新任务', 'Refresh Task')}
                  </button>
                </div>
                <div className="village-conway-action-row">
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={miroFishSyncing || !miroFishGraphId.trim()}
                    onClick={() => void syncMiroFishAgentsIntoTown()}
                  >
                    {miroFishSyncing ? t('同步中', 'Syncing') : t('3. 同步图谱人物', '3. Sync Graph Agents')}
                  </button>
                  <button
                    type="button"
                    className="village-agent-btn"
                    onClick={() => {
                      setMiroFishGraphId('');
                      setMiroFishProject(null);
                      setMiroFishProjectId('');
                      setMiroFishTask(null);
                      setMiroFishTaskId('');
                      setMiroFishSimulation(null);
                      setMiroFishSimulationId('');
                      setMiroFishPrepareTask(null);
                      setMiroFishPrepareTaskId('');
                      setMiroFishRunStatus(null);
                      setMiroFishProfilesRealtime(null);
                      setMiroFishInterviewResult(null);
                      setMiroFishInterviewByAgentId({});
                      setMiroFishReport(null);
                      setMiroFishReportId('');
                      setMiroFishReportTask(null);
                      setMiroFishReportTaskId('');
                      setMiroFishErr(null);
                      miroFishSyncSignatureRef.current = '';
                      applyMiroFishGraphAgents([], {}, { nodeCount: 0, edgeCount: 0 });
                      setAgentPanelNotice(t('已清空图谱角色。', 'Graph-driven characters cleared.'));
                      if (miroFishFileInputRef.current) {
                        miroFishFileInputRef.current.value = '';
                      }
                      setMiroFishSelectedFiles([]);
                    }}
                  >
                    {t('重置联动', 'Reset Link')}
                  </button>
                </div>
                <div className="village-conway-action-row">
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishHasProject || !miroFishGraphId.trim() || miroFishSimulationBusy || miroFishGeneratingOntology || miroFishBuildingGraph}
                    onClick={() => void handleMiroFishCreateSimulation()}
                  >
                    {miroFishSimulationBusy ? t('处理中', 'Working') : t('4. 创建 Simulation', '4. Create Simulation')}
                  </button>
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishHasSimulation || miroFishSimulationBusy || miroFishGeneratingOntology || miroFishBuildingGraph}
                    onClick={() => void handleMiroFishPrepareSimulation()}
                  >
                    {t('准备 Simulation', 'Prepare Simulation')}
                  </button>
                </div>
                <div className="village-conway-action-row">
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishHasSimulation || miroFishSimulationBusy}
                    onClick={() => void refreshMiroFishSimulation(undefined)}
                  >
                    {t('刷新 Simulation', 'Refresh Simulation')}
                  </button>
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishHasSimulation || miroFishSimulationBusy}
                    onClick={() => void refreshMiroFishProfiles(undefined, undefined)}
                  >
                    {t('刷新 Profiles', 'Refresh Profiles')}
                  </button>
                </div>
                <div className="village-conway-action-row">
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishHasSimulation || miroFishSimulationBusy}
                    onClick={() => void handleMiroFishStartSimulation()}
                  >
                    {t('启动 Simulation', 'Start Simulation')}
                  </button>
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishHasSimulation || miroFishSimulationBusy}
                    onClick={() => void handleMiroFishStopSimulation()}
                  >
                    {t('停止 Simulation', 'Stop Simulation')}
                  </button>
                </div>
                <div className="village-conway-action-row">
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishHasSimulation || miroFishSimulationBusy}
                    onClick={() => void refreshMiroFishRunStatus(undefined)}
                  >
                    {t('刷新 Run', 'Refresh Run')}
                  </button>
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishHasSimulation || !selectedGraphMeta || !selectedGraphSimulationProfile || miroFishInterviewing}
                    onClick={() => void handleMiroFishInterviewSelected()}
                  >
                    {miroFishInterviewing ? t('采访中', 'Interviewing') : t('采访当前人物', 'Interview Selected')}
                  </button>
                </div>
                <label className="village-conway-input-row">
                  <span>{t('采访问题', 'Interview Prompt')}</span>
                  <textarea
                    value={miroFishInterviewPrompt}
                    onChange={(e) => setMiroFishInterviewPrompt(e.target.value)}
                    rows={3}
                    placeholder={t('例如：你在当前事件里承担什么角色？', 'Example: What role are you playing in the current event?')}
                  />
                </label>
                <div className="village-conway-action-row">
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishHasSimulation || miroFishReporting}
                    onClick={() => void handleMiroFishGenerateReport()}
                  >
                    {miroFishReporting ? t('生成中', 'Generating') : t('5. 生成报告', '5. Generate Report')}
                  </button>
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={!miroFishHasSimulation || (!miroFishReportTaskId.trim() && !miroFishSimulationId.trim()) || miroFishReporting}
                    onClick={() => void refreshMiroFishReportStatus(undefined, undefined)}
                  >
                    {t('刷新报告任务', 'Refresh Report Task')}
                  </button>
                </div>
                <div className="village-conway-action-row">
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={(!miroFishReportId.trim() && !miroFishSimulationId.trim()) || miroFishReporting}
                    onClick={() => void refreshMiroFishReport(undefined, undefined)}
                  >
                    {t('刷新报告', 'Refresh Report')}
                  </button>
                  <button
                    type="button"
                    className="village-agent-btn"
                    disabled={(!miroFishPrepareTaskId.trim() && !miroFishSimulationId.trim()) || miroFishSimulationBusy}
                    onClick={() => void refreshMiroFishPrepareStatus(undefined, undefined)}
                  >
                    {t('刷新准备任务', 'Refresh Prepare Task')}
                  </button>
                </div>
                {miroFishTask ? (
                  <div className="village-mirofish-progress">
                    <div className="village-mirofish-progress-bar">
                      <div
                        className="village-mirofish-progress-fill"
                        style={{ width: `${clamp(miroFishTask.progress, 0, 100)}%` }}
                      />
                    </div>
                    <span>{`${miroFishTask.progress}% · ${miroFishTask.message || t('等待任务消息', 'Waiting for task updates')}`}</span>
                  </div>
                ) : null}
                {miroFishPrepareTask ? (
                  <div className="village-mirofish-progress">
                    <div className="village-agent-selected-title">{t('准备进度', 'Prepare Progress')}</div>
                    <div className="village-mirofish-progress-bar">
                      <div
                        className="village-mirofish-progress-fill is-blue"
                        style={{ width: `${clamp(miroFishPrepareTask.progress, 0, 100)}%` }}
                      />
                    </div>
                    <span>{`${miroFishPrepareTask.progress}% · ${miroFishPrepareTask.message || t('等待准备任务消息', 'Waiting for prepare updates')}`}</span>
                  </div>
                ) : null}
                {miroFishReportTask ? (
                  <div className="village-mirofish-progress">
                    <div className="village-agent-selected-title">{t('报告进度', 'Report Progress')}</div>
                    <div className="village-mirofish-progress-bar">
                      <div
                        className="village-mirofish-progress-fill is-amber"
                        style={{ width: `${clamp(miroFishReportTask.progress, 0, 100)}%` }}
                      />
                    </div>
                    <span>{`${miroFishReportTask.progress}% · ${miroFishReportTask.message || t('等待报告任务消息', 'Waiting for report updates')}`}</span>
                  </div>
                ) : null}
                {miroFishProject ? (
                  <div className="village-conway-output">
                    <strong>{t('项目摘要', 'Project Summary')}</strong>
                    <span>{miroFishProject.analysis_summary || t('生成本体后会在这里显示摘要。', 'Ontology summary will appear here after generation.')}</span>
                    <span>
                      {`${t('文件', 'Files')}: ${miroFishProject.files.length} · ${t('实体类型', 'Entity Types')}: ${miroFishOntologyEntityCount} · ${t('关系类型', 'Relation Types')}: ${miroFishOntologyEdgeTypeCount}`}
                    </span>
                    <span>{`${t('文本长度', 'Text Length')}: ${miroFishProject.total_text_length}`}</span>
                  </div>
                ) : null}
                <div className="village-conway-output">
                  <strong>{t('Demo Preset', 'Demo Preset')}</strong>
                  <span>{`${MIROFISH_SMOKE_DEMO_PRESET.label} · ${MIROFISH_SMOKE_DEMO_PRESET.projectId}`}</span>
                  <span>{`${t('图谱', 'Graph')}: ${MIROFISH_SMOKE_DEMO_PRESET.graphId}`}</span>
                  <span>{`${t('Simulation', 'Simulation')}: ${MIROFISH_SMOKE_DEMO_PRESET.simulationId} · ${t('Report', 'Report')}: ${MIROFISH_SMOKE_DEMO_PRESET.reportId}`}</span>
                </div>
                {(miroFishSimulation || miroFishRunStatus || miroFishProfilesRealtime) ? (
                  <div className="village-conway-output">
                    <strong>{t('Simulation Snapshot', 'Simulation Snapshot')}</strong>
                    <span>{`${t('Simulation ID', 'Simulation ID')}: ${miroFishSimulationId || '--'}`}</span>
                    <span>{`${t('状态', 'Status')}: ${miroFishSimulationStatusText} · ${t('准备', 'Prepare')}: ${miroFishPrepareStatusText} · ${t('运行', 'Run')}: ${miroFishRunStatusText}`}</span>
                    <span>{`${t('实体数', 'Entities')}: ${miroFishSimulation?.entities_count ?? miroFishPrepareTask?.expected_entities_count ?? 0} · ${t('Profiles', 'Profiles')}: ${miroFishProfileCountText}`}</span>
                    <span>{`${t('运行轮次', 'Rounds')}: ${miroFishRunStatus ? `${miroFishRunStatus.current_round}/${miroFishRunStatus.total_rounds || '--'}` : '--'} · ${t('动作数', 'Actions')}: ${miroFishRunStatus?.total_actions_count ?? 0}`}</span>
                    {selectedGraphSimulationProfile ? (
                      <span>{`${t('当前人物映射', 'Selected Mapping')}: #${selectedGraphSimulationProfile.index} · ${selectedGraphProfileDisplayName}`}</span>
                    ) : null}
                  </div>
                ) : null}
                {miroFishInterviewResult?.responseText ? (
                  <div className="village-conway-output">
                    <strong>{t('采访结果', 'Interview Result')}</strong>
                    <span>{`${t('Agent ID', 'Agent ID')}: #${miroFishInterviewResult.agent_id}${miroFishInterviewResult.platformSummary ? ` · ${miroFishInterviewResult.platformSummary}` : ''}`}</span>
                    <span>{`${t('问题', 'Prompt')}: ${miroFishInterviewResult.prompt}`}</span>
                    <span>{miroFishInterviewResult.responseText}</span>
                  </div>
                ) : null}
                {(miroFishReport || miroFishReportTaskId.trim()) ? (
                  <div className="village-conway-output">
                    <strong>{t('报告预览', 'Report Preview')}</strong>
                    <span>{`${t('Report ID', 'Report ID')}: ${miroFishReportId || miroFishReport?.report_id || '--'}`}</span>
                    <span>{`${t('状态', 'Status')}: ${miroFishReportStatusText}`}</span>
                    <span>{miroFishReportPreview || t('报告生成后会在这里显示 Markdown 摘要。', 'Markdown preview appears here after report generation.')}</span>
                  </div>
                ) : null}
                {miroFishErr ? <div className="village-conway-error">{`${t('图谱错误', 'Graph Error')}: ${miroFishErr}`}</div> : null}
                <label className="village-conway-input-row">
                  <span>{t('Sandbox ID', 'Sandbox ID')}</span>
                  <input
                    value={conwayRuntime.sandboxId}
                    onChange={(e) => patchConwayRuntime({ sandboxId: e.target.value.trim() })}
                    placeholder="sbx_..."
                  />
                </label>
                <div className="village-agent-proof-row">
                  <span>{t('运行状态', 'Status')}</span>
                  <strong>{conwayRuntime.status || '--'}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('最近执行', 'Last Run')}</span>
                  <strong>{`${conwayRuntime.lastRunStatus || '--'} · ${conwayLastRunText}`}</strong>
                </div>
                <div className="village-agent-proof-row">
                  <span>{t('联动结果', 'Sync Result')}</span>
                  <strong>{conwayApplySummary || '--'}</strong>
                </div>
                {conwayRuntime.publicUrl ? (
                  <a
                    className="village-agent-log-item"
                    href={conwayRuntime.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>{t('打开 Alpha Runtime', 'Open Alpha Runtime')}</span>
                    <em>{conwayRuntime.publicUrl}</em>
                  </a>
                ) : null}
                <label className="village-conway-input-row">
                  <span>{t('Agent 指令', 'Agent Prompt')}</span>
                  <textarea
                    value={conwayAgentMessage}
                    onChange={(e) => setConwayAgentMessage(e.target.value)}
                    rows={3}
                    placeholder={t(
                      '例如：返回 JSON，包含 agents:[{id,name,status,thought,intent}] 与 broadcast。',
                      'Example: return JSON with agents:[{id,name,status,thought,intent}] and broadcast.',
                    )}
                  />
                </label>
                <div className="village-conway-action-row">
                  <button type="button" className="village-agent-btn" disabled={conwayPending} onClick={() => void handleConwayCreateSandbox()}>
                    {t('创建 Sandbox', 'Create Sandbox')}
                  </button>
                  <button type="button" className="village-agent-btn" disabled={conwayPending} onClick={() => void handleConwaySyncSandbox()}>
                    {t('同步状态', 'Sync')}
                  </button>
                  <button type="button" className="village-agent-btn" disabled={conwayPending} onClick={() => void handleConwayRunAgent()}>
                    {conwayPending ? t('执行中', 'Running') : t('运行 Agent', 'Run Agent')}
                  </button>
                  <button type="button" className="village-agent-btn" disabled={conwayPending} onClick={() => handleConwayApplyLastOutput()}>
                    {t('应用输出', 'Apply Output')}
                  </button>
                  <button type="button" className="village-agent-btn" disabled={conwayPending} onClick={() => void handleConwayStopSandbox()}>
                    {t('停止 Sandbox', 'Stop Sandbox')}
                  </button>
                </div>
                {conwayErr ? <div className="village-conway-error">{conwayErr}</div> : null}
                {conwayLastOutput ? (
                  <div className="village-conway-output">
                    <strong>{t('执行输出', 'Output')}</strong>
                    <span>{conwayLastOutput}</span>
                  </div>
                ) : null}
              </div>
              ) : null}
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
            className={`village-canvas-wrap ${isTestMap ? 'is-test-map' : ''} ${!isTestMap && placeMode ? 'is-place-mode' : ''} ${mapExpansionPulseActive ? 'is-expansion-pulse' : ''} ${playSectorLoading ? 'is-sector-loading' : ''} ${mapLoading ? 'is-map-loading' : ''}`}
            ref={canvasWrapRef}
          >
            <canvas ref={canvasRef} className="village-canvas" />
            {mapExpansionPulseActive ? <div className="village-expansion-pulse-overlay" /> : null}
            {mapLoading ? (
              <div className="village-map-loading-overlay">
                <div className="village-map-loading-overlay-box">
                  <strong>{t('地图加载中', 'Map loading')}</strong>
                  <span>{mapLoadingText}</span>
                </div>
              </div>
            ) : null}
            {!isTestMap && playSectorLoading ? (
              <div className="village-sector-loading">
                <span>{t('边缘到达，正在加载新区...', 'Reached edge, loading next region...')}</span>
              </div>
            ) : null}
            {!isTestMap && placeMode ? (
              <div className="village-place-hint">
                {t('放置模式：点击地图任意位置，把选中的 NFT 放上去。', 'Placement mode: click anywhere on map to place selected NFT.')}
              </div>
            ) : null}
            {!isTestMap ? (
              <button
                type="button"
                className={`village-action-brief-hint ${!bnbActionBriefFocus ? 'is-disabled' : ''}`}
                onClick={handleFocusActionBriefZone}
                disabled={!bnbActionBriefFocus}
              >
                <span>{t('行动建议', 'Action Brief')}</span>
                <strong>{bnbActionBriefTitle}</strong>
                <em>{`${bnbActionBriefZone} · ${t('风险', 'Risk')}: ${bnbActionBriefRisk}`}</em>
              </button>
            ) : null}
            {isTestMap ? (
              <div className="village-top-dock">
                <button
                  type="button"
                  className={`village-top-dock-toggle ${topLeftDockOpen ? 'is-open' : ''}`}
                  onClick={() => setTopLeftDockOpen((prev) => !prev)}
                >
                  <span>{t('地图面板', 'Map Panel')}</span>
                  <strong>{topLeftDockOpen ? t('收起', 'Hide') : t('展开', 'Show')}</strong>
                </button>
                {topLeftDockOpen ? (
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
                {renderErr || (
                  activeSkillsMission
                    ? `${activeSkillsMission.title.toUpperCase()} // ${activeSkillsMission.token} // ${activeSkillsMission.zoneLabel.toUpperCase()}`
                    : (playModeEnabled
                      ? 'PLAY MODE // MOVE WITH WASD OR ARROWS // PRESS E TO INTERACT'
                      : 'SIMULATION MODE // CLICK AGENTS TO VIEW PROFILES')
                )}
              </div>
            ) : null}
          </div>
          {!isTestMap ? (
            <aside className="village-live-chat-window" aria-live="polite" aria-label={t('BSC 实时对话', 'BSC live talk')}>
              <div className="village-live-chat-header">
                <div>
                  <strong>{t('BSC 实时对话', 'BSC Live Talk')}</strong>
                  <span>{t('NPC 正在讨论主网节奏和行动建议', 'NPCs are discussing mainnet cadence and next actions')}</span>
                </div>
                <em className={`is-${bscLiveChatMode}`}>
                  {bscLiveChatMode === 'ai'
                    ? t('真 AI', 'Live AI')
                    : bscLiveChatMode === 'fallback'
                      ? t('回退', 'Fallback')
                      : t('实时', 'Live')}
                </em>
              </div>
              <div className="village-live-chat-summary">{bscLiveChatSummary}</div>
              <div className="village-live-chat-list">
                {bscLiveChatMessages.slice(-5).reverse().map((item) => (
                  <article key={item.id} className={`village-live-chat-item is-${item.tone}`}>
                    <div className="village-live-chat-item-head">
                      <strong>{item.speaker}</strong>
                      <span>{item.role}</span>
                      <time>{formatClockTime(item.createdAt)}</time>
                    </div>
                    <div className="village-live-chat-item-text">{item.text}</div>
                  </article>
                ))}
              </div>
              <div className="village-live-chat-footer">
                <span>
                  {selectedAgent
                    ? t('这里是实时播报窗。想输入消息，请点下面按钮和当前选中的小人对话。', 'This is a live feed. To type a message, use the button below to chat with the selected NPC.')
                    : t('这里是实时播报窗。想输入消息，请先点击地图上的一个小人。', 'This is a live feed. To type a message, click an NPC on the map first.')}
                </span>
                <button
                  type="button"
                  className="village-live-chat-cta"
                  disabled={!selectedAgent}
                  onClick={() => {
                    if (!selectedAgent) return;
                    setAgentProfileOpen(true);
                  }}
                >
                  {selectedAgent
                    ? t(`和 ${selectedAgent.name} 对话`, `Chat with ${selectedAgent.name}`)
                    : t('先选一个小人', 'Select an NPC first')}
                </button>
              </div>
            </aside>
          ) : null}
          {!isTestMap ? (
            <div className="village-map-overlay-dock">
              <div className="village-map-overlay-top">
                <div className="village-fixed-vitals" aria-live="polite">
                  <div className="village-fixed-vitals-head">
                    <span>{t('状态', 'Status')}</span>
                    <strong>{`Lv.${mapRpgPlayer.level}`}</strong>
                  </div>
                  <div className="village-fixed-vitals-row">
                    <span>HP</span>
                    <div className="village-fixed-vitals-track">
                      <div className="village-fixed-vitals-fill is-hp" style={{ width: `${mapRpgHpPct}%` }} />
                    </div>
                    <em>{`${mapRpgPlayer.hp}/${mapRpgPlayer.maxHp}`}</em>
                  </div>
                  <div className="village-fixed-vitals-row">
                    <span>MP</span>
                    <div className="village-fixed-vitals-track">
                      <div className="village-fixed-vitals-fill is-mp" style={{ width: `${mapRpgMpPct}%` }} />
                    </div>
                    <em>{`${mapRpgPlayer.mp}/${mapRpgPlayer.maxMp}`}</em>
                  </div>
                </div>
                <button
                  type="button"
                  className="village-hud-toggle-btn"
                  onClick={() => setMapPlayHudOpen((prev) => !prev)}
                >
                  <span>{t('操控窗口', 'Control Panel')}</span>
                  <strong>{mapPlayHudOpen ? t('收起', 'Hide') : t('展开', 'Show')}</strong>
                </button>
              </div>
              {mapPlayHudOpen ? (
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
                    <span>{t('RPG 等级', 'RPG Level')}</span>
                    <strong>{`Lv.${mapRpgPlayer.level}`}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('属性', 'Stats')}</span>
                    <strong>{`ATK ${mapRpgPlayer.atk} / DEF ${mapRpgPlayer.def}`}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('主动技能 Q', 'Skill Q')}</span>
                    <strong>{`${mapRpgSkillCdText} · MP-${MAP_RPG_SKILL_MP_COST}`}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('药水 1/2', 'Potions 1/2')}</span>
                    <strong>{`HP ${mapRpgPlayer.hpPotion} / MP ${mapRpgPlayer.mpPotion}`}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('金币', 'Gold')}</span>
                    <strong>{mapRpgPlayer.gold}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('击败数', 'Defeated')}</span>
                    <strong>{mapRpgPlayer.kills}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('区域', 'Region')}</span>
                    <strong>{`${infiniteRegion.x}, ${infiniteRegion.y}`}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('场景', 'Scene')}</span>
                    <strong>{mapHqSceneText}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('地貌', 'Biome')}</span>
                    <strong>{infiniteBiomeLabel}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('季节', 'Season')}</span>
                    <strong>{infiniteSeasonLabel}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('分数', 'Score')}</span>
                    <strong>{mapPlayStats.score}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('最高分', 'Best')}</span>
                    <strong>{mapPlayHighScore}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('连击', 'Combo')}</span>
                    <strong>{mapPlayComboActive ? `x${mapPlayStats.combo}` : 'x0'}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('最高连击', 'Best Combo')}</span>
                    <strong>{`x${mapPlayStats.bestCombo}`}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('互动任务', 'Talk Quest')}</span>
                    <strong>{`${mapPlayTalkProgress}/${MAP_PLAY_TALK_TARGET}${mapPlayQuestDone ? ` ${t('完成', 'Done')}` : ''}`}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('信号任务', 'Signal Quest')}</span>
                    <strong>{`${mapPlayLootProgress}/${MAP_PLAY_LOOT_TARGET}${mapPlayLootQuestDone ? ` ${t('完成', 'Done')}` : ''}`}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('剩余补给', 'Supplies Left')}</span>
                    <strong>{mapPlayLootRemaining}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('Alpha 任务', 'Alpha Quest')}</span>
                    <strong>{mapAdventure.activeQuest ? mapAdventureQuestText : '--'}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('RPG 任务', 'RPG Quest')}</span>
                    <strong>{mapRpgQuestText}</strong>
                  </div>
                  <div className="village-play-hud-row">
                    <span>{t('已发现分区', 'Sectors Found')}</span>
                    <strong>{`${mapAdventureDiscoveredCount}`}</strong>
                  </div>
                  <div className="village-play-energy village-play-energy-rpg">
                    <span>{t('生命', 'HP')}</span>
                    <div className="village-play-energy-track">
                      <div className="village-play-energy-fill village-play-energy-fill-hp" style={{ width: `${mapRpgHpPct}%` }} />
                    </div>
                    <em>{`${mapRpgPlayer.hp}/${mapRpgPlayer.maxHp}`}</em>
                  </div>
                  <div className="village-play-energy village-play-energy-rpg">
                    <span>{t('法力', 'MP')}</span>
                    <div className="village-play-energy-track">
                      <div className="village-play-energy-fill village-play-energy-fill-mp" style={{ width: `${mapRpgMpPct}%` }} />
                    </div>
                    <em>{`${mapRpgPlayer.mp}/${mapRpgPlayer.maxMp}`}</em>
                  </div>
                  <div className="village-play-energy village-play-energy-rpg">
                    <span>{t('经验', 'XP')}</span>
                    <div className="village-play-energy-track">
                      <div className="village-play-energy-fill village-play-energy-fill-xp" style={{ width: `${mapRpgXpPct}%` }} />
                    </div>
                    <em>{`${mapRpgPlayer.xp}/${mapRpgPlayer.xpToNext}`}</em>
                  </div>
                  <div className="village-play-energy">
                    <span>{t('冲刺体力', 'Sprint Energy')}</span>
                    <div className="village-play-energy-track">
                      <div className="village-play-energy-fill" style={{ width: `${Math.round(playSprintEnergyUi)}%` }} />
                    </div>
                    <em>{`${Math.round(playSprintEnergyUi)}%`}</em>
                  </div>
                  <div className="village-play-hud-hint">{playNearbyHint}</div>
                  <div className="village-play-hud-hint">{mapAdventureQuestHint}</div>
                  <div className="village-play-hud-hint">{`${t('世界事件', 'World Event')}: ${bnbWorldEventTitle} · ${bnbWorldEventDetail}`}</div>
                  <div className="village-play-hud-hint">
                    {mapRpgAttackReady
                      ? t('战斗状态: 可攻击', 'Combat: Attack Ready')
                      : t('战斗状态: 冷却中', 'Combat: Cooldown')}
                  </div>
                  <div className="village-play-hud-tip">{t('WASD/方向键移动 · Shift冲刺 · F普攻 · Q技能 · 1/2药水 · E互动 · 点地可自动寻路 · 边缘可跨区探索', 'Move: WASD/Arrows · Sprint: Shift · Attack: F · Skill: Q · Potions: 1/2 · Interact: E · Click ground to move · Cross edges to new sectors')}</div>
                </div>
              ) : null}
            </div>
          ) : null}
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

              <div className="village-agent-profile-block">
                <div className="village-agent-chat-title-row">
                  <div className="village-agent-profile-label">{t('与 TA 对话', 'Talk to this NPC')}</div>
                  <span className={`village-agent-chat-source is-${selectedNpcChatSource}`}>
                    {selectedNpcChatSource === 'ai'
                      ? t('真 AI', 'Live AI')
                      : selectedNpcChatSource === 'seed'
                        ? t('开场', 'Intro')
                        : t('回退', 'Fallback')}
                  </span>
                </div>
                <div className="village-agent-chat-panel">
                  <div className="village-agent-chat-thread" ref={npcChatThreadRef}>
                    {selectedNpcChatTurns.length > 0 ? selectedNpcChatTurns.map((item) => (
                      <div key={item.id} className={`village-agent-chat-turn is-${item.role}`}>
                        <div className="village-agent-chat-turn-head">
                          <strong>
                            {item.role === 'user'
                              ? t('你', 'You')
                              : item.role === 'system'
                                ? t('系统', 'System')
                                : selectedAgent.name}
                          </strong>
                          <span>
                            {item.source === 'ai'
                              ? t('真 AI', 'AI')
                              : item.source === 'seed'
                                ? t('开场', 'Intro')
                                : t('回退', 'Fallback')}
                          </span>
                        </div>
                        <div className="village-agent-chat-turn-text">{item.text}</div>
                      </div>
                    )) : (
                      <div className="village-agent-chat-empty">
                        {t('发一句话试试看，这个 NPC 会按自己的身份回复你。', 'Send a message and this NPC will answer in character.')}
                      </div>
                    )}
                  </div>
                  <div className="village-agent-chat-compose">
                    <textarea
                      className="village-agent-chat-input"
                      value={npcChatDraft}
                      onChange={(e) => setNpcChatDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleSendNpcChat();
                        }
                      }}
                      placeholder={t('问他：你现在在关注什么？ / BSC 现在怎么看？', 'Ask: what are you watching right now? / what is your BSC read?')}
                      rows={3}
                    />
                    <div className="village-agent-chat-compose-foot">
                      <span>{npcChatError || t('按 Enter 发送，Shift+Enter 换行。', 'Press Enter to send, Shift+Enter for a new line.')}</span>
                      <button
                        type="button"
                        className="village-agent-verify-btn"
                        disabled={npcChatPending || !npcChatDraft.trim()}
                        onClick={() => void handleSendNpcChat()}
                      >
                        {npcChatPending ? t('对话中...', 'Replying...') : t('发送', 'Send')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {selectedGraphMeta && selectedGraphInterview?.responseText ? (
                <div className="village-agent-profile-block">
                  <div className="village-agent-profile-label">{t('最近采访', 'Latest Interview')}</div>
                  <p>{selectedGraphInterview.responseText}</p>
                </div>
              ) : null}

              {selectedGraphProjection ? (
                <div className="village-agent-profile-grid">
                  <div className="village-agent-profile-block">
                    <div className="village-agent-profile-label">{t('Simulation Lens', 'Simulation Lens')}</div>
                    <ul>
                      <li>{`${t('状态', 'Status')}: ${selectedGraphProjection.statusLabel}`}</li>
                      <li>{`${t('角色', 'Role')}: ${selectedGraphProjection.roleLabel}`}</li>
                      <li>{`${t('平台', 'Platform')}: ${selectedGraphProjection.platform}`}</li>
                      <li>{`${t('活跃度', 'Activity')}: ${selectedGraphProjection.actionScore}`}</li>
                    </ul>
                  </div>
                  <div className="village-agent-profile-block">
                    <div className="village-agent-profile-label">{t('Report Lens', 'Report Lens')}</div>
                    <ul>
                      <li>{selectedGraphProjection.reportTitle || t('尚未生成完整报告标题。', 'No report title yet.')}</li>
                      <li>{selectedGraphProjection.reportLabel}</li>
                    </ul>
                  </div>
                </div>
              ) : null}

              <div className="village-agent-profile-motto">{selectedAgentProfile.motto}</div>

              <div className="village-agent-profile-verify">
                <div className="village-agent-profile-label">{t('自动验证', 'Auto Verification')}</div>
                {selectedAgentAutoVerify ? (
                  <>
                    <div className="village-agent-verify-row">
                      <span>{t('身份', 'Identity')}</span>
                      <strong className={`village-agent-verify-badge is-${selectedAgentAutoVerify.identityStatus}`}>
                        {verifyStatusLabel(selectedAgentAutoVerify.identityStatus)}
                      </strong>
                    </div>
                    <div className="village-agent-verify-detail">{selectedAgentAutoVerify.identityDetail}</div>
                    {selectedAgentAutoVerify.ownerAddress ? (
                      <div className="village-agent-verify-owner">
                        {`${t('持有人', 'Owner')}: ${selectedAgentAutoVerify.ownerAddress.slice(0, 8)}...${selectedAgentAutoVerify.ownerAddress.slice(-6)}`}
                      </div>
                    ) : null}
                    <div className="village-agent-verify-row">
                      <span>{t('凭证', 'Proof')}</span>
                      <strong className={`village-agent-verify-badge is-${selectedAgentAutoVerify.proofStatus}`}>
                        {verifyStatusLabel(selectedAgentAutoVerify.proofStatus)}
                      </strong>
                    </div>
                    <div className="village-agent-verify-detail">{selectedAgentAutoVerify.proofDetail}</div>
                    {selectedAgentAutoVerify.proofTxHash ? (
                      <a
                        className="village-agent-verify-link"
                        href={`https://bscscan.com/tx/${selectedAgentAutoVerify.proofTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {`${t('查看凭证交易', 'View Proof Tx')}: ${selectedAgentAutoVerify.proofTxHash.slice(0, 10)}...`}
                      </a>
                    ) : null}
                  </>
                ) : (
                  <div className="village-agent-verify-detail">
                    {t('点击小人后将自动触发身份与凭证校验。', 'Click an agent to auto-run identity and proof checks.')}
                  </div>
                )}
                <div className="village-agent-verify-actions">
                  <button
                    type="button"
                    className="village-agent-verify-btn"
                    disabled={Boolean(selectedAgentAutoVerify?.checking)}
                    onClick={() => void runAutoVerifyForAgent(selectedAgent)}
                  >
                    {selectedAgentAutoVerify?.checking ? t('验证中...', 'Checking...') : t('重新验证', 'Re-check')}
                  </button>
                </div>
              </div>
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

          .village-market-chip {
              display: inline-flex;
              align-items: center;
              min-height: 28px;
              max-width: min(320px, 42vw);
              border: 1px solid rgba(122, 163, 106, 0.82);
              border-radius: 999px;
              padding: 6px 10px;
              background: rgba(244, 255, 220, 0.92);
              color: #355638;
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              line-height: 1.25;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
          }

          .village-market-chip.is-risk-on {
              border-color: rgba(104, 166, 79, 0.95);
              color: #2f6b1f;
              box-shadow: 0 0 0 1px rgba(132, 199, 103, 0.24) inset;
          }

          .village-market-chip.is-risk-off {
              border-color: rgba(197, 125, 83, 0.92);
              color: #8b4a2f;
              box-shadow: 0 0 0 1px rgba(208, 128, 93, 0.2) inset;
          }

          .village-market-chip.is-volatile {
              border-color: rgba(232, 179, 74, 0.95);
              color: #855308;
              box-shadow: 0 0 0 1px rgba(231, 184, 67, 0.25) inset;
          }

          .village-market-chip.is-rotation {
              border-color: rgba(115, 152, 197, 0.95);
              color: #3f5e86;
              box-shadow: 0 0 0 1px rgba(120, 168, 214, 0.22) inset;
          }

          .village-market-chip.is-mainnet-busy {
              border-color: rgba(213, 137, 77, 0.94);
              color: #91501a;
              box-shadow: 0 0 0 1px rgba(227, 158, 86, 0.22) inset;
          }

          .village-market-chip.is-sync-watch {
              border-color: rgba(137, 140, 173, 0.94);
              color: #4a5575;
              box-shadow: 0 0 0 1px rgba(146, 151, 188, 0.22) inset;
          }

          .village-market-chip.is-balanced {
              border-color: rgba(118, 166, 92, 0.94);
              color: #3d6a29;
              box-shadow: 0 0 0 1px rgba(130, 188, 101, 0.22) inset;
          }

          .village-market-chip.is-idle {
              opacity: 0.84;
          }

          .village-terminal-ticker {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              min-height: 32px;
              max-width: min(980px, 66vw);
              padding: 6px 10px;
              border: 1px solid rgba(86, 102, 72, 0.82);
              border-radius: 9px;
              background:
                linear-gradient(180deg, rgba(42, 50, 31, 0.96), rgba(27, 31, 22, 0.96));
              box-shadow:
                inset 0 1px 0 rgba(255,255,255,0.04),
                inset 0 -1px 0 rgba(0,0,0,0.22);
              color: #d9f0b3;
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              white-space: nowrap;
              overflow: hidden;
          }

          .village-terminal-ticker.is-risk-on {
              border-color: rgba(92, 150, 73, 0.92);
          }

          .village-terminal-ticker.is-risk-off {
              border-color: rgba(186, 116, 76, 0.88);
          }

          .village-terminal-ticker.is-volatile {
              border-color: rgba(212, 163, 59, 0.9);
          }

          .village-terminal-ticker.is-rotation {
              border-color: rgba(92, 126, 168, 0.9);
          }

          .village-terminal-ticker-main {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              color: #f4d56f;
              flex-shrink: 0;
          }

          .village-terminal-symbol {
              color: #f0b90b;
              letter-spacing: 0.04em;
          }

          .village-terminal-ticker-main strong {
              color: #fff0b0;
          }

          .village-terminal-ticker-main em {
              font-style: normal;
              color: #ffcf76;
          }

          .village-terminal-divider {
              width: 1px;
              height: 16px;
              background: rgba(194, 211, 167, 0.18);
              flex-shrink: 0;
          }

          .village-terminal-field {
              display: inline-flex;
              align-items: center;
              gap: 4px;
              color: #b7d49a;
              flex-shrink: 0;
          }

          .village-terminal-field strong {
              color: #eef8d8;
              font-weight: 700;
          }

          .village-header-actions {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              flex-wrap: wrap;
              justify-content: flex-end;
          }

          .village-header-btn {
              border: 1px solid #7aa36a;
              border-radius: 6px;
              background: rgba(244, 255, 220, 0.92);
              color: #355638;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              line-height: 1.2;
              padding: 6px 8px;
              cursor: pointer;
              transition: transform .1s ease, box-shadow .12s ease;
              white-space: nowrap;
          }

          .village-header-btn:hover {
              transform: translateY(-1px);
              box-shadow: 0 3px 8px rgba(57, 84, 47, 0.18);
          }

          .village-header-btn.active {
              border-color: #5f8e56;
              background: linear-gradient(180deg, #e6ffd6, #cceebd);
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

          .village-control-grid.simple-open {
              grid-template-columns: minmax(0, 1fr) 320px;
          }

          .village-simple-guide-card {
              padding: 12px;
              min-height: 100%;
              display: flex;
              flex-direction: column;
              gap: 6px;
              justify-content: center;
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

          .village-agent-control-toolbar {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
              margin-bottom: 8px;
              flex-wrap: wrap;
          }

          .village-agent-control-subtitle {
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              color: #587156;
              line-height: 1.5;
          }

          .village-agent-control-grid.simple-open .expert-only {
              display: none;
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

          .village-expansion-mission-card-btn {
              width: 100%;
              text-align: left;
              cursor: pointer;
              transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
          }

          .village-expansion-mission-card-btn:hover {
              transform: translateY(-1px);
              border-color: rgba(214, 154, 18, 0.9);
              box-shadow: 0 10px 18px rgba(133, 105, 17, 0.12);
          }

          .village-expansion-mission-card-btn.is-expanded {
              border-color: rgba(214, 154, 18, 0.95);
              box-shadow: 0 0 0 1px rgba(214, 154, 18, 0.2) inset, 0 12px 24px rgba(133, 105, 17, 0.12);
          }

          .village-expansion-mission-card-btn:disabled {
              cursor: not-allowed;
              opacity: 0.72;
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

          .village-expansion-mission-cta {
              margin-top: 7px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              color: #6a581c;
          }

          .village-expansion-mission-cta strong {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #9a6f08;
          }

          .village-action-brief-route {
              margin-top: 8px;
              padding-top: 8px;
              border-top: 1px dashed rgba(154, 111, 8, 0.38);
              display: flex;
              flex-direction: column;
              gap: 6px;
          }

          .village-action-brief-route-title {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #725512;
          }

          .village-action-brief-route-subtitle {
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              color: #4f6124;
          }

          .village-action-brief-route-steps {
              display: flex;
              flex-direction: column;
              gap: 5px;
          }

          .village-action-brief-route-step {
              display: grid;
              grid-template-columns: 18px minmax(0, 1fr);
              gap: 8px;
              align-items: start;
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              color: #40582b;
          }

          .village-action-brief-route-step span {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              border: 1px solid rgba(214, 154, 18, 0.7);
              border-radius: 999px;
              color: #8c6207;
              min-height: 18px;
              background: rgba(255, 243, 191, 0.9);
              font-size: 10px;
          }

          .village-action-brief-route-step strong {
              font-weight: 500;
          }

          .village-action-brief-route-note {
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              color: #5b6b32;
              background: rgba(255, 250, 222, 0.72);
              border: 1px solid rgba(214, 154, 18, 0.18);
              border-radius: 6px;
              padding: 6px 7px;
          }

          .village-skills-missions {
              display: flex;
              flex-direction: column;
              gap: 8px;
              margin-top: 8px;
          }

          .village-skills-mission-btn {
              margin: 0;
          }

          .village-skills-mission-btn.is-alpha {
              border-color: rgba(214, 154, 18, 0.72);
          }

          .village-skills-mission-btn.is-watch {
              border-color: rgba(108, 145, 197, 0.72);
          }

          .village-skills-mission-btn.is-risk {
              border-color: rgba(201, 119, 88, 0.72);
          }

          .village-skills-mission-head {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
              margin-bottom: 4px;
          }

          .village-skills-mission-title {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              color: #486948;
          }

          .village-skills-mission-token {
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              color: #8b6207;
          }

          .village-guest-dock-actions {
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
              margin-top: 8px;
          }

          .village-guest-dock-editor {
              display: flex;
              flex-direction: column;
              gap: 6px;
              margin-top: 8px;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              color: #365136;
          }

          .village-guest-dock-editor textarea {
              width: 100%;
              resize: vertical;
              min-height: 128px;
              border: 1px solid rgba(126, 164, 106, 0.85);
              border-radius: 7px;
              padding: 8px 9px;
              background: rgba(250, 255, 235, 0.94);
              color: #27412c;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              line-height: 1.5;
          }

          .village-guest-dock-list {
              display: flex;
              flex-direction: column;
              gap: 8px;
              margin-top: 10px;
          }

          .village-guest-dock-item {
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 10px;
              padding: 8px 9px;
              border: 1px solid rgba(216, 124, 92, 0.42);
              border-radius: 8px;
              background: rgba(255, 245, 236, 0.84);
              color: #5c3528;
              font-family: 'Space Mono', monospace;
              font-size: 10px;
          }

          .village-guest-dock-item strong {
              display: block;
              font-size: 11px;
              color: #7f3f2a;
              margin-bottom: 3px;
          }

          .village-guest-dock-item span,
          .village-guest-dock-item em {
              display: block;
              font-style: normal;
              line-height: 1.45;
          }

          .village-guest-dock-item-actions {
              display: flex;
              flex-direction: column;
              gap: 6px;
          }

          .village-guest-dock-remove {
              flex-shrink: 0;
              border: 1px solid rgba(196, 110, 82, 0.62);
              border-radius: 6px;
              background: rgba(255, 232, 223, 0.95);
              color: #7d3f2a;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              padding: 6px 8px;
              cursor: pointer;
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
          .village-agent-proof,
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

          .village-mirofish-connection-list {
              margin-top: 6px;
              display: flex;
              flex-direction: column;
              gap: 5px;
          }

          .village-mirofish-connection-btn {
              width: 100%;
              text-align: left;
              border: 1px solid rgba(126, 164, 106, 0.75);
              border-radius: 4px;
              background: rgba(240, 252, 211, 0.72);
              padding: 5px 6px;
              color: #315533;
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              display: flex;
              flex-direction: column;
              gap: 2px;
              cursor: pointer;
          }

          .village-mirofish-connection-btn:hover {
              background: rgba(228, 248, 191, 0.92);
              border-color: rgba(112, 160, 92, 0.9);
          }

          .village-mirofish-connection-btn strong {
              color: #294a2d;
              font-size: 10px;
          }

          .village-mirofish-connection-btn span {
              color: #4d734f;
          }

          .village-mirofish-connection-btn em {
              color: #567255;
              font-style: normal;
              opacity: 0.88;
              line-height: 1.35;
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
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 8px;
          }

          .village-agent-log-item:hover {
              background: rgba(230, 246, 191, 0.8);
          }

          .village-agent-log-item em {
              font-style: normal;
              color: #4d6d45;
              font-size: 9px;
              opacity: 0.92;
          }

          .village-agent-proof {
              display: flex;
              flex-direction: column;
              gap: 4px;
          }

          .village-conway-card {
              border: 1px solid #7ea46a;
              background: rgba(247, 255, 226, 0.74);
              border-radius: 6px;
              padding: 6px 8px;
              display: flex;
              flex-direction: column;
              gap: 6px;
          }

          .village-agent-proof-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 8px;
              font-size: 10px;
          }

          .village-agent-proof-row strong {
              max-width: 56%;
              text-align: right;
              color: #2e5b31;
              overflow-wrap: anywhere;
          }

          .village-conway-input-row {
              display: flex;
              flex-direction: column;
              gap: 4px;
              font-size: 10px;
              color: #355537;
          }

          .village-conway-input-row input,
          .village-conway-input-row textarea,
          .village-conway-input-row select {
              border: 1px solid #7ea46a;
              background: rgba(255, 255, 255, 0.86);
              color: #2f4a31;
              border-radius: 4px;
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              padding: 4px 6px;
              resize: vertical;
          }

          .village-conway-action-row {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 6px;
          }

          .village-mirofish-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 6px;
          }

          .village-mirofish-file-list {
              display: flex;
              flex-wrap: wrap;
              gap: 6px;
          }

          .village-mirofish-file-pill {
              display: flex;
              align-items: center;
              gap: 6px;
              border: 1px solid rgba(126, 164, 106, 0.72);
              background: rgba(246, 255, 221, 0.82);
              border-radius: 999px;
              padding: 3px 8px;
              font-size: 10px;
              color: #355537;
              font-family: 'Space Mono', monospace;
          }

          .village-mirofish-file-pill em {
              color: #6a8a61;
              font-style: normal;
          }

          .village-mirofish-progress {
              display: flex;
              flex-direction: column;
              gap: 5px;
              font-size: 10px;
              color: #355537;
              font-family: 'Space Mono', monospace;
          }

          .village-mirofish-progress-bar {
              width: 100%;
              height: 8px;
              border-radius: 999px;
              border: 1px solid rgba(126, 164, 106, 0.72);
              background: rgba(224, 241, 183, 0.85);
              overflow: hidden;
          }

          .village-mirofish-progress-fill {
              height: 100%;
              background: linear-gradient(90deg, #89c05e, #4d8648);
              box-shadow: 0 0 10px rgba(101, 156, 87, 0.35);
          }

          .village-mirofish-progress-fill.is-blue {
              background: linear-gradient(90deg, #8dc8ff, #3d79c8);
              box-shadow: 0 0 10px rgba(61, 121, 200, 0.28);
          }

          .village-mirofish-progress-fill.is-amber {
              background: linear-gradient(90deg, #f0c86c, #c98928);
              box-shadow: 0 0 10px rgba(201, 137, 40, 0.25);
          }

          .village-conway-error {
              border: 1px solid rgba(185, 28, 28, 0.55);
              background: rgba(254, 226, 226, 0.82);
              color: #8d1414;
              border-radius: 5px;
              padding: 4px 6px;
              font-size: 10px;
              font-family: 'Space Mono', monospace;
              word-break: break-word;
          }

          .village-conway-output {
              border: 1px solid rgba(126, 164, 106, 0.75);
              border-radius: 5px;
              background: rgba(240, 252, 211, 0.62);
              padding: 5px 6px;
              display: flex;
              flex-direction: column;
              gap: 3px;
              font-size: 10px;
              color: #2e5b31;
              font-family: 'Space Mono', monospace;
              word-break: break-word;
          }

          .village-conway-output span {
              white-space: pre-wrap;
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
              position: relative;
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

          .village-canvas-wrap.is-sector-loading {
              cursor: progress;
          }

          .village-canvas-wrap.is-map-loading {
              cursor: progress;
          }

          .village-map-loading-screen {
              margin: 32px auto;
              min-height: 220px;
              max-width: 780px;
              width: min(92vw, 780px);
              border: 2px solid #84ab6f;
              border-radius: 12px;
              background:
                linear-gradient(180deg, rgba(236, 248, 216, 0.98), rgba(218, 236, 189, 0.98)),
                repeating-linear-gradient(
                  0deg,
                  rgba(112, 154, 83, 0.08) 0px,
                  rgba(112, 154, 83, 0.08) 1px,
                  transparent 1px,
                  transparent 6px
                );
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 14px;
              text-align: center;
              box-shadow: 0 10px 24px rgba(30, 56, 29, 0.18);
          }

          .village-map-loading-title {
              font-family: 'Press Start 2P', cursive;
              font-size: 12px;
              color: #345a34;
              letter-spacing: 0.8px;
          }

          .village-map-loading-subtitle {
              font-family: 'Space Mono', monospace;
              font-size: 13px;
              color: #4f6f49;
              letter-spacing: 0.25px;
          }

          .village-map-loading-dots {
              display: inline-flex;
              align-items: center;
              gap: 8px;
          }

          .village-map-loading-dots > span {
              width: 10px;
              height: 10px;
              border-radius: 2px;
              border: 1px solid #5f8f52;
              background: #8bcf61;
              box-shadow: 0 2px 6px rgba(31, 79, 24, 0.22);
              animation: villageMapLoadingDot 0.9s steps(2, end) infinite;
          }

          .village-map-loading-dots > span:nth-child(2) {
              animation-delay: 0.18s;
          }

          .village-map-loading-dots > span:nth-child(3) {
              animation-delay: 0.36s;
          }

          .village-map-loading-overlay {
              position: absolute;
              inset: 0;
              z-index: 10;
              pointer-events: none;
              display: flex;
              align-items: center;
              justify-content: center;
              background:
                linear-gradient(180deg, rgba(10, 22, 12, 0.28), rgba(10, 22, 12, 0.52)),
                repeating-linear-gradient(
                  90deg,
                  rgba(181, 215, 131, 0.06) 0px,
                  rgba(181, 215, 131, 0.06) 2px,
                  transparent 2px,
                  transparent 8px
                );
          }

          .village-map-loading-overlay-box {
              display: grid;
              gap: 6px;
              border: 2px solid #8aba73;
              border-radius: 8px;
              padding: 10px 14px;
              background: rgba(14, 33, 30, 0.9);
              color: #d7f4c4;
              text-align: center;
              box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34);
              font-family: 'Press Start 2P', cursive;
              font-size: 9px;
              letter-spacing: 0.5px;
          }

          .village-map-loading-overlay-box > span {
              font-family: 'Space Mono', monospace;
              font-size: 12px;
              letter-spacing: 0.2px;
          }

          .village-sector-loading {
              position: absolute;
              inset: 0;
              z-index: 8;
              pointer-events: none;
              display: flex;
              align-items: center;
              justify-content: center;
              background:
                radial-gradient(circle at 50% 48%, rgba(9, 24, 24, 0.08), rgba(7, 16, 16, 0.56) 48%, rgba(4, 10, 10, 0.84) 100%),
                repeating-linear-gradient(
                  90deg,
                  rgba(178, 214, 140, 0.07) 0px,
                  rgba(178, 214, 140, 0.07) 2px,
                  transparent 2px,
                  transparent 8px
                );
              animation: villageRegionLoadPulse .22s ease-out infinite alternate;
          }

          .village-sector-loading > span {
              border: 2px solid #8aba73;
              background: rgba(14, 33, 30, 0.92);
              color: #d7f4c4;
              border-radius: 8px;
              padding: 10px 14px;
              font-family: 'Press Start 2P', cursive;
              font-size: 9px;
              letter-spacing: 0.5px;
              box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34);
          }

          @keyframes villageMapLoadingDot {
              0%,
              100% {
                transform: translateY(0px);
                opacity: 0.6;
              }
              50% {
                transform: translateY(-2px);
                opacity: 1;
              }
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

          .village-live-chat-window {
              position: fixed;
              right: 10px;
              top: 168px;
              z-index: 24;
              width: min(340px, calc(100% - 20px));
              display: flex;
              flex-direction: column;
              gap: 8px;
              padding: 10px 10px 11px;
              border: 1px solid rgba(240, 185, 11, 0.38);
              border-radius: 10px;
              background:
                linear-gradient(180deg, rgba(20, 23, 17, 0.94), rgba(11, 13, 10, 0.94)),
                repeating-linear-gradient(
                  90deg,
                  rgba(240, 185, 11, 0.035) 0px,
                  rgba(240, 185, 11, 0.035) 1px,
                  transparent 1px,
                  transparent 8px
                );
              box-shadow: 0 14px 28px rgba(10, 18, 10, 0.34), inset 0 1px 0 rgba(255,255,255,0.04);
              color: #e6f0ca;
              pointer-events: auto;
          }

          .village-live-chat-header {
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 10px;
          }

          .village-live-chat-header strong {
              display: block;
              font-family: 'Press Start 2P', cursive;
              font-size: 9px;
              color: #f0c95d;
              margin-bottom: 4px;
          }

          .village-live-chat-header span,
          .village-live-chat-summary,
          .village-live-chat-item-head span,
          .village-live-chat-item-head time,
          .village-live-chat-item-text {
              font-family: 'Space Mono', monospace;
          }

          .village-live-chat-header span {
              display: block;
              color: rgba(230, 240, 202, 0.72);
              font-size: 10px;
              line-height: 1.45;
          }

          .village-live-chat-header em {
              flex-shrink: 0;
              padding: 4px 7px;
              border: 1px solid rgba(240, 185, 11, 0.52);
              border-radius: 999px;
              background: rgba(240, 185, 11, 0.12);
              color: #f0b90b;
              font-style: normal;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
          }

          .village-live-chat-header em.is-ai {
              border-color: rgba(118, 223, 150, 0.56);
              background: rgba(49, 98, 60, 0.18);
              color: #baf5c5;
          }

          .village-live-chat-header em.is-fallback {
              border-color: rgba(255, 132, 105, 0.52);
              background: rgba(93, 37, 29, 0.22);
              color: #ffd0c2;
          }

          .village-live-chat-summary {
              padding: 7px 8px;
              border: 1px solid rgba(240, 185, 11, 0.14);
              border-radius: 7px;
              background: rgba(240, 185, 11, 0.045);
              color: #eef8d8;
              font-size: 10px;
              line-height: 1.45;
          }

          .village-live-chat-list {
              display: flex;
              flex-direction: column;
              gap: 6px;
              max-height: 252px;
              overflow: hidden;
          }

          .village-live-chat-item {
              padding: 7px 8px;
              border-radius: 8px;
              border: 1px solid rgba(240, 185, 11, 0.12);
              background: rgba(255, 248, 211, 0.045);
          }

          .village-live-chat-item.is-risk {
              border-color: rgba(224, 120, 74, 0.32);
              background: rgba(184, 78, 45, 0.14);
          }

          .village-live-chat-item.is-watch {
              border-color: rgba(118, 162, 201, 0.28);
              background: rgba(57, 90, 133, 0.14);
          }

          .village-live-chat-item.is-alpha {
              border-color: rgba(240, 185, 11, 0.3);
              background: rgba(147, 113, 13, 0.16);
          }

          .village-live-chat-item-head {
              display: grid;
              grid-template-columns: minmax(0, auto) minmax(0, 1fr) auto;
              gap: 8px;
              align-items: center;
              margin-bottom: 4px;
              font-size: 9px;
          }

          .village-live-chat-item-head strong {
              color: #f6ffea;
              font-size: 10px;
          }

          .village-live-chat-item-head span {
              color: rgba(214, 239, 184, 0.72);
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
          }

          .village-live-chat-item-head time {
              color: rgba(214, 239, 184, 0.58);
              font-size: 9px;
          }

          .village-live-chat-item-text {
              color: #eef8d8;
              font-size: 10px;
              line-height: 1.48;
          }

          .village-live-chat-footer {
              display: flex;
              flex-direction: column;
              gap: 8px;
          }

          .village-live-chat-footer span {
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              line-height: 1.45;
              color: rgba(230, 240, 202, 0.72);
          }

          .village-live-chat-cta {
              align-self: flex-start;
              border: 1px solid rgba(240, 185, 11, 0.42);
              border-radius: 7px;
              background: linear-gradient(180deg, rgba(240, 185, 11, 0.18), rgba(116, 85, 5, 0.22));
              color: #fff0b5;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              line-height: 1.4;
              padding: 8px 10px;
              cursor: pointer;
          }

          .village-live-chat-cta:disabled {
              opacity: 0.48;
              cursor: default;
          }

          .village-map-overlay-dock {
              position: absolute;
              left: 10px;
              top: 10px;
              z-index: 7;
              width: min(380px, calc(100% - 20px));
              display: flex;
              flex-direction: column;
              gap: 8px;
              pointer-events: none;
          }

          .village-map-overlay-top {
              display: flex;
              align-items: stretch;
              gap: 8px;
              width: 100%;
          }

          .village-play-hud {
              width: 100%;
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

          .village-play-energy {
              margin-top: 4px;
              display: grid;
              grid-template-columns: auto 1fr auto;
              align-items: center;
              gap: 6px;
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              color: #38593a;
          }

          .village-play-energy-track {
              height: 8px;
              border: 1px solid #759e67;
              border-radius: 999px;
              background: rgba(255, 255, 255, 0.58);
              overflow: hidden;
          }

          .village-play-energy-fill {
              height: 100%;
              background: linear-gradient(90deg, #ef8f4a, #eec85d 38%, #7cb15a 70%, #5f9c4c 100%);
              transition: width .16s linear;
          }

          .village-play-energy-rpg {
              margin-top: 3px;
          }

          .village-play-energy-fill-hp {
              background: linear-gradient(90deg, #ff6f6f, #ff9a6b 40%, #ffd98a 100%);
          }

          .village-play-energy-fill-mp {
              background: linear-gradient(90deg, #4d7dff, #62a7ff 45%, #8ee7ff 100%);
          }

          .village-play-energy-fill-xp {
              background: linear-gradient(90deg, #b06eff, #d896ff 46%, #ffe184 100%);
          }

          .village-play-energy em {
              font-style: normal;
              font-size: 10px;
              color: #2f4f32;
          }

          .village-play-hud-hint {
              margin-top: 5px;
              padding: 4px 6px;
              border-radius: 5px;
              border: 1px dashed rgba(108, 150, 90, 0.55);
              background: rgba(255,255,255,0.44);
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              color: #3a5c3b;
              line-height: 1.35;
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

          .village-hud-toggle-btn {
              pointer-events: auto;
              cursor: pointer;
              border: 1px solid #6f975f;
              border-radius: 8px;
              background: linear-gradient(180deg, rgba(242, 255, 219, 0.96), rgba(218, 238, 171, 0.94));
              color: #2f4d33;
              display: flex;
              flex-direction: column;
              justify-content: center;
              gap: 4px;
              min-width: 122px;
              padding: 7px 8px;
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.44), 0 6px 16px rgba(53, 80, 42, 0.2);
              text-align: left;
              flex: 1;
          }

          .village-hud-toggle-btn span {
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              line-height: 1.45;
          }

          .village-hud-toggle-btn strong {
              font-family: 'Space Mono', monospace;
              font-size: 11px;
          }

          .village-hud-toggle-btn:hover {
              filter: brightness(1.03);
              transform: translateY(-1px);
          }

          .village-fixed-vitals {
              width: min(240px, 100%);
              border: 1px solid #6f975f;
              border-radius: 8px;
              background: linear-gradient(180deg, rgba(248, 255, 232, 0.96), rgba(228, 244, 188, 0.94));
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.44), 0 6px 16px rgba(53, 80, 42, 0.2);
              color: #2f4d33;
              padding: 7px 8px;
              pointer-events: none;
          }

          .village-fixed-vitals-head {
              display: flex;
              align-items: center;
              justify-content: space-between;
              margin-bottom: 6px;
          }

          .village-fixed-vitals-head span {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
          }

          .village-fixed-vitals-head strong {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
          }

          .village-fixed-vitals-row {
              display: grid;
              grid-template-columns: auto 1fr auto;
              align-items: center;
              gap: 6px;
              margin-top: 4px;
          }

          .village-fixed-vitals-row > span {
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              min-width: 18px;
          }

          .village-fixed-vitals-row > em {
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              font-style: normal;
              color: #315034;
          }

          .village-fixed-vitals-track {
              height: 9px;
              border: 1px solid #759e67;
              border-radius: 999px;
              background: rgba(255,255,255,0.58);
              overflow: hidden;
          }

          .village-fixed-vitals-fill {
              height: 100%;
              transition: width .14s linear;
          }

          .village-fixed-vitals-fill.is-hp {
              background: linear-gradient(90deg, #ff6f6f, #ff9a6b 40%, #ffd98a 100%);
          }

          .village-fixed-vitals-fill.is-mp {
              background: linear-gradient(90deg, #4d7dff, #62a7ff 45%, #8ee7ff 100%);
          }

          .village-action-brief-hint {
              position: fixed;
              right: 10px;
              top: 96px;
              z-index: 25;
              border: 1px solid rgba(240, 185, 11, 0.46);
              border-radius: 8px;
              background:
                linear-gradient(180deg, rgba(20, 23, 17, 0.96), rgba(11, 13, 10, 0.95)),
                repeating-linear-gradient(
                  90deg,
                  rgba(240, 185, 11, 0.045) 0px,
                  rgba(240, 185, 11, 0.045) 1px,
                  transparent 1px,
                  transparent 8px
                );
              color: #f6e7ac;
              padding: 8px 10px 9px;
              min-width: min(340px, calc(100% - 20px));
              max-width: min(340px, calc(100% - 20px));
              display: flex;
              flex-direction: column;
              gap: 4px;
              box-shadow: 0 12px 24px rgba(20, 18, 7, 0.24);
              cursor: pointer;
              pointer-events: auto;
              text-align: left;
          }

          .village-action-brief-hint span {
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              color: rgba(240, 185, 11, 0.92);
          }

          .village-action-brief-hint strong {
              font-family: 'Press Start 2P', cursive;
              font-size: 9px;
              line-height: 1.5;
              color: #fff1b8;
          }

          .village-action-brief-hint em {
              font-style: normal;
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              color: rgba(230, 240, 202, 0.74);
          }

          .village-action-brief-hint:hover {
              filter: brightness(1.03);
              transform: translateY(-1px);
          }

          .village-action-brief-hint.is-disabled {
              opacity: 0.55;
              cursor: default;
          }

          .village-top-dock {
              position: fixed;
              left: 12px;
              top: 12px;
              z-index: 108;
              width: min(360px, calc(100vw - 24px));
              display: flex;
              flex-direction: column;
              gap: 8px;
              pointer-events: auto;
          }

          .village-top-dock-toggle {
              border: 1px solid rgba(126, 164, 106, 0.96);
              border-radius: 8px;
              background: linear-gradient(180deg, rgba(246, 255, 223, 0.96), rgba(229, 246, 184, 0.96));
              color: #355537;
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.45), 0 6px 14px rgba(59,87,50,0.18);
              padding: 7px 10px;
              cursor: pointer;
              text-align: left;
              display: grid;
              gap: 3px;
          }

          .village-top-dock-toggle span {
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              letter-spacing: .04em;
              opacity: 0.92;
          }

          .village-top-dock-toggle strong {
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              line-height: 1.2;
          }

          .village-top-dock-toggle.is-open {
              border-color: rgba(236, 193, 70, 0.95);
          }

          .village-top-left-actions {
              display: inline-flex;
              align-items: stretch;
              flex-direction: column;
              gap: 8px;
              max-height: min(72vh, 640px);
              overflow: auto;
              padding-right: 2px;
              pointer-events: auto;
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
              pointer-events: auto;
              max-width: none;
              width: 100%;
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

          @keyframes villageRegionLoadPulse {
              from {
                  opacity: 0.9;
              }
              to {
                  opacity: 1;
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

          .village-agent-chat-panel {
              display: flex;
              flex-direction: column;
              gap: 8px;
          }

          .village-agent-chat-title-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 8px;
              margin-bottom: 5px;
          }

          .village-agent-chat-source {
              flex-shrink: 0;
              padding: 4px 7px;
              border-radius: 999px;
              border: 1px solid rgba(124, 157, 95, 0.5);
              background: rgba(241, 250, 217, 0.72);
              color: #4f6f4f;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              line-height: 1;
          }

          .village-agent-chat-source.is-ai {
              border-color: rgba(98, 175, 116, 0.55);
              background: rgba(201, 242, 210, 0.78);
              color: #1f6d36;
          }

          .village-agent-chat-source.is-fallback {
              border-color: rgba(224, 143, 92, 0.46);
              background: rgba(255, 229, 213, 0.82);
              color: #8f4a21;
          }

          .village-agent-chat-source.is-seed {
              border-color: rgba(126, 164, 106, 0.46);
              background: rgba(241, 250, 217, 0.72);
              color: #4f6f4f;
          }

          .village-agent-chat-thread {
              display: flex;
              flex-direction: column;
              gap: 6px;
              max-height: 220px;
              overflow: auto;
              padding-right: 4px;
          }

          .village-agent-chat-turn {
              border-radius: 8px;
              padding: 7px 8px;
              border: 1px solid rgba(122, 161, 98, 0.48);
              background: rgba(255, 255, 255, 0.52);
          }

          .village-agent-chat-turn.is-user {
              border-color: rgba(92, 145, 212, 0.45);
              background: rgba(216, 236, 255, 0.5);
          }

          .village-agent-chat-turn.is-npc {
              border-color: rgba(240, 185, 11, 0.42);
              background: rgba(255, 246, 208, 0.5);
          }

          .village-agent-chat-turn.is-system {
              border-style: dashed;
              background: rgba(244, 253, 216, 0.65);
          }

          .village-agent-chat-turn-head {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 8px;
              margin-bottom: 4px;
              font-size: 10px;
          }

          .village-agent-chat-turn-head strong {
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              color: #38563a;
          }

          .village-agent-chat-turn-head span {
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              color: #607c61;
          }

          .village-agent-chat-turn-text {
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              line-height: 1.6;
              color: #2f4f34;
              white-space: pre-wrap;
          }

          .village-agent-chat-empty {
              border: 1px dashed rgba(122, 161, 98, 0.54);
              border-radius: 8px;
              padding: 9px;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              line-height: 1.5;
              color: #537157;
              background: rgba(248, 255, 232, 0.74);
          }

          .village-agent-chat-compose {
              display: flex;
              flex-direction: column;
              gap: 6px;
          }

          .village-agent-chat-input {
              width: 100%;
              resize: vertical;
              min-height: 70px;
              border-radius: 8px;
              border: 1px solid rgba(117, 155, 92, 0.72);
              background: rgba(255, 255, 255, 0.78);
              color: #2e4b31;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              line-height: 1.5;
              padding: 8px 9px;
              box-sizing: border-box;
          }

          .village-agent-chat-compose-foot {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
          }

          .village-agent-chat-compose-foot span {
              font-family: 'Space Mono', monospace;
              font-size: 10px;
              color: #607c61;
              line-height: 1.5;
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

          .village-agent-profile-verify {
              border: 1px solid rgba(121, 158, 98, 0.9);
              border-radius: 8px;
              background: linear-gradient(180deg, rgba(250, 255, 235, 0.92), rgba(234, 247, 206, 0.9));
              padding: 9px 10px;
              margin-top: 9px;
          }

          .village-agent-verify-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 8px;
              color: #2f4e36;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              margin-top: 4px;
          }

          .village-agent-verify-badge {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              min-width: 68px;
              padding: 2px 8px;
              border-radius: 999px;
              font-family: 'Press Start 2P', cursive;
              font-size: 7px;
              border: 1px solid #7b9f6a;
              background: rgba(255, 255, 255, 0.7);
              color: #3a5e3d;
          }

          .village-agent-verify-badge.is-pending {
              border-color: #b48d4a;
              color: #6e4e1d;
              background: rgba(255, 241, 207, 0.9);
          }

          .village-agent-verify-badge.is-verified {
              border-color: #5f9158;
              color: #295631;
              background: rgba(219, 249, 206, 0.9);
          }

          .village-agent-verify-badge.is-missing,
          .village-agent-verify-badge.is-skipped {
              border-color: #7f8d8a;
              color: #45534f;
              background: rgba(228, 236, 233, 0.9);
          }

          .village-agent-verify-badge.is-failed {
              border-color: #b06d62;
              color: #6e2f24;
              background: rgba(255, 221, 214, 0.9);
          }

          .village-agent-verify-detail {
              margin-top: 5px;
              color: #3a593f;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              line-height: 1.55;
          }

          .village-agent-verify-owner {
              margin-top: 4px;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              color: #2f4f33;
          }

          .village-agent-verify-link {
              margin-top: 6px;
              display: inline-flex;
              align-items: center;
              gap: 6px;
              text-decoration: none;
              font-family: 'Space Mono', monospace;
              font-size: 11px;
              color: #2d6440;
          }

          .village-agent-verify-link:hover {
              text-decoration: underline;
          }

          .village-agent-verify-actions {
              margin-top: 8px;
              display: flex;
              justify-content: flex-end;
          }

          .village-agent-verify-btn {
              border: 1px solid #6f975f;
              background: linear-gradient(180deg, rgba(238, 250, 208, 0.95), rgba(211, 236, 159, 0.95));
              color: #28452c;
              font-family: 'Press Start 2P', cursive;
              font-size: 8px;
              padding: 7px 10px;
              cursor: pointer;
          }

          .village-agent-verify-btn:disabled {
              opacity: 0.72;
              cursor: not-allowed;
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

              .village-header-actions {
                  width: 100%;
                  justify-content: flex-start;
              }

              .village-header-btn {
                  font-size: 7px;
                  padding: 5px 7px;
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

              .village-map-overlay-dock {
                  left: 8px;
                  top: 8px;
                  width: min(320px, calc(100% - 16px));
                  gap: 6px;
              }

              .village-map-overlay-top {
                  gap: 6px;
              }

              .village-play-hud {
                  width: 100%;
              }

              .village-fixed-vitals {
                  width: min(210px, 100%);
                  padding: 6px 7px;
              }

              .village-hud-toggle-btn {
                  min-width: 96px;
                  padding: 6px 7px;
              }

              .village-fixed-vitals-row > em {
                  font-size: 9px;
              }

              .village-action-brief-hint {
                  right: 8px;
                  top: 88px;
                  min-width: min(300px, calc(100% - 16px));
                  max-width: min(300px, calc(100% - 16px));
                  padding: 6px 8px;
              }

              .village-live-chat-window {
                  right: 8px;
                  top: 156px;
                  width: min(300px, calc(100% - 16px));
                  padding: 8px;
                  gap: 6px;
              }

              .village-live-chat-list {
                  max-height: 196px;
              }

              .village-play-hud-row {
                  font-size: 10px;
              }

              .village-play-hud-row strong {
                  font-size: 7px;
              }

              .village-play-energy {
                  grid-template-columns: 1fr;
                  gap: 3px;
                  font-size: 9px;
              }

              .village-play-energy em {
                  justify-self: end;
              }

              .village-play-hud-hint {
                  font-size: 9px;
              }

              .village-top-dock {
                  left: 8px;
                  top: 8px;
                  width: min(320px, calc(100vw - 16px));
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

              .village-live-chat-window {
                  width: min(100%, calc(100% - 12px));
                  right: 6px;
                  top: 154px;
              }

              .village-action-brief-hint {
                  right: 6px;
                  top: 84px;
                  min-width: 0;
                  max-width: min(100%, calc(100% - 12px));
              }

              .village-top-dock {
                  left: 6px;
                  top: 6px;
                  width: min(294px, calc(100vw - 12px));
              }

              .testmap-farm-fx-layer {
                  display: none;
              }
          }
      `}</style>
    </div>
  );
}

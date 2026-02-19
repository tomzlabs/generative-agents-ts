# Generative Agents TS（AI 小镇 / AITown）

- 中文文档：`README.md`（本文件）
- English: `README.en.md`（当前内容较旧，建议以中文文档为准）

这是一个基于 **TypeScript + React + Vite** 的像素风小镇项目，目标是把：

- 可探索地图（Map）
- RPG 玩法循环（战斗 / 升级 / 任务）
- 链上农场（购买土地/种子、种植、收获、升级、开奖）
- NFA 资产与 Runtime

整合到同一个 Web 应用中。

---

## 当前状态（2026-02）

项目已进入可玩阶段，核心流程可跑通：

- 主地图 `Map`：可操控角色 + 无限探索 + NPC/NFT Agent 活动 + RPG 战斗
- 农场 `Farm`：已接入链上合约读写（BSC）
- 开奖页 `Lottery`：可查看奖池、历史轮次、个人彩票编号
- `My NFA`：旧合约模式运行（legacy pinned）
- 全站中英双语（导航切换）

---

## 功能总览

### 1) Map（`/map`）

主地图是当前核心可玩区域，已支持：

- Canvas 渲染 Tiled 地图
- 可操控角色（键盘/点地寻路）
- 无限探索区块（跨边缘进入新区）
- 三地貌与季节融合（森林/沙地/雪地）
- NPC + NFT Agent 自动行走与对话
- RPG 战斗循环：
  - 怪物刷新、追击、攻击
  - 玩家攻击（`F`）
  - 掉落金币/经验
  - 升级成长（HP/MP/ATK/DEF）
  - RPG 任务推进与奖励
- 角色编辑器：
  - 模板角色（sprite）模式
  - 像素自定义模式（发型/肤色/发色/服装/配件）
  - 名字与外观可持久化

### 2) Farm（`/farm`）

`/farm` 目前是地图内嵌农场模式（`VillageMap mode="test"`），并已接链：

- 钱包连接后读取链上土地与作物状态
- 购买土地 `purchaseLand`
- 购买种子 `purchaseSeed`
- 种植 `plantSeed`
- 收获 `harvestSeed`
- 升级 `levelUp`
- 奖池余额与钱包代币显示
- 成熟倒计时、经验进度、玩法指南弹窗

历史版本保留：`/farm-legacy`（旧农场页面）

### 3) Lottery（`/lottery`）

- 显示奖池（合约余额）
- 显示当前轮次与开奖状态
- 轮次历史（中奖号码、赢家）
- 当前钱包“本期彩票编号”扫描展示
- 开奖倒计时展示

### 4) Mint（`/nft`）

- NFT 铸造入口
- 展示最近铸造与当前钱包持仓

### 5) My NFA（`/my-nfa`）

- NFA 持仓扫描
- Runtime 配置面板
- 旧合约模式（legacy）运行支持
- 像素头像编辑并同步到地图展示

---

## 地图操作说明（`/map`）

- 移动：`WASD` / 方向键
- 冲刺：`Shift`
- 攻击：`F`（有冷却）
- 互动：`E`
- 点地：自动前往目标点
- 跨边缘：自动进入新区块继续探索

---

## 路由

- `/map`：主地图（RPG + AI 小镇）
- `/farm`：农场（地图集成链上模式）
- `/farm-legacy`：旧农场页面（保留）
- `/lottery`：开奖页
- `/nft`：铸造页
- `/my-nfa`：我的 NFA
- `/whitepaper`：白皮书

---

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

```bash
cp .env.example .env.local
```

`.env.local`：

- `VITE_FARM_ADDRESS`：Farm 合约地址
- `VITE_TOKEN_ADDRESS`：ERC20 代币地址
- `VITE_BSC_RPC_URL`：BSC RPC（当前默认 `https://bsc-rpc.publicnode.com/`）

### 3) 启动开发

```bash
npm run dev
```

### 4) 构建与预览

```bash
npm run build
npm run preview
```

---

## 合约与链配置

配置文件：`src/config/chain.ts`

- NFA 地址：按产品决策固定旧合约（legacy pinned）
- Farm 地址：可由 `VITE_FARM_ADDRESS` 覆盖
- Token 地址：可由 `VITE_TOKEN_ADDRESS` 覆盖
- RPC：当前单节点模式（`VITE_BSC_RPC_URL`）

Farm/Lottery/Map 的 Farm ABI 使用统一文件：

- `src/assets/abi.json`
- `src/config/farmAbi.ts`

---

## 主要目录

- `src/components/Map/VillageMap.tsx`：主地图、RPG、农场集成逻辑（核心）
- `src/pages/TestMapPage.tsx`：`/farm` 路由入口
- `src/pages/FarmingPage.tsx`：旧农场页面（`/farm-legacy`）
- `src/pages/LotteryPage.tsx`：开奖页
- `src/pages/MyNFAPage.tsx`：NFA 与 Runtime
- `src/pages/MintPage.tsx`：Mint 页面
- `src/config/chain.ts`：链配置
- `src/config/farmAbi.ts`：Farm ABI 导出
- `src/core/assets/*`：tilemap 加载和渲染工具

---

## 本地存档（节选）

地图与玩法会写入 `localStorage`（例如世界状态、角色状态、挑战进度等），常见 key 包括：

- `ga:map:world-v2`
- `ga:map:play-highscore-v1`
- `ga:map:nft-layout-v1`
- `ga:map:farm-v1` / `ga:map:farm-game-v1`

---

## 下一步计划（Roadmap）

1. 角色系统继续扩展：职业/装备槽/外观预设
2. RPG 深化：技能树、Boss、掉落体系
3. 地图事件化：区域任务、剧情触发、稀有事件
4. 链上索引优化：减少 `ownerOf` 扫描压力（事件索引/子图）
5. 包体优化：按页面拆包，降低主包体积

---

## 安全提示

- 不要提交私钥、助记词、API Key
- 仅在 `.env.local` 或部署平台环境变量中配置敏感信息
- 链上操作前确认网络、合约地址与授权额度

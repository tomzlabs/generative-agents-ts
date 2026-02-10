# Generative Agents TS（AI 小镇 + 链上农场）

- 中文版：`README.md`（本文件）
- English: [README.en.md](./README.en.md)

这是一个基于 **TypeScript + React + Vite** 的 AI 小镇项目。当前重点是把「地图可视化、NFA 资产管理、农场玩法、链上接入预留」整合到同一个网页应用里。

---

## 当前状态（2026-02）

项目已经从“资源验证阶段”进入“可交互产品阶段”：

- 已有多页面应用（Map / Farm / Mint / My NFA / Whitepaper）
- 地图已支持 Canvas 渲染 + NPC 动态显示
- 农场已有完整 3x3 交互循环（种植/生长/收获/升级）
- My NFA 已支持 Runtime 配置面板与旧/新合约模式说明
- 全站视觉正在统一为像素风设计系统（`ga-*`）

---

## 我们现在在做什么

### 1) 视觉统一（进行中）

正在把页面统一到同一套像素 UI token：

- 卡片：`ga-card-surface`
- 按钮：`ga-btn`
- 信息块：`ga-chip`
- 表单：`ga-label` / `ga-input` / `ga-select` / `ga-textarea`

目前已完成：

- `Map` 页面
- `Farm` 页面
- `My NFA` 页面（含 Runtime 面板与弹窗表单）

### 2) 链上交互落地（进行中）

- Farm 页面已接入钱包代币持仓读取（ERC20 `balanceOf / symbol / decimals`）
- Farm 动作已保留 `submitFarmIntentToContract` 合约钩子（待接 ABI/合约）
- My NFA Runtime 面板支持旧合约（legacy）与新合约参数模式

### 3) 体验与稳定性（进行中）

- 顶部导航移动端适配与滚动行为优化
- Map 渲染加入安全缩放上限，避免大画布导致空白
- 继续优化移动端表单、卡片密度和交互反馈

---

## 已有功能

### Map（`/map`）

- 加载并渲染 Tiled `tilemap.json`
- 多图层过滤渲染（隐藏调试层）
- NPC（含特殊角色）自动移动与气泡文本
- 缩放控制 + 渲染稳定性保护
- 合约地址展示与一键复制

### Farm（`/farm`）

- 3x3 农田网格交互
- 三种作物（`WHEAT/CORN/CARROT`）+ 生长阶段（`SEED/SPROUT/MATURE/RIPE`）
- 点击种植、成熟收获、一键收获、经验升级
- 本地存档（地块和玩家资料）
- 链上代币持仓展示（钱包连接后读取）

### Mint（`/nft`）

- 链上资产入口页（Mint 流程）

### My NFA（`/my-nfa`）

- 钱包持仓 NFA 扫描与展示
- Runtime 配置面板（RPC / 合约地址 / Agent ID / Logic / Executor / Message）
- Legacy 模式与新模式并存说明
- Agent 元数据编辑与 BAP-578 相关控制操作入口

---

## 快速开始

### 1) 安装

```bash
npm install
```

### 2) 配置环境变量

```bash
cp .env.example .env.local
```

`.env.local` 关键项：

- `VITE_NFA_ADDRESS`
- `VITE_FARM_ADDRESS`
- `VITE_TOKEN_ADDRESS`
- `VITE_BSC_RPC_URL`

### 3) 启动开发

```bash
npm run dev
```

默认本地地址通常是：

- <http://127.0.0.1:5173/>

### 4) 构建

```bash
npm run build
npm run preview
```

---

## 页面路由

- `/map`：AI 小镇地图
- `/farm`：链上农场玩法页
- `/nft`：Mint 页面
- `/my-nfa`：我的 NFA 与 Runtime 配置
- `/whitepaper`：白皮书

---

## 目录结构（当前）

- `src/components/Map/VillageMap.tsx`：地图渲染与 NPC
- `src/pages/FarmingPage.tsx`：农场核心交互页
- `src/pages/MyNFAPage.tsx`：NFA 管理 + Runtime 面板
- `src/components/Navigation.tsx`：全站导航
- `src/config/chain.ts`：链配置与环境变量入口
- `src/core/assets/*`：tilemap 加载与渲染工具
- `public/static/assets/*`：地图、农场、NPC、NFT 资源

---

## 接下来（Roadmap）

1. **Farm 真正上链**：将本地 `FarmIntent` 与真实合约 ABI 对接（种植/收获/经验）
2. **NFA 扫描优化**：从 `ownerOf` 轮询逐步升级为事件索引或子图方案
3. **跨页面状态统一**：钱包、链状态、资产缓存抽到统一 store
4. **性能优化**：拆包（code splitting）与静态资源缓存策略（解决大 bundle 警告）

---

## 安全说明

- 不要把私钥、API Key 提交到仓库
- 仅在 `.env.local` 或部署平台环境变量中配置敏感信息
- 链上执行前请确认网络、合约地址和钱包权限

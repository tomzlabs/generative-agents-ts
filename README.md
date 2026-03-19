# Binance AI Town

`Binance AI Town` 是一个基于 `TypeScript + React + Vite` 的像素风 Web 应用。  
它把一个可探索的小镇地图、BSC 市场状态、MiroFish 图谱人物、办公室协作场景和 AI 对话整合到了同一个前端里。

当前版本的核心目标不是“做一个静态展示页”，而是把这些能力揉成一个能交互的世界：

- 地图上的 NPC 会讨论 `BNB / BSC / Skills / 图谱`
- 图谱节点会变成地图里可点击的人
- 用户可以把“本地龙虾”接进办公室
- 地图和办公室的实时对话都可以走 AI

---

## 当前产品结构

### 1. 首页 `/`

首页是产品入口，展示当前品牌和导航入口。

- `Market`：主地图
- `Office`：龙虾办公室
- `More`：其他页面入口
- 钱包连接：用于链上资产和 NFA 相关页面

### 2. 地图 `/map`

地图是当前最核心的主场景。

已接入：

- 像素小镇地图
- 玩家可控角色
- 可点击 NPC / 图谱实体
- `BSC Live Talk` 实时对话窗
- `Action Brief` 行动建议卡
- Binance 市场数据
- BSC 主网链上状态
- Binance Skills 热点
- MiroFish 图谱人物同步
- 选中 NPC 后的一对一对话

主要特点：

- 顶部是交易终端风格的 `BNB ticker bar`
- 右上角固定显示：
  - `Action Brief`
  - `BSC Live Talk`
- 图谱实体不再是简单方块，而是带人物 sprite 的角色
- 主小镇地图已去掉随机伪建筑叠加，避免建筑摆放错乱

### 3. 办公室 `/office`

办公室场景参考并接入了 `Star-Office-UI` 的视觉结构，当前已经是本项目的一部分。

已支持：

- 办公室实时对话
- 本地龙虾接入
- 可选连接 `Star Office` 后端
- 办公室成员 roster
- BSC / Skills / 市场上下文驱动的办公室讨论
- 真 AI 对话优先，失败时自动 fallback

### 4. 农场 `/farm`

`/farm` 当前仍保留链上农场入口，主要用于已有 Farm 逻辑和测试模式。

### 5. Mint `/nft`

- NFT 铸造入口
- 展示当前钱包相关信息

### 6. My NFA `/my-nfa`

- NFA 持仓扫描
- 自定义像素头像
- 地图里 NFT 相关外观同步

### 7. Whitepaper `/whitepaper`

- 当前产品说明和历史内容页

---

## 当前已接入的数据和服务

### Binance 市场数据

地图和办公室会读取公开市场数据，用来驱动：

- ticker
- 市场情绪
- NPC 实时讨论
- 行动建议

### BSC 主网状态

当前产品已经收敛为只看 `BSC`，不再强调 `opBNB`。

已用于：

- `BSC Pulse`
- `Action Brief`
- 地图和办公室对话语境

### Binance Skills

当前地图里已经把 Skills 数据变成：

- Skills Watch 信息
- Skills Missions 任务
- 地图上的任务目标点
- NPC 对话中的热点 token 讨论

### MiroFish

当前地图已接入 MiroFish 图谱流程：

- 读取 graph
- 将 graph node 生成为地图中的人物
- 点击人物查看节点资料
- 显示连接关系
- 选中图谱角色后可继续触发 AI 对话

当前默认服务端使用：

- `https://mirofish-backend-full-production.up.railway.app`

### Star Office 后端

办公室支持两种模式：

1. 本地模式  
用户在浏览器里直接接入“本地龙虾”，不依赖后端。

2. 后端同步模式  
通过 `Star Office` 后端支持：

- `/status`
- `/agents`
- `/join-agent`
- `/agent-push`
- `/leave-agent`
- `/office-chat`
- `/npc-chat`

本地开发默认代理：

- `http://127.0.0.1:19000`

生产环境通过 Vercel API route 代理：

- `/api/star-office/*`

---

## AI 对话

当前有两类 AI 对话：

### 1. 地图实时对话

位置：

- 地图右上角 `BSC Live Talk`

输入上下文：

- BNB 行情
- BSC 主网状态
- Binance Skills
- World Event
- Action Brief
- 当前地图 NPC roster

### 2. 办公室实时对话

位置：

- `/office`

输入上下文：

- 办公室成员
- BNB / BSC 状态
- Skills 热点
- 最近几条对话

### 3. NPC 一对一对话

地图里点击一个小镇人物后，可以在角色详情里和他单独对话。

当前接口：

- `POST /npc-chat`

后端会优先调用 AI，失败则回退到模板回复。

---

## 路由

- `/`：首页
- `/map`：Binance AI Town 主地图
- `/office`：龙虾办公室
- `/farm`：农场入口
- `/farm-legacy`：旧版农场
- `/nft`：Mint
- `/my-nfa`：My NFA
- `/whitepaper`：白皮书
- `/lottery`：当前重定向到 `/office`
- `/map-classic`：重定向到 `/map`
- `/rpg`：重定向到 `/map`

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

当前前端主要用到的变量：

```bash
VITE_FARM_ADDRESS=0xc2933391a475A0aad4fa94C657F4372e058DcbF9
VITE_TOKEN_ADDRESS=0x7Bf7e3F3bE243F7A3cF009A1253e8e9fbD2a1AC3
VITE_BSC_RPC_URL=https://bsc-rpc.publicnode.com/
VITE_CONWAY_PROXY_BASE=/api/conway
```

可选开发变量：

```bash
STAR_OFFICE_API_BASE=http://127.0.0.1:19000
VITE_MIROFISH_API_BASE=https://mirofish-backend-full-production.up.railway.app
```

说明：

- `STAR_OFFICE_API_BASE` 用于本地开发代理 `Star Office` 后端
- `VITE_MIROFISH_API_BASE` 可覆盖默认图谱服务

### 3. 启动开发环境

```bash
npm run dev
```

### 4. 构建

```bash
npm run build
```

### 5. 预览

```bash
npm run preview
```

---

## 本地开发代理

Vite 会把下面的请求代理到 `STAR_OFFICE_API_BASE`：

- `/api/star-office/status`
- `/api/star-office/agents`
- `/api/star-office/join-agent`
- `/api/star-office/agent-push`
- `/api/star-office/leave-agent`
- `/api/star-office/office-chat`
- `/api/star-office/npc-chat`

对应配置文件：

- `/Users/tommy/clawd/generative-agents-ts/vite.config.ts`

---

## 部署

### Vercel

项目已经包含 Vercel 路由配置：

- `/api/*` 保留给 serverless API
- 其他路径回退到 `index.html`

文件：

- `/Users/tommy/clawd/generative-agents-ts/vercel.json`

生产部署时建议配置：

```bash
STAR_OFFICE_API_BASE=https://your-star-office-backend.example.com
```

这样 `/api/star-office/*` 才能在生产环境正确代理到真实后端。

### 线上域名

当前前端线上站点：

- [https://www.aitown.club/](https://www.aitown.club/)

当前 MiroFish 后端：

- [https://mirofish-backend-full-production.up.railway.app](https://mirofish-backend-full-production.up.railway.app)

---

## 主要文件

### 核心前端

- `/Users/tommy/clawd/generative-agents-ts/src/components/Map/VillageMap.tsx`
  - 主地图
  - BSC ticker
  - Skills missions
  - 图谱实体
  - AI 地图对话

- `/Users/tommy/clawd/generative-agents-ts/src/pages/LobsterOfficePage.tsx`
  - 龙虾办公室
  - 办公室 AI 对话
  - 本地龙虾接入
  - Star Office 后端连接

- `/Users/tommy/clawd/generative-agents-ts/src/App.tsx`
  - 路由总入口

- `/Users/tommy/clawd/generative-agents-ts/src/components/Navigation.tsx`
  - 顶部导航

### API / 代理

- `/Users/tommy/clawd/generative-agents-ts/api/star-office/[...path].ts`
  - 生产环境代理 Star Office 后端

### 配置

- `/Users/tommy/clawd/generative-agents-ts/vite.config.ts`
- `/Users/tommy/clawd/generative-agents-ts/vercel.json`
- `/Users/tommy/clawd/generative-agents-ts/.env.example`

---

## 当前产品取向

这不是一个单独的“链游页面”，也不是一个单独的“办公室聊天页面”。  
当前项目更像一个组合产品：

- `Binance / BSC` 语义的小镇世界
- `MiroFish` 图谱驱动的人物系统
- `Star Office` 风格的办公室协作场景
- `AI` 驱动的实时讨论和 NPC 对话

如果后面继续迭代，最自然的方向是：

- 把 Skills missions 做成完整任务链
- 让图谱人物和地图事件联动更强
- 把办公室任务白板和地图任务同步
- 继续收紧 UI，让地图和办公室更像一个统一产品

---

## 说明

- 中文文档以本文件为准
- `README.en.md` 当前内容较旧，尚未同步到最新产品形态

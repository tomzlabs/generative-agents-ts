# Generative Agents TS（AI 小镇）

这是一个将 **Generative Agents / AI 小镇** 从 Python 版重写到 **TypeScript + React + Vite** 的项目。

目标是提供：
- 一个可以在浏览器里运行的 **最小可用模拟（MVP）**
- 一个可视化界面：加载小镇地图资源、显示 agent、展示事件流

> 当前进度：已搬运村庄静态资源（tilemap/角色贴图/头像等），前端已能加载 `tilemap.json` 并验证 tileset 图片路径。

---

## 功能（MVP）

- [x] 搬运静态资源：`public/static/assets/village/**`
- [x] 前端加载 Tiled `tilemap.json`（debug 展示 + tileset 预览）
- [ ] 渲染 tilemap 到 Canvas（真正“看到地图”）
- [ ] 读取 agents 资源并叠加显示（位置点/贴图）
- [ ] 最简 simulation loop（tick）+ 前端状态刷新（事件流）

---

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 启动开发环境

```bash
npm run dev
```

默认会输出本地地址（通常是）：
- http://127.0.0.1:5173/

> 注意：如果你看到 Vite 的 Node 版本警告，请升级 Node（建议 >= 20.19 或 >= 22.12）。

### 3) 你应该能看到什么

当前页面会：
- 拉取 `/static/assets/village/tilemap/tilemap.json`
- 显示地图尺寸等元信息
- 加载一张 tileset 图片做预览（用于确认静态资源可访问）

---

## 资源目录说明

本项目使用与原项目兼容的静态路径：

- `public/static/assets/village/tilemap/tilemap.json`
- `public/static/assets/village/tilemap/*.png`（tileset 图片）
- `public/static/assets/village/agents/*/portrait.png`
- `public/static/assets/village/agents/*/texture.png`
- `public/static/assets/village/agents/*/agent.json`

---

## 开发说明

### 常用命令

```bash
npm run dev      # 本地开发
npm run build    # 生产构建
npm run preview  # 预览构建产物
```

### 代码结构（简化）

- `src/components/VillageMap.tsx`：当前 MVP 页面
- `src/core/assets/*`：tilemap 等资源加载与校验（Zod）
- `src/core/agents/*` / `src/core/world/*`：核心模拟骨架（持续完善中）

---

## Roadmap（接下来要做）

1. **Canvas 渲染 tilemap**：解析 Tiled tileset（firstgid / tilecount / columns），将 layer data 画到 canvas
2. **Agent 渲染**：读取 `agents/*/agent.json` + 贴图，在地图上叠加 agent
3. **最小 simulation**：实现 tick、agent 状态变更、事件流；前端可实时看到变化

---

## 免责声明 / 安全

- 不要把任何 LLM 的 API Key 明文写进仓库。请使用 `.env.local` 或部署环境变量。

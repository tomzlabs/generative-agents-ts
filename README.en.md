# Generative Agents TS (AI Town)

This project is a TypeScript + React + Vite rewrite of **Generative Agents / AI Town**.

Goals:
- A browser-runnable **minimal viable simulation (MVP)**
- A visual UI: load the town map assets, render agents, and show an event stream

> Status: village static assets are migrated; the frontend can load `tilemap.json` and preview a tileset image.

---

## Features (MVP)

- [x] Migrate static assets: `public/static/assets/village/**`
- [x] Frontend loads Tiled `tilemap.json` (debug view + tileset preview)
- [ ] Render the tilemap to Canvas (actually *see the map*)
- [ ] Load agents assets and overlay agents (position markers / sprites)
- [ ] Minimal simulation loop (tick) + live UI updates (event stream)

---

## Quick Start

### 1) Install dependencies

```bash
npm install
```

### 2) Start dev server

```bash
npm run dev
```

It will print a local URL (usually):
- http://127.0.0.1:5173/

> If you see a Vite Node version warning, upgrade Node (recommended >= 20.19 or >= 22.12).

### 3) What you should see

The current page:
- Fetches `/static/assets/village/tilemap/tilemap.json`
- Shows basic map metadata
- Loads a tileset image preview (to verify static paths work)

---

## Assets layout

We keep the same static path layout as the original project:

- `public/static/assets/village/tilemap/tilemap.json`
- `public/static/assets/village/tilemap/*.png` (tileset images)
- `public/static/assets/village/agents/*/portrait.png`
- `public/static/assets/village/agents/*/texture.png`
- `public/static/assets/village/agents/*/agent.json`

---

## Development

### Useful commands

```bash
npm run dev      # local development
npm run build    # production build
npm run preview  # preview the build output
```

### Structure (high level)

- `src/components/VillageMap.tsx`: current MVP page
- `src/core/assets/*`: asset loading & validation (Zod)
- `src/core/agents/*` / `src/core/world/*`: simulation skeleton (WIP)

---

## Roadmap (next)

1. **Canvas tilemap rendering**: parse tilesets (firstgid / tilecount / columns), draw layer data to canvas
2. **Agent rendering**: read `agents/*/agent.json` + sprite textures and overlay agents on the map
3. **Minimal simulation**: tick, agent state updates, event stream; live updates in the UI

---

## Security

- Do not commit any LLM API keys to the repo. Use `.env.local` or deployment environment variables.

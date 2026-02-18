import { useEffect, useMemo, useRef, useState } from 'react';
import { VillageMap } from './VillageMap';
import { useI18n } from '../../i18n/I18nContext';
import { loadVillageTilemap } from '../../core/assets/loadTilemap';
import type { TiledMap } from '../../core/assets/tilemapSchema';
import { pickTileset, resolveTilesets, type ResolvedTileset } from '../../core/assets/tileRendering';

type PixiForestMapProps = {
  account?: string | null;
  ownedTokens?: number[];
};

type Direction = 'up' | 'down' | 'left' | 'right';

type CharacterState = {
  id: string;
  name: string;
  x: number;
  y: number;
  speed: number;
  color: number;
  vx: number;
  vy: number;
  moveUntil: number;
  targetX?: number;
  targetY?: number;
  direction: Direction;
  visualType: 'human-sheet' | 'walk-strip';
  directionFrames?: Record<Direction, unknown[]>;
  walkFrames?: unknown[];
  sprite: unknown;
  body: unknown;
  shadow: unknown;
  bubble: unknown;
  bubbleUntil: number;
};

type PixiRuntime = {
  Application: new (opts: Record<string, unknown>) => {
    view: HTMLCanvasElement;
    stage: {
      addChild: (...nodes: unknown[]) => void;
      removeChildren: () => void;
    };
    renderer: {
      resize: (w: number, h: number) => void;
      render: (node: unknown, options?: Record<string, unknown>) => void;
    };
    ticker: {
      add: (fn: (delta: number) => void) => void;
      stop: () => void;
      start: () => void;
      destroy: () => void;
    };
    destroy: (removeView?: boolean, stageOptions?: Record<string, unknown>) => void;
  };
  Container: new () => {
    addChild: (...nodes: unknown[]) => void;
    removeChildren: () => void;
    sortableChildren?: boolean;
    x: number;
    y: number;
    zIndex?: number;
  };
  Graphics: new () => {
    beginFill: (color: number, alpha?: number) => unknown;
    drawRect: (x: number, y: number, w: number, h: number) => unknown;
    drawRoundedRect: (x: number, y: number, w: number, h: number, r: number) => unknown;
    drawCircle: (x: number, y: number, r: number) => unknown;
    endFill: () => unknown;
    clear: () => unknown;
    x: number;
    y: number;
    zIndex?: number;
    alpha: number;
  };
  Sprite: new (texture: unknown) => {
    x: number;
    y: number;
    zIndex?: number;
    alpha: number;
    width: number;
    height: number;
    tint: number;
    texture: unknown;
    anchor?: {
      set: (x: number, y?: number) => void;
    };
  };
  Text: new (text: string, style: Record<string, unknown>) => {
    x: number;
    y: number;
    zIndex?: number;
    visible: boolean;
    text: string;
    alpha: number;
  };
  Rectangle: new (x: number, y: number, w: number, h: number) => unknown;
  Texture: {
    from: (source: unknown) => unknown;
  } & (new (baseTexture: unknown, frame: unknown) => unknown);
  RenderTexture: {
    create: (opts: Record<string, unknown>) => unknown;
  };
};

declare global {
  interface Window {
    PIXI?: PixiRuntime;
    __gaPixiGlobalPromise?: Promise<PixiRuntime>;
  }
}

const PIXI_CDN = 'https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js';
const DEBUG_LAYERS = new Set([
  'Collisions',
  'Object Interaction Blocks',
  'Arena Blocks',
  'Sector Blocks',
  'World Blocks',
  'Spawning Blocks',
  'Special Blocks Registry',
  'Utilities',
]);
const PIXI_THOUGHTS = [
  '森林今天很安静。',
  '听到风车在转。',
  '去看看地标状态。',
  '小镇在变大。',
  '准备下一轮扩建。',
];
const HUMAN_SPRITE_KEYS = [
  'Abigail', 'Adam', 'Arthur', 'Ayesha', 'Carlos', 'Carmen', 'Eddy', 'Francisco', 'George',
  'Hailey', 'Isabella', 'Jane', 'Jennifer', 'John', 'Klaus', 'Latoya', 'Maria', 'Mei', 'Rajiv',
  'Ryan', 'Sam', 'Tamara', 'Tom', 'Wolfgang', 'Yuriko_Yamamoto',
] as const;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function seededRnd(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadPixiRuntime(): Promise<PixiRuntime> {
  if (window.PIXI) return window.PIXI;
  if (window.__gaPixiGlobalPromise) return window.__gaPixiGlobalPromise;
  window.__gaPixiGlobalPromise = new Promise<PixiRuntime>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PIXI_CDN;
    script.async = true;
    script.onload = () => {
      if (!window.PIXI) {
        reject(new Error('PIXI loaded but global runtime missing'));
        return;
      }
      resolve(window.PIXI);
    };
    script.onerror = () => reject(new Error(`Failed to load ${PIXI_CDN}`));
    document.head.appendChild(script);
  });
  return window.__gaPixiGlobalPromise;
}

function buildVisibleLayers(map: TiledMap): Array<{ name: string; data: number[] }> {
  const layers = map.layers ?? [];
  return layers
    .filter((layer) => {
      if (layer.type !== 'tilelayer' || !Array.isArray(layer.data) || layer.data.length === 0) return false;
      if (layer.visible === false) return false;
      if (layer.name?.startsWith('_')) return false;
      if (DEBUG_LAYERS.has(layer.name ?? '')) return false;
      return true;
    })
    .map((layer) => ({ name: String(layer.name ?? ''), data: layer.data as number[] }));
}

function createCharacterSprite(PIXI: PixiRuntime, texture: unknown): { root: unknown; body: unknown; shadow: unknown } {
  const root = new PIXI.Container();
  const shadow = new PIXI.Graphics();
  shadow.beginFill(0x000000, 0.22);
  shadow.drawRoundedRect(-8, 16, 16, 5, 2);
  shadow.endFill();
  shadow.alpha = 0.6;
  const body = new PIXI.Sprite(texture);
  body.width = 32;
  body.height = 32;
  body.x = -16;
  body.y = -19;
  root.addChild(shadow, body);
  return { root, body, shadow };
}

function createFallbackTexture(PIXI: PixiRuntime, color: string): unknown {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = color;
    ctx.fillRect(10, 9, 12, 14);
    ctx.fillStyle = '#f5d8bf';
    ctx.fillRect(11, 3, 10, 8);
    ctx.fillStyle = '#1f2325';
    ctx.fillRect(13, 6, 2, 1);
    ctx.fillRect(18, 6, 2, 1);
  }
  return PIXI.Texture.from(canvas);
}

function createHumanSheetTextures(PIXI: PixiRuntime, spriteKey: string): Record<Direction, unknown[]> {
  const baseTexture = PIXI.Texture.from(`/static/assets/village/agents/${spriteKey}/texture.png`) as { baseTexture?: unknown };
  const source = baseTexture.baseTexture ?? baseTexture;
  const mkFrame = (sx: number, sy: number) => new PIXI.Texture(source, new PIXI.Rectangle(sx, sy, 32, 32));
  const cycle = [0, 32, 64, 32];
  return {
    down: cycle.map((x) => mkFrame(x, 0)),
    left: cycle.map((x) => mkFrame(x, 32)),
    right: cycle.map((x) => mkFrame(x, 64)),
    up: cycle.map((x) => mkFrame(x, 96)),
  };
}

function createWalkStripTextures(PIXI: PixiRuntime, prefix: 'cz' | 'heyi'): unknown[] {
  return [0, 1, 2, 3].map((idx) => PIXI.Texture.from(`/static/assets/npc/${prefix}_walk_${idx}.png`));
}

export function PixiForestMap(props: PixiForestMapProps = {}) {
  const { account, ownedTokens = [] } = props;
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<InstanceType<PixiRuntime['Application']> | null>(null);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [pixiReady, setPixiReady] = useState(false);
  const [fallbackMode, setFallbackMode] = useState(false);
  const [mapInfo, setMapInfo] = useState<{ width: number; height: number; layers: number } | null>(null);
  const [agentInfo, setAgentInfo] = useState<{ total: number; selected: string | null }>({ total: 0, selected: null });

  const shouldFallback = useMemo(() => fallbackMode || Boolean(bootErr), [fallbackMode, bootErr]);

  useEffect(() => {
    if (shouldFallback) return;
    let canceled = false;
    let resizeHandler: (() => void) | null = null;
    const rafTimers: number[] = [];

    const boot = async () => {
      try {
        const host = hostRef.current;
        if (!host) return;
        const PIXI = await loadPixiRuntime();
        if (canceled) return;
        const map = await loadVillageTilemap();
        if (canceled) return;
        const tilesets = await resolveTilesets(map);
        if (canceled) return;
        const visibleLayers = buildVisibleLayers(map);
        const tw = map.tilewidth;
        const th = map.tileheight;
        const worldW = map.width * tw;
        const worldH = map.height * th;
        setMapInfo({ width: map.width, height: map.height, layers: visibleLayers.length });

        const app = new PIXI.Application({
          width: Math.max(320, host.clientWidth),
          height: Math.max(280, host.clientHeight),
          backgroundAlpha: 0,
          antialias: false,
          autoDensity: true,
          resolution: Math.min(2, window.devicePixelRatio || 1),
        });
        appRef.current = app;
        host.innerHTML = '';
        host.appendChild(app.view);

        const world = new PIXI.Container();
        world.sortableChildren = true;
        app.stage.addChild(world);

        const staticLayer = new PIXI.Container();
        const textureCache = new Map<number, unknown>();
        for (const layer of visibleLayers) {
          for (let i = 0; i < layer.data.length; i++) {
            const gidRaw = layer.data[i] ?? 0;
            const gid = gidRaw & 0x1fffffff;
            if (gid === 0) continue;
            let texture = textureCache.get(gid);
            if (!texture) {
              const ts = pickTileset(tilesets as ResolvedTileset[], gid);
              if (!ts) continue;
              const localId = gid - ts.firstgid;
              const sx = (localId % ts.columns) * ts.tileWidth;
              const sy = Math.floor(localId / ts.columns) * ts.tileHeight;
              const baseTexture = PIXI.Texture.from(ts.image);
              texture = new PIXI.Texture(baseTexture, new PIXI.Rectangle(sx, sy, ts.tileWidth, ts.tileHeight));
              textureCache.set(gid, texture);
            }
            const sprite = new PIXI.Sprite(texture);
            sprite.x = (i % map.width) * tw;
            sprite.y = Math.floor(i / map.width) * th;
            staticLayer.addChild(sprite);
          }
        }
        const staticRT = PIXI.RenderTexture.create({ width: worldW, height: worldH });
        app.renderer.render(staticLayer, { renderTexture: staticRT });
        staticLayer.removeChildren();
        const mapSprite = new PIXI.Sprite(staticRT);
        mapSprite.zIndex = 1;
        world.addChild(mapSprite);

        const foliageLayer = new PIXI.Container();
        foliageLayer.zIndex = 2;
        world.addChild(foliageLayer);
        const decoRnd = seededRnd(worldW + worldH + visibleLayers.length * 73);
        for (let i = 0; i < 180; i++) {
          const grass = new PIXI.Graphics();
          const gx = Math.floor(decoRnd() * worldW);
          const gy = Math.floor(decoRnd() * worldH);
          const tone = decoRnd() > 0.5 ? 0x6faa48 : 0x5d9444;
          grass.beginFill(tone, 0.45);
          grass.drawRect(gx, gy, 2, 2);
          grass.drawRect(gx + 2, gy - 1, 2, 3);
          grass.endFill();
          foliageLayer.addChild(grass);
        }

        const agentsLayer = new PIXI.Container();
        agentsLayer.zIndex = 6;
        world.addChild(agentsLayer);

        const characters: CharacterState[] = [];
        const fallbackPlayerTexture = createFallbackTexture(PIXI, '#5ca8f0');
        const playerFrames = createHumanSheetTextures(PIXI, 'Abigail');
        const playerTexture = playerFrames.down[1] ?? fallbackPlayerTexture;
        const playerSprite = createCharacterSprite(PIXI, playerTexture);
        const playerBubble = new PIXI.Text(t('点击地图移动', 'Click to move'), {
          fill: 0xffffff,
          fontSize: 11,
          fontFamily: 'monospace',
          stroke: '#000000',
          strokeThickness: 3,
        });
        playerBubble.visible = true;
        playerBubble.y = -30;
        (playerSprite.root as { addChild: (...nodes: unknown[]) => void }).addChild(playerBubble);
        (playerSprite.root as { x: number; y: number; zIndex?: number }).x = worldW * 0.5;
        (playerSprite.root as { x: number; y: number; zIndex?: number }).y = worldH * 0.55;
        (playerSprite.root as { zIndex?: number }).zIndex = Math.floor(worldH * 0.55) + 1000;
        agentsLayer.addChild(playerSprite.root as object);
        characters.push({
          id: 'player',
          name: account ? `${account.slice(0, 6)}...${account.slice(-4)}` : 'Guest',
          x: worldW * 0.5,
          y: worldH * 0.55,
          speed: 2.2,
          color: 0x58a7f0,
          vx: 0,
          vy: 0,
          moveUntil: Date.now(),
          targetX: undefined,
          targetY: undefined,
          direction: 'down',
          visualType: 'human-sheet',
          directionFrames: playerFrames,
          sprite: playerSprite.root,
          body: playerSprite.body,
          shadow: playerSprite.shadow,
          bubble: playerBubble,
          bubbleUntil: Date.now() + 2600,
        });

        const npcCount = 14;
        const czWalkFrames = createWalkStripTextures(PIXI, 'cz');
        const heyiWalkFrames = createWalkStripTextures(PIXI, 'heyi');
        for (let i = 0; i < npcCount; i++) {
          const rnd = seededRnd((i + 1) * 7721);
          const px = 80 + rnd() * (worldW - 160);
          const py = 80 + rnd() * (worldH - 160);
          const humanKey = HUMAN_SPRITE_KEYS[i % HUMAN_SPRITE_KEYS.length];
          const humanFrames = createHumanSheetTextures(PIXI, humanKey);
          const fallbackNpcTexture = createFallbackTexture(PIXI, i % 2 === 0 ? '#71b45f' : '#8da8ff');
          const isCz = i === 0;
          const isHeyi = i === 1;
          const texture = isCz
            ? (czWalkFrames[0] ?? fallbackNpcTexture)
            : isHeyi
              ? (heyiWalkFrames[0] ?? fallbackNpcTexture)
              : (humanFrames.down[1] ?? fallbackNpcTexture);
          const npcSprite = createCharacterSprite(PIXI, texture);
          const npcBubble = new PIXI.Text('', {
            fill: 0xffffff,
            fontSize: 10,
            fontFamily: 'monospace',
            stroke: '#000000',
            strokeThickness: 3,
          });
          npcBubble.visible = false;
          npcBubble.y = -28;
          (npcSprite.root as { addChild: (...nodes: unknown[]) => void }).addChild(npcBubble);
          (npcSprite.root as { x: number; y: number; zIndex?: number }).x = px;
          (npcSprite.root as { y: number; zIndex?: number }).y = py;
          (npcSprite.root as { zIndex?: number }).zIndex = Math.floor(py) + 1000;
          agentsLayer.addChild(npcSprite.root as object);
          const baseName = i < 2 ? ['CZ', 'HEYI'][i] : `Agent-${i.toString().padStart(2, '0')}`;
          const npcName = i === 1 ? 'Yi He' : baseName;
          characters.push({
            id: `npc-${i}`,
            name: npcName,
            x: px,
            y: py,
            speed: 1 + rnd() * 0.8,
            color: 0xffffff,
            vx: 0,
            vy: 0,
            moveUntil: Date.now() + 500 + Math.floor(rnd() * 2000),
            targetX: undefined,
            targetY: undefined,
            direction: 'down',
            visualType: isCz || isHeyi ? 'walk-strip' : 'human-sheet',
            directionFrames: isCz || isHeyi ? undefined : humanFrames,
            walkFrames: isCz ? czWalkFrames : (isHeyi ? heyiWalkFrames : undefined),
            sprite: npcSprite.root,
            body: npcSprite.body,
            shadow: npcSprite.shadow,
            bubble: npcBubble,
            bubbleUntil: 0,
          });
        }
        setAgentInfo({ total: characters.length, selected: null });

        let camX = characters[0].x;
        let camY = characters[0].y;
        const cameraLerp = 0.12;

        const updateCamera = (width: number, height: number) => {
          const halfW = width / 2;
          const halfH = height / 2;
          const targetX = clamp(characters[0].x, halfW, Math.max(halfW, worldW - halfW));
          const targetY = clamp(characters[0].y, halfH, Math.max(halfH, worldH - halfH));
          camX += (targetX - camX) * cameraLerp;
          camY += (targetY - camY) * cameraLerp;
          world.x = Math.round(halfW - camX);
          world.y = Math.round(halfH - camY);
        };

        const speakNpc = (npc: CharacterState) => {
          const phrase = PIXI_THOUGHTS[Math.floor(Math.random() * PIXI_THOUGHTS.length)] ?? '';
          const bubble = npc.bubble as { visible: boolean; text: string; alpha: number };
          bubble.text = phrase;
          bubble.visible = true;
          bubble.alpha = 1;
          npc.bubbleUntil = Date.now() + 2200 + Math.floor(Math.random() * 1200);
        };

        const onPointerDown = (event: PointerEvent) => {
          const rect = app.view.getBoundingClientRect();
          const sx = event.clientX - rect.left;
          const sy = event.clientY - rect.top;
          const worldX = sx - world.x;
          const worldY = sy - world.y;
          const player = characters[0];
          player.targetX = clamp(worldX, 30, worldW - 30);
          player.targetY = clamp(worldY, 30, worldH - 30);

          let picked: CharacterState | null = null;
          let bestDist = Number.POSITIVE_INFINITY;
          for (let i = 1; i < characters.length; i++) {
            const c = characters[i];
            const dx = c.x - worldX;
            const dy = c.y - worldY;
            const d = dx * dx + dy * dy;
            if (d < bestDist) {
              bestDist = d;
              picked = c;
            }
          }
          if (picked && bestDist < 22 * 22) {
            setAgentInfo({ total: characters.length, selected: picked.name });
            speakNpc(picked);
          }
        };

        app.view.addEventListener('pointerdown', onPointerDown);

        const resize = () => {
          const width = Math.max(320, host.clientWidth);
          const height = Math.max(280, host.clientHeight);
          app.renderer.resize(width, height);
          updateCamera(width, height);
        };
        resizeHandler = resize;
        window.addEventListener('resize', resizeHandler);
        resize();

        app.ticker.add((delta) => {
          const now = Date.now();
          const dt = Math.max(0.5, Math.min(2.2, delta));
          for (const c of characters) {
            if (c.id !== 'player') {
              if (now >= c.moveUntil || c.targetX === undefined || c.targetY === undefined) {
                const rnd = seededRnd(now + c.id.length * 977);
                c.targetX = clamp(c.x + ((rnd() - 0.5) * 220), 30, worldW - 30);
                c.targetY = clamp(c.y + ((rnd() - 0.5) * 180), 30, worldH - 30);
                c.moveUntil = now + 1500 + Math.floor(rnd() * 2600);
                if (rnd() > 0.72) speakNpc(c);
              }
            }

            if (c.targetX !== undefined && c.targetY !== undefined) {
              const dx = c.targetX - c.x;
              const dy = c.targetY - c.y;
              const dist = Math.hypot(dx, dy);
              if (dist < 1.8) {
                c.targetX = undefined;
                c.targetY = undefined;
                c.vx = 0;
                c.vy = 0;
              } else {
                const step = c.speed * dt;
                const mx = (dx / dist) * step;
                const my = (dy / dist) * step;
                c.x += mx;
                c.y += my;
                c.vx = mx;
                c.vy = my;
              }
            } else {
              c.vx = 0;
              c.vy = 0;
            }

            const bob = Math.sin((now / 130) + c.x * 0.01 + c.y * 0.01) * 1.2;
            const sprite = c.sprite as { x: number; y: number; zIndex?: number };
            const body = c.body as { texture: unknown; y: number };
            const shadow = c.shadow as { alpha: number };
            if (Math.abs(c.vx) >= Math.abs(c.vy) && Math.abs(c.vx) > 0.02) {
              c.direction = c.vx >= 0 ? 'right' : 'left';
            } else if (Math.abs(c.vy) > 0.02) {
              c.direction = c.vy >= 0 ? 'down' : 'up';
            }
            sprite.x = c.x;
            sprite.y = c.y + bob;
            sprite.zIndex = Math.floor(c.y) + 1000;
            const moving = c.targetX !== undefined && c.targetY !== undefined;
            shadow.alpha = moving ? 0.75 : 0.55;
            if (c.visualType === 'human-sheet' && c.directionFrames) {
              const frames = c.directionFrames[c.direction] ?? c.directionFrames.down;
              const frame = moving
                ? frames[(Math.floor(now / 170) + (c.id.length % 3)) % frames.length]
                : (frames[1] ?? frames[0]);
              body.texture = frame;
              body.y = -18;
            } else if (c.visualType === 'walk-strip' && c.walkFrames && c.walkFrames.length > 0) {
              const frame = moving
                ? c.walkFrames[(Math.floor(now / 190) + (c.id.length % 4)) % c.walkFrames.length]
                : c.walkFrames[0];
              body.texture = frame;
              body.y = -20;
            }

            const bubble = c.bubble as { visible: boolean; alpha: number };
            if (bubble.visible && now > c.bubbleUntil) {
              bubble.alpha -= 0.06 * dt;
              if (bubble.alpha <= 0.02) {
                bubble.visible = false;
              }
            }
          }
          updateCamera(app.view.width, app.view.height);
        });

        const readyTimer = window.setTimeout(() => {
          if (!canceled) setPixiReady(true);
        }, 120);
        rafTimers.push(readyTimer);

        const cleanup = () => {
          app.view.removeEventListener('pointerdown', onPointerDown);
          if (resizeHandler) {
            window.removeEventListener('resize', resizeHandler);
          }
          for (const timer of rafTimers) {
            window.clearTimeout(timer);
          }
          app.ticker.stop();
          app.ticker.destroy();
          app.stage.removeChildren();
          app.destroy(true, { children: true, texture: false, baseTexture: false });
          if (host.contains(app.view)) {
            host.removeChild(app.view);
          }
          appRef.current = null;
        };

        if (canceled) {
          cleanup();
          return;
        }

        (host as { __gaPixiCleanup?: () => void }).__gaPixiCleanup = cleanup;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setBootErr(message);
        setFallbackMode(true);
      }
    };

    void boot();

    return () => {
      canceled = true;
      const host = hostRef.current as ({ __gaPixiCleanup?: () => void } | null);
      host?.__gaPixiCleanup?.();
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
      }
      for (const timer of rafTimers) {
        window.clearTimeout(timer);
      }
    };
  }, [account, shouldFallback, t]);

  if (shouldFallback) {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <VillageMap account={account ?? null} ownedTokens={ownedTokens} />
      </div>
    );
  }

  return (
    <div className="pixi-forest-shell">
      <div className="pixi-forest-head">
        <div className="pixi-forest-chip">
          <span>{t('渲染', 'Renderer')}</span>
          <strong>{pixiReady ? 'PixiJS' : t('加载中', 'Booting')}</strong>
        </div>
        <div className="pixi-forest-chip">
          <span>{t('地图', 'Map')}</span>
          <strong>{mapInfo ? `${mapInfo.width} x ${mapInfo.height}` : '--'}</strong>
        </div>
        <div className="pixi-forest-chip">
          <span>{t('图层', 'Layers')}</span>
          <strong>{mapInfo ? String(mapInfo.layers) : '--'}</strong>
        </div>
        <div className="pixi-forest-chip">
          <span>{t('角色', 'Agents')}</span>
          <strong>{agentInfo.selected ? `${agentInfo.total} · ${agentInfo.selected}` : String(agentInfo.total)}</strong>
        </div>
      </div>
      <div className="pixi-forest-stage-wrap">
        <div ref={hostRef} className="pixi-forest-stage" />
      </div>
      <style>{`
        .pixi-forest-shell {
          width: 100%;
          height: 100%;
          min-height: 100%;
          padding: 12px;
          box-sizing: border-box;
          background:
            radial-gradient(circle at 16% 12%, rgba(255,255,255,0.38), transparent 21%),
            radial-gradient(circle at 80% 10%, rgba(255,255,255,0.28), transparent 17%),
            linear-gradient(180deg, #dbf4cf 0%, #c9e8b3 54%, #b7dba3 100%);
        }
        .pixi-forest-head {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 10px;
        }
        .pixi-forest-chip {
          border: 2px solid #6d9860;
          border-radius: 8px;
          background: linear-gradient(180deg, rgba(248,255,228,0.92), rgba(229,246,190,0.92));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.4), 0 6px 14px rgba(52, 80, 42, 0.14);
          padding: 7px 8px;
          color: #2f4f32;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .pixi-forest-chip span {
          font-family: 'Press Start 2P', cursive;
          font-size: 7px;
          opacity: 0.88;
        }
        .pixi-forest-chip strong {
          font-family: 'Space Mono', monospace;
          font-size: 11px;
          line-height: 1.2;
        }
        .pixi-forest-stage-wrap {
          width: 100%;
          height: calc(100% - 66px);
          min-height: min(80vh, 980px);
          border: 2px solid #6d9860;
          border-radius: 10px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.36), 0 10px 20px rgba(37, 64, 29, 0.2);
          background:
            repeating-linear-gradient(
              90deg,
              rgba(255,255,255,0.02) 0px,
              rgba(255,255,255,0.02) 1px,
              transparent 1px,
              transparent 10px
            ),
            linear-gradient(180deg, #d0ecb9 0%, #b8dc9d 100%);
          overflow: hidden;
        }
        .pixi-forest-stage {
          width: 100%;
          height: 100%;
          touch-action: none;
          image-rendering: pixelated;
        }
        .pixi-forest-stage canvas {
          width: 100% !important;
          height: 100% !important;
          display: block;
          image-rendering: pixelated;
        }
        @media (max-width: 900px) {
          .pixi-forest-head {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .pixi-forest-stage-wrap {
            height: calc(100% - 98px);
          }
        }
      `}</style>
    </div>
  );
}

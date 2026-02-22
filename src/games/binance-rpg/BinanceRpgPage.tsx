import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';

type Direction = 'up' | 'down' | 'left' | 'right';
type Biome = 'forest' | 'desert' | 'snow';
type EnemyKind =
  | 'slime'
  | 'raider'
  | 'wisp'
  | 'golem'
  | 'rat'
  | 'spider'
  | 'bat'
  | 'serpent'
  | 'boss_reaper'
  | 'boss_hydra';
type AvatarKind = 'heyi' | 'cz';
type WeaponIconKind = 'sword' | 'bow' | 'arrow' | 'staff';
type AttackElement = 'water' | 'thunder' | 'ice';
type UpgradeKind =
  | 'power'
  | 'firerate'
  | 'movespeed'
  | 'maxhp'
  | 'pickup'
  | 'pierce'
  | 'projectile'
  | 'skill_blade'
  | 'skill_nova'
  | 'skill_split';

type PlayerState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: Direction;
  avatar: AvatarKind;
  hp: number;
  maxHp: number;
  level: number;
  exp: number;
  expNext: number;
  speed: number;
  attack: number;
  armor: number;
  attackTimer: number;
  attackInterval: number;
  projectileSpeed: number;
  projectilePierce: number;
  pickupRadius: number;
  weaponTier: number;
  armorTier: number;
  skillBladeLevel: number;
  skillNovaLevel: number;
  skillSplitLevel: number;
  novaTimer: number;
  contactCd: number;
  kills: number;
};

type EnemyState = {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  radius: number;
  bladeHitCd: number;
};

type GemState = {
  id: number;
  x: number;
  y: number;
  xp: number;
  ttl: number;
};

type SupplyKind =
  | 'medkit'
  | 'haste'
  | 'magnet'
  | 'armor'
  | 'potion_hp'
  | 'potion_fury'
  | 'equip_blade'
  | 'equip_armor';

type SupplyState = {
  id: number;
  kind: SupplyKind;
  x: number;
  y: number;
  ttl: number;
};

type ProjectileState = {
  id: number;
  style: WeaponIconKind;
  element: AttackElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  damage: number;
  radius: number;
  pierce: number;
};

type FloatText = {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  ttl: number;
};

type WaveFx = {
  id: number;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  ttl: number;
  color: string;
};

type SpriteFx = {
  id: number;
  kind: 'hit' | 'muzzle' | 'nova';
  element: AttackElement;
  x: number;
  y: number;
  ttl: number;
  maxTtl: number;
  size: number;
  rotation: number;
};

type UpgradeChoice = {
  kind: UpgradeKind;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
};

type GameState = {
  player: PlayerState;
  enemies: EnemyState[];
  gems: GemState[];
  supplies: SupplyState[];
  projectiles: ProjectileState[];
  floats: FloatText[];
  waves: WaveFx[];
  spriteFxs: SpriteFx[];
  logs: string[];
  enemyAutoId: number;
  gemAutoId: number;
  supplyAutoId: number;
  projectileAutoId: number;
  floatAutoId: number;
  waveAutoId: number;
  spriteFxAutoId: number;
  spawnClock: number;
  supplySpawnClock: number;
  supplyNextSpawn: number;
  elapsedSeconds: number;
  difficulty: number;
  audioHitCd: number;
  audioPickupCd: number;
  audioShootCd: number;
  gameOver: boolean;
  levelUpChoices: UpgradeChoice[];
  bestScore: number;
  leaderboard: LeaderboardEntry[];
  runSubmitted: boolean;
  lastBossWave: number;
  lastMilestoneMinute: number;
};

type LeaderboardEntry = {
  id: string;
  account: string;
  avatar: AvatarKind;
  score: number;
  kills: number;
  level: number;
  survivalSeconds: number;
  at: number;
};

type SaveData = {
  player: Partial<PlayerState> & { atk?: number; def?: number };
  elapsedSeconds: number;
  difficulty: number;
  bestScore: number;
  leaderboard?: LeaderboardEntry[];
};

type HudSnapshot = {
  hp: number;
  maxHp: number;
  level: number;
  exp: number;
  expNext: number;
  kills: number;
  timer: number;
  biome: Biome;
  nearbyEnemies: number;
  attack: number;
  speed: number;
  attackInterval: number;
  pickupRadius: number;
  avatar: AvatarKind;
  skillBladeLevel: number;
  skillNovaLevel: number;
  skillSplitLevel: number;
  score: number;
  bestScore: number;
  walletLabel: string;
};

type EnemyBase = {
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  xp: number;
};

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

const STORAGE_KEY = 'ga:bnb-survivors:save-v1';
const LEADERBOARD_MAX_SAVE = 100;
const LEADERBOARD_MAX_VIEW = 10;
const TILE_SIZE = 32;
const STEP_DT = 1 / 60;
const SPAWN_RADIUS_MIN = 320;
const SPAWN_RADIUS_MAX = 520;
const MAX_NEARBY_ENEMIES = 150;
const ATTACK_TARGET_RANGE = 420;
const SUPPLY_SPAWN_INTERVAL_MIN = 8.5;
const SUPPLY_SPAWN_INTERVAL_MAX = 16;

const OGA_ASSET_PATHS = {
  warrior: '/static/assets/rpg/oga/puny/Warrior-Blue.png',
  heyiWalk0: '/static/assets/npc/heyi_walk_0.png',
  heyiWalk1: '/static/assets/npc/heyi_walk_1.png',
  heyiWalk2: '/static/assets/npc/heyi_walk_2.png',
  heyiWalk3: '/static/assets/npc/heyi_walk_3.png',
  czWalk0: '/static/assets/npc/cz_walk_0.png',
  czWalk1: '/static/assets/npc/cz_walk_1.png',
  czWalk2: '/static/assets/npc/cz_walk_2.png',
  czWalk3: '/static/assets/npc/cz_walk_3.png',
  slime: '/static/assets/rpg/oga/puny/Slime.png',
  envTree: '/static/assets/rpg/oga/puny/Tree.png',
  tileGrass: '/static/assets/rpg/oga/tiles/grass0.png',
  tileSand: '/static/assets/rpg/oga/tiles/sand0.png',
  tileIce: '/static/assets/rpg/oga/tiles/ice0.png',
  tileDirt: '/static/assets/rpg/oga/tiles/dirt0.png',
  monGoblin: '/static/assets/rpg/oga/monsters/goblin.png',
  monWisp: '/static/assets/rpg/oga/monsters/wisp.png',
  monGolem: '/static/assets/rpg/oga/monsters/golem.png',
  itemGold: '/static/assets/rpg/oga/items/gold.png',
  itemCrystal: '/static/assets/rpg/oga/items/crystal.png',
  spellMagicSheet: '/static/assets/rpg/free-pixel-effects-pack/extracted/1_magicspell_spritesheet.png',
  spellHitSheet: '/static/assets/rpg/free-pixel-effects-pack/extracted/5_magickahit_spritesheet.png',
  spellRingSheet: '/static/assets/rpg/free-pixel-effects-pack/extracted/8_protectioncircle_spritesheet.png',
  spellNovaSheet: '/static/assets/rpg/free-pixel-effects-pack/extracted/13_vortex_spritesheet.png',
  fxBloodHit: '/static/assets/rpg/oga-page5/extracted/particlefx2/blood_hit_01.png',
  fxTeleporterHit: '/static/assets/rpg/oga-page5/extracted/particlefx2/teleporter_hit.png',
  roguelikeMonsters: '/static/assets/rpg/roguelike-monsters/roguelikecreatures.png',
  lpcDecorations: '/static/assets/rpg/lpc-medieval-village/extracted/decoration_medieval/decorations-medieval.png',
  lpcFence: '/static/assets/rpg/lpc-medieval-village/extracted/decoration_medieval/fence_medieval.png',
  iconSword: '/static/assets/rpg/kyrise-icons/curated/sword_03d.png',
  iconBow: '/static/assets/rpg/kyrise-icons/curated/bow_03c.png',
  iconArrow: '/static/assets/rpg/kyrise-icons/curated/arrow_03d.png',
  iconStaff: '/static/assets/rpg/kyrise-icons/curated/staff_03d.png',
  iconShield: '/static/assets/rpg/kyrise-icons/curated/shield_03d.png',
  iconPotionRed: '/static/assets/rpg/kyrise-icons/curated/potion_02b.png',
  iconPotionBlue: '/static/assets/rpg/kyrise-icons/curated/potion_03f.png',
  iconHelmet: '/static/assets/rpg/kyrise-icons/curated/helmet_01a.png',
  waterMagicBase: '/static/assets/rpg/water-magic-effect/extracted',
} as const;

type OgaAssets = {
  warrior: HTMLImageElement;
  heyiWalk0: HTMLImageElement;
  heyiWalk1: HTMLImageElement;
  heyiWalk2: HTMLImageElement;
  heyiWalk3: HTMLImageElement;
  czWalk0: HTMLImageElement;
  czWalk1: HTMLImageElement;
  czWalk2: HTMLImageElement;
  czWalk3: HTMLImageElement;
  slime: HTMLImageElement;
  envTree: HTMLImageElement;
  tileGrass: HTMLImageElement;
  tileSand: HTMLImageElement;
  tileIce: HTMLImageElement;
  tileDirt: HTMLImageElement;
  monGoblin: HTMLImageElement;
  monWisp: HTMLImageElement;
  monGolem: HTMLImageElement;
  itemGold: HTMLImageElement;
  itemCrystal: HTMLImageElement;
  spellMagicSheet: HTMLImageElement;
  spellHitSheet: HTMLImageElement;
  spellRingSheet: HTMLImageElement;
  spellNovaSheet: HTMLImageElement;
  fxBloodHit: HTMLImageElement;
  fxTeleporterHit: HTMLImageElement;
  roguelikeMonsters: HTMLImageElement;
  lpcDecorations: HTMLImageElement;
  lpcFence: HTMLImageElement;
  iconSword: HTMLImageElement;
  iconBow: HTMLImageElement;
  iconArrow: HTMLImageElement;
  iconStaff: HTMLImageElement;
  iconShield: HTMLImageElement;
  iconPotionRed: HTMLImageElement;
  iconPotionBlue: HTMLImageElement;
  iconHelmet: HTMLImageElement;
  waterProjectileFrames: HTMLImageElement[];
  waterImpactFrames: HTMLImageElement[];
  waterNovaFrames: HTMLImageElement[];
};

const ROGUELIKE_MONSTER_CELL = 16;
type EnemyVisualConfig = {
  col: number;
  row: number;
  scale: number;
  ghost?: boolean;
  boss?: boolean;
};
const ROGUELIKE_MONSTER_MAP: Record<EnemyKind, EnemyVisualConfig> = {
  slime: { col: 0, row: 8, scale: 1 },
  raider: { col: 2, row: 0, scale: 1 },
  wisp: { col: 2, row: 7, scale: 1, ghost: true },
  golem: { col: 5, row: 2, scale: 1.1 },
  rat: { col: 0, row: 1, scale: 1 },
  spider: { col: 1, row: 4, scale: 1.05 },
  bat: { col: 4, row: 4, scale: 1, ghost: true },
  serpent: { col: 5, row: 8, scale: 1.08 },
  boss_reaper: { col: 4, row: 6, scale: 1.55, boss: true },
  boss_hydra: { col: 7, row: 5, scale: 1.72, boss: true },
};

const LPC_TILE_SIZE = 32;
const LPC_TILESET_COLS = 16;
const LPC_FIRE_FRAMES = [776, 777, 778, 779, 780] as const;
const LPC_STALL_PAIR = [432, 448] as const;
const LPC_FENCE_TILES = [49, 65, 67, 68, 69, 73, 74, 97, 98, 145, 146, 208, 209, 210, 241, 242] as const;
const LPC_DECOR_FOREST = [464, 544, 560, 561, 704, 752, 144, 160] as const;
const LPC_DECOR_DESERT = [336, 352, 368, 544, 560, 561, 704, 752] as const;
const LPC_DECOR_SNOW = [0, 4, 16, 32, 48, 64, 80, 128, 144, 160] as const;

const BASE_UPGRADE_POOL: UpgradeChoice[] = [
  {
    kind: 'power',
    titleZh: '暴击训练',
    titleEn: 'Power Training',
    descZh: '基础攻击 +6。',
    descEn: 'Base attack +6.',
  },
  {
    kind: 'firerate',
    titleZh: '连发模组',
    titleEn: 'Rapid Module',
    descZh: '攻击间隔 -10%。',
    descEn: 'Attack interval -10%.',
  },
  {
    kind: 'movespeed',
    titleZh: '轻装步伐',
    titleEn: 'Swift Steps',
    descZh: '移动速度 +12。',
    descEn: 'Move speed +12.',
  },
  {
    kind: 'maxhp',
    titleZh: '链甲升级',
    titleEn: 'Armor Upgrade',
    descZh: '最大生命 +24，并恢复 24。',
    descEn: 'Max HP +24 and heal 24.',
  },
  {
    kind: 'pickup',
    titleZh: '磁能核心',
    titleEn: 'Magnet Core',
    descZh: '经验吸附半径 +22。',
    descEn: 'XP pickup radius +22.',
  },
  {
    kind: 'pierce',
    titleZh: '穿透弹头',
    titleEn: 'Piercing Bolt',
    descZh: '投射物穿透 +1。',
    descEn: 'Projectile pierce +1.',
  },
  {
    kind: 'projectile',
    titleZh: '弹道推进',
    titleEn: 'Ballistic Boost',
    descZh: '弹速 +70，射程略增。',
    descEn: 'Projectile speed +70, slight range boost.',
  },
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function mod(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

function len(dx: number, dy: number): number {
  return Math.hypot(dx, dy);
}

function pickByRoll<T>(arr: readonly T[], roll: number): T {
  return arr[Math.floor(roll * arr.length) % arr.length];
}

function pickProjectileElement(shotCount: number): AttackElement {
  return shotCount > 1 ? 'thunder' : 'water';
}

function pickProjectileStyle(player: PlayerState, shotIndex: number, element: AttackElement): WeaponIconKind {
  if (element === 'thunder') {
    const styles: WeaponIconKind[] = ['staff', 'sword'];
    return styles[shotIndex % styles.length];
  }
  if (element === 'ice') {
    return 'staff';
  }
  const seed = player.skillBladeLevel + (player.skillSplitLevel * 2) + (player.skillNovaLevel * 3) + shotIndex;
  const styles: WeaponIconKind[] = ['arrow', 'bow'];
  return styles[Math.abs(seed) % styles.length];
}

function facingUnit(facing: Direction): { x: number; y: number } {
  if (facing === 'left') return { x: -1, y: 0 };
  if (facing === 'right') return { x: 1, y: 0 };
  if (facing === 'up') return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function bladeOrbitRadius(skillLevel: number): number {
  // Expanded orbit range so blade builds can control a wider ring.
  return 34 + (skillLevel * 7);
}

function isBossKind(kind: EnemyKind): boolean {
  return kind === 'boss_reaper' || kind === 'boss_hydra';
}

function upgradeIconForKind(kind: UpgradeKind): string {
  if (kind === 'power' || kind === 'skill_blade') return OGA_ASSET_PATHS.iconSword;
  if (kind === 'firerate' || kind === 'projectile' || kind === 'skill_split') return OGA_ASSET_PATHS.iconBow;
  if (kind === 'maxhp') return OGA_ASSET_PATHS.iconShield;
  if (kind === 'skill_nova') return OGA_ASSET_PATHS.iconStaff;
  return OGA_ASSET_PATHS.iconArrow;
}

function waterFramePaths(setId: '01' | '03' | '04'): string[] {
  return [1, 2, 3, 4, 5].map((idx) => `${OGA_ASSET_PATHS.waterMagicBase}/${setId}/Water__0${idx}.png`);
}

function pickRecommendedUpgradeIndex(choices: UpgradeChoice[], player: PlayerState): number {
  if (player.skillSplitLevel <= 0) {
    const idx = choices.findIndex((choice) => choice.kind === 'skill_split');
    if (idx >= 0) return idx;
  }
  if (player.skillNovaLevel <= 0) {
    const idx = choices.findIndex((choice) => choice.kind === 'skill_nova');
    if (idx >= 0) return idx;
  }
  const splitIdx = choices.findIndex((choice) => choice.kind === 'skill_split');
  if (splitIdx >= 0) return splitIdx;
  const novaIdx = choices.findIndex((choice) => choice.kind === 'skill_nova');
  if (novaIdx >= 0) return novaIdx;
  return 0;
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  if (!text) return [];
  const lines: string[] = [];
  let line = '';
  let truncated = false;

  for (const ch of text) {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
      continue;
    }
    const next = line + ch;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = ch;
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
    } else {
      line = next;
    }
  }

  if (!truncated && line && lines.length < maxLines) {
    lines.push(line);
  }

  if (truncated && lines.length > 0) {
    const lastIdx = lines.length - 1;
    let last = lines[lastIdx];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[lastIdx] = `${last}…`;
  }

  return lines;
}

function hash01(x: number, y: number): number {
  let n = Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca6b);
  n ^= n >>> 13;
  n = Math.imul(n, 0xc2b2ae35);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967295;
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const a = hash01(ix, iy);
  const b = hash01(ix + 1, iy);
  const c = hash01(ix, iy + 1);
  const d = hash01(ix + 1, iy + 1);

  const ux = fx * fx * (3 - (2 * fx));
  const uy = fy * fy * (3 - (2 * fy));
  const ab = a + ((b - a) * ux);
  const cd = c + ((d - c) * ux);
  return ab + ((cd - ab) * uy);
}

function sampleBiome(tx: number, ty: number): Biome {
  const wet = smoothNoise(tx * 0.065 + 17, ty * 0.065 - 23);
  const temp = smoothNoise(tx * 0.048 - 31, ty * 0.048 + 71);
  if (temp > 0.66 && wet < 0.52) return 'desert';
  if (temp < 0.4) return 'snow';
  return 'forest';
}

function biomeGroundColor(biome: Biome, tx: number, ty: number): string {
  const jitter = hash01(tx * 13 + 5, ty * 11 + 9);
  if (biome === 'forest') return jitter > 0.56 ? '#7bc367' : '#72bb5f';
  if (biome === 'desert') return jitter > 0.56 ? '#e8d893' : '#dfcf84';
  return jitter > 0.56 ? '#dcecff' : '#d2e5fa';
}

function isRoadTile(tx: number, ty: number): boolean {
  const warpX = Math.floor((smoothNoise(ty * 0.05 + 13, tx * 0.02 - 7) - 0.5) * 10);
  const warpY = Math.floor((smoothNoise(tx * 0.05 - 19, ty * 0.02 + 11) - 0.5) * 10);
  const laneX = Math.abs(mod(tx + warpX, 22) - 11) <= 1;
  const laneY = Math.abs(mod(ty + warpY, 22) - 11) <= 1;
  const plaza = smoothNoise(tx * 0.035 + 71, ty * 0.035 - 43) > 0.83;
  return laneX || laneY || plaza;
}

function isWaterTile(tx: number, ty: number, biome: Biome, road: boolean): boolean {
  if (road) return false;
  const body = smoothNoise(tx * 0.06 + 401, ty * 0.06 - 173);
  const detail = smoothNoise(tx * 0.13 + 31, ty * 0.13 + 61);
  const threshold = biome === 'desert' ? 0.87 : biome === 'snow' ? 0.84 : 0.8;
  return body > threshold && detail > 0.36;
}

function expNeed(level: number): number {
  return Math.floor(60 + (level * 42) + (level * level * 5));
}

function enemyBase(kind: EnemyKind): EnemyBase {
  if (kind === 'rat') {
    return { hp: 26, speed: 90, damage: 6, radius: 9, xp: 7 };
  }
  if (kind === 'bat') {
    return { hp: 30, speed: 102, damage: 7, radius: 9, xp: 9 };
  }
  if (kind === 'spider') {
    return { hp: 44, speed: 74, damage: 9, radius: 11, xp: 11 };
  }
  if (kind === 'raider') {
    return { hp: 50, speed: 64, damage: 9, radius: 11, xp: 11 };
  }
  if (kind === 'wisp') {
    return { hp: 32, speed: 82, damage: 8, radius: 10, xp: 10 };
  }
  if (kind === 'serpent') {
    return { hp: 68, speed: 72, damage: 12, radius: 13, xp: 15 };
  }
  if (kind === 'golem') {
    return { hp: 150, speed: 40, damage: 15, radius: 16, xp: 36 };
  }
  if (kind === 'boss_reaper') {
    return { hp: 420, speed: 52, damage: 19, radius: 20, xp: 130 };
  }
  if (kind === 'boss_hydra') {
    return { hp: 560, speed: 44, damage: 24, radius: 23, xp: 170 };
  }
  return { hp: 38, speed: 56, damage: 7, radius: 12, xp: 8 };
}

function pickEnemyKind(biome: Biome, roll: number, eliteBias: number, elapsedSeconds: number): EnemyKind {
  if (eliteBias > 0.992) return 'golem';
  if (biome === 'desert') {
    if (elapsedSeconds > 85 && roll > 0.82) return 'serpent';
    if (roll > 0.58) return 'raider';
    if (roll > 0.3) return 'rat';
    return 'wisp';
  }
  if (biome === 'snow') {
    if (elapsedSeconds > 75 && roll > 0.84) return 'bat';
    if (roll > 0.58) return 'wisp';
    if (roll > 0.3) return 'rat';
    return 'slime';
  }
  if (elapsedSeconds > 60 && roll > 0.8) return 'spider';
  if (roll > 0.6) return 'raider';
  if (roll > 0.36) return 'slime';
  return 'bat';
}

function createDefaultPlayer(): PlayerState {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 'down',
    avatar: 'heyi',
    hp: 145,
    maxHp: 145,
    level: 1,
    exp: 0,
    expNext: expNeed(1),
    speed: 172,
    attack: 20,
    armor: 6,
    attackTimer: 0,
    attackInterval: 0.5,
    projectileSpeed: 340,
    projectilePierce: 0,
    pickupRadius: 30,
    weaponTier: 0,
    armorTier: 0,
    skillBladeLevel: 0,
    skillNovaLevel: 0,
    skillSplitLevel: 0,
    novaTimer: 0,
    contactCd: 0,
    kills: 0,
  };
}

function hydratePlayer(saved: SaveData | null): PlayerState {
  const base = createDefaultPlayer();
  if (!saved?.player) return base;

  const incoming = saved.player;
  const numOr = (value: unknown, fallback: number): number => (
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  );
  const merged: PlayerState = {
    ...base,
    ...(incoming as Partial<PlayerState>),
  };

  if (typeof incoming.atk === 'number' && !Number.isNaN(incoming.atk)) {
    merged.attack = incoming.atk;
  }
  if (typeof incoming.def === 'number' && !Number.isNaN(incoming.def)) {
    merged.armor = incoming.def;
  }

  merged.level = clamp(Math.floor(merged.level), 1, 999);
  merged.maxHp = Math.max(40, Math.floor(merged.maxHp));
  merged.hp = clamp(merged.hp, 0, merged.maxHp);
  merged.speed = clamp(merged.speed, 100, 360);
  merged.attack = clamp(merged.attack, 8, 900);
  merged.armor = clamp(merged.armor, 0, 300);
  merged.attackInterval = clamp(merged.attackInterval, 0.14, 1.8);
  merged.projectileSpeed = clamp(merged.projectileSpeed, 180, 900);
  merged.projectilePierce = clamp(Math.floor(merged.projectilePierce), 0, 8);
  merged.pickupRadius = clamp(merged.pickupRadius, 20, 430);
  merged.weaponTier = clamp(Math.floor(numOr(merged.weaponTier, 0)), 0, 999);
  merged.armorTier = clamp(Math.floor(numOr(merged.armorTier, 0)), 0, 999);
  merged.avatar = merged.avatar === 'cz' ? 'cz' : 'heyi';
  merged.skillBladeLevel = clamp(Math.floor(numOr(merged.skillBladeLevel, 0)), 0, 6);
  merged.skillNovaLevel = clamp(Math.floor(numOr(merged.skillNovaLevel, 0)), 0, 6);
  merged.skillSplitLevel = clamp(Math.floor(numOr(merged.skillSplitLevel, 0)), 0, 5);
  merged.novaTimer = Math.max(0, numOr(merged.novaTimer, 0));
  merged.expNext = expNeed(merged.level);
  merged.exp = clamp(merged.exp, 0, merged.expNext - 1);
  return merged;
}

function defaultHud(walletLabel: string): HudSnapshot {
  const p = createDefaultPlayer();
  return {
    hp: p.hp,
    maxHp: p.maxHp,
    level: p.level,
    exp: p.exp,
    expNext: p.expNext,
    kills: p.kills,
    timer: 0,
    biome: 'forest',
    nearbyEnemies: 0,
    attack: p.attack,
    speed: p.speed,
    attackInterval: p.attackInterval,
    pickupRadius: p.pickupRadius,
    avatar: p.avatar,
    skillBladeLevel: p.skillBladeLevel,
    skillNovaLevel: p.skillNovaLevel,
    skillSplitLevel: p.skillSplitLevel,
    score: 0,
    bestScore: 0,
    walletLabel,
  };
}

function loadSave(): SaveData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveData;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.player || typeof parsed.player !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveGame(state: GameState): void {
  if (typeof window === 'undefined') return;
  const payload: SaveData = {
    player: state.player,
    elapsedSeconds: state.elapsedSeconds,
    difficulty: state.difficulty,
    bestScore: state.bestScore,
    leaderboard: state.leaderboard,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function addFloat(state: GameState, x: number, y: number, text: string, color: string): void {
  state.floats.push({
    id: state.floatAutoId++,
    x,
    y,
    text,
    color,
    ttl: 0.9,
  });
}

function addLog(state: GameState, msg: string): void {
  state.logs = [msg, ...state.logs].slice(0, 7);
}

function buildUpgradePool(state: GameState): UpgradeChoice[] {
  const p = state.player;
  const pool = [...BASE_UPGRADE_POOL];

  if (p.skillBladeLevel < 6) {
    const next = p.skillBladeLevel + 1;
    pool.push({
      kind: 'skill_blade',
      titleZh: next === 1 ? '技能解锁：旋刃' : `旋刃 Lv.${next}`,
      titleEn: next === 1 ? 'Unlock: Orbit Blades' : `Orbit Blades Lv.${next}`,
      descZh: next === 1
        ? '生成环绕飞刃，持续切割近身敌人。'
        : `飞刃伤害与数量提升（当前 ${p.skillBladeLevel} -> ${next}）。`,
      descEn: next === 1
        ? 'Summon orbit blades to cut nearby enemies.'
        : `Blade damage/count up (${p.skillBladeLevel} -> ${next}).`,
    });
  }

  if (p.skillNovaLevel < 6) {
    const next = p.skillNovaLevel + 1;
    pool.push({
      kind: 'skill_nova',
      titleZh: next === 1 ? '技能解锁：雷震波' : `雷震波 Lv.${next}`,
      titleEn: next === 1 ? 'Unlock: Thunder Nova' : `Thunder Nova Lv.${next}`,
      descZh: next === 1
        ? '周期释放范围冲击波。'
        : `冲击波范围更大、冷却更短（当前 ${p.skillNovaLevel} -> ${next}）。`,
      descEn: next === 1
        ? 'Release periodic area shockwaves.'
        : `Larger range, faster cooldown (${p.skillNovaLevel} -> ${next}).`,
    });
  }

  if (p.skillSplitLevel < 5) {
    const next = p.skillSplitLevel + 1;
    pool.push({
      kind: 'skill_split',
      titleZh: next === 1 ? '技能解锁：分裂弹' : `分裂弹 Lv.${next}`,
      titleEn: next === 1 ? 'Unlock: Split Shot' : `Split Shot Lv.${next}`,
      descZh: next === 1
        ? '自动攻击额外发射 1 枚子弹。'
        : `额外子弹数量增加（当前 ${p.skillSplitLevel} -> ${next}）。`,
      descEn: next === 1
        ? 'Auto-attack fires one extra projectile.'
        : `More extra projectiles (${p.skillSplitLevel} -> ${next}).`,
    });
  }

  return pool;
}

function rollUpgradeChoices(state: GameState, seed: number): UpgradeChoice[] {
  const bag = buildUpgradePool(state);
  for (let i = bag.length - 1; i > 0; i--) {
    const roll = hash01(seed + i * 13, seed * 7 + i * 31);
    const j = Math.floor(roll * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const picked = bag.slice(0, 3);
  const isSkill = (kind: UpgradeKind): boolean => (
    kind === 'skill_blade' || kind === 'skill_nova' || kind === 'skill_split'
  );
  const hasSkillInBag = bag.some((choice) => isSkill(choice.kind));
  const hasSkillInPicked = picked.some((choice) => isSkill(choice.kind));
  if (hasSkillInBag && !hasSkillInPicked) {
    const skillChoice = bag.find((choice) => isSkill(choice.kind));
    if (skillChoice) picked[2] = skillChoice;
  }
  return picked;
}

function applyUpgrade(state: GameState, kind: UpgradeKind): void {
  const p = state.player;
  if (kind === 'power') {
    p.attack += 6;
    addLog(state, '升级：攻击力提升。');
    return;
  }
  if (kind === 'firerate') {
    p.attackInterval = clamp(p.attackInterval * 0.9, 0.12, 2);
    addLog(state, '升级：自动攻击更快。');
    return;
  }
  if (kind === 'movespeed') {
    p.speed = clamp(p.speed + 12, 90, 420);
    addLog(state, '升级：移动速度提升。');
    return;
  }
  if (kind === 'maxhp') {
    p.maxHp += 24;
    p.hp = Math.min(p.maxHp, p.hp + 24);
    addLog(state, '升级：生命上限提升。');
    return;
  }
  if (kind === 'pickup') {
    p.pickupRadius = clamp(p.pickupRadius + 22, 20, 430);
    addLog(state, '升级：经验吸附半径提升。');
    return;
  }
  if (kind === 'pierce') {
    p.projectilePierce = clamp(p.projectilePierce + 1, 0, 10);
    addLog(state, '升级：投射物可穿透更多目标。');
    return;
  }
  if (kind === 'projectile') {
    p.projectileSpeed = clamp(p.projectileSpeed + 70, 180, 980);
    addLog(state, '升级：弹道推进强化。');
    return;
  }
  if (kind === 'skill_blade') {
    p.skillBladeLevel = clamp(p.skillBladeLevel + 1, 0, 6);
    addLog(state, `技能升级：旋刃 Lv.${p.skillBladeLevel}`);
    return;
  }
  if (kind === 'skill_nova') {
    p.skillNovaLevel = clamp(p.skillNovaLevel + 1, 0, 6);
    p.novaTimer = Math.min(p.novaTimer, 0.25);
    addLog(state, `技能升级：雷震波 Lv.${p.skillNovaLevel}`);
    return;
  }

  p.skillSplitLevel = clamp(p.skillSplitLevel + 1, 0, 5);
  addLog(state, `技能升级：分裂弹 Lv.${p.skillSplitLevel}`);
}

function rollLevelUp(state: GameState): void {
  const p = state.player;
  if (state.levelUpChoices.length > 0) return;
  if (p.exp < p.expNext) return;

  p.exp -= p.expNext;
  p.level += 1;
  p.expNext = expNeed(p.level);
  p.maxHp += 6;
  p.hp = Math.min(p.maxHp, p.hp + 14);
  p.attack += 1.2;

  state.levelUpChoices = rollUpgradeChoices(state, p.level + state.enemyAutoId + state.player.kills);
  addFloat(state, p.x, p.y - 28, `Lv.${p.level}`, '#ffe080');
  addLog(state, `升级！Lv.${p.level}，请选择一项强化。`);
}

function gainExp(state: GameState, amount: number): void {
  const p = state.player;
  p.exp += amount;
  rollLevelUp(state);
}

function spawnEnemy(state: GameState, forcedKind?: EnemyKind): void {
  const p = state.player;
  const id = state.enemyAutoId++;
  const angle = hash01(id * 17 + 11, Math.floor(state.elapsedSeconds * 10) + id * 3) * Math.PI * 2;
  const radius = SPAWN_RADIUS_MIN + (hash01(id * 7 + 5, id * 13 + 29) * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN));
  const x = p.x + (Math.cos(angle) * radius);
  const y = p.y + (Math.sin(angle) * radius);
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  const biome = sampleBiome(tx, ty);
  const kind = forcedKind ?? pickEnemyKind(
    biome,
    hash01(id, tx + ty),
    hash01(id * 3, ty * 5 + tx),
    state.elapsedSeconds,
  );
  const base = enemyBase(kind);
  const baseScale = 1 + Math.min(3, (state.elapsedSeconds / 220)) + ((state.player.level - 1) * 0.035) + (state.difficulty * 0.8);
  const scale = isBossKind(kind)
    ? 0.88 + Math.min(1.25, (state.elapsedSeconds / 420)) + (state.difficulty * 0.45)
    : baseScale;
  const speedScale = isBossKind(kind)
    ? 1 + (state.elapsedSeconds / 1400)
    : 1 + (state.elapsedSeconds / 780);
  const damageGrowthDiv = isBossKind(kind) ? 85 : 130;

  state.enemies.push({
    id,
    kind,
    x,
    y,
    hp: base.hp * scale,
    maxHp: base.hp * scale,
    speed: base.speed * speedScale,
    damage: Math.max(2, Math.floor(base.damage + (state.elapsedSeconds / damageGrowthDiv))),
    radius: base.radius,
    bladeHitCd: 0,
  });
}

function spawnEnemies(state: GameState, dt: number): void {
  const p = state.player;
  const nearby = state.enemies.filter((e) => len(e.x - p.x, e.y - p.y) < 860).length;
  if (nearby >= MAX_NEARBY_ENEMIES) return;

  state.spawnClock += dt;
  const spawnInterval = clamp(1.24 - (state.elapsedSeconds * 0.0056), 0.22, 1.24);
  while (state.spawnClock >= spawnInterval) {
    state.spawnClock -= spawnInterval;
    const pack = clamp(1 + Math.floor(state.elapsedSeconds / 105) + Math.floor(state.player.level / 9), 1, 4);
    for (let i = 0; i < pack; i++) {
      spawnEnemy(state);
    }
  }
}

function trySpawnElite(state: GameState, prevTime: number): void {
  const prevWave = Math.floor(prevTime / 58);
  const nowWave = Math.floor(state.elapsedSeconds / 58);
  if (nowWave <= 0 || nowWave === prevWave) return;
  const playerBiome = sampleBiome(Math.floor(state.player.x / TILE_SIZE), Math.floor(state.player.y / TILE_SIZE));
  const sideElite: EnemyKind = playerBiome === 'desert'
    ? 'serpent'
    : playerBiome === 'snow'
      ? 'bat'
      : 'spider';
  spawnEnemy(state, 'golem');
  spawnEnemy(state, sideElite);
  if (nowWave % 3 === 0) spawnEnemy(state, 'raider');
  addLog(state, '精英波次到来：巨像领队冲阵！');
}

function trySpawnBoss(state: GameState, prevTime: number): void {
  const prevWave = Math.floor(prevTime / 90);
  const nowWave = Math.floor(state.elapsedSeconds / 90);
  if (nowWave <= 0 || nowWave === prevWave || nowWave <= state.lastBossWave) return;

  const playerBiome = sampleBiome(Math.floor(state.player.x / TILE_SIZE), Math.floor(state.player.y / TILE_SIZE));
  const boss: EnemyKind = playerBiome === 'desert'
    ? 'boss_hydra'
    : playerBiome === 'snow'
      ? 'boss_reaper'
      : nowWave % 2 === 0
        ? 'boss_hydra'
        : 'boss_reaper';
  const support: EnemyKind = boss === 'boss_hydra' ? 'serpent' : 'wisp';

  state.lastBossWave = nowWave;
  spawnEnemy(state, boss);
  spawnEnemy(state, support);
  spawnEnemy(state, support);
  if (nowWave % 4 === 0) spawnEnemy(state, boss === 'boss_hydra' ? 'boss_reaper' : 'boss_hydra');
  addLog(state, boss === 'boss_hydra' ? 'Boss 来袭：噬界九头蛇出现！' : 'Boss 来袭：裁魂死神出现！');
}

function dropGemsFromEnemy(state: GameState, enemy: EnemyState): void {
  const base = enemyBase(enemy.kind);
  const boss = isBossKind(enemy.kind);
  const chunks = boss
    ? 10
    : enemy.kind === 'golem'
      ? 5
      : enemy.kind === 'serpent' || enemy.kind === 'spider' || enemy.kind === 'raider'
        ? 2
        : 1;
  for (let i = 0; i < chunks; i++) {
    const id = state.gemAutoId++;
    const xp = Math.max(1, Math.round(base.xp * (i === 0 ? (boss ? 1.22 : 1) : 0.68)));
    state.gems.push({
      id,
      x: enemy.x + ((hash01(id * 5, enemy.id * 3 + i) - 0.5) * 18),
      y: enemy.y + ((hash01(id * 7, enemy.id * 5 + i) - 0.5) * 18),
      xp,
      ttl: 35,
    });
  }
  const killDropChance = boss
    ? 1
    : enemy.kind === 'golem' || enemy.kind === 'serpent' || enemy.kind === 'spider'
      ? 0.24
      : 0.1;
  const dropRoll = hash01(enemy.id * 97 + state.supplyAutoId, Math.floor(state.elapsedSeconds * 12));
  if (dropRoll > killDropChance) return;

  const dropCount = boss ? 3 : 1;
  for (let i = 0; i < dropCount; i++) {
    const id = state.supplyAutoId++;
    const roll = hash01(enemy.id * 11 + i * 7, Math.floor(state.elapsedSeconds * 9) + i);
    const kind = pickCombatDropKind(roll, boss);
    state.supplies.push({
      id,
      kind,
      x: enemy.x + ((hash01(id * 13 + 5, enemy.id * 17 + i) - 0.5) * (boss ? 34 : 20)),
      y: enemy.y + ((hash01(id * 19 + 3, enemy.id * 23 + i) - 0.5) * (boss ? 34 : 20)),
      ttl: boss ? 35 + (hash01(id * 31, enemy.id * 41) * 14) : 24 + (hash01(id * 31, enemy.id * 41) * 10),
    });
  }
  if (boss) {
    addLog(state, 'Boss 被击倒：掉落药水与装备。');
  }
}

function nextSupplySpawnDelay(state: GameState): number {
  const seed = hash01(state.supplyAutoId * 19 + state.player.level, Math.floor(state.elapsedSeconds * 10) + state.enemyAutoId);
  const base = clamp(15.5 - (state.elapsedSeconds * 0.03), SUPPLY_SPAWN_INTERVAL_MIN, SUPPLY_SPAWN_INTERVAL_MAX);
  return clamp(base + ((seed - 0.5) * 3.4), SUPPLY_SPAWN_INTERVAL_MIN, SUPPLY_SPAWN_INTERVAL_MAX);
}

function pickSupplyKind(seed: number): SupplyKind {
  if (seed > 0.92) return 'equip_blade';
  if (seed > 0.82) return 'equip_armor';
  if (seed > 0.7) return 'potion_hp';
  if (seed > 0.58) return 'potion_fury';
  if (seed > 0.45) return 'medkit';
  if (seed > 0.3) return 'haste';
  if (seed > 0.16) return 'magnet';
  return 'armor';
}

function pickCombatDropKind(seed: number, boss: boolean): SupplyKind {
  if (boss) {
    if (seed > 0.8) return 'equip_blade';
    if (seed > 0.62) return 'equip_armor';
    if (seed > 0.44) return 'potion_fury';
    if (seed > 0.24) return 'potion_hp';
    return 'haste';
  }
  if (seed > 0.9) return 'equip_blade';
  if (seed > 0.8) return 'equip_armor';
  if (seed > 0.6) return 'potion_hp';
  if (seed > 0.42) return 'potion_fury';
  if (seed > 0.24) return 'medkit';
  return 'armor';
}

function spawnSupply(state: GameState): void {
  const p = state.player;
  const id = state.supplyAutoId++;
  const angle = hash01(id * 31 + 9, Math.floor(state.elapsedSeconds * 7) + id * 5) * Math.PI * 2;
  const radius = 120 + (hash01(id * 11 + 7, id * 13 + 3) * 260);
  const kind = pickSupplyKind(hash01(id * 17 + 13, id * 23 + 5));
  state.supplies.push({
    id,
    kind,
    x: p.x + (Math.cos(angle) * radius),
    y: p.y + (Math.sin(angle) * radius),
    ttl: 22 + (hash01(id * 29 + 1, id * 37 + 11) * 16),
  });
  addLog(state, '地图出现补给箱，记得去拾取。');
}

function pickupSupply(state: GameState, supply: SupplyState): void {
  const p = state.player;
  if (supply.kind === 'potion_hp') {
    const heal = Math.round(30 + p.level * 2.2);
    p.hp = Math.min(p.maxHp, p.hp + heal);
    addFloat(state, p.x, p.y - 24, `+${heal} HP`, '#86ffd1');
    addLog(state, `药水：生命药剂恢复 ${heal} 点生命。`);
    return;
  }
  if (supply.kind === 'potion_fury') {
    p.attack = clamp(p.attack + 4.8, 8, 1600);
    p.attackInterval = clamp(p.attackInterval * 0.96, 0.12, 2);
    addFloat(state, p.x, p.y - 24, '狂热药剂', '#ffd08a');
    addLog(state, '药水：狂热药剂生效，攻击与攻速提升。');
    return;
  }
  if (supply.kind === 'equip_blade') {
    p.attack = clamp(p.attack + 7.2, 8, 1800);
    p.projectilePierce = clamp(p.projectilePierce + 1, 0, 12);
    p.weaponTier = clamp(p.weaponTier + 1, 0, 999);
    addFloat(state, p.x, p.y - 24, '装备：锋刃', '#ffd78e');
    addLog(state, `装备掉落：锋刃组件已装配（攻击+穿透，武器阶级 ${p.weaponTier}）。`);
    return;
  }
  if (supply.kind === 'equip_armor') {
    p.armor = clamp(p.armor + 2, 0, 300);
    p.maxHp = Math.min(9999, p.maxHp + 14);
    p.hp = Math.min(p.maxHp, p.hp + 14);
    p.armorTier = clamp(p.armorTier + 1, 0, 999);
    addFloat(state, p.x, p.y - 24, '装备：护甲', '#c5ddff');
    addLog(state, `装备掉落：护甲组件已装配（防御+生命，护甲阶级 ${p.armorTier}）。`);
    return;
  }
  if (supply.kind === 'medkit') {
    const heal = Math.round(20 + p.level * 1.8);
    p.hp = Math.min(p.maxHp, p.hp + heal);
    addFloat(state, p.x, p.y - 24, `+${heal} HP`, '#9dffbc');
    addLog(state, `补给：医疗包生效，恢复 ${heal} 点生命。`);
    return;
  }
  if (supply.kind === 'haste') {
    p.attackInterval = clamp(p.attackInterval * 0.9, 0.12, 2);
    addFloat(state, p.x, p.y - 24, '攻速提升', '#ffe48e');
    addLog(state, '补给：攻速强化，自动攻击更快。');
    return;
  }
  if (supply.kind === 'magnet') {
    p.pickupRadius = clamp(p.pickupRadius + 18, 20, 430);
    addFloat(state, p.x, p.y - 24, '磁吸半径+', '#9ed7ff');
    addLog(state, '补给：磁吸核心，经验拾取半径提升。');
    return;
  }

  p.armor = clamp(p.armor + 1, 0, 300);
  p.hp = Math.min(p.maxHp, p.hp + 8);
  addFloat(state, p.x, p.y - 24, '护甲提升', '#c5ddff');
  addLog(state, '补给：护甲片生效，减伤能力提升。');
}

function formatTimer(total: number): string {
  const safe = Math.max(0, Math.floor(total));
  const mm = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const ss = Math.floor(safe % 60)
    .toString()
    .padStart(2, '0');
  return `${mm}:${ss}`;
}

function shortAccountLabel(account: string | null | undefined, guestLabel: string): string {
  if (!account) return guestLabel;
  const v = account.trim();
  if (!v) return guestLabel;
  if (v.length <= 12) return v;
  return `${v.slice(0, 6)}...${v.slice(-4)}`;
}

function sortLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.level !== a.level) return b.level - a.level;
    if (b.kills !== a.kills) return b.kills - a.kills;
    if (b.survivalSeconds !== a.survivalSeconds) return b.survivalSeconds - a.survivalSeconds;
    return b.at - a.at;
  });
}

function normalizeLeaderboard(raw: unknown): LeaderboardEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: LeaderboardEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Partial<LeaderboardEntry>;
    const score = typeof rec.score === 'number' && Number.isFinite(rec.score) ? Math.max(0, Math.floor(rec.score)) : 0;
    const kills = typeof rec.kills === 'number' && Number.isFinite(rec.kills) ? Math.max(0, Math.floor(rec.kills)) : 0;
    const level = typeof rec.level === 'number' && Number.isFinite(rec.level) ? clamp(Math.floor(rec.level), 1, 999) : 1;
    const survivalSeconds = typeof rec.survivalSeconds === 'number' && Number.isFinite(rec.survivalSeconds)
      ? Math.max(0, Math.floor(rec.survivalSeconds))
      : 0;
    const at = typeof rec.at === 'number' && Number.isFinite(rec.at) ? rec.at : Date.now();
    const account = typeof rec.account === 'string' && rec.account.trim() ? rec.account.trim().slice(0, 32) : 'Guest';
    entries.push({
      id: typeof rec.id === 'string' && rec.id ? rec.id : `${at}-${entries.length}`,
      account,
      avatar: rec.avatar === 'cz' ? 'cz' : 'heyi',
      score,
      kills,
      level,
      survivalSeconds,
      at,
    });
  }
  return sortLeaderboard(entries).slice(0, LEADERBOARD_MAX_SAVE);
}

function drawPixelPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: Direction,
  avatar: AvatarKind,
  moving: boolean,
  nowMs: number,
  assets: OgaAssets | null,
): void {
  if (!assets) {
    const bob = moving ? Math.sin(nowMs * 0.014) * 1.1 : 0;
    const px = Math.floor(x);
    const py = Math.floor(y + bob);
    ctx.fillStyle = '#241d15';
    ctx.fillRect(px - 4, py - 11, 8, 3);
    ctx.fillStyle = '#ffdfc1';
    ctx.fillRect(px - 3, py - 8, 6, 5);
    ctx.fillStyle = '#111725';
    ctx.fillRect(px - 5, py - 3, 10, 7);
    ctx.fillStyle = '#f3c24f';
    ctx.fillRect(px - 2, py + 2, 4, 2);
    ctx.fillStyle = '#2f4c79';
    ctx.fillRect(px - 4, py + 4, 3, 5);
    ctx.fillRect(px + 1, py + 4, 3, 5);
    return;
  }

  const frameIndex = moving ? [0, 1, 2, 3][Math.floor(nowMs / 110) % 4] : 0;
  const frames = avatar === 'cz'
    ? [assets.czWalk0, assets.czWalk1, assets.czWalk2, assets.czWalk3]
    : [assets.heyiWalk0, assets.heyiWalk1, assets.heyiWalk2, assets.heyiWalk3];
  const sprite = frames[frameIndex] ?? frames[0];
  const dx = Math.floor(x) - 16;
  const dy = Math.floor(y) - 22;

  ctx.save();
  if (facing === 'left') {
    ctx.translate(dx + 32, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite, 0, 0, 32, 32);
  } else {
    ctx.drawImage(sprite, dx, dy, 32, 32);
  }
  ctx.restore();
}

function drawEnemy(
  ctx: CanvasRenderingContext2D,
  e: EnemyState,
  sx: number,
  sy: number,
  nowMs: number,
  assets: OgaAssets | null,
): void {
  const x = Math.floor(sx);
  const y = Math.floor(sy);
  const visual = ROGUELIKE_MONSTER_MAP[e.kind];
  const boss = isBossKind(e.kind);
  if (assets) {
    if (visual) {
      const srcX = visual.col * ROGUELIKE_MONSTER_CELL;
      const srcY = visual.row * ROGUELIKE_MONSTER_CELL;
      const ghost = visual.ghost === true;
      const bob = ghost ? Math.sin(nowMs * 0.012 + e.id) * 1.4 : Math.sin(nowMs * 0.008 + e.id) * 0.5;
      const drawSize = Math.round(32 * visual.scale);
      const drawX = x - Math.floor(drawSize / 2);
      const drawY = Math.floor(y - Math.floor(drawSize / 2) + bob);
      if (ghost) {
        ctx.save();
        ctx.globalAlpha = 0.78 + (Math.sin(nowMs * 0.013 + e.id) * 0.18);
        ctx.drawImage(
          assets.roguelikeMonsters,
          srcX,
          srcY,
          ROGUELIKE_MONSTER_CELL,
          ROGUELIKE_MONSTER_CELL,
          drawX,
          drawY,
          drawSize,
          drawSize,
        );
        ctx.restore();
      } else {
        ctx.drawImage(
          assets.roguelikeMonsters,
          srcX,
          srcY,
          ROGUELIKE_MONSTER_CELL,
          ROGUELIKE_MONSTER_CELL,
          drawX,
          drawY,
          drawSize,
          drawSize,
        );
      }
    } else if (e.kind === 'slime') {
      const oldFrame = Math.floor(nowMs / 100 + e.id) % 12;
      ctx.drawImage(assets.slime, oldFrame * 32, 0, 32, 32, x - 16, y - 16, 32, 32);
    } else if (e.kind === 'raider') {
      ctx.drawImage(assets.monGoblin, x - 16, y - 16, 32, 32);
    } else if (e.kind === 'wisp') {
      ctx.save();
      ctx.globalAlpha = 0.8 + (Math.sin(nowMs * 0.01 + e.id) * 0.2);
      ctx.drawImage(assets.monWisp, x - 16, y - 16, 32, 32);
      ctx.restore();
    } else {
      ctx.drawImage(assets.monGolem, x - 16, y - 16, 32, 32);
    }
  } else {
    if (e.kind === 'slime') {
      ctx.fillStyle = '#67d06e';
      ctx.fillRect(x - 8, y - 6, 16, 12);
      ctx.fillStyle = '#2d6e36';
      ctx.fillRect(x - 6, y - 3, 2, 2);
      ctx.fillRect(x + 4, y - 3, 2, 2);
    } else if (e.kind === 'raider') {
      ctx.fillStyle = '#3b2b1d';
      ctx.fillRect(x - 6, y - 10, 12, 20);
      ctx.fillStyle = '#ffc999';
      ctx.fillRect(x - 4, y - 9, 8, 6);
      ctx.fillStyle = '#d04f3e';
      ctx.fillRect(x - 7, y - 12, 14, 3);
    } else if (e.kind === 'wisp') {
      const glow = 0.44 + (Math.sin(nowMs * 0.013 + e.id) * 0.22);
      ctx.fillStyle = `rgba(123, 218, 255, ${glow})`;
      ctx.beginPath();
      ctx.arc(x, y - 2, 9, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.kind === 'spider' || e.kind === 'bat' || e.kind === 'rat') {
      ctx.fillStyle = '#5a4738';
      ctx.fillRect(x - 7, y - 5, 14, 10);
      ctx.fillStyle = '#c9a86d';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    } else if (e.kind === 'serpent') {
      ctx.fillStyle = '#698e3e';
      ctx.fillRect(x - 10, y - 4, 18, 8);
      ctx.fillStyle = '#eff08f';
      ctx.fillRect(x + 7, y - 2, 2, 3);
    } else {
      ctx.fillStyle = boss ? '#886f63' : '#67686f';
      ctx.fillRect(x - 12, y - 14, 24, 28);
      ctx.fillStyle = boss ? '#eadcb8' : '#c8a85b';
      ctx.fillRect(x - 8, y - 8, 16, 5);
    }
  }

  const hpPct = clamp(e.hp / e.maxHp, 0, 1);
  const hpBarWidth = boss ? 40 : 24;
  const hpBarX = x - Math.floor(hpBarWidth / 2);
  ctx.fillStyle = 'rgba(20, 24, 28, 0.8)';
  ctx.fillRect(hpBarX, y - 16, hpBarWidth, 3);
  ctx.fillStyle = boss ? '#f3a065' : '#ef756f';
  ctx.fillRect(hpBarX, y - 16, hpBarWidth * hpPct, 3);
  if (boss) {
    ctx.fillStyle = 'rgba(12, 20, 14, 0.88)';
    ctx.fillRect(hpBarX, y - 24, hpBarWidth, 7);
    ctx.fillStyle = '#ffe3a1';
    ctx.font = '6px "Press Start 2P", monospace';
    ctx.fillText('BOSS', hpBarX + 3, y - 18);
  }
}

function drawGem(
  ctx: CanvasRenderingContext2D,
  gem: GemState,
  sx: number,
  sy: number,
  assets: OgaAssets | null,
): void {
  const x = Math.floor(sx);
  const y = Math.floor(sy);
  if (assets) {
    const img = gem.xp >= 10 ? assets.itemGold : assets.itemCrystal;
    ctx.drawImage(img, x - 10, y - 10, 20, 20);
    return;
  }
  ctx.fillStyle = gem.xp >= 10 ? '#f3c84f' : '#b38dff';
  ctx.beginPath();
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x + 5, y);
  ctx.lineTo(x, y + 6);
  ctx.lineTo(x - 5, y);
  ctx.closePath();
  ctx.fill();
}

function drawSupply(
  ctx: CanvasRenderingContext2D,
  supply: SupplyState,
  sx: number,
  sy: number,
  nowMs: number,
  assets: OgaAssets | null,
): void {
  const x = Math.floor(sx);
  const y = Math.floor(sy + (Math.sin((nowMs * 0.006) + supply.id) * 1.8));
  const supplyColor = supply.kind === 'medkit'
    ? '#8dffb1'
    : supply.kind === 'haste'
      ? '#ffe28a'
      : supply.kind === 'magnet'
        ? '#95dbff'
        : supply.kind === 'armor'
          ? '#d4ddff'
          : supply.kind === 'potion_hp'
            ? '#8efad1'
            : supply.kind === 'potion_fury'
              ? '#ffb781'
              : supply.kind === 'equip_blade'
                ? '#fbd89b'
                : '#b7cbff';
  if (assets) {
    const img = supply.kind === 'potion_hp'
      ? assets.iconPotionRed
      : supply.kind === 'potion_fury'
        ? assets.iconPotionBlue
      : supply.kind === 'equip_armor'
          ? assets.iconHelmet
          : supply.kind === 'medkit'
          ? assets.iconShield
          : supply.kind === 'haste'
            ? assets.iconArrow
            : supply.kind === 'magnet'
              ? assets.itemCrystal
              : supply.kind === 'armor'
                ? assets.iconShield
                : assets.iconSword;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = supplyColor;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.drawImage(img, x - 10, y - 10, 20, 20);
    return;
  }

  ctx.fillStyle = supplyColor;
  ctx.fillRect(x - 6, y - 6, 12, 12);
  ctx.fillStyle = '#102015';
  ctx.fillRect(x - 2, y - 2, 4, 4);
}

function drawProjectile(
  ctx: CanvasRenderingContext2D,
  projectile: ProjectileState,
  sx: number,
  sy: number,
  assets: OgaAssets | null,
  nowMs: number,
): void {
  if (assets) {
    const icon = projectile.style === 'sword'
      ? assets.iconSword
      : projectile.style === 'bow'
        ? assets.iconBow
        : projectile.style === 'staff'
          ? assets.iconStaff
          : assets.iconArrow;
    const angle = Math.atan2(projectile.vy, projectile.vx);
    const size = projectile.style === 'sword' ? 16 : 14;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angle);
    ctx.drawImage(icon, -size / 2, -size / 2, size, size);

    if (projectile.element === 'water' && assets.waterProjectileFrames.length > 0) {
      const frame = assets.waterProjectileFrames[Math.floor(nowMs / 85 + projectile.id) % assets.waterProjectileFrames.length];
      const waterSize = 22;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.82;
      ctx.drawImage(frame, -waterSize * 0.7, -waterSize / 2, waterSize, waterSize);
    } else if (projectile.element === 'thunder') {
      const sheet = assets.spellMagicSheet;
      const cell = 100;
      const cols = Math.max(1, Math.floor(sheet.width / cell));
      const rows = Math.max(1, Math.floor(sheet.height / cell));
      const total = cols * rows;
      const frame = Math.floor(nowMs / 60 + projectile.id * 2) % total;
      const srcX = (frame % cols) * cell;
      const srcY = Math.floor(frame / cols) * cell;
      const thunderSize = 24;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.86;
      ctx.drawImage(sheet, srcX, srcY, cell, cell, -thunderSize / 2, -thunderSize / 2, thunderSize, thunderSize);
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = 'rgba(255, 233, 120, 0.52)';
      ctx.beginPath();
      ctx.arc(0, 0, thunderSize * 0.42, 0, Math.PI * 2);
      ctx.fill();
    } else if (projectile.element === 'ice') {
      const sheet = assets.spellRingSheet;
      const cell = 100;
      const cols = Math.max(1, Math.floor(sheet.width / cell));
      const rows = Math.max(1, Math.floor(sheet.height / cell));
      const total = cols * rows;
      const frame = Math.floor(nowMs / 80 + projectile.id) % total;
      const srcX = (frame % cols) * cell;
      const srcY = Math.floor(frame / cols) * cell;
      const iceSize = 20;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.78;
      ctx.drawImage(sheet, srcX, srcY, cell, cell, -iceSize / 2, -iceSize / 2, iceSize, iceSize);
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = 'rgba(173, 233, 255, 0.58)';
      ctx.beginPath();
      ctx.arc(0, 0, iceSize * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  ctx.fillStyle = 'rgba(255, 214, 122, 0.95)';
  ctx.beginPath();
  ctx.arc(sx, sy, projectile.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 242, 201, 0.92)';
  ctx.fillRect(sx - 1, sy - 1, 2, 2);
}

function drawBladeOrbit(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  elapsedSeconds: number,
  skillLevel: number,
  assets: OgaAssets | null,
): void {
  if (skillLevel <= 0) return;
  const blades = Math.min(6, 1 + skillLevel);
  const radius = bladeOrbitRadius(skillLevel);
  const spin = elapsedSeconds * (2.8 + (skillLevel * 0.15));
  const ringFrame = assets ? Math.floor(elapsedSeconds * 18) % 64 : 0;
  for (let i = 0; i < blades; i++) {
    const angle = spin + ((i / blades) * Math.PI * 2);
    const bx = x + (Math.cos(angle) * radius);
    const by = y + (Math.sin(angle) * radius);
    if (assets) {
      const sheet = assets.spellRingSheet;
      const cell = 100;
      const cols = Math.max(1, Math.floor(sheet.width / cell));
      const rows = Math.max(1, Math.floor(sheet.height / cell));
      const total = cols * rows;
      const frame = ringFrame % total;
      const srcX = (frame % cols) * cell;
      const srcY = Math.floor(frame / cols) * cell;
      const drawSize = 20 + (skillLevel * 2.6);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9;
      ctx.drawImage(sheet, srcX, srcY, cell, cell, bx - drawSize / 2, by - drawSize / 2, drawSize, drawSize);
      ctx.restore();
      continue;
    }
    ctx.fillStyle = 'rgba(146, 236, 255, 0.85)';
    ctx.fillRect(Math.floor(bx - 3), Math.floor(by - 3), 6, 6);
    ctx.fillStyle = 'rgba(219, 252, 255, 0.92)';
    ctx.fillRect(Math.floor(bx - 1), Math.floor(by - 1), 2, 2);
  }
}

function drawWave(ctx: CanvasRenderingContext2D, wave: WaveFx, sx: number, sy: number): void {
  const alpha = clamp(wave.ttl / 0.42, 0, 1);
  ctx.strokeStyle = wave.color.replace('{alpha}', alpha.toFixed(3));
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx, sy, wave.radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSpriteFx(
  ctx: CanvasRenderingContext2D,
  fx: SpriteFx,
  sx: number,
  sy: number,
  assets: OgaAssets | null,
): void {
  const progress = clamp(1 - (fx.ttl / fx.maxTtl), 0, 1);
  const alpha = clamp(1 - progress * 0.86, 0, 1);

  if (!assets) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fx.element === 'thunder' ? '#ffe08a' : fx.element === 'ice' ? '#b9ecff' : '#8fe5ff';
    ctx.beginPath();
    ctx.arc(sx, sy, (fx.size * (0.2 + progress * 0.55)), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const isNova = fx.kind === 'nova';
  const isMuzzle = fx.kind === 'muzzle';
  const element = fx.element;
  const drawSize = fx.size * (isNova ? (0.56 + progress * 1.1) : isMuzzle ? (0.62 + progress * 0.52) : (0.66 + progress * 0.72));

  const drawSheetFrame = (sheet: HTMLImageElement, tint?: string) => {
    const cell = 100;
    const cols = Math.max(1, Math.floor(sheet.width / cell));
    const rows = Math.max(1, Math.floor(sheet.height / cell));
    const total = cols * rows;
    const frame = Math.min(total - 1, Math.floor(progress * (total - 1)));
    const srcX = (frame % cols) * cell;
    const srcY = Math.floor(frame / cols) * cell;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(fx.rotation + (progress * (isNova ? 0.28 : 0.6)));
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(sheet, srcX, srcY, cell, cell, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
    if (tint) {
      // Use radial glow instead of square overlay to avoid visible box artifacts.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.48;
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(0, 0, drawSize * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  if (element === 'water') {
    const waterFrames = isNova
      ? assets.waterNovaFrames
      : isMuzzle
        ? assets.waterProjectileFrames
        : assets.waterImpactFrames;
    if (waterFrames.length > 0) {
      const frame = waterFrames[Math.min(waterFrames.length - 1, Math.floor(progress * (waterFrames.length - 1)))];
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(fx.rotation + (progress * (isNova ? 0.24 : 0.56)));
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(frame, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      ctx.restore();
      return;
    }
    drawSheetFrame(isNova ? assets.spellNovaSheet : isMuzzle ? assets.spellMagicSheet : assets.spellHitSheet);
    return;
  }

  if (element === 'thunder') {
    const sheet = isNova ? assets.spellNovaSheet : isMuzzle ? assets.spellMagicSheet : assets.spellHitSheet;
    const tint = isMuzzle ? 'rgba(255, 234, 118, 0.42)' : 'rgba(174, 225, 255, 0.32)';
    drawSheetFrame(sheet, tint);
    return;
  }

  // Ice effect for nova: cooler tint + ring-styled frame.
  const iceSheet = isNova ? assets.spellRingSheet : assets.spellHitSheet;
  drawSheetFrame(iceSheet, 'rgba(173, 233, 255, 0.52)');
}

function drawLpcTile(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  tileId: number,
  dx: number,
  dy: number,
  dw: number = TILE_SIZE,
  dh: number = TILE_SIZE,
): void {
  const srcX = (tileId % LPC_TILESET_COLS) * LPC_TILE_SIZE;
  const srcY = Math.floor(tileId / LPC_TILESET_COLS) * LPC_TILE_SIZE;
  ctx.drawImage(sheet, srcX, srcY, LPC_TILE_SIZE, LPC_TILE_SIZE, Math.floor(dx), Math.floor(dy), Math.floor(dw), Math.floor(dh));
}

function drawLpcVillageDecor(
  ctx: CanvasRenderingContext2D,
  biome: Biome,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  nowMs: number,
  assets: OgaAssets | null,
): void {
  if (!assets) return;
  const roll = hash01(tx * 43 + 11, ty * 67 + 29);
  if (roll < 0.962) return;

  const styleRoll = hash01(tx * 97 + 7, ty * 79 + 5);
  if (roll > 0.997) {
    const frame = LPC_FIRE_FRAMES[Math.floor(nowMs / 120 + tx + ty) % LPC_FIRE_FRAMES.length];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.9;
    drawLpcTile(ctx, assets.lpcDecorations, frame, sx, sy);
    ctx.restore();
    return;
  }

  if (roll > 0.991) {
    const left = LPC_STALL_PAIR[0];
    const right = LPC_STALL_PAIR[1];
    drawLpcTile(ctx, assets.lpcDecorations, left, sx, sy);
    drawLpcTile(ctx, assets.lpcDecorations, right, sx + TILE_SIZE, sy);
    return;
  }

  if (roll > 0.983) {
    const fenceTile = pickByRoll(LPC_FENCE_TILES, styleRoll);
    drawLpcTile(ctx, assets.lpcFence, fenceTile, sx, sy);
    return;
  }

  const source = biome === 'forest' ? LPC_DECOR_FOREST : biome === 'desert' ? LPC_DECOR_DESERT : LPC_DECOR_SNOW;
  const decorTile = pickByRoll(source, styleRoll);
  drawLpcTile(ctx, assets.lpcDecorations, decorTile, sx, sy);
}

function drawBiomeProp(
  ctx: CanvasRenderingContext2D,
  biome: Biome,
  sx: number,
  sy: number,
  r: number,
  assets: OgaAssets | null,
): void {
  if (assets) {
    if (biome === 'forest') {
      ctx.drawImage(assets.envTree, sx + 8, sy + 8, 16, 16);
      return;
    }
    if (biome === 'desert') {
      ctx.drawImage(assets.envTree, sx + 8, sy + 8, 16, 16);
      ctx.fillStyle = 'rgba(224, 194, 120, 0.55)';
      ctx.fillRect(sx + 8, sy + 8, 16, 16);
      return;
    }
    ctx.drawImage(assets.envTree, sx + 8, sy + 8, 16, 16);
    ctx.fillStyle = 'rgba(233, 242, 255, 0.66)';
    ctx.fillRect(sx + 8, sy + 8, 16, 16);
    return;
  }

  if (biome === 'forest') {
    ctx.fillStyle = '#4f8f43';
    ctx.fillRect(sx + 9, sy + 12, 4, 8);
    ctx.fillStyle = '#67b95b';
    ctx.beginPath();
    ctx.arc(sx + 11, sy + 10, 7, 0, Math.PI * 2);
    ctx.fill();
    if (r > 0.6) {
      ctx.fillStyle = '#e5777c';
      ctx.fillRect(sx + 4, sy + 18, 2, 2);
      ctx.fillRect(sx + 16, sy + 19, 2, 2);
    }
  } else if (biome === 'desert') {
    ctx.fillStyle = '#5a9d52';
    ctx.fillRect(sx + 10, sy + 8, 4, 13);
    ctx.fillRect(sx + 7, sy + 12, 3, 5);
    ctx.fillRect(sx + 14, sy + 11, 3, 5);
    ctx.fillStyle = '#d7c77f';
    ctx.fillRect(sx + 4, sy + 21, 14, 2);
  } else {
    ctx.fillStyle = '#5f7ca2';
    ctx.fillRect(sx + 9, sy + 12, 4, 8);
    ctx.fillStyle = '#99b9d9';
    ctx.beginPath();
    ctx.moveTo(sx + 11, sy + 3);
    ctx.lineTo(sx + 4, sy + 14);
    ctx.lineTo(sx + 18, sy + 14);
    ctx.closePath();
    ctx.fill();
  }
}

function drawWorldTile(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  nowMs: number,
  assets: OgaAssets | null,
): { biome: Biome; water: boolean; road: boolean } {
  const biome = sampleBiome(tx, ty);
  const road = isRoadTile(tx, ty);
  const water = isWaterTile(tx, ty, biome, road);

  const biomeTile = assets
    ? biome === 'forest'
      ? assets.tileGrass
      : biome === 'desert'
        ? assets.tileSand
        : assets.tileIce
    : null;

  const drawBiomeOverlayRect = (ox: number, oy: number, w: number, h: number): void => {
    if (w <= 0 || h <= 0) return;
    const dx = Math.floor(sx + ox);
    const dy = Math.floor(sy + oy);
    if (biomeTile) {
      ctx.drawImage(
        biomeTile,
        Math.floor(ox),
        Math.floor(oy),
        Math.floor(w),
        Math.floor(h),
        dx,
        dy,
        Math.floor(w),
        Math.floor(h),
      );
      return;
    }
    ctx.fillStyle = biomeGroundColor(biome, tx, ty);
    ctx.fillRect(dx, dy, Math.floor(w), Math.floor(h));
  };

  if (biomeTile) {
    ctx.drawImage(biomeTile, Math.floor(sx), Math.floor(sy), TILE_SIZE, TILE_SIZE);
  } else {
    ctx.fillStyle = biomeGroundColor(biome, tx, ty);
    ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
  }

  if (road) {
    const roadN = isRoadTile(tx, ty - 1);
    const roadS = isRoadTile(tx, ty + 1);
    const roadW = isRoadTile(tx - 1, ty);
    const roadE = isRoadTile(tx + 1, ty);
    const edgeCut = 5;

    if (assets) {
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.drawImage(assets.tileDirt, Math.floor(sx), Math.floor(sy), TILE_SIZE, TILE_SIZE);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(168, 128, 81, 0.84)';
      ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    }

    // Blend outer edges back into biome so roads look carved, not square stamps.
    if (!roadN) drawBiomeOverlayRect(0, 0, TILE_SIZE, edgeCut);
    if (!roadS) drawBiomeOverlayRect(0, TILE_SIZE - edgeCut, TILE_SIZE, edgeCut);
    if (!roadW) drawBiomeOverlayRect(0, 0, edgeCut, TILE_SIZE);
    if (!roadE) drawBiomeOverlayRect(TILE_SIZE - edgeCut, 0, edgeCut, TILE_SIZE);
    if (!roadN && !roadW) drawBiomeOverlayRect(0, 0, edgeCut + 1, edgeCut + 1);
    if (!roadN && !roadE) drawBiomeOverlayRect(TILE_SIZE - edgeCut - 1, 0, edgeCut + 1, edgeCut + 1);
    if (!roadS && !roadW) drawBiomeOverlayRect(0, TILE_SIZE - edgeCut - 1, edgeCut + 1, edgeCut + 1);
    if (!roadS && !roadE) drawBiomeOverlayRect(TILE_SIZE - edgeCut - 1, TILE_SIZE - edgeCut - 1, edgeCut + 1, edgeCut + 1);

    const verticalRoad = roadN || roadS;
    const horizontalRoad = roadW || roadE;
    if (verticalRoad && !horizontalRoad) {
      ctx.fillStyle = 'rgba(240, 215, 160, 0.28)';
      ctx.fillRect(Math.floor(sx + 15), Math.floor(sy + 3), 2, TILE_SIZE - 6);
    } else if (horizontalRoad && !verticalRoad) {
      ctx.fillStyle = 'rgba(240, 215, 160, 0.28)';
      ctx.fillRect(Math.floor(sx + 3), Math.floor(sy + 15), TILE_SIZE - 6, 2);
    }

    if (hash01(tx * 17 + 9, ty * 23 + 7) > 0.76) {
      ctx.fillStyle = 'rgba(236, 210, 145, 0.32)';
      ctx.fillRect(Math.floor(sx + 4), Math.floor(sy + 6), 4, 2);
      ctx.fillRect(Math.floor(sx + 22), Math.floor(sy + 20), 3, 2);
    }
  }

  if (water) {
    const waterAt = (wx: number, wy: number): boolean => (
      isWaterTile(wx, wy, sampleBiome(wx, wy), isRoadTile(wx, wy))
    );
    const waterN = waterAt(tx, ty - 1);
    const waterS = waterAt(tx, ty + 1);
    const waterW = waterAt(tx - 1, ty);
    const waterE = waterAt(tx + 1, ty);
    const shore = 4;

    const tone = biome === 'snow'
      ? 'rgba(162, 213, 255, 0.76)'
      : biome === 'desert'
        ? 'rgba(95, 176, 222, 0.72)'
        : 'rgba(76, 156, 214, 0.72)';
    ctx.fillStyle = tone;
    ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    const waveShift = Math.floor((nowMs / 180) + tx + (ty * 2)) % 6;
    ctx.fillStyle = 'rgba(220, 243, 255, 0.28)';
    ctx.fillRect(Math.floor(sx + 3 + waveShift), Math.floor(sy + 7), 6, 1);
    ctx.fillRect(Math.floor(sx + 10 + waveShift), Math.floor(sy + 18), 5, 1);

    // Add shallow shoreline to remove hard square water borders.
    if (!waterN) drawBiomeOverlayRect(0, 0, TILE_SIZE, shore);
    if (!waterS) drawBiomeOverlayRect(0, TILE_SIZE - shore, TILE_SIZE, shore);
    if (!waterW) drawBiomeOverlayRect(0, 0, shore, TILE_SIZE);
    if (!waterE) drawBiomeOverlayRect(TILE_SIZE - shore, 0, shore, TILE_SIZE);
    if (!waterN && !waterW) drawBiomeOverlayRect(0, 0, shore + 1, shore + 1);
    if (!waterN && !waterE) drawBiomeOverlayRect(TILE_SIZE - shore - 1, 0, shore + 1, shore + 1);
    if (!waterS && !waterW) drawBiomeOverlayRect(0, TILE_SIZE - shore - 1, shore + 1, shore + 1);
    if (!waterS && !waterE) drawBiomeOverlayRect(TILE_SIZE - shore - 1, TILE_SIZE - shore - 1, shore + 1, shore + 1);

    if (!(waterN && waterS && waterW && waterE)) {
      ctx.fillStyle = biome === 'desert' ? 'rgba(239, 223, 176, 0.46)' : 'rgba(219, 243, 255, 0.46)';
      if (!waterN) ctx.fillRect(Math.floor(sx + 4), Math.floor(sy + shore), TILE_SIZE - 8, 1);
      if (!waterS) ctx.fillRect(Math.floor(sx + 4), Math.floor(sy + TILE_SIZE - shore - 1), TILE_SIZE - 8, 1);
      if (!waterW) ctx.fillRect(Math.floor(sx + shore), Math.floor(sy + 4), 1, TILE_SIZE - 8);
      if (!waterE) ctx.fillRect(Math.floor(sx + TILE_SIZE - shore - 1), Math.floor(sy + 4), 1, TILE_SIZE - 8);

      ctx.strokeStyle = biome === 'desert' ? 'rgba(236, 208, 150, 0.58)' : 'rgba(194, 229, 255, 0.62)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.floor(sx) + 0.5, Math.floor(sy) + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    }
  }

  if (!road && !water && assets) {
    const eastBiome = sampleBiome(tx + 1, ty);
    if (eastBiome !== biome && ((mod(tx + ty, 2) === 0))) {
      const edgeTile = eastBiome === 'forest'
        ? assets.tileGrass
        : eastBiome === 'desert'
          ? assets.tileSand
          : assets.tileIce;
      ctx.save();
      ctx.globalAlpha = 0.26;
      ctx.drawImage(edgeTile, Math.floor(sx), Math.floor(sy), TILE_SIZE, TILE_SIZE);
      ctx.restore();
    }
  }

  return { biome, water, road };
}

function scoreOf(state: GameState): number {
  return Math.floor(state.elapsedSeconds * 1.8 + state.player.kills * 6 + state.player.level * 24);
}

function gearTierInfo(tier: number): {
  zh: string;
  en: string;
  color: string;
} {
  if (tier >= 12) return { zh: '神话', en: 'Mythic', color: '#ffcf63' };
  if (tier >= 8) return { zh: '传说', en: 'Legendary', color: '#ffd989' };
  if (tier >= 5) return { zh: '史诗', en: 'Epic', color: '#d5b9ff' };
  if (tier >= 3) return { zh: '稀有', en: 'Rare', color: '#8fd2ff' };
  if (tier >= 1) return { zh: '普通', en: 'Common', color: '#c6e0a5' };
  return { zh: '未装备', en: 'Empty', color: '#9fb79a' };
}

function weaponBonusFromTier(tier: number): number {
  return Math.round(tier * 7.2);
}

function armorBonusFromTier(tier: number): { armor: number; hp: number } {
  return {
    armor: tier * 2,
    hp: tier * 14,
  };
}

export function BinanceRpgPage(props: { account: string | null }) {
  const { account } = props;
  const { t } = useI18n();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const justPressedRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const loadingOnceRef = useRef(true);

  const saved = useMemo(() => loadSave(), []);
  const initialLeaderboard = useMemo(() => normalizeLeaderboard(saved?.leaderboard), [saved]);
  const initialWalletLabel = shortAccountLabel(account, t('未连接', 'Disconnected'));

  const [hud, setHud] = useState<HudSnapshot>(() => defaultHud(initialWalletLabel));
  const [loading, setLoading] = useState(true);
  const [assetsReady, setAssetsReady] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const assetsRef = useRef<OgaAssets | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioMasterRef = useRef<GainNode | null>(null);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const audioMutedRef = useRef(false);

  const stateRef = useRef<GameState>({
    player: hydratePlayer(saved),
    enemies: [],
    gems: [],
    supplies: [],
    projectiles: [],
    floats: [],
    waves: [],
    spriteFxs: [],
    logs: [t('欢迎进入幸存者模式：活得越久越强。', 'Welcome to survivors mode: survive and scale.')],
    enemyAutoId: 1,
    gemAutoId: 1,
    supplyAutoId: 1,
    projectileAutoId: 1,
    floatAutoId: 1,
    waveAutoId: 1,
    spriteFxAutoId: 1,
    spawnClock: 0,
    supplySpawnClock: 0,
    supplyNextSpawn: 11.5,
    elapsedSeconds: Math.max(0, saved?.elapsedSeconds ?? 0),
    difficulty: Math.max(0, saved?.difficulty ?? 0),
    audioHitCd: 0,
    audioPickupCd: 0,
    audioShootCd: 0,
    gameOver: false,
    levelUpChoices: [],
    bestScore: Math.max(0, saved?.bestScore ?? 0),
    leaderboard: initialLeaderboard,
    runSubmitted: false,
    lastBossWave: 0,
    lastMilestoneMinute: 0,
  });

  const updateHud = useCallback(() => {
    const state = stateRef.current;
    const p = state.player;
    const biome = sampleBiome(Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE));
    const walletLabel = shortAccountLabel(account, t('未连接', 'Disconnected'));
    const nearbyEnemies = state.enemies.filter((e) => len(e.x - p.x, e.y - p.y) < 420).length;
    setHud({
      hp: Math.max(0, Math.round(p.hp)),
      maxHp: p.maxHp,
      level: p.level,
      exp: Math.round(p.exp),
      expNext: p.expNext,
      kills: p.kills,
      timer: state.elapsedSeconds,
      biome,
      nearbyEnemies,
      attack: Math.round(p.attack),
      speed: Math.round(p.speed),
      attackInterval: p.attackInterval,
      pickupRadius: Math.round(p.pickupRadius),
      avatar: p.avatar,
      skillBladeLevel: p.skillBladeLevel,
      skillNovaLevel: p.skillNovaLevel,
      skillSplitLevel: p.skillSplitLevel,
      score: scoreOf(state),
      bestScore: state.bestScore,
      walletLabel,
    });
  }, [account, t]);

  const unlockAudio = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (audioMutedRef.current) return;
    if (!audioCtxRef.current) {
      const Ctor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        const master = ctx.createGain();
        master.gain.value = 0.18;
        master.connect(ctx.destination);
        audioCtxRef.current = ctx;
        audioMasterRef.current = master;
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume();
    }
    if (!bgmRef.current) {
      const bgm = new Audio('/static/assets/rpg/oga-page5/extracted/gothicvania-town/GothicVania-town-files/Music/rpg_village02_loop.mp3');
      bgm.loop = true;
      bgm.volume = 0.15;
      bgm.preload = 'auto';
      bgmRef.current = bgm;
    }
    if (bgmRef.current && !audioMutedRef.current) {
      const playPromise = bgmRef.current.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    }
    setAudioUnlocked(true);
  }, []);

  const playSfx = useCallback((kind: 'shoot' | 'hit' | 'pickup' | 'levelup' | 'upgrade' | 'nova' | 'die') => {
    if (audioMutedRef.current) return;
    const ctx = audioCtxRef.current;
    const master = audioMasterRef.current;
    if (!ctx || !master) return;
    const now = ctx.currentTime;

    const oneShot = (
      freqStart: number,
      freqEnd: number,
      duration: number,
      gain: number,
      type: OscillatorType,
      detune = 0,
    ) => {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, now);
      osc.frequency.linearRampToValueAtTime(freqEnd, now + duration);
      osc.detune.setValueAtTime(detune, now);
      amp.gain.setValueAtTime(gain, now);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(amp);
      amp.connect(master);
      osc.start(now);
      osc.stop(now + duration);
    };

    if (kind === 'shoot') {
      oneShot(820, 470, 0.05, 0.16, 'triangle');
      return;
    }
    if (kind === 'hit') {
      oneShot(220, 130, 0.045, 0.1, 'square');
      return;
    }
    if (kind === 'pickup') {
      oneShot(620, 920, 0.07, 0.09, 'sine');
      return;
    }
    if (kind === 'levelup') {
      oneShot(500, 740, 0.12, 0.11, 'triangle');
      oneShot(760, 1180, 0.16, 0.08, 'sine');
      return;
    }
    if (kind === 'upgrade') {
      oneShot(680, 980, 0.08, 0.11, 'triangle');
      return;
    }
    if (kind === 'nova') {
      oneShot(180, 70, 0.2, 0.2, 'sawtooth');
      oneShot(280, 90, 0.16, 0.12, 'triangle', -12);
      return;
    }
    oneShot(260, 70, 0.25, 0.2, 'sawtooth');
  }, []);

  const submitRunToLeaderboard = useCallback(() => {
    const state = stateRef.current;
    if (state.runSubmitted) return;

    const runScore = scoreOf(state);
    const entry: LeaderboardEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      account: shortAccountLabel(account, t('游客', 'Guest')),
      avatar: state.player.avatar,
      score: Math.max(0, Math.floor(runScore)),
      kills: Math.max(0, Math.floor(state.player.kills)),
      level: Math.max(1, Math.floor(state.player.level)),
      survivalSeconds: Math.max(0, Math.floor(state.elapsedSeconds)),
      at: Date.now(),
    };
    const next = sortLeaderboard([entry, ...state.leaderboard]).slice(0, LEADERBOARD_MAX_SAVE);
    state.leaderboard = next;
    state.runSubmitted = true;

    const rank = Math.max(1, next.findIndex((v) => v.id === entry.id) + 1);
    addLog(
      state,
      t(
        `排行榜已记录：#${rank}，分数 ${entry.score}，击杀 ${entry.kills}。`,
        `Leaderboard saved: #${rank}, score ${entry.score}, kills ${entry.kills}.`,
      ),
    );
  }, [account, t]);

  const resetRun = useCallback(() => {
    const state = stateRef.current;
    state.bestScore = Math.max(state.bestScore, scoreOf(state));
    const keepAvatar = state.player.avatar;
    state.player = {
      ...createDefaultPlayer(),
      avatar: keepAvatar,
    };
    state.enemies = [];
    state.gems = [];
    state.supplies = [];
    state.projectiles = [];
    state.floats = [];
    state.waves = [];
    state.logs = [t('新的一局开始，祝你撑过更久。', 'A new run has started. Survive longer this time.')];
    state.enemyAutoId = 1;
    state.gemAutoId = 1;
    state.supplyAutoId = 1;
    state.projectileAutoId = 1;
    state.floatAutoId = 1;
    state.waveAutoId = 1;
    state.spriteFxAutoId = 1;
    state.spawnClock = 0;
    state.supplySpawnClock = 0;
    state.supplyNextSpawn = 11.5;
    state.elapsedSeconds = 0;
    state.difficulty = 0;
    state.gameOver = false;
    state.levelUpChoices = [];
    state.runSubmitted = false;
    state.lastBossWave = 0;
    state.lastMilestoneMinute = 0;
    updateHud();
  }, [t, updateHud]);

  const pickLevelUp = useCallback((index: number) => {
    const state = stateRef.current;
    const choice = state.levelUpChoices[index];
    if (!choice) return;

    applyUpgrade(state, choice.kind);
    playSfx('upgrade');
    state.levelUpChoices = [];
    rollLevelUp(state);
  }, [playSfx]);

  useEffect(() => {
    audioMutedRef.current = audioMuted;
    if (bgmRef.current) {
      bgmRef.current.muted = audioMuted;
      if (audioMuted) {
        bgmRef.current.pause();
      } else {
        const playPromise = bgmRef.current.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
      }
    }
    if (audioMasterRef.current) {
      audioMasterRef.current.gain.value = audioMuted ? 0 : 0.18;
    }
  }, [audioMuted]);

  useEffect(() => {
    let cancelled = false;
    const bootstrapAssets = async () => {
      try {
        const [
          warrior,
          heyiWalk0,
          heyiWalk1,
          heyiWalk2,
          heyiWalk3,
          czWalk0,
          czWalk1,
          czWalk2,
          czWalk3,
          slime,
          envTree,
          tileGrass,
          tileSand,
          tileIce,
          tileDirt,
          monGoblin,
          monWisp,
          monGolem,
          itemGold,
          itemCrystal,
          spellMagicSheet,
          spellHitSheet,
          spellRingSheet,
          spellNovaSheet,
          fxBloodHit,
          fxTeleporterHit,
          roguelikeMonsters,
          lpcDecorations,
          lpcFence,
          iconSword,
          iconBow,
          iconArrow,
          iconStaff,
          iconShield,
          iconPotionRed,
          iconPotionBlue,
          iconHelmet,
          waterProjectileFrames,
          waterImpactFrames,
          waterNovaFrames,
        ] = await Promise.all([
          loadImage(OGA_ASSET_PATHS.warrior),
          loadImage(OGA_ASSET_PATHS.heyiWalk0),
          loadImage(OGA_ASSET_PATHS.heyiWalk1),
          loadImage(OGA_ASSET_PATHS.heyiWalk2),
          loadImage(OGA_ASSET_PATHS.heyiWalk3),
          loadImage(OGA_ASSET_PATHS.czWalk0),
          loadImage(OGA_ASSET_PATHS.czWalk1),
          loadImage(OGA_ASSET_PATHS.czWalk2),
          loadImage(OGA_ASSET_PATHS.czWalk3),
          loadImage(OGA_ASSET_PATHS.slime),
          loadImage(OGA_ASSET_PATHS.envTree),
          loadImage(OGA_ASSET_PATHS.tileGrass),
          loadImage(OGA_ASSET_PATHS.tileSand),
          loadImage(OGA_ASSET_PATHS.tileIce),
          loadImage(OGA_ASSET_PATHS.tileDirt),
          loadImage(OGA_ASSET_PATHS.monGoblin),
          loadImage(OGA_ASSET_PATHS.monWisp),
          loadImage(OGA_ASSET_PATHS.monGolem),
          loadImage(OGA_ASSET_PATHS.itemGold),
          loadImage(OGA_ASSET_PATHS.itemCrystal),
          loadImage(OGA_ASSET_PATHS.spellMagicSheet),
          loadImage(OGA_ASSET_PATHS.spellHitSheet),
          loadImage(OGA_ASSET_PATHS.spellRingSheet),
          loadImage(OGA_ASSET_PATHS.spellNovaSheet),
          loadImage(OGA_ASSET_PATHS.fxBloodHit),
          loadImage(OGA_ASSET_PATHS.fxTeleporterHit),
          loadImage(OGA_ASSET_PATHS.roguelikeMonsters),
          loadImage(OGA_ASSET_PATHS.lpcDecorations),
          loadImage(OGA_ASSET_PATHS.lpcFence),
          loadImage(OGA_ASSET_PATHS.iconSword),
          loadImage(OGA_ASSET_PATHS.iconBow),
          loadImage(OGA_ASSET_PATHS.iconArrow),
          loadImage(OGA_ASSET_PATHS.iconStaff),
          loadImage(OGA_ASSET_PATHS.iconShield),
          loadImage(OGA_ASSET_PATHS.iconPotionRed),
          loadImage(OGA_ASSET_PATHS.iconPotionBlue),
          loadImage(OGA_ASSET_PATHS.iconHelmet),
          Promise.all(waterFramePaths('01').map((src) => loadImage(src))),
          Promise.all(waterFramePaths('03').map((src) => loadImage(src))),
          Promise.all(waterFramePaths('04').map((src) => loadImage(src))),
        ]);
        if (cancelled) return;
        assetsRef.current = {
          warrior,
          heyiWalk0,
          heyiWalk1,
          heyiWalk2,
          heyiWalk3,
          czWalk0,
          czWalk1,
          czWalk2,
          czWalk3,
          slime,
          envTree,
          tileGrass,
          tileSand,
          tileIce,
          tileDirt,
          monGoblin,
          monWisp,
          monGolem,
          itemGold,
          itemCrystal,
          spellMagicSheet,
          spellHitSheet,
          spellRingSheet,
          spellNovaSheet,
          fxBloodHit,
          fxTeleporterHit,
          roguelikeMonsters,
          lpcDecorations,
          lpcFence,
          iconSword,
          iconBow,
          iconArrow,
          iconStaff,
          iconShield,
          iconPotionRed,
          iconPotionBlue,
          iconHelmet,
          waterProjectileFrames,
          waterImpactFrames,
          waterNovaFrames,
        };
        setAssetsReady(true);
      } catch (e) {
        console.error('Failed to load OGA assets, fallback to procedural drawing.', e);
        if (!cancelled) setAssetsReady(false);
      }
    };
    void bootstrapAssets();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const c = e.code;
      unlockAudio();
      if (c.startsWith('Arrow') || c === 'Space') e.preventDefault();
      if (!keysRef.current.has(c)) justPressedRef.current.add(c);
      keysRef.current.add(c);
      if (c === 'KeyC' && !e.repeat) {
        const state = stateRef.current;
        const p = state.player;
        p.avatar = p.avatar === 'heyi' ? 'cz' : 'heyi';
        addLog(state, p.avatar === 'cz' ? '角色切换为 CZ。' : '角色切换为何一。');
      }
      if (c === 'KeyF') {
        const wrap = wrapRef.current;
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else if (wrap?.requestFullscreen) {
          void wrap.requestFullscreen();
        }
      }
      if (c === 'KeyM') {
        setAudioMuted((prev) => !prev);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
    };
    const onPointerDown = () => {
      unlockAudio();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [unlockAudio]);

  useEffect(() => {
    const saveTimer = window.setInterval(() => saveGame(stateRef.current), 5000);
    const hudTimer = window.setInterval(() => updateHud(), 120);
    const onBeforeUnload = () => saveGame(stateRef.current);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.clearInterval(saveTimer);
      window.clearInterval(hudTimer);
      window.removeEventListener('beforeunload', onBeforeUnload);
      saveGame(stateRef.current);
    };
  }, [updateHud]);

  useEffect(() => () => {
    if (bgmRef.current) {
      bgmRef.current.pause();
      bgmRef.current.src = '';
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
    }
  }, []);

  useEffect(() => {
    const step = (dt: number) => {
      const state = stateRef.current;
      const p = state.player;
      const hadChoicesAtTickStart = state.levelUpChoices.length > 0;

      if (justPressedRef.current.has('KeyR')) {
        resetRun();
      }

      if (state.gameOver) {
        justPressedRef.current.clear();
        return;
      }

      if (state.levelUpChoices.length > 0) {
        if (justPressedRef.current.has('Digit1')) pickLevelUp(0);
        if (justPressedRef.current.has('Digit2')) pickLevelUp(1);
        if (justPressedRef.current.has('Digit3')) pickLevelUp(2);
        if (justPressedRef.current.has('KeyB')) {
          const idx = pickRecommendedUpgradeIndex(state.levelUpChoices, p);
          pickLevelUp(idx);
        }
        justPressedRef.current.clear();
        return;
      }

      const prevTime = state.elapsedSeconds;
      state.elapsedSeconds += dt;
      state.difficulty = Math.min(2.5, state.elapsedSeconds / 230);

      p.contactCd = Math.max(0, p.contactCd - dt);
      state.audioHitCd = Math.max(0, state.audioHitCd - dt);
      state.audioPickupCd = Math.max(0, state.audioPickupCd - dt);
      state.audioShootCd = Math.max(0, state.audioShootCd - dt);

      const left = keysRef.current.has('ArrowLeft') || keysRef.current.has('KeyA');
      const right = keysRef.current.has('ArrowRight') || keysRef.current.has('KeyD');
      const up = keysRef.current.has('ArrowUp') || keysRef.current.has('KeyW');
      const down = keysRef.current.has('ArrowDown') || keysRef.current.has('KeyS');

      let mx = 0;
      let my = 0;
      if (left) mx -= 1;
      if (right) mx += 1;
      if (up) my -= 1;
      if (down) my += 1;

      if (mx !== 0 || my !== 0) {
        const m = len(mx, my);
        mx /= m;
        my /= m;
      }

      if (mx < -0.1) p.facing = 'left';
      else if (mx > 0.1) p.facing = 'right';
      else if (my < -0.1) p.facing = 'up';
      else if (my > 0.1) p.facing = 'down';

      p.vx = mx * p.speed;
      p.vy = my * p.speed;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      p.attackTimer = Math.max(0, p.attackTimer - dt);
      if (p.attackTimer <= 0 && state.enemies.length > 0) {
        const candidates = state.enemies
          .map((enemy) => {
            const d = len(enemy.x - p.x, enemy.y - p.y);
            return { enemy, d };
          })
          .filter((entry) => entry.d <= ATTACK_TARGET_RANGE)
          .sort((a, b) => a.d - b.d);

        if (candidates.length > 0) {
          const lead = candidates[0];
          const leadDir = lead.d > 0.001
            ? { x: (lead.enemy.x - p.x) / lead.d, y: (lead.enemy.y - p.y) / lead.d }
            : facingUnit(p.facing);
          if (state.audioShootCd <= 0) {
            playSfx('shoot');
            state.audioShootCd = 0.045;
          }
          const shotCount = 1 + p.skillSplitLevel;
          const projectileElement = pickProjectileElement(shotCount);
          state.spriteFxs.push({
            id: state.spriteFxAutoId++,
            kind: 'muzzle',
            element: projectileElement,
            x: p.x + leadDir.x * 18,
            y: p.y + leadDir.y * 18,
            ttl: 0.16,
            maxTtl: 0.16,
            size: 42 + (p.skillSplitLevel * 6),
            rotation: Math.atan2(leadDir.y, leadDir.x),
          });
          const dmgFactor = shotCount > 1 ? 0.84 : 1;
          for (let s = 0; s < shotCount; s++) {
            const shotTarget = candidates[s % candidates.length];
            const fallback = facingUnit(p.facing);
            const sx = shotTarget.d > 0.001 ? (shotTarget.enemy.x - p.x) / shotTarget.d : fallback.x;
            const sy = shotTarget.d > 0.001 ? (shotTarget.enemy.y - p.y) / shotTarget.d : fallback.y;
            const spawnDistance = clamp(shotTarget.d - (shotTarget.enemy.radius + 6), 0, 16);
            const style = pickProjectileStyle(p, s, projectileElement);
            state.projectiles.push({
              id: state.projectileAutoId++,
              style,
              element: projectileElement,
              x: p.x + sx * spawnDistance,
              y: p.y + sy * spawnDistance,
              vx: sx * p.projectileSpeed,
              vy: sy * p.projectileSpeed,
              ttl: 1.2 + (p.skillSplitLevel * 0.03),
              damage: p.attack * dmgFactor,
              radius: 5,
              pierce: p.projectilePierce,
            });
          }
          p.attackTimer = p.attackInterval;
        }
      }

      spawnEnemies(state, dt);
      trySpawnElite(state, prevTime);
      trySpawnBoss(state, prevTime);
      state.supplySpawnClock += dt;
      while (state.supplySpawnClock >= state.supplyNextSpawn) {
        state.supplySpawnClock -= state.supplyNextSpawn;
        spawnSupply(state);
        state.supplyNextSpawn = nextSupplySpawnDelay(state);
      }

      p.novaTimer = Math.max(0, p.novaTimer - dt);
      if (p.skillNovaLevel > 0 && p.novaTimer <= 0) {
        const novaRadius = 72 + (p.skillNovaLevel * 20);
        const novaDamage = (p.attack * 0.8) + (p.skillNovaLevel * 5);
        for (const e of state.enemies) {
          if (len(e.x - p.x, e.y - p.y) > novaRadius + e.radius) continue;
          e.hp -= novaDamage;
          addFloat(state, e.x, e.y - 16, `-${Math.round(novaDamage)}`, '#9ae9ff');
        }
        state.waves.push({
          id: state.waveAutoId++,
          x: p.x,
          y: p.y,
          radius: 18,
          maxRadius: novaRadius,
          ttl: 0.42,
          color: 'rgba(185, 236, 255, {alpha})',
        });
        state.spriteFxs.push({
          id: state.spriteFxAutoId++,
          kind: 'nova',
          element: 'ice',
          x: p.x,
          y: p.y,
          ttl: 0.48,
          maxTtl: 0.48,
          size: novaRadius * 1.6,
          rotation: hash01(state.spriteFxAutoId, state.enemyAutoId) * Math.PI * 2,
        });
        playSfx('nova');
        p.novaTimer = clamp(4.8 - (p.skillNovaLevel * 0.58), 1.45, 4.8);
      }

      const bladePoints: Array<{ x: number; y: number }> = [];
      if (p.skillBladeLevel > 0) {
        const bladeCount = Math.min(6, 1 + p.skillBladeLevel);
        const bladeRadius = bladeOrbitRadius(p.skillBladeLevel);
        const spin = state.elapsedSeconds * (2.8 + (p.skillBladeLevel * 0.15));
        for (let i = 0; i < bladeCount; i++) {
          const angle = spin + ((i / bladeCount) * Math.PI * 2);
          bladePoints.push({
            x: p.x + (Math.cos(angle) * bladeRadius),
            y: p.y + (Math.sin(angle) * bladeRadius),
          });
        }
      }

      const nextEnemies: EnemyState[] = [];
      for (const e of state.enemies) {
        e.bladeHitCd = Math.max(0, e.bladeHitCd - dt);
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const d = len(dx, dy);
        const nx = d > 0 ? dx / d : 0;
        const ny = d > 0 ? dy / d : 0;
        e.x += nx * e.speed * dt;
        e.y += ny * e.speed * dt;

        if (d <= e.radius + 10 && p.contactCd <= 0) {
          const damage = Math.max(1, Math.floor(e.damage - (p.armor * 0.3)));
          p.hp -= damage;
          p.contactCd = 0.5;
          addFloat(state, p.x, p.y - 24, `-${damage}`, '#ff9a9a');
        }

        if (bladePoints.length > 0 && e.bladeHitCd <= 0) {
          const hitRadius = e.radius + 6;
          let hitByBlade = false;
          for (const bp of bladePoints) {
            if (len(e.x - bp.x, e.y - bp.y) > hitRadius) continue;
            hitByBlade = true;
            break;
          }
          if (hitByBlade) {
            const bladeDamage = (p.attack * 0.58) + (p.skillBladeLevel * 3.2);
            e.hp -= bladeDamage;
            if (hash01(e.id, state.floatAutoId) > 0.6) {
              addFloat(state, e.x, e.y - 14, `-${Math.round(bladeDamage)}`, '#b9f6ff');
            }
            e.bladeHitCd = clamp(0.22 - (p.skillBladeLevel * 0.018), 0.09, 0.22);
          }
        }

        if (len(e.x - p.x, e.y - p.y) > 1300) continue;
        nextEnemies.push(e);
      }
      state.enemies = nextEnemies;

      const nextProjectiles: ProjectileState[] = [];
      for (const projectile of state.projectiles) {
        projectile.ttl -= dt;
        if (projectile.ttl <= 0) continue;

        const hitEnemyIds = new Set<number>();
        const tryHitEnemies = (): boolean => {
          let destroyed = false;
          for (const e of state.enemies) {
            if (e.hp <= 0) continue;
            if (hitEnemyIds.has(e.id)) continue;
            if (len(projectile.x - e.x, projectile.y - e.y) > projectile.radius + e.radius) continue;
            e.hp -= projectile.damage;
            hitEnemyIds.add(e.id);
            addFloat(state, e.x, e.y - 16, `-${Math.round(projectile.damage)}`, '#fff2b5');
            state.spriteFxs.push({
              id: state.spriteFxAutoId++,
              kind: 'hit',
              element: projectile.element,
              x: e.x,
              y: e.y,
              ttl: 0.2,
              maxTtl: 0.2,
              size: 52,
              rotation: Math.atan2(projectile.vy, projectile.vx),
            });
            if (state.audioHitCd <= 0) {
              playSfx('hit');
              state.audioHitCd = 0.04;
            }
            if (projectile.pierce <= 0) {
              destroyed = true;
              break;
            }
            projectile.pierce -= 1;
          }
          return destroyed;
        };

        // Check hit before movement to prevent overlap miss when enemies are on top of player.
        let destroyed = tryHitEnemies();
        if (!destroyed) {
          projectile.x += projectile.vx * dt;
          projectile.y += projectile.vy * dt;
          destroyed = tryHitEnemies();
        }

        if (!destroyed) nextProjectiles.push(projectile);
      }
      state.projectiles = nextProjectiles;

      const aliveEnemies: EnemyState[] = [];
      for (const e of state.enemies) {
        if (e.hp > 0) {
          aliveEnemies.push(e);
          continue;
        }
        dropGemsFromEnemy(state, e);
        p.kills += 1;
      }
      state.enemies = aliveEnemies;

      const nextGems: GemState[] = [];
      for (const gem of state.gems) {
        gem.ttl -= dt;
        if (gem.ttl <= 0) continue;
        const dx = p.x - gem.x;
        const dy = p.y - gem.y;
        const d = len(dx, dy);
        if (d <= p.pickupRadius) {
          gainExp(state, gem.xp);
          addFloat(state, p.x, p.y - 18, `+${gem.xp} EXP`, '#9ed7ff');
          if (state.audioPickupCd <= 0) {
            playSfx('pickup');
            state.audioPickupCd = 0.08;
          }
          continue;
        }
        if (d < p.pickupRadius + 140) {
          const nx = d > 0 ? dx / d : 0;
          const ny = d > 0 ? dy / d : 0;
          gem.x += nx * (240 + (state.player.level * 5)) * dt;
          gem.y += ny * (240 + (state.player.level * 5)) * dt;
        }
        nextGems.push(gem);
      }
      state.gems = nextGems;

      const nextSupplies: SupplyState[] = [];
      for (const supply of state.supplies) {
        supply.ttl -= dt;
        if (supply.ttl <= 0) continue;
        const dx = p.x - supply.x;
        const dy = p.y - supply.y;
        const d = len(dx, dy);
        if (d <= p.pickupRadius + 12) {
          pickupSupply(state, supply);
          if (state.audioPickupCd <= 0) {
            playSfx('pickup');
            state.audioPickupCd = 0.08;
          }
          continue;
        }
        if (d < p.pickupRadius + 190) {
          const nx = d > 0 ? dx / d : 0;
          const ny = d > 0 ? dy / d : 0;
          supply.x += nx * (188 + (state.player.level * 3.5)) * dt;
          supply.y += ny * (188 + (state.player.level * 3.5)) * dt;
        }
        nextSupplies.push(supply);
      }
      state.supplies = nextSupplies;

      const nextFloats: FloatText[] = [];
      for (const f of state.floats) {
        f.ttl -= dt;
        f.y -= 24 * dt;
        if (f.ttl > 0) nextFloats.push(f);
      }
      state.floats = nextFloats;

      const nextWaves: WaveFx[] = [];
      for (const wave of state.waves) {
        wave.ttl -= dt;
        if (wave.ttl <= 0) continue;
        const progress = 1 - (wave.ttl / 0.42);
        wave.radius = 18 + ((wave.maxRadius - 18) * progress);
        nextWaves.push(wave);
      }
      state.waves = nextWaves;

      const nextSpriteFxs: SpriteFx[] = [];
      for (const fx of state.spriteFxs) {
        fx.ttl -= dt;
        if (fx.ttl > 0) nextSpriteFxs.push(fx);
      }
      state.spriteFxs = nextSpriteFxs;

      if (p.hp <= 0) {
        p.hp = 0;
        state.gameOver = true;
        state.bestScore = Math.max(state.bestScore, scoreOf(state));
        submitRunToLeaderboard();
        addLog(state, '你被尸潮吞没了，按 R 重新开始。');
        playSfx('die');
      }

      if (!hadChoicesAtTickStart && state.levelUpChoices.length > 0) {
        playSfx('levelup');
      }

      const minuteTick = Math.floor(state.elapsedSeconds / 60);
      if (minuteTick > 0 && minuteTick > state.lastMilestoneMinute) {
        state.lastMilestoneMinute = minuteTick;
        addLog(state, `生存 ${formatTimer(state.elapsedSeconds)}，敌潮持续增强。`);
      }

      justPressedRef.current.clear();
    };

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const state = stateRef.current;
      const p = state.player;
      const assets = assetsRef.current;

      const width = canvas.width;
      const height = canvas.height;
      ctx.imageSmoothingEnabled = false;

      const cameraX = p.x - (width / 2);
      const cameraY = p.y - (height / 2);
      const startTx = Math.floor(cameraX / TILE_SIZE) - 1;
      const startTy = Math.floor(cameraY / TILE_SIZE) - 1;
      const endTx = Math.ceil((cameraX + width) / TILE_SIZE) + 1;
      const endTy = Math.ceil((cameraY + height) / TILE_SIZE) + 1;
      const nowMs = Date.now();

      ctx.fillStyle = '#95d57b';
      ctx.fillRect(0, 0, width, height);

      for (let ty = startTy; ty <= endTy; ty++) {
        for (let tx = startTx; tx <= endTx; tx++) {
          const sx = (tx * TILE_SIZE) - cameraX;
          const sy = (ty * TILE_SIZE) - cameraY;
          const tileMeta = drawWorldTile(ctx, tx, ty, sx, sy, nowMs, assets);
          if (!tileMeta.water && !tileMeta.road) {
            drawLpcVillageDecor(ctx, tileMeta.biome, sx, sy, tx, ty, nowMs, assets);
          }

          const r = hash01(tx * 17 + 3, ty * 11 + 7);
          if (!tileMeta.road && !tileMeta.water && r > 0.9 && r < 0.952) {
            drawBiomeProp(ctx, tileMeta.biome, sx, sy, r, assets);
          }
        }
      }

      for (const supply of state.supplies) {
        drawSupply(ctx, supply, supply.x - cameraX, supply.y - cameraY, nowMs, assets);
      }
      for (const gem of state.gems) {
        drawGem(ctx, gem, gem.x - cameraX, gem.y - cameraY, assets);
      }
      for (const e of state.enemies) {
        drawEnemy(ctx, e, e.x - cameraX, e.y - cameraY, nowMs, assets);
      }
      for (const projectile of state.projectiles) {
        drawProjectile(ctx, projectile, projectile.x - cameraX, projectile.y - cameraY, assets, nowMs);
      }
      for (const fx of state.spriteFxs) {
        drawSpriteFx(ctx, fx, fx.x - cameraX, fx.y - cameraY, assets);
      }
      for (const wave of state.waves) {
        drawWave(ctx, wave, wave.x - cameraX, wave.y - cameraY);
      }

      drawBladeOrbit(ctx, p.x - cameraX, p.y - cameraY, state.elapsedSeconds, p.skillBladeLevel, assets);

      drawPixelPlayer(
        ctx,
        p.x - cameraX,
        p.y - cameraY,
        p.facing,
        p.avatar,
        Math.abs(p.vx) + Math.abs(p.vy) > 10,
        nowMs,
        assets,
      );

      if (p.contactCd > 0) {
        ctx.fillStyle = 'rgba(255, 116, 116, 0.24)';
        ctx.beginPath();
        ctx.arc(p.x - cameraX, p.y - cameraY, 18, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const f of state.floats) {
        ctx.fillStyle = f.color;
        ctx.font = 'bold 13px monospace';
        ctx.fillText(f.text, f.x - cameraX, f.y - cameraY);
      }

      const hpPct = clamp(p.hp / Math.max(1, p.maxHp), 0, 1);
      const expPct = clamp(p.exp / Math.max(1, p.expNext), 0, 1);
      const overlayW = 266;

      ctx.fillStyle = 'rgba(11, 20, 14, 0.66)';
      ctx.fillRect(12, 12, overlayW, 60);
      ctx.strokeStyle = 'rgba(137, 179, 125, 0.9)';
      ctx.strokeRect(12.5, 12.5, overlayW - 1, 59);

      ctx.fillStyle = 'rgba(11, 20, 14, 0.6)';
      ctx.fillRect(20, 20, 150, 12);
      ctx.fillStyle = '#82d47a';
      ctx.fillRect(20, 20, 150 * hpPct, 12);
      ctx.fillStyle = '#d4f2be';
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.fillText(`HP ${Math.max(0, Math.floor(p.hp))}/${p.maxHp}`, 22, 30);

      ctx.fillStyle = 'rgba(11, 20, 14, 0.6)';
      ctx.fillRect(20, 38, 150, 8);
      ctx.fillStyle = '#7fc2ff';
      ctx.fillRect(20, 38, 150 * expPct, 8);
      ctx.fillStyle = '#d4f2be';
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillText(`LV ${p.level} EXP ${Math.floor(p.exp)}/${p.expNext}`, 22, 52);
      ctx.fillText(`TIME ${formatTimer(state.elapsedSeconds)}`, 182, 30);
      ctx.fillText(`KILL ${p.kills}`, 182, 45);
      ctx.fillText(`SCORE ${scoreOf(state)}`, 182, 60);

      if (state.levelUpChoices.length > 0) {
        ctx.fillStyle = 'rgba(10, 16, 12, 0.75)';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#d8f5c0';
        ctx.font = '12px "Press Start 2P", monospace';
        ctx.fillText(t('升级！选择 1/2/3', 'LEVEL UP! Pick 1/2/3'), Math.floor(width / 2) - 132, Math.floor(height / 2) - 92);

        const cardCount = state.levelUpChoices.length;
        const cardGap = 14;
        const availableW = Math.min(980, width - 44);
        const cardW = Math.floor((availableW - ((cardCount - 1) * cardGap)) / Math.max(1, cardCount));
        const cardH = Math.min(172, Math.max(138, Math.floor(height * 0.24)));
        const cardsTotalW = (cardW * cardCount) + ((cardCount - 1) * cardGap);
        const baseX = Math.floor((width - cardsTotalW) / 2);
        const baseY = Math.floor((height / 2) - (cardH / 2) - 6);
        const recommendedIdx = pickRecommendedUpgradeIndex(state.levelUpChoices, p);

        for (let i = 0; i < cardCount; i++) {
          const choice = state.levelUpChoices[i];
          const x = baseX + (i * (cardW + cardGap));
          const y = baseY;
          const recommended = i === recommendedIdx;

          ctx.fillStyle = recommended ? 'rgba(24, 54, 29, 0.96)' : 'rgba(17, 30, 19, 0.96)';
          ctx.fillRect(x, y, cardW, cardH);
          ctx.strokeStyle = recommended ? '#ffe08a' : 'rgba(145, 189, 129, 0.92)';
          ctx.lineWidth = recommended ? 2 : 1;
          ctx.strokeRect(x + 0.5, y + 0.5, cardW - 1, cardH - 1);

          if (recommended) {
            ctx.fillStyle = 'rgba(255, 224, 138, 0.16)';
            ctx.fillRect(x + 4, y + 4, cardW - 8, 18);
            ctx.fillStyle = '#ffe8a8';
            ctx.font = '8px "Press Start 2P", monospace';
            ctx.fillText(t('B 推荐', 'B Smart Pick'), x + 8, y + 16);
          }

          ctx.fillStyle = '#ffe080';
          ctx.font = '10px "Press Start 2P", monospace';
          ctx.fillText(`${i + 1}`, x + 8, y + 26);

          ctx.fillStyle = '#dbf9c1';
          ctx.font = '9px "Press Start 2P", monospace';
          const title = t(choice.titleZh, choice.titleEn);
          const titleLines = wrapCanvasText(ctx, title, cardW - 26, 2);
          let yCursor = y + 46;
          for (const line of titleLines) {
            ctx.fillText(line, x + 8, yCursor);
            yCursor += 13;
          }

          ctx.fillStyle = '#b9e8ad';
          ctx.font = '8px "Press Start 2P", monospace';
          const desc = t(choice.descZh, choice.descEn);
          const descLines = wrapCanvasText(ctx, desc, cardW - 16, 5);
          for (const line of descLines) {
            if (yCursor > (y + cardH - 10)) break;
            ctx.fillText(line, x + 8, yCursor);
            yCursor += 11;
          }
        }
      }

      if (state.gameOver) {
        ctx.fillStyle = 'rgba(12, 14, 15, 0.72)';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#ffd9d9';
        ctx.font = '14px "Press Start 2P", monospace';
        ctx.fillText(t('你失败了', 'YOU DIED'), Math.floor(width / 2) - 74, Math.floor(height / 2) - 18);
        ctx.font = '10px "Press Start 2P", monospace';
        ctx.fillStyle = '#fff3cc';
        ctx.fillText(`${t('本局得分', 'Score')}: ${scoreOf(state)}`, Math.floor(width / 2) - 82, Math.floor(height / 2) + 14);
        ctx.fillText(`${t('最佳得分', 'Best')}: ${state.bestScore}`, Math.floor(width / 2) - 82, Math.floor(height / 2) + 30);
        ctx.fillText(t('按 R 重新开始', 'Press R to restart'), Math.floor(width / 2) - 92, Math.floor(height / 2) + 50);
      }

      if (loadingOnceRef.current) {
        loadingOnceRef.current = false;
        setLoading(false);
      }
    };

    const loop = (ts: number) => {
      const last = lastTsRef.current ?? ts;
      let dt = (ts - last) / 1000;
      lastTsRef.current = ts;
      dt = clamp(dt, 0, 0.05);
      let budget = dt;
      while (budget > 0) {
        const cur = Math.min(STEP_DT, budget);
        step(cur);
        budget -= cur;
      }
      draw();
      rafRef.current = window.requestAnimationFrame(loop);
    };

    rafRef.current = window.requestAnimationFrame(loop);

    window.advanceTime = (ms: number) => {
      let remaining = Math.max(0, ms);
      while (remaining > 0) {
        const cur = Math.min(16.666, remaining);
        step(cur / 1000);
        remaining -= cur;
      }
      draw();
      updateHud();
    };

    window.render_game_to_text = () => {
      const state = stateRef.current;
      const p = state.player;
      const biome = sampleBiome(Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE));
      const payload = {
        coord: 'origin=(0,0), x:right+, y:down+',
        player: {
          x: Number(p.x.toFixed(1)),
          y: Number(p.y.toFixed(1)),
          hp: Number(p.hp.toFixed(1)),
          level: p.level,
          exp: Number(p.exp.toFixed(1)),
          expNext: p.expNext,
          attack: Number(p.attack.toFixed(1)),
          speed: Number(p.speed.toFixed(1)),
          attackInterval: Number(p.attackInterval.toFixed(2)),
          pickupRadius: Number(p.pickupRadius.toFixed(1)),
          avatar: p.avatar,
          weaponTier: p.weaponTier,
          armorTier: p.armorTier,
          skillBladeLevel: p.skillBladeLevel,
          skillNovaLevel: p.skillNovaLevel,
          skillSplitLevel: p.skillSplitLevel,
          kills: p.kills,
        },
        biome,
        elapsed: Number(state.elapsedSeconds.toFixed(2)),
        gameOver: state.gameOver,
        audioMuted: audioMutedRef.current,
        bossesAlive: state.enemies.filter((enemy) => isBossKind(enemy.kind)).length,
        bossKindsAlive: Array.from(
          new Set(
            state.enemies
              .filter((enemy) => isBossKind(enemy.kind))
              .map((enemy) => enemy.kind),
          ),
        ),
        levelUpChoices: state.levelUpChoices.map((c) => c.kind),
        enemies: state.enemies.slice(0, 18).map((e) => ({
          id: e.id,
          kind: e.kind,
          x: Number(e.x.toFixed(1)),
          y: Number(e.y.toFixed(1)),
          hp: Number(e.hp.toFixed(1)),
        })),
        gems: state.gems.slice(0, 18).map((gem) => ({
          id: gem.id,
          x: Number(gem.x.toFixed(1)),
          y: Number(gem.y.toFixed(1)),
          xp: gem.xp,
        })),
        supplies: state.supplies.slice(0, 12).map((supply) => ({
          id: supply.id,
          kind: supply.kind,
          x: Number(supply.x.toFixed(1)),
          y: Number(supply.y.toFixed(1)),
          ttl: Number(supply.ttl.toFixed(1)),
        })),
        projectiles: state.projectiles.slice(0, 24).map((projectile) => ({
          id: projectile.id,
          style: projectile.style,
          element: projectile.element,
          x: Number(projectile.x.toFixed(1)),
          y: Number(projectile.y.toFixed(1)),
          ttl: Number(projectile.ttl.toFixed(2)),
          pierce: projectile.pierce,
        })),
        spriteFxs: state.spriteFxs.slice(0, 18).map((fx) => ({
          id: fx.id,
          kind: fx.kind,
          element: fx.element,
          x: Number(fx.x.toFixed(1)),
          y: Number(fx.y.toFixed(1)),
          ttl: Number(fx.ttl.toFixed(2)),
        })),
        leaderboard: state.leaderboard.slice(0, 8).map((entry, idx) => ({
          rank: idx + 1,
          account: entry.account,
          avatar: entry.avatar,
          score: entry.score,
          kills: entry.kills,
          level: entry.level,
          survivalSeconds: entry.survivalSeconds,
          at: entry.at,
        })),
      };
      return JSON.stringify(payload);
    };

    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      saveGame(stateRef.current);
      if (window.render_game_to_text) delete window.render_game_to_text;
      if (window.advanceTime) delete window.advanceTime;
    };
  }, [pickLevelUp, playSfx, resetRun, submitRunToLeaderboard, t, updateHud]);

  useEffect(() => {
    updateHud();
  }, [updateHud]);

  const hpPct = clamp(hud.hp / Math.max(1, hud.maxHp), 0, 1) * 100;
  const expPct = clamp(hud.exp / Math.max(1, hud.expNext), 0, 1) * 100;
  const state = stateRef.current;
  const leaderboard = state.leaderboard.slice(0, LEADERBOARD_MAX_VIEW);
  const weaponTierInfo = gearTierInfo(state.player.weaponTier);
  const armorTierInfo = gearTierInfo(state.player.armorTier);
  const weaponAtkBonus = weaponBonusFromTier(state.player.weaponTier);
  const armorBonus = armorBonusFromTier(state.player.armorTier);
  const relicTier = state.player.skillBladeLevel + state.player.skillNovaLevel + state.player.skillSplitLevel;
  const relicTierInfo = gearTierInfo(relicTier);

  return (
    <div className="bnbrpg-page bnbrpg-survivors">
      <div className="bnbrpg-header">
        <div className="bnbrpg-title-wrap">
          <h1>{t('BNB 幸存者', 'BNB Survivors')}</h1>
          <p>
            {t('自动攻击 · 尸潮生存 · 三选一升级 · 无限地图', 'Auto Attack · Horde Survival · 3-Choice Upgrades · Infinite Map')}
            {` · ${assetsReady ? t('像素素材已加载', 'Pixel assets loaded') : t('素材加载中', 'Loading assets')}`}
          </p>
        </div>
        <div className="bnbrpg-wallet">
          <span>{t('钱包', 'Wallet')}</span>
          <strong>{hud.walletLabel}</strong>
        </div>
      </div>

      <div className="bnbrpg-layout">
        <section className="bnbrpg-canvas-panel">
          <div className="bnbrpg-canvas-wrap" ref={wrapRef}>
            <canvas ref={canvasRef} width={1280} height={720} />
            {loading ? <div className="bnbrpg-loading">{t('地图与怪潮生成中...', 'Preparing map and horde...')}</div> : null}
            <div className="bnbrpg-canvas-hint">
              {state.levelUpChoices.length > 0
                ? t('升级中：点击卡片或按 1/2/3 选择强化', 'Level up: click card or press 1/2/3')
                : state.gameOver
                  ? t('按 R 立即重开', 'Press R to restart')
                  : t('WASD 移动，自动攻击，C 切换何一/CZ，M 静音，F 全屏，升级时按 B 智能选择', 'WASD move, auto-attack, C switch HEYI/CZ, M mute, F fullscreen, press B to smart-pick upgrades')}
            </div>

            {state.levelUpChoices.length > 0 ? (
              <div className="bnbrpg-levelup-modal">
                <div className="bnbrpg-levelup-title">{t('选择一项升级', 'Choose One Upgrade')}</div>
                <div className="bnbrpg-levelup-grid">
                  {state.levelUpChoices.map((choice, idx) => (
                    <button type="button" key={`${choice.kind}-${idx}`} onClick={() => pickLevelUp(idx)}>
                      <img className="bnbrpg-upgrade-icon" src={upgradeIconForKind(choice.kind)} alt="" />
                      <strong>{t(choice.titleZh, choice.titleEn)}</strong>
                      <span>{t(choice.descZh, choice.descEn)}</span>
                      <em>{idx + 1}</em>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="bnbrpg-side">
          <div className="bnbrpg-card bnbrpg-card-gold">
            <div className="bnbrpg-card-title">{t('生存状态', 'Run Status')}</div>
            <button
              type="button"
              className="bnbrpg-audio-btn"
              onClick={() => {
                unlockAudio();
                setAudioMuted((prev) => !prev);
              }}
            >
              {audioMuted
                ? t('音效：关闭（点此开启）', 'Audio: OFF (click to enable)')
                : t('音效：开启（点此静音）', 'Audio: ON (click to mute)')}
              {audioUnlocked ? '' : t(' · 点击后解锁', ' · click to unlock')}
            </button>
            <div className="bnbrpg-bar">
              <label>HP</label>
              <div><span style={{ width: `${hpPct}%` }} /></div>
              <strong>{`${hud.hp}/${hud.maxHp}`}</strong>
            </div>
            <div className="bnbrpg-bar">
              <label>EXP</label>
              <div className="is-exp"><span style={{ width: `${expPct}%` }} /></div>
              <strong>{`${hud.exp}/${hud.expNext}`}</strong>
            </div>
            <div className="bnbrpg-grid">
              <div><span>{t('生存时间', 'Time')}</span><strong>{formatTimer(hud.timer)}</strong></div>
              <div><span>{t('等级', 'Level')}</span><strong>{hud.level}</strong></div>
              <div><span>{t('击杀', 'Kills')}</span><strong>{hud.kills}</strong></div>
              <div><span>{t('附近敌人', 'Nearby')}</span><strong>{hud.nearbyEnemies}</strong></div>
              <div><span>{t('攻击', 'ATK')}</span><strong>{hud.attack}</strong></div>
              <div><span>{t('移速', 'Move')}</span><strong>{hud.speed}</strong></div>
              <div><span>{t('攻速(秒)', 'AS(sec)')}</span><strong>{hud.attackInterval.toFixed(2)}</strong></div>
              <div><span>{t('拾取半径', 'Pickup')}</span><strong>{hud.pickupRadius}</strong></div>
              <div><span>{t('角色', 'Avatar')}</span><strong>{hud.avatar === 'cz' ? 'CZ' : t('何一', 'HEYI')}</strong></div>
              <div><span>{t('旋刃等级', 'Blade Lv')}</span><strong>{hud.skillBladeLevel}</strong></div>
              <div><span>{t('雷震波等级', 'Nova Lv')}</span><strong>{hud.skillNovaLevel}</strong></div>
              <div><span>{t('分裂弹等级', 'Split Lv')}</span><strong>{hud.skillSplitLevel}</strong></div>
              <div><span>{t('地貌', 'Biome')}</span><strong>{hud.biome}</strong></div>
              <div><span>{t('分数', 'Score')}</span><strong>{hud.score}</strong></div>
              <div><span>{t('历史最高', 'Best')}</span><strong>{hud.bestScore}</strong></div>
            </div>
          </div>

          <div className="bnbrpg-card bnbrpg-card-gold bnbrpg-equip-window">
            <div className="bnbrpg-card-title">{t('装备窗口', 'Equipment Window')}</div>
            <div className="bnbrpg-equip-grid">
              <article className="bnbrpg-equip-slot">
                <div className="bnbrpg-equip-icon-wrap">
                  <img src={OGA_ASSET_PATHS.iconSword} alt="" />
                </div>
                <div className="bnbrpg-equip-meta">
                  <strong>{t('锋刃主武', 'Blade Weapon')}</strong>
                  <span style={{ color: weaponTierInfo.color }}>
                    {`${t(weaponTierInfo.zh, weaponTierInfo.en)} · T${state.player.weaponTier}`}
                  </span>
                  <small>{`ATK +${weaponAtkBonus} · ${t('穿透', 'Pierce')} +${state.player.weaponTier}`}</small>
                </div>
              </article>
              <article className="bnbrpg-equip-slot">
                <div className="bnbrpg-equip-icon-wrap">
                  <img src={OGA_ASSET_PATHS.iconHelmet} alt="" />
                </div>
                <div className="bnbrpg-equip-meta">
                  <strong>{t('护甲组件', 'Armor Core')}</strong>
                  <span style={{ color: armorTierInfo.color }}>
                    {`${t(armorTierInfo.zh, armorTierInfo.en)} · T${state.player.armorTier}`}
                  </span>
                  <small>{`DEF +${armorBonus.armor} · HP +${armorBonus.hp}`}</small>
                </div>
              </article>
              <article className="bnbrpg-equip-slot">
                <div className="bnbrpg-equip-icon-wrap">
                  <img src={OGA_ASSET_PATHS.iconStaff} alt="" />
                </div>
                <div className="bnbrpg-equip-meta">
                  <strong>{t('法术回路', 'Spell Circuit')}</strong>
                  <span style={{ color: relicTierInfo.color }}>
                    {`${t(relicTierInfo.zh, relicTierInfo.en)} · T${relicTier}`}
                  </span>
                  <small>
                    {`Blade ${state.player.skillBladeLevel} · Nova ${state.player.skillNovaLevel} · Split ${state.player.skillSplitLevel}`}
                  </small>
                </div>
              </article>
            </div>
            <p className="bnbrpg-equip-note">
              {t('拾取“装备掉落”会直接强化对应槽位；药水属于一次性消耗。', 'Equipment drops permanently strengthen slots in this run; potions are consumables.')}
            </p>
          </div>

          <div className="bnbrpg-card bnbrpg-card-gold">
            <div className="bnbrpg-card-title">{t('排行榜 Top10', 'Leaderboard Top10')}</div>
            {leaderboard.length > 0 ? (
              <div className="bnbrpg-rank-list">
                {leaderboard.map((entry, idx) => (
                  <div className="bnbrpg-rank-row" key={entry.id}>
                    <span className="bnbrpg-rank-pos">#{idx + 1}</span>
                    <div className="bnbrpg-rank-main">
                      <strong>
                        {entry.account}
                        {entry.avatar === 'cz' ? ' · CZ' : ` · ${t('何一', 'HEYI')}`}
                      </strong>
                      <small>
                        {t('分数', 'Score')} {entry.score}
                        {' · '}
                        {t('击杀', 'K')} {entry.kills}
                        {' · '}
                        Lv {entry.level}
                        {' · '}
                        {formatTimer(entry.survivalSeconds)}
                      </small>
                    </div>
                    <em>{new Date(entry.at).toLocaleDateString()}</em>
                  </div>
                ))}
              </div>
            ) : (
              <p className="bnbrpg-rank-empty">
                {t('暂无排行数据，先开一局吧。', 'No records yet. Start a run first.')}
              </p>
            )}
          </div>

          <div className="bnbrpg-card bnbrpg-card-gold">
            <div className="bnbrpg-card-title">{t('幸存者节奏', 'Survivor Loop')}</div>
            <ul>
              <li>{t('你只负责走位，攻击会自动锁定最近敌人。', 'You only dodge; attacks auto-target nearest enemies.')}</li>
              <li>{t('拾取经验晶体升级，每次从 3 个强化里选 1 个（包含技能升级）。', 'Collect XP crystals and choose 1 of 3 upgrades (including skills).')}</li>
              <li>{t('时间越久怪越多，约 58 秒刷精英，约 90 秒刷 Boss。', 'Longer time means denser hordes; elites about every 58s, bosses about every 90s.')}</li>
              <li>{t('地图已优化为 Zelda 风格地貌：道路网、湖泊岸线与区域过渡。', 'Map now uses a Zelda-like terrain flow: roads, lake shores, and smoother biome transitions.')}</li>
              <li>{t('地图会随机刷药水与装备：生命药剂、狂热药剂、武器与护甲组件。', 'Random potion and equipment drops spawn: heal/fury potions plus weapon/armor gear.')}</li>
              <li>{t('技能推荐：先点分裂弹，再补旋刃和雷震波。', 'Recommended build: Split Shot first, then Orbit Blades and Thunder Nova.')}</li>
              <li>{t('元素规则：普通攻击=水系，分裂弹=雷系，雷震波(Nova)=冰系。', 'Element rules: Normal attack=Water, Split Shot=Thunder, Nova=Ice.')}</li>
              <li>{t('目标是尽可能提高生存时间与得分。', 'Goal: survive longer and push a higher score.')}</li>
            </ul>
          </div>

          <div className="bnbrpg-card bnbrpg-card-gold">
            <div className="bnbrpg-card-title">{t('战斗日志', 'Battle Log')}</div>
            <div className="bnbrpg-log">
              {state.logs.map((msg, idx) => (
                <p key={`${idx}-${msg}`}>{msg}</p>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <style>{`
        .bnbrpg-page.bnbrpg-survivors {
          --gold-1: #f7eab4;
          --gold-2: #dfc777;
          --gold-3: #b8913f;
          --gold-4: #826224;
          --gold-deep: #4a3812;
          --gold-glow: rgba(255, 219, 131, 0.34);
          min-height: calc(100vh - 96px);
          padding: 90px 16px 18px;
          box-sizing: border-box;
          background:
            radial-gradient(circle at 8% 0%, rgba(255,255,255,0.4), transparent 30%),
            radial-gradient(circle at 78% 0%, rgba(255,224,145,0.3), transparent 34%),
            linear-gradient(180deg, #e7f0cf 0%, #d4e2b1 42%, #c5d59d 100%);
          font-family: 'Space Mono', monospace;
          color: #29402c;
        }
        .bnbrpg-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          max-width: 1540px;
          margin: 0 auto 12px;
        }
        .bnbrpg-title-wrap h1 {
          margin: 0;
          font-family: 'Press Start 2P', cursive;
          font-size: clamp(15px, 2.2vw, 24px);
          color: #2e5c34;
          line-height: 1.3;
        }
        .bnbrpg-title-wrap p {
          margin: 7px 0 0;
          color: #44694a;
          font-size: 12px;
        }
        .bnbrpg-wallet {
          border: 1px solid var(--gold-4);
          border-radius: 9px;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.6), rgba(246, 234, 181, 0.92)),
            repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 3px, rgba(255,255,255,0) 3px 6px);
          padding: 8px 10px;
          min-width: 170px;
          text-align: right;
          box-shadow: inset 0 0 0 1px rgba(255, 236, 172, 0.56), 0 5px 13px rgba(72, 53, 19, 0.18);
        }
        .bnbrpg-wallet span {
          font-size: 10px;
          color: #4f7455;
          display: block;
        }
        .bnbrpg-wallet strong {
          font-family: 'Press Start 2P', cursive;
          font-size: 10px;
          color: #4d3a14;
        }
        .bnbrpg-layout {
          display: grid;
          grid-template-columns: 1fr 340px;
          gap: 12px;
          max-width: 1540px;
          margin: 0 auto;
          align-items: start;
        }
        .bnbrpg-canvas-panel {
          min-width: 0;
        }
        .bnbrpg-canvas-wrap {
          position: relative;
          width: 100%;
          border: 2px solid var(--gold-4);
          border-radius: 14px;
          overflow: hidden;
          box-shadow:
            0 12px 30px rgba(48, 41, 20, 0.28),
            inset 0 0 0 1px rgba(255, 233, 166, 0.46),
            inset 0 1px 0 rgba(255,255,255,0.4);
          background: #192218;
          aspect-ratio: 16 / 9;
        }
        .bnbrpg-canvas-wrap canvas {
          width: 100%;
          height: 100%;
          display: block;
          image-rendering: pixelated;
          image-rendering: crisp-edges;
        }
        .bnbrpg-loading {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 14, 0.64);
          color: #dcf8bd;
          font-family: 'Press Start 2P', cursive;
          font-size: 12px;
        }
        .bnbrpg-canvas-hint {
          position: absolute;
          left: 10px;
          right: 10px;
          bottom: 10px;
          border: 1px solid rgba(255, 223, 147, 0.52);
          border-radius: 8px;
          background: linear-gradient(180deg, rgba(54, 42, 16, 0.78), rgba(32, 24, 8, 0.78));
          color: #ffe7b0;
          text-align: center;
          padding: 6px 8px;
          font-size: 11px;
          z-index: 4;
        }
        .bnbrpg-levelup-modal {
          position: absolute;
          inset: 0;
          background: rgba(7, 13, 9, 0.64);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: 12px;
          z-index: 3;
          padding: 16px;
          box-sizing: border-box;
        }
        .bnbrpg-levelup-title {
          font-family: 'Press Start 2P', cursive;
          color: #ffeec3;
          font-size: 12px;
          text-align: center;
        }
        .bnbrpg-levelup-grid {
          width: min(980px, 96%);
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .bnbrpg-levelup-grid button {
          border: 1px solid var(--gold-3);
          border-radius: 10px;
          background:
            linear-gradient(180deg, rgba(86, 62, 22, 0.96), rgba(42, 30, 10, 0.96)),
            repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 4px, rgba(255,255,255,0) 4px 8px);
          color: #ffe8b2;
          padding: 12px 10px 10px;
          text-align: left;
          cursor: pointer;
          display: grid;
          gap: 8px;
          min-height: 120px;
          position: relative;
        }
        .bnbrpg-upgrade-icon {
          width: 24px;
          height: 24px;
          image-rendering: pixelated;
          image-rendering: crisp-edges;
          filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.18));
        }
        .bnbrpg-levelup-grid button strong {
          font-family: 'Press Start 2P', cursive;
          font-size: 10px;
          line-height: 1.4;
        }
        .bnbrpg-levelup-grid button span {
          font-size: 11px;
          color: #f8e2a3;
          line-height: 1.4;
        }
        .bnbrpg-levelup-grid button em {
          position: absolute;
          right: 8px;
          bottom: 8px;
          font-style: normal;
          font-family: 'Press Start 2P', cursive;
          font-size: 10px;
          color: #ffd26a;
        }
        .bnbrpg-side {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .bnbrpg-card {
          border: 1px solid var(--gold-4);
          border-radius: 10px;
          background:
            linear-gradient(180deg, rgba(250, 240, 203, 0.96), rgba(227, 205, 143, 0.96)),
            repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 5px, rgba(255,255,255,0) 5px 10px);
          padding: 10px;
          box-shadow:
            0 6px 16px rgba(70, 53, 19, 0.2),
            inset 0 0 0 1px rgba(255, 243, 194, 0.52);
          font-size: 12px;
        }
        .bnbrpg-card-gold {
          position: relative;
        }
        .bnbrpg-card-gold::before {
          content: '';
          position: absolute;
          inset: 5px;
          border: 1px solid rgba(123, 92, 32, 0.58);
          border-radius: 7px;
          pointer-events: none;
        }
        .bnbrpg-card-title {
          font-family: 'Press Start 2P', cursive;
          font-size: 10px;
          color: #553f14;
          margin-bottom: 8px;
          text-shadow: 0 1px 0 rgba(255, 248, 223, 0.55);
        }
        .bnbrpg-audio-btn {
          width: 100%;
          border: 1px solid rgba(131, 95, 30, 0.8);
          border-radius: 7px;
          background: linear-gradient(180deg, rgba(255, 242, 201, 0.88), rgba(226, 197, 124, 0.95));
          color: #4b3610;
          font-size: 10px;
          padding: 7px 8px;
          margin-bottom: 8px;
          cursor: pointer;
        }
        .bnbrpg-bar {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 6px;
          align-items: center;
          margin-bottom: 6px;
        }
        .bnbrpg-bar label {
          font-size: 11px;
          color: #6a4e1d;
          min-width: 32px;
        }
        .bnbrpg-bar div {
          border: 1px solid rgba(92, 69, 24, 0.46);
          height: 9px;
          background: rgba(63, 46, 18, 0.21);
        }
        .bnbrpg-bar div span {
          display: block;
          height: 100%;
          background: linear-gradient(90deg, #6cc868, #86df70);
        }
        .bnbrpg-bar div.is-exp span {
          background: linear-gradient(90deg, #6fb7ff, #9dd4ff);
        }
        .bnbrpg-bar strong {
          font-size: 11px;
          color: #553d13;
        }
        .bnbrpg-grid {
          margin-top: 8px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
        }
        .bnbrpg-grid div {
          border: 1px solid rgba(121, 89, 32, 0.54);
          background: rgba(255, 244, 212, 0.56);
          padding: 4px 5px;
          display: flex;
          justify-content: space-between;
          gap: 6px;
          font-size: 10px;
        }
        .bnbrpg-grid div span {
          color: #755627;
        }
        .bnbrpg-grid div strong {
          color: #48330c;
        }
        .bnbrpg-equip-window {
          border-color: #956f2a;
          box-shadow: 0 8px 18px rgba(70, 53, 19, 0.24), inset 0 0 0 1px rgba(255, 247, 207, 0.6);
        }
        .bnbrpg-equip-grid {
          display: grid;
          gap: 8px;
        }
        .bnbrpg-equip-slot {
          display: grid;
          grid-template-columns: 40px 1fr;
          gap: 8px;
          align-items: center;
          border: 1px solid rgba(128, 93, 30, 0.55);
          border-radius: 7px;
          padding: 6px;
          background:
            linear-gradient(180deg, rgba(255, 243, 205, 0.66), rgba(237, 212, 149, 0.58)),
            repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 4px, rgba(255,255,255,0) 4px 8px);
        }
        .bnbrpg-equip-icon-wrap {
          width: 32px;
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(118, 85, 27, 0.72);
          background: linear-gradient(180deg, rgba(255, 243, 206, 0.8), rgba(226, 194, 121, 0.82));
          border-radius: 6px;
          box-shadow: inset 0 0 0 1px rgba(255, 251, 224, 0.52);
        }
        .bnbrpg-equip-icon-wrap img {
          width: 20px;
          height: 20px;
          image-rendering: pixelated;
          image-rendering: crisp-edges;
          filter: drop-shadow(0 1px 0 rgba(255,255,255,0.32));
        }
        .bnbrpg-equip-meta {
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .bnbrpg-equip-meta strong {
          font-size: 11px;
          color: #4c370e;
        }
        .bnbrpg-equip-meta span {
          font-size: 10px;
        }
        .bnbrpg-equip-meta small {
          font-size: 10px;
          color: #6a4f1f;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .bnbrpg-equip-note {
          margin: 8px 0 0;
          border: 1px dashed rgba(119, 87, 31, 0.52);
          border-radius: 6px;
          padding: 6px 8px;
          font-size: 10px;
          color: #6a5124;
          background: rgba(255, 247, 224, 0.5);
          line-height: 1.45;
        }
        .bnbrpg-card ul {
          margin: 0;
          padding-left: 17px;
          display: grid;
          gap: 4px;
          color: #624a1e;
          font-size: 11px;
          line-height: 1.5;
        }
        .bnbrpg-log {
          display: grid;
          gap: 6px;
          max-height: 210px;
          overflow: auto;
        }
        .bnbrpg-log p {
          margin: 0;
          padding: 6px;
          border: 1px solid rgba(122, 89, 30, 0.58);
          background: rgba(255, 246, 220, 0.56);
          color: #533d11;
          font-size: 11px;
        }
        .bnbrpg-rank-list {
          display: grid;
          gap: 6px;
          max-height: 320px;
          overflow: auto;
        }
        .bnbrpg-rank-row {
          display: grid;
          grid-template-columns: 40px 1fr auto;
          gap: 6px;
          align-items: center;
          border: 1px solid rgba(123, 91, 33, 0.58);
          background: rgba(255, 246, 220, 0.56);
          padding: 5px 6px;
        }
        .bnbrpg-rank-pos {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(117, 86, 29, 0.72);
          background: rgba(245, 226, 170, 0.9);
          color: #5a4212;
          border-radius: 6px;
          font-size: 10px;
          height: 20px;
        }
        .bnbrpg-rank-main {
          min-width: 0;
          display: grid;
          gap: 3px;
        }
        .bnbrpg-rank-main strong {
          color: #4c360e;
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bnbrpg-rank-main small {
          color: #6f5424;
          font-size: 10px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bnbrpg-rank-row em {
          font-style: normal;
          font-size: 9px;
          color: #715626;
          white-space: nowrap;
        }
        .bnbrpg-rank-empty {
          margin: 0;
          border: 1px dashed rgba(123, 91, 30, 0.62);
          background: rgba(255, 246, 220, 0.45);
          color: #6e5423;
          font-size: 11px;
          padding: 8px;
        }
        @media (max-width: 1180px) {
          .bnbrpg-layout {
            grid-template-columns: 1fr;
          }
          .bnbrpg-side {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }
          .bnbrpg-levelup-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 760px) {
          .bnbrpg-page.bnbrpg-survivors {
            padding: 88px 10px 14px;
          }
          .bnbrpg-header {
            flex-direction: column;
            align-items: flex-start;
          }
          .bnbrpg-side {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

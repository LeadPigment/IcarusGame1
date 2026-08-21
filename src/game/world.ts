import * as THREE from "three";

/* ── 世界常量（与原版一致）───────────────────── */
export const ROOM = 5; // 房间地面 5×5 格
export const WALL_T = 0.4; // 墙厚
export const PITCH = ROOM + WALL_T * 2; // 房间间距 5.8
export const CEIL = 4.5; // 天花板高
export const DOOR_H = 4; // 门高 4
export const CAM_H = 2; // 摄像机高度（中间块 2 格）

export type Dir = 0 | 1 | 2 | 3; // 北 东 南 西
export const DIRVEC = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];
export const DIRNAME = ["北", "东", "南", "西"];
export const DOORW = [0, 3, 5]; // 0=无门 1=普通门(3宽) 2=无墙大门(5宽)
export type DoorKind = 0 | 1 | 2;

/* ── 确定性哈希 ────────────────────────────── */
export function hash2(x: number, z: number, salt = 0): number {
  let h = 2166136261 ^ salt;
  h = Math.imul(h ^ (x | 0), 16777619);
  h = Math.imul(h ^ ((z | 0) * 2654435761), 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 两房间共享边的门（保证往返一致） */
export function edgeDoor(x: number, z: number, dir: Dir): DoorKind {
  let kx = x,
    kz = z,
    axis = 0;
  if (dir === 0) {
    kx = x;
    kz = z - 1;
    axis = 11;
  } else if (dir === 2) {
    kx = x;
    kz = z;
    axis = 11;
  } else if (dir === 1) {
    kx = x;
    kz = z;
    axis = 23;
  } else {
    kx = x - 1;
    kz = z;
    axis = 23;
  }
  let r = hash2(kx * 2 + axis, kz * 2 + axis, 901 + axis);
  if (x === 0 && z === 0 && r < 0.2) r = 0.5; // 起始房间保证可离开
  if (r < 0.16) return 0;
  if (r < 0.78) return 1;
  return 2;
}

/* ── 群系 ──────────────────────────────────── */
export interface BiomeDef {
  name: string;
  fog: number;
  fogD: number;
  lamp: number;
  lampI: number;
  hemiSky: number;
  hemiGnd: number;
  ambFreq: number;
  dust: number;
  motif: string;
}
export const BIOMES: BiomeDef[] = [
  { name: "琥珀回廊", fog: 0xc7a15f, fogD: 0.078, lamp: 0xffd98a, lampI: 1.25, hemiSky: 0x9a7b4a, hemiGnd: 0x2a1f12, ambFreq: 55, dust: 0xe8c98a, motif: "墙纸剥落的无尽厅堂" },
  { name: "档案库", fog: 0x5f7a6a, fogD: 0.09, lamp: 0xbfe8c8, lampI: 1.1, hemiSky: 0x5f7f6f, hemiGnd: 0x161f1a, ambFreq: 49, dust: 0x9fd0b0, motif: "铁架与受潮的卷宗" },
  { name: "温室", fog: 0x3e6247, fogD: 0.1, lamp: 0xa8f0ae, lampI: 1.05, hemiSky: 0x4f8058, hemiGnd: 0x101f14, ambFreq: 44, dust: 0x8fe89a, motif: "苔藓吞没了地砖" },
  { name: "锅炉层", fog: 0x6e4028, fogD: 0.088, lamp: 0xffb35c, lampI: 1.3, hemiSky: 0x8a5a3a, hemiGnd: 0x1f120c, ambFreq: 41, dust: 0xffc08a, motif: "管道仍在低声震颤" },
  { name: "泳池厅", fog: 0x2e6e8e, fogD: 0.086, lamp: 0x9fe8ff, lampI: 1.15, hemiSky: 0x4f90b0, hemiGnd: 0x0d2030, ambFreq: 58, dust: 0xaeeaff, motif: "水光在天花板上晃动" },
  { name: "圣所", fog: 0xb99a5f, fogD: 0.075, lamp: 0xffe9a8, lampI: 1.35, hemiSky: 0xb09a6a, hemiGnd: 0x2a2214, ambFreq: 65, dust: 0xffe9b0, motif: "烛火为某人长明" },
];
const BIOME_W = [0.26, 0.2, 0.18, 0.16, 0.14, 0.06];

export function biomeIndex(x: number, z: number): number {
  if (x === 0 && z === 0) return 0;
  const r = hash2(x, z, 777);
  let acc = 0;
  for (let i = 0; i < BIOME_W.length; i++) {
    acc += BIOME_W[i];
    if (r < acc) return i;
  }
  return 0;
}

/* ── 遗物（伊卡洛斯残页）────────────────────── */
const RELIC_SLOTS = [
  [1.7, 1.7], [-1.7, 1.7], [1.7, -1.7], [-1.7, -1.7],
  [1.95, 0], [-1.95, 0], [0, 1.95], [0, -1.95],
];
export function relicAt(x: number, z: number): { x: number; z: number } | null {
  if (x === 0 && z === 0) return null;
  const r = hash2(x, z, 1234);
  if (r >= 0.15) return null;
  const i = Math.floor(hash2(x, z, 5678) * RELIC_SLOTS.length);
  return { x: RELIC_SLOTS[i][0], z: RELIC_SLOTS[i][1] };
}

export const LORE = [
  "……他造翼的工坊空了，桌上只剩半罐冷却的蜡。",
  "守卫说，那天正午，有人看见两个影子同时坠落。",
  "羽毛并不怕火——怕火的是握着它的人。",
  "迷宫不是囚笼，是巢。我们都在等一个坠落的人。",
  "他在墙上刻着：太阳不是终点，是门。",
  "蜡翼熔化的那一刻，他笑得像个孩子。",
  "追猎者并非狱卒。它在寻找自己遗失的另一半影子。",
  "伊卡洛斯没有消失。他成为了迷宫上方的光。",
];

/* ── 装饰布局（车道安全：不遮挡门的中轴通道）── */
export interface DecorItem {
  t: string;
  x: number;
  z: number;
  r: number;
  s: number;
}
export function decorFor(x: number, z: number, biome: number, doors: DoorKind[]): DecorItem[] {
  const out: DecorItem[] = [];
  const r1 = hash2(x, z, 31);
  const r2 = hash2(x, z, 32);
  const r3 = hash2(x, z, 33);
  // 角柱（所有群系通用，2 个对角）
  if (r1 < 0.8) {
    out.push({ t: "column", x: r2 < 0.5 ? 1.95 : -1.95, z: r3 < 0.5 ? 1.95 : -1.95, r: 0, s: 1 });
    out.push({ t: "column", x: r2 < 0.5 ? -1.95 : 1.95, z: r3 < 0.5 ? -1.95 : 1.95, r: 0, s: biome === 2 ? 0.62 : 1 });
  }
  const wallItem = (t: string, dir: number, side: number, s = 1) => {
    // 贴墙摆放，避开门洞(|沿墙偏移|>1.6)，仅用于非大门墙
    if (doors[dir] === 2) return;
    const off = side * 2.02;
    if (dir === 0) out.push({ t, x: off, z: -2.18, r: 0, s });
    if (dir === 2) out.push({ t, x: -off, z: 2.18, r: 0, s });
    if (dir === 1) out.push({ t, x: 2.18, z: off, r: Math.PI / 2, s });
    if (dir === 3) out.push({ t, x: -2.18, z: -off, r: Math.PI / 2, s });
  };
  const corner = (i: number) => [i % 2 === 0 ? 1.85 : -1.85, i < 2 ? -1.85 : 1.85];
  switch (biome) {
    case 0: {
      wallItem("shelf", 1, r2 < 0.5 ? 1 : -1);
      wallItem("table", 3, r3 < 0.5 ? 1 : -1);
      out.push({ t: "rug", x: 0, z: 0, r: r1 * Math.PI, s: 1 });
      out.push({ t: "lamp", x: 0, z: 0, r: 0, s: 1 });
      if (r2 > 0.55) {
        const c = corner(1);
        out.push({ t: "plant", x: c[0], z: c[1], r: 0, s: 1 });
      }
      break;
    }
    case 1: {
      wallItem("shelf", 0, 1);
      wallItem("shelf", 2, -1);
      wallItem("shelf", 1, r2 < 0.5 ? 1 : -1, 0.9);
      out.push({ t: "lamp", x: 0, z: 0, r: 0, s: 1 });
      if (r3 > 0.5) {
        const c = corner(2);
        out.push({ t: "crate", x: c[0], z: c[1], r: r1 * 3, s: 1 });
      }
      break;
    }
    case 2: {
      const vines = 3 + Math.floor(r2 * 4);
      for (let i = 0; i < vines; i++) {
        const a = hash2(x * 7 + i, z * 13 + i, 99);
        const b = hash2(x * 11 + i, z * 5 + i, 98);
        let vx = (a - 0.5) * 4.4;
        let vz = (b - 0.5) * 4.4;
        if (Math.abs(vx) < 0.8 && Math.abs(vz) < 0.8) vx += vx >= 0 ? 1 : -1;
        out.push({ t: "vine", x: vx, z: vz, r: a * 6, s: 0.8 + b * 1.5 });
      }
      if (r1 > 0.45) {
        const c = corner(3);
        out.push({ t: "rubble", x: c[0], z: c[1], r: 0, s: 1 });
      }
      wallItem("trough", 3, r3 < 0.5 ? 1 : -1);
      break;
    }
    case 3: {
      out.push({ t: "pipes", x: 0, z: 0, r: 0, s: 1 });
      wallItem("boiler", 1, r2 < 0.5 ? 1 : -1);
      wallItem("boiler", 3, r3 < 0.5 ? 1 : -1, 0.8);
      const c = corner(0);
      out.push({ t: "crate", x: c[0], z: c[1], r: 1, s: 0.8 });
      out.push({ t: "steam", x: r2 < 0.5 ? 2.1 : -2.1, z: r3 < 0.5 ? 2.1 : -2.1, r: 0, s: 1 });
      break;
    }
    case 4: {
      out.push({ t: "pool", x: 0, z: 0, r: 0, s: 1 });
      wallItem("bench", 0, r2 < 0.5 ? 1 : -1);
      wallItem("bench", 2, r3 < 0.5 ? 1 : -1);
      const c = corner(1);
      out.push({ t: "column", x: c[0], z: c[1], r: 0, s: 0.9 });
      break;
    }
    default: {
      wallItem("pew", 1, 1);
      wallItem("pew", 1, -1);
      wallItem("pew", 3, 1);
      out.push({ t: "candle", x: -1.85, z: -1.85, r: 0, s: 1 });
      out.push({ t: "candle", x: 1.85, z: 1.85, r: 0, s: 1 });
      out.push({ t: "lamp", x: 0, z: 0, r: 0, s: 1 });
      break;
    }
  }
  return out;
}

/* ── 程序化贴图 ────────────────────────────── */
const texCache = new Map<string, THREE.CanvasTexture>();
const matCache = new Map<string, THREE.MeshStandardMaterial>();

function seeded(seedStr: string) {
  let s = 2166136261;
  for (let i = 0; i < seedStr.length; i++) s = Math.imul(s ^ seedStr.charCodeAt(i), 16777619);
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
function shade(hex: number, f: number): string {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.max(0, (hex & 255) * f));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
const FLOOR_BASE = [0x8a6a44, 0x5d6660, 0x4a5a42, 0x4a3a34, 0x1e4a63, 0xb9ab90];
const WALL_BASE = [0xc9b183, 0x7d8a7a, 0x6d7f5a, 0x6e4a3a, 0x7fc4d8, 0xd8cbb2];
const CEIL_BASE = [0xb7a67e, 0x6e7a70, 0x5a6a52, 0x54423a, 0x2f6f8f, 0xcfc2a8];

function makeCanvas(kind: string, biome: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const rnd = seeded(kind + biome);
  const base = kind === "floor" ? FLOOR_BASE[biome] : kind === "wall" ? WALL_BASE[biome] : CEIL_BASE[biome];
  g.fillStyle = shade(base, 1);
  g.fillRect(0, 0, 256, 256);

  if (kind === "floor") {
    if (biome === 0) {
      // 木板
      for (let i = 0; i < 4; i++) {
        g.fillStyle = shade(base, 0.88 + rnd() * 0.26);
        g.fillRect(i * 64, 0, 62, 256);
        for (let k = 0; k < 7; k++) {
          g.strokeStyle = `rgba(40,24,10,${0.12 + rnd() * 0.14})`;
          g.beginPath();
          const x0 = i * 64 + rnd() * 60;
          g.moveTo(x0, 0);
          g.bezierCurveTo(x0 + 8, 80, x0 - 8, 170, x0 + 4, 256);
          g.stroke();
        }
      }
      g.fillStyle = "rgba(20,12,5,0.7)";
      for (let i = 0; i <= 4; i++) g.fillRect(i * 64 - 1, 0, 2, 256);
    } else if (biome === 4) {
      // 泳池深蓝湿砖
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          g.fillStyle = shade(base, 0.9 + rnd() * 0.24);
          g.fillRect(x * 32, y * 32, 31, 31);
        }
      g.fillStyle = "rgba(160,230,255,0.12)";
      for (let i = 0; i < 26; i++) g.fillRect(rnd() * 256, rnd() * 256, 26 + rnd() * 40, 2);
    } else {
      // 大方砖 + 勾缝
      const n = biome === 5 ? 2 : 2;
      const s = 256 / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          g.fillStyle = shade(base, 0.92 + rnd() * 0.16);
          g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
        }
      g.fillStyle = "rgba(0,0,0,0.35)";
      for (let i = 0; i <= n; i++) {
        g.fillRect(i * s - 2, 0, 4, 256);
        g.fillRect(0, i * s - 2, 256, 4);
      }
      if (biome === 2) {
        g.fillStyle = "rgba(60,110,60,0.5)";
        for (let i = 0; i < 40; i++) {
          g.beginPath();
          g.arc(rnd() * 256, rnd() * 256, 3 + rnd() * 10, 0, 7);
          g.fill();
        }
      }
      if (biome === 3) {
        g.strokeStyle = "rgba(120,120,130,0.4)";
        for (let i = 0; i < 5; i++) {
          g.beginPath();
          g.arc(rnd() * 256, rnd() * 256, 3, 0, 7);
          g.stroke();
        }
        g.fillStyle = "rgba(255,140,60,0.16)";
        for (let i = 0; i < 12; i++) g.fillRect(rnd() * 256, rnd() * 256, 8 + rnd() * 22, 6 + rnd() * 14);
      }
    }
  } else if (kind === "wall") {
    if (biome === 0) {
      // 条纹墙纸 + 腰线
      for (let x = 0; x < 256; x += 32) {
        g.fillStyle = shade(base, x % 64 === 0 ? 0.94 : 1.05);
        g.fillRect(x, 0, 32, 256);
      }
      g.fillStyle = shade(base, 0.55);
      g.fillRect(0, 176, 256, 12);
      g.fillStyle = shade(base, 0.72);
      g.fillRect(0, 188, 256, 68);
      g.fillStyle = "rgba(90,60,20,0.25)";
      for (let i = 0; i < 16; i++) {
        const x = rnd() * 256, y = rnd() * 170;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 10 + rnd() * 20, y + 4 + rnd() * 10);
        g.lineTo(x - 4 + rnd() * 8, y + 20 + rnd() * 16);
        g.closePath();
        g.fill();
      }
    } else if (biome === 1) {
      // 金属板 + 铆钉
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          g.fillStyle = shade(base, 0.92 + rnd() * 0.14);
          g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
        }
      g.fillStyle = "rgba(20,30,25,0.6)";
      for (let i = 0; i <= 2; i++) {
        g.fillRect(i * 128 - 2, 0, 4, 256);
        g.fillRect(0, i * 128 - 2, 256, 4);
      }
      g.fillStyle = "rgba(210,230,215,0.5)";
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++)
          for (let k = 0; k < 4; k++) {
            g.beginPath();
            g.arc(x * 128 + 12 + (k % 2) * 100, y * 128 + 12 + ((k / 2) | 0) * 100, 3, 0, 7);
            g.fill();
          }
      g.fillStyle = "rgba(200,240,210,0.1)";
      for (let i = 0; i < 20; i++) g.fillRect(rnd() * 256, rnd() * 256, 2, 10 + rnd() * 30);
    } else if (biome === 2) {
      // 苔石
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          g.fillStyle = shade(base, 0.86 + rnd() * 0.26);
          g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
        }
      g.fillStyle = "rgba(30,60,30,0.55)";
      for (let i = 0; i < 60; i++) {
        g.beginPath();
        g.arc(rnd() * 256, 120 + rnd() * 136, 2 + rnd() * 9, 0, 7);
        g.fill();
      }
    } else if (biome === 3) {
      // 锈板
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          g.fillStyle = shade(base, 0.88 + rnd() * 0.2);
          g.fillRect(x * 128 + 2, y * 128 + 2, 124, 124);
        }
      g.fillStyle = "rgba(255,150,70,0.22)";
      for (let i = 0; i < 26; i++) {
        g.beginPath();
        g.arc(rnd() * 256, rnd() * 256, 4 + rnd() * 16, 0, 7);
        g.fill();
      }
      g.fillStyle = "rgba(30,15,8,0.5)";
      for (let i = 0; i < 14; i++) g.fillRect(rnd() * 256, rnd() * 256, 3, 20 + rnd() * 50);
      g.fillStyle = "rgba(0,0,0,0.4)";
      g.fillRect(0, 0, 256, 5);
      g.fillRect(0, 126, 256, 5);
    } else if (biome === 4) {
      // 亮瓷砖
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          g.fillStyle = shade(base, 0.9 + rnd() * 0.2);
          g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
        }
      g.fillStyle = "rgba(255,255,255,0.25)";
      for (let i = 0; i < 30; i++) g.fillRect(rnd() * 256, rnd() * 256, 10, 3);
    } else {
      // 大理石
      g.fillStyle = shade(base, 1.03);
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = "rgba(150,130,95,0.35)";
      for (let i = 0; i < 10; i++) {
        g.lineWidth = 1 + rnd() * 2;
        g.beginPath();
        const x0 = rnd() * 256, y0 = rnd() * 256;
        g.moveTo(x0, y0);
        g.bezierCurveTo(x0 + 60 - rnd() * 120, y0 + 40, x0 + rnd() * 100, y0 + 120, x0 - 60 + rnd() * 120, y0 + 200);
        g.stroke();
      }
      g.fillStyle = "rgba(120,100,60,0.2)";
      g.fillRect(0, 220, 256, 36);
    }
  } else {
    // 天花板：方块吊顶 + 水渍
    g.fillStyle = shade(base, 0.96);
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "rgba(0,0,0,0.28)";
    g.lineWidth = 3;
    g.strokeRect(2, 2, 252, 252);
    g.strokeRect(64, 64, 128, 128);
    g.fillStyle = "rgba(60,40,20,0.14)";
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.arc(rnd() * 256, rnd() * 256, 14 + rnd() * 30, 0, 7);
      g.fill();
    }
  }
  // 颗粒噪点
  for (let i = 0; i < 900; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.05)";
    g.fillRect(rnd() * 256, rnd() * 256, 1.5, 1.5);
  }
  return c;
}

export function getTexture(kind: string, biome: number, repeatX = 1, repeatY = 1, darken = 1): THREE.CanvasTexture {
  const key = `${kind}|${biome}|${repeatX}|${repeatY}`;
  let t = texCache.get(key);
  if (!t) {
    const c = makeCanvas(kind, biome);
    t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
  }
  return t;
}

export function getMaterial(kind: string, biome: number, opts: { repeat?: [number, number]; darken?: number; emissive?: number; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  const rep = opts.repeat ?? [1, 1];
  const dk = opts.darken ?? 1;
  const key = `${kind}|${biome}|${rep[0]}|${rep[1]}|${dk}|${opts.emissive ?? 0}|${opts.side ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: getTexture(kind, biome, rep[0], rep[1]),
      roughness: 0.92,
      metalness: biome === 3 ? 0.25 : 0.04,
      side: opts.side ?? THREE.FrontSide,
    });
    if (dk !== 1) m.color.setScalar(dk);
    matCache.set(key, m);
  }
  return m;
}

/* 纯色装饰材质缓存 */
const colorMatCache = new Map<string, THREE.MeshStandardMaterial>();
export function colorMat(hex: number, rough = 0.85, emissive = 0, emissiveHex = 0): THREE.MeshStandardMaterial {
  const key = `${hex}|${rough}|${emissive}|${emissiveHex}`;
  let m = colorMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: rough,
      metalness: 0.05,
      emissive: emissiveHex,
      emissiveIntensity: emissive,
    });
    colorMatCache.set(key, m);
  }
  return m;
}

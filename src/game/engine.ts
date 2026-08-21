import * as THREE from "three";
import {
  ROOM, WALL_T, PITCH, CEIL, DOOR_H, CAM_H,
  DIRVEC, DIRNAME, DOORW,
  type Dir, type DoorKind,
  edgeDoor, biomeIndex, relicAt, decorFor, LORE,
  BIOMES, getMaterial, colorMat,
} from "./world";
import { SoundKit } from "./audio";

export interface HudData {
  mode: string;
  score: number;
  rooms: number;
  relics: number;
  relicsTotal: number;
  biome: string;
  motif: string;
  coords: string;
  yawDeg: number;
  alignedDir: number; // -1 未对准
  forwardDoor: number; // 前方门类型
  hold: number; // W 长按进度 0..1
  doors: number[]; // 四个方向的门
  shadowDist: number; // -1 未激活
  shadowSame: boolean;
  time: number;
  muted: boolean;
  log: string[];
}
export interface EndStats {
  score: number;
  rooms: number;
  relics: number;
  time: number;
  loreFound: string[];
}
export interface Hooks {
  onHud(h: HudData): void;
  onToast(text: string, tone: "gold" | "danger" | "info"): void;
  onEnd(kind: "caught" | "won", stats: EndStats): void;
}

const RELIC_TOTAL = 8;

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private roomGroup = new THREE.Group();
  private shadowGroup = new THREE.Group();
  private hemi: THREE.HemisphereLight;
  private roomLight: THREE.PointLight;
  private relicLight: THREE.PointLight;
  private hooks: Hooks;
  private sound = new SoundKit();
  private raf = 0;
  private clock = new THREE.Clock();
  private t = 0;
  private hudTimer = 0;
  private destroyed = false;
  private ro: ResizeObserver;

  /* 共享几何 */
  private gBox = new THREE.BoxGeometry(1, 1, 1);
  private gCyl = new THREE.CylinderGeometry(1, 1, 1, 14);
  private gCone = new THREE.CylinderGeometry(0.26, 0.5, 1, 14);
  private gPlane = new THREE.PlaneGeometry(1, 1);
  private gSphere = new THREE.SphereGeometry(1, 12, 10);
  private gTorus = new THREE.TorusGeometry(0.3, 0.035, 10, 28);
  private gOcta = new THREE.OctahedronGeometry(0.16);
  private gDodeca = new THREE.DodecahedronGeometry(0.4);
  private glowTex: THREE.CanvasTexture;

  /* 状态 */
  mode: "attract" | "play" | "paused" | "over" | "won" = "attract";
  private room = { x: 0, z: 0 };
  private yaw = 0;
  private pitch = -0.04;
  private forwardHeld = false;
  private keys = new Set<string>();
  private dragging = false;
  private lastPX = 0;
  private lastPY = 0;
  private ndc = new THREE.Vector2();
  private pointerDown = false;
  private shake = 0;
  private flashEl: HTMLDivElement;
  private fadeEl: HTMLDivElement;
  private ringEl: HTMLDivElement;
  private ringFg: SVGCircleElement;
  private ringLabel: HTMLDivElement;

  private traversing: { dir: Dir; t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; swapped: boolean } | null = null;
  private holdFwd = 0;
  private blockedCd = 0;
  private holdTarget: { type: "door" | "relic"; dir?: Dir } | null = null;
  private holdProg = 0;

  private collected = new Set<string>();
  private loreFound: string[] = [];
  private score = 0;
  private roomsSeen = new Set<string>(["0,0"]);
  private elapsed = 0;
  private log: string[] = [];

  private shadow = { active: false, x: 8, z: 8, timer: 0, inRoom: false, lx: 2, lz: 2, speed: 0.75 };
  private hbTimer = 0;
  private whisperTimer = 4;
  private winPending = false;
  private flick = 1;

  /* 每房间动画引用 */
  private anim: {
    dust: THREE.Points | null;
    steam: THREE.Points | null;
    relic: THREE.Group | null;
    waterMat: THREE.MeshStandardMaterial | null;
    flames: THREE.Mesh[];
    fogColor: THREE.Color;
    flicker: boolean;
    doorMeshes: THREE.Mesh[];
  } = { dust: null, steam: null, relic: null, waterMat: null, flames: [], fogColor: new THREE.Color(0xc7a15f), flicker: false, doorMeshes: [] };
  private bursts: { sp: THREE.Sprite; v: THREE.Vector3; life: number }[] = [];
  private tempGeos: THREE.BufferGeometry[] = [];
  private raycaster = new THREE.Raycaster();

  constructor(container: HTMLElement, hooks: Hooks) {
    this.hooks = hooks;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cursor = "grab";
    this.renderer.domElement.style.touchAction = "none";

    this.camera = new THREE.PerspectiveCamera(72, container.clientWidth / container.clientHeight, 0.05, 80);
    this.scene.add(this.roomGroup);

    this.hemi = new THREE.HemisphereLight(0x9a7b4a, 0x2a1f12, 0.9);
    this.scene.add(this.hemi);
    this.roomLight = new THREE.PointLight(0xffd98a, 30, 16, 1.6);
    this.roomLight.position.set(0, 3.6, 0);
    this.scene.add(this.roomLight);
    this.relicLight = new THREE.PointLight(0xffd98a, 0, 5, 1.8);
    this.scene.add(this.relicLight);

    /* 发光贴图 */
    const gc = document.createElement("canvas");
    gc.width = gc.height = 64;
    const gg = gc.getContext("2d")!;
    const grad = gg.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,244,214,1)");
    grad.addColorStop(0.35, "rgba(255,220,150,0.5)");
    grad.addColorStop(1, "rgba(255,200,120,0)");
    gg.fillStyle = grad;
    gg.fillRect(0, 0, 64, 64);
    this.glowTex = new THREE.CanvasTexture(gc);

    this.buildShadowFigure();

    /* DOM 高频效果层 */
    const layer = document.createElement("div");
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
    this.fadeEl = document.createElement("div");
    this.fadeEl.style.cssText = "position:absolute;inset:0;opacity:0;background:#c7a15f;transition:background 0.4s;";
    this.flashEl = document.createElement("div");
    this.flashEl.style.cssText = "position:absolute;inset:0;opacity:0;background:#f0d48a;mix-blend-mode:screen;";
    this.ringEl = document.createElement("div");
    this.ringEl.style.cssText = "position:absolute;width:74px;height:74px;margin:-37px 0 0 -37px;display:none;z-index:5;";
    this.ringEl.innerHTML =
      '<svg width="74" height="74" viewBox="0 0 74 74"><circle cx="37" cy="37" r="30" fill="rgba(10,7,4,0.55)" stroke="rgba(216,178,94,0.4)" stroke-width="2"/><circle class="fg" cx="37" cy="37" r="30" fill="none" stroke="#f0d48a" stroke-width="4" stroke-linecap="round" stroke-dasharray="188.5" stroke-dashoffset="188.5" transform="rotate(-90 37 37)" style="filter:drop-shadow(0 0 6px rgba(240,212,138,0.8))"/></svg>';
    this.ringFg = this.ringEl.querySelector(".fg") as SVGCircleElement;
    this.ringLabel = document.createElement("div");
    this.ringLabel.style.cssText =
      "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'ZCOOL XiaoWei',serif;color:#f0d48a;font-size:15px;letter-spacing:0.2em;text-shadow:0 0 8px rgba(240,212,138,0.7);";
    this.ringEl.appendChild(this.ringLabel);
    const vig = document.createElement("div");
    vig.style.cssText =
      "position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(8,5,2,0.55) 100%);";
    layer.appendChild(this.fadeEl);
    layer.appendChild(this.flashEl);
    layer.appendChild(vig);
    layer.appendChild(this.ringEl);
    container.appendChild(layer);

    this.ro = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (w > 0 && h > 0) {
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
    });
    this.ro.observe(container);

    this.bindInput(this.renderer.domElement);
    this.buildRoom(0, 0);
    this.clock.start();
    const loop = () => {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.update(dt);
      this.render(dt);
    };
    loop();
  }

  /* ── 输入 ── */
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === "KeyW" || e.code === "ArrowUp") this.forwardHeld = true;
    if ((e.code === "Escape" || e.code === "KeyP") && (this.mode === "play" || this.mode === "paused")) {
      this.setPaused(this.mode === "play");
    }
    if (e.code === "KeyM") this.toggleMute();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === "KeyW" || e.code === "ArrowUp") this.forwardHeld = false;
  };
  private bindInput(el: HTMLCanvasElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    el.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.pointerDown = true;
      this.lastPX = e.clientX;
      this.lastPY = e.clientY;
      this.setNDC(e, el);
      el.style.cursor = "grabbing";
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      this.setNDC(e, el);
      if (this.dragging && (this.mode === "play" || this.mode === "attract")) {
        const dx = e.clientX - this.lastPX;
        const dy = e.clientY - this.lastPY;
        this.lastPX = e.clientX;
        this.lastPY = e.clientY;
        this.yaw -= dx * 0.0046;
        this.pitch = Math.max(-1.28, Math.min(1.28, this.pitch - dy * 0.0042));
      }
    });
    const up = () => {
      this.dragging = false;
      this.pointerDown = false;
      this.holdTarget = null;
      this.holdProg = 0;
      this.ringEl.style.display = "none";
      el.style.cursor = "grab";
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  private setNDC(e: PointerEvent, el: HTMLCanvasElement) {
    const r = el.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  setForwardHeld(v: boolean) {
    this.forwardHeld = v;
  }
  toggleMute() {
    this.sound.toggleMute();
    this.pushHud();
  }
  setPaused(p: boolean) {
    if (this.mode !== "play" && this.mode !== "paused") return;
    this.mode = p ? "paused" : "play";
    if (p) this.sound.stopAmbient();
    else this.sound.setAmbient(BIOMES[biomeIndex(this.room.x, this.room.z)].ambFreq);
    this.pushHud();
  }

  /* ── 生命周期 ── */
  start() {
    this.sound.ensure();
    this.room = { x: 0, z: 0 };
    this.yaw = 0;
    this.pitch = -0.04;
    this.collected.clear();
    this.loreFound = [];
    this.score = 0;
    this.roomsSeen = new Set(["0,0"]);
    this.elapsed = 0;
    this.log = [];
    this.shadow = { active: false, x: 8, z: 8, timer: 0, inRoom: false, lx: 2, lz: 2, speed: 0.75 };
    this.traversing = null;
    this.holdFwd = 0;
    this.winPending = false;
    this.holdTarget = null;
    this.holdProg = 0;
    this.ringEl.style.display = "none";
    this.shadowGroup.visible = false;
    this.camera.fov = 72;
    this.camera.updateProjectionMatrix();
    this.bursts.forEach((b) => {
      this.scene.remove(b.sp);
      b.sp.material.dispose();
    });
    this.bursts = [];
    this.mode = "play";
    this.buildRoom(0, 0);
    this.sound.setAmbient(BIOMES[0].ambFreq);
    this.addLog("你在琥珀回廊中央醒来，烛火无风自动。");
    this.addLog("寻找伊卡洛斯遗留的八件残页，别被黑影追上。");
    this.hooks.onToast("寻找伊卡洛斯的八件遗物", "gold");
    this.pushHud();
  }
  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.ro.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private addLog(s: string) {
    this.log.push(s);
    if (this.log.length > 4) this.log.shift();
  }

  /* ── 房间建造 ── */
  private box(parent: THREE.Object3D, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, ry = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(this.gBox, m);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    parent.add(mesh);
    return mesh;
  }
  private cyl(parent: THREE.Object3D, m: THREE.Material, r: number, h: number, x: number, y: number, z: number, seg?: THREE.CylinderGeometry): THREE.Mesh {
    const mesh = new THREE.Mesh(seg ?? this.gCyl, m);
    mesh.scale.set(r, h, r);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  private buildRoom(rx: number, rz: number) {
    while (this.roomGroup.children.length) this.roomGroup.remove(this.roomGroup.children[0]);
    this.tempGeos.forEach((g) => g.dispose());
    this.tempGeos = [];
    this.anim = { dust: null, steam: null, relic: null, waterMat: null, flames: [], fogColor: new THREE.Color(0xc7a15f), flicker: false, doorMeshes: [] };

    const b = biomeIndex(rx, rz);
    const B = BIOMES[b];
    const doors: DoorKind[] = [edgeDoor(rx, rz, 0), edgeDoor(rx, rz, 1), edgeDoor(rx, rz, 2), edgeDoor(rx, rz, 3)];
    this.curDoors = doors;
    this.roomGroup.position.set(rx * PITCH, 0, rz * PITCH);

    this.scene.fog = new THREE.FogExp2(B.fog, B.fogD);
    this.anim.fogColor.set(B.fog);
    this.scene.background = new THREE.Color(B.fog);
    this.fadeEl.style.background = "#" + this.anim.fogColor.getHexString();
    this.hemi.color.set(B.hemiSky);
    this.hemi.groundColor.set(B.hemiGnd);
    this.roomLight.color.set(B.lamp);
    this.roomLight.intensity = 26 * B.lampI;
    this.anim.flicker = b === 3 || b === 5 || b === 0;

    const g = this.roomGroup;
    /* 地面 5×5（5 格砖）与天花板 */
    const floor = new THREE.Mesh(this.gPlane, getMaterial("floor", b, { repeat: [5, 5] }));
    floor.rotation.x = -Math.PI / 2;
    floor.scale.set(ROOM, ROOM, 1);
    g.add(floor);
    const ceil = new THREE.Mesh(this.gPlane, getMaterial("ceil", b, { repeat: [5, 5], darken: 0.92 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.scale.set(ROOM, ROOM, 1);
    ceil.position.y = CEIL;
    g.add(ceil);

    /* 四面墙 + 门洞 + 门内无限通道 */
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      this.buildWall(g, b, d as Dir, doors[d as Dir]);
    }

    this.buildDecor(g, b, rx, rz, doors);
    this.buildRelic(g, rx, rz);
    this.buildDust(g, b);

    if (this.shadow.active && this.shadow.inRoom && this.shadow.x === rx && this.shadow.z === rz) {
      /* 重建后保持黑影（罕见：暂停恢复） */
    } else if (this.shadow.active) {
      this.shadow.inRoom = false;
    }
    this.shadowGroup.visible = false;
  }
  private curDoors: DoorKind[] = [0, 0, 0, 0];

  private buildWall(g: THREE.Group, b: number, dir: Dir, kind: DoorKind) {
    const v = DIRVEC[dir];
    const ang = Math.atan2(v.x, v.z); // 本地 +Z 指向该方向
    const grp = new THREE.Group();
    grp.rotation.y = ang;
    g.add(grp);
    const wallMat = getMaterial("wall", b, { repeat: [2, 2] });
    const wallMatDark = getMaterial("wall", b, { repeat: [3, 1], darken: 0.72 });
    const floorMatDark = getMaterial("floor", b, { repeat: [1, 9], darken: 0.8 });
    const ceilMatDark = getMaterial("ceil", b, { repeat: [1, 9], darken: 0.6 });
    const zc = ROOM / 2 + WALL_T / 2; // 2.7 本地 +Z 处墙中线
    const L = dir === 0 || dir === 2 ? ROOM + WALL_T * 2 : ROOM;

    if (kind === 0) {
      this.box(grp, wallMat, L, CEIL, WALL_T, 0, CEIL / 2, zc);
    } else {
      const doorW = DOORW[kind];
      const sideW = (L - doorW) / 2;
      if (sideW > 0.01) {
        this.box(grp, wallMat, sideW, CEIL, WALL_T, (doorW + sideW) / 2, CEIL / 2, zc);
        this.box(grp, wallMat, sideW, CEIL, WALL_T, -(doorW + sideW) / 2, CEIL / 2, zc);
      }
      this.box(grp, wallMat, doorW, CEIL - DOOR_H, WALL_T, 0, DOOR_H + (CEIL - DOOR_H) / 2, zc);

      /* 门框金饰 */
      const trim = colorMat(0x7a5f2e, 0.45, 0.5, 0x574522);
      this.box(grp, trim, 0.13, DOOR_H, WALL_T + 0.1, -doorW / 2, DOOR_H / 2, zc);
      this.box(grp, trim, 0.13, DOOR_H, WALL_T + 0.1, doorW / 2, DOOR_H / 2, zc);
      this.box(grp, trim, doorW + 0.26, 0.15, WALL_T + 0.1, 0, DOOR_H + 0.02, zc);

      /* 通道：无限延伸、没入迷雾 */
      const CL = 26;
      const cz = zc + CL / 2;
      const cf = new THREE.Mesh(this.gPlane, floorMatDark);
      cf.rotation.x = -Math.PI / 2;
      cf.scale.set(doorW, CL, 1);
      cf.position.set(0, 0.001, cz);
      grp.add(cf);
      const cc = new THREE.Mesh(this.gPlane, ceilMatDark);
      cc.rotation.x = Math.PI / 2;
      cc.scale.set(doorW, CL, 1);
      cc.position.set(0, DOOR_H, cz);
      grp.add(cc);
      this.box(grp, wallMatDark, 0.3, DOOR_H, CL, -(doorW / 2 + 0.15), DOOR_H / 2, cz);
      this.box(grp, wallMatDark, 0.3, DOOR_H, CL, doorW / 2 + 0.15, DOOR_H / 2, cz);
      /* 通道灯带 */
      const B = BIOMES[b];
      const stripMat = colorMat(B.lamp, 0.4, 1.4, B.lamp);
      for (const dd of [4.5, 10.5, 16.5]) {
        this.box(grp, stripMat, 0.4, 0.06, 0.9, 0, DOOR_H - 0.06, zc + dd);
      }
      /* 迷雾尽头屏障 */
      const cap = new THREE.Mesh(this.gPlane, new THREE.MeshBasicMaterial({ color: B.fog, fog: false }));
      cap.scale.set(doorW + 1.2, DOOR_H + 1.4, 1);
      cap.position.set(0, DOOR_H / 2, zc + CL);
      cap.rotation.y = Math.PI;
      grp.add(cap);

      /* 门命中面（长按穿越） */
      const hit = new THREE.Mesh(
        this.gPlane,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hit.scale.set(doorW, DOOR_H, 1);
      hit.position.set(0, DOOR_H / 2, zc);
      hit.rotation.y = Math.PI;
      hit.userData = { doorDir: dir };
      grp.add(hit);
      this.anim.doorMeshes.push(hit);
    }
  }

  /* ── 装饰 ── */
  private buildDecor(g: THREE.Group, b: number, rx: number, rz: number, doors: DoorKind[]) {
    const items = decorFor(rx, rz, b, doors);
    const woodDark = colorMat(0x4a3826, 0.9);
    const stone = colorMat(b === 2 ? 0x5f7355 : 0x8f8474, 0.95);
    for (const it of items) {
      const grp = new THREE.Group();
      grp.position.set(it.x, 0, it.z);
      grp.rotation.y = it.r;
      switch (it.t) {
        case "column": {
          const h = CEIL * it.s;
          const mat = colorMat(b === 4 ? 0x9fc4d4 : b === 2 ? 0x6a7f5a : 0xb8a67e, 0.9);
          this.cyl(grp, mat, 0.23, h, 0, h / 2, 0);
          this.box(grp, mat, 0.62, 0.18, 0.62, 0, 0.09, 0);
          if (it.s >= 1) this.box(grp, mat, 0.6, 0.16, 0.6, 0, CEIL - 0.08, 0);
          else {
            const rub = new THREE.Mesh(this.gDodeca, stone);
            rub.scale.setScalar(0.5);
            rub.position.set(0.1, h + 0.15, 0);
            grp.add(rub);
          }
          break;
        }
        case "shelf": {
          const frame = colorMat(b === 1 ? 0x3f4f45 : 0x4a3826, 0.85);
          this.box(grp, frame, 1.05, 2.5, 0.42, 0, 1.25, 0);
          const bookCols = [0x8a4a3a, 0x4a6a5a, 0x6a5a3a, 0x4a4a6a, 0x7a3a4a];
          for (let s = 0; s < 3; s++) {
            this.box(grp, woodDark, 0.95, 0.05, 0.36, 0, 0.55 + s * 0.72, 0.02);
            for (let k = 0; k < 3; k++) {
              const bk = new THREE.Mesh(this.gBox, colorMat(bookCols[(s * 3 + k) % 5], 0.9));
              bk.scale.set(0.24, 0.3 + ((s + k) % 3) * 0.05, 0.26);
              bk.position.set(-0.3 + k * 0.3, 0.73 + s * 0.72, 0.02);
              grp.add(bk);
            }
          }
          break;
        }
        case "table": {
          this.box(grp, woodDark, 1.1, 0.07, 0.62, 0, 0.78, 0);
          this.box(grp, woodDark, 0.09, 0.78, 0.55, -0.46, 0.39, 0);
          this.box(grp, woodDark, 0.09, 0.78, 0.55, 0.46, 0.39, 0);
          const paper = new THREE.Mesh(this.gBox, colorMat(0xd8cba8, 0.95));
          paper.scale.set(0.3, 0.03, 0.22);
          paper.position.set(-0.2, 0.83, 0.05);
          paper.rotation.y = 0.4;
          grp.add(paper);
          break;
        }
        case "rug": {
          const rug = new THREE.Mesh(this.gPlane, colorMat(0x6a2a22, 1));
          rug.rotation.x = -Math.PI / 2;
          rug.scale.set(2.5, 3.3, 1);
          rug.position.y = 0.012;
          grp.add(rug);
          const border = new THREE.Mesh(this.gPlane, colorMat(0x8a5a2a, 1));
          border.rotation.x = -Math.PI / 2;
          border.scale.set(2.2, 3.0, 1);
          border.position.y = 0.02;
          grp.add(border);
          break;
        }
        case "lamp": {
          const B = BIOMES[b];
          this.cyl(grp, colorMat(0x22201c, 0.7), 0.015, 0.85, 0, CEIL - 0.42, 0);
          const shade = new THREE.Mesh(this.gCone, colorMat(0x3a3226, 0.6, 0.15, 0x2a2012));
          shade.scale.set(0.42, 0.3, 0.42);
          shade.position.set(0, CEIL - 0.95, 0);
          grp.add(shade);
          const bulb = new THREE.Mesh(this.gSphere, colorMat(0xfff2d0, 0.3, 2.4, B.lamp));
          bulb.scale.setScalar(0.085);
          bulb.position.set(0, CEIL - 1.06, 0);
          grp.add(bulb);
          this.anim.flames.push(bulb);
          break;
        }
        case "plant": {
          this.cyl(grp, colorMat(0x6a4a32, 0.9), 0.17, 0.32, 0, 0.16, 0);
          for (let k = 0; k < 3; k++) {
            const leaf = new THREE.Mesh(this.gSphere, colorMat(0x4a6a3a, 0.9));
            leaf.scale.set(0.16, 0.3, 0.16);
            leaf.position.set(Math.cos(k * 2.1) * 0.1, 0.55 + k * 0.12, Math.sin(k * 2.1) * 0.1);
            grp.add(leaf);
          }
          break;
        }
        case "crate": {
          this.box(grp, woodDark, 0.62, 0.62, 0.62, 0, 0.31 * it.s, 0);
          this.box(grp, colorMat(0x2a2015, 0.9), 0.66, 0.08, 0.66, 0, 0.62 * it.s, 0);
          break;
        }
        case "trough": {
          this.box(grp, stone, 1.0, 0.5, 0.5, 0, 0.25, 0);
          const water = new THREE.Mesh(this.gPlane, colorMat(0x2a5f4a, 0.3, 0.6, 0x1a4a3a));
          water.rotation.x = -Math.PI / 2;
          water.scale.set(0.86, 0.38, 1);
          water.position.y = 0.46;
          grp.add(water);
          break;
        }
        case "pipes": {
          const metal = colorMat(0x6f6258, 0.5);
          const pipeGeoH = this.gCyl;
          for (const py of [3.35, 3.72]) {
            const p = new THREE.Mesh(pipeGeoH, metal);
            p.scale.set(0.11, ROOM, 0.11);
            p.rotation.z = Math.PI / 2;
            p.position.set(0, py, -2.32);
            grp.add(p);
          }
          this.cyl(grp, metal, 0.13, CEIL, 2.2, CEIL / 2, -2.3);
          const valve = new THREE.Mesh(this.gTorus, colorMat(0x8a3a2a, 0.5));
          valve.scale.setScalar(0.55);
          valve.position.set(0.8, 3.35, -2.18);
          grp.add(valve);
          break;
        }
        case "boiler": {
          const rust = colorMat(0x6e4434, 0.7);
          this.box(grp, rust, 0.95 * it.s, 1.5 * it.s, 0.75 * it.s, 0, 0.75 * it.s, 0);
          const glow = new THREE.Mesh(this.gPlane, colorMat(0xff8030, 0.4, 1.8, 0xff6020));
          glow.scale.set(0.4 * it.s, 0.26 * it.s, 1);
          glow.position.set(0, 0.5 * it.s, -0.39 * it.s);
          glow.rotation.y = Math.PI;
          grp.add(glow);
          this.anim.flames.push(glow);
          this.cyl(grp, colorMat(0x4a3a30, 0.6), 0.09, 1.2, 0.3 * it.s, 1.5 * it.s + 0.6, 0);
          break;
        }
        case "steam": {
          const n = 42;
          const pos = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 0.5;
            pos[i * 3 + 1] = Math.random() * 2.6;
            pos[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          this.tempGeos.push(geo);
          const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd8c8b8, size: 0.09, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
          grp.add(pts);
          this.anim.steam = pts;
          break;
        }
        case "rubble": {
          for (let k = 0; k < 3; k++) {
            const r = new THREE.Mesh(this.gDodeca, stone);
            r.scale.setScalar(0.28 + k * 0.14);
            r.position.set((k - 1) * 0.35, 0.25 + k * 0.1, (k % 2) * 0.25 - 0.1);
            r.rotation.set(k, k * 2, 0);
            grp.add(r);
          }
          break;
        }
        case "vine": {
          const len = 1.6 * it.s;
          const vine = colorMat(0x3f6f45, 0.9);
          this.cyl(grp, vine, 0.035, len, 0, CEIL - len / 2, 0);
          for (let k = 0; k < 3; k++) {
            const leaf = new THREE.Mesh(this.gSphere, colorMat(0x4f8f55, 0.9));
            leaf.scale.set(0.09, 0.14, 0.09);
            leaf.position.set(Math.cos(it.r + k * 2.4) * 0.08, CEIL - len * (0.3 + k * 0.28), Math.sin(it.r + k * 2.4) * 0.08);
            grp.add(leaf);
          }
          break;
        }
        case "pool": {
          const water = new THREE.Mesh(this.gPlane, new THREE.MeshStandardMaterial({ color: 0x2f8fbf, transparent: true, opacity: 0.5, roughness: 0.12, metalness: 0.2, emissive: 0x1a5f8f, emissiveIntensity: 0.55 }));
          water.rotation.x = -Math.PI / 2;
          water.scale.set(4.5, 4.5, 1);
          water.position.y = 0.03;
          grp.add(water);
          this.anim.waterMat = water.material as THREE.MeshStandardMaterial;
          for (let k = 0; k < 3; k++) {
            const pad = new THREE.Mesh(this.gCyl, colorMat(0x3f7f4f, 0.85));
            pad.scale.set(0.2 + k * 0.06, 0.025, 0.2 + k * 0.06);
            pad.position.set(-1.3 + k * 1.25, 0.05, -0.9 + k * 0.85);
            grp.add(pad);
          }
          break;
        }
        case "bench": {
          this.box(grp, colorMat(0x7a9fb0, 0.6), 1.3, 0.1, 0.42, 0, 0.46, 0);
          this.box(grp, colorMat(0x5a7a8a, 0.7), 0.1, 0.46, 0.38, -0.5, 0.23, 0);
          this.box(grp, colorMat(0x5a7a8a, 0.7), 0.1, 0.46, 0.38, 0.5, 0.23, 0);
          break;
        }
        case "pew": {
          this.box(grp, woodDark, 0.5, 0.5, 2.0, 0, 0.25, 0);
          this.box(grp, woodDark, 0.08, 1.05, 2.0, -0.24, 0.52, 0);
          break;
        }
        case "candle": {
          this.cyl(grp, colorMat(0x8a6f3a, 0.5), 0.045, 1.05, 0, 0.52, 0);
          this.cyl(grp, colorMat(0xd8cba8, 0.8), 0.038, 0.28, 0, 1.18, 0);
          const flame = new THREE.Mesh(this.gSphere, colorMat(0xffc060, 0.2, 2.6, 0xffa030));
          flame.scale.set(0.045, 0.075, 0.045);
          flame.position.set(0, 1.37, 0);
          grp.add(flame);
          this.anim.flames.push(flame);
          break;
        }
      }
      g.add(grp);
    }
  }

  /* ── 遗物 ── */
  private buildRelic(g: THREE.Group, rx: number, rz: number) {
    const slot = relicAt(rx, rz);
    if (!slot || this.collected.has(rx + "," + rz)) return;
    const grp = new THREE.Group();
    grp.position.set(slot.x, 1.15, slot.z);
    const gold = colorMat(0xf0d48a, 0.3, 1.2, 0xd8a23e);
    const ring = new THREE.Mesh(this.gTorus, gold);
    grp.add(ring);
    const core = new THREE.Mesh(this.gOcta, colorMat(0xfff0c0, 0.2, 2.2, 0xffcf6e));
    grp.add(core);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(this.gPlane, new THREE.MeshStandardMaterial({ color: 0xf0d48a, emissive: 0xd8a23e, emissiveIntensity: 0.9, side: THREE.DoubleSide, roughness: 0.4 }));
      wing.scale.set(0.52, 0.2, 1);
      wing.position.set(s * 0.42, 0.06, 0);
      wing.rotation.z = s * 0.5;
      grp.add(wing);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffe0a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(1.7);
    grp.add(glow);
    grp.userData = { relic: true };
    g.add(grp);
    this.anim.relic = grp;
    this.relicLight.position.set(rx * PITCH + slot.x, 1.6, rz * PITCH + slot.z);
    this.relicLight.intensity = 14;
  }

  /* ── 尘埃 ── */
  private buildDust(g: THREE.Group, b: number) {
    const B = BIOMES[b];
    const n = 110;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 4.2;
      pos[i * 3 + 1] = 0.25 + Math.random() * 3.9;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4.2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.tempGeos.push(geo);
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: B.dust, size: 0.035, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.add(pts);
    this.anim.dust = pts;
  }

  /* ── 黑影 ── */
  private buildShadowFigure() {
    const body = new THREE.Mesh(this.gCone, new THREE.MeshBasicMaterial({ color: 0x05040a }));
    body.scale.set(1, 2.15, 1);
    body.position.y = 1.07;
    this.shadowGroup.add(body);
    const head = new THREE.Mesh(this.gSphere, new THREE.MeshBasicMaterial({ color: 0x07060e }));
    head.scale.setScalar(0.23);
    head.position.y = 2.32;
    this.shadowGroup.add(head);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(this.gSphere, new THREE.MeshBasicMaterial({ color: 0xd8e2ff }));
      eye.scale.setScalar(0.035);
      eye.position.set(s * 0.085, 2.36, 0.19);
      this.shadowGroup.add(eye);
    }
    const n = 34;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.4;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 2.2;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const smoke = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x3a2a5a, size: 0.12, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.shadowGroup.add(smoke);
    this.shadowGroup.visible = false;
    this.scene.add(this.shadowGroup);
  }

  /* ── 穿越 ── */
  private startTraverse(dir: Dir) {
    if (this.traversing || this.mode !== "play") return;
    const v = DIRVEC[dir];
    const from = new THREE.Vector3(this.room.x * PITCH, CAM_H, this.room.z * PITCH);
    const to = new THREE.Vector3((this.room.x + v.x) * PITCH, CAM_H, (this.room.z + v.z) * PITCH);
    this.traversing = { dir, t: 0, dur: 1.35, from, to, swapped: false };
    this.holdFwd = 0;
    this.holdTarget = null;
    this.holdProg = 0;
    this.ringEl.style.display = "none";
    this.sound.whoosh();
    this.shake = Math.max(this.shake, 0.25);
  }

  private arrive(nx: number, nz: number) {
    const key = nx + "," + nz;
    const isNew = !this.roomsSeen.has(key);
    this.roomsSeen.add(key);
    if (isNew) this.score += 10;
    const oldB = biomeIndex(this.room.x, this.room.z);
    this.room = { x: nx, z: nz };
    this.buildRoom(nx, nz);
    const nb = biomeIndex(nx, nz);
    if (nb !== oldB) {
      this.sound.setAmbient(BIOMES[nb].ambFreq);
      this.addLog(`进入「${BIOMES[nb].name}」——${BIOMES[nb].motif}。`);
    }
    this.sound.step();
    /* 黑影：若玩家从它所在房间离开 → 甩开 */
    if (this.shadow.inRoom) {
      this.shadow.inRoom = false;
      const a = Math.random() * Math.PI * 2;
      const d = 4 + Math.floor(Math.random() * 3);
      this.shadow.x = nx + Math.round(Math.cos(a) * d);
      this.shadow.z = nz + Math.round(Math.sin(a) * d);
      this.shadow.speed = 0.75;
      this.shadowGroup.visible = false;
      this.addLog("你加快脚步，把低语甩在了身后。");
    }
  }

  /* ── 更新循环 ── */
  private update(dt: number) {
    this.t += dt;
    if (this.mode === "paused" || this.mode === "over" || this.mode === "won") return;
    if (this.mode === "attract") {
      this.yaw += dt * 0.14;
      this.pitch = -0.06 + Math.sin(this.t * 0.25) * 0.05;
    }

    /* 转向输入 */
    if (this.mode === "play") {
      const rot = 2.3 * dt;
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft") || this.keys.has("KeyQ")) this.yaw += rot;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight") || this.keys.has("KeyE")) this.yaw -= rot;
    }

    /* 前进长按（需对准基准方位且前方有门） */
    this.blockedCd = Math.max(0, this.blockedCd - dt);
    if (this.mode === "play" && !this.traversing) {
      const aligned = this.alignedDir();
      if (this.forwardHeld && aligned >= 0) {
        const kind = this.curDoors[aligned];
        if (kind > 0) {
          this.holdFwd = Math.min(1, this.holdFwd + dt);
          if (this.holdFwd >= 1) {
            this.yaw = this.snapYaw(aligned);
            this.startTraverse(aligned as Dir);
          }
        } else if (this.blockedCd <= 0) {
          this.blockedCd = 0.9;
          this.sound.thud();
          this.shake = Math.max(this.shake, 0.3);
          this.hooks.onToast(`${DIRNAME[aligned]}侧没有门`, "danger");
        }
      } else {
        this.holdFwd = Math.max(0, this.holdFwd - dt * 2.5);
      }
      this.updatePointerHold(dt);
    }

    /* 穿越动画 */
    if (this.traversing) {
      const tr = this.traversing;
      tr.t += dt / tr.dur;
      if (tr.t >= 0.5 && !tr.swapped) {
        tr.swapped = true;
        const v = DIRVEC[tr.dir];
        this.arrive(this.room.x + v.x, this.room.z + v.z);
      }
      if (tr.t >= 1) {
        this.traversing = null;
        this.camera.fov = 72;
        this.camera.updateProjectionMatrix();
      }
    }

    /* 遗物动画 */
    if (this.anim.relic) {
      this.anim.relic.rotation.y += dt * 1.4;
      this.anim.relic.position.y = 1.15 + Math.sin(this.t * 1.8) * 0.09;
    }
    if (this.anim.dust) {
      this.anim.dust.rotation.y += dt * 0.045;
      this.anim.dust.position.y = Math.sin(this.t * 0.3) * 0.08;
    }
    if (this.anim.steam) {
      const attr = this.anim.steam.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < attr.count; i++) {
        let y = attr.getY(i) + dt * 0.5;
        if (y > 2.6) y = 0;
        attr.setY(i, y);
      }
      attr.needsUpdate = true;
    }
    if (this.anim.waterMat) {
      this.anim.waterMat.emissiveIntensity = 0.45 + Math.sin(this.t * 1.7) * 0.2;
      this.anim.waterMat.opacity = 0.46 + Math.sin(this.t * 1.1) * 0.06;
    }
    if (this.anim.flicker) {
      this.flick += (Math.random() - this.flick) * Math.min(1, dt * 7);
      this.roomLight.intensity = 26 * BIOMES[biomeIndex(this.room.x, this.room.z)].lampI * (0.75 + this.flick * 0.35);
      for (const f of this.anim.flames) {
        const m = f.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = 1.6 + this.flick * 1.4;
      }
    }

    /* 爆发粒子 */
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const bs = this.bursts[i];
      bs.life -= dt;
      bs.sp.position.addScaledVector(bs.v, dt);
      bs.v.multiplyScalar(1 - dt * 2.2);
      (bs.sp.material as THREE.SpriteMaterial).opacity = Math.max(0, bs.life / 0.8);
      if (bs.life <= 0) {
        bs.sp.material.dispose();
        this.scene.remove(bs.sp);
        this.bursts.splice(i, 1);
      }
    }

    if (this.mode === "play") {
      this.elapsed += dt;
      this.updateShadow(dt);
    }

    /* HUD 节流 */
    this.hudTimer += dt;
    if (this.hudTimer > 0.12) {
      this.hudTimer = 0;
      this.pushHud();
    }
  }

  /* 指针对门/遗物的长按 */
  private updatePointerHold(dt: number) {
    if (!this.pointerDown || this.traversing) return;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const targets: THREE.Object3D[] = [...this.anim.doorMeshes];
    if (this.anim.relic) targets.push(this.anim.relic);
    const hits = this.raycaster.intersectObjects(targets, true);
    let found: { type: "door" | "relic"; dir?: Dir; obj: THREE.Object3D } | null = null;
    if (hits.length > 0) {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && o.userData.doorDir === undefined && !o.userData.relic) o = o.parent;
      if (o) {
        if (o.userData.relic) found = { type: "relic", obj: o };
        else if (o.userData.doorDir !== undefined) found = { type: "door", dir: o.userData.doorDir as Dir, obj: o };
      }
    }
    if (!found) {
      this.holdTarget = null;
      this.holdProg = 0;
      this.ringEl.style.display = "none";
      return;
    }
    if (!this.holdTarget || this.holdTarget.type !== found.type || (found.dir !== undefined && this.holdTarget.dir !== found.dir)) {
      this.holdTarget = { type: found.type, dir: found.dir };
      this.holdProg = 0;
    }
    const need = found.type === "door" ? 1.0 : 0.7;
    this.holdProg = Math.min(1, this.holdProg + dt / need);

    /* 圆环投影定位 */
    const wp = new THREE.Vector3();
    if (found.type === "relic" && this.anim.relic) this.anim.relic.getWorldPosition(wp);
    else if (found.dir !== undefined) {
      const v = DIRVEC[found.dir];
      wp.set(this.room.x * PITCH + v.x * 2.7, 2, this.room.z * PITCH + v.z * 2.7);
    }
    wp.project(this.camera);
    const cw = this.renderer.domElement.clientWidth;
    const ch = this.renderer.domElement.clientHeight;
    const sx = (wp.x * 0.5 + 0.5) * cw;
    const sy = (-wp.y * 0.5 + 0.5) * ch;
    if (wp.z < 1) {
      this.ringEl.style.display = "block";
      this.ringEl.style.left = sx + "px";
      this.ringEl.style.top = sy + "px";
      this.ringFg.style.strokeDashoffset = String(188.5 * (1 - this.holdProg));
      this.ringLabel.textContent = found.type === "door" ? "门" : "拾";
    } else {
      this.ringEl.style.display = "none";
    }

    if (this.holdProg >= 1) {
      if (found.type === "door" && found.dir !== undefined) {
        this.yaw = this.snapYaw(found.dir);
        this.startTraverse(found.dir);
      } else {
        this.collectRelic();
      }
      this.holdTarget = null;
      this.holdProg = 0;
      this.ringEl.style.display = "none";
    }
  }

  private collectRelic() {
    if (!this.anim.relic) return;
    const wp = new THREE.Vector3();
    this.anim.relic.getWorldPosition(wp);
    this.roomGroup.remove(this.anim.relic);
    this.anim.relic = null;
    this.relicLight.intensity = 0;
    this.collected.add(this.room.x + "," + this.room.z);
    const idx = this.loreFound.length;
    this.loreFound.push(LORE[idx % LORE.length]);
    this.score += 150;
    this.sound.chime(idx);
    this.flash(0.5, "#ffe9b0");
    this.shake = Math.max(this.shake, 0.22);
    this.hooks.onToast(`遗物 ${this.loreFound.length}/8 ·「${LORE[idx % LORE.length]}」`, "gold");
    this.addLog(`拾得残页 ${this.loreFound.length}/8。`);
    /* 金粒子爆发 */
    for (let i = 0; i < 16; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffe0a0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.scale.setScalar(0.22 + Math.random() * 0.2);
      sp.position.copy(wp);
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3);
      this.scene.add(sp);
      this.bursts.push({ sp, v, life: 0.8 });
    }
    if (!this.shadow.active && this.loreFound.length === 1) {
      this.shadow.active = true;
      const a = Math.random() * Math.PI * 2;
      this.shadow.x = this.room.x + Math.round(Math.cos(a) * 7);
      this.shadow.z = this.room.z + Math.round(Math.sin(a) * 7);
      this.sound.awaken();
      this.hooks.onToast("有什么东西，在迷宫深处睁开了眼……", "danger");
      this.addLog("空气冷了下来。别停下。");
    }
    if (this.loreFound.length >= RELIC_TOTAL && !this.winPending) {
      this.winPending = true;
      this.shadow.active = false;
      this.shadowGroup.visible = false;
      this.sound.win();
      this.flash(0.85, "#fff2cc");
      this.hooks.onToast("八页残纸在无风中燃起——真相浮现。", "gold");
      window.setTimeout(() => {
        if (this.destroyed || !this.winPending || this.mode !== "play") return;
        this.mode = "won";
        this.sound.stopAmbient();
        this.hooks.onEnd("won", this.stats());
      }, 1800);
    }
  }

  /* ── 黑影 AI ── */
  private updateShadow(dt: number) {
    const s = this.shadow;
    if (!s.active) return;
    const dx = this.room.x - s.x;
    const dz = this.room.z - s.z;
    const dist = Math.abs(dx) + Math.abs(dz);

    if (!s.inRoom) {
      s.timer += dt;
      const interval = this.loreFound.length >= 6 ? 4.2 : this.loreFound.length >= 3 ? 5.4 : 6.6;
      if (s.timer >= interval) {
        s.timer = 0;
        if (Math.abs(dx) >= Math.abs(dz)) s.x += Math.sign(dx) || 1;
        else s.z += Math.sign(dz) || 1;
        if (s.x === this.room.x && s.z === this.room.z) {
          s.inRoom = true;
          s.speed = 0.72;
          const c = Math.floor(Math.random() * 4);
          s.lx = c % 2 === 0 ? 2.05 : -2.05;
          s.lz = c < 2 ? 2.05 : -2.05;
          this.sound.whisper();
          this.hooks.onToast("它进来了——快走！", "danger");
          this.addLog("黑影从门缝里渗了进来。");
          this.flash(0.5, "#3a1020");
          this.shake = Math.max(this.shake, 0.5);
        }
      }
    } else {
      /* 同房间：逼近 */
      s.speed = Math.min(2.1, s.speed + dt * 0.16);
      const len = Math.hypot(s.lx, s.lz) || 1;
      s.lx -= (s.lx / len) * s.speed * dt;
      s.lz -= (s.lz / len) * s.speed * dt;
      const ox = this.room.x * PITCH;
      const oz = this.room.z * PITCH;
      this.shadowGroup.visible = true;
      this.shadowGroup.position.set(ox + s.lx, Math.sin(this.t * 2.2) * 0.06, oz + s.lz);
      this.shadowGroup.rotation.y += dt * 0.8;
      if (len - s.speed * dt <= 0.95) {
        this.caught();
        return;
      }
      this.shake = Math.max(this.shake, Math.min(0.35, (1.6 - len) * 0.25));
    }

    /* 心跳与低语 */
    if (dist <= 4 || s.inRoom) {
      this.hbTimer += dt;
      const iv = s.inRoom ? 0.5 : dist <= 1 ? 0.85 : dist === 2 ? 1.25 : dist <= 4 ? 2.3 : 3.5;
      if (this.hbTimer >= iv) {
        this.hbTimer = 0;
        this.sound.heartbeat(1 - Math.min(dist, 6) / 7);
      }
      this.whisperTimer -= dt;
      if (this.whisperTimer <= 0 && dist <= 2) {
        this.whisperTimer = 3 + Math.random() * 4;
        this.sound.whisper();
      }
    }
  }

  private caught() {
    if (this.mode !== "play") return;
    this.mode = "over";
    this.shadowGroup.visible = false;
    this.sound.sting();
    this.sound.stopAmbient();
    this.flash(1, "#5a0a14");
    this.shake = 1.2;
    window.setTimeout(() => {
      if (this.destroyed || this.mode !== "over") return;
      this.hooks.onEnd("caught", this.stats());
    }, 1100);
  }

  private stats(): EndStats {
    return { score: this.score, rooms: this.roomsSeen.size, relics: this.loreFound.length, time: this.elapsed, loreFound: [...this.loreFound] };
  }

  /* ── 工具 ── */
  private alignedDir(): number {
    const deg = this.yawDeg();
    const nearest = ((Math.round(deg / 90) % 4) + 4) % 4;
    let d = Math.abs(deg - nearest * 90);
    if (d > 180) d = 360 - d;
    return d <= 22.5 ? nearest : -1;
  }
  private yawDeg() {
    return (((-this.yaw * 180) / Math.PI) % 360 + 360) % 360;
  }
  private snapYaw(dir: number) {
    const target = (-dir * 90 * Math.PI) / 180;
    let cur = this.yaw % (Math.PI * 2);
    let diff = target - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return cur + diff;
  }
  private flash(a: number, color: string) {
    this.flashEl.style.background = color;
    this.flashEl.style.transition = "none";
    this.flashEl.style.opacity = String(a);
    requestAnimationFrame(() => {
      this.flashEl.style.transition = "opacity 0.7s ease-out";
      this.flashEl.style.opacity = "0";
    });
  }

  private pushHud() {
    const aligned = this.alignedDir();
    this.hooks.onHud({
      mode: this.mode,
      score: this.score,
      rooms: this.roomsSeen.size,
      relics: this.loreFound.length,
      relicsTotal: RELIC_TOTAL,
      biome: BIOMES[biomeIndex(this.room.x, this.room.z)].name,
      motif: BIOMES[biomeIndex(this.room.x, this.room.z)].motif,
      coords: `(${this.room.x}, ${this.room.z})`,
      yawDeg: this.yawDeg(),
      alignedDir: aligned,
      forwardDoor: aligned >= 0 ? this.curDoors[aligned] : 0,
      hold: this.holdFwd,
      doors: [...this.curDoors],
      shadowDist: !this.shadow.active ? -1 : this.shadow.inRoom ? 0 : Math.abs(this.room.x - this.shadow.x) + Math.abs(this.room.z - this.shadow.z),
      shadowSame: this.shadow.inRoom,
      time: this.elapsed,
      muted: this.sound.muted,
      log: [...this.log],
    });
  }

  /* ── 渲染 ── */
  private render(dt: number) {
    /* 相机 */
    let cx: number, cz: number, cy = CAM_H + Math.sin(this.t * 1.25) * 0.014;
    if (this.traversing) {
      const tr = this.traversing;
      const e = easeInOut(Math.min(1, tr.t));
      cx = tr.from.x + (tr.to.x - tr.from.x) * e;
      cz = tr.from.z + (tr.to.z - tr.from.z) * e;
      cy += Math.sin(e * Math.PI * 3) * 0.045 * (1 - Math.abs(e - 0.5) * 2);
      this.camera.fov = 72 + Math.sin(e * Math.PI) * 7;
      this.camera.updateProjectionMatrix();
      this.fadeEl.style.opacity = String(Math.sin(Math.min(1, tr.t) * Math.PI) * 0.82);
      const dx = tr.to.x - tr.from.x;
      const dz = tr.to.z - tr.from.z;
      const midYaw = Math.atan2(-dx, -dz);
      this.yaw = this.normAngle(this.yaw, midYaw);
    } else {
      cx = this.room.x * PITCH;
      cz = this.room.z * PITCH;
      this.fadeEl.style.opacity = "0";
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake;
    this.camera.position.set(
      cx + (Math.random() - 0.5) * sh * 0.16,
      cy + (Math.random() - 0.5) * sh * 0.12,
      cz + (Math.random() - 0.5) * sh * 0.16
    );
    this.camera.rotation.set(this.pitch, this.yaw, (Math.random() - 0.5) * sh * 0.03, "YXZ");
    this.renderer.render(this.scene, this.camera);
  }
  private normAngle(cur: number, target: number) {
    let diff = target - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return cur + diff;
  }
}

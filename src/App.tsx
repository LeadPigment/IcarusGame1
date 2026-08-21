import { useEffect, useRef, useState, useCallback } from "react";
import { Engine, type HudData, type EndStats } from "./game/engine";

const DEF_HUD: HudData = {
  mode: "attract", score: 0, rooms: 1, relics: 0, relicsTotal: 8,
  biome: "琥珀回廊", motif: "墙纸剥落的无尽厅堂", coords: "(0, 0)",
  yawDeg: 0, alignedDir: -1, forwardDoor: 0, hold: 0,
  doors: [0, 0, 0, 0], shadowDist: -1, shadowSame: false,
  time: 0, muted: false, log: [],
};

type Screen = "start" | "play" | "paused" | "over" | "won";
interface Toast { id: number; text: string; tone: "gold" | "danger" | "info" }

const SECTORS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ── 羽毛图标 ── */
function Feather({ lit }: { lit: boolean }) {
  return (
    <svg width="17" height="22" viewBox="0 0 24 30" className="inline-block">
      <path
        d="M13 2 C7 7 4 14 5.5 24 L8 21 C7 14 10 8 15 5 C13 10 12 16 12.5 21 L14.5 18 C14.5 12 16 8 19 5.5 C17.5 4 15.5 2.6 13 2 Z"
        fill={lit ? "#f0d48a" : "none"}
        stroke={lit ? "#f0d48a" : "#6b5326"}
        strokeWidth="1.4"
        style={lit ? { filter: "drop-shadow(0 0 4px rgba(240,212,138,0.9))" } : undefined}
      />
      <line x1="6.5" y1="23" x2="9" y2="28" stroke={lit ? "#f0d48a" : "#6b5326"} strokeWidth="1.4" />
    </svg>
  );
}

/* ── 罗盘 ── */
function Compass({ hud }: { hud: HudData }) {
  const marks = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * 45 * Math.PI) / 180;
    const cardinal = i % 2 === 0;
    const r1 = cardinal ? 34 : 38;
    marks.push(
      <line
        key={i}
        x1={48 + Math.sin(a) * r1}
        y1={48 - Math.cos(a) * r1}
        x2={48 + Math.sin(a) * 43}
        y2={48 - Math.cos(a) * 43}
        stroke={cardinal ? "#d8b25e" : "#6b5326"}
        strokeWidth={cardinal ? 2.4 : 1.2}
      />
    );
  }
  const doorDots = [];
  for (let i = 0; i < 4; i++) {
    if (hud.doors[i] > 0) {
      const a = (i * 90 * Math.PI) / 180;
      doorDots.push(
        <circle
          key={i}
          cx={48 + Math.sin(a) * 27}
          cy={48 - Math.cos(a) * 27}
          r={hud.doors[i] === 2 ? 3.4 : 2.2}
          fill={hud.doors[i] === 2 ? "#f0d48a" : "#9a8a6a"}
          opacity="0.9"
        />
      );
    }
  }
  return (
    <svg width="96" height="96" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r="45" fill="rgba(16,11,6,0.72)" stroke="#6b5326" strokeWidth="1.5" />
      {marks}
      {doorDots}
      <text x="48" y="16" textAnchor="middle" fill="#f0d48a" fontSize="10" fontFamily="'ZCOOL XiaoWei',serif">北</text>
      <text x="82" y="52" textAnchor="middle" fill="#8a6f3a" fontSize="10" fontFamily="'ZCOOL XiaoWei',serif">东</text>
      <text x="48" y="88" textAnchor="middle" fill="#8a6f3a" fontSize="10" fontFamily="'ZCOOL XiaoWei',serif">南</text>
      <text x="14" y="52" textAnchor="middle" fill="#8a6f3a" fontSize="10" fontFamily="'ZCOOL XiaoWei',serif">西</text>
      <g className="compass-needle" style={{ transform: `rotate(${hud.yawDeg}deg)`, transformOrigin: "48px 48px" }}>
        <path d="M48 26 L52 48 L48 56 L44 48 Z" fill="#f0d48a" />
        <path d="M48 70 L51 52 L48 48 L45 52 Z" fill="#8a3a2a" />
      </g>
      <circle cx="48" cy="48" r="3" fill="#efe3c4" />
    </svg>
  );
}

/* ── 主应用 ── */
export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [hud, setHud] = useState<HudData>(DEF_HUD);
  const [screen, setScreen] = useState<Screen>("start");
  const [stats, setStats] = useState<EndStats | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    if (!mountRef.current) return;
    const eng = new Engine(mountRef.current, {
      onHud: setHud,
      onToast: (text, tone) => {
        const id = ++toastId.current;
        setToasts((ts) => [...ts.slice(-2), { id, text, tone }]);
        window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4200);
      },
      onEnd: (kind, s) => {
        setStats(s);
        setScreen(kind === "caught" ? "over" : "won");
      },
    });
    engineRef.current = eng;
    return () => eng.destroy();
  }, []);

  useEffect(() => {
    if (hud.mode === "paused") setScreen("paused");
    else if (hud.mode === "play") setScreen((s) => (s === "paused" ? "play" : s));
  }, [hud.mode]);

  const begin = useCallback(() => {
    engineRef.current?.start();
    setScreen("play");
  }, []);
  const resume = useCallback(() => engineRef.current?.setPaused(false), []);
  const isTouch = typeof window !== "undefined" && "ontouchstart" in window;

  const aligned = hud.alignedDir >= 0;
  const sector = ((Math.round(hud.yawDeg / 45) % 8) + 8) % 8;
  const inGame = screen === "play" || screen === "paused";

  return (
    <div className="relative w-full h-full no-select" style={{ fontFamily: "var(--font-body)" }}>
      {/* 3D 画布 */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* ── 游戏内 HUD ── */}
      {inGame && (
        <>
          {/* 顶部左：分数与遗物 */}
          <div className="absolute top-3 left-3 panel px-4 py-2.5 rise-in">
            <div className="hud-label">灵焰分</div>
            <div className="font-display text-2xl leading-tight" style={{ color: "#f0d48a" }}>
              {hud.score}
            </div>
            <div className="mt-1 flex gap-1 items-end">
              {Array.from({ length: hud.relicsTotal }).map((_, i) => (
                <Feather key={i} lit={i < hud.relics} />
              ))}
            </div>
            <div className="hud-label mt-1">
              遗物 {hud.relics}/{hud.relicsTotal} · 房间 {hud.rooms}
            </div>
          </div>

          {/* 顶部中：群系 */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 panel-soft px-5 py-2 text-center rise-in">
            <div className="font-display text-xl tracking-[0.3em]" style={{ color: "#efe3c4" }}>
              {hud.biome}
            </div>
            <div className="text-[11px]" style={{ color: "#8a6f3a" }}>
              {hud.motif} · 房间 {hud.coords}
            </div>
          </div>

          {/* 顶部右：罗盘 + 时间 + 低语 */}
          <div className="absolute top-3 right-3 flex flex-col items-end gap-2 rise-in">
            <div className="flex items-center gap-3">
              <div className="panel-soft px-3 py-1.5 text-right">
                <div className="hud-label">时间</div>
                <div className="font-display text-lg" style={{ color: "#efe3c4" }}>{fmtTime(hud.time)}</div>
                {hud.shadowDist >= 0 && (
                  <>
                    <div className="hud-label mt-1" style={{ color: hud.shadowSame ? "#e2543a" : undefined }}>
                      {hud.shadowSame ? "它在房里" : "低语距离"}
                    </div>
                    <div className={`flex gap-0.5 justify-end ${hud.shadowSame ? "blink-danger" : ""}`}>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <span
                          key={i}
                          className="inline-block w-2 h-3"
                          style={{
                            background:
                              i < 6 - Math.min(hud.shadowDist, 6)
                                ? hud.shadowDist <= 1 || hud.shadowSame
                                  ? "#e2543a"
                                  : "#c98a3a"
                                : "#2a2015",
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
              <Compass hud={hud} />
            </div>
            <button
              className="btn-ghost px-3 py-1 text-xs"
              onClick={() => engineRef.current?.toggleMute()}
            >
              {hud.muted ? "已静音 · M" : "音效开 · M"}
            </button>
          </div>

          {/* 底部中：八方位区间 + 长按进度 */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5">
            <div
              className="text-sm px-4 py-1 panel-soft"
              style={{ color: aligned ? (hud.forwardDoor > 0 ? "#f0d48a" : "#e2543a") : "#8a7a5a" }}
            >
              {aligned
                ? hud.forwardDoor === 2
                  ? "前方 · 无墙大门 —— 长按 W 穿越"
                  : hud.forwardDoor === 1
                    ? "前方 · 普通门 —— 长按 W 穿越"
                    : "此墙无门，另寻他路"
                : "转向最近的方位（±22.5°）再长按 W"}
            </div>
            <div className="w-[340px] h-1.5 overflow-hidden" style={{ background: "rgba(20,14,8,0.8)", border: "1px solid #4a3a1e" }}>
              <div
                className="h-full"
                style={{
                  width: `${hud.hold * 100}%`,
                  background: "linear-gradient(90deg, #8a6f3a, #f0d48a)",
                  boxShadow: "0 0 10px rgba(240,212,138,0.8)",
                  transition: "width 0.08s linear",
                }}
              />
            </div>
            <div className="flex gap-1">
              {SECTORS.map((s, i) => {
                const cardinal = i % 2 === 0;
                const active = sector === i;
                const alignedHere = cardinal && aligned && hud.alignedDir === i / 2;
                return (
                  <div
                    key={s}
                    className="px-2 py-0.5 text-[11px] leading-none"
                    style={{
                      fontFamily: "var(--font-display)",
                      color: alignedHere ? "#17100a" : active ? "#f0d48a" : cardinal ? "#8a6f3a" : "#4a3a22",
                      background: alignedHere ? "#f0d48a" : active ? "rgba(216,178,94,0.16)" : "rgba(16,11,6,0.55)",
                      border: "1px solid " + (cardinal ? "#6b5326" : "#3a2c16"),
                      textShadow: alignedHere ? "none" : undefined,
                      transition: "all 0.12s",
                    }}
                  >
                    {s}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 底部左：日志 */}
          <div className="absolute bottom-4 left-3 w-[300px] space-y-1 pointer-events-none">
            {hud.log.map((l, i) => (
              <div
                key={hud.log.length + "-" + i}
                className="text-xs px-2.5 py-1.5 panel-soft"
                style={{ color: "#cbbd98", opacity: 0.45 + (i / Math.max(1, hud.log.length - 1)) * 0.55 }}
              >
                {l}
              </div>
            ))}
          </div>

          {/* 底部右：操作提示 / 触屏前进键 */}
          <div className="absolute bottom-4 right-3 flex flex-col items-end gap-2">
            {isTouch ? (
              <button
                className="btn-gold px-8 py-5 text-xl"
                onPointerDown={(e) => {
                  e.preventDefault();
                  engineRef.current?.setForwardHeld(true);
                }}
                onPointerUp={() => engineRef.current?.setForwardHeld(false)}
                onPointerLeave={() => engineRef.current?.setForwardHeld(false)}
                onPointerCancel={() => engineRef.current?.setForwardHeld(false)}
              >
                前行
              </button>
            ) : (
              <div className="panel-soft px-3 py-2 text-[11px] leading-relaxed" style={{ color: "#8a7a5a" }}>
                拖动 / Q·E — 转身 · 长按 W — 穿门
                <br />
                长按门或遗物 — 穿越 / 拾取 · Esc — 暂停
              </div>
            )}
          </div>

          {/* 中央准星 */}
          <div
            className="absolute left-1/2 top-1/2 w-1.5 h-1.5 -ml-[3px] -mt-[3px] rounded-full pointer-events-none"
            style={{ background: "rgba(240,212,138,0.85)", boxShadow: "0 0 6px rgba(240,212,138,0.7)" }}
          />

          {/* 低语红晕 */}
          {(hud.shadowSame || hud.shadowDist === 1) && screen === "play" && (
            <div
              className="absolute inset-0 pointer-events-none blink-danger"
              style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(120,10,20,0.35) 100%)" }}
            />
          )}
        </>
      )}

      {/* ── 提示浮层 ── */}
      <div className="absolute top-[18%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none z-20">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-lore px-5 py-2 text-sm panel"
            style={{
              color: t.tone === "gold" ? "#f0d48a" : t.tone === "danger" ? "#e2543a" : "#efe3c4",
              fontFamily: "var(--font-display)",
              letterSpacing: "0.12em",
            }}
          >
            {t.text}
          </div>
        ))}
      </div>

      {/* ── 开始界面 ── */}
      {screen === "start" && (
        <div className="absolute inset-0 z-30 screen-in" style={{ background: "radial-gradient(ellipse at 50% 30%, rgba(20,14,8,0.55), rgba(10,7,4,0.92) 75%)" }}>
          {/* 飘落的羽毛 */}
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="feather-fall absolute"
              style={{
                left: `${8 + i * 13}%`,
                animationDuration: `${9 + (i % 3) * 4}s`,
                animationDelay: `${i * 1.7}s`,
                opacity: 0,
              }}
            >
              <Feather lit />
            </div>
          ))}
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="w-full max-w-[980px] grid md:grid-cols-[1.2fr_1fr] gap-8 items-center">
              <div>
                <div className="hud-label mb-3" style={{ color: "#8a6f3a" }}>迷宫档案 · 第〇六版 · 三维重制</div>
                <h1
                  className="font-display title-glow leading-[1.05]"
                  style={{ fontSize: "clamp(44px, 7vw, 84px)", color: "#f0d48a", letterSpacing: "0.06em" }}
                >
                  伊卡洛斯
                  <br />
                  消失之谜
                </h1>
                <p className="mt-5 max-w-[430px] text-sm leading-relaxed" style={{ color: "#cbbd98" }}>
                  那年正午，少年带着蜡与羽制成的双翼飞向太阳，此后无人再见过他——
                  只有一座不断增殖的迷宫，和深处一对熔化的金翼。
                  穿过一间接一间的房，拾起他散落的八页残章，
                  弄清那个坠落的真相。只是小心：
                  <span style={{ color: "#e2543a" }}>他的影子，也在找你。</span>
                </p>
                <button className="btn-gold mt-7 px-10 py-3.5 text-xl pulse-gold" onClick={begin}>
                  踏入回廊
                </button>
                <div className="mt-3 text-[11px]" style={{ color: "#6b5326" }}>
                  v0.6.0 · 建议佩戴耳机 · 支持键盘与触屏
                </div>
              </div>
              <div className="panel px-6 py-5">
                <div className="font-display text-lg mb-3" style={{ color: "#f0d48a", letterSpacing: "0.2em" }}>行动手册</div>
                <ul className="space-y-2.5 text-[13px]" style={{ color: "#cbbd98" }}>
                  <li className="flex gap-2.5"><span style={{ color: "#f0d48a" }}>◈</span>拖动鼠标自由环视这间 5×5 的房</li>
                  <li className="flex gap-2.5"><span style={{ color: "#f0d48a" }}>◈</span>视野落在北 / 东 / 南 / 西 ±22.5° 内，<b style={{ color: "#efe3c4" }}>长按 W 一秒</b>穿过前方的门</li>
                  <li className="flex gap-2.5"><span style={{ color: "#f0d48a" }}>◈</span><b style={{ color: "#efe3c4" }}>长按任意门</b>一秒，直接穿到对面房间</li>
                  <li className="flex gap-2.5"><span style={{ color: "#f0d48a" }}>◈</span>3 格宽是普通门，整面墙洞开的是<b style={{ color: "#efe3c4" }}>无墙大门</b>；通道尽头只有雾</li>
                  <li className="flex gap-2.5"><span style={{ color: "#f0d48a" }}>◈</span><b style={{ color: "#efe3c4" }}>长按金色遗物</b>拾取残页（+150 分）</li>
                  <li className="flex gap-2.5"><span style={{ color: "#e2543a" }}>◈</span>低语声近了就走——被黑影抱住即告终结</li>
                  <li className="flex gap-2.5"><span style={{ color: "#8a6f3a" }}>◈</span>Q / E 转身 · Esc 暂停 · M 静音</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 暂停 ── */}
      {screen === "paused" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center screen-in" style={{ background: "rgba(8,5,3,0.78)" }}>
          <div className="panel px-10 py-8 text-center rise-in">
            <div className="font-display text-4xl" style={{ color: "#f0d48a", letterSpacing: "0.3em" }}>暂停</div>
            <div className="mt-2 text-xs" style={{ color: "#8a6f3a" }}>烛火屏住了呼吸</div>
            <div className="mt-6 flex gap-3 justify-center">
              <button className="btn-gold px-8 py-2.5" onClick={resume}>继续</button>
              <button className="btn-ghost px-6 py-2.5" onClick={begin}>重新开始</button>
            </div>
            <div className="mt-5 text-[11px] leading-relaxed" style={{ color: "#8a7a5a" }}>
              长按 W 穿门 · 长按门直达对面 · 长按遗物拾取
              <br />
              Esc / P 继续 · M 静音
            </div>
          </div>
        </div>
      )}

      {/* ── 被捕获 ── */}
      {screen === "over" && stats && (
        <div className="absolute inset-0 z-30 flex items-center justify-center screen-in" style={{ background: "radial-gradient(ellipse at center, rgba(60,8,14,0.82), rgba(8,3,3,0.95))" }}>
          <div className="panel px-10 py-8 text-center rise-in max-w-[560px]">
            <div className="font-display text-5xl" style={{ color: "#e2543a", letterSpacing: "0.18em", textShadow: "0 0 24px rgba(226,84,58,0.5)" }}>
              被黑影拥抱
            </div>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: "#cbbd98" }}>
              冰冷的气息合拢。你听见它用很多人的声音说：
              「再等等……还差一页，我就能记起自己是谁。」
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              {[
                ["灵焰分", String(stats.score)],
                ["探索房间", String(stats.rooms)],
                ["残页", `${stats.relics}/8`],
              ].map(([k, v]) => (
                <div key={k} className="panel-soft px-3 py-2.5">
                  <div className="hud-label">{k}</div>
                  <div className="font-display text-xl" style={{ color: "#f0d48a" }}>{v}</div>
                </div>
              ))}
            </div>
            {stats.loreFound.length > 0 && (
              <div className="mt-4 text-left max-h-[120px] overflow-y-auto panel-soft px-4 py-2.5 space-y-1.5">
                {stats.loreFound.map((l, i) => (
                  <div key={i} className="text-xs" style={{ color: "#cbbd98" }}>▸ {l}</div>
                ))}
              </div>
            )}
            <button className="btn-gold mt-6 px-10 py-3 text-lg" onClick={begin}>再入迷宫</button>
          </div>
        </div>
      )}

      {/* ── 真相（胜利） ── */}
      {screen === "won" && stats && (
        <div className="absolute inset-0 z-30 flex items-center justify-center screen-in" style={{ background: "radial-gradient(ellipse at 50% 20%, rgba(90,68,26,0.85), rgba(12,9,5,0.95) 80%)" }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="feather-fall absolute" style={{ left: `${5 + i * 11}%`, animationDuration: `${8 + (i % 4) * 3}s`, animationDelay: `${i * 0.9}s`, opacity: 0 }}>
              <Feather lit />
            </div>
          ))}
          <div className="panel px-10 py-8 text-center rise-in max-w-[620px]">
            <div className="hud-label" style={{ color: "#8a6f3a" }}>八页残章已齐</div>
            <div className="font-display text-5xl mt-1" style={{ color: "#f0d48a", letterSpacing: "0.22em", textShadow: "0 0 30px rgba(240,212,138,0.55)" }}>
              真相
            </div>
            <p className="mt-4 text-sm leading-relaxed" style={{ color: "#e6d9b8" }}>
              残页在无风中燃起，拼成最后一行字——
              伊卡洛斯坠落时，身体化作了迷宫上方的光，影子却跌进了迷宫深处，
              一页一页地寻找自己。追猎你的从来不是狱卒：
              <span style={{ color: "#f0d48a" }}>那是他留在人间的另一半。</span>
              此刻，影子松开怀抱，向着光，向上走去。
            </p>
            <div className="mt-5 grid grid-cols-4 gap-2.5 text-center">
              {[
                ["灵焰分", String(stats.score + 500)],
                ["房间", String(stats.rooms)],
                ["残页", "8/8"],
                ["用时", fmtTime(stats.time)],
              ].map(([k, v]) => (
                <div key={k} className="panel-soft px-2 py-2.5">
                  <div className="hud-label">{k}</div>
                  <div className="font-display text-lg" style={{ color: "#f0d48a" }}>{v}</div>
                </div>
              ))}
            </div>
            <button className="btn-gold mt-6 px-10 py-3 text-lg" onClick={begin}>再探一轮</button>
          </div>
        </div>
      )}
    </div>
  );
}

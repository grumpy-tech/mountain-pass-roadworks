// Everything the levels share: canvas + sky (day/night cycle, weather), the single useFrame stepper, HUD,
// minimap, machine roster, objective hints, instructions popup, photo mode, audio and win stats.
// A level supplies a LevelSpec (its rules + its scene); this file never knows which level it is running.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { GameAudio, type SoundName } from "./audio";
import Minimap, { type MapFrame, type MapInfo } from "./Minimap";
import { EnvCtx, Key } from "./parts";
import { FxBus, FxCtx, Particles } from "./Particles";
import { DIFF, LOW_FUEL, WEATHER_GRIP, ratingFor, type Difficulty, type Env, type Fx, type WeatherKind } from "./shared";
import { Precipitation, type WeatherState } from "./Weather";

export interface BaseVehicle {
  kind: string; x: number; y: number; z: number; heading: number; speed: number; pitch: number; roll: number; tipped: boolean; work: number;
  fuel: number; damage: number;
}
export interface BaseGame {
  vehicles: BaseVehicle[]; active: number; msg: string; msgT: number; actionT: number; won: boolean;
  time: number; rollovers: number; events: string[]; fx: Fx[]; env: Env;
}
export interface Input {
  throttle: number; steer: number; action: boolean;
  /** For machines that split the keys (a tower crane): W/S alone, and arrow up/down alone. `throttle` merges W/S with the arrows. */
  trolley: number; lift: number;
}
export interface MachineInfo {
  label: string; nick: string; max: number; weight: number; paint: string;
  /** Headlight pair in the machine's local space: [x, y, z, half-spread]. */
  lamp: [number, number, number, number];
}

export interface LevelSpec {
  id: string;
  title: string;
  brief: string;
  game: BaseGame;
  machines: Record<string, MachineInfo>;
  roles: Record<string, string>;
  jobOrder: string;
  winText: string;
  /** Par time in seconds on Normal; 3 stars need to beat it. */
  par: number;
  /** Wasted effort that costs the third star (e.g. trees felled outside the cut block). */
  penalties(): number;
  /** Extra lines for the win screen. */
  extra(): [string, string][];
  step(input: Input, dt: number): void;
  action(): { label: string; time: number } | null;
  recover(): void;
  select(i: number): void;
  cycle(dir: 1 | -1): void;
  hint(): { text: string; machine: string | null };
  tasks(): [string, string, boolean][];
  progress(): number;
  cargo(): string;
  map(): MapInfo;
  /** Where to refuel when a machine runs low (defaults to the camp tank). */
  refuelHint?(): string;
  /** Extra sentence for the instructions' fuel section (e.g. a field tank). */
  fuelNote?: string;
  /** Extra control lines for the instructions popup, shown after the standard ones. */
  controls?: [string, string][];
  /** A key press the shell does not handle itself (not a repeat, not while paused). Return true if it was used. */
  onKey?(key: string): boolean;
  /**
   * Level-specific camera (e.g. a crane's hook or cab view), called every frame while the game is not in photo mode.
   * Return the point the sun should follow, or null to use the default chase camera.
   */
  camera?(cam: THREE.PerspectiveCamera, dt: number): [number, number, number] | null;
  /** Extra HUD drawn over the canvas (hidden in photo mode), e.g. instrument panels. */
  overlay?: ReactNode;
  /** Level meshes (terrain, props). */
  scene: ReactNode;
  /** One machine's mesh. `lamps` is true when it is dark enough for lights. */
  vehicle(v: BaseVehicle, active: boolean, lamps: boolean): ReactNode;
}

export type Lighting = "auto" | "day" | "night";
export interface Settings { lighting: Lighting; weather: "auto" | WeatherKind; difficulty: Difficulty; muted: boolean }

export interface LevelProps {
  settings: Settings;
  onCycleLighting(): void; onCycleWeather(): void; onToggleMute(): void; onExit(): void; onRestart(): void;
}

export const bestKey = (id: string, diff: Difficulty) => `roadworks-best-${id}-${diff}`;
export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const stars = (n: number) => "★".repeat(n) + "☆".repeat(3 - n);

const keys = new Set<string>();
const ONE_SHOT = new Set(["tab", "r", "?", "h", "m", "n", "c", "p", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

// ---- sky: one full day is DAY_SECONDS of play; t = 0 midnight, 0.5 noon ----
export const DAY_SECONDS = 360;
interface Sky { t: number; dark: number; bg: string; sky: string; ground: string; hemi: number; sun: string; sunI: number; env: number }
const NIGHT = { dark: 1, bg: "#0d1430", sky: "#6676b8", ground: "#221e2e", hemi: 0.8, sun: "#9aaeff", sunI: 0.9, env: 0.2 };
const DAYK = { dark: 0, bg: "#b9d3e0", sky: "#dbeeff", ground: "#6b5a3e", hemi: 0.5, sun: "#fff1d6", sunI: 2.4, env: 0.35 };
const SKY: Sky[] = [
  { t: 0, ...NIGHT },
  { t: 0.2, ...NIGHT, dark: 0.9, bg: "#1d2040", sky: "#7478bc" },
  { t: 0.28, dark: 0.35, bg: "#e8a37a", sky: "#ffd2b0", ground: "#6b5a3e", hemi: 0.6, sun: "#ffa860", sunI: 1.7, env: 0.3 },
  { t: 0.36, ...DAYK },
  { t: 0.62, ...DAYK },
  { t: 0.72, dark: 0.1, bg: "#e8c9a0", sky: "#ffe0c0", ground: "#6b5a3e", hemi: 0.55, sun: "#ffbf80", sunI: 2, env: 0.32 },
  { t: 0.79, dark: 0.7, bg: "#2a2342", sky: "#a592d0", ground: "#46394a", hemi: 1, sun: "#ff9a5c", sunI: 1.7, env: 0.25 },
  { t: 0.88, ...NIGHT },
  { t: 1, ...NIGHT },
];
const _c = new THREE.Color();
interface SkyOut { dark: number; bg: THREE.Color; sky: THREE.Color; ground: THREE.Color; hemi: number; sun: THREE.Color; sunI: number; env: number }
function sampleSky(tod: number, o: SkyOut) {
  let i = 0;
  while (i < SKY.length - 2 && tod >= SKY[i + 1].t) i++;
  const a = SKY[i], b = SKY[i + 1], f = (tod - a.t) / (b.t - a.t), m = (x: number, y: number) => x + (y - x) * f;
  o.bg.set(a.bg).lerp(_c.set(b.bg), f); o.sky.set(a.sky).lerp(_c.set(b.sky), f); o.ground.set(a.ground).lerp(_c.set(b.ground), f);
  o.sun.set(a.sun).lerp(_c.set(b.sun), f);
  o.dark = m(a.dark, b.dark); o.hemi = m(a.hemi, b.hemi); o.sunI = m(a.sunI, b.sunI); o.env = m(a.env, b.env);
}
const clockText = (tod: number) => { const h = Math.floor(tod * 24), mi = Math.floor((tod * 24 - h) * 60); return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`; };
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Mutable sim-side state shared by the stepper and the HUD (kept out of React so it can change every frame). */
interface Sim {
  tod: number; day: number; dark: number; lamps: boolean;
  weather: WeatherState; auto: WeatherKind; autoIn: number;
}
const newSim = (): Sim => ({ tod: 0.3, day: 1, dark: 0, lamps: false, weather: { kind: "clear", level: 0 }, auto: "clear", autoIn: 50 });

function Director({ spec, paused, photo, photoOn, audio, bus, sim, settings, controls, onReady }: {
  spec: LevelSpec; paused: MutableRefObject<boolean>; photo: MutableRefObject<boolean>; photoOn: boolean; audio: GameAudio; bus: FxBus; sim: MutableRefObject<Sim>;
  settings: Settings; controls: MutableRefObject<OrbitControlsImpl | null>; onReady: () => void;
}) {
  const { camera, scene } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null!), hemi = useRef<THREE.HemisphereLight>(null!);
  const beamA = useRef<THREE.SpotLight>(null!), beamB = useRef<THREE.SpotLight>(null!);
  const frames = useRef(0);
  const st = useMemo(() => ({
    bg: new THREE.Color(), fog: new THREE.Fog("#fff", 60, 160), tA: new THREE.Object3D(), tB: new THREE.Object3D(), cam: new THREE.Vector3(),
    sky: { dark: 0, bg: new THREE.Color(), sky: new THREE.Color(), ground: new THREE.Color(), hemi: 0, sun: new THREE.Color(), sunI: 0, env: 0 } as SkyOut,
    gray: new THREE.Color(),
  }), []);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  useEffect(() => { scene.background = st.bg; scene.fog = st.fog; }, [scene, st]);
  useEffect(() => { beamA.current.target = st.tA; beamB.current.target = st.tB; }, [st]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05), g = spec.game, S = sim.current, set = settingsRef.current, w = S.weather;
    if (!paused.current) {
      // clock and weather advance only while the work does
      if (set.lighting === "auto") { S.tod += dt / DAY_SECONDS; if (S.tod >= 1) { S.tod -= 1; S.day++; } }
      else S.tod += ((set.lighting === "day" ? 0.5 : 0.96) - S.tod) * Math.min(1, dt * 1.5);
      if (set.weather === "auto") { S.autoIn -= dt; if (S.autoIn <= 0) { const r = Math.random(); S.auto = r < 0.5 ? "clear" : r < 0.8 ? "rain" : "snow"; S.autoIn = rnd(70, 130); } }
      const want: WeatherKind = set.weather === "auto" ? S.auto : set.weather;
      if (w.kind !== want) { w.level = Math.max(0, w.level - dt * 0.35); if (w.level <= 0) w.kind = want; }
      else w.level = w.kind === "clear" ? 0 : Math.min(1, w.level + dt * 0.25);
      g.env.gripMul = 1 - (1 - WEATHER_GRIP[w.kind]) * w.level;

      const throttle = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
      const steer = (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
      const trolley = (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0), lift = (keys.has("arrowup") ? 1 : 0) - (keys.has("arrowdown") ? 1 : 0);
      spec.step({ throttle, steer, action: keys.has(" "), trolley, lift }, dt);
      const v = g.vehicles[g.active], m = spec.machines[v.kind], dead = v.tipped || v.fuel <= 0;
      audio.update({
        speed: dead ? 0 : Math.min(1, Math.abs(v.speed) / m.max), throttle: dead ? 0 : throttle,
        working: g.actionT > 0, weight: m.weight, reversing: !dead && v.speed < -0.3 && throttle < 0,
      });
      for (const e of g.events.splice(0)) audio.play(e as SoundName);
      for (const e of g.fx.splice(0)) bus.push(e);
    } else audio.idle();

    // ---- sky ----
    sampleSky(S.tod, st.sky);
    const k = st.sky, wl = w.level, wk = w.kind;
    const lum = 1 - k.dark * 0.8;
    st.bg.copy(k.bg).lerp(st.gray.set(wk === "rain" ? "#6a7580" : "#d4dae0").multiplyScalar(lum), wl * (wk === "snow" ? 0.55 : 0.65));
    st.fog.color.copy(st.bg);
    st.fog.near = (60 - 32 * k.dark) * (1 - 0.5 * wl);
    st.fog.far = (160 - 55 * k.dark) * (1 - 0.5 * wl);
    hemi.current.color.copy(k.sky); hemi.current.groundColor.copy(k.ground); hemi.current.intensity = k.hemi * (1 - 0.2 * wl);
    sun.current.color.copy(k.sun); sun.current.intensity = k.sunI * (1 - 0.45 * wl);
    scene.environmentIntensity = k.env * (1 - 0.3 * wl);
    S.dark = k.dark + 0.25 * wl;
    if (!S.lamps && S.dark > 0.55) S.lamps = true; else if (S.lamps && S.dark < 0.4) S.lamps = false;

    // ---- camera, sun, headlights ----
    const v = g.vehicles[g.active];
    let sx = v.x, sy = v.y, sz = v.z; // where the sun looks
    if (!photo.current) {
      const focus = spec.camera?.(camera as THREE.PerspectiveCamera, dt);
      if (focus) [sx, sy, sz] = focus;
      else {
        camera.position.lerp(st.cam.set(v.x + 6, v.y + 42, v.z + 16), 1 - Math.exp(-3 * dt));
        camera.lookAt(v.x, v.y, v.z);
      }
    }
    const day = S.tod > 0.22 && S.tod < 0.82, a = ((S.tod - 0.22) / 0.6) * Math.PI;
    const ox = day ? Math.cos(a) * 45 : -22, oy = day ? Math.max(9, Math.sin(a) * 50) : 40, oz = day ? 14 : -12;
    sun.current.position.set(sx + ox, sy + oy, sz + oz);
    sun.current.target.position.set(sx, sy, sz);
    sun.current.target.updateMatrixWorld();
    const lamp = spec.machines[v.kind].lamp, fx = Math.sin(v.heading), fz = Math.cos(v.heading), rx = Math.cos(v.heading), rz = -Math.sin(v.heading);
    const on = S.lamps && !v.tipped && v.fuel > 0 ? 260 : 0;
    for (const [beam, tgt, side] of [[beamA, st.tA, 1], [beamB, st.tB, -1]] as const) {
      const sx = v.x + rx * lamp[0] + rx * lamp[3] * side + fx * lamp[2], sz = v.z + rz * lamp[0] + rz * lamp[3] * side + fz * lamp[2];
      beam.current.position.set(sx, v.y + lamp[1], sz);
      tgt.position.set(sx + fx * 13, v.y - 0.8, sz + fz * 13);
      beam.current.intensity = on;
    }
    if (++frames.current === 3) onReady();
  });
  return (
    <>
      <hemisphereLight ref={hemi} />
      <directionalLight ref={sun} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-40} shadow-camera-right={40}
        shadow-camera-top={40} shadow-camera-bottom={-40} shadow-bias={-0.0005} />
      <spotLight ref={beamA} intensity={0} distance={48} angle={0.34} penumbra={0.55} color="#fff1cf" />
      <spotLight ref={beamB} intensity={0} distance={48} angle={0.34} penumbra={0.55} color="#fff1cf" />
      <primitive object={st.tA} /><primitive object={st.tB} />
      <OrbitControls ref={controls} enabled={photoOn} enablePan maxPolarAngle={Math.PI * 0.49} minDistance={4} maxDistance={140} />
    </>
  );
}

function Help({ spec, onClose }: { spec: LevelSpec; onClose: () => void }) {
  const n = spec.game.vehicles.length;
  const controls: [string, string][] = [
    ["W / S  or  ↑ / ↓", "Drive forward / reverse"],
    ["A / D  or  ← / →", "Steer"],
    ["Space (hold)", "Work: dig, fell, load, dump, haul, refuel"],
    ["Tab / Shift+Tab", "Next / previous machine"],
    [`1 – ${n}`, "Jump straight to that machine"],
    ["R", "Recover after a rollover (or tow when out of fuel)"],
    ["N  /  C", "Lighting: auto, day, night  /  weather"],
    ["P  /  M", "Photo mode  /  sound"],
    ["? or H", "Show / hide these instructions"],
    ...(spec.controls ?? []),
  ];
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4" role="dialog" aria-modal="true" aria-label="Instructions">
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-md border-2 border-foreground bg-card p-6 font-mono text-sm text-card-foreground shadow-xl">
        <h2 className="text-xl font-bold">{spec.title} · Crew Briefing</h2>
        <p className="mt-1 text-muted-foreground">{spec.brief}</p>

        <h3 className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">Controls</h3>
        <ul className="mt-1 space-y-1">
          {controls.map(([k, d]) => (
            <li key={k} className="flex items-baseline justify-between gap-4"><Key>{k}</Key><span className="text-right">{d}</span></li>
          ))}
        </ul>

        <h3 className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">The crew</h3>
        <ul className="mt-1 space-y-1">
          {Object.entries(spec.machines).map(([kind, m]) => (
            <li key={kind} className="flex gap-2">
              <span className="mt-1 h-3 w-3 shrink-0 rounded-sm border border-foreground/60" style={{ background: m.paint }} />
              <span><b>{m.nick}</b> the {m.label}: {spec.roles[kind]}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">Job order</h3>
        <p className="mt-1">{spec.jobOrder}</p>

        <h3 className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">Fuel, wear and weather</h3>
        <p className="mt-1">Machines burn fuel while you drive them and wear down from hard hits and rollovers (slower, up to 40%). Park at the camp fuel tank and hold Space to refuel and repair. {spec.fuelNote} Rain and snow cut traction. A day lasts about {DAY_SECONDS / 60} minutes: headlights come on at dusk.</p>
        <p className="mt-2 text-muted-foreground">The banner at the bottom always names the next job and which machine should do it. The map shows the whole route.</p>

        <div className="mt-5 flex justify-end">
          <button type="button" autoFocus onClick={onClose} className="rounded-md border-2 border-foreground bg-primary px-4 py-2 font-bold text-primary-foreground hover:opacity-90">
            Start work <span className="ml-1 text-xs font-normal">(Enter)</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const btn = "pointer-events-auto rounded-md border-2 border-foreground/80 bg-card/90 px-2 py-1 font-mono text-xs font-bold text-card-foreground shadow-lg hover:bg-card";
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function Bar({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-9 text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 bg-muted"><div className={`h-2 ${warn ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>
    </div>
  );
}

export function LevelShell({ spec, settings, onCycleLighting, onCycleWeather, onToggleMute, onExit, onRestart }: { spec: LevelSpec } & LevelProps) {
  const game = spec.game;
  const sim = useRef<Sim>(newSim());
  const snapshot = useCallback(() => {
    const v = game.vehicles[game.active], a = spec.action(), S = sim.current;
    return {
      active: game.active, speed: Math.abs(v.speed), msg: game.msgT > 0 ? game.msg : "",
      action: a ? a.label : "", actionT: game.actionT, actionMax: a && Number.isFinite(a.time) ? a.time : 0,
      cargo: spec.cargo(), tasks: spec.tasks(), progress: spec.progress(), hint: spec.hint(),
      won: game.won, time: game.time, rollovers: game.rollovers, tipped: game.vehicles.map((o) => o.tipped),
      fuel: v.fuel, damage: v.damage, lowFuel: game.vehicles.map((o) => o.fuel < LOW_FUEL), refuel: spec.refuelHint?.() ?? "Drive to the tank at the camp and hold Space",
      clock: clockText(S.tod), day: S.day, lamps: S.lamps, wkind: S.weather.kind, wlevel: S.weather.level,
    };
  }, [game, spec]);
  const [hud, setHud] = useState(snapshot);
  const [ready, setReady] = useState(false);
  const [help, setHelp] = useState(true); // instructions open on load; the sim is paused while they are up
  const [photo, setPhoto] = useState(false);
  const [tod, setTod] = useState(0.3);
  const [best, setBest] = useState<{ time: number; isNew: boolean } | null>(null);
  const helpRef = useRef(true), photoRef = useRef(false), pausedRef = useRef(true);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const canvasEl = useRef<HTMLCanvasElement | null>(null);
  const audio = useMemo(() => new GameAudio(), []);
  const bus = useMemo(() => new FxBus(), []);
  const weatherBox = useRef<WeatherState>(sim.current.weather);
  const latest = useRef({ onCycleLighting, onCycleWeather, onToggleMute });
  latest.current = { onCycleLighting, onCycleWeather, onToggleMute };
  const sync = () => { pausedRef.current = helpRef.current || photoRef.current; keys.clear(); };
  const setHelpOpen = useCallback((open: boolean) => { helpRef.current = open; sync(); setHelp(open); }, []);
  const setPhotoOpen = useCallback((open: boolean) => {
    photoRef.current = open; sync(); setPhoto(open);
    if (open) { setTod(sim.current.tod); const v = game.vehicles[game.active]; setTimeout(() => { controls.current?.target.set(v.x, v.y, v.z); controls.current?.update(); }, 0); }
  }, [game]);

  useEffect(() => { audio.setMuted(settings.muted); }, [audio, settings.muted]);

  useEffect(() => {
    if (typeof window !== "undefined") (window as unknown as { __game: BaseGame; __sim: Sim }).__game = game;
    if (typeof window !== "undefined") (window as unknown as { __sim: Sim }).__sim = sim.current;
    const down = (e: KeyboardEvent) => {
      audio.unlock();
      const k = e.key.toLowerCase();
      if (k === "tab") e.preventDefault(); // never move browser focus
      if (e.repeat && ONE_SHOT.has(k)) return;
      if (k === "?" || k === "h") { if (!photoRef.current) setHelpOpen(!helpRef.current); return; }
      if (k === "m") { latest.current.onToggleMute(); return; }
      if (k === "n") { latest.current.onCycleLighting(); return; }
      if (k === "c") { latest.current.onCycleWeather(); return; }
      if (k === "p" && !helpRef.current) { setPhotoOpen(!photoRef.current); return; }
      if (photoRef.current) { if (k === "escape") setPhotoOpen(false); return; }
      if (helpRef.current) { if (k === "escape" || k === "enter") setHelpOpen(false); return; }
      if (k === " " || k.startsWith("arrow")) e.preventDefault();
      if (k === "tab") spec.cycle(e.shiftKey ? -1 : 1);
      else if (/^[1-9]$/.test(k)) spec.select(Number(k) - 1);
      else if (k === "r") spec.recover();
      else if (!e.repeat) spec.onKey?.(k);
      keys.add(k);
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    const blur = () => keys.clear();
    const click = () => audio.unlock();
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur); window.addEventListener("pointerdown", click);
    const id = setInterval(() => setHud(snapshot()), 120);
    return () => {
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); window.removeEventListener("pointerdown", click);
      clearInterval(id); keys.clear(); audio.idle();
    };
  }, [game, spec, audio, snapshot, setHelpOpen, setPhotoOpen]);

  const rating = useMemo(() => (hud.won ? ratingFor(game.time, game.rollovers, spec.penalties(), spec.par * DIFF[settings.difficulty].par) : 0), [hud.won, game, spec, settings.difficulty]);
  useEffect(() => {
    if (!hud.won) return;
    try {
      const k = bestKey(spec.id, settings.difficulty), prev = Number(localStorage.getItem(k)), t = game.time;
      const isNew = !prev || t < prev;
      if (isNew) localStorage.setItem(k, String(t));
      localStorage.setItem(k + "-stars", String(Math.max(rating, Number(localStorage.getItem(k + "-stars")) || 0)));
      setBest({ time: isNew ? t : prev, isNew });
    } catch { /* storage unavailable: just skip best time */ }
  }, [hud.won, game, spec.id, settings.difficulty, rating]);

  const mapRead = useCallback((): MapFrame => ({
    ...spec.map(),
    dots: game.vehicles.map((o, i) => ({ x: o.x, z: o.z, color: spec.machines[o.kind].paint, active: i === game.active })),
  }), [spec, game]);

  const savePhoto = () => {
    const c = canvasEl.current;
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = `${spec.id}-${Date.now()}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };

  const v = game.vehicles[hud.active], m = spec.machines[v.kind];
  const hintMachine = hud.hint.machine;
  const hintIdx = hintMachine ? game.vehicles.findIndex((o) => o.kind === hintMachine) : -1;
  const needSwitch = hintIdx >= 0 && hintIdx !== hud.active;
  const weatherLabel = hud.wlevel > 0.3 ? hud.wkind : "clear";

  return (
    <div className="relative h-screen w-full overflow-hidden" data-scene-ready={ready ? "" : undefined} data-level={spec.id}>
      <Canvas shadows camera={{ fov: 40, position: [v.x + 6, 42, v.z + 16], far: 400 }} gl={{ preserveDrawingBuffer: true }}
        onCreated={({ gl }) => { canvasEl.current = gl.domElement; }}>
        <Environment resolution={64}>
          <Lightformer intensity={1.5} position={[0, 5, 0]} scale={[10, 10, 1]} />
          <Lightformer intensity={0.8} color="#ffd9a8" position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[20, 1, 1]} />
        </Environment>
        <FxCtx.Provider value={bus}>
          <EnvCtx.Provider value={{ lamps: hud.lamps }}>
            {spec.scene}
            {game.vehicles.map((veh, i) => <Fragment key={i}>{spec.vehicle(veh, i === hud.active, hud.lamps)}</Fragment>)}
          </EnvCtx.Provider>
          <Particles bus={bus} />
        </FxCtx.Provider>
        <Precipitation weather={weatherBox} follow={() => game.vehicles[game.active]} />
        <Director spec={spec} paused={pausedRef} photo={photoRef} photoOn={photo} audio={audio} bus={bus} sim={sim} settings={settings} controls={controls} onReady={() => setReady(true)} />
      </Canvas>

      {!photo && (
        <>
          <div className="pointer-events-none absolute left-4 top-4 w-80 rounded-md border-2 border-foreground/80 bg-card/90 p-4 font-mono text-sm text-card-foreground shadow-lg">
            <div className="flex justify-between text-xs uppercase tracking-widest text-muted-foreground">
              <span>Job · {spec.title}</span><span>{fmtTime(hud.time)}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">Day {hud.day} · {hud.clock} · {cap(weatherLabel)}</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-lg font-bold">{m.nick} <span className="text-xs font-normal text-muted-foreground">the {m.label}</span></span>
              <span className="text-xs text-muted-foreground">{(hud.speed * 3.6).toFixed(0)} km/h</span>
            </div>
            {hud.cargo && <div className="text-xs">{hud.cargo}</div>}
            <div className="mt-2 space-y-1">
              <Bar label="Fuel" value={hud.fuel} warn={hud.fuel < LOW_FUEL} />
              <Bar label="Wear" value={hud.damage} warn={hud.damage > 0.6} />
            </div>
            <ul className="mt-3 space-y-1">
              {hud.tasks.map(([l, val, ok]) => (
                <li key={l} className="flex justify-between gap-2">
                  <span className={ok ? "text-muted-foreground line-through" : ""}>{l}</span><span className="text-right">{val}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 h-2 bg-muted"><div className="h-2 bg-primary" style={{ width: `${hud.progress * 100}%` }} /></div>
          </div>

          {spec.overlay}

          {(hud.action || hud.msg) && (
            <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 space-y-2 text-center font-mono text-sm">
              {hud.msg && <div className="rounded-md bg-foreground px-4 py-2 text-background">{hud.msg}</div>}
              {hud.action && (
                <div className="rounded-md bg-card/90 px-4 py-2 text-card-foreground">
                  {hud.actionMax ? <><b>Hold Space</b> · {hud.action}</> : hud.action}
                  {hud.actionMax > 0 && hud.actionT > 0 && (
                    <div className="mt-1 h-1.5 bg-muted"><div className="h-1.5 bg-primary" style={{ width: `${Math.min(1, hud.actionT / hud.actionMax) * 100}%` }} /></div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="absolute right-4 top-4 flex max-w-md flex-col items-end gap-2 font-mono text-xs">
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" tabIndex={-1} className={btn} onClick={(e) => { e.currentTarget.blur(); onExit(); }}>Menu</button>
              <button type="button" tabIndex={-1} className={btn} title="Lighting: auto / day / night (N)" onClick={(e) => { e.currentTarget.blur(); onCycleLighting(); }}>Light: {cap(settings.lighting)}</button>
              <button type="button" tabIndex={-1} className={btn} title="Weather (C)" onClick={(e) => { e.currentTarget.blur(); onCycleWeather(); }}>Weather: {cap(settings.weather)}</button>
              <button type="button" tabIndex={-1} className={btn} title="Sound (M)" onClick={(e) => { e.currentTarget.blur(); onToggleMute(); }}>{settings.muted ? "Sound off" : "Sound on"}</button>
              <button type="button" tabIndex={-1} className={btn} title="Photo mode (P)" onClick={(e) => { e.currentTarget.blur(); setPhotoOpen(true); }}>Photo</button>
              <button
                type="button" tabIndex={-1} aria-label="Show instructions" title="Instructions (?)"
                onClick={(e) => { e.currentTarget.blur(); setHelpOpen(true); }}
                className="pointer-events-auto h-8 w-8 rounded-full border-2 border-foreground/80 bg-card/90 text-sm font-bold text-card-foreground shadow-lg hover:bg-card"
              >?</button>
            </div>
            <div className="pointer-events-none w-48 rounded-md border-2 border-foreground/80 bg-card/90 p-2 text-card-foreground shadow-lg">
              <div className="mb-1 uppercase tracking-widest text-muted-foreground"><Key>Tab</Key> or <Key>1-{game.vehicles.length}</Key></div>
              {game.vehicles.map((veh, i) => (
                <div key={i} className={`flex items-center gap-2 rounded px-1.5 py-1 ${i === hud.active ? "bg-primary/25 font-bold" : ""}`}>
                  <span className="w-3 text-muted-foreground">{i + 1}</span>
                  <span className="h-3 w-3 shrink-0 rounded-sm border border-foreground/60" style={{ background: spec.machines[veh.kind].paint }} />
                  <span className="flex-1 truncate">{spec.machines[veh.kind].nick}</span>
                  {hud.tipped[i] ? <span className="text-destructive">tipped</span> : hud.lowFuel[i] ? <span className="text-destructive">fuel</span> : null}
                </div>
              ))}
            </div>
          </div>

          <div className="absolute bottom-4 left-4"><Minimap read={mapRead} /></div>

          {!hud.won && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 max-w-xl -translate-x-1/2 rounded-md border-2 border-foreground/80 bg-card/90 px-4 py-2 text-center font-mono text-sm text-card-foreground shadow-lg">
              {hud.fuel < LOW_FUEL ? (
                <><span className="mr-2 text-xs uppercase tracking-widest text-destructive">Low fuel</span>{hud.refuel}{hud.fuel <= 0 ? " (or press R for a tow)" : ""}</>
              ) : (
                <>
                  <span className="mr-2 text-xs uppercase tracking-widest text-muted-foreground">Next</span>
                  {needSwitch ? <><b>Switch to {spec.machines[hintMachine!].nick}</b> <Key>{hintIdx + 1}</Key> : </> : hintMachine ? <b>{spec.machines[hintMachine].nick}: </b> : null}
                  {hud.hint.text}
                </>
              )}
            </div>
          )}
        </>
      )}

      {photo && (
        <div className="absolute inset-x-0 top-3 z-30 flex flex-wrap items-center justify-center gap-3 font-mono text-xs">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-md border-2 border-foreground/80 bg-card/90 px-3 py-2 text-card-foreground shadow-lg">
            <b>Photo mode</b>
            <span className="text-muted-foreground">drag to orbit, right-drag to pan, scroll to zoom</span>
            <label className="flex items-center gap-2">Time {clockText(tod)}
              <input type="range" min={0} max={0.999} step={0.005} value={tod} aria-label="Time of day"
                onChange={(e) => { const t = Number(e.target.value); sim.current.tod = t; setTod(t); }} />
            </label>
            <button type="button" className={btn} onClick={() => onCycleWeather()}>Weather: {cap(settings.weather)}</button>
            <button type="button" className={btn} onClick={savePhoto}>Save PNG</button>
            <button type="button" className={btn} onClick={() => setPhotoOpen(false)}>Exit (P)</button>
          </div>
        </div>
      )}

      {help && <Help spec={spec} onClose={() => setHelpOpen(false)} />}

      {hud.won && !photo && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-foreground/40">
          <div className="rounded-md border-2 border-foreground bg-card p-8 text-center font-mono text-card-foreground">
            <div className="text-2xl font-bold">{spec.title} complete!</div>
            <div className="mt-2 text-3xl tracking-widest text-primary" aria-label={`${rating} stars`}>{stars(rating)}</div>
            <div className="mt-1 text-muted-foreground">{spec.winText}</div>
            <dl className="mx-auto mt-4 grid w-72 grid-cols-2 gap-y-1 text-left text-sm">
              <dt className="text-muted-foreground">Time</dt><dd className="text-right font-bold">{fmtTime(hud.time)}</dd>
              <dt className="text-muted-foreground">Par ({cap(settings.difficulty)})</dt><dd className="text-right font-bold">{fmtTime(spec.par * DIFF[settings.difficulty].par)}</dd>
              <dt className="text-muted-foreground">Rollovers</dt><dd className="text-right font-bold">{hud.rollovers}</dd>
              {spec.extra().map(([a, b]) => <Fragment key={a}><dt className="text-muted-foreground">{a}</dt><dd className="text-right font-bold">{b}</dd></Fragment>)}
              {best && <><dt className="text-muted-foreground">Best</dt><dd className="text-right font-bold">{fmtTime(best.time)}{best.isNew ? " (new!)" : ""}</dd></>}
            </dl>
            <div className="mt-2 text-xs text-muted-foreground">3 stars: beat par, at most 1 rollover, no wasted effort. 2 stars: within 1.5x par.</div>
            <div className="mt-6 flex justify-center gap-3">
              <button type="button" onClick={onRestart} className="rounded-md border-2 border-foreground bg-primary px-4 py-2 font-bold text-primary-foreground hover:opacity-90">Play again</button>
              <button type="button" onClick={onExit} className="rounded-md border-2 border-foreground bg-card px-4 py-2 font-bold hover:bg-muted">Level select</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


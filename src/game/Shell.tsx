// Everything the levels share: canvas + lighting (day / dusk), the single useFrame stepper, HUD,
// machine roster, objective hints, instructions popup, audio hookup and win stats.
// A level supplies a LevelSpec (its rules + its scene); this file never knows which level it is running.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import * as THREE from "three";
import { GameAudio, type SoundName } from "./audio";
import { Key } from "./parts";

export interface BaseVehicle {
  kind: string; x: number; y: number; z: number; heading: number; speed: number; pitch: number; roll: number; tipped: boolean; work: number;
}
export interface BaseGame {
  vehicles: BaseVehicle[]; active: number; msg: string; msgT: number; actionT: number; won: boolean;
  time: number; rollovers: number; events: string[];
}
export interface Input { throttle: number; steer: number; action: boolean }
export interface MachineInfo { label: string; nick: string; max: number; weight: number; paint: string }

export interface LevelSpec {
  id: string;
  title: string;
  brief: string;
  game: BaseGame;
  machines: Record<string, MachineInfo>;
  roles: Record<string, string>;
  jobOrder: string;
  winText: string;
  step(input: Input, dt: number): void;
  action(): { label: string; time: number } | null;
  recover(): void;
  select(i: number): void;
  cycle(dir: 1 | -1): void;
  hint(): { text: string; machine: string | null };
  tasks(): [string, string, boolean][];
  progress(): number;
  cargo(): string;
  /** Level meshes (terrain, props). */
  scene: ReactNode;
  /** One machine's mesh. `night` lets it switch its headlights on. */
  vehicle(v: BaseVehicle, active: boolean, night: boolean): ReactNode;
}

export interface LevelProps {
  night: boolean; muted: boolean;
  onToggleNight(): void; onToggleMute(): void; onExit(): void; onRestart(): void;
}

export const bestKey = (id: string) => `roadworks-best-${id}`;
export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const keys = new Set<string>();
const ONE_SHOT = new Set(["tab", "r", "?", "h", "m", "n", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

const LOOK = {
  day: { bg: "#b9d3e0", fog: [60, 160] as [number, number], hemi: ["#dbeeff", "#6b5a3e", 0.5] as const, sun: "#fff1d6", sunI: 2.4, env: 0.35 },
  dusk: { bg: "#2a2342", fog: [28, 105] as [number, number], hemi: ["#a592d0", "#46394a", 1.0] as const, sun: "#ff9a5c", sunI: 1.7, env: 0.25 },
};

function Director({ spec, paused, audio, night, onReady }: {
  spec: LevelSpec; paused: MutableRefObject<boolean>; audio: GameAudio; night: boolean; onReady: () => void;
}) {
  const light = useRef<THREE.DirectionalLight>(null!);
  const { camera } = useThree();
  const frames = useRef(0);
  const look = night ? LOOK.dusk : LOOK.day;
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const g = spec.game;
    if (!paused.current) {
      const throttle = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
      const steer = (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
      spec.step({ throttle, steer, action: keys.has(" ") }, dt);
      const v = g.vehicles[g.active], m = spec.machines[v.kind];
      audio.update({
        speed: v.tipped ? 0 : Math.min(1, Math.abs(v.speed) / m.max), throttle: v.tipped ? 0 : throttle,
        working: g.actionT > 0, weight: m.weight, reversing: !v.tipped && v.speed < -0.3 && throttle < 0,
      });
      for (const e of g.events.splice(0)) audio.play(e as SoundName);
    } else audio.idle();
    const v = g.vehicles[g.active];
    camera.position.lerp(new THREE.Vector3(v.x + 6, v.y + 42, v.z + 16), 1 - Math.exp(-3 * dt));
    camera.lookAt(v.x, v.y, v.z);
    light.current.position.set(v.x + 20, v.y + 40, v.z + 10);
    light.current.target.position.set(v.x, v.y, v.z);
    light.current.target.updateMatrixWorld();
    if (++frames.current === 3) onReady();
  });
  return (
    <directionalLight ref={light} intensity={look.sunI} color={look.sun} castShadow shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} shadow-bias={-0.0005} />
  );
}

function Help({ spec, onClose }: { spec: LevelSpec; onClose: () => void }) {
  const n = spec.game.vehicles.length;
  const controls: [string, string][] = [
    ["W / S  or  ↑ / ↓", "Drive forward / reverse"],
    ["A / D  or  ← / →", "Steer"],
    ["Space (hold)", "Work: dig, fell, load, dump, haul"],
    ["Tab / Shift+Tab", "Next / previous machine"],
    [`1 – ${n}`, "Jump straight to that machine"],
    ["R", "Recover after a rollover"],
    ["N  /  M", "Toggle day / dusk  /  sound"],
    ["? or H", "Show / hide these instructions"],
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
        <p className="mt-2 text-muted-foreground">The banner at the bottom always names the next job and which machine should do it.</p>

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

export function LevelShell({ spec, night, muted, onToggleNight, onToggleMute, onExit, onRestart }: { spec: LevelSpec } & LevelProps) {
  const game = spec.game;
  const snapshot = useCallback(() => {
    const v = game.vehicles[game.active], a = spec.action();
    return {
      active: game.active, speed: Math.abs(v.speed), msg: game.msgT > 0 ? game.msg : "",
      action: a ? a.label : "", actionT: game.actionT, actionMax: a && Number.isFinite(a.time) ? a.time : 0,
      cargo: spec.cargo(), tasks: spec.tasks(), progress: spec.progress(), hint: spec.hint(),
      won: game.won, time: game.time, rollovers: game.rollovers, tipped: game.vehicles.map((o) => o.tipped),
    };
  }, [game, spec]);
  const [hud, setHud] = useState(snapshot);
  const [ready, setReady] = useState(false);
  const [help, setHelp] = useState(true); // instructions open on load; the sim is paused while they are up
  const [best, setBest] = useState<{ time: number; isNew: boolean } | null>(null);
  const helpRef = useRef(true);
  const audio = useMemo(() => new GameAudio(), []);
  const latest = useRef({ onToggleNight, onToggleMute });
  latest.current = { onToggleNight, onToggleMute };
  const setHelpOpen = useCallback((open: boolean) => { helpRef.current = open; keys.clear(); setHelp(open); }, []);

  useEffect(() => { audio.setMuted(muted); }, [audio, muted]);

  useEffect(() => {
    if (typeof window !== "undefined") (window as unknown as { __game: BaseGame }).__game = game;
    const down = (e: KeyboardEvent) => {
      audio.unlock();
      const k = e.key.toLowerCase();
      if (k === "tab") e.preventDefault(); // never move browser focus
      if (e.repeat && ONE_SHOT.has(k)) return;
      if (k === "?" || k === "h") { setHelpOpen(!helpRef.current); return; }
      if (k === "m") { latest.current.onToggleMute(); return; }
      if (k === "n") { latest.current.onToggleNight(); return; }
      if (helpRef.current) { if (k === "escape" || k === "enter") setHelpOpen(false); return; }
      if (k === " " || k.startsWith("arrow")) e.preventDefault();
      if (k === "tab") spec.cycle(e.shiftKey ? -1 : 1);
      else if (/^[1-9]$/.test(k)) spec.select(Number(k) - 1);
      else if (k === "r") spec.recover();
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
  }, [game, spec, audio, snapshot, setHelpOpen]);

  useEffect(() => {
    if (!hud.won) return;
    try {
      const k = bestKey(spec.id), prev = Number(localStorage.getItem(k)), t = game.time;
      const isNew = !prev || t < prev;
      if (isNew) localStorage.setItem(k, String(t));
      setBest({ time: isNew ? t : prev, isNew });
    } catch { /* storage unavailable: just skip best time */ }
  }, [hud.won, game, spec.id]);

  const v = game.vehicles[hud.active], m = spec.machines[v.kind];
  const look = night ? LOOK.dusk : LOOK.day;
  const hintMachine = hud.hint.machine;
  const hintIdx = hintMachine ? game.vehicles.findIndex((o) => o.kind === hintMachine) : -1;
  const needSwitch = hintIdx >= 0 && hintIdx !== hud.active;

  return (
    <div className="relative h-screen w-full overflow-hidden" data-scene-ready={ready ? "" : undefined} data-level={spec.id}>
      <Canvas shadows camera={{ fov: 40, position: [v.x + 6, 42, v.z + 16], far: 400 }}>
        <color attach="background" args={[look.bg]} />
        <fog attach="fog" args={[look.bg, look.fog[0], look.fog[1]]} />
        <hemisphereLight args={[look.hemi[0], look.hemi[1], look.hemi[2]]} />
        <Environment resolution={64} environmentIntensity={look.env}>
          <Lightformer intensity={1.5} position={[0, 5, 0]} scale={[10, 10, 1]} />
          <Lightformer intensity={0.8} color="#ffd9a8" position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[20, 1, 1]} />
        </Environment>
        {spec.scene}
        {game.vehicles.map((veh, i) => <Fragment key={i}>{spec.vehicle(veh, i === hud.active, night)}</Fragment>)}
        <Director spec={spec} paused={helpRef} audio={audio} night={night} onReady={() => setReady(true)} />
      </Canvas>

      <div className="pointer-events-none absolute left-4 top-4 w-80 rounded-md border-2 border-foreground/80 bg-card/90 p-4 font-mono text-sm text-card-foreground shadow-lg">
        <div className="flex justify-between text-xs uppercase tracking-widest text-muted-foreground">
          <span>Job · {spec.title}</span><span>{fmtTime(hud.time)}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-lg font-bold">{m.nick} <span className="text-xs font-normal text-muted-foreground">the {m.label}</span></span>
          <span className="text-xs text-muted-foreground">{(hud.speed * 3.6).toFixed(0)} km/h</span>
        </div>
        {hud.cargo && <div className="text-xs">{hud.cargo}</div>}
        <ul className="mt-3 space-y-1">
          {hud.tasks.map(([l, val, ok]) => (
            <li key={l} className="flex justify-between">
              <span className={ok ? "text-muted-foreground line-through" : ""}>{l}</span><span>{val}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 h-2 bg-muted"><div className="h-2 bg-primary" style={{ width: `${hud.progress * 100}%` }} /></div>
      </div>

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

      <div className="absolute right-4 top-4 flex flex-col items-end gap-2 font-mono text-xs">
        <div className="flex gap-2">
          <button type="button" tabIndex={-1} className={btn} onClick={(e) => { e.currentTarget.blur(); onExit(); }}>Menu</button>
          <button type="button" tabIndex={-1} className={btn} title="Toggle day / dusk (N)" onClick={(e) => { e.currentTarget.blur(); onToggleNight(); }}>{night ? "Dusk" : "Day"}</button>
          <button type="button" tabIndex={-1} className={btn} title="Toggle sound (M)" onClick={(e) => { e.currentTarget.blur(); onToggleMute(); }}>{muted ? "Sound off" : "Sound on"}</button>
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
              {hud.tipped[i] && <span className="text-destructive">tipped</span>}
            </div>
          ))}
        </div>
      </div>

      {!hud.won && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 max-w-xl -translate-x-1/2 rounded-md border-2 border-foreground/80 bg-card/90 px-4 py-2 text-center font-mono text-sm text-card-foreground shadow-lg">
          <span className="mr-2 text-xs uppercase tracking-widest text-muted-foreground">Next</span>
          {needSwitch ? <><b>Switch to {spec.machines[hintMachine!].nick}</b> <Key>{hintIdx + 1}</Key> : </> : hintMachine ? <b>{spec.machines[hintMachine].nick}: </b> : null}
          {hud.hint.text}
        </div>
      )}

      {help && <Help spec={spec} onClose={() => setHelpOpen(false)} />}

      {hud.won && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-foreground/40">
          <div className="rounded-md border-2 border-foreground bg-card p-8 text-center font-mono text-card-foreground">
            <div className="text-2xl font-bold">{spec.title} complete!</div>
            <div className="mt-2 text-muted-foreground">{spec.winText}</div>
            <dl className="mx-auto mt-4 grid w-64 grid-cols-2 gap-y-1 text-left text-sm">
              <dt className="text-muted-foreground">Time</dt><dd className="text-right font-bold">{fmtTime(hud.time)}</dd>
              <dt className="text-muted-foreground">Rollovers</dt><dd className="text-right font-bold">{hud.rollovers}</dd>
              {best && <><dt className="text-muted-foreground">Best</dt><dd className="text-right font-bold">{fmtTime(best.time)}{best.isNew ? " (new!)" : ""}</dd></>}
            </dl>
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

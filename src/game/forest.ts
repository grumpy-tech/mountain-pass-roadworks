// Forestry level rules: terrain, standing trees, felled logs, landing stack, vehicle sim.
// Pure data + functions: no React / three, same as world.ts.
import { CELL, HALF, N, fbm, hash, nearestOnPath, smooth, vnoise } from "./world";

export type ForestMachine = "feller" | "skidder" | "logtruck";
export const FOREST_MACHINES: Record<ForestMachine, { accel: number; max: number; turn: number; label: string; nick: string; tracks: boolean }> = {
  feller: { accel: 1.8, max: 4.5, turn: 1.1, label: "Feller Buncher", nick: "Timber", tracks: true },
  skidder: { accel: 2.6, max: 6.5, turn: 1.2, label: "Skidder", nick: "Drag", tracks: false },
  logtruck: { accel: 3.2, max: 9, turn: 1.1, label: "Log Truck", nick: "Haul", tracks: false },
};

export const LOG_TARGET = 12;
export const SKIDDER_CAPACITY = 3;
export const TRUCK_CAPACITY = 6;
const FELL_TIME = 1.2;
const HOOK_TIME = 0.7;
const STACK_TIME = 0.8;
const LOAD_TIME = 1.2;
const DELIVER_TIME = 1.5;
const VEH_RADIUS = 1.7;
const TREE_RADIUS = 1.35; // trunk + machine half-width, centre to centre
const TIP_ROLL = 0.5;
const TIP_PITCH = 0.6;
const DRAG = 1.4;
const MAX_GRADE = 0.75;
export const ROAD_WIDTH = 4.5;

export interface Tree { x: number; z: number; s: number; alive: boolean }
export interface Log { id: number; x: number; z: number; heading: number }
export interface Zone { x: number; z: number; r: number }

export interface ForestWorld {
  heights: Float32Array; colors: Float32Array;
  path: { x: number; z: number }[]; onRoad: Uint8Array;
  trees: Tree[]; cellTree: Int32Array;
  logs: Log[]; nextLogId: number;
  landing: Zone & { stack: number }; mill: Zone;
  felled: number; stacked: number; delivered: number;
  dirtyTrees: boolean; dirtyLogs: boolean;
}

export type ForestEvent = "switch" | "tip" | "chop" | "fell" | "hook" | "stack" | "load" | "deliver" | "win";

export interface ForestVehicle {
  kind: ForestMachine; x: number; y: number; z: number; heading: number; speed: number; pitch: number; roll: number;
  tipped: boolean; work: number;
  logs: number; // skidder grapple / truck bed
}

export interface ForestGame {
  world: ForestWorld; vehicles: ForestVehicle[]; active: number; msg: string; msgT: number; actionT: number; won: boolean;
  time: number; rollovers: number; events: ForestEvent[]; chopT: number;
}

const CONTROL: [number, number][] = [[0, 56], [-22, 44], [-38, 24], [-18, 0], [16, -18], [34, -40], [42, -62]];
const START = { x: 0, z: 56 };

function spline(pts: [number, number][], per = 60) {
  const out: { x: number; z: number }[] = [];
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const f = (a: number, b: number, c: number, d: number, t: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < per; k++) {
      const t = k / per, p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      out.push({ x: f(p0[0], p1[0], p2[0], p3[0], t), z: f(p0[1], p1[1], p2[1], p3[1], t) });
    }
  }
  out.push({ x: pts[pts.length - 1][0], z: pts[pts.length - 1][1] });
  return out;
}

export function createForestWorld(): ForestWorld {
  const path = spline(CONTROL);
  const landing = { x: CONTROL[2][0], z: CONTROL[2][1], r: 9, stack: 0 };
  const mill = { x: CONTROL[CONTROL.length - 1][0], z: CONTROL[CONTROL.length - 1][1], r: 8 };
  const V = (N + 1) * (N + 1);
  const heights = new Float32Array(V), colors = new Float32Array(V * 3);
  for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) {
    const v = r * (N + 1) + c, x = -HALF + c * CELL, z = -HALF + r * CELL;
    const { d, t } = nearestOnPath(path, x, z);
    const s = smooth(5, 14, d);
    const base = fbm(x * 0.03 + 7, z * 0.03) * 22;
    const h = (8 + 5 * Math.sin(t * 5.5)) * (1 - s) + base * s + (vnoise(x * 0.4, z * 0.4) - 0.5) * 0.8 * s;
    heights[v] = h;
    const dl = Math.hypot(x - landing.x, z - landing.z), dm = Math.hypot(x - mill.x, z - mill.z);
    const j = 0.88 + hash(c, r) * 0.24;
    let col: [number, number, number];
    if (dl < landing.r + 1 || dm < mill.r + 1) col = [0.52, 0.48, 0.42];
    else if (d < ROAD_WIDTH - 0.4) col = [0.5, 0.4, 0.28];
    else if (h > 17) col = [0.5, 0.5, 0.46];
    else if (h > 12) col = [0.32, 0.45, 0.26];
    else col = [0.25, 0.4, 0.2];
    colors.set([col[0] * j, col[1] * j, col[2] * j], v * 3);
  }
  const onRoad = new Uint8Array(N * N);
  const trees: Tree[] = [], cellTree = new Int32Array(N * N).fill(-1);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + (i + 0.5) * CELL, z = -HALF + (j + 0.5) * CELL;
    const { d } = nearestOnPath(path, x, z);
    if (d < ROAD_WIDTH) onRoad[j * N + i] = 1;
    const clear = d < ROAD_WIDTH + 1.2
      || Math.hypot(x - landing.x, z - landing.z) < landing.r + 1.5
      || Math.hypot(x - mill.x, z - mill.z) < mill.r + 1.5
      || Math.hypot(x - START.x, z - START.z) < 13
      || Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4;
    if (clear) continue;
    const grove = vnoise(x * 0.06 + 11, z * 0.06 + 3);
    if (hash(i * 3.1, j * 7.7) > 0.92 - grove * 0.22) {
      cellTree[j * N + i] = trees.length;
      trees.push({ x: x + (hash(i, j * 1.3) - 0.5) * 0.8, z: z + (hash(j, i * 1.7) - 0.5) * 0.8, s: 0.9 + hash(i * 1.9, j) * 0.7, alive: true });
    }
  }
  const w: ForestWorld = {
    heights, colors, path, onRoad, trees, cellTree, logs: [], nextLogId: 0, landing, mill,
    felled: 0, stacked: 0, delivered: 0, dirtyTrees: true, dirtyLogs: true,
  };
  return w;
}

export function forestHeightAt(w: ForestWorld, x: number, z: number) {
  const fx = Math.min(N - 0.001, Math.max(0, (x + HALF) / CELL)), fz = Math.min(N - 0.001, Math.max(0, (z + HALF) / CELL));
  const c = Math.floor(fx), r = Math.floor(fz), u = fx - c, v = fz - r;
  const H = w.heights, i = r * (N + 1) + c;
  return (H[i] * (1 - u) + H[i + 1] * u) * (1 - v) + (H[i + N + 1] * (1 - u) + H[i + N + 2] * u) * v;
}

const cellOf = (x: number, z: number) => {
  const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};

/** Nearest standing tree whose centre is within `reach` of (x, z). */
function treeNear(w: ForestWorld, x: number, z: number, reach: number): number {
  let best = -1, bd = reach;
  const ci = Math.floor((x + HALF) / CELL), cj = Math.floor((z + HALF) / CELL);
  const span = Math.ceil(reach / CELL) + 1;
  for (let dj = -span; dj <= span; dj++) for (let di = -span; di <= span; di++) {
    const i = ci + di, j = cj + dj;
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    const k = w.cellTree[j * N + i];
    if (k < 0) continue;
    const t = w.trees[k], d = Math.hypot(t.x - x, t.z - z);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

function makeVehicle(w: ForestWorld, kind: ForestMachine, pathIdx: number, side: number): ForestVehicle {
  const p = w.path[pathIdx], q = w.path[pathIdx + 3];
  const heading = Math.atan2(q.x - p.x, q.z - p.z);
  const x = p.x + Math.cos(heading) * side, z = p.z - Math.sin(heading) * side;
  return { kind, x, z, heading, speed: 0, pitch: 0, roll: 0, y: forestHeightAt(w, x, z), tipped: false, work: 0, logs: 0 };
}

export function createForestGame(): ForestGame {
  const w = createForestWorld();
  const vehicles = [makeVehicle(w, "feller", 14, -1.5), makeVehicle(w, "skidder", 6, 1.8), makeVehicle(w, "logtruck", 1, -2)];
  return {
    world: w, vehicles, active: 0, msg: "Cut into the forest with the feller buncher", msgT: 5, actionT: 0, won: false,
    time: 0, rollovers: 0, events: [], chopT: 0,
  };
}

export interface Input { throttle: number; steer: number; action: boolean }

function say(g: ForestGame, m: string) { g.msg = m; g.msgT = 2.5; }
function emit(g: ForestGame, e: ForestEvent) { if (g.events.length < 32) g.events.push(e); }

function grip(w: ForestWorld, v: ForestVehicle) {
  const c = cellOf(v.x, v.z), road = c >= 0 && w.onRoad[c] === 1;
  if (v.kind === "feller") return road ? 0.9 : 0.7;
  if (v.kind === "skidder") return road ? 1 : 0.75;
  return road ? 1 : v.logs > 0 ? 0.3 : 0.4; // the truck bogs down off the haul road
}

function stepVehicle(g: ForestGame, v: ForestVehicle, throttle: number, steer: number, dt: number) {
  const w = g.world, M = FOREST_MACHINES[v.kind];
  if (v.tipped) { throttle = 0; steer = 0; }
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const loadFactor = v.kind === "logtruck" ? 1 - (v.logs / TRUCK_CAPACITY) * 0.3 : v.kind === "skidder" ? 1 - (v.logs / SKIDDER_CAPACITY) * 0.15 : 1;
  v.speed += throttle * M.accel * loadFactor * dt;
  v.speed *= Math.exp(-DRAG * (throttle === 0 ? 1.5 : 0.3) * dt);
  const maxS = M.max * grip(w, v);
  v.speed = Math.max(-maxS * 0.5, Math.min(maxS, v.speed));
  v.heading += steer * M.turn * dt * Math.min(1, Math.abs(v.speed) / 1.5 + 0.35) * (v.speed < -0.1 ? -1 : 1);
  const nx = v.x + fx * v.speed * dt, nz = v.z + fz * v.speed * dt;
  const h0 = forestHeightAt(w, v.x, v.z), h1 = forestHeightAt(w, nx, nz);
  const dist = Math.hypot(nx - v.x, nz - v.z);
  const grade = dist > 1e-4 ? (h1 - h0) / dist : 0;
  const lim = HALF - 2;
  let blocked = grade > MAX_GRADE || Math.abs(nx) > lim || Math.abs(nz) > lim;
  if (!blocked) for (const o of g.vehicles) {
    if (o === v) continue;
    const d0 = Math.hypot(o.x - v.x, o.z - v.z), d1 = Math.hypot(o.x - nx, o.z - nz);
    if (d1 < VEH_RADIUS * 2 && d1 < d0) { blocked = true; break; }
  }
  if (!blocked) { // standing trees are solid: fell them or drive around
    const k = treeNear(w, nx, nz, TREE_RADIUS);
    if (k >= 0) {
      const t = w.trees[k];
      if (Math.hypot(t.x - nx, t.z - nz) < Math.hypot(t.x - v.x, t.z - v.z)) {
        blocked = true;
        if (v.kind === "feller" && v.speed > 1) say(g, "Tree in the way: hold Space to fell it");
      }
    }
  }
  if (blocked) v.speed *= -0.2;
  else {
    if (grade > 0) v.speed *= Math.exp(-grade * 2.5 * dt);
    v.x = nx; v.z = nz;
  }
  const L = 1.6;
  const hf = forestHeightAt(w, v.x + fx * L, v.z + fz * L), hb = forestHeightAt(w, v.x - fx * L, v.z - fz * L);
  const hr = forestHeightAt(w, v.x + fz * L, v.z - fx * L), hl = forestHeightAt(w, v.x - fz * L, v.z + fx * L);
  const tp = Math.atan2(hb - hf, 2 * L), trl = Math.atan2(hr - hl, 2 * L);
  const k = 1 - Math.exp(-6 * dt);
  if (v.tipped) v.roll += (Math.sign(v.roll || 1) * 1.4 - v.roll) * k;
  else {
    v.pitch += (tp - v.pitch) * k; v.roll += (trl - v.roll) * k;
    const topHeavy = v.kind === "logtruck" ? 1 + (v.logs / TRUCK_CAPACITY) * 0.4 : 1;
    if (Math.abs(v.roll) * topHeavy > TIP_ROLL || Math.abs(v.pitch) > TIP_PITCH) {
      v.tipped = true; v.speed = 0; g.rollovers++; emit(g, "tip");
      if (g.vehicles[g.active] === v) say(g, "Rolled over! Press R to recover");
    }
  }
  v.y += ((hf + hb + hl + hr) / 4 - v.y) * (1 - Math.exp(-10 * dt));
}

type Action = { label: string; time: number; run: () => void } | null;

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** What Space would do for the active vehicle right now. */
export function currentForestAction(g: ForestGame): Action {
  const w = g.world, v = g.vehicles[g.active];
  if (v.tipped) return null;
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const px = v.x + fx * 3, pz = v.z + fz * 3; // reach point
  if (v.kind === "feller") {
    const k = treeNear(w, px, pz, 2.8);
    if (k < 0) return null;
    return { label: "Fell tree", time: FELL_TIME, run: () => {
      const t = w.trees[k];
      t.alive = false; w.cellTree[cellOf(t.x, t.z)] = -1;
      w.logs.push({ id: w.nextLogId++, x: t.x + fx * 1.6, z: t.z + fz * 1.6, heading: v.heading + (hash(k, 3) - 0.5) * 0.5 });
      w.felled++; w.dirtyTrees = true; w.dirtyLogs = true;
      emit(g, "fell");
    } };
  }
  if (v.kind === "skidder") {
    if (v.logs > 0 && dist2(v, w.landing) < w.landing.r) {
      return { label: `Stack ${v.logs} log${v.logs > 1 ? "s" : ""} at landing`, time: STACK_TIME, run: () => {
        w.landing.stack += v.logs; w.stacked += v.logs; v.logs = 0; emit(g, "stack");
      } };
    }
    if (v.logs >= SKIDDER_CAPACITY) return { label: "Grapple full: take logs to the landing", time: Infinity, run: () => {} };
    let best = -1, bd = 3.4;
    w.logs.forEach((l, i) => { const d = dist2(l, { x: px, z: pz }); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return null;
    return { label: "Hook log", time: HOOK_TIME, run: () => {
      w.logs.splice(best, 1); v.logs++; w.dirtyLogs = true; emit(g, "hook");
    } };
  }
  // log truck: loads itself from the landing stack with its crane
  const atLanding = dist2(v, w.landing) < w.landing.r + 2;
  if (atLanding && w.landing.stack > 0) {
    if (v.logs >= TRUCK_CAPACITY) return { label: "Truck is full: haul it to the mill", time: Infinity, run: () => {} };
    return { label: "Load logs from the stack", time: LOAD_TIME, run: () => {
      const n = Math.min(w.landing.stack, TRUCK_CAPACITY - v.logs);
      w.landing.stack -= n; v.logs += n; emit(g, "load");
    } };
  }
  if (v.logs > 0 && dist2(v, w.mill) < w.mill.r) {
    return { label: `Deliver ${v.logs} log${v.logs > 1 ? "s" : ""} to the mill`, time: DELIVER_TIME, run: () => {
      w.delivered += v.logs; v.logs = 0; emit(g, "deliver");
    } };
  }
  return null;
}

export function stepForestGame(g: ForestGame, inp: Input, dt: number) {
  g.vehicles.forEach((v, i) => {
    const me = i === g.active;
    stepVehicle(g, v, me ? inp.throttle : 0, me ? inp.steer : 0, dt);
  });
  const v = g.vehicles[g.active];
  const act = inp.action ? currentForestAction(g) : null;
  if (act && Number.isFinite(act.time) && Math.abs(v.speed) < 1) {
    g.actionT += dt;
    if (v.kind === "feller" && (g.chopT += dt) > 0.28) { g.chopT = 0; emit(g, "chop"); }
    if (g.actionT >= act.time) { act.run(); g.actionT = 0; }
  } else { g.actionT = 0; g.chopT = 0; }
  for (const o of g.vehicles) o.work += ((o === v && g.actionT > 0 ? 1 : 0) - o.work) * (1 - Math.exp(-5 * dt));
  if (g.msgT > 0) g.msgT -= dt;
  if (!g.won) {
    g.time += dt;
    if (g.world.delivered >= LOG_TARGET) { g.won = true; emit(g, "win"); }
  }
}

export function selectForestVehicle(g: ForestGame, i: number) {
  if (i < 0 || i >= g.vehicles.length || i === g.active) return;
  g.vehicles[g.active].speed = 0;
  g.active = i; g.actionT = 0;
  const m = FOREST_MACHINES[g.vehicles[i].kind];
  say(g, `Now driving: ${m.nick} the ${m.label}`);
  emit(g, "switch");
}

export function cycleForestVehicle(g: ForestGame, dir: 1 | -1 = 1) {
  const n = g.vehicles.length;
  selectForestVehicle(g, (g.active + dir + n) % n);
}

export function recoverForest(g: ForestGame) {
  const v = g.vehicles[g.active], w = g.world;
  const n = nearestOnPath(w.path, v.x, v.z);
  const p = w.path[n.i], q = w.path[Math.min(w.path.length - 1, n.i + 3)];
  if (v.tipped || n.d > 6) { v.x = p.x; v.z = p.z; v.heading = Math.atan2(q.x - p.x, q.z - p.z); }
  v.tipped = false; v.roll = 0; v.pitch = 0; v.speed = 0;
}

export function forestProgress(w: ForestWorld) {
  return Math.min(1, w.delivered / LOG_TARGET);
}

/** What the crew should do next, and which machine should do it. */
export function forestHint(g: ForestGame): { text: string; machine: ForestMachine | null } {
  const w = g.world;
  const truck = g.vehicles.find((v) => v.kind === "logtruck")!, skidder = g.vehicles.find((v) => v.kind === "skidder")!;
  if (g.won) return { text: "Every log is at the mill!", machine: null };
  if (w.felled < LOG_TARGET) {
    const n = LOG_TARGET - w.felled;
    return { text: `Fell ${n} more tree${n > 1 ? "s" : ""}: drive into the forest, hold Space at a trunk`, machine: "feller" };
  }
  if (w.logs.length > 0 || skidder.logs > 0) {
    return skidder.logs > 0
      ? { text: "Take the logs to the landing (the grey clearing on the haul road)", machine: "skidder" }
      : { text: `Skid ${w.logs.length} log${w.logs.length > 1 ? "s" : ""} to the landing: hold Space beside a log`, machine: "skidder" };
  }
  if (w.landing.stack > 0 && truck.logs < TRUCK_CAPACITY) return { text: "Back the truck into the landing and load the stack", machine: "logtruck" };
  if (truck.logs > 0) return { text: "Haul the load down the road to the mill gate", machine: "logtruck" };
  return { text: "Finish the delivery", machine: null };
}

// Timber Ridge rules: restore the old logging road, then log the marked trees and haul them to the mill.
// Pure data + functions: no React / three, same as world.ts.
import { findCamp, type Camp } from "./campLayout";
import { DIFF, addDamage, burnFuel, makeEnv, wearFactor, type Collider, type Difficulty, type Env, type Fx, type FxKind } from "./shared";
import { CELL, HALF, N, fbm, hash, nearestOnPath, smooth, vnoise } from "./world";
import { arcLengths, pathPoint, startSlots, type StartSlot } from "./startLayout";

export { pathPoint, type StartSlot };

export type ForestMachine = "feller" | "grader" | "skidder" | "logtruck";
export const FOREST_MACHINES: Record<ForestMachine, { accel: number; max: number; turn: number; label: string; nick: string; tracks: boolean }> = {
  feller: { accel: 1.8, max: 4.5, turn: 1.1, label: "Feller Buncher", nick: "Timber", tracks: true },
  grader: { accel: 2.1, max: 6, turn: 1, label: "Motor Grader", nick: "Level", tracks: false },
  skidder: { accel: 2.6, max: 6.5, turn: 1.2, label: "Skidder", nick: "Drag", tracks: false },
  logtruck: { accel: 3.2, max: 9, turn: 1.1, label: "Log Truck", nick: "Haul", tracks: false },
};

export const LOG_TARGET = 18; // marked trees in the cut block; the truck holds 6, so three loads
export const SKIDDER_CAPACITY = 3;
export const LOG_LENGTH = 4; // metres; also what the renderer draws
export const HITCH_BACK = 3.2; // the claw hangs this far behind the skidder's centre
const HITCH_SPREAD = [0, -0.78, 0.78]; // each carried log is clamped this far to the side of the claw's centre line
const GRAB_TIME = 0.45; // s for a hooked log to slide its end into the claw
const SWING_IN = 2.6; // rad/s: a log that ends up ahead of the claw (hooked from the front) swings round to trail behind
export const TRUCK_CAPACITY = 6;
export const WASTE_ALLOWANCE = 6; // unmarked trees you may fell (to clear a path) before it costs a star
export const FALL_TIME = 1.15; // seconds for a felled tree to hit the ground
const FELL_TIME = 1.2;
const HOOK_TIME = 0.7;
const DRAG_TIME = 1;
const STACK_TIME = 0.8;
const LOAD_TIME = 1.2;
const DELIVER_TIME = 1.5;
const REFUEL_TIME = 2;
const VEH_RADIUS = 1.7;
const TREE_RADIUS = 1.35; // trunk + machine half-width, centre to centre
const TIP_ROLL = 0.5;
const TIP_PITCH = 0.6;
const DRAG = 1.4;
const MAX_GRADE = 0.75;
const GRADE_RATE = 1.4;
export const OPEN_AT = 0.85; // share of the road that must be levelled to reopen it
const CELL_HALF = 3.3; // the part of the road that has ruts to level
export const ROAD_WIDTH = 4.5;

// Field fuel: a small tank at the cut block holds ONE tankful. An NPC tanker truck tops it up from the mill depot.
export const FIELD_TANK_RADIUS = 5.5; // how close a machine must be to use it
const TANKER_SPEED = 8; // u/s along the road
const TANKER_FILL = 3; // s spent pumping at the tank
const TANKER_RELOAD = 10; // s at the depot before it can be sent again
const TANKER_CALL_BELOW = 0.5; // the tanker is sent when the field tank drops under this
const TANKER_YIELD = 5.5; // it waits for any machine this far ahead on the road
// Machines start parked in a row beside the road (see startLayout.ts); the log truck is nearest the mill.

export type TreeKind = "forest" | "marked" | "blocker";
export interface Tree { x: number; z: number; s: number; alive: boolean; kind: TreeKind }
/** A felled log lying on the ground; it can only be hooked once it has landed (`at`, in game time). */
export interface Log { id: number; x: number; z: number; heading: number; at: number }
/** A big log fallen across the old road. Only the skidder can drag it aside. */
export interface Deadfall { id: number; x: number; z: number; heading: number; cleared: boolean }
export interface RoadCell { cell: number; x: number; z: number; t: number; rut: number }
export interface Zone { x: number; z: number; r: number }
/**
 * A log towed by the skidder like a trailer: its front end (f) is held by the claw, its tail (t) swings freely
 * behind and is dragged round corners. (a) is where the front end was when hooked, so it slides into the claw.
 */
export interface DragLog { tx: number; tz: number; fx: number; fz: number; ax: number; az: number; g: number; sw?: boolean }
export interface FieldTank extends Zone { fuel: number; heading: number } // fuel: 1 = one full machine tank
export type TankerState = "depot" | "out" | "fill" | "back";
/** The NPC tanker: hidden at the depot, drives out along the road to the field tank, pumps, and drives back. */
export interface Tanker { state: TankerState; s: number; timer: number; x: number; y: number; z: number; heading: number; pitch: number; speed: number; waiting: boolean; waitT: number }

export interface ForestWorld {
  base: Float32Array; bump: Float32Array; rough: Float32Array; heights: Float32Array; colors: Float32Array; roadV: Uint8Array;
  path: { x: number; z: number }[]; cum: number[]; onRoad: Uint8Array;
  road: RoadCell[]; cellToRoad: Int32Array;
  trees: Tree[]; cellTree: Int32Array;
  logs: Log[]; nextLogId: number; deadfalls: Deadfall[];
  landing: Zone & { stack: number }; mill: Zone; camp: Camp; block: { x: number; z: number };
  start: StartSlot[]; fieldTank: FieldTank; tanker: Tanker; tankerStopS: number;
  felled: number; stacked: number; delivered: number; wasted: number; roadOpen: boolean;
  dirtyTerrain: boolean; dirtyTrees: boolean; dirtyLogs: boolean;
}

export type ForestEvent = "switch" | "tip" | "chop" | "fell" | "hook" | "stack" | "load" | "deliver" | "dig" | "win";

export interface ForestVehicle {
  kind: ForestMachine; x: number; y: number; z: number; heading: number; speed: number; pitch: number; roll: number;
  tipped: boolean; work: number;
  logs: number; // skidder grapple / truck bed
  drag: DragLog[]; // one per log the skidder carries (kept in step with `logs`)
  fuel: number; damage: number;
}

export interface ForestGame {
  world: ForestWorld; vehicles: ForestVehicle[]; active: number; msg: string; msgT: number; actionT: number; won: boolean;
  time: number; rollovers: number; events: ForestEvent[]; fx: Fx[]; env: Env; chopT: number; blockWarned: boolean;
}

// Mill gate at the first point, landing and cut block at the last. The old road winds between them.
const CONTROL: [number, number][] = [[10, 58], [10, 42], [-14, 24], [-34, 4], [-10, -18], [18, -32], [34, -50], [44, -68]];
const BLOCKS = { trees: [0.38, 0.74], falls: [0.2, 0.56] }; // route fractions of the road blockers

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

const cellOf = (x: number, z: number) => {
  const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};

export function createForestWorld(): ForestWorld {
  const path = spline(CONTROL);
  const cum = arcLengths(path);
  const endP = path[path.length - 1];
  const landing = { x: endP.x, z: endP.z, r: 9, stack: 0 };
  const mill = { x: path[0].x, z: path[0].z, r: 8 };
  const camp = findCamp(path, "TIMBER RIDGE", [{ x: mill.x, z: mill.z, r: 16 }, { x: landing.x, z: landing.z, r: 14 }]);
  const campT = nearestOnPath(path, camp.x, camp.z).t;
  const start = startSlots({ path, cum }, camp);
  const hPath = (t: number) => 8 + 5 * Math.sin(t * 5.5);
  const V = (N + 1) * (N + 1);
  const base = new Float32Array(V), bump = new Float32Array(V), rough = new Float32Array(V), heights = new Float32Array(V), colors = new Float32Array(V * 3), roadV = new Uint8Array(V);
  for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) {
    const v = r * (N + 1) + c, x = -HALF + c * CELL, z = -HALF + r * CELL;
    const { d, t } = nearestOnPath(path, x, z);
    const s = smooth(5, 14, d);
    const hills = fbm(x * 0.03 + 7, z * 0.03) * 22;
    const plateau = 1 - smooth(21, 34, Math.hypot(x - camp.mid.x, z - camp.mid.z)); // level ground under the camp
    base[v] = (hPath(t) * (1 - s) + hills * s) * (1 - plateau) + hPath(campT) * plateau;
    bump[v] = (vnoise(x * 0.4, z * 0.4) - 0.5) * 2.2 * (1 - smooth(3.4, 5.6, d)); // the old road is badly rutted
    rough[v] = 1;
    if (d < CELL_HALF + 0.3) roadV[v] = 1;
    const dl = Math.hypot(x - landing.x, z - landing.z), dm = Math.hypot(x - mill.x, z - mill.z), dc = Math.hypot(x - camp.mid.x, z - camp.mid.z);
    const h = base[v];
    let col: [number, number, number];
    if (dl < landing.r + 1 || dm < mill.r + 1 || dc < 24) col = [0.52, 0.48, 0.42];
    else if (h > 17) col = [0.5, 0.5, 0.46];
    else if (h > 12) col = [0.32, 0.45, 0.26];
    else col = [0.25, 0.4, 0.2];
    const j = 0.88 + hash(c, r) * 0.24;
    colors.set([col[0] * j, col[1] * j, col[2] * j], v * 3);
  }
  const onRoad = new Uint8Array(N * N), cellToRoad = new Int32Array(N * N).fill(-1);
  const road: RoadCell[] = [];
  const trees: Tree[] = [], cellTree = new Int32Array(N * N).fill(-1);
  const block = { x: landing.x - 8, z: landing.z + 12 }; // roughly the middle of the cut block
  const inBlock = (x: number, z: number) => { const d = Math.hypot(x - landing.x, z - landing.z); return d > landing.r + 3 && d < 34; };
  const spare: number[] = []; // free forest tree indices inside the cut block
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + (i + 0.5) * CELL, z = -HALF + (j + 0.5) * CELL;
    const { d, t } = nearestOnPath(path, x, z);
    if (d < ROAD_WIDTH) onRoad[j * N + i] = 1;
    if (d < CELL_HALF) { cellToRoad[j * N + i] = road.length; road.push({ cell: j * N + i, x, z, t, rut: 1 }); }
    const clear = d < ROAD_WIDTH + 1.2
      || Math.hypot(x - landing.x, z - landing.z) < landing.r + 1.5
      || Math.hypot(x - mill.x, z - mill.z) < mill.r + 1.5
      || Math.hypot(x - camp.mid.x, z - camp.mid.z) < 27
      || start.some((q) => Math.hypot(x - q.x, z - q.z) < 6)
      || Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4;
    if (clear) continue;
    const grove = vnoise(x * 0.06 + 11, z * 0.06 + 3);
    if (hash(i * 3.1, j * 7.7) > 0.92 - grove * 0.22) {
      cellTree[j * N + i] = trees.length;
      if (inBlock(x, z)) spare.push(trees.length);
      trees.push({ x: x + (hash(i, j * 1.3) - 0.5) * 0.8, z: z + (hash(j, i * 1.7) - 0.5) * 0.8, s: 0.9 + hash(i * 1.9, j) * 0.7, alive: true, kind: "forest" });
    }
  }
  // road blockers: clusters of trees growing across the old road, and big logs fallen over it
  const dir = (i: number) => { const a = path[i], b = path[Math.min(path.length - 1, i + 3)]; return Math.atan2(b.x - a.x, b.z - a.z); };
  for (const f of BLOCKS.trees) {
    const i = Math.round(f * (path.length - 1)), h = dir(i), p = path[i];
    for (const off of [-3.4, 0, 3.4]) {
      const x = p.x + Math.cos(h) * off, z = p.z - Math.sin(h) * off, c = cellOf(x, z);
      if (c < 0) continue;
      if (cellTree[c] >= 0) { trees[cellTree[c]].kind = "blocker"; continue; }
      cellTree[c] = trees.length;
      trees.push({ x, z, s: 1.3, alive: true, kind: "blocker" });
    }
  }
  const deadfalls: Deadfall[] = BLOCKS.falls.map((f, id) => {
    const i = Math.round(f * (path.length - 1)), h = dir(i);
    return { id, x: path[i].x, z: path[i].z, heading: h + Math.PI / 2 + (id ? -0.2 : 0.15), cleared: false };
  });
  // marked trees: spread through the cut block, never right beside each other
  const marked: number[] = [];
  const order = [...spare].sort((a, b) => hash(a, 5) - hash(b, 5));
  for (const sep of [7, 5, 3.5]) {
    for (const k of order) {
      if (marked.length >= LOG_TARGET) break;
      if (marked.includes(k)) continue;
      if (marked.every((m) => Math.hypot(trees[m].x - trees[k].x, trees[m].z - trees[k].z) >= sep)) marked.push(k);
    }
  }
  for (const k of marked) { trees[k].kind = "marked"; trees[k].s = 1.15; }
  // field fuel tank: inside the landing clearing, as far from the road as it fits and clear of the log pile
  const pile = { x: landing.x + 7.5, z: landing.z - 2 };
  let fieldTank: FieldTank = { x: landing.x, z: landing.z, r: FIELD_TANK_RADIUS, fuel: 1, heading: 0 }, bestFar = -1;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
    const x = landing.x + Math.cos(a) * 6.5, z = landing.z + Math.sin(a) * 6.5;
    if (Math.hypot(x - pile.x, z - pile.z) < 6 || Math.abs(x) > HALF - 6 || Math.abs(z) > HALF - 6) continue;
    const near = nearestOnPath(path, x, z);
    if (near.d > bestFar) { bestFar = near.d; fieldTank = { x, z, r: FIELD_TANK_RADIUS, fuel: 1, heading: Math.atan2(path[near.i].x - x, path[near.i].z - z) }; }
  }
  const tankerStopS = Math.max(0, Math.min(cum[cum.length - 1] - 4, cum[nearestOnPath(path, fieldTank.x, fieldTank.z).i]));
  const tanker: Tanker = { state: "depot", s: 0, timer: 0, x: path[0].x, y: 0, z: path[0].z, heading: 0, pitch: 0, speed: 0, waiting: false, waitT: 0 };
  const w: ForestWorld = {
    base, bump, rough, heights, colors, roadV, path, cum, onRoad, road, cellToRoad, trees, cellTree,
    logs: [], nextLogId: 0, deadfalls, landing, mill, camp, block, start, fieldTank, tanker, tankerStopS,
    felled: 0, stacked: 0, delivered: 0, wasted: 0, roadOpen: false,
    dirtyTerrain: true, dirtyTrees: true, dirtyLogs: true,
  };
  recomputeForestHeights(w);
  tanker.y = forestHeightAt(w, tanker.x, tanker.z);
  return w;
}

export function recomputeForestHeights(w: ForestWorld) {
  for (let v = 0; v < w.heights.length; v++) w.heights[v] = w.base[v] + w.bump[v] * w.rough[v];
}

export function forestHeightAt(w: ForestWorld, x: number, z: number) {
  const fx = Math.min(N - 0.001, Math.max(0, (x + HALF) / CELL)), fz = Math.min(N - 0.001, Math.max(0, (z + HALF) / CELL));
  const c = Math.floor(fx), r = Math.floor(fz), u = fx - c, v = fz - r;
  const H = w.heights, i = r * (N + 1) + c;
  return (H[i] * (1 - u) + H[i + 1] * u) * (1 - v) + (H[i + N + 1] * (1 - u) + H[i + N + 2] * u) * v;
}

export const blockersLeft = (w: ForestWorld) =>
  w.trees.filter((t) => t.kind === "blocker" && t.alive).length + w.deadfalls.filter((d) => !d.cleared).length;
export const blockersTotal = (w: ForestWorld) => w.trees.filter((t) => t.kind === "blocker").length + w.deadfalls.length;
export const roadLevelled = (w: ForestWorld) => w.road.filter((r) => r.rut < 0.06).length / w.road.length;

/** Solid circles for deadfall logs (five along each log). */
function deadfallColliders(w: ForestWorld): Collider[] {
  const out: Collider[] = [];
  for (const d of w.deadfalls) if (!d.cleared) for (let k = -2; k <= 2; k++) out.push({ x: d.x + Math.sin(d.heading) * k * 2, z: d.z + Math.cos(d.heading) * k * 2, r: 1.1 });
  return out;
}

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

function makeVehicle(w: ForestWorld, kind: ForestMachine, slot: StartSlot): ForestVehicle {
  const { x, z, heading } = slot;
  return { kind, x, y: forestHeightAt(w, x, z), z, heading, speed: 0, pitch: 0, roll: 0, tipped: false, work: 0, logs: 0, drag: [], fuel: 1, damage: 0 };
}

export function createForestGame(diff: Difficulty = "normal"): ForestGame {
  const w = createForestWorld();
  const kinds: ForestMachine[] = ["feller", "grader", "skidder", "logtruck"];
  const vehicles = kinds.map((k, i) => makeVehicle(w, k, w.start[i]));
  return {
    world: w, vehicles, active: 0, msg: "The old logging road is overgrown: clear the blockers first", msgT: 6, actionT: 0, won: false,
    time: 0, rollovers: 0, events: [], fx: [], env: makeEnv(diff), chopT: 0, blockWarned: false,
  };
}

export interface Input { throttle: number; steer: number; action: boolean }

function say(g: ForestGame, m: string) { g.msg = m; g.msgT = 2.5; }
function emit(g: ForestGame, e: ForestEvent) { if (g.events.length < 32) g.events.push(e); }
function puff(g: ForestGame, kind: FxKind, x: number, z: number, n = 8, extra: Partial<Fx> = {}) {
  if (g.fx.length < 64) g.fx.push({ kind, x, y: forestHeightAt(g.world, x, z), z, n, ...extra });
}

function setLevel(w: ForestWorld, rc: RoadCell, rut: number) {
  rc.rut = rut;
  const i = rc.cell % N, j = Math.floor(rc.cell / N);
  for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const v = (j + dj) * (N + 1) + (i + di);
    w.rough[v] = Math.min(w.rough[v], rut);
  }
  w.dirtyTerrain = true;
}

function grip(w: ForestWorld, v: ForestVehicle) {
  const c = cellOf(v.x, v.z), road = c >= 0 && w.onRoad[c] === 1;
  const rut = road && w.cellToRoad[c] >= 0 ? w.road[w.cellToRoad[c]].rut : 0;
  if (v.kind === "feller") return road ? 0.9 - 0.2 * rut : 0.7;
  if (v.kind === "logtruck") return road ? 1 - 0.35 * rut : v.logs > 0 ? 0.3 : 0.4; // the truck bogs down off the haul road
  return road ? 1 - 0.3 * rut : 0.75;
}

/** Where log `i` is clamped by the claw (behind the skidder). */
export function hitchPoint(v: { x: number; z: number; heading: number }, i: number) {
  const f = Math.sin(v.heading), c = Math.cos(v.heading), o = HITCH_SPREAD[i] ?? 0;
  return { x: v.x - f * HITCH_BACK + c * o, z: v.z - c * HITCH_BACK - f * o };
}

/** Keep one DragLog per carried log; a log that just appeared hangs straight behind the claw. */
function syncDrag(v: ForestVehicle) {
  if (v.drag.length > v.logs) v.drag.length = v.logs;
  while (v.drag.length < v.logs) {
    const h = hitchPoint(v, v.drag.length);
    v.drag.push({ tx: h.x - Math.sin(v.heading) * LOG_LENGTH, tz: h.z - Math.cos(v.heading) * LOG_LENGTH, fx: h.x, fz: h.z, ax: h.x, az: h.z, g: 1 });
  }
}

/** Trailer kinematics: the front end follows the claw, the tail keeps its distance and trails along behind it. */
function stepDrag(v: ForestVehicle, dt: number) {
  syncDrag(v);
  v.drag.forEach((d, i) => {
    const h = hitchPoint(v, i);
    d.g = Math.min(1, d.g + dt / GRAB_TIME);
    const e = d.g * d.g * (3 - 2 * d.g);
    d.fx = d.ax + (h.x - d.ax) * e; d.fz = d.az + (h.z - d.az) * e;
    let dx = d.fx - d.tx, dz = d.fz - d.tz;
    const len = Math.hypot(dx, dz);
    if (len > 1e-3) { dx /= len; dz /= len; } else { dx = Math.sin(v.heading); dz = Math.cos(v.heading); }
    const phi = Math.atan2(Math.sin(v.heading - Math.atan2(dx, dz)), Math.cos(v.heading - Math.atan2(dx, dz))); // angle from the log's direction to the machine's
    if (Math.cos(phi) < 0.3) d.sw = true; // tail is ahead of / beside the claw: swing it round behind, until it is lined up
    else if (Math.cos(phi) > 0.97) d.sw = false;
    if (d.sw) {
      const hd = Math.atan2(dx, dz) + Math.max(-SWING_IN * dt, Math.min(SWING_IN * dt, phi));
      dx = Math.sin(hd); dz = Math.cos(hd);
    }
    d.tx = d.fx - dx * LOG_LENGTH; d.tz = d.fz - dz * LOG_LENGTH;
  });
}

function stepVehicle(g: ForestGame, v: ForestVehicle, throttle: number, steer: number, dt: number, me: boolean) {
  const w = g.world, M = FOREST_MACHINES[v.kind], D = DIFF[g.env.diff];
  if (v.tipped) { throttle = 0; steer = 0; }
  if (me && !v.tipped) burnFuel(v, dt, throttle, g.actionT > 0, g.env.diff);
  if (v.fuel <= 0) {
    if (me && throttle !== 0 && g.msgT <= 0) say(g, "Out of fuel! Press R to be towed back to camp (+20 s)");
    throttle = 0;
  }
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const loadFactor = v.kind === "logtruck" ? 1 - (v.logs / TRUCK_CAPACITY) * 0.3 : v.kind === "skidder" ? 1 - (v.logs / SKIDDER_CAPACITY) * 0.15 : 1;
  v.speed += throttle * M.accel * loadFactor * dt;
  v.speed *= Math.exp(-DRAG * (throttle === 0 ? 1.5 : 0.3) * dt);
  const maxS = M.max * Math.min(1.15, grip(w, v) * g.env.gripMul * D.grip) * wearFactor(v);
  v.speed = Math.max(-maxS * 0.5, Math.min(maxS, v.speed));
  v.heading += steer * M.turn * dt * Math.min(1, Math.abs(v.speed) / 1.5 + 0.35) * (v.speed < -0.1 ? -1 : 1);
  const nx = v.x + fx * v.speed * dt, nz = v.z + fz * v.speed * dt;
  const h0 = forestHeightAt(w, v.x, v.z), h1 = forestHeightAt(w, nx, nz);
  const dist = Math.hypot(nx - v.x, nz - v.z);
  const grade = dist > 1e-4 ? (h1 - h0) / dist : 0;
  const lim = HALF - 2;
  let blocked = grade > MAX_GRADE || Math.abs(nx) > lim || Math.abs(nz) > lim;
  const away = (o: { x: number; z: number }, rad: number) => {
    const d0 = Math.hypot(o.x - v.x, o.z - v.z), d1 = Math.hypot(o.x - nx, o.z - nz);
    return d1 < rad && d1 < d0;
  };
  if (!blocked) for (const o of g.vehicles) if (o !== v && away(o, VEH_RADIUS * 2)) { blocked = true; break; }
  if (!blocked) for (const c of w.camp.colliders) if (away(c, VEH_RADIUS * 0.9 + c.r)) { blocked = true; break; }
  if (!blocked && away(w.fieldTank, VEH_RADIUS * 0.9 + 1.3)) blocked = true;
  if (!blocked && w.tanker.state !== "depot" && away(w.tanker, VEH_RADIUS + 1.8)) blocked = true;
  if (!blocked) for (const c of deadfallColliders(w)) if (away(c, VEH_RADIUS * 0.9 + c.r)) { blocked = true; if (me && v.kind !== "skidder") say(g, "Deadfall across the road: only the skidder can drag it aside"); break; }
  if (!blocked) { // standing trees are solid: fell them or drive around
    const k = treeNear(w, nx, nz, TREE_RADIUS);
    if (k >= 0 && away(w.trees[k], TREE_RADIUS)) {
      blocked = true;
      if (v.kind === "feller" && v.speed > 1) say(g, "Tree in the way: hold Space to fell it");
    }
  }
  if (blocked) {
    const hit = Math.abs(v.speed);
    if (hit > 2.5) { addDamage(v, Math.min(0.08, hit * 0.01)); emit(g, "dig"); puff(g, "dust", nx, nz, 5); }
    v.speed *= -0.2;
  } else {
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
    if (Math.abs(v.roll) * topHeavy > TIP_ROLL * D.tip || Math.abs(v.pitch) > TIP_PITCH * D.tip) {
      v.tipped = true; v.speed = 0; g.rollovers++; addDamage(v, 0.2); emit(g, "tip"); puff(g, "dust", v.x, v.z, 14);
      if (g.vehicles[g.active] === v) say(g, "Rolled over! Press R to recover");
    }
  }
  v.y += ((hf + hb + hl + hr) / 4 - v.y) * (1 - Math.exp(-10 * dt));
  if (v.kind === "skidder") stepDrag(v, dt);

  // the grader levels the ruts it drives over
  if (v.kind === "grader" && !v.tipped && Math.abs(v.speed) > 0.4) {
    const work = Math.abs(v.speed) / M.max;
    for (const off of [-2.6, -1.3, 0, 1.3, 2.6]) {
      const c = cellOf(v.x + fx * 2.4 + fz * off, v.z + fz * 2.4 - fx * off), k2 = c >= 0 ? w.cellToRoad[c] : -1;
      if (k2 < 0) continue;
      const rc = w.road[k2];
      if (rc.rut > 0) setLevel(w, rc, Math.max(0, rc.rut - GRADE_RATE * dt * (0.5 + work)));
    }
    if (g.vehicles[g.active] === v && Math.random() < 0.3) puff(g, "dust", v.x + fx * 2.4, v.z + fz * 2.4, 1);
  }
}

/** `blocked` is a reason the job cannot be done yet: it is shown whenever Space is held. */
type Action = { label: string; time: number; run: () => void; blocked?: string } | null;

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** What Space would do for the active vehicle right now. */
export function currentForestAction(g: ForestGame): Action {
  const w = g.world, v = g.vehicles[g.active];
  if (v.tipped) return null;
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const px = v.x + fx * 3, pz = v.z + fz * 3; // reach point
  const pump = w.camp.fuel;
  if (dist2(v, pump) < pump.r && (v.fuel < 0.97 || v.damage > 0.03)) {
    return { label: "Refuel & repair", time: REFUEL_TIME, run: () => { v.fuel = 1; v.damage = 0; emit(g, "load"); say(g, "Tank full, machine repaired"); } };
  }
  const ft = w.fieldTank;
  if (dist2(v, ft) < ft.r && v.fuel < 0.97) {
    if (ft.fuel < 0.02) {
      const eta = tankerEta(w);
      const label = eta === null ? "Field tank empty: the tanker comes once the road is open" : `Field tank empty: tanker arrives in ${Math.ceil(eta)} s`;
      return { label, time: Infinity, run: () => {}, blocked: label };
    }
    const part = ft.fuel < 1 - v.fuel - 0.02;
    return { label: part ? `Refuel from field tank (only ${Math.round(ft.fuel * 100)}% left)` : "Refuel from field tank", time: REFUEL_TIME, run: () => {
      const give = Math.min(ft.fuel, 1 - v.fuel);
      ft.fuel -= give; v.fuel += give; emit(g, "load");
      const eta = tankerEta(w);
      if (ft.fuel >= TANKER_CALL_BELOW) say(g, "Refuelled from the field tank");
      else say(g, eta === null ? "Field tank is low: the tanker comes once the road is open" : `Field tank is low: tanker called, back in about ${Math.ceil(eta)} s`);
    } };
  }
  if (v.kind === "feller") {
    const k = treeNear(w, px, pz, 2.8);
    if (k < 0) return null;
    const t = w.trees[k];
    if (t.kind === "marked" && !w.roadOpen) { // never let a marked tree be cut early: it would be lost for good
      const why = "Cut block closed: restore the road first (clear blockers, grade 85%)";
      return { label: why, time: Infinity, run: () => {}, blocked: why };
    }
    const label = t.kind === "blocker" ? "Fell blocking tree" : t.kind === "marked" ? "Fell marked tree" : "Fell tree (not marked: no log)";
    return { label, time: FELL_TIME, run: () => {
      t.alive = false; w.cellTree[cellOf(t.x, t.z)] = -1;
      w.dirtyTrees = true;
      puff(g, "treefall", t.x, t.z, 1, { heading: v.heading, s: t.s });
      puff(g, "sawdust", t.x, t.z, 16);
      emit(g, "fell");
      if (t.kind === "blocker") {
        const left = blockersLeft(w);
        say(g, left ? `Blocker cleared: ${left} left` : "All blockers cleared! Now level the road with the grader");
      } else if (t.kind === "marked") {
        w.logs.push({ id: w.nextLogId++, x: t.x + fx * 2.2, z: t.z + fz * 2.2, heading: v.heading + (hash(k, 3) - 0.5) * 0.5, at: g.time + FALL_TIME });
        w.felled++; w.dirtyLogs = true;
      } else {
        w.wasted++;
        say(g, "Not a marked tree: wasted");
      }
    } };
  }
  if (v.kind === "grader") return null; // levels the road just by driving along it
  if (v.kind === "skidder") {
    if (v.logs > 0 && dist2(v, w.landing) < w.landing.r) {
      return { label: `Stack ${v.logs} log${v.logs > 1 ? "s" : ""} at landing`, time: STACK_TIME, run: () => {
        w.landing.stack += v.logs; w.stacked += v.logs; v.logs = 0; emit(g, "stack"); puff(g, "dust", w.landing.x + 7.5, w.landing.z - 2, 10);
      } };
    }
    const fall = w.deadfalls.find((d) => !d.cleared && Math.abs((px - d.x) * Math.cos(d.heading) - (pz - d.z) * Math.sin(d.heading)) < 3.5 && Math.abs((px - d.x) * Math.sin(d.heading) + (pz - d.z) * Math.cos(d.heading)) < 5.5);
    if (fall) {
      return { label: "Drag deadfall off the road", time: DRAG_TIME, run: () => {
        fall.cleared = true; w.dirtyLogs = true; emit(g, "hook"); puff(g, "dust", fall.x, fall.z, 16);
        const left = blockersLeft(w);
        say(g, left ? `Deadfall cleared: ${left} blockers left` : "All blockers cleared! Now level the road with the grader");
      } };
    }
    if (v.logs >= SKIDDER_CAPACITY) return { label: "Grapple full: take logs to the landing", time: Infinity, run: () => {} };
    // a log can be hooked from the front of the machine or from the claw at the back
    let best = -1, bd = 3.4;
    const claw = hitchPoint(v, v.logs);
    w.logs.forEach((l, i) => { const d = Math.min(dist2(l, { x: px, z: pz }), dist2(l, claw)); if (l.at <= g.time && d < bd) { bd = d; best = i; } });
    if (best < 0) return null;
    return { label: "Hook log", time: HOOK_TIME, run: () => {
      syncDrag(v);
      const l = w.logs[best], h = hitchPoint(v, v.drag.length), dx = Math.sin(l.heading) * LOG_LENGTH / 2, dz = Math.cos(l.heading) * LOG_LENGTH / 2;
      const e1 = { x: l.x + dx, z: l.z + dz }, e2 = { x: l.x - dx, z: l.z - dz };
      const [near, far] = dist2(e1, h) <= dist2(e2, h) ? [e1, e2] : [e2, e1]; // the claw grabs the end of the log nearest to it
      w.logs.splice(best, 1); v.logs++; w.dirtyLogs = true; emit(g, "hook");
      v.drag.push({ tx: far.x, tz: far.z, fx: near.x, fz: near.z, ax: near.x, az: near.z, g: 0 });
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
      w.delivered += v.logs; v.logs = 0; emit(g, "deliver"); say(g, `${w.delivered}/${LOG_TARGET} logs delivered`);
    } };
  }
  return null;
}

/** Seconds until the field tank is full again, or null while the tanker cannot leave (road still closed). */
export function tankerEta(w: ForestWorld): number | null {
  const T = w.tanker, S = w.tankerStopS;
  switch (T.state) {
    case "depot": return w.roadOpen ? T.timer + S / TANKER_SPEED + TANKER_FILL : null;
    case "out": return (S - T.s) / TANKER_SPEED + TANKER_FILL;
    case "fill": return Math.max(0, T.timer);
    case "back": return T.s / TANKER_SPEED + TANKER_RELOAD + S / TANKER_SPEED + TANKER_FILL;
  }
}

/** The NPC tanker: sent from the depot whenever the field tank runs low and the road is open. */
function stepTanker(g: ForestGame, dt: number) {
  const w = g.world, T = w.tanker, tank = w.fieldTank;
  T.speed = 0; T.waiting = false;
  if (T.state === "depot") {
    T.timer = Math.max(0, T.timer - dt);
    if (w.roadOpen && T.timer <= 0 && tank.fuel < TANKER_CALL_BELOW) { T.state = "out"; T.s = 0; T.waitT = 0; }
    return;
  }
  if (T.state === "fill") {
    T.timer -= dt;
    if (T.timer <= 0) { tank.fuel = 1; T.state = "back"; emit(g, "load"); say(g, "Tanker delivered: the field tank is full"); }
    return;
  }
  const dir = T.state === "out" ? 1 : -1;
  const hx = Math.sin(T.heading), hz = Math.cos(T.heading);
  T.waiting = g.vehicles.some((o) => {
    const dx = o.x - T.x, dz = o.z - T.z, ahead = dx * hx + dz * hz;
    return ahead > 0 && ahead < TANKER_YIELD && Math.abs(dx * hz - dz * hx) < 2.6;
  });
  if (T.waiting) {
    T.waitT += dt;
    if (T.waitT > 2.5 && g.msgT <= 0) { say(g, "The tanker is stuck behind a machine: move off the road"); T.waitT = -6; }
  } else {
    T.waitT = 0; T.s += dir * TANKER_SPEED * dt; T.speed = TANKER_SPEED;
  }
  if (T.state === "out" && T.s >= w.tankerStopS) { T.s = w.tankerStopS; T.state = "fill"; T.timer = TANKER_FILL; T.speed = 0; }
  else if (T.state === "back" && T.s <= 0) { T.s = 0; T.state = "depot"; T.timer = TANKER_RELOAD; T.speed = 0; return; }
  const p = pathPoint(w, T.s);
  T.x = p.x; T.z = p.z; T.heading = dir > 0 ? p.heading : p.heading + Math.PI;
  const L = 2.2, f = Math.sin(T.heading), c = Math.cos(T.heading);
  const hf = forestHeightAt(w, T.x + f * L, T.z + c * L), hb = forestHeightAt(w, T.x - f * L, T.z - c * L);
  T.pitch = Math.atan2(hb - hf, 2 * L); T.y = (hf + hb) / 2;
}

export function stepForestGame(g: ForestGame, inp: Input, dt: number) {
  g.vehicles.forEach((v, i) => {
    const me = i === g.active;
    stepVehicle(g, v, me ? inp.throttle : 0, me ? inp.steer : 0, dt, me);
  });
  stepTanker(g, dt);
  const w = g.world, v = g.vehicles[g.active];
  const act = inp.action ? currentForestAction(g) : null;
  if (act?.blocked && g.msgT <= 0) say(g, act.blocked);
  if (!w.roadOpen && !g.blockWarned && dist2(v, w.landing) < 32) { // first time anyone drives into the cut block
    g.blockWarned = true; say(g, "Cut block is closed until the road is restored");
  }
  if (act && Number.isFinite(act.time) && Math.abs(v.speed) < 1) {
    g.actionT += dt;
    if (v.kind === "feller" && (g.chopT += dt) > 0.28) { g.chopT = 0; emit(g, "chop"); }
    if (g.actionT >= act.time) { act.run(); g.actionT = 0; }
  } else { g.actionT = 0; g.chopT = 0; }
  for (const o of g.vehicles) o.work += ((o === v && g.actionT > 0 ? 1 : 0) - o.work) * (1 - Math.exp(-5 * dt));
  if (g.msgT > 0) g.msgT -= dt;
  if (!w.roadOpen && blockersLeft(w) === 0 && roadLevelled(w) >= OPEN_AT) {
    w.roadOpen = true; w.dirtyTrees = true; emit(g, "stack");
    say(g, "Road restored! The cut block is open: fell the trees with orange ribbons");
  }
  if (!g.won) {
    g.time += dt;
    if (w.delivered >= LOG_TARGET) { g.won = true; emit(g, "win"); }
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
  if (v.fuel <= 0) { // out of fuel: tow to the pump, with a time penalty
    const c = w.camp.fuel, n = nearestOnPath(w.path, c.x, c.z), q = w.path[Math.min(w.path.length - 1, n.i + 3)];
    v.x = c.x; v.z = c.z; v.heading = Math.atan2(q.x - w.path[n.i].x, q.z - w.path[n.i].z);
    v.fuel = 0.3; v.tipped = false; v.roll = 0; v.pitch = 0; v.speed = 0; g.time += 20;
    say(g, "Towed back to camp (+20 s)");
    return;
  }
  const n = nearestOnPath(w.path, v.x, v.z);
  const p = w.path[n.i], q = w.path[Math.min(w.path.length - 1, n.i + 3)];
  if (v.tipped || n.d > 6) { v.x = p.x; v.z = p.z; v.heading = Math.atan2(q.x - p.x, q.z - p.z); }
  v.tipped = false; v.roll = 0; v.pitch = 0; v.speed = 0;
}

export function forestProgress(w: ForestWorld) {
  const road = (1 - blockersLeft(w) / Math.max(1, blockersTotal(w))) * 0.5 + roadLevelled(w) * 0.5;
  return w.roadOpen ? 0.25 + 0.75 * Math.min(1, w.delivered / LOG_TARGET) : 0.25 * road;
}

/** What the crew should do next, and which machine should do it. */
export function forestHint(g: ForestGame): { text: string; machine: ForestMachine | null } {
  const w = g.world;
  const truck = g.vehicles.find((v) => v.kind === "logtruck")!, skidder = g.vehicles.find((v) => v.kind === "skidder")!;
  if (g.won) return { text: "Every log is at the mill!", machine: null };
  const left = blockersLeft(w);
  if (left > 0) {
    // the nearest unfinished blocker along the road decides who is needed
    const treeT = Math.min(...w.trees.filter((t) => t.kind === "blocker" && t.alive).map((t) => nearestOnPath(w.path, t.x, t.z).t), 2);
    const fallT = Math.min(...w.deadfalls.filter((d) => !d.cleared).map((d) => nearestOnPath(w.path, d.x, d.z).t), 2);
    return treeT <= fallT
      ? { text: `Fell the trees blocking the old road (${left} blockers left)`, machine: "feller" }
      : { text: `Drag the fallen log off the road: hold Space at it (${left} blockers left)`, machine: "skidder" };
  }
  if (!w.roadOpen) return { text: `Level the rutted road: drive the grader along the red and amber flags (${Math.floor(roadLevelled(w) * 100)}% of ${Math.round(OPEN_AT * 100)}%)`, machine: "grader" };
  if (w.felled < LOG_TARGET) {
    const n = LOG_TARGET - w.felled;
    return { text: `Fell the ${n} marked tree${n > 1 ? "s" : ""} with orange ribbons in the cut block (end of the road)`, machine: "feller" };
  }
  if (w.logs.length > 0 || skidder.logs > 0) {
    return skidder.logs > 0
      ? { text: "Take the logs to the landing (the grey clearing)", machine: "skidder" }
      : { text: `Skid ${w.logs.length} log${w.logs.length > 1 ? "s" : ""} to the landing: hold Space with the front or the claw beside a log`, machine: "skidder" };
  }
  if (w.landing.stack > 0 && truck.logs < TRUCK_CAPACITY) return { text: "Back the truck into the landing and load the stack", machine: "logtruck" };
  if (truck.logs > 0) return { text: "Haul the load down the road to the mill gate", machine: "logtruck" };
  return { text: "Finish the delivery", machine: null };
}

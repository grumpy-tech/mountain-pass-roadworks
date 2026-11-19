// Pure game rules: terrain generation, road job state, vehicle sim. No React / three.
import { findCamp, type Camp } from "./campLayout";
import { DIFF, addDamage, burnFuel, makeEnv, wearFactor, type Difficulty, type Env, type Fx, type FxKind, LOW_FUEL } from "./shared";
import { arcLengths, nearSlot, padWeight, startSlots, type StartSlot } from "./startLayout";
export const N = 80; // cells per side
export const CELL = 2;
export const HALF = (N * CELL) / 2;
export const ROAD_HALF_WIDTH = 3.2;

export type Machine = "dozer" | "excavator" | "truck" | "paver";
export const MACHINES: Record<Machine, { accel: number; max: number; turn: number; label: string; nick: string; tracks: boolean }> = {
  dozer: { accel: 2.2, max: 5.5, turn: 1.1, label: "Bulldozer", nick: "Bruiser", tracks: true },
  excavator: { accel: 1.6, max: 3.5, turn: 1.0, label: "Excavator", nick: "Scoop", tracks: true },
  truck: { accel: 3.2, max: 9, turn: 1.2, label: "Dump Truck", nick: "Rumble", tracks: false },
  paver: { accel: 1.6, max: 4, turn: 0.9, label: "Paver", nick: "Smooth", tracks: true },
};
export const TRUCK_CAPACITY = 6;
const DIG_TIME = 1.1;
const LOAD_TIME = 0.6;
const FILL_TIME = 0.8;
const DUMP_TIME = 1.2;
const REFUEL_TIME = 2;
const VEH_RADIUS = 1.7;
const TIP_ROLL = 0.5;
const TIP_PITCH = 0.6;
const DRAG = 1.4;
const MAX_GRADE = 0.75; // steeper than this = can't climb
const LEVEL_RATE = 0.7;
const PAVE_RATE = 1.0;

export function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { s += vnoise(x * f, y * f) * a; f *= 2; a *= 0.5; }
  return s;
}
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};


/** "mud" marks a road cell that is part of a washout (an unfilled dip across the road). */
export type CellKind = "ok" | "mound" | "mud";
export interface RoadCell { cell: number; x: number; z: number; t: number; kind: CellKind; mound: number; stage: 1 | 2 | 3; level: number; pave: number }
export interface Rock { id: number; x: number; z: number; r: number; big: boolean; spin: number }

/** One terrain vertex shaped by a washout: how deep it dips (negative = raised lip), how wet it looks, its dry colour. */
interface WashVert { v: number; d: number; wet: number; c0: [number, number, number] }
/**
 * A washout: water has cut a dip across the road. `cells` are the road cells it covers (one dirt each to fill);
 * `shown` is the filled fraction drawn so far (it eases towards filled/cells so the dip rises smoothly).
 */
export interface Washout { id: number; x: number; z: number; angle: number; len: number; cells: number[]; filled: number; shown: number; verts: WashVert[] }

export interface World {
  path: { x: number; z: number }[];
  base: Float32Array; bump: Float32Array; rough: Float32Array; dip: Float32Array; heights: Float32Array;
  colors: Float32Array;
  road: RoadCell[]; cellToRoad: Int32Array;
  mud: Uint8Array; mudCells: number[];
  washouts: Washout[];
  trees: { x: number; z: number; s: number }[];
  boulders: { x: number; z: number; s: number }[];
  rocks: Rock[]; rockCapacity: number; nextRockId: number;
  camp: Camp; start: StartSlot[];
  dirtyTerrain: boolean; dirtyCells: Set<number>; dirtyHazards: boolean;
}

export const pathX = (t: number) => 34 * Math.sin(t * Math.PI * 2.2) + 10 * Math.sin(t * 9 + 1);
export const pathH = (t: number) => t * 22;
const PZ0 = HALF - 26, PZL = 2 * HALF - 52;

// Washouts: a few places where water has cut a dip across the road (not a field of holes).
const WASH_COUNT = 4;
const WASH_FROM = 0.2, WASH_TO = 0.95; // route fractions the washouts are spread over, one per equal stretch
const WASH_DEPTH = 0.75; // metres the dip sinks below the road (a loaded truck still crosses it without tipping: see world.test.ts)
const WASH_HALF = 1.7; // half-width of the dip along the road
const WASH_LEN = 4.4; // half-length of the dip across the road
const WASH_CLEAR = 5; // no mounds or loose rocks this close to a washout
const WASH_REACH = 2.8; // a bucket or tailgate within this of an unfilled washout cell can fill it
const WET: [number, number, number] = [0.3, 0.21, 0.14];

interface WashSpec { x: number; z: number; angle: number }

/** One washout per stretch of the route, each on the straightest bit of it and well away from the camp. */
function planWashouts(path: { x: number; z: number }[], camp: Camp, start: StartSlot[]): WashSpec[] {
  const out: WashSpec[] = [], n = path.length - 1;
  const head = (a: number, b: number) => Math.atan2(path[b].x - path[a].x, path[b].z - path[a].z);
  const span = (WASH_TO - WASH_FROM) / WASH_COUNT;
  for (let k = 0; k < WASH_COUNT; k++) {
    const lo = WASH_FROM + k * span;
    let best = -1, bs = 1e9;
    for (let i = Math.round((lo + span * 0.25) * n); i <= Math.round((lo + span * 0.75) * n); i += 2) {
      const p = path[i];
      if (Math.hypot(p.x - camp.mid.x, p.z - camp.mid.z) < 32 || start.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 16)) continue;
      const dh = head(i, i + 12) - head(i - 12, i), turn = Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh)));
      const score = turn + hash(i * 0.37, k + 1) * 0.05;
      if (score < bs) { bs = score; best = i; }
    }
    if (best < 0) continue;
    const p = path[best];
    out.push({ x: p.x, z: p.z, angle: head(best - 3, best + 3) + Math.PI / 2 + (hash(best, 9.1) - 0.5) * 0.45 });
  }
  return out;
}

/** Position of (x, z) relative to a washout's centre line: across the dip (`perp`) and along its length. */
function washFrame(s: WashSpec, x: number, z: number) {
  const dx = x - s.x, dz = z - s.z;
  return { along: dx * Math.sin(s.angle) + dz * Math.cos(s.angle), perp: dx * Math.cos(s.angle) - dz * Math.sin(s.angle) };
}

/** How much of a dip (`bowl`) and of the raised bank beside it (`lip`) sits at (x, z). */
function washProfile(s: WashSpec, x: number, z: number) {
  const { along, perp } = washFrame(s, x, z), ap = Math.abs(perp), end = 1 - smooth(WASH_LEN - 0.6, WASH_LEN + 1.4, Math.abs(along));
  return {
    bowl: (1 - smooth(0, WASH_HALF + 1.3, ap)) * end,
    lip: smooth(WASH_HALF + 0.4, WASH_HALF + 2, ap) * (1 - smooth(WASH_HALF + 2, WASH_HALF + 3.6, ap)) * end,
  };
}

const washoutAt = (specs: WashSpec[], x: number, z: number) =>
  specs.findIndex((s) => { const f = washFrame(s, x, z); return Math.abs(f.perp) < 1.05 && Math.abs(f.along) < ROAD_HALF_WIDTH + 0.4; });

/** Write a washout's current depth and wetness into the terrain; it eases away as the washout is filled. */
function applyWashout(w: World, wo: Washout) {
  const k = 1 - wo.shown;
  for (const q of wo.verts) {
    w.dip[q.v] = q.d * k;
    const m = q.wet * k;
    for (let c = 0; c < 3; c++) w.colors[q.v * 3 + c] = q.c0[c] + (WET[c] - q.c0[c]) * m;
  }
  w.dirtyTerrain = true;
}

export function createWorld(): World {
  const path: { x: number; z: number }[] = [];
  for (let i = 0; i <= 500; i++) { const t = i / 500; path.push({ x: pathX(t), z: PZ0 - t * PZL }); }
  const nearest = (x: number, z: number) => nearestOnPath(path, x, z);
  const camp = findCamp(path, "PASS ROAD WORKS");
  const nearCamp = (x: number, z: number, r: number) => Math.hypot(x - camp.mid.x, z - camp.mid.z) < r;
  const campT = nearestOnPath(path, camp.x, camp.z).t;
  const start = startSlots({ path, cum: arcLengths(path) }, camp);
  const startH = start.map((q) => pathH(nearestOnPath(path, q.x, q.z).t)); // road height beside each parking pad
  const specs = planWashouts(path, camp, start);
  const washouts: Washout[] = specs.map((s, id) => ({ id, x: s.x, z: s.z, angle: s.angle, len: WASH_LEN, cells: [], filled: 0, shown: 0, verts: [] }));
  const V = (N + 1) * (N + 1);
  const base = new Float32Array(V), bump = new Float32Array(V), rough = new Float32Array(V), colors = new Float32Array(V * 3);
  const dist = new Float32Array(V), pad = new Float32Array(V);
  for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) {
    const v = r * (N + 1) + c, x = -HALF + c * CELL, z = -HALF + r * CELL;
    const { d, t } = nearest(x, z);
    dist[v] = d;
    const s = smooth(4.5, 18, d);
    const m = fbm(x * 0.035 + 3, z * 0.035) * 24 + d * 0.25;
    const plateau = 1 - smooth(21, 34, Math.hypot(x - camp.mid.x, z - camp.mid.z)); // level ground under the camp
    base[v] = (pathH(t) + s * m) * (1 - plateau) + pathH(campT) * plateau;
    bump[v] = (vnoise(x * 0.4, z * 0.4) - 0.5) * 2.2 * (1 - smooth(4, 7, d));
    const pw = padWeight(start, x, z); // a level shelf under every parked machine
    if (pw.w > 0) { base[v] = base[v] * (1 - pw.w) + startH[pw.i] * pw.w; bump[v] *= 1 - pw.w; pad[v] = pw.w; }
    rough[v] = 1;
    specs.forEach((sp, k) => { // carve each washout: a smooth gully with a low bank either side
      const { bowl, lip } = washProfile(sp, x, z), sh = Math.max(bowl, lip);
      if (sh < 0.02) return;
      bump[v] *= 1 - 0.85 * sh;
      washouts[k].verts.push({ v, d: WASH_DEPTH * bowl - 0.14 * lip, wet: bowl, c0: [0, 0, 0] });
    });
  }
  for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) {
    const v = r * (N + 1) + c, h = base[v], d = dist[v];
    const rel = h - pathH(Math.min(1, Math.max(0, (PZ0 - (-HALF + r * CELL)) / PZL)));
    let col: [number, number, number];
    if (d < 4.6) col = [0.55, 0.42, 0.28];
    else if (h > 40) col = [0.93, 0.95, 0.97];
    else if (rel > 14) col = [0.5, 0.48, 0.46];
    else if (rel > 7) col = [0.42, 0.5, 0.33];
    else col = [0.4, 0.58, 0.3];
    if ((nearCamp(-HALF + c * CELL, -HALF + r * CELL, 26) && d > 4.6) || pad[v] > 0.5) col = [0.55, 0.5, 0.42]; // gravel yard / parking pads
    const j = 0.9 + hash(c, r) * 0.2;
    colors.set([col[0] * j, col[1] * j, col[2] * j], v * 3);
  }
  for (const wo of washouts) for (const q of wo.verts) q.c0 = [colors[q.v * 3], colors[q.v * 3 + 1], colors[q.v * 3 + 2]];
  const road: RoadCell[] = [];
  const cellToRoad = new Int32Array(N * N).fill(-1);
  const mud = new Uint8Array(N * N);
  const trees: World["trees"] = [], boulders: World["boulders"] = [];
  const rocks: Rock[] = [];
  let id = 0, bigCount = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + (i + 0.5) * CELL, z = -HALF + (j + 0.5) * CELL;
    const { d, t } = nearest(x, z);
    const h = hash(i * 3.1, j * 7.7);
    const mudNoise = vnoise(x * 0.12 + 9, z * 0.12);
    if (d < ROAD_HALF_WIDTH) {
      const early = t < 0.06 || nearCamp(x, z, 26); // keep the camp and parking area clear
      const wi = washoutAt(specs, x, z), nearWash = specs.some((s) => Math.hypot(x - s.x, z - s.z) < WASH_CLEAR);
      let kind: CellKind = "ok";
      if (wi >= 0) kind = "mud";
      else if (!early && !nearWash && vnoise(x * 0.15, z * 0.15 + 4) > 0.8) kind = "mound";
      cellToRoad[j * N + i] = road.length;
      road.push({ cell: j * N + i, x, z, t, kind, mound: kind === "mound" ? 2 : 0, stage: 1, level: 0, pave: 0 });
      if (kind === "mud") { mud[j * N + i] = 1; washouts[wi].cells.push(road.length - 1); }
      if (!early && !nearWash && kind === "ok") {
        if (h > 0.965) { rocks.push({ id: id++, x, z, r: 1.4, big: true, spin: h * 9 }); bigCount++; }
        else if (h > 0.8) rocks.push({ id: id++, x: x + (h - 0.9) * 2, z, r: 0.55 + h * 0.2, big: false, spin: h * 20 });
      }
    } else if (nearCamp(x, z, 28) || nearSlot(start, x, z)) {
      // camp yard and the parking row: no scenery
    } else {
      if (d < 6 && mudNoise > 0.7) mud[j * N + i] = 1; // off-road bog
      else if (d > 7 && d < 22 && h > 0.9) trees.push({ x, z, s: 0.8 + hash(i, j) * 0.8 });
      else if (d > 6 && h < 0.03) boulders.push({ x, z, s: 1 + hash(j, i) * 1.5 });
    }
  }
  const mudCells: number[] = [];
  mud.forEach((m, k) => { if (m) mudCells.push(k); });
  const w: World = {
    path, base, bump, rough, dip: new Float32Array(V), heights: new Float32Array(V), colors, road, cellToRoad, mud, mudCells, washouts, trees, boulders,
    rocks, rockCapacity: rocks.length + bigCount * 3, nextRockId: id, camp, start,
    dirtyTerrain: true, dirtyCells: new Set(), dirtyHazards: true,
  };
  washouts.forEach((wo) => applyWashout(w, wo));
  recomputeHeights(w);
  return w;
}

export function nearestOnPath(path: { x: number; z: number }[], x: number, z: number) {
  let best = 1e9, bi = 0;
  for (let i = 0; i < path.length; i++) {
    const dx = path[i].x - x, dz = path[i].z - z, d = dx * dx + dz * dz;
    if (d < best) { best = d; bi = i; }
  }
  return { d: Math.sqrt(best), t: bi / (path.length - 1), i: bi };
}

export function recomputeHeights(w: World) {
  for (let v = 0; v < w.heights.length; v++) w.heights[v] = w.base[v] + w.bump[v] * w.rough[v] - w.dip[v];
}

export function heightAt(w: World, x: number, z: number) {
  const fx = Math.min(N - 0.001, Math.max(0, (x + HALF) / CELL)), fz = Math.min(N - 0.001, Math.max(0, (z + HALF) / CELL));
  const c = Math.floor(fx), r = Math.floor(fz), u = fx - c, v = fz - r;
  const H = w.heights, i = r * (N + 1) + c;
  const a = H[i], b = H[i + 1], cc = H[i + N + 1], d = H[i + N + 2];
  return (a * (1 - u) + b * u) * (1 - v) + (cc * (1 - u) + d * u) * v;
}

export function cellIndex(x: number, z: number) {
  const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
  if (i < 0 || j < 0 || i >= N || j >= N) return -1;
  return j * N + i;
}

export function roadCellAt(w: World, x: number, z: number): RoadCell | null {
  const c = cellIndex(x, z);
  if (c < 0) return null;
  const k = w.cellToRoad[c];
  return k < 0 ? null : w.road[k];
}

export function rockOnRoad(w: World, r: Rock) {
  const e = r.r * 0.7;
  return !!(roadCellAt(w, r.x, r.z) || roadCellAt(w, r.x + e, r.z) || roadCellAt(w, r.x - e, r.z) || roadCellAt(w, r.x, r.z + e) || roadCellAt(w, r.x, r.z - e));
}

export interface Vehicle {
  kind: Machine; x: number; z: number; heading: number; speed: number; pitch: number; roll: number; y: number;
  dirt: number; rock: number; // cargo (truck: up to capacity; excavator bucket: max 1 total)
  tipped: boolean; work: number; // action progress 0..1 for animation
  fuel: number; damage: number; // 0..1 tank, 0..1 wear
}

/** One-shot happenings the renderer/audio layer drains each frame. */
export type GameEvent = "switch" | "tip" | "break" | "dig" | "load" | "dump" | "fill" | "win";

export interface Game {
  world: World; vehicles: Vehicle[]; active: number; msg: string; msgT: number; actionT: number; won: boolean;
  time: number; rollovers: number; events: GameEvent[]; fx: Fx[]; env: Env;
}

function makeVehicle(w: World, kind: Machine, slot: StartSlot): Vehicle {
  const { x, z, heading } = slot;
  return { kind, x, z, heading, speed: 0, pitch: 0, roll: 0, y: heightAt(w, x, z), dirt: 0, rock: 0, tipped: false, work: 0, fuel: 1, damage: 0 };
}

export function createGame(diff: Difficulty = "normal"): Game {
  const w = createWorld();
  // Parked in a spread-out row beside the road (startLayout.ts). Slot 0 is furthest along the road: the machine that works first.
  const kinds: Machine[] = ["dozer", "excavator", "truck", "paver"];
  const vehicles = kinds.map((k, i) => makeVehicle(w, k, w.start[i]));
  return { world: w, vehicles, active: 0, msg: "Push the rocks off the road with the bulldozer", msgT: 5, actionT: 0, won: false, time: 0, rollovers: 0, events: [], fx: [], env: makeEnv(diff) };
}

export interface Input { throttle: number; steer: number; action: boolean }

function say(g: Game, m: string) { g.msg = m; g.msgT = 2.5; }
function emit(g: Game, e: GameEvent) { if (g.events.length < 32) g.events.push(e); }
function puff(g: Game, kind: FxKind, x: number, z: number, n = 8, extra: Partial<Fx> = {}) {
  if (g.fx.length < 64) g.fx.push({ kind, x, y: heightAt(g.world, x, z), z, n, ...extra });
}

function setLevel(w: World, rc: RoadCell, level: number) {
  rc.level = level;
  const i = rc.cell % N, j = Math.floor(rc.cell / N);
  for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const v = (j + dj) * (N + 1) + (i + di);
    w.rough[v] = Math.min(w.rough[v], 1 - level);
  }
  w.dirtyTerrain = true;
}

function surfaceGrip(w: World, v: Vehicle) {
  const c = cellIndex(v.x, v.z);
  const tracks = MACHINES[v.kind].tracks;
  if (c >= 0 && w.mud[c]) return tracks ? 0.4 : v.dirt + v.rock > 0 ? 0.12 : 0.28;
  const rc = c >= 0 && w.cellToRoad[c] >= 0 ? w.road[w.cellToRoad[c]] : null;
  if (!rc) return tracks ? 0.6 : 0.5;
  if (rc.kind === "mound") return 0.35;
  return rc.stage === 1 ? 0.75 : rc.stage === 2 ? 0.9 : 1;
}

function stepVehicle(g: Game, v: Vehicle, throttle: number, steer: number, dt: number, me: boolean) {
  const w = g.world, M = MACHINES[v.kind], D = DIFF[g.env.diff];
  if (v.tipped) { throttle = 0; steer = 0; }
  if (me && !v.tipped) burnFuel(v, dt, throttle, g.actionT > 0, g.env.diff);
  if (v.fuel <= 0) {
    if (me && throttle !== 0 && g.msgT <= 0) say(g, "Out of fuel! Press R to be towed back to camp (+20 s)");
    throttle = 0;
  }
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const grip = Math.min(1.15, surfaceGrip(w, v) * g.env.gripMul * D.grip);
  const loadFactor = v.kind === "truck" ? 1 - ((v.dirt + v.rock) / TRUCK_CAPACITY) * 0.35 : 1;
  v.speed += throttle * M.accel * loadFactor * dt;
  v.speed *= Math.exp(-DRAG * (throttle === 0 ? 1.5 : 0.3) * dt);
  const maxS = M.max * grip * wearFactor(v);
  v.speed = Math.max(-maxS * 0.5, Math.min(maxS, v.speed));
  v.heading += steer * M.turn * dt * Math.min(1, Math.abs(v.speed) / 1.5 + 0.35) * (v.speed < -0.1 ? -1 : 1);
  const nx = v.x + fx * v.speed * dt, nz = v.z + fz * v.speed * dt;
  const h0 = heightAt(w, v.x, v.z), h1 = heightAt(w, nx, nz);
  const dist = Math.hypot(nx - v.x, nz - v.z);
  const grade = dist > 1e-4 ? (h1 - h0) / dist : 0;
  const lim = HALF - 2;
  let blocked = grade > MAX_GRADE || Math.abs(nx) > lim || Math.abs(nz) > lim;
  // other vehicles
  if (!blocked) for (const o of g.vehicles) {
    if (o === v) continue;
    const d0 = Math.hypot(o.x - v.x, o.z - v.z), d1 = Math.hypot(o.x - nx, o.z - nz);
    if (d1 < VEH_RADIUS * 2 && d1 < d0) { blocked = true; break; }
  }
  if (!blocked) for (const c of w.camp.colliders) { // cabins, parked cars, tank...
    const d0 = Math.hypot(c.x - v.x, c.z - v.z), d1 = Math.hypot(c.x - nx, c.z - nz);
    if (d1 < VEH_RADIUS * 0.9 + c.r && d1 < d0) { blocked = true; break; }
  }
  // rocks: the dozer blade pushes small rocks, everything else is an obstacle
  if (!blocked) for (const r of w.rocks) {
    const dx = r.x - nx, dz = r.z - nz;
    const fwd = dx * fx + dz * fz, lat = dx * fz - dz * fx;
    if (v.kind === "dozer" && v.speed > 0 && fwd > 0.5 && fwd < 2.4 + r.r && Math.abs(lat) < 1.6 + r.r * 0.5) {
      if (r.big) { blocked = true; say(g, "Too heavy to push — break it up with the excavator"); break; }
      const push = 2.4 + r.r - fwd;
      // rocks slide off the blade edges a little
      const slide = Math.sign(lat || 1) * push * 0.25;
      const rx = r.x + fx * push + fz * slide, rz = r.z + fz * push - fx * slide;
      if (Math.abs(rx) < lim && Math.abs(rz) < lim) { r.x = rx; r.z = rz; r.spin += push; }
      v.speed *= Math.exp(-1.2 * dt); // pushing is hard work
      continue;
    }
    if (Math.hypot(dx, dz) < VEH_RADIUS + r.r * 0.8 && Math.hypot(r.x - v.x, r.z - v.z) > Math.hypot(dx, dz)) { blocked = true; break; }
  }
  if (blocked) {
    const hit = Math.abs(v.speed);
    if (hit > 2.5) { addDamage(v, Math.min(0.08, hit * 0.01)); emit(g, "dig"); puff(g, "dust", nx, nz, 5); }
    v.speed *= -0.2;
  } else {
    if (grade > 0) v.speed *= Math.exp(-grade * 2.5 * dt);
    v.x = nx; v.z = nz;
  }
  // body attitude from terrain
  const L = 1.6;
  const hf = heightAt(w, v.x + fx * L, v.z + fz * L), hb = heightAt(w, v.x - fx * L, v.z - fz * L);
  const hr = heightAt(w, v.x + fz * L, v.z - fx * L), hl = heightAt(w, v.x - fz * L, v.z + fx * L);
  const tp = Math.atan2(hb - hf, 2 * L), trl = Math.atan2(hr - hl, 2 * L);
  const k = 1 - Math.exp(-6 * dt);
  if (v.tipped) { v.roll += (Math.sign(v.roll || 1) * 1.4 - v.roll) * k; }
  else {
    v.pitch += (tp - v.pitch) * k; v.roll += (trl - v.roll) * k;
    const topHeavy = v.kind === "truck" ? 1 + (v.dirt + v.rock) / TRUCK_CAPACITY * 0.4 : 1;
    if (Math.abs(v.roll) * topHeavy > TIP_ROLL * D.tip || Math.abs(v.pitch) > TIP_PITCH * D.tip) {
      v.tipped = true; v.speed = 0;
      g.rollovers++; addDamage(v, 0.2); emit(g, "tip"); puff(g, "dust", v.x, v.z, 14);
      if (g.vehicles[g.active] === v) say(g, "Rolled over! Press R to recover");
    }
  }
  v.y += ((hf + hb + hl + hr) / 4 - v.y) * (1 - Math.exp(-10 * dt));

  // passive work while driving
  if (Math.abs(v.speed) < 0.4 || v.tipped) return;
  const work = Math.abs(v.speed) / M.max;
  if (v.kind !== "dozer" && v.kind !== "paver") return;
  const occupied = new Set<number>();
  for (const r of w.rocks) occupied.add(cellIndex(r.x, r.z));
  const ahead = v.kind === "dozer" ? 2.2 : 0;
  for (const off of [-1.4, 0, 1.4]) {
    const rc = roadCellAt(w, v.x + fx * ahead + fz * off, v.z + fz * ahead - fx * off);
    if (!rc || rc.kind !== "ok" || occupied.has(rc.cell)) continue;
    if (v.kind === "dozer" && rc.stage === 1) {
      setLevel(w, rc, Math.min(1, rc.level + LEVEL_RATE * dt * (0.5 + work)));
      if (rc.level >= 1) { rc.stage = 2; w.dirtyCells.add(rc.cell); }
    } else if (v.kind === "paver" && rc.stage === 2) {
      rc.pave += PAVE_RATE * dt * (0.5 + work);
      if (rc.pave >= 1) { rc.stage = 3; w.dirtyCells.add(rc.cell); }
    }
  }
}

type Action = { label: string; time: number; run: () => void } | null;

/** What Space would do for the active vehicle right now. */
export function currentAction(g: Game): Action {
  const w = g.world, v = g.vehicles[g.active];
  if (v.tipped) return null;
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const px = v.x + fx * 3.2, pz = v.z + fz * 3.2; // reach point
  const pump = w.camp.fuel;
  if (Math.hypot(v.x - pump.x, v.z - pump.z) < pump.r && (v.fuel < 0.97 || v.damage > 0.03)) {
    return { label: "Refuel & repair", time: REFUEL_TIME, run: () => { v.fuel = 1; v.damage = 0; emit(g, "load"); say(g, "Tank full, machine repaired"); } };
  }
  if (v.kind === "excavator") {
    const held = v.dirt + v.rock;
    if (held === 0) {
      let best: Rock | null = null, bd = 3.2;
      for (const r of w.rocks) { const d = Math.hypot(r.x - px, r.z - pz) - r.r; if (d < bd) { bd = d; best = r; } }
      if (best) {
        const r = best;
        if (r.big) return { label: "Break boulder", time: DIG_TIME * 2, run: () => {
          emit(g, "break"); puff(g, "chips", r.x, r.z, 18); puff(g, "dust", r.x, r.z, 10);
          w.rocks.splice(w.rocks.indexOf(r), 1);
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + r.spin;
            w.rocks.push({ id: w.nextRockId++, x: r.x + Math.cos(a) * 1.1, z: r.z + Math.sin(a) * 1.1, r: 0.6, big: false, spin: a });
          }
        } };
        return { label: "Pick up rock", time: DIG_TIME, run: () => { emit(g, "dig"); puff(g, "dust", r.x, r.z, 8); w.rocks.splice(w.rocks.indexOf(r), 1); v.rock = 1; } };
      }
      let mc: RoadCell | null = null; let md = 3.2;
      for (const rc of w.road) if (rc.kind === "mound") { const d = Math.hypot(rc.x - px, rc.z - pz); if (d < md) { md = d; mc = rc; } }
      if (mc) {
        const c = mc;
        return { label: "Dig dirt mound", time: DIG_TIME, run: () => {
          emit(g, "dig"); puff(g, "dirt", c.x, c.z, 12); c.mound -= 1; v.dirt = 1;
          if (c.mound <= 0) { c.kind = "ok"; }
          w.dirtyHazards = true;
        } };
      }
      const hole = washoutCellNear(w, px, pz);
      const mounds = w.road.some((r) => r.kind === "mound");
      if (hole && mounds) return { label: "Washout needs dirt: dig a mound first", time: Infinity, run: () => {} };
      // Dirt must never run out (every mound can be dug and dumped): with no mounds left, scoop it beside the road.
      if (!mounds && !hole && !roadCellAt(w, px, pz) && cellIndex(px, pz) >= 0 && !w.camp.colliders.some((c) => Math.hypot(c.x - px, c.z - pz) < c.r + 1)) {
        return { label: "Scoop roadside dirt", time: DIG_TIME, run: () => { emit(g, "dig"); puff(g, "dirt", px, pz, 12); v.dirt = 1; } };
      }
      if (hole) return { label: "Washout needs dirt: scoop it beside the road", time: Infinity, run: () => {} };
      return null;
    }
    const rc = roadCellAt(w, px, pz);
    const hole = washoutCellNear(w, px, pz);
    if (hole && v.dirt) return { label: `Fill washout (${washoutLeft(w, hole)} left here)`, time: FILL_TIME, run: () => fillWashout(g, hole, () => { v.dirt = 0; }) };
    if (hole) return { label: "Bucket holds a rock: dump it off the road first", time: Infinity, run: () => {} };
    const truck = g.vehicles.find((o) => o.kind === "truck" && Math.hypot(o.x - px, o.z - pz) < 4 && !o.tipped);
    if (truck) {
      if (truck.dirt + truck.rock >= TRUCK_CAPACITY) return { label: "Truck is full", time: Infinity, run: () => {} };
      return { label: "Load into truck", time: LOAD_TIME, run: () => { emit(g, "load"); puff(g, "dust", truck.x, truck.z, 8); truck.dirt += v.dirt; truck.rock += v.rock; v.dirt = 0; v.rock = 0; } };
    }
    if (!rc) return { label: "Dump bucket here", time: LOAD_TIME, run: () => { emit(g, "dump"); puff(g, "dirt", px, pz, 12); v.dirt = 0; v.rock = 0; } };
    return { label: "Swing to a truck or off the road to dump", time: Infinity, run: () => {} };
  }
  if (v.kind === "truck") {
    const load = v.dirt + v.rock;
    if (load === 0) return null;
    const bx = v.x - fx * 2.5, bz = v.z - fz * 2.5; // tips out the back
    const rc = roadCellAt(w, bx, bz), hole = washoutCellNear(w, bx, bz);
    if (hole && v.dirt > 0) return { label: `Tip dirt into washout (${washoutLeft(w, hole)} left here)`, time: FILL_TIME, run: () => fillWashout(g, hole, () => { v.dirt -= 1; }) };
    if (!rc && !roadCellAt(w, v.x, v.z)) return { label: `Dump load (${load})`, time: DUMP_TIME, run: () => { emit(g, "dump"); puff(g, "dirt", bx, bz, 20); v.dirt = 0; v.rock = 0; } };
    return { label: v.dirt > 0 ? "Back the tailgate up to a washout, or drive off-road to dump" : "Drive off-road to dump rocks", time: Infinity, run: () => {} };
  }
  return null;
}

/** The nearest unfilled washout cell whose centre is within `r` of (x, z). A washout is a few cells wide: any of them will do. */
function washoutCellNear(w: World, x: number, z: number, r = WASH_REACH): RoadCell | null {
  let best: RoadCell | null = null, bd = r;
  for (const wo of w.washouts) for (const k of wo.cells) {
    const rc = w.road[k];
    if (rc.kind !== "mud") continue;
    const d = Math.hypot(rc.x - x, rc.z - z);
    if (d < bd) { bd = d; best = rc; }
  }
  return best;
}

const washoutOf = (w: World, rc: RoadCell) => w.washouts.find((wo) => wo.cells.some((k) => w.road[k] === rc))!;
const washoutLeft = (w: World, rc: RoadCell) => { const wo = washoutOf(w, rc); return wo.cells.length - wo.filled; };

/** One dirt fills one cell of a washout; the dip rises as its cells fill. */
function fillWashout(g: Game, rc: RoadCell, spend: () => void) {
  const w = g.world, wo = washoutOf(w, rc);
  emit(g, "fill"); rc.kind = "ok"; w.mud[rc.cell] = 0; spend(); wo.filled++; w.dirtyHazards = true;
  puff(g, "splash", rc.x, rc.z, 16); puff(g, "dirt", rc.x, rc.z, 12);
  const left = w.washouts.filter((o) => o.filled < o.cells.length).length;
  say(g, wo.filled < wo.cells.length ? `Washout ${wo.filled}/${wo.cells.length} filled` : left ? `Washout filled: ${left} left` : "Last washout filled!");
}

export function stepGame(g: Game, inp: Input, dt: number) {
  g.vehicles.forEach((v, i) => {
    const me = i === g.active;
    stepVehicle(g, v, me ? inp.throttle : 0, me ? inp.steer : 0, dt, me);
  });
  const v = g.vehicles[g.active];
  const act = inp.action ? currentAction(g) : null;
  if (act && Number.isFinite(act.time) && Math.abs(v.speed) < 1) {
    g.actionT += dt;
    if (g.actionT >= act.time) { act.run(); g.actionT = 0; }
  } else g.actionT = 0;
  for (const o of g.vehicles) o.work += ((o === v && g.actionT > 0 ? 1 : 0) - o.work) * (1 - Math.exp(-5 * dt));
  if (g.msgT > 0) g.msgT -= dt;
  for (const wo of g.world.washouts) { // the dip rises smoothly as cells are filled
    const target = wo.filled / wo.cells.length;
    if (wo.shown < target) { wo.shown = Math.min(target, wo.shown + dt * 0.9); applyWashout(g.world, wo); }
  }
  if (!g.won) { g.time += dt; if (progress(g.world).paved >= 0.95) { g.won = true; emit(g, "win"); } }
}

/** Jump straight to machine i (keys 1-4). */
export function selectVehicle(g: Game, i: number) {
  if (i < 0 || i >= g.vehicles.length || i === g.active) return;
  g.vehicles[g.active].speed = 0;
  g.active = i;
  g.actionT = 0;
  const m = MACHINES[g.vehicles[i].kind];
  say(g, `Now driving: ${m.nick} the ${m.label}`);
  emit(g, "switch");
}

/** Tab: jump to the next (dir = 1) or previous (dir = -1) machine, wherever it is. */
export function cycleVehicle(g: Game, dir: 1 | -1 = 1) {
  const n = g.vehicles.length;
  selectVehicle(g, (g.active + dir + n) % n);
}

export function recover(g: Game) {
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

export function progress(w: World) {
  let graded = 0, paved = 0, mounds = 0, mud = 0;
  for (const r of w.road) {
    if (r.stage >= 2) graded++;
    if (r.stage === 3) paved++;
    if (r.kind === "mound") mounds++;
    if (r.kind === "mud") mud++;
  }
  let rocksOnRoad = 0;
  for (const r of w.rocks) if (rockOnRoad(w, r)) rocksOnRoad++;
  const n = w.road.length;
  const washouts = w.washouts.filter((o) => o.filled < o.cells.length).length;
  return { graded: graded / n, paved: paved / n, mounds, mud, washouts, rocksOnRoad };
}

export interface Hint { text: string; machine: Machine | null }

/** What the crew should do next, and which machine should do it. */
export function objectiveHint(g: Game): Hint {
  const w = g.world, p = progress(w);
  const bigOnRoad = w.rocks.filter((r) => r.big && rockOnRoad(w, r)).length;
  if (g.won) return { text: "Road complete!", machine: null };
  if (bigOnRoad) return { text: `Break ${bigOnRoad} boulder${bigOnRoad > 1 ? "s" : ""} blocking the road`, machine: "excavator" };
  if (p.rocksOnRoad) return { text: `Push ${p.rocksOnRoad} loose rock${p.rocksOnRoad > 1 ? "s" : ""} off the road`, machine: "dozer" };
  if (p.mounds) return { text: `Dig ${p.mounds} dirt mound${p.mounds > 1 ? "s" : ""}: keep the dirt for the washouts (bucket or truck)`, machine: "excavator" };
  if (p.washouts) return { text: `Fill ${p.washouts} washout${p.washouts > 1 ? "s" : ""} with dirt (${p.mud} load${p.mud > 1 ? "s" : ""}): excavator fills, or the truck tips it`, machine: "excavator" };
  if (p.graded < 0.95) return { text: `Grade the road: ${Math.floor(p.graded * 100)}% done`, machine: "dozer" };
  return { text: `Pave the graded road: ${Math.floor(p.paved * 100)}% done`, machine: "paver" };
}

/** Length of the route in metres. */
export function pathLength(w: World) {
  let L = 0;
  for (let i = 1; i < w.path.length; i++) L += Math.hypot(w.path[i].x - w.path[i - 1].x, w.path[i].z - w.path[i - 1].z);
  return L;
}

const orderCache = new WeakMap<World, RoadCell[]>();

/**
 * How far along the route the work has got, as unbroken stretches from the camp end:
 * the grading front stops at the first ungraded cell, the paving front at the first unpaved one.
 */
export function roadFrontier(w: World) {
  let order = orderCache.get(w);
  if (!order) { order = [...w.road].sort((a, b) => a.t - b.t); orderCache.set(w, order); }
  const frontier = (done: (r: RoadCell) => boolean) => {
    let t = 1;
    for (const r of order!) if (!done(r)) { t = r.t; break; }
    const i = Math.max(0, Math.min(w.path.length - 1, Math.round(t * (w.path.length - 1))));
    return { t, ...w.path[i] };
  };
  const total = pathLength(w);
  const g = frontier((r) => r.stage >= 2), p = frontier((r) => r.stage === 3);
  return { total, graded: { ...g, m: g.t * total }, paved: { ...p, m: p.t * total } };
}

// Pure game rules: terrain generation, road job state, vehicle sim. No React / three.
export const N = 80; // cells per side
export const CELL = 2;
export const HALF = (N * CELL) / 2;
export const ROAD_HALF_WIDTH = 3.2;

export type Machine = "dozer" | "excavator" | "truck" | "paver";
export const MACHINES: Record<Machine, { accel: number; max: number; turn: number; label: string; tracks: boolean }> = {
  dozer: { accel: 2.2, max: 5.5, turn: 1.1, label: "Bulldozer", tracks: true },
  excavator: { accel: 1.6, max: 3.5, turn: 1.0, label: "Excavator", tracks: true },
  truck: { accel: 3.2, max: 9, turn: 1.2, label: "Dump Truck", tracks: false },
  paver: { accel: 1.6, max: 4, turn: 0.9, label: "Paver", tracks: true },
};
export const TRUCK_CAPACITY = 6;
const DIG_TIME = 1.1;
const LOAD_TIME = 0.6;
const FILL_TIME = 0.8;
const DUMP_TIME = 1.2;
const VEH_RADIUS = 1.7;
const TIP_ROLL = 0.5;
const TIP_PITCH = 0.6;
const DRAG = 1.4;
const MAX_GRADE = 0.75; // steeper than this = can't climb
const LEVEL_RATE = 0.7;
const PAVE_RATE = 1.0;

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { s += vnoise(x * f, y * f) * a; f *= 2; a *= 0.5; }
  return s;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};


export type CellKind = "ok" | "mound" | "mud";
export interface RoadCell { cell: number; x: number; z: number; t: number; kind: CellKind; mound: number; stage: 1 | 2 | 3; level: number; pave: number }
export interface Rock { id: number; x: number; z: number; r: number; big: boolean; spin: number }

export interface World {
  path: { x: number; z: number }[];
  base: Float32Array; bump: Float32Array; rough: Float32Array; heights: Float32Array;
  colors: Float32Array;
  road: RoadCell[]; cellToRoad: Int32Array;
  mud: Uint8Array; mudCells: number[];
  trees: { x: number; z: number; s: number }[];
  boulders: { x: number; z: number; s: number }[];
  rocks: Rock[]; rockCapacity: number; nextRockId: number;
  dirtyTerrain: boolean; dirtyCells: Set<number>; dirtyHazards: boolean;
}

export const pathX = (t: number) => 34 * Math.sin(t * Math.PI * 2.2) + 10 * Math.sin(t * 9 + 1);
export const pathH = (t: number) => t * 22;
const PZ0 = HALF - 26, PZL = 2 * HALF - 52;

export function createWorld(): World {
  const path: { x: number; z: number }[] = [];
  for (let i = 0; i <= 500; i++) { const t = i / 500; path.push({ x: pathX(t), z: PZ0 - t * PZL }); }
  const nearest = (x: number, z: number) => nearestOnPath(path, x, z);
  const V = (N + 1) * (N + 1);
  const base = new Float32Array(V), bump = new Float32Array(V), rough = new Float32Array(V), colors = new Float32Array(V * 3);
  const dist = new Float32Array(V);
  for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) {
    const v = r * (N + 1) + c, x = -HALF + c * CELL, z = -HALF + r * CELL;
    const { d, t } = nearest(x, z);
    dist[v] = d;
    const s = smooth(4.5, 18, d);
    const m = fbm(x * 0.035 + 3, z * 0.035) * 24 + d * 0.25;
    base[v] = pathH(t) + s * m;
    bump[v] = (vnoise(x * 0.4, z * 0.4) - 0.5) * 2.2 * (1 - smooth(4, 7, d));
    rough[v] = 1;
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
    const j = 0.9 + hash(c, r) * 0.2;
    colors.set([col[0] * j, col[1] * j, col[2] * j], v * 3);
  }
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
      const early = t < 0.06; // keep the parking area clear
      let kind: CellKind = "ok";
      if (!early && vnoise(x * 0.15, z * 0.15 + 4) > 0.8) kind = "mound";
      else if (!early && mudNoise > 0.86) kind = "mud";
      cellToRoad[j * N + i] = road.length;
      road.push({ cell: j * N + i, x, z, t, kind, mound: kind === "mound" ? 2 : 0, stage: 1, level: 0, pave: 0 });
      if (kind === "mud") mud[j * N + i] = 1;
      if (!early && kind === "ok") {
        if (h > 0.965) { rocks.push({ id: id++, x, z, r: 1.4, big: true, spin: h * 9 }); bigCount++; }
        else if (h > 0.8) rocks.push({ id: id++, x: x + (h - 0.9) * 2, z, r: 0.55 + h * 0.2, big: false, spin: h * 20 });
      }
    } else {
      if (d < 6 && mudNoise > 0.7) mud[j * N + i] = 1; // off-road bog
      else if (d > 7 && d < 22 && h > 0.9) trees.push({ x, z, s: 0.8 + hash(i, j) * 0.8 });
      else if (d > 6 && h < 0.03) boulders.push({ x, z, s: 1 + hash(j, i) * 1.5 });
    }
  }
  const mudCells: number[] = [];
  mud.forEach((m, k) => { if (m) mudCells.push(k); });
  const w: World = {
    path, base, bump, rough, heights: new Float32Array(V), colors, road, cellToRoad, mud, mudCells, trees, boulders,
    rocks, rockCapacity: rocks.length + bigCount * 3, nextRockId: id,
    dirtyTerrain: true, dirtyCells: new Set(), dirtyHazards: true,
  };
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
  for (let v = 0; v < w.heights.length; v++) w.heights[v] = w.base[v] + w.bump[v] * w.rough[v];
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
}

export interface Game { world: World; vehicles: Vehicle[]; active: number; msg: string; msgT: number; actionT: number; won: boolean }

function makeVehicle(w: World, kind: Machine, pathIdx: number, side: number): Vehicle {
  const p = w.path[pathIdx], q = w.path[pathIdx + 3];
  const heading = Math.atan2(q.x - p.x, q.z - p.z);
  const x = p.x + Math.cos(heading) * side, z = p.z - Math.sin(heading) * side;
  return { kind, x, z, heading, speed: 0, pitch: 0, roll: 0, y: heightAt(w, x, z), dirt: 0, rock: 0, tipped: false, work: 0 };
}

export function createGame(): Game {
  const w = createWorld();
  const vehicles = [makeVehicle(w, "dozer", 14, 0), makeVehicle(w, "excavator", 6, -1.5), makeVehicle(w, "truck", 2, 1.8), makeVehicle(w, "paver", 22, 0)];
  // nudge paver behind start so it isn't in the way
  const pv = makeVehicle(w, "paver", 1, -2.2);
  vehicles[3] = pv;
  return { world: w, vehicles, active: 0, msg: "Push the rocks off the road with the bulldozer", msgT: 5, actionT: 0, won: false };
}

export interface Input { throttle: number; steer: number; action: boolean }

function say(g: Game, m: string) { g.msg = m; g.msgT = 2.5; }

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

function stepVehicle(g: Game, v: Vehicle, throttle: number, steer: number, dt: number) {
  const w = g.world, M = MACHINES[v.kind];
  if (v.tipped) { throttle = 0; steer = 0; }
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const grip = surfaceGrip(w, v);
  const loadFactor = v.kind === "truck" ? 1 - ((v.dirt + v.rock) / TRUCK_CAPACITY) * 0.35 : 1;
  v.speed += throttle * M.accel * loadFactor * dt;
  v.speed *= Math.exp(-DRAG * (throttle === 0 ? 1.5 : 0.3) * dt);
  const maxS = M.max * grip;
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
  if (blocked) v.speed *= -0.2;
  else {
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
    if (Math.abs(v.roll) * topHeavy > TIP_ROLL || Math.abs(v.pitch) > TIP_PITCH) {
      v.tipped = true; v.speed = 0;
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
  if (v.kind === "excavator") {
    const held = v.dirt + v.rock;
    if (held === 0) {
      let best: Rock | null = null, bd = 3.2;
      for (const r of w.rocks) { const d = Math.hypot(r.x - px, r.z - pz) - r.r; if (d < bd) { bd = d; best = r; } }
      if (best) {
        const r = best;
        if (r.big) return { label: "Break boulder", time: DIG_TIME * 2, run: () => {
          w.rocks.splice(w.rocks.indexOf(r), 1);
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + r.spin;
            w.rocks.push({ id: w.nextRockId++, x: r.x + Math.cos(a) * 1.1, z: r.z + Math.sin(a) * 1.1, r: 0.6, big: false, spin: a });
          }
        } };
        return { label: "Pick up rock", time: DIG_TIME, run: () => { w.rocks.splice(w.rocks.indexOf(r), 1); v.rock = 1; } };
      }
      let mc: RoadCell | null = null; let md = 3.2;
      for (const rc of w.road) if (rc.kind === "mound") { const d = Math.hypot(rc.x - px, rc.z - pz); if (d < md) { md = d; mc = rc; } }
      if (mc) {
        const c = mc;
        return { label: "Dig dirt mound", time: DIG_TIME, run: () => {
          c.mound -= 1; v.dirt = 1;
          if (c.mound <= 0) { c.kind = "ok"; }
          w.dirtyHazards = true;
        } };
      }
      return null;
    }
    const truck = g.vehicles.find((o) => o.kind === "truck" && Math.hypot(o.x - px, o.z - pz) < 4 && !o.tipped);
    if (truck) {
      if (truck.dirt + truck.rock >= TRUCK_CAPACITY) return { label: "Truck is full", time: Infinity, run: () => {} };
      return { label: "Load into truck", time: LOAD_TIME, run: () => { truck.dirt += v.dirt; truck.rock += v.rock; v.dirt = 0; v.rock = 0; } };
    }
    const rc = roadCellAt(w, px, pz);
    if (rc && rc.kind === "mud" && v.dirt) return { label: "Fill mud hole", time: FILL_TIME, run: () => fillMud(w, rc, () => { v.dirt = 0; }) };
    if (!rc) return { label: "Dump bucket here", time: LOAD_TIME, run: () => { v.dirt = 0; v.rock = 0; } };
    return { label: "Swing to a truck or off the road to dump", time: Infinity, run: () => {} };
  }
  if (v.kind === "truck") {
    const load = v.dirt + v.rock;
    if (load === 0) return null;
    const bx = v.x - fx * 2.5, bz = v.z - fz * 2.5; // tips out the back
    const rc = roadCellAt(w, bx, bz);
    if (rc && rc.kind === "mud" && v.dirt > 0) return { label: "Tip dirt into mud", time: FILL_TIME, run: () => fillMud(w, rc, () => { v.dirt -= 1; }) };
    if (!rc && !roadCellAt(w, v.x, v.z)) return { label: `Dump load (${load})`, time: DUMP_TIME, run: () => { v.dirt = 0; v.rock = 0; } };
    return { label: v.dirt > 0 ? "Back up to mud, or drive off-road to dump" : "Drive off-road to dump rocks", time: Infinity, run: () => {} };
  }
  return null;
}

function fillMud(w: World, rc: RoadCell, spend: () => void) {
  rc.kind = "ok"; w.mud[rc.cell] = 0; spend(); w.dirtyHazards = true;
}

export function stepGame(g: Game, inp: Input, dt: number) {
  g.vehicles.forEach((v, i) => {
    const me = i === g.active;
    stepVehicle(g, v, me ? inp.throttle : 0, me ? inp.steer : 0, dt);
  });
  const v = g.vehicles[g.active];
  const act = inp.action ? currentAction(g) : null;
  if (act && Number.isFinite(act.time) && Math.abs(v.speed) < 1) {
    g.actionT += dt;
    if (g.actionT >= act.time) { act.run(); g.actionT = 0; }
  } else g.actionT = 0;
  for (const o of g.vehicles) o.work += ((o === v && g.actionT > 0 ? 1 : 0) - o.work) * (1 - Math.exp(-5 * dt));
  if (g.msgT > 0) g.msgT -= dt;
  if (!g.won && progress(g.world).paved >= 0.95) { g.won = true; }
}

export function switchVehicle(g: Game) {
  const v = g.vehicles[g.active];
  let best = -1, bd = 7;
  g.vehicles.forEach((o, i) => { if (i !== g.active) { const d = Math.hypot(o.x - v.x, o.z - v.z); if (d < bd) { bd = d; best = i; } } });
  if (best < 0) { say(g, "Drive closer to another machine to hop in"); return; }
  v.speed = 0; g.active = best; g.actionT = 0;
  say(g, `Now driving: ${MACHINES[g.vehicles[best].kind].label}`);
}

export function recover(g: Game) {
  const v = g.vehicles[g.active], w = g.world;
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
  return { graded: graded / n, paved: paved / n, mounds, mud, rocksOnRoad };
}

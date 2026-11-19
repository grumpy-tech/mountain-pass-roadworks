// Pure game rules: terrain generation, road job state, vehicle sim. No React / three.
export const N = 80; // cells per side
export const CELL = 2;
export const HALF = (N * CELL) / 2;
export const ROAD_HALF_WIDTH = 3.2;

export type Machine = "dozer" | "paver";
export const MACHINES: Record<Machine, { accel: number; max: number; turn: number; label: string }> = {
  dozer: { accel: 2.2, max: 5.5, turn: 1.1, label: "Bulldozer" },
  paver: { accel: 1.6, max: 4, turn: 0.9, label: "Paver" },
};
const DRAG = 1.4;
const MAX_GRADE = 0.75; // steeper than this = can't climb
const CLEAR_RATE = 0.9;
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

export interface RoadCell { cell: number; x: number; z: number; stage: 0 | 1 | 2 | 3; hp: number; level: number; pave: number; t: number }

export interface World {
  path: { x: number; z: number }[];
  base: Float32Array; bump: Float32Array; rough: Float32Array; heights: Float32Array;
  colors: Float32Array;
  road: RoadCell[]; cellToRoad: Int32Array;
  trees: { x: number; z: number; s: number }[];
  boulders: { x: number; z: number; s: number }[];
  dirtyTerrain: boolean; dirtyCells: Set<number>;
}

export const pathX = (t: number) => 34 * Math.sin(t * Math.PI * 2.2) + 10 * Math.sin(t * 9 + 1);
export const pathH = (t: number) => t * 22;

export function createWorld(): World {
  const path: { x: number; z: number }[] = [];
  for (let i = 0; i <= 500; i++) { const t = i / 500; path.push({ x: pathX(t), z: HALF - 26 - t * (2 * HALF - 52) }); }
  const nearest = (x: number, z: number) => {
    let best = 1e9, bt = 0;
    for (let i = 0; i < path.length; i++) {
      const dx = path[i].x - x, dz = path[i].z - z, d = dx * dx + dz * dz;
      if (d < best) { best = d; bt = i / 500; }
    }
    return { d: Math.sqrt(best), t: bt };
  };
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
  // vertex colors
  for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) {
    const v = r * (N + 1) + c, h = base[v], d = dist[v];
    const rel = h - pathH(Math.min(1, Math.max(0, (HALF - 26 - (-HALF + r * CELL)) / (2 * HALF - 52))));
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
  const trees: World["trees"] = [], boulders: World["boulders"] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + (i + 0.5) * CELL, z = -HALF + (j + 0.5) * CELL;
    const { d, t } = nearest(x, z);
    const h = hash(i * 3.1, j * 7.7);
    if (d < ROAD_HALF_WIDTH) {
      const rubble = h < 0.5;
      cellToRoad[j * N + i] = road.length;
      road.push({ cell: j * N + i, x, z, stage: rubble ? 0 : 1, hp: rubble ? 1 + h * 2 : 0, level: 0, pave: 0, t });
    } else if (d > 7 && d < 22 && h > 0.9) trees.push({ x, z, s: 0.8 + hash(i, j) * 0.8 });
    else if (d > 6 && h < 0.03) boulders.push({ x, z, s: 1 + hash(j, i) * 1.5 });
  }
  const w: World = { path, base, bump, rough, heights: new Float32Array(V), colors, road, cellToRoad, trees, boulders, dirtyTerrain: true, dirtyCells: new Set() };
  recomputeHeights(w);
  return w;
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

export function roadCellAt(w: World, x: number, z: number): RoadCell | null {
  const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
  if (i < 0 || j < 0 || i >= N || j >= N) return null;
  const k = w.cellToRoad[j * N + i];
  return k < 0 ? null : w.road[k];
}

export interface Truck { x: number; z: number; heading: number; speed: number; machine: Machine; pitch: number; roll: number; y: number }

export function createTruck(w: World): Truck {
  const p = w.path[4];
  return { x: p.x, z: p.z + 2, heading: Math.PI, speed: 0, machine: "dozer", pitch: 0, roll: 0, y: heightAt(w, p.x, p.z) };
}

export interface Input { throttle: number; steer: number }

function setLevel(w: World, rc: RoadCell, level: number) {
  rc.level = level;
  const i = rc.cell % N, j = Math.floor(rc.cell / N);
  for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const v = (j + dj) * (N + 1) + (i + di);
    w.rough[v] = Math.min(w.rough[v], 1 - level);
  }
  w.dirtyTerrain = true;
}

export function stepTruck(w: World, tr: Truck, inp: Input, dt: number) {
  const M = MACHINES[tr.machine];
  const fx = Math.sin(tr.heading), fz = Math.cos(tr.heading);
  // surface resistance
  const here = roadCellAt(w, tr.x, tr.z);
  let grip = 0.55; // off-road
  if (here) grip = here.stage === 0 ? 0.45 : here.stage === 1 ? 0.7 : here.stage === 2 ? 0.9 : 1;
  tr.speed += inp.throttle * M.accel * dt;
  tr.speed *= Math.exp(-DRAG * (inp.throttle === 0 ? 1.5 : 0.3) * dt);
  const maxS = M.max * grip;
  tr.speed = Math.max(-maxS * 0.5, Math.min(maxS, tr.speed));
  tr.heading += inp.steer * M.turn * dt * Math.min(1, Math.abs(tr.speed) / 1.5 + 0.35) * (tr.speed < -0.1 ? -1 : 1);
  const nx = tr.x + fx * tr.speed * dt, nz = tr.z + fz * tr.speed * dt;
  const h0 = heightAt(w, tr.x, tr.z), h1 = heightAt(w, nx, nz);
  const dist = Math.hypot(nx - tr.x, nz - tr.z);
  const grade = dist > 1e-4 ? (h1 - h0) / dist : 0;
  const lim = HALF - 2;
  if (grade > MAX_GRADE || Math.abs(nx) > lim || Math.abs(nz) > lim) {
    tr.speed *= -0.2; // bump into slope
  } else {
    if (grade > 0) tr.speed *= Math.exp(-grade * 2.5 * dt);
    tr.x = nx; tr.z = nz;
  }
  // body attitude from terrain
  const L = 1.6;
  const hf = heightAt(w, tr.x + fx * L, tr.z + fz * L), hb = heightAt(w, tr.x - fx * L, tr.z - fz * L);
  const hr = heightAt(w, tr.x + fz * L, tr.z - fx * L), hl = heightAt(w, tr.x - fz * L, tr.z + fx * L);
  const tp = Math.atan2(hb - hf, 2 * L), trl = Math.atan2(hr - hl, 2 * L);
  const k = 1 - Math.exp(-6 * dt);
  tr.pitch += (tp - tr.pitch) * k; tr.roll += (trl - tr.roll) * k;
  tr.y += ((hf + hb + hl + hr) / 4 - tr.y) * (1 - Math.exp(-10 * dt));

  // work
  if (Math.abs(tr.speed) < 0.4) return;
  const work = Math.abs(tr.speed) / M.max;
  const ahead = tr.machine === "dozer" ? 2.2 : 0;
  const sx = fz, sz = -fx;
  for (const off of [-1.4, 0, 1.4]) {
    const rc = roadCellAt(w, tr.x + fx * ahead + sx * off, tr.z + fz * ahead + sz * off);
    if (!rc) continue;
    if (tr.machine === "dozer") {
      if (rc.stage === 0) {
        rc.hp -= CLEAR_RATE * dt * (0.5 + work);
        if (rc.hp <= 0) { rc.hp = 0; rc.stage = 1; }
        w.dirtyCells.add(rc.cell);
      } else if (rc.stage === 1) {
        setLevel(w, rc, Math.min(1, rc.level + LEVEL_RATE * dt * (0.5 + work)));
        if (rc.level >= 1) { rc.stage = 2; w.dirtyCells.add(rc.cell); }
      }
    } else if (rc.stage === 2) {
      rc.pave += PAVE_RATE * dt * (0.5 + work);
      if (rc.pave >= 1) { rc.stage = 3; w.dirtyCells.add(rc.cell); }
    }
  }
}

export function progress(w: World) {
  const c = [0, 0, 0, 0];
  for (const r of w.road) c[r.stage]++;
  const n = w.road.length;
  return { cleared: (n - c[0]) / n, graded: (c[2] + c[3]) / n, paved: c[3] / n };
}

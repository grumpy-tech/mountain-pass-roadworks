// Shared terrain grid: constants, noise, the World container and height/cell lookups.
// Pure — no React / three. Level generators (src/game/levels/*) fill a World; world.ts runs the sim on it.
export const N = 80; // cells per side
export const CELL = 2;
export const HALF = (N * CELL) / 2;

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

export type CellKind = "ok" | "mound" | "mud";
export interface RoadCell { cell: number; x: number; z: number; t: number; kind: CellKind; mound: number; stage: 1 | 2 | 3; level: number; pave: number }
export interface Rock { id: number; x: number; z: number; r: number; big: boolean; spin: number }

export interface World {
  path: { x: number; z: number }[];
  base: Float32Array; bump: Float32Array; rough: Float32Array; heights: Float32Array;
  /** Excavated depth per vertex, subtracted from the surface (foundation pits). All zero on levels without digging. */
  dig: Float32Array;
  colors: Float32Array;
  road: RoadCell[]; cellToRoad: Int32Array;
  mud: Uint8Array; mudCells: number[];
  trees: { x: number; z: number; s: number }[];
  boulders: { x: number; z: number; s: number }[];
  rocks: Rock[]; rockCapacity: number; nextRockId: number;
  dirtyTerrain: boolean; dirtyCells: Set<number>; dirtyHazards: boolean;
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
  for (let v = 0; v < w.heights.length; v++) w.heights[v] = w.base[v] + w.bump[v] * w.rough[v] - w.dig[v];
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

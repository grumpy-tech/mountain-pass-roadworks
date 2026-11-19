// Level 1: winding mountain pass road. Terrain generation is unchanged from the original single-level game.
import { CELL, HALF, N, fbm, hash, nearestOnPath, recomputeHeights, smooth, vnoise, type CellKind, type Rock, type RoadCell, type World } from "../grid";
import { makeVehicle, type LevelConfig } from "../world";

export const ROAD_HALF_WIDTH = 3.2;

export const pathX = (t: number) => 34 * Math.sin(t * Math.PI * 2.2) + 10 * Math.sin(t * 9 + 1);
export const pathH = (t: number) => t * 22;
const PZ0 = HALF - 26, PZL = 2 * HALF - 52;

export function createMountainWorld(): World {
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
    path, base, bump, rough, heights: new Float32Array(V), dig: new Float32Array(V), colors, road, cellToRoad, mud, mudCells, trees, boulders,
    rocks, rockCapacity: rocks.length + bigCount * 3, nextRockId: id,
    dirtyTerrain: true, dirtyCells: new Set(), dirtyHazards: true,
  };
  recomputeHeights(w);
  return w;
}

export const MOUNTAIN_LEVEL: LevelConfig = {
  id: "mountain",
  title: "Mountain Pass",
  blurb: "Clear rocks, grade the dirt and pave a winding road up the pass.",
  job: "Pass Road",
  machines: ["dozer", "excavator", "truck", "paver"],
  build() {
    const world = createMountainWorld();
    // paver starts behind the others so it isn't in the way
    const vehicles = [makeVehicle(world, "dozer", 14, 0), makeVehicle(world, "excavator", 6, -1.5), makeVehicle(world, "truck", 2, 1.8), makeVehicle(world, "paver", 1, -2.2)];
    return { world, vehicles, site: null, intro: "Push the rocks off the road with the bulldozer" };
  },
};

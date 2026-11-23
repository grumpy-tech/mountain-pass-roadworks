// Level 2: urban construction site. A flat city lot between neighbouring buildings, a pavement and street on the
// south side, a foundation pit to dig, and a tower crane that lifts every delivery onto the rising building.
import { CELL, HALF, N, hash, recomputeHeights, type World } from "../grid";
import { createSite, inRect, type DeliveryItem, type Rect, type SiteConfig } from "../site";
import { spawnVehicle, type LevelConfig } from "../urbanSim";

const FLOORS = 6;

/** The build order, as data. Each floor needs its steel frame, then its concrete slab; the roof plant tops it out. */
export const URBAN_SCRIPT: DeliveryItem[] = [
  ...Array.from({ length: FLOORS }, (_, i): DeliveryItem[] => [{ kind: "steel", floor: i + 1 }, { kind: "concrete", floor: i + 1 }]).flat(),
  { kind: "roof", floor: FLOORS + 1 },
];

const LOT: Rect = { x0: -36, x1: 36, z0: -40, z1: 20 };
const SIDEWALK: Rect = { x0: -80, x1: 80, z0: 20.3, z1: 24 };
const STREET: Rect = { x0: -80, x1: 80, z0: 24, z1: 38 };

export const URBAN_SITE: SiteConfig = {
  footprint: { x0: -14, x1: -2, z0: -24, z1: -16 },
  floors: FLOORS,
  floorH: 3.6,
  pitDepth: 1.2,
  deliveryZone: { x0: 5, x1: 15, z0: 13, z1: 19 },
  zoneSlots: [{ x: 7.6, z: 16 }, { x: 12.4, z: 16 }],
  truck: { laneZ: 27, spawnX: -46, unloadX: 10, exitX: 60 },
  spoilZone: { x0: -18, x1: -6, z0: 21, z1: 28 },
  publicZone: { x0: -80, x1: 80, z0: 20.3, z1: 40 },
  buildings: [
    { x0: -70, x1: -37, z0: -40, z1: 20, h: 20 },
    { x0: 37, x1: 70, z0: -40, z1: 20, h: 14 },
    { x0: -70, x1: 70, z0: -78, z1: -42, h: 12 },
  ],
  // site fence along the pavement, with a spoil gate (west) and a delivery gate (east)
  fences: [
    { x0: -36, x1: -18, z0: 19.7, z1: 20.3 },
    { x0: -6, x1: 4, z0: 19.7, z1: 20.3 },
    { x0: 16, x1: 36, z0: 19.7, z1: 20.3 },
  ],
  powerLines: { z: 24.2, x0: -60, x1: 60, ys: [11.5, 12.6] },
  script: URBAN_SCRIPT,
  crane: { x: 14, z: -12, jibY: 34, cableMax: 36.5 },
  craneStart: { slew: -0.15, trolley: 26, cable: 22 },
  windMax: 0.5,
  parTime: 600,
  respawn: { x: -2, z: 12, heading: Math.PI },
};

/** Site fuel tank, in the east of the lot clear of the crane, pit and delivery pad. */
export const URBAN_PUMP = { x: 27, z: 2, r: 6 };

function createUrbanWorld(cfg: SiteConfig): World {
  const V = (N + 1) * (N + 1);
  const colors = new Float32Array(V * 3);
  const palette = {
    gravel: [0.54, 0.49, 0.4], pave: [0.72, 0.71, 0.68], asphalt: [0.23, 0.24, 0.26], concrete: [0.55, 0.55, 0.55], city: [0.5, 0.5, 0.48],
  } as const;
  for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) {
    const v = r * (N + 1) + c, x = -HALF + c * CELL, z = -HALF + r * CELL;
    let col: readonly number[] = palette.city;
    if (inRect(STREET, x, z)) col = palette.asphalt;
    else if (inRect(SIDEWALK, x, z)) col = palette.pave;
    else if (inRect(LOT, x, z)) col = palette.gravel;
    else if (cfg.buildings.some((b) => inRect(b, x, z))) col = palette.concrete;
    const j = 0.93 + hash(c, r) * 0.14;
    colors.set([col[0] * j, col[1] * j, col[2] * j], v * 3);
  }
  const w: World = {
    path: [], base: new Float32Array(V), bump: new Float32Array(V), rough: new Float32Array(V).fill(1), heights: new Float32Array(V), dig: new Float32Array(V),
    colors, road: [], cellToRoad: new Int32Array(N * N).fill(-1), mud: new Uint8Array(N * N), mudCells: [], trees: [], boulders: [],
    rocks: [], rockCapacity: 0, nextRockId: 0, dirtyTerrain: true, dirtyCells: new Set(), dirtyHazards: true,
  };
  recomputeHeights(w);
  return w;
}

export const URBAN_LEVEL: LevelConfig = {
  id: "urban",
  title: "Tower Block",
  blurb: "Dig the foundation, then lift a six-storey frame into place with the tower crane.",
  job: "Tower Block",
  machines: ["excavator", "truck", "crane"],
  build() {
    const world = createUrbanWorld(URBAN_SITE);
    const site = createSite(URBAN_SITE);
    const c = URBAN_SITE.crane;
    const vehicles = [
      spawnVehicle(world, "excavator", -9, 4, Math.PI),
      spawnVehicle(world, "truck", -3, 8, Math.PI),
      spawnVehicle(world, "crane", c.x ?? 0, c.z ?? 0, 0),
    ];
    return { world, vehicles, site, pump: URBAN_PUMP, intro: "Dig the foundation: Space digs, load the dump truck, haul spoil out through the west gate" };
  },
};

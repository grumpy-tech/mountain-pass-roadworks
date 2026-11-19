// The start-of-level rules every map must meet. A NEW MAP MUST BE ADDED TO `LEVELS` BELOW (see .claude/skills/roadworks-new-map).
import { describe, expect, it } from "vitest";
import { createForestGame, stepForestGame } from "./forest";
import { START_GAP, START_MAX_SPAN, arcLengths, padWeight, pathPoint, startSlots } from "./startLayout";
import { createGame, nearestOnPath, stepGame } from "./world";

interface Probe {
  name: string;
  /** Largest pitch/roll (radians) a parked machine may start with. New maps use the strict 0.1 (they get a level pad: padWeight). */
  maxLean: number;
  path: { x: number; z: number }[];
  camp: { mid: { x: number; z: number }; colliders: { x: number; z: number; r: number }[] };
  machines: { x: number; z: number; heading: number; pitch: number; roll: number; tipped: boolean }[];
  treesNear: (x: number, z: number, r: number) => boolean;
  idle: (seconds: number) => void;
}

const LEVELS: { name: string; make: () => Probe }[] = [
  {
    name: "Pass Road",
    make: () => {
      const g = createGame(), w = g.world;
      return {
        name: "Pass Road", maxLean: 0.1, path: w.path, camp: w.camp, machines: g.vehicles,
        treesNear: (x, z, r) => w.trees.some((t) => Math.hypot(t.x - x, t.z - z) < r) || w.boulders.some((b) => Math.hypot(b.x - x, b.z - z) < r),
        idle: (s) => { for (let t = 0; t < s; t += 0.05) stepGame(g, { throttle: 0, steer: 0, action: false }, 0.05); },
      };
    },
  },
  {
    name: "Timber Ridge",
    make: () => {
      const g = createForestGame(), w = g.world;
      return {
        // Timber Ridge predates the level pads: its feller and grader start leaning ~0.3 rad. Flatten it with padWeight, then tighten this.
        name: "Timber Ridge", maxLean: 0.32, path: w.path, camp: w.camp, machines: g.vehicles,
        treesNear: (x, z, r) => w.trees.some((t) => t.alive && Math.hypot(t.x - x, t.z - z) < r),
        idle: (s) => { for (let t = 0; t < s; t += 0.05) stepForestGame(g, { throttle: 0, steer: 0, action: false }, 0.05); },
      };
    },
  },
];

const roadHeading = (path: Probe["path"], x: number, z: number) => {
  const n = nearestOnPath(path, x, z), p = path[n.i], q = path[Math.min(path.length - 1, n.i + 3)];
  return { n, p, h: Math.atan2(q.x - p.x, q.z - p.z) };
};
const sideOf = (path: Probe["path"], x: number, z: number) => {
  const { p, h } = roadHeading(path, x, z);
  return Math.sign((x - p.x) * Math.cos(h) - (z - p.z) * Math.sin(h));
};

describe.each(LEVELS)("$name start layout", ({ make }) => {
  it("parks the machines spread out, beside the road (not on it), angled 45 degrees towards it", () => {
    const L = make();
    expect(L.machines.length).toBeGreaterThanOrEqual(4);
    L.machines.forEach((v, i) => {
      const { n, p, h } = roadHeading(L.path, v.x, v.z);
      expect(n.d).toBeGreaterThan(6.3);
      expect(n.d).toBeLessThan(9);
      const diff = Math.atan2(Math.sin(v.heading - h), Math.cos(v.heading - h));
      expect(Math.abs(Math.abs(diff) - Math.PI / 4)).toBeLessThan(0.08);
      // the nose points at the road: rolling forward a little brings it closer
      expect(Math.hypot(p.x - (v.x + Math.sin(v.heading) * 3), p.z - (v.z + Math.cos(v.heading) * 3))).toBeLessThan(n.d);
      for (const o of L.machines.slice(i + 1)) expect(Math.hypot(o.x - v.x, o.z - v.z)).toBeGreaterThan(START_GAP - 0.5); // never clumped
    });
  });

  it("puts every machine on the same side of the road, opposite the camp, clear of camp props and trees", () => {
    const L = make();
    expect(new Set(L.machines.map((v) => sideOf(L.path, v.x, v.z))).size).toBe(1);
    expect(sideOf(L.path, L.machines[0].x, L.machines[0].z)).not.toBe(sideOf(L.path, L.camp.mid.x, L.camp.mid.z));
    for (const v of L.machines) {
      for (const c of L.camp.colliders) expect(Math.hypot(c.x - v.x, c.z - v.z)).toBeGreaterThan(c.r + 3);
      expect(L.treesNear(v.x, v.z, 3.5)).toBe(false);
    }
  });

  it("keeps the row compact: a sharp bend must not stretch it along the road", () => {
    const L = make(), cum = arcLengths(L.path);
    const along = L.machines.map((v) => cum[nearestOnPath(L.path, v.x, v.z).i]);
    expect(Math.max(...along) - Math.min(...along)).toBeLessThanOrEqual(START_MAX_SPAN);
  });

  it("starts clear of tipping (hard mode tips at 0.41 roll / 0.49 pitch), so nothing rolls when the player takes over", () => {
    const L = make();
    L.idle(3);
    for (const v of L.machines) {
      expect(v.tipped).toBe(false);
      expect(Math.abs(v.pitch)).toBeLessThan(L.maxLean);
      expect(Math.abs(v.roll)).toBeLessThan(L.maxLean);
    }
  });
});

describe("startSlots / padWeight", () => {
  it("gives full weight on the pad, none far away, and reports the nearest slot", () => {
    const g = createGame(), slots = g.world.start;
    expect(padWeight(slots, slots[2].x, slots[2].z)).toEqual({ w: 1, i: 2 });
    expect(padWeight(slots, slots[0].x + 40, slots[0].z + 40).w).toBe(0);
    const lone = [{ x: 0, z: 0, heading: 0 }], edge = padWeight(lone, 6.5, 0);
    expect(edge.w).toBeGreaterThan(0);
    expect(edge.w).toBeLessThan(1);
  });

  it("walks the road in metres and returns the direction of travel", () => {
    const w = createGame().world, cum = arcLengths(w.path);
    const a = pathPoint({ path: w.path, cum }, 10), b = pathPoint({ path: w.path, cum }, 10.5);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(0.5, 1);
    expect(startSlots({ path: w.path, cum }, w.camp)).toHaveLength(4);
  });
});

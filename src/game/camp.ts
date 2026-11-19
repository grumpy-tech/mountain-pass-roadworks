// The work camp both levels start from: cabins, parked vehicles, toilet, fuel tank, signage, floodlights.
// Pure layout: positions and colliders only. Camp.tsx draws it.
import type { Collider } from "./shared";

export type CampKind = "cabin" | "office" | "car" | "pickup" | "van" | "toilet" | "tank" | "flag" | "sign" | "light" | "crate" | "fence" | "cone";
export interface CampProp { kind: CampKind; x: number; z: number; rot: number; color?: string; label?: string }
export interface Camp { props: CampProp[]; colliders: Collider[]; fuel: { x: number; z: number; r: number }; x: number; z: number; mid: { x: number; z: number } }

/**
 * Lay the camp out beside a road: (cx, cz) is a point on the road, `heading` the road's direction there.
 * Props sit to the road's right-hand side so machines starting on the road are never boxed in.
 */
export function buildCamp(cx: number, cz: number, heading: number, label: string): Camp {
  const fx = Math.sin(heading), fz = Math.cos(heading); // forward
  const rx = Math.cos(heading), rz = -Math.sin(heading); // right
  const at = (u: number, v: number) => ({ x: cx + rx * u + fx * v, z: cz + rz * u + fz * v });
  const props: CampProp[] = [], colliders: Collider[] = [];
  const add = (kind: CampKind, u: number, v: number, rot: number, extra: Partial<CampProp> = {}, r = 0, along = 0) => {
    const p = at(u, v);
    props.push({ kind, x: p.x, z: p.z, rot: heading + rot, ...extra });
    if (r > 0) { // collider circles spread along the prop's long axis
      const n = along > 0 ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const o = n === 1 ? 0 : (i - 1) * along;
        colliders.push({ x: p.x + Math.sin(heading + rot) * o, z: p.z + Math.cos(heading + rot) * o, r });
      }
    }
  };
  for (const v of [-8, 0, 8]) add("cabin", 13, v, 0, { color: v === 0 ? "#d8d4c4" : "#c9d3da" }, 1.9, 2.2);
  add("office", 22, -3, Math.PI / 2, {}, 2.1, 2.6);
  add("toilet", 10, 14, Math.PI, {}, 0.9);
  add("pickup", 21, 9, 0.3, { color: "#c8392b" }, 1.7, 1.2);
  add("car", 26, 5, -0.5, { color: "#2f5d8a" }, 1.5, 1);
  add("van", 25, 14, 0.1, { color: "#e8e8e8" }, 1.7, 1.4);
  add("tank", 8, -15, Math.PI / 2, {}, 1.4, 1.0);
  for (let i = 0; i < 3; i++) add("crate", 18 + i * 1.3, -16, i, {}, 0.8);
  add("cone", 5.4, -12, 0); add("cone", 5.4, -18, 0);
  add("flag", 9, 20, 0, {}, 0.3);
  add("sign", 6.5, 24, -Math.PI / 2, { label }, 0.5);
  add("light", 11.5, -13, 0, {}, 0.3);
  add("light", 30, 10, 0, {}, 0.3);
  for (let v = -18; v <= 22; v += 4) add("fence", 33, v, 0);
  const f = at(5, -15);
  return { props, colliders, fuel: { x: f.x, z: f.z, r: 5 }, x: cx, z: cz, mid: at(17, 0) };
}

const distToPath = (path: { x: number; z: number }[], x: number, z: number) => {
  let d = 1e9;
  for (const p of path) d = Math.min(d, Math.hypot(p.x - x, p.z - z));
  return d;
};

/**
 * Try the camp at many points along the first stretch of the route, on both sides of the road, and keep the
 * layout that leaves the most room between its solid props and the road (and clear of any `avoid` zones).
 */
export function findCamp(path: { x: number; z: number }[], label: string, avoid: { x: number; z: number; r: number }[] = [], bound = 75): Camp {
  let best: Camp | null = null, bestScore = -1e9;
  for (let i = 8; i <= 80; i += 3) {
    for (const flip of [false, true]) {
      const p = path[i], q = path[i + 3];
      const camp = buildCamp(p.x, p.z, Math.atan2(q.x - p.x, q.z - p.z) + (flip ? Math.PI : 0), label);
      let clear = 1e9;
      for (const pr of camp.props) {
        if (pr.kind === "sign" || pr.kind === "cone") continue;
        clear = Math.min(clear, distToPath(path, pr.x, pr.z));
        if (Math.abs(pr.x) > bound || Math.abs(pr.z) > bound) clear = -50;
        for (const a of avoid) if (Math.hypot(pr.x - a.x, pr.z - a.z) < a.r) clear = Math.min(clear, -20);
      }
      const score = Math.min(clear, 9) - Math.abs(i - 20) * 0.03; // good clearance first, then close to the start
      if (score > bestScore) { bestScore = score; best = camp; }
    }
  }
  return best!;
}

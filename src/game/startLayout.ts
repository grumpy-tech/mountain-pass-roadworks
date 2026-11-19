// Where a map's machines start: a spread-out row parked beside the road, each angled 45 degrees towards it.
// Every map must use this (see .claude/skills/roadworks-new-map): machines that start on the road in a
// clump block each other in, and one pushing past another can tip it over.
// Pure geometry: no React / three, and no import from a level file (levels import this).
import type { Camp } from "./campLayout";

export interface StartSlot { x: number; z: number; heading: number }
type Pt = { x: number; z: number };
type Route = { path: Pt[]; cum: number[] };

export const START_FROM = 8; // metres along the road from its first point where the row begins
export const START_GAP = 7.5; // straight-line gap between parked machines
export const START_COUNT = 4;
export const PARK_OFFSET = 7.5; // metres off the road centre line
export const PAD_INNER = 4.5; // terrain is level within this radius of a parked machine...
export const PAD_OUTER = 9; // ...and blends back into the hillside by this radius
export const PAD_CLEAR = 5.5; // no trees, boulders or bog this close to a parked machine

/** Cumulative arc length along the route, so positions can be asked for in metres. */
export function arcLengths(path: Pt[]) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  return cum;
}

/** The route point `s` metres from its start, with the direction of travel. */
export function pathPoint(w: Route, s: number) {
  const { path, cum } = w, ss = Math.max(0, Math.min(cum[cum.length - 1], s));
  let lo = 1, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < ss) lo = mid + 1; else hi = mid; }
  const a = path[lo - 1], b = path[lo], f = (ss - cum[lo - 1]) / (cum[lo] - cum[lo - 1] || 1);
  const p = path[Math.max(0, lo - 4)], q = path[Math.min(path.length - 1, lo + 3)];
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, heading: Math.atan2(q.x - p.x, q.z - p.z), i: lo };
}

function nearestIndex(path: Pt[], x: number, z: number) {
  let best = 1e9, bi = 0;
  for (let i = 0; i < path.length; i++) {
    const d = (path[i].x - x) ** 2 + (path[i].z - z) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  return bi;
}

export const START_MAX_SPAN = 36; // metres: the whole row must fit within this much of the road

/** One greedy row of parking spots beginning `from` metres along the road. Slot 0 is the nearest the road start. */
function parkingRow(w: Route, side: number, from: number): StartSlot[] {
  const slots: StartSlot[] = [];
  for (let s = from; slots.length < START_COUNT && s < w.cum[w.cum.length - 1]; s += 0.5) {
    const p = pathPoint(w, s), rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
    const x = p.x + rx * side * PARK_OFFSET, z = p.z + rz * side * PARK_OFFSET, last = slots[slots.length - 1];
    if (!last || Math.hypot(x - last.x, z - last.z) >= START_GAP) slots.push({ x, z, heading: p.heading - side * (Math.PI / 4) });
  }
  return slots;
}

/** A row is good when it is complete, compact (a tight bend squeezes spots together and stretches the row), and nobody is crowded. */
function goodRow(row: StartSlot[], w: Route) {
  if (row.length < START_COUNT) return false;
  const along = row.map((q) => w.cum[nearestIndex(w.path, q.x, q.z)]);
  if (Math.max(...along) - Math.min(...along) > START_MAX_SPAN) return false;
  for (let i = 0; i < row.length; i++) for (let j = i + 1; j < row.length; j++) if (Math.hypot(row[i].x - row[j].x, row[i].z - row[j].z) < START_GAP - 0.5) return false;
  return true;
}

/**
 * A row of parking spots on the far side of the road from the camp, spaced out, each angled 45 degrees towards
 * the road. It begins `from` metres along the road, or at the first compact stretch after that, so a sharp bend
 * near the start does not scatter it. Slot 0 is the furthest along the road: give it the machine that works first.
 */
export function startSlots(w: Route, camp: Camp, from = START_FROM): StartSlot[] {
  const ref = pathPoint(w, w.cum[nearestIndex(w.path, camp.x, camp.z)]);
  const campSide = Math.sign((camp.mid.x - ref.x) * Math.cos(ref.heading) - (camp.mid.z - ref.z) * Math.sin(ref.heading)) || 1;
  const side = -campSide; // +1 = the "right" vector (cos h, -sin h) side of the road
  const total = w.cum[w.cum.length - 1];
  const tries = [from, ...[6, 4, 2, 0].filter((f) => f < from), ...Array.from({ length: 40 }, (_, k) => from + 2 * (k + 1))].filter((f) => f < total);
  for (const f of tries) { const row = parkingRow(w, side, f); if (goodRow(row, w)) return row.reverse(); }
  return parkingRow(w, side, from).reverse();
}

/** True when (x, z) is within `r` of any parking slot (keep scenery and hazards away from the row). */
export function nearSlot(slots: StartSlot[], x: number, z: number, r = PAD_CLEAR) {
  return slots.some((q) => Math.hypot(x - q.x, z - q.z) < r);
}

/**
 * How strongly the terrain at (x, z) should be flattened onto the parking pad under the nearest slot (`w`, 0..1),
 * and which slot that is (`i`). Blend the terrain height towards the road height at that slot with this weight,
 * so a parked machine never starts on a slope (and a heavy machine never tips the moment the player takes over).
 */
export function padWeight(slots: StartSlot[], x: number, z: number) {
  let d = 1e9, i = -1;
  slots.forEach((q, k) => { const dk = Math.hypot(x - q.x, z - q.z); if (dk < d) { d = dk; i = k; } });
  if (d >= PAD_OUTER) return { w: 0, i };
  if (d <= PAD_INNER) return { w: 1, i };
  const t = (PAD_OUTER - d) / (PAD_OUTER - PAD_INNER);
  return { w: t * t * (3 - 2 * t), i };
}

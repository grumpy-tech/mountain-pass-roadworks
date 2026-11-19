// Urban construction-site rules: foundation pit, delivery zone + scripted truck deliveries, crane loads,
// building progress, hazards and scoring. Pure — no React / three. Layout comes from a SiteConfig
// (levels/urban.ts), so a different site only needs different numbers and a different delivery script.
import { CELL, HALF, N, heightAt, recomputeHeights, type World } from "./grid";
import { createCrane, stepCrane, type CraneConfig, type CraneEnv, type CraneInput, type CraneState } from "./crane";

export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface Solid extends Rect { h: number }

export type PalletKind = "steel" | "concrete" | "roof";
/** One scheduled delivery. The script is the build order: it is shipped, and must be placed, in this order. */
export interface DeliveryItem { kind: PalletKind; floor: number }

export const PALLETS: Record<PalletKind, { label: string; w: number; h: number; d: number }> = {
  steel: { label: "Steel frame", w: 4, h: 0.8, d: 1.4 },
  concrete: { label: "Concrete skip", w: 2.2, h: 1.3, d: 2.2 },
  roof: { label: "Rooftop plant", w: 3, h: 2, d: 3 },
};

export const SLING = 1.4; // hook to top of load
export const HOOK_H = 0.35; // empty hook resting height above a surface
export const SLAB_T = 0.4;
const PICK_RADIUS = 1.3;
const PICK_HEIGHT = SLING + 0.5; // hook must be down at sling height over the load
const SOFT_LAND = 1.0; // metres of drop that count as setting a load down
const WRECK_LAND = 3.5; // metres of drop that wreck it
const UNLOAD_TIME = 1.6;
const TRUCK_SPEED = 11;
const TRUCK_GAP = 9;
const WAIT_GRACE = 30; // s a truck may wait for space before it counts as blocking traffic
const CURE_TIME = 3;

export interface SiteConfig {
  footprint: Rect; // building outline; also the foundation pit
  floors: number;
  floorH: number;
  pitDepth: number;
  deliveryZone: Rect;
  zoneSlots: { x: number; z: number }[];
  truck: { laneZ: number; spawnX: number; unloadX: number; exitX: number };
  spoilZone: Rect;
  /** Pavement + road: loads must never be dropped here and are penalised when swung over it. */
  publicZone: Rect;
  buildings: Solid[]; // neighbouring buildings: block vehicles, hooks and loads
  fences: Rect[]; // block vehicles only
  powerLines: { z: number; x0: number; x1: number; ys: number[] };
  script: DeliveryItem[];
  crane: Partial<CraneConfig>;
  craneStart: { slew: number; trolley: number; cable: number };
  /** Peak wind acceleration (m/s²) at the top of the building, before the per-floor ramp. */
  windMax: number;
  parTime: number; // seconds for the time star
  /** Where R puts a machine back when it is stuck or tipped. */
  respawn: { x: number; z: number; heading: number };
}

export interface Pallet {
  id: number; idx: number; kind: PalletKind;
  x: number; y: number; z: number; // y = underside
  state: "unloading" | "rest" | "hooked" | "falling";
  vx: number; vy: number; vz: number; fallFrom: number;
  u: number; fromX: number; fromY: number; fromZ: number; toX: number; toZ: number;
  damaged: boolean;
}

export interface DeliveryTruck {
  id: number; idx: number; kind: PalletKind; x: number;
  state: "driving" | "unloading" | "leaving";
  t: number; wait: number; speed: number; pallet: number | null; stopped: boolean;
}

export interface Site {
  cfg: SiteConfig;
  crane: CraneState;
  loadId: number | null;
  pallets: Pallet[]; nextPalletId: number;
  trucks: DeliveryTruck[]; nextTruckId: number;
  nextDelivery: number; redeliver: number[];
  // building progress
  nextBuild: number; floorsDone: number; frameUp: boolean; roofDone: boolean; cure: { floor: number; t: number } | null;
  toppedOut: boolean;
  // foundation
  pitCells: number[]; dug: Set<number>; hauled: number;
  /** Original ground colour of pit vertices, so digging can darken them without compounding. */
  groundColor: Map<number, [number, number, number]>;
  // run stats
  time: number; damage: number; exposure: number; traffic: number;
  wind: { x: number; z: number };
  /** Messages for the HUD toast, drained by the game loop. */
  notes: string[];
  cooldown: { building: number; power: number };
}

export const inRect = (r: Rect, x: number, z: number, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function createSite(cfg: SiteConfig): Site {
  const pitCells: number[] = [];
  const i0 = Math.floor((cfg.footprint.x0 + HALF) / CELL), i1 = Math.ceil((cfg.footprint.x1 + HALF) / CELL);
  const j0 = Math.floor((cfg.footprint.z0 + HALF) / CELL), j1 = Math.ceil((cfg.footprint.z1 + HALF) / CELL);
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) pitCells.push(j * N + i);
  return {
    cfg,
    crane: createCrane(cfg.crane, cfg.craneStart.slew, cfg.craneStart.trolley, cfg.craneStart.cable),
    loadId: null, pallets: [], nextPalletId: 1, trucks: [], nextTruckId: 1,
    nextDelivery: 0, redeliver: [],
    nextBuild: 0, floorsDone: 0, frameUp: false, roofDone: false, cure: null, toppedOut: false,
    pitCells, dug: new Set(), hauled: 0, groundColor: new Map(),
    time: 0, damage: 0, exposure: 0, traffic: 0,
    wind: { x: 0, z: 0 }, notes: [], cooldown: { building: 0, power: 0 },
  };
}

// ---------- foundation ----------

export const cellCenter = (c: number) => ({ x: -HALF + ((c % N) + 0.5) * CELL, z: -HALF + (Math.floor(c / N) + 0.5) * CELL });
export const foundationDone = (s: Site) => s.hauled >= s.pitCells.length;

/** Nearest undug pit cell to a reach point, within `r` metres. */
export function nextDigCell(s: Site, px: number, pz: number, r = 3): number {
  let best = -1, bd = r;
  for (const c of s.pitCells) {
    if (s.dug.has(c)) continue;
    const p = cellCenter(c), d = Math.hypot(p.x - px, p.z - pz);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

export function digCell(w: World, s: Site, cell: number) {
  s.dug.add(cell);
  w.dig.fill(0);
  for (const c of s.dug) {
    const i = c % N, j = Math.floor(c / N);
    for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) w.dig[(j + dj) * (N + 1) + (i + di)] += s.cfg.pitDepth / 4;
  }
  recomputeHeights(w); // physics reads w.heights directly; the renderer only needs the dirty flag
  // freshly dug soil is darker, so the pit reads from above
  for (let v = 0; v < w.dig.length; v++) {
    if (w.dig[v] <= 0) continue;
    let orig = s.groundColor.get(v);
    if (!orig) { orig = [w.colors[v * 3], w.colors[v * 3 + 1], w.colors[v * 3 + 2]]; s.groundColor.set(v, orig); }
    const f = 1 - 0.4 * Math.min(1, w.dig[v] / s.cfg.pitDepth);
    for (let k = 0; k < 3; k++) w.colors[v * 3 + k] = orig[k] * f * (k === 2 ? 0.95 : 1);
  }
  w.dirtyTerrain = true;
}

export const inSpoilZone = (s: Site, x: number, z: number) => inRect(s.cfg.spoilZone, x, z);

export function haulSpoil(s: Site, units: number) {
  const before = s.hauled;
  s.hauled = Math.min(s.pitCells.length, s.hauled + units);
  if (before < s.pitCells.length && foundationDone(s)) s.notes.push("Foundation ready — the crane can start lifting");
}

// ---------- geometry ----------

/** True if a ground vehicle at (x, z) would be inside a neighbouring building, the fence, or the rising building. */
export function solidAt(s: Site, x: number, z: number, m = 1.4) {
  const c = s.cfg;
  return c.buildings.some((b) => inRect(b, x, z, m)) || c.fences.some((f) => inRect(f, x, z, m)) || (buildingStarted(s) && inRect(c.footprint, x, z, m));
}

export const baseY = (s: Site) => -s.cfg.pitDepth;
/** Height of the structure's current top inside the footprint. */
export function structureTop(s: Site) {
  const c = s.cfg;
  return baseY(s) + s.floorsDone * c.floorH + (s.frameUp ? c.floorH - SLAB_T : 0) + (s.roofDone ? PALLETS.roof.h : 0);
}
export const buildingStarted = (s: Site) => s.floorsDone > 0 || s.frameUp;

/** Highest surface a load or hook can rest on at (x, z). */
export function supportY(s: Site, w: World, x: number, z: number) {
  let y = heightAt(w, x, z);
  if (inRect(s.cfg.footprint, x, z, 0.3)) y = Math.max(y, structureTop(s));
  for (const b of s.cfg.buildings) if (inRect(b, x, z)) y = Math.max(y, b.h);
  return y;
}

const palletById = (s: Site, id: number | null) => (id == null ? undefined : s.pallets.find((p) => p.id === id));
export const hookedPallet = (s: Site) => palletById(s, s.loadId);
export const targetPallet = (s: Site) => s.pallets.find((p) => p.idx === s.nextBuild);

/** Lowest y the hook can reach at (x, z). A resting load under the hook holds it up; a hooked load holds itself up. */
function minHookY(s: Site, w: World, x: number, z: number) {
  const load = hookedPallet(s);
  let y = supportY(s, w, x, z);
  if (load) return y + SLING + PALLETS[load.kind].h;
  for (const p of s.pallets) {
    if (p.state !== "rest") continue;
    const d = PALLETS[p.kind];
    if (Math.abs(x - p.x) < d.w / 2 && Math.abs(z - p.z) < d.d / 2) y = Math.max(y, p.y + d.h + SLING - HOOK_H);
  }
  return y + HOOK_H;
}

export function windAt(s: Site, hookY: number) {
  const c = s.cfg, t = s.time;
  const height = clamp((hookY - baseY(s)) / (c.floors * c.floorH), 0, 1);
  const ramp = 0.2 + 0.8 * (s.floorsDone / c.floors); // gentle for the first floor, real by the top
  const amp = c.windMax * ramp * (0.35 + 0.65 * height);
  const gust = 0.55 + 0.45 * Math.sin(t * 0.31) * Math.sin(t * 0.83 + 1.7);
  const dir = 0.7 + 0.5 * Math.sin(t * 0.047);
  return { x: Math.cos(dir) * amp * gust, z: Math.sin(dir) * amp * gust };
}

// ---------- hooking ----------

/** The resting load the empty hook could pick up right now, if any. */
export function pickTarget(s: Site): Pallet | undefined {
  const c = s.crane;
  let best: Pallet | undefined, bd = PICK_RADIUS;
  for (const p of s.pallets) {
    if (p.state !== "rest") continue;
    const top = p.y + PALLETS[p.kind].h;
    const d = Math.hypot(c.hook.x - p.x, c.hook.z - p.z);
    if (d < bd && c.hook.y - top < PICK_HEIGHT && c.hook.y > top - 0.3) { bd = d; best = p; }
  }
  return best;
}

export function toggleHook(s: Site): string {
  const c = s.crane;
  const load = hookedPallet(s);
  if (load) {
    load.state = "falling";
    load.vx = c.hookVel.x * 0.8; load.vz = c.hookVel.z * 0.8; load.vy = c.hookVel.y;
    load.fallFrom = load.y;
    s.loadId = null;
    return "Load released";
  }
  const best = pickTarget(s);
  if (!best) return "Nothing in reach — lower the hook onto a load";
  best.state = "hooked";
  s.loadId = best.id;
  return `Hooked: ${PALLETS[best.kind].label}`;
}

// ---------- stepping ----------

function note(s: Site, m: string) { s.notes.push(m); }

/** A load was lost: recall trucks that haven't unloaded yet so the replacement arrives first, not behind later items. */
function reorderDeliveries(s: Site, lostIdx: number) {
  for (const t of s.trucks) {
    if (t.state !== "driving") continue;
    s.redeliver.push(t.idx);
    t.state = "leaving"; t.pallet = null;
  }
  s.redeliver.push(lostIdx);
  s.redeliver.sort((a, b) => a - b);
}

function land(s: Site, p: Pallet, sup: number) {
  const c = s.cfg;
  const drop = p.fallFrom - sup;
  const remove = () => s.pallets.splice(s.pallets.indexOf(p), 1);
  p.y = sup; p.state = "rest"; p.vx = p.vy = p.vz = 0;
  if (inRect(c.publicZone, p.x, p.z)) {
    s.damage += 4; note(s, "Load dropped on the public footpath!");
    remove(); reorderDeliveries(s, p.idx);
    return;
  }
  if (drop > WRECK_LAND) {
    s.damage += 3; note(s, `${PALLETS[p.kind].label} smashed — replacement ordered`);
    remove(); reorderDeliveries(s, p.idx);
    return;
  }
  const hard = drop > SOFT_LAND;
  if (hard) { s.damage += 1; p.damaged = true; note(s, "Hard landing"); }
  const fp = c.footprint;
  if (inRect({ x0: fp.x0 + 0.4, x1: fp.x1 - 0.4, z0: fp.z0 + 0.4, z1: fp.z1 - 0.4 }, p.x, p.z) && foundationDone(s)) {
    if (p.idx === s.nextBuild) { remove(); place(s, p); return; }
    const item = c.script[s.nextBuild];
    note(s, item ? `Not yet — ${PALLETS[item.kind].label.toLowerCase()} for floor ${item.floor} goes first` : "Not needed");
  }
}

function place(s: Site, p: Pallet) {
  const item = s.cfg.script[p.idx];
  s.nextBuild = p.idx + 1;
  if (item.kind === "steel") { s.frameUp = true; note(s, `Floor ${item.floor}: frame up`); }
  else if (item.kind === "concrete") {
    s.frameUp = false; s.floorsDone = item.floor; s.cure = { floor: item.floor, t: 0 };
    note(s, `Floor ${item.floor} poured`);
  } else { s.roofDone = true; s.toppedOut = true; note(s, "Topped out!"); }
}

function stepPallets(s: Site, w: World, dt: number) {
  const hook = s.crane.hook;
  for (const p of [...s.pallets]) {
    const d = PALLETS[p.kind];
    if (p.state === "hooked") { p.x = hook.x; p.z = hook.z; p.y = hook.y - SLING - d.h; }
    else if (p.state === "rest") p.y = Math.max(p.y, supportY(s, w, p.x, p.z)); // a rising structure lifts loose loads
    else if (p.state === "unloading") {
      p.u = Math.min(1, p.u + dt / (UNLOAD_TIME * 0.9));
      const e = p.u * p.u * (3 - 2 * p.u);
      p.x = p.fromX + (p.toX - p.fromX) * e; p.z = p.fromZ + (p.toZ - p.fromZ) * e;
      const sup = supportY(s, w, p.toX, p.toZ);
      p.y = p.fromY + (sup - p.fromY) * e + Math.sin(Math.PI * p.u) * 2.5;
      if (p.u >= 1) { p.y = sup; p.state = "rest"; }
    } else if (p.state === "falling") {
      p.vy -= 9.81 * dt;
      p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
      const sup = supportY(s, w, p.x, p.z);
      if (p.y <= sup) land(s, p, sup);
    }
  }
}

function freeSlot(s: Site) {
  for (const sl of s.cfg.zoneSlots) {
    const taken = s.pallets.some((p) => {
      if (p.state === "hooked") return false;
      if (p.state === "unloading") return p.toX === sl.x && p.toZ === sl.z;
      return Math.hypot(p.x - sl.x, p.z - sl.z) < 2.4;
    });
    if (!taken) return sl;
  }
  return null;
}

function stepTrucks(s: Site, dt: number) {
  const c = s.cfg, T = c.truck;
  const total = c.script.length;
  const open = s.hauled >= s.pitCells.length * 0.7; // trucks start arriving as the dig nears its end
  const active = s.trucks.filter((t) => t.state !== "leaving");
  const nearSpawn = s.trucks.some((t) => t.x < T.spawnX + 14);
  if (open && !s.toppedOut && active.length < 2 && !nearSpawn && (s.redeliver.length > 0 || s.nextDelivery < total)) {
    const idx = s.redeliver.length ? s.redeliver.shift()! : s.nextDelivery++;
    s.trucks.push({ id: s.nextTruckId++, idx, kind: c.script[idx].kind, x: T.spawnX, state: "driving", t: 0, wait: 0, speed: 0, pallet: null, stopped: false });
  }
  const ready = foundationDone(s);
  for (const t of [...s.trucks]) {
    if (t.state === "driving") {
      let stop = T.unloadX;
      for (const o of s.trucks) if (o !== t && o.state !== "leaving" && o.x > t.x) stop = Math.min(stop, o.x - TRUCK_GAP);
      const want = Math.min(TRUCK_SPEED, Math.max(0, (stop - t.x) * 2.2));
      t.speed += (want - t.speed) * Math.min(1, 3 * dt);
      t.x = Math.min(stop, t.x + t.speed * dt);
      t.stopped = stop - t.x < 0.2;
      if (t.stopped && stop === T.unloadX && t.x >= T.unloadX - 0.3) {
        const slot = ready ? freeSlot(s) : null;
        if (slot) {
          const p: Pallet = {
            id: s.nextPalletId++, idx: t.idx, kind: t.kind, x: t.x, y: 1.6, z: T.laneZ, state: "unloading",
            vx: 0, vy: 0, vz: 0, fallFrom: 0, u: 0, fromX: t.x, fromY: 1.6, fromZ: T.laneZ, toX: slot.x, toZ: slot.z, damaged: false,
          };
          s.pallets.push(p); t.pallet = p.id; t.state = "unloading"; t.t = 0;
        } else if (ready) {
          t.wait += dt;
          if (t.wait > WAIT_GRACE) s.traffic += dt; // truck stuck in the street because the pad is full
        }
      }
    } else if (t.state === "unloading") {
      t.t += dt;
      if (t.t >= UNLOAD_TIME) { t.state = "leaving"; t.speed = 0; }
    } else {
      t.speed = Math.min(TRUCK_SPEED, t.speed + 7 * dt);
      t.x += t.speed * dt;
      if (t.x > T.exitX) s.trucks.splice(s.trucks.indexOf(t), 1);
    }
  }
}

function stepHazards(s: Site, dt: number) {
  const c = s.crane, h = c.hook, cfg = s.cfg;
  const load = hookedPallet(s);
  const lowY = load ? h.y - SLING - PALLETS[load.kind].h : h.y;
  if (load && inRect(cfg.publicZone, h.x, h.z)) s.exposure += dt;
  for (const k of Object.keys(s.cooldown) as (keyof Site["cooldown"])[]) s.cooldown[k] = Math.max(0, s.cooldown[k] - dt);
  // neighbouring buildings: the hook and load can't pass through walls
  for (const b of cfg.buildings) {
    if (!inRect(b, h.x, h.z, 0.4) || lowY >= b.h - 0.05) continue; // above the roof: minHookY holds it up
    const dl = h.x - b.x0, dr = b.x1 - h.x, du = h.z - b.z0, dd = b.z1 - h.z;
    const m = Math.min(dl, dr, du, dd);
    const speed = Math.hypot(c.hookVel.x, c.hookVel.z);
    if (m === dl) h.x = b.x0 - 0.4; else if (m === dr) h.x = b.x1 + 0.4; else if (m === du) h.z = b.z0 - 0.4; else h.z = b.z1 + 0.4;
    c.hookVel.x = 0; c.hookVel.z = 0;
    if (speed > 1.2 && s.cooldown.building <= 0) { s.damage += 1; s.cooldown.building = 1.5; note(s, "Load scraped the neighbouring building"); }
  }
  // power lines
  const pl = cfg.powerLines;
  if (Math.abs(h.z - pl.z) < 0.8 && h.x > pl.x0 && h.x < pl.x1 && s.cooldown.power <= 0) {
    if (pl.ys.some((y) => Math.abs(y - h.y) < 0.9 || (load && Math.abs(y - (lowY + PALLETS[load.kind].h / 2)) < 1.2))) {
      s.damage += 2; s.cooldown.power = 2.5; note(s, "Hit the power line!");
    }
  }
}

export function stepSite(s: Site, w: World, input: CraneInput, dt: number) {
  if (!s.toppedOut) s.time += dt;
  s.wind = windAt(s, s.crane.hook.y);
  const env: CraneEnv = { minHookY: (x, z) => minHookY(s, w, x, z), wind: s.wind };
  stepCrane(s.crane, input, dt, env);
  stepHazards(s, dt);
  stepPallets(s, w, dt);
  stepTrucks(s, dt);
  if (s.cure) { s.cure.t += dt / CURE_TIME; if (s.cure.t >= 1) s.cure = null; }
}

// ---------- scoring + hints ----------

export function stars(s: Site) {
  const time = s.time <= s.cfg.parTime;
  const safe = s.damage <= 3 && s.exposure <= 6;
  const traffic = s.traffic <= 20;
  return { time, safe, traffic, total: +time + +safe + +traffic };
}

export function craneHint(s: Site, inCrane: boolean): string {
  if (s.toppedOut) return "";
  if (!foundationDone(s)) return "Dig the foundation with the excavator, load the truck, haul spoil to the pad at the gate";
  const load = hookedPallet(s);
  const next = s.cfg.script[s.nextBuild];
  if (!inCrane) return "Drive next to the crane base and press E to take the controls";
  if (load) {
    if (load.idx !== s.nextBuild) return next ? `Wrong load — ${PALLETS[next.kind].label.toLowerCase()} for floor ${next.floor} is next. Set this one down` : "";
    return "Lift clear, slew to the green outline on the building, ease down to the deck, then Space to release";
  }
  const t = targetPallet(s);
  if (!t) return next ? `Waiting for ${PALLETS[next.kind].label.toLowerCase()} for floor ${next.floor}…` : "";
  return "Trolley (W/S) and slew (A/D) the hook over the load, lower it (↓), then Space to hook on";
}

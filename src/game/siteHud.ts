// Snapshot of site state for the HUD, sampled by Game.tsx a few times a second.
import { PALLETS, craneHint, foundationDone, hookedPallet, stars } from "./site";
import type { Game } from "./urbanSim";

export interface SiteHud {
  dug: number; hauled: number; total: number;
  floors: number; floorsTotal: number; roof: boolean;
  next: string; load: string;
  time: number; damage: number; exposure: number; traffic: number;
  swing: number; wind: number; windDir: number; hookH: number; trolley: number;
  inCrane: boolean; cam: "overview" | "cab"; hint: string; stage: 1 | 2 | 3;
  stars: { time: boolean; safe: boolean; traffic: boolean; total: number };
}

export function readSiteHud(g: Game): SiteHud | null {
  const s = g.site;
  if (!s) return null;
  const inCrane = g.vehicles[g.active].kind === "crane";
  const next = s.cfg.script[s.nextBuild];
  const load = hookedPallet(s);
  return {
    dug: s.dug.size, hauled: s.hauled, total: s.pitCells.length,
    floors: s.floorsDone, floorsTotal: s.cfg.floors, roof: s.roofDone,
    next: next ? `${PALLETS[next.kind].label}${next.kind === "roof" ? "" : ` · floor ${next.floor}`}` : "All delivered",
    load: load ? PALLETS[load.kind].label : "empty hook",
    time: s.time, damage: s.damage, exposure: s.exposure, traffic: s.traffic,
    swing: (s.crane.swing * 180) / Math.PI, wind: Math.hypot(s.wind.x, s.wind.z), windDir: (Math.atan2(s.wind.z, s.wind.x) * 180) / Math.PI,
    hookH: s.crane.hook.y, trolley: s.crane.trolley,
    inCrane, cam: g.cam, hint: craneHint(s, inCrane),
    stage: s.toppedOut ? 3 : foundationDone(s) ? 2 : 1,
    stars: stars(s),
  };
}

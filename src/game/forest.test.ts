import { describe, expect, it } from "vitest";
import {
  FALL_TIME, LOG_TARGET, OPEN_AT, SKIDDER_CAPACITY, TRUCK_CAPACITY, blockersLeft, blockersTotal, createForestGame, currentForestAction, cycleForestVehicle, forestHint,
  pathPoint, recoverForest, roadLevelled, selectForestVehicle, stepForestGame, tankerEta, type ForestGame, type ForestMachine, type ForestVehicle,
} from "./forest";
import { nearestOnPath } from "./world";

/** Hold the tanker's clock forward until `until` is true, in 0.1 s steps. */
const runUntil = (g: ForestGame, until: () => boolean, max = 400) => {
  let t = 0;
  while (!until() && t < max) { stepForestGame(g, { throttle: 0, steer: 0, action: false }, 0.1); t += 0.1; }
  return t;
};

const hold = (g: ForestGame, seconds: number, action = true) => {
  for (let t = 0; t < seconds; t += 0.05) stepForestGame(g, { throttle: 0, steer: 0, action }, 0.05);
};
const place = (v: ForestVehicle, x: number, z: number, heading = 0) => { v.x = x; v.z = z; v.heading = heading; v.speed = 0; };
const veh = (g: ForestGame, kind: ForestMachine) => g.vehicles.find((v) => v.kind === kind)!;
const drive = (g: ForestGame, kind: ForestMachine) => { g.active = g.vehicles.indexOf(veh(g, kind)); return veh(g, kind); };
/** Clear every blocker and level the whole road, as a short cut to the later stages. */
const openRoad = (g: ForestGame) => {
  const w = g.world;
  w.trees.forEach((t) => { if (t.kind === "blocker") t.alive = false; });
  w.deadfalls.forEach((d) => { d.cleared = true; });
  w.road.forEach((r) => { r.rut = 0; });
  hold(g, 0.1, false);
};

describe("forest level", () => {
  it("lays the camp out clear of the road and the machines", () => {
    const g = createForestGame(), w = g.world;
    for (const p of w.camp.props) if (p.kind !== "sign" && p.kind !== "cone") expect(nearestOnPath(w.path, p.x, p.z).d).toBeGreaterThan(5);
    for (const v of g.vehicles) for (const c of w.camp.colliders) expect(Math.hypot(c.x - v.x, c.z - v.z)).toBeGreaterThan(c.r + 1.7);
    for (const t of w.trees) expect(Math.hypot(t.x - w.camp.mid.x, t.z - w.camp.mid.z)).toBeGreaterThan(20);
  });

  it("starts with the old road blocked, rutted and closed, and marks the trees to cut", () => {
    const g = createForestGame(), w = g.world;
    expect(blockersTotal(w)).toBeGreaterThanOrEqual(8);
    expect(blockersLeft(w)).toBe(blockersTotal(w));
    expect(roadLevelled(w)).toBe(0);
    expect(w.roadOpen).toBe(false);
    expect(w.trees.filter((t) => t.kind === "marked")).toHaveLength(LOG_TARGET);
  });

  it("the feller clears a blocker tree and leaves no log", () => {
    const g = createForestGame(), w = g.world;
    const before = blockersLeft(w), t = w.trees.find((x) => x.kind === "blocker")!;
    place(drive(g, "feller"), t.x, t.z - 3);
    hold(g, 1.5);
    expect(t.alive).toBe(false);
    expect(blockersLeft(w)).toBe(before - 1);
    expect(w.logs).toHaveLength(0);
    expect(g.fx.some((f) => f.kind === "treefall") && g.fx.some((f) => f.kind === "sawdust")).toBe(true);
  });

  it("only the skidder can drag a deadfall aside, and it blocks other machines", () => {
    const g = createForestGame(), w = g.world, d = w.deadfalls[0];
    place(drive(g, "feller"), d.x, d.z - 3);
    expect(currentForestAction(g)?.label ?? "").not.toMatch(/deadfall/i);
    place(drive(g, "skidder"), d.x, d.z - 3);
    hold(g, 1.3);
    expect(d.cleared).toBe(true);
  });

  it("opens the road once blockers are gone and ruts are graded", () => {
    const g = createForestGame(), w = g.world, gr = drive(g, "grader");
    w.trees.forEach((t) => { if (t.kind === "blocker") t.alive = false; });
    w.deadfalls.forEach((d) => { d.cleared = true; });
    for (let pass = 0; pass < 6; pass++) for (let i = 0; i < w.path.length - 4; i += 2) {
      const p = w.path[i], q = w.path[i + 4];
      place(gr, p.x, p.z, Math.atan2(q.x - p.x, q.z - p.z));
      gr.speed = 3;
      stepForestGame(g, { throttle: 0, steer: 0, action: false }, 0.1);
    }
    expect(roadLevelled(w)).toBeGreaterThan(OPEN_AT);
    expect(w.roadOpen).toBe(true);
  });

  it("reopens the road at 85% levelled, not before", () => {
    const g = createForestGame(), w = g.world;
    w.trees.forEach((t) => { if (t.kind === "blocker") t.alive = false; });
    w.deadfalls.forEach((d) => { d.cleared = true; });
    expect(OPEN_AT).toBe(0.85);
    const levelled = (share: number) => w.road.forEach((r, i) => { r.rut = i < Math.floor(w.road.length * share) ? 0 : 1; });
    levelled(0.8);
    hold(g, 0.1, false);
    expect(w.roadOpen).toBe(false);
    levelled(0.87);
    hold(g, 0.1, false);
    expect(w.roadOpen).toBe(true);
  });

  it("marked trees are locked until the road is open: they can't be cut and the player is told why", () => {
    const g = createForestGame(), w = g.world, f = drive(g, "feller");
    const marked = w.trees.find((t) => t.kind === "marked")!;
    place(f, marked.x, marked.z - 3);
    const act = currentForestAction(g);
    expect(act?.blocked).toMatch(/restore the road/i);
    expect(Number.isFinite(act!.time)).toBe(false);
    hold(g, 3);
    expect(marked.alive).toBe(true); // still standing, so the job can still be finished
    expect(w.wasted).toBe(0);
    expect(w.felled).toBe(0);
    expect(g.msg).toMatch(/closed/i);
    expect(w.trees.filter((t) => t.kind === "marked" && t.alive)).toHaveLength(LOG_TARGET);
  });

  it("warns the first time a machine drives into the closed cut block", () => {
    const g = createForestGame(), w = g.world;
    place(drive(g, "grader"), w.landing.x - 6, w.landing.z + 6);
    hold(g, 0.1, false);
    expect(g.blockWarned).toBe(true);
    expect(g.msg).toMatch(/cut block is closed/i);
  });

  it("only marked trees give logs, and only after the road is open", () => {
    const g = createForestGame(), w = g.world, f = drive(g, "feller");
    const plain = w.trees.find((t) => t.kind === "forest")!;
    openRoad(g);
    const m2 = w.trees.find((t) => t.kind === "marked" && t.alive)!;
    place(f, m2.x, m2.z - 3);
    hold(g, 1.5);
    expect(w.logs).toHaveLength(1);
    expect(w.felled).toBe(1);
    place(f, plain.x, plain.z - 3);
    hold(g, 1.5);
    expect(w.wasted).toBe(1);
    expect(w.logs).toHaveLength(1);
  });

  it("a felled log can only be hooked after the tree has landed", () => {
    const g = createForestGame(), w = g.world, s = drive(g, "skidder");
    w.logs.push({ id: 0, x: 0, z: 0, heading: 0, at: g.time + FALL_TIME });
    place(s, 0, -3);
    expect(currentForestAction(g)).toBeNull();
    hold(g, 0.9, false); hold(g, 0.9, false);
    expect(currentForestAction(g)?.label).toBe("Hook log");
  });

  it("runs the whole chain: skid, stack, load, deliver, win", () => {
    const g = createForestGame(), w = g.world, s = veh(g, "skidder"), tr = veh(g, "logtruck");
    openRoad(g);
    w.logs.push({ id: 0, x: 0, z: 0, heading: 0, at: 0 });
    drive(g, "skidder"); place(s, 0, -3);
    hold(g, 1);
    expect(s.logs).toBe(1);
    place(s, w.landing.x, w.landing.z);
    hold(g, 1);
    expect(w.landing.stack).toBe(1);
    w.landing.stack = LOG_TARGET;
    drive(g, "logtruck"); place(tr, w.landing.x + 1, w.landing.z + 1);
    hold(g, 1.5);
    expect(tr.logs).toBe(TRUCK_CAPACITY);
    for (let trip = 0; trip < 3; trip++) {
      place(tr, w.mill.x, w.mill.z);
      hold(g, 2);
      place(tr, w.landing.x + 1, w.landing.z + 1);
      if (!g.won) hold(g, 1.5);
    }
    expect(w.delivered).toBe(LOG_TARGET);
    expect(g.won).toBe(true);
    expect(g.events).toContain("win");
  });

  it("caps the skidder grapple", () => {
    const g = createForestGame(), s = drive(g, "skidder");
    for (let i = 0; i < SKIDDER_CAPACITY + 2; i++) g.world.logs.push({ id: i, x: 0, z: 0, heading: 0, at: 0 });
    place(s, 0, -3);
    hold(g, 6);
    expect(s.logs).toBe(SKIDDER_CAPACITY);
  });

  it("burns fuel, stops when empty, refuels at the pump and tows you home", () => {
    const g = createForestGame(), w = g.world, f = drive(g, "feller");
    stepForestGame(g, { throttle: 1, steer: 0, action: false }, 1);
    expect(f.fuel).toBeLessThan(1);
    f.fuel = 0;
    const x = f.x;
    for (let i = 0; i < 20; i++) stepForestGame(g, { throttle: 1, steer: 0, action: false }, 0.05);
    expect(Math.abs(f.x - x)).toBeLessThan(0.5);
    const t0 = g.time;
    recoverForest(g);
    expect(f.fuel).toBeGreaterThan(0);
    expect(g.time).toBeGreaterThanOrEqual(t0 + 20);
    place(f, w.camp.fuel.x, w.camp.fuel.z); f.fuel = 0.2; f.damage = 0.5;
    expect(currentForestAction(g)?.label).toBe("Refuel & repair");
    hold(g, 2.2);
    expect(f.fuel).toBeGreaterThan(0.99);
    expect(f.damage).toBe(0);
  });

  it("switches machines by index and by cycling, wrapping around", () => {
    const g = createForestGame(), n = g.vehicles.length;
    selectForestVehicle(g, n - 1);
    expect(g.active).toBe(n - 1);
    cycleForestVehicle(g, 1);
    expect(g.active).toBe(0);
    cycleForestVehicle(g, -1);
    expect(g.active).toBe(n - 1);
    selectForestVehicle(g, 9);
    expect(g.active).toBe(n - 1);
  });

  it("hints the right machine for each stage", () => {
    const g = createForestGame(), w = g.world;
    expect(["feller", "skidder"]).toContain(forestHint(g).machine);
    w.trees.forEach((t) => { if (t.kind === "blocker") t.alive = false; });
    w.deadfalls.forEach((d) => { d.cleared = true; });
    expect(forestHint(g).machine).toBe("grader");
    w.roadOpen = true;
    expect(forestHint(g).machine).toBe("feller");
    w.felled = LOG_TARGET; w.logs.push({ id: 0, x: 0, z: 0, heading: 0, at: 0 });
    expect(forestHint(g).machine).toBe("skidder");
    w.logs.length = 0; w.landing.stack = 3;
    expect(forestHint(g).machine).toBe("logtruck");
    veh(g, "logtruck").logs = TRUCK_CAPACITY;
    expect(forestHint(g).text).toMatch(/sawmill|mill/);
  });
  it("starts the machines in a spread-out row beside the road, each angled 45 degrees towards it", () => {
    const g = createForestGame(), w = g.world;
    expect(g.vehicles.map((v) => v.kind)).toEqual(["feller", "grader", "skidder", "logtruck"]);
    g.vehicles.forEach((v, i) => {
      const n = nearestOnPath(w.path, v.x, v.z), p = w.path[n.i], q = w.path[Math.min(w.path.length - 1, n.i + 3)];
      const road = Math.atan2(q.x - p.x, q.z - p.z);
      let diff = v.heading - road; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      expect(Math.abs(Math.abs(diff) - Math.PI / 4)).toBeLessThan(0.08); // 45 degrees off the road direction
      expect(n.d).toBeGreaterThan(6.3); expect(n.d).toBeLessThan(9); // beside the road, not on it
      // nose points at the road: moving forward a bit brings it closer
      expect(Math.hypot(p.x - (v.x + Math.sin(v.heading) * 3), p.z - (v.z + Math.cos(v.heading) * 3))).toBeLessThan(n.d);
      for (const o of g.vehicles.slice(i + 1)) expect(Math.hypot(o.x - v.x, o.z - v.z)).toBeGreaterThan(7); // not clumped
      expect(w.trees.some((t) => Math.hypot(t.x - v.x, t.z - v.z) < 3.5)).toBe(false);
      for (const c of w.camp.colliders) expect(Math.hypot(c.x - v.x, c.z - v.z)).toBeGreaterThan(c.r + 3);
      expect(Math.hypot(v.x - w.mill.x, v.z - w.mill.z)).toBeGreaterThan(w.mill.r + 2);
    });
    // all four sit on the same side of the road, opposite the camp
    const side = (x: number, z: number) => { const n = nearestOnPath(w.path, x, z), p = w.path[n.i], q = w.path[Math.min(w.path.length - 1, n.i + 3)], h = Math.atan2(q.x - p.x, q.z - p.z); return Math.sign((x - p.x) * Math.cos(h) - (z - p.z) * Math.sin(h)); };
    expect(new Set(g.vehicles.map((v) => side(v.x, v.z))).size).toBe(1);
    expect(side(g.vehicles[0].x, g.vehicles[0].z)).not.toBe(side(w.camp.mid.x, w.camp.mid.z));
  });

  it("puts a small fuel tank at the cut block, off the road, holding one tankful", () => {
    const g = createForestGame(), w = g.world, ft = w.fieldTank;
    expect(ft.fuel).toBe(1);
    expect(Math.hypot(ft.x - w.landing.x, ft.z - w.landing.z)).toBeLessThan(w.landing.r + 2);
    expect(nearestOnPath(w.path, ft.x, ft.z).d).toBeGreaterThan(4);
    expect(w.tanker.state).toBe("depot");
    expect(w.tankerStopS).toBeGreaterThan(w.cum[w.cum.length - 1] - 20);
  });

  it("the field tank refuels only one machine until the NPC tanker has been there and back", () => {
    const g = createForestGame(), w = g.world, ft = w.fieldTank, f = veh(g, "feller"), gr = veh(g, "grader");
    openRoad(g);
    drive(g, "feller"); place(f, ft.x + 2, ft.z + 2);
    f.fuel = 0.05;
    expect(currentForestAction(g)?.label).toBe("Refuel from field tank");
    hold(g, 2.2);
    expect(f.fuel).toBeGreaterThan(0.99);
    expect(ft.fuel).toBeLessThan(0.07); // one tankful taken
    // a second machine only gets the dregs, and the tanker is already on its way
    drive(g, "grader"); place(gr, ft.x - 2, ft.z - 2);
    gr.fuel = 0.1;
    stepForestGame(g, { throttle: 0, steer: 0, action: false }, 0.1);
    expect(w.tanker.state).toBe("out");
    expect(currentForestAction(g)?.label).toMatch(/only 5% left/);
    hold(g, 2.2);
    expect(gr.fuel).toBeGreaterThan(0.1); expect(gr.fuel).toBeLessThan(0.2); // only the dregs
    expect(ft.fuel).toBeLessThan(0.02);
    expect(currentForestAction(g)?.label).toMatch(/empty: tanker arrives in \d+ s/);
    expect(currentForestAction(g)?.blocked).toBeTruthy();
    const eta = tankerEta(w)!;
    expect(eta).toBeGreaterThan(15); expect(eta).toBeLessThan(60);
    // it really does take about that long, then the tank is full again
    const took = runUntil(g, () => ft.fuel >= 0.99);
    expect(Math.abs(took - eta)).toBeLessThan(3);
    expect(["fill", "back"]).toContain(w.tanker.state);
    gr.fuel = 0.1; hold(g, 0.1, false);
    expect(currentForestAction(g)?.label).toBe("Refuel from field tank");
    // it drives back, reloads, and only then is free to be sent again
    runUntil(g, () => w.tanker.state === "depot");
    expect(w.tanker.state).toBe("depot");
    ft.fuel = 0.2; hold(g, 0.1, false);
    expect(w.tanker.state).toBe("depot"); // still reloading
    runUntil(g, () => w.tanker.state === "out");
    expect(w.tanker.state).toBe("out");
  });

  it("the tanker will not leave while the road is closed, and waits behind a machine in its way", () => {
    const g = createForestGame(), w = g.world;
    w.fieldTank.fuel = 0;
    hold(g, 5, false);
    expect(w.tanker.state).toBe("depot");
    expect(tankerEta(w)).toBeNull();
    openRoad(g);
    hold(g, 0.2, false);
    expect(w.tanker.state).toBe("out");
    const blocker = veh(g, "logtruck");
    hold(g, 3, false);
    const q = pathPoint(w, w.tanker.s + 4); // park a machine right in front of it
    place(blocker, q.x, q.z);
    hold(g, 1, false);
    const stuck = w.tanker.s;
    hold(g, 2, false);
    expect(w.tanker.s).toBeCloseTo(stuck, 5);
    expect(w.tanker.waiting).toBe(true);
    place(blocker, 0, 0); // machine moves away: it carries on
    hold(g, 1, false);
    expect(w.tanker.s).toBeGreaterThan(stuck + 4);
  });
});

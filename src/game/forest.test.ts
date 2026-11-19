import { describe, expect, it } from "vitest";
import {
  FALL_TIME, LOG_TARGET, SKIDDER_CAPACITY, TRUCK_CAPACITY, blockersLeft, blockersTotal, createForestGame, currentForestAction, cycleForestVehicle, forestHint,
  recoverForest, roadLevelled, selectForestVehicle, stepForestGame, type ForestGame, type ForestMachine, type ForestVehicle,
} from "./forest";
import { nearestOnPath } from "./world";

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
    expect(roadLevelled(w)).toBeGreaterThan(0.9);
    expect(w.roadOpen).toBe(true);
  });

  it("only marked trees give logs, and only after the road is open", () => {
    const g = createForestGame(), w = g.world, f = drive(g, "feller");
    const marked = w.trees.find((t) => t.kind === "marked")!, plain = w.trees.find((t) => t.kind === "forest")!;
    place(f, marked.x, marked.z - 3);
    hold(g, 1.5);
    expect(w.logs).toHaveLength(0);
    expect(w.wasted).toBe(1); // too early: the road is still closed
    openRoad(g);
    const m2 = w.trees.find((t) => t.kind === "marked" && t.alive)!;
    place(f, m2.x, m2.z - 3);
    hold(g, 1.5);
    expect(w.logs).toHaveLength(1);
    expect(w.felled).toBe(1);
    place(f, plain.x, plain.z - 3);
    hold(g, 1.5);
    expect(w.wasted).toBe(2);
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
});

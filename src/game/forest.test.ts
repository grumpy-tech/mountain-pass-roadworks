import { describe, expect, it } from "vitest";
import {
  LOG_TARGET, SKIDDER_CAPACITY, TRUCK_CAPACITY, createForestGame, cycleForestVehicle, forestHint, selectForestVehicle, stepForestGame,
  type ForestGame, type ForestVehicle,
} from "./forest";

const hold = (g: ForestGame, seconds: number, action = true) => {
  for (let t = 0; t < seconds; t += 0.05) stepForestGame(g, { throttle: 0, steer: 0, action }, 0.05);
};
const place = (g: ForestGame, v: ForestVehicle, x: number, z: number, heading: number) => {
  v.x = x; v.z = z; v.heading = heading; v.speed = 0;
};
const veh = (g: ForestGame, kind: string) => g.vehicles.find((v) => v.kind === kind)!;

describe("forest level", () => {
  it("spawns trees and keeps the start clearing free of them", () => {
    const g = createForestGame();
    expect(g.world.trees.length).toBeGreaterThan(300);
    for (const v of g.vehicles) for (const t of g.world.trees) expect(Math.hypot(t.x - v.x, t.z - v.z)).toBeGreaterThan(3);
  });

  it("the feller fells a tree into a log", () => {
    const g = createForestGame(), w = g.world, f = veh(g, "feller");
    const t = w.trees[100];
    place(g, f, t.x, t.z - 3, 0); // facing +z, reach point lands on the trunk
    hold(g, 1.5);
    expect(t.alive).toBe(false);
    expect(w.logs).toHaveLength(1);
    expect(w.felled).toBe(1);
  });

  it("standing trees block a machine", () => {
    const g = createForestGame(), f = veh(g, "feller");
    const t = g.world.trees[100];
    place(g, f, t.x, t.z - 4, 0);
    for (let i = 0; i < 100; i++) stepForestGame(g, { throttle: 1, steer: 0, action: false }, 0.05);
    expect(Math.hypot(f.x - t.x, f.z - t.z)).toBeGreaterThan(1.1);
  });

  it("runs the whole chain: fell, skid, stack, load, deliver, win", () => {
    const g = createForestGame(), w = g.world, s = veh(g, "skidder"), tr = veh(g, "logtruck");
    // a felled log, hooked by the skidder
    w.logs.push({ id: 0, x: 0, z: 0, heading: 0 });
    g.active = g.vehicles.indexOf(s);
    place(g, s, 0, -3, 0);
    hold(g, 1);
    expect(s.logs).toBe(1);
    expect(w.logs).toHaveLength(0);
    // stack at the landing
    place(g, s, w.landing.x, w.landing.z, 0);
    hold(g, 1);
    expect(w.landing.stack).toBe(1);
    expect(s.logs).toBe(0);
    // truck loads from the stack, up to capacity
    w.landing.stack = LOG_TARGET;
    g.active = g.vehicles.indexOf(tr);
    place(g, tr, w.landing.x + 1, w.landing.z + 1, 0);
    hold(g, 1.5);
    expect(tr.logs).toBe(TRUCK_CAPACITY);
    expect(w.landing.stack).toBe(LOG_TARGET - TRUCK_CAPACITY);
    // deliver, twice
    for (let trip = 0; trip < 2; trip++) {
      place(g, tr, w.mill.x, w.mill.z, 0);
      hold(g, 2);
      place(g, tr, w.landing.x + 1, w.landing.z + 1, 0);
      if (!g.won) hold(g, 1.5);
    }
    expect(w.delivered).toBe(LOG_TARGET);
    expect(g.won).toBe(true);
    expect(g.events).toContain("win");
  });

  it("caps the skidder grapple", () => {
    const g = createForestGame(), s = veh(g, "skidder");
    g.active = g.vehicles.indexOf(s);
    for (let i = 0; i < SKIDDER_CAPACITY + 2; i++) g.world.logs.push({ id: i, x: 0, z: 0, heading: 0 });
    place(g, s, 0, -3, 0);
    hold(g, 6);
    expect(s.logs).toBe(SKIDDER_CAPACITY);
  });

  it("switches machines by index and by cycling, wrapping around", () => {
    const g = createForestGame();
    selectForestVehicle(g, 2);
    expect(g.active).toBe(2);
    cycleForestVehicle(g, 1);
    expect(g.active).toBe(0);
    cycleForestVehicle(g, -1);
    expect(g.active).toBe(2);
    selectForestVehicle(g, 9); // out of range: ignored
    expect(g.active).toBe(2);
  });

  it("hints the right machine for each stage", () => {
    const g = createForestGame(), w = g.world;
    expect(forestHint(g).machine).toBe("feller");
    w.felled = LOG_TARGET; w.logs.push({ id: 0, x: 0, z: 0, heading: 0 });
    expect(forestHint(g).machine).toBe("skidder");
    w.logs.length = 0; w.landing.stack = 3;
    expect(forestHint(g).machine).toBe("logtruck");
    veh(g, "logtruck").logs = TRUCK_CAPACITY;
    expect(forestHint(g).text).toMatch(/mill/);
  });
});

import { describe, expect, it } from "vitest";
import { DIFF, ratingFor } from "./shared";
import { createGame, currentAction, cycleVehicle, nearestOnPath, objectiveHint, pathLength, progress, recover, roadFrontier, selectVehicle, stepGame } from "./world";

const hold = (g: ReturnType<typeof createGame>, seconds: number) => { for (let t = 0; t < seconds; t += 0.05) stepGame(g, { throttle: 0, steer: 0, action: true }, 0.05); };

describe("road level", () => {
  it("Tab cycles through every machine and wraps, regardless of distance", () => {
    const g = createGame(), n = g.vehicles.length;
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) { cycleVehicle(g, 1); seen.add(g.active); }
    expect(seen.size).toBe(n);
    expect(g.active).toBe(0);
    cycleVehicle(g, -1);
    expect(g.active).toBe(n - 1);
  });

  it("number keys jump to a machine and ignore bad indexes", () => {
    const g = createGame();
    selectVehicle(g, 2);
    expect(g.active).toBe(2);
    expect(g.events).toContain("switch");
    selectVehicle(g, 7);
    selectVehicle(g, -1);
    expect(g.active).toBe(2);
  });

  it("tracks time while playing and gives a hint with a machine", () => {
    const g = createGame();
    stepGame(g, { throttle: 0, steer: 0, action: false }, 0.5);
    expect(g.time).toBeCloseTo(0.5);
    const h = objectiveHint(g);
    expect(h.text.length).toBeGreaterThan(0);
    expect(g.vehicles.some((v) => v.kind === h.machine)).toBe(true);
  });

  it("fills a mud hole with dirt: the count drops, there is a splash and a message", () => {
    const g = createGame(), w = g.world, ex = g.vehicles[1];
    g.active = 1;
    const holes = w.road.filter((r) => r.kind === "mud"), hole = holes[0];
    ex.dirt = 1; ex.x = hole.x; ex.z = hole.z - 3; ex.heading = 0; ex.speed = 0;
    expect(currentAction(g)?.label).toBe("Fill mud hole");
    hold(g, 1.2);
    expect(progress(w).mud).toBe(holes.length - 1);
    expect(hole.kind).toBe("ok");
    expect(w.mud[hole.cell]).toBe(0);
    expect(g.fx.some((f) => f.kind === "splash")).toBe(true);
    expect(g.msg).toMatch(/Mud hole filled/);
  });

  it("tells you a hole needs dirt, and fills it even with a truck standing near", () => {
    const g = createGame(), w = g.world, ex = g.vehicles[1], truck = g.vehicles[2];
    g.active = 1;
    w.rocks.length = 0; // nothing else to do near the hole
    w.road.forEach((r) => { if (r.kind === "mound") r.kind = "ok"; });
    const hole = w.road.find((r) => r.kind === "mud")!;
    ex.x = hole.x; ex.z = hole.z - 3; ex.heading = 0; ex.speed = 0;
    expect(currentAction(g)?.label).toMatch(/needs dirt/);
    ex.dirt = 1; truck.x = hole.x + 2; truck.z = hole.z - 1;
    expect(currentAction(g)?.label).toBe("Fill mud hole");
  });

  it("burns fuel only on the active machine, and refuels and repairs at the camp pump", () => {
    const g = createGame(), w = g.world;
    stepGame(g, { throttle: 1, steer: 0, action: false }, 1);
    expect(g.vehicles[0].fuel).toBeLessThan(1);
    expect(g.vehicles[1].fuel).toBe(1);
    const v = g.vehicles[0];
    v.x = w.camp.fuel.x; v.z = w.camp.fuel.z; v.speed = 0; v.fuel = 0.1; v.damage = 0.4;
    expect(currentAction(g)?.label).toBe("Refuel & repair");
    hold(g, 2.2);
    expect(v.fuel).toBeGreaterThan(0.99);
    expect(v.damage).toBe(0);
  });

  it("out of fuel means no driving until towed, which costs time", () => {
    const g = createGame(), v = g.vehicles[0];
    v.fuel = 0;
    const x = v.x, z = v.z;
    for (let i = 0; i < 20; i++) stepGame(g, { throttle: 1, steer: 0, action: false }, 0.05);
    expect(Math.hypot(v.x - x, v.z - z)).toBeLessThan(0.5);
    const t = g.time;
    recover(g);
    expect(v.fuel).toBeGreaterThan(0);
    expect(g.time).toBeGreaterThanOrEqual(t + 20);
  });

  it("wet weather and wear lower the top speed; difficulty scales fuel burn", () => {
    const run = (mut: (g: ReturnType<typeof createGame>) => void) => {
      const g = createGame(); mut(g);
      g.vehicles.forEach((o, i) => { if (i) { o.x = -70; o.z = -70 + i * 6; } });
      const v = g.vehicles[0], p = g.world.path[2], q = g.world.path[6];
      v.x = p.x; v.z = p.z; v.heading = Math.atan2(q.x - p.x, q.z - p.z);
      for (let i = 0; i < 100; i++) stepGame(g, { throttle: 1, steer: 0, action: false }, 0.05);
      return Math.abs(v.speed);
    };
    const dry = run(() => {}), wet = run((g) => { g.env.gripMul = 0.6; }), worn = run((g) => { g.vehicles[0].damage = 1; });
    expect(wet).toBeLessThan(dry);
    expect(worn).toBeLessThan(dry);
    const burn = (d: "easy" | "hard") => { const g = createGame(d); stepGame(g, { throttle: 1, steer: 0, action: false }, 1); return 1 - g.vehicles[0].fuel; };
    expect(burn("easy")).toBeLessThan(burn("hard"));
  });

  it("keeps the camp clear of the road and the machines", () => {
    const g = createGame(), w = g.world;
    for (const p of w.camp.props) if (p.kind !== "sign" && p.kind !== "cone") expect(nearestOnPath(w.path, p.x, p.z).d).toBeGreaterThan(5);
    for (const v of g.vehicles) for (const c of w.camp.colliders) expect(Math.hypot(c.x - v.x, c.z - v.z)).toBeGreaterThan(c.r + 1.7);
  });

  it("reports how far the graded and paved stretches reach", () => {
    const g = createGame(), w = g.world;
    expect(roadFrontier(w).graded.m).toBeLessThan(roadFrontier(w).total * 0.1);
    w.road.forEach((r) => { r.stage = 2; r.kind = "ok"; });
    const f = roadFrontier(w);
    expect(f.graded.m).toBeCloseTo(pathLength(w), 0);
    expect(f.paved.m).toBeLessThan(f.total * 0.1);
  });

  it("rates a run from one to three stars, scaled by difficulty", () => {
    expect(ratingFor(1000, 5, 0, 600)).toBe(1);
    expect(ratingFor(800, 5, 0, 600)).toBe(2);
    expect(ratingFor(500, 0, 0, 600)).toBe(3);
    expect(ratingFor(500, 3, 0, 600)).toBe(2); // too many rollovers
    expect(ratingFor(500, 0, 2, 600)).toBe(2); // wasted effort
    expect(DIFF.easy.par).toBeGreaterThan(DIFF.hard.par);
  });
});

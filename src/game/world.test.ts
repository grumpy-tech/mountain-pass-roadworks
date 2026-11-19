import { describe, expect, it } from "vitest";
import { DIFF, ratingFor } from "./shared";
import { createGame, currentAction, cycleVehicle, heightAt, nearestOnPath, objectiveHint, pathLength, progress, recomputeHeights, recover, roadCellAt, roadFrontier, selectVehicle, stepGame, type Game, type Vehicle } from "./world";

const hold = (g: ReturnType<typeof createGame>, seconds: number) => { for (let t = 0; t < seconds; t += 0.05) stepGame(g, { throttle: 0, steer: 0, action: true }, 0.05); };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const dirtyMound = (g: Game) => g.world.road.filter((r) => r.kind === "mound").sort((a, b) => a.t - b.t)[0];

/** Drive the active machine like a player: follow the road, then creep in until its reach point (`reach` m ahead) is on (tx, tz). */
function driveReach(g: Game, tx: number, tz: number, reach = 3.2, maxT = 240) {
  const v = g.vehicles[g.active], w = g.world, tI = nearestOnPath(w.path, tx, tz).i;
  for (let t = 0; t < maxT; t += 0.05) {
    const px = v.x + Math.sin(v.heading) * reach, pz = v.z + Math.cos(v.heading) * reach;
    const dist = Math.hypot(tx - v.x, tz - v.z);
    if (Math.hypot(tx - px, tz - pz) < 0.6 && Math.abs(v.speed) < 0.3) return true;
    let ax = tx, az = tz;
    if (dist > 9) { const n = nearestOnPath(w.path, v.x, v.z), k = Math.max(0, Math.min(w.path.length - 1, n.i + Math.sign(tI - n.i) * 8)); ax = w.path[k].x; az = w.path[k].z; }
    const da = wrap(Math.atan2(ax - v.x, az - v.z) - v.heading);
    stepGame(g, { throttle: dist > reach + 0.4 ? (Math.abs(da) > 1 ? 0.2 : 1) : dist < reach - 0.4 ? -1 : 0, steer: Math.max(-1, Math.min(1, da * 2)), action: false }, 0.05);
    if (v.tipped) return false;
  }
  return false;
}

/** Drive along the road from path index `from` towards higher indexes for `seconds`, full throttle. */
function driveRoad(g: Game, v: Vehicle, seconds: number) {
  const w = g.world;
  for (let t = 0; t < seconds && !v.tipped; t += 0.05) {
    const n = nearestOnPath(w.path, v.x, v.z), k = Math.min(w.path.length - 1, n.i + 8);
    const da = wrap(Math.atan2(w.path[k].x - v.x, w.path[k].z - v.z) - v.heading);
    stepGame(g, { throttle: 1, steer: Math.max(-1, Math.min(1, da * 2)), action: false }, 0.05);
  }
}

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

  it("fills one washout cell per dirt: the count drops, there is a splash and a message", () => {
    const g = createGame(), w = g.world, ex = g.vehicles[1];
    g.active = 1;
    const holes = w.road.filter((r) => r.kind === "mud"), hole = holes[0];
    ex.dirt = 1; ex.x = hole.x; ex.z = hole.z - 3; ex.heading = 0; ex.speed = 0;
    expect(currentAction(g)?.label).toMatch(/^Fill washout/);
    hold(g, 1.2);
    expect(progress(w).mud).toBe(holes.length - 1);
    expect(hole.kind).toBe("ok");
    expect(w.mud[hole.cell]).toBe(0);
    expect(g.fx.some((f) => f.kind === "splash")).toBe(true);
    expect(g.msg).toMatch(/Washout 1\/3 filled/);
  });

  it("tells you a washout needs dirt, and fills it even with a truck standing near", () => {
    const g = createGame(), w = g.world, ex = g.vehicles[1], truck = g.vehicles[2];
    g.active = 1;
    w.rocks.length = 0; // nothing else to do near the hole
    w.road.forEach((r) => { if (r.kind === "mound") r.kind = "ok"; });
    const hole = w.road.find((r) => r.kind === "mud")!;
    ex.x = hole.x; ex.z = hole.z - 3; ex.heading = 0; ex.speed = 0;
    expect(currentAction(g)?.label).toMatch(/needs dirt/);
    ex.dirt = 1; truck.x = hole.x + 2; truck.z = hole.z - 1;
    expect(currentAction(g)?.label).toMatch(/^Fill washout/);
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
      let peak = 0; // peak, not final: the climb out of the start pad slows every run alike
      for (let i = 0; i < 100; i++) { stepGame(g, { throttle: 1, steer: 0, action: false }, 0.05); peak = Math.max(peak, Math.abs(v.speed)); }
      return peak;
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

  describe("washouts", () => {
    const detrended = (g: Game, wo: Game["world"]["washouts"][number]) => {
      const w = g.world, px = Math.cos(wo.angle), pz = -Math.sin(wo.angle); // along the road
      const h = (a: number) => heightAt(w, wo.x + px * a, wo.z + pz * a);
      return h(0) - (h(4) + h(-4)) / 2; // dip below the road's own slope
    };

    it("has a few compact washouts spread along the road, not a field of holes", () => {
      const g = createGame(), w = g.world;
      expect(w.washouts.length).toBeGreaterThanOrEqual(3);
      expect(w.washouts.length).toBeLessThanOrEqual(5);
      for (const wo of w.washouts) {
        expect(wo.cells.length).toBeGreaterThanOrEqual(2);
        expect(wo.cells.length).toBeLessThanOrEqual(4);
        expect(wo.cells.every((k) => w.road[k].kind === "mud")).toBe(true);
        expect(Math.hypot(wo.x - w.camp.mid.x, wo.z - w.camp.mid.z)).toBeGreaterThan(30);
        for (const q of w.start) expect(Math.hypot(wo.x - q.x, wo.z - q.z)).toBeGreaterThan(14);
        for (const o of w.washouts) if (o !== wo) expect(Math.hypot(wo.x - o.x, wo.z - o.z)).toBeGreaterThan(15); // never stacked
      }
      expect(progress(w).mud).toBeLessThanOrEqual(16);
      // nothing else piled on top of them
      for (const wo of w.washouts) {
        expect(w.rocks.some((r) => Math.hypot(r.x - wo.x, r.z - wo.z) < 4)).toBe(false);
        expect(w.road.some((r) => r.kind === "mound" && Math.hypot(r.x - wo.x, r.z - wo.z) < 4)).toBe(false);
      }
    });

    it("is a real dip in the ground that rises as it is filled", () => {
      const g = createGame(), w = g.world, wo = w.washouts[0];
      const dipBefore = detrended(g, wo);
      expect(dipBefore).toBeLessThan(-0.5);
      const before = heightAt(w, wo.x, wo.z);
      g.active = 1; const ex = g.vehicles[1];
      for (const k of wo.cells) {
        const rc = w.road[k];
        ex.dirt = 1; ex.x = rc.x; ex.z = rc.z - 3; ex.heading = 0; ex.speed = 0;
        hold(g, 1);
      }
      for (let t = 0; t < 2; t += 0.05) stepGame(g, { throttle: 0, steer: 0, action: false }, 0.05);
      recomputeHeights(w); // the renderer does this whenever the terrain is dirty
      expect(wo.filled).toBe(wo.cells.length);
      expect(detrended(g, wo)).toBeGreaterThan(dipBefore + 0.5); // the road's own lumps remain, the dip does not
      expect(detrended(g, wo)).toBeGreaterThan(-0.4);
      expect(heightAt(w, wo.x, wo.z)).toBeGreaterThan(before + 0.3);
      expect(progress(w).washouts).toBe(w.washouts.length - 1);
    });

    it("a loaded truck crosses an open washout at full speed without tipping, even on hard", () => {
      for (const wo of createGame().world.washouts) {
        const g = createGame("hard"), v = g.vehicles[2], w = g.world, n = nearestOnPath(w.path, wo.x, wo.z);
        g.active = 2; v.dirt = 3; v.rock = 3;
        const from = w.path[Math.max(0, n.i - 30)], to = w.path[Math.max(0, n.i - 24)];
        v.x = from.x; v.z = from.z; v.heading = Math.atan2(to.x - from.x, to.z - from.z); v.speed = 0;
        g.vehicles.forEach((o) => { if (o !== v) { o.x = -70; o.z = -70; } });
        w.rocks.length = 0; w.road.forEach((r) => { if (r.kind === "mound") r.kind = "ok"; });
        driveRoad(g, v, 14);
        expect(v.tipped).toBe(false);
        expect(nearestOnPath(w.path, v.x, v.z).i).toBeGreaterThan(n.i + 5); // got across it
      }
    });

    it("the excavator digs a mound and fills a washout using only driving and Space", () => {
      const g = createGame(), w = g.world, ex = g.vehicles[1];
      g.active = 1; // the other machines stay parked where they start: nobody boxes it in
      w.rocks.length = 0;
      const m = dirtyMound(g), wo = w.washouts[0];
      expect(driveReach(g, m.x, m.z)).toBe(true);
      expect(currentAction(g)?.label).toBe("Dig dirt mound");
      hold(g, 1.3);
      expect(ex.dirt).toBe(1);
      const c = w.road[wo.cells[1]];
      expect(driveReach(g, c.x, c.z)).toBe(true);
      expect(currentAction(g)?.label).toMatch(/^Fill washout/);
      hold(g, 1);
      expect(wo.filled).toBe(1);
      expect(ex.dirt).toBe(0);
    });

    it("the excavator can fill a washout from the cell next to the one it aims at (no pixel-perfect aiming)", () => {
      const g = createGame(), w = g.world, ex = g.vehicles[1], wo = w.washouts[0], mid = w.road[wo.cells[1]];
      g.active = 1; ex.dirt = 1; ex.heading = 0; ex.speed = 0;
      ex.x = mid.x + 2.2; ex.z = mid.z - 3.2; // aims about two metres off the dip's middle
      expect(currentAction(g)?.label).toMatch(/^Fill washout/);
    });

    it("the truck, loaded by the excavator, backs up to a washout and tips dirt into it", () => {
      const g = createGame(), w = g.world, ex = g.vehicles[1], truck = g.vehicles[2], wo = w.washouts[0];
      w.rocks.length = 0;
      // the excavator loads the truck (set up close together, as at a work site)
      const road = w.path[nearestOnPath(w.path, wo.x, wo.z).i - 30];
      ex.x = road.x + 3; ex.z = road.z; ex.heading = Math.PI / 2; ex.dirt = 1; ex.speed = 0;
      truck.x = road.x + 6; truck.z = road.z; truck.speed = 0;
      g.active = 1;
      expect(currentAction(g)?.label).toBe("Load into truck");
      hold(g, 1);
      expect(truck.dirt).toBe(1);
      truck.dirt = 3;
      // drive the truck along the road past the washout, then reverse straight back
      g.active = 2; ex.x = -70; ex.z = -70;
      const n = nearestOnPath(w.path, wo.x, wo.z);
      const from = w.path[n.i - 30], to = w.path[n.i - 24];
      truck.x = from.x; truck.z = from.z; truck.heading = Math.atan2(to.x - from.x, to.z - from.z);
      driveRoad(g, truck, 6);
      while (nearestOnPath(w.path, truck.x, truck.z).i < n.i + 28) { driveRoad(g, truck, 0.5); if (truck.tipped) break; }
      expect(truck.tipped).toBe(false);
      truck.speed = 0;
      let label = "";
      for (let t = 0; t < 30 && !label.startsWith("Tip dirt"); t += 0.05) { stepGame(g, { throttle: -1, steer: 0, action: false }, 0.05); label = currentAction(g)?.label ?? ""; }
      expect(label).toMatch(/^Tip dirt into washout/);
      for (let t = 0; t < 4; t += 0.05) stepGame(g, { throttle: 0, steer: 0, action: true }, 0.05);
      expect(wo.filled).toBeGreaterThanOrEqual(1);
      expect(truck.dirt).toBeLessThan(3);
    });

    it("dirt never runs out: with every mound gone you can scoop it beside the road", () => {
      const g = createGame(), w = g.world, ex = g.vehicles[1], wo = w.washouts[0];
      g.active = 1; w.rocks.length = 0;
      w.road.forEach((r) => { if (r.kind === "mound") { r.kind = "ok"; r.mound = 0; } });
      const c = w.road[wo.cells[1]];
      ex.x = c.x; ex.z = c.z - 3; ex.heading = 0; ex.speed = 0; // bucket over the dip, empty
      expect(currentAction(g)?.label).toMatch(/needs dirt/);
      expect(currentAction(g)?.time).toBe(Infinity);
      // park on the level pad beside the road, facing away from it: the bucket is over bare ground
      const pad = w.start[1];
      ex.x = pad.x; ex.z = pad.z; ex.heading = pad.heading + Math.PI;
      expect(roadCellAt(w, ex.x + Math.sin(ex.heading) * 3.2, ex.z + Math.cos(ex.heading) * 3.2)).toBeNull();
      expect(currentAction(g)?.label).toBe("Scoop roadside dirt");
      hold(g, 1.3);
      expect(ex.dirt).toBe(1);
    });

    it("a rock in the bucket says why the washout cannot be filled", () => {
      const g = createGame(), w = g.world, ex = g.vehicles[1], c = w.road[w.washouts[0].cells[1]];
      g.active = 1; w.rocks.length = 0; ex.rock = 1; ex.x = c.x; ex.z = c.z - 3; ex.heading = 0; ex.speed = 0;
      expect(currentAction(g)?.label).toMatch(/rock/);
    });

    it("the hint names washouts once the mounds are gone, and counts them in progress", () => {
      const g = createGame(), w = g.world;
      w.rocks.length = 0; w.road.forEach((r) => { if (r.kind === "mound") r.kind = "ok"; });
      expect(objectiveHint(g).text).toMatch(/washout/);
      expect(objectiveHint(g).machine).toBe("excavator");
      expect(progress(w).washouts).toBe(w.washouts.length);
    });
  });

  describe("start", () => {
    it("parks the machines in a spread-out row beside the road, none on the road or boxed in", () => {
      const g = createGame(), w = g.world;
      expect(g.vehicles.map((v) => v.kind)).toEqual(["dozer", "excavator", "truck", "paver"]);
      for (const v of g.vehicles) {
        expect(nearestOnPath(w.path, v.x, v.z).d).toBeGreaterThan(6.3);
        expect(roadCellAt(w, v.x, v.z)).toBeNull();
        for (const o of g.vehicles) if (o !== v) expect(Math.hypot(o.x - v.x, o.z - v.z)).toBeGreaterThan(7);
      }
    });

    it("every machine can drive out onto the road without tipping or being blocked", () => {
      for (let i = 0; i < 4; i++) {
        const g = createGame(), w = g.world, v = g.vehicles[i];
        g.active = i; w.rocks.length = 0;
        const n = nearestOnPath(w.path, v.x, v.z), p = w.path[n.i];
        let reached = false;
        for (let t = 0; t < 40 && !reached && !v.tipped; t += 0.05) { // steer at the road's nearest point, full throttle
          const da = wrap(Math.atan2(p.x - v.x, p.z - v.z) - v.heading);
          stepGame(g, { throttle: Math.abs(da) > 1 ? 0.2 : 1, steer: Math.max(-1, Math.min(1, da * 2)), action: false }, 0.05);
          reached = Math.hypot(p.x - v.x, p.z - v.z) < 1.5;
        }
        expect(v.tipped).toBe(false);
        expect(reached).toBe(true);
      }
    });
  });
});

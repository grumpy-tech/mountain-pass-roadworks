import { describe, expect, it } from "vitest";
import { createGame, cycleVehicle, objectiveHint, selectVehicle, stepGame } from "./world";

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
});

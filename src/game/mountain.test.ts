import { describe, expect, it } from "vitest";
import { MOUNTAIN_LEVEL } from "./levels/mountain";
import { createGame, progress, stepGame } from "./world";

const weighted = (a: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * ((i % 97) + 1);
  return +s.toFixed(4);
};

// Golden values captured before the level-config refactor: the mountain level must not change when
// shared code is touched. If you retune the mountain on purpose, regenerate these.
describe("mountain level", () => {
  it("generates the same world as before the level-config refactor", () => {
    const g = createGame(MOUNTAIN_LEVEL);
    const w = g.world;
    expect(weighted(w.heights)).toBe(8948106.8576);
    expect(weighted(w.colors)).toBe(503521.4419);
    expect(weighted(w.base)).toBe(8948526.1234);
    expect([w.road.length, w.rocks.length, w.trees.length, w.boulders.length, w.mudCells.length]).toEqual([293, 36, 167, 174, 113]);
    expect(g.vehicles.map((v) => v.kind)).toEqual(["dozer", "excavator", "truck", "paver"]);
    expect(Math.max(...w.dig)).toBe(0);
  });

  it("simulates the same dozer drive", () => {
    const g = createGame(MOUNTAIN_LEVEL);
    for (let i = 0; i < 300; i++) stepGame(g, { throttle: 1, steer: i % 120 < 30 ? 0.5 : 0, action: false }, 1 / 60);
    const v = g.vehicles[0];
    expect([+v.x.toFixed(3), +v.z.toFixed(3), +v.heading.toFixed(3), +v.speed.toFixed(3)]).toEqual([22.84, 43.508, 2.703, 3.289]);
    expect(progress(g.world)).toMatchObject({ graded: 0, paved: 0, mounds: 32, mud: 34, rocksOnRoad: 36 });
  });
});

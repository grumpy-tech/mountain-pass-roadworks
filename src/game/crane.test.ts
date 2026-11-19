import { describe, expect, it } from "vitest";
import { G, createCrane, stepCrane, type CraneEnv, type CraneInput } from "./crane";

const idle: CraneInput = { slew: 0, trolley: 0, hoist: 0 };
const run = (c: ReturnType<typeof createCrane>, inp: CraneInput, secs: number, env?: CraneEnv, dt = 1 / 60) => {
  for (let t = 0; t < secs; t += dt) stepCrane(c, inp, dt, env);
};

// A crane pinned in place (no slew/trolley motion) with the hook pulled aside, for pendulum checks.
function pendulum(L: number, offset: number, damping: number) {
  const c = createCrane({ damping, x: 0, z: 0, jibY: 40 }, 0, 10, L);
  c.hook.x += offset; // pull aside along x
  c.hook.z = c.pivot.z;
  c.hook.y = c.pivot.y - Math.sqrt(L * L - offset * offset);
  return c;
}

describe("crane hook pendulum", () => {
  it("swings with the real small-angle period 2π√(L/g)", () => {
    const L = 10;
    const c = pendulum(L, 0.4, 0);
    // time between successive same-direction zero crossings of the horizontal offset
    const cross: number[] = [];
    let prev = c.hook.x - c.pivot.x, t = 0;
    const dt = 1 / 120;
    while (t < 40 && cross.length < 3) {
      stepCrane(c, idle, dt);
      t += dt;
      const x = c.hook.x - c.pivot.x;
      if (prev > 0 && x <= 0) cross.push(t);
      prev = x;
    }
    expect(cross.length).toBeGreaterThanOrEqual(2);
    const period = cross[1] - cross[0];
    expect(period).toBeGreaterThan(2 * Math.PI * Math.sqrt(L / G) * 0.97);
    expect(period).toBeLessThan(2 * Math.PI * Math.sqrt(L / G) * 1.03);
  });

  it("does not gain or lose energy without damping", () => {
    const c = pendulum(12, 1.5, 0);
    let peak = 0;
    for (let t = 0; t < 90; t += 1 / 60) { stepCrane(c, idle, 1 / 60); if (t > 60) peak = Math.max(peak, Math.abs(c.hook.x - c.pivot.x)); }
    expect(peak).toBeGreaterThan(1.5 * 0.93);
    expect(peak).toBeLessThan(1.5 * 1.02);
  });

  it("damping is the difficulty knob: swing dies out faster when it is higher", () => {
    const amp = (damping: number) => {
      const c = pendulum(10, 1.5, damping);
      let peak = 0;
      for (let t = 0; t < 40; t += 1 / 60) { stepCrane(c, idle, 1 / 60); if (t > 30) peak = Math.max(peak, Math.abs(c.hook.x - c.pivot.x)); }
      return peak;
    };
    const real = amp(0.12), easy = amp(0.6);
    expect(real).toBeGreaterThan(0.1);
    expect(easy).toBeLessThan(real * 0.2);
  });

  it("never lets the hook get farther than the rope allows", () => {
    const c = createCrane({}, 0.3, 14, 12);
    const inputs: CraneInput[] = [{ slew: 1, trolley: 1, hoist: -1 }, { slew: -1, trolley: -1, hoist: 1 }, { slew: 1, trolley: 0, hoist: 0 }];
    for (let i = 0; i < 600; i++) {
      stepCrane(c, inputs[Math.floor(i / 50) % 3], 1 / 60, { minHookY: () => 0, wind: { x: 0.3, z: -0.2 } });
      const d = Math.hypot(c.hook.x - c.pivot.x, c.hook.y - c.pivot.y, c.hook.z - c.pivot.z);
      expect(d).toBeLessThanOrEqual(c.cable + 1e-6);
    }
  });

  it("is deterministic", () => {
    const a = createCrane(), b = createCrane();
    for (let i = 0; i < 300; i++) { const inp = { slew: Math.sin(i / 20), trolley: Math.cos(i / 33), hoist: 0 }; stepCrane(a, inp, 1 / 60); stepCrane(b, inp, 1 / 60); }
    expect(a.hook).toEqual(b.hook);
  });

  it("holds the same swing regardless of frame rate", () => {
    const sim = (dt: number) => { const c = createCrane({ damping: 0.1 }, 0, 20, 15); run(c, { slew: 1, trolley: 0, hoist: 0 }, 4, undefined, dt); run(c, idle, 6, undefined, dt); return c.swing; };
    expect(Math.abs(sim(1 / 30) - sim(1 / 144))).toBeLessThan(0.01);
  });
});

describe("crane controls", () => {
  it("ramps up rather than jumping to speed", () => {
    const c = createCrane();
    stepCrane(c, { slew: 1, trolley: 0, hoist: 0 }, 1 / 60);
    expect(c.slewVel).toBeGreaterThan(0);
    expect(c.slewVel).toBeLessThan(c.cfg.slewSpeed * 0.1);
  });

  it("slewing drags the load behind the trolley, then it swings on after the jib stops", () => {
    const c = createCrane({ damping: 0.12 }, 0, 25, 15);
    run(c, { slew: 1, trolley: 0, hoist: 0 }, 4);
    const lag = Math.hypot(c.hook.x - c.pivot.x, c.hook.z - c.pivot.z);
    expect(lag).toBeGreaterThan(0.5);
    run(c, idle, 1);
    let swung = 0;
    for (let i = 0; i < 300; i++) { stepCrane(c, idle, 1 / 60); swung = Math.max(swung, c.swing); }
    expect(swung).toBeGreaterThan(0.03); // still swinging well after the jib stopped
  });

  it("stops the trolley at its limits", () => {
    const c = createCrane();
    run(c, { slew: 0, trolley: 1, hoist: 0 }, 40);
    expect(c.trolley).toBe(c.cfg.trolleyMax);
    expect(c.trolleyVel).toBe(0);
    run(c, { slew: 0, trolley: -1, hoist: 0 }, 40);
    expect(c.trolley).toBe(c.cfg.trolleyMin);
  });

  it("hoist raises (+1) and lowers (-1) the hook within rope limits", () => {
    const c = createCrane({}, 0, 12, 10);
    run(c, { slew: 0, trolley: 0, hoist: 1 }, 10);
    expect(c.cable).toBe(c.cfg.cableMin);
    run(c, { slew: 0, trolley: 0, hoist: -1 }, 30);
    expect(c.cable).toBe(c.cfg.cableMax);
  });
});

describe("crane hook contact", () => {
  it("rests on the floor and keeps rope slack, then lifts off only once the rope is taut again", () => {
    const c = createCrane({ jibY: 30 }, 0, 10, 20);
    const env: CraneEnv = { minHookY: () => 5, wind: { x: 0, z: 0 } };
    run(c, idle, 6, env);
    expect(c.hook.y).toBeCloseTo(10, 0); // hangs at 30 - 20
    run(c, { slew: 0, trolley: 0, hoist: -1 }, 8, env); // pay out rope past the floor
    expect(c.hook.y).toBeCloseTo(5, 3);
    expect(c.grounded).toBe(true);
    const cableAtLanding = c.cable;
    expect(cableAtLanding).toBeGreaterThan(25); // rope is slack: longer than the 25 m to the floor
    run(c, { slew: 0, trolley: 0, hoist: 1 }, (cableAtLanding - 25) / c.cfg.hoistSpeed - 0.5, env);
    expect(c.hook.y).toBeCloseTo(5, 3); // still slack
    run(c, { slew: 0, trolley: 0, hoist: 1 }, 3, env);
    expect(c.hook.y).toBeGreaterThan(5.5); // now it lifts
  });

  it("leans into steady wind by about wind/g of the rope length", () => {
    const L = 10, a = 0.5;
    const c = createCrane({ damping: 0.8, jibY: 40 }, 0, 10, L);
    run(c, idle, 40, { minHookY: () => 0, wind: { x: a, z: 0 } });
    const expected = L * Math.atan2(a, G);
    expect(c.hook.x - c.pivot.x).toBeGreaterThan(expected * 0.85);
    expect(c.hook.x - c.pivot.x).toBeLessThan(expected * 1.15);
  });
});

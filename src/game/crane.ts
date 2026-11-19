// Tower crane simulation. Pure — no React / three.
//
// Three driven axes (slew, trolley, hoist) with inertia, and a hook that is a real constrained pendulum:
// the trolley is the pivot, the hook is a point mass on a rope of length `cable`. Gravity, wind and drag
// act on the hook; the rope only pulls (it can go slack), so swing comes from how the player moves the
// pivot, not from a scripted animation. Axes: x east, z south on screen, y up; slew angle uses the same
// convention as vehicle headings, so the jib points along (sin slew, cos slew).
export const G = 9.81;

export interface Vec3 { x: number; y: number; z: number }

export interface CraneConfig {
  /** Mast base position. */
  x: number; z: number;
  /** Height of the jib rail (the pivot's y). */
  jibY: number;
  /** Trolley travel from the mast axis. */
  trolleyMin: number; trolleyMax: number;
  /** Rope length limits. */
  cableMin: number; cableMax: number;
  /** Top speed (rad/s or m/s) and acceleration of each axis. Acceleration is what excites swing. */
  slewSpeed: number; slewAccel: number;
  trolleySpeed: number; trolleyAccel: number;
  hoistSpeed: number; hoistAccel: number;
  /** Air drag on the hook, per second. Higher = swing dies faster. The main difficulty knob. */
  damping: number;
}

/** Tuned for a "mostly real" feel: long, lazy pendulum, a few seconds of ramp on every axis. */
export const DEFAULT_CRANE: CraneConfig = {
  x: 0, z: 0, jibY: 34,
  trolleyMin: 4, trolleyMax: 36,
  cableMin: 2.5, cableMax: 33,
  slewSpeed: 0.22, slewAccel: 0.22,
  trolleySpeed: 2.6, trolleyAccel: 1.8,
  hoistSpeed: 2.4, hoistAccel: 2.4,
  damping: 0.12,
};

export interface CraneState {
  cfg: CraneConfig;
  slew: number; slewVel: number;
  trolley: number; trolleyVel: number;
  cable: number; cableVel: number;
  pivot: Vec3;
  hook: Vec3; hookVel: Vec3;
  /** Rope angle from vertical, radians. */
  swing: number;
  /** True while the hook is resting on something. */
  grounded: boolean;
}

/** Axis commands in -1..1. slew: +1 turns the jib counter-clockwise on screen (same sign as vehicle steer). trolley: +1 out. hoist: +1 raises the hook. */
export interface CraneInput { slew: number; trolley: number; hoist: number }

export interface CraneEnv {
  /** Lowest y the hook may reach at (x, z): ground, roofs, a load resting on something. */
  minHookY(x: number, z: number): number;
  /** Horizontal wind acceleration on the hook, m/s². */
  wind: { x: number; z: number };
}

export const NO_ENV: CraneEnv = { minHookY: () => 0, wind: { x: 0, z: 0 } };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function approach(v: number, target: number, step: number) {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

export function pivotOf(cfg: CraneConfig, slew: number, trolley: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  out.x = cfg.x + Math.sin(slew) * trolley;
  out.y = cfg.jibY;
  out.z = cfg.z + Math.cos(slew) * trolley;
  return out;
}

export function createCrane(over: Partial<CraneConfig> = {}, slew = 0, trolley = 12, cable = 10): CraneState {
  const cfg = { ...DEFAULT_CRANE, ...over };
  const pivot = pivotOf(cfg, slew, trolley);
  return {
    cfg, slew, slewVel: 0, trolley, trolleyVel: 0, cable, cableVel: 0,
    pivot, hook: { x: pivot.x, y: pivot.y - cable, z: pivot.z }, hookVel: { x: 0, y: 0, z: 0 },
    swing: 0, grounded: false,
  };
}

const MAX_SUBSTEP = 1 / 480; // fine steps keep the rope projection from bleeding energy

export function stepCrane(c: CraneState, inp: CraneInput, dt: number, env: CraneEnv = NO_ENV) {
  const k = c.cfg;
  const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
  const h = dt / n;
  const drag = Math.exp(-k.damping * h);
  const h0 = c.hook, v = c.hookVel;
  for (let i = 0; i < n; i++) {
    // driven axes: velocity ramps toward the command, so starting/stopping a slew is what kicks the load
    c.slewVel = approach(c.slewVel, clamp(inp.slew, -1, 1) * k.slewSpeed, k.slewAccel * h);
    c.trolleyVel = approach(c.trolleyVel, clamp(inp.trolley, -1, 1) * k.trolleySpeed, k.trolleyAccel * h);
    c.cableVel = approach(c.cableVel, -clamp(inp.hoist, -1, 1) * k.hoistSpeed, k.hoistAccel * h);
    c.slew += c.slewVel * h;
    c.trolley += c.trolleyVel * h;
    c.cable += c.cableVel * h;
    if (c.trolley <= k.trolleyMin || c.trolley >= k.trolleyMax) { c.trolley = clamp(c.trolley, k.trolleyMin, k.trolleyMax); c.trolleyVel = 0; }
    if (c.cable <= k.cableMin || c.cable >= k.cableMax) { c.cable = clamp(c.cable, k.cableMin, k.cableMax); c.cableVel = 0; }
    const p = pivotOf(k, c.slew, c.trolley, c.pivot);

    // hook as a point mass: free flight under gravity + wind, then the rope pulls it back onto the sphere
    v.x += env.wind.x * h; v.z += env.wind.z * h; v.y -= G * h;
    v.x *= drag; v.y *= drag; v.z *= drag;
    h0.x += v.x * h; h0.y += v.y * h; h0.z += v.z * h;
    let dx = h0.x - p.x, dy = h0.y - p.y, dz = h0.z - p.z;
    const len = Math.hypot(dx, dy, dz);
    if (len > c.cable) {
      dx /= len; dy /= len; dz /= len;
      h0.x = p.x + dx * c.cable; h0.y = p.y + dy * c.cable; h0.z = p.z + dz * c.cable;
      const out = v.x * dx + v.y * dy + v.z * dz; // only the outward part is cancelled: ropes don't push
      if (out > 0) { v.x -= dx * out; v.y -= dy * out; v.z -= dz * out; }
    }
    // resting on the ground / a roof / a load
    const floor = env.minHookY(h0.x, h0.z);
    c.grounded = h0.y <= floor;
    if (c.grounded) {
      h0.y = floor;
      if (v.y < 0) v.y = 0;
      const f = Math.exp(-4 * h); // scraping friction
      v.x *= f; v.z *= f;
    }
  }
  const dx = h0.x - c.pivot.x, dy = c.pivot.y - h0.y, dz = h0.z - c.pivot.z;
  c.swing = Math.atan2(Math.hypot(dx, dz), Math.max(1e-6, dy));
}

/** Where the hook sits relative to its trolley, for HUD / hints: horizontal offset of the hook from straight-below. */
export function hookOffset(c: CraneState) {
  return Math.hypot(c.hook.x - c.pivot.x, c.hook.z - c.pivot.z);
}

// Rules shared by every level: difficulty, weather grip, fuel and wear, particle (fx) events.
// Pure data + functions: no React / three.

export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];
/** tip: roll/pitch threshold multiplier. grip: traction multiplier. fuel: burn multiplier. par: par-time multiplier. */
export const DIFF: Record<Difficulty, { tip: number; grip: number; fuel: number; par: number }> = {
  easy: { tip: 1.3, grip: 1.1, fuel: 0.6, par: 1.3 },
  normal: { tip: 1, grip: 1, fuel: 1, par: 1 },
  hard: { tip: 0.82, grip: 0.92, fuel: 1.4, par: 0.85 },
};

export type WeatherKind = "clear" | "rain" | "snow";
export const WEATHER_KINDS: WeatherKind[] = ["clear", "rain", "snow"];
/** Traction multiplier at full intensity. */
export const WEATHER_GRIP: Record<WeatherKind, number> = { clear: 1, rain: 0.82, snow: 0.7 };

/** Per-game environment the shell updates every frame; the rules read it. */
export interface Env { diff: Difficulty; gripMul: number }
export const makeEnv = (diff: Difficulty): Env => ({ diff, gripMul: 1 });

export type FxKind = "splash" | "dirt" | "dust" | "sawdust" | "leaves" | "chips" | "smoke" | "steam" | "treefall";
/** A particle / animation request at a world position. The shell drains these each frame. */
export interface Fx { kind: FxKind; x: number; y?: number; z: number; n?: number; heading?: number; s?: number }

export interface Collider { x: number; z: number; r: number }

/** Full tank = about 7 minutes of heavy driving on normal. */
export const FUEL_SECONDS = 420;
export const LOW_FUEL = 0.2;

export interface Worn { fuel: number; damage: number }

/** Fuel use of the machine being driven: idle burns a little, throttle and work burn more. */
export function burnFuel(v: Worn, dt: number, throttle: number, working: boolean, diff: Difficulty) {
  const rate = 0.15 + 0.6 * Math.abs(throttle) + (working ? 0.3 : 0);
  v.fuel = Math.max(0, v.fuel - (rate * DIFF[diff].fuel * dt) / FUEL_SECONDS);
}

/** Wear slows a machine down by up to 40%. */
export const wearFactor = (v: Worn) => 1 - 0.4 * Math.min(1, v.damage);

export function addDamage(v: Worn, amount: number) { v.damage = Math.min(1, v.damage + amount); }

export const ratingFor = (time: number, rollovers: number, penalties: number, par: number) =>
  1 + (time <= par * 1.5 ? 1 : 0) + (time <= par && rollovers <= 1 && penalties === 0 ? 1 : 0);

// Wheel and track marks the machines leave behind: short dashes laid at intervals, oldest overwritten first.
// Pure data, no React / three: GroundMarks.tsx draws them.

export const MARK_CAP = 900; // dashes alive at once
export const MARK_LIFE = 80; // seconds before a dash has faded away
export const MARK_STEP = 2.6; // metres travelled between dashes (the dash itself is MARK_LEN long, so there is a gap)
export const MARK_LEN = 1.3;
export const MARK_GAUGE = 1.0; // distance from the machine's centre line to each track
const MIN_SPEED = 0.8; // parked or crawling machines leave nothing

export interface MarkSource { x: number; z: number; heading: number; speed: number; tipped: boolean }

export class GroundMarks {
  x = new Float32Array(MARK_CAP); z = new Float32Array(MARK_CAP); heading = new Float32Array(MARK_CAP); born = new Float32Array(MARK_CAP).fill(-1e9);
  /** Total dashes ever laid; the newest is at `(head - 1) % MARK_CAP`. Lets the renderer find what changed. */
  head = 0;
  private from = new Map<MarkSource, { x: number; z: number }>();

  private lay(x: number, z: number, heading: number, now: number) {
    const k = this.head % MARK_CAP;
    this.x[k] = x; this.z[k] = z; this.heading[k] = heading; this.born[k] = now; this.head++;
  }

  /** How faded a dash is: 1 fresh .. 0 gone. */
  vigor(k: number, now: number) {
    const age = now - this.born[k];
    return age >= MARK_LIFE ? 0 : age > MARK_LIFE * 0.7 ? 1 - (age - MARK_LIFE * 0.7) / (MARK_LIFE * 0.3) : 1;
  }

  /** Call every frame with the machines and the clock. Lays a pair of dashes each time a moving machine has covered MARK_STEP. */
  update(machines: MarkSource[], now: number) {
    for (const m of machines) {
      let f = this.from.get(m);
      if (!f) { f = { x: m.x, z: m.z }; this.from.set(m, f); }
      if (m.tipped || Math.abs(m.speed) < MIN_SPEED) { f.x = m.x; f.z = m.z; continue; }
      if (Math.hypot(m.x - f.x, m.z - f.z) < MARK_STEP) continue;
      f.x = m.x; f.z = m.z;
      const rx = Math.cos(m.heading), rz = -Math.sin(m.heading), fx = Math.sin(m.heading), fz = Math.cos(m.heading);
      for (const side of [-1, 1]) this.lay(m.x + rx * MARK_GAUGE * side - fx * 0.6, m.z + rz * MARK_GAUGE * side - fz * 0.6, m.heading, now);
    }
  }
}

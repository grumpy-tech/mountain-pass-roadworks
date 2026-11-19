import { describe, expect, it } from "vitest";
import { GroundMarks, MARK_CAP, MARK_LIFE, MARK_STEP, type MarkSource } from "./groundMarks";

const drive = (m: MarkSource, marks: GroundMarks, metres: number, dt = 0.05) => {
  let now = 0;
  for (let d = 0; d < metres; d += m.speed * dt) { m.z += m.speed * dt; now += dt; marks.update([m], now); }
  return now;
};

describe("ground marks", () => {
  it("lays a pair of dashes every few metres while a machine is moving, with gaps between", () => {
    const m: MarkSource = { x: 0, z: 0, heading: 0, speed: 4, tipped: false }, marks = new GroundMarks();
    drive(m, marks, 26);
    expect(marks.head).toBeGreaterThanOrEqual(2 * Math.floor(26 / MARK_STEP) - 2);
    expect(marks.head).toBeLessThanOrEqual(2 * Math.ceil(26 / MARK_STEP) + 2);
    expect(marks.head % 2).toBe(0);
    // left and right track are a gauge apart, and consecutive dashes are MARK_STEP apart: intermittent, not a solid line
    expect(Math.abs(marks.x[0] - marks.x[1])).toBeCloseTo(2, 3);
    expect(marks.z[2] - marks.z[0]).toBeGreaterThan(MARK_STEP - 0.3);
  });

  it("leaves nothing when parked, crawling or tipped over", () => {
    const marks = new GroundMarks();
    drive({ x: 0, z: 0, heading: 0, speed: 0.5, tipped: false }, marks, 20, 0.05);
    drive({ x: 0, z: 0, heading: 0, speed: 5, tipped: true }, marks, 20);
    expect(marks.head).toBe(0);
  });

  it("follows the machine's heading and overwrites the oldest dashes once full", () => {
    const marks = new GroundMarks(), m: MarkSource = { x: 0, z: 0, heading: Math.PI / 2, speed: 5, tipped: false };
    for (let i = 0; i < MARK_CAP; i++) { m.x += MARK_STEP + 0.1; marks.update([m], i); }
    expect(marks.head).toBeGreaterThan(MARK_CAP);
    expect(marks.heading[0]).toBeCloseTo(Math.PI / 2, 5);
    expect(Math.min(...marks.born)).toBeGreaterThan(0); // slot 0 was reused by a newer dash
  });

  it("fades dashes out over the last part of their life", () => {
    const marks = new GroundMarks(), m: MarkSource = { x: 0, z: 0, heading: 0, speed: 5, tipped: false };
    marks.update([m], 0); m.z = 10; marks.update([m], 0);
    expect(marks.vigor(0, 10)).toBe(1);
    expect(marks.vigor(0, MARK_LIFE * 0.85)).toBeGreaterThan(0);
    expect(marks.vigor(0, MARK_LIFE * 0.85)).toBeLessThan(1);
    expect(marks.vigor(0, MARK_LIFE + 1)).toBe(0);
  });
});

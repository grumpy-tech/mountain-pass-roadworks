import { describe, expect, it } from "vitest";
import { URBAN_LEVEL, URBAN_SITE } from "./levels/urban";
import { PALLETS, cellCenter, craneHint, foundationDone, hookedPallet, stars, structureTop, toggleHook, type Pallet, type Site } from "./site";
import { createGame, craneAction, currentAction, heightAt, recover, stepGame, switchVehicle, type Game } from "./world";

const idle = { throttle: 0, steer: 0, action: false };
const run = (g: Game, secs: number) => { for (let t = 0; t < secs; t += 1 / 60) stepGame(g, idle, 1 / 60); };

/** Park a machine so its reach point (3.2 m ahead) is on (x, z). */
function reachAt(g: Game, i: number, x: number, z: number) {
  const v = g.vehicles[i];
  v.heading = Math.PI; // facing -z
  v.x = x; v.z = z + 3.2; v.speed = 0;
}
const doAction = (g: Game) => { const a = currentAction(g); expect(a).not.toBeNull(); a!.run(); };

/** Dig the whole pit, loading and hauling through the real actions. */
function buildFoundation(g: Game) {
  const s = g.site!, ex = g.vehicles[0], truck = g.vehicles[1];
  for (const cell of s.pitCells) {
    const p = cellCenter(cell);
    g.active = 0; reachAt(g, 0, p.x, p.z);
    doAction(g); // dig
    expect(ex.dirt).toBe(1);
    truck.x = ex.x + 0; truck.z = ex.z - 3.2; // under the bucket
    doAction(g); // load
    if (truck.dirt === 6 || cell === s.pitCells[s.pitCells.length - 1]) {
      g.active = 1; truck.x = -12; truck.z = 24; truck.speed = 0;
      doAction(g); // dump at the spoil pad
    }
  }
}

/** Hold the hook (perfectly steady) at (x, y, z), as an ideal operator would. */
function hang(s: Site, x: number, y: number, z: number) {
  const c = s.crane;
  c.slew = Math.atan2(x - c.cfg.x, z - c.cfg.z);
  c.trolley = Math.hypot(x - c.cfg.x, z - c.cfg.z);
  c.cable = c.cfg.jibY - y;
  c.pivot.x = x; c.pivot.z = z; c.pivot.y = c.cfg.jibY;
  c.hook.x = x; c.hook.y = y; c.hook.z = z;
  c.hookVel.x = c.hookVel.y = c.hookVel.z = 0;
}
const rest = (s: Site) => s.pallets.filter((p) => p.state === "rest");
function waitForPallet(g: Game, idx: number) {
  for (let t = 0; t < 40; t += 1 / 30) { stepGame(g, idle, 1 / 30); const p = g.site!.pallets.find((q) => q.idx === idx && q.state === "rest"); if (p) return p; }
  throw new Error(`pallet ${idx} never arrived`);
}
/** Lift a delivered pallet onto the building like a careful operator. */
function liftIntoPlace(g: Game, p: Pallet) {
  const s = g.site!, fp = s.cfg.footprint;
  hang(s, p.x, p.y + PALLETS[p.kind].h + 1.4, p.z); stepGame(g, idle, 1 / 60);
  expect(toggleHook(s)).toMatch(/Hooked/);
  const cx = (fp.x0 + fp.x1) / 2, cz = (fp.z0 + fp.z1) / 2;
  hang(s, cx, structureTop(s) + 1.4 + PALLETS[p.kind].h + 0.1, cz); stepGame(g, idle, 1 / 60);
  toggleHook(s);
  for (let i = 0; i < 90; i++) stepGame(g, idle, 1 / 60);
}

describe("urban level setup", () => {
  it("has the right machines, a flat lot and an undug pit", () => {
    const g = createGame(URBAN_LEVEL);
    expect(g.vehicles.map((v) => v.kind)).toEqual(["excavator", "truck", "crane"]);
    expect(g.level.machines).toEqual(["excavator", "truck", "crane"]);
    expect(g.site!.pitCells).toHaveLength(24);
    expect(g.world.road).toHaveLength(0);
    expect(heightAt(g.world, 0, 0)).toBe(0);
    expect(foundationDone(g.site!)).toBe(false);
  });

  it("keeps the crane within reach of both the delivery pad and the building", () => {
    const { crane, deliveryZone: z, footprint: f } = URBAN_SITE;
    const reach = (x: number, zz: number) => Math.hypot(x - crane.x!, zz - crane.z!);
    for (const sl of URBAN_SITE.zoneSlots) expect(reach(sl.x, sl.z)).toBeLessThan(36 - 2);
    for (const [x, zz] of [[f.x0, f.z0], [f.x1, f.z0], [f.x0, f.z1], [f.x1, f.z1]]) expect(reach(x, zz)).toBeLessThan(36 - 2);
    expect(z.z1).toBeLessThan(URBAN_SITE.fences[0].z0); // pad is inside the fence
  });

  it("delivery script is the build order: steel then concrete per floor, roof last", () => {
    const kinds = URBAN_SITE.script.map((d) => `${d.kind}${d.floor}`);
    expect(kinds.slice(0, 4)).toEqual(["steel1", "concrete1", "steel2", "concrete2"]);
    expect(kinds.at(-1)).toBe("roof7");
    expect(kinds).toHaveLength(13);
  });
});

describe("foundation", () => {
  it("digging lowers the ground, spoil must be hauled out through the gate", () => {
    const g = createGame(URBAN_LEVEL), s = g.site!;
    const c0 = cellCenter(s.pitCells[0]);
    g.active = 0; reachAt(g, 0, c0.x, c0.z);
    doAction(g);
    stepGame(g, idle, 1 / 60);
    expect(heightAt(g.world, c0.x, c0.z)).toBeLessThan(0);
    expect(g.vehicles[0].dirt).toBe(1);
    // bucket won't dig again until emptied, and spoil can't be dumped in the lot
    expect(currentAction(g)!.label).toMatch(/dump truck/);
    g.vehicles[1].dirt = 3; g.active = 1; g.vehicles[1].x = 0; g.vehicles[1].z = 0;
    expect(currentAction(g)!.time).toBe(Infinity);
    expect(currentAction(g)!.label).toMatch(/Haul/);
    g.vehicles[1].x = -12; g.vehicles[1].z = 24;
    expect(currentAction(g)!.label).toMatch(/Dump load/);
  });

  it("is finished when every pit cell has been dug and hauled", () => {
    const g = createGame(URBAN_LEVEL), s = g.site!;
    buildFoundation(g);
    expect(s.dug.size).toBe(24);
    expect(s.hauled).toBe(24);
    expect(foundationDone(s)).toBe(true);
    expect(heightAt(g.world, -8, -20)).toBeCloseTo(-1.2, 5);
  });
});

describe("deliveries", () => {
  it("no trucks until the dig is nearly done, then pallets arrive in script order, two at a time at most", () => {
    const g = createGame(URBAN_LEVEL), s = g.site!;
    run(g, 20);
    expect(s.trucks).toHaveLength(0);
    buildFoundation(g);
    run(g, 40);
    const arrived = s.pallets.filter((p) => p.state === "rest").map((p) => p.idx).sort();
    expect(arrived).toEqual([0, 1]); // pad holds two; the next truck waits in the street
    expect(s.trucks.some((t) => t.state === "driving" && t.stopped)).toBe(true);
    // free a slot: the waiting truck delivers item 2 without the player waiting long
    const p0 = s.pallets.find((p) => p.idx === 0)!;
    s.pallets.splice(s.pallets.indexOf(p0), 1);
    run(g, 6);
    expect(s.pallets.some((p) => p.idx === 2)).toBe(true);
  });

  it("only counts street blocking after a grace period", () => {
    const g = createGame(URBAN_LEVEL), s = g.site!;
    buildFoundation(g);
    run(g, 40);
    expect(s.traffic).toBe(0); // a truck is waiting but the player has two loads to work on
    run(g, 60);
    expect(s.traffic).toBeGreaterThan(10);
  });
});

describe("crane work", () => {
  it("builds the whole tower from the delivery script", () => {
    const g = createGame(URBAN_LEVEL), s = g.site!;
    buildFoundation(g);
    for (let i = 0; i < s.cfg.script.length; i++) {
      const p = waitForPallet(g, i);
      liftIntoPlace(g, p);
      expect(s.nextBuild).toBe(i + 1);
    }
    expect(s.toppedOut).toBe(true);
    expect(g.won).toBe(true);
    expect(s.floorsDone).toBe(6);
    expect(s.damage).toBe(0);
    expect(structureTop(s)).toBeCloseTo(-1.2 + 6 * 3.6 + PALLETS.roof.h, 5);
    expect(stars(s).safe).toBe(true);
  });

  it("makes the player place steel before concrete", () => {
    const g = createGame(URBAN_LEVEL), s = g.site!;
    buildFoundation(g);
    const concrete = waitForPallet(g, 1);
    liftIntoPlace(g, concrete);
    expect(s.nextBuild).toBe(0);
    expect(s.frameUp).toBe(false);
    expect(s.pallets.find((p) => p.idx === 1)).toBeDefined(); // still sitting there, not consumed
    expect(g.msg).toMatch(/steel frame for floor 1/i);
  });

  it("wrecks a load dropped from height and orders a replacement", () => {
    const g = createGame(URBAN_LEVEL), s = g.site!;
    buildFoundation(g);
    const p = waitForPallet(g, 0);
    hang(s, p.x, p.y + 0.8 + 1.4, p.z); stepGame(g, idle, 1 / 60);
    toggleHook(s);
    hang(s, 0, 12, 0); stepGame(g, idle, 1 / 60); // lift well clear of the ground
    toggleHook(s);
    run(g, 3);
    expect(s.damage).toBe(3);
    expect(s.pallets.find((q) => q.idx === 0 && q.state !== "unloading")).toBeUndefined();
    run(g, 20);
    expect(s.pallets.some((q) => q.idx === 0)).toBe(true); // replacement shipped, same item
  });

  it("penalises dropping a load on the public footpath", () => {
    const g = createGame(URBAN_LEVEL), s = g.site!;
    buildFoundation(g);
    const p = waitForPallet(g, 0);
    hang(s, p.x, p.y + 0.8 + 1.4, p.z); stepGame(g, idle, 1 / 60);
    toggleHook(s);
    hang(s, 10, 3, 22.5); stepGame(g, idle, 1 / 60);
    expect(hookedPallet(s)).toBeDefined();
    toggleHook(s);
    run(g, 3);
    expect(s.damage).toBeGreaterThanOrEqual(4);
  });

  it("counts time with a load over the pavement", () => {
    const g = createGame(URBAN_LEVEL), s = g.site!;
    buildFoundation(g);
    const p = waitForPallet(g, 0);
    hang(s, p.x, p.y + 0.8 + 1.4, p.z); stepGame(g, idle, 1 / 60);
    toggleHook(s);
    for (let i = 0; i < 120; i++) { hang(s, 10, 12, 22); stepGame(g, idle, 1 / 60); }
    expect(s.exposure).toBeGreaterThan(1.5);
  });

  it("rests the hook on a load and reports nothing in reach when it is not low enough", () => {
    const g = createGame(URBAN_LEVEL), s = g.site!;
    buildFoundation(g);
    const p = waitForPallet(g, 0);
    hang(s, p.x, 20, p.z); stepGame(g, idle, 1 / 60);
    expect(toggleHook(s)).toMatch(/Nothing in reach/);
    // lowering right onto the load stops at sling height, then it hooks
    for (let i = 0; i < 600; i++) stepGame(g, { throttle: 0, steer: 0, action: false, lift: -1 }, 1 / 60);
    expect(s.crane.hook.y).toBeGreaterThan(p.y + PALLETS[p.kind].h);
  });
});

describe("controls on site", () => {
  it("climbs into the crane near its base and back out to the previous machine", () => {
    const g = createGame(URBAN_LEVEL);
    g.active = 1;
    const c = g.vehicles[2];
    g.vehicles[1].x = c.x - 6; g.vehicles[1].z = c.z;
    switchVehicle(g);
    expect(g.vehicles[g.active].kind).toBe("crane");
    expect(g.prevActive).toBe(1);
    switchVehicle(g);
    expect(g.active).toBe(1);
  });

  it("drives the crane from the input: slew, trolley and hoist reach the hook", () => {
    const g = createGame(URBAN_LEVEL), s = g.site!;
    g.active = 2;
    const slew0 = s.crane.slew, trolley0 = s.crane.trolley, cable0 = s.crane.cable;
    for (let i = 0; i < 120; i++) stepGame(g, { throttle: 1, steer: 1, action: false, lift: 1 }, 1 / 60);
    expect(s.crane.slew).toBeGreaterThan(slew0);
    expect(s.crane.trolley).toBeGreaterThan(trolley0);
    expect(s.crane.cable).toBeLessThan(cable0);
    expect(craneAction(g)).toBe(true);
  });

  it("does not move machines through neighbouring buildings or the fence", () => {
    const g = createGame(URBAN_LEVEL);
    const t = g.vehicles[1];
    g.active = 1; t.x = 34; t.z = 10; t.heading = Math.PI / 2; // facing east, into the east neighbour
    for (let i = 0; i < 600; i++) stepGame(g, { throttle: 1, steer: 0, action: false }, 1 / 60);
    expect(t.x).toBeLessThan(37);
    t.x = -25; t.z = 15; t.heading = 0; // facing south into the fence
    t.speed = 0;
    for (let i = 0; i < 600; i++) stepGame(g, { throttle: 1, steer: 0, action: false }, 1 / 60);
    expect(t.z).toBeLessThan(20);
  });

  it("recover returns a stuck machine to the gate area", () => {
    const g = createGame(URBAN_LEVEL);
    g.vehicles[0].x = 50; g.vehicles[0].tipped = true;
    recover(g);
    expect(g.vehicles[0].tipped).toBe(false);
    expect(Math.abs(g.vehicles[0].z - URBAN_SITE.respawn.z)).toBeLessThan(1);
  });

  it("gives a hint for each stage of the job", () => {
    const g = createGame(URBAN_LEVEL), s = g.site!;
    expect(craneHint(s, false)).toMatch(/foundation/i);
    buildFoundation(g);
    expect(craneHint(s, false)).toMatch(/press E/);
    expect(craneHint(s, true)).toMatch(/Waiting|hook/i);
  });
});

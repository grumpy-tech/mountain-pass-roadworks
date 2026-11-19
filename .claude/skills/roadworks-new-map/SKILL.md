---
name: roadworks-new-map
description: Add a new map (level) to Mountain Pass Roadworks, or rework a map's start or hazards. Use for every new map or track, and for requests like "add a new level", "new map", "the machines start clumped up", "fix the start positions", "too many holes/hazards". Makes the machines start spread out beside the road like Timber Ridge, keeps hazards sparse, and proves both with tests.
---

# New roadworks map

Every map starts the same way: machines **parked in a spaced row beside the road, each angled 45 degrees towards it, on level ground**. Never start machines on the road or in a clump: they block each other in, and a nudge can tip one over.

Pair with `roadworks-level-change` for the general check list (install, tsc, vitest, eslint, build, browser check).

## Inputs
- The map's route (a path of `{x, z}` points), its camp (`findCamp` in `campLayout.ts`), and its four machines in work order.
- The map's hazards and jobs, in the user's words.

## Rules
1. **Start layout is mandatory and shared.** Use `startSlots(...)` from `src/game/startLayout.ts`. Do not hand-place start positions and do not copy its maths into a level file.
   - `startSlots({ path, cum }, camp)` with `cum = arcLengths(path)` returns 4 slots, slot 0 furthest along the road. Give slot 0 to the machine that works first, the last slot to the one that works last.
   - It picks the side of the road opposite the camp, 7.5 m off the centre line, 7.5+ m apart, and slides the row along the road past any sharp bend (a bend squeezes the spots together). Keep the row within `START_MAX_SPAN`.
   - Build vehicles from the slots: position and `heading` come straight from the slot, height from the terrain.
2. **Level pad under every slot.** In the terrain loop, blend height towards the road height at each slot with `padWeight(slots, x, z)` (`{ w, i }`: weight and nearest slot), and damp the bump noise by `1 - w`. Tint `w > 0.5` gravel. Without it a machine can start on a 15 degree lean.
3. **Clear scenery.** Skip trees, boulders, bog and hazards near slots with `nearSlot(slots, x, z)`. Keep hazards, rocks and mounds out of the first stretch of road and away from the row.
4. **Hazards are few, spaced and shaped to the ground.**
   - A handful (about 4) spread along the route, one per equal stretch, each at the straightest point, at least 15 m apart and never near the camp or the start row. Never a noise-driven field of cells: that stacks hazards into clumps.
   - Draw a hazard as terrain (carve the heightfield, tint the dirt) plus a few props. Do not tile a prop per cell.
   - Interaction must be forgiving: fill/dig/tip within a radius of the hazard's cells, not one exact cell. Show the reason on screen whenever an action is unavailable (`label`, `time: Infinity`).
5. **No soft-locks.** A resource a job consumes (dirt, fuel) must always be obtainable again, however the player wasted it. A player action must never make the map unwinnable.
6. Rules go in the pure file (no React/three); the `.tsx` only draws (AGENTS.md).

## Steps
1. Write the map's pure rules file; call `startSlots`, `padWeight`, `nearSlot` as above.
2. Register the map in `LEVELS` in `src/game/startLayout.test.ts` (name, a `make()` that returns path, camp, machines, a trees-near check and an idle stepper). The four start tests then cover it: spread out, beside the road at 45 degrees, same side opposite the camp, compact row, and no machine tipping after 3 s idle. Use `maxLean: 0.1`; only Timber Ridge (older) has a looser limit.
3. Add map tests for its hazards: counts, spacing, shape in the terrain, and the real-input flow (drive with throttle/steer/Space like a player, not teleport-and-call; see the driveReach helper in `world.test.ts`). Headless tests must call `recomputeHeights` after terrain changes (the renderer does it in-game).
4. Wire the scene, HUD, minimap and level select (`Game.tsx` ids, `LevelSelect.tsx`).
5. Run all checks and the browser check from `roadworks-level-change`. Look at the screenshots: machines spread out and level, hazards individually readable and not overlapping.
6. Commit with the session's attribution trailers; push to the assigned branch only.

## Output
- The map, its tests (including the `LEVELS` entry), and a short summary: what the start looks like, hazard count and placement, anything not verified.

---
name: roadworks-level-change
description: Add or change a gameplay mechanic in a Mountain Pass Roadworks level (rules, HUD, minimap, 3D scene), then prove it works with unit tests and a headless-browser check. Use for requests like "add fuel stops", "lock this until X is done", "show Y on the minimap", "change the start positions".
---

# Roadworks level change

## Inputs
- The requested change(s), in the user's words.
- If the request adds a whole new map or changes where machines start, use `roadworks-new-map` instead (or as well).
- Which level: Pass Road (`world.ts` + `RoadLevel.tsx`) or Timber Ridge (`forest.ts` + `ForestLevel.tsx`). Shared UI: `Shell.tsx`, `Minimap.tsx`, `shared.ts`, `campLayout.ts`.

## Rules
- Game rules live in the pure files (`world.ts`, `forest.ts`, `shared.ts`, `groundMarks.ts`): no React or three imports. The `.tsx` files only draw state and read it. (AGENTS.md)
- The level-agnostic `Shell.tsx` must never know which level it runs: extend `LevelSpec` / `MapInfo` with optional fields instead.
- Never edit `supabase/migrations/`, `drizzle/` or generated files. Never rewrite pushed history (Lovable sync). Push only to the assigned branch; no PR unless asked.
- If a feature needs the player to do things in order, make the later step impossible (locked, with a visible reason) rather than just discouraged. A player action must never be able to make the level unwinnable.
- Ask before guessing when a request is ambiguous; state any interpretation you pick.

## Steps
1. Confirm the code for the feature exists on the current branch (`git branch -r`, `git grep`). Levels may live on another branch; fast-forward, never rebase.
2. Install: `bun install --frozen-lockfile` (no package-lock, so `npm ci` fails). Baseline: `npx vitest run`.
3. Write the rule in the pure file first, with state on the world/game object so the HUD and minimap can read it.
4. Add tests next to the existing ones (`forest.test.ts`, `world.test.ts`, `groundMarks.test.ts`). Cover: the happy path, the guard (what is now refused), and timing (e.g. ETA matches the simulated time).
5. Wire the UI: scene components in the level `.tsx`, HUD rows in `tasks()`, hints in `hint()`/`refuelHint()`, minimap in `map()`, instructions in `jobOrder`/`fuelNote`.
6. Checks, all must pass: `npx tsc --noEmit -p .`, `npx vitest run`, `npx eslint src/game --rule 'prettier/prettier: off'` (the project's prettier errors are pre-existing noise; compare warning count with baseline = 11), `bun run build`.
7. Browser check (see below), view the screenshots, fix what looks wrong.
8. Commit with the attribution trailers from the session, push to the assigned branch.

## Browser check
- `npx vite dev --port 5199 --host 127.0.0.1` in the background, then Playwright with `args: ["--use-angle=swiftshader","--use-gl=angle","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]`.
- Open `/?level=timber-ridge` (or `pass-road`), wait for `[data-scene-ready]`, press Enter to close the briefing.
- `window.__game` is the live game object: teleport machines, set `world.roadOpen`, set fuel, etc. to reach a state, then screenshot. `__game.world`, `__game.vehicles`, `__game.active` are all mutable.
- Software WebGL runs at roughly 0.2x speed: hold keys for 25 s or more, or wait on a condition with `page.waitForFunction`, instead of short timeouts.
- Keep Playwright scripts in the scratchpad, not the repo. Kill the dev server afterwards.
- Do not expose debug handles from inside `useMemo`: React StrictMode runs it twice and you get the discarded instance. Use `useEffect`, and remove the hook before committing.

## Output
- Committed and pushed change, passing checks, and a short summary: what changed, interpretations chosen, open decisions, anything not verified.

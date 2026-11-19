<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Game architecture
- Game rules live in rules modules with no React/three imports: `src/game/world.ts` (Pass Road) and `src/game/forest.ts` (Timber Ridge), plus `shared.ts` (difficulty, weather grip, fuel and wear, fx event types) and `campLayout.ts` (work camp layout and colliders). Each of those levels has a render module (`RoadLevel.tsx`, `ForestLevel.tsx`) that exposes a `LevelSpec`; `src/game/Shell.tsx` runs any spec (HUD, minimap, hints, popup, photo mode, audio, day/night cycle, weather, star ratings) with one `useFrame` stepper. `Game.tsx` is just the level-select root and holds the settings. New levels = a rules module + a level module + a card in `LevelSelect.tsx`.
- Effects: rules push event names onto `game.events` (sound, played by `audio.ts`) and `Fx` requests onto `game.fx` (particles / tree falls); the shell drains both. Continuous effects (exhaust, dust) are emitted from vehicle meshes via the `FxBus` in `Particles.tsx`. Game time is `game.time`; the clock and weather live in the shell's `Sim` state, which sets `game.env` each frame.
- Tower Block (urban site) predates the Shell and is self-contained: `UrbanLevel.tsx` runs its own canvas, stepper and HUD (`UrbanHud.tsx`, `UrbanSite.tsx`) on `urbanSim.ts` (vehicle sim, `LevelConfig`), `grid.ts` (terrain grid), `site.ts` / `crane.ts` (site rules, tower crane) and `levels/urban.ts`. It has no weather, fuel or audio yet; moving it onto `Shell` is the open follow-up. Pure-rules tests: `crane.test.ts`, `urban.test.ts`.
- Pass Road and Timber Ridge tests pin their generated worlds and scripted drives (`world.test.ts`, `forest.test.ts`, `startLayout.test.ts`). If shared code changes them, the level changed — fix the code, don't just update the numbers.

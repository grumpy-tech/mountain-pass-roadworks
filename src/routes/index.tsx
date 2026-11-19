import { createFileRoute, useNavigate } from "@tanstack/react-router";
import Game from "@/game/Game";
import { LEVELS, getLevel } from "@/game/levels";

export const Route = createFileRoute("/")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { level?: string } => (typeof search["level"] === "string" ? { level: search["level"] } : {}),
  head: () => ({
    meta: [
      { title: "Pass Builder — Construction Game" },
      { name: "description", content: "Build a mountain road or lift a tower block into place with a tower crane, in low-poly 3D." },
      { property: "og:title", content: "Pass Builder — Construction Game" },
      { property: "og:description", content: "Build a mountain road or lift a tower block into place with a tower crane, in low-poly 3D." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const { level } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const cfg = getLevel(level);
  if (cfg) return <Game key={cfg.id} level={cfg} onExit={() => navigate({ search: {} })} />;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 font-mono text-foreground">
      <div className="w-full max-w-2xl">
        <h1 className="text-3xl font-bold">Pass Builder</h1>
        <p className="mt-1 text-muted-foreground">Pick a job.</p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {LEVELS.map((l) => (
            <li key={l.id}>
              <button
                className="h-full w-full rounded-md border-2 border-foreground/80 bg-card p-5 text-left text-card-foreground shadow-lg transition hover:bg-muted"
                onClick={() => navigate({ search: { level: l.id } })}
              >
                <div className="text-xs uppercase tracking-widest text-muted-foreground">{l.machines.length} machines</div>
                <div className="mt-1 text-xl font-bold">{l.title}</div>
                <div className="mt-2 text-sm text-muted-foreground">{l.blurb}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

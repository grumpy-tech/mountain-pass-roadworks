import { useEffect, useState } from "react";
import { FOREST_MACHINES, LOG_TARGET } from "./forest";
import { PAINT, Key } from "./parts";
import { bestKey, fmtTime } from "./Shell";
import { MACHINES } from "./world";

export type LevelId = "pass-road" | "timber-ridge";

interface Card { id: LevelId; title: string; blurb: string; crew: { kind: string; nick: string }[]; difficulty: string }

const CARDS: Card[] = [
  {
    id: "pass-road", title: "Pass Road", difficulty: "Classic",
    blurb: "Clear rocks, dig mounds, fill mud, then grade and pave a winding road up the mountain pass.",
    crew: Object.entries(MACHINES).map(([kind, m]) => ({ kind, nick: m.nick })),
  },
  {
    id: "timber-ridge", title: "Timber Ridge", difficulty: "New",
    blurb: `Fell trees, skid the logs to the landing and haul ${LOG_TARGET} of them to the mill. Standing timber blocks everything, and the truck hates the forest floor.`,
    crew: Object.entries(FOREST_MACHINES).map(([kind, m]) => ({ kind, nick: m.nick })),
  },
];

function readBest(id: string): number | null {
  try { const n = Number(localStorage.getItem(bestKey(id))); return n > 0 ? n : null; } catch { return null; }
}

export default function LevelSelect({ night, muted, onPlay, onToggleNight, onToggleMute }: {
  night: boolean; muted: boolean; onPlay(id: LevelId): void; onToggleNight(): void; onToggleMute(): void;
}) {
  const [best, setBest] = useState<Record<string, number | null>>({});
  useEffect(() => { setBest(Object.fromEntries(CARDS.map((c) => [c.id, readBest(c.id)]))); }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if (CARDS[i]) onPlay(CARDS[i].id);
      else if (e.key.toLowerCase() === "n") onToggleNight();
      else if (e.key.toLowerCase() === "m") onToggleMute();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [onPlay, onToggleNight, onToggleMute]);

  return (
    <main className={`flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-6 font-mono text-foreground ${night ? "from-[#2a2342] to-[#4a3a52]" : "from-[#b9d3e0] to-[#e3ead6]"}`}>
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Pass Builder</h1>
        <p className="mt-2 text-muted-foreground">Pick a job site. Switch machines with <Key>Tab</Key> or number keys.</p>
      </header>

      <div className="grid w-full max-w-3xl gap-4 md:grid-cols-2">
        {CARDS.map((c, i) => (
          <button
            key={c.id} type="button" onClick={() => onPlay(c.id)} data-level-card={c.id}
            className="flex flex-col gap-3 rounded-md border-2 border-foreground bg-card p-5 text-left text-card-foreground shadow-lg transition hover:-translate-y-0.5 hover:bg-muted"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-bold"><Key>{i + 1}</Key> {c.title}</span>
              <span className="text-xs uppercase tracking-widest text-muted-foreground">{c.difficulty}</span>
            </div>
            <p className="text-sm">{c.blurb}</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {c.crew.map((m) => (
                <li key={m.kind} className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm border border-foreground/60" style={{ background: PAINT[m.kind] }} />{m.nick}
                </li>
              ))}
            </ul>
            <div className="mt-auto text-xs text-muted-foreground">{best[c.id] ? `Best time ${fmtTime(best[c.id]!)}` : "No time set yet"}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-3 text-sm">
        <button type="button" onClick={onToggleNight} className="rounded-md border-2 border-foreground/80 bg-card px-3 py-1.5 font-bold hover:bg-muted">
          Lighting: {night ? "Dusk" : "Day"} <span className="font-normal text-muted-foreground">(N)</span>
        </button>
        <button type="button" onClick={onToggleMute} className="rounded-md border-2 border-foreground/80 bg-card px-3 py-1.5 font-bold hover:bg-muted">
          Sound: {muted ? "Off" : "On"} <span className="font-normal text-muted-foreground">(M)</span>
        </button>
      </div>
    </main>
  );
}

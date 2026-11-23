import { useEffect, useState } from "react";
import { FOREST_MACHINES, LOG_TARGET } from "./forest";
import { PAINT, Key } from "./parts";
import { DIFFICULTIES, type Difficulty } from "./shared";
import { bestKey, fmtTime, type Settings } from "./Shell";
import { MACHINES } from "./world";
import { MACHINES as URBAN_MACHINES } from "./urbanSim";
import { URBAN_LEVEL } from "./levels/urban";

export type LevelId = "pass-road" | "timber-ridge" | "tower-block";

interface Card { id: LevelId; title: string; blurb: string; crew: { kind: string; nick: string }[]; tag: string }

const CARDS: Card[] = [
  {
    id: "pass-road", title: "Pass Road", tag: "Classic",
    blurb: "Clear rocks, dig mounds, fill the mud holes, then grade and pave a winding road up the mountain pass. Flags and a map show how far you have got.",
    crew: Object.entries(MACHINES).map(([kind, m]) => ({ kind, nick: m.nick })),
  },
  {
    id: "timber-ridge", title: "Timber Ridge", tag: "New",
    blurb: `Reopen an overgrown logging road: clear the blockers and level the ruts. Then fell the ${LOG_TARGET} marked trees in the cut block and haul them to the sawmill.`,
    crew: Object.entries(FOREST_MACHINES).map(([kind, m]) => ({ kind, nick: m.nick })),
  },
  {
    id: "tower-block", title: "Tower Block", tag: "New",
    blurb: URBAN_LEVEL.blurb,
    crew: URBAN_LEVEL.machines.map((kind) => ({ kind, nick: URBAN_MACHINES[kind].nick })),
  },
];

function readBest(id: string, diff: Difficulty): { time: number; stars: number } | null {
  try {
    const k = bestKey(id, diff), time = Number(localStorage.getItem(k));
    return time > 0 ? { time, stars: Number(localStorage.getItem(k + "-stars")) || 0 } : null;
  } catch { return null; }
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function Choice({ label, value, onClick, hint }: { label: string; value: string; onClick: () => void; hint: string }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border-2 border-foreground/80 bg-card px-3 py-1.5 text-sm font-bold text-card-foreground hover:bg-muted">
      {label}: {value} <span className="font-normal text-muted-foreground">({hint})</span>
    </button>
  );
}

export default function LevelSelect({ settings, onPlay, onCycleLighting, onCycleWeather, onToggleMute, onDifficulty }: {
  settings: Settings; onPlay(id: LevelId): void; onCycleLighting(): void; onCycleWeather(): void; onToggleMute(): void; onDifficulty(d: Difficulty): void;
}) {
  const [best, setBest] = useState<Record<string, { time: number; stars: number } | null>>({});
  useEffect(() => { setBest(Object.fromEntries(CARDS.map((c) => [c.id, readBest(c.id, settings.difficulty)]))); }, [settings.difficulty]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1, k = e.key.toLowerCase();
      if (CARDS[i]) onPlay(CARDS[i].id);
      else if (k === "n") onCycleLighting();
      else if (k === "c") onCycleWeather();
      else if (k === "m") onToggleMute();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [onPlay, onCycleLighting, onCycleWeather, onToggleMute]);

  const dusk = settings.lighting === "night";
  return (
    <main className={`flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b p-6 font-mono text-foreground ${dusk ? "from-[#1d2040] to-[#4a3a52] text-white" : "from-[#b9d3e0] to-[#e3ead6]"}`}>
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Pass Builder</h1>
        <p className={`mt-2 ${dusk ? "text-white/70" : "text-muted-foreground"}`}>Pick a job site. Switch machines with <Key>Tab</Key> or number keys.</p>
      </header>

      <div className="grid w-full max-w-3xl gap-4 md:grid-cols-2">
        {CARDS.map((c, i) => {
          const b = best[c.id];
          return (
            <button
              key={c.id} type="button" onClick={() => onPlay(c.id)} data-level-card={c.id}
              className="flex flex-col gap-3 rounded-md border-2 border-foreground bg-card p-5 text-left text-card-foreground shadow-lg transition hover:-translate-y-0.5 hover:bg-muted"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold"><Key>{i + 1}</Key> {c.title}</span>
                <span className="text-xs uppercase tracking-widest text-muted-foreground">{c.tag}</span>
              </div>
              <p className="text-sm">{c.blurb}</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {c.crew.map((m) => (
                  <li key={m.kind} className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm border border-foreground/60" style={{ background: PAINT[m.kind] }} />{m.nick}
                  </li>
                ))}
              </ul>
              <div className="mt-auto text-xs text-muted-foreground">
                {b ? <>Best ({cap(settings.difficulty)}): {fmtTime(b.time)} <span className="text-primary">{"★".repeat(b.stars)}{"☆".repeat(3 - b.stars)}</span></> : `No ${settings.difficulty} time set yet`}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        <div className="flex overflow-hidden rounded-md border-2 border-foreground/80 bg-card text-sm text-card-foreground" role="group" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => (
            <button key={d} type="button" onClick={() => onDifficulty(d)} aria-pressed={settings.difficulty === d}
              className={`px-3 py-1.5 font-bold ${settings.difficulty === d ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{cap(d)}</button>
          ))}
        </div>
        <Choice label="Lighting" value={cap(settings.lighting)} onClick={onCycleLighting} hint="N" />
        <Choice label="Weather" value={cap(settings.weather)} onClick={onCycleWeather} hint="C" />
        <Choice label="Sound" value={settings.muted ? "Off" : "On"} onClick={onToggleMute} hint="M" />
      </div>
      <p className={`max-w-xl text-center text-xs ${dusk ? "text-white/60" : "text-muted-foreground"}`}>
        Easy: sturdier machines, grippier ground, thriftier engines. Hard: tippier, slipperier and thirstier. Auto lighting runs a full day and night; auto weather brings in rain and snow.
      </p>
    </main>
  );
}

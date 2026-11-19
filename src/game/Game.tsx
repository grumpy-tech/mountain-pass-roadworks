// Root of the game: level select menu <-> a running level. Each level lives in its own module
// (rules in world.ts / forest.ts, scene in RoadLevel.tsx / ForestLevel.tsx) and runs inside the shared Shell.
import { useCallback, useState } from "react";
import ForestLevel from "./ForestLevel";
import LevelSelect, { type LevelId } from "./LevelSelect";
import RoadLevel from "./RoadLevel";

const IDS: LevelId[] = ["pass-road", "timber-ridge"];

/** `?level=timber-ridge` jumps straight into a level (handy for sharing a preview link). */
function initialLevel(): LevelId | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("level");
  return IDS.find((id) => id === q) ?? null;
}

export default function Game() {
  const [level, setLevel] = useState<LevelId | null>(initialLevel);
  const [run, setRun] = useState(0); // bump to start the level over
  const [night, setNight] = useState(false);
  const [muted, setMuted] = useState(false);
  const toggleNight = useCallback(() => setNight((n) => !n), []);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);
  const exit = useCallback(() => setLevel(null), []);
  const restart = useCallback(() => setRun((r) => r + 1), []);

  if (!level) return <LevelSelect night={night} muted={muted} onPlay={setLevel} onToggleNight={toggleNight} onToggleMute={toggleMute} />;
  const props = { night, muted, onToggleNight: toggleNight, onToggleMute: toggleMute, onExit: exit, onRestart: restart };
  return level === "timber-ridge" ? <ForestLevel key={run} {...props} /> : <RoadLevel key={run} {...props} />;
}

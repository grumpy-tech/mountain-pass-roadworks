// Root of the game: level select menu <-> a running level. Each level lives in its own module
// (rules in world.ts / forest.ts, scene in RoadLevel.tsx / ForestLevel.tsx) and runs inside the shared Shell.
import { useCallback, useState } from "react";
import ForestLevel from "./ForestLevel";
import LevelSelect, { type LevelId } from "./LevelSelect";
import RoadLevel from "./RoadLevel";
import type { Lighting, Settings } from "./Shell";
import type { Difficulty } from "./shared";

const IDS: LevelId[] = ["pass-road", "timber-ridge"];
const LIGHTING: Lighting[] = ["auto", "day", "night"];
const WEATHER: Settings["weather"][] = ["auto", "clear", "rain", "snow"];
const next = <T,>(list: T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length];

/** `?level=timber-ridge` jumps straight into a level (handy for sharing a preview link). */
function initialLevel(): LevelId | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("level");
  return IDS.find((id) => id === q) ?? null;
}

export default function Game() {
  const [level, setLevel] = useState<LevelId | null>(initialLevel);
  const [run, setRun] = useState(0); // bump to start the level over
  const [settings, setSettings] = useState<Settings>({ lighting: "auto", weather: "auto", difficulty: "normal", muted: false });
  const cycleLighting = useCallback(() => setSettings((s) => ({ ...s, lighting: next(LIGHTING, s.lighting) })), []);
  const cycleWeather = useCallback(() => setSettings((s) => ({ ...s, weather: next(WEATHER, s.weather) })), []);
  const toggleMute = useCallback(() => setSettings((s) => ({ ...s, muted: !s.muted })), []);
  const setDifficulty = useCallback((difficulty: Difficulty) => setSettings((s) => ({ ...s, difficulty })), []);
  const exit = useCallback(() => setLevel(null), []);
  const restart = useCallback(() => setRun((r) => r + 1), []);

  if (!level) {
    return <LevelSelect settings={settings} onPlay={setLevel} onCycleLighting={cycleLighting} onCycleWeather={cycleWeather} onToggleMute={toggleMute} onDifficulty={setDifficulty} />;
  }
  const props = { settings, onCycleLighting: cycleLighting, onCycleWeather: cycleWeather, onToggleMute: toggleMute, onExit: exit, onRestart: restart };
  return level === "timber-ridge" ? <ForestLevel key={run} {...props} /> : <RoadLevel key={run} {...props} />;
}

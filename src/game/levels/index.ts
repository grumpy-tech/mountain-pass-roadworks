import type { LevelConfig } from "../world";
import { MOUNTAIN_LEVEL } from "./mountain";

export const LEVELS: LevelConfig[] = [MOUNTAIN_LEVEL];
export const getLevel = (id: string | undefined): LevelConfig | undefined => LEVELS.find((l) => l.id === id);

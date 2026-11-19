import type { LevelConfig } from "../urbanSim";
import { URBAN_LEVEL } from "./urban";

export const LEVELS: LevelConfig[] = [URBAN_LEVEL];
export const getLevel = (id: string | undefined): LevelConfig | undefined => LEVELS.find((l) => l.id === id);

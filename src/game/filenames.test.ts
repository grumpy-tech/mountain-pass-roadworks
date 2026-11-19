// Windows and macOS filesystems ignore case, so `groundMarks.ts` and `GroundMarks.tsx` collide on checkout
// and imports silently resolve to the wrong file. Keep every source file name unique ignoring case and extension.
import { readdirSync } from "node:fs";
import { join, parse } from "node:path";
import { expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

it("has no source files whose names differ only by case or extension", () => {
  const seen = new Map<string, string>(), clashes: string[] = [];
  for (const f of walk("src")) {
    const { dir, name } = parse(f), key = join(dir, name).toLowerCase();
    const prev = seen.get(key);
    if (prev) clashes.push(`${prev} <-> ${f}`);
    else seen.set(key, f);
  }
  expect(clashes).toEqual([]);
});

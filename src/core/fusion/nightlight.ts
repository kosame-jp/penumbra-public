import { clamp } from "../scanline/geometry";
import type { StatBlock } from "../static-data/worldgrid-loader";

export function normalizeNightLight(value: number, stats: StatBlock): number {
  const reference = stats.p99_5 ?? stats.p99 ?? stats.max;
  if (reference <= 0) {
    return 0;
  }

  return clamp(Math.log1p(Math.max(0, value)) / Math.log1p(reference), 0, 1);
}

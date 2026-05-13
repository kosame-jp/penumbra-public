import type { WorldGrid, WorldGridCell } from "../../src/core/static-data/worldgrid-loader";
import { computeWorldGridStats } from "./compute-stats";

export interface BuildWorldGridOptions {
  readonly version: string;
  readonly generatedAtUtc: string;
  readonly cellSizeDegrees: number;
  readonly sources?: Record<string, unknown>;
}

export function buildWorldGridArtifact(
  cells: readonly WorldGridCell[],
  options: BuildWorldGridOptions,
): WorldGrid {
  if (cells.length === 0) {
    throw new Error("Worldgrid build requires at least one generated cell.");
  }

  return {
    version: options.version,
    generatedAtUtc: options.generatedAtUtc,
    cellSizeDegrees: options.cellSizeDegrees,
    sources: options.sources,
    stats: computeWorldGridStats(cells),
    cells,
  };
}

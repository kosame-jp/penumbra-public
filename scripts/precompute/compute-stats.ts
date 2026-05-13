import type { StatBlock, WorldGrid, WorldGridCell } from "../../src/core/static-data/worldgrid-loader";

export interface PercentileOptions {
  readonly includeP95?: boolean;
  readonly includeP99?: boolean;
  readonly includeP99_5?: boolean;
}

export function computeStatBlock(
  values: readonly number[],
  options: PercentileOptions = {},
): StatBlock {
  const finiteValues = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finiteValues.length === 0) {
    throw new Error("Cannot compute stats from an empty numeric series.");
  }

  return {
    min: finiteValues[0],
    max: finiteValues[finiteValues.length - 1],
    ...(options.includeP95 ? { p95: percentile(finiteValues, 95) } : {}),
    ...(options.includeP99 ? { p99: percentile(finiteValues, 99) } : {}),
    ...(options.includeP99_5 ? { p99_5: percentile(finiteValues, 99.5) } : {}),
  };
}

export function computeWorldGridStats(cells: readonly WorldGridCell[]): WorldGrid["stats"] {
  return {
    nightLight: computeStatBlock(cells.map((cell) => cell.nightLightMean), {
      includeP95: true,
      includeP99: true,
      includeP99_5: true,
    }),
    roadLengthKm: computeStatBlock(cells.map((cell) => cell.roadLengthKm), {
      includeP95: true,
      includeP99: true,
    }),
    buildingCount: computeStatBlock(cells.map((cell) => cell.buildingCount), {
      includeP95: true,
      includeP99: true,
    }),
    waterRatio: computeStatBlock(cells.map((cell) => cell.waterRatio)),
    forestRatio: computeStatBlock(cells.map((cell) => cell.forestRatio)),
    elevationM: computeStatBlock(cells.map((cell) => cell.elevationM), {
      includeP95: true,
      includeP99: true,
    }),
    bathymetryM: computeStatBlock(cells.map((cell) => cell.bathymetryM), {
      includeP95: true,
      includeP99: true,
    }),
  };
}

export function percentile(sortedValues: readonly number[], percentileValue: number): number {
  if (sortedValues.length === 0) {
    throw new Error("Cannot compute percentile from an empty series.");
  }
  if (percentileValue < 0 || percentileValue > 100) {
    throw new Error("Percentile must be between 0 and 100.");
  }

  const rank = (percentileValue / 100) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const ratio = rank - lowerIndex;

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  return lower + (upper - lower) * ratio;
}

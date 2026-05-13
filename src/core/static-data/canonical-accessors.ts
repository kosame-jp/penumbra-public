import type { WeatherSample } from "../live-data/openmeteo-client";
import type { WeatherCacheEntryArtifact } from "../live-data/weather-cache";
import { effectiveElevationM } from "../fusion/register";
import type { WorldGrid, WorldGridCell } from "./worldgrid-loader";

export function requireNightLightReference(worldGrid: WorldGrid): number {
  const reference =
    worldGrid.stats.nightLight.p99_5 ??
    worldGrid.stats.nightLight.p99 ??
    worldGrid.stats.nightLight.max;

  if (reference <= 0) {
    throw new Error("Worldgrid nightLight stats must expose a positive runtime reference.");
  }
  return reference;
}

export function requirePercentileStat(
  worldGrid: WorldGrid,
  key: "nightLight" | "roadLengthKm" | "buildingCount",
  percentile: "p95" | "p99" | "p99_5",
): number {
  const value = worldGrid.stats[key][percentile];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Worldgrid stats.${key}.${percentile} is required for runtime normalization.`);
  }
  return value;
}

export function canonicalCellElevationM(cell: WorldGridCell): number {
  return effectiveElevationM(cell);
}

export function weatherSampleFromCacheEntry(entry: WeatherCacheEntryArtifact): WeatherSample {
  return {
    cloudCoverPct: entry.cloudCoverPct,
    relativeHumidityPct: entry.relativeHumidityPct,
    windSpeedMps: entry.windSpeedMps,
    precipitationMm: entry.precipitationMm,
    temperatureC: entry.temperatureC,
    pressureHpa: entry.pressureHpa,
  };
}

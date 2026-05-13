import { clamp } from "../scanline/geometry";
import type { WeatherSample } from "../live-data/openmeteo-client";
import type { WorldGridCell } from "../static-data/worldgrid-loader";

export interface EarthLayerParams {
  readonly active: boolean;
  readonly brightness01: number;
}

export function earthLayerParams(cell: WorldGridCell, weather: WeatherSample): EarthLayerParams {
  const cloudTransparency = 1 - weather.cloudCoverPct / 100;
  const forestDamping = 1 - cell.forestRatio * 0.35;
  return {
    active: true,
    brightness01: clamp(cloudTransparency * forestDamping, 0, 1),
  };
}

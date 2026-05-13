import { DEFAULT_WEATHER_SAMPLE, type WeatherSample } from "../live-data/openmeteo-client";
import type { EarthquakeEvent } from "../live-data/quake-store";
import { clamp, normalizeDegrees180 } from "../scanline/geometry";
import type { ScanlineState } from "../scanline/scanline-state";
import { findNearestWorldGridCell, type StatBlock, type WorldGrid, type WorldGridCell } from "../static-data/worldgrid-loader";
import type { TuningKernelSet } from "../static-data/kernels-loader";
import { earthLayerParams, type EarthLayerParams } from "./earth-layer-params";
import { effectiveElevationM, registerMidiForElevation } from "./register";
import { musicLayerParams, type MusicLayerParams } from "./music-layer-params";
import { scanlineNightLightContacts } from "./nightlight-contacts";
import { normalizeNightLight } from "./nightlight";
import { quakesForLatitudeSample } from "./quake-layer-params";
import {
  frequencyHzForTuningRegister,
  tuningWeightsAt,
  type KernelWeightResult,
  type TuningModeAtmosphere,
  type TuningModeSelectionContext,
} from "./tuning";

export const HUMAN_PITCH_REGISTER_OFFSET_SEMITONES = 7;
const SPATIAL_PROBE_MIN_OFFSET_DEG = 1.5;
const SPATIAL_PROBE_MAX_OFFSET_DEG = 4;

export interface NightLightTopology {
  readonly neighborMean01: number;
  readonly neighborMax01: number;
  readonly neighborLitCount01: number;
  readonly isolation01: number;
  readonly continuity01: number;
  readonly edge01: number;
}

export const DEFAULT_NIGHTLIGHT_TOPOLOGY: NightLightTopology = {
  neighborMean01: 0,
  neighborMax01: 0,
  neighborLitCount01: 0,
  isolation01: 0,
  continuity01: 0,
  edge01: 0,
};

export interface CanonicalScanlineSample {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly scanlineWeight: number;
  readonly utcIso: string;
  readonly cellId: string;
  readonly effectiveElevationM: number;
  readonly registerMidi: number;
  readonly nightLightNorm: number;
  readonly surfaceHardness01: number;
  readonly openness01: number;
  readonly waterRatio: number;
  readonly forestRatio: number;
  readonly roadDensityNorm: number;
  readonly buildingDensityNorm: number;
  readonly nightLightTopology: NightLightTopology;
  readonly spatialChange01: number;
  readonly spatialSlope01: number;
  readonly weather: WeatherSample;
  readonly tuning: KernelWeightResult;
  readonly layers: {
    readonly earth: EarthLayerParams;
    readonly music: MusicLayerParams;
    readonly quakes: readonly EarthquakeEvent[];
  };
}

export interface ScanlineSampleInput {
  readonly scanlineState: ScanlineState;
  readonly worldGrid: WorldGrid;
  readonly musicContactWorldGrid?: WorldGrid;
  readonly tuningKernels: TuningKernelSet;
  readonly quakes?: readonly EarthquakeEvent[];
  readonly weatherForCell?: (cellId: string) => WeatherSample | undefined;
  readonly tuningModeAtmosphereForCell?: (cell: WorldGridCell) => TuningModeAtmosphere | undefined;
}

export function createCanonicalScanlineSamples(input: ScanlineSampleInput): CanonicalScanlineSample[] {
  const quakes = input.quakes ?? [];
  const latitudeBandDeg = input.scanlineState.latitudeStepDeg / 2;
  const centerlineCellIds = new Set<string>();
  const musicContactWorldGrid = input.musicContactWorldGrid ?? input.worldGrid;

  const centerlineSamples = input.scanlineState.points.flatMap((point) => {
    if (point.sunriseLongitudeDeg == null) {
      return [];
    }

    const cell = findNearestWorldGridCell(
      input.worldGrid,
      point.latitudeDeg,
      point.sunriseLongitudeDeg,
    );
    const weather = input.weatherForCell?.(cell.id) ?? DEFAULT_WEATHER_SAMPLE;
    const tuningModeAtmosphere = input.tuningModeAtmosphereForCell?.(cell);
    const elevationM = effectiveElevationM(cell);
    const scanlineWeight = 1;
    const nightLightNorm = normalizeNightLight(
      cell.nightLightMean,
      input.worldGrid.stats.nightLight,
    );
    const nightLightTopology = nightLightTopologyForCell(cell, input.worldGrid);
    const registerMidi = registerMidiForElevation(elevationM);
    const textureDrivers = surfaceTextureDriversForCell(cell, input.worldGrid);
    const modeContext = tuningModeContextForCell({
      cell,
      utcIso: input.scanlineState.utc.iso,
      atmosphere: tuningModeAtmosphere,
      nightLightTopology,
      textureDrivers,
    });
    const tuning = tuningWeightsAt(
      point.latitudeDeg,
      point.sunriseLongitudeDeg,
      input.tuningKernels,
      modeContext,
    );
    const musicFrequencyHz = frequencyHzForTuningRegister(
      humanPitchTargetMidi(registerMidi),
      tuning,
      input.tuningKernels,
      undefined,
      modeContext,
    );
    const spatial = spatialChangeForSample({
      cell,
      latitudeDeg: point.latitudeDeg,
      longitudeDeg: point.sunriseLongitudeDeg,
      worldGrid: input.worldGrid,
      weather,
      weatherForCell: input.weatherForCell,
    });
    centerlineCellIds.add(cell.id);

    return [
      {
        latitudeDeg: point.latitudeDeg,
        longitudeDeg: point.sunriseLongitudeDeg,
        scanlineWeight,
        utcIso: input.scanlineState.utc.iso,
        cellId: cell.id,
        effectiveElevationM: elevationM,
        registerMidi,
        nightLightNorm,
        surfaceHardness01: cell.surfaceHardness01,
        openness01: cell.openness01,
        ...textureDrivers,
        nightLightTopology,
        ...spatial,
        weather,
        tuning,
        layers: {
          earth: earthLayerParams(cell, weather),
          music: musicLayerParams(nightLightNorm, scanlineWeight, musicFrequencyHz),
          quakes: quakesForLatitudeSample(
            quakes,
            input.scanlineState.utc.date,
            input.scanlineState,
            point.latitudeDeg,
            latitudeBandDeg,
          ),
        },
      },
    ];
  });

  const earthDroneKeyCenterMidi = earthDroneKeyCenterMidiForSamples(centerlineSamples);
  const keyedCenterlineSamples = centerlineSamples.map((sample) =>
    retuneMusicSample(sample, input.tuningKernels, earthDroneKeyCenterMidi),
  );
  const musicContactSamples = scanlineNightLightContacts({
    scanlineState: input.scanlineState,
    worldGrid: musicContactWorldGrid,
    excludedCellIds: centerlineCellIds,
  }).map((contact) =>
    createMusicContactSample({
      contact,
      utcIso: input.scanlineState.utc.iso,
      tuningKernels: input.tuningKernels,
      worldGrid: musicContactWorldGrid,
      weather: input.weatherForCell?.(contact.cell.id) ?? DEFAULT_WEATHER_SAMPLE,
      tuningModeAtmosphere: input.tuningModeAtmosphereForCell?.(contact.cell),
      earthDroneKeyCenterMidi,
    }),
  );

  return [...keyedCenterlineSamples, ...musicContactSamples];
}

const nightLightTopologyCache = new WeakMap<WorldGrid, ReadonlyMap<string, NightLightTopology>>();

function nightLightTopologyForCell(cell: WorldGridCell, worldGrid: WorldGrid): NightLightTopology {
  const cached = nightLightTopologyCache.get(worldGrid);
  if (cached !== undefined) {
    return cached.get(cell.id) ?? DEFAULT_NIGHTLIGHT_TOPOLOGY;
  }

  const built = buildNightLightTopologyIndex(worldGrid);
  nightLightTopologyCache.set(worldGrid, built);
  return built.get(cell.id) ?? DEFAULT_NIGHTLIGHT_TOPOLOGY;
}

function buildNightLightTopologyIndex(worldGrid: WorldGrid): ReadonlyMap<string, NightLightTopology> {
  const cellIndex = new Map<string, WorldGridCell>();
  const topologyIndex = new Map<string, NightLightTopology>();
  const cellSizeDeg = Math.max(worldGrid.cellSizeDegrees, 0.0001);
  const latCount = Math.max(1, Math.round(180 / cellSizeDeg));
  const lonCount = Math.max(1, Math.round(360 / cellSizeDeg));

  for (const cell of worldGrid.cells) {
    cellIndex.set(gridCellKey(cell, cellSizeDeg, latCount, lonCount), cell);
  }

  for (const cell of worldGrid.cells) {
    const centerNightLight01 = normalizeNightLight(cell.nightLightMean, worldGrid.stats.nightLight);
    const centerGrid = gridCellIndex(cell, cellSizeDeg, latCount, lonCount);
    const neighborNightLights: number[] = [];

    for (let latOffset = -1; latOffset <= 1; latOffset += 1) {
      const latIndex = centerGrid.latIndex + latOffset;
      if (latIndex < 0 || latIndex >= latCount) {
        continue;
      }

      for (let lonOffset = -1; lonOffset <= 1; lonOffset += 1) {
        if (latOffset === 0 && lonOffset === 0) {
          continue;
        }

        const lonIndex = wrapIndex(centerGrid.lonIndex + lonOffset, lonCount);
        const neighbor = cellIndex.get(`${latIndex}:${lonIndex}`);
        neighborNightLights.push(
          neighbor === undefined
            ? 0
            : normalizeNightLight(neighbor.nightLightMean, worldGrid.stats.nightLight),
        );
      }
    }

    const neighborMean01 = clamp(average(neighborNightLights), 0, 1);
    const neighborMax01 = neighborNightLights.length === 0 ? 0 : Math.max(...neighborNightLights);
    const neighborLitCount01 = clamp(
      neighborNightLights.filter((value) => value > 0.02).length / 8,
      0,
      1,
    );
    const localContrast01 = clamp(Math.abs(centerNightLight01 - neighborMean01), 0, 1);
    const centerPresence01 = smoothstep(0.015, 0.16, centerNightLight01);
    const isolation01 = clamp(
      centerPresence01 * (1 - neighborMean01 * 0.86) * (1 - neighborLitCount01 * 0.74),
      0,
      1,
    );
    const continuity01 = clamp(
      centerPresence01 * (neighborMean01 * 0.58 + neighborMax01 * 0.17 + neighborLitCount01 * 0.25),
      0,
      1,
    );
    const edgeBand01 = 1 - clamp(Math.abs(neighborLitCount01 - 0.45) / 0.45, 0, 1);
    const edge01 = clamp(localContrast01 * (0.32 + edgeBand01 * 0.68) * centerPresence01, 0, 1);

    topologyIndex.set(cell.id, {
      neighborMean01,
      neighborMax01,
      neighborLitCount01,
      isolation01,
      continuity01,
      edge01,
    });
  }

  return topologyIndex;
}

function gridCellKey(
  cell: WorldGridCell,
  cellSizeDeg: number,
  latCount: number,
  lonCount: number,
): string {
  const { latIndex, lonIndex } = gridCellIndex(cell, cellSizeDeg, latCount, lonCount);
  return `${latIndex}:${lonIndex}`;
}

function gridCellIndex(
  cell: WorldGridCell,
  cellSizeDeg: number,
  latCount: number,
  lonCount: number,
): { readonly latIndex: number; readonly lonIndex: number } {
  return {
    latIndex: clamp(Math.floor((cell.latCenterDeg + 90) / cellSizeDeg), 0, latCount - 1),
    lonIndex: wrapIndex(Math.floor((normalizeDegrees180(cell.lonCenterDeg) + 180) / cellSizeDeg), lonCount),
  };
}

function wrapIndex(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function createMusicContactSample(input: {
  readonly contact: ReturnType<typeof scanlineNightLightContacts>[number];
  readonly utcIso: string;
  readonly tuningKernels: TuningKernelSet;
  readonly worldGrid: WorldGrid;
  readonly weather: WeatherSample;
  readonly tuningModeAtmosphere: TuningModeAtmosphere | undefined;
  readonly earthDroneKeyCenterMidi?: number;
}): CanonicalScanlineSample {
  const cell = input.contact.cell;
  const elevationM = effectiveElevationM(cell);
  const registerMidi = registerMidiForElevation(elevationM);
  const textureDrivers = surfaceTextureDriversForCell(cell, input.worldGrid);
  const nightLightTopology = nightLightTopologyForCell(cell, input.worldGrid);
  const modeContext = tuningModeContextForCell({
    cell,
    utcIso: input.utcIso,
    atmosphere: input.tuningModeAtmosphere,
    nightLightTopology,
    textureDrivers,
  });
  const tuning = tuningWeightsAt(
    input.contact.latitudeDeg,
    input.contact.longitudeDeg,
    input.tuningKernels,
    modeContext,
  );
  const musicFrequencyHz = frequencyHzForTuningRegister(
    humanPitchTargetMidi(registerMidi),
    tuning,
    input.tuningKernels,
    input.earthDroneKeyCenterMidi,
    modeContext,
  );
  const spatial = {
    spatialChange01: 0,
    spatialSlope01: 0,
  };

  return {
    latitudeDeg: input.contact.latitudeDeg,
    longitudeDeg: input.contact.longitudeDeg,
    scanlineWeight: input.contact.scanlineWeight,
    utcIso: input.utcIso,
    cellId: cell.id,
    effectiveElevationM: elevationM,
    registerMidi,
    nightLightNorm: input.contact.nightLightNorm,
    surfaceHardness01: cell.surfaceHardness01,
    openness01: cell.openness01,
    ...textureDrivers,
    nightLightTopology,
    ...spatial,
    weather: input.weather,
    tuning,
    layers: {
      earth: {
        active: false,
        brightness01: 0,
      },
      music: musicLayerParams(
        input.contact.nightLightNorm,
        input.contact.scanlineWeight,
        musicFrequencyHz,
      ),
      quakes: [],
    },
  };
}

function spatialChangeForSample(input: {
  readonly cell: WorldGridCell;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly worldGrid: WorldGrid;
  readonly weather: WeatherSample;
  readonly weatherForCell: ((cellId: string) => WeatherSample | undefined) | undefined;
}): Pick<CanonicalScanlineSample, "spatialChange01" | "spatialSlope01"> {
  const offsetDeg = clamp(
    input.worldGrid.cellSizeDegrees / 2,
    SPATIAL_PROBE_MIN_OFFSET_DEG,
    SPATIAL_PROBE_MAX_OFFSET_DEG,
  );
  const previousCell = findNearestWorldGridCell(
    input.worldGrid,
    input.latitudeDeg,
    normalizeDegrees180(input.longitudeDeg - offsetDeg),
  );
  const nextCell = findNearestWorldGridCell(
    input.worldGrid,
    input.latitudeDeg,
    normalizeDegrees180(input.longitudeDeg + offsetDeg),
  );
  const previousWeather = input.weatherForCell?.(previousCell.id) ?? DEFAULT_WEATHER_SAMPLE;
  const nextWeather = input.weatherForCell?.(nextCell.id) ?? DEFAULT_WEATHER_SAMPLE;
  const previousChange = cellChangeMagnitude(input.cell, previousCell, input.worldGrid);
  const nextChange = cellChangeMagnitude(input.cell, nextCell, input.worldGrid);
  const weatherChange = average([
    weatherChangeMagnitude(input.weather, previousWeather),
    weatherChangeMagnitude(input.weather, nextWeather),
  ]);
  const previousEnergy = cellTextureEnergy01(previousCell, input.worldGrid) + weatherTextureEnergy01(previousWeather);
  const nextEnergy = cellTextureEnergy01(nextCell, input.worldGrid) + weatherTextureEnergy01(nextWeather);
  const slope = clamp((nextEnergy - previousEnergy) * 0.5, -1, 1);

  return {
    spatialChange01: clamp(average([previousChange, nextChange]) * 0.72 + weatherChange * 0.28, 0, 1),
    spatialSlope01: slope,
  };
}

function cellChangeMagnitude(
  left: WorldGridCell,
  right: WorldGridCell,
  worldGrid: WorldGrid,
): number {
  const registerChange = clamp(
    Math.abs(registerMidiForElevation(effectiveElevationM(left)) - registerMidiForElevation(effectiveElevationM(right))) /
      36,
    0,
    1,
  );
  const builtChange = Math.abs(
    builtTextureForCell(left, worldGrid) - builtTextureForCell(right, worldGrid),
  );

  return clamp(
    registerChange * 0.26 +
      Math.abs(left.waterRatio - right.waterRatio) * 0.2 +
      Math.abs(left.forestRatio - right.forestRatio) * 0.1 +
      Math.abs(left.surfaceHardness01 - right.surfaceHardness01) * 0.16 +
      Math.abs(left.openness01 - right.openness01) * 0.1 +
      builtChange * 0.18,
    0,
    1,
  );
}

function weatherChangeMagnitude(left: WeatherSample, right: WeatherSample): number {
  return clamp(
    Math.abs(left.cloudCoverPct - right.cloudCoverPct) / 100 * 0.24 +
      Math.abs(left.relativeHumidityPct - right.relativeHumidityPct) / 100 * 0.18 +
      Math.abs(left.windSpeedMps - right.windSpeedMps) / 18 * 0.24 +
      Math.abs(left.precipitationMm - right.precipitationMm) / 8 * 0.22 +
      Math.abs(left.temperatureC - right.temperatureC) / 45 * 0.12,
    0,
    1,
  );
}

function cellTextureEnergy01(cell: WorldGridCell, worldGrid: WorldGrid): number {
  return clamp(
    registerMidiForElevation(effectiveElevationM(cell)) / 96 * 0.18 +
      cell.surfaceHardness01 * 0.24 +
      cell.openness01 * 0.18 +
      builtTextureForCell(cell, worldGrid) * 0.22 +
      (1 - cell.waterRatio) * 0.1 +
      (1 - cell.forestRatio) * 0.08,
    0,
    1,
  );
}

function weatherTextureEnergy01(weather: WeatherSample): number {
  return clamp(
    weather.windSpeedMps / 18 * 0.46 +
      weather.precipitationMm / 8 * 0.26 +
      (1 - weather.relativeHumidityPct / 100) * 0.14 +
      (1 - weather.cloudCoverPct / 100) * 0.14,
    0,
    1,
  );
}

function builtTextureForCell(cell: WorldGridCell, worldGrid: WorldGrid): number {
  return clamp(
    normalizeByStat(cell.roadLengthKm, worldGrid.stats.roadLengthKm) * 0.45 +
      normalizeByStat(cell.buildingCount, worldGrid.stats.buildingCount) * 0.55,
    0,
    1,
  );
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function earthDroneKeyCenterMidiForSamples(
  samples: readonly CanonicalScanlineSample[],
): number | undefined {
  const totalWeight = samples.reduce((sum, sample) => sum + sample.scanlineWeight, 0);
  if (totalWeight <= 0) {
    return undefined;
  }

  const earthRegisterMidi =
    samples.reduce((sum, sample) => sum + sample.registerMidi * sample.scanlineWeight, 0) /
    totalWeight;
  return earthRegisterMidi - 12;
}

function retuneMusicSample(
  sample: CanonicalScanlineSample,
  tuningKernels: TuningKernelSet,
  earthDroneKeyCenterMidi: number | undefined,
): CanonicalScanlineSample {
  if (earthDroneKeyCenterMidi == null) {
    return sample;
  }

  const musicFrequencyHz = frequencyHzForTuningRegister(
    humanPitchTargetMidi(sample.registerMidi),
    sample.tuning,
    tuningKernels,
    earthDroneKeyCenterMidi,
  );

  return {
    ...sample,
    layers: {
      ...sample.layers,
      music: musicLayerParams(sample.nightLightNorm, sample.scanlineWeight, musicFrequencyHz),
    },
  };
}

function humanPitchTargetMidi(registerMidi: number): number {
  return registerMidi + HUMAN_PITCH_REGISTER_OFFSET_SEMITONES;
}

function tuningModeContextForCell(input: {
  readonly cell: WorldGridCell;
  readonly utcIso: string;
  readonly atmosphere: TuningModeAtmosphere | undefined;
  readonly nightLightTopology: NightLightTopology;
  readonly textureDrivers: Pick<
    CanonicalScanlineSample,
    "waterRatio" | "forestRatio" | "roadDensityNorm" | "buildingDensityNorm"
  >;
}): TuningModeSelectionContext {
  return {
    cellId: input.cell.id,
    utcIso: input.utcIso,
    nightLightTopology: input.nightLightTopology,
    surfaceHardness01: input.cell.surfaceHardness01,
    openness01: input.cell.openness01,
    waterRatio: input.textureDrivers.waterRatio,
    forestRatio: input.textureDrivers.forestRatio,
    roadDensityNorm: input.textureDrivers.roadDensityNorm,
    buildingDensityNorm: input.textureDrivers.buildingDensityNorm,
    atmosphericWetnessNorm: input.atmosphere?.atmosphericWetnessNorm,
    cloudNorm: input.atmosphere?.cloudNorm,
    precipitationNorm: input.atmosphere?.precipitationNorm,
  };
}

function surfaceTextureDriversForCell(
  cell: WorldGridCell,
  worldGrid: WorldGrid,
): Pick<
  CanonicalScanlineSample,
  "waterRatio" | "forestRatio" | "roadDensityNorm" | "buildingDensityNorm"
> {
  return {
    waterRatio: clamp(cell.waterRatio, 0, 1),
    forestRatio: clamp(cell.forestRatio, 0, 1),
    roadDensityNorm: normalizeByStat(cell.roadLengthKm, worldGrid.stats.roadLengthKm),
    buildingDensityNorm: normalizeByStat(cell.buildingCount, worldGrid.stats.buildingCount),
  };
}

function normalizeByStat(value: number, stat: StatBlock): number {
  const denominator = stat.p99 ?? stat.p95 ?? stat.max;
  if (denominator <= 0) {
    return 0;
  }

  return clamp(value / denominator, 0, 1);
}

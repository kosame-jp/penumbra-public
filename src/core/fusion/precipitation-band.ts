import { sunriseLongitudeAtLatitude } from "../astronomy/terminator";
import { gaussianWeight } from "../scanline/gaussian";
import { clamp, normalizeDegrees180 } from "../scanline/geometry";
import type { ScanlineState } from "../scanline/scanline-state";
import {
  precipitation01At,
  type CloudAtlasSequence,
  type LoadedCloudAtlasFrame,
} from "../static-data/cloud-atlas-loader";

export interface PrecipitationBandSample {
  readonly id: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly precipitation01: number;
  readonly scanlineWeight: number;
}

export interface PrecipitationBandField {
  readonly active: boolean;
  readonly source: "cloud-atlas-precipitation";
  readonly activity01: number;
  readonly coverage01: number;
  readonly intensity01: number;
  readonly maxPrecipitation01: number;
  readonly sampleCount: number;
  readonly rainySampleCount: number;
  readonly frameMix01: number;
  readonly leftValidAtUtc: string;
  readonly rightValidAtUtc: string;
  readonly samples: readonly PrecipitationBandSample[];
}

export interface PrecipitationBandOptions {
  readonly latitudeStepDeg?: number;
  readonly longitudeStepDeg?: number;
  readonly minVisualPrecipitation01?: number;
}

const DEFAULT_SIGNIFICANT_PRECIPITATION_START01 = 0.68;
const DEFAULT_SIGNIFICANT_PRECIPITATION_FULL01 = 0.94;
const DEFAULT_VISUAL_PRECIPITATION_MIN01 = 0.7;

export function precipitationBandFieldFromCloudAtlasSequence(input: {
  readonly sequence: CloudAtlasSequence | undefined;
  readonly scanlineState: ScanlineState;
  readonly options?: PrecipitationBandOptions;
}): PrecipitationBandField | undefined {
  const sequence = input.sequence;
  if (!sequence || sequence.frames.length === 0) {
    return undefined;
  }

  const selection = selectCloudAtlasFrames(sequence.frames, input.scanlineState.utc.epochMs);
  if (!selection) {
    return undefined;
  }

  const leftAtlas = selection.left.atlas;
  const rightAtlas = selection.right.atlas;
  if (!leftAtlas.precipitationValues || !rightAtlas.precipitationValues) {
    return undefined;
  }

  const resolutionDeg = Math.max(0.25, leftAtlas.resolutionDeg || 1);
  const latitudeStepDeg = input.options?.latitudeStepDeg ?? Math.max(1, resolutionDeg);
  const longitudeStepDeg = input.options?.longitudeStepDeg ?? Math.max(1, resolutionDeg);
  const minVisualPrecipitation01 =
    input.options?.minVisualPrecipitation01 ?? DEFAULT_VISUAL_PRECIPITATION_MIN01;
  const samples: PrecipitationBandSample[] = [];
  let weightedPrecipitation = 0;
  let weightedCoverage = 0;
  let weightedIntensity = 0;
  let totalIntensityWeight = 0;
  let totalWeight = 0;
  let maxPrecipitation01 = 0;
  let sampleCount = 0;

  for (let latitudeDeg = -90; latitudeDeg <= 90.0001; latitudeDeg += latitudeStepDeg) {
    const point = sunriseLongitudeAtLatitude(latitudeDeg, input.scanlineState.solar);
    if (point.sunriseLongitudeDeg == null) {
      continue;
    }

    for (
      let offsetDeg = -input.scanlineState.activeReachDeg;
      offsetDeg <= input.scanlineState.activeReachDeg + 0.0001;
      offsetDeg += longitudeStepDeg
    ) {
      const scanlineWeight = gaussianWeight(offsetDeg, input.scanlineState.sigmaDeg);
      const longitudeDeg = normalizeDegrees180(point.sunriseLongitudeDeg + offsetDeg);
      const precipitation01 = clamp(
        mix(
          precipitation01At(leftAtlas, latitudeDeg, longitudeDeg),
          precipitation01At(rightAtlas, latitudeDeg, longitudeDeg),
          selection.mix01,
        ),
        0,
        1,
      );

      sampleCount += 1;
      totalWeight += scanlineWeight;
      maxPrecipitation01 = Math.max(maxPrecipitation01, precipitation01);
      const significantPresence01 = smoothstep(
        DEFAULT_SIGNIFICANT_PRECIPITATION_START01,
        DEFAULT_SIGNIFICANT_PRECIPITATION_FULL01,
        precipitation01,
      );
      weightedCoverage += significantPresence01 * scanlineWeight;
      weightedPrecipitation += precipitation01 * significantPresence01 * scanlineWeight;
      weightedIntensity += precipitation01 * significantPresence01 * scanlineWeight;
      totalIntensityWeight += significantPresence01 * scanlineWeight;

      if (precipitation01 >= minVisualPrecipitation01) {
        samples.push({
          id: `precip:${roundCoord(latitudeDeg)}:${roundCoord(longitudeDeg)}`,
          latitudeDeg,
          longitudeDeg,
          precipitation01,
          scanlineWeight,
        });
      }
    }
  }

  const activity01 = totalWeight > 0 ? clamp(weightedPrecipitation / totalWeight, 0, 1) : 0;
  const coverage01 = totalWeight > 0 ? clamp(weightedCoverage / totalWeight, 0, 1) : 0;
  const intensity01 = totalIntensityWeight > 0
    ? clamp(weightedIntensity / totalIntensityWeight, 0, 1)
    : 0;

  return {
    active: activity01 > 0 || samples.length > 0,
    source: "cloud-atlas-precipitation",
    activity01,
    coverage01,
    intensity01,
    maxPrecipitation01,
    sampleCount,
    rainySampleCount: samples.length,
    frameMix01: selection.mix01,
    leftValidAtUtc: leftAtlas.validAtUtc,
    rightValidAtUtc: rightAtlas.validAtUtc,
    samples,
  };
}

function selectCloudAtlasFrames(
  frames: readonly LoadedCloudAtlasFrame[],
  utcMs: number,
): { readonly left: LoadedCloudAtlasFrame; readonly right: LoadedCloudAtlasFrame; readonly mix01: number } | undefined {
  if (frames.length === 0) {
    return undefined;
  }

  if (frames.length === 1 || utcMs <= frames[0].validAtMs) {
    const frame = frames[0];
    return { left: frame, right: frame, mix01: 0 };
  }

  for (let index = 0; index < frames.length - 1; index += 1) {
    const left = frames[index];
    const right = frames[index + 1];
    if (utcMs >= left.validAtMs && utcMs <= right.validAtMs) {
      const durationMs = Math.max(1, right.validAtMs - left.validAtMs);
      return { left, right, mix01: clamp((utcMs - left.validAtMs) / durationMs, 0, 1) };
    }
  }

  const frame = frames[frames.length - 1];
  return { left: frame, right: frame, mix01: 0 };
}

function mix(left: number, right: number, amount01: number): number {
  return left + (right - left) * clamp(amount01, 0, 1);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function roundCoord(value: number): string {
  return value.toFixed(3);
}

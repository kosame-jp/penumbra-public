import { clamp } from "../scanline/geometry";
import {
  cloudCover01At,
  opticalDensity01At,
  precipitation01At,
  type CloudAtlasSequence,
  type LoadedCloudAtlasFrame,
} from "../static-data/cloud-atlas-loader";
import type { TuningModeAtmosphere } from "./tuning";

const MODE_ATMOSPHERE_QUANTUM01 = 0.05;

export function tuningModeAtmosphereFromCloudAtlasSequence(input: {
  readonly sequence: CloudAtlasSequence | undefined;
  readonly utcMs: number;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
}): TuningModeAtmosphere | undefined {
  const selection = selectCloudAtlasFrames(input.sequence?.frames ?? [], input.utcMs);
  if (!selection) {
    return undefined;
  }

  const cloudNorm = quantize01(
    mix(
      cloudCover01At(selection.left.atlas, input.latitudeDeg, input.longitudeDeg),
      cloudCover01At(selection.right.atlas, input.latitudeDeg, input.longitudeDeg),
      selection.mix01,
    ),
  );
  const opticalDensityNorm = quantize01(
    mix(
      opticalDensity01At(selection.left.atlas, input.latitudeDeg, input.longitudeDeg),
      opticalDensity01At(selection.right.atlas, input.latitudeDeg, input.longitudeDeg),
      selection.mix01,
    ),
  );
  const precipitationNorm = quantize01(
    mix(
      precipitation01At(selection.left.atlas, input.latitudeDeg, input.longitudeDeg),
      precipitation01At(selection.right.atlas, input.latitudeDeg, input.longitudeDeg),
      selection.mix01,
    ),
  );

  return {
    source: "gfs-forecast-artifact",
    cloudNorm,
    atmosphericWetnessNorm: quantize01(opticalDensityNorm * 0.72 + cloudNorm * 0.28),
    precipitationNorm,
  };
}

function selectCloudAtlasFrames(
  frames: readonly LoadedCloudAtlasFrame[],
  utcMs: number,
):
  | {
      readonly left: LoadedCloudAtlasFrame;
      readonly right: LoadedCloudAtlasFrame;
      readonly mix01: number;
    }
  | undefined {
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

function quantize01(value: number): number {
  return Number(
    clamp(
      Math.round(clamp(value, 0, 1) / MODE_ATMOSPHERE_QUANTUM01) *
        MODE_ATMOSPHERE_QUANTUM01,
      0,
      1,
    ).toFixed(6),
  );
}

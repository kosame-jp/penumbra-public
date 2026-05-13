import { DEFAULT_WEATHER_SAMPLE, type WeatherSample } from "../live-data/openmeteo-client";
import { clamp } from "../scanline/geometry";
import {
  cloudCover01At,
  opticalDensity01At,
  precipitation01At,
  type CloudAtlasSequence,
  type LoadedCloudAtlasFrame,
} from "../static-data/cloud-atlas-loader";

const FORECAST_HUMIDITY_MIN_PCT = 42;
const FORECAST_HUMIDITY_RANGE_PCT = 54;
const FORECAST_PRECIPITATION_FULL_MM = 8;
const FORECAST_WIND_MIN_MPS = 1.1;
const FORECAST_WIND_RANGE_MPS = 7.4;
const FORECAST_GRADIENT_PROBE_DEG = 1;

export function weatherSampleFromCloudAtlasSequence(input: {
  readonly sequence: CloudAtlasSequence | undefined;
  readonly utcMs: number;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
}): WeatherSample | undefined {
  const selection = selectCloudAtlasFrames(input.sequence?.frames ?? [], input.utcMs);
  if (!selection) {
    return undefined;
  }

  const cloud01 = mix(
    cloudCover01At(selection.left.atlas, input.latitudeDeg, input.longitudeDeg),
    cloudCover01At(selection.right.atlas, input.latitudeDeg, input.longitudeDeg),
    selection.mix01,
  );
  const opticalDensity01 = mix(
    opticalDensity01At(selection.left.atlas, input.latitudeDeg, input.longitudeDeg),
    opticalDensity01At(selection.right.atlas, input.latitudeDeg, input.longitudeDeg),
    selection.mix01,
  );
  const precipitation01 = mix(
    precipitation01At(selection.left.atlas, input.latitudeDeg, input.longitudeDeg),
    precipitation01At(selection.right.atlas, input.latitudeDeg, input.longitudeDeg),
    selection.mix01,
  );
  const wetness01 = clamp(opticalDensity01 * 0.72 + cloud01 * 0.28, 0, 1);
  const windProxy01 = forecastWindProxy01({
    selection,
    latitudeDeg: input.latitudeDeg,
    longitudeDeg: input.longitudeDeg,
    cloud01,
    opticalDensity01,
    precipitation01,
  });

  return {
    cloudCoverPct: round1(cloud01 * 100),
    relativeHumidityPct: round1(
      FORECAST_HUMIDITY_MIN_PCT + wetness01 * FORECAST_HUMIDITY_RANGE_PCT,
    ),
    windSpeedMps: round3(FORECAST_WIND_MIN_MPS + windProxy01 * FORECAST_WIND_RANGE_MPS),
    precipitationMm: round3(precipitation01 * FORECAST_PRECIPITATION_FULL_MM),
    temperatureC: DEFAULT_WEATHER_SAMPLE.temperatureC,
    pressureHpa: DEFAULT_WEATHER_SAMPLE.pressureHpa,
  };
}

function forecastWindProxy01(input: {
  readonly selection: {
    readonly left: LoadedCloudAtlasFrame;
    readonly right: LoadedCloudAtlasFrame;
    readonly mix01: number;
  };
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly cloud01: number;
  readonly opticalDensity01: number;
  readonly precipitation01: number;
}): number {
  const cloudGradient01 = forecastCloudGradient01(input);
  return clamp(
    0.26 +
      cloudGradient01 * 1.45 +
      input.precipitation01 * 0.22 +
      (1 - input.cloud01) * 0.1 +
      (1 - input.opticalDensity01) * 0.08,
    0,
    1,
  );
}

function forecastCloudGradient01(input: {
  readonly selection: {
    readonly left: LoadedCloudAtlasFrame;
    readonly right: LoadedCloudAtlasFrame;
    readonly mix01: number;
  };
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly cloud01: number;
}): number {
  const north = cloud01AtSelection(
    input.selection,
    input.latitudeDeg + FORECAST_GRADIENT_PROBE_DEG,
    input.longitudeDeg,
  );
  const south = cloud01AtSelection(
    input.selection,
    input.latitudeDeg - FORECAST_GRADIENT_PROBE_DEG,
    input.longitudeDeg,
  );
  const east = cloud01AtSelection(
    input.selection,
    input.latitudeDeg,
    input.longitudeDeg + FORECAST_GRADIENT_PROBE_DEG,
  );
  const west = cloud01AtSelection(
    input.selection,
    input.latitudeDeg,
    input.longitudeDeg - FORECAST_GRADIENT_PROBE_DEG,
  );
  return clamp(
    (Math.abs(north - south) + Math.abs(east - west)) * 0.5 +
      (Math.abs(north - input.cloud01) +
        Math.abs(south - input.cloud01) +
        Math.abs(east - input.cloud01) +
        Math.abs(west - input.cloud01)) *
        0.125,
    0,
    1,
  );
}

function cloud01AtSelection(
  selection: {
    readonly left: LoadedCloudAtlasFrame;
    readonly right: LoadedCloudAtlasFrame;
    readonly mix01: number;
  },
  latitudeDeg: number,
  longitudeDeg: number,
): number {
  return mix(
    cloudCover01At(selection.left.atlas, latitudeDeg, longitudeDeg),
    cloudCover01At(selection.right.atlas, latitudeDeg, longitudeDeg),
    selection.mix01,
  );
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

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

import type { AudioFrameParams } from "./audio-params";

export interface EarthDronePartialConfig {
  readonly integerRatio: number;
  readonly maxDeviation: number;
  readonly baseGain01: number;
  readonly drawbar: {
    readonly mass: number;
    readonly body: number;
    readonly roughness: number;
    readonly air: number;
  };
  readonly dampingSensitivity: number;
  readonly motionRateScale: number;
  readonly responseSeconds: number;
}

export interface EarthAirTurbulence {
  readonly noiseColorOffset: number;
  readonly lowpassScale: number;
  readonly surfaceTextureFilterScale: number;
  readonly surfaceTextureQScale: number;
  readonly body: number;
  readonly focus: number;
}

export interface EarthDroneCompanionParams {
  readonly frequencyHz: number;
  readonly detuneCents: number;
  readonly amount01: number;
  readonly relativeGain01: number;
  readonly responseSeconds: number;
}

export const EARTH_DRONE_SECOND_PARTIAL_GAIN_SCALE = 0.5;
export const EARTH_DRONE_AUDIBLE_HARMONIC_GAIN_SCALE = 0;
export const EARTH_DRONE_COMPANION_MAX_DETUNE_CENTS = 82;
export const EARTH_DRONE_COMPANION_RELATIVE_GAIN = 0.2;

export const EARTH_DRONE_PARTIALS: readonly EarthDronePartialConfig[] = [
  {
    integerRatio: 1,
    maxDeviation: 0,
    baseGain01: 0.62,
    drawbar: { mass: 1, body: 0.1, roughness: 0, air: 0 },
    dampingSensitivity: 0.12,
    motionRateScale: 0,
    responseSeconds: 0.9,
  },
  {
    integerRatio: 2,
    maxDeviation: 0.24,
    baseGain01: 0.34 * EARTH_DRONE_SECOND_PARTIAL_GAIN_SCALE,
    drawbar: { mass: 0.48, body: 0.5, roughness: 0.16, air: 0 },
    dampingSensitivity: 0.18,
    motionRateScale: 0.18,
    responseSeconds: 0.7,
  },
  {
    integerRatio: 3,
    maxDeviation: 0.58,
    baseGain01: 0.26,
    drawbar: { mass: 0.18, body: 0.72, roughness: 0.28, air: 0.06 },
    dampingSensitivity: 0.28,
    motionRateScale: 0.36,
    responseSeconds: 0.52,
  },
  {
    integerRatio: 4,
    maxDeviation: 1.05,
    baseGain01: 0.21,
    drawbar: { mass: 0.04, body: 0.48, roughness: 0.68, air: 0.16 },
    dampingSensitivity: 0.38,
    motionRateScale: 0.56,
    responseSeconds: 0.38,
  },
  {
    integerRatio: 5,
    maxDeviation: 1.65,
    baseGain01: 0.17,
    drawbar: { mass: 0, body: 0.26, roughness: 0.78, air: 0.38 },
    dampingSensitivity: 0.48,
    motionRateScale: 0.78,
    responseSeconds: 0.26,
  },
  {
    integerRatio: 6,
    maxDeviation: 2.35,
    baseGain01: 0.13,
    drawbar: { mass: 0, body: 0.12, roughness: 0.58, air: 0.82 },
    dampingSensitivity: 0.58,
    motionRateScale: 0.98,
    responseSeconds: 0.18,
  },
  {
    integerRatio: 8,
    maxDeviation: 3.45,
    baseGain01: 0.1,
    drawbar: { mass: 0, body: 0.04, roughness: 0.36, air: 1 },
    dampingSensitivity: 0.66,
    motionRateScale: 1.18,
    responseSeconds: 0.14,
  },
  {
    integerRatio: 10,
    maxDeviation: 4.6,
    baseGain01: 0.075,
    drawbar: { mass: 0, body: 0.02, roughness: 0.28, air: 1 },
    dampingSensitivity: 0.72,
    motionRateScale: 1.32,
    responseSeconds: 0.12,
  },
  {
    integerRatio: 12,
    maxDeviation: 5.9,
    baseGain01: 0.058,
    drawbar: { mass: 0, body: 0, roughness: 0.2, air: 1 },
    dampingSensitivity: 0.76,
    motionRateScale: 1.48,
    responseSeconds: 0.1,
  },
  {
    integerRatio: 15,
    maxDeviation: 7.8,
    baseGain01: 0.043,
    drawbar: { mass: 0, body: 0, roughness: 0.14, air: 1 },
    dampingSensitivity: 0.8,
    motionRateScale: 1.66,
    responseSeconds: 0.085,
  },
  {
    integerRatio: 18,
    maxDeviation: 10.4,
    baseGain01: 0.032,
    drawbar: { mass: 0, body: 0, roughness: 0.08, air: 1 },
    dampingSensitivity: 0.84,
    motionRateScale: 1.86,
    responseSeconds: 0.07,
  },
  {
    integerRatio: 24,
    maxDeviation: 14.8,
    baseGain01: 0.024,
    drawbar: { mass: 0, body: 0, roughness: 0.04, air: 1 },
    dampingSensitivity: 0.9,
    motionRateScale: 2.1,
    responseSeconds: 0.055,
  },
];

export const EARTH_DRONE_GAIN_SUM_CAP = 1.32;

export function deriveEarthAirTurbulence(frame: AudioFrameParams): EarthAirTurbulence {
  const spatialMotion = clampNumber(
    frame.earth.scanlineSpatialChange01 * 0.72 + frame.earth.scanlineSpatialVariance01 * 0.48,
    0,
    1,
  );
  const depth = clampNumber(frame.earth.airTurbulenceDepth01 * 0.52 + spatialMotion * 0.7, 0, 1);
  if (depth <= 0.001) {
    return {
      noiseColorOffset: 0,
      lowpassScale: 0,
      surfaceTextureFilterScale: 0,
      surfaceTextureQScale: 0,
      body: 0,
      focus: 0,
    };
  }

  const body = clampSigned(
    frame.earth.scanlineSpatialSlope01 * 0.78 +
      (frame.earth.scanlineSpatialChange01 - frame.earth.scanlineSpatialVariance01) * 0.22 +
      (frame.earth.wind01 - frame.earth.humidity01 * 0.5) * frame.earth.airTurbulenceDepth01 * 0.18,
  );
  const focus = clampSigned(
    spatialMotion * 1.2 +
      frame.earth.surfaceRoughness01 * 0.35 -
      frame.earth.cloudCover01 * 0.28 -
      frame.earth.humidity01 * 0.18 -
      frame.earth.waterRatio01 * 0.08 -
      0.45,
  );

  return {
    noiseColorOffset: body * depth * 0.16,
    lowpassScale: body * depth * 0.42,
    surfaceTextureFilterScale: (body * 0.68 + focus * 0.32) * depth * 0.62,
    surfaceTextureQScale: (focus * 0.62 + Math.abs(body) * 0.38) * depth * 0.95,
    body,
    focus,
  };
}

export function earthDroneRootHz(frame: AudioFrameParams): number {
  return clampNumber(frame.earth.registerHz * 0.5, 18, 1400);
}

export function earthDroneCompanionParams(
  frame: AudioFrameParams,
  airTurbulence: EarthAirTurbulence = deriveEarthAirTurbulence(frame),
): EarthDroneCompanionParams {
  const rootHz = earthDroneRootHz(frame);
  const destabilizing = clampNumber(
    frame.earth.wind01 * 0.26 +
      frame.earth.openness01 * 0.16 +
      frame.earth.surfaceHardness01 * 0.12 +
      frame.earth.builtTexture01 * 0.16 +
      frame.earth.surfaceRoughness01 * 0.18 +
      frame.earth.scanlineSpatialChange01 * 0.3 +
      frame.earth.scanlineSpatialVariance01 * 0.22 +
      frame.earth.precipitation01 * 0.08 +
      Math.max(0, airTurbulence.focus) * 0.1,
    0,
    1,
  );
  const stabilizing = clampNumber(
    frame.earth.humidity01 * 0.22 +
      frame.earth.cloudCover01 * 0.22 +
      frame.earth.forestRatio01 * 0.2 +
      frame.earth.waterRatio01 * 0.14 +
      frame.earth.droneDamping01 * 0.18,
    0,
    1,
  );
  const amount01 = frame.earth.active
    ? clampNumber((0.055 + destabilizing * 0.945) * (1 - stabilizing * 0.66), 0, 1)
    : 0;
  const directionDriver =
    frame.earth.scanlineSpatialSlope01 +
    (frame.earth.wind01 - frame.earth.humidity01) * 0.08 +
    (frame.earth.openness01 - frame.earth.waterRatio01) * 0.04;
  const direction = directionDriver < -0.025 ? -1 : 1;
  const detuneCents =
    direction * EARTH_DRONE_COMPANION_MAX_DETUNE_CENTS * Math.pow(amount01, 1.38);
  const frequencyHz = clampNumber(rootHz * 2 ** (detuneCents / 1200), 16, 1600);
  const relativeGain01 = frame.earth.active
    ? EARTH_DRONE_COMPANION_RELATIVE_GAIN * (0.38 + amount01 * 0.62)
    : 0;

  return {
    frequencyHz,
    detuneCents,
    amount01,
    relativeGain01,
    responseSeconds: 1.05,
  };
}

export function earthDronePartialFrequencyHz(
  config: EarthDronePartialConfig,
  frame: AudioFrameParams,
  airTurbulence: EarthAirTurbulence = deriveEarthAirTurbulence(frame),
): number {
  return clampNumber(
    earthDroneRootHz(frame) * earthDronePartialRatio(config, frame, airTurbulence),
    20,
    12000,
  );
}

export function earthDronePartialRatio(
  config: EarthDronePartialConfig,
  frame: AudioFrameParams,
  airTurbulence: EarthAirTurbulence,
): number {
  if (config.maxDeviation <= 0) {
    return config.integerRatio;
  }

  const spatialGate = clampNumber(
    0.22 +
      frame.earth.scanlineSpatialChange01 * 0.48 +
      frame.earth.scanlineSpatialVariance01 * 0.38 +
      Math.max(0, airTurbulence.focus) * 0.16,
    0.12,
    1,
  );
  const partialLift = 0.82 + config.motionRateScale * 0.18;
  const dispersion = clampNumber(frame.earth.droneDispersion01 * spatialGate * partialLift, 0, 1);

  return config.integerRatio + config.maxDeviation * dispersion;
}

export function earthDronePartialGainRaw(
  config: EarthDronePartialConfig,
  frame: AudioFrameParams,
  airTurbulence: EarthAirTurbulence,
): number {
  const audibleScale = config.integerRatio === 1 ? 1 : EARTH_DRONE_AUDIBLE_HARMONIC_GAIN_SCALE;
  if (audibleScale <= 0) {
    return 0;
  }

  const tilt = frame.earth.droneSpectralTilt01;
  const damping = frame.earth.droneDamping01;
  const dispersion = frame.earth.droneDispersion01;
  const turbulence = frame.earth.airTurbulenceDepth01;
  const mass = clampNumber(0.92 + (1 - damping) * 0.08, 0, 1);
  const body = clampNumber(0.18 + tilt * 0.82 - damping * 0.24, 0, 1);
  const roughness = clampNumber(
    dispersion * 0.72 + frame.earth.surfaceRoughness01 * 0.28 + Math.abs(airTurbulence.body) * turbulence * 0.18,
    0,
    1,
  );
  const air = clampNumber(
    tilt * 0.28 + turbulence * 0.5 + Math.max(0, airTurbulence.focus) * turbulence * 0.26 - damping * 0.28,
    0,
    1,
  );
  const weightSum =
    config.drawbar.mass + config.drawbar.body + config.drawbar.roughness + config.drawbar.air || 1;
  const drawbarDriver =
    (mass * config.drawbar.mass +
      body * config.drawbar.body +
      roughness * config.drawbar.roughness +
      air * config.drawbar.air) /
    weightSum;
  const motionLift = 1 + (dispersion * 0.18 + Math.max(0, airTurbulence.body) * turbulence * 0.12);
  const dampingScale = 1 - damping * config.dampingSensitivity;

  return clampNumber(
    config.baseGain01 * audibleScale * (0.28 + drawbarDriver * 0.92) * motionLift * dampingScale,
    0,
    1,
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampSigned(value: number): number {
  return clampNumber(value, -1, 1);
}

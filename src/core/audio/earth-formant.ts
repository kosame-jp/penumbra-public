import type { AudioFrameParams } from "./audio-params";
import {
  EARTH_DRONE_PARTIALS,
  earthDronePartialFrequencyHz,
  type EarthAirTurbulence,
} from "./earth-drone-spectrum";

export type EarthFormantBandId = "body" | "mid" | "air";

export interface EarthFormantBandParams {
  readonly id: EarthFormantBandId;
  readonly frequencyHz: number;
  readonly q: number;
  readonly gain01: number;
}

export interface EarthFormantParams {
  readonly active: boolean;
  readonly amount01: number;
  readonly droneSendGain: number;
  readonly windSendGain: number;
  readonly noiseSendGain: number;
  readonly outputGain: number;
  readonly bands: readonly EarthFormantBandParams[];
}

export interface EarthFormantDerivationOptions {
  readonly muted?: boolean;
}

const EARTH_FORMANT_DRONE_SEND_GAIN = 1;
const EARTH_FORMANT_WIND_SEND_GAIN = 28;
const EARTH_FORMANT_NOISE_SEND_GAIN = 0;
const EARTH_FORMANT_OUTPUT_GAIN = 0.72;

export function deriveEarthFormantParams(
  frame: AudioFrameParams,
  airTurbulence: EarthAirTurbulence,
  options: EarthFormantDerivationOptions = {},
): EarthFormantParams {
  const wetness01 = clampNumber(
    frame.earth.humidity01 * 0.28 +
      frame.earth.cloudCover01 * 0.22 +
      frame.earth.waterRatio01 * 0.2 +
      frame.earth.forestRatio01 * 0.18 +
      frame.earth.precipitation01 * 0.12,
    0,
    1,
  );
  const exposure01 = clampNumber(
    frame.earth.openness01 * 0.32 +
      frame.earth.wind01 * 0.26 +
      frame.earth.surfaceHardness01 * 0.2 +
      frame.earth.surfaceRoughness01 * 0.14 +
      frame.earth.builtTexture01 * 0.08,
    0,
    1,
  );
  const spatialMotion01 = clampNumber(
    frame.earth.scanlineSpatialChange01 * 0.64 + frame.earth.scanlineSpatialVariance01 * 0.46,
    0,
    1,
  );
  const humanPresence01 = clampNumber(
    Math.sqrt(frame.music.gain01) * 0.46 +
      clampNumber(frame.music.candidates.length / 180, 0, 1) * 0.3 +
      clampNumber(frame.music.voices.length / 36, 0, 1) * 0.12 +
      frame.earth.builtTexture01 * 0.12,
    0,
    1,
  );
  const amount01 = frame.earth.active && !options.muted
    ? clampNumber(
        humanPresence01 * (0.34 + exposure01 * 0.3 + spatialMotion01 * 0.18) * (1 - wetness01 * 0.14),
        0,
        1,
      )
    : 0;

  const bodyTargetHz = clampNumber(
    320 + exposure01 * 280 - wetness01 * 95 + humanPresence01 * 85 + spatialMotion01 * 70,
    190,
    820,
  );
  const midTargetHz = clampNumber(
    940 + exposure01 * 760 - wetness01 * 280 + frame.earth.builtTexture01 * 260 + spatialMotion01 * 180,
    620,
    2600,
  );
  const airTargetHz = clampNumber(
    2300 + exposure01 * 1780 - wetness01 * 520 + frame.earth.wind01 * 620 + spatialMotion01 * 420,
    1400,
    6200,
  );

  const bodyQ = clampNumber(0.58 + exposure01 * 0.95 + frame.earth.surfaceHardness01 * 0.34 - wetness01 * 0.38, 0.45, 2.2);
  const midQ = clampNumber(0.82 + exposure01 * 1.45 + frame.earth.surfaceHardness01 * 0.58 - wetness01 * 0.54, 0.56, 3.7);
  const airQ = clampNumber(1.05 + exposure01 * 2 + frame.earth.wind01 * 0.72 - wetness01 * 0.72, 0.7, 4.8);

  const bodyGain = amount01 * (0.16 + wetness01 * 0.08 + frame.earth.waterRatio01 * 0.06);
  const midGain = amount01 * (0.15 + humanPresence01 * 0.12 + frame.earth.builtTexture01 * 0.05);
  const airGain = amount01 * (0.12 + frame.earth.wind01 * 0.1 + frame.earth.openness01 * 0.07) * (1 - wetness01 * 0.24);

  return {
    active: amount01 > 0.001,
    amount01,
    droneSendGain: options.muted
      ? 0
      : EARTH_FORMANT_DRONE_SEND_GAIN,
    windSendGain: options.muted
      ? 0
      : EARTH_FORMANT_WIND_SEND_GAIN,
    noiseSendGain: options.muted
      ? 0
      : EARTH_FORMANT_NOISE_SEND_GAIN,
    outputGain: options.muted
      ? 0
      : EARTH_FORMANT_OUTPUT_GAIN,
    bands: [
      {
        id: "body",
        frequencyHz: partialAttractedFrequencyHz(
          frame,
          airTurbulence,
          bodyTargetHz,
          190,
          820,
          0.18 + frame.earth.builtTexture01 * 0.1,
        ),
        q: bodyQ,
        gain01: bodyGain,
      },
      {
        id: "mid",
        frequencyHz: partialAttractedFrequencyHz(
          frame,
          airTurbulence,
          midTargetHz,
          620,
          2600,
          0.22 + humanPresence01 * 0.14,
        ),
        q: midQ,
        gain01: midGain,
      },
      {
        id: "air",
        frequencyHz: partialAttractedFrequencyHz(
          frame,
          airTurbulence,
          airTargetHz,
          1400,
          6200,
          0.22 + frame.earth.openness01 * 0.16,
        ),
        q: airQ,
        gain01: airGain,
      },
    ],
  };
}

function partialAttractedFrequencyHz(
  frame: AudioFrameParams,
  airTurbulence: EarthAirTurbulence,
  targetHz: number,
  minHz: number,
  maxHz: number,
  attraction01: number,
): number {
  let closestHz = targetHz;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const partial of EARTH_DRONE_PARTIALS) {
    const frequencyHz = foldFrequencyIntoRange(
      earthDronePartialFrequencyHz(partial, frame, airTurbulence),
      minHz,
      maxHz,
    );
    const distance = Math.abs(Math.log2(frequencyHz / targetHz));
    if (distance < closestDistance) {
      closestDistance = distance;
      closestHz = frequencyHz;
    }
  }

  return clampNumber(lerpNumber(targetHz, closestHz, clampNumber(attraction01, 0, 0.5)), minHz, maxHz);
}

function foldFrequencyIntoRange(frequencyHz: number, minHz: number, maxHz: number): number {
  let folded = Math.max(0.001, frequencyHz);
  while (folded < minHz) {
    folded *= 2;
  }
  while (folded > maxHz) {
    folded *= 0.5;
  }
  return clampNumber(folded, minHz, maxHz);
}

function lerpNumber(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

import {
  derivePenumbraDropletShapeForFrequency,
  penumbraDropletBandForFrequency,
  type PenumbraDropletBand,
  type PenumbraEarthTextureParams,
} from "./penumbra-earth-texture-params";

export const PENUMBRA_EARTH_TEXTURE_WORKLET_MODULE_URL =
  "/worklets/penumbra-earth-texture-processor.js?v=26050802";
export const PENUMBRA_EARTH_TEXTURE_WORKLET_PROCESSOR_NAME = "penumbra-earth-texture";
export const PENUMBRA_EARTH_TEXTURE_SCHEDULE_AHEAD_SECONDS = 0.04;

export interface PenumbraEarthTextureContinuousMessage {
  readonly type: "set-continuous";
  readonly params: PenumbraEarthTextureParams;
}

export interface PenumbraWaterDropletMessage {
  readonly type: "water-droplet";
  readonly startTimeSeconds: number;
  readonly randomSeed: number;
  readonly frequencyHz: number;
  readonly velocity01: number;
  readonly band: PenumbraDropletBand;
  readonly pitchSweep: number;
  readonly sweepTimeSeconds: number;
  readonly decaySeconds: number;
  readonly transient01: number;
}

export interface PenumbraRainGranularMessage {
  readonly type: "rain-grain";
  readonly startTimeSeconds: number;
  readonly randomSeed: number;
  readonly bufferIndex: number;
  readonly offset01: number;
  readonly durationSeconds: number;
  readonly playbackRate: number;
  readonly velocity01: number;
  readonly pan01: number;
  readonly lowpassHz: number;
  readonly attackRatio: number;
  readonly attackCurve: number;
  readonly decayCurve: number;
}

export type PenumbraEarthTextureWorkletMessage =
  | PenumbraEarthTextureContinuousMessage
  | PenumbraWaterDropletMessage
  | PenumbraRainGranularMessage;

export function createPenumbraEarthTextureContinuousMessage(
  params: PenumbraEarthTextureParams,
): PenumbraEarthTextureContinuousMessage {
  return {
    type: "set-continuous",
    params,
  };
}

export function createPenumbraWaterDropletMessage(options: {
  readonly startTimeSeconds: number;
  readonly randomSeed: number;
  readonly frequencyHz: number;
  readonly velocity01: number;
  readonly band?: PenumbraDropletBand;
}): PenumbraWaterDropletMessage {
  const shape = derivePenumbraDropletShapeForFrequency(options.frequencyHz);
  return {
    type: "water-droplet",
    startTimeSeconds: options.startTimeSeconds,
    randomSeed: sanitizeUint32(options.randomSeed),
    frequencyHz: options.frequencyHz,
    velocity01: Math.max(0, Math.min(1, options.velocity01)),
    band: options.band ?? penumbraDropletBandForFrequency(options.frequencyHz),
    pitchSweep: shape.pitchSweep,
    sweepTimeSeconds: shape.sweepTimeMs / 1000,
    decaySeconds: shape.dropDecaySeconds,
    transient01: shape.transient01,
  };
}

export function createPenumbraRainGranularMessage(options: {
  readonly startTimeSeconds: number;
  readonly randomSeed: number;
  readonly bufferIndex: number;
  readonly offset01: number;
  readonly durationSeconds: number;
  readonly playbackRate: number;
  readonly velocity01: number;
  readonly pan01: number;
  readonly lowpassHz: number;
  readonly attackRatio: number;
  readonly attackCurve: number;
  readonly decayCurve: number;
}): PenumbraRainGranularMessage {
  return {
    type: "rain-grain",
    startTimeSeconds: options.startTimeSeconds,
    randomSeed: sanitizeUint32(options.randomSeed),
    bufferIndex: Math.max(0, Math.floor(options.bufferIndex)),
    offset01: Math.max(0, Math.min(0.999999, options.offset01)),
    durationSeconds: Math.max(0.008, Math.min(0.25, options.durationSeconds)),
    playbackRate: Math.max(0.25, Math.min(2.5, options.playbackRate)),
    velocity01: Math.max(0, Math.min(1, options.velocity01)),
    pan01: Math.max(-1, Math.min(1, options.pan01)),
    lowpassHz: Math.max(500, Math.min(18000, options.lowpassHz)),
    attackRatio: Math.max(0.035, Math.min(0.62, options.attackRatio)),
    attackCurve: Math.max(0.35, Math.min(2.6, options.attackCurve)),
    decayCurve: Math.max(0.65, Math.min(7.2, options.decayCurve)),
  };
}

function sanitizeUint32(value: number): number {
  return Math.max(1, Math.floor(value)) >>> 0;
}

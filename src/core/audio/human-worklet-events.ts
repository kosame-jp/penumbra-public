import type { HumanPluckParams } from "./human-pluck-params";

export const HUMAN_LAYER_WORKLET_MODULE_URL = "/worklets/human-layer-processor.js?v=26050804";
export const HUMAN_LAYER_WORKLET_PROCESSOR_NAME = "penumbra-human-layer";
export const HUMAN_WORKLET_SCHEDULE_AHEAD_SECONDS = 0.03;

export interface HumanWorkletPartial {
  readonly ratio: number;
  readonly gain01: number;
  readonly detuneCents: number;
  readonly decayScale: number;
}

export interface HumanWorkletPluckMessage {
  readonly type: "pluck";
  readonly startTimeSeconds: number;
  readonly randomSeed: number;
  readonly frequencyHz: number;
  readonly peakGain01: number;
  readonly attackSeconds: number;
  readonly decaySeconds: number;
  readonly lowpassHz: number;
  readonly noiseGain01: number;
  readonly reverbSend01: number;
  readonly reverbTailSeconds: number;
  readonly reverbDampingHz: number;
  readonly partials: readonly HumanWorkletPartial[];
}

export interface HumanWorkletDiagnosticsMessage {
  readonly type: "diagnostics";
  readonly reverbEnabled: boolean;
  readonly maxActiveVoices: number;
  readonly maxPartialsPerVoice: number;
}

export function createHumanWorkletPluckMessage(
  params: HumanPluckParams,
  startTimeSeconds: number,
  options: { readonly randomSeed: number },
): HumanWorkletPluckMessage {
  return {
    type: "pluck",
    startTimeSeconds,
    randomSeed: sanitizeUint32(options.randomSeed),
    frequencyHz: params.frequencyHz,
    peakGain01: params.peakGain01,
    attackSeconds: params.attackSeconds,
    decaySeconds: params.decaySeconds,
    lowpassHz: params.lowpassHz,
    noiseGain01: params.noiseGain01,
    reverbSend01: params.reverbSend01,
    reverbTailSeconds: params.reverbTailSeconds,
    reverbDampingHz: params.reverbDampingHz,
    partials: params.partials.map((partial) => ({
      ratio: partial.ratio,
      gain01: partial.gain01,
      detuneCents: partial.detuneCents,
      decayScale: partial.decayScale,
    })),
  };
}

export function createHumanWorkletDiagnosticsMessage(options: {
  readonly reverbEnabled: boolean;
  readonly maxActiveVoices: number;
  readonly maxPartialsPerVoice: number;
}): HumanWorkletDiagnosticsMessage {
  return {
    type: "diagnostics",
    reverbEnabled: options.reverbEnabled,
    maxActiveVoices: Math.max(1, Math.floor(options.maxActiveVoices)),
    maxPartialsPerVoice: Math.max(1, Math.floor(options.maxPartialsPerVoice)),
  };
}

function sanitizeUint32(value: number): number {
  return Math.max(1, Math.floor(value)) >>> 0;
}

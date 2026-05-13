import type { CanonicalScanlineSample, NightLightTopology } from "./scanline-sample";
import { clamp } from "../scanline/geometry";

export const DEFAULT_HUMAN_VOICE_CAP = 12;
export const DEFAULT_HUMAN_VOICE_MIN_GAIN = 0;

export interface HumanVoiceCandidate {
  readonly id: string;
  readonly sampleIndex: number;
  readonly cellId: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly gain01: number;
  readonly scanlineWeight: number;
  readonly nightLightNorm: number;
  readonly frequencyHz: number;
  readonly registerMidi: number;
  readonly surfaceHardness01: number;
  readonly openness01: number;
  readonly waterRatio: number;
  readonly forestRatio: number;
  readonly roadDensityNorm: number;
  readonly buildingDensityNorm: number;
  readonly nightLightTopology: NightLightTopology;
  readonly humidityNorm: number;
  readonly cloudNorm: number;
  readonly windNorm: number;
  readonly precipitationNorm: number;
  readonly temperatureNorm: number;
  readonly dominantGridKernelId?: string;
  readonly dominantScaleKernelId?: string;
}

export interface HumanVoiceSelectionOptions {
  readonly maxVoices?: number;
  readonly minGain01?: number;
}

export interface HumanVoiceSelection {
  readonly candidates: readonly HumanVoiceCandidate[];
  readonly voices: readonly HumanVoiceCandidate[];
}

export function deriveHumanVoiceCandidates(
  samples: readonly CanonicalScanlineSample[],
  options: Pick<HumanVoiceSelectionOptions, "minGain01"> = {},
): HumanVoiceCandidate[] {
  const minGain01 = options.minGain01 ?? DEFAULT_HUMAN_VOICE_MIN_GAIN;

  return samples
    .map((sample, sampleIndex) => toHumanVoiceCandidate(sample, sampleIndex))
    .filter((candidate): candidate is HumanVoiceCandidate => {
      return candidate !== undefined && candidate.gain01 > minGain01;
    })
    .sort(compareHumanVoiceCandidates);
}

export function selectHumanVoiceCandidates(
  samples: readonly CanonicalScanlineSample[],
  options: HumanVoiceSelectionOptions = {},
): HumanVoiceSelection {
  const maxVoices = Math.max(0, Math.floor(options.maxVoices ?? DEFAULT_HUMAN_VOICE_CAP));
  const candidates = deriveHumanVoiceCandidates(samples, options);

  return {
    candidates,
    voices: candidates.slice(0, maxVoices),
  };
}

function toHumanVoiceCandidate(
  sample: CanonicalScanlineSample,
  sampleIndex: number,
): HumanVoiceCandidate | undefined {
  if (!sample.layers.music.active) {
    return undefined;
  }

  return {
    id: `human:${sample.cellId}`,
    sampleIndex,
    cellId: sample.cellId,
    latitudeDeg: sample.latitudeDeg,
    longitudeDeg: sample.longitudeDeg,
    gain01: clamp(sample.layers.music.gain01, 0, 1),
    scanlineWeight: clamp(sample.scanlineWeight, 0, 1),
    nightLightNorm: clamp(sample.nightLightNorm, 0, 1),
    frequencyHz: sample.layers.music.frequencyHz,
    registerMidi: sample.registerMidi,
    surfaceHardness01: clamp(sample.surfaceHardness01, 0, 1),
    openness01: clamp(sample.openness01, 0, 1),
    waterRatio: clamp(sample.waterRatio, 0, 1),
    forestRatio: clamp(sample.forestRatio, 0, 1),
    roadDensityNorm: clamp(sample.roadDensityNorm, 0, 1),
    buildingDensityNorm: clamp(sample.buildingDensityNorm, 0, 1),
    nightLightTopology: {
      neighborMean01: clamp(sample.nightLightTopology.neighborMean01, 0, 1),
      neighborMax01: clamp(sample.nightLightTopology.neighborMax01, 0, 1),
      neighborLitCount01: clamp(sample.nightLightTopology.neighborLitCount01, 0, 1),
      isolation01: clamp(sample.nightLightTopology.isolation01, 0, 1),
      continuity01: clamp(sample.nightLightTopology.continuity01, 0, 1),
      edge01: clamp(sample.nightLightTopology.edge01, 0, 1),
    },
    humidityNorm: clamp(sample.weather.relativeHumidityPct / 100, 0, 1),
    cloudNorm: clamp(sample.weather.cloudCoverPct / 100, 0, 1),
    windNorm: clamp(sample.weather.windSpeedMps / 18, 0, 1),
    precipitationNorm: clamp(sample.weather.precipitationMm / 8, 0, 1),
    temperatureNorm: clamp((sample.weather.temperatureC + 20) / 60, 0, 1),
    dominantGridKernelId: sample.tuning.dominantGridKernelId,
    dominantScaleKernelId: sample.tuning.dominantScaleKernelId,
  };
}

function compareHumanVoiceCandidates(
  left: HumanVoiceCandidate,
  right: HumanVoiceCandidate,
): number {
  return (
    right.gain01 - left.gain01 ||
    right.scanlineWeight - left.scanlineWeight ||
    left.cellId.localeCompare(right.cellId) ||
    left.sampleIndex - right.sampleIndex
  );
}

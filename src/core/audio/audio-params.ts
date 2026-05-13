import type { CanonicalScanlineSample } from "../fusion/scanline-sample";
import {
  selectHumanVoiceCandidates,
  type HumanVoiceCandidate,
} from "../fusion/human-voice-candidates";
import { midiToHz } from "../fusion/register";
import { clamp } from "../scanline/geometry";

export const MASTER_OUTPUT_GAIN = 0.35;
export const HUMAN_LAYER_OUTPUT_GAIN = 1.12;

export interface EarthAudioParams {
  readonly active: boolean;
  readonly gain01: number;
  readonly registerHz: number;
  readonly brightness01: number;
  readonly cloudCover01: number;
  readonly humidity01: number;
  readonly wind01: number;
  readonly precipitation01: number;
  readonly surfaceHardness01: number;
  readonly openness01: number;
  readonly waterRatio01: number;
  readonly oceanDepth01: number;
  readonly forestRatio01: number;
  readonly builtTexture01: number;
  readonly toneGain01: number;
  readonly noiseGain01: number;
  readonly noiseLowpassHz: number;
  readonly noiseColor01: number;
  readonly precipitationGrainGain01: number;
  readonly precipitationGrainDensityHz: number;
  readonly precipitationGrainBrightness01: number;
  readonly surfaceTextureGain01: number;
  readonly surfaceTextureFilterHz: number;
  readonly surfaceTextureQ: number;
  readonly surfaceRoughness01: number;
  readonly airTurbulenceDepth01: number;
  readonly airTurbulenceRateHz: number;
  readonly airTurbulenceSeed01: number;
  readonly droneDispersion01: number;
  readonly droneSpectralTilt01: number;
  readonly droneDamping01: number;
  readonly scanlineSpatialChange01: number;
  readonly scanlineSpatialVariance01: number;
  readonly scanlineSpatialSlope01: number;
}

export interface MusicAudioParams {
  readonly active: boolean;
  readonly gain01: number;
  readonly frequencyHz: number;
  readonly candidates: readonly HumanVoiceCandidate[];
  readonly voices: readonly HumanVoiceCandidate[];
  readonly dominantGridKernelId?: string;
  readonly dominantScaleKernelId?: string;
}

export interface QuakeHitAudioParams {
  readonly id: string;
  readonly active: boolean;
  readonly eventTimeUtc: string;
  readonly magnitude: number;
  readonly scanlineWeight: number;
  readonly gain01: number;
  readonly lowpassHz: number;
  readonly depthDarkness01: number;
}

export interface AudioFrameParams {
  readonly utcIso: string;
  readonly utcEpochMs: number;
  readonly earth: EarthAudioParams;
  readonly music: MusicAudioParams;
  readonly quakes: readonly QuakeHitAudioParams[];
  readonly debugMeters: {
    readonly earthEnergy01: number;
    readonly musicCandidateCount: number;
    readonly musicVoiceCount: number;
    readonly musicEnergy01: number;
    readonly musicMaxGain01: number;
    readonly musicMeanGain01: number;
    readonly musicPulseEnvelope01: number;
    readonly precipitationGrainGain01: number;
    readonly precipitationGrainDensityHz: number;
    readonly surfaceTextureGain01: number;
    readonly surfaceRoughness01: number;
    readonly airTurbulenceDepth01: number;
    readonly airTurbulenceRateHz: number;
    readonly droneDispersion01: number;
    readonly droneSpectralTilt01: number;
    readonly scanlineSpatialChange01: number;
    readonly scanlineSpatialVariance01: number;
    readonly quakeEnergy01: number;
  };
}

export interface AudioFrameDerivationOptions {
  readonly precipitationOverride01?: number;
}

export function deriveAudioFrameParams(
  samples: readonly CanonicalScanlineSample[],
  options: AudioFrameDerivationOptions = {},
): AudioFrameParams {
  const utcIso = samples[0]?.utcIso ?? new Date(0).toISOString();
  const utcEpochMs = Date.parse(utcIso);
  const earthSamples = samples.filter((sample) => sample.layers.earth.active);
  const scanlinePresence = average(earthSamples.map((sample) => sample.scanlineWeight));
  const earthBrightness = average(
    earthSamples.map((sample) => sample.scanlineWeight * sample.layers.earth.brightness01),
  );
  const cloudNorm = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: clamp(sample.weather.cloudCoverPct / 100, 0, 1),
      weight: sample.scanlineWeight,
    })),
  );
  const humidityNorm = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: clamp(sample.weather.relativeHumidityPct / 100, 0, 1),
      weight: sample.scanlineWeight,
    })),
  );
  const windNorm = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: clamp(sample.weather.windSpeedMps / 18, 0, 1),
      weight: sample.scanlineWeight,
    })),
  );
  const scanlineLocalPrecipitationNorm = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: clamp(sample.weather.precipitationMm / 8, 0, 1),
      weight: sample.scanlineWeight,
    })),
  );
  const precipitationNorm = options.precipitationOverride01 === undefined
    ? scanlineLocalPrecipitationNorm
    : clamp(options.precipitationOverride01, 0, 1);
  const surfaceHardness = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: sample.surfaceHardness01,
      weight: sample.scanlineWeight,
    })),
  );
  const openness = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: sample.openness01,
      weight: sample.scanlineWeight,
    })),
  );
  const forest = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: sample.forestRatio,
      weight: sample.scanlineWeight,
    })),
  );
  const water = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: sample.waterRatio,
      weight: sample.scanlineWeight,
    })),
  );
  const oceanDepth01 = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: clamp(Math.max(0, -sample.effectiveElevationM) / 10994, 0, 1),
      weight: sample.scanlineWeight,
    })),
  );
  const roadDensity = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: sample.roadDensityNorm,
      weight: sample.scanlineWeight,
    })),
  );
  const buildingDensity = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: sample.buildingDensityNorm,
      weight: sample.scanlineWeight,
    })),
  );
  const scanlineSpatialChange01 = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: sample.spatialChange01,
      weight: sample.scanlineWeight,
    })),
  );
  const scanlineSpatialSlope01 = clamp(
    weightedAverageOrZero(
      earthSamples.map((sample) => ({
        value: sample.spatialSlope01,
        weight: sample.scanlineWeight,
      })),
    ),
    -1,
    1,
  );
  const scanlineSpatialVariance01 = scanlineVarianceForSamples(earthSamples);
  const earthRegisterMidi = weightedAverage(
    earthSamples.map((sample) => ({
      value: sample.registerMidi,
      weight: sample.scanlineWeight,
    })),
  );
  const musicSelection = selectHumanVoiceCandidates(samples);
  const musicCandidates = musicSelection.candidates;
  const musicSamples = musicSelection.voices;
  const musicEnergy = average(musicSamples.map((sample) => sample.gain01));
  const musicRegisterMidi = weightedAverage(
    musicSamples.map((sample) => ({
      value: sample.registerMidi,
      weight: sample.gain01,
    })),
  );
  const musicFrequencyHz = weightedAverage(
    musicSamples.map((sample) => ({
      value: sample.frequencyHz,
      weight: sample.gain01,
    })),
  );
  const musicMaxGain = musicSelection.candidates.reduce(
    (max, candidate) => Math.max(max, candidate.gain01),
    0,
  );
  const musicGain = clamp(musicEnergy * 0.15, 0, 0.18);
  const quakeHits = samples.flatMap((sample) =>
    sample.layers.quakes.map((quake) => deriveQuakeHitParams(sample, quake.id)),
  );
  const quakeEnergy = clamp(
    quakeHits.reduce((sum, hit) => sum + hit.gain01, 0),
    0,
    1,
  );
  const earthPresence = clamp(scanlinePresence * (0.62 + earthBrightness * 0.38), 0, 1);
  const earthGain = clamp(earthPresence * 0.2, 0, 0.25);
  const weatherTexture = clamp(
    windNorm * 0.45 + precipitationNorm * 0.28 + humidityNorm * 0.16 + cloudNorm * 0.11,
    0,
    1,
  );
  const propagationClarity = clamp(
    1 - cloudNorm * 0.6 - humidityNorm * 0.16 + windNorm * 0.14 + openness * 0.14,
    0,
    1,
  );
  const brightNoiseColor = clamp(
    windNorm * 0.4 + openness * 0.35 + precipitationNorm * 0.12 + surfaceHardness * 0.08,
    0,
    1,
  );
  const absorbedNoiseColor = clamp(
    cloudNorm * 0.36 + humidityNorm * 0.28 + forest * 0.26,
    0,
    1,
  );
  const noiseColor01 = clamp(0.46 + brightNoiseColor * 0.32 - absorbedNoiseColor * 0.46, 0.06, 0.88);
  const precipitationAbsorption = clamp(
    cloudNorm * 0.38 + humidityNorm * 0.28 + forest * 0.24,
    0,
    1,
  );
  const precipitationScatter = clamp(
    windNorm * 0.48 + openness * 0.32 + surfaceHardness * 0.1,
    0,
    1,
  );
  const precipitationPresence01 = precipitationNorm > 0 ? clamp(Math.pow(precipitationNorm, 0.54), 0, 1) : 0;
  const precipitationGrainDensityHz =
    precipitationPresence01 > 0 ? clamp(0.18 + precipitationPresence01 * 25.8, 0, 30) : 0;
  const precipitationGrainBrightness01 =
    precipitationPresence01 > 0
      ? clamp(
          0.24 +
            precipitationPresence01 * 0.22 +
            precipitationScatter * 0.3 -
            precipitationAbsorption * 0.34,
          0.08,
          0.78,
        )
      : 0;
  const precipitationGrainAudibility01 = precipitationPresence01;
  const precipitationGrainGain01 = clamp(
    earthGain *
      precipitationGrainAudibility01 *
      (0.044 + precipitationScatter * 0.052) *
      (1 - precipitationAbsorption * 0.26),
    0,
    0.024,
  );
  const builtTexture = clamp(roadDensity * 0.45 + buildingDensity * 0.55, 0, 1);
  const surfaceSmoothness = clamp(
    water * 0.4 + forest * 0.24 + humidityNorm * 0.18 + cloudNorm * 0.08 + (1 - surfaceHardness) * 0.1,
    0,
    1,
  );
  const surfaceRoughness01 = clamp(
    surfaceHardness * 0.34 +
      openness * 0.18 +
      builtTexture * 0.24 +
      windNorm * 0.14 +
      precipitationNorm * 0.06 -
      surfaceSmoothness * 0.32,
    0,
    1,
  );
  const surfaceWindFocus = clamp(
    windNorm * (0.34 + openness * 0.26 + surfaceHardness * 0.22 + builtTexture * 0.18) -
      surfaceSmoothness * 0.18,
    0,
    1,
  );
  const surfaceHardFocus = clamp(
    surfaceHardness * 0.42 + builtTexture * 0.3 + openness * 0.18 - water * 0.12 - forest * 0.12,
    0,
    1,
  );
  const airTurbulenceSeed01 = weightedAverageOrZero(
    earthSamples.map((sample) => ({
      value: hashStringToUnit(sample.cellId),
      weight: sample.scanlineWeight,
    })),
  );
  const airTurbulenceExposure = clamp(
    windNorm * (0.64 + openness * 0.42 + surfaceHardness * 0.2 + precipitationNorm * 0.12),
    0,
    1,
  );
  const airTurbulenceAbsorption = clamp(
    humidityNorm * 0.26 + cloudNorm * 0.2 + forest * 0.16 + water * 0.08,
    0,
    1,
  );
  const airTurbulenceDepth01 = clamp(
    airTurbulenceExposure * (1 - airTurbulenceAbsorption * 0.38),
    0,
    1,
  );
  const airTurbulenceRateHz =
    airTurbulenceDepth01 > 0.02
      ? clamp(
          0.04 + Math.pow(windNorm, 1.05) * 0.48 + openness * 0.035 + surfaceHardness * 0.02,
          0.025,
          0.62,
        )
      : 0;
  const surfaceTextureGain01 = clamp(
    earthGain * (0.035 + Math.pow(surfaceRoughness01, 0.78) * 0.096) * (1 - surfaceSmoothness * 0.34),
    0,
    0.024,
  );
  const surfaceTextureFilterHz = clamp(
    300 +
      surfaceRoughness01 * 2800 +
      surfaceWindFocus * 1450 +
      builtTexture * 520 +
      openness * 360 -
      surfaceSmoothness * 560,
    160,
    5200,
  );
  const surfaceTextureQ = clamp(
    0.22 +
      surfaceRoughness01 * 0.72 +
      surfaceWindFocus * 1.72 +
      surfaceHardFocus * 0.62 -
      surfaceSmoothness * 0.3,
    0.16,
    3.2,
  );
  const droneDamping01 = clamp(cloudNorm * 0.26 + humidityNorm * 0.24 + forest * 0.24 + water * 0.14, 0, 1);
  const droneExcitation01 = clamp(
    surfaceRoughness01 * 0.26 +
      surfaceHardness * 0.18 +
      openness * 0.18 +
      builtTexture * 0.2 +
      windNorm * 0.14 +
      precipitationNorm * 0.04,
    0,
    1,
  );
  const droneDispersion01 = clamp(
    (droneExcitation01 +
      airTurbulenceDepth01 * 0.1 +
      scanlineSpatialChange01 * 0.18 +
      scanlineSpatialVariance01 * 0.12) *
      (1 - droneDamping01 * 0.42),
    0,
    1,
  );
  const droneSpectralTilt01 = clamp(
    0.14 +
      droneExcitation01 * 0.66 +
      airTurbulenceDepth01 * 0.16 +
      scanlineSpatialChange01 * 0.12 +
      scanlineSpatialVariance01 * 0.14 -
      droneDamping01 * 0.5,
    0,
    1,
  );
  const resolvedMusicFrequencyHz = musicFrequencyHz || midiToHz(musicRegisterMidi || earthRegisterMidi);

  return {
    utcIso,
    utcEpochMs: Number.isFinite(utcEpochMs) ? utcEpochMs : 0,
    earth: {
      active: earthPresence > 0.0001,
      gain01: earthGain,
      registerHz: midiToHz(earthRegisterMidi),
      brightness01: clamp(earthBrightness, 0, 1),
      cloudCover01: cloudNorm,
      humidity01: humidityNorm,
      wind01: windNorm,
      precipitation01: precipitationNorm,
      surfaceHardness01: surfaceHardness,
      openness01: openness,
      waterRatio01: water,
      oceanDepth01,
      forestRatio01: forest,
      builtTexture01: builtTexture,
      toneGain01: clamp(earthGain * (0.58 + surfaceHardness * 0.18), 0, 0.2),
      noiseGain01: clamp(earthGain * (0.085 + weatherTexture * 0.36), 0, 0.095),
      noiseLowpassHz: 240 + propagationClarity * 5200,
      noiseColor01,
      precipitationGrainGain01,
      precipitationGrainDensityHz,
      precipitationGrainBrightness01,
      surfaceTextureGain01,
      surfaceTextureFilterHz,
      surfaceTextureQ,
      surfaceRoughness01,
      airTurbulenceDepth01,
      airTurbulenceRateHz,
      airTurbulenceSeed01,
      droneDispersion01,
      droneSpectralTilt01,
      droneDamping01,
      scanlineSpatialChange01,
      scanlineSpatialVariance01,
      scanlineSpatialSlope01,
    },
    music: {
      active: musicEnergy > 0.0001,
      gain01: musicGain,
      frequencyHz: resolvedMusicFrequencyHz,
      candidates: musicCandidates,
      voices: musicSamples,
      dominantGridKernelId: dominantId(musicSamples.map((sample) => sample.dominantGridKernelId)),
      dominantScaleKernelId: dominantId(musicSamples.map((sample) => sample.dominantScaleKernelId)),
    },
    quakes: quakeHits,
    debugMeters: {
      earthEnergy01: earthPresence,
      musicCandidateCount: musicSelection.candidates.length,
      musicVoiceCount: musicSamples.length,
      musicEnergy01: clamp(musicEnergy, 0, 1),
      musicMaxGain01: musicMaxGain,
      musicMeanGain01: clamp(musicEnergy, 0, 1),
      musicPulseEnvelope01: musicGain * HUMAN_LAYER_OUTPUT_GAIN * MASTER_OUTPUT_GAIN,
      precipitationGrainGain01,
      precipitationGrainDensityHz,
      surfaceTextureGain01,
      surfaceRoughness01,
      airTurbulenceDepth01,
      airTurbulenceRateHz,
      droneDispersion01,
      droneSpectralTilt01,
      scanlineSpatialChange01,
      scanlineSpatialVariance01,
      quakeEnergy01: quakeEnergy,
    },
  };
}

function scanlineVarianceForSamples(samples: readonly CanonicalScanlineSample[]): number {
  if (samples.length <= 1) {
    return 0;
  }

  const registerVariance = weightedStdDevNormalized(
    samples.map((sample) => ({ value: sample.registerMidi, weight: sample.scanlineWeight })),
    28,
  );
  const waterVariance = weightedStdDevNormalized(
    samples.map((sample) => ({ value: sample.waterRatio, weight: sample.scanlineWeight })),
    0.5,
  );
  const forestVariance = weightedStdDevNormalized(
    samples.map((sample) => ({ value: sample.forestRatio, weight: sample.scanlineWeight })),
    0.5,
  );
  const roughnessVariance = weightedStdDevNormalized(
    samples.map((sample) => ({ value: sample.surfaceHardness01, weight: sample.scanlineWeight })),
    0.5,
  );
  const opennessVariance = weightedStdDevNormalized(
    samples.map((sample) => ({ value: sample.openness01, weight: sample.scanlineWeight })),
    0.5,
  );
  const builtVariance = weightedStdDevNormalized(
    samples.map((sample) => ({
      value: sample.roadDensityNorm * 0.45 + sample.buildingDensityNorm * 0.55,
      weight: sample.scanlineWeight,
    })),
    0.5,
  );
  const weatherVariance = clamp(
    weightedStdDevNormalized(
      samples.map((sample) => ({
        value: sample.weather.cloudCoverPct / 100,
        weight: sample.scanlineWeight,
      })),
      0.5,
    ) *
      0.2 +
      weightedStdDevNormalized(
        samples.map((sample) => ({
          value: sample.weather.relativeHumidityPct / 100,
          weight: sample.scanlineWeight,
        })),
        0.5,
      ) *
        0.16 +
      weightedStdDevNormalized(
        samples.map((sample) => ({
          value: sample.weather.windSpeedMps / 18,
          weight: sample.scanlineWeight,
        })),
        0.5,
      ) *
        0.32 +
      weightedStdDevNormalized(
        samples.map((sample) => ({
          value: sample.weather.precipitationMm / 8,
          weight: sample.scanlineWeight,
        })),
        0.5,
      ) *
        0.32,
    0,
    1,
  );

  return clamp(
    registerVariance * 0.22 +
      waterVariance * 0.16 +
      forestVariance * 0.1 +
      roughnessVariance * 0.16 +
      opennessVariance * 0.1 +
      builtVariance * 0.12 +
      weatherVariance * 0.14,
    0,
    1,
  );
}

function weightedStdDevNormalized(
  values: readonly { value: number; weight: number }[],
  normalizer: number,
): number {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0 || normalizer <= 0) {
    return 0;
  }

  const mean = values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
  const variance =
    values.reduce((sum, item) => sum + (item.value - mean) ** 2 * item.weight, 0) / totalWeight;
  return clamp(Math.sqrt(variance) / normalizer, 0, 1);
}

function deriveQuakeHitParams(sample: CanonicalScanlineSample, quakeId: string): QuakeHitAudioParams {
  const quake = sample.layers.quakes.find((candidate) => candidate.id === quakeId);
  if (!quake) {
    throw new Error(`Quake ${quakeId} was not found in sample ${sample.cellId}.`);
  }

  const depthDarkness01 = clamp(quake.depthKm / 700, 0, 1);
  return {
    id: quake.id,
    active: true,
    eventTimeUtc: quake.eventTimeUtc,
    magnitude: quake.magnitude,
    scanlineWeight: sample.scanlineWeight,
    gain01: clamp((quake.magnitude / 10) * sample.scanlineWeight, 0, 1),
    lowpassHz: 260 + (1 - depthDarkness01) * 4200,
    depthDarkness01,
  };
}

function weightedAverage(values: readonly { value: number; weight: number }[]): number {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return average(values.map((item) => item.value)) || 48;
  }

  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function weightedAverageOrZero(values: readonly { value: number; weight: number }[]): number {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return 0;
  }

  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dominantId(values: readonly (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function hashStringToUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

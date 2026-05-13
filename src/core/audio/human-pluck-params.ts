import type { HumanVoiceCandidate } from "../fusion/human-voice-candidates";
import { clamp } from "../scanline/geometry";
import type { HumanPulseEvent } from "../fusion/human-pulse-scheduler";

export interface HumanPluckPartial {
  readonly ratio: number;
  readonly gain01: number;
  readonly detuneCents: number;
  readonly decayScale: number;
}

export interface HumanPluckParams {
  readonly frequencyHz: number;
  readonly peakGain01: number;
  readonly attackSeconds: number;
  readonly decaySeconds: number;
  readonly lowpassHz: number;
  readonly noiseGain01: number;
  readonly reverbSend01: number;
  readonly reverbTailSeconds: number;
  readonly reverbDampingHz: number;
  readonly partials: readonly HumanPluckPartial[];
}

export const HUMAN_SECOND_PARTIAL_GAIN_SCALE = 1;
export const HUMAN_METALLIC_DISPERSION_B_MAX = 0.08;
export const HUMAN_CANONICAL_PARTIAL_COUNT = 4;

const HUMAN_WOOD_PARTIAL_OFFSETS: Record<number, number> = {
  2: 0.018,
  3: 0.032,
  4: 0.048,
  5: 0.066,
  6: 0.084,
  7: 0.105,
  8: 0.128,
  9: 0.152,
};

export function deriveHumanPluckParams(
  voice: HumanVoiceCandidate,
  pulse: HumanPulseEvent | undefined,
): HumanPluckParams {
  const hardness = clamp(voice.surfaceHardness01, 0, 1);
  const openness = clamp(voice.openness01, 0, 1);
  const water = clamp(voice.waterRatio, 0, 1);
  const forest = clamp(voice.forestRatio, 0, 1);
  const builtTexture = clamp(voice.buildingDensityNorm * 0.62 + voice.roadDensityNorm * 0.38, 0, 1);
  const topology = voice.nightLightTopology;
  const topologyIsolation = clamp(topology.isolation01, 0, 1);
  const topologyContinuity = clamp(topology.continuity01, 0, 1);
  const topologyEdge = clamp(topology.edge01, 0, 1);
  const topologyCluster = clamp(
    topologyContinuity * 0.68 + topology.neighborMean01 * 0.18 + topologyEdge * 0.14,
    0,
    1,
  );
  const topologyFundamentalFocus = clamp(
    topologyIsolation * 0.74 + (1 - topology.neighborLitCount01) * 0.14 - topologyCluster * 0.18,
    0,
    1,
  );
  const humidity = clamp(voice.humidityNorm, 0, 1);
  const cloud = clamp(voice.cloudNorm, 0, 1);
  const wind = clamp(voice.windNorm, 0, 1);
  const precipitation = clamp(voice.precipitationNorm, 0, 1);
  const coldness = clamp(1 - voice.temperatureNorm, 0, 1);
  const vegetationDamping = clamp(forest * 0.52 + cloud * 0.29 + humidity * 0.19, 0, 1);
  const mineralBrightness = clamp(hardness * 0.52 + builtTexture * 0.38 + coldness * 0.1, 0, 1);
  const airiness = clamp(openness * 0.42 + water * 0.26 + wind * 0.23 + precipitation * 0.09, 0, 1);
  const woodyResonance = clamp(
    (1 - hardness) * 0.28 +
      forest * 0.26 +
      humidity * 0.16 +
      cloud * 0.12 +
      (1 - builtTexture) * 0.07 +
      (1 - openness) * 0.06,
    0,
    1,
  );
  const metallicResonance = clamp(
    mineralBrightness * 0.42 +
      builtTexture * 0.26 +
      openness * 0.14 +
      coldness * 0.08 +
      wind * 0.06 +
      precipitation * 0.05 -
      woodyResonance * 0.24 -
      vegetationDamping * 0.22,
    0,
    1,
  );
  const bodyWarmth = clamp(woodyResonance * (1 - metallicResonance * 0.22), 0, 1);
  const metalShimmer = clamp(metallicResonance * (1 - woodyResonance * 0.28), 0, 1);
  const upperDamping = clamp(1 - vegetationDamping * 0.62 - bodyWarmth * 0.2, 0.18, 1);
  const fundamentalGain = clamp(
    1.02 + bodyWarmth * 0.16 + topologyFundamentalFocus * 0.14 - metalShimmer * 0.22 - mineralBrightness * 0.12,
    0.72,
    1.2,
  );
  const spectralBloom = clamp(metalShimmer * 0.72 + airiness * 0.28 + precipitation * 0.12 - bodyWarmth * 0.24 - vegetationDamping * 0.24, 0, 1);
  const partialPresence01 = clamp(
    0.18 +
      hardness * 0.22 +
      builtTexture * 0.2 +
      openness * 0.16 +
      metalShimmer * 0.22 +
      topologyCluster * 0.18 +
      topologyEdge * 0.08 +
      wind * 0.08 +
      coldness * 0.06 -
      topologyFundamentalFocus * 0.34 -
      water * 0.16 -
      forest * 0.22 -
      humidity * 0.13 -
      cloud * 0.1 -
      bodyWarmth * 0.1,
    0,
    1,
  );
  const secondPartialPresence = clamp(0.12 + partialPresence01 * 0.76 + topologyCluster * 0.14 - topologyFundamentalFocus * 0.12, 0, 1);
  const thirdPartialPresence = smoothstep(0.08, 0.9, partialPresence01 + topologyCluster * 0.08 - topologyFundamentalFocus * 0.12);
  const fourthPartialPresence = smoothstep(0.28, 1, partialPresence01 + topologyCluster * 0.12 - topologyFundamentalFocus * 0.16);
  const metallicDispersionB = HUMAN_METALLIC_DISPERSION_B_MAX * metallicResonance ** 1.25;
  const upperSustain = clamp(
    0.14 + airiness * 0.36 + water * 0.16 + builtTexture * 0.18 + metalShimmer * 0.32 - vegetationDamping * 0.36 - bodyWarmth * 0.12,
    0.1,
    1,
  );
  const brightness = clamp(
    0.2 + mineralBrightness * 0.48 + metalShimmer * 0.28 + airiness * 0.26 - vegetationDamping * 0.26 - bodyWarmth * 0.08,
    0,
    1,
  );
  const reverbAbsorption = clamp(humidity * 0.38 + cloud * 0.26 + forest * 0.22 + water * 0.08, 0, 1);
  const reverbSend01 = clamp(
    0.095 + humidity * 0.2 + water * 0.13 + openness * 0.13 + precipitation * 0.055 - cloud * 0.018,
    0.075,
    0.48,
  );
  const reverbTailSeconds = clamp(
    0.42 + openness * 1.25 + water * 0.55 + coldness * 0.24 - humidity * 0.12 - cloud * 0.08 - forest * 0.12,
    0.36,
    2.6,
  );
  const reverbDampingHz = clamp(950 + (1 - reverbAbsorption) * 7200 + openness * 1300 + hardness * 600, 800, 12000);
  const partials = pruneHumanPartials(
    [
      {
        ratio: 1,
        gain01: clamp(fundamentalGain * (1 + (1 - partialPresence01) * 0.1), 0.72, 1.28),
        detuneCents: 0,
        decayScale: 1,
      },
      {
        ratio: materialPartialRatio(2, woodyResonance, metallicResonance, metallicDispersionB),
        gain01:
          clamp(
            (0.15 + hardness * 0.21 + builtTexture * 0.12 + bodyWarmth * 0.08 + metalShimmer * 0.12) *
              upperDamping,
            0.07,
            0.56,
          ) *
          HUMAN_SECOND_PARTIAL_GAIN_SCALE *
          secondPartialPresence,
        detuneCents: 1.2 + builtTexture * 2.2,
        decayScale: clamp((0.82 + upperSustain * 0.28) * (0.72 + secondPartialPresence * 0.28), 0.45, 1),
      },
      {
        ratio: materialPartialRatio(3, woodyResonance, metallicResonance, metallicDispersionB),
        gain01:
          clamp(
            (0.07 + bodyWarmth * 0.16 + openness * 0.08 + builtTexture * 0.12 + water * 0.08 + spectralBloom * 0.08) *
              upperDamping,
            0.02,
            0.48,
          ) * thirdPartialPresence,
        detuneCents: -1.8 - forest * 1.7,
        decayScale: clamp((0.5 + upperSustain * 0.38 + bodyWarmth * 0.08 + water * 0.06) * (0.64 + thirdPartialPresence * 0.36), 0.22, 1),
      },
      {
        ratio: materialPartialRatio(4, woodyResonance, metallicResonance, metallicDispersionB),
        gain01:
          clamp(
            (0.032 + bodyWarmth * 0.12 + hardness * 0.1 + builtTexture * 0.11 + coldness * 0.04 + spectralBloom * 0.06) *
              upperDamping,
            0.01,
            0.34,
          ) * fourthPartialPresence,
        detuneCents: 2.4 + water * 2,
        decayScale: clamp((0.32 + upperSustain * 0.36 + bodyWarmth * 0.06 + hardness * 0.06) * (0.58 + fourthPartialPresence * 0.42), 0.14, 0.9),
      },
    ],
    topologyFundamentalFocus,
    topologyCluster,
    partialPresence01,
  );

  return {
    frequencyHz: voice.frequencyHz * 2 ** ((pulse?.detuneCents ?? 0) / 1200),
    peakGain01: clamp((0.003 + Math.sqrt(voice.gain01) * 0.061) * (pulse?.gainScale01 ?? 1), 0, 0.074),
    attackSeconds: (0.018 - hardness * 0.012) * (pulse?.attackScale ?? 1),
    decaySeconds: clamp(
      (0.22 + openness * 0.45 + airiness * 0.32 + (1 - humidity) * 0.18 + coldness * 0.13 + water * 0.1 - forest * 0.12 - cloud * 0.08) *
        (pulse?.decayScale ?? 1),
      0.16,
      1.8,
    ),
    lowpassHz: clamp((780 + brightness * 12200 + airiness * 1800 - vegetationDamping * 180) * (0.72 + partialPresence01 * 0.28) * (pulse?.filterScale ?? 1), 700, 16500),
    noiseGain01: clamp(
      voice.gain01 *
        (0.003 + hardness * 0.012 + builtTexture * 0.012 + airiness * 0.007 + precipitation * 0.006) *
        (1 - cloud * 0.28),
      0,
      0.035,
    ),
    reverbSend01,
    reverbTailSeconds,
    reverbDampingHz,
    partials,
  };
}

function pruneHumanPartials(
  partials: readonly HumanPluckPartial[],
  topologyFundamentalFocus: number,
  topologyCluster: number,
  partialPresence01: number,
): readonly HumanPluckPartial[] {
  const partialLimit = effectivePartialLimit(
    topologyFundamentalFocus,
    topologyCluster,
    partialPresence01,
  );
  const minimumUpperGain = 0.012 + topologyFundamentalFocus * 0.07 - topologyCluster * 0.012;
  const kept = partials.slice(0, partialLimit).filter((partial, index) => {
    return index === 0 || partial.gain01 >= minimumUpperGain;
  });

  return kept.length === 0 ? partials.slice(0, 1) : kept;
}

function effectivePartialLimit(
  topologyFundamentalFocus: number,
  topologyCluster: number,
  partialPresence01: number,
): number {
  if (topologyFundamentalFocus > 0.68 && topologyCluster < 0.36 && partialPresence01 < 0.5) {
    return 1;
  }
  if (topologyFundamentalFocus > 0.48 && topologyCluster < 0.48 && partialPresence01 < 0.62) {
    return 2;
  }
  if (topologyCluster > 0.58 || partialPresence01 > 0.7) {
    return HUMAN_CANONICAL_PARTIAL_COUNT;
  }
  return 3;
}

function materialPartialRatio(
  partialIndex: number,
  woodyResonance: number,
  metallicResonance: number,
  metallicDispersionB: number,
): number {
  const woodOffset = HUMAN_WOOD_PARTIAL_OFFSETS[partialIndex] ?? partialIndex * 0.018;
  const woodRatio = partialIndex + woodOffset * (0.45 + woodyResonance * 0.55);
  const metalRatio = dispersionPartialRatio(partialIndex, metallicDispersionB);
  const metalMorph = smoothstep(0.16, 0.78, metallicResonance) * (1 - woodyResonance * 0.28);

  return lerp(woodRatio, metalRatio, clamp(metalMorph, 0, 1));
}

function dispersionPartialRatio(partialIndex: number, dispersionB: number): number {
  return partialIndex * Math.sqrt((1 + dispersionB * partialIndex * partialIndex) / (1 + dispersionB));
}

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

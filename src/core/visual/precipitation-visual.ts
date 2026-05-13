import type { PenumbraWaterTextureParams } from "../audio/penumbra-earth-texture-params";
import {
  canonicalWaterHighDropletDensityHz,
  canonicalWaterHighDropletEventsInWindow,
  type PenumbraScheduledWaterHighDropletEvent,
} from "../audio/water-droplet-events";
import { hashUint32, hashUint32To01 } from "../audio/utc-event-field";
import type { PrecipitationBandField, PrecipitationBandSample } from "../fusion/precipitation-band";
import type { CanonicalScanlineSample } from "../fusion/scanline-sample";
import { clamp, normalizeDegrees180 } from "../scanline/geometry";

export interface PrecipitationVisualParticle {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly radius: number;
  readonly strength01: number;
  readonly age01: number;
}

export interface PrecipitationVisualInput {
  readonly samples: readonly CanonicalScanlineSample[];
  readonly epochMs: number;
  readonly water: PenumbraWaterTextureParams;
  readonly precipitationBand?: PrecipitationBandField;
  readonly highDropletEvents?: readonly PenumbraScheduledWaterHighDropletEvent[];
}

interface RainCandidate {
  readonly id: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly precipitation01: number;
  readonly scanlineWeight: number;
  readonly cellCount: number;
  readonly weight: number;
}

const RAIN_VISUAL_BASE_RADIUS = 1.009;
const RAIN_VISUAL_FALL_RADIUS = 0.022;
const RAIN_VISUAL_MIN_PRECIPITATION_MM = 0.001;
const RAIN_VISUAL_BAND_CLUSTER_DEG = 8;
const RAIN_VISUAL_BAND_CLUSTER_MIN_WEIGHT = 0.04;
const RAIN_VISUAL_MAX_PARTICLES = 192;
const RAIN_VISUAL_CLUSTER_MIN_SLOTS = 2;
const RAIN_VISUAL_CLUSTER_MAX_SLOTS = 7;

export function precipitationVisualParticles(input: PrecipitationVisualInput): PrecipitationVisualParticle[] {
  const usesScheduledHighDropletEvents = input.highDropletEvents != null;
  const visualDensityHz = precipitationVisualDensityHzForWater(input.water);
  const gain01 = clamp(input.water.dropletGain01 * input.water.highLevel01, 0, 0.32);
  if (!usesScheduledHighDropletEvents && (visualDensityHz <= 0.01 || gain01 <= 0.0004)) {
    return [];
  }

  const candidates = rainCandidates(input.samples, input.precipitationBand);
  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (candidates.length === 0 || totalWeight <= 0) {
    return [];
  }

  const lifetimeMs = rainVisualLifetimeMs(input.water);
  const events =
    input.highDropletEvents != null
      ? input.highDropletEvents.filter(
          (event) =>
            event.scheduledUtcMs <= input.epochMs &&
            event.scheduledUtcMs >= input.epochMs - lifetimeMs,
        )
      : canonicalWaterHighDropletEventsInWindow({
          densityHz: input.water.highDensityHz,
          level01: input.water.highLevel01,
          windowStartUtcMs: input.epochMs - lifetimeMs,
          windowEndUtcMs: input.epochMs,
        });
  const useClusterEnvelope = (input.precipitationBand?.samples.length ?? 0) > 0;
  const particles: PrecipitationVisualParticle[] = [];

  for (const event of events) {
    const ageMs = input.epochMs - event.scheduledUtcMs;
    const age01 = clamp(ageMs / lifetimeMs, 0, 1);
    const candidate = weightedCandidateAt(
      candidates,
      totalWeight,
      hashUint32To01(event.randomSeed ^ 0x165667b1),
    );
    if (!candidate) {
      continue;
    }

    const clusterSlotKey = useClusterEnvelope
      ? rainVisualClusterSlotKey(candidate, event.randomSeed)
      : undefined;
    particles.push(precipitationParticleForEvent({
      candidate,
      randomSeed: event.randomSeed,
      age01,
      water: input.water,
      gain01,
      eventStrength01: event.velocity01,
      clusterSlotKey,
    }));
  }

  return particles
    .sort((left, right) => right.strength01 - left.strength01)
    .slice(0, RAIN_VISUAL_MAX_PARTICLES);
}

function rainCandidates(
  samples: readonly CanonicalScanlineSample[],
  precipitationBand: PrecipitationBandField | undefined,
): RainCandidate[] {
  if (precipitationBand?.samples.length) {
    return clusterBandRainCandidates(precipitationBand.samples);
  }

  return samples.flatMap((sample) => {
    if (!sample.layers.earth.active || sample.weather.precipitationMm <= RAIN_VISUAL_MIN_PRECIPITATION_MM) {
      return [];
    }

    const precipitation01 = clamp(sample.weather.precipitationMm / 8, 0, 1);
    if (precipitation01 <= 0) {
      return [];
    }

    return [
      {
        id: `sample:${sample.cellId}`,
        latitudeDeg: sample.latitudeDeg,
        longitudeDeg: sample.longitudeDeg,
        precipitation01,
        scanlineWeight: sample.scanlineWeight,
        cellCount: 1,
        weight: rainCandidateWeight(precipitation01, sample.scanlineWeight),
      },
    ];
  });
}

function clusterBandRainCandidates(samples: readonly PrecipitationBandSample[]): RainCandidate[] {
  const clusters = new Map<string, {
    latitudeWeighted: number;
    longitudeWeighted: number;
    precipitationWeighted: number;
    scanlineWeighted: number;
    totalWeight: number;
    cellCount: number;
    latBucket: number;
    lonBucket: number;
  }>();

  for (const sample of samples) {
    const cellWeight = rainCandidateWeight(sample.precipitation01, sample.scanlineWeight);
    if (cellWeight <= RAIN_VISUAL_BAND_CLUSTER_MIN_WEIGHT) {
      continue;
    }

    const latBucket = Math.floor((sample.latitudeDeg + 90) / RAIN_VISUAL_BAND_CLUSTER_DEG);
    const lonBucket = Math.floor((normalizeDegrees180(sample.longitudeDeg) + 180) / RAIN_VISUAL_BAND_CLUSTER_DEG);
    const key = `${latBucket}:${lonBucket}`;
    const cluster = clusters.get(key) ?? {
      latitudeWeighted: 0,
      longitudeWeighted: 0,
      precipitationWeighted: 0,
      scanlineWeighted: 0,
      totalWeight: 0,
      cellCount: 0,
      latBucket,
      lonBucket,
    };

    cluster.latitudeWeighted += sample.latitudeDeg * cellWeight;
    cluster.longitudeWeighted += sample.longitudeDeg * cellWeight;
    cluster.precipitationWeighted += sample.precipitation01 * cellWeight;
    cluster.scanlineWeighted += sample.scanlineWeight * cellWeight;
    cluster.totalWeight += cellWeight;
    cluster.cellCount += 1;
    clusters.set(key, cluster);
  }

  return Array.from(clusters.values())
    .map((cluster) => {
      const latitudeDeg = cluster.latitudeWeighted / cluster.totalWeight;
      const longitudeDeg = normalizeDegrees180(cluster.longitudeWeighted / cluster.totalWeight);
      const precipitation01 = clamp(cluster.precipitationWeighted / cluster.totalWeight, 0, 1);
      const scanlineWeight = clamp(cluster.scanlineWeighted / cluster.totalWeight, 0, 1);
      return {
        id: `cluster:${cluster.latBucket}:${cluster.lonBucket}`,
        latitudeDeg,
        longitudeDeg,
        precipitation01,
        scanlineWeight,
        cellCount: cluster.cellCount,
        weight: rainCandidateWeight(precipitation01, scanlineWeight) * Math.sqrt(cluster.cellCount),
      };
    })
    .filter((candidate) => candidate.weight > 0);
}

function rainCandidateWeight(precipitation01: number, scanlineWeight: number): number {
  return Math.pow(clamp(precipitation01, 0, 1), 0.54) * (0.26 + clamp(scanlineWeight, 0, 1) * 0.74);
}

function weightedCandidateAt(
  candidates: readonly RainCandidate[],
  totalWeight: number,
  selector01: number,
): RainCandidate | undefined {
  const target = clamp(selector01, 0, 0.999999) * totalWeight;
  let cursor = 0;

  for (const candidate of candidates) {
    cursor += candidate.weight;
    if (target <= cursor) {
      return candidate;
    }
  }

  return candidates.at(-1);
}

function precipitationParticleForEvent(input: {
  readonly candidate: RainCandidate;
  readonly randomSeed: number;
  readonly age01: number;
  readonly water: PenumbraWaterTextureParams;
  readonly gain01: number;
  readonly eventStrength01?: number;
  readonly clusterSlotKey?: string;
}): PrecipitationVisualParticle {
  const { candidate, randomSeed, age01, water, gain01, eventStrength01, clusterSlotKey } = input;
  const materialSeed = hashUint32(
    clusterSlotKey
      ? `rain-visual:${clusterSlotKey}:event:${randomSeed}`
      : `rain-visual:${randomSeed}:${candidate.id}`,
  );
  const lateral01 = hashUint32To01(materialSeed ^ 0x7f4a7c15);
  const angle01 = hashUint32To01(materialSeed ^ 0x85ebca6b);
  const fallJitter01 = hashUint32To01(materialSeed ^ 0xc2b2ae35);
  const brightnessJitter01 = hashUint32To01(materialSeed ^ 0x27d4eb2d);
  const clusterScale01 = clamp(Math.log2(candidate.cellCount + 1) / 4, 0, 1);
  const spreadDeg = 0.14 + Math.sqrt(candidate.precipitation01) * 0.42 + clusterScale01 * 0.42;
  const angle = angle01 * Math.PI * 2;
  const distanceDeg = Math.sqrt(lateral01) * spreadDeg;
  const latitudeDeg = clamp(
    candidate.latitudeDeg + Math.sin(angle) * distanceDeg,
    -89.6,
    89.6,
  );
  const longitudeScale = Math.max(0.28, Math.cos(latitudeDeg * Math.PI / 180));
  const longitudeDeg = normalizeDegrees180(
    candidate.longitudeDeg + Math.cos(angle) * distanceDeg / longitudeScale,
  );
  const fall01 = Math.pow(age01, 0.72) * (0.74 + fallJitter01 * 0.34);
  const radius =
    RAIN_VISUAL_BASE_RADIUS +
    RAIN_VISUAL_FALL_RADIUS * (1 - clamp(fall01, 0, 1)) *
      (0.72 + water.highLevel01 * 0.28 + water.brightness01 * 0.1);
  const ageFade01 = Math.pow(1 - age01, 0.68);
  const eventPresence01 = clamp(
    0.5 +
      candidate.precipitation01 * 0.28 +
      water.brightness01 * 0.16 +
      water.highLevel01 * 0.12 +
      Math.sqrt(gain01 / 0.32) * 0.16 +
      (eventStrength01 ?? 0) * 0.16,
    0,
    1,
  );
  const strength01 = clamp(ageFade01 * eventPresence01 * (0.82 + brightnessJitter01 * 0.34), 0, 1);

  return {
    latitudeDeg,
    longitudeDeg,
    radius,
    strength01,
    age01,
  };
}

function rainVisualClusterSlotKey(candidate: RainCandidate, randomSeed: number): string {
  const slotCount = rainVisualClusterSlotCount(candidate);
  const slotIndex = Math.floor(
    hashUint32To01(randomSeed ^ hashUint32(`${candidate.id}:rain-slot`)) * slotCount,
  );
  return `${candidate.id}:slot:${slotIndex}`;
}

function rainVisualClusterSlotCount(candidate: RainCandidate): number {
  const clusterScale01 = clamp(Math.log2(candidate.cellCount + 1) / 4, 0, 1);
  return clamp(
    Math.round(
      RAIN_VISUAL_CLUSTER_MIN_SLOTS +
        clusterScale01 * 3 +
        clamp(candidate.precipitation01, 0, 1) * 2,
    ),
    RAIN_VISUAL_CLUSTER_MIN_SLOTS,
    RAIN_VISUAL_CLUSTER_MAX_SLOTS,
  );
}

function rainVisualLifetimeMs(water: PenumbraWaterTextureParams): number {
  return clamp(
    2200 + water.highLevel01 * 1400 + water.brightness01 * 800,
    1800,
    4400,
  );
}

export function precipitationVisualDensityHzForWater(water: PenumbraWaterTextureParams): number {
  return canonicalWaterHighDropletDensityHz(water.highDensityHz);
}

import { hashUint32, hashUint32To01 } from "./utc-event-field";

export type PenumbraWaterDropletEventBand = "low" | "mid" | "high";

export interface PenumbraScheduledWaterDropletEvent {
  readonly scheduledUtcMs: number;
  readonly randomSeed: number;
  readonly velocity01: number;
}

export interface PenumbraCanonicalWaterDropletEvent
  extends PenumbraScheduledWaterDropletEvent {
  readonly band: PenumbraWaterDropletEventBand;
  readonly slotIndex: number;
  readonly densityHz: number;
}

export interface PenumbraCanonicalWaterDropletEventsInput {
  readonly band: PenumbraWaterDropletEventBand;
  readonly densityHz: number;
  readonly level01: number;
  readonly windowStartUtcMs: number;
  readonly windowEndUtcMs: number;
}

export type PenumbraScheduledWaterHighDropletEvent = PenumbraScheduledWaterDropletEvent;

export interface PenumbraCanonicalWaterHighDropletEvent
  extends PenumbraCanonicalWaterDropletEvent {
  readonly band: "high";
}

export interface PenumbraCanonicalWaterHighDropletEventsInput {
  readonly densityHz: number;
  readonly level01: number;
  readonly windowStartUtcMs: number;
  readonly windowEndUtcMs: number;
}

export const WATER_DROPLET_CANONICAL_CLOCK_HZ: Record<PenumbraWaterDropletEventBand, number> = {
  low: 4,
  mid: 6,
  high: 32,
};

export const WATER_HIGH_DROPLET_CANONICAL_CLOCK_HZ = WATER_DROPLET_CANONICAL_CLOCK_HZ.high;

const WATER_DROPLET_DENSITY_QUANTUM_HZ: Record<PenumbraWaterDropletEventBand, number> = {
  low: 0.01,
  mid: 0.01,
  high: 0.02,
};
const WATER_DROPLET_RANDOM_FEEL_01: Record<PenumbraWaterDropletEventBand, number> = {
  low: 0.42,
  mid: 0.46,
  high: 0.5,
};

export function canonicalWaterDropletEventsInWindow(
  input: PenumbraCanonicalWaterDropletEventsInput,
): PenumbraCanonicalWaterDropletEvent[] {
  if (input.windowEndUtcMs <= input.windowStartUtcMs) {
    return [];
  }

  const densityHz = canonicalWaterDropletDensityHz(input.band, input.densityHz);
  if (densityHz <= 0) {
    return [];
  }

  const canonicalClockHz = WATER_DROPLET_CANONICAL_CLOCK_HZ[input.band];
  const periodMs = 1000 / canonicalClockHz;
  const firstSlot = Math.floor(input.windowStartUtcMs / periodMs) - 2;
  const lastSlot = Math.ceil(input.windowEndUtcMs / periodMs) + 2;
  const eventChance01 = clampNumber(densityHz / canonicalClockHz, 0, 1);
  const jitterWidth = lerpNumber(0.24, 0.84, WATER_DROPLET_RANDOM_FEEL_01[input.band]);
  const events: PenumbraCanonicalWaterDropletEvent[] = [];

  for (let slotIndex = firstSlot; slotIndex <= lastSlot; slotIndex += 1) {
    const randomSeed = hashUint32(`water:${input.band}:${slotIndex}:canonical-droplet:v1`);
    if (hashUint32To01(randomSeed ^ 0x41c6ce57) > eventChance01) {
      continue;
    }

    const jitter01 = hashUint32To01(randomSeed ^ 0x9e3779b9);
    const scheduledUtcMs = Math.round(
      (slotIndex + 0.5 + (jitter01 - 0.5) * jitterWidth) * periodMs,
    );

    if (scheduledUtcMs > input.windowStartUtcMs && scheduledUtcMs <= input.windowEndUtcMs) {
      events.push({
        band: input.band,
        slotIndex,
        scheduledUtcMs,
        randomSeed,
        velocity01: canonicalWaterDropletVelocity01(randomSeed, input.level01),
        densityHz,
      });
    }
  }

  return events.sort((left, right) => left.scheduledUtcMs - right.scheduledUtcMs);
}

export function canonicalWaterDropletDensityHz(
  band: PenumbraWaterDropletEventBand,
  sourceDensityHz: number,
): number {
  const clamped = clampNumber(sourceDensityHz, 0, WATER_DROPLET_CANONICAL_CLOCK_HZ[band]);
  const quantum = WATER_DROPLET_DENSITY_QUANTUM_HZ[band];
  return Math.round(clamped / quantum) * quantum;
}

export function canonicalWaterDropletVelocity01(randomSeed: number, level01: number): number {
  return clampNumber(
    (0.34 + hashUint32To01(randomSeed ^ 0x27d4eb2d) * 0.66) *
      Math.sqrt(clampNumber(level01, 0, 1)),
    0,
    1,
  );
}

export function canonicalWaterHighDropletEventsInWindow(
  input: PenumbraCanonicalWaterHighDropletEventsInput,
): PenumbraCanonicalWaterHighDropletEvent[] {
  return canonicalWaterDropletEventsInWindow({
    ...input,
    band: "high",
  }) as PenumbraCanonicalWaterHighDropletEvent[];
}

export function canonicalWaterHighDropletDensityHz(sourceDensityHz: number): number {
  return canonicalWaterDropletDensityHz("high", sourceDensityHz);
}

export function canonicalWaterHighDropletVelocity01(randomSeed: number, level01: number): number {
  return canonicalWaterDropletVelocity01(randomSeed, level01);
}

function lerpNumber(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

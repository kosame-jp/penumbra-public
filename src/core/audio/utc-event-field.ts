export interface UtcSeededAudioEvent {
  readonly slotIndex: number;
  readonly scheduledUtcMs: number;
  readonly randomSeed: number;
}

const DEFAULT_UTC_EVENT_RANDOM_FEEL = 0.5;

export function utcSeededAudioEventsInWindow(
  eventKind: string,
  densityHz: number,
  windowStartUtcMs: number,
  windowEndUtcMs: number,
  randomFeel01 = DEFAULT_UTC_EVENT_RANDOM_FEEL,
): UtcSeededAudioEvent[] {
  if (windowEndUtcMs <= windowStartUtcMs) {
    return [];
  }

  const safeDensityHz = Math.max(0.1, Math.min(80, densityHz));
  const periodMs = 1000 / safeDensityHz;
  const firstSlot = Math.floor(windowStartUtcMs / periodMs) - 2;
  const lastSlot = Math.ceil(windowEndUtcMs / periodMs) + 2;
  const jitterWidth = lerpNumber(0.24, 0.84, clampNumber(randomFeel01, 0, 1));
  const events: UtcSeededAudioEvent[] = [];

  for (let slotIndex = firstSlot; slotIndex <= lastSlot; slotIndex += 1) {
    const randomSeed = hashUint32(`${eventKind}:${slotIndex}:utc-field:v1`);
    const jitter01 = hashUint32To01(randomSeed ^ 0x9e3779b9);
    const scheduledUtcMs = Math.round(
      (slotIndex + 0.5 + (jitter01 - 0.5) * jitterWidth) * periodMs,
    );

    if (scheduledUtcMs > windowStartUtcMs && scheduledUtcMs <= windowEndUtcMs) {
      events.push({ slotIndex, scheduledUtcMs, randomSeed });
    }
  }

  return events.sort((left, right) => left.scheduledUtcMs - right.scheduledUtcMs);
}

export function hashUint32(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.max(1, hash >>> 0);
}

export function hashUint32To01(seed: number): number {
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

function lerpNumber(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

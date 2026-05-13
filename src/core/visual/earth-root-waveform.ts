export interface EarthBeatEnvelopePoint {
  readonly x: number;
  readonly y: number;
}

const DEFAULT_BEAT_POINT_COUNT = 96;
const DEFAULT_BEAT_AMPLITUDE = 0.74;
const DEFAULT_BEAT_WINDOW_SECONDS = 1;
const TAU = Math.PI * 2;

export function earthRootHzFromDroneRootHz(droneRootHz: number): number {
  if (!Number.isFinite(droneRootHz) || droneRootHz <= 0) {
    return 0;
  }

  return droneRootHz * 0.5;
}

export function createEarthDetuneBeatEnvelope(input: {
  readonly droneRootHz: number;
  readonly companionHz: number;
  readonly detuneAmount01: number;
  readonly beatPhase01: number;
  readonly windowSeconds?: number;
  readonly pointCount?: number;
  readonly amplitude?: number;
}): readonly EarthBeatEnvelopePoint[] {
  const droneRootHz = input.droneRootHz;
  const companionHz = input.companionHz;
  if (
    !Number.isFinite(droneRootHz) ||
    !Number.isFinite(companionHz) ||
    droneRootHz <= 0 ||
    companionHz <= 0
  ) {
    return [];
  }

  const windowSeconds = clampNumber(
    input.windowSeconds ?? DEFAULT_BEAT_WINDOW_SECONDS,
    0.25,
    60,
  );
  const pointCount = Math.max(2, Math.floor(input.pointCount ?? DEFAULT_BEAT_POINT_COUNT));
  const amplitude = clampNumber(input.amplitude ?? DEFAULT_BEAT_AMPLITUDE, 0, 1);
  const beatHz = Math.abs(companionHz - droneRootHz);
  const detuneAmount01 = clampNumber(input.detuneAmount01, 0, 1);
  const currentPhase01 = positiveModulo(input.beatPhase01, 1);
  const points: EarthBeatEnvelopePoint[] = [];

  for (let index = 0; index < pointCount; index += 1) {
    const x01 = index / Math.max(1, pointCount - 1);
    const samplePhase01 = currentPhase01 - beatHz * windowSeconds * (1 - x01);
    const beat01 = beatHz > 0.000001
      ? (1 - Math.cos(TAU * samplePhase01)) * 0.5
      : 0;
    const envelope01 = detuneAmount01 * beat01;
    points.push({
      x: -1 + x01 * 2,
      y: 0.82 - envelope01 * amplitude * 1.64,
    });
  }

  return points;
}

export function earthDetuneBeatEnvelopeLevel01(input: {
  readonly droneRootHz: number;
  readonly companionHz: number;
  readonly detuneAmount01: number;
  readonly beatPhase01: number;
}): number {
  const droneRootHz = input.droneRootHz;
  const companionHz = input.companionHz;
  if (
    !Number.isFinite(droneRootHz) ||
    !Number.isFinite(companionHz) ||
    !Number.isFinite(input.beatPhase01) ||
    droneRootHz <= 0 ||
    companionHz <= 0
  ) {
    return 0;
  }

  const beatHz = Math.abs(companionHz - droneRootHz);
  if (beatHz <= 0.000001) {
    return 0;
  }

  const phase01 = positiveModulo(input.beatPhase01, 1);
  const beat01 = (1 - Math.cos(TAU * phase01)) * 0.5;
  return clampNumber(input.detuneAmount01, 0, 1) * beat01;
}

function positiveModulo(value: number, modulo: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(modulo) || modulo <= 0) {
    return 0;
  }

  return ((value % modulo) + modulo) % modulo;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

import type { HumanVoiceCandidate } from "./human-voice-candidates";
import { DEFAULT_SCANLINE_SIGMA_DEG } from "../scanline/gaussian";
import { clamp } from "../scanline/geometry";

export const HUMAN_PULSE_MIN_GAIN = 0;
export const HUMAN_PULSE_MAX_CATCHUP_SECONDS = 2.5;
export const HUMAN_PULSE_MIN_PERIOD_SECONDS = 2.6;
export const HUMAN_PULSE_MAX_PERIOD_SECONDS = 48;
export const HUMAN_PULSE_EDGE_MIN_EMIT_PROBABILITY = 0.03;
export const HUMAN_PULSE_DENSITY_REFERENCE_CONTACTS_5DEG = 72;
export const HUMAN_PULSE_DENSITY_MAX_PERIOD_SCALE = 24;
export const HUMAN_PULSE_DENSITY_MAX_PERIOD_SECONDS = 240;
export const HUMAN_PULSE_FOCUS_MIN_SIGMA_DEG = 4;
export const HUMAN_PULSE_FOCUS_FULL_DENSITY_SCALE = 6;
export const HUMAN_PULSE_CORE_DENSITY_PERIOD_SHARE = 0.32;
export const HUMAN_PULSE_SPARSE_EDGE_EMIT_FLOOR = 0.07;
export const HUMAN_PULSE_DENSE_CENTER_EMIT_CEILING = 0.82;
export const HUMAN_PULSE_SPARSE_EMIT_CURVE = 1.45;
export const HUMAN_PULSE_DENSE_EMIT_CURVE = 2.75;

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.2425;

export interface HumanPulseProfile {
  readonly periodSeconds: number;
  readonly phaseSeconds: number;
  readonly maxJitterSeconds: number;
  readonly emitProbability01: number;
  readonly focusedScanlineWeight: number;
  readonly focusSigmaScale: number;
  readonly localDensityPeriodScale: number;
  readonly dayIndex: number;
}

export interface HumanPulseEvent {
  readonly scheduledUtcMs: number;
  readonly pulseIndex: number;
  readonly timingJitterSeconds: number;
  readonly detuneCents: number;
  readonly gainScale01: number;
  readonly attackScale: number;
  readonly decayScale: number;
  readonly filterScale: number;
}

export interface HumanPulseWindow {
  readonly voice: HumanVoiceCandidate;
  readonly previousUtcMs: number;
  readonly currentUtcMs: number;
  readonly ensembleDensityPeriodScale?: number;
}

export function nextHumanPulseEvent(input: HumanPulseWindow): HumanPulseEvent | undefined {
  if (
    input.voice.gain01 < HUMAN_PULSE_MIN_GAIN ||
    input.currentUtcMs <= input.previousUtcMs ||
    input.currentUtcMs - input.previousUtcMs > HUMAN_PULSE_MAX_CATCHUP_SECONDS * 1000
  ) {
    return undefined;
  }

  const profile = deriveHumanPulseProfile(
    input.voice,
    input.currentUtcMs,
    input.ensembleDensityPeriodScale,
  );
  const previousSeconds = input.previousUtcMs / 1000;
  const currentSeconds = input.currentUtcMs / 1000;
  const firstPulseIndex = Math.floor(
    (previousSeconds - profile.phaseSeconds - profile.maxJitterSeconds) / profile.periodSeconds,
  );
  const lastPulseIndex = Math.ceil(
    (currentSeconds - profile.phaseSeconds + profile.maxJitterSeconds) / profile.periodSeconds,
  );

  for (let pulseIndex = firstPulseIndex; pulseIndex <= lastPulseIndex; pulseIndex += 1) {
    const event = humanPulseEventAtIndex(input.voice, profile, pulseIndex);
    if (
      event.scheduledUtcMs > input.previousUtcMs &&
      event.scheduledUtcMs <= input.currentUtcMs &&
      humanPulsePassesEmitGate(input.voice, profile, pulseIndex)
    ) {
      return event;
    }
  }

  return undefined;
}

export function deriveHumanPulseProfile(
  voice: HumanVoiceCandidate,
  utcEpochMs: number,
  ensembleDensityPeriodScale = 1,
): HumanPulseProfile {
  const dayIndex = Math.floor(utcEpochMs / DAY_MS);
  const dayOfYear = utcDayOfYear(utcEpochMs);
  const season = Math.sin((dayOfYear / YEAR_DAYS) * Math.PI * 2);
  const nightLightNorm = clamp(voice.nightLightNorm, 0, 1);
  const scanlineNorm = clamp(voice.scanlineWeight, 0, 1);
  const basePeriod = 3.2 + hash01(`${voice.id}:period`) * 5.8;
  const densityFactor = 1.36 - Math.sqrt(nightLightNorm) * 0.58;
  const dailyDrift = 1 + hashSigned(`${voice.id}:day:${dayIndex}`) * 0.09;
  const seasonalDrift = 1 + season * hashSigned(`${voice.id}:season`) * 0.045;
  const densityPeriodScale = clamp(
    ensembleDensityPeriodScale,
    1,
    HUMAN_PULSE_DENSITY_MAX_PERIOD_SCALE,
  );
  const density01 = humanPulseDensity01(densityPeriodScale);
  const focusSigmaScale = humanPulseFocusSigmaScale(densityPeriodScale);
  const focusedScanlineWeight = humanPulseFocusedScanlineWeight(scanlineNorm, focusSigmaScale);
  const localDensityPeriodScale =
    1 + (densityPeriodScale - 1) * HUMAN_PULSE_CORE_DENSITY_PERIOD_SHARE;
  const maxPeriodSeconds = clamp(
    HUMAN_PULSE_MAX_PERIOD_SECONDS * localDensityPeriodScale,
    HUMAN_PULSE_MAX_PERIOD_SECONDS,
    HUMAN_PULSE_DENSITY_MAX_PERIOD_SECONDS,
  );
  const periodSeconds = clamp(
    basePeriod *
      densityFactor *
      dailyDrift *
      seasonalDrift *
      localDensityPeriodScale,
    HUMAN_PULSE_MIN_PERIOD_SECONDS,
    maxPeriodSeconds,
  );
  const seasonalPhase = season * hashSigned(`${voice.id}:season-phase`) * 0.8;
  const phaseSeconds = positiveModulo(
    hash01(`${voice.id}:phase`) * periodSeconds + seasonalPhase,
    periodSeconds,
  );
  const maxJitterSeconds = clamp(
    0.018 +
      voice.nightLightTopology.edge01 * 0.12 +
      voice.nightLightTopology.isolation01 * 0.07 +
      voice.nightLightTopology.continuity01 * 0.035,
    0.015,
    0.32,
  );
  const emitFloor = lerp(
    HUMAN_PULSE_SPARSE_EDGE_EMIT_FLOOR,
    HUMAN_PULSE_EDGE_MIN_EMIT_PROBABILITY,
    density01,
  );
  const emitCeiling = lerp(
    1,
    HUMAN_PULSE_DENSE_CENTER_EMIT_CEILING,
    density01,
  );
  const emitCurve = lerp(HUMAN_PULSE_SPARSE_EMIT_CURVE, HUMAN_PULSE_DENSE_EMIT_CURVE, density01);
  const emitProbability01 = clamp(
    emitFloor + Math.pow(focusedScanlineWeight, emitCurve) * (emitCeiling - emitFloor),
    emitFloor,
    emitCeiling,
  );

  return {
    periodSeconds,
    phaseSeconds,
    maxJitterSeconds,
    emitProbability01,
    focusedScanlineWeight,
    focusSigmaScale,
    localDensityPeriodScale,
    dayIndex,
  };
}

export function humanEnsembleDensityPeriodScale(candidateCount: number): number {
  const count = Math.max(0, Math.floor(candidateCount));
  if (count <= HUMAN_PULSE_DENSITY_REFERENCE_CONTACTS_5DEG) {
    return 1;
  }

  return clamp(
    count / HUMAN_PULSE_DENSITY_REFERENCE_CONTACTS_5DEG,
    1,
    HUMAN_PULSE_DENSITY_MAX_PERIOD_SCALE,
  );
}

export function humanPulseFocusSigmaScale(ensembleDensityPeriodScale: number): number {
  const minFocusScale = clamp(
    HUMAN_PULSE_FOCUS_MIN_SIGMA_DEG / DEFAULT_SCANLINE_SIGMA_DEG,
    0.35,
    1,
  );
  const density01 = humanPulseDensity01(ensembleDensityPeriodScale);

  return clamp(1 - density01 * (1 - minFocusScale), minFocusScale, 1);
}

export function humanPulseFocusedScanlineWeight(
  scanlineWeight: number,
  focusSigmaScale: number,
): number {
  const weight = clamp(scanlineWeight, 0, 1);
  const sigmaScale = clamp(focusSigmaScale, 0.35, 1);

  if (weight <= 0 || weight >= 1 || sigmaScale >= 0.999) {
    return weight;
  }

  return clamp(weight ** (1 / (sigmaScale ** 2)), 0, 1);
}

export function humanPulseEventAtIndex(
  voice: HumanVoiceCandidate,
  profile: HumanPulseProfile,
  pulseIndex: number,
): HumanPulseEvent {
  const eventSeed = `${voice.id}:pulse:${profile.dayIndex}:${pulseIndex}`;
  const timingJitterSeconds = hashSigned(`${eventSeed}:time`) * profile.maxJitterSeconds;
  const scheduledUtcMs = Math.round(
    (profile.phaseSeconds + pulseIndex * profile.periodSeconds + timingJitterSeconds) * 1000,
  );
  const looseness = 1 + voice.windNorm * 0.8 + voice.precipitationNorm * 0.45 + voice.cloudNorm * 0.25;

  return {
    scheduledUtcMs,
    pulseIndex,
    timingJitterSeconds,
    detuneCents: hashSigned(`${eventSeed}:detune`) * (1.2 + looseness * 2.4),
    gainScale01: clamp(0.78 + hashSigned(`${eventSeed}:gain`) * 0.18 + voice.scanlineWeight * 0.12, 0.55, 1.08),
    attackScale: clamp(1 + hashSigned(`${eventSeed}:attack`) * 0.16 + voice.windNorm * 0.08, 0.72, 1.28),
    decayScale: clamp(1 + hashSigned(`${eventSeed}:decay`) * 0.18 + voice.humidityNorm * 0.08, 0.72, 1.32),
    filterScale: clamp(1 + hashSigned(`${eventSeed}:filter`) * 0.14 - voice.cloudNorm * 0.08, 0.72, 1.18),
  };
}

function utcDayOfYear(utcEpochMs: number): number {
  const date = new Date(utcEpochMs);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((utcEpochMs - yearStart) / DAY_MS);
}

function hash01(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function hashSigned(input: string): number {
  return hash01(input) * 2 - 1;
}

function humanPulsePassesEmitGate(
  voice: HumanVoiceCandidate,
  profile: HumanPulseProfile,
  pulseIndex: number,
): boolean {
  if (profile.emitProbability01 >= 0.999) {
    return true;
  }

  return hash01(`${voice.id}:density:${profile.dayIndex}:${pulseIndex}`) <= profile.emitProbability01;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function humanPulseDensity01(ensembleDensityPeriodScale: number): number {
  return smoothstep(1, HUMAN_PULSE_FOCUS_FULL_DENSITY_SCALE, ensembleDensityPeriodScale);
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * clamp(amount, 0, 1);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

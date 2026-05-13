import { QUAKE_WINDOW_MINUTES } from "../live-data/quake-store";
import { clamp } from "../scanline/geometry";

export const QUAKE_PULSE_MAX_CATCHUP_SECONDS = 2.5;
export const QUAKE_PULSE_MIN_PERIOD_SECONDS = 3.8;
export const QUAKE_PULSE_MAX_PERIOD_SECONDS = 72;

const QUAKE_WINDOW_MS = QUAKE_WINDOW_MINUTES * 60_000;

export interface QuakePulseContact {
  readonly id: string;
  readonly eventTimeUtc: string;
  readonly magnitude: number;
  readonly scanlineWeight: number;
  readonly gain01: number;
  readonly depthDarkness01: number;
}

export interface QuakePulseProfile {
  readonly eventEpochMs: number;
  readonly periodSeconds: number;
  readonly phaseSeconds: number;
  readonly maxJitterSeconds: number;
  readonly emitProbability01: number;
  readonly age01: number;
}

export interface QuakePulseEvent {
  readonly scheduledUtcMs: number;
  readonly pulseIndex: number;
  readonly gainScale01: number;
  readonly resonancePartialIndex: number;
  readonly resonanceGainScale01: number;
  readonly noiseGainScale01: number;
  readonly attackSeconds: number;
  readonly decaySeconds: number;
}

export interface QuakePulseWindow {
  readonly contact: QuakePulseContact;
  readonly previousUtcMs: number;
  readonly currentUtcMs: number;
}

export function nextQuakePulseEvent(input: QuakePulseWindow): QuakePulseEvent | undefined {
  if (
    input.contact.gain01 <= 0 ||
    input.currentUtcMs <= input.previousUtcMs ||
    input.currentUtcMs - input.previousUtcMs > QUAKE_PULSE_MAX_CATCHUP_SECONDS * 1000
  ) {
    return undefined;
  }

  const profile = deriveQuakePulseProfile(input.contact, input.currentUtcMs);
  if (!profile) {
    return undefined;
  }

  const previousSeconds = (input.previousUtcMs - profile.eventEpochMs) / 1000;
  const currentSeconds = (input.currentUtcMs - profile.eventEpochMs) / 1000;
  const firstPulseIndex = Math.floor(
    (previousSeconds - profile.phaseSeconds - profile.maxJitterSeconds) / profile.periodSeconds,
  );
  const lastPulseIndex = Math.ceil(
    (currentSeconds - profile.phaseSeconds + profile.maxJitterSeconds) / profile.periodSeconds,
  );

  for (let pulseIndex = firstPulseIndex; pulseIndex <= lastPulseIndex; pulseIndex += 1) {
    const event = quakePulseEventAtIndex(input.contact, profile, pulseIndex);
    if (
      event.scheduledUtcMs > input.previousUtcMs &&
      event.scheduledUtcMs <= input.currentUtcMs &&
      quakePulsePassesDensityGate(input.contact, profile, pulseIndex)
    ) {
      return event;
    }
  }

  return undefined;
}

export function deriveQuakePulseProfile(
  contact: QuakePulseContact,
  utcEpochMs: number,
): QuakePulseProfile | undefined {
  const eventEpochMs = Date.parse(contact.eventTimeUtc);
  if (!Number.isFinite(eventEpochMs)) {
    return undefined;
  }

  const ageMs = utcEpochMs - eventEpochMs;
  if (ageMs < 0 || ageMs > QUAKE_WINDOW_MS) {
    return undefined;
  }

  const age01 = clamp(ageMs / QUAKE_WINDOW_MS, 0, 1);
  const magnitude01 = clamp(contact.magnitude / 10, 0, 1);
  const scanlineWeight = clamp(contact.scanlineWeight, 0, 1);
  const depth = clamp(contact.depthDarkness01, 0, 1);
  const basePeriod = 7.5 + hash01(`${contact.id}:${contact.eventTimeUtc}:period`) * 8.5;
  const magnitudeFactor = 1.56 - Math.sqrt(magnitude01) * 0.58;
  const scanlineFactor = 1 + Math.pow(1 - scanlineWeight, 1.45) * 4.2;
  const depthFactor = 1 + depth * 0.18;
  const periodSeconds = clamp(
    basePeriod * magnitudeFactor * scanlineFactor * depthFactor,
    QUAKE_PULSE_MIN_PERIOD_SECONDS,
    QUAKE_PULSE_MAX_PERIOD_SECONDS,
  );
  const phaseSeconds = hash01(`${contact.id}:${contact.eventTimeUtc}:phase`) * periodSeconds;
  const maxJitterSeconds = clamp(0.04 + magnitude01 * 0.13 + depth * 0.07, 0.025, 0.28);
  const emitProbability01 = clamp(
    (0.1 + Math.pow(scanlineWeight, 0.68) * 0.78 + magnitude01 * 0.12) * (1 - age01 * 0.42),
    0.08,
    1,
  );

  return {
    eventEpochMs,
    periodSeconds,
    phaseSeconds,
    maxJitterSeconds,
    emitProbability01,
    age01,
  };
}

export function quakePulseEventAtIndex(
  contact: QuakePulseContact,
  profile: QuakePulseProfile,
  pulseIndex: number,
): QuakePulseEvent {
  const eventSeed = `${contact.id}:${contact.eventTimeUtc}:pulse:${pulseIndex}`;
  const magnitude01 = clamp(contact.magnitude / 10, 0, 1);
  const depth = clamp(contact.depthDarkness01, 0, 1);
  const timingJitterSeconds = hashSigned(`${eventSeed}:time`) * profile.maxJitterSeconds;
  const scheduledUtcMs = Math.round(
    profile.eventEpochMs +
      (profile.phaseSeconds + pulseIndex * profile.periodSeconds + timingJitterSeconds) * 1000,
  );

  return {
    scheduledUtcMs,
    pulseIndex,
    gainScale01: clamp(
      0.62 + Math.sqrt(magnitude01) * 0.28 - profile.age01 * 0.26 + hashSigned(`${eventSeed}:gain`) * 0.14,
      0.18,
      1.08,
    ),
    resonancePartialIndex: 1 + Math.floor(hash01(`${eventSeed}:partial`) * 4),
    resonanceGainScale01: clamp(
      0.2 + (1 - depth) * 0.32 + magnitude01 * 0.18 + hashSigned(`${eventSeed}:resonance`) * 0.08,
      0.08,
      0.76,
    ),
    noiseGainScale01: clamp(
      0.08 + magnitude01 * 0.18 + (1 - depth) * 0.12 + hashSigned(`${eventSeed}:noise`) * 0.04,
      0.02,
      0.38,
    ),
    attackSeconds: clamp(0.006 + depth * 0.018 + hash01(`${eventSeed}:attack`) * 0.006, 0.004, 0.034),
    decaySeconds: clamp(0.28 + depth * 0.42 + magnitude01 * 0.2 + profile.age01 * 0.12, 0.22, 1.12),
  };
}

function quakePulsePassesDensityGate(
  contact: QuakePulseContact,
  profile: QuakePulseProfile,
  pulseIndex: number,
): boolean {
  if (profile.emitProbability01 >= 0.999) {
    return true;
  }

  return hash01(`${contact.id}:${contact.eventTimeUtc}:density:${pulseIndex}`) <= profile.emitProbability01;
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

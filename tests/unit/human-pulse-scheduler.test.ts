import { describe, expect, it } from "vitest";

import {
  deriveHumanPulseProfile,
  humanEnsembleDensityPeriodScale,
  humanPulseFocusedScanlineWeight,
  humanPulseFocusSigmaScale,
  humanPulseEventAtIndex,
  HUMAN_PULSE_MAX_CATCHUP_SECONDS,
  HUMAN_PULSE_FOCUS_MIN_SIGMA_DEG,
  nextHumanPulseEvent,
} from "../../src/core/fusion/human-pulse-scheduler";
import type { HumanVoiceCandidate } from "../../src/core/fusion/human-voice-candidates";
import { DEFAULT_NIGHTLIGHT_TOPOLOGY } from "../../src/core/fusion/scanline-sample";

describe("human contact-local pulse scheduler", () => {
  it("gives different contacts different local pulse profiles", () => {
    const utcMs = Date.parse("2026-05-01T00:00:00.000Z");
    const first = deriveHumanPulseProfile(candidate({ id: "human:a:330", cellId: "a" }), utcMs);
    const second = deriveHumanPulseProfile(candidate({ id: "human:b:330", cellId: "b" }), utcMs);

    expect(first.periodSeconds !== second.periodSeconds || first.phaseSeconds !== second.phaseSeconds).toBe(true);
  });

  it("changes daily modulation deterministically across UTC days", () => {
    const voice = candidate();
    const today = Date.parse("2026-05-01T00:00:00.000Z");
    const tomorrow = Date.parse("2026-05-02T00:00:00.000Z");

    expect(deriveHumanPulseProfile(voice, today)).toEqual(deriveHumanPulseProfile(voice, today));
    expect(deriveHumanPulseProfile(voice, tomorrow).periodSeconds).not.toBeCloseTo(
      deriveHumanPulseProfile(voice, today).periodSeconds,
      8,
    );
  });

  it("emits only when a contact-local pulse crosses the current UTC frame", () => {
    const voice = candidate();
    const utcMs = Date.parse("2026-05-01T00:00:00.000Z");
    const profile = deriveHumanPulseProfile(voice, utcMs);
    const pulseIndex = Math.floor(utcMs / 1000 / profile.periodSeconds) + 1;
    const pulse = humanPulseEventAtIndex(voice, profile, pulseIndex);

    expect(
      nextHumanPulseEvent({
        voice,
        previousUtcMs: pulse.scheduledUtcMs - 20,
        currentUtcMs: pulse.scheduledUtcMs + 20,
      })?.pulseIndex,
    ).toBe(pulseIndex);
    expect(
      nextHumanPulseEvent({
        voice,
        previousUtcMs: pulse.scheduledUtcMs + 20,
        currentUtcMs: pulse.scheduledUtcMs + 40,
      }),
    ).toBeUndefined();
  });

  it("keeps very quiet contacts eligible for occasional pulses", () => {
    const voice = candidate({ gain01: 0.0015 });
    const utcMs = Date.parse("2026-05-01T00:00:00.000Z");
    const profile = deriveHumanPulseProfile(voice, utcMs);
    const pulseIndex = Math.floor(utcMs / 1000 / profile.periodSeconds) + 1;
    const pulse = humanPulseEventAtIndex(voice, profile, pulseIndex);

    expect(
      nextHumanPulseEvent({
        voice,
        previousUtcMs: pulse.scheduledUtcMs - 20,
        currentUtcMs: pulse.scheduledUtcMs + 20,
      }),
    ).toBeDefined();
  });

  it("makes edge contacts sparser without making them impossible", () => {
    const utcMs = Date.parse("2026-05-01T00:00:00.000Z");
    const center = deriveHumanPulseProfile(candidate({ scanlineWeight: 1, gain01: 0.12 }), utcMs);
    const edge = deriveHumanPulseProfile(candidate({ scanlineWeight: 0.08, gain01: 0.12 }), utcMs);

    expect(edge.periodSeconds).toBeCloseTo(center.periodSeconds, 8);
    expect(edge.emitProbability01).toBeGreaterThan(0);
    expect(edge.emitProbability01).toBeLessThan(center.emitProbability01);
  });

  it("stretches edge contacts more than core contacts when the ensemble is dense", () => {
    const utcMs = Date.parse("2026-05-01T00:00:00.000Z");
    const oldGridLikeCount = 68;
    const oneDegreeLikeCount = 666;
    const sparseCore = deriveHumanPulseProfile(
      candidate({ scanlineWeight: 1, gain01: 0.42 }),
      utcMs,
      humanEnsembleDensityPeriodScale(oldGridLikeCount),
    );
    const denseCore = deriveHumanPulseProfile(
      candidate({ scanlineWeight: 1, gain01: 0.42 }),
      utcMs,
      humanEnsembleDensityPeriodScale(oneDegreeLikeCount),
    );
    const denseEdge = deriveHumanPulseProfile(
      candidate({ scanlineWeight: 0.32, gain01: 0.42 }),
      utcMs,
      humanEnsembleDensityPeriodScale(oneDegreeLikeCount),
    );

    expect(humanEnsembleDensityPeriodScale(oldGridLikeCount)).toBe(1);
    expect(humanEnsembleDensityPeriodScale(oneDegreeLikeCount)).toBeCloseTo(
      oneDegreeLikeCount / 72,
      8,
    );
    expect(denseCore.periodSeconds).toBeGreaterThan(sparseCore.periodSeconds * 2);
    expect(denseCore.periodSeconds).toBeLessThan(sparseCore.periodSeconds * 5);
    expect(denseEdge.periodSeconds).toBeCloseTo(denseCore.periodSeconds, 8);
    expect(denseCore.emitProbability01).toBeLessThan(sparseCore.emitProbability01);
    expect(denseCore.emitProbability01).toBeGreaterThan(0.75);
    expect(denseEdge.emitProbability01).toBeLessThan(denseCore.emitProbability01);
    expect(denseEdge.emitProbability01).toBeLessThan(0.08);
    expect(denseCore.focusSigmaScale).toBeCloseTo(HUMAN_PULSE_FOCUS_MIN_SIGMA_DEG / 7, 4);
  });

  it("keeps the pulse clock stable across volatile frame-local drivers", () => {
    const utcMs = Date.parse("2026-05-01T00:00:00.000Z");
    const calm = deriveHumanPulseProfile(
      candidate({
        gain01: 0.04,
        scanlineWeight: 0.18,
        windNorm: 0,
        precipitationNorm: 0,
        humidityNorm: 0.2,
        cloudNorm: 0.1,
      }),
      utcMs,
      humanEnsembleDensityPeriodScale(520),
    );
    const active = deriveHumanPulseProfile(
      candidate({
        gain01: 0.72,
        scanlineWeight: 0.96,
        windNorm: 1,
        precipitationNorm: 1,
        humidityNorm: 0.95,
        cloudNorm: 0.9,
      }),
      utcMs,
      humanEnsembleDensityPeriodScale(520),
    );

    expect(active.periodSeconds).toBeCloseTo(calm.periodSeconds, 8);
    expect(active.phaseSeconds).toBeCloseTo(calm.phaseSeconds, 8);
    expect(active.maxJitterSeconds).toBeCloseTo(calm.maxJitterSeconds, 8);
    expect(active.emitProbability01).toBeGreaterThan(calm.emitProbability01);
  });

  it("narrows the human pulse focus weight under dense contact fields", () => {
    const sparseFocusScale = humanPulseFocusSigmaScale(humanEnsembleDensityPeriodScale(50));
    const denseFocusScale = humanPulseFocusSigmaScale(humanEnsembleDensityPeriodScale(720));

    expect(sparseFocusScale).toBe(1);
    expect(denseFocusScale).toBeLessThan(sparseFocusScale);
    expect(humanPulseFocusedScanlineWeight(1, denseFocusScale)).toBe(1);
    expect(humanPulseFocusedScanlineWeight(0.6, denseFocusScale)).toBeLessThan(0.6);
  });

  it("does not catch up old pulses after a long pause", () => {
    const voice = candidate();
    const utcMs = Date.parse("2026-05-01T00:00:00.000Z");

    expect(
      nextHumanPulseEvent({
        voice,
        previousUtcMs: utcMs,
        currentUtcMs: utcMs + (HUMAN_PULSE_MAX_CATCHUP_SECONDS + 1) * 1000,
      }),
    ).toBeUndefined();
  });

  it("uses stable nightlight topology for pulse jitter", () => {
    const utcMs = Date.parse("2026-05-01T00:00:00.000Z");
    const compact = deriveHumanPulseProfile(
      candidate({
        nightLightTopology: {
          ...DEFAULT_NIGHTLIGHT_TOPOLOGY,
          edge01: 0,
          isolation01: 0,
          continuity01: 0,
        },
      }),
      utcMs,
    );
    const textured = deriveHumanPulseProfile(
      candidate({
        nightLightTopology: {
          ...DEFAULT_NIGHTLIGHT_TOPOLOGY,
          edge01: 1,
          isolation01: 1,
          continuity01: 1,
        },
      }),
      utcMs,
    );

    expect(textured.maxJitterSeconds).toBeGreaterThan(compact.maxJitterSeconds);
  });
});

function candidate(overrides: Partial<HumanVoiceCandidate> = {}): HumanVoiceCandidate {
  return {
    id: overrides.id ?? "human:test:330",
    sampleIndex: 0,
    cellId: overrides.cellId ?? "test",
    latitudeDeg: overrides.latitudeDeg ?? 0,
    longitudeDeg: overrides.longitudeDeg ?? 0,
    gain01: overrides.gain01 ?? 0.5,
    scanlineWeight: overrides.scanlineWeight ?? 1,
    nightLightNorm: overrides.nightLightNorm ?? 0.5,
    frequencyHz: overrides.frequencyHz ?? 330,
    registerMidi: overrides.registerMidi ?? 52,
    surfaceHardness01: overrides.surfaceHardness01 ?? 0.5,
    openness01: overrides.openness01 ?? 0.5,
    waterRatio: overrides.waterRatio ?? 0.2,
    forestRatio: overrides.forestRatio ?? 0.1,
    roadDensityNorm: overrides.roadDensityNorm ?? 0,
    buildingDensityNorm: overrides.buildingDensityNorm ?? 0,
    nightLightTopology: overrides.nightLightTopology ?? DEFAULT_NIGHTLIGHT_TOPOLOGY,
    humidityNorm: overrides.humidityNorm ?? 0.5,
    cloudNorm: overrides.cloudNorm ?? 0.2,
    windNorm: overrides.windNorm ?? 0.1,
    precipitationNorm: overrides.precipitationNorm ?? 0,
    temperatureNorm: overrides.temperatureNorm ?? 0.6,
    dominantGridKernelId: "12tet",
    dominantScaleKernelId: "church_modes",
  };
}

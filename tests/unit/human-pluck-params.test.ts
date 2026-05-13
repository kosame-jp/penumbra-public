import { describe, expect, it } from "vitest";

import {
  HUMAN_CANONICAL_PARTIAL_COUNT,
  HUMAN_METALLIC_DISPERSION_B_MAX,
  HUMAN_SECOND_PARTIAL_GAIN_SCALE,
  deriveHumanPluckParams,
} from "../../src/core/audio/human-pluck-params";
import type { HumanPulseEvent } from "../../src/core/fusion/human-pulse-scheduler";
import type { HumanVoiceCandidate } from "../../src/core/fusion/human-voice-candidates";
import type { NightLightTopology } from "../../src/core/fusion/scanline-sample";

describe("human pluck parameter mapping", () => {
  it("uses surface hardness for attack without changing pitch identity", () => {
    const soft = deriveHumanPluckParams(candidate({ surfaceHardness01: 0.1 }), undefined);
    const hard = deriveHumanPluckParams(candidate({ surfaceHardness01: 0.9 }), undefined);

    expect(hard.attackSeconds).toBeLessThan(soft.attackSeconds);
    expect(hard.frequencyHz).toBe(soft.frequencyHz);
  });

  it("shortens decay in humid closed conditions and damps cloudy brightness", () => {
    const openDry = deriveHumanPluckParams(
      candidate({ openness01: 0.9, humidityNorm: 0.1, cloudNorm: 0.1 }),
      undefined,
    );
    const closedHumidCloudy = deriveHumanPluckParams(
      candidate({ openness01: 0.1, humidityNorm: 0.95, cloudNorm: 0.9 }),
      undefined,
    );

    expect(closedHumidCloudy.decaySeconds).toBeLessThan(openDry.decaySeconds);
    expect(closedHumidCloudy.lowpassHz).toBeLessThan(openDry.lowpassHz);
  });

  it("derives contact-specific reverb send, tail, and damping from propagation drivers", () => {
    const openDry = deriveHumanPluckParams(
      candidate({ openness01: 0.95, humidityNorm: 0.1, cloudNorm: 0.05, forestRatio: 0, waterRatio: 0.05 }),
      undefined,
    );
    const humidClosed = deriveHumanPluckParams(
      candidate({ openness01: 0.1, humidityNorm: 0.95, cloudNorm: 0.85, forestRatio: 0.7, waterRatio: 0.3 }),
      undefined,
    );

    expect(humidClosed.reverbSend01).toBeGreaterThan(openDry.reverbSend01);
    expect(humidClosed.reverbTailSeconds).toBeLessThan(openDry.reverbTailSeconds);
    expect(humidClosed.reverbDampingHz).toBeLessThan(openDry.reverbDampingHz);
  });

  it("applies deterministic pulse variance to pitch and envelope", () => {
    const plain = deriveHumanPluckParams(candidate(), undefined);
    const varied = deriveHumanPluckParams(
      candidate(),
      pulse({ detuneCents: 4, gainScale01: 0.8, decayScale: 1.2, filterScale: 0.9 }),
    );

    expect(varied.frequencyHz).toBeGreaterThan(plain.frequencyHz);
    expect(varied.peakGain01).toBeLessThan(plain.peakGain01);
    expect(varied.decaySeconds).toBeGreaterThan(plain.decaySeconds);
    expect(varied.lowpassHz).toBeLessThan(plain.lowpassHz);
  });

  it("keeps one abstract pluck family while varying partial color from surface drivers", () => {
    const damped = deriveHumanPluckParams(
      candidate({
        surfaceHardness01: 0.2,
        openness01: 0.2,
        forestRatio: 0.9,
        cloudNorm: 0.8,
        buildingDensityNorm: 0,
        roadDensityNorm: 0,
        nightLightTopology: clusteredTopology(),
      }),
      undefined,
    );
    const hardBuiltOpen = deriveHumanPluckParams(
      candidate({
        surfaceHardness01: 0.9,
        openness01: 0.9,
        forestRatio: 0,
        cloudNorm: 0.1,
        buildingDensityNorm: 0.9,
        roadDensityNorm: 0.8,
        waterRatio: 0.4,
        nightLightTopology: clusteredTopology({ continuity01: 0.9, neighborMean01: 0.75 }),
      }),
      undefined,
    );

    expect(hardBuiltOpen.partials.length).toBeGreaterThan(damped.partials.length);
    expect(damped.partials.length).toBeGreaterThanOrEqual(1);
    expect(hardBuiltOpen.partials).toHaveLength(HUMAN_CANONICAL_PARTIAL_COUNT);
    expect(hardBuiltOpen.partials.every((partial) => partial.decayScale > 0 && partial.decayScale <= 1)).toBe(true);
    expect(hardBuiltOpen.noiseGain01).toBeGreaterThan(damped.noiseGain01 * 3);
    expect(hardBuiltOpen.partials[3]?.gain01).toBeGreaterThan(damped.partials[3]?.gain01 ?? 0);
    expect(hardBuiltOpen.partials[3]?.ratio).toBeGreaterThan(damped.partials[3]?.ratio ?? 0);
    expect(hardBuiltOpen.partials[1]?.ratio).toBeGreaterThan(2.08);
    expect(hardBuiltOpen.partials[1]?.gain01).toBeLessThanOrEqual(0.78);
    expect(HUMAN_METALLIC_DISPERSION_B_MAX).toBe(0.08);
    expect(HUMAN_SECOND_PARTIAL_GAIN_SCALE).toBe(1);
    expect(damped.partials[1]?.ratio).toBeLessThan(2.03);
    expect(lowPartialSpread(hardBuiltOpen)).toBeGreaterThan(lowPartialSpread(damped) * 8);
    expect(upperPartialEnergy(hardBuiltOpen)).toBeGreaterThan(upperPartialEnergy(damped) * 3);
    expect(hardBuiltOpen.lowpassHz).toBeGreaterThan(damped.lowpassHz * 3);
  });

  it("uses 3x3 nightlight topology to move isolated contacts toward fundamental-only plucks", () => {
    const isolated = deriveHumanPluckParams(
      candidate({
        surfaceHardness01: 0.35,
        openness01: 0.35,
        buildingDensityNorm: 0.08,
        roadDensityNorm: 0.06,
        nightLightTopology: isolatedTopology(),
      }),
      undefined,
    );
    const clustered = deriveHumanPluckParams(
      candidate({
        surfaceHardness01: 0.65,
        openness01: 0.72,
        buildingDensityNorm: 0.46,
        roadDensityNorm: 0.44,
        nightLightTopology: clusteredTopology(),
      }),
      undefined,
    );

    expect(isolated.partials).toHaveLength(1);
    expect(clustered.partials.length).toBeGreaterThan(isolated.partials.length);
    expect(clustered.partials.length).toBeLessThanOrEqual(HUMAN_CANONICAL_PARTIAL_COUNT);
    expect(upperPartialEnergy(clustered)).toBeGreaterThan(upperPartialEnergy(isolated));
  });
});

function upperPartialEnergy(params: ReturnType<typeof deriveHumanPluckParams>): number {
  return params.partials.slice(2).reduce((sum, partial) => sum + partial.gain01, 0);
}

function lowPartialSpread(params: ReturnType<typeof deriveHumanPluckParams>): number {
  return params.partials.slice(1, 4).reduce((sum, partial) => {
    return sum + Math.abs(partial.ratio - Math.round(partial.ratio));
  }, 0);
}

function candidate(overrides: Partial<HumanVoiceCandidate> = {}): HumanVoiceCandidate {
  return {
    id: "voice",
    sampleIndex: 0,
    cellId: "cell",
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
    nightLightTopology: overrides.nightLightTopology ?? clusteredTopology({ continuity01: 0.45 }),
    humidityNorm: overrides.humidityNorm ?? 0.5,
    cloudNorm: overrides.cloudNorm ?? 0.2,
    windNorm: overrides.windNorm ?? 0.1,
    precipitationNorm: overrides.precipitationNorm ?? 0,
    temperatureNorm: overrides.temperatureNorm ?? 0.6,
    dominantGridKernelId: "12tet",
    dominantScaleKernelId: "church_modes",
  };
}

function isolatedTopology(overrides: Partial<NightLightTopology> = {}): NightLightTopology {
  return {
    neighborMean01: overrides.neighborMean01 ?? 0,
    neighborMax01: overrides.neighborMax01 ?? 0,
    neighborLitCount01: overrides.neighborLitCount01 ?? 0,
    isolation01: overrides.isolation01 ?? 0.92,
    continuity01: overrides.continuity01 ?? 0.04,
    edge01: overrides.edge01 ?? 0.08,
  };
}

function clusteredTopology(overrides: Partial<NightLightTopology> = {}): NightLightTopology {
  return {
    neighborMean01: overrides.neighborMean01 ?? 0.58,
    neighborMax01: overrides.neighborMax01 ?? 0.86,
    neighborLitCount01: overrides.neighborLitCount01 ?? 0.74,
    isolation01: overrides.isolation01 ?? 0.08,
    continuity01: overrides.continuity01 ?? 0.68,
    edge01: overrides.edge01 ?? 0.22,
  };
}

function pulse(overrides: Partial<HumanPulseEvent> = {}): HumanPulseEvent {
  return {
    scheduledUtcMs: overrides.scheduledUtcMs ?? Date.parse("2026-05-01T00:00:00.000Z"),
    pulseIndex: overrides.pulseIndex ?? 1,
    timingJitterSeconds: overrides.timingJitterSeconds ?? 0,
    detuneCents: overrides.detuneCents ?? 0,
    gainScale01: overrides.gainScale01 ?? 1,
    attackScale: overrides.attackScale ?? 1,
    decayScale: overrides.decayScale ?? 1,
    filterScale: overrides.filterScale ?? 1,
  };
}

import { describe, expect, it } from "vitest";

import {
  activeMusicSampleCount,
  activeQuakeCount,
  maxMusicGain,
  maxNightLightNorm,
  scaleModeDistribution,
} from "../../src/core/app-state/selectors";
import type { RuntimeSnapshot } from "../../src/core/app-state/runtime-store";
import {
  DEFAULT_NIGHTLIGHT_TOPOLOGY,
  type CanonicalScanlineSample,
} from "../../src/core/fusion/scanline-sample";
import { midiToHz } from "../../src/core/fusion/register";
import type { EarthquakeEvent } from "../../src/core/live-data/quake-store";
import { createScanlineState } from "../../src/core/scanline/scanline-state";

describe("runtime selectors", () => {
  it("summarizes active music, quake contacts, and debug music drivers", () => {
    const snapshot = runtimeSnapshot([
      sample({ nightLightNorm: 0, musicActive: false, musicGain: 0, quakes: [] }),
      sample({
        nightLightNorm: 0.42,
        musicActive: true,
        musicGain: 0.28,
        quakes: [quake("quake-a")],
      }),
      sample({
        nightLightNorm: 0.75,
        musicActive: false,
        musicGain: 0.5,
        quakes: [quake("quake-b"), quake("quake-c")],
      }),
    ]);

    expect(activeMusicSampleCount(snapshot)).toBe(1);
    expect(activeQuakeCount(snapshot)).toBe(3);
    expect(maxNightLightNorm(snapshot)).toBeCloseTo(0.75, 8);
    expect(maxMusicGain(snapshot)).toBeCloseTo(0.5, 8);
  });

  it("returns zero maxima for empty scanline samples", () => {
    const snapshot = runtimeSnapshot([]);

    expect(activeMusicSampleCount(snapshot)).toBe(0);
    expect(activeQuakeCount(snapshot)).toBe(0);
    expect(maxNightLightNorm(snapshot)).toBe(0);
    expect(maxMusicGain(snapshot)).toBe(0);
    expect(scaleModeDistribution(snapshot)).toEqual([]);
  });

  it("summarizes selected scale modes for active music contacts only", () => {
    const snapshot = runtimeSnapshot([
      sample({
        nightLightNorm: 0.8,
        musicActive: true,
        musicGain: 0.4,
        quakes: [],
        dominantScaleKernelId: "east_asia_pentatonic",
        selectedScaleModeId: "yo",
      }),
      sample({
        nightLightNorm: 0.7,
        musicActive: true,
        musicGain: 0.3,
        quakes: [],
        dominantScaleKernelId: "east_asia_pentatonic",
        selectedScaleModeId: "yo",
      }),
      sample({
        nightLightNorm: 0.5,
        musicActive: true,
        musicGain: 0.2,
        quakes: [],
        dominantScaleKernelId: "church_modes",
        selectedScaleModeId: "dorian",
      }),
      sample({
        nightLightNorm: 0.9,
        musicActive: false,
        musicGain: 0.6,
        quakes: [],
        dominantScaleKernelId: "church_modes",
        selectedScaleModeId: "ionian",
      }),
    ]);

    expect(scaleModeDistribution(snapshot)).toEqual([
      {
        scaleKernelId: "east_asia_pentatonic",
        modeId: "yo",
        count: 2,
        fraction01: 2 / 3,
      },
      {
        scaleKernelId: "church_modes",
        modeId: "dorian",
        count: 1,
        fraction01: 1 / 3,
      },
    ]);
  });
});

interface SampleOptions {
  readonly nightLightNorm: number;
  readonly musicActive: boolean;
  readonly musicGain: number;
  readonly quakes: readonly EarthquakeEvent[];
  readonly dominantScaleKernelId?: string;
  readonly selectedScaleModeId?: string;
}

function runtimeSnapshot(samples: readonly CanonicalScanlineSample[]): RuntimeSnapshot {
  return {
    scanlineState: createScanlineState(new Date("2026-04-30T00:00:00.000Z")),
    samples,
  };
}

function sample(options: SampleOptions): CanonicalScanlineSample {
  return {
    latitudeDeg: 0,
    longitudeDeg: 0,
    scanlineWeight: 1,
    utcIso: "2026-04-30T00:00:00.000Z",
    cellId: "test-cell",
    effectiveElevationM: 0,
    registerMidi: 48,
    nightLightNorm: options.nightLightNorm,
    surfaceHardness01: 0.5,
    openness01: 0.5,
    waterRatio: 0.2,
    forestRatio: 0.1,
    roadDensityNorm: 0,
    buildingDensityNorm: 0,
    nightLightTopology: DEFAULT_NIGHTLIGHT_TOPOLOGY,
    spatialChange01: 0,
    spatialSlope01: 0,
    weather: {
      cloudCoverPct: 20,
      relativeHumidityPct: 60,
      windSpeedMps: 2,
      precipitationMm: 0,
      temperatureC: 18,
      pressureHpa: 1012,
    },
    tuning: {
      gridKernelWeights: { "12tet": 1 },
      scaleKernelWeights: { [options.dominantScaleKernelId ?? "church_modes"]: 1 },
      dominantGridKernelId: "12tet",
      dominantScaleKernelId: options.dominantScaleKernelId ?? "church_modes",
      selectedScaleModeId: options.selectedScaleModeId,
    },
    layers: {
      earth: {
        active: true,
        brightness01: 0.7,
      },
      music: {
        active: options.musicActive,
        gain01: options.musicGain,
        frequencyHz: midiToHz(48),
      },
      quakes: options.quakes,
    },
  };
}

function quake(id: string): EarthquakeEvent {
  return {
    id,
    provider: "test",
    eventTimeUtc: "2026-04-29T23:30:00.000Z",
    updatedTimeUtc: "2026-04-29T23:30:00.000Z",
    latitudeDeg: 0,
    longitudeDeg: 0,
    depthKm: 12,
    magnitude: 1,
  };
}

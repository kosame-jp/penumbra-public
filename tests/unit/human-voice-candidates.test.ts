import { describe, expect, it } from "vitest";

import {
  DEFAULT_HUMAN_VOICE_CAP,
  deriveHumanVoiceCandidates,
  selectHumanVoiceCandidates,
} from "../../src/core/fusion/human-voice-candidates";
import { midiToHz } from "../../src/core/fusion/register";
import {
  DEFAULT_NIGHTLIGHT_TOPOLOGY,
  type CanonicalScanlineSample,
} from "../../src/core/fusion/scanline-sample";

describe("human voice candidate selection", () => {
  it("filters inactive samples and orders active candidates deterministically", () => {
    const selection = selectHumanVoiceCandidates(
      [
        sample({ cellId: "b", musicGain: 0.2 }),
        sample({ cellId: "ignored", musicActive: false, musicGain: 0 }),
        sample({ cellId: "c", musicGain: 0.8 }),
        sample({ cellId: "a", musicGain: 0.8 }),
      ],
      { maxVoices: 3 },
    );

    expect(selection.candidates.map((candidate) => candidate.cellId)).toEqual(["a", "c", "b"]);
    expect(selection.voices.map((voice) => voice.cellId)).toEqual(["a", "c", "b"]);
  });

  it("caps selected voices without removing inspectable candidates", () => {
    const selection = selectHumanVoiceCandidates(
      Array.from({ length: DEFAULT_HUMAN_VOICE_CAP + 3 }, (_, index) =>
        sample({
          cellId: `cell-${index.toString().padStart(2, "0")}`,
          musicGain: 1 - index * 0.02,
        }),
      ),
    );

    expect(selection.candidates).toHaveLength(DEFAULT_HUMAN_VOICE_CAP + 3);
    expect(selection.voices).toHaveLength(DEFAULT_HUMAN_VOICE_CAP);
    expect(selection.voices.at(-1)?.cellId).toBe("cell-11");
  });

  it("keeps very quiet active contacts inspectable as candidates", () => {
    const candidates = deriveHumanVoiceCandidates([
      sample({ cellId: "quiet-light", musicGain: 0.00001 }),
    ]);

    expect(candidates.map((candidate) => candidate.cellId)).toEqual(["quiet-light"]);
    expect(candidates[0]?.gain01).toBeCloseTo(0.00001, 10);
  });

  it("carries elevation-derived frequency without deriving pitch from latitude", () => {
    const candidates = deriveHumanVoiceCandidates([
      sample({ cellId: "south", latitudeDeg: -60, registerMidi: 60 }),
      sample({ cellId: "north", latitudeDeg: 60, registerMidi: 60 }),
    ]);

    expect(candidates.map((candidate) => candidate.frequencyHz)).toEqual([
      midiToHz(60),
      midiToHz(60),
    ]);
  });

  it("keeps voice identity stable when musical frequency drifts", () => {
    const [low] = deriveHumanVoiceCandidates([
      sample({ cellId: "stable-cell", musicFrequencyHz: 219.998 }),
    ]);
    const [high] = deriveHumanVoiceCandidates([
      sample({ cellId: "stable-cell", musicFrequencyHz: 220.002 }),
    ]);

    expect(low?.id).toBe("human:stable-cell");
    expect(high?.id).toBe("human:stable-cell");
    expect(low?.frequencyHz).not.toBe(high?.frequencyHz);
  });

  it("exposes physical drivers for the later plucked synthesis pass", () => {
    const [candidate] = deriveHumanVoiceCandidates([
      sample({
        musicGain: 0.5,
        surfaceHardness01: 0.9,
        openness01: 0.7,
        waterRatio: 0.3,
        forestRatio: 0.2,
        roadDensityNorm: 0.4,
        buildingDensityNorm: 0.6,
        nightLightTopology: {
          ...DEFAULT_NIGHTLIGHT_TOPOLOGY,
          neighborMean01: 0.3,
          neighborMax01: 0.7,
          neighborLitCount01: 0.5,
          isolation01: 0.2,
          continuity01: 0.6,
          edge01: 0.4,
        },
        relativeHumidityPct: 82,
        cloudCoverPct: 35,
        temperatureC: 10,
      }),
    ]);

    expect(candidate?.surfaceHardness01).toBeCloseTo(0.9, 8);
    expect(candidate?.openness01).toBeCloseTo(0.7, 8);
    expect(candidate?.waterRatio).toBeCloseTo(0.3, 8);
    expect(candidate?.forestRatio).toBeCloseTo(0.2, 8);
    expect(candidate?.roadDensityNorm).toBeCloseTo(0.4, 8);
    expect(candidate?.buildingDensityNorm).toBeCloseTo(0.6, 8);
    expect(candidate?.nightLightTopology.neighborMean01).toBeCloseTo(0.3, 8);
    expect(candidate?.nightLightTopology.continuity01).toBeCloseTo(0.6, 8);
    expect(candidate?.nightLightTopology.edge01).toBeCloseTo(0.4, 8);
    expect(candidate?.humidityNorm).toBeCloseTo(0.82, 8);
    expect(candidate?.cloudNorm).toBeCloseTo(0.35, 8);
    expect(candidate?.windNorm).toBeCloseTo(2 / 18, 8);
    expect(candidate?.precipitationNorm).toBe(0);
    expect(candidate?.temperatureNorm).toBeCloseTo(0.5, 8);
  });
});

interface SampleOptions {
  readonly cellId?: string;
  readonly latitudeDeg?: number;
  readonly registerMidi?: number;
  readonly musicActive?: boolean;
  readonly musicGain?: number;
  readonly surfaceHardness01?: number;
  readonly openness01?: number;
  readonly waterRatio?: number;
  readonly forestRatio?: number;
  readonly roadDensityNorm?: number;
  readonly buildingDensityNorm?: number;
  readonly nightLightTopology?: CanonicalScanlineSample["nightLightTopology"];
  readonly relativeHumidityPct?: number;
  readonly cloudCoverPct?: number;
  readonly temperatureC?: number;
  readonly musicFrequencyHz?: number;
}

function sample(options: SampleOptions = {}): CanonicalScanlineSample {
  const registerMidi = options.registerMidi ?? 48;
  const musicGain = options.musicGain ?? 0.5;

  return {
    latitudeDeg: options.latitudeDeg ?? 0,
    longitudeDeg: 0,
    scanlineWeight: 1,
    utcIso: "2026-05-01T00:00:00.000Z",
    cellId: options.cellId ?? "test-cell",
    effectiveElevationM: 0,
    registerMidi,
    nightLightNorm: musicGain,
    surfaceHardness01: options.surfaceHardness01 ?? 0.5,
    openness01: options.openness01 ?? 0.5,
    waterRatio: options.waterRatio ?? 0.2,
    forestRatio: options.forestRatio ?? 0.1,
    roadDensityNorm: options.roadDensityNorm ?? 0,
    buildingDensityNorm: options.buildingDensityNorm ?? 0,
    nightLightTopology: options.nightLightTopology ?? DEFAULT_NIGHTLIGHT_TOPOLOGY,
    spatialChange01: 0,
    spatialSlope01: 0,
    weather: {
      cloudCoverPct: options.cloudCoverPct ?? 20,
      relativeHumidityPct: options.relativeHumidityPct ?? 60,
      windSpeedMps: 2,
      precipitationMm: 0,
      temperatureC: options.temperatureC ?? 18,
      pressureHpa: 1012,
    },
    tuning: {
      gridKernelWeights: { "12tet": 1 },
      scaleKernelWeights: { "church_modes": 1 },
      dominantGridKernelId: "12tet",
      dominantScaleKernelId: "church_modes",
    },
    layers: {
      earth: {
        active: false,
        brightness01: 0,
      },
      music: {
        active: options.musicActive ?? true,
        gain01: musicGain,
        frequencyHz: options.musicFrequencyHz ?? midiToHz(registerMidi),
      },
      quakes: [],
    },
  };
}

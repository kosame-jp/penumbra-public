import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  allowedIntervalsCents,
  frequencyHzForTuningRegister,
  tuningWeightsAt,
} from "../../src/core/fusion/tuning";
import { midiToHz } from "../../src/core/fusion/register";
import { parseTuningKernelArtifact } from "../../src/core/static-data/generated-artifact-loaders";
import type { TuningKernelSet } from "../../src/core/static-data/kernels-loader";

const tuningAsset = parseTuningKernelArtifact(
  JSON.parse(readFileSync(join(process.cwd(), "public", "data", "tuning-kernels.json"), "utf8")) as unknown,
);

describe("reviewable tuning kernel asset", () => {
  it("keeps the spec topology and family split", () => {
    expect(tuningAsset.kernels.map((kernel) => kernel.id)).toEqual([
      "12tet",
      "maqam",
      "indian",
      "slendro_pelog",
      "east_asia_pentatonic",
      "church_modes",
      "west_african_blues",
      "andean_pentatonic",
    ]);

    expect(tuningAsset.kernels.filter((kernel) => kernel.family === "grid")).toHaveLength(4);
    expect(tuningAsset.kernels.filter((kernel) => kernel.family === "scale")).toHaveLength(4);
    expect(kernelById(tuningAsset, "12tet")?.centroid).toEqual({ latDeg: 48, lonDeg: 15 });
    expect(kernelById(tuningAsset, "andean_pentatonic")?.centroid).toEqual({
      latDeg: -15,
      lonDeg: -72,
    });
  });

  it("preserves review flags and provenance for provisional abstractions", () => {
    const provisional = tuningAsset.kernels.filter((kernel) => kernel.status === "provisional");
    expect(provisional.length).toBeGreaterThan(0);

    for (const kernel of provisional) {
      expect(kernel.reviewRequired).toBe(true);
      expect(kernel.notes).toContain("abstraction");
      expect(kernel.provenance).toContain("PENUMBRA design spec v10");
    }
  });

  it("parses all mode interval assets", () => {
    const modes = tuningAsset.kernels.flatMap((kernel) => kernel.modes ?? []);
    expect(modes.length).toBeGreaterThan(0);

    for (const mode of modes) {
      expect(mode.intervalCents?.length).toBeGreaterThan(0);
      expect(mode.intervalCents?.every((interval) => interval >= 0 && interval <= 1200)).toBe(true);
    }
  });

  it("normalizes grid and scale weights independently", () => {
    const weights = tuningWeightsAt(35, 139, tuningAsset);
    expect(sum(Object.values(weights.gridKernelWeights))).toBeCloseTo(1, 8);
    expect(sum(Object.values(weights.scaleKernelWeights))).toBeCloseTo(1, 8);
    expect(weights.dominantGridKernelId).toBeTruthy();
    expect(weights.dominantScaleKernelId).toBeTruthy();
  });

  it("turns dominant tuning kernels into pitch permission instead of timbre templates", () => {
    const eastAsiaWeights = tuningWeightsAt(35, 122, tuningAsset);
    const churchWeights = tuningWeightsAt(57, 17, tuningAsset);

    expect(frequencyHzForTuningRegister(53, eastAsiaWeights, tuningAsset)).toBeCloseTo(
      midiToHz(52),
      8,
    );
    expect(frequencyHzForTuningRegister(53, churchWeights, tuningAsset)).toBeCloseTo(
      midiToHz(53),
      8,
    );
  });

  it("projects scale permission onto the dominant grid before choosing pitch", () => {
    const weights = {
      gridKernelWeights: {},
      scaleKernelWeights: {},
      dominantGridKernelId: "indian",
      dominantScaleKernelId: "east_asia_pentatonic",
    };

    expect(allowedIntervalsCents(weights, tuningAsset)).toEqual([0, 204, 408, 702, 906]);
  });

  it("uses the full grid interval set rather than a grid mode during projection", () => {
    const weights = {
      gridKernelWeights: {},
      scaleKernelWeights: {},
      dominantGridKernelId: "slendro_pelog",
      dominantScaleKernelId: "church_modes",
    };

    expect(allowedIntervalsCents(weights, tuningAsset)).toEqual([
      0, 240, 390, 480, 720, 960, 1020,
    ]);
  });

  it("can retune pitch permission around an Earth-drone key center while preserving register", () => {
    const eastAsiaWeights = tuningWeightsAt(35, 122, tuningAsset);

    expect(frequencyHzForTuningRegister(53, eastAsiaWeights, tuningAsset, 41)).toBeCloseTo(
      midiToHz(53),
      8,
    );
    expect(frequencyHzForTuningRegister(53, eastAsiaWeights, tuningAsset)).toBeCloseTo(
      midiToHz(52),
      8,
    );
  });

  it("keeps projected grid intervals relative to the Earth-drone key center", () => {
    const weights = {
      gridKernelWeights: {},
      scaleKernelWeights: {},
      dominantGridKernelId: "indian",
      dominantScaleKernelId: "east_asia_pentatonic",
    };

    expect(frequencyHzForTuningRegister(57, weights, tuningAsset, 41)).toBeCloseTo(
      midiToHz(57.08),
      8,
    );
  });

  it("selects scale modes deterministically from contact context and shared forecast atmosphere", () => {
    const dense = tuningWeightsAt(35, 122, tuningAsset, {
      cellId: "dense-human-field",
      utcIso: "2026-05-08T00:00:00Z",
      nightLightTopology: {
        neighborMean01: 0.85,
        neighborMax01: 0.95,
        neighborLitCount01: 1,
        isolation01: 0.02,
        continuity01: 0.9,
        edge01: 0.2,
      },
      surfaceHardness01: 0.85,
      openness01: 0.7,
      waterRatio: 0.05,
      forestRatio: 0.02,
      roadDensityNorm: 0.9,
      buildingDensityNorm: 0.95,
      atmosphericWetnessNorm: 0.35,
      cloudNorm: 0.25,
      windNorm: 0.45,
      precipitationNorm: 0,
      temperatureNorm: 0.7,
    });
    const sparse = tuningWeightsAt(35, 122, tuningAsset, {
      cellId: "sparse-human-field",
      utcIso: "2026-05-08T00:00:00Z",
      nightLightTopology: {
        neighborMean01: 0.02,
        neighborMax01: 0.03,
        neighborLitCount01: 0,
        isolation01: 0.95,
        continuity01: 0.01,
        edge01: 0.35,
      },
      surfaceHardness01: 0.2,
      openness01: 0.2,
      waterRatio: 0.55,
      forestRatio: 0.5,
      roadDensityNorm: 0.02,
      buildingDensityNorm: 0.01,
      atmosphericWetnessNorm: 0.85,
      cloudNorm: 0.8,
      windNorm: 0.05,
      precipitationNorm: 0,
      temperatureNorm: 0.4,
    });

    expect(dense.selectedScaleModeId).toBe("yin");
    expect(sparse.selectedScaleModeId).toBe("yang");
    expect(allowedIntervalsCents(dense, tuningAsset)).toEqual([0, 300, 500, 700, 1000]);
  });
});

function kernelById(kernelSet: TuningKernelSet, id: string) {
  return kernelSet.kernels.find((kernel) => kernel.id === id);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

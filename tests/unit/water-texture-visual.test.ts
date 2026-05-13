import { describe, expect, it } from "vitest";

import type { PenumbraWaterTextureParams } from "../../src/core/audio/penumbra-earth-texture-params";
import { createScanlineState } from "../../src/core/scanline/scanline-state";
import type { WorldGrid, WorldGridCell } from "../../src/core/static-data/worldgrid-loader";
import {
  waterTextureVisualParticles,
  type WaterTextureVisualParticle,
} from "../../src/core/visual/water-texture-visual";

describe("water texture low/mid visual event field", () => {
  it("uses deterministic UTC events for low and mid water ripples", () => {
    const input = {
      worldGrid: worldGrid("ocean"),
      scanlineState: createScanlineState(new Date("2026-05-09T18:00:00.000Z"), { sigmaDeg: 7 }),
      water: waterTexture({ lowDensityHz: 1.2, midDensityHz: 1.4 }),
    };

    const first = waterTextureVisualParticles(input);
    const second = waterTextureVisualParticles(input);

    expect(first).toEqual(second);
    expect(first.particles.length).toBeGreaterThan(0);
    expect(first.summary.lowCandidateCount).toBeGreaterThan(0);
    expect(first.summary.midCandidateCount).toBeGreaterThan(0);
  });

  it("does not render water ripples without water cells", () => {
    const output = waterTextureVisualParticles({
      worldGrid: worldGrid("land"),
      scanlineState: createScanlineState(new Date("2026-05-09T18:00:00.000Z"), { sigmaDeg: 7 }),
      water: waterTexture({ lowDensityHz: 1.2, midDensityHz: 1.4 }),
    });

    expect(output.particles).toEqual([]);
    expect(output.summary.lowCandidateCount).toBe(0);
    expect(output.summary.midCandidateCount).toBe(0);
  });

  it("advances ripple age from UTC instead of a visual-only loop", () => {
    const world = worldGrid("ocean");
    const water = waterTexture({ lowDensityHz: 1.2, midDensityHz: 1.4 });
    const first = waterTextureVisualParticles({
      worldGrid: world,
      scanlineState: createScanlineState(new Date("2026-05-09T18:00:00.000Z"), { sigmaDeg: 7 }),
      water,
    }).particles;
    const second = waterTextureVisualParticles({
      worldGrid: world,
      scanlineState: createScanlineState(new Date("2026-05-09T18:00:00.800Z"), { sigmaDeg: 7 }),
      water,
    }).particles;

    expect(first).not.toEqual(second);
  });

  it("keeps ripple positions fixed for the same UTC event while scanline advances", () => {
    const world = worldGrid("ocean");
    const water = waterTexture({ lowDensityHz: 1.2, midDensityHz: 1.4 });
    const first = waterTextureVisualParticles({
      worldGrid: world,
      scanlineState: createScanlineState(new Date("2026-05-09T18:00:00.000Z"), { sigmaDeg: 7 }),
      water,
    }).particles;
    const second = waterTextureVisualParticles({
      worldGrid: world,
      scanlineState: createScanlineState(new Date("2026-05-09T18:00:00.800Z"), { sigmaDeg: 7 }),
      water,
    }).particles;
    const secondById = new Map(second.map((particle) => [particle.eventId, particle]));
    const common = first
      .map((particle) => ({ first: particle, second: secondById.get(particle.eventId) }))
      .filter((pair): pair is { first: WaterTextureVisualParticle; second: WaterTextureVisualParticle } =>
        pair.second != null,
      );

    expect(common.length).toBeGreaterThan(0);
    for (const pair of common) {
      expect(pair.second.latitudeDeg).toBeCloseTo(pair.first.latitudeDeg, 8);
      expect(pair.second.longitudeDeg).toBeCloseTo(pair.first.longitudeDeg, 8);
      expect(pair.second.age01).toBeGreaterThanOrEqual(pair.first.age01);
    }
  });

  it("keeps water visual events stable under sub-quantum density jitter", () => {
    const world = worldGrid("ocean");
    const scanlineState = createScanlineState(new Date("2026-05-09T18:00:00.000Z"), {
      sigmaDeg: 7,
    });
    const base = waterTextureVisualParticles({
      worldGrid: world,
      scanlineState,
      water: waterTexture({ lowDensityHz: 0.901, midDensityHz: 0.901 }),
    });
    const jittered = waterTextureVisualParticles({
      worldGrid: world,
      scanlineState,
      water: waterTexture({ lowDensityHz: 0.904, midDensityHz: 0.904 }),
    });

    expect(jittered.particles).toEqual(base.particles);
  });

  it("keeps particles on the globe surface with finite water coordinates", () => {
    const output = waterTextureVisualParticles({
      worldGrid: worldGrid("ocean"),
      scanlineState: createScanlineState(new Date("2026-05-09T18:00:00.000Z"), { sigmaDeg: 7 }),
      water: waterTexture({ lowDensityHz: 1.2, midDensityHz: 1.4 }),
    });

    expect(output.particles.every(isFiniteWaterParticle)).toBe(true);
    expect(output.particles.every((particle) => particle.radius > 1)).toBe(true);
  });
});

function waterTexture(overrides: Partial<PenumbraWaterTextureParams> = {}): PenumbraWaterTextureParams {
  return {
    noiseFloorGain01: overrides.noiseFloorGain01 ?? 0,
    dropletDensityHz: overrides.dropletDensityHz ?? 2,
    lowDensityHz: overrides.lowDensityHz ?? 0.9,
    midDensityHz: overrides.midDensityHz ?? 0.9,
    highDensityHz: overrides.highDensityHz ?? 0,
    dropletGain01: overrides.dropletGain01 ?? 0.08,
    brightness01: overrides.brightness01 ?? 0.5,
    lowLevel01: overrides.lowLevel01 ?? 0.78,
    midLevel01: overrides.midLevel01 ?? 0.72,
    highLevel01: overrides.highLevel01 ?? 0,
  };
}

function worldGrid(kind: "ocean" | "land"): WorldGrid {
  const cells: WorldGridCell[] = [];
  const cellSizeDegrees = 10;

  for (let latCenterDeg = -85; latCenterDeg <= 85; latCenterDeg += cellSizeDegrees) {
    for (let lonCenterDeg = -175; lonCenterDeg <= 175; lonCenterDeg += cellSizeDegrees) {
      cells.push(cell(kind, latCenterDeg, lonCenterDeg));
    }
  }

  return {
    version: "test-water-visual",
    generatedAtUtc: "2026-05-09T00:00:00.000Z",
    cellSizeDegrees,
    stats: {
      nightLight: { min: 0, max: 0, p95: 0, p99: 0, p99_5: 0 },
      roadLengthKm: { min: 0, max: 0 },
      buildingCount: { min: 0, max: 0 },
      waterRatio: { min: 0, max: kind === "ocean" ? 1 : 0 },
      forestRatio: { min: 0, max: 0 },
      elevationM: { min: 0, max: 0 },
      bathymetryM: { min: kind === "ocean" ? -6000 : 0, max: 0 },
    },
    cells,
  };
}

function cell(kind: "ocean" | "land", latCenterDeg: number, lonCenterDeg: number): WorldGridCell {
  return {
    id: `${kind}:${latCenterDeg}:${lonCenterDeg}`,
    latCenterDeg,
    lonCenterDeg,
    landClass: kind,
    elevationM: 0,
    bathymetryM: kind === "ocean" ? -4200 : 0,
    roadLengthKm: 0,
    buildingCount: 0,
    waterRatio: kind === "ocean" ? 1 : 0,
    forestRatio: 0,
    nightLightMean: 0,
    surfaceHardness01: kind === "ocean" ? 0.05 : 0.62,
    openness01: kind === "ocean" ? 0.84 : 0.5,
  };
}

function isFiniteWaterParticle(particle: WaterTextureVisualParticle): boolean {
  return (
    Number.isFinite(particle.latitudeDeg) &&
    Number.isFinite(particle.longitudeDeg) &&
    Number.isFinite(particle.radius) &&
    Number.isFinite(particle.strength01) &&
    Number.isFinite(particle.age01) &&
    Number.isFinite(particle.sizeScale01)
  );
}

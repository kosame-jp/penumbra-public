import { describe, expect, it } from "vitest";

import { buildTuningKernelArtifact } from "../../scripts/precompute/build-kernels";
import { buildWorldGridArtifact } from "../../scripts/precompute/build-worldgrid";
import { computeStatBlock, percentile } from "../../scripts/precompute/compute-stats";
import { requireNightLightReference, requirePercentileStat } from "../../src/core/static-data/canonical-accessors";
import type { TuningKernelSet } from "../../src/core/static-data/kernels-loader";
import type { WorldGridCell } from "../../src/core/static-data/worldgrid-loader";
import {
  parseCloudAtlasArtifact,
  parseCloudAtlasManifestArtifact,
  parseWorldGridArtifact,
} from "../../src/core/static-data/generated-artifact-loaders";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("data precompute foundations", () => {
  it("computes percentile stats deterministically", () => {
    expect(percentile([0, 10, 20, 30], 50)).toBe(15);
    const stats = computeStatBlock([0, 10, 20, 30], { includeP95: true });
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(30);
    expect(stats.p95).toBeCloseTo(28.5, 8);
  });

  it("builds worldgrid artifacts with normalization stats", () => {
    const artifact = buildWorldGridArtifact(fixtureCells, {
      version: "test",
      generatedAtUtc: "2026-04-30T00:00:00Z",
      cellSizeDegrees: 1,
      sources: { fixture: true },
    });

    expect(artifact.stats.nightLight.p99_5).toBeGreaterThan(0);
    expect(requireNightLightReference(artifact)).toBe(artifact.stats.nightLight.p99_5);
    expect(requirePercentileStat(artifact, "roadLengthKm", "p99")).toBeGreaterThan(0);
  });

  it("keeps tuning kernel provenance and review flags", () => {
    const artifact = buildTuningKernelArtifact({
      version: "test-provisional",
      kernels: [
        {
          id: "abstract_grid",
          family: "grid",
          label: "Abstract Grid",
          centroid: { latDeg: 0, lonDeg: 0 },
          sigmaKm: 1000,
          status: "provisional",
          reviewRequired: true,
          notes: "intentional abstraction",
          provenance: "test fixture",
        },
      ],
    } satisfies TuningKernelSet);

    expect(artifact.kernels[0]?.status).toBe("provisional");
    expect(artifact.kernels[0]?.reviewRequired).toBe(true);
  });

  it("ships a generated terrain-seed worldgrid artifact", () => {
    const artifact = parseWorldGridArtifact(readJson("public/data/worldgrid.terrain-seed.json"));

    expect(artifact.cells.length).toBeGreaterThan(100);
    expect(artifact.sources?.terrainTiles).toBeTruthy();
    expect(artifact.stats.elevationM.max).toBeGreaterThan(1000);
    expect(artifact.stats.bathymetryM.min).toBeLessThan(-1000);
    expect(artifact.cells.some((cell) => cell.landClass === "ocean")).toBe(true);
    expect(artifact.cells.some((cell) => cell.landClass === "land")).toBe(true);
  });

  it("ships a generated production-seed worldgrid with VIIRS nightlights and OSM density proxies", () => {
    const artifact = parseWorldGridArtifact(readJson("public/data/worldgrid.production-seed.json"));

    expect(artifact.cells.length).toBeGreaterThan(100);
    expect(artifact.sources?.terrainTiles).toBeTruthy();
    expect(artifact.sources?.viirsNightLights).toBeTruthy();
    expect(artifact.sources?.openStreetMapDensity).toBeTruthy();
    expect(artifact.stats.nightLight.p99_5).toBeGreaterThan(0);
    expect(artifact.stats.roadLengthKm.p99).toBeGreaterThan(0);
    expect(artifact.stats.buildingCount.p99).toBeGreaterThan(0);
    expect(artifact.stats.forestRatio?.max).toBeGreaterThan(0);
    expect(requireNightLightReference(artifact)).toBe(artifact.stats.nightLight.p99_5);
    expect(artifact.cells.some((cell) => cell.nightLightMean > 0)).toBe(true);
    expect(artifact.cells.some((cell) => cell.nightLightMean === 0)).toBe(true);
    expect(artifact.cells.some((cell) => cell.roadLengthKm > 0)).toBe(true);
    expect(artifact.cells.some((cell) => cell.buildingCount > 0)).toBe(true);
    expect(artifact.cells.some((cell) => cell.forestRatio > 0)).toBe(true);
  });

  it("ships a provisional cloud atlas fixture for visual pipeline work", () => {
    const artifact = parseCloudAtlasArtifact(readJson("public/data/fixtures/cloud-atlas.provisional.json"));

    expect(artifact.source.kind).toBe("provisional-fixture");
    expect(artifact.width * artifact.height).toBe(artifact.values.length);
    expect(artifact.resolutionDeg).toBe(1);
    expect(artifact.values.some((value) => value > 50)).toBe(true);
    expect(artifact.source.provenance).toContain("not meteorological data");
  });

  it("ships a current cloud atlas artifact when the Open-Meteo bridge has been run", () => {
    const artifact = parseCloudAtlasArtifact(readJson("public/data/cloud-atlas.current.json"));

    expect(artifact.source.kind).toBe("open-meteo");
    expect(artifact.width).toBe(360);
    expect(artifact.height).toBe(181);
    expect(artifact.values).toHaveLength(65160);
    expect(artifact.source.provenance).toContain("visual-only");
  });

  it("ships a forecast cloud atlas manifest with frame artifacts", () => {
    const manifest = parseCloudAtlasManifestArtifact(readJson("public/data/cloud-atlas.forecast/manifest.json"));

    expect(["open-meteo", "noaa-gfs"]).toContain(manifest.source.kind);
    expect(manifest.interpolation).toBe("linear-time");
    expect(manifest.frames.length).toBeGreaterThanOrEqual(2);
    for (const frame of manifest.frames) {
      const artifact = parseCloudAtlasArtifact(readJson(`public/data/cloud-atlas.forecast/${frame.url}`));
      expect(artifact.values).toHaveLength(artifact.width * artifact.height);
      expect(artifact.validAtUtc).toBe(frame.validAtUtc);
    }
  });
});

const fixtureCells: readonly WorldGridCell[] = [
  {
    id: "cell-a",
    latCenterDeg: 0,
    lonCenterDeg: 0,
    landClass: "land",
    terrainClass: "plain",
    elevationM: 10,
    bathymetryM: 0,
    roadLengthKm: 10,
    buildingCount: 5,
    waterRatio: 0.1,
    forestRatio: 0.2,
    nightLightMean: 0,
    surfaceHardness01: 0.7,
    openness01: 0.5,
  },
  {
    id: "cell-b",
    latCenterDeg: 5,
    lonCenterDeg: 5,
    landClass: "land",
    terrainClass: "urban",
    elevationM: 100,
    bathymetryM: 0,
    roadLengthKm: 200,
    buildingCount: 1000,
    waterRatio: 0.2,
    forestRatio: 0.05,
    nightLightMean: 80,
    surfaceHardness01: 0.95,
    openness01: 0.4,
  },
  {
    id: "cell-c",
    latCenterDeg: 10,
    lonCenterDeg: 10,
    landClass: "ocean",
    terrainClass: "deep_ocean",
    elevationM: 0,
    bathymetryM: -5000,
    roadLengthKm: 0,
    buildingCount: 0,
    waterRatio: 1,
    forestRatio: 0,
    nightLightMean: 0,
    surfaceHardness01: 0.05,
    openness01: 1,
  },
];

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as unknown;
}

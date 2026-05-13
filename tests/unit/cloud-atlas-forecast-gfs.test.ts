import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseCloudAtlasArtifact,
  parseCloudAtlasManifestArtifact,
} from "../../src/core/static-data/generated-artifact-loaders";

describe("GFS forecast cloud atlas precompute", () => {
  it("parses wgrib2 text output with and without an nx/ny header", async () => {
    const { parseWgrib2TextGrid } = await importGfsBuilder();

    expect(parseWgrib2TextGrid("1\n2\n3\n4\n", { expectedWidth: 2, expectedHeight: 2 })).toEqual({
      width: 2,
      height: 2,
      values: [1, 2, 3, 4],
    });
    expect(parseWgrib2TextGrid("2 2\n5\n6\n7\n8\n", { expectedWidth: 9, expectedHeight: 9 })).toEqual({
      width: 2,
      height: 2,
      values: [5, 6, 7, 8],
    });
  });

  it("maps GFS 0-360 longitude order into cloud-atlas -180..180 order", async () => {
    const { resampleGfsCloudCoverValues } = await importGfsBuilder();
    const values = resampleGfsCloudCoverValues({
      sourceValues: [
        0, 1, 2, 3,
        10, 11, 12, 13,
        20, 21, 22, 23,
      ],
      sourceWidth: 4,
      sourceHeight: 3,
      sourceResolutionDeg: 90,
      outputResolutionDeg: 90,
      outputWidth: 4,
      outputHeight: 3,
    });

    expect(values).toEqual([
      2, 3, 0, 1,
      12, 13, 10, 11,
      22, 23, 20, 21,
    ]);
  });

  it("normalizes cloud-water values into an optical-density proxy", async () => {
    const { normalizeCloudWaterToOpticalDensityValues } = await importGfsBuilder();

    expect(
      normalizeCloudWaterToOpticalDensityValues([0, 0.1, 0.2, 0.4], {
        referenceValue: 0.4,
        gamma: 1,
      }),
    ).toEqual([0, 25, 50, 100]);
  });

  it("normalizes GFS precipitation rate into a rain activity proxy", async () => {
    const { normalizePrecipitationRateToActivityValues } = await importGfsBuilder();

    expect(
      normalizePrecipitationRateToActivityValues([0, 0.0005, 0.001, 0.002], {
        referenceMmPerHour: 7.2,
        gamma: 1,
      }),
    ).toEqual([0, 25, 50, 100]);
  });

  it("writes forecast artifacts from mocked GFS index, byte-range, and decoder steps", async () => {
    const { buildCloudAtlasForecastGfs } = await importGfsBuilder();
    const outputDir = mkdtempSync(join(tmpdir(), "penumbra-gfs-forecast-"));
    const result = await buildCloudAtlasForecastGfs({
      outputDir,
      date: "20260506",
      cycleHour: 0,
      generatedAtUtc: "2026-05-06T06:10:00.000Z",
      forecastHours: [0, 3],
      resolutionDeg: 1,
      sourceResolutionDeg: 1,
      sourceWidth: 360,
      sourceHeight: 181,
      quiet: true,
      fetchText: async (url: string) => {
        if (url.endsWith(".f000.idx")) {
          return [
            "605:432596835:d=2026050600:CWAT:entire atmosphere (considered as a single layer):anl:",
            "606:433596835:d=2026050600:TMP:surface:anl:",
            "610:435570974:d=2026050600:HCDC:high cloud layer:anl:",
            "611:436283889:d=2026050600:TCDC:entire atmosphere:anl:",
            "612:437113679:d=2026050600:PRATE:surface:anl:",
            "613:437313679:d=2026050600:HGT:cloud ceiling:anl:",
          ].join("\n");
        }
        return [
          "634:447573006:d=2026050600:CWAT:entire atmosphere (considered as a single layer):3 hour fcst:",
          "635:448573006:d=2026050600:HCDC:high cloud layer:3 hour fcst:",
          "636:449133280:d=2026050600:TCDC:entire atmosphere:3 hour fcst:",
          "637:449955471:d=2026050600:TCDC:entire atmosphere:0-3 hour ave fcst:",
          "638:450710600:d=2026050600:PRATE:surface:0-3 hour ave fcst:",
          "639:451210600:d=2026050600:HGT:cloud ceiling:3 hour fcst:",
        ].join("\n");
      },
      fetchBytes: async (_url: string, rangeHeader: string) => new TextEncoder().encode(rangeHeader),
      decodeGribValues: async ({ field, plan }: { field: string; plan: { forecastHour: number } }) => ({
        width: 360,
        height: 181,
        values: Array.from({ length: 360 * 181 }, (_, index) =>
          field === "cloudWater"
            ? ((plan.forecastHour + index) % 251) / 100
            : field === "precipitationRate"
              ? ((plan.forecastHour + index) % 8) / 3600
            : (plan.forecastHour + index) % 101,
        ),
      }),
    });

    expect(result.frames).toHaveLength(2);
    expect(existsSync(join(outputDir, "manifest.json"))).toBe(true);
    const manifest = parseCloudAtlasManifestArtifact(
      JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf8")) as unknown,
    );
    expect(manifest.source.kind).toBe("noaa-gfs");
    expect(manifest.frames.map((frame) => frame.validAtUtc)).toEqual([
      "2026-05-06T00:00:00.000Z",
      "2026-05-06T03:00:00.000Z",
    ]);

    const frame = parseCloudAtlasArtifact(
      JSON.parse(readFileSync(join(outputDir, "f003.json"), "utf8")) as unknown,
    );
    expect(frame.values).toHaveLength(65160);
    expect(frame.opticalDensityValues).toHaveLength(65160);
    expect(frame.opticalDensityValuesEncoding).toBe("uint8-cloud-water-density-proxy-pct");
    expect(frame.precipitationValues).toHaveLength(65160);
    expect(frame.precipitationValuesEncoding).toBe("uint8-precipitation-activity-pct");
    expect(frame.precipitationValues?.some((value) => value > 0)).toBe(true);
    expect(frame.opticalDensityValues?.some((value) => value > 0)).toBe(true);
    expect(frame.values.slice(0, 4)).toEqual([82, 83, 84, 85]);
  });
});

async function importGfsBuilder(): Promise<{
  buildCloudAtlasForecastGfs: (options: Record<string, unknown>) => Promise<{
    frames: readonly unknown[];
  }>;
  parseWgrib2TextGrid: (
    text: string,
    options?: { expectedWidth?: number; expectedHeight?: number },
  ) => { width: number; height: number; values: number[] };
  resampleGfsCloudCoverValues: (options: {
    sourceValues: readonly number[];
    sourceWidth: number;
    sourceHeight: number;
    sourceResolutionDeg: number;
    outputResolutionDeg: number;
    outputWidth: number;
    outputHeight: number;
  }) => number[];
  normalizeCloudWaterToOpticalDensityValues: (
    values: readonly number[],
    options?: { referenceValue?: number; gamma?: number; referencePercentile?: number },
  ) => number[];
  normalizePrecipitationRateToActivityValues: (
    values: readonly number[],
    options?: { referenceMmPerHour?: number; gamma?: number },
  ) => number[];
}> {
  return import("../../scripts/precompute/build-cloud-atlas-forecast-gfs.mjs");
}

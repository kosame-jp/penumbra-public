import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseCloudAtlasArtifact,
  parseCloudAtlasManifestArtifact,
} from "../../src/core/static-data/generated-artifact-loaders";

describe("Open-Meteo forecast cloud atlas precompute", () => {
  it("builds hourly cloud-cover request URLs", async () => {
    const { openMeteoHourlyCloudCoverUrl } = await importForecastBuilder();
    const url = openMeteoHourlyCloudCoverUrl(
      [
        { latitudeDeg: 35, longitudeDeg: 139 },
        { latitudeDeg: -12.5, longitudeDeg: -42.25 },
      ],
      10,
    );

    expect(url).toContain("latitude=35%2C-12.5");
    expect(url).toContain("longitude=139%2C-42.25");
    expect(url).toContain("hourly=cloud_cover");
    expect(url).toContain("forecast_hours=10");
    expect(url).toContain("timezone=UTC");
  });

  it("parses forecast-hour values by requested offset", async () => {
    const { parseOpenMeteoHourlyCloudCoverResponse } = await importForecastBuilder();
    const parsed = parseOpenMeteoHourlyCloudCoverResponse(
      [
        {
          hourly: {
            time: ["2026-05-06T06:00", "2026-05-06T07:00", "2026-05-06T08:00", "2026-05-06T09:00"],
            cloud_cover: [10, 20, 30, 40],
          },
        },
        {
          hourly: {
            time: ["2026-05-06T06:00", "2026-05-06T07:00", "2026-05-06T08:00", "2026-05-06T09:00"],
            cloud_cover: [50, 60, 70, 80],
          },
        },
      ],
      2,
      [0, 3],
      "unit-test",
    );

    expect(parsed.valuesByHour.get(0)).toEqual([10, 50]);
    expect(parsed.valuesByHour.get(3)).toEqual([40, 80]);
    expect(parsed.validTimesByHour.get(3)).toEqual([
      "2026-05-06T09:00:00.000Z",
      "2026-05-06T09:00:00.000Z",
    ]);
  });

  it("writes a manifest and frame artifacts from mocked forecast batches", async () => {
    const { buildCloudAtlasForecast } = await importForecastBuilder();
    const outputDir = mkdtempSync(join(tmpdir(), "penumbra-cloud-forecast-"));
    const result = await buildCloudAtlasForecast({
      outputDir,
      requestDelayMs: 0,
      batchSize: 36,
      generatedAtUtc: "2026-05-06T06:10:00.000Z",
      forecastHours: [0, 3],
      quiet: true,
      fetchJson: async (url: string) => {
        const params = new URL(url).searchParams;
        const latitudes = params.get("latitude")?.split(",") ?? [];
        return latitudes.map((_, index) => ({
          hourly: {
            time: [
              "2026-05-06T06:00",
              "2026-05-06T07:00",
              "2026-05-06T08:00",
              "2026-05-06T09:00",
            ],
            cloud_cover: [index % 101, 12, 24, (index + 30) % 101],
          },
        }));
      },
    });

    expect(result.frames).toHaveLength(2);
    const manifest = parseCloudAtlasManifestArtifact(
      JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf8")) as unknown,
    );
    expect(manifest.frames.map((frame) => frame.label)).toEqual(["f000", "f003"]);

    const frame = parseCloudAtlasArtifact(
      JSON.parse(readFileSync(join(outputDir, "f003.json"), "utf8")) as unknown,
    );
    expect(frame.source.kind).toBe("open-meteo");
    expect(frame.source.forecastHour).toBe(3);
    expect(frame.values).toHaveLength(65160);
  });

  it("can publish versioned frames before atomically replacing the manifest", async () => {
    const { buildCloudAtlasForecast } = await importForecastBuilder();
    const outputDir = mkdtempSync(join(tmpdir(), "penumbra-cloud-forecast-atomic-"));
    writeFileSync(join(outputDir, "20260505T000000Z-f000.json"), "{}\n", "utf8");
    const result = await buildCloudAtlasForecast({
      outputDir,
      requestDelayMs: 0,
      batchSize: 36,
      sourceResolutionDeg: 30,
      generatedAtUtc: "2026-05-06T06:10:00.000Z",
      forecastHours: [0],
      atomicPublish: true,
      retainGenerations: 1,
      quiet: true,
      fetchJson: async (url: string) => {
        const params = new URL(url).searchParams;
        const latitudes = params.get("latitude")?.split(",") ?? [];
        return latitudes.map((_, index) => ({
          hourly: {
            time: ["2026-05-06T06:00"],
            cloud_cover: [(index * 7) % 101],
          },
        }));
      },
    });

    expect(result.frames).toHaveLength(1);
    const manifest = parseCloudAtlasManifestArtifact(
      JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf8")) as unknown,
    );
    expect((manifest.source as { readonly frameUrlMode?: string }).frameUrlMode).toBe("versioned");
    expect(manifest.frames[0]?.url).toBe("20260506T061000Z-f000.json");
    expect(existsSync(join(outputDir, "20260506T061000Z-f000.json"))).toBe(true);
    expect(existsSync(join(outputDir, "f000.json"))).toBe(false);
    expect(existsSync(join(outputDir, "20260505T000000Z-f000.json"))).toBe(false);
  });
});

async function importForecastBuilder(): Promise<{
  buildCloudAtlasForecast: (options: Record<string, unknown>) => Promise<{
    manifest: Record<string, unknown>;
    frames: readonly { readonly url?: string }[];
  }>;
  openMeteoHourlyCloudCoverUrl: (
    points: readonly { latitudeDeg: number; longitudeDeg: number }[],
    forecastHours: number,
  ) => string;
  parseOpenMeteoHourlyCloudCoverResponse: (
    response: unknown,
    expectedCount: number,
    forecastHours: readonly number[],
    source: string,
  ) => {
    valuesByHour: Map<number, readonly number[]>;
    validTimesByHour: Map<number, readonly string[]>;
  };
}> {
  return import("../../scripts/precompute/build-cloud-atlas-forecast-openmeteo.mjs");
}

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("cloud atlas forecast validator", () => {
  it("accepts a manifest whose frames exist and share shape", async () => {
    const { validateCloudAtlasForecast } = await importValidator();
    const root = mkdtempSync(join(tmpdir(), "penumbra-cloud-forecast-validator-"));
    const manifestPath = writeForecastFixture(root, [
      {
        url: "f000.json",
        validAtUtc: "2026-05-06T06:00:00.000Z",
        values: [0, 10, 20, 30],
      },
      {
        url: "f003.json",
        validAtUtc: "2026-05-06T09:00:00.000Z",
        values: [40, 50, 60, 70],
      },
    ]);

    const result = await validateCloudAtlasForecast(manifestPath, {
      nowUtcMs: Date.parse("2026-05-06T07:00:00.000Z"),
    });

    expect(result).toMatchObject({
      frameCount: 2,
      width: 2,
      height: 2,
      resolutionDeg: 1,
      firstValidAtUtc: "2026-05-06T06:00:00.000Z",
      lastValidAtUtc: "2026-05-06T09:00:00.000Z",
      freshness: {
        status: "current",
        usable: true,
      },
    });
  });

  it("passes the operational freshness check inside the hold window", async () => {
    const { validateCloudAtlasForecast } = await importValidator();
    const root = mkdtempSync(join(tmpdir(), "penumbra-cloud-forecast-validator-"));
    const manifestPath = writeForecastFixture(root, [
      {
        url: "f000.json",
        validAtUtc: "2026-05-06T06:00:00.000Z",
        values: [0, 10, 20, 30],
      },
      {
        url: "f003.json",
        validAtUtc: "2026-05-06T09:00:00.000Z",
        values: [40, 50, 60, 70],
      },
    ]);

    const result = await validateCloudAtlasForecast(manifestPath, {
      requireCurrent: true,
      nowUtcMs: Date.parse("2026-05-06T11:30:00.000Z"),
      maxHoldMs: 3 * 60 * 60 * 1000,
    });

    expect(result.freshness).toMatchObject({
      status: "hold",
      usable: true,
      holdMs: 2.5 * 60 * 60 * 1000,
    });
  });

  it("uses the 9 hour production hold window by default", async () => {
    const { validateCloudAtlasForecast } = await importValidator();
    const root = mkdtempSync(join(tmpdir(), "penumbra-cloud-forecast-validator-"));
    const manifestPath = writeForecastFixture(root, [
      {
        url: "f000.json",
        validAtUtc: "2026-05-06T06:00:00.000Z",
        values: [0, 10, 20, 30],
      },
      {
        url: "f015.json",
        validAtUtc: "2026-05-06T21:00:00.000Z",
        values: [40, 50, 60, 70],
      },
    ]);

    const result = await validateCloudAtlasForecast(manifestPath, {
      requireCurrent: true,
      nowUtcMs: Date.parse("2026-05-07T05:30:00.000Z"),
    });

    expect(result.freshness).toMatchObject({
      status: "hold",
      usable: true,
      maxHoldMs: 9 * 60 * 60 * 1000,
    });
  });

  it("rejects operationally stale forecasts when required", async () => {
    const { validateCloudAtlasForecast } = await importValidator();
    const root = mkdtempSync(join(tmpdir(), "penumbra-cloud-forecast-validator-"));
    const manifestPath = writeForecastFixture(root, [
      {
        url: "f000.json",
        validAtUtc: "2026-05-06T06:00:00.000Z",
        values: [0, 10, 20, 30],
      },
      {
        url: "f003.json",
        validAtUtc: "2026-05-06T09:00:00.000Z",
        values: [40, 50, 60, 70],
      },
    ]);

    await expect(
      validateCloudAtlasForecast(manifestPath, {
        requireCurrent: true,
        nowUtcMs: Date.parse("2026-05-06T12:01:00.000Z"),
        maxHoldMs: 3 * 60 * 60 * 1000,
      }),
    ).rejects.toThrow(/not operationally current/);
  });

  it("rejects non-monotonic forecast frame times", async () => {
    const { validateCloudAtlasForecast } = await importValidator();
    const root = mkdtempSync(join(tmpdir(), "penumbra-cloud-forecast-validator-"));
    const manifestPath = writeForecastFixture(root, [
      {
        url: "f003.json",
        validAtUtc: "2026-05-06T09:00:00.000Z",
        values: [0, 10, 20, 30],
      },
      {
        url: "f000.json",
        validAtUtc: "2026-05-06T06:00:00.000Z",
        values: [40, 50, 60, 70],
      },
    ]);

    await expect(validateCloudAtlasForecast(manifestPath)).rejects.toThrow(/strictly increasing/);
  });

  it("rejects frame artifacts with mismatched validAtUtc", async () => {
    const { validateCloudAtlasForecast } = await importValidator();
    const root = mkdtempSync(join(tmpdir(), "penumbra-cloud-forecast-validator-"));
    const manifestPath = writeForecastFixture(
      root,
      [
        {
          url: "f000.json",
          validAtUtc: "2026-05-06T06:00:00.000Z",
          artifactValidAtUtc: "2026-05-06T07:00:00.000Z",
          values: [0, 10, 20, 30],
        },
      ],
    );

    await expect(validateCloudAtlasForecast(manifestPath)).rejects.toThrow(/must match manifest/);
  });
});

async function importValidator(): Promise<{
  validateCloudAtlasForecast: (
    manifestPath: string,
    options?: {
      readonly requireCurrent?: boolean;
      readonly nowUtcMs?: number;
      readonly maxHoldMs?: number;
    },
  ) => Promise<{
    frameCount: number;
    width: number;
    height: number;
    resolutionDeg: number;
    firstValidAtUtc: string;
    lastValidAtUtc: string;
    freshness: {
      readonly status: string;
      readonly usable: boolean;
      readonly holdMs: number;
    };
  }>;
}> {
  return import("../../scripts/checks/validate-cloud-atlas-forecast.mjs");
}

interface ForecastFixtureFrame {
  readonly url: string;
  readonly validAtUtc: string;
  readonly artifactValidAtUtc?: string;
  readonly values: readonly number[];
}

function writeForecastFixture(root: string, frames: readonly ForecastFixtureFrame[]): string {
  const forecastDir = join(root, "cloud-atlas.forecast");
  mkdirSync(forecastDir, { recursive: true });
  const manifest = {
    version: "test-cloud-forecast",
    generatedAtUtc: "2026-05-06T06:10:00.000Z",
    activeCycleUtc: "2026-05-06T06:00:00.000Z",
    transitionDurationMinutes: 20,
    interpolation: "linear-time",
    source: {
      kind: "open-meteo",
      provenance: "unit test",
    },
    frames: frames.map((frame, index) => ({
      url: frame.url,
      validAtUtc: frame.validAtUtc,
      forecastHour: index * 3,
      label: frame.url.replace(".json", ""),
    })),
  };

  for (const frame of frames) {
    const artifact = {
      version: "test-cloud-atlas",
      generatedAtUtc: "2026-05-06T06:10:00.000Z",
      validAtUtc: frame.artifactValidAtUtc ?? frame.validAtUtc,
      resolutionDeg: 1,
      width: 2,
      height: 2,
      latitudeStartDeg: -90,
      longitudeStartDeg: -180,
      valuesEncoding: "uint8-cloud-cover-pct",
      source: {
        kind: "open-meteo",
        provenance: "unit test",
      },
      values: frame.values,
    };
    writeFileSync(join(forecastDir, frame.url), `${JSON.stringify(artifact)}\n`, "utf8");
  }

  const manifestPath = join(forecastDir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
  return manifestPath;
}

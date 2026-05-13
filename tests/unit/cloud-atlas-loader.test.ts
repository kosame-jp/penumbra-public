import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cloudAtlasSequenceFreshness,
  cloudAtlasDistributionStats,
  cloudAtlasOpticalDensityDistributionStats,
  cloudAtlasPrecipitationDistributionStats,
  loadCloudAtlasSequence,
  precipitation01At,
  type CloudAtlas,
  type CloudAtlasSequence,
} from "../../src/core/static-data/cloud-atlas-loader";

describe("cloud atlas loader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cache-busts forecast manifests and every referenced frame", async () => {
    const requestedUrls: string[] = [];
    const manifest = {
      version: "test-forecast",
      generatedAtUtc: "2026-05-06T06:00:00.000Z",
      activeCycleUtc: "2026-05-06T06:00:00.000Z",
      transitionDurationMinutes: 20,
      interpolation: "linear-time",
      source: {
        kind: "open-meteo",
        provenance: "test",
      },
      frames: [
        { url: "f000.json", validAtUtc: "2026-05-06T06:00:00.000Z", forecastHour: 0 },
        { url: "f003.json", validAtUtc: "2026-05-06T09:00:00.000Z", forecastHour: 3 },
      ],
    };

    vi.stubGlobal("fetch", async (url: string) => {
      requestedUrls.push(url);
      if (url.includes("manifest.json")) {
        return jsonResponse(manifest);
      }

      return jsonResponse({
        version: "test-atlas",
        generatedAtUtc: "2026-05-06T06:00:00.000Z",
        validAtUtc: url.includes("f003")
          ? "2026-05-06T09:00:00.000Z"
          : "2026-05-06T06:00:00.000Z",
        resolutionDeg: 1,
        width: 2,
        height: 2,
        latitudeStartDeg: -90,
        longitudeStartDeg: -180,
        valuesEncoding: "uint8-cloud-cover-pct",
        source: {
          kind: "open-meteo",
          provenance: "test",
        },
        values: [0, 25, 50, 100],
      });
    });

    const sequence = await loadCloudAtlasSequence("https://example.test/data/manifest.json", {
      cacheBust: "slot-12",
    });

    expect(sequence?.frames).toHaveLength(2);
    expect(requestedUrls).toEqual([
      "https://example.test/data/manifest.json?v=slot-12",
      "https://example.test/data/f000.json?v=slot-12",
      "https://example.test/data/f003.json?v=slot-12",
    ]);
  });

  it("summarizes cloud cover distribution for debug tuning", () => {
    const atlas = cloudAtlas({
      values: [0, 50, 75, 90, 95, 98, 99, 100],
    });

    const stats = cloudAtlasDistributionStats(atlas);

    expect(stats.p50Pct).toBe(90);
    expect(stats.p75Pct).toBe(98);
    expect(stats.p90Pct).toBe(100);
    expect(stats.p95Pct).toBe(100);
    expect(stats.p99Pct).toBe(100);
    expect(stats.maxPct).toBe(100);
    expect(stats.atLeast95Pct).toBeCloseTo(0.5, 8);
    expect(stats.atLeast98Pct).toBeCloseTo(0.375, 8);
    expect(stats.atLeast99Pct).toBeCloseTo(0.25, 8);
    expect(stats.fullCoverPct).toBeCloseTo(0.125, 8);
  });

  it("summarizes optional cloud-water optical density for debug tuning", () => {
    const atlas = cloudAtlas({
      opticalDensityValuesEncoding: "uint8-cloud-water-density-proxy-pct",
      opticalDensityValues: [0, 4, 8, 16, 32, 64, 96, 100],
    });

    const stats = cloudAtlasOpticalDensityDistributionStats(atlas);

    expect(stats?.p75Pct).toBe(64);
    expect(stats?.p99Pct).toBe(100);
    expect(stats?.maxPct).toBe(100);
  });

  it("samples optional precipitation activity from a cloud atlas", () => {
    const atlas = cloudAtlas({
      resolutionDeg: 90,
      width: 4,
      height: 3,
      values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      precipitationValuesEncoding: "uint8-precipitation-activity-pct",
      precipitationValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 80, 100],
    });

    expect(precipitation01At(atlas, 90, 90)).toBeCloseTo(1, 8);
    expect(precipitation01At(atlas, 0, 90)).toBeCloseTo(0, 8);

    const stats = cloudAtlasPrecipitationDistributionStats(atlas);
    expect(stats?.p90Pct).toBe(80);
    expect(stats?.maxPct).toBe(100);
  });

  it("marks forecast sequences current while UTC is inside the frame span", () => {
    const freshness = cloudAtlasSequenceFreshness(
      cloudAtlasSequence([
        "2026-05-06T06:00:00.000Z",
        "2026-05-06T09:00:00.000Z",
        "2026-05-06T12:00:00.000Z",
      ]),
      Date.parse("2026-05-06T10:30:00.000Z"),
    );

    expect(freshness).toMatchObject({
      status: "current",
      usable: true,
      firstValidAtUtc: "2026-05-06T06:00:00.000Z",
      lastValidAtUtc: "2026-05-06T12:00:00.000Z",
      holdMs: 0,
    });
  });

  it("allows a short hold after the newest forecast frame", () => {
    const freshness = cloudAtlasSequenceFreshness(
      cloudAtlasSequence(["2026-05-06T06:00:00.000Z", "2026-05-06T09:00:00.000Z"]),
      Date.parse("2026-05-06T11:30:00.000Z"),
      { maxHoldMs: 3 * 60 * 60 * 1000 },
    );

    expect(freshness.status).toBe("hold");
    expect(freshness.usable).toBe(true);
    expect(freshness.holdMs).toBe(2.5 * 60 * 60 * 1000);
  });

  it("rejects stale or future forecast sequences for runtime use", () => {
    const sequence = cloudAtlasSequence([
      "2026-05-06T06:00:00.000Z",
      "2026-05-06T09:00:00.000Z",
    ]);

    expect(
      cloudAtlasSequenceFreshness(sequence, Date.parse("2026-05-06T05:00:00.000Z")),
    ).toMatchObject({
      status: "future",
      usable: false,
    });
    expect(
      cloudAtlasSequenceFreshness(sequence, Date.parse("2026-05-06T18:01:00.000Z"), {
        maxHoldMs: 3 * 60 * 60 * 1000,
      }),
    ).toMatchObject({
      status: "stale",
      usable: false,
    });
  });
});

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function cloudAtlas(overrides: Partial<CloudAtlas>): CloudAtlas {
  return {
    version: "test-atlas",
    generatedAtUtc: "2026-05-06T06:00:00.000Z",
    validAtUtc: "2026-05-06T09:00:00.000Z",
    resolutionDeg: 1,
    width: 4,
    height: 2,
    latitudeStartDeg: -90,
    longitudeStartDeg: -180,
    valuesEncoding: "uint8-cloud-cover-pct",
    source: {
      kind: "noaa-gfs",
      provenance: "test",
    },
    values: [0, 50, 75, 90, 95, 98, 99, 100],
    ...overrides,
  };
}

function cloudAtlasSequence(validAtUtcValues: readonly string[]): CloudAtlasSequence {
  return {
    manifest: {
      version: "test-cloud-forecast",
      generatedAtUtc: "2026-05-06T06:10:00.000Z",
      activeCycleUtc: "2026-05-06T06:00:00.000Z",
      transitionDurationMinutes: 20,
      interpolation: "linear-time",
      source: {
        kind: "noaa-gfs",
        provenance: "unit test",
      },
      frames: validAtUtcValues.map((validAtUtc, index) => ({
        url: `f${String(index * 3).padStart(3, "0")}.json`,
        validAtUtc,
        forecastHour: index * 3,
      })),
    },
    frames: validAtUtcValues.map((validAtUtc, index) => ({
      url: `f${String(index * 3).padStart(3, "0")}.json`,
      validAtUtc,
      forecastHour: index * 3,
      atlas: cloudAtlas({ validAtUtc }),
      validAtMs: Date.parse(validAtUtc),
    })),
  };
}

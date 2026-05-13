import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { canonicalQuakeContact } from "../../src/core/fusion/quake-layer-params";
import { createCanonicalScanlineSamples } from "../../src/core/fusion/scanline-sample";
import { deriveAudioFrameParams } from "../../src/core/audio/audio-params";
import {
  LiveDataRuntime,
  shouldShowLiveWeatherFallback,
} from "../../src/app/live-data-runtime";
import {
  adaptOpenMeteoCurrentResponse,
  fetchOpenMeteoWeather,
  normalizeWeatherSample,
} from "../../src/core/live-data/openmeteo-client";
import { QuakeStore, type EarthquakeEvent } from "../../src/core/live-data/quake-store";
import {
  adaptUsgsFeatureCollection,
  fetchUsgsEarthquakes,
  USGS_ALL_DAY_URL,
} from "../../src/core/live-data/usgs-client";
import { getWeatherWithCacheFallback, WeatherCache } from "../../src/core/live-data/weather-cache";
import { createScanlineState } from "../../src/core/scanline/scanline-state";
import { dateFromUtcParts } from "../../src/core/time/utc-clock";
import {
  parseTuningKernelArtifact,
  parseWorldGridArtifact,
} from "../../src/core/static-data/generated-artifact-loaders";
import { findNearestWorldGridCell } from "../../src/core/static-data/worldgrid-loader";

describe("live data adapters and fusion", () => {
  it("adapts USGS features without filtering low magnitudes", async () => {
    const raw = {
      features: [
        {
          id: "low-mag",
          properties: {
            mag: 0.1,
            place: "fixture place",
            time: Date.UTC(2026, 3, 30, 0, 10),
            updated: null,
          },
          geometry: {
            coordinates: [139.5, 35.5, 12],
          },
        },
      ],
    } as const;

    const adapted = adaptUsgsFeatureCollection(raw);
    expect(adapted).toHaveLength(1);
    expect(adapted[0]?.magnitude).toBe(0.1);
    expect(adapted[0]?.updatedTimeUtc).toBe(adapted[0]?.eventTimeUtc);

    const requestedUrls: string[] = [];
    await expect(
      fetchUsgsEarthquakes(async (url) => {
        requestedUrls.push(url);
        return raw;
      }),
    ).resolves.toEqual(adapted);
    expect(requestedUrls).toEqual([USGS_ALL_DAY_URL]);
  });

  it("adapts and normalizes Open-Meteo current weather", async () => {
    const raw = {
      current: {
        time: "2026-04-30T00:00",
        temperature_2m: 20,
        relative_humidity_2m: 75,
        pressure_msl: 1009,
        wind_speed_10m: 18,
        cloud_cover: 60,
        precipitation: 2,
        weather_code: 3,
      },
    };

    const sample = adaptOpenMeteoCurrentResponse(raw);
    expect(sample.windSpeedMps).toBeCloseTo(5, 6);
    expect(normalizeWeatherSample(sample)).toMatchObject({
      cloudNorm: 0.6,
      humidityNorm: 0.75,
      precipitationNorm: 0.1,
    });
    await expect(fetchOpenMeteoWeather(async () => raw, 35, 139)).resolves.toEqual(sample);
  });

  it("evicts stale quakes after the 81-minute window plus margin", () => {
    const now = dateFromUtcParts(2026, 4, 30, 12, 0);
    const store = new QuakeStore();
    store.upsertMany([
      quake("fresh", "2026-04-30T10:40:00Z"),
      quake("evict", "2026-04-30T10:20:00Z"),
    ]);

    expect(store.evictStale(now)).toBe(1);
    expect(store.list().map((event) => event.id)).toEqual(["fresh"]);
  });

  it("derives canonical quake contact params without magnitude thresholding", () => {
    const scanlineState = createScanlineState(dateFromUtcParts(2026, 3, 20, 12));
    const tinyQuake = quake("tiny", "2026-03-20T11:30:00Z", 0.1);
    const contact = canonicalQuakeContact(
      { ...tinyQuake, longitudeDeg: scanlineState.equatorLongitudeDeg },
      scanlineState.utc.date,
      scanlineState,
    );

    expect(contact?.velocity01).toBeCloseTo(0.01, 6);
    expect(contact?.scanlineWeight).toBeCloseTo(1, 6);
  });

  it("uses documented weather cache fallback for missing and stale entries", () => {
    const cache = new WeatherCache();
    const now = dateFromUtcParts(2026, 4, 30, 12, 0);

    expect(cache.getOrFallback("missing", now)).toMatchObject({
      source: "fallback",
      reason: "weather cache entry missing is missing",
    });

    cache.set(
      "tokyo",
      {
        cloudCoverPct: 10,
        relativeHumidityPct: 20,
        windSpeedMps: 1,
        precipitationMm: 0,
        temperatureC: 22,
      },
      dateFromUtcParts(2026, 4, 30, 10, 0),
      30,
    );
    expect(cache.getOrFallback("tokyo", now)).toMatchObject({
      source: "fallback",
      reason: "weather cache entry tokyo is stale",
    });
  });

  it("prunes stale weather cache entries after a short grace period", () => {
    const cache = new WeatherCache();
    cache.set(
      "old",
      {
        cloudCoverPct: 10,
        relativeHumidityPct: 20,
        windSpeedMps: 1,
        precipitationMm: 0,
        temperatureC: 22,
      },
      dateFromUtcParts(2026, 4, 30, 10, 0),
      30,
    );
    cache.set(
      "fresh",
      {
        cloudCoverPct: 70,
        relativeHumidityPct: 65,
        windSpeedMps: 4,
        precipitationMm: 1,
        temperatureC: 18,
      },
      dateFromUtcParts(2026, 4, 30, 11, 45),
      30,
    );

    expect(cache.pruneStale(dateFromUtcParts(2026, 4, 30, 12, 0), 10)).toBe(1);
    expect(cache.size()).toBe(1);
    expect(cache.getOrFallback("fresh", dateFromUtcParts(2026, 4, 30, 12, 0)).source).toBe("cache");
  });

  it("reports failed weather fetches through the fallback path", async () => {
    const cache = new WeatherCache();
    const result = await getWeatherWithCacheFallback(
      cache,
      "tokyo",
      async () => {
        throw new Error("network unavailable");
      },
      dateFromUtcParts(2026, 4, 30, 12, 0),
    );

    expect(result).toMatchObject({
      source: "fallback",
      reason: "weather fetch failed for tokyo: network unavailable",
    });
  });

  it("seeds fixture quakes and merges live USGS events in the app runtime", async () => {
    const now = dateFromUtcParts(2026, 4, 30, 12, 0);
    const raw = {
      features: [
        {
          id: "live-low-mag",
          properties: {
            mag: 0.1,
            place: "runtime fixture",
            time: Date.UTC(2026, 3, 30, 11, 50),
            updated: null,
          },
          geometry: {
            coordinates: [140, 36, 8],
          },
        },
      ],
    } as const;
    const requestedUrls: string[] = [];
    const runtime = new LiveDataRuntime({
      fetchJson: async (url) => {
        requestedUrls.push(url);
        return raw;
      },
      quakePollIntervalMs: 0,
    });

    runtime.seedQuakes([quake("fixture", "2026-04-30T11:40:00Z", 0.1)]);
    await runtime.maybePollQuakes(now);

    expect(requestedUrls).toEqual([USGS_ALL_DAY_URL]);
    expect(runtime.listQuakes(now).map((event) => event.id)).toEqual([
      "fixture",
      "live-low-mag",
    ]);
  });

  it("refreshes scanline-local weather into the app runtime cache", async () => {
    const worldGrid = parseWorldGridArtifact(readJson("tests/fixtures/valid/worldgrid.sample.json"));
    const now = dateFromUtcParts(2026, 4, 30, 12, 0);
    const scanlineState = createScanlineState(now);
    const rawWeather = {
      current: {
        time: "2026-04-30T12:00",
        temperature_2m: 18,
        relative_humidity_2m: 80,
        pressure_msl: 1006,
        wind_speed_10m: 10.8,
        cloud_cover: 72,
        precipitation: 0.4,
      },
    };
    const runtime = new LiveDataRuntime({
      fetchJson: async () => rawWeather,
      weatherSweepIntervalMs: 0,
      weatherTtlMinutes: 45,
      maxWeatherFetchesPerSweep: 37,
    });

    await runtime.maybeRefreshWeatherForScanline(scanlineState, worldGrid, now);

    const touchedCellIds = new Set(
      scanlineState.points.flatMap((point) =>
        point.sunriseLongitudeDeg == null
          ? []
          : [
              findNearestWorldGridCell(
                worldGrid,
                point.latitudeDeg,
                point.sunriseLongitudeDeg,
              ).id,
            ],
      ),
    );
    expect(runtime.weatherCacheSize()).toBe(touchedCellIds.size);
    for (const cellId of touchedCellIds) {
      expect(runtime.getWeatherForCell(cellId, now)).toMatchObject({
        cloudCoverPct: 72,
        relativeHumidityPct: 80,
        windSpeedMps: 3,
      });
    }
  });

  it("keeps isolated live weather request failures out of the visible fallback status", async () => {
    const worldGrid = parseWorldGridArtifact(readJson("tests/fixtures/valid/worldgrid.sample.json"));
    const now = dateFromUtcParts(2026, 4, 30, 12, 0);
    const scanlineState = createScanlineState(now);
    const rawWeather = {
      current: {
        time: "2026-04-30T12:00",
        temperature_2m: 18,
        relative_humidity_2m: 80,
        pressure_msl: 1006,
        wind_speed_10m: 10.8,
        cloud_cover: 72,
        precipitation: 0.4,
      },
    };
    let requestCount = 0;
    const runtime = new LiveDataRuntime({
      fetchJson: async () => {
        requestCount += 1;
        if (requestCount === 1) {
          throw new Error("transient mobile fetch failure");
        }
        return rawWeather;
      },
      weatherSweepIntervalMs: 0,
      weatherTtlMinutes: 45,
      maxWeatherFetchesPerSweep: 37,
    });

    await runtime.maybeRefreshWeatherForScanline(scanlineState, worldGrid, now);

    const diagnostics = runtime.diagnostics(now);
    expect(diagnostics.lastWeatherWarning).toContain("weather requests failed");
    expect(diagnostics.lastWeatherFailedCount).toBe(1);
    expect(diagnostics.lastWeatherRequestCount).toBeGreaterThan(1);
    expect(diagnostics.lastWeatherError).toBeUndefined();
  });

  it("only shows live weather fallback for all-failed or substantially degraded sweeps", () => {
    expect(
      shouldShowLiveWeatherFallback({
        failedCount: 1,
        fulfilledCount: 36,
        failureRatio: 1 / 37,
      }),
    ).toBe(false);
    expect(
      shouldShowLiveWeatherFallback({
        failedCount: 4,
        fulfilledCount: 12,
        failureRatio: 0.25,
      }),
    ).toBe(true);
    expect(
      shouldShowLiveWeatherFallback({
        failedCount: 1,
        fulfilledCount: 0,
        failureRatio: 1,
      }),
    ).toBe(true);
  });

  it("keeps fixture quakes and default weather available when live fetches fail", async () => {
    const worldGrid = parseWorldGridArtifact(readJson("tests/fixtures/valid/worldgrid.sample.json"));
    const now = dateFromUtcParts(2026, 4, 30, 12, 0);
    const scanlineState = createScanlineState(now);
    const runtime = new LiveDataRuntime({
      fetchJson: async () => {
        throw new Error("offline");
      },
      quakePollIntervalMs: 0,
      weatherSweepIntervalMs: 0,
    });

    runtime.seedQuakes([quake("fixture", "2026-04-30T11:40:00Z", 0.1)]);
    await expect(runtime.maybePollQuakes(now)).resolves.toBeUndefined();
    await expect(runtime.maybeRefreshWeatherForScanline(scanlineState, worldGrid, now)).resolves.toBeUndefined();

    expect(runtime.listQuakes(now).map((event) => event.id)).toEqual(["fixture"]);
    expect(runtime.weatherCacheSize()).toBe(0);
    expect(runtime.diagnostics(now).lastWeatherError).toContain("weather requests failed");
  });

  it("keeps scanline fusion serializable for debug surfaces", () => {
    const worldGrid = parseWorldGridArtifact(readJson("tests/fixtures/valid/worldgrid.sample.json"));
    const tuningKernels = parseTuningKernelArtifact(readJson("public/data/tuning-kernels.json"));
    const scanlineState = createScanlineState(dateFromUtcParts(2026, 4, 30, 0, 30));
    const samples = createCanonicalScanlineSamples({
      scanlineState,
      worldGrid,
      tuningKernels,
      quakes: [quake("tiny", "2026-04-30T00:00:00Z", 0.1)],
    });

    expect(() => JSON.stringify(samples)).not.toThrow();
    expect(samples.length).toBeGreaterThan(0);
    expect(samples[0]).toHaveProperty("layers.earth.active", true);
  });

  it("keeps center scanline samples active even with sparse fixture grids", () => {
    const worldGrid = parseWorldGridArtifact(readJson("tests/fixtures/valid/worldgrid.sample.json"));
    const tuningKernels = parseTuningKernelArtifact(readJson("public/data/tuning-kernels.json"));
    const scanlineState = createScanlineState(dateFromUtcParts(2026, 4, 30, 6, 45));
    const samples = createCanonicalScanlineSamples({
      scanlineState,
      worldGrid,
      tuningKernels,
    });

    expect(samples).not.toHaveLength(0);
    expect(samples.every((sample) => sample.scanlineWeight === 1)).toBe(true);
    expect(deriveAudioFrameParams(samples).earth.gain01).toBeGreaterThan(0.05);
  });
});

function quake(id: string, eventTimeUtc: string, magnitude = 4): EarthquakeEvent {
  return {
    id,
    provider: "test",
    eventTimeUtc,
    updatedTimeUtc: eventTimeUtc,
    latitudeDeg: 0,
    longitudeDeg: 0,
    depthKm: 10,
    magnitude,
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as unknown;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseCloudAtlasArtifact,
  parseCloudAtlasManifestArtifact,
  parseEarthquakeEventArtifact,
  parseScanlineSampleArtifact,
  parseTuningKernelArtifact,
  parseWeatherCacheEntryArtifact,
  parseWorldGridArtifact,
} from "../../src/core/static-data/generated-artifact-loaders";
import { validateArtifact, type ArtifactKind } from "../../src/core/static-data/schema-validation";
import { weatherSampleFromCacheEntry } from "../../src/core/static-data/canonical-accessors";

const fixtureRoot = join(process.cwd(), "tests", "fixtures");

const validFixtures: readonly [ArtifactKind, string][] = [
  ["cloud-atlas", "cloud-atlas.sample.json"],
  ["cloud-atlas-manifest", "cloud-atlas-manifest.sample.json"],
  ["worldgrid", "worldgrid.sample.json"],
  ["weather-cache-entry", "weather-cache-entry.sample.json"],
  ["earthquake-event", "earthquake-event.sample.json"],
  ["scanline-sample", "scanline-sample.sample.json"],
  ["tuning-kernels", "tuning-kernels.provisional.json"],
];

const invalidFixtures: readonly [ArtifactKind, string][] = [
  ["cloud-atlas", "cloud-atlas.bad-values.json"],
  ["cloud-atlas-manifest", "cloud-atlas-manifest.bad-frames.json"],
  ["worldgrid", "worldgrid.missing-stats.json"],
  ["weather-cache-entry", "weather-cache-entry.bad-humidity.json"],
  ["earthquake-event", "earthquake-event.bad-latitude.json"],
  ["scanline-sample", "scanline-sample.extra-field.json"],
  ["tuning-kernels", "tuning-kernels.missing-provenance.json"],
];

describe("PENUMBRA data artifact schema validation", () => {
  it.each(validFixtures)("accepts valid %s fixture", (kind, fileName) => {
    expect(validateArtifact(kind, readFixture("valid", fileName))).toEqual({ valid: true });
  });

  it.each(invalidFixtures)("rejects invalid %s fixture", (kind, fileName) => {
    const result = validateArtifact(kind, readFixture("invalid", fileName));
    expect(result.valid).toBe(false);
  });

  it("parses generated artifact fixtures through loader functions", () => {
    expect(parseCloudAtlasArtifact(readFixture("valid", "cloud-atlas.sample.json")).values).toHaveLength(12);
    expect(parseCloudAtlasManifestArtifact(readFixture("valid", "cloud-atlas-manifest.sample.json")).frames).toHaveLength(2);
    expect(parseWorldGridArtifact(readFixture("valid", "worldgrid.sample.json")).cells).toHaveLength(3);
    expect(parseWeatherCacheEntryArtifact(readFixture("valid", "weather-cache-entry.sample.json")).cacheKey).toBe("35.0_139.0_2026-04-29T10");
    expect(parseEarthquakeEventArtifact(readFixture("valid", "earthquake-event.sample.json")).magnitude).toBe(5.7);
    expect(parseScanlineSampleArtifact(readFixture("valid", "scanline-sample.sample.json")).cellId).toBe("tokyo-bay-sample");
    expect(parseTuningKernelArtifact(readFixture("valid", "tuning-kernels.provisional.json")).kernels).toHaveLength(8);
  });

  it("exposes runtime-safe weather access from cache entries", () => {
    const entry = parseWeatherCacheEntryArtifact(readFixture("valid", "weather-cache-entry.sample.json"));
    expect(weatherSampleFromCacheEntry(entry)).toEqual({
      cloudCoverPct: 64,
      relativeHumidityPct: 72,
      windSpeedMps: 4.2,
      precipitationMm: 0.2,
      temperatureC: 18.2,
      pressureHpa: 1008.4,
    });
  });
});

function readFixture(kind: "valid" | "invalid", fileName: string): unknown {
  return JSON.parse(readFileSync(join(fixtureRoot, kind, fileName), "utf8")) as unknown;
}

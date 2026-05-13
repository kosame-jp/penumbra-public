import { describe, expect, it } from "vitest";

import { tuningModeAtmosphereFromCloudAtlasSequence } from "../../src/core/fusion/forecast-mode-atmosphere";
import type {
  CloudAtlas,
  CloudAtlasSequence,
  LoadedCloudAtlasFrame,
} from "../../src/core/static-data/cloud-atlas-loader";

describe("forecast mode atmosphere", () => {
  it("derives quantized mode atmosphere from shared GFS cloud atlas frames", () => {
    const atmosphere = tuningModeAtmosphereFromCloudAtlasSequence({
      sequence: sequence([
        cloudAtlas({
          validAtUtc: "2026-05-09T00:00:00.000Z",
          values: filledValues(30),
          opticalDensityValuesEncoding: "uint8-cloud-water-density-proxy-pct",
          opticalDensityValues: filledValues(20),
          precipitationValuesEncoding: "uint8-precipitation-activity-pct",
          precipitationValues: filledValues(10),
        }),
        cloudAtlas({
          validAtUtc: "2026-05-09T03:00:00.000Z",
          values: filledValues(90),
          opticalDensityValuesEncoding: "uint8-cloud-water-density-proxy-pct",
          opticalDensityValues: filledValues(70),
          precipitationValuesEncoding: "uint8-precipitation-activity-pct",
          precipitationValues: filledValues(50),
        }),
      ]),
      utcMs: Date.parse("2026-05-09T01:30:00.000Z"),
      latitudeDeg: 0,
      longitudeDeg: 0,
    });

    expect(atmosphere).toEqual({
      source: "gfs-forecast-artifact",
      cloudNorm: 0.6,
      atmosphericWetnessNorm: 0.5,
      precipitationNorm: 0.3,
    });
  });

  it("returns no atmosphere when no shared forecast sequence is usable", () => {
    expect(
      tuningModeAtmosphereFromCloudAtlasSequence({
        sequence: undefined,
        utcMs: Date.parse("2026-05-09T00:00:00.000Z"),
        latitudeDeg: 0,
        longitudeDeg: 0,
      }),
    ).toBeUndefined();
  });
});

function sequence(atlases: readonly CloudAtlas[]): CloudAtlasSequence {
  const frames = atlases.map(frameForAtlas);
  return {
    manifest: {
      version: "test-cloud-forecast",
      generatedAtUtc: "2026-05-09T00:00:00.000Z",
      activeCycleUtc: "2026-05-09T00:00:00.000Z",
      interpolation: "linear-time",
      source: {
        kind: "noaa-gfs",
        provenance: "unit test",
      },
      frames,
    },
    frames,
  };
}

function cloudAtlas(overrides: Partial<CloudAtlas>): CloudAtlas {
  return {
    version: "test-atlas",
    generatedAtUtc: "2026-05-09T00:00:00.000Z",
    validAtUtc: "2026-05-09T00:00:00.000Z",
    resolutionDeg: 1,
    width: 360,
    height: 181,
    latitudeStartDeg: -90,
    longitudeStartDeg: -180,
    valuesEncoding: "uint8-cloud-cover-pct",
    source: {
      kind: "noaa-gfs",
      provenance: "unit test",
    },
    values: filledValues(0),
    ...overrides,
  };
}

function frameForAtlas(atlas: CloudAtlas, index: number): LoadedCloudAtlasFrame {
  return {
    url: `f${String(index * 3).padStart(3, "0")}.json`,
    validAtUtc: atlas.validAtUtc,
    forecastHour: index * 3,
    atlas,
    validAtMs: Date.parse(atlas.validAtUtc),
  };
}

function filledValues(valuePct: number): number[] {
  return new Array<number>(360 * 181).fill(valuePct);
}

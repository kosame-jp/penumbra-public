import { describe, expect, it } from "vitest";

import { precipitationBandFieldFromCloudAtlasSequence } from "../../src/core/fusion/precipitation-band";
import { createScanlineState } from "../../src/core/scanline/scanline-state";
import type {
  CloudAtlas,
  CloudAtlasSequence,
  LoadedCloudAtlasFrame,
} from "../../src/core/static-data/cloud-atlas-loader";

describe("precipitation atlas band", () => {
  it("summarizes precipitation across the sunrise Gaussian band", () => {
    const scanlineState = createScanlineState(new Date("2026-05-07T00:00:00.000Z"));
    const field = precipitationBandFieldFromCloudAtlasSequence({
      sequence: sequenceWithPrecipitation(100),
      scanlineState,
      options: { latitudeStepDeg: 10, longitudeStepDeg: 5 },
    });

    expect(field?.active).toBe(true);
    expect(field?.activity01).toBeCloseTo(1, 8);
    expect(field?.coverage01).toBeCloseTo(1, 8);
    expect(field?.intensity01).toBeCloseTo(1, 8);
    expect(field?.maxPrecipitation01).toBe(1);
    expect(field?.rainySampleCount).toBeGreaterThan(0);
  });

  it("suppresses non-heavy precipitation so width-band drizzle does not become visual noise", () => {
    const scanlineState = createScanlineState(new Date("2026-05-07T00:00:00.000Z"));
    const field = precipitationBandFieldFromCloudAtlasSequence({
      sequence: sequenceWithPrecipitation(45),
      scanlineState,
      options: { latitudeStepDeg: 10, longitudeStepDeg: 5 },
    });

    expect(field?.activity01).toBe(0);
    expect(field?.coverage01).toBe(0);
    expect(field?.rainySampleCount).toBe(0);
  });

  it("only exposes visual rain candidates for significant precipitation cells", () => {
    const scanlineState = createScanlineState(new Date("2026-05-07T00:00:00.000Z"));
    const field = precipitationBandFieldFromCloudAtlasSequence({
      sequence: sequenceWithPrecipitation(69),
      scanlineState,
      options: { latitudeStepDeg: 10, longitudeStepDeg: 5 },
    });

    expect(field?.active).toBe(true);
    expect(field?.activity01).toBeGreaterThan(0);
    expect(field?.rainySampleCount).toBe(0);
  });

  it("keeps heavy precipitation visible and audible after the gate", () => {
    const scanlineState = createScanlineState(new Date("2026-05-07T00:00:00.000Z"));
    const field = precipitationBandFieldFromCloudAtlasSequence({
      sequence: sequenceWithPrecipitation(82),
      scanlineState,
      options: { latitudeStepDeg: 10, longitudeStepDeg: 5 },
    });

    expect(field?.active).toBe(true);
    expect(field?.activity01).toBeGreaterThan(0.05);
    expect(field?.coverage01).toBeGreaterThan(0.05);
    expect(field?.rainySampleCount).toBeGreaterThan(0);
  });

  it("falls back when the forecast frames do not carry precipitation", () => {
    const scanlineState = createScanlineState(new Date("2026-05-07T00:00:00.000Z"));

    expect(
      precipitationBandFieldFromCloudAtlasSequence({
        sequence: sequenceWithoutPrecipitation(),
        scanlineState,
      }),
    ).toBeUndefined();
  });
});

function sequenceWithPrecipitation(valuePct: number): CloudAtlasSequence {
  const atlas = cloudAtlas({
    precipitationValuesEncoding: "uint8-precipitation-activity-pct",
    precipitationValues: new Array<number>(360 * 181).fill(valuePct),
  });
  const frame = frameForAtlas(atlas);
  return {
    manifest: {
      version: "test",
      generatedAtUtc: atlas.generatedAtUtc,
      interpolation: "linear-time",
      source: atlas.source,
      frames: [frame],
    },
    frames: [frame],
  };
}

function sequenceWithoutPrecipitation(): CloudAtlasSequence {
  const atlas = cloudAtlas({});
  const frame = frameForAtlas(atlas);
  return {
    manifest: {
      version: "test",
      generatedAtUtc: atlas.generatedAtUtc,
      interpolation: "linear-time",
      source: atlas.source,
      frames: [frame],
    },
    frames: [frame],
  };
}

function cloudAtlas(overrides: Partial<CloudAtlas>): CloudAtlas {
  return {
    version: "test-atlas",
    generatedAtUtc: "2026-05-07T00:00:00.000Z",
    validAtUtc: "2026-05-07T00:00:00.000Z",
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
    values: new Array<number>(360 * 181).fill(0),
    ...overrides,
  };
}

function frameForAtlas(atlas: CloudAtlas): LoadedCloudAtlasFrame {
  return {
    url: "f000.json",
    validAtUtc: atlas.validAtUtc,
    atlas,
    validAtMs: Date.parse(atlas.validAtUtc),
  };
}

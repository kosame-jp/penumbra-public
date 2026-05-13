import { describe, expect, it } from "vitest";

import {
  createCanonicalScanlineSamples,
  HUMAN_PITCH_REGISTER_OFFSET_SEMITONES,
} from "../../src/core/fusion/scanline-sample";
import {
  nextNightLightForecast,
  scanlineNightLightContacts,
} from "../../src/core/fusion/nightlight-contacts";
import { gaussianWeight } from "../../src/core/scanline/gaussian";
import { midiToHz } from "../../src/core/fusion/register";
import type { ScanlineState } from "../../src/core/scanline/scanline-state";
import { dateFromUtcParts, createCanonicalUtcState } from "../../src/core/time/utc-clock";
import type { WeatherSample } from "../../src/core/live-data/openmeteo-client";
import type { TuningKernelSet } from "../../src/core/static-data/kernels-loader";
import type { WorldGrid, WorldGridCell } from "../../src/core/static-data/worldgrid-loader";

describe("nightlight scanline contacts", () => {
  it("activates human music from nightlights inside the Gaussian scanline band", () => {
    const scanlineState = scanlineStateAtLongitude(0);
    const worldGrid = worldGridWithCells([
      cell("center-dark", 0, 0, 0),
      cell("off-center-light", 0, 7, 10),
      cell("out-of-reach-light", 0, 50, 10),
    ]);

    const contacts = scanlineNightLightContacts({ scanlineState, worldGrid });

    expect(contacts.map((contact) => contact.cell.id)).toEqual(["off-center-light"]);
    expect(contacts[0]?.scanlineWeight).toBeCloseTo(gaussianWeight(7, 7), 8);
  });

  it("adds nightlight contact samples without moving the centerline earth sample", () => {
    const samples = createCanonicalScanlineSamples({
      scanlineState: scanlineStateAtLongitude(0),
      worldGrid: worldGridWithCells([
        cell("center-dark", 0, 0, 0, 250),
        cell("off-center-light", 0, 7, 10, 500),
      ]),
      tuningKernels: tuningKernels(),
    });

    const centerline = samples.find((sample) => sample.cellId === "center-dark");
    const contact = samples.find((sample) => sample.cellId === "off-center-light");

    expect(centerline?.layers.earth.active).toBe(true);
    expect(centerline?.layers.music.active).toBe(false);
    expect(contact?.layers.earth.active).toBe(false);
    expect(contact?.layers.music.active).toBe(true);
    expect(contact?.scanlineWeight).toBeCloseTo(gaussianWeight(7, 7), 8);
    expect(centerline?.registerMidi).toBe(54);
    expect(contact?.registerMidi).toBe(60);
    expect(contact?.layers.music.frequencyHz).toBeCloseTo(
      midiToHz(59 + HUMAN_PITCH_REGISTER_OFFSET_SEMITONES),
      8,
    );
  });

  it("can read human contacts from a denser contact grid while preserving centerline earth", () => {
    const samples = createCanonicalScanlineSamples({
      scanlineState: scanlineStateAtLongitude(0),
      worldGrid: worldGridWithCells([cell("canonical-center", 0, 0, 0, 250)]),
      musicContactWorldGrid: worldGridWithCells([
        cell("contact-center", 0, 0, 10, 300),
        cell("contact-edge", 0, 21, 10, 500),
      ]),
      tuningKernels: tuningKernels(),
    });

    const centerline = samples.find((sample) => sample.cellId === "canonical-center");
    const contact = samples.find((sample) => sample.cellId === "contact-center");

    expect(centerline?.layers.earth.active).toBe(true);
    expect(contact?.layers.earth.active).toBe(false);
    expect(contact?.layers.music.active).toBe(true);
    expect(contact?.scanlineWeight).toBe(1);
  });

  it("keeps every nightlight contact inside the active reach as a candidate", () => {
    const contacts = scanlineNightLightContacts({
      scanlineState: scanlineStateAtLongitude(0),
      worldGrid: worldGridWithCells([
        cell("center-light", 0, 0, 10),
        cell("middle-light", 0, 14, 10),
        cell("edge-light", 0, 21, 10),
        cell("outside-light", 0, 25, 10),
      ]),
    });

    expect(contacts.map((contact) => contact.cell.id)).toEqual([
      "center-light",
      "middle-light",
      "edge-light",
    ]);
    expect(contacts.find((contact) => contact.cell.id === "edge-light")?.scanlineWeight).toBeCloseTo(
      gaussianWeight(21, 7),
      8,
    );
  });

  it("derives 3x3 nightlight topology for contact timbre decisions", () => {
    const isolatedSamples = createCanonicalScanlineSamples({
      scanlineState: scanlineStateAtLongitude(0),
      worldGrid: worldGridWithCells([cell("canonical-center", 0, 0, 0)]),
      musicContactWorldGrid: worldGridWithCells([cell("isolated", 0, 0, 10)]),
      tuningKernels: tuningKernels(),
    });
    const clusteredSamples = createCanonicalScanlineSamples({
      scanlineState: scanlineStateAtLongitude(0),
      worldGrid: worldGridWithCells([cell("canonical-center", 0, 0, 0)]),
      musicContactWorldGrid: worldGridWithCells([
        cell("cluster-center", 0, 0, 10),
        cell("cluster-n", 5, 0, 6),
        cell("cluster-s", -5, 0, 6),
        cell("cluster-e", 0, 5, 6),
        cell("cluster-w", 0, -5, 6),
        cell("cluster-ne", 5, 5, 4),
        cell("cluster-nw", 5, -5, 4),
        cell("cluster-se", -5, 5, 4),
        cell("cluster-sw", -5, -5, 4),
      ]),
      tuningKernels: tuningKernels(),
    });

    const isolated = isolatedSamples.find((sample) => sample.cellId === "isolated");
    const clustered = clusteredSamples.find((sample) => sample.cellId === "cluster-center");

    expect(isolated?.nightLightTopology.isolation01).toBeGreaterThan(0.8);
    expect(isolated?.nightLightTopology.continuity01).toBeLessThan(0.1);
    expect(clustered?.nightLightTopology.continuity01).toBeGreaterThan(0.4);
    expect(clustered?.nightLightTopology.isolation01).toBeLessThan(isolated?.nightLightTopology.isolation01 ?? 0);
  });

  it("keeps scale mode selection independent from browser-local live weather", () => {
    const drySamples = createCanonicalScanlineSamples({
      scanlineState: scanlineStateAtLongitude(0),
      worldGrid: worldGridWithCells([cell("canonical-center", 0, 0, 0)]),
      musicContactWorldGrid: worldGridWithCells([cell("contact", 0, 0, 10)]),
      tuningKernels: tuningKernelsWithModes(),
      weatherForCell: () => weather({ cloudCoverPct: 5, precipitationMm: 0, windSpeedMps: 0.4 }),
    });
    const stormSamples = createCanonicalScanlineSamples({
      scanlineState: scanlineStateAtLongitude(0),
      worldGrid: worldGridWithCells([cell("canonical-center", 0, 0, 0)]),
      musicContactWorldGrid: worldGridWithCells([cell("contact", 0, 0, 10)]),
      tuningKernels: tuningKernelsWithModes(),
      weatherForCell: () => weather({ cloudCoverPct: 100, precipitationMm: 8, windSpeedMps: 18 }),
    });

    const dryMode = drySamples.find((sample) => sample.cellId === "contact")?.tuning.selectedScaleModeId;
    const stormMode = stormSamples.find((sample) => sample.cellId === "contact")?.tuning.selectedScaleModeId;

    expect(dryMode).toBeTruthy();
    expect(stormMode).toBe(dryMode);
  });

  it("forecasts the next debug-checkable nightlight contact in UTC", () => {
    const forecast = nextNightLightForecast({
      startDate: dateFromUtcParts(2026, 4, 30, 0, 0),
      worldGrid: worldGridWithCells([cell("future-light", 0, -105, 10)]),
      stepMinutes: 10,
      horizonMinutes: 24 * 60,
      minGain01: 0.05,
    });

    expect(forecast?.utcIso).toMatch(/Z$/);
    expect(forecast?.minutesFromNow).toBeGreaterThanOrEqual(0);
    expect(forecast?.contact.cell.id).toBe("future-light");
  });
});

function scanlineStateAtLongitude(equatorLongitudeDeg: number): ScanlineState {
  const utc = createCanonicalUtcState(dateFromUtcParts(2026, 4, 30, 0, 0));
  return {
    utc,
    solar: {
      utcIso: utc.iso,
      julianDay: 0,
      solarDeclinationDeg: 0,
      equationOfTimeMinutes: 0,
      subsolarLongitudeDeg: equatorLongitudeDeg + 90,
    },
    sigmaDeg: 7,
    activeReachDeg: 21,
    latitudeStepDeg: 5,
    equatorLongitudeDeg,
    points: [
      {
        latitudeDeg: 0,
        sunriseLongitudeDeg: equatorLongitudeDeg,
        polarState: "normal",
      },
    ],
  };
}

function worldGridWithCells(cells: readonly WorldGridCell[]): WorldGrid {
  return {
    version: "test",
    generatedAtUtc: "2026-04-30T00:00:00.000Z",
    cellSizeDegrees: 5,
    stats: {
      nightLight: { min: 0, max: 10, p95: 10, p99: 10, p99_5: 10 },
      roadLengthKm: { min: 0, max: 0 },
      buildingCount: { min: 0, max: 0 },
      waterRatio: { min: 0, max: 0 },
      forestRatio: { min: 0, max: 0 },
      elevationM: { min: 0, max: 0 },
      bathymetryM: { min: 0, max: 0 },
    },
    cells,
  };
}

function cell(
  id: string,
  latCenterDeg: number,
  lonCenterDeg: number,
  nightLightMean: number,
  elevationM = 0,
): WorldGridCell {
  return {
    id,
    latCenterDeg,
    lonCenterDeg,
    landClass: "land",
    elevationM,
    bathymetryM: 0,
    roadLengthKm: 0,
    buildingCount: 0,
    waterRatio: 0,
    forestRatio: 0,
    nightLightMean,
    surfaceHardness01: 0.5,
    openness01: 0.5,
  };
}

function tuningKernels(): TuningKernelSet {
  return {
    version: "test",
    kernels: [
      {
        id: "12tet",
        family: "grid",
        label: "12-TET",
        centroid: { latDeg: 0, lonDeg: 0 },
        sigmaKm: 1000,
        status: "provisional",
        reviewRequired: true,
        intervalCents: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
      },
      {
        id: "test_scale",
        family: "scale",
        label: "Test scale",
        centroid: { latDeg: 0, lonDeg: 0 },
        sigmaKm: 1000,
        status: "provisional",
        reviewRequired: true,
        intervalCents: [0, 200, 400, 500, 700, 900, 1100],
      },
    ],
  };
}

function tuningKernelsWithModes(): TuningKernelSet {
  return {
    version: "test",
    kernels: [
      {
        id: "12tet",
        family: "grid",
        label: "12-TET",
        centroid: { latDeg: 0, lonDeg: 0 },
        sigmaKm: 1000,
        status: "provisional",
        reviewRequired: true,
        intervalCents: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
      },
      {
        id: "test_scale",
        family: "scale",
        label: "Test scale",
        centroid: { latDeg: 0, lonDeg: 0 },
        sigmaKm: 1000,
        status: "provisional",
        reviewRequired: true,
        modes: [
          { id: "sparse", label: "Sparse", intervalCents: [0, 700] },
          { id: "middle", label: "Middle", intervalCents: [0, 300, 700, 1000] },
          {
            id: "dense",
            label: "Dense",
            intervalCents: [0, 200, 300, 500, 700, 900, 1000],
          },
        ],
      },
    ],
  };
}

function weather(overrides: Partial<WeatherSample>): WeatherSample {
  return {
    cloudCoverPct: 50,
    relativeHumidityPct: 50,
    windSpeedMps: 3,
    precipitationMm: 0,
    temperatureC: 15,
    pressureHpa: 1013,
    ...overrides,
  };
}

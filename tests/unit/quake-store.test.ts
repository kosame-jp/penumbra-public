import { describe, expect, it } from "vitest";
import {
  type EarthquakeEvent,
  isQuakeInScanlineReach,
  isWithinQuakeWindow,
} from "../../src/core/live-data/quake-store";
import { createScanlineState } from "../../src/core/scanline/scanline-state";
import { dateFromUtcParts } from "../../src/core/time/utc-clock";

describe("earthquake gating", () => {
  it("keeps the 81-minute authorial window", () => {
    const now = dateFromUtcParts(2026, 4, 30, 12, 0);
    expect(isWithinQuakeWindow(now, quakeAt("2026-04-30T10:40:00Z"))).toBe(true);
    expect(isWithinQuakeWindow(now, quakeAt("2026-04-30T10:38:00Z"))).toBe(false);
  });

  it("does not add a magnitude threshold", () => {
    const scanline = createScanlineState(dateFromUtcParts(2026, 3, 20, 12));
    const lowMagnitudeQuake: EarthquakeEvent = {
      ...quakeAt("2026-03-20T11:30:00Z"),
      magnitude: 0.1,
      latitudeDeg: 0,
      longitudeDeg: scanline.equatorLongitudeDeg,
    };

    expect(isWithinQuakeWindow(scanline.utc.date, lowMagnitudeQuake)).toBe(true);
    expect(isQuakeInScanlineReach(lowMagnitudeQuake, scanline)).toBe(true);
  });
});

function quakeAt(eventTimeUtc: string): EarthquakeEvent {
  return {
    id: `quake-${eventTimeUtc}`,
    provider: "test",
    eventTimeUtc,
    updatedTimeUtc: eventTimeUtc,
    latitudeDeg: 0,
    longitudeDeg: 0,
    depthKm: 10,
    magnitude: 4,
  };
}

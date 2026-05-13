import { describe, expect, it } from "vitest";
import { createScanlineState } from "../../src/core/scanline/scanline-state";
import { signedLongitudeOffsetDeg } from "../../src/core/scanline/geometry";
import { createCanonicalUtcState, dateFromUtcParts } from "../../src/core/time/utc-clock";
import { sunriseLongitudeAtLatitude } from "../../src/core/astronomy/terminator";

describe("sunrise scanline advance", () => {
  it("moves westward by roughly 15 degrees per UTC hour", () => {
    const start = createScanlineState(dateFromUtcParts(2026, 3, 20, 12));
    const oneHourLater = createScanlineState(dateFromUtcParts(2026, 3, 20, 13));
    const advance = signedLongitudeOffsetDeg(
      oneHourLater.equatorLongitudeDeg,
      start.equatorLongitudeDeg,
    );

    expect(advance).toBeLessThan(-14.7);
    expect(advance).toBeGreaterThan(-15.3);
  });

  it("uses the 5-degree latitude sampler by default", () => {
    const state = createScanlineState(dateFromUtcParts(2026, 4, 30, 0));
    expect(state.points).toHaveLength(37);
    expect(state.points[0]?.latitudeDeg).toBe(-90);
    expect(state.points[36]?.latitudeDeg).toBe(90);
  });

  it("uses the narrowed 7-degree Gaussian scanline by default", () => {
    const state = createScanlineState(dateFromUtcParts(2026, 4, 30, 0));
    expect(state.sigmaDeg).toBe(7);
    expect(state.activeReachDeg).toBe(21);
  });

  it("returns close to the same equator longitude after a full UTC day", () => {
    const start = createScanlineState(dateFromUtcParts(2026, 3, 20, 12));
    const nextDay = createScanlineState(dateFromUtcParts(2026, 3, 21, 12));
    const sweep = signedLongitudeOffsetDeg(nextDay.equatorLongitudeDeg, start.equatorLongitudeDeg);

    expect(Math.abs(sweep)).toBeLessThan(1);
  });

  it("keeps solstice polar day and polar night edge cases explicit", () => {
    const juneSolstice = createScanlineState(dateFromUtcParts(2026, 6, 21, 12));
    const decemberSolstice = createScanlineState(dateFromUtcParts(2026, 12, 21, 12));

    expect(sunriseLongitudeAtLatitude(80, juneSolstice.solar).polarState).toBe("polar_day");
    expect(sunriseLongitudeAtLatitude(-80, juneSolstice.solar).polarState).toBe("polar_night");
    expect(sunriseLongitudeAtLatitude(80, decemberSolstice.solar).polarState).toBe("polar_night");
    expect(sunriseLongitudeAtLatitude(-80, decemberSolstice.solar).polarState).toBe("polar_day");
  });

  it("does not derive canonical state from local timezone fields", () => {
    const previousTimezone = process.env.TZ;
    const epochMs = Date.UTC(2026, 3, 30, 12, 34, 56, 789);

    process.env.TZ = "Pacific/Honolulu";
    const honoluluState = createCanonicalUtcState(new Date(epochMs));
    process.env.TZ = "Asia/Tokyo";
    const tokyoState = createCanonicalUtcState(new Date(epochMs));
    process.env.TZ = previousTimezone;

    expect(tokyoState.iso).toBe(honoluluState.iso);
    expect(tokyoState.utcMinutesOfDay).toBe(honoluluState.utcMinutesOfDay);
    expect(tokyoState.utcHour).toBe(12);
  });
});

import { describe, expect, it } from "vitest";

import {
  canonicalWaterDropletDensityHz,
  canonicalWaterDropletEventsInWindow,
  canonicalWaterHighDropletDensityHz,
  canonicalWaterHighDropletEventsInWindow,
  WATER_DROPLET_CANONICAL_CLOCK_HZ,
  WATER_HIGH_DROPLET_CANONICAL_CLOCK_HZ,
} from "../../src/core/audio/water-droplet-events";

describe("canonical water high droplet event field", () => {
  it("returns deterministic UTC events for the same window", () => {
    const input = {
      densityHz: 2.5,
      level01: 0.72,
      windowStartUtcMs: Date.parse("2026-05-09T00:00:00.000Z"),
      windowEndUtcMs: Date.parse("2026-05-09T00:00:04.000Z"),
    };

    expect(canonicalWaterHighDropletEventsInWindow(input)).toEqual(
      canonicalWaterHighDropletEventsInWindow(input),
    );
  });

  it("keeps low-density timing stable under sub-quantum density jitter", () => {
    const base = canonicalWaterHighDropletEventsInWindow({
      densityHz: 0.12,
      level01: 0.72,
      windowStartUtcMs: Date.parse("2026-05-09T00:00:00.000Z"),
      windowEndUtcMs: Date.parse("2026-05-09T00:02:00.000Z"),
    });
    const jittered = canonicalWaterHighDropletEventsInWindow({
      densityHz: 0.121,
      level01: 0.72,
      windowStartUtcMs: Date.parse("2026-05-09T00:00:00.000Z"),
      windowEndUtcMs: Date.parse("2026-05-09T00:02:00.000Z"),
    });

    expect(jittered).toEqual(base);
  });

  it("makes lower-density events a deterministic subset of higher-density events", () => {
    const window = {
      level01: 0.72,
      windowStartUtcMs: Date.parse("2026-05-09T00:00:00.000Z"),
      windowEndUtcMs: Date.parse("2026-05-09T00:01:00.000Z"),
    };
    const lower = canonicalWaterHighDropletEventsInWindow({ ...window, densityHz: 1 });
    const higher = canonicalWaterHighDropletEventsInWindow({ ...window, densityHz: 6 });
    const higherSeeds = new Set(higher.map((event) => event.randomSeed));

    expect(lower.length).toBeGreaterThan(0);
    expect(lower.every((event) => higherSeeds.has(event.randomSeed))).toBe(true);
  });

  it("caps event density at the canonical high-droplet clock", () => {
    const events = canonicalWaterHighDropletEventsInWindow({
      densityHz: 999,
      level01: 1,
      windowStartUtcMs: Date.parse("2026-05-09T00:00:00.000Z"),
      windowEndUtcMs: Date.parse("2026-05-09T00:00:01.000Z"),
    });

    expect(canonicalWaterHighDropletDensityHz(999)).toBe(WATER_HIGH_DROPLET_CANONICAL_CLOCK_HZ);
    expect(events.length).toBeLessThanOrEqual(WATER_HIGH_DROPLET_CANONICAL_CLOCK_HZ + 1);
    expect(events.every((event) => event.velocity01 >= 0 && event.velocity01 <= 1)).toBe(true);
  });

  it("uses fixed UTC event fields for low and mid water bands", () => {
    const window = {
      level01: 0.62,
      windowStartUtcMs: Date.parse("2026-05-09T00:00:00.000Z"),
      windowEndUtcMs: Date.parse("2026-05-09T00:01:00.000Z"),
    };

    const low = canonicalWaterDropletEventsInWindow({ ...window, band: "low", densityHz: 0.7 });
    const mid = canonicalWaterDropletEventsInWindow({ ...window, band: "mid", densityHz: 0.7 });

    expect(low.length).toBeGreaterThan(0);
    expect(mid.length).toBeGreaterThan(0);
    expect(low.every((event) => event.band === "low")).toBe(true);
    expect(mid.every((event) => event.band === "mid")).toBe(true);
  });

  it("keeps low and mid timing stable under sub-quantum density jitter", () => {
    const window = {
      level01: 0.62,
      windowStartUtcMs: Date.parse("2026-05-09T00:00:00.000Z"),
      windowEndUtcMs: Date.parse("2026-05-09T00:01:00.000Z"),
    };

    expect(canonicalWaterDropletEventsInWindow({ ...window, band: "low", densityHz: 0.904 })).toEqual(
      canonicalWaterDropletEventsInWindow({ ...window, band: "low", densityHz: 0.901 }),
    );
    expect(canonicalWaterDropletEventsInWindow({ ...window, band: "mid", densityHz: 0.904 })).toEqual(
      canonicalWaterDropletEventsInWindow({ ...window, band: "mid", densityHz: 0.901 }),
    );
  });

  it("caps low and mid density at their canonical clocks", () => {
    expect(canonicalWaterDropletDensityHz("low", 999)).toBe(WATER_DROPLET_CANONICAL_CLOCK_HZ.low);
    expect(canonicalWaterDropletDensityHz("mid", 999)).toBe(WATER_DROPLET_CANONICAL_CLOCK_HZ.mid);
  });
});

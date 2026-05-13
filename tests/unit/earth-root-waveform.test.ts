import { describe, expect, it } from "vitest";

import {
  createEarthDetuneBeatEnvelope,
  earthDetuneBeatEnvelopeLevel01,
  earthRootHzFromDroneRootHz,
} from "../../src/core/visual/earth-root-waveform";

describe("Earth detune beat envelope", () => {
  it("derives the conceptual earth root one octave below the sounding drone root", () => {
    expect(earthRootHzFromDroneRootHz(49.02)).toBeCloseTo(24.51, 8);
    expect(earthRootHzFromDroneRootHz(0)).toBe(0);
    expect(earthRootHzFromDroneRootHz(Number.NaN)).toBe(0);
  });

  it("draws a flowing beat history from a continuous phase", () => {
    const base = createEarthDetuneBeatEnvelope({
      droneRootHz: 80,
      companionHz: 80.5,
      detuneAmount01: 1,
      beatPhase01: 0,
      pointCount: 9,
    });
    const shifted = createEarthDetuneBeatEnvelope({
      droneRootHz: 80,
      companionHz: 80.5,
      detuneAmount01: 1,
      beatPhase01: 0.25,
      pointCount: 9,
    });
    const oneBeatLater = createEarthDetuneBeatEnvelope({
      droneRootHz: 80,
      companionHz: 80.5,
      detuneAmount01: 1,
      beatPhase01: 1,
      pointCount: 9,
    });

    expect(base.length).toBe(9);
    expect(base.map((point) => point.x)).toEqual(shifted.map((point) => point.x));
    expect(base[0]?.x).toBeCloseTo(-1, 8);
    expect(base.at(-1)?.x).toBeCloseTo(1, 8);
    expect(base.at(-1)?.y).toBeCloseTo(0.82, 8);
    expect(Math.abs((shifted[4]?.y ?? 0) - (base[4]?.y ?? 0))).toBeGreaterThan(0.1);
    for (let index = 0; index < base.length; index += 1) {
      expect(oneBeatLater[index]?.y).toBeCloseTo(base[index]?.y ?? 0, 6);
    }
  });

  it("stays flat when detune amount is zero", () => {
    const envelope = createEarthDetuneBeatEnvelope({
      droneRootHz: 80,
      companionHz: 81,
      detuneAmount01: 0,
      beatPhase01: 0.5,
      pointCount: 6,
    });

    expect(new Set(envelope.map((point) => point.y.toFixed(8))).size).toBe(1);
  });

  it("reduces the beat level from a continuous phase", () => {
    expect(
      earthDetuneBeatEnvelopeLevel01({
        droneRootHz: 80,
        companionHz: 80.5,
        detuneAmount01: 1,
        beatPhase01: 0,
      }),
    ).toBeCloseTo(0, 8);
    expect(
      earthDetuneBeatEnvelopeLevel01({
        droneRootHz: 80,
        companionHz: 80.5,
        detuneAmount01: 1,
        beatPhase01: 0.25,
      }),
    ).toBeCloseTo(0.5, 8);
    expect(
      earthDetuneBeatEnvelopeLevel01({
        droneRootHz: 80,
        companionHz: 80.5,
        detuneAmount01: 0.25,
        beatPhase01: 0.5,
      }),
    ).toBeCloseTo(0.25, 8);
    expect(
      earthDetuneBeatEnvelopeLevel01({
        droneRootHz: 80,
        companionHz: 80.5,
        detuneAmount01: 1,
        beatPhase01: 1,
      }),
    ).toBeCloseTo(0, 8);
  });

  it("keeps x positions fixed while the flowing envelope advances", () => {
    const low = createEarthDetuneBeatEnvelope({
      droneRootHz: 80,
      companionHz: 80.66,
      detuneAmount01: 1,
      beatPhase01: 0,
      pointCount: 12,
    });
    const high = createEarthDetuneBeatEnvelope({
      droneRootHz: 80,
      companionHz: 80.66,
      detuneAmount01: 1,
      beatPhase01: 0.5,
      pointCount: 12,
    });

    expect(low.map((point) => point.x)).toEqual(high.map((point) => point.x));
    expect(new Set(high.map((point) => point.y.toFixed(8))).size).toBeGreaterThan(1);
  });

  it("returns no envelope for non-positive frequencies", () => {
    expect(
      createEarthDetuneBeatEnvelope({
        droneRootHz: 0,
        companionHz: 80,
        detuneAmount01: 1,
        beatPhase01: 0,
      }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import {
  createEarthRootDebugMeterSnapshotFromTimeDomain,
  smoothEarthRootDebugMeterRootHz,
} from "../../src/core/audio/earth-root-debug-meter";

describe("Earth root debug meter", () => {
  it("keeps the displayed root frequency as a high resolution float", () => {
    const snapshot = createEarthRootDebugMeterSnapshotFromTimeDomain({
      rootHz: 73.4567,
      left: sineBuffer(0),
      right: sineBuffer(0),
    });

    expect(snapshot.rootHz).toBeCloseTo(73.4567, 6);
    expect(snapshot.active).toBe(true);
    expect(snapshot.points.length).toBe(128);
  });

  it("reports stereo width from the reverbed left/right branch", () => {
    const mono = createEarthRootDebugMeterSnapshotFromTimeDomain({
      rootHz: 80,
      left: sineBuffer(0),
      right: sineBuffer(0),
      displayGain: 4,
    });
    const wide = createEarthRootDebugMeterSnapshotFromTimeDomain({
      rootHz: 80,
      left: sineBuffer(0),
      right: sineBuffer(Math.PI / 2),
      displayGain: 4,
    });

    expect(mono.stereoWidth01).toBeLessThan(0.001);
    expect(wide.stereoWidth01).toBeGreaterThan(mono.stereoWidth01);
    expect(wide.points.every((point) => Math.abs(point.x) <= 0.82 && Math.abs(point.y) <= 0.82)).toBe(true);
  });

  it("stays inactive for silence instead of inventing a trace", () => {
    const snapshot = createEarthRootDebugMeterSnapshotFromTimeDomain({
      rootHz: 80,
      left: new Float32Array(64),
      right: new Float32Array(64),
    });

    expect(snapshot.active).toBe(false);
    expect(snapshot.rmsDb).toBeLessThanOrEqual(-120);
  });

  it("does not normalize every frame to the full display size", () => {
    const quiet = createEarthRootDebugMeterSnapshotFromTimeDomain({
      rootHz: 80,
      left: sineBuffer(0, 0.02),
      right: sineBuffer(0, 0.02),
      displayGain: 4,
    });
    const loud = createEarthRootDebugMeterSnapshotFromTimeDomain({
      rootHz: 80,
      left: sineBuffer(0, 0.12),
      right: sineBuffer(0, 0.12),
      displayGain: 4,
    });

    const quietPeak = Math.max(...quiet.points.map((point) => Math.abs(point.y)));
    const loudPeak = Math.max(...loud.points.map((point) => Math.abs(point.y)));
    expect(loudPeak).toBeGreaterThan(quietPeak * 4);
  });

  it("smooths root readout with the same one-pole response as audio params", () => {
    const first = smoothEarthRootDebugMeterRootHz({
      previousHz: undefined,
      targetHz: 80,
      elapsedSeconds: 0,
      timeConstantSeconds: 0.9,
    });
    const next = smoothEarthRootDebugMeterRootHz({
      previousHz: first,
      targetHz: 120,
      elapsedSeconds: 0.9,
      timeConstantSeconds: 0.9,
    });

    expect(first).toBe(80);
    expect(next).toBeGreaterThan(80);
    expect(next).toBeLessThan(120);
    expect(next).toBeCloseTo(80 + (120 - 80) * (1 - Math.exp(-1)), 8);
  });
});

function sineBuffer(phaseOffset: number, amplitude = 0.12): Float32Array {
  return Float32Array.from({ length: 128 }, (_, index) =>
    Math.sin((index / 128) * Math.PI * 4 + phaseOffset) * amplitude,
  );
}

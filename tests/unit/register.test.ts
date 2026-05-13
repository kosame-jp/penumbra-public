import { describe, expect, it } from "vitest";
import { registerMidiForElevation } from "../../src/core/fusion/register";

describe("elevation and bathymetry register mapping", () => {
  it("uses the canonical piecewise anchors", () => {
    expect(registerMidiForElevation(-10994)).toBe(24);
    expect(registerMidiForElevation(-4000)).toBe(36);
    expect(registerMidiForElevation(0)).toBe(48);
    expect(registerMidiForElevation(500)).toBe(60);
    expect(registerMidiForElevation(8849)).toBe(96);
  });

  it("interpolates between anchors without latitude input", () => {
    expect(registerMidiForElevation(250)).toBeCloseTo(54, 6);
    expect(registerMidiForElevation(1250)).toBeCloseTo(66, 6);
  });
});

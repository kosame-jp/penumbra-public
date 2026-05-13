import { describe, expect, it } from "vitest";
import { gaussianWeight } from "../../src/core/scanline/gaussian";

describe("gaussian scanline weight", () => {
  it("matches the canonical sigma 7 degree anchors", () => {
    expect(gaussianWeight(0, 7)).toBeCloseTo(1, 6);
    expect(gaussianWeight(7, 7)).toBeCloseTo(0.6065, 4);
    expect(gaussianWeight(21, 7)).toBeCloseTo(0.0111, 4);
  });
});

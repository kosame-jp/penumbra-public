import { describe, expect, it } from "vitest";

import {
  createServerEpochMsClockSyncSample,
  createServerDateClockSyncSample,
  estimateServerDateClockOffset,
  selectBestServerDateClockSyncSample,
  ServerDateCanonicalClock,
} from "../../src/core/time/server-date-clock";

describe("server date canonical clock", () => {
  it("estimates client clock offset from the HTTP Date header and request midpoint", () => {
    const dateHeader = "Sat, 09 May 2026 00:00:03 GMT";
    const sample = createServerDateClockSyncSample({
      clientRequestStartMs: 1_000,
      clientResponseEndMs: 1_060,
      dateHeader,
    });

    expect(sample).toBeDefined();
    expect(sample?.source).toBe("http-date");
    expect(sample?.clientMidpointMs).toBe(1_030);
    expect(sample?.roundTripMs).toBe(60);
    expect(sample?.offsetMs).toBe(Date.parse(dateHeader) - 1_030);
  });

  it("rejects missing, invalid, or negative-round-trip samples", () => {
    expect(
      createServerDateClockSyncSample({
        clientRequestStartMs: 1_000,
        clientResponseEndMs: 1_060,
        dateHeader: null,
      }),
    ).toBeUndefined();
    expect(
      createServerDateClockSyncSample({
        clientRequestStartMs: 1_000,
        clientResponseEndMs: 1_060,
        dateHeader: "not a date",
      }),
    ).toBeUndefined();
    expect(
      createServerDateClockSyncSample({
        clientRequestStartMs: 1_060,
        clientResponseEndMs: 1_000,
        dateHeader: "Sat, 09 May 2026 00:00:03 GMT",
      }),
    ).toBeUndefined();
  });

  it("chooses the lowest round-trip sample", () => {
    const slow = createServerDateClockSyncSample({
      clientRequestStartMs: 1_000,
      clientResponseEndMs: 1_250,
      dateHeader: "Sat, 09 May 2026 00:00:03 GMT",
    });
    const fast = createServerDateClockSyncSample({
      clientRequestStartMs: 2_000,
      clientResponseEndMs: 2_020,
      dateHeader: "Sat, 09 May 2026 00:00:03 GMT",
    });

    expect(selectBestServerDateClockSyncSample([slow!, fast!])).toBe(fast);
  });

  it("applies the selected offset to canonical now", () => {
    const clock = new ServerDateCanonicalClock(() => 2_000);
    const sample = createServerDateClockSyncSample({
      clientRequestStartMs: 1_000,
      clientResponseEndMs: 1_000,
      dateHeader: "Thu, 01 Jan 1970 00:00:05 GMT",
    });

    clock.applySample(sample!);

    expect(clock.getOffsetMs()).toBe(4_000);
    expect(clock.nowMs()).toBe(6_000);
    expect(clock.nowDate().toISOString()).toBe("1970-01-01T00:00:06.000Z");
  });

  it("estimates client clock offset from a millisecond server time payload", () => {
    const sample = createServerEpochMsClockSyncSample({
      clientRequestStartMs: 1_000,
      clientResponseEndMs: 1_040,
      serverUtcMs: 5_005,
    });

    expect(sample).toBeDefined();
    expect(sample?.source).toBe("server-epoch-ms");
    expect(sample?.clientMidpointMs).toBe(1_020);
    expect(sample?.roundTripMs).toBe(40);
    expect(sample?.offsetMs).toBe(3_985);
  });

  it("samples the same-origin date header and ignores high latency probes", async () => {
    const dateHeader = "Sat, 09 May 2026 00:00:03 GMT";
    const nowValues = [1_000, 1_400, 2_000, 2_030];
    const result = await estimateServerDateClockOffset({
      fetcher: async () => new Response(null, { headers: { Date: dateHeader } }),
      maxRoundTripMs: 100,
      nowMs: () => nowValues.shift() ?? 2_030,
      sampleCount: 2,
      url: "/",
    });

    expect(result.status).toBe("synced");
    if (result.status === "synced") {
      expect(result.samples).toHaveLength(1);
      expect(result.sample.roundTripMs).toBe(30);
      expect(result.sample.offsetMs).toBe(Date.parse(dateHeader) - 2_015);
    }
  });

  it("prefers the millisecond server time payload over the coarse date header", async () => {
    const dateHeader = "Sat, 09 May 2026 00:00:03 GMT";
    const nowValues = [1_000, 1_040];
    const result = await estimateServerDateClockOffset({
      fetcher: async () =>
        new Response(JSON.stringify({ serverUtcMs: 5_005 }), {
          headers: {
            "Content-Type": "application/json",
            Date: dateHeader,
          },
        }),
      nowMs: () => nowValues.shift() ?? 1_040,
      sampleCount: 1,
      url: "/__penumbra-time",
    });

    expect(result.status).toBe("synced");
    if (result.status === "synced") {
      expect(result.sample.source).toBe("server-epoch-ms");
      expect(result.sample.offsetMs).toBe(3_985);
    }
  });
});

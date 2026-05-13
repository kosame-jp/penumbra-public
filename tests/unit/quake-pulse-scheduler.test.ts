import { describe, expect, it } from "vitest";

import {
  deriveQuakePulseProfile,
  nextQuakePulseEvent,
  quakePulseEventAtIndex,
  type QuakePulseContact,
} from "../../src/core/fusion/quake-pulse-scheduler";

describe("quake pulse scheduler", () => {
  it("does not emit a catch-up pulse when audio starts on an already-active quake", () => {
    const currentUtcMs = Date.parse("2026-04-30T00:12:00.000Z");

    expect(
      nextQuakePulseEvent({
        contact: quakeContact(),
        previousUtcMs: currentUtcMs,
        currentUtcMs,
      }),
    ).toBeUndefined();
  });

  it("returns deterministic UTC-anchored pulse events", () => {
    const contact = quakeContact({ magnitude: 8, scanlineWeight: 1 });
    const profile = deriveQuakePulseProfile(contact, Date.parse("2026-04-30T00:10:00.000Z"));
    expect(profile).toBeDefined();

    let target = quakePulseEventAtIndex(contact, profile!, 30);
    let found = nextQuakePulseEvent({
      contact,
      previousUtcMs: target.scheduledUtcMs - 8,
      currentUtcMs: target.scheduledUtcMs + 8,
    });
    for (let pulseIndex = 31; !found && pulseIndex < 70; pulseIndex += 1) {
      target = quakePulseEventAtIndex(contact, profile!, pulseIndex);
      found = nextQuakePulseEvent({
        contact,
        previousUtcMs: target.scheduledUtcMs - 8,
        currentUtcMs: target.scheduledUtcMs + 8,
      });
    }

    expect(found?.scheduledUtcMs).toBe(target.scheduledUtcMs);
    expect(found?.pulseIndex).toBe(target.pulseIndex);
    expect(found).toEqual(
      nextQuakePulseEvent({
        contact,
        previousUtcMs: target.scheduledUtcMs - 8,
        currentUtcMs: target.scheduledUtcMs + 8,
      }),
    );
  });

  it("keeps low magnitude earthquakes eligible without a threshold", () => {
    const profile = deriveQuakePulseProfile(
      quakeContact({ magnitude: 0.1, scanlineWeight: 0.72 }),
      Date.parse("2026-04-30T00:10:00.000Z"),
    );

    expect(profile?.emitProbability01).toBeGreaterThan(0);
    expect(profile?.periodSeconds).toBeGreaterThan(0);
  });

  it("rejects windows outside the 81 minute quake lifetime and large catch-ups", () => {
    const contact = quakeContact();

    expect(
      deriveQuakePulseProfile(contact, Date.parse("2026-04-30T01:22:30.000Z")),
    ).toBeUndefined();
    expect(
      nextQuakePulseEvent({
        contact,
        previousUtcMs: Date.parse("2026-04-30T00:10:00.000Z"),
        currentUtcMs: Date.parse("2026-04-30T00:10:04.000Z"),
      }),
    ).toBeUndefined();
  });
});

function quakeContact(overrides: Partial<QuakePulseContact> = {}): QuakePulseContact {
  return {
    id: overrides.id ?? "quake-usgs-test",
    eventTimeUtc: overrides.eventTimeUtc ?? "2026-04-30T00:00:00.000Z",
    magnitude: overrides.magnitude ?? 4.2,
    scanlineWeight: overrides.scanlineWeight ?? 0.86,
    gain01: overrides.gain01 ?? 0.32,
    depthDarkness01: overrides.depthDarkness01 ?? 0.18,
  };
}

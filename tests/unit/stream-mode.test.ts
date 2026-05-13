import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { LIVE_SAFETY_COPY, REQUIRED_SAFETY_LINES } from "../../src/copy/live-safety";
import { parseQueryFlags } from "../../src/app/query-flags";
import { resolveAppMode, shouldUseLowPerformanceProfile } from "../../src/app/modes";

describe("stream mode", () => {
  it("keeps stream differences operational", () => {
    const canonical = resolveAppMode({ debug: false, stream: false, performance: "auto" });
    const stream = resolveAppMode({ debug: false, stream: true, performance: "auto" });

    expect(canonical.stream).toBe(false);
    expect(canonical.performanceProfile).toBe("standard");
    expect(canonical.targetFps).toBe(60);
    expect(canonical.renderer.pixelRatioCap).toBe(2);
    expect(canonical.renderer.preserveDrawingBuffer).toBe(false);
    expect(canonical.cloudAtlas).toBe("forecast");
    expect(canonical.hideCursor).toBe(false);
    expect(canonical.recovery.enabled).toBe(false);

    expect(stream.stream).toBe(true);
    expect(stream.performanceProfile).toBe("stream");
    expect(stream.targetFps).toBe(30);
    expect(stream.renderer.pixelRatioCap).toBe(1.5);
    expect(stream.renderer.preserveDrawingBuffer).toBe(false);
    expect(stream.hideCursor).toBe(true);
    expect(stream.fullscreenPreference).toBe(true);
    expect(stream.recovery.enabled).toBe(true);
    expect(stream.recovery.reloadOnRuntimeError).toBe(true);
  });

  it("allows a low-performance profile without changing canonical stream semantics", () => {
    const low = resolveAppMode({ debug: false, stream: false, performance: "low" });
    const autoLow = resolveAppMode(
      { debug: false, stream: false, performance: "auto" },
      { deviceMemoryGb: 4, hardwareConcurrency: 8 },
    );

    expect(low.performanceProfile).toBe("low");
    expect(low.stream).toBe(false);
    expect(low.targetFps).toBe(30);
    expect(low.hideCursor).toBe(false);
    expect(low.recovery.enabled).toBe(false);
    expect(low.renderer.pixelRatioCap).toBeLessThan(2);
    expect(autoLow.performanceProfile).toBe("low");
    expect(parseQueryFlags("?perf=standard").performance).toBe("standard");
    expect(parseQueryFlags("?perf=low").performance).toBe("low");
    expect(parseQueryFlags("?perf=other").performance).toBe("auto");
    expect(parseQueryFlags("?surface=canonical").surfaceGrid).toBe("canonical");
    expect(parseQueryFlags("?surface=1").surfaceGrid).toBe("1deg");
    expect(parseQueryFlags("?contact=canonical").contactGrid).toBe("canonical");
    expect(parseQueryFlags("?contact=1deg").contactGrid).toBe("1deg");
    expect(resolveAppMode(parseQueryFlags("?cloud=scanline")).cloudAtlas).toBe("scanline");
    expect(resolveAppMode(parseQueryFlags("?cloud=forecast")).cloudAtlas).toBe("forecast");
    expect(resolveAppMode(parseQueryFlags("?debug&cloud-diagnostic")).cloudDiagnostic).toBe(true);
    expect(resolveAppMode(parseQueryFlags("?cloud-diagnostic")).cloudDiagnostic).toBe(false);
    expect(resolveAppMode(parseQueryFlags("?fallback-demo=cloud,audio")).fallbackDemo).toEqual([
      "cloud-forecast-unavailable",
      "human-worklet-unavailable",
      "earth-texture-worklet-unavailable",
    ]);
  });

  it("keeps visual capture mode operational and canvas-only", () => {
    const flags = parseQueryFlags(
      "?capture&scene=blue-earth-01&capture-scale=4&capture-size=4096x4096&capture-utc=2026-05-10T03%3A00%3A00.000Z",
    );
    const capture = resolveAppMode(flags);
    const disabled = resolveAppMode(parseQueryFlags("?capture=0"));
    const streamWins = resolveAppMode(parseQueryFlags("?stream&capture"));

    expect(flags.capture).toBe(true);
    expect(flags.captureScene).toBe("blue-earth-01");
    expect(flags.captureScale).toBe(4);
    expect(flags.captureSize).toEqual({ width: 4096, height: 4096 });
    expect(flags.captureUtcMs).toBe(Date.parse("2026-05-10T03:00:00.000Z"));
    expect(parseQueryFlags("?capture&capture-scale=9").captureScale).toBe(4);
    expect(parseQueryFlags("?capture&capture-size=10000x100").captureSize).toEqual({
      width: 8192,
      height: 512,
    });
    expect(capture.capture).toBe(true);
    expect(capture.captureSceneId).toBe("blue-earth-01");
    expect(capture.captureSize).toEqual({ width: 4096, height: 4096 });
    expect(capture.captureUtcMs).toBe(Date.parse("2026-05-10T03:00:00.000Z"));
    expect(capture.stream).toBe(false);
    expect(capture.audioTuning).toBe(false);
    expect(capture.performanceProfile).toBe("capture");
    expect(capture.targetFps).toBe(60);
    expect(capture.hideCursor).toBe(false);
    expect(capture.fullscreenPreference).toBe(false);
    expect(capture.renderer.preserveDrawingBuffer).toBe(true);
    expect(capture.renderer.pixelRatioOverride).toBe(1);
    expect(capture.renderer.outputSize).toEqual({ width: 4096, height: 4096 });
    expect(capture.recovery.enabled).toBe(false);
    expect(disabled.capture).toBe(false);
    expect(streamWins.stream).toBe(true);
    expect(streamWins.capture).toBe(false);
    expect(streamWins.performanceProfile).toBe("stream");
  });

  it("allows the earth root widget without enabling the full debug overlay", () => {
    const production = resolveAppMode(parseQueryFlags(""));
    const rootWidget = resolveAppMode(parseQueryFlags("?root=1"));
    const debug = resolveAppMode(parseQueryFlags("?debug"));

    expect(production.debug).toBe(false);
    expect(production.debugHud).toBe(false);
    expect(production.earthRootWidget).toBe(false);
    expect(rootWidget.debug).toBe(false);
    expect(rootWidget.debugHud).toBe(false);
    expect(rootWidget.earthRootWidget).toBe(true);
    expect(debug.debug).toBe(true);
    expect(debug.debugHud).toBe(true);
    expect(debug.earthRootWidget).toBe(true);
  });

  it("keeps audio tuning explicit and outside stream mode", () => {
    expect(parseQueryFlags("?tune=audio").audioTune).toBe(true);
    expect(parseQueryFlags("?tune=visual").audioTune).toBe(false);
    expect(resolveAppMode(parseQueryFlags("?tune=audio")).audioTuning).toBe(true);
    expect(resolveAppMode(parseQueryFlags("?stream&tune=audio")).audioTuning).toBe(false);
  });

  it("suppresses the lower-left debug HUD while audio tuning is open", () => {
    const audioTuning = resolveAppMode(parseQueryFlags("?debug&tune=audio"));
    const audioTuningWithRoot = resolveAppMode(parseQueryFlags("?debug&tune=audio&root=1"));

    expect(audioTuning.debug).toBe(true);
    expect(audioTuning.audioTuning).toBe(true);
    expect(audioTuning.debugHud).toBe(false);
    expect(audioTuning.earthRootWidget).toBe(false);
    expect(audioTuningWithRoot.debugHud).toBe(false);
    expect(audioTuningWithRoot.earthRootWidget).toBe(true);
  });

  it("keeps audio diagnostics behind debug mode", () => {
    expect(parseQueryFlags("?debug&audio=surface-texture").audioDebug).toBe(
      "surface-texture-boost",
    );
    expect(parseQueryFlags("?debug&audio=surface-texture-solo").audioDebug).toBe(
      "surface-texture-solo",
    );
    expect(parseQueryFlags("?debug&audio=earth-texture-solo").audioDebug).toBe(
      "earth-texture-solo",
    );
    expect(parseQueryFlags("?debug&audio=earth-formant-solo").audioDebug).toBe(
      "earth-formant-solo",
    );
    expect(parseQueryFlags("?debug&audio=water-solo").audioDebug).toBe("earth-water-solo");
    expect(parseQueryFlags("?debug&audio=wind-solo").audioDebug).toBe("earth-wind-solo");
    expect(parseQueryFlags("?debug&audio=human-reverb-solo").audioDebug).toBe(
      "human-reverb-solo",
    );
    expect(parseQueryFlags("?debug&audio=quake-solo").audioDebug).toBe("quake-solo");
    expect(parseQueryFlags("?debug&audio=unknown").audioDebug).toBe("off");

    const solo = resolveAppMode(parseQueryFlags("?debug&audio=surface-texture-solo"));
    const earthTextureSolo = resolveAppMode(parseQueryFlags("?debug&audio=water-wind-solo"));
    const earthFormantSolo = resolveAppMode(parseQueryFlags("?debug&audio=formant-solo"));
    const earthWaterSolo = resolveAppMode(parseQueryFlags("?debug&audio=water-solo"));
    const earthWindSolo = resolveAppMode(parseQueryFlags("?debug&audio=wind-solo"));
    const humanReverbSolo = resolveAppMode(parseQueryFlags("?debug&audio=human-reverb-solo"));
    const quakeSolo = resolveAppMode(parseQueryFlags("?debug&audio=quake-solo"));
    const production = resolveAppMode(parseQueryFlags("?audio=surface-texture-solo"));

    expect(solo.debug).toBe(true);
    expect(solo.audioDebug).toBe("surface-texture-solo");
    expect(earthTextureSolo.debug).toBe(true);
    expect(earthTextureSolo.audioDebug).toBe("earth-texture-solo");
    expect(earthFormantSolo.debug).toBe(true);
    expect(earthFormantSolo.audioDebug).toBe("earth-formant-solo");
    expect(earthWaterSolo.debug).toBe(true);
    expect(earthWaterSolo.audioDebug).toBe("earth-water-solo");
    expect(earthWindSolo.debug).toBe(true);
    expect(earthWindSolo.audioDebug).toBe("earth-wind-solo");
    expect(humanReverbSolo.debug).toBe(true);
    expect(humanReverbSolo.audioDebug).toBe("human-reverb-solo");
    expect(quakeSolo.debug).toBe(true);
    expect(quakeSolo.audioDebug).toBe("quake-solo");
    expect(production.debug).toBe(false);
    expect(production.audioDebug).toBe("off");
  });

  it("keeps lower-end device detection explicit and conservative", () => {
    expect(shouldUseLowPerformanceProfile({ hardwareConcurrency: 4 })).toBe(true);
    expect(shouldUseLowPerformanceProfile({ deviceMemoryGb: 4 })).toBe(true);
    expect(shouldUseLowPerformanceProfile({ prefersReducedMotion: true })).toBe(true);
    expect(shouldUseLowPerformanceProfile({ hardwareConcurrency: 8, deviceMemoryGb: 8 })).toBe(
      false,
    );
  });

  it("preserves required live safety language", () => {
    for (const line of REQUIRED_SAFETY_LINES) {
      expect(LIVE_SAFETY_COPY).toContain(line);
    }

    const publicCopy = readFileSync(join(process.cwd(), "public/live-safety.txt"), "utf8");
    expect(publicCopy.trim()).toBe(LIVE_SAFETY_COPY);

    const releaseCopy = readFileSync(join(process.cwd(), "copy/live-safety-copy.md"), "utf8");
    expect(releaseCopy).toContain(LIVE_SAFETY_COPY);

    const publicYoutube = readFileSync(join(process.cwd(), "public/youtube-metadata.md"), "utf8");
    expect(publicYoutube).toContain(LIVE_SAFETY_COPY);
  });
});

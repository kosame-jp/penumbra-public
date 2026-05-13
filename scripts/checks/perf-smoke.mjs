/* global console, document, window */
import process from "node:process";
import { chromium } from "playwright-core";

const DEFAULT_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE_URL = process.env.PENUMBRA_PERF_URL ?? "http://127.0.0.1:5173";
const SAMPLE_MS = Number(process.env.PENUMBRA_PERF_SAMPLE_MS ?? 5000);
const MAX_SHORT_HEAP_DELTA_BYTES = 96 * 1024 * 1024;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROME_PATH ?? DEFAULT_CHROME_PATH,
  args: ["--enable-precise-memory-info"],
});

try {
  const canonical = await collectProfile("canonical", BASE_URL);
  const stream = await collectProfile("stream", `${BASE_URL}/?stream`);
  const low = await collectProfile("low", `${BASE_URL}/?perf=low`);

  console.log(JSON.stringify({ sampleMs: SAMPLE_MS, canonical, stream, low }, null, 2));
} finally {
  await browser.close();
}

async function collectProfile(name, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas.penumbra__canvas");
  await page.waitForFunction(() => {
    const probe = window.__PENUMBRA_PERFORMANCE__;
    return Boolean(
      document.querySelector("canvas.penumbra__canvas") &&
        probe &&
        probe.renderedFrameCount > 4 &&
        probe.stats,
    );
  });

  const start = await readProbe(page);
  await page.waitForTimeout(SAMPLE_MS);
  const end = await readProbe(page);
  await page.close();

  const frameDelta = end.renderedFrameCount - start.renderedFrameCount;
  const measuredFps = frameDelta / (SAMPLE_MS / 1000);
  const minimumExpectedFps = end.targetFps === 60 ? 24 : 12;
  const maximumExpectedFps = end.targetFps === 60 ? 72 : 39;
  const shortHeapDeltaBytes =
    end.stats.latestHeapUsedBytes !== undefined && start.stats.latestHeapUsedBytes !== undefined
      ? end.stats.latestHeapUsedBytes - start.stats.latestHeapUsedBytes
      : undefined;

  if (measuredFps < minimumExpectedFps) {
    throw new Error(
      `${name}: measured ${measuredFps.toFixed(1)}fps, expected at least ${minimumExpectedFps}fps.`,
    );
  }

  if (measuredFps > maximumExpectedFps) {
    throw new Error(
      `${name}: measured ${measuredFps.toFixed(1)}fps, expected cap near ${end.targetFps}fps.`,
    );
  }

  if (
    shortHeapDeltaBytes !== undefined &&
    shortHeapDeltaBytes > MAX_SHORT_HEAP_DELTA_BYTES
  ) {
    throw new Error(
      `${name}: short memory delta was ${formatBytes(shortHeapDeltaBytes)}, above smoke-test budget.`,
    );
  }

  return {
    profile: end.performanceProfile,
    targetFps: end.targetFps,
    measuredFps: Number(measuredFps.toFixed(1)),
    renderedFrames: frameDelta,
    droppedFrameRatio: Number(end.stats.droppedFrameRatio.toFixed(4)),
    p95FrameMs: Number(end.stats.p95FrameMs.toFixed(2)),
    p95RenderMs: Number(end.stats.p95RenderMs.toFixed(2)),
    shortHeapDelta: shortHeapDeltaBytes === undefined ? "unavailable" : formatBytes(shortHeapDeltaBytes),
    rollingHeapDelta:
      end.stats.heapDeltaBytes === undefined ? "unavailable" : formatBytes(end.stats.heapDeltaBytes),
  };
}

async function readProbe(page) {
  return page.evaluate(() => {
    const probe = window.__PENUMBRA_PERFORMANCE__;
    if (!probe?.stats) {
      throw new Error("PENUMBRA performance probe is unavailable.");
    }

    return {
      performanceProfile: probe.performanceProfile,
      targetFps: probe.targetFps,
      renderedFrameCount: probe.renderedFrameCount,
      stats: probe.stats,
    };
  });
}

function formatBytes(value) {
  const sign = value < 0 ? "-" : "";
  return `${sign}${(Math.abs(value) / (1024 * 1024)).toFixed(2)} MiB`;
}

/* global console, document, HTMLCanvasElement, HTMLElement */
import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import { inflateSync } from "node:zlib";
import { chromium } from "playwright-core";

const DEFAULT_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE_URL = process.env.PENUMBRA_VISUAL_URL ?? "http://127.0.0.1:5173";
const OUTPUT_DIR = "/tmp/penumbra-visual-smoke";

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROME_PATH ?? DEFAULT_CHROME_PATH,
});

try {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const desktop = await checkViewport({
    name: "desktop",
    viewport: { width: 1280, height: 800 },
    url: BASE_URL,
    expectDebug: false,
    expectStream: false,
  });
  const mobile = await checkViewport({
    name: "mobile",
    viewport: { width: 390, height: 844 },
    url: BASE_URL,
    expectDebug: false,
    expectStream: false,
  });
  const stream = await checkViewport({
    name: "stream",
    viewport: { width: 1280, height: 800 },
    url: `${BASE_URL}/?stream`,
    expectDebug: false,
    expectStream: true,
  });
  const debug = await checkViewport({
    name: "debug",
    viewport: { width: 1024, height: 720 },
    url: `${BASE_URL}/?debug`,
    expectDebug: true,
    expectStream: false,
  });

  console.log(JSON.stringify({ desktop, mobile, stream, debug }, null, 2));
} finally {
  await browser.close();
}

async function checkViewport({ name, viewport, url, expectDebug, expectStream }) {
  const page = await browser.newPage({ viewport, ignoreHTTPSErrors: true });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas.penumbra__canvas");
  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas.penumbra__canvas");
    const hudItems = document.querySelectorAll(".penumbra__hud-readout");
    return canvas instanceof HTMLCanvasElement && canvas.width > 0 && hudItems.length === 3;
  });
  await maybeEnterProduction(page);
  await page.waitForTimeout(600);

  const layout = await page.evaluate(() => {
    const toPlainRect = (rect) => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
    const hasOverlap = (a, b) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const canvas = document.querySelector("canvas.penumbra__canvas");
    const hud = document.querySelector(".penumbra__hud");
    const app = document.querySelector("#app");
    const audioButton = document.querySelector(".penumbra__audio-button");
    const debugPanel = document.querySelector(".penumbra__debug-panel");
    const safetyCopy = document.querySelector(".penumbra__safety-copy");
    if (!(canvas instanceof HTMLCanvasElement) || !(hud instanceof HTMLElement)) {
      throw new Error("Missing Penumbra canvas or HUD.");
    }
    const canvasRect = canvas.getBoundingClientRect();
    const hudRect = hud.getBoundingClientRect();
    const audioRect =
      audioButton instanceof HTMLElement ? audioButton.getBoundingClientRect() : undefined;

    return {
      canvasRect: toPlainRect(canvasRect),
      hudRect: toPlainRect(hudRect),
      audioRect: audioRect ? toPlainRect(audioRect) : undefined,
      hudTexts: Array.from(document.querySelectorAll(".penumbra__hud-readout")).map((element) =>
        element.textContent?.trim() ?? "",
      ),
      debugVisible: debugPanel instanceof HTMLElement,
      streamVisible: app instanceof HTMLElement && app.classList.contains("penumbra--stream"),
      safetyText: safetyCopy instanceof HTMLElement ? safetyCopy.textContent ?? "" : "",
      hudAudioOverlap: audioRect ? hasOverlap(hudRect, audioRect) : false,
    };
  });

  if (layout.debugVisible !== expectDebug) {
    throw new Error(`${name}: debug visibility was ${layout.debugVisible}, expected ${expectDebug}.`);
  }
  if (layout.streamVisible !== expectStream) {
    throw new Error(`${name}: stream class was ${layout.streamVisible}, expected ${expectStream}.`);
  }
  if (expectStream && !layout.safetyText.includes("You are more important than this stream.")) {
    throw new Error(`${name}: stream safety copy was not wired into the app.`);
  }
  if (layout.hudTexts.length !== 3) {
    throw new Error(`${name}: production HUD should have exactly three readouts.`);
  }
  if (
    !/^UTC\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(layout.hudTexts[0] ?? "") ||
    !/^LON\s+\d{3}\.\d{2}°[EW]$/.test(layout.hudTexts[1] ?? "") ||
    !/^DEC\s+[+-]\d{1,2}\.\d°[NS]$/.test(layout.hudTexts[2] ?? "")
  ) {
    throw new Error(`${name}: HUD text did not expose UTC, scanline longitude, and solar declination.`);
  }
  if (layout.hudAudioOverlap) {
    throw new Error(`${name}: HUD overlaps the audio control.`);
  }

  await page.addStyleTag({
    content: `
      .penumbra__hud,
      .penumbra__debug-panel,
      .penumbra__audio-button,
      .penumbra__entry-overlay,
      .penumbra__safety-copy {
        visibility: hidden !important;
      }
    `,
  });
  await page.waitForTimeout(50);

  const screenshot = await page.screenshot({
    clip: layout.canvasRect,
    animations: "disabled",
  });
  const screenshotPath = `${OUTPUT_DIR}/penumbra-${name}.png`;
  await writeFile(screenshotPath, screenshot);

  const pixels = pngStats(screenshot);
  await page.close();

  if (pixels.nonDarkRatio < 0.03) {
    throw new Error(`${name}: canvas appears blank; non-dark ratio ${pixels.nonDarkRatio}.`);
  }
  if (pixels.lumaStdDev < 5) {
    throw new Error(`${name}: canvas has too little contrast; luma stddev ${pixels.lumaStdDev}.`);
  }
  if (pixels.sideLumaDelta < 3.5 && pixels.visibleLumaSpread < 26) {
    throw new Error(
      `${name}: day and night sides are not visually separated; side luma delta ${pixels.sideLumaDelta}, visible luma spread ${pixels.visibleLumaSpread}.`,
    );
  }
  if (pixels.uniqueColorBuckets < 20) {
    throw new Error(`${name}: canvas has too few color buckets; ${pixels.uniqueColorBuckets}.`);
  }
  if (pixels.surfaceChromaBuckets < 4) {
    throw new Error(`${name}: globe surface has too little terrain/ocean chroma detail; ${pixels.surfaceChromaBuckets}.`);
  }
  if (pixels.edgeNonDarkRatio > 0.55) {
    throw new Error(`${name}: globe appears clipped at the viewport edge; edge ratio ${pixels.edgeNonDarkRatio}.`);
  }

  return {
    screenshotPath,
    nonDarkRatio: Number(pixels.nonDarkRatio.toFixed(4)),
    edgeNonDarkRatio: Number(pixels.edgeNonDarkRatio.toFixed(4)),
    lumaStdDev: Number(pixels.lumaStdDev.toFixed(2)),
    sideLumaDelta: Number(pixels.sideLumaDelta.toFixed(2)),
    visibleLumaSpread: Number(pixels.visibleLumaSpread.toFixed(2)),
    uniqueColorBuckets: pixels.uniqueColorBuckets,
    surfaceChromaBuckets: pixels.surfaceChromaBuckets,
    hudTexts: layout.hudTexts,
  };
}

async function maybeEnterProduction(page) {
  const entryButton = page.locator(".penumbra__entry-button");
  if ((await entryButton.count()) === 0) {
    return;
  }

  await page.waitForFunction(() => {
    const app = document.querySelector("#app");
    return app?.getAttribute("data-logo-font") !== "loading";
  });
  await entryButton.click();
  await page.waitForFunction(() => {
    const app = document.querySelector("#app");
    return (
      !(document.querySelector(".penumbra__entry-overlay") instanceof HTMLElement) ||
      app?.getAttribute("data-entry-state") === "entered"
    );
  });
}

function pngStats(pngBuffer) {
  const decoded = decodePng(pngBuffer);
  const buckets = new Set();
  const surfaceChromaBuckets = new Set();
  let nonDark = 0;
  let edgeNonDark = 0;
  let edgeCount = 0;
  let leftLumaSum = 0;
  let leftLumaCount = 0;
  let rightLumaSum = 0;
  let rightLumaCount = 0;
  let lumaSum = 0;
  let lumaSqSum = 0;
  let count = 0;
  const visibleLumas = [];
  const step = Math.max(1, Math.floor(decoded.width / 220));
  const edgeSize = Math.max(2, Math.floor(Math.min(decoded.width, decoded.height) * 0.04));

  for (let y = 0; y < decoded.height; y += step) {
    for (let x = 0; x < decoded.width; x += step) {
      const offset = (y * decoded.width + x) * decoded.channels;
      const red = decoded.data[offset];
      const green = decoded.data[offset + 1];
      const blue = decoded.data[offset + 2];
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      lumaSum += luma;
      lumaSqSum += luma * luma;
      count += 1;

      if (luma > 18) {
        nonDark += 1;
      }
      if (
        luma > 2 &&
        x > edgeSize &&
        x < decoded.width - edgeSize &&
        y > edgeSize &&
        y < decoded.height - edgeSize
      ) {
        visibleLumas.push(luma);
      }
      if (luma > 20 && x > edgeSize && x < decoded.width - edgeSize && y > edgeSize && y < decoded.height - edgeSize) {
        const sum = red + green + blue;
        if (sum > 0) {
          surfaceChromaBuckets.add(
            `${Math.floor((red / sum) * 12)}:${Math.floor((green / sum) * 12)}:${Math.floor((blue / sum) * 12)}`,
          );
        }
      }
      if (
        x < edgeSize ||
        y < edgeSize ||
        x >= decoded.width - edgeSize ||
        y >= decoded.height - edgeSize
      ) {
        edgeCount += 1;
        if (luma > 18) {
          edgeNonDark += 1;
        }
      }
      if (y > edgeSize && y < decoded.height - edgeSize) {
        if (x < decoded.width * 0.42) {
          leftLumaSum += luma;
          leftLumaCount += 1;
        } else if (x > decoded.width * 0.58) {
          rightLumaSum += luma;
          rightLumaCount += 1;
        }
      }
      buckets.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
    }
  }

  const mean = lumaSum / count;
  const variance = Math.max(0, lumaSqSum / count - mean * mean);
  visibleLumas.sort((left, right) => left - right);
  const visibleLumaSpread =
    visibleLumas.length === 0
      ? 0
      : percentile(visibleLumas, 0.98) - percentile(visibleLumas, 0.2);
  return {
    nonDarkRatio: nonDark / count,
    edgeNonDarkRatio: edgeCount === 0 ? 0 : edgeNonDark / edgeCount,
    lumaStdDev: Math.sqrt(variance),
    sideLumaDelta: Math.abs(rightLumaSum / rightLumaCount - leftLumaSum / leftLumaCount),
    visibleLumaSpread,
    uniqueColorBuckets: buckets.size,
    surfaceChromaBuckets: surfaceChromaBuckets.size,
  };
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(sortedValues.length * ratio)));
  return sortedValues[index] ?? 0;
}

function decodePng(buffer) {
  const signature = buffer.subarray(0, 8);
  if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Screenshot was not a PNG.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}.`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const bytesPerRow = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const data = Buffer.alloc(width * height * channels);
  let inputOffset = 0;
  let outputOffset = 0;
  let previousRow = Buffer.alloc(bytesPerRow);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const row = Buffer.from(inflated.subarray(inputOffset, inputOffset + bytesPerRow));
    inputOffset += bytesPerRow;
    unfilterRow(row, previousRow, channels, filter);
    row.copy(data, outputOffset);
    outputOffset += bytesPerRow;
    previousRow = row;
  }

  return { width, height, channels, data };
}

function unfilterRow(row, previousRow, bytesPerPixel, filter) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previousRow[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0;

    if (filter === 1) {
      row[index] = (row[index] + left) & 0xff;
    } else if (filter === 2) {
      row[index] = (row[index] + up) & 0xff;
    } else if (filter === 3) {
      row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
    } else if (filter === 4) {
      row[index] = (row[index] + paeth(left, up, upLeft)) & 0xff;
    } else if (filter !== 0) {
      throw new Error(`Unsupported PNG row filter ${filter}.`);
    }
  }
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);

  if (pa <= pb && pa <= pc) {
    return left;
  }

  return pb <= pc ? up : upLeft;
}

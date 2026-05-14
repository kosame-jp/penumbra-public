#!/usr/bin/env node
/* global console, fetch, setTimeout, URLSearchParams */
import { fileURLToPath } from "node:url";
import process from "node:process";

import { buildRows, resampleCloudAtlasValues } from "./build-cloud-atlas-openmeteo.mjs";
import { publishCloudAtlasForecastArtifacts } from "./cloud-atlas-forecast-artifacts.mjs";

const DEFAULT_OUTPUT_DIR = "public/data/cloud-atlas.forecast";
const DEFAULT_RESOLUTION_DEG = 1;
const DEFAULT_SOURCE_RESOLUTION_DEG = 10;
const DEFAULT_FORECAST_HOURS = [0, 3, 6, 9, 12, 15];
const DEFAULT_REQUEST_DELAY_MS = 1000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_RETRY_DELAY_MS = 15000;
const DEFAULT_RETAIN_GENERATIONS = 0;
const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

if (isMainModule()) {
  const options = parseArgs(process.argv.slice(2));
  await buildCloudAtlasForecast(options);
}

export async function buildCloudAtlasForecast(options = {}) {
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const resolutionDeg = options.resolutionDeg ?? DEFAULT_RESOLUTION_DEG;
  const sourceResolutionDeg = options.sourceResolutionDeg ?? DEFAULT_SOURCE_RESOLUTION_DEG;
  const forecastHours = options.forecastHours ?? DEFAULT_FORECAST_HOURS;
  const requestDelayMs = options.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const fetchJson = options.fetchJson ?? fetchJsonFromNetwork;
  const generatedAtUtc = options.generatedAtUtc ?? new Date().toISOString();
  const atomicPublish = options.atomicPublish === true;
  const retainGenerations = Math.max(0, Math.floor(options.retainGenerations ?? DEFAULT_RETAIN_GENERATIONS));
  const rows = buildRows(sourceResolutionDeg);
  const sourceWidth = Math.round(360 / sourceResolutionDeg);
  const sourceHeight = rows.length;
  const outputWidth = Math.round(360 / resolutionDeg);
  const outputHeight = Math.round(180 / resolutionDeg) + 1;
  const sourceValuesByHour = new Map(forecastHours.map((hour) => [hour, []]));
  const validTimesByHour = new Map(forecastHours.map((hour) => [hour, []]));
  const forecastFetchHours = Math.max(...forecastHours) + 1;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowValuesByHour = new Map(forecastHours.map((hour) => [hour, []]));
    const chunks = chunk(row, batchSize);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunkPoints = chunks[chunkIndex];
      const url = openMeteoHourlyCloudCoverUrl(chunkPoints, forecastFetchHours);
      const response = await fetchJsonWithRetry(fetchJson, url, {
        maxRetries,
        retryDelayMs,
        quiet: options.quiet === true,
      });
      const parsed = parseOpenMeteoHourlyCloudCoverResponse(response, chunkPoints.length, forecastHours, url);

      for (const hour of forecastHours) {
        rowValuesByHour.get(hour)?.push(...(parsed.valuesByHour.get(hour) ?? []));
        validTimesByHour.get(hour)?.push(...(parsed.validTimesByHour.get(hour) ?? []));
      }

      const isLastRequest = rowIndex === rows.length - 1 && chunkIndex === chunks.length - 1;
      if (!isLastRequest && requestDelayMs > 0) {
        await delay(requestDelayMs);
      }
    }

    for (const hour of forecastHours) {
      const rowValues = rowValuesByHour.get(hour) ?? [];
      if (rowValues.length !== sourceWidth) {
        throw new Error(`Open-Meteo forecast row ${rowIndex} f${hour} yielded ${rowValues.length}; expected ${sourceWidth}.`);
      }
      sourceValuesByHour.get(hour)?.push(...rowValues);
    }

    if (options.quiet !== true) {
      console.log(`cloud atlas forecast source row ${rowIndex + 1}/${rows.length} lat ${row[0]?.latitudeDeg.toFixed(2)} done`);
    }
  }

  const frames = [];
  for (const hour of forecastHours) {
    const sourceValues = sourceValuesByHour.get(hour) ?? [];
    const values = resampleCloudAtlasValues({
      sourceValues,
      sourceResolutionDeg,
      sourceWidth,
      sourceHeight,
      outputResolutionDeg: resolutionDeg,
      outputWidth,
      outputHeight,
    });
    const validAtUtc = mostCommonValidTime(validTimesByHour.get(hour) ?? []) ?? generatedAtUtc;
    const label = `f${String(hour).padStart(3, "0")}`;
    frames.push({
      values,
      validAtUtc,
      forecastHour: hour,
      label,
    });
  }

  return publishCloudAtlasForecastArtifacts({
    outputDir,
    generatedAtUtc,
    resolutionDeg,
    width: outputWidth,
    height: outputHeight,
    frameVersion: `open-meteo-cloud-atlas-${resolutionDeg}deg-from-${sourceResolutionDeg}deg-v1`,
    manifestVersion: `open-meteo-cloud-forecast-${resolutionDeg}deg-from-${sourceResolutionDeg}deg-v1`,
    source: {
      kind: "open-meteo",
      model: "Open-Meteo Forecast API hourly cloud_cover",
      provenance:
        "Generated by scripts/precompute/build-cloud-atlas-forecast-openmeteo.mjs. Frames are legacy visual-only cloud atlases intended for UTC-linear interpolation in the browser.",
      frameProvenance:
        "Generated by scripts/precompute/build-cloud-atlas-forecast-openmeteo.mjs from Open-Meteo batch hourly cloud_cover requests. Source points are bilinearly resampled into the output atlas. This artifact is a legacy visual-only bridge; production weather should use the GFS forecast artifact when available.",
      manifestMetadata: {
        requestCount: Math.ceil(sourceWidth / batchSize) * sourceHeight,
        batchSize,
        sourceResolutionDeg,
      },
    },
    frames,
    atomicPublish,
    retainGenerations,
    quiet: options.quiet === true,
  });
}

export function openMeteoHourlyCloudCoverUrl(points, forecastHours) {
  if (points.length === 0) {
    throw new Error("Open-Meteo forecast cloud atlas request requires at least one point.");
  }
  const params = new URLSearchParams({
    latitude: points.map((point) => formatCoordinate(point.latitudeDeg)).join(","),
    longitude: points.map((point) => formatCoordinate(point.longitudeDeg)).join(","),
    hourly: "cloud_cover",
    forecast_hours: String(forecastHours),
    timezone: "UTC",
  });
  return `${OPEN_METEO_FORECAST_URL}?${params.toString()}`;
}

export function parseOpenMeteoHourlyCloudCoverResponse(response, expectedCount, forecastHours, source) {
  const items = Array.isArray(response) ? response : [response];
  if (items.length !== expectedCount) {
    throw new Error(`${source} returned ${items.length} locations; expected ${expectedCount}.`);
  }

  const valuesByHour = new Map(forecastHours.map((hour) => [hour, []]));
  const validTimesByHour = new Map(forecastHours.map((hour) => [hour, []]));
  for (const [index, item] of items.entries()) {
    const hourly = requireHourlyPayload(item, `${source} location ${index}`);
    for (const hour of forecastHours) {
      const cloudCover = hourly.cloud_cover[hour];
      const validTime = hourly.time[hour];
      if (typeof cloudCover !== "number" || !Number.isFinite(cloudCover)) {
        throw new Error(`${source} location ${index} hourly.cloud_cover[${hour}] must be numeric.`);
      }
      if (typeof validTime === "string") {
        validTimesByHour.get(hour)?.push(normalizeOpenMeteoTime(validTime));
      }
      valuesByHour.get(hour)?.push(clampUint8(Math.round(cloudCover)));
    }
  }
  return { valuesByHour, validTimesByHour };
}

function requireHourlyPayload(item, label) {
  if (typeof item !== "object" || item === null || !("hourly" in item)) {
    throw new Error(`${label} is missing hourly cloud_cover.`);
  }
  const hourly = item.hourly;
  if (
    typeof hourly !== "object" ||
    hourly === null ||
    !Array.isArray(hourly.time) ||
    !Array.isArray(hourly.cloud_cover)
  ) {
    throw new Error(`${label} hourly payload is invalid.`);
  }
  return hourly;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--output-dir":
        options.outputDir = requireValue(args, index, arg);
        index += 1;
        break;
      case "--step":
      case "--resolution-deg":
        options.resolutionDeg = Number(requireValue(args, index, arg));
        index += 1;
        break;
      case "--source-step":
      case "--source-resolution-deg":
        options.sourceResolutionDeg = Number(requireValue(args, index, arg));
        index += 1;
        break;
      case "--forecast-hours":
        options.forecastHours = requireValue(args, index, arg).split(",").map((value) => Number(value.trim()));
        index += 1;
        break;
      case "--request-delay-ms":
        options.requestDelayMs = Number(requireValue(args, index, arg));
        index += 1;
        break;
      case "--batch-size":
        options.batchSize = Number(requireValue(args, index, arg));
        index += 1;
        break;
      case "--max-retries":
        options.maxRetries = Number(requireValue(args, index, arg));
        index += 1;
        break;
      case "--retry-delay-ms":
        options.retryDelayMs = Number(requireValue(args, index, arg));
        index += 1;
        break;
      case "--retain-generations":
        options.retainGenerations = Number(requireValue(args, index, arg));
        index += 1;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--atomic-publish":
        options.atomicPublish = true;
        break;
      case "--help":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/precompute/build-cloud-atlas-forecast-openmeteo.mjs [options]

Options:
  --output-dir <path>         Output frame directory. Default: ${DEFAULT_OUTPUT_DIR}
  --step <deg>                Output grid resolution. Default: ${DEFAULT_RESOLUTION_DEG}
  --source-step <deg>         Open-Meteo source anchor grid. Default: ${DEFAULT_SOURCE_RESOLUTION_DEG}
  --forecast-hours <csv>      Forecast hour offsets. Default: ${DEFAULT_FORECAST_HOURS.join(",")}
  --request-delay-ms <ms>     Delay between API requests. Default: ${DEFAULT_REQUEST_DELAY_MS}
  --batch-size <count>        Locations per API request. Default: ${DEFAULT_BATCH_SIZE}
  --max-retries <count>       Retry count for 429 / 5xx. Default: ${DEFAULT_MAX_RETRIES}
  --retry-delay-ms <ms>       Base retry delay. Default: ${DEFAULT_RETRY_DELAY_MS}
  --atomic-publish            Write versioned frame URLs first, then atomically replace manifest.json
  --retain-generations <n>    With --atomic-publish, keep this many frame generations. Default: ${DEFAULT_RETAIN_GENERATIONS}
  --quiet                     Suppress row progress logs
`);
}

function requireValue(args, index, optionName) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

async function fetchJsonFromNetwork(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "PENUMBRA cloud-atlas forecast precompute",
    },
  });
  if (!response.ok) {
    const error = new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function fetchJsonWithRetry(fetchJson, url, options) {
  let attempt = 0;
  for (;;) {
    try {
      return await fetchJson(url);
    } catch (error) {
      if (attempt >= options.maxRetries || !isRetryableFetchError(error)) {
        throw error;
      }
      attempt += 1;
      const delayMs = options.retryDelayMs * attempt;
      if (!options.quiet) {
        console.warn(`cloud atlas forecast request retry ${attempt}/${options.maxRetries} in ${delayMs}ms`);
      }
      await delay(delayMs);
    }
  }
}

function isRetryableFetchError(error) {
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  if (status === 429) {
    return true;
  }
  return typeof status === "number" && status >= 500 && status < 600;
}

function chunk(values, size) {
  const chunkSize = Math.max(1, Math.floor(size));
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function mostCommonValidTime(times) {
  const counts = new Map();
  for (const time of times) {
    counts.set(time, (counts.get(time) ?? 0) + 1);
  }
  let bestTime;
  let bestCount = 0;
  for (const [time, count] of counts.entries()) {
    if (count > bestCount) {
      bestTime = time;
      bestCount = count;
    }
  }
  return bestTime;
}

function normalizeOpenMeteoTime(time) {
  return time.endsWith("Z") ? time : `${time}:00.000Z`;
}

function formatCoordinate(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function clampUint8(value) {
  return Math.min(100, Math.max(0, value));
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isMainModule() {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
}

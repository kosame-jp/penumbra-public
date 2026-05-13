#!/usr/bin/env node
/* global console, fetch */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { publishCloudAtlasForecastArtifacts } from "./cloud-atlas-forecast-artifacts.mjs";
import {
  DEFAULT_GFS_AWS_BASE_URL,
  DEFAULT_GFS_CYCLE_LATENCY_HOURS,
  fetchGfsCloudCoverFramePlan,
  latestAvailableGfsCycle,
} from "./gfs-cloud-source.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_OUTPUT_DIR = "public/data/cloud-atlas.forecast";
const DEFAULT_RESOLUTION_DEG = 1;
const DEFAULT_FORECAST_HOURS = [0, 3, 6, 9];
const DEFAULT_RETAIN_GENERATIONS = 0;
const DEFAULT_WGRIB2_BIN = "wgrib2";
const GFS_SOURCE_RESOLUTION_DEG = 0.25;
const GFS_SOURCE_WIDTH = 1440;
const GFS_SOURCE_HEIGHT = 721;
const DEFAULT_CLOUD_WATER_REFERENCE_PERCENTILE = 0.995;
const DEFAULT_CLOUD_WATER_DENSITY_GAMMA = 0.92;
const DEFAULT_PRECIPITATION_REFERENCE_MM_PER_HOUR = 8;
const DEFAULT_PRECIPITATION_ACTIVITY_GAMMA = 0.58;

if (isMainModule()) {
  const options = parseArgs(process.argv.slice(2));
  await buildCloudAtlasForecastGfs(options);
}

export async function buildCloudAtlasForecastGfs(options = {}) {
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const resolutionDeg = options.resolutionDeg ?? DEFAULT_RESOLUTION_DEG;
  const forecastHours = options.forecastHours ?? DEFAULT_FORECAST_HOURS;
  const generatedAtUtc = options.generatedAtUtc ?? new Date().toISOString();
  const atomicPublish = options.atomicPublish === true;
  const retainGenerations = Math.max(0, Math.floor(options.retainGenerations ?? DEFAULT_RETAIN_GENERATIONS));
  const cycle =
    options.date === undefined || options.cycleHour === undefined
      ? latestAvailableGfsCycle(options.nowUtcMs, options.latencyHours ?? DEFAULT_GFS_CYCLE_LATENCY_HOURS)
      : { date: options.date, cycleHour: options.cycleHour };
  const sourceWidth = options.sourceWidth ?? GFS_SOURCE_WIDTH;
  const sourceHeight = options.sourceHeight ?? GFS_SOURCE_HEIGHT;
  const sourceResolutionDeg = options.sourceResolutionDeg ?? GFS_SOURCE_RESOLUTION_DEG;
  const outputWidth = Math.round(360 / resolutionDeg);
  const outputHeight = Math.round(180 / resolutionDeg) + 1;
  const decodeGribValues = options.decodeGribValues ?? decodeGfsGridValuesWithWgrib2;
  const fetchBytes = options.fetchBytes ?? fetchByteRangeFromNetwork;

  const frames = [];
  for (const forecastHour of forecastHours) {
    const plan = await fetchGfsCloudCoverFramePlan({
      date: cycle.date,
      cycleHour: cycle.cycleHour,
      forecastHour,
      baseUrl: options.baseUrl ?? DEFAULT_GFS_AWS_BASE_URL,
      fetchText: options.fetchText,
    });
    const cloudCoverBytes = await fetchBytes(plan.gribUrl, plan.byteRangeHeader);
    const cloudWaterBytes = await fetchBytes(plan.gribUrl, plan.cloudWaterByteRangeHeader);
    const precipitationBytes = await fetchBytes(plan.gribUrl, plan.precipitationByteRangeHeader);
    const decodedCover = await decodeGribValues({
      field: "cloudCover",
      gribBytes: cloudCoverBytes,
      plan,
      message: plan.message,
      byteRangeHeader: plan.byteRangeHeader,
      wgrib2Bin: options.wgrib2Bin ?? DEFAULT_WGRIB2_BIN,
      sourceWidth,
      sourceHeight,
    });
    const decodedPrecipitation = await decodeGribValues({
      field: "precipitationRate",
      gribBytes: precipitationBytes,
      plan,
      message: plan.precipitationMessage,
      byteRangeHeader: plan.precipitationByteRangeHeader,
      wgrib2Bin: options.wgrib2Bin ?? DEFAULT_WGRIB2_BIN,
      sourceWidth,
      sourceHeight,
    });
    const decodedCloudWater = await decodeGribValues({
      field: "cloudWater",
      gribBytes: cloudWaterBytes,
      plan,
      message: plan.cloudWaterMessage,
      byteRangeHeader: plan.cloudWaterByteRangeHeader,
      wgrib2Bin: options.wgrib2Bin ?? DEFAULT_WGRIB2_BIN,
      sourceWidth,
      sourceHeight,
    });
    const sourceValues = Array.isArray(decodedCover) ? decodedCover : decodedCover.values;
    const frameSourceWidth = Array.isArray(decodedCover) ? sourceWidth : decodedCover.width ?? sourceWidth;
    const frameSourceHeight = Array.isArray(decodedCover) ? sourceHeight : decodedCover.height ?? sourceHeight;
    const values = resampleGfsCloudCoverValues({
      sourceValues,
      sourceWidth: frameSourceWidth,
      sourceHeight: frameSourceHeight,
      sourceResolutionDeg,
      outputResolutionDeg: resolutionDeg,
      outputWidth,
      outputHeight,
    });
    const cloudWaterSourceValues = Array.isArray(decodedCloudWater) ? decodedCloudWater : decodedCloudWater.values;
    const cloudWaterSourceWidth = Array.isArray(decodedCloudWater)
      ? sourceWidth
      : decodedCloudWater.width ?? sourceWidth;
    const cloudWaterSourceHeight = Array.isArray(decodedCloudWater)
      ? sourceHeight
      : decodedCloudWater.height ?? sourceHeight;
    const cloudWaterValues = resampleGfsGridValues({
      sourceValues: cloudWaterSourceValues,
      sourceWidth: cloudWaterSourceWidth,
      sourceHeight: cloudWaterSourceHeight,
      sourceResolutionDeg,
      outputResolutionDeg: resolutionDeg,
      outputWidth,
      outputHeight,
    });
    const opticalDensityValues = normalizeCloudWaterToOpticalDensityValues(cloudWaterValues);
    const precipitationSourceValues = Array.isArray(decodedPrecipitation)
      ? decodedPrecipitation
      : decodedPrecipitation.values;
    const precipitationSourceWidth = Array.isArray(decodedPrecipitation)
      ? sourceWidth
      : decodedPrecipitation.width ?? sourceWidth;
    const precipitationSourceHeight = Array.isArray(decodedPrecipitation)
      ? sourceHeight
      : decodedPrecipitation.height ?? sourceHeight;
    const precipitationRateValues = resampleGfsGridValues({
      sourceValues: precipitationSourceValues,
      sourceWidth: precipitationSourceWidth,
      sourceHeight: precipitationSourceHeight,
      sourceResolutionDeg,
      outputResolutionDeg: resolutionDeg,
      outputWidth,
      outputHeight,
    });
    const precipitationValues = normalizePrecipitationRateToActivityValues(precipitationRateValues);
    frames.push({
      values,
      opticalDensityValues,
      precipitationValues,
      validAtUtc: plan.validAtUtc,
      forecastHour,
      label: `f${String(forecastHour).padStart(3, "0")}`,
      provenance:
        `Decoded ${plan.sourceKey} ${plan.message.raw}, ${plan.cloudWaterMessage.raw}, and ${plan.precipitationMessage.raw} from NOAA GFS GRIB2 byte ranges ${plan.byteRangeHeader} / ${plan.cloudWaterByteRangeHeader} / ${plan.precipitationByteRangeHeader}.`,
    });

    if (options.quiet !== true) {
      console.log(`gfs cloud frame f${String(forecastHour).padStart(3, "0")} ${plan.byteRangeHeader} done`);
    }
  }

  return publishCloudAtlasForecastArtifacts({
    outputDir,
    generatedAtUtc,
    resolutionDeg,
    width: outputWidth,
    height: outputHeight,
    frameVersion: `gfs-cloud-atlas-${resolutionDeg}deg-from-${sourceResolutionDeg}deg-v1`,
    manifestVersion: `gfs-cloud-forecast-${resolutionDeg}deg-from-${sourceResolutionDeg}deg-v1`,
    source: {
      kind: "noaa-gfs",
      model: "NOAA GFS 0.25 degree pgrb2 total cloud cover + cloud water + precipitation rate",
      provenance:
        "Generated by scripts/precompute/build-cloud-atlas-forecast-gfs.mjs from NOAA/NODD GFS GRIB2 TCDC:entire atmosphere, CWAT:entire atmosphere cloud-water, and PRATE:surface precipitation-rate messages.",
      frameProvenance:
        "Decoded from NOAA/NODD GFS GRIB2 TCDC:entire atmosphere, CWAT:entire atmosphere, and PRATE:surface byte-range messages selected by the companion .idx file, then resampled into the cloud atlas grid. TCDC remains cloud-cover presence; CWAT is normalized as a visual optical-density proxy. PRATE is normalized as a precipitation activity field for the sunrise Gaussian band; it does not create a second playhead.",
      manifestMetadata: {
        cycleDate: cycle.date,
        cycleHour: cycle.cycleHour,
        sourceResolutionDeg,
        sourceWidth,
        sourceHeight,
        decoder: options.decodeGribValues === undefined ? "wgrib2" : "injected",
      },
    },
    frames,
    atomicPublish,
    retainGenerations,
    quiet: options.quiet === true,
  });
}

export async function decodeGfsGridValuesWithWgrib2(options) {
  const tempDir = await mkdtemp(join(tmpdir(), "penumbra-gfs-cloud-"));
  const inputPath = join(tempDir, `${options.field ?? "field"}.grib2`);
  const outputPath = join(tempDir, `${options.field ?? "field"}.txt`);
  try {
    await writeFile(inputPath, options.gribBytes);
    await execFileAsync(options.wgrib2Bin ?? DEFAULT_WGRIB2_BIN, [inputPath, "-no_header", "-text", outputPath], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const text = await readFile(outputPath, "utf8");
    return parseWgrib2TextGrid(text, {
      expectedWidth: options.sourceWidth ?? GFS_SOURCE_WIDTH,
      expectedHeight: options.sourceHeight ?? GFS_SOURCE_HEIGHT,
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "wgrib2 is required to build GFS cloud atlas frames. Install wgrib2 or inject decodeGribValues in tests.",
      );
    }
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export const decodeGfsCloudCoverValuesWithWgrib2 = decodeGfsGridValuesWithWgrib2;

export function parseWgrib2TextGrid(text, options = {}) {
  const values = text
    .trim()
    .split(/\s+/)
    .filter((part) => part !== "")
    .map((part) => Number(part));
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("wgrib2 text output did not contain finite numeric grid values.");
  }

  const expectedWidth = options.expectedWidth ?? GFS_SOURCE_WIDTH;
  const expectedHeight = options.expectedHeight ?? GFS_SOURCE_HEIGHT;
  const expectedCount = expectedWidth * expectedHeight;
  if (values.length === expectedCount) {
    return { width: expectedWidth, height: expectedHeight, values };
  }

  const headerWidth = values[0];
  const headerHeight = values[1];
  if (Number.isInteger(headerWidth) && Number.isInteger(headerHeight) && headerWidth * headerHeight === values.length - 2) {
    return { width: headerWidth, height: headerHeight, values: values.slice(2) };
  }

  throw new Error(`wgrib2 text output contained ${values.length} values; expected ${expectedCount}.`);
}

export function resampleGfsCloudCoverValues(options) {
  return resampleGfsGridValues(options).map((value) => clampUint8(Math.round(value)));
}

export function resampleGfsGridValues(options) {
  const {
    sourceValues,
    sourceWidth,
    sourceHeight,
    sourceResolutionDeg = GFS_SOURCE_RESOLUTION_DEG,
    outputResolutionDeg,
    outputWidth,
    outputHeight,
  } = options;
  if (sourceValues.length !== sourceWidth * sourceHeight) {
    throw new Error(`GFS cloud source grid has ${sourceValues.length} values; expected ${sourceWidth * sourceHeight}.`);
  }

  const values = [];
  for (let y = 0; y < outputHeight; y += 1) {
    const latitudeDeg = -90 + y * outputResolutionDeg;
    const sourceY = clampInt(Math.round((latitudeDeg + 90) / sourceResolutionDeg), 0, sourceHeight - 1);
    for (let x = 0; x < outputWidth; x += 1) {
      const longitudeDeg = -180 + x * outputResolutionDeg;
      const normalizedLon = ((longitudeDeg % 360) + 360) % 360;
      const sourceX = Math.round(normalizedLon / sourceResolutionDeg) % sourceWidth;
      const value = sourceValues[sourceY * sourceWidth + sourceX];
      values.push(Number.isFinite(value) ? value : 0);
    }
  }
  return values;
}

export function normalizeCloudWaterToOpticalDensityValues(values, options = {}) {
  const positiveValues = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (positiveValues.length === 0) {
    return values.map(() => 0);
  }

  const referenceValue =
    options.referenceValue ??
    percentileSorted(
      positiveValues,
      options.referencePercentile ?? DEFAULT_CLOUD_WATER_REFERENCE_PERCENTILE,
    );
  const safeReference = Number.isFinite(referenceValue) && referenceValue > 0
    ? referenceValue
    : positiveValues.at(-1) ?? 1;
  const gamma = options.gamma ?? DEFAULT_CLOUD_WATER_DENSITY_GAMMA;

  return values.map((value) => {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    const normalized = Math.max(0, Math.min(1, value / safeReference));
    return clampUint8(Math.round(Math.pow(normalized, gamma) * 100));
  });
}

export function normalizePrecipitationRateToActivityValues(values, options = {}) {
  const referenceMmPerHour =
    options.referenceMmPerHour ?? DEFAULT_PRECIPITATION_REFERENCE_MM_PER_HOUR;
  const safeReference = Number.isFinite(referenceMmPerHour) && referenceMmPerHour > 0
    ? referenceMmPerHour
    : DEFAULT_PRECIPITATION_REFERENCE_MM_PER_HOUR;
  const gamma = options.gamma ?? DEFAULT_PRECIPITATION_ACTIVITY_GAMMA;

  return values.map((value) => {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }

    const mmPerHour = value * 3600;
    const normalized = Math.max(0, Math.min(1, mmPerHour / safeReference));
    return clampUint8(Math.round(Math.pow(normalized, gamma) * 100));
  });
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
      case "--date":
        options.date = requireValue(args, index, arg);
        index += 1;
        break;
      case "--cycle":
        options.cycleHour = Number(requireValue(args, index, arg));
        index += 1;
        break;
      case "--forecast-hours":
        options.forecastHours = requireValue(args, index, arg)
          .split(",")
          .map((value) => Number(value.trim()));
        index += 1;
        break;
      case "--base-url":
        options.baseUrl = requireValue(args, index, arg);
        index += 1;
        break;
      case "--latency-hours":
        options.latencyHours = Number(requireValue(args, index, arg));
        index += 1;
        break;
      case "--wgrib2-bin":
        options.wgrib2Bin = requireValue(args, index, arg);
        index += 1;
        break;
      case "--retain-generations":
        options.retainGenerations = Number(requireValue(args, index, arg));
        index += 1;
        break;
      case "--atomic-publish":
        options.atomicPublish = true;
        break;
      case "--quiet":
        options.quiet = true;
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

function requireValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

async function fetchByteRangeFromNetwork(url, byteRangeHeader) {
  const response = await fetch(url, { headers: { Range: byteRangeHeader } });
  if (response.status !== 206) {
    throw new Error(`${url} did not return a partial GRIB2 response for ${byteRangeHeader}; got HTTP ${response.status}.`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function clampUint8(value) {
  if (!Number.isFinite(value) || value > 1e10) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function percentileSorted(sortedValues, percentile01) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const clampedPercentile = Math.max(0, Math.min(1, Number(percentile01)));
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * clampedPercentile) - 1));
  return sortedValues[index] ?? 0;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function printHelp() {
  console.log(`Usage:
  node scripts/precompute/build-cloud-atlas-forecast-gfs.mjs [options]

Options:
  --output-dir <path>         Output frame directory. Default: ${DEFAULT_OUTPUT_DIR}
  --step <deg>                Output grid resolution. Default: ${DEFAULT_RESOLUTION_DEG}
  --date <YYYYMMDD>           GFS cycle date. Default: latest available cycle by UTC latency.
  --cycle <00|06|12|18>       GFS cycle hour. Default: latest available cycle by UTC latency.
  --forecast-hours <csv>      Forecast hour offsets. Default: ${DEFAULT_FORECAST_HOURS.join(",")}
  --base-url <url>            GFS object base URL. Default: ${DEFAULT_GFS_AWS_BASE_URL}
  --latency-hours <hours>     Cycle availability lag for automatic cycle selection. Default: ${DEFAULT_GFS_CYCLE_LATENCY_HOURS}
  --wgrib2-bin <path>         wgrib2 executable. Default: ${DEFAULT_WGRIB2_BIN}
  --atomic-publish            Write versioned frames before atomically replacing manifest.json.
  --retain-generations <n>    Keep this many old versioned frame generations. Default: ${DEFAULT_RETAIN_GENERATIONS}
  --quiet                     Suppress progress output.
`);
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

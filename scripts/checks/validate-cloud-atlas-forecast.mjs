#!/usr/bin/env node
/* global console */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const DEFAULT_MANIFEST_PATH = "public/data/cloud-atlas.forecast/manifest.json";
const DEFAULT_MAX_HOLD_MS = 9 * 60 * 60 * 1000;

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await validateCloudAtlasForecast(options.manifestPath, {
      requireCurrent: options.requireCurrent,
      nowUtcMs: options.nowUtcMs,
      maxHoldMs: options.maxHoldMs,
    });
    if (!options.quiet) {
      console.log(
        [
          `cloud forecast ok`,
          `${result.frameCount} frames`,
          `${result.width}x${result.height}`,
          `${result.resolutionDeg.toFixed(2)}deg`,
          `${result.firstValidAtUtc}..${result.lastValidAtUtc}`,
          `freshness ${result.freshness.status}`,
        ].join(" "),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export async function validateCloudAtlasForecast(
  manifestPath = DEFAULT_MANIFEST_PATH,
  options = {},
) {
  const readJson = options.readJson ?? readJsonFile;
  const validator = options.validator ?? (await createArtifactValidator());
  const manifest = validator.parseCloudAtlasManifest(await readJson(manifestPath), manifestPath);
  const manifestDir = dirname(manifestPath);
  const seenUrls = new Set();
  let previousValidAtMs = Number.NEGATIVE_INFINITY;
  let width;
  let height;
  let resolutionDeg;

  for (const [index, frame] of manifest.frames.entries()) {
    if (seenUrls.has(frame.url)) {
      throw new Error(`${manifestPath}.frames[${index}].url duplicates ${frame.url}.`);
    }
    seenUrls.add(frame.url);

    const frameValidAtMs = requireUtcMs(frame.validAtUtc, `${manifestPath}.frames[${index}].validAtUtc`);
    if (frameValidAtMs <= previousValidAtMs) {
      throw new Error(`${manifestPath}.frames must be strictly increasing by validAtUtc.`);
    }
    previousValidAtMs = frameValidAtMs;

    const framePath = resolveFramePath(manifestDir, frame.url);
    const atlas = validator.parseCloudAtlas(await readJson(framePath), framePath);
    if (atlas.validAtUtc !== frame.validAtUtc) {
      throw new Error(`${framePath}.validAtUtc must match manifest frame validAtUtc.`);
    }
    if (atlas.source.kind !== manifest.source.kind) {
      throw new Error(`${framePath}.source.kind must match manifest source.kind.`);
    }

    width ??= atlas.width;
    height ??= atlas.height;
    resolutionDeg ??= atlas.resolutionDeg;
    if (atlas.width !== width || atlas.height !== height || atlas.resolutionDeg !== resolutionDeg) {
      throw new Error(`${framePath} grid shape must match previous forecast frames.`);
    }
    if (atlas.values.length !== atlas.width * atlas.height) {
      throw new Error(`${framePath}.values length must match width * height.`);
    }
    if (
      atlas.opticalDensityValues !== undefined &&
      atlas.opticalDensityValues.length !== atlas.width * atlas.height
    ) {
      throw new Error(`${framePath}.opticalDensityValues length must match width * height.`);
    }
    if (
      atlas.precipitationValues !== undefined &&
      atlas.precipitationValues.length !== atlas.width * atlas.height
    ) {
      throw new Error(`${framePath}.precipitationValues length must match width * height.`);
    }
  }

  const firstFrame = manifest.frames[0];
  const lastFrame = manifest.frames.at(-1);
  const freshness = forecastFreshness({
    firstValidAtUtc: firstFrame?.validAtUtc ?? "",
    lastValidAtUtc: lastFrame?.validAtUtc ?? "",
    nowUtcMs: options.nowUtcMs ?? Date.now(),
    maxHoldMs: options.maxHoldMs ?? DEFAULT_MAX_HOLD_MS,
  });
  if (options.requireCurrent === true && !freshness.usable) {
    throw new Error(`Forecast is not operationally current: ${freshness.message}`);
  }

  return {
    frameCount: manifest.frames.length,
    width: width ?? 0,
    height: height ?? 0,
    resolutionDeg: resolutionDeg ?? 0,
    firstValidAtUtc: firstFrame?.validAtUtc ?? "",
    lastValidAtUtc: lastFrame?.validAtUtc ?? "",
    freshness,
  };
}

export function forecastFreshness(options) {
  const firstValidAtMs = requireUtcMs(options.firstValidAtUtc, "firstValidAtUtc");
  const lastValidAtMs = requireUtcMs(options.lastValidAtUtc, "lastValidAtUtc");
  const nowUtcMs = options.nowUtcMs;
  const maxHoldMs = Math.max(0, options.maxHoldMs);
  if (!Number.isFinite(nowUtcMs)) {
    throw new Error("nowUtcMs must be finite.");
  }

  if (nowUtcMs < firstValidAtMs) {
    return {
      status: "future",
      usable: false,
      holdMs: nowUtcMs - firstValidAtMs,
      maxHoldMs,
      message: `forecast starts in ${formatDurationMs(firstValidAtMs - nowUtcMs)}`,
    };
  }

  if (nowUtcMs <= lastValidAtMs) {
    return {
      status: "current",
      usable: true,
      holdMs: 0,
      maxHoldMs,
      message: "forecast covers current UTC",
    };
  }

  const holdMs = nowUtcMs - lastValidAtMs;
  if (holdMs <= maxHoldMs) {
    return {
      status: "hold",
      usable: true,
      holdMs,
      maxHoldMs,
      message: `forecast is holding last frame for ${formatDurationMs(holdMs)}`,
    };
  }

  return {
    status: "stale",
    usable: false,
    holdMs,
    maxHoldMs,
    message: `forecast is stale by ${formatDurationMs(holdMs - maxHoldMs)}`,
  };
}

function resolveFramePath(manifestDir, frameUrl) {
  if (/^https?:\/\//.test(frameUrl) || frameUrl.startsWith("/")) {
    throw new Error(`Forecast validation expects local relative frame URLs; got ${frameUrl}.`);
  }
  return join(manifestDir, frameUrl);
}

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function createArtifactValidator() {
  const [cloudAtlasSchema, cloudAtlasManifestSchema] = await Promise.all([
    readJsonFile("schemas/cloud-atlas.schema.json"),
    readJsonFile("schemas/cloud-atlas-manifest.schema.json"),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateCloudAtlas = ajv.compile(cloudAtlasSchema);
  const validateCloudAtlasManifest = ajv.compile(cloudAtlasManifestSchema);
  return {
    parseCloudAtlas(data, label) {
      if (!validateCloudAtlas(data)) {
        throw new Error(formatValidationError(label, validateCloudAtlas.errors));
      }
      return data;
    },
    parseCloudAtlasManifest(data, label) {
      if (!validateCloudAtlasManifest(data)) {
        throw new Error(formatValidationError(label, validateCloudAtlasManifest.errors));
      }
      return data;
    },
  };
}

function formatValidationError(label, errors) {
  const detail = (errors ?? [])
    .slice(0, 4)
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
  return `${label} failed schema validation${detail ? `: ${detail}` : "."}`;
}

function requireUtcMs(value, label) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`${label} must be a valid UTC date-time.`);
  }
  return ms;
}

function parseArgs(args) {
  const options = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    quiet: false,
    requireCurrent: false,
    nowUtcMs: undefined,
    maxHoldMs: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--manifest":
        options.manifestPath = requireValue(args, index, arg);
        index += 1;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--require-current":
        options.requireCurrent = true;
        break;
      case "--now":
        options.nowUtcMs = Date.parse(requireValue(args, index, arg));
        if (!Number.isFinite(options.nowUtcMs)) {
          throw new Error("--now requires a valid UTC date-time.");
        }
        index += 1;
        break;
      case "--max-hold-hours":
        options.maxHoldMs = Number(requireValue(args, index, arg)) * 60 * 60 * 1000;
        if (!Number.isFinite(options.maxHoldMs) || options.maxHoldMs < 0) {
          throw new Error("--max-hold-hours must be a non-negative number.");
        }
        index += 1;
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
  node scripts/checks/validate-cloud-atlas-forecast.mjs [options]

Options:
  --manifest <path>  Forecast manifest path. Default: ${DEFAULT_MANIFEST_PATH}
  --require-current  Fail when current UTC is outside the forecast and its hold window
  --now <utc>        UTC instant for freshness checks. Default: current Date.now()
  --max-hold-hours <n>
                     Allowed hold after the last frame when --require-current is set. Default: 9
  --quiet            Suppress success output
`);
}

function requireValue(args, index, optionName) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

function isMainModule() {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
}

function formatDurationMs(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h${String(minutes).padStart(2, "0")}m`;
}

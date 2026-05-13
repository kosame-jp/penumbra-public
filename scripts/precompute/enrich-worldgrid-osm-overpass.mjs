/* global AbortController, clearTimeout, console, fetch, process, setTimeout */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_INPUT = "public/data/worldgrid.production-seed.json";
const DEFAULT_OUTPUT = "public/data/worldgrid.production-seed.json";
const DEFAULT_CACHE = ".cache/penumbra/osm-overpass-density.json";
const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";
const DEFAULT_SAMPLE_RADIUS_DEG = 0.25;
const DEFAULT_SAMPLE_GRID = 3;
const DEFAULT_MIN_NIGHTLIGHT = 0.001;
const DEFAULT_TIMEOUT_SECONDS = 25;
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_REQUEST_DELAY_MS = 1100;
const DEFAULT_DENSITY_REFERENCE_AREA_KM2 = 1000;
const OVERPASS_CACHE_VERSION = 2;
const EXCLUDED_HIGHWAY_RE = /^(footway|path|steps|cycleway|bridleway|pedestrian|corridor|elevator|escalator|platform|proposed|construction)$/;

if (isMainModule()) {
  await main();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = optionsFromArgs(args);
  const worldGrid = JSON.parse(await readFile(options.input, "utf8"));
  const cache = await loadCache(options.cache, options.endpoint);
  const enriched = await enrichWorldGridWithOsmDensity(worldGrid, options, cache);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          input: options.input,
          output: options.output,
          targetCells: targetCells(worldGrid.cells, options).length,
          stats: enriched.stats,
          sources: enriched.sources?.openStreetMapDensity,
        },
        null,
        2,
      ),
    );
    return;
  }

  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  await saveCache(options.cache, cache);
  console.log(
    JSON.stringify(
      {
        input: options.input,
        output: options.output,
        cache: options.cache,
        cells: enriched.cells.length,
        processedCells: enriched.cells.filter((cell) => cell.notes?.includes("OSM sampled density")).length,
        roadLengthKm: enriched.stats.roadLengthKm,
        buildingCount: enriched.stats.buildingCount,
        forestRatio: enriched.stats.forestRatio,
      },
      null,
      2,
    ),
  );
}

export async function enrichWorldGridWithOsmDensity(worldGrid, options, cache = createEmptyCache(options.endpoint)) {
  const generatedAtUtc = options.generatedAtUtc ?? new Date().toISOString();
  const targetIds = new Set(targetCells(worldGrid.cells, options).map((cell) => cell.id));
  let processed = 0;
  const cells = [];

  for (const cell of worldGrid.cells) {
    if (!targetIds.has(cell.id) || (options.maxCells != null && processed >= options.maxCells)) {
      cells.push(cell);
      continue;
    }

    const summary = await summarizeCellFromOverpass(cell, options, cache);
    cells.push(applyOsmSummaryToCell(cell, summary, options));
    processed += 1;

    if (!options.dryRun) {
      await saveCache(options.cache, cache);
    }
  }

  return {
    ...worldGrid,
    version: appendVersionToken(worldGrid.version, `osm-density-sampled-${generatedAtUtc.slice(0, 10)}`),
    generatedAtUtc,
    sources: {
      ...(worldGrid.sources ?? {}),
      openStreetMapDensity: {
        name: "OpenStreetMap sampled road/building/forest density",
        provider: "OpenStreetMap contributors via Overpass API",
        url: "https://www.openstreetmap.org/",
        overpassEndpoint: options.endpoint,
        accessedAtUtc: generatedAtUtc,
        sampleGrid: options.sampleGrid,
        sampleRadiusDeg: options.sampleRadiusDeg,
        densityReferenceAreaKm2: options.densityReferenceAreaKm2,
        minNightLight: options.minNightLight,
        includeZeroNightlight: options.includeZeroNightlight,
        includeOcean: options.includeOcean,
        transform:
          "Per-cell density proxies from small Overpass bbox samples. Road length is summed from OSM highway way geometry, converted to sampled road density, then normalized to the configured reference area. Building count is counted from OSM building ways/relations and normalized the same way. Forest ratio is estimated from sampled landuse=forest/natural=wood closed-way area. Values are reproducible approximations for PENUMBRA mapping, not complete planet-scale extracts or literal 5-degree cell totals.",
        attribution: "© OpenStreetMap contributors",
        license: "ODbL 1.0",
      },
    },
    stats: computeWorldGridStats(cells),
    cells,
  };
}

export function targetCells(cells, options) {
  return cells.filter((cell) => {
    if (!options.includeOcean && cell.landClass === "ocean") {
      return false;
    }
    if (options.includeZeroNightlight) {
      return true;
    }
    return cell.nightLightMean > options.minNightLight;
  });
}

export async function summarizeCellFromOverpass(cell, options, cache) {
  const samples = sampleBboxesForCell(cell, options);
  const sampleSummaries = [];

  for (const bbox of samples) {
    const key = cacheKeyForBbox(bbox);
    let summary = cache.samples[key];
    if (!summary) {
      summary = await fetchOverpassSummary(bbox, options);
      cache.samples[key] = summary;
      if (options.requestDelayMs > 0) {
        await sleep(options.requestDelayMs);
      }
    }
    sampleSummaries.push(summary);
  }

  return estimateCellDensity(cell, sampleSummaries, options);
}

export function estimateCellDensity(cell, sampleSummaries, options = {}) {
  const sampleAreaKm2 = sampleSummaries.reduce((sum, sample) => sum + sample.bboxAreaKm2, 0);
  const roadLengthKm = sampleSummaries.reduce((sum, sample) => sum + sample.roadLengthKm, 0);
  const buildingCount = sampleSummaries.reduce((sum, sample) => sum + sample.buildingCount, 0);
  const forestAreaKm2 = sampleSummaries.reduce((sum, sample) => sum + sample.forestAreaKm2, 0);
  const cellAreaKm2 = bboxAreaKm2(cellBounds(cell));
  const densityReferenceAreaKm2 = options.densityReferenceAreaKm2 ?? DEFAULT_DENSITY_REFERENCE_AREA_KM2;
  const densityScale = sampleAreaKm2 > 0 ? densityReferenceAreaKm2 / sampleAreaKm2 : 0;

  return {
    roadLengthKm: round(roadLengthKm * densityScale, 3),
    buildingCount: Math.round(buildingCount * densityScale),
    forestRatio: round(clamp(sampleAreaKm2 > 0 ? forestAreaKm2 / sampleAreaKm2 : 0, 0, 1), 4),
    sampledAreaKm2: round(sampleAreaKm2, 3),
    cellAreaKm2: round(cellAreaKm2, 3),
    sampleCount: sampleSummaries.length,
  };
}

export function sampleBboxesForCell(cell, options) {
  const offsets = sampleOffsets(options.sampleGrid);
  const radius = options.sampleRadiusDeg;

  return offsets.map(([latOffsetNorm, lonOffsetNorm]) => {
    const lat = clamp(
      cell.latCenterDeg + latOffsetNorm * cellSizeDeg(cell, options),
      -85.05112878 + radius,
      85.05112878 - radius,
    );
    const lon = wrapLongitude(cell.lonCenterDeg + lonOffsetNorm * cellSizeDeg(cell, options));
    return {
      south: round(clamp(lat - radius, -85.05112878, 85.05112878), 6),
      west: round(wrapLongitude(lon - radius), 6),
      north: round(clamp(lat + radius, -85.05112878, 85.05112878), 6),
      east: round(wrapLongitude(lon + radius), 6),
    };
  });
}

async function fetchOverpassSummary(bbox, options) {
  const query = overpassQueryForBbox(bbox, options.timeoutSeconds);
  const json = await fetchOverpassJson(query, options);
  return summarizeOverpassElements(json.elements ?? [], bbox);
}

export function summarizeOverpassElements(elements, bbox) {
  const buildingIds = new Set();
  let roadLengthKm = 0;
  let forestAreaKm2 = 0;

  for (const element of elements) {
    const tags = element.tags ?? {};
    if (element.type === "way" && typeof tags.highway === "string" && !EXCLUDED_HIGHWAY_RE.test(tags.highway)) {
      roadLengthKm += polylineLengthKm(element.geometry ?? []);
    }
    if ((element.type === "way" || element.type === "relation") && tags.building) {
      buildingIds.add(`${element.type}/${element.id}`);
    }
    if (element.type === "way" && isForestTags(tags)) {
      forestAreaKm2 += polygonAreaKm2(element.geometry ?? []);
    }
  }

  return {
    bbox,
    bboxAreaKm2: round(bboxAreaKm2(bbox), 3),
    roadLengthKm: round(roadLengthKm, 3),
    buildingCount: buildingIds.size,
    forestAreaKm2: round(forestAreaKm2, 3),
  };
}

function isForestTags(tags) {
  return tags.landuse === "forest" || tags.natural === "wood";
}

async function fetchOverpassJson(query, options) {
  let lastError;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs);
    try {
      const response = await fetch(`${options.endpoint}?data=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "PENUMBRA data precompute",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Overpass returned ${response.status} ${response.statusText}: ${detail.slice(0, 240)}`);
      }
      return await response.json();
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < options.retries) {
        await sleep(options.requestDelayMs * (attempt + 1));
      }
    }
  }

  throw lastError;
}

export function overpassQueryForBbox(bbox, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS) {
  const bboxText = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `[out:json][timeout:${timeoutSeconds}];
(
  way["highway"]["highway"!~"^(footway|path|steps|cycleway|bridleway|pedestrian|corridor|elevator|escalator|platform|proposed|construction)$"](${bboxText});
);
out body geom qt;
(
  way["building"](${bboxText});
  relation["building"](${bboxText});
);
out tags qt;
(
  way["landuse"="forest"](${bboxText});
  way["natural"="wood"](${bboxText});
);
out body geom qt;`;
}

function applyOsmSummaryToCell(cell, summary, options) {
  return {
    ...cell,
    roadLengthKm: summary.roadLengthKm,
    buildingCount: summary.buildingCount,
    forestRatio: summary.forestRatio,
    surfaceHardness01: clamp(
      cell.surfaceHardness01 + Math.min(0.22, Math.log1p(summary.buildingCount) / 70 + Math.log1p(summary.roadLengthKm) / 95),
      0,
      1,
    ),
    openness01: clamp(cell.openness01 - summary.forestRatio * 0.24 - Math.min(0.18, Math.log1p(summary.buildingCount) / 90), 0, 1),
    notes: appendNote(
      cell.notes,
      `OSM sampled density via Overpass (${options.sampleGrid}x${options.sampleGrid}, radius ${options.sampleRadiusDeg} deg): road ${summary.roadLengthKm} km, buildings ${summary.buildingCount}, forest ${summary.forestRatio}.`,
    ),
  };
}

function cellSizeDeg(cell, options) {
  return Number.isFinite(options.cellSizeDegrees) ? options.cellSizeDegrees : 5;
}

function cellBounds(cell) {
  const half = 2.5;
  return {
    south: clamp(cell.latCenterDeg - half, -85.05112878, 85.05112878),
    west: wrapLongitude(cell.lonCenterDeg - half),
    north: clamp(cell.latCenterDeg + half, -85.05112878, 85.05112878),
    east: wrapLongitude(cell.lonCenterDeg + half),
  };
}

function sampleOffsets(sampleGrid) {
  if (sampleGrid <= 1) {
    return [[0, 0]];
  }
  const offsets = [];
  const denominator = sampleGrid - 1;
  for (let y = 0; y < sampleGrid; y += 1) {
    for (let x = 0; x < sampleGrid; x += 1) {
      offsets.push([((y / denominator) - 0.5) * 0.64, ((x / denominator) - 0.5) * 0.64]);
    }
  }
  return offsets;
}

function polylineLengthKm(points) {
  let lengthKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    lengthKm += haversineDistanceKm(points[index - 1].lat, points[index - 1].lon, points[index].lat, points[index].lon);
  }
  return lengthKm;
}

function polygonAreaKm2(points) {
  if (points.length < 4) {
    return 0;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first.lat !== last.lat || first.lon !== last.lon) {
    return 0;
  }

  const meanLatRad = degToRad(points.reduce((sum, point) => sum + point.lat, 0) / points.length);
  const earthRadiusKm = 6371.0088;
  const projected = points.map((point) => ({
    x: earthRadiusKm * degToRad(point.lon) * Math.cos(meanLatRad),
    y: earthRadiusKm * degToRad(point.lat),
  }));
  let twiceArea = 0;
  for (let index = 0; index < projected.length - 1; index += 1) {
    twiceArea += projected[index].x * projected[index + 1].y - projected[index + 1].x * projected[index].y;
  }
  return Math.abs(twiceArea) / 2;
}

function bboxAreaKm2(bbox) {
  const widthKm = haversineDistanceKm((bbox.south + bbox.north) / 2, bbox.west, (bbox.south + bbox.north) / 2, bbox.east);
  const heightKm = haversineDistanceKm(bbox.south, (bbox.west + bbox.east) / 2, bbox.north, (bbox.west + bbox.east) / 2);
  return widthKm * heightKm;
}

function computeWorldGridStats(cells) {
  return {
    nightLight: computeStatBlock(cells.map((cell) => cell.nightLightMean), {
      includeP95: true,
      includeP99: true,
      includeP99_5: true,
    }),
    roadLengthKm: computeStatBlock(cells.map((cell) => cell.roadLengthKm), {
      includeP95: true,
      includeP99: true,
    }),
    buildingCount: computeStatBlock(cells.map((cell) => cell.buildingCount), {
      includeP95: true,
      includeP99: true,
    }),
    waterRatio: computeStatBlock(cells.map((cell) => cell.waterRatio)),
    forestRatio: computeStatBlock(cells.map((cell) => cell.forestRatio)),
    elevationM: computeStatBlock(cells.map((cell) => cell.elevationM), {
      includeP95: true,
      includeP99: true,
    }),
    bathymetryM: computeStatBlock(cells.map((cell) => cell.bathymetryM), {
      includeP95: true,
      includeP99: true,
    }),
  };
}

function computeStatBlock(values, options = {}) {
  const finiteValues = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finiteValues.length === 0) {
    throw new Error("Cannot compute stats from an empty numeric series.");
  }

  return {
    min: finiteValues[0],
    max: finiteValues[finiteValues.length - 1],
    ...(options.includeP95 ? { p95: percentile(finiteValues, 95) } : {}),
    ...(options.includeP99 ? { p99: percentile(finiteValues, 99) } : {}),
    ...(options.includeP99_5 ? { p99_5: percentile(finiteValues, 99.5) } : {}),
  };
}

function percentile(sortedValues, percentileValue) {
  const rank = (percentileValue / 100) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const ratio = rank - lowerIndex;
  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }
  return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * ratio;
}

async function loadCache(path, endpoint) {
  try {
    const cache = JSON.parse(await readFile(path, "utf8"));
    if (cache.version === OVERPASS_CACHE_VERSION && cache.endpoint === endpoint && cache.samples) {
      return cache;
    }
  } catch {
    // Empty cache is expected on first run.
  }

  return createEmptyCache(endpoint);
}

function createEmptyCache(endpoint) {
  return {
    version: OVERPASS_CACHE_VERSION,
    endpoint,
    samples: {},
  };
}

async function saveCache(path, cache) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function optionsFromArgs(args) {
  const sampleGrid = Number(args["sample-grid"] ?? DEFAULT_SAMPLE_GRID);
  const options = {
    input: args.input ?? DEFAULT_INPUT,
    output: args.output ?? DEFAULT_OUTPUT,
    cache: args.cache ?? DEFAULT_CACHE,
    endpoint: args.endpoint ?? DEFAULT_ENDPOINT,
    sampleRadiusDeg: Number(args["sample-radius-deg"] ?? DEFAULT_SAMPLE_RADIUS_DEG),
    sampleGrid,
    minNightLight: Number(args["min-nightlight"] ?? DEFAULT_MIN_NIGHTLIGHT),
    maxCells: args["max-cells"] == null ? undefined : Number(args["max-cells"]),
    includeZeroNightlight: parseBoolean(args["include-zero-nightlight"], false),
    includeOcean: parseBoolean(args["include-ocean"], false),
    dryRun: parseBoolean(args["dry-run"], false),
    timeoutSeconds: Number(args["timeout-seconds"] ?? DEFAULT_TIMEOUT_SECONDS),
    requestTimeoutMs: Number(args["request-timeout-ms"] ?? DEFAULT_REQUEST_TIMEOUT_MS),
    requestDelayMs: Number(args["request-delay-ms"] ?? DEFAULT_REQUEST_DELAY_MS),
    densityReferenceAreaKm2: Number(args["density-reference-area-km2"] ?? DEFAULT_DENSITY_REFERENCE_AREA_KM2),
    retries: Number(args.retries ?? 1),
    cellSizeDegrees: Number(args["cell-size-degrees"] ?? 5),
  };

  if (!Number.isInteger(options.sampleGrid) || options.sampleGrid < 1 || options.sampleGrid > 5) {
    throw new Error("--sample-grid must be an integer between 1 and 5.");
  }
  if (!Number.isFinite(options.sampleRadiusDeg) || options.sampleRadiusDeg <= 0 || options.sampleRadiusDeg > 1) {
    throw new Error("--sample-radius-deg must be a number between 0 and 1.");
  }
  if (options.maxCells != null && (!Number.isInteger(options.maxCells) || options.maxCells < 1)) {
    throw new Error("--max-cells must be a positive integer.");
  }
  if (!Number.isFinite(options.densityReferenceAreaKm2) || options.densityReferenceAreaKm2 <= 0) {
    throw new Error("--density-reference-area-km2 must be a positive number.");
  }

  return options;
}

function appendVersionToken(version, token) {
  return version.includes(token) ? version : `${version}+${token}`;
}

function cacheKeyForBbox(bbox) {
  return `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
}

function appendNote(existingNote, nextNote) {
  return existingNote ? `${existingNote} ${nextNote}` : nextNote;
}

function haversineDistanceKm(latADeg, lonADeg, latBDeg, lonBDeg) {
  const earthRadiusKm = 6371.0088;
  const latA = degToRad(latADeg);
  const latB = degToRad(latBDeg);
  const deltaLat = degToRad(latBDeg - latADeg);
  const deltaLon = degToRad(lonBDeg - lonADeg);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degToRad(value) {
  return (value * Math.PI) / 180;
}

function wrapLongitude(longitudeDeg) {
  if (longitudeDeg < -180) {
    return longitudeDeg + 360;
  }
  if (longitudeDeg >= 180) {
    return longitudeDeg - 360;
  }
  return longitudeDeg;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBoolean(value, fallback) {
  if (value == null) {
    return fallback;
  }
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return fallback;
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = rawArgs[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

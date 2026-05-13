/* global Buffer, console, fetch, process */
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { inflateSync } from "node:zlib";

const DEFAULT_INPUT = "public/data/worldgrid.terrain-seed.json";
const DEFAULT_OUTPUT = "public/data/worldgrid.production-seed.json";
const DEFAULT_ZOOM = 4;
const DEFAULT_TIME = "2016-01-01";
const TILE_SIZE = 256;
const TILE_MATRIX_SET = "GoogleMapsCompatible_Level8";
const TILE_URL_TEMPLATE =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Night_Lights/default/{time}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";

const args = parseArgs(process.argv.slice(2));
const input = args.input ?? DEFAULT_INPUT;
const output = args.output ?? DEFAULT_OUTPUT;
const zoom = Number(args.zoom ?? DEFAULT_ZOOM);
const time = args.time ?? DEFAULT_TIME;

if (!Number.isInteger(zoom) || zoom < 0 || zoom > 8) {
  throw new Error("--zoom must be an integer between 0 and 8 for VIIRS_Night_Lights.");
}

const generatedAtUtc = new Date().toISOString();
const worldGrid = JSON.parse(await readFile(input, "utf8"));
const enriched = await enrichNightLights(worldGrid, { generatedAtUtc, zoom, time });

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      input,
      output,
      cells: enriched.cells.length,
      zoom,
      time,
      nonZeroNightLightCells: enriched.cells.filter((cell) => cell.nightLightMean > 0).length,
      nightLight: enriched.stats.nightLight,
    },
    null,
    2,
  ),
);

async function enrichNightLights(worldGrid, options) {
  const tileCache = new Map();
  const cells = [];
  const cellSizeDegrees = Number.isFinite(worldGrid.cellSizeDegrees) ? worldGrid.cellSizeDegrees : 5;

  for (const cell of worldGrid.cells) {
    const nightLightMean = await sampleNightLightMean(
      cell,
      options.zoom,
      options.time,
      tileCache,
      cellSizeDegrees,
    );
    cells.push({
      ...cell,
      nightLightMean,
      notes: appendNote(
        cell.notes,
        `VIIRS_Night_Lights ${options.time} sampled from NASA GIBS at z${options.zoom}.`,
      ),
    });
  }

  return {
    ...worldGrid,
    version: `${worldGrid.version}+viirs-${options.time}-z${options.zoom}`,
    generatedAtUtc: options.generatedAtUtc,
    sources: {
      ...(worldGrid.sources ?? {}),
      ...(worldGrid.sources?.terrainTiles
        ? {
            terrainTiles: {
              ...worldGrid.sources.terrainTiles,
              note:
                "Terrain/bathymetry seed. VIIRS nightlights are enriched in this artifact; OSM density and vegetation fields remain pending.",
            },
          }
        : {}),
      viirsNightLights: {
        name: "Black Marble - Nighttime Lights only (Annual, 2012 & 2016)",
        provider: "NASA GIBS / NASA Earth Observatory / Suomi NPP VIIRS",
        url: "https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/VIIRS_Night_Lights.json",
        tileTemplate: TILE_URL_TEMPLATE,
        layer: "VIIRS_Night_Lights",
        time: options.time,
        tileMatrixSet: TILE_MATRIX_SET,
        zoom: options.zoom,
        accessedAtUtc: options.generatedAtUtc,
        transform:
          "Nightlight seed derived from 3x3 per-cell luminance samples of the rendered GIBS layer; values are visualization brightness, not calibrated radiance.",
      },
    },
    stats: computeWorldGridStats(cells),
    cells,
  };
}

async function sampleNightLightMean(cell, zoom, time, tileCache, cellSizeDegrees) {
  const offsets = [-0.32, 0, 0.32];
  const sampleSpanDeg = Number.isFinite(cellSizeDegrees) ? cellSizeDegrees : 5;
  let sum = 0;
  let count = 0;

  for (const latOffset of offsets) {
    for (const lonOffset of offsets) {
      const sampleLat = clamp(
        cell.latCenterDeg + latOffset * sampleSpanDeg,
        -85.05112878,
        85.05112878,
      );
      const sampleLon = wrapLongitude(cell.lonCenterDeg + lonOffset * sampleSpanDeg);
      sum += await sampleNightLight(sampleLat, sampleLon, zoom, time, tileCache);
      count += 1;
    }
  }

  return Number((sum / count).toFixed(3));
}

async function sampleNightLight(latitudeDeg, longitudeDeg, zoom, time, tileCache) {
  const tile = webMercatorTileCoordinate(latitudeDeg, longitudeDeg, zoom);
  const key = `${time}/${zoom}/${tile.x}/${tile.y}`;
  let decoded = tileCache.get(key);

  if (!decoded) {
    const url = viirsTileUrl(time, zoom, tile.x, tile.y);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    decoded = decodePng(Buffer.from(await response.arrayBuffer()));
    tileCache.set(key, decoded);
  }

  const pixelX = clamp(Math.floor(tile.pixelX), 0, decoded.width - 1);
  const pixelY = clamp(Math.floor(tile.pixelY), 0, decoded.height - 1);
  return pixelLuminance(decoded, pixelX, pixelY);
}

function viirsTileUrl(time, zoom, x, y) {
  return TILE_URL_TEMPLATE.replace("{time}", encodeURIComponent(time))
    .replace("{z}", String(zoom))
    .replace("{y}", String(y))
    .replace("{x}", String(x));
}

function webMercatorTileCoordinate(latitudeDeg, longitudeDeg, zoom) {
  const clampedLat = clamp(latitudeDeg, -85.05112878, 85.05112878);
  const clampedLon = clamp(longitudeDeg, -180, 180 - Number.EPSILON);
  const latRad = (clampedLat * Math.PI) / 180;
  const n = 2 ** zoom;
  const xFloat = ((clampedLon + 180) / 360) * n;
  const yFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = clamp(Math.floor(xFloat), 0, n - 1);
  const y = clamp(Math.floor(yFloat), 0, n - 1);

  return {
    x,
    y,
    pixelX: (xFloat - x) * TILE_SIZE,
    pixelY: (yFloat - y) * TILE_SIZE,
  };
}

function pixelLuminance(decoded, x, y) {
  const offset = (y * decoded.width + x) * decoded.channels;
  const red = decoded.data[offset];
  const green = decoded.channels === 1 || decoded.channels === 2 ? red : decoded.data[offset + 1];
  const blue = decoded.channels === 1 || decoded.channels === 2 ? red : decoded.data[offset + 2];
  const alpha =
    decoded.channels === 2 ? decoded.data[offset + 1] / 255 :
    decoded.channels === 4 ? decoded.data[offset + 3] / 255 :
    1;
  return Number(((red * 0.2126 + green * 0.7152 + blue * 0.0722) * alpha).toFixed(3));
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

function decodePng(buffer) {
  const signature = buffer.subarray(0, 8);
  if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Source tile was not a PNG.");
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

  if (bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType)) {
    throw new Error(`Unsupported VIIRS PNG format: bitDepth=${bitDepth}, colorType=${colorType}.`);
  }

  const channels = channelsForColorType(colorType);
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

function channelsForColorType(colorType) {
  if (colorType === 0) {
    return 1;
  }
  if (colorType === 2) {
    return 3;
  }
  if (colorType === 4) {
    return 2;
  }
  return 4;
}

function unfilterRow(row, previousRow, bytesPerPixel, filter) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previousRow[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] ?? 0 : 0;

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
  const predictor = left + up - upLeft;
  const leftDistance = Math.abs(predictor - left);
  const upDistance = Math.abs(predictor - up);
  const upLeftDistance = Math.abs(predictor - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  if (upDistance <= upLeftDistance) {
    return up;
  }
  return upLeft;
}

function appendNote(existingNote, nextNote) {
  return existingNote ? `${existingNote} ${nextNote}` : nextNote;
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

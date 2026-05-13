/* global Buffer, console, fetch, process */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { inflateSync } from "node:zlib";

const DEFAULT_OUTPUT = "public/data/worldgrid.terrain-seed.json";
const DEFAULT_STEP_DEG = 5;
const DEFAULT_ZOOM = 5;
const TILE_SIZE = 256;
const TILE_URL_TEMPLATE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

const args = parseArgs(process.argv.slice(2));
const output = args.output ?? DEFAULT_OUTPUT;
const stepDeg = Number(args.step ?? DEFAULT_STEP_DEG);
const zoom = Number(args.zoom ?? DEFAULT_ZOOM);

if (!Number.isFinite(stepDeg) || stepDeg <= 0 || stepDeg > 5) {
  throw new Error("--step must be a number between 0 and 5 degrees.");
}
if (!Number.isInteger(zoom) || zoom < 0 || zoom > 15) {
  throw new Error("--zoom must be an integer between 0 and 15.");
}

const generatedAtUtc = new Date().toISOString();
const cells = await buildTerrainCells({ stepDeg, zoom });
const artifact = buildWorldGridArtifact(cells, {
  version: `terrain-seed-${generatedAtUtc.slice(0, 10)}-z${zoom}-step${stepDeg}`,
  generatedAtUtc,
  cellSizeDegrees: stepDeg,
  sources: {
    terrainTiles: {
      name: "Mapzen Terrain Tiles on AWS",
      url: "https://registry.opendata.aws/terrain-tiles/",
      tileTemplate: TILE_URL_TEMPLATE,
      accessedAtUtc: generatedAtUtc,
      zoom,
      note: "Terrain/bathymetry seed. VIIRS nightlights, OSM density, and vegetation fields remain pending.",
    },
  },
});

await mkdir(dirname(output), { recursive: true });
await writeFile(`${output}`, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, cells: cells.length, stepDeg, zoom }, null, 2));

async function buildTerrainCells({ stepDeg, zoom }) {
  const tileCache = new Map();
  const cells = [];

  for (const latCenterDeg of centers(-90, 90, stepDeg)) {
    for (const lonCenterDeg of centers(-180, 180, stepDeg)) {
      const sample = await sampleTerrain(latCenterDeg, lonCenterDeg, zoom, tileCache);
      cells.push(cellFromTerrainSample(latCenterDeg, lonCenterDeg, sample.elevationM, stepDeg, zoom));
    }
  }

  return cells;
}

async function sampleTerrain(latitudeDeg, longitudeDeg, zoom, tileCache) {
  const tile = tileCoordinate(latitudeDeg, longitudeDeg, zoom);
  const key = `${zoom}/${tile.x}/${tile.y}`;
  let decoded = tileCache.get(key);

  if (!decoded) {
    const url = terrainTileUrl(zoom, tile.x, tile.y);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    decoded = decodePng(Buffer.from(await response.arrayBuffer()));
    tileCache.set(key, decoded);
  }

  const pixelX = clamp(Math.floor(tile.pixelX), 0, decoded.width - 1);
  const pixelY = clamp(Math.floor(tile.pixelY), 0, decoded.height - 1);
  const offset = (pixelY * decoded.width + pixelX) * decoded.channels;
  const elevationM = terrariumElevationM(
    decoded.data[offset],
    decoded.data[offset + 1],
    decoded.data[offset + 2],
  );

  return { elevationM };
}

function cellFromTerrainSample(latCenterDeg, lonCenterDeg, sampledElevationM, cellSizeDegrees, zoom) {
  const roundedElevationM = Math.round(sampledElevationM);
  const landClass = landClassForElevation(latCenterDeg, roundedElevationM);
  const terrainClass = terrainClassForElevation(latCenterDeg, roundedElevationM);
  const bathymetryM = roundedElevationM < 0 ? roundedElevationM : 0;
  const elevationM = roundedElevationM > 0 ? roundedElevationM : 0;

  return {
    id: `terrain-${formatCoord(latCenterDeg, "lat")}-${formatCoord(lonCenterDeg, "lon")}`,
    latCenterDeg,
    lonCenterDeg,
    landClass,
    terrainClass,
    elevationM,
    bathymetryM,
    roadLengthKm: 0,
    buildingCount: 0,
    waterRatio: waterRatioForLandClass(landClass),
    forestRatio: 0,
    nightLightMean: 0,
    surfaceHardness01: surfaceHardnessForTerrain(terrainClass),
    openness01: opennessForTerrain(terrainClass),
    notes: `Terrain seed cell from Mapzen/AWS terrain tiles at z${zoom}; OSM/VIIRS/forest density pending. Cell size ${cellSizeDegrees} degrees.`,
  };
}

function buildWorldGridArtifact(cells, options) {
  return {
    version: options.version,
    generatedAtUtc: options.generatedAtUtc,
    cellSizeDegrees: options.cellSizeDegrees,
    sources: options.sources,
    stats: computeWorldGridStats(cells),
    cells,
  };
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

export function terrariumElevationM(red, green, blue) {
  return red * 256 + green + blue / 256 - 32768;
}

function tileCoordinate(latitudeDeg, longitudeDeg, zoom) {
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

function terrainTileUrl(zoom, x, y) {
  return TILE_URL_TEMPLATE.replace("{z}", String(zoom))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

function landClassForElevation(latitudeDeg, elevationM) {
  if (Math.abs(latitudeDeg) > 75 && elevationM > -20) {
    return "ice";
  }
  if (elevationM < -20) {
    return "ocean";
  }
  if (elevationM <= 20) {
    return "coast";
  }
  return "land";
}

function terrainClassForElevation(latitudeDeg, elevationM) {
  if (Math.abs(latitudeDeg) > 75 && elevationM > -20) {
    return "ice";
  }
  if (elevationM <= -6000) {
    return "deep_ocean";
  }
  if (elevationM < -20) {
    return "ocean";
  }
  if (elevationM <= 20) {
    return "mixed";
  }
  if (elevationM >= 4500) {
    return "high_mountain";
  }
  if (elevationM >= 2000) {
    return "mountain";
  }
  if (elevationM >= 500) {
    return "hill";
  }
  return "plain";
}

function waterRatioForLandClass(landClass) {
  if (landClass === "ocean") {
    return 1;
  }
  if (landClass === "coast") {
    return 0.5;
  }
  if (landClass === "ice") {
    return 0.2;
  }
  return 0.05;
}

function surfaceHardnessForTerrain(terrainClass) {
  if (terrainClass === "deep_ocean" || terrainClass === "ocean") {
    return 0.05;
  }
  if (terrainClass === "ice") {
    return 0.25;
  }
  if (terrainClass === "plain" || terrainClass === "mixed") {
    return 0.55;
  }
  if (terrainClass === "hill") {
    return 0.65;
  }
  return 0.85;
}

function opennessForTerrain(terrainClass) {
  if (terrainClass === "deep_ocean" || terrainClass === "ocean") {
    return 1;
  }
  if (terrainClass === "high_mountain" || terrainClass === "mountain") {
    return 0.92;
  }
  if (terrainClass === "ice") {
    return 0.9;
  }
  if (terrainClass === "hill") {
    return 0.72;
  }
  return 0.55;
}

function centers(min, max, step) {
  const result = [];
  for (let value = min + step / 2; value < max; value += step) {
    result.push(roundCoord(value));
  }
  return result;
}

function formatCoord(value, axis) {
  const hemi = axis === "lat" ? (value < 0 ? "s" : "n") : value < 0 ? "w" : "e";
  return `${hemi}${Math.abs(value).toFixed(1).replace(".", "p")}`;
}

function roundCoord(value) {
  return Number(value.toFixed(6));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}

function decodePng(buffer) {
  const signature = buffer.subarray(0, 8);
  if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Terrain tile was not a PNG.");
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
    throw new Error(`Unsupported terrain PNG format: bitDepth=${bitDepth}, colorType=${colorType}.`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const bytesPerRow = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const data = Buffer.alloc(width * height * channels);
  let inOffset = 0;
  let outOffset = 0;
  let previousRow = Buffer.alloc(bytesPerRow);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inOffset];
    inOffset += 1;
    const row = Buffer.from(inflated.subarray(inOffset, inOffset + bytesPerRow));
    inOffset += bytesPerRow;
    unfilterRow(row, previousRow, filter, channels);
    row.copy(data, outOffset);
    outOffset += bytesPerRow;
    previousRow = row;
  }

  return { width, height, channels, data };
}

function unfilterRow(row, previousRow, filter, bytesPerPixel) {
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
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  return upDistance <= upLeftDistance ? up : upLeft;
}

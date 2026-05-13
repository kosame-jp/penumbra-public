import { degToRad } from "../scanline/geometry";

export type LandClass = "ocean" | "coast" | "land" | "ice";

export interface StatBlock {
  readonly min: number;
  readonly max: number;
  readonly p95?: number;
  readonly p99?: number;
  readonly p99_5?: number;
}

export interface WorldGridCell {
  readonly id: string;
  readonly latCenterDeg: number;
  readonly lonCenterDeg: number;
  readonly landClass: LandClass;
  readonly terrainClass?: string;
  readonly elevationM: number;
  readonly bathymetryM: number;
  readonly roadLengthKm: number;
  readonly buildingCount: number;
  readonly waterRatio: number;
  readonly forestRatio: number;
  readonly nightLightMean: number;
  readonly surfaceHardness01: number;
  readonly openness01: number;
  readonly notes?: string;
}

export interface WorldGrid {
  readonly version: string;
  readonly generatedAtUtc: string;
  readonly cellSizeDegrees: number;
  readonly sources?: Record<string, unknown>;
  readonly stats: {
    readonly nightLight: StatBlock;
    readonly roadLengthKm: StatBlock;
    readonly buildingCount: StatBlock;
    readonly waterRatio?: StatBlock;
    readonly forestRatio?: StatBlock;
    readonly elevationM: StatBlock;
    readonly bathymetryM: StatBlock;
  };
  readonly cells: readonly WorldGridCell[];
}

export type WorldGridLoadSource = "production" | "terrain-seed" | "fixture" | "custom";

export interface WorldGridLoadResult {
  readonly grid: WorldGrid;
  readonly source: WorldGridLoadSource;
}

export const DEFAULT_WORLDGRID_URL = "/data/worldgrid.production-seed.json";
export const VISUAL_SURFACE_WORLDGRID_URL = "/data/worldgrid.visual-surface-1deg.json";
export const CONTACT_WORLDGRID_URL = "/data/worldgrid.contact-1deg.json";
export const TERRAIN_SEED_WORLDGRID_URL = "/data/worldgrid.terrain-seed.json";
export const FIXTURE_WORLDGRID_URL = "/data/fixtures/worldgrid.sample.json";

export async function loadWorldGrid(url = DEFAULT_WORLDGRID_URL): Promise<WorldGrid> {
  return (await loadWorldGridResult(url)).grid;
}

export async function loadWorldGridResult(url = DEFAULT_WORLDGRID_URL): Promise<WorldGridLoadResult> {
  try {
    return {
      grid: parseLoadedWorldGrid(await loadJson<unknown>(url), url),
      source: url === DEFAULT_WORLDGRID_URL ? "production" : "custom",
    };
  } catch (error) {
    if (url !== DEFAULT_WORLDGRID_URL) {
      throw error;
    }

    console.warn(
      `Failed to load generated worldgrid ${DEFAULT_WORLDGRID_URL}; falling back to terrain seed worldgrid.`,
      error,
    );
    return loadTerrainSeedWorldGridResult();
  }
}

export async function loadVisualSurfaceWorldGrid(
  url = VISUAL_SURFACE_WORLDGRID_URL,
): Promise<WorldGrid | undefined> {
  try {
    return parseLoadedWorldGrid(await loadJson<unknown>(url), url);
  } catch (error) {
    console.warn(`Failed to load visual surface worldgrid ${url}; using canonical worldgrid surface.`, error);
    return undefined;
  }
}

export async function loadContactWorldGrid(url = CONTACT_WORLDGRID_URL): Promise<WorldGrid | undefined> {
  try {
    return parseLoadedWorldGrid(await loadJson<unknown>(url), url);
  } catch (error) {
    console.warn(`Failed to load contact worldgrid ${url}; using canonical worldgrid contacts.`, error);
    return undefined;
  }
}

async function loadTerrainSeedWorldGridResult(): Promise<WorldGridLoadResult> {
  try {
    return {
      grid: parseLoadedWorldGrid(
        await loadJson<unknown>(TERRAIN_SEED_WORLDGRID_URL),
        TERRAIN_SEED_WORLDGRID_URL,
      ),
      source: "terrain-seed",
    };
  } catch (error) {
    console.warn(
      `Failed to load terrain seed worldgrid ${TERRAIN_SEED_WORLDGRID_URL}; falling back to fixture worldgrid.`,
      error,
    );
    return {
      grid: parseLoadedWorldGrid(await loadJson<unknown>(FIXTURE_WORLDGRID_URL), FIXTURE_WORLDGRID_URL),
      source: "fixture",
    };
  }
}

export async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export function findNearestWorldGridCell(
  worldGrid: WorldGrid,
  latitudeDeg: number,
  longitudeDeg: number,
): WorldGridCell {
  if (worldGrid.cells.length === 0) {
    throw new Error("Worldgrid contains no cells.");
  }

  let nearest = worldGrid.cells[0];
  let nearestDistanceKm = haversineDistanceKm(
    latitudeDeg,
    longitudeDeg,
    nearest.latCenterDeg,
    nearest.lonCenterDeg,
  );

  for (const cell of worldGrid.cells.slice(1)) {
    const distanceKm = haversineDistanceKm(
      latitudeDeg,
      longitudeDeg,
      cell.latCenterDeg,
      cell.lonCenterDeg,
    );
    if (distanceKm < nearestDistanceKm) {
      nearest = cell;
      nearestDistanceKm = distanceKm;
    }
  }

  return nearest;
}

export function haversineDistanceKm(
  latADeg: number,
  lonADeg: number,
  latBDeg: number,
  lonBDeg: number,
): number {
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

function parseLoadedWorldGrid(data: unknown, sourceUrl: string): WorldGrid {
  assertWorldGridShape(data, sourceUrl);
  return data;
}

function assertWorldGridShape(data: unknown, sourceUrl: string): asserts data is WorldGrid {
  const artifact = requireRecord(data, `${sourceUrl} worldgrid`);
  requireString(artifact, "version", sourceUrl);
  requireString(artifact, "generatedAtUtc", sourceUrl);
  requireNumber(artifact, "cellSizeDegrees", sourceUrl);

  const stats = requireRecord(artifact.stats, `${sourceUrl}.stats`);
  requireStatBlock(stats.nightLight, `${sourceUrl}.stats.nightLight`);
  requireStatBlock(stats.roadLengthKm, `${sourceUrl}.stats.roadLengthKm`);
  requireStatBlock(stats.buildingCount, `${sourceUrl}.stats.buildingCount`);
  requireStatBlock(stats.elevationM, `${sourceUrl}.stats.elevationM`);
  requireStatBlock(stats.bathymetryM, `${sourceUrl}.stats.bathymetryM`);
  if (stats.waterRatio !== undefined) {
    requireStatBlock(stats.waterRatio, `${sourceUrl}.stats.waterRatio`);
  }
  if (stats.forestRatio !== undefined) {
    requireStatBlock(stats.forestRatio, `${sourceUrl}.stats.forestRatio`);
  }

  if (!Array.isArray(artifact.cells) || artifact.cells.length === 0) {
    throw new Error(`${sourceUrl} worldgrid must contain at least one cell.`);
  }

  artifact.cells.forEach((cell, index) => assertWorldGridCellShape(cell, `${sourceUrl}.cells[${index}]`));
}

function assertWorldGridCellShape(data: unknown, label: string): asserts data is WorldGridCell {
  const cell = requireRecord(data, label);
  requireString(cell, "id", label);
  requireNumber(cell, "latCenterDeg", label);
  requireNumber(cell, "lonCenterDeg", label);
  requireNumber(cell, "elevationM", label);
  requireNumber(cell, "bathymetryM", label);
  requireNumber(cell, "roadLengthKm", label);
  requireNumber(cell, "buildingCount", label);
  requireNumber(cell, "waterRatio", label);
  requireNumber(cell, "forestRatio", label);
  requireNumber(cell, "nightLightMean", label);
  requireNumber(cell, "surfaceHardness01", label);
  requireNumber(cell, "openness01", label);

  if (!isLandClass(cell.landClass)) {
    throw new Error(`${label}.landClass must be ocean, coast, land, or ice.`);
  }
  if (cell.terrainClass !== undefined && typeof cell.terrainClass !== "string") {
    throw new Error(`${label}.terrainClass must be a string when present.`);
  }
}

function requireStatBlock(data: unknown, label: string): asserts data is StatBlock {
  const block = requireRecord(data, label);
  requireNumber(block, "min", label);
  requireNumber(block, "max", label);
  requireOptionalNumber(block, "p95", label);
  requireOptionalNumber(block, "p99", label);
  requireOptionalNumber(block, "p99_5", label);
}

function requireRecord(data: unknown, label: string): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${label} must be an object.`);
  }
  return data as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, field: string, label: string): void {
  if (typeof record[field] !== "string") {
    throw new Error(`${label}.${field} must be a string.`);
  }
}

function requireNumber(record: Record<string, unknown>, field: string, label: string): void {
  if (typeof record[field] !== "number" || !Number.isFinite(record[field])) {
    throw new Error(`${label}.${field} must be a finite number.`);
  }
}

function requireOptionalNumber(record: Record<string, unknown>, field: string, label: string): void {
  if (record[field] !== undefined) {
    requireNumber(record, field, label);
  }
}

function isLandClass(value: unknown): value is LandClass {
  return value === "ocean" || value === "coast" || value === "land" || value === "ice";
}

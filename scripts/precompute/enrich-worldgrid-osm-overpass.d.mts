export type OverpassBbox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type OverpassSampleSummary = {
  bbox: OverpassBbox;
  bboxAreaKm2: number;
  roadLengthKm: number;
  buildingCount: number;
  forestAreaKm2: number;
};

export type OsmTargetCell = {
  id?: string;
  landClass?: string;
  nightLightMean: number;
};

export type OsmCellEstimateInput = {
  latCenterDeg: number;
  lonCenterDeg: number;
};

export type OsmEnrichmentOptions = {
  minNightLight: number;
  includeZeroNightlight: boolean;
  includeOcean: boolean;
  sampleGrid?: number;
  sampleRadiusDeg?: number;
  cellSizeDegrees?: number;
  timeoutSeconds?: number;
  requestTimeoutMs?: number;
  requestDelayMs?: number;
  densityReferenceAreaKm2?: number;
  retries?: number;
  endpoint?: string;
  cache?: string;
  dryRun?: boolean;
  generatedAtUtc?: string;
  maxCells?: number;
};

export type OsmDensityEstimate = {
  roadLengthKm: number;
  buildingCount: number;
  forestRatio: number;
  sampledAreaKm2: number;
  cellAreaKm2: number;
  sampleCount: number;
};

export function enrichWorldGridWithOsmDensity(
  worldGrid: unknown,
  options: OsmEnrichmentOptions,
  cache?: unknown,
): Promise<unknown>;

export function targetCells<T extends OsmTargetCell>(cells: T[], options: OsmEnrichmentOptions): T[];

export function summarizeCellFromOverpass(
  cell: unknown,
  options: OsmEnrichmentOptions,
  cache: unknown,
): Promise<OsmDensityEstimate>;

export function estimateCellDensity(
  cell: OsmCellEstimateInput,
  sampleSummaries: OverpassSampleSummary[],
  options?: Pick<OsmEnrichmentOptions, "densityReferenceAreaKm2">,
): OsmDensityEstimate;

export function sampleBboxesForCell(cell: OsmCellEstimateInput, options: OsmEnrichmentOptions): OverpassBbox[];

export function summarizeOverpassElements(elements: unknown[], bbox: OverpassBbox): OverpassSampleSummary;

export function overpassQueryForBbox(bbox: OverpassBbox, timeoutSeconds?: number): string;

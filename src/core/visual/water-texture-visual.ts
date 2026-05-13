import type {
  PenumbraDropletBand,
  PenumbraWaterTextureParams,
} from "../audio/penumbra-earth-texture-params";
import { hashUint32, hashUint32To01 } from "../audio/utc-event-field";
import { canonicalWaterDropletEventsInWindow } from "../audio/water-droplet-events";
import { sunriseLongitudeAtLatitude } from "../astronomy/terminator";
import { gaussianWeight } from "../scanline/gaussian";
import { clamp, normalizeDegrees180 } from "../scanline/geometry";
import { createScanlineState, type ScanlineState } from "../scanline/scanline-state";
import type { WorldGrid, WorldGridCell } from "../static-data/worldgrid-loader";

export interface WaterTextureVisualParticle {
  readonly eventId: string;
  readonly band: Extract<PenumbraDropletBand, "low" | "mid">;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly radius: number;
  readonly strength01: number;
  readonly age01: number;
  readonly sizeScale01: number;
}

export interface WaterTextureVisualSummary {
  readonly lowCount: number;
  readonly midCount: number;
  readonly lowCandidateCount: number;
  readonly midCandidateCount: number;
}

interface WaterTextureVisualCandidate {
  readonly id: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly scanlineWeight: number;
  readonly lowWeight: number;
  readonly midWeight: number;
}

interface WaterTextureGridIndex {
  readonly cellSizeDeg: number;
  readonly latCount: number;
  readonly lonCount: number;
  readonly cellsByIndex: ReadonlyMap<string, WorldGridCell>;
}

interface WaterTextureVisualCandidateSetCacheEntry {
  readonly epochMs: number;
  readonly candidates: readonly WaterTextureVisualCandidate[];
}

interface MutableCandidate {
  id: string;
  latitudeDeg: number;
  longitudeDeg: number;
  scanlineWeight: number;
  lowWeight: number;
  midWeight: number;
}

const WATER_TEXTURE_VISUAL_RADIUS = 1.012;
const WATER_TEXTURE_VISUAL_LOW_LIFETIME_MS = 18_000;
const WATER_TEXTURE_VISUAL_MID_LIFETIME_MS = 12_000;
const WATER_TEXTURE_VISUAL_MAX_PARTICLES = 128;
const WATER_TEXTURE_VISUAL_MIN_WEIGHT = 0.01;
const WATER_TEXTURE_VISUAL_SCANLINE_STEP_MIN_DEG = 1;
const WATER_TEXTURE_VISUAL_SCANLINE_STEP_MAX_DEG = 2;
const WATER_TEXTURE_VISUAL_EVENT_CANDIDATE_CACHE_MAX_AGE_MS =
  Math.max(WATER_TEXTURE_VISUAL_LOW_LIFETIME_MS, WATER_TEXTURE_VISUAL_MID_LIFETIME_MS) + 60_000;

const waterGridIndexCache = new WeakMap<WorldGrid, WaterTextureGridIndex>();
const waterVisualCandidateSetCache = new WeakMap<
  WorldGrid,
  Map<string, WaterTextureVisualCandidateSetCacheEntry>
>();

export function waterTextureVisualParticles(input: {
  readonly worldGrid: WorldGrid;
  readonly scanlineState: ScanlineState;
  readonly water: PenumbraWaterTextureParams;
}): {
  readonly particles: readonly WaterTextureVisualParticle[];
  readonly summary: WaterTextureVisualSummary;
} {
  const candidates = waterTextureVisualCandidates(input.worldGrid, input.scanlineState);
  const lowCandidates = candidates.filter((candidate) => candidate.lowWeight > WATER_TEXTURE_VISUAL_MIN_WEIGHT);
  const midCandidates = candidates.filter((candidate) => candidate.midWeight > WATER_TEXTURE_VISUAL_MIN_WEIGHT);
  const particles = [
    ...particlesForBand({
      band: "low",
      worldGrid: input.worldGrid,
      scanlineState: input.scanlineState,
      densityHz: input.water.lowDensityHz,
      level01: input.water.lowLevel01,
      epochMs: input.scanlineState.utc.epochMs,
      lifetimeMs: WATER_TEXTURE_VISUAL_LOW_LIFETIME_MS,
    }),
    ...particlesForBand({
      band: "mid",
      worldGrid: input.worldGrid,
      scanlineState: input.scanlineState,
      densityHz: input.water.midDensityHz,
      level01: input.water.midLevel01,
      epochMs: input.scanlineState.utc.epochMs,
      lifetimeMs: WATER_TEXTURE_VISUAL_MID_LIFETIME_MS,
    }),
  ]
    .sort((left, right) => right.strength01 - left.strength01)
    .slice(0, WATER_TEXTURE_VISUAL_MAX_PARTICLES);

  return {
    particles,
    summary: {
      lowCount: particles.filter((particle) => particle.band === "low").length,
      midCount: particles.filter((particle) => particle.band === "mid").length,
      lowCandidateCount: lowCandidates.length,
      midCandidateCount: midCandidates.length,
    },
  };
}

function particlesForBand(input: {
  readonly band: Extract<PenumbraDropletBand, "low" | "mid">;
  readonly worldGrid: WorldGrid;
  readonly scanlineState: ScanlineState;
  readonly densityHz: number;
  readonly level01: number;
  readonly epochMs: number;
  readonly lifetimeMs: number;
}): WaterTextureVisualParticle[] {
  if (input.densityHz <= 0.05 || input.level01 <= 0.01) {
    return [];
  }

  const events = canonicalWaterDropletEventsInWindow({
    band: input.band,
    densityHz: input.densityHz,
    level01: input.level01,
    windowStartUtcMs: input.epochMs - input.lifetimeMs,
    windowEndUtcMs: input.epochMs,
  });
  const particles: WaterTextureVisualParticle[] = [];

  for (const event of events) {
    const ageMs = input.epochMs - event.scheduledUtcMs;
    const age01 = clamp(ageMs / input.lifetimeMs, 0, 1);
    const eventCandidates = waterTextureVisualCandidatesForEvent(
      input.worldGrid,
      input.scanlineState,
      event.scheduledUtcMs,
    ).filter(
      (candidate) => waterCandidateBandWeight(candidate, input.band) > WATER_TEXTURE_VISUAL_MIN_WEIGHT,
    );
    const totalWeight = eventCandidates.reduce(
      (sum, candidate) => sum + waterCandidateBandWeight(candidate, input.band),
      0,
    );
    if (totalWeight <= 0) {
      continue;
    }

    const candidate = weightedCandidateAt(
      eventCandidates,
      totalWeight,
      input.band,
      hashUint32To01(event.randomSeed ^ 0x7f4a7c15),
    );
    if (!candidate) {
      continue;
    }

    particles.push(waterParticleForEvent({
      band: input.band,
      candidate,
      eventId: `${input.band}:${event.slotIndex}`,
      randomSeed: event.randomSeed,
      velocity01: event.velocity01,
      age01,
    }));
  }

  return particles;
}

function waterTextureVisualCandidatesForEvent(
  worldGrid: WorldGrid,
  scanlineState: ScanlineState,
  scheduledUtcMs: number,
): readonly WaterTextureVisualCandidate[] {
  const cache = waterVisualCandidateSetCacheForGrid(worldGrid);
  pruneWaterTextureVisualCandidateCache(cache, scanlineState.utc.epochMs);

  const cacheKey = [
    Math.round(scheduledUtcMs),
    scanlineState.sigmaDeg.toFixed(4),
    scanlineState.latitudeStepDeg.toFixed(4),
  ].join(":");
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached.candidates;
  }

  const eventScanlineState = createScanlineState(new Date(scheduledUtcMs), {
    sigmaDeg: scanlineState.sigmaDeg,
    latitudeStepDeg: scanlineState.latitudeStepDeg,
  });
  const candidates = waterTextureVisualCandidates(worldGrid, eventScanlineState);
  cache.set(cacheKey, { epochMs: scheduledUtcMs, candidates });
  return candidates;
}

function waterTextureVisualCandidates(
  worldGrid: WorldGrid,
  scanlineState: ScanlineState,
): readonly WaterTextureVisualCandidate[] {
  const index = waterGridIndex(worldGrid);
  const stepDeg = clamp(
    worldGrid.cellSizeDegrees || 1,
    WATER_TEXTURE_VISUAL_SCANLINE_STEP_MIN_DEG,
    WATER_TEXTURE_VISUAL_SCANLINE_STEP_MAX_DEG,
  );
  const candidatesById = new Map<string, MutableCandidate>();

  for (let latitudeDeg = -90; latitudeDeg <= 90.0001; latitudeDeg += stepDeg) {
    const terminator = sunriseLongitudeAtLatitude(latitudeDeg, scanlineState.solar);
    if (terminator.sunriseLongitudeDeg == null) {
      continue;
    }

    for (
      let offsetDeg = -scanlineState.activeReachDeg;
      offsetDeg <= scanlineState.activeReachDeg + 0.0001;
      offsetDeg += stepDeg
    ) {
      const scanlineWeight = gaussianWeight(offsetDeg, scanlineState.sigmaDeg);
      if (scanlineWeight <= 0.004) {
        continue;
      }

      const longitudeDeg = normalizeDegrees180(terminator.sunriseLongitudeDeg + offsetDeg);
      const cell = waterGridCellAt(index, latitudeDeg, longitudeDeg);
      if (!cell) {
        continue;
      }

      const depth01 = oceanDepth01ForCell(cell, worldGrid);
      const waterRatio01 = clamp(cell.waterRatio, 0, 1);
      const lowWeight = scanlineWeight * Math.pow(depth01, 0.58);
      const midWeight = scanlineWeight * Math.pow(waterRatio01, 0.68);
      if (lowWeight <= WATER_TEXTURE_VISUAL_MIN_WEIGHT && midWeight <= WATER_TEXTURE_VISUAL_MIN_WEIGHT) {
        continue;
      }

      const existing = candidatesById.get(cell.id);
      if (existing) {
        existing.scanlineWeight = Math.max(existing.scanlineWeight, scanlineWeight);
        existing.lowWeight = Math.max(existing.lowWeight, lowWeight);
        existing.midWeight = Math.max(existing.midWeight, midWeight);
        continue;
      }

      candidatesById.set(cell.id, {
        id: cell.id,
        latitudeDeg: cell.latCenterDeg,
        longitudeDeg: cell.lonCenterDeg,
        scanlineWeight,
        lowWeight,
        midWeight,
      });
    }
  }

  return Array.from(candidatesById.values());
}

function waterVisualCandidateSetCacheForGrid(
  worldGrid: WorldGrid,
): Map<string, WaterTextureVisualCandidateSetCacheEntry> {
  const cached = waterVisualCandidateSetCache.get(worldGrid);
  if (cached) {
    return cached;
  }

  const cache = new Map<string, WaterTextureVisualCandidateSetCacheEntry>();
  waterVisualCandidateSetCache.set(worldGrid, cache);
  return cache;
}

function pruneWaterTextureVisualCandidateCache(
  cache: Map<string, WaterTextureVisualCandidateSetCacheEntry>,
  epochMs: number,
): void {
  const minEpochMs = epochMs - WATER_TEXTURE_VISUAL_EVENT_CANDIDATE_CACHE_MAX_AGE_MS;
  for (const [key, entry] of cache) {
    if (entry.epochMs < minEpochMs || entry.epochMs > epochMs + 30_000) {
      cache.delete(key);
    }
  }
}

function waterGridIndex(worldGrid: WorldGrid): WaterTextureGridIndex {
  const cached = waterGridIndexCache.get(worldGrid);
  if (cached) {
    return cached;
  }

  const cellSizeDeg = Math.max(0.0001, worldGrid.cellSizeDegrees || 1);
  const latCount = Math.max(1, Math.round(180 / cellSizeDeg));
  const lonCount = Math.max(1, Math.round(360 / cellSizeDeg));
  const cellsByIndex = new Map<string, WorldGridCell>();

  for (const cell of worldGrid.cells) {
    cellsByIndex.set(
      waterGridKey(
        clamp(Math.floor((cell.latCenterDeg + 90) / cellSizeDeg), 0, latCount - 1),
        wrapIndex(Math.floor((normalizeDegrees180(cell.lonCenterDeg) + 180) / cellSizeDeg), lonCount),
      ),
      cell,
    );
  }

  const index = { cellSizeDeg, latCount, lonCount, cellsByIndex };
  waterGridIndexCache.set(worldGrid, index);
  return index;
}

function waterGridCellAt(
  index: WaterTextureGridIndex,
  latitudeDeg: number,
  longitudeDeg: number,
): WorldGridCell | undefined {
  const latIndex = clamp(
    Math.floor((latitudeDeg + 90) / index.cellSizeDeg),
    0,
    index.latCount - 1,
  );
  const lonIndex = wrapIndex(
    Math.floor((normalizeDegrees180(longitudeDeg) + 180) / index.cellSizeDeg),
    index.lonCount,
  );
  return index.cellsByIndex.get(waterGridKey(latIndex, lonIndex));
}

function waterGridKey(latIndex: number, lonIndex: number): string {
  return `${latIndex}:${lonIndex}`;
}

function waterCandidateBandWeight(
  candidate: WaterTextureVisualCandidate,
  band: Extract<PenumbraDropletBand, "low" | "mid">,
): number {
  return band === "low" ? candidate.lowWeight : candidate.midWeight;
}

function weightedCandidateAt(
  candidates: readonly WaterTextureVisualCandidate[],
  totalWeight: number,
  band: Extract<PenumbraDropletBand, "low" | "mid">,
  selector01: number,
): WaterTextureVisualCandidate | undefined {
  const target = clamp(selector01, 0, 0.999999) * totalWeight;
  let cursor = 0;

  for (const candidate of candidates) {
    cursor += waterCandidateBandWeight(candidate, band);
    if (target <= cursor) {
      return candidate;
    }
  }

  return candidates.at(-1);
}

function waterParticleForEvent(input: {
  readonly eventId: string;
  readonly band: Extract<PenumbraDropletBand, "low" | "mid">;
  readonly candidate: WaterTextureVisualCandidate;
  readonly randomSeed: number;
  readonly velocity01: number;
  readonly age01: number;
}): WaterTextureVisualParticle {
  const materialSeed = hashUint32(`water-visual:${input.band}:${input.candidate.id}:${input.randomSeed}`);
  const angle = hashUint32To01(materialSeed ^ 0x85ebca6b) * Math.PI * 2;
  const distance01 = Math.sqrt(hashUint32To01(materialSeed ^ 0xc2b2ae35));
  const spreadDeg = input.band === "low" ? 1.15 : 0.62;
  const latJitter = Math.sin(angle) * distance01 * spreadDeg;
  const lonJitter =
    (Math.cos(angle) * distance01 * spreadDeg) /
    Math.max(0.22, Math.cos((input.candidate.latitudeDeg * Math.PI) / 180));
  const eventStrength01 = clamp(
    input.velocity01 * (0.52 + input.candidate.scanlineWeight * 0.48),
    0,
    1,
  );

  return {
    eventId: input.eventId,
    band: input.band,
    latitudeDeg: clamp(input.candidate.latitudeDeg + latJitter, -89.8, 89.8),
    longitudeDeg: normalizeDegrees180(input.candidate.longitudeDeg + lonJitter),
    radius: WATER_TEXTURE_VISUAL_RADIUS,
    strength01: eventStrength01,
    age01: input.age01,
    sizeScale01: waterRippleSizeScale(input.band, input.age01),
  };
}

function waterRippleSizeScale(
  band: Extract<PenumbraDropletBand, "low" | "mid">,
  age01: number,
): number {
  const age = clamp(age01, 0, 1);
  const expansion01 = 1 - Math.pow(1 - age, band === "low" ? 0.72 : 0.78);
  return band === "low"
    ? 0.08 + expansion01 * 3.02
    : 0.07 + expansion01 * 2.28;
}

function oceanDepth01ForCell(cell: WorldGridCell, worldGrid: WorldGrid): number {
  if (cell.bathymetryM >= 0 && cell.landClass !== "ocean") {
    return 0;
  }

  const maxDepthM = Math.max(
    1,
    Math.abs(Math.min(worldGrid.stats.bathymetryM.min, -1)),
  );
  return clamp(Math.abs(Math.min(cell.bathymetryM, 0)) / maxDepthM, 0, 1);
}

function wrapIndex(value: number, size: number): number {
  return ((value % size) + size) % size;
}

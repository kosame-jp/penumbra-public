/* global console */
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

export const DEFAULT_CLOUD_FORECAST_TRANSITION_DURATION_MINUTES = 20;

export async function publishCloudAtlasForecastArtifacts(options) {
  const {
    outputDir,
    generatedAtUtc,
    resolutionDeg,
    width,
    height,
    source,
    frameVersion,
    manifestVersion,
    frames: frameInputs,
    atomicPublish = false,
    retainGenerations = 0,
    quiet = false,
  } = options;
  const framePrefix = atomicPublish ? cloudAtlasFramePrefix(generatedAtUtc) : "";
  await mkdir(outputDir, { recursive: true });

  const frames = [];
  for (const frame of frameInputs) {
    const label = frame.label ?? `f${String(frame.forecastHour ?? frames.length).padStart(3, "0")}`;
    const fileName = atomicPublish ? `${framePrefix}-${label}.json` : `${label}.json`;
    const artifact = createCloudAtlasFrameArtifact({
      version: frameVersion,
      generatedAtUtc,
      validAtUtc: frame.validAtUtc,
      resolutionDeg,
      width,
      height,
      source: {
        kind: source.kind,
        model: source.model,
        forecastHour: frame.forecastHour,
        provenance: frame.provenance ?? source.frameProvenance ?? source.provenance,
      },
      values: frame.values,
      opticalDensityValues: frame.opticalDensityValues,
      precipitationValues: frame.precipitationValues,
    });
    await writeJsonArtifact(outputDir, fileName, artifact, { atomic: atomicPublish });
    frames.push({
      url: fileName,
      validAtUtc: frame.validAtUtc,
      forecastHour: frame.forecastHour,
      label,
    });
  }

  const manifest = {
    version: manifestVersion,
    generatedAtUtc,
    activeCycleUtc: frames[0]?.validAtUtc ?? generatedAtUtc,
    transitionDurationMinutes:
      options.transitionDurationMinutes ?? DEFAULT_CLOUD_FORECAST_TRANSITION_DURATION_MINUTES,
    interpolation: "linear-time",
    source: {
      ...source.manifestMetadata,
      kind: source.kind,
      model: source.model,
      provenance: source.provenance,
      forecastHours: frameInputs.map((frame) => frame.forecastHour).filter((hour) => hour !== undefined),
      frameUrlMode: atomicPublish ? "versioned" : "stable",
    },
    frames,
  };

  await writeJsonArtifact(outputDir, "manifest.json", manifest, { atomic: atomicPublish });
  if (atomicPublish && retainGenerations > 0) {
    await pruneVersionedForecastFrames(outputDir, retainGenerations, framePrefix);
  }
  if (!quiet) {
    const publishMode = atomicPublish ? "atomic versioned frames" : "stable frame names";
    console.log(`Wrote ${outputDir}/manifest.json (${frames.length} frames, ${publishMode})`);
  }

  return { manifest, frames };
}

export function createCloudAtlasFrameArtifact(options) {
  const artifact = {
    version: options.version,
    generatedAtUtc: options.generatedAtUtc,
    validAtUtc: options.validAtUtc,
    resolutionDeg: options.resolutionDeg,
    width: options.width,
    height: options.height,
    latitudeStartDeg: -90,
    longitudeStartDeg: -180,
    valuesEncoding: "uint8-cloud-cover-pct",
    opticalDensityValuesEncoding: options.opticalDensityValues === undefined
      ? undefined
      : "uint8-cloud-water-density-proxy-pct",
    precipitationValuesEncoding: options.precipitationValues === undefined
      ? undefined
      : "uint8-precipitation-activity-pct",
    source: removeUndefinedFields(options.source),
    values: options.values,
    opticalDensityValues: options.opticalDensityValues,
    precipitationValues: options.precipitationValues,
  };
  return removeUndefinedFields(artifact);
}

export async function writeJsonArtifact(outputDir, fileName, data, options = {}) {
  const outputPath = join(outputDir, fileName);
  const payload = `${JSON.stringify(data)}\n`;
  if (options.atomic !== true) {
    await writeFile(outputPath, payload, "utf8");
    return;
  }

  const tempPath = join(outputDir, `.${fileName}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, payload, "utf8");
  await rename(tempPath, outputPath);
}

export function cloudAtlasFramePrefix(generatedAtUtc) {
  return generatedAtUtc.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function pruneVersionedForecastFrames(outputDir, retainGenerations, currentPrefix) {
  const entries = await readdir(outputDir);
  const generationPrefixes = Array.from(
    new Set(
      entries
        .map((entry) => versionedForecastFramePrefix(entry))
        .filter((prefix) => prefix !== undefined),
    ),
  ).sort();
  const keepPrefixes = new Set(generationPrefixes.slice(-retainGenerations));
  keepPrefixes.add(currentPrefix);

  await Promise.all(
    entries.map(async (entry) => {
      const prefix = versionedForecastFramePrefix(entry);
      if (!prefix || keepPrefixes.has(prefix)) {
        return;
      }
      await rm(join(outputDir, entry), { force: true });
    }),
  );
}

export function versionedForecastFramePrefix(fileName) {
  const match = /^(\d{8}T\d{6}Z)-f\d{3}\.json$/.exec(fileName);
  return match?.[1];
}

function removeUndefinedFields(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

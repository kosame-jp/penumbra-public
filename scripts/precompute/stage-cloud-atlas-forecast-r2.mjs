/* global console */
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import process from "node:process";

const DEFAULT_INPUT_DIR = "public/data/cloud-atlas.forecast";
const DEFAULT_OUTPUT_DIR = ".tmp/cloud-atlas.forecast-r2";
const DEFAULT_RETAIN_GENERATIONS = 8;
const VERSIONED_FRAME_RE = /^\d{8}T\d{6}Z-f\d{3}\.json$/;
const VERSIONED_FRAME_PREFIX_RE = /^(\d{8}T\d{6}Z)-f\d{3}\.json$/;

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await stageCloudAtlasForecastForR2(options);
}

export async function stageCloudAtlasForecastForR2(options = {}) {
  const inputDir = options.inputDir ?? DEFAULT_INPUT_DIR;
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const retainGenerations = Math.max(
    1,
    Number.isFinite(options.retainGenerations) ? options.retainGenerations : DEFAULT_RETAIN_GENERATIONS,
  );
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const entries = await readdir(inputDir);
  const versionedFrames = retainedVersionedFrames(entries, retainGenerations);
  if (versionedFrames.length === 0) {
    throw new Error(`${inputDir} does not contain versioned cloud forecast frames.`);
  }
  if (!entries.includes("manifest.json")) {
    throw new Error(`${inputDir}/manifest.json is required.`);
  }

  await cp(join(inputDir, "manifest.json"), join(outputDir, "manifest.json"));
  await Promise.all(
    versionedFrames.map((entry) => cp(join(inputDir, entry), join(outputDir, basename(entry)))),
  );

  console.log(
    `staged ${versionedFrames.length} cloud forecast frames ` +
      `(${retainGenerations} generations max) for R2 at ${outputDir}`,
  );
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--input-dir":
        options.inputDir = requireValue(args, index, arg);
        index += 1;
        break;
      case "--output-dir":
        options.outputDir = requireValue(args, index, arg);
        index += 1;
        break;
      case "--retain-generations":
        options.retainGenerations = Number(requireValue(args, index, arg));
        index += 1;
        break;
      default:
        throw new Error(`Unknown option ${arg}`);
    }
  }
  return options;
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function retainedVersionedFrames(entries, retainGenerations) {
  const prefixes = Array.from(
    new Set(
      entries
        .map((entry) => VERSIONED_FRAME_PREFIX_RE.exec(entry)?.[1])
        .filter((prefix) => prefix !== undefined),
    ),
  ).sort();
  const keepPrefixes = new Set(prefixes.slice(-retainGenerations));
  return entries
    .filter((entry) => VERSIONED_FRAME_RE.test(entry))
    .filter((entry) => keepPrefixes.has(VERSIONED_FRAME_PREFIX_RE.exec(entry)?.[1]))
    .sort();
}

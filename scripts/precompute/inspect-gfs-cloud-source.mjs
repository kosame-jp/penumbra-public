#!/usr/bin/env node
/* global console */
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  DEFAULT_GFS_AWS_BASE_URL,
  DEFAULT_GFS_CYCLE_LATENCY_HOURS,
  fetchGfsCloudCoverSequencePlan,
  latestAvailableGfsCycle,
} from "./gfs-cloud-source.mjs";

if (isMainModule()) {
  const options = parseArgs(process.argv.slice(2));
  const result = await inspectGfsCloudSource(options);
  if (options.json === true) {
    console.log(JSON.stringify(result, null, 2));
  } else if (options.quiet !== true) {
    printHumanReadablePlan(result);
  }
}

export async function inspectGfsCloudSource(options = {}) {
  const cycle =
    options.date === undefined || options.cycleHour === undefined
      ? latestAvailableGfsCycle(options.nowUtcMs, options.latencyHours ?? DEFAULT_GFS_CYCLE_LATENCY_HOURS)
      : { date: options.date, cycleHour: options.cycleHour };

  return fetchGfsCloudCoverSequencePlan({
    date: cycle.date,
    cycleHour: cycle.cycleHour,
    forecastHours: options.forecastHours ?? [0, 3, 6, 9, 12, 15],
    baseUrl: options.baseUrl ?? DEFAULT_GFS_AWS_BASE_URL,
    fetchText: options.fetchText,
  });
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
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
      case "--json":
        options.json = true;
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

function printHumanReadablePlan(result) {
  console.log(`GFS cloud source ${result.date} ${String(result.cycleHour).padStart(2, "0")}z`);
  for (const plan of result.plans) {
    const byteLength = plan.byteLength === undefined ? "unknown" : `${plan.byteLength} bytes`;
    const precipitationByteLength =
      plan.precipitationByteLength === undefined ? "unknown" : `${plan.precipitationByteLength} bytes`;
    console.log(
      `  f${String(plan.forecastHour).padStart(3, "0")} ${plan.validAtUtc} ${plan.byteRangeHeader} ${byteLength}`,
    );
    console.log(`    prate ${plan.precipitationByteRangeHeader} ${precipitationByteLength}`);
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/precompute/inspect-gfs-cloud-source.mjs [options]

Options:
  --date <YYYYMMDD>           GFS cycle date. Default: latest available cycle by UTC latency.
  --cycle <00|06|12|18>       GFS cycle hour. Default: latest available cycle by UTC latency.
  --forecast-hours <csv>      Forecast hour offsets. Default: 0,3,6,9,12,15
  --base-url <url>            GFS object base URL. Default: ${DEFAULT_GFS_AWS_BASE_URL}
  --latency-hours <hours>     Cycle availability lag for automatic cycle selection. Default: ${DEFAULT_GFS_CYCLE_LATENCY_HOURS}
  --json                      Print the complete source plan as JSON.
  --quiet                     Fetch and validate without printing the human-readable plan.
`);
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

/* global fetch */

export const DEFAULT_GFS_AWS_BASE_URL = "https://noaa-gfs-bdp-pds.s3.amazonaws.com";
export const DEFAULT_GFS_CYCLE_LATENCY_HOURS = 5;
export const GFS_CYCLE_HOURS = [0, 6, 12, 18];
export const GFS_TOTAL_CLOUD_COVER_VARIABLE = "TCDC";
export const GFS_TOTAL_CLOUD_COVER_LEVEL = "entire atmosphere";
export const GFS_CLOUD_WATER_VARIABLE = "CWAT";
export const GFS_CLOUD_WATER_LEVEL = "entire atmosphere (considered as a single layer)";
export const GFS_PRECIPITATION_RATE_VARIABLE = "PRATE";
export const GFS_PRECIPITATION_RATE_LEVEL = "surface";

export function latestAvailableGfsCycle(nowUtcMs = Date.now(), latencyHours = DEFAULT_GFS_CYCLE_LATENCY_HOURS) {
  const targetUtcMs = nowUtcMs - Math.max(0, Number(latencyHours)) * 60 * 60 * 1000;
  const target = new Date(targetUtcMs);
  const cycleHour = Math.floor(target.getUTCHours() / 6) * 6;
  return {
    date: formatUtcDate(target),
    cycleHour,
  };
}

export function gfsAtmosObjectKey(options) {
  const date = validateGfsDate(options.date);
  const cycle = formatGfsCycle(options.cycleHour);
  const forecastHour = formatGfsForecastHour(options.forecastHour);
  const product = options.product ?? "pgrb2.0p25";
  return `gfs.${date}/${cycle}/atmos/gfs.t${cycle}z.${product}.f${forecastHour}`;
}

export function gfsAtmosIndexObjectKey(options) {
  return `${gfsAtmosObjectKey(options)}.idx`;
}

export function gfsAtmosUrl(options) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_GFS_AWS_BASE_URL);
  return `${baseUrl}/${gfsAtmosObjectKey(options)}`;
}

export function gfsAtmosIndexUrl(options) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_GFS_AWS_BASE_URL);
  return `${baseUrl}/${gfsAtmosIndexObjectKey(options)}`;
}

export function gfsValidAtUtc(options) {
  const { year, monthIndex, day } = parseGfsDate(validateGfsDate(options.date));
  const cycleHour = validateGfsCycleHour(options.cycleHour);
  const forecastHour = validateGfsForecastHour(options.forecastHour);
  return new Date(Date.UTC(year, monthIndex, day, cycleHour + forecastHour)).toISOString();
}

export function parseGfsIndex(indexText, source = "GFS index") {
  if (typeof indexText !== "string" || indexText.trim() === "") {
    throw new Error(`${source} is empty.`);
  }
  const messages = [];
  const lines = indexText.split(/\r?\n/);

  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    const parts = line.split(":");
    if (parts.length < 6) {
      throw new Error(`${source} line ${lineIndex + 1} is not a recognized wgrib2 index line.`);
    }

    const messageNumber = Number(parts[0]);
    const byteOffset = Number(parts[1]);
    if (!Number.isInteger(messageNumber) || messageNumber < 1) {
      throw new Error(`${source} line ${lineIndex + 1} has invalid message number "${parts[0]}".`);
    }
    if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) {
      throw new Error(`${source} line ${lineIndex + 1} has invalid byte offset "${parts[1]}".`);
    }

    messages.push({
      messageNumber,
      byteOffset,
      dateCycle: parts[2]?.replace(/^d=/, "") ?? "",
      variable: parts[3] ?? "",
      level: parts[4] ?? "",
      forecastLabel: parts.slice(5).filter((part, index, array) => !(index === array.length - 1 && part === "")).join(":"),
      raw: line,
    });
  }

  if (messages.length === 0) {
    throw new Error(`${source} does not contain any messages.`);
  }

  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index];
    const next = messages[index + 1];
    if (next !== undefined) {
      if (next.byteOffset <= current.byteOffset) {
        throw new Error(`${source} byte offsets must be strictly increasing near message ${current.messageNumber}.`);
      }
      current.nextByteOffset = next.byteOffset;
      current.byteLength = next.byteOffset - current.byteOffset;
      current.byteRangeHeader = gfsMessageByteRangeHeader(current);
    } else {
      current.byteRangeHeader = gfsMessageByteRangeHeader(current);
    }
  }

  return messages;
}

export function findGfsTotalCloudCoverMessage(messages, options = {}) {
  return findGfsAtmosMessage(messages, {
    ...options,
    variable: GFS_TOTAL_CLOUD_COVER_VARIABLE,
    level: GFS_TOTAL_CLOUD_COVER_LEVEL,
  });
}

export function findGfsCloudWaterMessage(messages, options = {}) {
  return findGfsAtmosMessage(messages, {
    ...options,
    variable: GFS_CLOUD_WATER_VARIABLE,
    level: GFS_CLOUD_WATER_LEVEL,
  });
}

export function findGfsPrecipitationRateMessage(messages, options = {}) {
  return findGfsAtmosMessage(messages, {
    ...options,
    variable: GFS_PRECIPITATION_RATE_VARIABLE,
    level: GFS_PRECIPITATION_RATE_LEVEL,
  });
}

function findGfsAtmosMessage(messages, options) {
  const forecastHour =
    options.forecastHour === undefined ? undefined : validateGfsForecastHour(options.forecastHour);
  const { variable, level } = options;
  const candidates = messages.filter(
    (message) =>
      message.variable === variable && message.level === level,
  );
  if (candidates.length === 0) {
    throw new Error(`GFS index does not contain ${variable}:${level}.`);
  }

  if (forecastHour !== undefined) {
    const preferredLabel = forecastHour === 0 ? "anl" : `${forecastHour} hour fcst`;
    const exact = candidates.find((message) => message.forecastLabel === preferredLabel);
    if (exact !== undefined) {
      return exact;
    }
  }

  const instantaneous = candidates.find((message) => isInstantaneousCloudCoverLabel(message.forecastLabel));
  if (instantaneous !== undefined) {
    return instantaneous;
  }

  const nonAverage = candidates.find((message) => !/\bave\b/i.test(message.forecastLabel));
  return nonAverage ?? candidates[0];
}

export function planGfsCloudCoverFrameFromIndex(options) {
  const indexUrl = gfsAtmosIndexUrl(options);
  const gribUrl = gfsAtmosUrl(options);
  const messages = parseGfsIndex(options.indexText, indexUrl);
  const message = findGfsTotalCloudCoverMessage(messages, { forecastHour: options.forecastHour });
  const cloudWaterMessage = findGfsCloudWaterMessage(messages, { forecastHour: options.forecastHour });
  const precipitationMessage = findGfsPrecipitationRateMessage(messages, { forecastHour: options.forecastHour });
  return {
    date: validateGfsDate(options.date),
    cycleHour: validateGfsCycleHour(options.cycleHour),
    forecastHour: validateGfsForecastHour(options.forecastHour),
    validAtUtc: gfsValidAtUtc(options),
    sourceKey: gfsAtmosObjectKey(options),
    indexKey: gfsAtmosIndexObjectKey(options),
    gribUrl,
    indexUrl,
    byteRangeHeader: gfsMessageByteRangeHeader(message),
    byteLength: message.byteLength,
    message: {
      messageNumber: message.messageNumber,
      byteOffset: message.byteOffset,
      nextByteOffset: message.nextByteOffset,
      dateCycle: message.dateCycle,
      variable: message.variable,
      level: message.level,
      forecastLabel: message.forecastLabel,
      raw: message.raw,
    },
    cloudWaterByteRangeHeader: gfsMessageByteRangeHeader(cloudWaterMessage),
    cloudWaterByteLength: cloudWaterMessage.byteLength,
    cloudWaterMessage: {
      messageNumber: cloudWaterMessage.messageNumber,
      byteOffset: cloudWaterMessage.byteOffset,
      nextByteOffset: cloudWaterMessage.nextByteOffset,
      dateCycle: cloudWaterMessage.dateCycle,
      variable: cloudWaterMessage.variable,
      level: cloudWaterMessage.level,
      forecastLabel: cloudWaterMessage.forecastLabel,
      raw: cloudWaterMessage.raw,
    },
    precipitationByteRangeHeader: gfsMessageByteRangeHeader(precipitationMessage),
    precipitationByteLength: precipitationMessage.byteLength,
    precipitationMessage: {
      messageNumber: precipitationMessage.messageNumber,
      byteOffset: precipitationMessage.byteOffset,
      nextByteOffset: precipitationMessage.nextByteOffset,
      dateCycle: precipitationMessage.dateCycle,
      variable: precipitationMessage.variable,
      level: precipitationMessage.level,
      forecastLabel: precipitationMessage.forecastLabel,
      raw: precipitationMessage.raw,
    },
  };
}

export async function fetchGfsCloudCoverFramePlan(options) {
  const fetchText = options.fetchText ?? fetchTextFromNetwork;
  const indexUrl = gfsAtmosIndexUrl(options);
  const indexText = await fetchText(indexUrl);
  return planGfsCloudCoverFrameFromIndex({ ...options, indexText });
}

export async function fetchGfsCloudCoverSequencePlan(options = {}) {
  const cycle = options.date === undefined || options.cycleHour === undefined
    ? latestAvailableGfsCycle(options.nowUtcMs, options.latencyHours)
    : { date: options.date, cycleHour: options.cycleHour };
  const forecastHours = options.forecastHours ?? [0, 3, 6, 9];
  const plans = [];
  for (const forecastHour of forecastHours) {
    plans.push(
      await fetchGfsCloudCoverFramePlan({
        date: cycle.date,
        cycleHour: cycle.cycleHour,
        forecastHour,
        baseUrl: options.baseUrl,
        fetchText: options.fetchText,
      }),
    );
  }
  return {
    date: validateGfsDate(cycle.date),
    cycleHour: validateGfsCycleHour(cycle.cycleHour),
    model: "NOAA GFS 0.25 degree pgrb2 total cloud cover + cloud water + precipitation rate",
    plans,
  };
}

export function gfsMessageByteRangeHeader(message) {
  if (!Number.isSafeInteger(message.byteOffset) || message.byteOffset < 0) {
    throw new Error(`GFS message ${message.messageNumber ?? ""} has an invalid byte offset.`);
  }
  if (message.nextByteOffset === undefined) {
    return `bytes=${message.byteOffset}-`;
  }
  return `bytes=${message.byteOffset}-${message.nextByteOffset - 1}`;
}

function isInstantaneousCloudCoverLabel(label) {
  return label === "anl" || /^\d+ hour fcst$/.test(label);
}

function formatGfsCycle(cycleHour) {
  return String(validateGfsCycleHour(cycleHour)).padStart(2, "0");
}

function formatGfsForecastHour(forecastHour) {
  return String(validateGfsForecastHour(forecastHour)).padStart(3, "0");
}

function validateGfsCycleHour(cycleHour) {
  const numeric = Number(cycleHour);
  if (!GFS_CYCLE_HOURS.includes(numeric)) {
    throw new Error(`GFS cycle hour must be one of ${GFS_CYCLE_HOURS.join(", ")} UTC.`);
  }
  return numeric;
}

function validateGfsForecastHour(forecastHour) {
  const numeric = Number(forecastHour);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 384) {
    throw new Error("GFS forecast hour must be an integer between 0 and 384.");
  }
  return numeric;
}

function validateGfsDate(date) {
  if (typeof date !== "string" || !/^\d{8}$/.test(date)) {
    throw new Error("GFS date must be YYYYMMDD.");
  }
  const parsed = parseGfsDate(date);
  const roundTrip = `${parsed.year}${String(parsed.monthIndex + 1).padStart(2, "0")}${String(parsed.day).padStart(2, "0")}`;
  if (roundTrip !== date) {
    throw new Error(`GFS date ${date} is not a valid UTC calendar date.`);
  }
  return date;
}

function parseGfsDate(date) {
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(4, 6)) - 1;
  const day = Number(date.slice(6, 8));
  const utc = new Date(Date.UTC(year, monthIndex, day));
  return {
    year: utc.getUTCFullYear(),
    monthIndex: utc.getUTCMonth(),
    day: utc.getUTCDate(),
  };
}

function formatUtcDate(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl).replace(/\/+$/, "");
}

async function fetchTextFromNetwork(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status} ${response.statusText}`);
  }
  return response.text();
}

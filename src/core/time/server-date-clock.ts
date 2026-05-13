export interface ServerDateClockSyncSample {
  readonly source: "server-epoch-ms" | "http-date";
  readonly dateHeader?: string;
  readonly serverUtcMs: number;
  readonly clientRequestStartMs: number;
  readonly clientResponseEndMs: number;
  readonly clientMidpointMs: number;
  readonly roundTripMs: number;
  readonly offsetMs: number;
}

export type ServerDateClockSyncResult =
  | {
      readonly status: "synced";
      readonly sample: ServerDateClockSyncSample;
      readonly samples: readonly ServerDateClockSyncSample[];
    }
  | {
      readonly status: "unavailable";
      readonly reason: string;
      readonly samples: readonly ServerDateClockSyncSample[];
    };

export type ServerDateClockFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface EstimateServerDateClockOffsetOptions {
  readonly fetcher: ServerDateClockFetch;
  readonly url: string;
  readonly nowMs?: () => number;
  readonly sampleCount?: number;
  readonly signal?: AbortSignal;
  readonly maxRoundTripMs?: number;
}

const DEFAULT_SAMPLE_COUNT = 3;
const DEFAULT_MAX_ROUND_TRIP_MS = 2_000;

export class ServerDateCanonicalClock {
  private offsetMs = 0;
  private lastSample: ServerDateClockSyncSample | undefined;

  constructor(private readonly nowMsProvider: () => number = () => Date.now()) {}

  nowMs(): number {
    return this.nowMsProvider() + this.offsetMs;
  }

  nowDate(): Date {
    return new Date(this.nowMs());
  }

  applySample(sample: ServerDateClockSyncSample): void {
    this.offsetMs = sample.offsetMs;
    this.lastSample = sample;
  }

  getOffsetMs(): number {
    return this.offsetMs;
  }

  getLastSample(): ServerDateClockSyncSample | undefined {
    return this.lastSample;
  }
}

export async function estimateServerDateClockOffset(
  options: EstimateServerDateClockOffsetOptions,
): Promise<ServerDateClockSyncResult> {
  const nowMs = options.nowMs ?? (() => Date.now());
  const sampleCount = Math.max(1, Math.floor(options.sampleCount ?? DEFAULT_SAMPLE_COUNT));
  const maxRoundTripMs = options.maxRoundTripMs ?? DEFAULT_MAX_ROUND_TRIP_MS;
  const samples: ServerDateClockSyncSample[] = [];
  let lastReason = "no-date-header";

  for (let index = 0; index < sampleCount; index += 1) {
    if (options.signal?.aborted) {
      return { status: "unavailable", reason: "aborted", samples };
    }

    try {
      const sample = await sampleServerDateClock({
        fetcher: options.fetcher,
        url: options.url,
        nowMs,
        signal: options.signal,
      });
      if (!sample) {
        lastReason = "no-date-header";
        continue;
      }
      if (sample.roundTripMs > maxRoundTripMs) {
        lastReason = "round-trip-too-large";
        continue;
      }
      samples.push(sample);
    } catch (error) {
      lastReason = isAbortError(error) ? "aborted" : "fetch-error";
      if (lastReason === "aborted") {
        return { status: "unavailable", reason: lastReason, samples };
      }
    }
  }

  const sample = selectBestServerDateClockSyncSample(samples);
  if (!sample) {
    return { status: "unavailable", reason: lastReason, samples };
  }

  return { status: "synced", sample, samples };
}

export async function sampleServerDateClock(options: {
  readonly fetcher: ServerDateClockFetch;
  readonly url: string;
  readonly nowMs: () => number;
  readonly signal?: AbortSignal;
}): Promise<ServerDateClockSyncSample | undefined> {
  const requestStartMs = options.nowMs();
  const response = await options.fetcher(options.url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    method: "GET",
    signal: options.signal,
  });
  const responseEndMs = options.nowMs();
  const serverUtcMs = await readServerUtcMsFromResponse(response);
  if (serverUtcMs != null) {
    return createServerEpochMsClockSyncSample({
      clientRequestStartMs: requestStartMs,
      clientResponseEndMs: responseEndMs,
      serverUtcMs,
    });
  }

  return createServerDateClockSyncSample({
    dateHeader: response.headers.get("date"),
    clientRequestStartMs: requestStartMs,
    clientResponseEndMs: responseEndMs,
  });
}

export function createServerEpochMsClockSyncSample(options: {
  readonly serverUtcMs: number;
  readonly clientRequestStartMs: number;
  readonly clientResponseEndMs: number;
}): ServerDateClockSyncSample | undefined {
  if (!Number.isFinite(options.serverUtcMs)) {
    return undefined;
  }

  const roundTripMs = options.clientResponseEndMs - options.clientRequestStartMs;
  if (!Number.isFinite(roundTripMs) || roundTripMs < 0) {
    return undefined;
  }

  const clientMidpointMs =
    options.clientRequestStartMs + (options.clientResponseEndMs - options.clientRequestStartMs) / 2;

  return {
    source: "server-epoch-ms",
    serverUtcMs: options.serverUtcMs,
    clientRequestStartMs: options.clientRequestStartMs,
    clientResponseEndMs: options.clientResponseEndMs,
    clientMidpointMs,
    roundTripMs,
    offsetMs: options.serverUtcMs - clientMidpointMs,
  };
}

export function createServerDateClockSyncSample(options: {
  readonly dateHeader: string | null;
  readonly clientRequestStartMs: number;
  readonly clientResponseEndMs: number;
}): ServerDateClockSyncSample | undefined {
  if (!options.dateHeader) {
    return undefined;
  }

  const serverUtcMs = Date.parse(options.dateHeader);
  if (!Number.isFinite(serverUtcMs)) {
    return undefined;
  }

  const roundTripMs = options.clientResponseEndMs - options.clientRequestStartMs;
  if (!Number.isFinite(roundTripMs) || roundTripMs < 0) {
    return undefined;
  }

  const clientMidpointMs =
    options.clientRequestStartMs + (options.clientResponseEndMs - options.clientRequestStartMs) / 2;

  return {
    source: "http-date",
    dateHeader: options.dateHeader,
    serverUtcMs,
    clientRequestStartMs: options.clientRequestStartMs,
    clientResponseEndMs: options.clientResponseEndMs,
    clientMidpointMs,
    roundTripMs,
    offsetMs: serverUtcMs - clientMidpointMs,
  };
}

export function selectBestServerDateClockSyncSample(
  samples: readonly ServerDateClockSyncSample[],
): ServerDateClockSyncSample | undefined {
  let best: ServerDateClockSyncSample | undefined;
  for (const sample of samples) {
    if (!best || sample.roundTripMs < best.roundTripMs) {
      best = sample;
    }
  }
  return best;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function readServerUtcMsFromResponse(response: Response): Promise<number | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return undefined;
  }

  try {
    const payload = await response.json() as unknown;
    return serverUtcMsFromPayload(payload);
  } catch {
    return undefined;
  }
}

function serverUtcMsFromPayload(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const numericValue =
    typeof record.serverUtcMs === "number"
      ? record.serverUtcMs
      : typeof record.utcMs === "number"
        ? record.utcMs
        : undefined;
  if (numericValue != null && Number.isFinite(numericValue)) {
    return numericValue;
  }

  const isoValue =
    typeof record.serverUtcIso === "string"
      ? record.serverUtcIso
      : typeof record.utcIso === "string"
        ? record.utcIso
        : undefined;
  if (!isoValue) {
    return undefined;
  }

  const parsed = Date.parse(isoValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface CanonicalUtcState {
  readonly date: Date;
  readonly iso: string;
  readonly epochMs: number;
  readonly utcYear: number;
  readonly utcMonth: number;
  readonly utcDay: number;
  readonly utcHour: number;
  readonly utcMinute: number;
  readonly utcSecond: number;
  readonly utcMillisecond: number;
  readonly utcMinutesOfDay: number;
}

export type UtcNowProvider = () => Date;

export const systemUtcNow: UtcNowProvider = () => new Date(Date.now());

export function createCanonicalUtcState(date: Date): CanonicalUtcState {
  assertValidDate(date);

  const utcHour = date.getUTCHours();
  const utcMinute = date.getUTCMinutes();
  const utcSecond = date.getUTCSeconds();
  const utcMillisecond = date.getUTCMilliseconds();

  return {
    date: new Date(date.getTime()),
    iso: date.toISOString(),
    epochMs: date.getTime(),
    utcYear: date.getUTCFullYear(),
    utcMonth: date.getUTCMonth() + 1,
    utcDay: date.getUTCDate(),
    utcHour,
    utcMinute,
    utcSecond,
    utcMillisecond,
    utcMinutesOfDay:
      utcHour * 60 + utcMinute + utcSecond / 60 + utcMillisecond / 60000,
  };
}

export function dateFromUtcParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
}

function assertValidDate(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new Error("PENUMBRA UTC clock received an invalid Date.");
  }
}

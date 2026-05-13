export interface WeatherSample {
  readonly cloudCoverPct: number;
  readonly relativeHumidityPct: number;
  readonly windSpeedMps: number;
  readonly precipitationMm: number;
  readonly temperatureC: number;
  readonly pressureHpa?: number;
}

export const DEFAULT_WEATHER_SAMPLE: WeatherSample = {
  cloudCoverPct: 35,
  relativeHumidityPct: 62,
  windSpeedMps: 3,
  precipitationMm: 0,
  temperatureC: 14,
  pressureHpa: 1013,
};

export interface CanonicalWeather extends WeatherSample {
  readonly cloudNorm: number;
  readonly humidityNorm: number;
  readonly precipitationNorm: number;
  readonly temperatureNorm: number;
}

export interface OpenMeteoCurrentResponse {
  readonly current: {
    readonly time: string;
    readonly temperature_2m: number;
    readonly relative_humidity_2m: number;
    readonly pressure_msl?: number;
    readonly wind_speed_10m: number;
    readonly cloud_cover: number;
    readonly precipitation: number;
    readonly weather_code?: number;
  };
}

export function adaptOpenMeteoCurrentResponse(response: OpenMeteoCurrentResponse): WeatherSample {
  const current = response.current;
  return {
    cloudCoverPct: current.cloud_cover,
    relativeHumidityPct: current.relative_humidity_2m,
    windSpeedMps: current.wind_speed_10m / 3.6,
    precipitationMm: current.precipitation,
    temperatureC: current.temperature_2m,
    pressureHpa: current.pressure_msl,
  };
}

export function normalizeWeatherSample(sample: WeatherSample): CanonicalWeather {
  return {
    ...sample,
    cloudNorm: clamp01(sample.cloudCoverPct / 100),
    humidityNorm: clamp01(sample.relativeHumidityPct / 100),
    precipitationNorm: clamp01(sample.precipitationMm / 20),
    temperatureNorm: clamp01((sample.temperatureC + 30) / 70),
  };
}

export async function fetchOpenMeteoWeather(
  fetchJson: (url: string) => Promise<unknown>,
  latitudeDeg: number,
  longitudeDeg: number,
): Promise<WeatherSample> {
  const url = openMeteoCurrentUrl(latitudeDeg, longitudeDeg);
  const data = await fetchJson(url);
  assertOpenMeteoCurrentResponse(data);
  return adaptOpenMeteoCurrentResponse(data);
}

export function openMeteoCurrentUrl(latitudeDeg: number, longitudeDeg: number): string {
  const params = new URLSearchParams({
    latitude: latitudeDeg.toFixed(4),
    longitude: longitudeDeg.toFixed(4),
    current:
      "temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m,cloud_cover,precipitation,weather_code",
    timezone: "UTC",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

function assertOpenMeteoCurrentResponse(data: unknown): asserts data is OpenMeteoCurrentResponse {
  if (typeof data !== "object" || data === null || !("current" in data)) {
    throw new Error("Open-Meteo response is missing current weather.");
  }

  const current = (data as { current: unknown }).current;
  if (typeof current !== "object" || current === null) {
    throw new Error("Open-Meteo current weather must be an object.");
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

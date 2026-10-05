import type { WeatherSample, WeatherSnapshot } from '../types';
import type { WeatherProvider } from './provider';

const HOURLY_VARIABLES = [
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'weather_code',
  'cloud_cover',
  'wind_gusts_10m',
  'shortwave_radiation',
] as const;

type HourlyVariable = (typeof HOURLY_VARIABLES)[number];

/** The part of the Open-Meteo forecast response this project reads. */
export interface OpenMeteoResponse {
  hourly: { time: number[] } & Record<HourlyVariable, (number | null)[]>;
}

export function buildUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: HOURLY_VARIABLES.join(','),
    forecast_days: '3',
    timeformat: 'unixtime',
    timezone: 'GMT',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export function parseHourly(body: OpenMeteoResponse): WeatherSample[] {
  const h = body.hourly;
  if (!h || !Array.isArray(h.time)) throw new Error('Open-Meteo response has no hourly data');
  const at = (name: HourlyVariable, i: number): number => h[name]?.[i] ?? 0;
  return h.time.map((seconds, i) => ({
    time: new Date(seconds * 1000).toISOString(),
    temperatureC: at('temperature_2m', i),
    humidityPct: at('relative_humidity_2m', i),
    precipitationMm: at('precipitation', i),
    weatherCode: at('weather_code', i),
    cloudCoverPct: at('cloud_cover', i),
    windGustKmh: at('wind_gusts_10m', i),
    solarRadiationWm2: at('shortwave_radiation', i),
  }));
}

/** Picks the hour containing `at` as current and the following hours as forecast. */
export function toSnapshot(samples: WeatherSample[], at: Date, forecastHours = 48): WeatherSnapshot {
  let index = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Date.parse(samples[i]!.time) <= at.getTime()) index = i;
  }
  const current = samples[index];
  if (!current) throw new Error(`No weather data covers ${at.toISOString()}`);
  return { current, forecast: samples.slice(index + 1, index + 1 + forecastHours) };
}

/** Live weather from https://open-meteo.com (free for non-commercial use, no API key). */
export class OpenMeteoProvider implements WeatherProvider {
  constructor(
    private readonly latitude: number,
    private readonly longitude: number,
  ) {}

  async getSnapshot(at: Date): Promise<WeatherSnapshot> {
    const response = await fetch(buildUrl(this.latitude, this.longitude), {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Open-Meteo returned ${response.status}: ${await response.text()}`);
    }
    return toSnapshot(parseHourly((await response.json()) as OpenMeteoResponse), at);
  }
}

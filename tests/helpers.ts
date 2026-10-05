import type { WeatherSample, WeatherSnapshot } from '../src/types';

const HOUR_MS = 3_600_000;
export const T0 = Date.parse('2026-06-01T12:00:00Z');

export function sample(overrides: Partial<WeatherSample> = {}): WeatherSample {
  return {
    time: new Date(T0).toISOString(),
    temperatureC: 18,
    humidityPct: 50,
    precipitationMm: 0,
    windGustKmh: 10,
    cloudCoverPct: 50,
    solarRadiationWm2: 0,
    weatherCode: 2,
    ...overrides,
  };
}

/** A snapshot at T0 whose forecast is one sample per following hour. */
export function snapshot(current: Partial<WeatherSample> = {}, next: Partial<WeatherSample>[] = []): WeatherSnapshot {
  return {
    current: sample(current),
    forecast: next.map((o, i) => sample({ ...o, time: new Date(T0 + (i + 1) * HOUR_MS).toISOString() })),
  };
}

export const minutesAfterT0 = (minutes: number): Date => new Date(T0 + minutes * 60_000);

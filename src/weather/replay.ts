import { readFileSync } from 'node:fs';
import type { HomeState, WeatherSample, WeatherSnapshot } from '../types';
import type { WeatherProvider } from './provider';

type HourOfWeather = Omit<WeatherSample, 'time'>;

/** A stretch of time during which the forecast was wrong about some later hours. */
export interface ForecastError {
  /** The forecast is wrong until this many hours after `start`, then it is corrected. */
  untilHour: number;
  /** Hour offset from `start` -> what the forecast showed for that hour instead of what happened. */
  hours: Record<string, Partial<HourOfWeather>>;
}

/** A scripted stretch of weather, one entry per hour starting at `start`. */
export interface Scenario {
  name: string;
  description: string;
  /** ISO 8601 UTC time of the first hour. */
  start: string;
  initialHome: HomeState;
  /** What actually happened. */
  hours: HourOfWeather[];
  /** Optional: how the forecast differed from what happened. Without it the forecast is perfect. */
  forecastErrors?: ForecastError[];
}

export function loadScenario(path: string): Scenario {
  const scenario = JSON.parse(readFileSync(path, 'utf8')) as Scenario;
  if (!Array.isArray(scenario.hours) || scenario.hours.length === 0) {
    throw new Error(`${path} has no "hours"`);
  }
  if (Number.isNaN(Date.parse(scenario.start))) throw new Error(`${path} has an invalid "start"`);
  return scenario;
}

const HOUR_MS = 3_600_000;

/**
 * Replays a scenario as if it were live weather. Current conditions are always
 * what really happened. The forecast is the scenario's own future, altered by
 * any `forecastErrors` that are still in effect at the moment of asking.
 */
export class ReplayProvider implements WeatherProvider {
  private readonly samples: WeatherSample[];
  private readonly errors: ForecastError[];

  constructor(scenario: Scenario) {
    const start = Date.parse(scenario.start);
    this.errors = scenario.forecastErrors ?? [];
    this.samples = scenario.hours.map((hour, i) => ({
      time: new Date(start + i * HOUR_MS).toISOString(),
      ...hour,
    }));
  }

  get endTime(): number {
    return Date.parse(this.samples[0]!.time) + this.samples.length * HOUR_MS;
  }

  async getSnapshot(at: Date): Promise<WeatherSnapshot> {
    const index = Math.floor((at.getTime() - Date.parse(this.samples[0]!.time)) / HOUR_MS);
    const current = this.samples[index];
    if (!current) throw new Error(`Scenario does not cover ${at.toISOString()}`);
    const active = this.errors.filter((e) => index < e.untilHour);
    const forecast = this.samples.slice(index + 1, index + 49).map((truth, i) => {
      const hour = String(index + 1 + i);
      return active.reduce((seen, error) => ({ ...seen, ...(error.hours[hour] ?? {}) }), truth);
    });
    return { current, forecast };
  }
}

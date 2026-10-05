import { readFileSync, existsSync } from 'node:fs';
import type { HomeState } from './types';

export interface ComfortConfig {
  targetTemperatureC: number;
  /** Heating starts below target - deadband, cooling above target + deadband. */
  deadbandC: number;
  humidityLimitPct: number;
  /** Stricter limit while it rains or rain is about to start. */
  humidityLimitWhenRainingPct: number;
  /** How far ahead the brain looks for heat waves and cold snaps. */
  planningHorizonH: number;
  heatWaveThresholdC: number;
  coldSnapThresholdC: number;
  /** How far to shift the setpoint ahead of a heat wave or cold snap. 0 turns planning off. */
  preconditionOffsetC: number;
  /** Blinds close this long before forecast hail. */
  hailLookaheadH: number;
  /** Blinds also close this long before a forecast thunderstorm, in case it brings hail nobody forecast. */
  stormLookaheadH: number;
  /** Minimum time between HVAC mode changes (safety rules are exempt). */
  minModeDwellMin: number;
  /** Minimum time between blinds movements (safety rules are exempt). */
  minBlindsDwellMin: number;
}

export const defaultComfort: ComfortConfig = {
  targetTemperatureC: 22,
  deadbandC: 1,
  humidityLimitPct: 60,
  humidityLimitWhenRainingPct: 55,
  planningHorizonH: 6,
  heatWaveThresholdC: 30,
  coldSnapThresholdC: -10,
  preconditionOffsetC: 0.5,
  hailLookaheadH: 2,
  stormLookaheadH: 1,
  minModeDwellMin: 20,
  minBlindsDwellMin: 30,
};

/**
 * Rejects settings under which rules would fight each other. The precondition
 * offset must be smaller than the deadband: otherwise a pre-cooled house would
 * count as too cold the moment the setpoint returns to normal, and the heating
 * would start in the middle of a heat wave.
 */
export function validateComfort(c: ComfortConfig): void {
  if (c.deadbandC <= 0) throw new Error('deadbandC must be positive');
  if (c.preconditionOffsetC < 0 || c.preconditionOffsetC >= c.deadbandC) {
    throw new Error('preconditionOffsetC must be at least 0 and smaller than deadbandC');
  }
  if (c.humidityLimitWhenRainingPct > c.humidityLimitPct) {
    throw new Error('humidityLimitWhenRainingPct must not exceed humidityLimitPct');
  }
}

export interface AppConfig {
  location: { name: string; latitude: number; longitude: number };
  initialHome: HomeState;
  comfort: ComfortConfig;
}

export function loadConfig(path = 'config.json'): AppConfig {
  const raw = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  if (!raw.location) throw new Error(`${path} must contain a "location" with latitude and longitude`);
  return {
    location: raw.location,
    initialHome: raw.initialHome ?? { temperatureC: 21.5, humidityPct: 45 },
    comfort: { ...defaultComfort, ...(raw.comfort ?? {}) },
  };
}

import type { ComfortConfig } from '../config';
import { absoluteHumidity, relativeHumidity } from '../humidity';
import type { BrainState, HomeState, Outlook, Proposal, Setpoint, WeatherSample } from '../types';
import { isHail, isRaining, isThunderstorm } from '../weather/codes';

/** Everything a rule may look at. Rules are pure functions of this. */
export interface Context {
  /** Epoch ms. */
  now: number;
  weather: WeatherSample;
  forecast: WeatherSample[];
  outlook: Outlook;
  setpoint: Setpoint;
  home: HomeState;
  previous: BrainState;
  comfort: ComfortConfig;
}

export interface Rule {
  id: string;
  priority: number;
  description: string;
  evaluate(ctx: Context): Omit<Proposal, 'ruleId' | 'priority'> | null;
}

/** Higher wins. Safety-level proposals also bypass the minimum dwell times. */
export const PRIORITY = {
  safety: 100,
  efficiency: 65,
  comfort: 60,
  airQuality: 50,
  shading: 30,
} as const;

const HOUR_MS = 3_600_000;
const fmt = (n: number): string => n.toFixed(1);

/** Forecast samples that start within the next `hours`. */
export function upcoming(ctx: Context, hours: number): WeatherSample[] {
  return ctx.forecast.filter((s) => Date.parse(s.time) <= ctx.now + hours * HOUR_MS);
}

/** Proportional power, rounded to steps of 5 so the command does not jitter. */
function power(base: number, gain: number, gap: number, min: number): number {
  const raw = Math.round((base + gain * gap) / 5) * 5;
  return Math.min(100, Math.max(min, raw));
}

/** Would bringing in outdoor air keep indoor humidity under the limit? */
function outdoorAirIsDryEnough(ctx: Context): boolean {
  const water = absoluteHumidity(ctx.weather.temperatureC, ctx.weather.humidityPct);
  return relativeHumidity(ctx.home.temperatureC, water) <= ctx.comfort.humidityLimitPct;
}

const because = (setpoint: Setpoint): string => (setpoint.reason ? ` (${setpoint.reason})` : '');

/** While pre-cooling, outdoor air is used as soon as the house is this far above the setpoint. */
const EAGER_MARGIN_C = 0.3;

const HAIL = 'hail-protection';
const STORM = 'storm-precaution';
const FREE_COOLING = 'free-cooling';
const HEAT = 'heat-when-cold';
const COOL = 'cool-when-hot';
const HUMIDITY = 'dehumidify-when-damp';
const SHADING = 'solar-shading';

export const hailProtection: Rule = {
  id: HAIL,
  priority: PRIORITY.safety,
  description: 'Close the blinds before and during hail.',
  evaluate(ctx) {
    if (isHail(ctx.weather.weatherCode)) return { blinds: 'closed', reason: 'Hail right now' };
    const next = upcoming(ctx, ctx.comfort.hailLookaheadH).find((s) => isHail(s.weatherCode));
    if (!next) return null;
    const minutes = Math.round((Date.parse(next.time) - ctx.now) / 60_000);
    return { blinds: 'closed', reason: `Hail forecast in ${minutes} min` };
  },
};

export const stormPrecaution: Rule = {
  id: STORM,
  priority: PRIORITY.safety,
  description:
    'Close the blinds for any thunderstorm, because forecasts often miss the hail that comes with one.',
  evaluate(ctx) {
    if (isThunderstorm(ctx.weather.weatherCode)) {
      return { blinds: 'closed', reason: 'Thunderstorm right now, hail is possible' };
    }
    const next = upcoming(ctx, ctx.comfort.stormLookaheadH).find((s) => isThunderstorm(s.weatherCode));
    if (!next) return null;
    const minutes = Math.round((Date.parse(next.time) - ctx.now) / 60_000);
    return { blinds: 'closed', reason: `Thunderstorm forecast in ${minutes} min, hail is possible` };
  },
};

export const freeCooling: Rule = {
  id: FREE_COOLING,
  priority: PRIORITY.efficiency,
  description:
    'When the house is too warm and outdoor air is cooler and dry, ventilate instead of running the compressor. Starts earlier while pre-cooling, because outdoor air is nearly free.',
  evaluate(ctx) {
    const target = ctx.setpoint.temperatureC;
    const active = ctx.previous.hvac.ruleId === FREE_COOLING;
    const indoor = ctx.home.temperatureC;
    const outdoor = ctx.weather.temperatureC;
    const startAbove = target + (ctx.setpoint.shiftC < 0 ? EAGER_MARGIN_C : ctx.comfort.deadbandC);
    const tooWarm = indoor > startAbove || (active && indoor > target);
    const usable =
      outdoor <= indoor - (active ? 1 : 2) && !isRaining(ctx.weather) && outdoorAirIsDryEnough(ctx);
    if (!tooWarm || !usable) return null;
    return {
      hvac: { mode: 'ventilate', powerPct: power(50, 15, indoor - outdoor, 50) },
      reason: `Indoor ${fmt(indoor)} °C, cooling to ${fmt(target)} °C with ${fmt(outdoor)} °C outdoor air${because(ctx.setpoint)}`,
    };
  },
};

export const heatWhenCold: Rule = {
  id: HEAT,
  priority: PRIORITY.comfort,
  description: 'Heat when the house falls below the setpoint minus deadband, until it is back at the setpoint.',
  evaluate(ctx) {
    const target = ctx.setpoint.temperatureC;
    const active = ctx.previous.hvac.ruleId === HEAT;
    const indoor = ctx.home.temperatureC;
    // If it is warmer outside than the setpoint, the house will warm up by itself.
    if (ctx.weather.temperatureC >= target) return null;
    if (!(indoor < target - ctx.comfort.deadbandC || (active && indoor < target))) return null;
    return {
      hvac: { mode: 'heat', powerPct: power(40, 40, target - indoor, 40) },
      reason: `Indoor ${fmt(indoor)} °C, heating to ${fmt(target)} °C${because(ctx.setpoint)}`,
    };
  },
};

export const coolWhenHot: Rule = {
  id: COOL,
  priority: PRIORITY.comfort,
  description: 'Cool when the house rises above the setpoint plus deadband, until it is back at the setpoint.',
  evaluate(ctx) {
    const target = ctx.setpoint.temperatureC;
    const active = ctx.previous.hvac.ruleId === COOL;
    const indoor = ctx.home.temperatureC;
    if (!(indoor > target + ctx.comfort.deadbandC || (active && indoor > target))) return null;
    return {
      hvac: { mode: 'cool', powerPct: power(40, 40, indoor - target, 40) },
      reason: `Indoor ${fmt(indoor)} °C, cooling to ${fmt(target)} °C${because(ctx.setpoint)}`,
    };
  },
};

export const dehumidifyWhenDamp: Rule = {
  id: HUMIDITY,
  priority: PRIORITY.airQuality,
  description: 'Dehumidify above the humidity limit, with a stricter limit while it rains or rain is imminent.',
  evaluate(ctx) {
    const rain = isRaining(ctx.weather) || upcoming(ctx, 1).some(isRaining);
    const limit = rain ? ctx.comfort.humidityLimitWhenRainingPct : ctx.comfort.humidityLimitPct;
    const stopAt = limit - 5;
    const active = ctx.previous.hvac.ruleId === HUMIDITY;
    const humidity = ctx.home.humidityPct;
    if (!(humidity > limit || (active && humidity > stopAt))) return null;
    return {
      hvac: { mode: 'dehumidify', powerPct: power(50, 10, humidity - stopAt, 40) },
      reason: `Indoor humidity ${fmt(humidity)} %, drying to ${stopAt} % (limit ${limit} %${rain ? ' while it rains' : ''})`,
    };
  },
};

export const solarShading: Rule = {
  id: SHADING,
  priority: PRIORITY.shading,
  description: 'Close the blinds against strong sun when it is hot, or about to be, unless the house is cold.',
  evaluate(ctx) {
    const c = ctx.comfort;
    const active = ctx.previous.blinds.ruleId === SHADING;
    const sun = ctx.weather.solarRadiationWm2;
    const sunny = sun >= (active ? 200 : 350);
    const hot = ctx.weather.temperatureC >= 24 || ctx.outlook.maxTemperatureC >= c.heatWaveThresholdC;
    // Below the comfort band the sun is welcome, so the blinds stay open.
    const coldInside = ctx.home.temperatureC < ctx.setpoint.temperatureC - c.deadbandC - (active ? 0.5 : 0);
    if (!sunny || !hot || coldInside) return null;
    return { blinds: 'closed', reason: `Strong sun (${Math.round(sun)} W/m²) on a hot day` };
  },
};

/** Order only matters as a tie-breaker between rules of equal priority. */
export const defaultRules: Rule[] = [
  hailProtection,
  stormPrecaution,
  freeCooling,
  heatWhenCold,
  coolWhenHot,
  dehumidifyWhenDamp,
  solarShading,
];

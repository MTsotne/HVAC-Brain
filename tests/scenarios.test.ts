import { describe, expect, it } from 'vitest';
import { Brain } from '../src/brain/brain';
import { defaultComfort } from '../src/config';
import { runScenario } from '../src/sim/simulator';
import type { DecisionRecord } from '../src/types';
import { isHail, isRaining } from '../src/weather/codes';
import { loadScenario } from '../src/weather/replay';

const STEP_MIN = 10;
const run = (name: string, comfort = defaultComfort): Promise<DecisionRecord[]> =>
  runScenario(loadScenario(`scenarios/${name}.json`), new Brain(comfort), { stepMin: STEP_MIN });

const modes = (records: DecisionRecord[]): Set<string> => new Set(records.map((r) => r.command.mode));

/** Power × time spent heating or cooling, in "hours at full power". */
const effort = (records: DecisionRecord[]): number =>
  records
    .filter((r) => r.command.mode === 'cool' || r.command.mode === 'heat')
    .reduce((sum, r) => sum + (r.command.powerPct / 100) * (STEP_MIN / 60), 0);

describe('hailstorm', () => {
  it('has the blinds closed from two hours before the hail until it is over, then reopens them', async () => {
    const records = await run('hailstorm');
    const firstHail = records.findIndex((r) => isHail(r.weather.weatherCode));
    const lastHail = records.findLastIndex((r) => isHail(r.weather.weatherCode));
    const stepsPerHour = 60 / STEP_MIN;
    expect(firstHail).toBeGreaterThan(0);

    const protectedSpan = records.slice(firstHail - defaultComfort.hailLookaheadH * stepsPerHour, lastHail + 1);
    expect(protectedSpan.every((r) => r.command.blinds === 'closed' && r.blinds.ruleId === 'hail-protection')).toBe(true);

    const justBefore = records[firstHail - defaultComfort.hailLookaheadH * stepsPerHour - 1]!;
    expect(justBefore.blinds.ruleId).not.toBe('hail-protection');
    expect(records.at(-1)!.command.blinds).toBe('open');
  });
});

describe('heat wave', () => {
  it('pre-cools with outdoor air before sunrise and never heats', async () => {
    const records = await run('heatwave');
    const firstHot = records.findIndex((r) => r.weather.temperatureC >= defaultComfort.heatWaveThresholdC);
    const firstVentilation = records.findIndex((r) => r.command.mode === 'ventilate');

    expect(firstVentilation).toBeGreaterThanOrEqual(0);
    expect(firstVentilation).toBeLessThan(firstHot);
    expect(records[firstVentilation]!.hvac.reason).toMatch(/pre-cooling/);
    expect(modes(records).has('heat')).toBe(false);
  });

  it('keeps the house in the comfort band and the blinds closed through the strongest sun', async () => {
    const records = await run('heatwave');
    const { targetTemperatureC: target, deadbandC } = defaultComfort;
    for (const r of records) {
      expect(r.home.temperatureC).toBeLessThanOrEqual(target + deadbandC + 0.5);
      expect(r.home.temperatureC).toBeGreaterThanOrEqual(target - deadbandC);
      if (r.weather.solarRadiationWm2 >= 600) expect(r.command.blinds).toBe('closed');
    }
  });

  it('enters the heat cooler, and cools less during it, than with planning turned off', async () => {
    const planned = await run('heatwave');
    const reactive = await run('heatwave', { ...defaultComfort, preconditionOffsetC: 0 });
    const hot = (r: DecisionRecord): boolean => r.weather.temperatureC >= defaultComfort.heatWaveThresholdC;

    expect(planned.find(hot)!.home.temperatureC).toBeLessThan(reactive.find(hot)!.home.temperatureC);
    expect(effort(planned.filter(hot))).toBeLessThan(effort(reactive.filter(hot)));
  });
});

describe('rainy day', () => {
  it('dehumidifies while it rains and keeps humidity at or below the normal limit during the rain', async () => {
    const records = await run('rainy-day');
    const rain = records.filter((r) => isRaining(r.weather));

    expect(rain.length).toBeGreaterThan(0);
    expect(rain.filter((r) => r.command.mode === 'dehumidify').length / rain.length).toBeGreaterThan(0.9);
    for (const r of rain) expect(r.home.humidityPct).toBeLessThanOrEqual(defaultComfort.humidityLimitPct);
    expect(modes(records).has('cool')).toBe(false);
  });
});

describe('cold snap', () => {
  it('raises the setpoint before the cold arrives, and never cools or ventilates', async () => {
    const records = await run('cold-snap');
    const firstCold = records.findIndex((r) => r.weather.temperatureC <= defaultComfort.coldSnapThresholdC);
    const preheating = records.slice(0, firstCold).filter((r) => r.setpoint.shiftC > 0);

    expect(preheating.length).toBeGreaterThan(0);
    expect(preheating.every((r) => r.command.mode === 'heat')).toBe(true);
    expect(records.slice(firstCold).every((r) => r.setpoint.shiftC === 0)).toBe(true);
    expect([...modes(records)].sort()).toEqual(['heat', 'off']);
    for (const r of records) expect(r.home.temperatureC).toBeGreaterThanOrEqual(20.5);
  });
});

describe.each(['hailstorm', 'heatwave', 'rainy-day', 'cold-snap', 'hail-false-alarm', 'hail-surprise'])('stability in %s', (name) => {
  it('never changes HVAC mode sooner than the minimum dwell time', async () => {
    const records = await run(name);
    let lastChange = -Infinity;
    records.forEach((r, i) => {
      if (i === 0 || records[i - 1]!.command.mode === r.command.mode) return;
      const time = Date.parse(r.time);
      expect((time - lastChange) / 60_000).toBeGreaterThanOrEqual(defaultComfort.minModeDwellMin);
      lastChange = time;
    });
  });

  it('never switches directly between heating and cooling', async () => {
    const records = await run(name);
    records.forEach((r, i) => {
      const before = records[i - 1]?.command.mode;
      const pair = [before, r.command.mode].sort().join('>');
      expect(pair).not.toBe('cool>heat');
    });
  });
});

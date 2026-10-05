import { describe, expect, it } from 'vitest';
import { analyze, dailyCycle, findSpells, protectionEvents, rainPrecursors } from '../src/analysis/patterns';
import { Brain } from '../src/brain/brain';
import { runScenario } from '../src/sim/simulator';
import type { WeatherSample } from '../src/types';
import { loadScenario } from '../src/weather/replay';
import { T0, sample } from './helpers';

const HOUR_MS = 3_600_000;
/** One sample per hour starting at T0; `skip` leaves a gap after that many hours. */
const hourly = (hours: Partial<WeatherSample>[], gapAfter?: number): WeatherSample[] =>
  hours.map((h, i) => sample({ ...h, time: new Date(T0 + (i + (gapAfter !== undefined && i >= gapAfter ? 5 : 0)) * HOUR_MS).toISOString() }));

const rain = { weatherCode: 63, precipitationMm: 2 };
const run = (name: string) => runScenario(loadScenario(`scenarios/${name}.json`), new Brain());

describe('weather spells', () => {
  it('groups consecutive hours of the same weather and totals the rain', () => {
    const spells = findSpells(hourly([{}, rain, rain, rain, {}, { temperatureC: 31 }, { temperatureC: 33 }]));
    expect(spells).toEqual([
      { kind: 'rain', start: new Date(T0 + HOUR_MS).toISOString(), hours: 3, extreme: 6 },
      { kind: 'heat', start: new Date(T0 + 5 * HOUR_MS).toISOString(), hours: 2, extreme: 33 },
    ]);
  });

  it('does not join spells across a gap in the log', () => {
    const spells = findSpells(hourly([rain, rain, rain, rain], 2));
    expect(spells.map((s) => s.hours)).toEqual([2, 2]);
  });

  it('counts hail as hail, thunderstorm and rain at once', () => {
    const kinds = findSpells(hourly([{ weatherCode: 99, precipitationMm: 10 }])).map((s) => s.kind);
    expect(kinds.sort()).toEqual(['hail', 'rain', 'thunderstorm']);
  });
});

describe('before the rain', () => {
  it('measures the change over the three dry hours before rain starts', () => {
    const result = rainPrecursors(
      hourly([{ humidityPct: 60, windGustKmh: 10 }, { humidityPct: 66 }, { humidityPct: 72, windGustKmh: 25 }, rain, rain]),
    );
    expect(result).toMatchObject({ onsets: 1, withRisingHumidity: 1, withRisingGusts: 1, meanHumidityChangePct: 12 });
  });

  it('ignores rain that was already falling and rain right after a gap', () => {
    expect(rainPrecursors(hourly([rain, rain, rain, rain])).onsets).toBe(0);
    expect(rainPrecursors(hourly([{}, {}, {}, rain], 3)).onsets).toBe(0);
  });
});

describe('daily cycle', () => {
  it('waits until every hour of the day has been seen', () => {
    expect(dailyCycle(hourly(Array.from({ length: 23 }, () => ({}))))).toBeNull();
    const day = hourly(Array.from({ length: 24 }, (_, i) => ({ temperatureC: i === 3 ? 30 : i === 16 ? 5 : 15 })));
    // T0 is 12:00 UTC, so index 3 is 15:00 and index 16 is 04:00.
    expect(dailyCycle(day)).toEqual({ warmestHourUtc: 15, coldestHourUtc: 4, meanSwingC: 25 });
  });
});

describe('protection events', () => {
  it('reports how long before the hail the blinds were closed', async () => {
    expect(protectionEvents(await run('hailstorm'))).toEqual([
      { start: '2026-07-14T13:00:00.000Z', minutes: 240, leadMinutes: 120, outcome: 'hail' },
    ]);
  });

  it('reports a closing that no hail followed', async () => {
    expect(protectionEvents(await run('hail-false-alarm'))).toEqual([
      { start: '2026-06-18T13:00:00.000Z', minutes: 60, leadMinutes: null, outcome: 'no hail' },
    ]);
  });
});

describe('analyze', () => {
  it('accounts for every hour of the log exactly once, whatever order the records come in', async () => {
    const records = await run('rainy-day');
    const analysis = analyze([...records].reverse());
    const total = Object.values(analysis.hoursByMode).reduce((a, b) => a + b, 0);

    expect(total).toBeCloseTo(24, 6);
    expect(analysis.hoursOfWeather).toBe(24);
    expect(analysis.spells.filter((s) => s.kind === 'rain')).toEqual([{ kind: 'rain', start: '2026-08-10T09:00:00.000Z', hours: 9, extreme: 30 }]);
    expect(analysis.hvacRules[0]!.ruleId).toBe('dehumidify-when-damp');
  });

  it('refuses an empty log', () => {
    expect(() => analyze([])).toThrow(/empty/);
  });
});

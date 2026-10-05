import { describe, expect, it } from 'vitest';
import { Brain } from '../src/brain/brain';
import { defaultRules, stormPrecaution } from '../src/brain/rules';
import { defaultComfort } from '../src/config';
import { runScenario } from '../src/sim/simulator';
import type { DecisionRecord } from '../src/types';
import { isHail } from '../src/weather/codes';
import { ReplayProvider, loadScenario } from '../src/weather/replay';
import { minutesAfterT0, snapshot } from './helpers';

const STEP_MIN = 10;
const run = (name: string, brain = new Brain()): Promise<DecisionRecord[]> =>
  runScenario(loadScenario(`scenarios/${name}.json`), brain, { stepMin: STEP_MIN });
const at = (records: DecisionRecord[], time: string): DecisionRecord => records.find((r) => r.time.slice(11, 16) === time)!;

describe('replay with forecast errors', () => {
  it('shows the wrong forecast until it is corrected, and never lies about current weather', async () => {
    const provider = new ReplayProvider(loadScenario('scenarios/hail-false-alarm.json'));
    const before = await provider.getSnapshot(new Date('2026-06-18T13:00:00Z'));
    const after = await provider.getSnapshot(new Date('2026-06-18T14:00:00Z'));
    const duringTheHourItWasWrongAbout = await provider.getSnapshot(new Date('2026-06-18T15:00:00Z'));

    expect(before.forecast[1]!.time).toBe('2026-06-18T15:00:00.000Z');
    expect(before.forecast[1]!.weatherCode).toBe(99);
    expect(after.forecast[0]!.weatherCode).toBe(81);
    expect(duringTheHourItWasWrongAbout.current.weatherCode).toBe(81);
  });
});

describe('hail false alarm', () => {
  it('closes the blinds for the forecast hail and reopens them as soon as the forecast is corrected', async () => {
    const records = await run('hail-false-alarm');
    expect(records.some((r) => isHail(r.weather.weatherCode))).toBe(false);

    const guarded = records.filter((r) => r.blinds.ruleId === 'hail-protection');
    expect(guarded[0]!.time).toBe('2026-06-18T13:00:00.000Z');
    expect(guarded).toHaveLength(60 / STEP_MIN);
    expect(at(records, '14:00').command.blinds).toBe('open');
    expect(records.filter((r) => r.command.blinds === 'closed')).toHaveLength(guarded.length);
  });
});

describe('surprise hail', () => {
  const minutesClosedBeforeHail = (records: DecisionRecord[]): number => {
    const firstHail = records.findIndex((r) => isHail(r.weather.weatherCode));
    let i = firstHail;
    while (i > 0 && records[i - 1]!.command.blinds === 'closed') i--;
    return (firstHail - i) * STEP_MIN;
  };

  it('never sees hail in the forecast, yet has the blinds closed two hours early because of the storm', async () => {
    const records = await run('hail-surprise');
    const beforeHail = records.filter((r) => !isHail(r.weather.weatherCode));
    expect(beforeHail.every((r) => r.outlook.hailInMin === null)).toBe(true);

    expect(at(records, '13:00').blinds.ruleId).toBe('storm-precaution');
    expect(minutesClosedBeforeHail(records)).toBe(120);
    for (const r of records.filter((x) => isHail(x.weather.weatherCode))) {
      expect(r.command.blinds).toBe('closed');
      expect(r.blinds.ruleId).toBe('hail-protection');
    }
  });

  it('would get no warning at all without the storm precaution rule', async () => {
    const withoutPrecaution = new Brain(defaultComfort, defaultRules.filter((rule) => rule !== stormPrecaution));
    const records = await run('hail-surprise', withoutPrecaution);
    expect(minutesClosedBeforeHail(records)).toBe(0);
    expect(records.find((r) => isHail(r.weather.weatherCode))!.command.blinds).toBe('closed');
  });
});

describe('storm precaution', () => {
  const home = { temperatureC: 22, humidityPct: 45 };

  it('closes the blinds during a thunderstorm and one hour before a forecast one', () => {
    const now = new Brain().decide({ now: minutesAfterT0(0), snapshot: snapshot({ weatherCode: 95 }), home });
    const soon = new Brain().decide({ now: minutesAfterT0(0), snapshot: snapshot({}, [{ weatherCode: 95 }]), home });
    const later = new Brain().decide({ now: minutesAfterT0(0), snapshot: snapshot({}, [{}, { weatherCode: 95 }]), home });
    expect(now.command.blinds).toBe('closed');
    expect(soon.blinds).toEqual({ ruleId: 'storm-precaution', reason: 'Thunderstorm forecast in 60 min, hail is possible' });
    expect(later.command.blinds).toBe('open');
  });
});

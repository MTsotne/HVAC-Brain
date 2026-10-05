import { describe, expect, it } from 'vitest';
import { absoluteHumidity, relativeHumidity } from '../src/humidity';
import { stepHouse } from '../src/sim/houseModel';
import type { Command } from '../src/types';
import { sample } from './helpers';

const off: Command = { mode: 'off', powerPct: 0, blinds: 'open' };
const home = { temperatureC: 22, humidityPct: 50 };

describe('humidity maths', () => {
  it('converts relative to absolute humidity and back', () => {
    expect(relativeHumidity(22, absoluteHumidity(22, 50))).toBeCloseTo(50, 6);
  });

  it('gives the same air a higher relative humidity when it is colder', () => {
    expect(relativeHumidity(15, absoluteHumidity(22, 50))).toBeGreaterThan(70);
  });
});

describe('house model', () => {
  it('drifts towards the outdoor temperature when everything is off', () => {
    expect(stepHouse(home, sample({ temperatureC: 0 }), off, 1).temperatureC).toBeLessThan(22);
    expect(stepHouse(home, sample({ temperatureC: 35 }), off, 1).temperatureC).toBeGreaterThan(22);
  });

  it('heats, cools and dries in the direction the command says', () => {
    const mild = sample({ temperatureC: 22, humidityPct: 50 });
    const idle = stepHouse(home, mild, off, 1);
    expect(stepHouse(home, mild, { ...off, mode: 'heat', powerPct: 100 }, 1).temperatureC).toBeGreaterThan(idle.temperatureC);
    expect(stepHouse(home, mild, { ...off, mode: 'cool', powerPct: 100 }, 1).temperatureC).toBeLessThan(idle.temperatureC);
    expect(stepHouse(home, mild, { ...off, mode: 'dehumidify', powerPct: 100 }, 1).humidityPct).toBeLessThan(idle.humidityPct);
  });

  it('lets in less sun with the blinds closed', () => {
    const sunny = sample({ temperatureC: 22, solarRadiationWm2: 800 });
    const open = stepHouse(home, sunny, off, 1);
    const closed = stepHouse(home, sunny, { ...off, blinds: 'closed' }, 1);
    expect(closed.temperatureC).toBeLessThan(open.temperatureC);
  });
});

import { describe, expect, it } from 'vitest';
import { Brain } from '../src/brain/brain';
import { PRIORITY, type Rule } from '../src/brain/rules';
import { defaultComfort } from '../src/config';
import { minutesAfterT0, snapshot } from './helpers';

const home = { temperatureC: 22, humidityPct: 45 };

describe('arbitration', () => {
  it('lets the highest priority win, separately for HVAC and blinds', () => {
    const rules: Rule[] = [
      { id: 'low', priority: 10, description: '', evaluate: () => ({ reason: 'low', hvac: { mode: 'heat', powerPct: 50 }, blinds: 'closed' }) },
      { id: 'high', priority: 90, description: '', evaluate: () => ({ reason: 'high', hvac: { mode: 'cool', powerPct: 70 } }) },
    ];
    const record = new Brain(defaultComfort, rules).decide({ now: minutesAfterT0(0), snapshot: snapshot(), home });

    expect(record.command).toEqual({ mode: 'cool', powerPct: 70, blinds: 'closed' });
    expect(record.hvac.ruleId).toBe('high');
    expect(record.blinds.ruleId).toBe('low');
    expect(record.proposals).toHaveLength(2);
  });

  it('turns everything off and opens the blinds when no rule fires', () => {
    const record = new Brain(defaultComfort, []).decide({ now: minutesAfterT0(0), snapshot: snapshot(), home });
    expect(record.command).toEqual({ mode: 'off', powerPct: 0, blinds: 'open' });
  });
});

describe('stabilizer', () => {
  /** A rule whose wish the test can change between decisions. */
  function switchable(priority: number) {
    let wish: ReturnType<Rule['evaluate']> = null;
    const rule: Rule = { id: 'switchable', priority, description: '', evaluate: () => wish };
    return { rule, want: (next: typeof wish) => (wish = next) };
  }

  it('postpones an HVAC mode change that comes too soon, and explains why', () => {
    const { rule, want } = switchable(PRIORITY.comfort);
    const brain = new Brain(defaultComfort, [rule]);

    want({ reason: 'cold', hvac: { mode: 'heat', powerPct: 60 } });
    expect(brain.decide({ now: minutesAfterT0(0), snapshot: snapshot(), home }).command.mode).toBe('heat');

    want({ reason: 'hot', hvac: { mode: 'cool', powerPct: 60 } });
    const tooSoon = brain.decide({ now: minutesAfterT0(10), snapshot: snapshot(), home });
    expect(tooSoon.command.mode).toBe('heat');
    expect(tooSoon.notes[0]).toMatch(/stays on "heat"/);

    const later = brain.decide({ now: minutesAfterT0(defaultComfort.minModeDwellMin), snapshot: snapshot(), home });
    expect(later.command.mode).toBe('cool');
    expect(later.notes).toEqual([]);
  });

  it('lets a power change through without waiting', () => {
    const { rule, want } = switchable(PRIORITY.comfort);
    const brain = new Brain(defaultComfort, [rule]);
    want({ reason: 'cold', hvac: { mode: 'heat', powerPct: 60 } });
    brain.decide({ now: minutesAfterT0(0), snapshot: snapshot(), home });
    want({ reason: 'colder', hvac: { mode: 'heat', powerPct: 90 } });
    expect(brain.decide({ now: minutesAfterT0(10), snapshot: snapshot(), home }).command.powerPct).toBe(90);
  });

  it('holds the blinds for the dwell time, except for safety rules', () => {
    for (const [priority, expected] of [[PRIORITY.shading, 'closed'], [PRIORITY.safety, 'open']] as const) {
      const { rule, want } = switchable(priority);
      const brain = new Brain(defaultComfort, [rule]);
      want({ reason: 'close', blinds: 'closed' });
      brain.decide({ now: minutesAfterT0(0), snapshot: snapshot(), home });
      want({ reason: 'open', blinds: 'open' });
      expect(brain.decide({ now: minutesAfterT0(10), snapshot: snapshot(), home }).command.blinds).toBe(expected);
    }
  });
});

describe('default rules', () => {
  it('keeps heating until the setpoint is reached, not just until the start threshold', () => {
    const brain = new Brain();
    const cold = snapshot({ temperatureC: 5 });
    expect(brain.decide({ now: minutesAfterT0(0), snapshot: cold, home: { temperatureC: 20.8, humidityPct: 40 } }).command.mode).toBe('heat');
    // 21.5 °C is inside the deadband: a fresh brain would do nothing, a heating one carries on.
    expect(brain.decide({ now: minutesAfterT0(30), snapshot: cold, home: { temperatureC: 21.5, humidityPct: 40 } }).command.mode).toBe('heat');
    expect(new Brain().decide({ now: minutesAfterT0(30), snapshot: cold, home: { temperatureC: 21.5, humidityPct: 40 } }).command.mode).toBe('off');
    expect(brain.decide({ now: minutesAfterT0(60), snapshot: cold, home: { temperatureC: 22.1, humidityPct: 40 } }).command.mode).toBe('off');
  });

  it('never heats when it is warmer outside than the setpoint', () => {
    const record = new Brain().decide({
      now: minutesAfterT0(0),
      snapshot: snapshot({ temperatureC: 31 }),
      home: { temperatureC: 20.5, humidityPct: 40 },
    });
    expect(record.command.mode).toBe('off');
  });

  it('ventilates instead of cooling when outdoor air is cool and dry', () => {
    const warmHome = { temperatureC: 23.5, humidityPct: 45 };
    const coolOutside = new Brain().decide({ now: minutesAfterT0(0), snapshot: snapshot({ temperatureC: 16, humidityPct: 50 }), home: warmHome });
    const hotOutside = new Brain().decide({ now: minutesAfterT0(0), snapshot: snapshot({ temperatureC: 28, humidityPct: 50 }), home: warmHome });
    expect(coolOutside.command.mode).toBe('ventilate');
    expect(coolOutside.proposals.map((p) => p.ruleId)).toContain('cool-when-hot');
    expect(hotOutside.command.mode).toBe('cool');
  });

  it('uses a stricter humidity limit when rain is about to start', () => {
    const damp = { temperatureC: 22, humidityPct: 57 };
    const dry = new Brain().decide({ now: minutesAfterT0(0), snapshot: snapshot({}, [{}]), home: damp });
    const rainNextHour = new Brain().decide({ now: minutesAfterT0(0), snapshot: snapshot({}, [{ weatherCode: 63, precipitationMm: 3 }]), home: damp });
    expect(dry.command.mode).toBe('off');
    expect(rainNextHour.command.mode).toBe('dehumidify');
  });

  it('closes the blinds two hours before forecast hail, but not earlier', () => {
    const hailInThreeHours = snapshot({}, [{}, {}, { weatherCode: 99 }]);
    const brain = new Brain();
    expect(brain.decide({ now: minutesAfterT0(0), snapshot: hailInThreeHours, home }).command.blinds).toBe('open');
    const record = brain.decide({ now: minutesAfterT0(60), snapshot: hailInThreeHours, home });
    expect(record.command.blinds).toBe('closed');
    expect(record.blinds).toEqual({ ruleId: 'hail-protection', reason: 'Hail forecast in 120 min' });
    expect(record.outlook.hailInMin).toBe(120);
  });

  it('shifts the setpoint ahead of a heat wave and returns it once the heat has arrived', () => {
    const before = new Brain().decide({ now: minutesAfterT0(0), snapshot: snapshot({ temperatureC: 24 }, [{ temperatureC: 28 }, { temperatureC: 33 }]), home });
    const during = new Brain().decide({ now: minutesAfterT0(0), snapshot: snapshot({ temperatureC: 33 }, [{ temperatureC: 34 }]), home });
    expect(before.setpoint.temperatureC).toBe(defaultComfort.targetTemperatureC - defaultComfort.preconditionOffsetC);
    expect(before.setpoint.reason).toMatch(/pre-cooling/);
    expect(during.setpoint).toEqual({ temperatureC: defaultComfort.targetTemperatureC, shiftC: 0, reason: null });
  });
});

describe('configuration', () => {
  it('rejects a precondition offset that would make rules fight', () => {
    expect(() => new Brain({ ...defaultComfort, preconditionOffsetC: 1.5 })).toThrow(/preconditionOffsetC/);
  });
});

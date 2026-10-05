import { describe, expect, it } from 'vitest';
import { Brain } from '../src/brain/brain';
import { runCycle } from '../src/controller';
import { renderDashboard } from '../src/dashboard/build';
import type { Actuator, HomeSensor } from '../src/home/ports';
import type { Command, DecisionRecord } from '../src/types';
import { minutesAfterT0, snapshot } from './helpers';

describe('control loop', () => {
  it('reads the sensor, sends the decision to the actuator and logs it', async () => {
    const applied: Command[] = [];
    const logged: DecisionRecord[] = [];
    const sensor: HomeSensor = { read: async () => ({ temperatureC: 19.5, humidityPct: 40 }) };
    const actuator: Actuator = { apply: async (command) => void applied.push(command) };

    const record = await runCycle(
      {
        weather: { getSnapshot: async () => snapshot({ temperatureC: 2 }) },
        sensor,
        actuator,
        brain: new Brain(),
        logger: { write: (r) => void logged.push(r) },
      },
      minutesAfterT0(0),
    );

    expect(record.home.temperatureC).toBe(19.5);
    expect(record.command.mode).toBe('heat');
    expect(applied).toEqual([record.command]);
    expect(logged).toEqual([record]);
  });
});

describe('dashboard', () => {
  it('embeds the log in the page as data that cannot break out of its script element', () => {
    const record = new Brain().decide({ now: minutesAfterT0(0), snapshot: snapshot(), home: { temperatureC: 22, humidityPct: 45 } });
    const hostile = { ...record, notes: ['</script><script>alert(1)</script>'] };
    const html = renderDashboard('my-log', [hostile]);

    expect(html).not.toContain('"__HVAC_DATA__"');
    expect(html).not.toContain('</script><script>alert(1)');
    const embedded = JSON.parse(html.match(/<script id="hvac-data" type="application\/json">(.*?)<\/script>/s)![1]!);
    expect(embedded.name).toBe('my-log');
    expect(embedded.records[0].notes).toEqual(hostile.notes);
  });
});

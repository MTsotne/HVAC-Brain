import type { Brain } from './brain/brain';
import type { Actuator, HomeSensor } from './home/ports';
import type { DecisionLogger } from './log/logger';
import type { DecisionRecord } from './types';
import type { WeatherProvider } from './weather/provider';

export interface ControlLoop {
  weather: WeatherProvider;
  sensor: HomeSensor;
  actuator: Actuator;
  brain: Brain;
  logger?: DecisionLogger;
}

/** One pass of the control loop: observe, decide, act, record. */
export async function runCycle(loop: ControlLoop, now: Date): Promise<DecisionRecord> {
  const [snapshot, home] = await Promise.all([loop.weather.getSnapshot(now), loop.sensor.read()]);
  const record = loop.brain.decide({ now, snapshot, home });
  await loop.actuator.apply(record.command);
  loop.logger?.write(record);
  return record;
}

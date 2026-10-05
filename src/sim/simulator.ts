import type { Brain } from '../brain/brain';
import { runCycle } from '../controller';
import type { DecisionLogger } from '../log/logger';
import type { DecisionRecord } from '../types';
import { ReplayProvider, type Scenario } from '../weather/replay';
import { defaultHouse, type HouseParams } from './houseModel';
import { SimulatedHome } from './simulatedHome';

export interface SimulationOptions {
  stepMin?: number;
  house?: HouseParams;
  logger?: DecisionLogger;
}

/**
 * Runs the brain through a scenario: at every step it sees the weather and the
 * state of the simulated house, decides, and the house then reacts to the decision.
 */
export async function runScenario(
  scenario: Scenario,
  brain: Brain,
  { stepMin = 10, house = defaultHouse, logger }: SimulationOptions = {},
): Promise<DecisionRecord[]> {
  const weather = new ReplayProvider(scenario);
  const home = new SimulatedHome(scenario.initialHome, house);
  const loop = { weather, sensor: home, actuator: home, brain, logger };
  const records: DecisionRecord[] = [];

  for (let t = Date.parse(scenario.start); t < weather.endTime; t += stepMin * 60_000) {
    const record = await runCycle(loop, new Date(t));
    records.push(record);
    home.advance(record.weather, stepMin / 60);
  }
  return records;
}

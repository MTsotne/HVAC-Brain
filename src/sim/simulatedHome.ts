import type { Actuator, HomeSensor } from '../home/ports';
import type { Command, HomeState, WeatherSample } from '../types';
import { defaultHouse, stepHouse, type HouseParams } from './houseModel';

/** A house that exists only in memory: it is both the sensor and the actuator. */
export class SimulatedHome implements HomeSensor, Actuator {
  private state: HomeState;
  private command: Command = { mode: 'off', powerPct: 0, blinds: 'open' };

  constructor(
    initial: HomeState,
    private readonly params: HouseParams = defaultHouse,
  ) {
    this.state = { ...initial };
  }

  async read(): Promise<HomeState> {
    return { ...this.state };
  }

  async apply(command: Command): Promise<void> {
    this.command = command;
  }

  /** Lets time pass under the last command. A real house does this by itself. */
  advance(weather: WeatherSample, hours: number): void {
    this.state = stepHouse(this.state, weather, this.command, hours, this.params);
  }
}

import type { WeatherSnapshot } from '../types';

/**
 * Where the brain gets its weather. The live implementation calls a weather API,
 * the replay implementation reads a scenario file, and the brain cannot tell them apart.
 */
export interface WeatherProvider {
  getSnapshot(at: Date): Promise<WeatherSnapshot>;
}

import type { Command, HomeState } from '../types';

/**
 * The two places where a real installation plugs in. The brain and the control
 * loop only know these interfaces, so swapping the simulated house for real
 * hardware means writing two small adapters and changing nothing else.
 */

/** Reads the indoor climate, e.g. from a thermostat, a Zigbee sensor or Home Assistant. */
export interface HomeSensor {
  read(): Promise<HomeState>;
}

/** Carries out a command, e.g. over Modbus, MQTT or a vendor's cloud API. */
export interface Actuator {
  apply(command: Command): Promise<void>;
}

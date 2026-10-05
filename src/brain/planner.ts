import type { ComfortConfig } from '../config';
import type { Outlook, Setpoint, WeatherSample } from '../types';

/**
 * Chooses the temperature the comfort rules should aim for right now.
 *
 * Normally that is the configured target. When a heat wave is forecast but has
 * not arrived yet, the setpoint is lowered so the house goes into it pre-cooled;
 * ahead of a cold snap it is raised. Because every comfort rule tracks this one
 * setpoint, planning ahead can never make two rules fight each other.
 */
export function planSetpoint(weather: WeatherSample, outlook: Outlook, c: ComfortConfig): Setpoint {
  const outdoor = weather.temperatureC;
  if (outlook.maxTemperatureC >= c.heatWaveThresholdC && outdoor < c.heatWaveThresholdC) {
    return {
      temperatureC: c.targetTemperatureC - c.preconditionOffsetC,
      shiftC: -c.preconditionOffsetC,
      reason: `pre-cooling, ${outlook.maxTemperatureC.toFixed(1)} °C forecast within ${c.planningHorizonH} h`,
    };
  }
  if (outlook.minTemperatureC <= c.coldSnapThresholdC && outdoor > c.coldSnapThresholdC) {
    return {
      temperatureC: c.targetTemperatureC + c.preconditionOffsetC,
      shiftC: c.preconditionOffsetC,
      reason: `pre-heating, ${outlook.minTemperatureC.toFixed(1)} °C forecast within ${c.planningHorizonH} h`,
    };
  }
  return { temperatureC: c.targetTemperatureC, shiftC: 0, reason: null };
}

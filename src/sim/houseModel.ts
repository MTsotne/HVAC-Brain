import { absoluteHumidity, relativeHumidity } from '../humidity';
import type { Command, HomeState, WeatherSample } from '../types';

/**
 * A deliberately simple model of a house, used only to close the loop in
 * simulation so the brain's decisions have consequences. It is not calibrated
 * against a real building.
 */
export interface HouseParams {
  /** Hours for the indoor/outdoor temperature gap to shrink to ~37 % with everything off. */
  thermalTimeConstantH: number;
  /** Warming from people and appliances, °C per hour. */
  internalGainCPerH: number;
  /** Warming from sun at 1000 W/m² with open blinds, °C per hour. */
  solarGainCPerH: number;
  /** Share of solar gain that still gets through closed blinds. */
  closedBlindsSolarFactor: number;
  /** °C per hour at 100 % power. */
  heatingCPerH: number;
  coolingCPerH: number;
  /** Share of the indoor/outdoor temperature gap closed per hour by ventilation at 100 %. */
  ventilationCouplingPerH: number;
  /** Air changes per hour through leaks, and added by ventilation at 100 %. */
  infiltrationAirChangesPerH: number;
  ventilationAirChangesPerH: number;
  /** Moisture from people, cooking and showers, g/m³ per hour. */
  moistureGainPerH: number;
  /** Moisture removed at 100 % power, g/m³ per hour. */
  dehumidifyPerH: number;
  coolingDehumidifyPerH: number;
}

export const defaultHouse: HouseParams = {
  thermalTimeConstantH: 14,
  internalGainCPerH: 0.12,
  solarGainCPerH: 1.0,
  closedBlindsSolarFactor: 0.25,
  heatingCPerH: 4,
  coolingCPerH: 3,
  ventilationCouplingPerH: 0.6,
  infiltrationAirChangesPerH: 0.3,
  ventilationAirChangesPerH: 2,
  moistureGainPerH: 0.35,
  dehumidifyPerH: 2,
  coolingDehumidifyPerH: 0.8,
};

/** Advances the house by `hours` under constant weather and a constant command. */
export function stepHouse(
  home: HomeState,
  weather: WeatherSample,
  command: Command,
  hours: number,
  p: HouseParams = defaultHouse,
): HomeState {
  const power = command.powerPct / 100;
  const ventilating = command.mode === 'ventilate' ? power : 0;

  // Moisture: outdoor air mixes in, the household adds some, the HVAC may remove some.
  let water = absoluteHumidity(home.temperatureC, home.humidityPct);
  const outdoorWater = absoluteHumidity(weather.temperatureC, weather.humidityPct);
  const airChanges = p.infiltrationAirChangesPerH + p.ventilationAirChangesPerH * ventilating;
  water += (outdoorWater - water) * (1 - Math.exp(-airChanges * hours));
  water += p.moistureGainPerH * hours;
  if (command.mode === 'dehumidify') water -= p.dehumidifyPerH * power * hours;
  if (command.mode === 'cool') water -= p.coolingDehumidifyPerH * power * hours;
  water = Math.max(0, water);

  // Temperature: envelope losses, internal and solar gains, then the HVAC.
  const solarFactor = command.blinds === 'closed' ? p.closedBlindsSolarFactor : 1;
  let temperature = home.temperatureC;
  temperature += ((weather.temperatureC - temperature) / p.thermalTimeConstantH) * hours;
  temperature += p.internalGainCPerH * hours;
  temperature += p.solarGainCPerH * (weather.solarRadiationWm2 / 1000) * solarFactor * hours;
  if (command.mode === 'heat') temperature += p.heatingCPerH * power * hours;
  if (command.mode === 'cool') temperature -= p.coolingCPerH * power * hours;
  if (ventilating > 0) {
    temperature += (weather.temperatureC - temperature) * (1 - Math.exp(-p.ventilationCouplingPerH * ventilating * hours));
  }

  return { temperatureC: temperature, humidityPct: relativeHumidity(temperature, water) };
}

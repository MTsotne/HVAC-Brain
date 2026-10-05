/** Saturation vapour pressure in hPa (Magnus formula). */
const saturationPressure = (tempC: number): number =>
  6.112 * Math.exp((17.62 * tempC) / (243.12 + tempC));

/** Water content of air in g/m³ for a temperature and relative humidity. */
export function absoluteHumidity(tempC: number, relativePct: number): number {
  return (216.7 * (relativePct / 100) * saturationPressure(tempC)) / (273.15 + tempC);
}

/** Relative humidity (%) that air holding `gramsPerM3` of water has at `tempC`. */
export function relativeHumidity(tempC: number, gramsPerM3: number): number {
  const pct = (gramsPerM3 * (273.15 + tempC)) / (216.7 * saturationPressure(tempC)) * 100;
  return Math.min(100, Math.max(0, pct));
}

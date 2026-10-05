/**
 * WMO weather interpretation codes, as used by Open-Meteo.
 * 0 clear, 1-3 clouds, 45/48 fog, 51-57 drizzle, 61-67 rain, 71-77 snow,
 * 80-82 rain showers, 85/86 snow showers, 95 thunderstorm, 96/99 thunderstorm with hail.
 */
import type { WeatherSample } from '../types';

export const isHail = (code: number): boolean => code === 96 || code === 99;

export const isThunderstorm = (code: number): boolean => code === 95 || isHail(code);

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

/** True if the sample has rain, judged by code or by measurable precipitation. */
export const isRaining = (s: WeatherSample): boolean =>
  RAIN_CODES.has(s.weatherCode) || s.precipitationMm >= 0.2;

export function describeCode(code: number): string {
  if (code === 0) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code === 85 || code === 86) return 'snow showers';
  if (code === 95) return 'thunderstorm';
  if (isHail(code)) return 'hail';
  return `code ${code}`;
}

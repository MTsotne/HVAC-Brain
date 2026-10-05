import { describe, expect, it } from 'vitest';
import { buildUrl, parseHourly, toSnapshot, type OpenMeteoResponse } from '../src/weather/openMeteo';
import { ReplayProvider, loadScenario } from '../src/weather/replay';

const HOUR = 3600;
const start = Date.parse('2026-10-05T00:00:00Z') / 1000;

/** Shaped like an Open-Meteo forecast response requested with timeformat=unixtime. */
const response: OpenMeteoResponse = {
  hourly: {
    time: [start, start + HOUR, start + 2 * HOUR, start + 3 * HOUR],
    temperature_2m: [9.1, 8.7, 8.4, 8.9],
    relative_humidity_2m: [88, 90, 91, 89],
    precipitation: [0, 0.4, 1.2, 0],
    weather_code: [3, 61, 63, 3],
    cloud_cover: [100, 100, 100, 90],
    wind_gusts_10m: [22.3, 25.9, 31.0, null],
    shortwave_radiation: [0, 0, 0, 12],
  },
};

describe('Open-Meteo', () => {
  it('asks for the configured place and every variable the brain needs', () => {
    const url = new URL(buildUrl(55.93, 23.32));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('55.93');
    expect(url.searchParams.get('longitude')).toBe('23.32');
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    expect(url.searchParams.get('hourly')!.split(',')).toEqual(
      expect.arrayContaining(['temperature_2m', 'relative_humidity_2m', 'precipitation', 'weather_code', 'shortwave_radiation']),
    );
  });

  it('turns the column-oriented response into hourly samples', () => {
    const samples = parseHourly(response);
    expect(samples).toHaveLength(4);
    expect(samples[1]).toEqual({
      time: '2026-10-05T01:00:00.000Z',
      temperatureC: 8.7,
      humidityPct: 90,
      precipitationMm: 0.4,
      weatherCode: 61,
      cloudCoverPct: 100,
      windGustKmh: 25.9,
      solarRadiationWm2: 0,
    });
  });

  it('treats a missing value as zero instead of crashing', () => {
    expect(parseHourly(response)[3]!.windGustKmh).toBe(0);
  });

  it('uses the hour containing "now" as current and the rest as forecast', () => {
    const snap = toSnapshot(parseHourly(response), new Date('2026-10-05T01:40:00Z'));
    expect(snap.current.time).toBe('2026-10-05T01:00:00.000Z');
    expect(snap.forecast.map((s) => s.time)).toEqual(['2026-10-05T02:00:00.000Z', '2026-10-05T03:00:00.000Z']);
  });

  it('refuses to guess when the data does not cover "now"', () => {
    expect(() => toSnapshot(parseHourly(response), new Date('2026-10-04T12:00:00Z'))).toThrow(/No weather data/);
  });
});

describe('scenario replay', () => {
  it('serves the scripted hour as current and the following hours as forecast', async () => {
    const provider = new ReplayProvider(loadScenario('scenarios/hailstorm.json'));
    const snap = await provider.getSnapshot(new Date('2026-07-14T13:30:00Z'));
    expect(snap.current.time).toBe('2026-07-14T13:00:00.000Z');
    expect(snap.forecast[0]!.time).toBe('2026-07-14T14:00:00.000Z');
    expect(snap.forecast[1]!.weatherCode).toBe(99);
  });

  it('fails clearly outside the scenario', async () => {
    const provider = new ReplayProvider(loadScenario('scenarios/hailstorm.json'));
    await expect(provider.getSnapshot(new Date('2026-07-20T00:00:00Z'))).rejects.toThrow(/does not cover/);
  });
});

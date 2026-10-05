import { readFileSync } from 'node:fs';
import type { DecisionRecord, HvacMode, WeatherSample } from '../types';
import { isHail, isRaining, isThunderstorm } from '../weather/codes';

const HOUR_MS = 3_600_000;

export function readLog(path: string): DecisionRecord[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      try {
        return JSON.parse(line) as DecisionRecord;
      } catch {
        throw new Error(`${path}: line ${i + 1} is not valid JSON`);
      }
    });
}

/** The log repeats each hour's weather at every decision; this keeps one sample per hour, in time order. */
export function hourlyWeather(records: DecisionRecord[]): WeatherSample[] {
  const byHour = new Map<string, WeatherSample>();
  for (const r of records) byHour.set(r.weather.time, r.weather);
  return [...byHour.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

export type SpellKind = 'rain' | 'thunderstorm' | 'hail' | 'heat' | 'frost';

/** An unbroken run of hours with the same kind of weather. */
export interface Spell {
  kind: SpellKind;
  start: string;
  hours: number;
  /** Rain: total mm. Heat: highest °C. Frost: lowest °C. Otherwise undefined. */
  extreme?: number;
}

const SPELL_TESTS: Record<SpellKind, (s: WeatherSample) => boolean> = {
  rain: isRaining,
  thunderstorm: (s) => isThunderstorm(s.weatherCode),
  hail: (s) => isHail(s.weatherCode),
  heat: (s) => s.temperatureC >= 30,
  frost: (s) => s.temperatureC <= 0,
};

function extremeOf(kind: SpellKind, run: WeatherSample[]): number | undefined {
  if (kind === 'rain') return Number(run.reduce((sum, s) => sum + s.precipitationMm, 0).toFixed(1));
  if (kind === 'heat') return Math.max(...run.map((s) => s.temperatureC));
  if (kind === 'frost') return Math.min(...run.map((s) => s.temperatureC));
  return undefined;
}

/** A gap in the log (the program was not running) ends a spell. */
const follows = (a: WeatherSample, b: WeatherSample): boolean => Date.parse(b.time) - Date.parse(a.time) === HOUR_MS;

export function findSpells(hourly: WeatherSample[]): Spell[] {
  const spells: Spell[] = [];
  for (const kind of Object.keys(SPELL_TESTS) as SpellKind[]) {
    let run: WeatherSample[] = [];
    const close = (): void => {
      if (run.length > 0) spells.push({ kind, start: run[0]!.time, hours: run.length, extreme: extremeOf(kind, run) });
      run = [];
    };
    for (const sample of hourly) {
      const last = run.at(-1);
      if (last && !follows(last, sample)) close();
      if (SPELL_TESTS[kind](sample)) run.push(sample);
      else close();
    }
    close();
  }
  return spells.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** What the three hours before each start of rain looked like. */
export interface RainPrecursors {
  onsets: number;
  /** Onsets where outdoor humidity rose by at least 5 points in the 3 hours before. */
  withRisingHumidity: number;
  /** Onsets where gusts picked up by at least 10 km/h in the 3 hours before. */
  withRisingGusts: number;
  meanHumidityChangePct: number;
  meanTemperatureChangeC: number;
}

export function rainPrecursors(hourly: WeatherSample[]): RainPrecursors {
  const result: RainPrecursors = { onsets: 0, withRisingHumidity: 0, withRisingGusts: 0, meanHumidityChangePct: 0, meanTemperatureChangeC: 0 };
  let humidity = 0;
  let temperature = 0;
  for (let i = 3; i < hourly.length; i++) {
    const window = hourly.slice(i - 3, i + 1);
    const unbroken = window.every((s, k) => k === 0 || follows(window[k - 1]!, s));
    const [first, , before, onset] = window as [WeatherSample, WeatherSample, WeatherSample, WeatherSample];
    // Three dry hours and then rain, so the same spell is not counted twice.
    if (!unbroken || !isRaining(onset) || window.slice(0, 3).some(isRaining)) continue;
    result.onsets++;
    humidity += before.humidityPct - first.humidityPct;
    temperature += before.temperatureC - first.temperatureC;
    if (before.humidityPct - first.humidityPct >= 5) result.withRisingHumidity++;
    if (before.windGustKmh - first.windGustKmh >= 10) result.withRisingGusts++;
  }
  if (result.onsets > 0) {
    result.meanHumidityChangePct = Number((humidity / result.onsets).toFixed(1));
    result.meanTemperatureChangeC = Number((temperature / result.onsets).toFixed(1));
  }
  return result;
}

/** Average outdoor temperature by hour of day (UTC). Null until every hour has been seen. */
export interface DailyCycle {
  warmestHourUtc: number;
  coldestHourUtc: number;
  meanSwingC: number;
}

export function dailyCycle(hourly: WeatherSample[]): DailyCycle | null {
  const sums = Array.from({ length: 24 }, () => ({ total: 0, n: 0 }));
  for (const s of hourly) {
    const slot = sums[new Date(s.time).getUTCHours()]!;
    slot.total += s.temperatureC;
    slot.n++;
  }
  if (sums.some((s) => s.n === 0)) return null;
  const means = sums.map((s) => s.total / s.n);
  const max = Math.max(...means);
  const min = Math.min(...means);
  return { warmestHourUtc: means.indexOf(max), coldestHourUtc: means.indexOf(min), meanSwingC: Number((max - min).toFixed(1)) };
}

/** How one stretch of protectively closed blinds turned out. */
export interface ProtectionEvent {
  start: string;
  minutes: number;
  /** Minutes the blinds were already closed when hail began, or null if no hail came. */
  leadMinutes: number | null;
  outcome: 'hail' | 'no hail';
}

const PROTECTIVE = new Set(['hail-protection', 'storm-precaution']);

/** Every stretch where a safety rule held the blinds closed, and whether hail actually fell during it. */
export function protectionEvents(records: DecisionRecord[]): ProtectionEvent[] {
  const events: ProtectionEvent[] = [];
  let run: DecisionRecord[] = [];
  const close = (next?: DecisionRecord): void => {
    if (run.length === 0) return;
    const start = Date.parse(run[0]!.time);
    const end = next ? Date.parse(next.time) : Date.parse(run.at(-1)!.time);
    const firstHail = run.find((r) => isHail(r.weather.weatherCode));
    events.push({
      start: run[0]!.time,
      minutes: Math.round((end - start) / 60_000),
      leadMinutes: firstHail ? Math.round((Date.parse(firstHail.time) - start) / 60_000) : null,
      outcome: firstHail ? 'hail' : 'no hail',
    });
    run = [];
  };
  for (const r of records) {
    if (r.command.blinds === 'closed' && PROTECTIVE.has(r.blinds.ruleId)) run.push(r);
    else close(r);
  }
  close();
  return events;
}

export interface RuleShare {
  ruleId: string;
  hours: number;
}

export interface Analysis {
  from: string;
  to: string;
  hoursOfWeather: number;
  spells: Spell[];
  rain: RainPrecursors;
  cycle: DailyCycle | null;
  protection: ProtectionEvent[];
  hoursByMode: Record<HvacMode, number>;
  hvacRules: RuleShare[];
  postponedChanges: number;
}

/** Time each record stands for: until the next record, capped so a gap in the log is not counted. */
function durationsH(records: DecisionRecord[]): number[] {
  const gaps = records.map((r, i) => (records[i + 1] ? Date.parse(records[i + 1]!.time) - Date.parse(r.time) : NaN));
  const known = gaps.filter((g) => Number.isFinite(g)).sort((a, b) => a - b);
  const typical = known[Math.floor(known.length / 2)] ?? 0;
  return gaps.map((g) => (Number.isFinite(g) && g <= typical * 3 ? g : typical) / HOUR_MS);
}

export function analyze(input: DecisionRecord[]): Analysis {
  if (input.length === 0) throw new Error('The log is empty');
  const records = [...input].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const hourly = hourlyWeather(records);
  const durations = durationsH(records);

  const hoursByMode: Record<HvacMode, number> = { off: 0, heat: 0, cool: 0, ventilate: 0, dehumidify: 0 };
  const byRule = new Map<string, number>();
  records.forEach((r, i) => {
    hoursByMode[r.command.mode] += durations[i]!;
    if (r.command.mode !== 'off') byRule.set(r.hvac.ruleId, (byRule.get(r.hvac.ruleId) ?? 0) + durations[i]!);
  });

  return {
    from: records[0]!.time,
    to: records.at(-1)!.time,
    hoursOfWeather: hourly.length,
    spells: findSpells(hourly),
    rain: rainPrecursors(hourly),
    cycle: dailyCycle(hourly),
    protection: protectionEvents(records),
    hoursByMode,
    hvacRules: [...byRule].map(([ruleId, hours]) => ({ ruleId, hours })).sort((a, b) => b.hours - a.hours),
    postponedChanges: records.filter((r) => r.notes.length > 0).length,
  };
}

const when = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

function describeSpell(s: Spell): string {
  const detail =
    s.kind === 'rain' ? `, ${s.extreme} mm` : s.kind === 'heat' ? `, up to ${s.extreme} °C` : s.kind === 'frost' ? `, down to ${s.extreme} °C` : '';
  return `  ${when(s.start)}  ${s.kind.padEnd(12)} ${String(s.hours).padStart(3)} h${detail}`;
}

/** Below this many events a share is an anecdote, and the report says so. */
const ENOUGH_EVENTS = 5;

export function formatAnalysis(a: Analysis): string {
  const lines: string[] = [`Log from ${when(a.from)} to ${when(a.to)} UTC, ${a.hoursOfWeather} hours of weather`, ''];

  lines.push('Weather spells');
  lines.push(...(a.spells.length ? a.spells.map(describeSpell) : ['  none (no rain, storm, hail, heat of 30 °C or frost)']));

  lines.push('', 'Before the rain');
  if (a.rain.onsets === 0) {
    lines.push('  No rain started after at least three dry hours, so there is nothing to compare.');
  } else {
    lines.push(
      `  ${a.rain.onsets} time(s) rain started after three dry hours. In the three hours before:`,
      `  humidity rose by 5 points or more ${a.rain.withRisingHumidity} time(s) (mean change ${a.rain.meanHumidityChangePct} points)`,
      `  gusts picked up by 10 km/h or more ${a.rain.withRisingGusts} time(s)`,
      `  mean temperature change ${a.rain.meanTemperatureChangeC} °C`,
    );
    if (a.rain.onsets < ENOUGH_EVENTS) lines.push(`  With fewer than ${ENOUGH_EVENTS} events this is an observation, not yet a pattern.`);
  }

  lines.push('', 'Daily cycle');
  lines.push(
    a.cycle
      ? `  Warmest around ${String(a.cycle.warmestHourUtc).padStart(2, '0')}:00 UTC, coldest around ${String(a.cycle.coldestHourUtc).padStart(2, '0')}:00 UTC, mean swing ${a.cycle.meanSwingC} °C`
      : '  Needs weather for every hour of the day.',
  );

  lines.push('', 'Blinds closed for protection');
  if (a.protection.length === 0) lines.push('  never');
  for (const e of a.protection) {
    lines.push(
      e.outcome === 'hail'
        ? `  ${when(e.start)}  closed ${e.minutes} min, hail began ${e.leadMinutes} min after closing`
        : `  ${when(e.start)}  closed ${e.minutes} min, no hail came (false alarm or precaution)`,
    );
  }

  lines.push('', 'What the HVAC did');
  const modes = (Object.entries(a.hoursByMode) as [HvacMode, number][]).filter(([, h]) => h > 0);
  lines.push(`  ${modes.map(([mode, h]) => `${mode} ${h.toFixed(1)} h`).join(', ')}`);
  for (const rule of a.hvacRules) lines.push(`  ${rule.ruleId.padEnd(22)} in control for ${rule.hours.toFixed(1)} h`);
  lines.push(`  ${a.postponedChanges} decision(s) where the stabilizer postponed a change`);
  return lines.join('\n');
}

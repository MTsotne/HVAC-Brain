import type { DecisionRecord, HvacMode } from './types';
import { describeCode } from './weather/codes';

export interface Summary {
  hours: number;
  hoursByMode: Record<HvacMode, number>;
  modeChanges: number;
  blindsChanges: number;
  blindsClosedH: number;
  indoorMinC: number;
  indoorMaxC: number;
  indoorMaxHumidityPct: number;
  /** Rough relative effort: power × time, weighted by how expensive each mode is. */
  energyIndex: number;
}

const ENERGY_WEIGHT: Record<HvacMode, number> = { off: 0, heat: 1, cool: 1, dehumidify: 0.4, ventilate: 0.1 };

export function summarize(records: DecisionRecord[], stepMin: number): Summary {
  const dt = stepMin / 60;
  const hoursByMode: Record<HvacMode, number> = { off: 0, heat: 0, cool: 0, ventilate: 0, dehumidify: 0 };
  let modeChanges = 0;
  let blindsChanges = 0;
  let blindsClosedH = 0;
  let energyIndex = 0;
  records.forEach((r, i) => {
    hoursByMode[r.command.mode] += dt;
    energyIndex += (r.command.powerPct / 100) * dt * ENERGY_WEIGHT[r.command.mode];
    if (r.command.blinds === 'closed') blindsClosedH += dt;
    const before = records[i - 1];
    if (before && before.command.mode !== r.command.mode) modeChanges++;
    if (before && before.command.blinds !== r.command.blinds) blindsChanges++;
  });
  const temps = records.map((r) => r.home.temperatureC);
  return {
    hours: records.length * dt,
    hoursByMode,
    modeChanges,
    blindsChanges,
    blindsClosedH,
    indoorMinC: Math.min(...temps),
    indoorMaxC: Math.max(...temps),
    indoorMaxHumidityPct: Math.max(...records.map((r) => r.home.humidityPct)),
    energyIndex: Number(energyIndex.toFixed(2)),
  };
}

const clock = (iso: string): string => `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;

export function formatRecord(r: DecisionRecord): string {
  const hvac = r.command.mode === 'off' ? 'off' : `${r.command.mode} ${r.command.powerPct}%`;
  const idle = r.hvac.ruleId === 'idle';
  const why = [
    idle ? '' : r.hvac.reason,
    idle && r.setpoint.reason ? `Setpoint ${r.setpoint.temperatureC.toFixed(1)} °C (${r.setpoint.reason})` : '',
    r.blinds.ruleId !== 'idle' ? r.blinds.reason : '',
  ]
    .filter(Boolean)
    .join('; ');
  return [
    clock(r.time),
    `out ${r.weather.temperatureC.toFixed(1).padStart(5)}°C ${describeCode(r.weather.weatherCode).padEnd(12)}`,
    `in ${r.home.temperatureC.toFixed(1)}°C ${r.home.humidityPct.toFixed(0).padStart(2)}%`,
    hvac.padEnd(15),
    `blinds ${r.command.blinds.padEnd(6)}`,
    why,
  ].join('  ');
}

/** Only the moments where the command or the setpoint changed, which is what a person wants to read. */
export function formatTimeline(records: DecisionRecord[]): string {
  const lines: string[] = [];
  records.forEach((r, i) => {
    const before = records[i - 1];
    const changed =
      !before ||
      before.command.mode !== r.command.mode ||
      before.command.blinds !== r.command.blinds ||
      before.setpoint.temperatureC !== r.setpoint.temperatureC;
    if (changed) lines.push(formatRecord(r));
  });
  return lines.join('\n');
}

export function formatSummary(s: Summary): string {
  const modes = (Object.entries(s.hoursByMode) as [HvacMode, number][])
    .filter(([, h]) => h > 0)
    .map(([mode, h]) => `${mode} ${h.toFixed(1)} h`)
    .join(', ');
  return [
    `Simulated ${s.hours.toFixed(0)} h: ${modes}`,
    `Indoor temperature ${s.indoorMinC.toFixed(1)} to ${s.indoorMaxC.toFixed(1)} °C, humidity peaked at ${s.indoorMaxHumidityPct.toFixed(0)} %`,
    `${s.modeChanges} HVAC mode changes, ${s.blindsChanges} blinds movements, blinds closed ${s.blindsClosedH.toFixed(1)} h`,
    `Energy index ${s.energyIndex} (relative units)`,
  ].join('\n');
}

import { defaultComfort, validateComfort, type ComfortConfig } from '../config';
import type {
  ActiveChoice,
  BlindsPosition,
  BrainState,
  DecisionRecord,
  HomeState,
  HvacMode,
  Outlook,
  Proposal,
  WeatherSample,
  WeatherSnapshot,
} from '../types';
import { isHail } from '../weather/codes';
import { planSetpoint } from './planner';
import { defaultRules, PRIORITY, type Context, type Rule } from './rules';

const HOUR_MS = 3_600_000;
const IDLE = 'idle';

export interface DecisionInput {
  now: Date;
  snapshot: WeatherSnapshot;
  home: HomeState;
}

function buildOutlook(now: number, weather: WeatherSample, forecast: WeatherSample[], horizonH: number): Outlook {
  const horizon = forecast.filter((s) => Date.parse(s.time) <= now + horizonH * HOUR_MS);
  const window = [weather, ...horizon];
  const temps = window.map((s) => s.temperatureC);
  const hail = window.find((s) => isHail(s.weatherCode));
  return {
    horizonH,
    maxTemperatureC: Math.max(...temps),
    minTemperatureC: Math.min(...temps),
    totalPrecipitationMm: Number(window.reduce((sum, s) => sum + s.precipitationMm, 0).toFixed(1)),
    hailInMin: hail ? Math.max(0, Math.round((Date.parse(hail.time) - now) / 60_000)) : null,
  };
}

/** Highest-priority proposal that has something to say about one actuator. */
function pick<K extends 'hvac' | 'blinds'>(proposals: Proposal[], field: K): Proposal | undefined {
  let best: Proposal | undefined;
  for (const p of proposals) {
    if (p[field] !== undefined && (!best || p.priority > best.priority)) best = p;
  }
  return best;
}

/**
 * The decision engine. Each call to `decide`:
 *   1. plans the setpoint from the forecast,
 *   2. asks every rule for a proposal,
 *   3. lets the highest priority win, separately for HVAC and for blinds,
 *   4. holds back changes that come too soon after the previous one,
 *   5. returns a record of the inputs, all proposals and the outcome.
 */
export class Brain {
  private state: BrainState;

  constructor(
    private readonly comfort: ComfortConfig = defaultComfort,
    private readonly rules: Rule[] = defaultRules,
  ) {
    validateComfort(comfort);
    const never: ActiveChoice = { ruleId: IDLE, reason: 'Initial state', priority: 0, since: -Infinity };
    this.state = {
      command: { mode: 'off', powerPct: 0, blinds: 'open' },
      hvac: { ...never },
      blinds: { ...never },
    };
  }

  decide({ now, snapshot, home: rawHome }: DecisionInput): DecisionRecord {
    const nowMs = now.getTime();
    // Round once, so the rules reason about exactly the numbers that end up in the log.
    const home: HomeState = {
      temperatureC: Number(rawHome.temperatureC.toFixed(1)),
      humidityPct: Number(rawHome.humidityPct.toFixed(1)),
    };
    const outlook = buildOutlook(nowMs, snapshot.current, snapshot.forecast, this.comfort.planningHorizonH);
    const setpoint = planSetpoint(snapshot.current, outlook, this.comfort);
    const ctx: Context = {
      now: nowMs,
      weather: snapshot.current,
      forecast: snapshot.forecast,
      outlook,
      setpoint,
      home,
      previous: this.state,
      comfort: this.comfort,
    };

    const proposals: Proposal[] = [];
    for (const rule of this.rules) {
      const result = rule.evaluate(ctx);
      if (result) proposals.push({ ruleId: rule.id, priority: rule.priority, ...result });
    }

    const notes: string[] = [];
    const previous = this.state;

    // HVAC
    const hvacWinner = pick(proposals, 'hvac');
    let mode: HvacMode = hvacWinner?.hvac?.mode ?? 'off';
    let powerPct = hvacWinner?.hvac?.powerPct ?? 0;
    let hvac: ActiveChoice = {
      ruleId: hvacWinner?.ruleId ?? IDLE,
      reason: hvacWinner?.reason ?? 'No rule asks for the HVAC',
      priority: hvacWinner?.priority ?? 0,
      since: previous.hvac.since,
    };
    if (mode !== previous.command.mode) {
      const elapsedMin = (nowMs - previous.hvac.since) / 60_000;
      if (elapsedMin < this.comfort.minModeDwellMin && hvac.priority < PRIORITY.safety) {
        notes.push(
          `HVAC stays on "${previous.command.mode}": ${hvac.ruleId} wants "${mode}" but the last change was ${Math.round(elapsedMin)} min ago (minimum ${this.comfort.minModeDwellMin})`,
        );
        mode = previous.command.mode;
        powerPct = previous.command.powerPct;
        hvac = previous.hvac;
      } else {
        hvac.since = nowMs;
      }
    }

    // Blinds
    const blindsWinner = pick(proposals, 'blinds');
    let position: BlindsPosition = blindsWinner?.blinds ?? 'open';
    let blinds: ActiveChoice = {
      ruleId: blindsWinner?.ruleId ?? IDLE,
      reason: blindsWinner?.reason ?? 'No rule asks for closed blinds',
      priority: blindsWinner?.priority ?? 0,
      since: previous.blinds.since,
    };
    if (position !== previous.command.blinds) {
      const elapsedMin = (nowMs - previous.blinds.since) / 60_000;
      if (elapsedMin < this.comfort.minBlindsDwellMin && blinds.priority < PRIORITY.safety) {
        notes.push(
          `Blinds stay ${previous.command.blinds}: ${blinds.ruleId} wants them ${position} but they moved ${Math.round(elapsedMin)} min ago (minimum ${this.comfort.minBlindsDwellMin})`,
        );
        position = previous.command.blinds;
        blinds = previous.blinds;
      } else {
        blinds.since = nowMs;
      }
    }

    const command = { mode, powerPct, blinds: position };
    this.state = { command, hvac, blinds };

    return {
      time: now.toISOString(),
      weather: snapshot.current,
      outlook,
      setpoint,
      home,
      proposals,
      command,
      hvac: { ruleId: hvac.ruleId, reason: hvac.reason },
      blinds: { ruleId: blinds.ruleId, reason: blinds.reason },
      notes,
    };
  }
}

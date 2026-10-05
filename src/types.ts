export type HvacMode = 'off' | 'heat' | 'cool' | 'ventilate' | 'dehumidify';
export type BlindsPosition = 'open' | 'closed';

/** Weather for one hour. `time` is the ISO 8601 (UTC) start of that hour. */
export interface WeatherSample {
  time: string;
  temperatureC: number;
  humidityPct: number;
  precipitationMm: number;
  windGustKmh: number;
  cloudCoverPct: number;
  solarRadiationWm2: number;
  /** WMO weather interpretation code, see src/weather/codes.ts */
  weatherCode: number;
}

/** What the brain sees of the outside world at one moment. */
export interface WeatherSnapshot {
  current: WeatherSample;
  /** Hourly samples after `current`, in ascending time order. */
  forecast: WeatherSample[];
}

export interface HomeState {
  temperatureC: number;
  humidityPct: number;
}

/** The brain's output: what the actuators should be doing. */
export interface Command {
  mode: HvacMode;
  powerPct: number;
  blinds: BlindsPosition;
}

/** A rule's suggestion. A rule may speak for the HVAC, the blinds, or both. */
export interface Proposal {
  ruleId: string;
  priority: number;
  reason: string;
  hvac?: { mode: HvacMode; powerPct: number };
  blinds?: BlindsPosition;
}

/** Which rule is currently in control of an actuator, and since when. */
export interface ActiveChoice {
  ruleId: string;
  reason: string;
  priority: number;
  /** Epoch ms of the last change of mode / position. */
  since: number;
}

export interface BrainState {
  command: Command;
  hvac: ActiveChoice;
  blinds: ActiveChoice;
}

export interface Outlook {
  horizonH: number;
  maxTemperatureC: number;
  minTemperatureC: number;
  totalPrecipitationMm: number;
  /** Minutes until the first hour with hail, 0 if it is hailing now, null if none in sight. */
  hailInMin: number | null;
}

/** The temperature the comfort rules aim for at one moment. */
export interface Setpoint {
  temperatureC: number;
  /** Difference from the configured target; non-zero while preconditioning. */
  shiftC: number;
  /** Why the setpoint is shifted, or null when it is not. */
  reason: string | null;
}

/** One line of the decision log: inputs, every proposal, and the outcome. */
export interface DecisionRecord {
  time: string;
  weather: WeatherSample;
  outlook: Outlook;
  setpoint: Setpoint;
  home: HomeState;
  proposals: Proposal[];
  command: Command;
  hvac: { ruleId: string; reason: string };
  blinds: { ruleId: string; reason: string };
  /** Remarks from the stabilizer, e.g. a mode change that was postponed. */
  notes: string[];
}

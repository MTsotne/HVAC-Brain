import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DecisionRecord } from '../types';

const TEMPLATE = fileURLToPath(new URL('../../dashboard/template.html', import.meta.url));
const PLACEHOLDER = '"__HVAC_DATA__"';

/** Returns the dashboard page with a log embedded in it, so the one file can be opened or shared as is. */
export function renderDashboard(name: string, records: DecisionRecord[]): string {
  const template = readFileSync(TEMPLATE, 'utf8');
  if (!template.includes(PLACEHOLDER)) throw new Error('dashboard/template.html has lost its data placeholder');
  // "<" is escaped so that nothing in the log can close the script element early.
  const data = JSON.stringify({ name, records }).replace(/</g, '\\u003c');
  return template.replace(PLACEHOLDER, () => data);
}

export function buildDashboard(name: string, records: DecisionRecord[], outPath: string): void {
  writeFileSync(outPath, renderDashboard(name, records));
}

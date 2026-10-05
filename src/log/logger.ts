import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DecisionRecord } from '../types';

export interface DecisionLogger {
  write(record: DecisionRecord): void;
}

/** One JSON object per line, so logs can be grepped, tailed and loaded line by line. */
export class JsonlLogger implements DecisionLogger {
  constructor(
    private readonly path: string,
    options: { truncate?: boolean } = {},
  ) {
    mkdirSync(dirname(path), { recursive: true });
    if (options.truncate) writeFileSync(path, '');
  }

  write(record: DecisionRecord): void {
    appendFileSync(this.path, JSON.stringify(record) + '\n');
  }
}

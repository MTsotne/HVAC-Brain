import { basename } from 'node:path';
import { analyze, formatAnalysis, readLog } from './analysis/patterns';
import { Brain } from './brain/brain';
import { loadConfig, defaultComfort } from './config';
import { buildDashboard } from './dashboard/build';
import { JsonlLogger } from './log/logger';
import { formatRecord, formatSummary, formatTimeline, summarize } from './report';
import { runCycle } from './controller';
import { SimulatedHome } from './sim/simulatedHome';
import { runScenario } from './sim/simulator';
import { OpenMeteoProvider } from './weather/openMeteo';
import { loadScenario } from './weather/replay';

const USAGE = `Usage:
  npm run simulate -- <scenario.json> [--step <minutes>] [--log <file>]
  npm run live [-- --watch] [--interval <minutes>] [--log <file>]
  npm run analyze -- <log.jsonl> [more logs...]
  npm run dashboard -- <log.jsonl> [--out <file.html>]`;

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function simulate(args: string[]): Promise<void> {
  const file = args.find((a) => !a.startsWith('--') && a.endsWith('.json'));
  if (!file) throw new Error(USAGE);
  const scenario = loadScenario(file);
  const stepMin = Number(option(args, '--step') ?? 10);
  const logPath = option(args, '--log') ?? `logs/${basename(file, '.json')}.jsonl`;

  const records = await runScenario(scenario, new Brain(defaultComfort), {
    stepMin,
    logger: new JsonlLogger(logPath, { truncate: true }),
  });

  console.log(`${scenario.name}: ${scenario.description}\n`);
  console.log(formatTimeline(records));
  console.log(`\n${formatSummary(summarize(records, stepMin))}`);
  console.log(`\nFull decision log (times in UTC): ${logPath}`);
}

async function live(args: string[]): Promise<void> {
  const config = loadConfig();
  const watch = args.includes('--watch');
  const intervalMin = Number(option(args, '--interval') ?? 10);

  // There is no real hardware yet, so the simulated house stands in for both the
  // sensor and the actuator. To drive a real installation, implement HomeSensor
  // and Actuator from src/home/ports.ts and pass them here instead.
  const home = new SimulatedHome(config.initialHome);
  const loop = {
    weather: new OpenMeteoProvider(config.location.latitude, config.location.longitude),
    sensor: home,
    actuator: home,
    brain: new Brain(config.comfort),
    logger: new JsonlLogger(option(args, '--log') ?? 'logs/live.jsonl'),
  };
  console.log(`Live weather for ${config.location.name} (Open-Meteo), simulated house. Times in UTC.`);

  for (;;) {
    try {
      const record = await runCycle(loop, new Date());
      console.log(formatRecord(record));
      for (const note of record.notes) console.log(`    note: ${note}`);
      home.advance(record.weather, intervalMin / 60);
    } catch (error) {
      console.error(`Could not decide: ${(error as Error).message}`);
      if (!watch) process.exitCode = 1;
    }
    if (!watch) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMin * 60_000));
  }
}

async function analyzeLogs(args: string[]): Promise<void> {
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) throw new Error(USAGE);
  console.log(formatAnalysis(analyze(files.flatMap(readLog))));
}

async function dashboard(args: string[]): Promise<void> {
  const file = args.find((a) => !a.startsWith('--') && a !== option(args, '--out'));
  if (!file) throw new Error(USAGE);
  const out = option(args, '--out') ?? file.replace(/\.[^.]+$/, '') + '.html';
  buildDashboard(basename(file).replace(/\.[^.]+$/, ''), readLog(file), out);
  console.log(`Dashboard written to ${out}. Open it in a browser.`);
}

const commands: Record<string, (args: string[]) => Promise<void>> = { simulate, live, analyze: analyzeLogs, dashboard };
const [command, ...args] = process.argv.slice(2);
const run = command ? commands[command] : undefined;
if (!run) {
  console.error(USAGE);
  process.exit(1);
}
run(args).catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});

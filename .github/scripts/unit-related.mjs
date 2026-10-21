// A selected run's unit tests (`Selection: affected`, gate-plan.mjs): vitest's related mode over the paths the plan
// gives as JSON in UNIT_RELATED, the suites whose module graph reaches one, passing when none does. With file filters
// (unit:darwin's own set, scripts/darwin-unit-files.sh), only the suites that are both related and filtered: vitest's CLI
// cannot say that (its `related` command takes no filters, and `--related` is no option of `run`), its API can, as
// `startVitest` with both. Otherwise this is the CLI's own start and exit, so the reporters, the JUnit report
// (MAWS_TEST_JUNIT) and the exit status are those of `vitest run`, and the module cache (`fsModuleCache`) that of the
// gate's `--fsModuleCache`.
// Usage: UNIT_RELATED='["src/a.ts",…]' node .github/scripts/unit-related.mjs <max-workers> [file filter…]
import { normalize } from 'node:path';
import process from 'node:process';
import { startVitest } from 'vitest/node';

const [maxWorkers, ...filters] = process.argv.slice(2);
const parsed = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
const related = parsed(process.env.UNIT_RELATED ?? '');
if (!(Number(maxWorkers) >= 1 && Number.isInteger(Number(maxWorkers))) || !Array.isArray(related) || !related.every((path) => typeof path === 'string')) {
  process.stderr.write('unit-related: usage: UNIT_RELATED=<JSON list of paths> node .github/scripts/unit-related.mjs <max-workers> [file filter…]\n');
  process.exit(2);
}
process.stdout.write(`unit-related: vitest related over ${related.length} paths${filters.length > 0 ? `, within ${filters.length} files` : ''}\n`);
try {
  const ctx = await startVitest('test', filters.map(normalize), { run: true, watch: false, related, passWithNoTests: true, maxWorkers: Number(maxWorkers), fsModuleCache: true });
  if (!ctx.shouldKeepServer()) await ctx.exit();
} catch (error) {
  // As the CLI does with an error before the run starts.
  process.stderr.write(`unit-related: ${error?.stack ?? error}\n`);
  process.exitCode ??= 1;
  process.exit();
}

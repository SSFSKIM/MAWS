// A retry stays visible even when it turns the job green: gate-run.sh puts each location in the job summary. A separate
// workflow step publishes the file as one annotation, so the test step's warnings and the per-step cap cannot hide it.
import console from 'node:console';
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { relative } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const escapeData = (value) => value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

export default class FlakyReporter {
  onBegin(_config, suite) { this.suite = suite; }

  onEnd() {
    const lines = new Set();
    for (const test of this.suite.allTests()) {
      if (test.outcome() !== 'flaky') continue;
      lines.add(`flaky: ${relative(root, test.location.file)}:${test.location.line}`);
    }
    for (const line of lines) console.log(line);
    if (lines.size && process.env.MAWS_E2E_FLAKY_FILE) appendFileSync(process.env.MAWS_E2E_FLAKY_FILE, `${[...lines].join('\n')}\n`);
  }
}

// Invoked only by the dedicated publish step; absent when the test command never reached its reporter or had no flakes.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) && existsSync(process.argv[2])) {
  const lines = [...new Set(readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean))];
  // GitHub bounds annotation messages; if a job ever exceeds that limit, its job summary remains the complete record.
  if (lines.length) console.log(`::notice title=MAWS flaky::${escapeData(lines.join('\n'))}`);
}

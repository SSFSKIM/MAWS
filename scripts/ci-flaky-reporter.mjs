// A retry stays visible even when it turns the job green: gate-run.sh puts the location in the job summary, and
// ci-gate-flaky.mjs reads its annotation back for the lander's verdict. Paths are relative to the repo, also for desk-web.
import console from 'node:console';
import { relative } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const escapeData = (value) => value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const escapeProperty = (value) => escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');

export default class FlakyReporter {
  onBegin(_config, suite) { this.suite = suite; }

  onEnd() {
    const seen = new Set();
    for (const test of this.suite.allTests()) {
      if (test.outcome() !== 'flaky') continue;
      const file = relative(root, test.location.file);
      const line = `flaky: ${file}:${test.location.line}`;
      if (seen.has(line)) continue;
      seen.add(line);
      console.log(line);
      console.log(`::warning title=MAWS flaky,file=${escapeProperty(file)},line=${test.location.line}::${escapeData(line)}`);
    }
  }
}

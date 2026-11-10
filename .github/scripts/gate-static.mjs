// Hosted Linux gives each static check its own runner. Keep typecheck's project list in package.json;
// as in gate-bg.sh, split only simple && chains. The pool and Mac still use gate-bg's memory-aware pacing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function staticChecks(scripts) {
  const parts = scripts.typecheck.split(' && ');
  const commands = parts.some((part) => /[|;&()<>`$]/.test(part)) ? [scripts.typecheck] : parts;
  return [
    ...commands.map((command, i) => ({ name: `typecheck-${i + 1}`, command, pattern: 'error TS|problems?\\b' })),
    { name: 'lint', command: 'pnpm lint', pattern: 'error TS|problems?\\b' },
    { name: 'build', command: 'pnpm build', pattern: 'built in|error' },
    ...[1, 2].map((shard) => ({ name: `gate-scripts-${shard}`, command: `node --test --test-shard=${shard}/2 .github/scripts/*.test.mjs scripts/*.test.mjs`, pattern: '^(ℹ|#) (tests|suites|pass|fail|cancelled|skipped|todo) ' })),
    // Run both even when the first fails, as the old job did; either failure fails this job.
    { name: 'session-host', go: true, command: 'go -C native/session-host test -count=1 ./...; go_status=$?; scripts/check-session-host.sh; prebuild_status=$?; test "$go_status" -eq 0 && test "$prebuild_status" -eq 0', pattern: '^(ok|FAIL|--- FAIL|panic:|session-host:)' },
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(staticChecks(JSON.parse(readFileSync('package.json', 'utf8')).scripts)));
}

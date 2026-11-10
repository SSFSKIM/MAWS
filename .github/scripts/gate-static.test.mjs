import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import process from 'node:process';
import { URL } from 'node:url';
import { staticChecks } from './gate-static.mjs';

const workflow = readFileSync(new URL('../workflows/gate.yml', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));

test('every typecheck command gets its own job, including a newly added project', () => {
  const checks = staticChecks({ ...pkg.scripts, typecheck: `${pkg.scripts.typecheck} && echo new-project` });
  const commands = checks.filter(({ name }) => name.startsWith('typecheck-')).map(({ command }) => command);
  assert.deepEqual(commands, [...pkg.scripts.typecheck.split(' && '), 'echo new-project']);
  for (const name of ['lint', 'build']) assert.equal(checks.find((check) => check.name === name).command, `pnpm ${name}`);
  assert.equal(checks.find(({ name }) => name === 'session-host').command, 'go -C native/session-host test -count=1 ./...; go_status=$?; scripts/check-session-host.sh; prebuild_status=$?; test "$go_status" -eq 0 && test "$prebuild_status" -eq 0');
});

test('a compound typecheck that cannot safely split stays a single check', () => {
  assert.deepEqual(staticChecks({ typecheck: 'echo a && (echo b || echo c)' }).filter(({ name }) => name.startsWith('typecheck-')).map(({ command }) => command), ['echo a && (echo b || echo c)']);
});

test('the two test shards cover the same file globs without fail-fast', () => {
  const checks = staticChecks(pkg.scripts).filter(({ name }) => name.startsWith('gate-scripts-'));
  assert.deepEqual(checks.map(({ command }) => command), [1, 2].map((shard) => `node --test --test-shard=${shard}/2 .github/scripts/*.test.mjs scripts/*.test.mjs`));
  assert.match(workflow, /static-checks:[\s\S]*?fail-fast: false/);
});

test('static succeeds only when its selected lane succeeds, never a skipped or failed lane', () => {
  const body = /\n {2}static:\n([\s\S]*?)(?=\n {2}\S)/.exec(workflow)?.[1];
  assert.ok(body, 'the static compatibility result exists');
  assert.match(body, /needs: \[plan, static-checks, static-local\]/);
  assert.match(body, /if:.*!cancelled\(\).*needs.plan.outputs.static == 'true'/);
  const shell = /run: \|\n([\s\S]*)/.exec(body)[1].split('\n').filter((line) => line.startsWith('          ')).map((line) => line.slice(10)).join('\n');
  for (const hosted of ['true', 'false']) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
      const env = { ...process.env, HOSTED: hosted, HOSTED_RESULT: hosted === 'true' ? result : 'skipped', LOCAL_RESULT: hosted === 'false' ? result : 'skipped' };
      assert.equal(spawnSync('bash', ['-c', shell], { env }).status, result === 'success' ? 0 : 1, `${hosted}: ${result}`);
    }
  }
});

// The runtime fonts held a hosted setup for minutes; static never opens a renderer. Other jobs retain them.
test('only a Linux job opting out of fonts omits the runtime font packages', () => {
  const setup = readFileSync(new URL('../actions/setup/action.yml', import.meta.url), 'utf8');
  const expression = /^ {8}skip: \$\{\{ (.*) \}\}$/m.exec(setup)[1];
  const skip = (os, fonts) => Function('runner', 'inputs', `return (${expression});`)({ os, environment: 'self-hosted' }, { fonts });
  assert.equal(skip('Linux', 'false'), 'apt:fonts-noto-cjk apt:fonts-inter apt:fonts-jetbrains-mono');
  assert.equal(skip('Linux', 'true'), '');
  assert.equal(skip('macOS', 'false'), '');
});

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { docsOnlyChange, docsOnlyPaths, checkTracker, checkDecisionLog } from './gate-docs.mjs';
import { planOf } from './gate-plan.mjs';

const scripts = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).scripts;

test('only unread documentation counts: evidence, code, renames across the border, and empty diffs do not', () => {
  assert.equal(docsOnlyPaths(['docs/charter.md', 'docs/doperpowers/plans/records.md']), true);
  for (const paths of [[], ['README.md'], ['docs/doperpowers/evidence/p1-e8/probe.txt'], ['docs/notes.md', 'src/notes.ts'], ['docs/notes.md', 'docs/doperpowers/evidence/p1-e8/probe.txt']]) assert.equal(docsOnlyPaths(paths), false);
});

test('docs replaces static alone, leaves every other gate untouched, and cannot be requested by a caller', () => {
  for (const gates of ['static', 'static,unit,probes', 'unit,probes', '']) {
    const env = { HEAD_MESSAGE: `Gates: ${gates}` };
    const before = planOf(env, scripts, Date.now());
    const after = planOf(env, scripts, Date.now(), { docsOnly: true });
    assert.equal(after.outputs.static, 'false');
    assert.equal(after.outputs.docs, before.outputs.static === 'true' ? 'true' : undefined);
    for (const key of ['unit', 'probes', 'e2e', 'unit_darwin', 'packaged']) assert.equal(after.outputs[key], before.outputs[key]);
    assert.equal(planOf({ ...env, HEAD_MESSAGE: `${env.HEAD_MESSAGE}\nDocs-Only: true` }, scripts).outputs.static, before.outputs.static);
  }
  assert.throws(() => planOf({ HEAD_MESSAGE: 'Gates: docs' }, scripts), /no such gate/);
});

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'gate-docs-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.test');
  const commit = (file, body, message = file) => {
    mkdirSync(join(cwd, file, '..'), { recursive: true }); writeFileSync(join(cwd, file), body);
    git('add', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD');
  };
  const base = commit('docs/notes.md', 'base'); git('update-ref', 'refs/remotes/origin/master', base);
  const nonce = () => { git('commit', '--allow-empty', '-qm', 'ci-gate: test\n\nNonce: 1-2\nGates: static'); return git('rev-parse', 'HEAD'); };
  return { cwd, git, commit, base, nonce };
}

test('git computes nonce changes from its tested parent against master, not the empty nonce diff or caller trailers', (t) => {
  const r = repository(t);
  r.commit('docs/notes.md', 'docs');
  assert.equal(docsOnlyChange(r.cwd, r.nonce()), true);
  r.commit('source.js', 'code', 'pretend docs\n\nDocs-Only: true\nAffected: M\tdocs/notes.md');
  assert.equal(docsOnlyChange(r.cwd, r.nonce()), false);
  r.commit('docs/notes.md', 'more docs');
  assert.equal(docsOnlyChange(r.cwd, r.nonce()), false, 'earlier unmerged code is still part of the change');
});

test('merge heads compare with their first parent; a nonce around a merge still uses the master merge-base', (t) => {
  const r = repository(t);
  const code = r.commit('source.js', 'code');
  r.commit('docs/notes.md', 'docs');
  const tree = r.git('rev-parse', 'HEAD^{tree}');
  const merge = r.git('commit-tree', tree, '-p', code, '-p', r.base, '-m', 'merge records');
  assert.equal(docsOnlyChange(r.cwd, merge), true);
  r.git('reset', '--hard', merge);
  assert.equal(docsOnlyChange(r.cwd, r.nonce()), false);
});

test('a nonce rejects a stacked merge whose source changes cancel against master', (t) => {
  const r = repository(t);
  const master = r.commit('source.js', 'master code');
  r.git('update-ref', 'refs/remotes/origin/master', master);
  const unlanded = r.commit('source.js', 'unlanded code');
  r.git('checkout', '-qb', 'docs', master);
  r.commit('docs/notes.md', 'docs');
  r.git('checkout', '-qb', 'stacked', unlanded);
  r.git('merge', '--no-ff', '--no-commit', 'docs');
  const merge = r.commit('source.js', 'master code', 'merge docs and restore master source');
  assert.equal(r.git('diff', '--name-only', `${merge}^1`, merge), 'docs/notes.md\nsource.js');
  assert.equal(r.git('diff', '--name-only', 'origin/master', merge), 'docs/notes.md');
  assert.equal(docsOnlyChange(r.cwd, merge), false);
  assert.equal(docsOnlyChange(r.cwd, r.nonce()), false);
});

test('git includes deleted paths and both sides of renames, and unread history is never a docs pass', (t) => {
  const r = repository(t);
  r.git('mv', 'docs/notes.md', 'source.js'); r.git('commit', '-qm', 'move');
  assert.equal(docsOnlyChange(r.cwd, r.nonce()), false);
  assert.throws(() => docsOnlyChange(r.cwd, 'not-a-commit'));
});

test('tracker tables preserve header widths, allowing escaped pipes but catching pipes even inside code', () => {
  const table = '| Key | Detail |\n| --- | --- |\n| a | one \\| two |\n';
  assert.deepEqual(checkTracker(table), []);
  assert.equal(checkTracker(table.replace('one \\| two', '`one|two`')).length, 1);
  assert.equal(checkTracker(table.replace('| a | one \\| two |', '| a |')).length, 1);
  assert.equal(checkTracker(table.replace('| a | one \\| two |', 'only one cell')).length, 1);
  assert.deepEqual(checkTracker(`${table}\n| A | B | C |\n| --- | --- | --- |\n| a | b | c |\n`), []);
});

test('tracker tables with short GFM delimiters still reject malformed widths', () => {
  for (const delimiter of ['-', '--', ':-', '-:', ':-:']) {
    const separator = `| ${delimiter} | ${delimiter} |`;
    const table = `| Key | Detail |\n${separator}\n| a | detail |\n`;
    assert.deepEqual(checkTracker(table), []);
    assert.equal(checkTracker(table.replace('| a | detail |', '| a |')).length, 1, delimiter);
    assert.equal(checkTracker(table.replace(separator, `| ${delimiter} |`)).length, 1, delimiter);
  }
});

test('Decision Log entries are consecutive single lines, with blank lines allowed', () => {
  const good = '# Plan\n\n## Decision Log\n\n1. first\n\n2. second\n\n## Outcomes and retrospective\nprose\n';
  assert.deepEqual(checkDecisionLog(good), []);
  for (const bad of [good.replace('2. second', '3. gap'), good.replace('2. second', '1. duplicate'), good.replace('2. second', '2. second\n   continuation'), good.replace('1. first', '0. zero'), good.replace('## Decision Log', '## Missing'), good.replace('1. first\n\n2. second', '')]) assert.ok(checkDecisionLog(bad).length > 0, bad);
});

test('only the workflow git-docs entry point reads history; ordinary planner clients ignore ambient Actions context', (t) => {
  const r = repository(t);
  r.commit('docs/notes.md', 'docs');
  const head = r.nonce();
  writeFileSync(join(r.cwd, 'package.json'), JSON.stringify({ scripts }));
  const output = join(r.cwd, 'output');
  const summary = join(r.cwd, 'summary');
  const entry = fileURLToPath(new URL('./gate-plan.mjs', import.meta.url));
  const run = (args, sha) => {
    writeFileSync(output, '');
    execFileSync(process.execPath, [entry, ...args], { cwd: r.cwd, env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/example', GITHUB_SHA: sha, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, HEAD_MESSAGE: 'Gates: static' } });
    return readFileSync(output, 'utf8');
  };
  assert.match(run([], 'missing-commit'), /^static=true$/m);
  const checked = run(['--git-docs'], head);
  assert.match(checked, /^static=false$/m);
  assert.match(checked, /^docs=true$/m);
});

test('gate requests, trailers, dispatch inputs and environment cannot claim a code tree is docs-only', (t) => {
  const r = repository(t);
  r.commit('source.js', 'code');
  const head = r.nonce();
  writeFileSync(join(r.cwd, 'package.json'), JSON.stringify({ scripts }));
  const output = join(r.cwd, 'output');
  const entry = fileURLToPath(new URL('./gate-plan.mjs', import.meta.url));
  const cases = [
    { HEAD_MESSAGE: 'Gates: static' },
    { HEAD_MESSAGE: 'Gates: static\nDocs-Only: true\nCI-Gates: docs\nAffected-Count: 1\nAffected: M\tdocs/notes.md' },
    { HEAD_MESSAGE: 'Gates: static\nSelection: affected\nAffected-Count: 1\nAffected: M\tdocs/notes.md' },
    { EVENT: 'workflow_dispatch', INPUT_GATES: 'static', INPUT_DOCS_ONLY: 'true' },
    { HEAD_MESSAGE: 'Gates: static', DOCS_ONLY: 'true', INPUT_DOCS_ONLY: 'true', CI_GATES: 'docs', GATE_RUNNER: 'pool' },
    { HEAD_MESSAGE: 'Gates: static', DOCS_ONLY: 'true', GATE_RUNNER: 'macos' },
    { HEAD_MESSAGE: 'Gates: docs', invalid: true },
    { EVENT: 'workflow_dispatch', INPUT_GATES: 'docs', invalid: true },
  ];
  for (const { invalid, ...request } of cases) {
    writeFileSync(output, '');
    const result = spawnSync(process.execPath, [entry, '--git-docs'], { cwd: r.cwd, encoding: 'utf8', env: { PATH: process.env.PATH, EVENT: 'push', GITHUB_SHA: head, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(r.cwd, 'summary'), ...request } });
    const outputs = readFileSync(output, 'utf8');
    assert.doesNotMatch(outputs, /^docs=true$/m, JSON.stringify(request));
    if (invalid) { assert.equal(result.status, 1); assert.match(result.stderr, /no such gate: docs/); }
    else { assert.equal(result.status, 0, result.stderr); assert.match(outputs, /^static=true$/m); }
  }
  const cli = fileURLToPath(new URL('../../scripts/ci-gate.sh', import.meta.url));
  const forgedFlag = spawnSync('bash', [cli, r.cwd, '--gates', 'static', '--docs-only'], { encoding: 'utf8' });
  assert.equal(forgedFlag.status, 2);
  assert.match(forgedFlag.stderr, /unknown.*--docs-only|no such.*--docs-only/);
});

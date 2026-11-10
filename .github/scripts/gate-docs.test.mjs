import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
  assert.deepEqual(checkTracker(`${table}\n| A | B | C |\n| --- | --- | --- |\n| a | b | c |\n`), []);
});

test('Decision Log entries are consecutive single lines, with blank lines allowed', () => {
  const good = '# Plan\n\n## Decision Log\n\n1. first\n\n2. second\n\n## Outcomes and retrospective\nprose\n';
  assert.deepEqual(checkDecisionLog(good), []);
  for (const bad of [good.replace('2. second', '3. gap'), good.replace('2. second', '1. duplicate'), good.replace('2. second', '2. second\n   continuation'), good.replace('1. first', '0. zero'), good.replace('## Decision Log', '## Missing'), good.replace('1. first\n\n2. second', '')]) assert.ok(checkDecisionLog(bad).length > 0, bad);
});

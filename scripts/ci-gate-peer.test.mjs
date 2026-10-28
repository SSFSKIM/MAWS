// node --test scripts/ci-gate-peer.test.mjs (from anywhere; no install needed). ci-gate-peer.mjs, ci-gate.sh's peer for
// the PEER_E2E groups, run whole against a repository whose origin's master and branch hold wire manifests.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./ci-gate-peer.mjs', import.meta.url));
const MANIFEST = 'src/shared/ipc/wire-manifest.json';
const manifest = (major, minor) => `${JSON.stringify({ major, minor, capabilities: [], entries: {} })}\n`;

// A tree on origin/master's `master` content, then a branch commit of `branch` content on top of it (each path → content,
// null to delete it). Returns its git, the two commits and `peer`, a run of the script on the branch commit (or `sha`).
function repository(t, { master = {}, branch = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-peer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const role of ['AUTHOR', 'COMMITTER']) Object.assign(env, { [`GIT_${role}_NAME`]: 'ci-gate-peer test', [`GIT_${role}_EMAIL`]: 'ci-gate-peer@test.invalid' });
  const tree = join(dir, 'tree');
  const git = (...args) => execFileSync('git', ['-C', tree, ...args], { encoding: 'utf8', env }).trim();
  const write = (files) => {
    for (const [path, content] of Object.entries(files)) {
      if (content === null) git('rm', '--quiet', path);
      else {
        mkdirSync(dirname(join(tree, path)), { recursive: true });
        writeFileSync(join(tree, path), content);
      }
    }
    git('add', '-A');
  };
  execFileSync('git', ['init', '--quiet', '--bare', join(dir, 'origin.git')], { env });
  execFileSync('git', ['init', '--quiet', '-b', 'branch', tree], { env });
  git('remote', 'add', 'origin', join(dir, 'origin.git'));
  write({ README: 'master\n', ...master });
  git('commit', '--quiet', '-m', 'master');
  git('push', '--quiet', 'origin', 'HEAD:refs/heads/master');
  write(branch);
  git('commit', '--quiet', '--allow-empty', '-m', 'branch');
  const [base, head] = [git('rev-parse', 'HEAD~1'), git('rev-parse', 'HEAD')];
  // `at`: another checkout of the origin to run in (a shallow or single-branch clone)
  const peerAt = (sha, args = [], at = tree) => {
    const run = spawnSync(process.execPath, [script, '--git-dir', at, '--sha', sha, ...args], { encoding: 'utf8', env });
    return { status: run.status, trailers: run.stdout.split('\n').filter(Boolean), notes: run.stderr.split('\n').filter(Boolean) };
  };
  const clone = (...args) => {
    const at = join(dir, `clone-${args.join('-').replace(/\W+/g, '')}`);
    execFileSync('git', ['clone', '--quiet', ...args, `file://${join(dir, 'origin.git')}`, at], { env });
    return at;
  };
  return { git, write, base, head, peerAt, clone, peer: (...args) => peerAt(head, args) };
}

test("a branch a minor past master's wire names the merge base, both wires, and says they are a minor apart", (t) => {
  const { peer, base } = repository(t, { master: { [MANIFEST]: manifest(3, 0) }, branch: { [MANIFEST]: manifest(3, 1) } });
  assert.deepEqual(peer(), { status: 0, trailers: [`Peer: ${base}`, 'Peer-Wire: 3.0', 'Wire: 3.1'], notes: [`ci-gate: peer ${base.slice(0, 8)} (the merge base with origin/master), wire 3.0; this tree's 3.1, a minor apart`] });
});

test('a branch at the same minor, or a major on, still names its peer; only a minor apart says so', (t) => {
  const same = repository(t, { master: { [MANIFEST]: manifest(3, 2) }, branch: { 'src/a.ts': 'a\n' } });
  assert.deepEqual(same.peer(), { status: 0, trailers: [`Peer: ${same.base}`, 'Peer-Wire: 3.2', 'Wire: 3.2'], notes: [`ci-gate: peer ${same.base.slice(0, 8)} (the merge base with origin/master), wire 3.2; this tree's 3.2`] });
  const major = repository(t, { master: { [MANIFEST]: manifest(3, 2) }, branch: { [MANIFEST]: manifest(4, 0) } });
  assert.deepEqual(major.peer().trailers, [`Peer: ${major.base}`, 'Peer-Wire: 3.2', 'Wire: 4.0']);
  assert.doesNotMatch(major.peer().notes.join('\n'), /a minor apart/);
});

test('--peer names another commit; none names no peer; a ref that is no commit, or a peer with no manifest, is refused', (t) => {
  const { git, peer, base, head } = repository(t, { master: { [MANIFEST]: manifest(3, 0) }, branch: { [MANIFEST]: manifest(3, 1) } });
  git('tag', 'older', base);
  assert.deepEqual(peer('--peer', 'older').trailers, [`Peer: ${base}`, 'Peer-Wire: 3.0', 'Wire: 3.1']);
  assert.match(peer('--peer', 'older').notes[0], /^ci-gate: peer [0-9a-f]{8} \(--peer older\), wire 3\.0; this tree's 3\.1, a minor apart$/);
  assert.deepEqual(peer('--peer', 'none'), { status: 0, trailers: [], notes: [] });
  assert.deepEqual(peer('--peer', 'no-such-ref'), { status: 2, trailers: [], notes: ['ci-gate: --peer no-such-ref: no such commit'] });
  git('checkout', '--quiet', '--orphan', 'bare');
  git('rm', '--quiet', '-r', '--cached', '.');
  git('commit', '--quiet', '--allow-empty', '-m', 'no manifest');
  const bare = git('rev-parse', 'HEAD');
  git('checkout', '--quiet', '-f', head);
  assert.deepEqual(peer('--peer', bare), { status: 2, trailers: [], notes: [`ci-gate: the peer ${bare.slice(0, 8)} (--peer ${bare}) has no ${MANIFEST}`] });
});

test("no peer for a tree with no manifest, master's own tree, or a master with no manifest yet", (t) => {
  assert.deepEqual(repository(t, { branch: { 'src/a.ts': 'a\n' } }).peer(), { status: 0, trailers: [], notes: [] });
  const own = repository(t, { master: { [MANIFEST]: manifest(3, 0) } });
  assert.deepEqual(own.peerAt(own.base), { status: 0, trailers: [], notes: ['ci-gate: the peer would be the tested commit itself (the merge base with origin/master), so no peer'] });
  const first = repository(t, { branch: { [MANIFEST]: manifest(3, 0) } });
  assert.deepEqual(first.peer(), { status: 0, trailers: [], notes: [`ci-gate: the peer ${first.base.slice(0, 8)} (the merge base with origin/master) has no ${MANIFEST}, so no peer`] });
  assert.deepEqual(repository(t, { branch: { 'src/a.ts': 'a\n' } }).peer('--peer', 'HEAD~1').status, 2, 'an asked-for peer of a tree with no manifest');
});

// A checkout that cannot find the merge base would drop the check a bump needs without a word: it is refused, naming
// --peer, while master's own tree (its own merge base) stays quiet.
test('a shallow checkout, a single-branch one and a tree with no merge base are refused, naming --peer; --peer none still works there', (t) => {
  const { git, head, peerAt, clone } = repository(t, { master: { [MANIFEST]: manifest(3, 0) }, branch: { [MANIFEST]: manifest(3, 1) } });
  git('push', '--quiet', 'origin', 'HEAD:refs/heads/branch');
  const advice = 'so this tree\'s peer cannot be found: pass --peer <ref> (the build to check it against) or --peer none';
  const shallow = clone('--depth=1', '--branch', 'branch');
  assert.deepEqual(peerAt(head, [], shallow), { status: 2, trailers: [], notes: [`ci-gate: this checkout is shallow, and its merge base with origin/master may lie past its history, ${advice}`] });
  assert.equal(peerAt(head, ['--peer', 'none'], shallow).status, 0);
  assert.equal(peerAt(head, ['--peer', 'HEAD'], shallow).status, 2, 'an explicit unmerged peer is not a master state, even when it equals the tested sha');
  const single = clone('--single-branch', '--branch', 'branch');
  assert.deepEqual(peerAt(head, [], single), { status: 2, trailers: [], notes: [`ci-gate: ${head.slice(0, 8)} has no merge base with origin/master (none fetched, or a single-branch checkout), ${advice}`] });
  git('checkout', '--quiet', '--orphan', 'unrelated');
  git('commit', '--quiet', '-m', 'unrelated');
  const unrelated = git('rev-parse', 'HEAD');
  assert.equal(peerAt(unrelated).status, 2);
  assert.match(peerAt(unrelated).notes.at(-1), /has no merge base with origin\/master .*pass --peer <ref>/);
});


// A child branches from the draft, while its parent branch advances and later merges into master. The merge-base
// with the child is the draft, but the first master state containing it is the merge, not the draft or today's tip.
function middleOfMergedBranch(t, { missingDraft = false } = {}) {
  const repo = repository(t, { master: { [MANIFEST]: manifest(3, 0) }, branch: { [MANIFEST]: missingDraft ? null : manifest(3, 1) } });
  const { git, write, base, head: draft } = repo;
  git('branch', 'child', draft);
  write({ [MANIFEST]: manifest(3, 2) });
  git('commit', '--quiet', '-m', 'settled parent branch wire');
  const parent = git('rev-parse', 'HEAD');
  git('checkout', '--quiet', '-b', 'master-line', base);
  write({ 'master-only.txt': 'advance master independently\n' });
  git('commit', '--quiet', '-m', 'master advanced');
  git('merge', '--quiet', '--no-ff', 'branch', '-m', 'land the parent branch');
  const landed = git('rev-parse', 'HEAD');
  write({ 'after-landing.txt': 'a later master state\n' });
  git('commit', '--quiet', '-m', 'later master');
  git('push', '--quiet', 'origin', 'HEAD:refs/heads/master');
  git('checkout', '--quiet', 'child');
  write({ [MANIFEST]: manifest(3, 3) });
  git('commit', '--quiet', '-m', 'child branch wire');
  return { ...repo, draft, parent, landed, tested: git('rev-parse', 'HEAD') };
}

test('a default peer from a merged branch middle maps to the first master state containing it', (t) => {
  const { git, peerAt, draft, landed, tested } = middleOfMergedBranch(t);
  assert.equal(git('merge-base', 'origin/master', tested), draft);
  const result = peerAt(tested);
  assert.equal(result.status, 0, result.notes.join('\n'));
  assert.deepEqual(result.trailers, [`Peer: ${landed}`, 'Peer-Wire: 3.2', 'Wire: 3.3']);
  assert.ok(result.notes.includes(`ci-gate: peer ${draft.slice(0, 8)} is not a master state; using ${landed.slice(0, 8)}, the first master commit that contains it`));
});

test('explicit peers use the same mapping, while a first-parent master peer keeps its identity', (t) => {
  const { git, peerAt, base, draft, parent, landed, tested } = middleOfMergedBranch(t);
  git('tag', 'draft-peer', draft);
  for (const ref of ['draft-peer', draft, parent]) {
    const result = peerAt(tested, ['--peer', ref]);
    assert.equal(result.status, 0, result.notes.join('\n'));
    assert.deepEqual(result.trailers, [`Peer: ${landed}`, 'Peer-Wire: 3.2', 'Wire: 3.3']);
    assert.match(result.notes.join('\n'), /is not a master state; using/);
  }
  for (const [ref, minor] of [[base, 0], [landed, 2]]) {
    const result = peerAt(tested, ['--peer', ref]);
    assert.deepEqual(result.trailers, [`Peer: ${ref}`, `Peer-Wire: 3.${minor}`, 'Wire: 3.3']);
    assert.doesNotMatch(result.notes.join('\n'), /is not a master state/);
  }
  assert.deepEqual(peerAt(landed, ['--peer', landed]).trailers, [], 'a tested master state still has no peer against itself');
});

test('an explicit valid-manifest peer outside master ancestry is refused, even if it is the tested commit', (t) => {
  const { git, peerAt, base, tested } = middleOfMergedBranch(t);
  for (const ref of [tested, 'child']) {
    const result = peerAt(tested, ['--peer', ref]);
    assert.equal(result.status, 2);
    assert.deepEqual(result.trailers, []);
    assert.match(result.notes.join('\n'), /--peer .*not an ancestor of origin\/master/);
  }
  // A different unmerged branch is refused too; equality with sha is not what decides ancestry.
  git('checkout', '--quiet', '-b', 'unmerged', base);
  git('commit', '--quiet', '--allow-empty', '-m', 'not landed');
  assert.equal(peerAt(tested, ['--peer', 'unmerged']).status, 2);
});

test('explicit draft with no manifest is refused even when its containing master state has one', (t) => {
  const { peerAt, draft, tested } = middleOfMergedBranch(t, { missingDraft: true });
  const result = peerAt(tested, ['--peer', draft]);
  assert.equal(result.status, 2);
  assert.deepEqual(result.trailers, []);
  assert.match(result.notes.join('\n'), /has no src\/shared\/ipc\/wire-manifest.json/);
});

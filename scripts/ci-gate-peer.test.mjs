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
  const peerAt = (sha, ...args) => {
    const run = spawnSync(process.execPath, [script, '--git-dir', tree, '--sha', sha, ...args], { encoding: 'utf8', env });
    return { status: run.status, trailers: run.stdout.split('\n').filter(Boolean), notes: run.stderr.split('\n').filter(Boolean) };
  };
  return { git, base, head, peerAt, peer: (...args) => peerAt(head, ...args) };
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

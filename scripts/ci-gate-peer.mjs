// scripts/ci-gate.sh's peer: the commit a PEER_E2E group checks the tested tree against (gate.yml; the two-build check,
// e2e/cross-build.spec.ts), resolved here, where the history is, so the plan job's shallow checkout and a rerun of the
// run read the same peer. The peer is `--peer <ref>`, else the merge base of the tested commit with origin/master (fetched
// first; a failed fetch takes the local origin/master), and each tree's wire is its src/shared/ipc/wire-manifest.json's
// major and minor. Prints the trailers, `Peer: <sha>`, `Peer-Wire: <major>.<minor>` and `Wire: <major>.<minor>`, one per
// line, from which gate-plan.mjs adds the peer groups to a run whose two wires are a minor apart; nothing when the tested
// tree has no manifest, is its own peer (master's own tree), or its peer has no manifest. `--peer none` prints nothing.
// What it decided is said on stderr. Exits 2 when an asked-for peer cannot be used, and when the merge base cannot be
// found (a shallow checkout, or one with no merge base with origin/master), naming --peer for either; else 0.
// Usage: node scripts/ci-gate-peer.mjs --git-dir <dir> --sha <commit> [--peer <ref>|none]
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const MANIFEST = 'src/shared/ipc/wire-manifest.json';

// A tree's wire, `<major>.<minor>`, or null when it holds no manifest (a tree before protocol 3).
export function wireAt(git, rev) {
  let text;
  try {
    text = git('show', `${rev}:${MANIFEST}`);
  } catch {
    return null;
  }
  const { major, minor } = JSON.parse(text);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) throw new Error(`${rev}:${MANIFEST} names no integer major and minor`);
  return `${major}.${minor}`;
}

// { trailers, notes, status }: the trailer lines, the lines for stderr, and the exit status.
export function resolvePeer({ git, sha, peer }) {
  const notes = [];
  const say = (line) => notes.push(`ci-gate: ${line}`);
  if (peer === 'none') return { trailers: [], notes, status: 0 };
  const wire = wireAt(git, sha);
  if (wire === null) {
    if (!peer) return { trailers: [], notes, status: 0 };
    say(`--peer ${peer}: the tested tree has no ${MANIFEST}, so no wire to check against another build`);
    return { trailers: [], notes, status: 2 };
  }
  let base;
  let how;
  if (peer) {
    try {
      base = git('rev-parse', '--verify', '--quiet', `${peer}^{commit}`);
    } catch {
      say(`--peer ${peer}: no such commit`);
      return { trailers: [], notes, status: 2 };
    }
    how = `--peer ${peer}`;
  } else {
    // A checkout that cannot find the merge base would silently drop the check a bump needs: it is refused instead.
    const refused = (why) => {
      say(`${why}, so this tree's peer cannot be found: pass --peer <ref> (the build to check it against) or --peer none`);
      return { trailers: [], notes, status: 2 };
    };
    if (git('rev-parse', '--is-shallow-repository') === 'true') return refused('this checkout is shallow, and its merge base with origin/master may lie past its history');
    try {
      git('fetch', '--quiet', 'origin', 'master');
    } catch {
      say('warning: fetching origin/master failed; the peer is the merge base with the local origin/master');
    }
    try {
      base = git('merge-base', 'origin/master', sha);
    } catch {
      return refused(`${sha.slice(0, 8)} has no merge base with origin/master (none fetched, or a single-branch checkout)`);
    }
    how = 'the merge base with origin/master';
  }
  if (base === sha) {
    say(`the peer would be the tested commit itself (${how}), so no peer`);
    return { trailers: [], notes, status: 0 };
  }
  const peerWire = wireAt(git, base);
  if (peerWire === null) {
    say(`the peer ${base.slice(0, 8)} (${how}) has no ${MANIFEST}${peer ? '' : ', so no peer'}`);
    return { trailers: [], notes, status: peer ? 2 : 0 };
  }
  const [major, minor] = wire.split('.');
  const [peerMajor, peerMinor] = peerWire.split('.');
  const apart = major === peerMajor && minor !== peerMinor ? ', a minor apart' : '';
  say(`peer ${base.slice(0, 8)} (${how}), wire ${peerWire}; this tree's ${wire}${apart}`);
  return { trailers: [`Peer: ${base}`, `Peer-Wire: ${peerWire}`, `Wire: ${wire}`], notes, status: 0 };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'git-dir': { type: 'string' }, sha: { type: 'string' }, peer: { type: 'string', default: '' } } });
  if (!values['git-dir'] || !values.sha) {
    process.stderr.write('ci-gate-peer: --git-dir and --sha are required\n');
    process.exit(2);
  }
  const git = (...args) => execFileSync('git', ['-C', values['git-dir'], ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
  const { trailers, notes, status } = resolvePeer({ git, sha: values.sha, peer: values.peer });
  for (const line of notes) process.stderr.write(`${line}\n`);
  for (const line of trailers) process.stdout.write(`${line}\n`);
  process.exit(status);
}

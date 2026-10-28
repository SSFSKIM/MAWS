// scripts/ci-gate.sh's peer: the commit a PEER_E2E group checks the tested tree against (gate.yml; the two-build check,
// e2e/cross-build.spec.ts), resolved here, where the history is, so the plan job's shallow checkout and a rerun of the
// run read the same peer. The candidate is `--peer <ref>`, else the merge base with origin/master (fetched first; a
// failed fetch takes local origin/master). Both map to the first master first-parent commit containing the candidate:
// a merged branch's draft commit was never a master state. Each tree's wire is its src/shared/ipc/wire-manifest.json's
// major and minor. Prints the trailers, `Peer: <sha>`, `Peer-Wire: <major>.<minor>` and `Wire: <major>.<minor>`, one per
// line, from which gate-plan.mjs adds the peer groups to a run whose two wires are a minor apart; nothing when the tested
// tree has no manifest, is its own peer (master's own tree), or its peer has no manifest. `--peer none` prints nothing.
// What it decided is said on stderr. Exits 2 when an asked-for peer cannot be used, and when the merge base cannot be
// found (a shallow checkout, or one with no merge base with origin/master), or a requested peer is outside master
// ancestry, naming --peer; else 0.
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
  // A checkout that cannot find the merge base would silently drop the check a bump needs: refuse it instead.
  const refused = (why) => {
    say(`${why}, so this tree's peer cannot be found: pass --peer <ref> (the build to check it against) or --peer none`);
    return { trailers: [], notes, status: 2 };
  };
  // A peer can be reachable through a merge while its earlier first-parent master states are truncated.
  // Neither explicit refs nor merge bases can establish the first containing state in a shallow checkout.
  if (git('rev-parse', '--is-shallow-repository') === 'true') {
    say(`${peer ? `--peer ${peer}: ` : ''}this checkout is shallow, so the peer's first-parent master state cannot be established; fetch complete history or pass --peer none`);
    return { trailers: [], notes, status: 2 };
  }
  if (peer) {
    try {
      base = git('rev-parse', '--verify', '--quiet', `${peer}^{commit}`);
    } catch {
      say(`--peer ${peer}: no such commit`);
      return { trailers: [], notes, status: 2 };
    }
    how = `--peer ${peer}`;
    // An explicit ref without a manifest remains an error even if a later containing master commit has one.
    if (wireAt(git, base) === null) {
      say(`the peer ${base.slice(0, 8)} (${how}) has no ${MANIFEST}`);
      return { trailers: [], notes, status: 2 };
    }
  }
  // Explicit peers need the current master ancestry too, not only the default merge-base selection.
  try {
    git('fetch', '--quiet', 'origin', 'master');
  } catch {
    say('warning: fetching origin/master failed; resolving the peer against the local origin/master');
  }
  if (!peer) {
    try {
      base = git('merge-base', 'origin/master', sha);
    } catch {
      return refused(`${sha.slice(0, 8)} has no merge base with origin/master (none fetched, or a single-branch checkout)`);
    }
    how = 'the merge base with origin/master';
  }
  try {
    git('merge-base', '--is-ancestor', base, 'origin/master');
  } catch {
    say(`--peer ${peer || base}: ${base.slice(0, 8)} is not an ancestor of origin/master (or its ancestry is unavailable)`);
    return { trailers: [], notes, status: 2 };
  }
  // Two graph walks, not one ancestry subprocess per master commit. Keep them separate: --first-parent with
  // --ancestry-path can prune an off-chain candidate before finding its containing merge and return nothing.
  const masterStates = git('rev-list', '--first-parent', 'origin/master').split('\n');
  if (!masterStates.includes(base)) {
    const candidate = base;
    const descendants = new Set(git('rev-list', '--ancestry-path', `${candidate}..origin/master`).split('\n'));
    base = masterStates.findLast((commit) => descendants.has(commit));
    say(`peer ${candidate.slice(0, 8)} is not a master state; using ${base.slice(0, 8)}, the first master commit that contains it`);
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

// Advisory only: missing e2e groups whose specs statically import a changed path. No builds, Playwright collection
// or installation. The graph does NOT cover Electron's src/ -> build -> out/ dependency: that is the lander's rule.
// CLI stdout is E2E-Coverage trailers for gate-plan's summary; stderr is one warning per missing group plus notes.
// Usage (dry, no push): node scripts/ci-gate-e2e-coverage.mjs --git-dir <checkout> --sha <commit> --gates static
// With --mini-copy, the same graph decides the run's mini copies instead (miniCopyAt, below).
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { importGraph } from './ci-gate-e2e-imports.mjs';
import { discoverGroups } from './ci-gate-e2e-specs.mjs';
import { workflowEnv } from './ci-gate-alerts.mjs';

export { importGraph, discoverGroups };
const words = (text) => text.split(/[\s,]+/).filter(Boolean);
const wholeSet = (gates) => gates === 'all' || words(gates).length === 0;
export function checkCoverage({ root, ts, gates, changed }) {
  if (wholeSet(gates) || changed.length === 0) return { missing: [], notes: [] };
  if (!ts) return { missing: [], notes: ['skipped import coverage: TypeScript unavailable (no dependencies installed)'] };
  const { groups, notes } = discoverGroups(root, ts);
  const requested = new Set(words(gates));
  if ([...groups.keys()].every((group) => requested.has(group))) return { missing: [], notes: [] };
  const graph = importGraph(root, ts);
  const missing = [];
  for (const [group, specs] of groups) {
    if (requested.has(group)) continue;
    const reached = graph.reachable(specs);
    const paths = [...new Set(changed)].filter((path) => reached.has(path)).sort();
    if (paths.length > 0) missing.push({ group, paths });
  }
  return { missing, notes };
}

function typescript(gitDir, git) {
  // A new worktree often has no node_modules, but its primary checkout does. Use its parser without installing or
  // symlinking anything; the graph itself is resolved exclusively in the committed snapshot, not that checkout.
  const locations = [fileURLToPath(import.meta.url), join(resolve(gitDir), 'package.json')];
  try { locations.push(join(dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir').toString().trim()), 'package.json')); } catch { /* no primary checkout */ }
  for (const location of locations) {
    try { return createRequire(location)('typescript'); } catch { /* try the next existing dependency tree */ }
  }
  return null;
}

// The tested commit's change (the merge-base diff with origin/master) handed to `check` with the commit's tree and
// TypeScript: check({ root, ts, changed }). `wanted` narrows the change first; nothing wanted, and check is not called.
function atCommit({ gitDir, sha, wanted = () => true, check, none }) {
  const git = (...args) => execFileSync('git', ['-C', gitDir, ...args], { maxBuffer: 128 << 20, stdio: ['pipe', 'pipe', 'pipe'] });
  const base = git('merge-base', 'origin/master', sha).toString().trim();
  const changed = git('diff', '--name-only', '--no-renames', '-z', base, sha).toString().split('\0').filter(Boolean).filter(wanted);
  if (changed.length === 0) return none;
  const ts = typescript(gitDir, git);
  if (!ts) return check({ root: '', ts, changed });
  const root = mkdtempSync(join(tmpdir(), 'maws-e2e-coverage-'));
  try {
    // Read the tested commit, never a worktree's dirty files (and support a bare sha). Only source/config files;
    // assets, fixtures and build output are not needed. A single archive avoids a git subprocess per graph edge.
    const files = git('ls-tree', '-r', '--name-only', '-z', sha).toString().split('\0');
    const extensions = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json'].filter((ext) => files.some((file) => file.endsWith(`.${ext}`)));
    const archive = git('archive', sha, '--', ...extensions.map((ext) => `*.${ext}`), ...files.filter((file) => file === 'pnpm-workspace.yaml'));
    execFileSync('tar', ['-xf', '-', '-C', root], { input: archive, stdio: ['pipe', 'pipe', 'pipe'] });
    return check({ root, ts, changed });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

export function coverageAt({ gitDir, sha, gates }) {
  if (wholeSet(gates)) return { missing: [], notes: [] };
  return atCommit({ gitDir, sha, none: { missing: [], notes: [] }, check: ({ root, ts, changed }) => checkCoverage({ root, ts, gates, changed }) });
}

// Mini copies (gate-plan.mjs): of the e2e groups `groups` names, those whose specs reach a changed path under e2e/
// (a spec or e2e/support), each with those paths. A group whose specs cannot be read is named in the notes.
export function miniCopies({ root, ts, groups, changed }) {
  if (groups.length === 0 || changed.length === 0) return { copies: [], notes: [] };
  if (!ts) throw new Error('TypeScript unavailable (no dependencies installed)');
  const discovered = discoverGroups(root, ts);
  const graph = importGraph(root, ts);
  const copies = [];
  for (const group of new Set(groups)) {
    const specs = discovered.groups.get(`e2e:${group}`);
    if (!specs) continue;
    const reached = graph.reachable(specs);
    const paths = [...new Set(changed)].filter((path) => reached.has(path)).sort();
    if (paths.length > 0) copies.push({ group, paths });
  }
  return { copies, notes: discovered.notes.filter((note) => groups.some((group) => note.startsWith(`skipped e2e:${group}:`))) };
}

// The e2e groups a run asks for: its `e2e:` gates, or for the whole set (`all`, or no list) the tested commit's class-1
// list (gate.yml's CLASS1_E2E), which the plan runs on a macOS lane; a group the plan does not run is never copied.
export function requestedGroups({ gitDir, sha, gates }) {
  if (!wholeSet(gates)) return words(gates).filter((gate) => gate.startsWith('e2e:')).map((gate) => gate.slice(4));
  const workflow = execFileSync('git', ['-C', gitDir, 'show', `${sha}:.github/workflows/gate.yml`], { encoding: 'utf8', maxBuffer: 16 << 20, stdio: ['pipe', 'pipe', 'pipe'] });
  return words(workflowEnv(workflow).CLASS1_E2E ?? '');
}

export function miniCopyAt({ gitDir, sha, gates }) {
  const groups = requestedGroups({ gitDir, sha, gates });
  if (groups.length === 0) return { copies: [], notes: [] };
  return atCommit({ gitDir, sha, wanted: (path) => path.startsWith('e2e/'), none: { copies: [], notes: [] }, check: ({ root, ts, changed }) => miniCopies({ root, ts, groups, changed }) });
}

// One `MiniCopy: <group> <paths>` trailer per group, which gate-plan.mjs places and names in its summary. The group is
// never cut, so the plan copies every one: at most three paths follow it, `(+n more)` for the rest, a path with a space
// or a markup character quoted, and the line is cut at 508 bytes as advisoryTrailers cuts. One line per e2e group of the
// run (CLASS1_E2E's 43 on 2026-11-13: under 22 KiB) stays far within commit-tree's 128 KiB argument.
export function miniCopyTrailers(copies) {
  return copies.map(({ group, paths }) => {
    const shown = paths.slice(0, 3).map((path) => (/[\s`<>]/.test(path) ? JSON.stringify(path) : path)).join(', ');
    const line = Buffer.from(`MiniCopy: ${group} ${shown}${paths.length > 3 ? ` (+${paths.length - 3} more)` : ''}`.replace(/[\r\n]+/g, ' '));
    if (line.length <= 508) return `${line.toString()}\n`;
    let end = 508;
    while ((line[end] & 0xc0) === 0x80) end--;
    return `${line.subarray(0, end).toString()}...\n`;
  }).join('');
}

// commit-tree receives these in one -m argument (Linux caps each argument at 128 KiB). Budget the complete UTF-8
// trailer block, including prefixes/newlines and its truncation note, before the shell captures it. Stderr stays full.
export function advisoryTrailers(lines) {
  const note = 'E2E-Coverage: note: advice truncated; see pre-push stderr for the full list\n';
  const budget = 4096 - Buffer.byteLength(note);
  let output = '';
  let truncated = false;
  for (let i = 0; i < lines.length; i++) {
    if (i === 12) { truncated = true; break; }
    const bytes = Buffer.from(`E2E-Coverage: ${lines[i].replace(/[\r\n]+/g, ' ')}`);
    let line;
    if (bytes.length > 508) {
      let end = 508;
      while ((bytes[end] & 0xc0) === 0x80) end--;
      line = `${bytes.subarray(0, end).toString()}...\n`;
      truncated = true;
    } else line = `${bytes.toString()}\n`;
    if (Buffer.byteLength(output) + Buffer.byteLength(line) > budget) { truncated = true; break; }
    output += line;
  }
  return output + (truncated ? note : '');
}

// --mini-copy: the MiniCopy trailers instead (ci-gate.sh, before its alert check, whose plan they change), the copies
// also on stderr. Not computed (no merge base, no TypeScript), the run has no copy and its summary an E2E-Coverage note
// saying so; a push never waits on it.
// Real paths on both sides: a script reached through a symlinked directory (macOS's /var) is still run as the CLI.
const main = process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (main && process.argv.includes('--mini-copy')) {
  let output;
  try {
    const { values } = parseArgs({ options: { 'mini-copy': { type: 'boolean' }, 'git-dir': { type: 'string' }, sha: { type: 'string' }, gates: { type: 'string', default: '' } } });
    if (!values['git-dir'] || !values.sha) throw new Error('--git-dir and --sha are required');
    const { copies, notes } = miniCopyAt({ gitDir: values['git-dir'], sha: values.sha, gates: values.gates });
    output = miniCopyTrailers(copies);
    for (const line of output.split('\n').filter(Boolean)) process.stderr.write(`ci-gate: mini copy: e2e:${line.slice('MiniCopy: '.length)}\n`);
    for (const note of notes) process.stderr.write(`ci-gate: mini copy note: ${note.replace(/[\r\n]+/g, ' ')}\n`);
    output += advisoryTrailers(notes.map((note) => `note: mini copies: ${note}`));
  } catch (error) {
    const line = `mini copies not computed: ${error.message.split('\n')[0]}`;
    process.stderr.write(`ci-gate: warning: ${line}; going ahead without them\n`);
    output = advisoryTrailers([`note: ${line}`]);
  }
  process.stdout.write(output);
} else if (main) {
  const started = performance.now();
  const advice = [];
  try {
    const { values } = parseArgs({ options: { 'git-dir': { type: 'string' }, sha: { type: 'string' }, gates: { type: 'string', default: '' } } });
    if (!values['git-dir'] || !values.sha) throw new Error('--git-dir and --sha are required');
    const result = coverageAt({ gitDir: values['git-dir'], sha: values.sha, gates: values.gates });
    for (const { group, paths } of result.missing) {
      const shown = paths.slice(0, 3).map((path) => /[\s`<>]/.test(path) ? JSON.stringify(path) : path).join(', ');
      const line = `missing ${group}; specs reach ${shown}${paths.length > 3 ? ` (+${paths.length - 3} more)` : ''}`;
      process.stderr.write(`ci-gate: warning: ${line}\n`);
      advice.push(line);
    }
    for (const note of result.notes) {
      const line = note.replace(/[\r\n]+/g, ' ');
      process.stderr.write(`ci-gate: e2e coverage note: ${line}\n`);
      advice.push(`note: ${line}`);
    }
    if (!wholeSet(values.gates)) {
      const line = `spec-import coverage checked in ${((performance.now() - started) / 1000).toFixed(2)} s; advisory only (not Electron build dependencies)`;
      process.stderr.write(`ci-gate: ${line}\n`);
      advice.push(line);
    }
  } catch (error) {
    const line = `spec-import coverage unavailable: ${error.message.split('\n')[0]}`;
    process.stderr.write(`ci-gate: warning: ${line}; going ahead\n`);
    advice.push(`note: ${line}`);
    // Never make selecting or launching gates depend on this advisory succeeding.
  }
  process.stdout.write(advisoryTrailers(advice));
}

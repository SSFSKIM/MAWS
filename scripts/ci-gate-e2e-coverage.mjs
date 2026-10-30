// Advisory only: missing e2e groups whose specs statically import a changed path. No builds, Playwright collection
// or installation. The graph does NOT cover Electron's src/ -> build -> out/ dependency: that is the lander's rule.
// CLI stdout is E2E-Coverage trailers for gate-plan's summary; stderr is one warning per missing group plus notes.
// Usage (dry, no push): node scripts/ci-gate-e2e-coverage.mjs --git-dir <checkout> --sha <commit> --gates static
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { importGraph } from './ci-gate-e2e-imports.mjs';
import { discoverGroups } from './ci-gate-e2e-specs.mjs';

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

export function coverageAt({ gitDir, sha, gates }) {
  if (wholeSet(gates)) return { missing: [], notes: [] };
  const git = (...args) => execFileSync('git', ['-C', gitDir, ...args], { maxBuffer: 128 << 20, stdio: ['pipe', 'pipe', 'pipe'] });
  const base = git('merge-base', 'origin/master', sha).toString().trim();
  const changed = git('diff', '--name-only', '--no-renames', '-z', base, sha).toString().split('\0').filter(Boolean);
  if (changed.length === 0) return { missing: [], notes: [] };
  const ts = typescript(gitDir, git);
  if (!ts) return checkCoverage({ root: '', ts, gates, changed });
  const root = mkdtempSync(join(tmpdir(), 'maws-e2e-coverage-'));
  try {
    // Read the tested commit, never a worktree's dirty files (and support a bare sha). Only source/config files;
    // assets, fixtures and build output are not needed. A single archive avoids a git subprocess per graph edge.
    const files = git('ls-tree', '-r', '--name-only', '-z', sha).toString().split('\0');
    const extensions = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json'].filter((ext) => files.some((file) => file.endsWith(`.${ext}`)));
    const archive = git('archive', sha, '--', ...extensions.map((ext) => `*.${ext}`), ...files.filter((file) => file === 'pnpm-workspace.yaml'));
    execFileSync('tar', ['-xf', '-', '-C', root], { input: archive, stdio: ['pipe', 'pipe', 'pipe'] });
    return checkCoverage({ root, ts, gates, changed });
  } finally { rmSync(root, { recursive: true, force: true }); }
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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

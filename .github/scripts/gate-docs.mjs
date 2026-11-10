// A docs-only landing still runs a real check on the tested tree. Classification uses git, never the caller's
// affected-path trailers; the same unread/data boundary as unit selection excludes suite-read evidence.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { READ_AS_DATA, UNREAD } from './gate-affected.mjs';

export const docsOnlyPaths = (paths) => paths.length > 0 && paths.every((path) => UNREAD.some((prefix) => path.startsWith(prefix)) && !READ_AS_DATA.some((prefix) => path.startsWith(prefix)));

export function docsOnlyChange(cwd, head) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  const parents = git('show', '-s', '--format=%P', head).split(' ').filter(Boolean);
  const message = git('show', '-s', '--format=%B', head);
  const nonce = parents.length === 1 && /^ci-gate:/.test(message) && /^Nonce: /m.test(message) && git('rev-parse', `${head}^{tree}`) === git('rev-parse', `${parents[0]}^{tree}`);
  const tested = nonce ? parents[0] : head;
  // A merge is judged against its first parent. ci-gate instead tests its parent's entire unmerged change,
  // exactly as ci-gate.sh --affected does: a final docs commit cannot conceal earlier unmerged code.
  const base = !nonce && parents.length > 1 ? parents[0] : git('merge-base', 'origin/master', tested);
  const paths = git('diff', '--name-only', '--no-renames', '-z', base, tested).split('\0').filter(Boolean);
  return docsOnlyPaths(paths);
}

function cells(line) {
  const result = [];
  let start = 0;
  let slashes = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|' && slashes % 2 === 0) { result.push(line.slice(start, i).trim()); start = i + 1; }
    slashes = line[i] === '\\' ? slashes + 1 : 0;
  }
  result.push(line.slice(start).trim());
  if (line.trimStart().startsWith('|')) result.shift();
  if (result.at(-1) === '' && line.trimEnd().endsWith('|')) result.pop();
  return result;
}

export function checkTracker(text) {
  const errors = [];
  const lines = text.split('\n');
  for (let i = 0; i + 1 < lines.length; i++) {
    const separator = cells(lines[i + 1]);
    if (!lines[i].includes('|') || separator.length === 0 || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    const width = cells(lines[i]).length;
    for (let row = i + 1; row < lines.length && lines[row].includes('|'); row++) {
      const count = cells(lines[row]).length;
      if (count !== width) errors.push(`line ${row + 1}: table has ${count} cells, header has ${width}`);
      i = row;
    }
  }
  return errors;
}

export function checkDecisionLog(text) {
  const lines = text.split('\n');
  const heading = lines.findIndex((line) => line === '## Decision Log');
  if (heading < 0) return ['missing ## Decision Log'];
  const errors = [];
  let expected = 1;
  for (let i = heading + 1; i < lines.length && !/^## /.test(lines[i]); i++) {
    if (!lines[i].trim()) continue;
    const match = /^(\d+)\. \S/.exec(lines[i]);
    if (!match) { errors.push(`line ${i + 1}: each Decision Log entry must occupy one numbered line`); continue; }
    if (Number(match[1]) !== expected) errors.push(`line ${i + 1}: expected entry ${expected}, got ${match[1]}`);
    expected = Number(match[1]) + 1;
  }
  if (expected === 1) errors.push('Decision Log has no entries');
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checks = [
    ['docs/tech-debt-tracker.md', checkTracker],
    ['docs/doperpowers/plans/2026-10-27-p5-org.md', checkDecisionLog],
  ];
  for (const [path, check] of checks) {
    const errors = check(readFileSync(path, 'utf8'));
    for (const error of errors) console.error(`${path}: ${error}`);
    if (errors.length) process.exitCode = 1;
    else console.log(`docs: ${path} passed`);
  }
}

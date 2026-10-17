// The specs `e2e:default` runs in one run of .github/workflows/gate.yml (docs/doperpowers/plans/2026-10-14-gate-offload.md
// Decision Log 60(2)). `default` is the bare `pnpm e2e`, which collects most of e2e/ and so repeated the specs of a dozen
// other groups inside a full set. Beside other e2e groups it runs only its own: every spec the bare `pnpm e2e` collects
// at this tree minus the specs those groups collect, so a new spec no group claims lands here rather than falling out.
// What a group collects is Playwright's own answer: its package script's selection (its env assignments, its spec
// arguments, its --config) run as `playwright test --list`, which applies the configs' testMatch and testIgnore. A file
// counts as claimed only when its group lists every test the bare set lists in it.
// Prints the spec arguments for `pnpm e2e`, one per line, or nothing for the bare `pnpm e2e`: when no other e2e group
// runs, and whenever the derivation cannot read a script's shape or a listing fails, saying why on stderr. The doubt
// always falls on running more, never fewer.
// Usage: E2E_PLAN=<the plan job's e2e matrix> node .github/scripts/e2e-default-specs.mjs, from the checkout's root
// (with its node_modules). The derivation is exported for .github/scripts/e2e-default-specs.test.mjs.
import { execFile } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const say = (line) => process.stderr.write(`e2e-default: ${line}\n`);

// A package script's selection as `playwright test --list` can repeat it: { env, args }; { elsewhere } for a script run
// in another workspace package, which collects nothing under this root's e2e/; null for any shape it cannot read.
// Readable: an optional `scripts/e2e-build.sh <variant> &&`, then NAME=value assignments, then `playwright test` with spec
// arguments, --config, and the options that select nothing (--forbid-only, --reporter, --add-reporter). Anything else,
// a quote, an expansion, another command, --grep or any other option, is unreadable.
export function readScript(script, rootName) {
  let rest = script.trim();
  const built = /^scripts\/e2e-build\.sh (?:harness|plain) && (.*)$/.exec(rest);
  if (built) rest = built[1];
  if (!/^[\w\s./:=,@+-]*$/.test(rest)) return null;
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (!built && tokens.length === 4 && tokens[0] === 'pnpm' && tokens[1] === '--filter' && tokens[2] !== rootName) return { elsewhere: tokens[2] };
  const env = {};
  while (/^[A-Za-z_]\w*=/.test(tokens[0] ?? '')) {
    const assignment = tokens.shift();
    const at = assignment.indexOf('=');
    env[assignment.slice(0, at)] = assignment.slice(at + 1);
  }
  if (tokens.shift() !== 'playwright' || tokens.shift() !== 'test') return null;
  const args = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith('-')) {
      args.push(token);
      continue;
    }
    const at = token.indexOf('=');
    const flag = at < 0 ? token : token.slice(0, at);
    const inline = at < 0 ? undefined : token.slice(at + 1);
    if (flag === '--config' || flag === '-c') {
      const value = inline ?? tokens[++i];
      if (!value) return null;
      args.push('--config', value);
    } else if (flag === '--reporter' || flag === '--add-reporter') {
      if (inline === undefined && !tokens[++i]) return null;
    } else if (flag !== '--forbid-only' || inline !== undefined) {
      return null;
    }
  }
  return { env, args };
}

const pool = async (jobs, width) => {
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, jobs.length) }, async () => {
      while (next < jobs.length) {
        const at = next++;
        results[at] = await jobs[at]();
      }
    }),
  );
  return results;
};

// What `playwright test --list` collects for one selection: Map(spec path from the root -> Set of its tests, each by its
// title path and location). Throws when the listing fails or reports an error.
async function listSelection(root, { env, args }) {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-default-'));
  const output = join(dir, 'list.json');
  try {
    await new Promise((settle, fail) => {
      execFile(
        join(root, 'node_modules/.bin/playwright'),
        ['test', '--list', '--reporter=json', ...args],
        { cwd: root, env: { ...process.env, ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: output }, maxBuffer: 64 << 20 },
        (error, _stdout, stderr) => (error ? fail(new Error(`playwright test --list ${args.join(' ')} failed: ${String(stderr).trim().split('\n').slice(-3).join(' / ')}`)) : settle()),
      );
    });
    const report = JSON.parse(readFileSync(output, 'utf8'));
    if (report.errors?.length > 0) throw new Error(`playwright test --list ${args.join(' ')} reported: ${report.errors.map((error) => error.message?.split('\n')[0]).join(' / ')}`);
    const specs = new Map();
    const walk = (suite, titles, tests) => {
      for (const spec of suite.specs ?? []) tests.add(`${[...titles, spec.title].join(' › ')} @ ${spec.file}:${spec.line}:${spec.column}`);
      for (const child of suite.suites ?? []) walk(child, [...titles, child.title], tests);
    };
    for (const suite of report.suites ?? []) {
      const tests = new Set();
      walk(suite, [], tests);
      specs.set(relative(root, resolve(report.config.rootDir, suite.file)), tests);
    }
    return specs;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The derivation: { specs } for default's own specs, or { bare: reason } for the bare `pnpm e2e`, with `doubt` when the
// bare set is a fallback rather than the answer. `groups` are the run's other e2e groups; `list` is listSelection for
// this root, replaceable in a test.
export async function defaultSpecs({ scripts, rootName, groups, list, width = 4 }) {
  if (groups.length === 0) return { bare: 'no other e2e group runs beside it' };
  const doubt = (reason, notes) => ({ bare: reason, doubt: true, notes });
  const own = readScript(scripts.e2e ?? '', rootName);
  if (own === null || own.elsewhere || own.args.some((arg) => !arg.startsWith('-'))) return doubt(`cannot read the e2e script's shape (${scripts.e2e})`);
  const selections = [];
  const notes = [];
  for (const group of groups) {
    const script = scripts[`e2e:${group}`] ?? '';
    const selection = readScript(script, rootName);
    if (selection === null) return doubt(`cannot read e2e:${group}'s script shape (${script})`);
    if (selection.elsewhere) notes.push(`e2e:${group} runs in ${selection.elsewhere} and collects nothing under e2e/`);
    else selections.push({ group, selection });
  }
  let bare;
  let listed;
  try {
    [bare, ...listed] = await pool([() => list(own), ...selections.map(({ selection }) => () => list(selection))], width);
  } catch (error) {
    return doubt(error.message);
  }
  const claimed = new Map();
  selections.forEach(({ group }, at) => {
    const files = [];
    for (const [file, tests] of listed[at]) {
      if (!bare.has(file)) continue;
      files.push(file);
      const seen = claimed.get(file) ?? new Set();
      for (const test of tests) seen.add(test);
      claimed.set(file, seen);
    }
    notes.push(`e2e:${group} collects ${files.length === 0 ? "none of the bare set's specs" : files.join(' ')}`);
  });
  const specs = [];
  for (const [file, tests] of bare) {
    const seen = claimed.get(file);
    if (seen === undefined) specs.push(file);
    else if ([...tests].some((test) => !seen.has(test))) {
      specs.push(file);
      notes.push(`${file} stays: the groups that collect it list ${[...tests].filter((test) => seen.has(test)).length} of its ${tests.size} tests`);
    }
  }
  if (specs.length === bare.size) return { bare: 'the other e2e groups collect none of its specs', notes };
  if (specs.length === 0) return doubt('the other e2e groups collect every spec of the bare set', notes);
  specs.sort();
  // The run itself, `pnpm e2e <specs>`, must collect exactly these specs with every test the bare set has in them.
  let narrowed;
  try {
    narrowed = await list({ env: own.env, args: [...own.args, ...specs] });
  } catch (error) {
    return doubt(error.message, notes);
  }
  const exact = narrowed.size === specs.length && specs.every((file) => narrowed.has(file) && narrowed.get(file).size === bare.get(file).size && [...bare.get(file)].every((test) => narrowed.get(file).has(test)));
  if (!exact) return doubt(`pnpm e2e with the ${specs.length} own specs as arguments does not collect exactly them`, notes);
  return { specs, notes, total: bare.size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const { name: rootName, scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const groups = JSON.parse(process.env.E2E_PLAN ?? '[]')
    .map((entry) => entry.group)
    .filter((group) => group !== 'default');
  const started = Date.now();
  const result = await defaultSpecs({ scripts, rootName, groups, list: (selection) => listSelection(root, selection), width: Math.max(2, Math.min(8, availableParallelism())) });
  for (const note of result.notes ?? []) say(note);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const summary = (line) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n\n`);
  if (result.specs) {
    say(`default runs its own ${result.specs.length} of the bare set's ${result.total} specs, beside ${groups.length} other e2e groups (derived in ${seconds} s):`);
    for (const spec of result.specs) say(`  ${spec}`);
    summary(`#### e2e:default: its own ${result.specs.length} of the bare set's ${result.total} specs, beside ${groups.length} other e2e groups (Decision Log 60(2))`);
    process.stdout.write(`${result.specs.join('\n')}\n`);
  } else {
    say(`default runs the bare pnpm e2e: ${result.bare}`);
    if (result.doubt) process.stderr.write(`::warning title=e2e:default runs the bare set::${result.bare}\n`);
    if (groups.length > 0) summary(`#### e2e:default: the bare \`pnpm e2e\` (${result.bare})`);
  }
}

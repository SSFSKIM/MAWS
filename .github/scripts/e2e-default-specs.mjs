// The specs `e2e:default` runs in one run of .github/workflows/gate.yml (docs/doperpowers/plans/2026-10-14-gate-offload.md
// Decision Log 60(2)). `default` is the bare `pnpm e2e`, which collects most of e2e/ and so repeated the specs of a dozen
// other groups inside a full set. Beside other e2e groups it runs only its own: every spec the bare `pnpm e2e` collects
// at this tree minus the specs those groups collect, so a new spec no group claims lands here rather than falling out.
// What a group collects is Playwright's own answer: its package script's selection (its env assignments, its spec
// arguments, its --config) run as `playwright test --list`, which applies the configs' testMatch and testIgnore. A file
// counts as claimed only when its group lists every test the bare set lists in it.
// The groups of a `DefaultBeside:` trailer count as if they ran beside it too, so a relaunch of part of a set, naming
// the whole set's other groups there, runs the own specs the whole set's `default` ran rather than every spec of the
// groups it leaves out (Decision Log 66).
// Prints the spec arguments for `pnpm e2e`, one per line, or nothing for the bare `pnpm e2e`: when no other e2e group
// runs or is named, and whenever the derivation cannot read a script's shape, a named group has no script or a listing
// fails, saying why on stderr. The doubt always falls on running more, never fewer.
// Usage: E2E_PLAN=<the plan job's e2e matrix> DEFAULT_BESIDE=<the plan job's default_beside> node
// .github/scripts/e2e-default-specs.mjs, from the checkout's root (with its node_modules). The derivation is exported
// for .github/scripts/e2e-default-specs.test.mjs.
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

// What a `playwright test --list` JSON report collects: Map(spec path from the root -> Set of its tests, each by its title
// path, which Playwright refuses to repeat within a file). Not by line and column: concurrent listings on a cold transform
// cache can leave one without a spec's source map, so the same test reports its compiled position. The identity is the JSON
// array of the title components, so two tests share one only when their arrays are equal; Playwright's own check (empty
// describe titles dropped, then joined) is coarser and reports that as a duplicate title, which listSelection throws on.
export function collected(report, root) {
  const specs = new Map();
  const walk = (suite, titles, tests) => {
    for (const spec of suite.specs ?? []) tests.add(JSON.stringify([...titles, spec.title]));
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title], tests);
  };
  for (const suite of report.suites ?? []) {
    const tests = new Set();
    walk(suite, [], tests);
    specs.set(relative(root, resolve(report.config.rootDir, suite.file)), tests);
  }
  return specs;
}

// Runs `playwright test --list` for one selection and returns collected(its report). Throws when the listing fails or
// reports an error.
export async function listSelection(root, { env, args }) {
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
    return collected(report, root);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The derivation: { specs } for default's own specs, or { bare: reason } for the bare `pnpm e2e`, with `doubt` when the
// bare set is a fallback rather than the answer. `groups` are the run's e2e groups, `beside` those of its DefaultBeside
// trailer, both read alike (`default` itself in either is no other group); `list` is listSelection for this root,
// replaceable in a test.
export async function defaultSpecs({ scripts, rootName, groups, beside = [], list, width = 4 }) {
  const others = [...new Set([...groups, ...beside])].filter((group) => group !== 'default');
  if (others.length === 0) return { bare: 'no other e2e group runs beside it' };
  const doubt = (reason, notes) => ({ bare: reason, doubt: true, notes });
  const own = readScript(scripts.e2e ?? '', rootName);
  if (own === null || own.elsewhere || own.args.some((arg) => !arg.startsWith('-'))) return doubt(`cannot read the e2e script's shape (${scripts.e2e})`);
  const selections = [];
  const notes = [];
  for (const group of others) {
    const named = groups.includes(group) ? '' : ' (named by DefaultBeside)';
    if (!Object.hasOwn(scripts, `e2e:${group}`)) return doubt(`no package.json script e2e:${group}${named}`);
    const script = scripts[`e2e:${group}`];
    const selection = readScript(script, rootName);
    if (selection === null) return doubt(`cannot read e2e:${group}'s script shape (${script})${named}`);
    if (selection.elsewhere) notes.push(`e2e:${group}${named} runs in ${selection.elsewhere} and collects nothing under e2e/`);
    else selections.push({ name: `e2e:${group}${named}`, selection });
  }
  let bare;
  let listed;
  try {
    [bare, ...listed] = await pool([() => list(own), ...selections.map(({ selection }) => () => list(selection))], width);
  } catch (error) {
    return doubt(error.message);
  }
  const claimed = new Map();
  selections.forEach(({ name }, at) => {
    const files = [];
    for (const [file, tests] of listed[at]) {
      if (!bare.has(file)) continue;
      files.push(file);
      const seen = claimed.get(file) ?? new Set();
      for (const test of tests) seen.add(test);
      claimed.set(file, seen);
    }
    notes.push(`${name} collects ${files.length === 0 ? "none of the bare set's specs" : files.join(' ')}`);
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
  const groups = JSON.parse(process.env.E2E_PLAN ?? '[]').map((entry) => entry.group);
  const beside = JSON.parse(process.env.DEFAULT_BESIDE || '[]');
  const others = new Set([...groups, ...beside].filter((group) => group !== 'default'));
  const named = [...others].filter((group) => !groups.includes(group)).length;
  const besideText = `beside ${others.size} other e2e groups${named > 0 ? `, ${named} of them named by DefaultBeside` : ''}`;
  const started = Date.now();
  const result = await defaultSpecs({ scripts, rootName, groups, beside, list: (selection) => listSelection(root, selection), width: Math.max(2, Math.min(8, availableParallelism())) });
  for (const note of result.notes ?? []) say(note);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const summary = (line) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n\n`);
  if (result.specs) {
    say(`default runs its own ${result.specs.length} of the bare set's ${result.total} specs, ${besideText} (derived in ${seconds} s):`);
    for (const spec of result.specs) say(`  ${spec}`);
    summary(`#### e2e:default: its own ${result.specs.length} of the bare set's ${result.total} specs, ${besideText} (Decision Log 60(2), 66)`);
    process.stdout.write(`${result.specs.join('\n')}\n`);
  } else {
    say(`default runs the bare pnpm e2e: ${result.bare}`);
    if (result.doubt) process.stderr.write(`::warning title=e2e:default runs the bare set::${result.bare}\n`);
    if (others.size > 0) summary(`#### e2e:default: the bare \`pnpm e2e\` (${result.bare})`);
  }
}

// One run of one load in a pass, written so a pass can stop at any point and resume in a later window: the script is
// built (build.mjs, the same arguments), run through playwright-cli, and its JSON written to
// `<dir>/<target>-<load>-<cohort>[-<variant>]-<n>.json` only once the run has returned whole, `n` the next number free
// for that load. A run stopped half way leaves no file; running the load again adds one; join.mjs pools every file of
// a load. Each run written adds a line to `<dir>/done.txt`: the file, its repetitions and how many met their marks.
//
//   node spikes/desk-latency/pass.mjs --pw <playwright-cli session> [--dir /tmp/lat] <build.mjs arguments>…
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cohortOf, readRun } from './join.mjs';

const args = process.argv.slice(2);
const take = (name) => {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return undefined;
  const [, value] = args.splice(at, 2);
  return value;
};
const pw = take('pw');
const dir = take('dir') ?? '/tmp/lat';
if (!pw) throw new Error('--pw <playwright-cli session> is required: the session attached to the browser the pass drives');
mkdirSync(dir, { recursive: true });

const pending = `${dir}/.pending-${process.pid}`;
execFileSync(process.execPath, [fileURLToPath(new URL('build.mjs', import.meta.url)), ...args, '--out', `${pending}.js`], { stdio: 'inherit' });
// From `dir`, where playwright-cli keeps its own files.
const text = execFileSync('playwright-cli', [`-s=${pw}`, '--raw', 'run-code', `--filename=${pending}.js`], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
const run = readRun(text);
const ok = (run.reps ?? []).filter((r) => r.ok).length;
if (!run.reps?.length) {
  process.stderr.write(`no repetition ran: ${run.error ?? run.notes?.join('; ') ?? 'no error given'}\n`);
  process.exit(1);
}

const stem = [run.target, run.load, cohortOf(run), run.variant].filter(Boolean).join('-');
const taken = readdirSync(dir).map((f) => f.match(new RegExp(`^${stem}-(\\d+)\\.json$`))?.[1]).filter(Boolean).map(Number);
const file = `${dir}/${stem}-${Math.max(0, ...taken) + 1}`;
writeFileSync(`${pending}.json`, JSON.stringify(run));
renameSync(`${pending}.json`, `${file}.json`);
renameSync(`${pending}.js`, `${file}.js`);
appendFileSync(`${dir}/done.txt`, `${file}.json ${run.reps.length} reps, ${ok} ok, ${run.ended}${run.error ? `; stopped: ${run.error.split('\n')[0]}` : ''}\n`);
process.stdout.write(`${file}.json: ${run.reps.length} reps, ${ok} ok${run.error ? `; stopped: ${run.error.split('\n')[0]}` : ''}\n`);

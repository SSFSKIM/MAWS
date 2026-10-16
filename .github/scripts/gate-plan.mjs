// The gate set of one run of .github/workflows/gate.yml (docs/doperpowers/plans/2026-10-14-gate-offload.md §3.1, §3.2,
// §3.6) and the runners its jobs take. The set: a manual run's `gates` input, else the pushed commit's `Gates:` trailer
// (scripts/ci-gate.sh writes it when its caller narrows the set), else class 1a, with unit:darwin and class 1's e2e
// groups added when the e2e lane is a macOS runner. Explicit unit:darwin runs on macOS regardless of the e2e lane, and so
// does `packaged` (the unsigned app built once, then its checks; Decision Log 35), which is only ever explicit.
// Class 1a's runner (static, unit, probes): the `class1a` input or the `Class1a:` trailer (`linux`, `macos` or `pool`),
// else the repository variable GATE_RUNNER, else `linux`. `pool` is ci-kit's Hetzner box, each job in a container of its
// own size (Decision Log 35); `pool=true` when a class-1a job runs there, for the plan job's pool-ensure.
// The e2e lane: the `runner` input or the `Runner:` trailer (`linux` or `macos`), else the repository variable
// GATE_E2E_RUNNER, else GATE_RUNNER unless it is `pool` (Chromium would lose its sandbox in the pool's containers), else
// `linux`; a Linux lane takes only the groups that run green there (LINUX_E2E).
// Writes the switches, the runners and the e2e matrix to the job's outputs and the set to its summary. Run from the
// checkout's root.
import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';

const env = process.env;
const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
const words = (text = '') => text.split(/[\s,]+/).filter(Boolean);
// `default` is the bare `pnpm e2e` set (after `pnpm build`, as `verify` orders them); every other group is `e2e:<group>`.
const scriptOf = (group) => (group === 'default' ? 'e2e' : `e2e:${group}`);
const refuse = (message) => {
  process.stderr.write(`gate-plan: ${message}\n`);
  process.exit(1);
};

const dispatched = env.EVENT === 'workflow_dispatch';
const trailer = (key) =>
  (env.HEAD_MESSAGE ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith(`${key.toLowerCase()}:`))
    .at(-1)
    ?.slice(key.length + 1)
    .trim();

const RUNNERS = { linux: 'ubuntu-24.04', macos: ['self-hosted', 'macOS', 'ARM64'] };
const poolBox = (cpus) => ['self-hosted', 'ci-kit-pool', `cpus-${cpus}`];
const CLASS1A_RUNNERS = {
  linux: { static: RUNNERS.linux, unit: RUNNERS.linux, probes: RUNNERS.linux },
  macos: { static: RUNNERS.macos, unit: RUNNERS.macos, probes: RUNNERS.macos },
  // unit at 8 cores leaves one 16-core box room for static's 4 and probes' 2, so the three start together.
  pool: { static: poolBox(4), unit: poolBox(8), probes: poolBox(2) },
};
const gateRunner = (env.GATE_RUNNER ?? '').toLowerCase();
const class1a = ((dispatched ? env.INPUT_CLASS1A : trailer('Class1a')) || gateRunner || 'linux').toLowerCase();
if (!Object.hasOwn(CLASS1A_RUNNERS, class1a)) refuse(`no such class-1a runner: ${class1a} (linux, macos or pool)`);

const lane = ((dispatched ? env.INPUT_RUNNER : trailer('Runner')) || env.GATE_E2E_RUNNER || (gateRunner === 'pool' ? '' : gateRunner) || 'linux').toLowerCase();
if (lane !== 'linux' && lane !== 'macos') refuse(`no such runner: ${lane} (linux or macos; the pool takes class 1a alone, through Class1a: pool)`);

const asked = dispatched ? env.INPUT_GATES : trailer('Gates');
const defaults = ['static', 'unit', 'probes', ...(lane === 'macos' ? ['unit:darwin', ...words(env.CLASS1_E2E).filter((group) => scriptOf(group) in scripts).map((group) => `e2e:${group}`)] : [])];
const gates = new Set(words(asked).length > 0 ? words(asked) : defaults);

const unknown = [...gates].filter((gate) => !['static', 'unit', 'unit:darwin', 'probes', 'packaged'].includes(gate) && !(gate.startsWith('e2e:') && scriptOf(gate.slice(4)) in scripts));
if (unknown.length > 0) refuse(`no such gate: ${unknown.join(', ')} (static, unit, unit:darwin, probes, packaged, e2e:default or e2e:<group> with a package.json script)`);
// The packaged app's e2e scripts read dist/, which only the packaged job builds.
const packagedOnly = [...gates].filter((gate) => gate.startsWith('e2e:') && /(^|:)packaged$/.test(gate.slice(4)));
if (packagedOnly.length > 0) refuse(`${packagedOnly.join(', ')} run inside the packaged gate, after its build: ask with Gates: packaged`);

// A Linux lane runs only the groups §3.1's table found green there; the rest are macOS work, refused here rather than
// scheduled to fail.
const linux = new Set(words(env.LINUX_E2E));
const macOnly = lane === 'linux' ? [...gates].filter((gate) => gate.startsWith('e2e:') && !linux.has(gate.slice(4))) : [];
if (macOnly.length > 0) refuse(`${macOnly.join(', ')} run on the macOS runner (§3.1): ask with Runner: macos (ci-gate.sh --runner macos)`);

const libreoffice = new Set(words(env.LIBREOFFICE_E2E));
const e2e = [...gates]
  .filter((gate) => gate.startsWith('e2e:'))
  .map((gate) => {
    const group = gate.slice(4);
    return { group, script: scriptOf(group), slug: group.replace(/[^\w-]/g, '-'), build: group === 'default', libreoffice: libreoffice.has(group) };
  });

const has = (gate) => String(gates.has(gate));
const runners = CLASS1A_RUNNERS[class1a];
const pool = class1a === 'pool' && ['static', 'unit', 'probes'].some((gate) => gates.has(gate));
appendFileSync(
  env.GITHUB_OUTPUT,
  `static=${has('static')}\nunit=${has('unit')}\nunit_darwin=${has('unit:darwin')}\nprobes=${has('probes')}\ne2e=${JSON.stringify(e2e)}\ne2e_runner=${JSON.stringify(RUNNERS[lane])}\n` +
    `static_runner=${JSON.stringify(runners.static)}\nunit_runner=${JSON.stringify(runners.unit)}\nprobes_runner=${JSON.stringify(runners.probes)}\npool=${pool}\n`,
);
appendFileSync(env.GITHUB_OUTPUT, `packaged=${has('packaged')}\n`);
const from = words(asked).length > 0 ? (dispatched ? 'the `gates` input' : 'the `Gates:` trailer') : 'the default (class 1a, with unit:darwin and class 1 e2e on a macOS lane)';
appendFileSync(env.GITHUB_STEP_SUMMARY, `### Gates\n\n${[...gates].map((gate) => `- \`${gate}\``).join('\n')}\n\nFrom: ${from}. Class 1a: ${class1a}. E2e lane: ${lane}.\n`);
process.stdout.write(`${[...gates].join('\n')}\nclass 1a: ${class1a}\nlane: ${lane}\n`);

// The gate set of one run of .github/workflows/gate.yml (docs/doperpowers/plans/2026-10-14-gate-offload.md §3.2): a
// manual run's `gates` input, else the pushed commit's `Gates:` trailer (scripts/ci-gate.sh writes it when its caller
// narrows the set), else the whole class-1 set of §3.1. Writes `static`, `unit`, `probes` and the e2e matrix to the
// job's outputs, and the set to its summary. Run from the checkout's root.
import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';

const env = process.env;
const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
const words = (text = '') => text.split(/[\s,]+/).filter(Boolean);
// `default` is the bare `pnpm e2e` set (after `pnpm build`, as `verify` orders them); every other group is `e2e:<group>`.
const scriptOf = (group) => (group === 'default' ? 'e2e' : `e2e:${group}`);

const trailer = (env.HEAD_MESSAGE ?? '')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /^Gates:/i.test(line))
  .at(-1)
  ?.slice('Gates:'.length);
const asked = env.EVENT === 'workflow_dispatch' ? env.INPUT_GATES : trailer;
const gates = new Set(
  words(asked).length > 0
    ? words(asked)
    : ['static', 'unit', 'probes', ...words(env.CLASS1_E2E).filter((group) => scriptOf(group) in scripts).map((group) => `e2e:${group}`)],
);

const unknown = [...gates].filter((gate) => !['static', 'unit', 'probes'].includes(gate) && !(gate.startsWith('e2e:') && scriptOf(gate.slice(4)) in scripts));
if (unknown.length > 0) {
  process.stderr.write(`gate-plan: no such gate: ${unknown.join(', ')} (static, unit, probes, e2e:default or e2e:<group> with a package.json script)\n`);
  process.exit(1);
}

// A Linux runner cannot pass a class-2 group (§3.1: the packaged app, the CUA harness, anything needing the Mac), so an
// explicit request for one is refused rather than scheduled to fail; any other runner OS takes every group with a script.
const class1 = new Set(words(env.CLASS1_E2E));
const class2 = env.RUNNER_OS === 'Linux' ? [...gates].filter((gate) => gate.startsWith('e2e:') && !class1.has(gate.slice(4))) : [];
if (class2.length > 0) {
  process.stderr.write(`gate-plan: class 2, run on the Mac: ${class2.join(', ')} (a Linux runner takes only the class-1 e2e groups)\n`);
  process.exit(1);
}

const libreoffice = new Set(words(env.LIBREOFFICE_E2E));
const e2e = [...gates]
  .filter((gate) => gate.startsWith('e2e:'))
  .map((gate) => {
    const group = gate.slice(4);
    return { group, script: scriptOf(group), slug: group.replace(/[^\w-]/g, '-'), build: group === 'default', libreoffice: libreoffice.has(group) };
  });

const has = (gate) => String(gates.has(gate));
appendFileSync(env.GITHUB_OUTPUT, `static=${has('static')}\nunit=${has('unit')}\nprobes=${has('probes')}\ne2e=${JSON.stringify(e2e)}\n`);
appendFileSync(env.GITHUB_STEP_SUMMARY, `### Gates\n\n${[...gates].map((gate) => `- \`${gate}\``).join('\n')}\n\nFrom: ${words(asked).length > 0 ? (env.EVENT === 'workflow_dispatch' ? 'the `gates` input' : 'the `Gates:` trailer') : 'the class-1 default'}\n`);
process.stdout.write(`${[...gates].join('\n')}\n`);

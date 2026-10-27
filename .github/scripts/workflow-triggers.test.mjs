// node --test .github/scripts/workflow-triggers.test.mjs (from the checkout's root, after pnpm install). MAWS is
// public, and its self-hosted runners (the persistent Macs, ci-kit's ephemeral pool boxes) must never run code someone
// outside the repository can trigger. A runner's refusal at job start is no boundary, since a job's always()
// and failure() steps and its actions' pre scripts still run after it. So no workflow in .github/workflows may both
// have a job whose runs-on can reach a self-hosted runner and trigger on anything but push, workflow_dispatch or
// schedule, which only the repository's own writers can set off. The check fails closed: a workflow, a trigger or a
// runs-on it cannot read counts against the workflow.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workflows = join(root, '.github/workflows');

// The triggers only the repository's writers can set off.
const OWN_TRIGGERS = new Set(['push', 'workflow_dispatch', 'schedule']);
// The labels of GitHub's hosted images, in the shapes GitHub gives them (actions/runner-images' table, and the hosted
// and larger-runner references of docs.github.com): ubuntu-latest, -slim and -<yy.mm>[-arm]; windows-latest,
// -<yyyy>[-vs<yyyy>] and -11[-vs<yyyy>]-arm; macos-latest[-large|-xlarge] and -<nn>[-large|-xlarge|-intel];
// xcode-<nn>[-xlarge]. Any other label can be one a self-hosted runner carries, a name that only starts like an
// image's (ubuntu-ci-pool) and a larger Linux or Windows runner's, which its owner names, among them: a runner takes a
// job when it has every label the job asks for, whether or not the job names `self-hosted` (gate-plan.mjs asks for
// `[ci-kit-mac-shared]` alone), so the Macs' default `macOS` and `ARM64` and the pool's `cpus-<n>` reach them as
// surely as ci-kit's own names do.
const HOSTED_LABEL =
  /^(?:ubuntu-(?:latest|slim|\d{2}\.\d{2}(?:-arm)?)|windows-(?:latest|\d{4}(?:-vs\d{4})?|11(?:-vs\d{4})?-arm)|macos-(?:latest(?:-large|-xlarge)?|\d{2}(?:-large|-xlarge|-intel)?)|xcode-\d{2}(?:-xlarge)?)$/i;
const hostedLabel = (label) => typeof label === 'string' && HOSTED_LABEL.test(label);
// A runs-on as GitHub reads it: a label, a list of labels, or a mapping of a runner group and labels. Only a literal
// hosted label, or a non-empty list of them, stays off self-hosted runners; an expression, a group (which can hold
// self-hosted runners) and any form the check cannot read reach them.
const staysHosted = (runsOn) => {
  if (Array.isArray(runsOn)) return runsOn.length > 0 && runsOn.every(hostedLabel);
  if (runsOn && typeof runsOn === 'object') return Object.keys(runsOn).every((key) => key === 'labels') && 'labels' in runsOn && staysHosted([runsOn.labels].flat());
  return hostedLabel(runsOn);
};
// A job that calls a reusable workflow has no runs-on of its own and runs that workflow's jobs, which the check does
// not follow, so it reaches them as any unreadable runs-on does.
const reachesSelfHosted = (job) => !staysHosted(job['runs-on']);
// A workflow's events, from any form of `on` (an event, a list of them, a mapping by event); null when unreadable.
const events = (on) => {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.every((event) => typeof event === 'string') ? on : null;
  if (on && typeof on === 'object') return Object.keys(on);
  return null;
};
const isMapping = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// One workflow's text: what is wrong with it, empty when nothing is. js-yaml reads `on` as GitHub does (a key, not YAML
// 1.1's boolean), resolves anchors and aliases, and throws on a repeated key.
const violations = (text) => {
  let workflow;
  try {
    workflow = yaml.load(text);
  } catch (error) {
    return [`the workflow is not YAML the check can read: ${error.reason ?? error.message}`];
  }
  if (!isMapping(workflow)) return ['the workflow is not a mapping'];
  const triggers = events(workflow.on);
  if (!triggers) return ['the workflow has no `on` the check can read'];
  if (!isMapping(workflow.jobs)) return ['the workflow has no `jobs` map the check can read'];
  const outside = triggers.filter((event) => !OWN_TRIGGERS.has(event));
  return Object.entries(workflow.jobs).flatMap(([name, job]) => {
    if (!isMapping(job)) return [`job ${name} is not a mapping`];
    return outside.length > 0 && reachesSelfHosted(job) ? [`job ${name}'s runs-on can reach a self-hosted runner, and the workflow triggers on ${outside.join(', ')}`] : [];
  });
};

test('a workflow on GitHub-hosted runners alone may trigger on anything', () => {
  assert.deepEqual(violations('on: [pull_request, issue_comment]\njobs:\n  a:\n    runs-on: ubuntu-latest\n  b:\n    runs-on: [macos-15, windows-latest]\n'), []);
  // Every label of actions/runner-images' table and GitHub's hosted and larger-runner references, 2026-10-27.
  const hosted = [
    'ubuntu-latest', 'ubuntu-slim', 'ubuntu-26.04', 'ubuntu-24.04', 'ubuntu-22.04', 'ubuntu-26.04-arm', 'ubuntu-24.04-arm', 'ubuntu-22.04-arm',
    'windows-latest', 'windows-2025', 'windows-2025-vs2026', 'windows-2022', 'windows-11-arm', 'windows-11-vs2026-arm',
    'macos-latest', 'macos-26', 'macos-15', 'macos-14', 'macos-26-intel', 'macos-15-intel', 'macos-latest-large', 'macos-26-large', 'macos-15-large',
    'macos-14-large', 'macos-latest-xlarge', 'macos-26-xlarge', 'macos-15-xlarge', 'macos-14-xlarge', 'xcode-27', 'xcode-27-xlarge',
  ];
  for (const label of hosted) assert.deepEqual(violations(`on: pull_request\njobs:\n  build:\n    runs-on: ${label}\n`), [], label);
});

test('a self-hosted workflow triggered only by push, workflow_dispatch or schedule passes, in every form of `on`', () => {
  const jobs = 'jobs:\n  a:\n    runs-on: [self-hosted, macOS, ARM64]\n  b:\n    runs-on: ${{ fromJSON(needs.plan.outputs.runner) }}\n';
  for (const on of ['on: push', 'on: [push, workflow_dispatch]', "on:\n  push:\n    branches: ['ci/**']\n  workflow_dispatch:\n  schedule:\n    - cron: '0 * * * *'"]) {
    assert.deepEqual(violations(`${on}\n${jobs}`), [], on);
  }
});

test('every form of runs-on that can reach a self-hosted runner fails beside an outside trigger', () => {
  const reaching = [
    'self-hosted',
    'SELF-HOSTED',
    '[self-hosted, macOS, ARM64]',
    'ci-kit-pool',
    '[ci-kit-mac-shared]',
    'ci-kit-mac-vm-trial',
    // A runner takes a job when it carries every label the job asks for, `self-hosted` or not: the Mac's own default
    // labels and the pool's size labels reach it as well as ci-kit's names do.
    'macOS',
    '[Linux, X64]',
    'cpus-16',
    '[ubuntu-latest, self-hosted]',
    // A custom label that only starts like a hosted image's is any runner's to carry, as are a larger Linux or Windows
    // runner's names, which the organization chooses.
    'ubuntu-ci-pool',
    'macos-builder',
    'windows-private',
    'ubuntu-latest-gpu',
    'ubuntu-24.04-large',
    'ubuntu-slim-2',
    'macos-latest-intel',
    'macos-15-mini',
    'windows-2025-arm',
    'windows-11',
    'xcode-builder',
    '[ubuntu-latest, ubuntu-ci-pool]',
    '${{ matrix.os }}',
    "${{ vars.GATE_RUNNER == 'macos' && 'self-hosted' || 'ubuntu-latest' }}",
    'ubuntu-${{ matrix.version }}',
    '\n      group: my-runners',
    '\n      labels: [self-hosted]',
    '\n      group: hosted-large\n      labels: ubuntu-latest',
    '\n      - ubuntu-latest\n      - ci-kit-pool',
    '7',
    '[]',
    "''",
  ];
  for (const runsOn of reaching) {
    const found = violations(`on: pull_request\njobs:\n  build:\n    runs-on: ${runsOn}\n`);
    assert.equal(found.length, 1, runsOn);
    assert.match(found[0], /^job build's runs-on can reach a self-hosted runner, and the workflow triggers on pull_request$/, runsOn);
  }
  assert.deepEqual(violations('on: pull_request\njobs:\n  build:\n    runs-on:\n      labels: [ubuntu-24.04-arm]\n'), []);
});

test('every trigger outside push, workflow_dispatch and schedule fails beside a self-hosted job, each named', () => {
  for (const event of ['pull_request', 'pull_request_target', 'issue_comment', 'workflow_run', 'workflow_call', 'repository_dispatch', 'release', 'fork', 'watch']) {
    assert.deepEqual(violations(`on: [push, ${event}]\njobs:\n  build:\n    runs-on: self-hosted\n`), [`job build's runs-on can reach a self-hosted runner, and the workflow triggers on ${event}`], event);
  }
  assert.deepEqual(violations('on:\n  push:\n  pull_request:\n    types: [opened]\n  issues:\njobs:\n  build:\n    runs-on: self-hosted\n'), [
    "job build's runs-on can reach a self-hosted runner, and the workflow triggers on pull_request, issues",
  ]);
});

test('every reaching job of the workflow is named, the hosted ones are not', () => {
  const text = 'on: pull_request\njobs:\n  lint:\n    runs-on: ubuntu-latest\n  mac:\n    runs-on: [self-hosted, macOS]\n  pool:\n    runs-on: ${{ fromJSON(needs.plan.outputs.runner) }}\n';
  assert.deepEqual(violations(text), [
    "job mac's runs-on can reach a self-hosted runner, and the workflow triggers on pull_request",
    "job pool's runs-on can reach a self-hosted runner, and the workflow triggers on pull_request",
  ]);
});

// A job that calls a reusable workflow has no runs-on of its own: the called workflow's jobs run on this repository's
// runners, and the check does not follow the call, in this repository or another.
test("a reusable workflow's call fails beside an outside trigger, local or not, as does a job with no runs-on", () => {
  for (const uses of ['./.github/workflows/build.yml', 'someone/else/.github/workflows/build.yml@v1']) {
    assert.deepEqual(violations(`on: pull_request\njobs:\n  call:\n    uses: ${uses}\n`), ["job call's runs-on can reach a self-hosted runner, and the workflow triggers on pull_request"], uses);
    assert.deepEqual(violations(`on: [push, workflow_dispatch]\njobs:\n  call:\n    uses: ${uses}\n`), [], uses);
  }
  assert.deepEqual(violations('on: pull_request\njobs:\n  bare:\n    steps: []\n'), ["job bare's runs-on can reach a self-hosted runner, and the workflow triggers on pull_request"]);
  assert.deepEqual(violations('on: workflow_call\njobs:\n  build:\n    runs-on: self-hosted\n'), [
    "job build's runs-on can reach a self-hosted runner, and the workflow triggers on workflow_call",
  ]);
});

test('a workflow, a trigger list or a jobs map the check cannot read fails', () => {
  assert.deepEqual(violations('on: [push\njobs: {}\n').length, 1);
  assert.match(violations('on: [push\n')[0], /^the workflow is not YAML the check can read: /);
  assert.match(violations('on: push\non: pull_request\njobs: {}\n')[0], /^the workflow is not YAML the check can read: /);
  assert.deepEqual(violations('- push\n'), ['the workflow is not a mapping']);
  assert.deepEqual(violations('jobs:\n  a:\n    runs-on: ubuntu-latest\n'), ['the workflow has no `on` the check can read']);
  assert.deepEqual(violations('on: 7\njobs:\n  a:\n    runs-on: self-hosted\n'), ['the workflow has no `on` the check can read']);
  assert.deepEqual(violations('on: [push, [pull_request]]\njobs:\n  a:\n    runs-on: self-hosted\n'), ['the workflow has no `on` the check can read']);
  assert.deepEqual(violations('on: push\njobs: [a]\n'), ['the workflow has no `jobs` map the check can read']);
  assert.deepEqual(violations('on: push\njobs:\n  a: self-hosted\n'), ['job a is not a mapping']);
});

// The check on this tree. gate.yml's jobs are on the Macs and the pool, so its triggers are the ones that keep it
// passing: the same file with a pull_request trigger added must fail, which keeps the check from passing a workflow
// it misread as hosted.
test('no workflow in .github/workflows runs a self-hosted job on a trigger from outside the repository', () => {
  assert.match(violations(readFileSync(join(workflows, 'gate.yml'), 'utf8').replace(/^on:\n/m, 'on:\n  pull_request:\n'))[0], /^job plan's runs-on can reach/);
  const files = readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name));
  assert.ok(files.includes('gate.yml'));
  const found = files.flatMap((name) => violations(readFileSync(join(workflows, name), 'utf8')).map((violation) => `.github/workflows/${name}: ${violation}`));
  assert.deepEqual(found, []);
});

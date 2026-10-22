// Whether a final gate run was the whole declared invocation (e2e/support/final-invocation.ts; gate-offload Decision Log
// 50; the tracker's reporter row, closed at P3-F): the runner's command line against the package script's own, which
// catches the narrowings the CLI applies outside the config a reporter sees (a grep or its inverse, a file or location
// argument, the last failures, a test list…); the config's own selection; the declared case counts or, without them, a
// forbidden `test.only`; every case run and expected. The repository's real acceptance scripts are read where it matters.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DASHBOARD_ACCEPTANCE } from '../../e2e/support/dashboard-acceptance';
import { commandLineProblems, invocationProblems, playwrightArgs, type InvocationSummary } from '../../e2e/support/final-invocation';

const REPO = resolve(__dirname, '..', '..');
const SCRIPTS = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
const ROOT = '/repo';
const RUNNER = ['/usr/local/bin/node', '/repo/node_modules/@playwright/test/cli.js', 'test'];
const DESIGN_SPECS = ['design.spec.ts', 'design-comments.spec.ts', 'design-history.spec.ts', 'design-export.spec.ts', 'design-provisional.spec.ts' /* P4-A2 G2.6 */];

const argvOf = (script: string) => [...RUNNER, ...playwrightArgs(script)!];
const casesOf = (files: readonly { file: string; tests: number }[]) => files.flatMap(({ file, tests }) => Array.from({ length: tests }, (_, k) => ({ file, title: `case ${k}`, outcome: 'expected' })));
const run = (script: string, over: Partial<InvocationSummary> = {}, files: readonly { file: string; tests: number }[] = DESIGN_SPECS.map((file) => ({ file, tests: 2 }))): InvocationSummary => ({
  status: 'passed',
  argv: argvOf(script),
  config: { grep: /.*/, grepInvert: null, shard: null, forbidOnly: true },
  tests: casesOf(files),
  ...over,
});

describe('the package script’s command', () => {
  it('is the `playwright test` arguments of the repository’s acceptance scripts', () => {
    expect(playwrightArgs(SCRIPTS['e2e:design']!)).toEqual([...DESIGN_SPECS.map((s) => `e2e/${s}`), '--forbid-only', '--add-reporter=./e2e/support/design-final-reporter.ts']);
    expect(playwrightArgs(SCRIPTS['e2e:dashboard']!)).toEqual(['--config', 'playwright.dashboard.config.ts']);
    expect(playwrightArgs(SCRIPTS['e2e:connectors']!)).toEqual(['e2e/connectors.spec.ts']);
  });

  it('is none for a script the shell would change after `playwright test`, or one that runs no Playwright', () => {
    expect(playwrightArgs('scripts/e2e-build.sh plain')).toBeNull();
    expect(playwrightArgs('playwright test "e2e/a b.spec.ts"')).toBeNull();
    expect(playwrightArgs('playwright test e2e/a.spec.ts $EXTRA')).toBeNull();
    expect(playwrightArgs('playwright test e2e/a.spec.ts && echo done')).toBeNull();
  });
});

describe('the command line against the script’s', () => {
  const design = playwrightArgs(SCRIPTS['e2e:design']!)!;
  const dashboard = playwrightArgs(SCRIPTS['e2e:dashboard']!)!;

  it('admits the script’s own command however its options and paths are spelled', () => {
    expect(commandLineProblems([...RUNNER, ...design], design, ROOT)).toEqual([]);
    expect(commandLineProblems([...RUNNER, ...design.slice(0, -1), '--add-reporter', 'e2e/support/design-final-reporter.ts'], design, ROOT)).toEqual([]);
    expect(commandLineProblems([...RUNNER, '--config=playwright.dashboard.config.ts'], dashboard, ROOT)).toEqual([]);
    expect(commandLineProblems([...RUNNER, '-c', './playwright.dashboard.config.ts'], dashboard, ROOT)).toEqual([]);
  });

  it.each([
    ['--grep', ['--grep', 'export'], 'adds --grep export'],
    ['-g', ['-g', 'export'], 'adds -g export'],
    ['--grep=', ['--grep=menu'], 'adds --grep=menu'],
    ['--grep-invert', ['--grep-invert', 'history'], 'adds --grep-invert history'],
    ['-G', ['-G', 'history'], 'adds -G history'],
    ['--last-failed', ['--last-failed'], 'adds --last-failed'],
    ['--only-changed', ['--only-changed'], 'adds --only-changed'],
    ['--test-list', ['--test-list', 'list.txt'], 'adds --test-list list.txt'],
    ['--test-list-invert=', ['--test-list-invert=skip.txt'], 'adds --test-list-invert=skip.txt'],
    ['--shard=', ['--shard=1/2'], 'adds --shard=1/2'],
    ['--project', ['--project', 'chromium'], 'adds --project chromium'],
    ['-x', ['-x'], 'adds -x'],
    ['--max-failures=', ['--max-failures=1'], 'adds --max-failures=1'],
    ['another reporter', ['--add-reporter', './other.ts'], 'adds --add-reporter ./other.ts'],
    ['words after --', ['--', '--grep'], 'adds --'],
    ['a file argument', ['e2e/dashboard.spec.ts'], 'adds e2e/dashboard.spec.ts'],
  ])('names a narrowing by %s, however the group names its files', (_what, extra, words) => {
    expect(commandLineProblems([...RUNNER, ...design, ...extra], design, ROOT).join('; ')).toContain(words);
    expect(commandLineProblems([...RUNNER, ...dashboard, ...extra], dashboard, ROOT).join('; ')).toContain(words);
  });

  it('names a location in place of a spec, a spec left out, another config, and a command that is not `playwright test`', () => {
    const located = design.map((a) => (a === 'e2e/design.spec.ts' ? 'e2e/design.spec.ts:120' : a));
    expect(commandLineProblems([...RUNNER, ...located], design, ROOT)).toEqual(['the command line adds e2e/design.spec.ts:120', "the command line leaves out the script's e2e/design.spec.ts"]);
    expect(commandLineProblems([...RUNNER, ...design.slice(1)], design, ROOT)).toEqual(["the command line leaves out the script's e2e/design.spec.ts"]);
    expect(commandLineProblems([...RUNNER, '--config', 'playwright.config.ts'], dashboard, ROOT)).toEqual(['the command line adds --config playwright.config.ts', "the command line leaves out the script's playwright.dashboard.config.ts"]);
    expect(commandLineProblems(RUNNER, dashboard, ROOT)).toEqual(["the command line leaves out the script's --config", "the command line leaves out the script's playwright.dashboard.config.ts"]);
    expect(commandLineProblems(['/node', '/cli.js', 'show-report'], dashboard, ROOT)).toEqual(['the invocation is not `playwright test`']);
  });
});

describe('the whole declared invocation', () => {
  const design = SCRIPTS['e2e:design']!;
  const dashboard = SCRIPTS['e2e:dashboard']!;
  const dashboardRun = (over: Partial<InvocationSummary> = {}) => run(dashboard, { config: { grep: /.*/, grepInvert: null, shard: null, forbidOnly: false }, ...over }, DASHBOARD_ACCEPTANCE);

  it('is a passed run of the script’s own command, every named spec run, every case expected', () => {
    expect(invocationProblems(run(design), { script: design }, ROOT)).toEqual([]);
    expect(invocationProblems(dashboardRun(), { script: dashboard, files: DASHBOARD_ACCEPTANCE }, ROOT)).toEqual([]);
  });

  it('names what is not that, every problem at once', () => {
    const problems = (over: Partial<InvocationSummary>) => invocationProblems(run(design, over), { script: design }, ROOT);
    expect(problems({ status: 'failed' })).toEqual(['the run did not pass (failed)']);
    expect(problems({ argv: [...argvOf(design), '--grep-invert', 'menu'] })).toEqual(['the invocation was narrowed: the command line adds --grep-invert menu']);
    expect(problems({ config: { grep: /export/, grepInvert: null, shard: null, forbidOnly: true } })).toEqual(["the config's grep narrows the run (/export/)"]);
    expect(problems({ config: { grep: [/.*/, /x/], grepInvert: null, shard: null, forbidOnly: true } })).toEqual(["the config's grep narrows the run (/.*/ /x/)"]);
    expect(problems({ config: { grep: /.*/, grepInvert: /manual/, shard: null, forbidOnly: true } })).toEqual(["the config's grepInvert narrows the run (/manual/)"]);
    expect(problems({ config: { grep: /.*/, grepInvert: null, shard: { current: 1, total: 2 }, forbidOnly: true } })).toEqual(['the run is shard 1/2']);
    expect(problems({ config: { grep: /.*/, grepInvert: null, shard: null, forbidOnly: false } })).toEqual(['test.only admitted (no --forbid-only and no declared case counts)']);
    const rest = casesOf(DESIGN_SPECS.slice(1).map((file) => ({ file, tests: 2 })));
    expect(problems({ tests: rest })).toEqual(['a spec the script names did not run: design.spec.ts']);
    expect(problems({ tests: [...run(design).tests, { file: 'design-scale.spec.ts', title: 'scale', outcome: 'expected' }] })).toEqual(["a spec outside the script's ran: design-scale.spec.ts"]);
    expect(problems({ tests: [...run(design).tests, { file: 'design.spec.ts', title: 'held', outcome: 'skipped' }] })).toEqual(['a skipped case: design.spec.ts › held']);
    expect(problems({ tests: [...run(design).tests, { file: 'design.spec.ts', title: 'bad', outcome: 'unexpected' }] })).toEqual(['a case not expected (unexpected): design.spec.ts › bad']);
    expect(problems({ tests: [...run(design).tests, { file: 'design.spec.ts', title: 'never', outcome: 'not run' }] })).toEqual(['a case not expected (not run): design.spec.ts › never']);
    expect(problems({ tests: [] })).toContain('no case ran');
    expect(invocationProblems(run(design), { script: 'scripts/e2e-build.sh plain' }, ROOT)).toEqual(['the package script is not a plain `playwright test` command: scripts/e2e-build.sh plain']);
  });

  it('holds a group that declares its case counts to exactly those, in place of forbidding test.only', () => {
    const problems = (over: Partial<InvocationSummary>) => invocationProblems(dashboardRun(over), { script: dashboard, files: DASHBOARD_ACCEPTANCE }, ROOT);
    const [, ...rest] = dashboardRun().tests;
    expect(problems({ tests: rest })).toEqual(['dashboard.spec.ts: 3 cases of the declared 4']);
    expect(problems({ tests: dashboardRun().tests.filter((t) => t.file !== 'dashboard-history.spec.ts') })).toEqual(['dashboard-history.spec.ts: 0 cases of the declared 2']);
    expect(problems({ tests: [...dashboardRun().tests, { file: 'dashboard-scale.spec.ts', title: 'scale', outcome: 'expected' }] })).toEqual(['a file outside the declared list ran: dashboard-scale.spec.ts']);
    expect(problems({ argv: [...argvOf(dashboard), 'e2e/dashboard.spec.ts'] })).toEqual(['the invocation was narrowed: the command line adds e2e/dashboard.spec.ts']);
  });
});

describe('the dashboard’s declared acceptance list', () => {
  it('declares each spec file’s own count of cases, none skipped of its own', () => {
    for (const { file, tests } of DASHBOARD_ACCEPTANCE) {
      const source = readFileSync(join(REPO, 'e2e', file), 'utf8');
      expect(source.match(/^test\(/gm)?.length ?? 0, file).toBe(tests);
      expect(source, `${file} skips nothing of its own`).not.toMatch(/^test\.skip\(/m);
    }
  });
});

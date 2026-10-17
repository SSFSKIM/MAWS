// P3-E1 M6 final review: the Design final reporter at its own boundary (e2e/support/design-final-reporter.ts), driven as
// Playwright drives it (onBegin with the run's config and suite, onTestEnd per case, onEnd with the result), under the
// repository's real package script. A selected final run narrowed on the command line (a grep inverse, the last
// failures, a location, a test list) fails with that narrowing named, though all four specs are still represented; the
// package command itself passes the invocation checks and stops at the next precondition (here, not on CI) before any
// command runs; any other ref leaves the reporter silent whatever the outcome.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import DesignFinalReporter from '../../e2e/support/design-final-reporter';

const SPECS = ['design.spec.ts', 'design-comments.spec.ts', 'design-history.spec.ts', 'design-export.spec.ts'];
const PACKAGE = ['/usr/local/bin/node', '/repo/node_modules/@playwright/test/cli.js', 'test', ...SPECS.map((s) => `e2e/${s}`), '--forbid-only', '--add-reporter=./e2e/support/design-final-reporter.ts'];

function caseIn(file: string): TestCase {
  return { location: { file: `/repo/e2e/${file}`, line: 1, column: 1 }, titlePath: () => ['', file, `a case of ${file}`], outcome: () => 'expected' } as unknown as TestCase;
}
const cases = SPECS.map(caseIn);
const suite = { allTests: () => cases } as unknown as Suite;
const config = (argv: string[]): FullConfig => ({ argv, grep: /.*/, grepInvert: null, shard: null, forbidOnly: true }) as unknown as FullConfig;

async function run(argv: string[]): Promise<{ status: unknown; said: string[] }> {
  const said: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((line: string) => void said.push(line));
  vi.spyOn(console, 'log').mockImplementation((line: string) => void said.push(line));
  const reporter = new DesignFinalReporter();
  reporter.onBegin(config(argv), suite);
  for (const test of cases) reporter.onTestEnd(test, { status: 'passed' } as TestResult);
  const status = await reporter.onEnd({ status: 'passed' } as FullResult);
  return { status, said };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('the Design final reporter on a selected final run', () => {
  const selected = () => {
    vi.stubEnv('GITHUB_REF', 'refs/heads/ci/e1-final-a1b2c3d4');
    vi.stubEnv('GITHUB_REF_NAME', '');
    vi.stubEnv('CI', ''); // so the provenance stops at once, before any git, tar or digest runs
  };

  it('passes the package command’s invocation checks, stopping at the next precondition', async () => {
    selected();
    const { status, said } = await run(PACKAGE);
    expect(status).toEqual({ status: 'failed' });
    expect(said.join('\n')).toMatch(/design bundle: FAILED \(not on CI/);
  });

  for (const [what, argv] of [
    ['a grep inverse', [...PACKAGE, '--grep-invert', 'menu']],
    ['the last failures', [...PACKAGE, '--last-failed']],
    ['a location', PACKAGE.map((a) => (a === 'e2e/design.spec.ts' ? 'e2e/design.spec.ts:120' : a))],
    ['a test list', [...PACKAGE, '--test-list=cases.txt']],
  ] as const)
    it(`fails a run narrowed by ${what}, naming it, every spec still represented`, async () => {
      selected();
      const { status, said } = await run([...argv]);
      expect(status).toEqual({ status: 'failed' });
      expect(said.join('\n')).toMatch(/design bundle: FAILED \(.*the invocation was filtered/);
      expect(said.join('\n')).not.toMatch(/not on CI/);
    });
});

describe('the Design final reporter on any other run', () => {
  it('says nothing and changes no status, whatever the command line', async () => {
    vi.stubEnv('GITHUB_REF', 'refs/heads/ci/e1-development-a1b2c3d4');
    vi.stubEnv('GITHUB_REF_NAME', '');
    const { status, said } = await run([...PACKAGE, '--grep', 'menu']);
    expect(status).toBeUndefined();
    expect(said).toEqual([]);
  });
});

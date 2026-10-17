// P3-E1 M6 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M6; gate-offload Decision Log 50): the final
// reporter `pnpm e2e:design` adds beside the configured list and HTML reporters (`--add-reporter`). On any ref but the
// reserved `ci/e1-final-<short>` it does nothing. On that ref it collects the invocation (the specs loaded, every case's
// outcome, any narrowing: the config's filters and the runner's command line against the package command) and, at the end, writes the plain bundle or fails the run with the named reason
// (./design-bundle.ts says which checks, in which order). A failed bundle returns a failed status from `onEnd`, so a green
// final run without its bundle cannot happen.
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { finalBundle, intendedSpecs, invocationFilters, realCommand, selectedRef, type InvocationSummary } from './design-bundle';

const ROOT = resolve(__dirname, '../..');
const SCRIPT = 'e2e:design';

/** The spec files the package's e2e:design script runs, by name; throws when the package cannot be read. */
function packageSpecs(): string[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  return intendedSpecs(pkg.scripts?.[SCRIPT] ?? '').sort();
}

export default class DesignFinalReporter implements Reporter {
  private suite: Suite | null = null;
  private filtered: string[] = [];
  private readonly outcomes = new Map<TestCase, string>();

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    if (selectedRef(process.env) === null) return;
    this.suite = suite;
    const greps = (g: RegExp | RegExp[] | null) => (g === null ? [] : Array.isArray(g) ? g : [g]);
    const grep = greps(config.grep).map(String);
    if (!(grep.length === 1 && grep[0] === '/.*/')) this.filtered.push(`--grep ${grep.join(' ')}`);
    if (greps(config.grepInvert).length > 0) this.filtered.push(`--grep-invert ${greps(config.grepInvert).map(String).join(' ')}`);
    if (config.shard) this.filtered.push(`--shard ${config.shard.current}/${config.shard.total}`);
    if (!config.forbidOnly) this.filtered.push('test.only admitted (no --forbid-only)');
    // M6 final review: the CLI's own narrowing (a grep or its inverse, the last failures, a test list, a location…) is
    // applied outside the config above; the runner's command line is checked against the package command itself
    try {
      this.filtered.push(...invocationFilters(config.argv ?? [], packageSpecs(), ROOT));
    } catch (error) {
      this.filtered.push(`the package script could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (this.suite === null) return;
    // the last result is the case's (no retries are configured)
    this.outcomes.set(test, result.status === 'skipped' ? 'skipped' : test.outcome());
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    if (selectedRef(process.env) === null) return undefined;
    const tests = (this.suite?.allTests() ?? []).map((test) => ({ file: basename(test.location.file), title: test.titlePath().slice(1).join(' › '), outcome: this.outcomes.get(test) ?? 'not run' }));
    const run: InvocationSummary = { status: result.status, specs: [...new Set(tests.map((t) => t.file))].sort(), tests, filtered: this.filtered };
    let intended: string[];
    try {
      intended = packageSpecs();
    } catch (error) {
      console.error(`design bundle: FAILED (the package script could not be read: ${error instanceof Error ? error.message : String(error)})`);
      return { status: 'failed' };
    }
    const outcome = finalBundle({ root: ROOT, env: process.env, platform: process.platform, run: realCommand(ROOT), log: (line) => console.log(line) }, run, intended);
    if (!outcome.selected) return undefined;
    if (outcome.ok) return undefined;
    console.error(`design bundle: FAILED (${outcome.reason})`);
    return { status: 'failed' };
  }
}

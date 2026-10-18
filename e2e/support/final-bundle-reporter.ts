// The one final reporter (gate-offload Decision Log 50; P3-F converged E1's, E2's and H's here, the tracker's reporter
// row): it writes a live run's build into a final gate run's evidence (./final-bundle.ts) when the whole declared
// invocation passed (./final-invocation.ts). Each acceptance group names it with its reserved labels, its package script
// and, when it declares them, its files' case counts:
//   - `pnpm e2e:design` through ./design-final-reporter.ts (`ci/e1-final-*`);
//   - `pnpm e2e:dashboard` through ./dashboard-final-reporter.ts (`ci/e2-final-*`, and P3-F's `ci/p3f-final-*`);
//   - a group whose script sets `MAWS_E2E_FINAL_BUNDLE=<label>:<variant>` (H's `e2e:connectors`), which
//     playwright.config.ts reads, the script being the one pnpm runs (`npm_lifecycle_event`).
// On any other ref it writes nothing and changes nothing. On a reserved ref it writes the bundle only when the whole
// invocation passed: the script's own command line, the config unnarrowed, every case run and expected, none skipped;
// an otherwise-passing invocation that is not that, or a build it cannot prove the source's (CI, macOS, the wrapper, the
// trees, the cache), fails the run by name, so a green final run always carries its bundle. A run already failed stays
// failed, with no bundle.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { selectedRef, writeFinalBundle, type BundleVariant } from './final-bundle';
import { invocationProblems, type DeclaredInvocation, type InvocationSummary } from './final-invocation';

export interface FinalBundleOptions {
  labels: readonly string[];
  variant: BundleVariant;
  script?: string; // the package script the group runs; unset, the one pnpm runs (`npm_lifecycle_event`)
  files?: DeclaredInvocation['files']; // the files' declared case counts, when the group declares them
}

// `<label>:<variant>` as playwright.config.ts reads MAWS_E2E_FINAL_BUNDLE; null when unset.
export function finalBundleOption(value: string | undefined): FinalBundleOptions | null {
  if (value === undefined || value === '') return null;
  const match = /^([A-Za-z0-9._-]+):(plain|harness)$/.exec(value);
  if (!match) throw new Error(`MAWS_E2E_FINAL_BUNDLE must be <label>:plain or <label>:harness, not "${value}"`);
  return { labels: [match[1]!], variant: match[2] as BundleVariant };
}

export default class FinalBundleReporter implements Reporter {
  private root = process.cwd();
  private outputDir = join(process.cwd(), 'test-results');
  private config: FullConfig | null = null;
  private suite: Suite | null = null;
  private readonly outcomes = new Map<TestCase, string>();

  constructor(private readonly options: FinalBundleOptions) {}

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    if (config.configFile) this.root = dirname(config.configFile);
    this.outputDir = config.projects[0]?.outputDir ?? join(this.root, 'test-results');
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // the last result is the case's (no retries are configured)
    this.outcomes.set(test, result.status === 'skipped' ? 'skipped' : test.outcome());
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    const log = (line: string) => console.log(line);
    const selected = selectedRef(this.options.labels, process.env);
    if (selected === null) {
      log(`final bundle: not written (the ref ${process.env.GITHUB_REF_NAME || process.env.GITHUB_REF || '(none)'} is not ci/<${this.options.labels.join('|')}>-<sha>)`);
      return undefined;
    }
    const refuse = (why: string) => {
      console.error(`final bundle: REFUSED on the final run ${selected.ref}: ${why}`);
      return { status: 'failed' as const };
    };
    if (result.status !== 'passed') {
      log(`final bundle: not written (the run ${result.status})`); // already a failure
      return undefined;
    }
    const scriptName = this.options.script ?? process.env.npm_lifecycle_event;
    if (!scriptName) return refuse('not run through a package script (no npm_lifecycle_event)');
    let script: string | undefined;
    try {
      script = (JSON.parse(readFileSync(join(this.root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts?.[scriptName];
    } catch (error) {
      return refuse(`the package script ${scriptName} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (script === undefined) return refuse(`no package script ${scriptName}`);
    const config = this.config;
    const run: InvocationSummary = {
      status: result.status,
      argv: config?.argv ?? [],
      config: { grep: config?.grep ?? /.*/, grepInvert: config?.grepInvert ?? null, shard: config?.shard ?? null, forbidOnly: config?.forbidOnly ?? false },
      tests: (this.suite?.allTests() ?? []).map((test) => ({ file: basename(test.location.file), title: test.titlePath().slice(1).join(' › '), outcome: this.outcomes.get(test) ?? 'not run' })),
    };
    const problems = invocationProblems(run, { script, files: this.options.files }, this.root);
    if (problems.length > 0) return refuse(`not the whole invocation of ${scriptName}: ${problems.join('; ')}`);
    try {
      writeFinalBundle({ labels: this.options.labels, variant: this.options.variant, root: this.root, bundleDir: join(this.outputDir, 'bundle'), env: process.env, platform: process.platform, log });
      return undefined;
    } catch (error) {
      return refuse(error instanceof Error ? error.message : String(error));
    }
  }
}

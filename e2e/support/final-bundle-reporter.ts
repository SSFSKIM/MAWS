// The final reporter that writes a child's live-run build into its acceptance run's evidence (./final-bundle.ts; gate-
// offload Decision Log 50). playwright.config.ts adds it beside the list and HTML reporters only when the invocation
// names it (`MAWS_E2E_FINAL_BUNDLE=<label>:<variant>`, set by the child's acceptance script), so every other run is as
// it was. The child's reserved ref alone selects the final run (Decision Log 50, amended 19:57Z): on any other ref it
// writes nothing and changes nothing. On the final ref it writes the bundle only when the whole invocation passed,
// every test ran and passed; an otherwise-passing invocation with a skipped test or none, or a build it cannot prove
// the source's (CI, macOS, the wrapper, the trees, the cache), fails the run, so a green final run always carries its
// bundle. A run already failed stays failed, with no bundle.
import { dirname, join } from 'node:path';
import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { isFinalRef, writeFinalBundle, type BundleVariant } from './final-bundle';

export interface FinalBundleOptions {
  label: string;
  variant: BundleVariant;
}

// `<label>:<variant>` as playwright.config.ts reads MAWS_E2E_FINAL_BUNDLE; null when unset.
export function finalBundleOption(value: string | undefined): FinalBundleOptions | null {
  if (value === undefined || value === '') return null;
  const match = /^([A-Za-z0-9._-]+):(plain|harness)$/.exec(value);
  if (!match) throw new Error(`MAWS_E2E_FINAL_BUNDLE must be <label>:plain or <label>:harness, not "${value}"`);
  return { label: match[1]!, variant: match[2] as BundleVariant };
}

export default class FinalBundleReporter implements Reporter {
  private root = process.cwd();
  private outputDir = join(process.cwd(), 'test-results');
  private ran = 0;
  private notPassed: string[] = [];

  constructor(private readonly options: FinalBundleOptions) {}

  onBegin(config: FullConfig): void {
    if (config.configFile) this.root = dirname(config.configFile);
    this.outputDir = config.projects[0]?.outputDir ?? join(this.root, 'test-results');
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // the last attempt decides (retries are 0 in this config, so there is one)
    if (result.retry < test.retries && result.status !== 'passed') return;
    this.ran += 1;
    if (result.status !== 'passed') this.notPassed.push(`${test.title}: ${result.status}`);
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    const log = (line: string) => console.log(line);
    if (!isFinalRef(this.options.label, process.env)) {
      log(`final bundle: not written (the ref ${process.env.GITHUB_REF_NAME || '(none)'} is not ci/${this.options.label}-<sha>)`);
      return undefined;
    }
    const refuse = (why: string) => {
      console.error(`final bundle: REFUSED on the final run: ${why}`);
      return { status: 'failed' as const };
    };
    if (result.status !== 'passed') {
      log(`final bundle: not written (the run ${result.status})`); // already a failure
      return undefined;
    }
    if (this.ran === 0) return refuse('no test ran');
    if (this.notPassed.length > 0) return refuse(`not every test passed: ${this.notPassed.join(', ')}`);
    try {
      writeFinalBundle({ ...this.options, root: this.root, bundleDir: join(this.outputDir, 'bundle'), env: process.env, platform: process.platform, log });
      return undefined;
    } catch (error) {
      return refuse(error instanceof Error ? error.message : String(error));
    }
  }

  printsToStdio(): boolean {
    return false;
  }
}

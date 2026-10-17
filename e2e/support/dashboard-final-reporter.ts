// The dashboard acceptance run's final reporter (P3-E2 M6; gate-offload Decision Log 50; P3-E Decision Log 36 (2)):
// named only by playwright.dashboard.config.ts, so only `pnpm e2e:dashboard` runs it. On any run but the reserved
// `ci/e2-final-*` one it does nothing; on that one it writes the final bundle after the whole invocation passed, or
// fails the run by name (its `onEnd` status), never a green run without its bundle. The checks are ./dashboard-bundle.ts's.
import { resolve } from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter';
import { finalBundle, realCommand, specName } from './dashboard-bundle';

const REPO_ROOT = resolve(__dirname, '..', '..');

export default class DashboardFinalReporter implements Reporter {
  private config: FullConfig | null = null;
  private suite: Suite | null = null;

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
  }

  printsToStdio(): boolean {
    return false;
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const config = this.config;
    const tests = (this.suite?.allTests() ?? []).map((test) => ({ file: specName(test.location.file), title: test.titlePath().slice(1).join(' › '), outcome: test.outcome() }));
    const outcome = finalBundle(
      { root: REPO_ROOT, env: process.env, platform: process.platform, run: realCommand(REPO_ROOT), log: (line) => console.log(line) },
      { status: result.status, argv: process.argv, config: { grep: config?.grep ?? /.*/, grepInvert: config?.grepInvert ?? null, shard: config?.shard ?? null }, tests },
    );
    if (!outcome.selected || outcome.ok) return undefined;
    console.error(`dashboard final bundle: the reserved final run fails: ${outcome.reason}`);
    return { status: 'failed' };
  }
}

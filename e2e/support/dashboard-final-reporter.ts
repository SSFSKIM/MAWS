// The dashboard acceptance run's final reporter (P3-E2 M6; gate-offload Decision Log 50; P3-E Decision Log 36 (2)), named
// only by playwright.dashboard.config.ts, so only `pnpm e2e:dashboard` runs it: the shared final reporter
// (./final-bundle-reporter.ts, converged at P3-F) checking the run against the `e2e:dashboard` script and the declared
// files' case counts (./dashboard-acceptance.ts). Its reserved refs are E2's `ci/e2-final-*` and P3-F's hand-back
// `ci/p3f-final-*`: the whole class-1b set on P3-F's frozen source carries its plain bundle from this group, eleven
// declared cases with no skip of their own.
import { DASHBOARD_ACCEPTANCE } from './dashboard-acceptance';
import FinalBundleReporter from './final-bundle-reporter';

export default class DashboardFinalReporter extends FinalBundleReporter {
  constructor() {
    super({ labels: ['e2-final', 'p3f-final'], variant: 'plain', script: 'e2e:dashboard', files: DASHBOARD_ACCEPTANCE });
  }
}

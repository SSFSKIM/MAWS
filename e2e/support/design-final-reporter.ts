// P3-E1 M6 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M6; gate-offload Decision Log 50): the final
// reporter `pnpm e2e:design` adds beside the configured list and HTML reporters (`--add-reporter`, which takes no
// options, hence this module): the shared final reporter (./final-bundle-reporter.ts, converged at P3-F) on E1's
// reserved `ci/e1-final-*` ref, checking the run against the `e2e:design` script, which names its four specs and
// `--forbid-only`.
import FinalBundleReporter from './final-bundle-reporter';

export default class DesignFinalReporter extends FinalBundleReporter {
  constructor() {
    super({ labels: ['e1-final'], variant: 'plain', script: 'e2e:design' });
  }
}

// The staging phone run (P5 O13 M7, Interfaces §H), run only by `apps/desk-hub/deploy/staging-run.sh phone <n>`, which
// sets DESK_STAGING_PHONE=1 (or `cleanup`, its last step) and the run's environment (staging/run.ts): MAWS's endpoint
// module enrolled on desk-hub-staging as `o13-phone-<n>`, the owner's cards raised on it, answered by the owner's phone
// (or, with `--rehearse`, by the owner's second device in its place), and acceptance 1-3 and 5 checked, one `PASS`,
// `FAIL`, `NOT RUN` or `NOT SHOWN` line per item; then everything the run made undone, however it ended. Skipped in every
// other run of the `node` project; its pieces load only when it runs. Its lines go straight to stdout, as the run makes
// them, so the owner reads the WAITING line while the run waits.
import { describe, expect, it } from 'vitest';

const gate = process.env.DESK_STAGING_PHONE;
const write = (line: string) => void process.stdout.write(`${line}\n`);

describe.skipIf(gate !== '1' && gate !== 'cleanup')('the staging phone run', () => {
  it(
    gate === 'cleanup' ? 'undoes what the run left' : 'runs acceptance 1-3 and 5 on staging',
    async () => {
      const { readRun, stopLine } = await import('./staging/run');
      const run = readRun(process.env);
      if (run.mode === 'cleanup') {
        const { Cleanup } = await import('../../apps/desk-hub/deploy/proof');
        const { stagingAdmin } = await import('./staging/world');
        const { sweepRun } = await import('./staging/sweep');
        const { person, admin } = await stagingAdmin(run, new Cleanup(), () => {});
        const left = await sweepRun(admin, person, run.n, write);
        for (const line of left) write(`LEFT ${line}`);
        expect(left).toEqual([]);
        return;
      }
      const { startStagingWorld } = await import('./staging/world');
      const { Report } = await import('./staging/report');
      const { runItems } = await import('./staging/items');
      const report = new Report(write);
      let world: Awaited<ReturnType<typeof startStagingWorld>> | null = null;
      let stopped: string | null = null;
      try {
        world = await startStagingWorld(run, write);
        await runItems(world, report, write);
      } catch (error) {
        stopped = stopLine(error);
        write(`the run stopped: ${stopped}`);
      } finally {
        const failed = world === null ? [] : await world.cleanup.run();
        for (const failure of failed) write(`LEFT cleanup step failed: ${failure}`);
        if (world !== null && world.left.length === 0 && failed.length === 0) write('cleanup: nothing of the run is current');
      }
      const passed = report.summary();
      expect({ passed, stopped, left: world?.left ?? [] }).toEqual({ passed: true, stopped: null, left: [] });
    },
    40 * 60_000,
  );
});

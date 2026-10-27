// Two machines, one app (P5 O6, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md; OX2): two MAWS profiles on
// this Mac stand in for two machines. Profile B's app, started with MAWS_MACHINE_SERVE=1, serves its machine services on
// a same-uid socket in its serve directory; profile A's app, started with MAWS_LOCAL_MACHINES naming that directory,
// reaches them through its connection manager. At O3 the scene starts B's mawsd instead of a second app.
//   M3: A's machines.list shows B up with B's ref; A's raw bridge, naming B's ref, lists B's seeded session and not A's;
//       closing B turns B down within 2 s.
// Run by `pnpm e2e:machines` (MAWS_MACHINES_E2E=1).
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { MachineState } from '../src/shared/ipc/schema/machines';
import type { MachineRef } from '../src/shared/machine/ref';
import { localRef } from './support/address';
import { launchMaws, type MawsLaunch } from './support/launch';
import { seedTranscripts } from './support/maws-tools';

test.skip(process.env.MAWS_MACHINES_E2E !== '1', 'the two-machine scenes run under pnpm e2e:machines (MAWS_MACHINES_E2E=1)');
test.setTimeout(120_000);

const SERVE_DIR = 'machine-serve'; // src/main/machines/serve-standin.ts

// The raw bridge's answer, or the test fails with the error it carried.
async function invoke<T>(page: Page, name: string, input: unknown, machine?: MachineRef): Promise<T> {
  const result = await page.evaluate(([n, i, m]) => window.maws.invoke(n as never, i as never, (m ?? undefined) as never), [name, input, machine ?? null] as const);
  if (!(result as { ok: boolean }).ok) throw new Error(`${name}: ${JSON.stringify((result as { error: unknown }).error)}`);
  return (result as { value: T }).value;
}
const machinesOf = (page: Page) => invoke<{ machines: MachineState[] }>(page, 'machines.list', undefined).then(({ machines }) => machines);
const engineIdsOn = (page: Page, machine?: MachineRef) =>
  invoke<{ sessions: { engineSessionId: string | null }[] }>(page, 'session.list', {}, machine).then(({ sessions }) => sessions.map((s) => s.engineSessionId));

test('A reaches B’s sessions through the link, and B’s departure turns B down within 2 s', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-machines-')));
  const launches: MawsLaunch[] = [];
  try {
    const [aDir, bDir] = ['a', 'b'].map((name) => {
      const dir = join(root, `folder-${name}`);
      mkdirSync(dir);
      return dir;
    });
    let bSeeded: string[] = [];
    let aSeeded: string[] = [];
    const b = await launchMaws({
      env: { MAWS_MACHINE_SERVE: '1', MAWS_MACHINE_NAME: 'standin-b' },
      prepare: ({ claudeConfigDir }) => void (bSeeded = seedTranscripts(claudeConfigDir, bDir!, ['B’s seeded session'])),
    });
    launches.push(b);
    const bRef = await localRef(b.page);
    await expect.poll(() => engineIdsOn(b.page), { timeout: 30_000 }).toContain(bSeeded[0]);

    const a = await launchMaws({
      env: { MAWS_LOCAL_MACHINES: join(b.userData, SERVE_DIR), MAWS_MACHINE_NAME: 'standin-a' },
      prepare: ({ claudeConfigDir }) => void (aSeeded = seedTranscripts(claudeConfigDir, aDir!, ['A’s seeded session'])),
    });
    launches.push(a);
    const aRef = await localRef(a.page);
    expect(aRef).not.toBe(bRef);
    await expect.poll(() => engineIdsOn(a.page), { timeout: 30_000 }).toContain(aSeeded[0]);

    // machines.list: A first and local, then B up with B's ref and name
    await expect.poll(async () => (await machinesOf(a.page)).find((m) => m.ref === bRef)?.state, { timeout: 15_000 }).toBe('up');
    const machines = await machinesOf(a.page);
    expect(machines[0]).toMatchObject({ ref: aRef, local: true, state: 'up', name: 'standin-a' });
    expect(machines.find((m) => m.ref === bRef)).toMatchObject({ local: false, name: 'standin-b', generation: 1 });

    // session.list naming B's ref is B's index: its seeded session, not A's
    const onB = await engineIdsOn(a.page, bRef);
    expect(onB).toContain(bSeeded[0]);
    expect(onB).not.toContain(aSeeded[0]);

    // B quits: its link closes with its process, and A says so within 2 s
    let exitedAt = 0;
    b.app.process().once('exit', () => (exitedAt = Date.now()));
    await b.cleanup();
    launches.splice(launches.indexOf(b), 1);
    await expect.poll(async () => (await machinesOf(a.page)).find((m) => m.ref === bRef)?.state, { timeout: 2_000 }).toBe('down');
    const down = (await machinesOf(a.page)).find((m) => m.ref === bRef)!;
    expect(exitedAt).toBeGreaterThan(0);
    expect(Date.parse(down.since) - exitedAt, 'B down within 2 s of its exit').toBeLessThanOrEqual(2_000);
    await expect(invoke(a.page, 'session.list', {}, bRef)).rejects.toThrow(/host_unavailable/);
  } finally {
    for (const launch of launches.reverse()) await launch.cleanup().catch((error: unknown) => console.error('[e2e] cleanup failed', error));
    rmSync(root, { recursive: true, force: true });
  }
});

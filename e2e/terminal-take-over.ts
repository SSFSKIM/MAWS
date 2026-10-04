// Included by the terminal group. Real PTYs and product confirmation; replayed engine, no model calls.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { fixtureIdentity } from '../test/support/fixture-session-id';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import { launchMaws, REPO_ROOT, test, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';

async function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>) {
  const result = await page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const) as CommandResult<N>;
  if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
  return result.value;
}
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const ps = (pid: number) => {
  try { return execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

for (const ready of [true, false]) {
  test(`pause-first takeover ${ready ? 'ends the paused CLI only after ready and leaves a usable shell' : 'returns the CLI to the foreground when resume is refused'}`, async () => {
    test.setTimeout(90_000);
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const fixture = 'spikes/protocol-probe/fixtures/pass2/auto-routed.jsonl';
    const sid = fixtureIdentity(fixture).sessionId;
    const log = join(store.configHome, 'pane-events.jsonl');
    let maws: MawsLaunch | null = null;
    let pid: number | null = null;
    try {
      await store.addTranscript(repo.root, sid, [{ type: 'user', uuid: 'w14-user', parentUuid: null, cwd: repo.root, sessionId: sid, timestamp: '2026-10-03T10:00:00.000Z', message: { role: 'user', content: 'W14 pane takeover' } }]);
      writeFileSync(join(store.configHome, '.claude.json'), JSON.stringify({ projects: { [repo.root]: { hasTrustDialogAccepted: true } } }));
      writeFileSync(join(store.configHome, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'default' } }));
      maws = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: '', MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: ready ? fixture : '', CLAUDE_CONFIG_DIR: store.configHome, DISABLE_AUTOUPDATER: '1' } });
      const { page } = maws;
      await invoke(page, 'settings.set', { gateway: { defaultRoute: 'direct' } });
      await expect.poll(async () => (await invoke(page, 'session.list', {})).sessions.some((r) => r.engineSessionId === sid), { timeout: 20_000 }).toBe(true);
      const record = (await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sid)!;
      await (await sidebarRow(page, { appSessionId: record.appId })).click();
      const panel = page.locator('[data-region="panel"]');
      await panel.getByRole('button', { name: 'Add a tool' }).click();
      await page.getByRole('menuitem', { name: 'Terminal', exact: true }).click();
      await expect.poll(async () => (await invoke(page, 'pty.list', undefined)).ptys.filter((p) => p.alive), { timeout: 15_000 }).toHaveLength(1);
      const pane = (await invoke(page, 'pty.list', undefined)).ptys.find((p) => p.alive)!;
      await expect.poll(async () => (await invoke(page, 'pty.foreground', { ptyId: pane.ptyId })).busy).toBe(false);
      const command = [process.execPath, join(REPO_ROOT, 'test/support/pause-cli.mjs'), store.configHome, sid, log].map(quote).join(' ');
      await invoke(page, 'pty.write', { ptyId: pane.ptyId, data: `${command}\n` });
      const events = () => { try { return readFileSync(log, 'utf8').trim().split('\n').map((s) => JSON.parse(s) as { event: string; pid: number }); } catch { return []; } };
      await expect.poll(() => events().map((e) => e.event), { timeout: 10_000 }).toContain('ready');
      pid = events()[0].pid;
      await expect(page.getByRole('button', { name: 'Take over here' })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Take over here' }).click();
      const confirm = page.getByRole('dialog', { name: 'Take over this session?' });
      await expect(confirm).toContainText('terminal pane “W14 CLI”');
      await expect(confirm).toContainText('A turn in progress there is lost.');
      await confirm.getByRole('button', { name: 'Take over', exact: true }).click();
      await expect.poll(() => events().map((e) => e.event)).toContain('suspended');
      if (ready) {
        await expect.poll(async () => (await invoke(page, 'session.status', { appSessionId: record.appId })).process, { timeout: 25_000 }).toBe('ready');
        await expect.poll(() => ps(pid!), { timeout: 12_000 }).toBe('');
        expect(events().map((e) => e.event)).not.toContain('continued');
        expect((await invoke(page, 'fs.holders', { sessionIds: [sid], directories: null })).holders.some((r) => r.holder.kind === 'terminal' && r.holder.pid === pid)).toBe(false);
        await expect.poll(async () => (await invoke(page, 'pty.foreground', { ptyId: pane.ptyId })).busy).toBe(false);
        const proof = join(store.configHome, 'shell-proof');
        await invoke(page, 'pty.write', { ptyId: pane.ptyId, data: `printf 'usable\\n' > ${quote(proof)}; stty -a >> ${quote(proof)}\n` });
        await expect.poll(() => { try { return readFileSync(proof, 'utf8'); } catch { return ''; } }).toMatch(/usable[\s\S]*\bicanon\b[\s\S]*\becho\b/);
        expect(readFileSync(proof, 'utf8')).not.toMatch(/-icanon|-echo\s/);
      } else {
        await expect.poll(() => events().map((e) => e.event), { timeout: 15_000 }).toContain('continued');
        expect(ps(pid)).not.toContain('T');
        expect((await invoke(page, 'pty.foreground', { ptyId: pane.ptyId })).busy).toBe(true);
        await expect(page.getByText(/replay_disabled.*terminal CLI is back in the foreground/)).toBeVisible();
      }
    } finally {
      if (pid !== null && ps(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ } }
      await maws?.cleanup();
      await store.dispose();
      await repo.dispose();
    }
  });
}

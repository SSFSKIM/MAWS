import { expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { PtyInfo } from '@shared/ipc/schema/pty';
import { pauseTakeOver, type PauseDeps } from './pause-take-over';
import { parseProcesses } from './pane-holder';

const q = { appSessionId: 'app' as AppSessionId, engineSessionId: 'engine' as SessionId };
function fixture() {
  let state = 'R+';
  let present = true;
  let foreground = 30;
  const events: string[] = [];
  const table = () => parseProcesses(`10 1 10 ${foreground} Ss Mon Oct 3 12:00:00 2026\n${present ? `30 10 30 ${foreground} ${state} Mon Oct 3 12:00:01 2026` : ''}`);
  const target = { pane: { pid: 10, ptyId: 'pane', alive: true, label: 'Terminal' } as PtyInfo, holder: table().get(30)! };
  const deps: PauseDeps = {
    processes: async () => table(),
    write: async (data) => { events.push(data); if (data === '\x1a') { state = 'T'; foreground = 10; } else { state = 'R+'; foreground = 30; } },
    foreground: async () => ({ process: foreground === 10 ? 'bash' : 'claude', busy: foreground !== 10 }),
    signal: (_pid, signal) => { events.push(signal); present = false; },
    clear: async () => !present,
    resume: async (allow) => { expect(await allow.isPaused()).toBe(true); events.push('ready'); },
    cancel: async () => { events.push('cancel'); return true; },
    waitMs: 25, pollMs: 1,
  };
  return { deps, target, events, state: (s: string) => { state = s; }, foreground: (pid: number) => { foreground = pid; } };
}
it('pauses through the pane and waits for ready before ending the CLI and clearing its registry row', async () => {
  const f = fixture();
  expect(await pauseTakeOver(f.deps, q, f.target)).toEqual({ status: 'resumed', warning: null });
  expect(f.events).toEqual(['\x1a', 'ready', 'SIGKILL']);
});
it('never launches or kills when the stop is not observed', async () => {
  const f = fixture(); f.deps.write = async (data) => { f.events.push(data); };
  expect(await pauseTakeOver(f.deps, q, f.target)).toMatchObject({ status: 'refused', reason: 'pause_failed' });
  expect(f.events).toEqual(['\x1a']);
});
it.each(['resume refused', 'engine not ready'])('restores the foreground job after %s, only after the new engine is gone', async (message) => {
  const f = fixture(); f.deps.resume = async () => { f.events.push('resume'); throw new Error(message); };
  const result = await pauseTakeOver(f.deps, q, f.target);
  expect(result).toMatchObject({ status: 'refused', reason: 'resume_failed', message: expect.stringContaining(message) });
  expect(f.events).toEqual(['\x1a', 'resume', 'cancel', '\x15fg\n']);
});
it('leaves the holder paused with a manual recovery reason if the new engine cannot be stopped', async () => {
  const f = fixture(); f.deps.resume = async () => { throw new Error('no ready'); }; f.deps.cancel = async () => false;
  expect(await pauseTakeOver(f.deps, q, f.target)).toMatchObject({ status: 'refused', message: expect.stringContaining('still be running') });
  expect(f.events).toEqual(['\x1a']);
});
it('does not type fg into a busy pane or guess among stopped jobs', async () => {
  const f = fixture(); f.deps.resume = async () => { f.foreground(80); throw new Error('refused'); };
  expect(await pauseTakeOver(f.deps, q, f.target)).toMatchObject({ status: 'refused', message: expect.stringContaining('type fg') });
  expect(f.events).toEqual(['\x1a', 'cancel']);
});
it('reports end-step failure without resuming the old writer alongside the ready engine', async () => {
  const f = fixture(); f.deps.signal = vi.fn(() => { throw new Error('denied'); });
  expect(await pauseTakeOver(f.deps, q, f.target)).toMatchObject({ status: 'resumed', warning: expect.stringContaining('denied') });
  expect(f.events).toEqual(['\x1a', 'ready']);
});
it('waits for the old registry row rather than mistaking MAWS readiness for release', async () => {
  const f = fixture(); f.deps.clear = async () => false;
  expect(await pauseTakeOver(f.deps, q, f.target)).toMatchObject({ status: 'resumed', warning: expect.stringContaining('registry') });
});

it('does not foreground an already stopped job when no pause was sent', async () => {
  const f = fixture(); f.state('T'); f.foreground(10);
  expect(await pauseTakeOver(f.deps, q, f.target)).toMatchObject({ status: 'refused' });
  expect(f.events).toEqual([]);
});
it('does not signal a recycled holder pid after the engine became ready', async () => {
  const f = fixture();
  f.deps.resume = async () => {
    f.events.push('ready');
    f.deps.processes = async () => parseProcesses('10 1 10 10 Ss Mon Oct 3 12:00:00 2026\n30 10 30 10 T Mon Oct 3 12:00:09 2026');
  };
  expect(await pauseTakeOver(f.deps, q, f.target)).toMatchObject({ status: 'refused' });
  expect(f.events).toEqual(['\x1a', 'ready', 'cancel']);
});

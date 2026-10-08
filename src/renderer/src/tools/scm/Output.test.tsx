// The Output disclosure (E6 execution document, Design §4 and §5): the latest remote run of the session, resumed from
// main's snapshot and advanced by sequence number, with Cancel while it runs, main's truncation mark, the exit line,
// and the pull request a PR run printed. Main is a fake bridge behind the renderer's validating client.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { ScmRemoteLast, ScmRemoteOutput } from '@shared/ipc/schema/scm';
import { ok } from '../../test-support/code';
import { A, OTHER_TOKEN, planOf, prPlanOf, scmMain, TOKEN } from '../../test-support/scm';
import { Output } from './Output';
import { useScm } from './store';
import { createScmUi, type ScmUi } from './view-state';

let main: ReturnType<typeof scmMain>;
let ui: StoreApi<ScmUi>;
let release: () => void = () => {};

const out = (seq: number, text: string, over: Partial<ScmRemoteOutput> = {}): ScmRemoteOutput => ({ appSessionId: A, token: TOKEN, seq, kind: 'stderr', text, ...over });
const exit = (seq: number, exitCode: number | null, signal: string | null = null, token = TOKEN): ScmRemoteOutput => ({ appSessionId: A, token, seq, kind: 'exit', exitCode, signal });
const snapshot = (over: Partial<NonNullable<ScmRemoteLast>> = {}): ScmRemoteLast => ({
  token: TOKEN,
  kind: 'push',
  plan: planOf(),
  running: true,
  exitCode: null,
  signal: null,
  output: 'one\ntwo\nthree\n',
  truncated: false,
  seq: 3,
  startedAt: '2026-10-06T10:00:00.000Z',
  ...over,
});

async function mount(last: ScmRemoteLast) {
  main.state.answers['scm.remote.last'] = () => ok(last);
  release = useScm.getState().resume(A);
  const view = render(<Output appSessionId={A} ui={ui} />);
  await waitFor(() => expect(main.callsOf('scm.remote.last')).toHaveLength(1));
  return view;
}
const section = () => screen.getByRole('region', { name: 'Output' });
const text = () => section().querySelector('[data-scm-output-text]')?.textContent;
const state = () => section().querySelector('[data-scm-output-state]');

beforeEach(() => {
  useScm.getState().reset();
  main = scmMain();
  ui = createScmUi({ session: A });
});
afterEach(() => {
  release();
  cleanup();
});

describe('output appends chunks in order, drops a seq at or below the snapshot’s, caps, and shows the exit', () => {
  it('opens itself on a running run from the snapshot, appends past its seq only, marks the truncation and shows the exit', async () => {
    await mount(snapshot());
    await waitFor(() => expect(text()).toBe('one\ntwo\nthree'));
    expect(ui.getState().output).toBe(true);
    expect(state()?.textContent).toBe('Push · Running…');
    expect(section().querySelector('[data-scm-output-command]')?.textContent).toBe('/usr/bin/git push --progress --recurse-submodules=no origin refs/heads/main:refs/heads/main');

    main.emit('scm.remote.output', out(2, 'two again\n'));
    main.emit('scm.remote.output', out(3, 'three again\n'));
    main.emit('scm.remote.output', out(4, 'four\n'));
    main.emit('scm.remote.output', out(5, 'fi'));
    main.emit('scm.remote.output', out(6, 've\n'));
    await waitFor(() => expect(text()).toBe('one\ntwo\nthree\nfour\nfive'));
    expect(section().querySelector('[data-scm-output-truncated]')).toBeNull();
    main.emit('scm.remote.output', out(7, '', { truncated: true }));
    await waitFor(() => expect(section().querySelector('[data-scm-output-truncated]')?.textContent).toBe('Output past 1 MiB was dropped'));

    main.emit('scm.remote.output', exit(8, 1));
    await waitFor(() => expect(state()?.textContent).toBe('Push · Exited with code 1'));
    expect(state()?.className).toContain('text-danger');
    expect(section().querySelector('[data-scm-output-exit]')?.textContent).toBe('Exited with code 1');
    expect(within(section()).queryByRole('button', { name: 'Cancel the running command' })).toBeNull();
  });

  it('cancels the running run by its token', async () => {
    await mount(snapshot());
    fireEvent.click(await within(section()).findByRole('button', { name: 'Cancel the running command' }));
    await waitFor(() => expect(main.callsOf('scm.remote.cancel')).toEqual([{ appSessionId: A, token: TOKEN }]));
  });

  it('stays closed for a run that had ended before it mounted, and says how it ended', async () => {
    await mount(snapshot({ running: false, exitCode: 0 }));
    await waitFor(() => expect(state()?.textContent).toBe('Push · Done'));
    expect(ui.getState().output).toBe(false);
    expect(text()).toBeUndefined();
    fireEvent.click(within(section()).getByRole('button', { expanded: false }));
    expect(ui.getState().output).toBe(true);
    expect(text()).toBe('one\ntwo\nthree');
    expect(state()?.className).not.toContain('text-danger');
  });

  it('says a run stopped by a signal, and one that never started', async () => {
    await mount(snapshot({ running: false, signal: 'SIGTERM' }));
    await waitFor(() => expect(state()?.textContent).toBe('Push · Stopped (SIGTERM)'));
    cleanup();
    release();
    useScm.getState().reset();
    main = scmMain();
    await mount(snapshot({ running: false, output: 'could not start /usr/bin/git: ENOENT\n' }));
    await waitFor(() => expect(state()?.textContent).toBe('Push · Did not start'));
  });

  it('opens itself when a new run starts, and offers the pull request a PR run printed', async () => {
    await mount(null);
    expect(screen.queryByRole('region', { name: 'Output' })).toBeNull();
    useScm.getState().started(A, prPlanOf({ token: OTHER_TOKEN }));
    await waitFor(() => expect(state()?.textContent).toBe('Pull request · Running…'));
    expect(ui.getState().output).toBe(true);
    main.emit('scm.remote.output', out(1, 'https://github.com/o/r/pull/7\n', { token: OTHER_TOKEN, kind: 'stdout' }));
    main.emit('scm.remote.output', exit(2, 0, null, OTHER_TOKEN));
    fireEvent.click(await within(section()).findByRole('button', { name: 'Open PR #7 ↗' }));
    await waitFor(() => expect(main.callsOf('layout.openExternal')).toEqual([{ url: 'https://github.com/o/r/pull/7' }]));
  });
});

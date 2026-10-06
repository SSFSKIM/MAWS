// The Push sheet (E6 execution document, Design §8; task 3's Decision Log entry): main's plan shown as the remote, every
// destination, the branch and the exact command, and a confirm that sends only the plan's token. Main is a fake bridge.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { ScmStatus } from '@shared/ipc/schema/scm';
import { deferred, fail, ok } from '../../test-support/code';
import { A, DIR, OTHER_TOKEN, planOf, refusal, scmMain, scmStatusOf, statusOf, TOKEN } from '../../test-support/scm';
import { PushSheet } from './PushSheet';
import { useScm } from './store';
import { createScmUi, type ScmUi } from './view-state';

let main: ReturnType<typeof scmMain>;
let ui: StoreApi<ScmUi>;
let release: () => void = () => {};

function open(status: GitStatus = statusOf({ ahead: 1 }), scm: ScmStatus = scmStatusOf()) {
  ui.setState({ sheet: { kind: 'push' } });
  render(<PushSheet appSessionId={A} ui={ui} status={status} scm={scm} />);
  return screen.getByRole('dialog', { name: 'Push' });
}
const submitOf = (sheet: HTMLElement) => within(sheet).getByRole('button', { name: 'Push' }) as HTMLButtonElement;
const commandOf = (sheet: HTMLElement) => sheet.querySelector('[data-scm-plan-command]')?.textContent;
const destinationsOf = (sheet: HTMLElement) => [...sheet.querySelectorAll('[data-scm-destination]')].map((el) => el.textContent);
const rowOf = (sheet: HTMLElement, name: string) => sheet.querySelector(`[data-scm-plan-row="${name}"]`)?.textContent;

beforeEach(() => {
  useScm.getState().reset();
  main = scmMain();
  ui = createScmUi({ session: A });
  release = useScm.getState().resume(A); // the body holds the session's latest run while mounted
});
afterEach(() => {
  release();
  cleanup();
});

describe("push and PR sheets show the plan's command and destination and run only its token", () => {
  it('Push: shows the plan’s remote, destination, branch, count and exact command, and pushes only its token', async () => {
    const sheet = open();
    await waitFor(() => expect(commandOf(sheet)).toBe('/usr/bin/git push --progress origin refs/heads/main:refs/heads/main'));
    expect(main.callsOf('scm.push.plan')).toEqual([{ appSessionId: A }]); // main picks the default remote
    expect(rowOf(sheet, 'remote')).toContain('origin');
    expect(destinationsOf(sheet)).toEqual(['github.com/o/r']);
    expect(rowOf(sheet, 'branch')).toContain('main → origin/main');
    expect(rowOf(sheet, 'branch')).not.toContain('sets upstream');
    expect(rowOf(sheet, 'commits')).toContain('1 commit');
    expect(within(sheet).getByText(`Runs in ${DIR} with your login shell's environment and credential helpers.`)).toBeTruthy();

    fireEvent.click(submitOf(sheet));
    await waitFor(() => expect(main.callsOf('scm.push')).toEqual([{ appSessionId: A, token: TOKEN }]));
    await waitFor(() => expect(ui.getState().sheet).toBeNull());
    expect(useScm.getState().runs.get(A)).toMatchObject({ token: TOKEN, kind: 'push', plan: planOf(), running: true });
  });

  it('Push: lists every push destination, one per line, a bare path as it is', async () => {
    main.state.answers['scm.push.plan'] = () => ok(planOf({ pushUrls: ['https://github.com/o/r.git', '/tmp/scratch/push.git'] }));
    const sheet = open();
    await waitFor(() => expect(destinationsOf(sheet)).toEqual(['github.com/o/r', '/tmp/scratch/push.git']));
  });

  it('Push: says it sets upstream from the plan’s argv, and that a branch tracking another branch is re-pointed', async () => {
    const publish = planOf({ branch: 'feature', upstream: 'origin/feature', argv: ['push', '--progress', '--set-upstream', 'origin', 'refs/heads/feature:refs/heads/feature'] });
    main.state.answers['scm.push.plan'] = () => ok(publish);
    let sheet = open(statusOf({ branch: 'feature', upstream: null, ahead: 0 }));
    await waitFor(() => expect(rowOf(sheet, 'branch')).toContain('feature → origin/feature · sets upstream'));
    expect(rowOf(sheet, 'commits')).toBeUndefined(); // no count against an upstream it does not have yet
    cleanup();

    // Tracking origin/main (git's default for a branch made from it): an upstream exists, and the push still sets one.
    sheet = open(statusOf({ branch: 'feature', upstream: 'origin/main', ahead: 4 }));
    await waitFor(() => expect(rowOf(sheet, 'branch')).toContain('feature → origin/feature · sets upstream, re-pointing it from origin/main'));
    cleanup();

    // An upstream of its own: no "sets upstream", whatever the status says.
    main.state.answers['scm.push.plan'] = () => ok(planOf());
    sheet = open(statusOf({ upstream: null, ahead: 1 }));
    await waitFor(() => expect(commandOf(sheet)).toBeTruthy());
    expect(rowOf(sheet, 'branch')).not.toContain('sets upstream');
  });

  it('Push: re-plans for the remote picked when the checkout has several, keeping Push off until the new plan is shown', async () => {
    const scm = scmStatusOf({ remotes: [{ name: 'origin', url: 'https://github.com/o/r.git' }, { name: 'fork', url: 'git@github.com:me/r.git' }] });
    const sheet = open(statusOf({ ahead: 1 }), scm);
    await waitFor(() => expect(submitOf(sheet).disabled).toBe(false));
    const answer = deferred<ReturnType<typeof ok>>();
    main.state.answers['scm.push.plan'] = () => answer.promise;
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Remote' }), { target: { value: 'fork' } });
    await waitFor(() => expect(main.callsOf('scm.push.plan')).toEqual([{ appSessionId: A }, { appSessionId: A, remote: 'fork' }]));
    expect(submitOf(sheet).disabled).toBe(true);
    fireEvent.submit(submitOf(sheet).closest('form')!);
    expect(main.callsOf('scm.push')).toEqual([]);
    answer.resolve(ok(planOf({ token: OTHER_TOKEN, remote: 'fork', pushUrls: ['git@github.com:me/r.git'], argv: ['push', '--progress', '--set-upstream', 'fork', 'refs/heads/main:refs/heads/main'] })));
    await waitFor(() => expect(destinationsOf(sheet)).toEqual(['github.com/me/r']));
    const run = deferred<ReturnType<typeof ok>>();
    main.state.answers['scm.push'] = () => run.promise;
    fireEvent.click(submitOf(sheet));
    await waitFor(() => expect(main.callsOf('scm.push')).toEqual([{ appSessionId: A, token: OTHER_TOKEN }]));
    expect((within(sheet).getByRole('combobox', { name: 'Remote' }) as HTMLSelectElement).disabled).toBe(true); // a re-plan uses the remote shown
    run.resolve(ok({ started: true, token: OTHER_TOKEN }));
    await waitFor(() => expect(ui.getState().sheet).toBeNull());
  });

  it('Push: shows each plan refusal in main’s words with no way to submit', async () => {
    for (const [code, detail] of [
      ['behind', 'main is 2 commits behind origin/main. Pull in a terminal first; MAWS never force-pushes'],
      ['detached', 'HEAD is detached; check out a branch to push it'],
      ['no_remote', 'This repository has no remote to push to'],
      ['untrusted', 'MAWS runs git here only after you trust the folder in a session'],
    ] as const) {
      main.state.answers['scm.push.plan'] = () => ok(refusal(code, detail));
      const sheet = open();
      await waitFor(() => expect(within(sheet).getByText(detail)).toBeTruthy());
      expect(commandOf(sheet)).toBeUndefined();
      expect(submitOf(sheet).disabled).toBe(true);
      fireEvent.submit(submitOf(sheet).closest('form')!);
      cleanup();
    }
    expect(main.callsOf('scm.push')).toEqual([]);
  });

  it('Push: re-plans with the sentence of what changed when the run answers changed, and pushes the new token', async () => {
    main.state.answers['scm.push'] = () => ok(refusal('changed', 'head changed since the sheet opened; review it again'));
    const sheet = open();
    await waitFor(() => expect(submitOf(sheet).disabled).toBe(false));
    main.state.answers['scm.push.plan'] = () => ok(planOf({ token: OTHER_TOKEN, head: 'feedfacefeedfacefeedfacefeedfacefeedface' }));
    fireEvent.click(submitOf(sheet));
    await waitFor(() => expect(within(sheet).getByText('head changed since the sheet opened; review it again')).toBeTruthy());
    await waitFor(() => expect(main.callsOf('scm.push.plan')).toHaveLength(2));
    expect(ui.getState().sheet).toEqual({ kind: 'push' });
    await waitFor(() => expect(submitOf(sheet).disabled).toBe(false));
    delete main.state.answers['scm.push'];
    fireEvent.click(submitOf(sheet));
    await waitFor(() => expect(main.callsOf('scm.push')).toEqual([
      { appSessionId: A, token: TOKEN },
      { appSessionId: A, token: OTHER_TOKEN },
    ]));
    await waitFor(() => expect(ui.getState().sheet).toBeNull());
  });

  it('Push: keeps the plan when a run is already in flight (the token is not spent), and a failed call too', async () => {
    main.state.answers['scm.push'] = () => ok(refusal('busy', 'A push or pull request is already running for this checkout'));
    const sheet = open();
    await waitFor(() => expect(submitOf(sheet).disabled).toBe(false));
    fireEvent.click(submitOf(sheet));
    await waitFor(() => expect(within(sheet).getByText('A push or pull request is already running for this checkout')).toBeTruthy());
    expect(main.callsOf('scm.push.plan')).toHaveLength(1);
    expect(submitOf(sheet).disabled).toBe(false);
    main.state.answers['scm.push'] = () => fail('unknown app session: app-a');
    fireEvent.click(submitOf(sheet));
    await waitFor(() => expect(within(sheet).getByText('Failed: unknown app session: app-a')).toBeTruthy());
    expect(main.callsOf('scm.push')).toEqual([
      { appSessionId: A, token: TOKEN },
      { appSessionId: A, token: TOKEN },
    ]);
    expect(main.callsOf('scm.push.plan')).toHaveLength(1);
  });

  it('Push: closes on Cancel without pushing anything', async () => {
    const sheet = open();
    await waitFor(() => expect(submitOf(sheet).disabled).toBe(false));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(ui.getState().sheet).toBeNull();
    expect(main.callsOf('scm.push')).toEqual([]);
  });
});

// The confirmation sheet of a `maws` command aimed at another machine (docs/doperpowers/plans/2026-11-10-project-registry.md,
// Interfaces §K, "The page's half"; Decision Logs 20 and 21): the page shows main's first ask with where it came from, and
// its Confirm or its dismissal is main's `org.projectActs.decide`, once.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ProjectActAsk } from '@shared/ipc/schema/org';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { ProjectActSheet } from './ProjectActSheet';
import { REGISTRY } from './registry-copy';

const ASKED = '2026-11-10T09:00:00.000Z';
const add: ProjectActAsk = { id: 'a1', verb: 'add', machine: OTHER_MACHINE, machineName: 'mini', path: '/srv/scrape', askedAt: ASKED };
const link: ProjectActAsk = { id: 'a2', verb: 'link', machine: OTHER_MACHINE, machineName: 'mini', path: '/srv/tools', into: 'p-9', intoName: 'tools', askedAt: ASKED };

let fake: FakeClient;
const mount = () => render(<ProjectActSheet client={fake.client as unknown as MawsBridge} />);
const sheet = () => within(screen.getByRole('dialog', { name: REGISTRY.actTitle }));

beforeEach(() => {
  fake = fakeClient({ 'org.projectActs.decide': undefined });
});
afterEach(() => cleanup());

describe('a maws request on the page', () => {
  it('shows nothing while main holds no ask', async () => {
    mount();
    await act(() => fake.reply('org.projectActs', { asks: [] }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the first ask with where it came from, §K’s words, and Confirm decides it once', async () => {
    mount();
    await act(() => fake.reply('org.projectActs', { asks: [add, link] }));
    expect(sheet().getByText('From a terminal on this Mac: add /srv/scrape on mini')).toBeTruthy();
    fireEvent.click(sheet().getByRole('button', { name: REGISTRY.actConfirm }));
    fireEvent.click(sheet().getByRole('button', { name: REGISTRY.actConfirm })); // the next ask's, not the first again
    expect(fake.invoked('org.projectActs.decide')).toEqual([
      { id: 'a1', confirm: true },
      { id: 'a2', confirm: true },
    ]);
  });

  it('names the project a folder goes into', async () => {
    mount();
    await act(() => fake.reply('org.projectActs', { asks: [link] }));
    expect(sheet().getByText('From a terminal on this Mac: link /srv/tools on mini')).toBeTruthy();
    expect(sheet().getByText(REGISTRY.actInto('tools'))).toBeTruthy();
  });

  it('dismissing it is a decline', async () => {
    mount();
    await act(() => fake.reply('org.projectActs', { asks: [add] }));
    fireEvent.click(sheet().getByRole('button', { name: REGISTRY.cancel }));
    expect(fake.invoked('org.projectActs.decide')).toEqual([{ id: 'a1', confirm: false }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('follows main’s changes, and a change heard before the first read answered wins over it', async () => {
    mount();
    act(() => fake.event('org.projectActs.changed', { asks: [link] }));
    await act(() => fake.reply('org.projectActs', { asks: [add] })); // older than the event
    expect(sheet().getByText('From a terminal on this Mac: link /srv/tools on mini')).toBeTruthy();
    act(() => fake.event('org.projectActs.changed', { asks: [] })); // the terminal left
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

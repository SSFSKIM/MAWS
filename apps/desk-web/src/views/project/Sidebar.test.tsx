// @vitest-environment happy-dom
// A sidebar row names its session as its human knows it, in the owner's layout: the title cut to the row, its machine
// and whether that is online; the alias it is addressed by muted under it. A session with no title keeps its one line,
// alias and machine, as before. An ended session keeps its title: it comes from the log, not from the session's
// presence.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { SessionGroup } from '../../log/projection';
import type { DeskSession } from '../../shell/sessions';
import { Sidebar } from './Sidebar';

afterEach(cleanup);

const S1 = '1ea561bc-a60d-4437-a6ac-fa7cd5eda54f';
const S2 = 'e3ce7feb-2e31-42ee-b836-829ecb01458b';
const S3 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const row = (session: string, alias: string, title: string | null, group: SessionGroup, machineOnline: boolean | null = true): DeskSession => ({
  project: 'p1',
  session,
  alias,
  machine: 'macbook',
  cwd: '/w/maws',
  worktree: null,
  seat: '',
  title,
  member: group !== 'ended',
  ended: group === 'ended' ? { by: '', reason: 'ended' } : null,
  charge: null,
  status: null,
  state: null,
  joinedAt: 1,
  joinedTs: '',
  group,
  presence: null,
  machineOnline,
});

it('names a titled row by its title, its machine and whether that is online, the alias muted under it; an untitled one by alias and machine on one line', () => {
  const groups: Record<SessionGroup, DeskSession[]> = {
    waiting: [],
    working: [row(S1, 'maws-4d', 'GUI Agent Workspace charter, the cua host and its approvals', 'working'), row(S3, 'maws-45', null, 'working')],
    idle: [],
    ended: [row(S2, 'maws-e3', 'cua_repl', 'ended', false), row('0d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a59', 'maws-old', null, 'ended', false)],
  };
  render(<Sidebar name="MAWS" channel={{ kind: 'group' }} groups={groups} locked={false} onSelect={() => {}} />);
  const parts = (session: string) => {
    const button = document.querySelector(`[data-session="${session}"]`) as HTMLElement;
    const part = (id: string) => button.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    return { button, name: part('session-name'), alias: part('alias'), text: (id: string) => part(id)?.textContent ?? null };
  };

  const titled = parts(S1);
  expect(titled.name?.textContent).toBe('GUI Agent Workspace charter, the cua host and its approvals');
  expect(titled.name?.className).toContain('truncate'); // cut to the row, and whole on hover
  expect(titled.name?.title).toBe('GUI Agent Workspace charter, the cua host and its approvals');
  expect([titled.text('machine'), titled.text('liveness'), titled.text('alias')]).toEqual(['@macbook', 'online', 'maws-4d']);
  // Line 1 holds the title, the machine and the word; the alias is a line of its own under it.
  expect(titled.name?.parentElement?.contains(titled.alias)).toBe(false);
  expect(titled.name?.parentElement?.textContent).toBe('GUI Agent Workspace charter, the cua host and its approvals@macbookonline');
  expect(titled.alias?.className).toContain('text-fg-muted');

  // No title: the row as it was, alias and machine on one line, and no word while the machine is online.
  const untitled = parts(S3);
  expect(untitled.button.textContent).toBe('maws-45@macbook');
  expect(untitled.alias).toBeNull();

  // Ended, on a machine that is offline: the title is the log's, so it stays; the word says offline.
  const ended = parts(S2);
  expect(screen.getByRole('region', { name: 'Ended' }).contains(ended.button)).toBe(true);
  expect([ended.name?.textContent, ended.text('liveness'), ended.text('alias')]).toEqual(['cua_repl', 'offline', 'maws-e3']);
  expect(parts('0d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a59').button.textContent).toBe('maws-old@macbookoffline');
});

it('tells two rows that go by one name apart: each carries its id, and the seat says so', () => {
  // The owner's desk, 2026-10-19: the seat a6dee14b, titled, and a `--bg` copy a5b99a8b that took its name, both ended.
  const seat = { ...row('a6dee14b-4df3-47aa-93ff-4565c2f76077', 'acc-ask71', 'acc-ask71', 'ended'), seat: 'a6dee14b-4df3-47aa-93ff-4565c2f76077', namesake: true };
  const copy = { ...row('a5b99a8b-0ebe-4f5f-b6c0-b8bc32c64e0b', 'acc-ask71', null, 'ended'), namesake: true };
  const groups: Record<SessionGroup, DeskSession[]> = { waiting: [], working: [row(S3, 'maws-45', null, 'working')], idle: [], ended: [copy, seat] };
  render(<Sidebar name="MAWS" channel={{ kind: 'group' }} groups={groups} locked={false} onSelect={() => {}} />);
  const button = (session: string) => document.querySelector(`[data-session="${session}"]`) as HTMLElement;
  const part = (session: string, id: string) => button(session).querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

  expect(button(copy.session).textContent).toBe('acc-ask71#a5b99a8b@macbook');
  expect(part(copy.session, 'seat-mark')).toBeNull();
  expect(part(seat.session, 'session-short')).toBe('#a6dee14b');
  expect(part(seat.session, 'seat-mark')).toBe('seat');
  // Under a title they sit beside the alias, on its line: the title's line keeps its machine and word.
  expect(button(seat.session).querySelector('[data-testid="alias"]')?.parentElement?.textContent).toBe('acc-ask71#a6dee14bseat');
  // A row no other shares its name with carries neither.
  expect(button(S3).textContent).toBe('maws-45@macbook');
});

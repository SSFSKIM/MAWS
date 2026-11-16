// "MAWS mods · Built in" (X20; the P2-C document, §9 and G7), the last group of the plugin library's My items: a row per
// built-in mod from `mods.list` with the session, its version, its source in words, the app's switch, the session's
// override, the pending and mismatch lines; no overflow and no Uninstall; an unreadable registry says so; the library's
// search filters; a change of the switch, the override or the session's channel reads the rows again.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { ModRow } from '@shared/mods/registry';
import { fakeClient } from '../../../../../test/support/fake-client';
import { remoteRow } from '../../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../../test/support/machine';
import { addressOf } from '@shared/machine/address';
import { REMOTE_UNAVAILABLE } from '@shared/ipc/remote-unavailable';
import { useSessions } from '../../stores/sessions';
import { BuiltInMods } from './BuiltInMods';

const hold = vi.hoisted(() => ({ client: null as ReturnType<typeof import('../../../../../test/support/fake-client').fakeClient>['client'] | null }));
vi.mock('../../ipc/client', () => ({ ipc: { invoke: (...args: unknown[]) => (hold.client!.invoke as (...a: unknown[]) => unknown)(...args), on: (...args: unknown[]) => (hold.client!.on as (...a: unknown[]) => unknown)(...args) } }));

const APP = 'app-mods' as AppSessionId;
const ROW: ModRow = { id: 'maws.to-human', name: 'To-human', description: 'Agents mark what is for you.', version: 1, enabled: true, source: 'maws-contract', perSession: 'inherit' };
let fake: ReturnType<typeof fakeClient>;
beforeEach(() => {
  fake = fakeClient({ 'settings.set': {} });
  hold.client = fake.client;
});
afterEach(cleanup);

const section = () => screen.getByRole('region', { name: 'MAWS mods · Built in' });

describe('the built-in mods section', () => {
  it('draws a row per mod as a library group, with its version, its source in words and the session’s override, and no Uninstall', async () => {
    render(<BuiltInMods appSessionId={APP} search="" />);
    expect(fake.invoked('mods.list')).toEqual([{ appSessionId: APP }]);
    await act(() => fake.reply('mods.list', [ROW]));
    expect(section().getAttribute('data-plugins-group')).toBe('builtIn');
    expect(within(section()).getByRole('heading').textContent).toBe('MAWS mods · Built in1');
    const row = within(section()).getByRole('listitem');
    expect(row.getAttribute('data-mod-row')).toBe('maws.to-human');
    // UX wave U11c M1: its image is the mod's letter tile, by its registry name
    const image = row.querySelector('[data-item-image]')!;
    expect([image.getAttribute('data-item-image'), image.getAttribute('data-item-kind'), image.getAttribute('data-tile-colour'), image.textContent]).toEqual(['tile', 'mod', '5', 'T']);
    expect(row.textContent).toContain('To-human');
    expect(row.textContent).toContain('Built in');
    expect(row.textContent).toContain('Version 1');
    expect(row.textContent).toContain('MAWS gives the agent its instructions');
    expect(within(row).getByRole('switch', { name: 'To-human in every session' }).getAttribute('aria-checked')).toBe('true');
    const override = within(row).getByRole('radiogroup', { name: 'To-human in this session' });
    expect(within(override).getAllByRole('radio').map((radio) => radio.closest('label')!.textContent)).toEqual(['Default (On)', 'On', 'Off']);
    expect((within(override).getByRole('radio', { name: 'Default (On)' }) as HTMLInputElement).checked).toBe(true);
    expect(within(row).queryByRole('button', { name: /Uninstall|More actions/ })).toBeNull();
    expect(row.textContent).not.toContain('Uninstall');
  });

  it('the override writes the session’s and reads again, showing what it waits for', async () => {
    render(<BuiltInMods appSessionId={APP} search="" />);
    await act(() => fake.reply('mods.list', [ROW]));
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    expect(fake.invoked('mods.setSessionOverride')).toEqual([{ appSessionId: APP, id: 'maws.to-human', value: 'off' }]);
    await act(() => fake.reply('mods.setSessionOverride', undefined));
    await act(() => fake.reply('mods.list', [{ ...ROW, perSession: 'off', pending: 'next-launch' }]));
    expect(section().textContent).toContain('Applies the next time this session starts');
    expect((screen.getByRole('radio', { name: 'Off' }) as HTMLInputElement).checked).toBe(true);
  });

  it('the app’s switch is the settings write; a settings or channel change reads the rows again', async () => {
    render(<BuiltInMods appSessionId={APP} search="" />);
    await act(() => fake.reply('mods.list', [{ ...ROW, source: 'external-compatible-style', pending: 'next-compaction', mismatch: { resolved: 'default', observed: 'doperpowers:to-human' } }]));
    expect(section().textContent).toContain('The output style gives the agent its instructions');
    expect(section().textContent).toContain('Applies after this session’s next compaction');
    expect(within(section()).getByRole('note').textContent).toContain('“doperpowers:to-human”');
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'To-human in every session' })));
    expect(fake.invoked('settings.set')).toEqual([{ mods: { toHuman: { enabled: false } } }]);
    expect(fake.invoked('mods.list')).toHaveLength(2); // read again after the write
    await act(() => fake.reply('mods.list', [ROW]));
    act(() => fake.event('ownerChannel.changed', { appSessionId: 'another', state: {} }));
    expect(fake.invoked('mods.list')).toHaveLength(2); // another session's channel: nothing to read
    act(() => fake.event('settings.changed', {}));
    expect(fake.invoked('mods.list')).toHaveLength(3);
    await act(() => fake.reply('mods.list', [ROW]));
    act(() => fake.event('ownerChannel.changed', { appSessionId: APP, state: {} }));
    expect(fake.invoked('mods.list')).toHaveLength(4);
    await act(() => fake.reply('mods.list', [{ ...ROW, enabled: false }]));
    expect(screen.getByRole('radio', { name: 'Default (Off)' })).toBeTruthy();
  });

  it('a refused write says so in main’s words, and the rows read again show what holds', async () => {
    render(<BuiltInMods appSessionId={APP} search="" />);
    await act(() => fake.reply('mods.list', [ROW]));
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    await act(() => fake.fail('mods.setSessionOverride', 'unknown session: app-mods'));
    await act(() => fake.reply('mods.list', [ROW]));
    expect(within(section()).getByRole('alert').textContent).toBe('Not saved: unknown session: app-mods');
    expect((screen.getByRole('radio', { name: 'Default (On)' }) as HTMLInputElement).checked).toBe(true);
  });

  it('a registry main cannot read says so; an empty one, or a search matching nothing, draws nothing', async () => {
    render(<BuiltInMods appSessionId={APP} search="" />);
    await act(() => fake.fail('mods.list', 'index unavailable: locked by another build'));
    expect(within(section()).getByRole('status').textContent).toBe('MAWS mods can’t be read right now: index unavailable: locked by another build');
    expect(section().getAttribute('data-plugins-group')).toBe('builtIn');
    cleanup();
    const empty = render(<BuiltInMods appSessionId={APP} search="" />);
    await act(() => fake.reply('mods.list', []));
    expect(empty.container.textContent).toBe('');
    cleanup();
    const searched = render(<BuiltInMods appSessionId={APP} search="sandbox" />);
    await act(() => fake.reply('mods.list', [ROW]));
    expect(searched.container.textContent).toBe('');
  });

  // P5 O7 M8: `mods.list` is declared not offered on another machine (REMOTE_UNAVAILABLE): nothing is asked, and the
  // section says why in the declared words
  it('for a session on another machine asks nothing and says why, in the declared words', async () => {
    const remote = addressOf(OTHER_MACHINE, 'app-mods' as AppSessionId);
    useSessions.setState({ listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, 'app-mods'), appId: remote }]]), listedMachines: new Set([OTHER_MACHINE]) });
    try {
      render(<BuiltInMods appSessionId={remote} search="" />);
      expect(within(section()).getByRole('status').textContent).toBe(REMOTE_UNAVAILABLE['mods.list']);
      await act(() => Promise.resolve());
      expect(fake.invoked('mods.list')).toEqual([]);
    } finally {
      useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    }
  });
  // UX wave U2b, M7 (the execution document, Interfaces §M, "The switch"; cards 10 and 11; the rulings on the drawing):
  // under the to-human entry's own switch, a second line: the words `Summaries on fold lines`, its sentence under
  // them, and its switch, the words being the switch's label; no pending line of its own.
  describe('the summaries’ switch', () => {
    const SENTENCE = 'Each summary is one small model call by the to-human mod, on the session’s own account. Off: sessions MAWS starts make no new summaries from their next start, and summaries already made stay. A session started in a terminal follows the mod’s own setting.';
    const WITH = { ...ROW, summaries: true };
    const summaries = () => screen.getByRole('switch', { name: 'Summaries on fold lines' });

    it('draws the words, its sentence and its switch on a second line of the row; its accessible name is its words', async () => {
      render(<BuiltInMods appSessionId={APP} search="" />);
      await act(() => fake.reply('mods.list', [WITH]));
      const line = summaries().closest('label')!;
      expect(line.getAttribute('data-mod-summaries')).toBe('');
      expect(line.textContent).toBe(`Summaries on fold lines${SENTENCE}`);
      expect(summaries().getAttribute('aria-checked')).toBe('true');
      expect(within(screen.getByRole('listitem')).getAllByRole('switch')).toHaveLength(2);
    });

    it('a press on the words toggles it: the write, then the rows read again', async () => {
      render(<BuiltInMods appSessionId={APP} search="" />);
      await act(() => fake.reply('mods.list', [WITH]));
      await act(async () => fireEvent.click(screen.getByText('Summaries on fold lines')));
      expect(fake.invoked('mods.setFoldSummaries')).toEqual([{ on: false }]);
      expect(fake.invoked('mods.list')).toHaveLength(1); // the write is awaited first
      await act(() => fake.reply('mods.setFoldSummaries', undefined));
      expect(fake.invoked('mods.list')).toHaveLength(2);
      await act(() => fake.reply('mods.list', [{ ...WITH, summaries: false }]));
      expect(summaries().getAttribute('aria-checked')).toBe('false');
      await act(async () => fireEvent.click(summaries()));
      expect(fake.invoked('mods.setFoldSummaries')).toEqual([{ on: false }, { on: true }]);
    });

    it('a second press while the first is out does nothing', async () => {
      render(<BuiltInMods appSessionId={APP} search="" />);
      await act(() => fake.reply('mods.list', [WITH]));
      await act(async () => fireEvent.click(summaries()));
      await act(async () => fireEvent.click(summaries()));
      expect(fake.invoked('mods.setFoldSummaries')).toEqual([{ on: false }]);
      await act(() => fake.reply('mods.setFoldSummaries', undefined));
      await act(() => fake.reply('mods.list', [{ ...WITH, summaries: false }]));
      await act(async () => fireEvent.click(summaries()));
      expect(fake.invoked('mods.setFoldSummaries')).toEqual([{ on: false }, { on: true }]);
    });

    it('a failure leaves the row as it was, under the widget’s own notice', async () => {
      render(<BuiltInMods appSessionId={APP} search="" />);
      await act(() => fake.reply('mods.list', [WITH]));
      await act(async () => fireEvent.click(summaries()));
      await act(() => fake.fail('mods.setFoldSummaries', 'index unavailable: locked by another build'));
      await act(() => fake.reply('mods.list', [WITH]));
      expect(within(section()).getByRole('alert').textContent).toBe('Not saved: index unavailable: locked by another build');
      expect(summaries().getAttribute('aria-checked')).toBe('true');
    });

    it('the entry’s own switch keeps its name and has no visible words', async () => {
      render(<BuiltInMods appSessionId={APP} search="" />);
      await act(() => fake.reply('mods.list', [WITH]));
      const own = screen.getByRole('switch', { name: 'To-human in every session' });
      expect(own.textContent).toBe('');
      expect(own.closest('label')).toBeNull();
    });

    it.each([undefined, 'next-launch', 'next-compaction'] as const)('draws no pending line for it whatever the row’s pending (%s)', async (pending) => {
      render(<BuiltInMods appSessionId={APP} search="" />);
      await act(() => fake.reply('mods.list', [{ ...WITH, ...(pending !== undefined && { pending }) }]));
      const line = summaries().closest('label')!;
      expect(line.querySelector('[data-mod-pending]')).toBeNull();
      expect(screen.getByRole('listitem').querySelectorAll('[data-mod-pending]')).toHaveLength(pending === undefined ? 0 : 1);
    });

    // Panel finding 3 (the coordinator's ruling): the switch is this machine's, so a write through one mounted list is
    // main's word to every other (`mods.foldSummariesChanged`), each reading `mods.list` again; a list with no session
    // (Customize with none attached) among them. Its next press writes the opposite of what the first wrote.
    it('two mounted lists: one writes on, the other shows on, and that other’s next press writes off', async () => {
      const first = render(<BuiltInMods appSessionId={APP} search="" />);
      const other = render(<BuiltInMods appSessionId={null} search="" />);
      const switchIn = (view: ReturnType<typeof render>) => within(view.container).getByRole('switch', { name: 'Summaries on fold lines' });
      await act(() => fake.reply('mods.list', [{ ...WITH, summaries: false }]));
      await act(() => fake.reply('mods.list', [{ ...WITH, summaries: false }]));
      expect([switchIn(first).getAttribute('aria-checked'), switchIn(other).getAttribute('aria-checked')]).toEqual(['false', 'false']);
      await act(async () => fireEvent.click(switchIn(first)));
      expect(fake.invoked('mods.setFoldSummaries')).toEqual([{ on: true }]);
      await act(() => fake.reply('mods.setFoldSummaries', undefined));
      await act(() => fake.reply('mods.list', [WITH])); // the writer's own read
      act(() => fake.event('mods.foldSummariesChanged', {})); // main's word after the write
      expect(fake.pending('mods.list')).toBe(2); // every mounted list reads again
      await act(() => fake.reply('mods.list', [WITH]));
      await act(() => fake.reply('mods.list', [WITH]));
      expect([switchIn(first).getAttribute('aria-checked'), switchIn(other).getAttribute('aria-checked')]).toEqual(['true', 'true']);
      await act(async () => fireEvent.click(switchIn(other)));
      expect(fake.invoked('mods.setFoldSummaries')).toEqual([{ on: true }, { on: false }]);
    });

    it('is drawn only where the row carries summaries (an earlier daemon’s row does not)', async () => {
      render(<BuiltInMods appSessionId={APP} search="" />);
      await act(() => fake.reply('mods.list', [ROW]));
      expect(screen.queryByRole('switch', { name: 'Summaries on fold lines' })).toBeNull();
      expect(screen.getByRole('listitem').textContent).not.toContain('Summaries on fold lines');
    });
  });
});

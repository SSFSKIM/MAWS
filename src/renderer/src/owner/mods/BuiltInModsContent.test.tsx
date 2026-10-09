// "MAWS mods · Built in" (X20; the P2-C document, §9 and G7): a row per built-in mod from `mods.list` with the session,
// its source in words, the app's switch, the session's override, the pending and mismatch lines; no Uninstall; an
// unreadable registry says so; the search filters; a change of the switch, the override or the session's channel reads
// the rows again.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { ModRow } from '@shared/mods/registry';
import { fakeClient } from '../../../../../test/support/fake-client';
import { BuiltInModsContent } from './BuiltInModsContent';

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
  it('draws a row per mod with its version, its source in words and the session’s override, and no Uninstall', async () => {
    render(<BuiltInModsContent appSessionId={APP} />);
    expect(fake.invoked('mods.list')).toEqual([{ appSessionId: APP }]);
    await act(() => fake.reply('mods.list', [ROW]));
    const row = within(section()).getByRole('listitem');
    expect(row.textContent).toContain('To-human');
    expect(row.textContent).toContain('Built in');
    expect(row.textContent).toContain('Version 1');
    expect(row.textContent).toContain('MAWS gives the agent its instructions');
    expect(within(row).getByRole('switch', { name: 'To-human in every session' }).getAttribute('aria-checked')).toBe('true');
    const override = within(row).getByRole('radiogroup', { name: 'To-human in this session' });
    expect(within(override).getAllByRole('radio').map((radio) => radio.closest('label')!.textContent)).toEqual(['Default (On)', 'On', 'Off']);
    expect((within(override).getByRole('radio', { name: 'Default (On)' }) as HTMLInputElement).checked).toBe(true);
    expect(within(row).queryByRole('button', { name: /Uninstall/ })).toBeNull();
  });

  it('the override writes the session’s and reads again, showing what it waits for', async () => {
    render(<BuiltInModsContent appSessionId={APP} />);
    await act(() => fake.reply('mods.list', [ROW]));
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    expect(fake.invoked('mods.setSessionOverride')).toEqual([{ appSessionId: APP, id: 'maws.to-human', value: 'off' }]);
    await act(() => fake.reply('mods.setSessionOverride', undefined));
    await act(() => fake.reply('mods.list', [{ ...ROW, perSession: 'off', pending: 'next-launch' }]));
    expect(section().textContent).toContain('Applies the next time this session starts');
    expect((screen.getByRole('radio', { name: 'Off' }) as HTMLInputElement).checked).toBe(true);
  });

  it('the app’s switch is the settings write; a settings or channel change reads the rows again', async () => {
    render(<BuiltInModsContent appSessionId={APP} />);
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
    render(<BuiltInModsContent appSessionId={APP} />);
    await act(() => fake.reply('mods.list', [ROW]));
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    await act(() => fake.fail('mods.setSessionOverride', 'unknown session: app-mods'));
    await act(() => fake.reply('mods.list', [ROW]));
    expect(within(section()).getByRole('alert').textContent).toBe('Not saved: unknown session: app-mods');
    expect((screen.getByRole('radio', { name: 'Default (On)' }) as HTMLInputElement).checked).toBe(true);
  });

  it('a registry main cannot read says so; an empty one, or a search matching nothing, draws nothing', async () => {
    render(<BuiltInModsContent appSessionId={APP} />);
    await act(() => fake.fail('mods.list', 'index unavailable: locked by another build'));
    expect(within(section()).getByRole('status').textContent).toBe('MAWS mods can’t be read right now: index unavailable: locked by another build');
    cleanup();
    const empty = render(<BuiltInModsContent appSessionId={APP} />);
    await act(() => fake.reply('mods.list', []));
    expect(empty.container.textContent).toBe('');
    cleanup();
    const searched = render(<BuiltInModsContent appSessionId={APP} search="sandbox" />);
    await act(() => fake.reply('mods.list', [ROW]));
    expect(searched.container.textContent).toBe('');
  });
});

// @vitest-environment happy-dom
// "+ Session" follows the machines as the hub reports them while it is open: a machine or a checkout that arrives after
// the dialog opened is offered and chosen, a machine set read-only is shown and never chosen, and the Model field offers
// what a spawn's engine resolves and the ids the project's sessions were seen answering from.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MachinePresence } from 'desk-hub/protocol';
import { VECTOR_PROJECT as PROJECT } from '../../../test/vectors';
import { memoryLogRecord } from '../../log/record';
import { ProjectConnection } from '../../project/connection';
import { noteModel } from '../../state/models';
import { DeskContext } from '../conversation/desk-context';
import { SpawnDialog } from './SpawnDialog';

const MEMBER = '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c';
const presence = (checkouts: MachinePresence['checkouts'], more: { online?: boolean; read_only?: boolean } = {}): MachinePresence => ({
  online: more.online ?? true,
  policy: { read_only: more.read_only ?? false, ceiling: 'default' },
  checkouts,
});

let connection: ProjectConnection;
let rpc: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  connection = new ProjectConnection(PROJECT, { base: 'ws://127.0.0.1:9', record: memoryLogRecord() });
  connection.live.setState({ connected: true });
  rpc = vi.spyOn(connection, 'rpc').mockResolvedValue('nonce');
});
afterEach(() => {
  cleanup();
  connection.stop();
  vi.restoreAllMocks();
});

function open() {
  render(
    <DeskContext.Provider value={{ connection, member: MEMBER, sessions: new Map() }}>
      <SpawnDialog onClose={() => {}} onOpen={() => {}} />
    </DeskContext.Provider>,
  );
}
const field = (name: string) => screen.getByLabelText(name, { selector: 'select, input, textarea' }) as HTMLSelectElement & HTMLInputElement;
const start = () => {
  fireEvent.change(field('Brief'), { target: { value: 'walk seat: answers pings' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
};

it('offers and chooses a machine that came online after it opened, with its checkout', () => {
  open();
  expect(screen.getByText('No machine of this project is online: a spawn needs one.')).toBeTruthy();
  act(() => connection.live.setState({ machines: { mini: presence([{ path: '/Users/new/desk-walk', branch: 'main' }]) } }));
  expect(field('Machine').value).toBe('mini');
  expect(field('Checkout').value).toBe('/Users/new/desk-walk');
  start();
  expect(rpc).toHaveBeenCalledWith(MEMBER, 'mini', 'spawn', { checkout: '/Users/new/desk-walk', brief: 'walk seat: answers pings' });
});

it("takes the chosen machine's checkouts as they arrive", () => {
  connection.live.setState({ machines: { mini: presence([]) } });
  open();
  expect(field('Checkout').disabled).toBe(true);
  act(() => connection.live.setState({ machines: { mini: presence([{ path: '/Users/new/desk-walk', branch: 'main' }]) } }));
  expect(field('Checkout').value).toBe('/Users/new/desk-walk');
  start();
  expect(rpc).toHaveBeenCalledWith(MEMBER, 'mini', 'spawn', { checkout: '/Users/new/desk-walk', brief: 'walk seat: answers pings' });
});

it("keeps the owner's choice of machine while the others change", () => {
  connection.live.setState({ machines: { macbook: presence([{ path: '/a', branch: 'main' }]), mini: presence([{ path: '/b', branch: 'main' }]) } });
  open();
  fireEvent.change(field('Machine'), { target: { value: 'mini' } });
  act(() => connection.live.setState({ machines: { aardvark: presence([{ path: '/c', branch: 'main' }]), macbook: presence([{ path: '/a', branch: 'main' }]), mini: presence([{ path: '/b', branch: 'main' }]) } }));
  expect(field('Machine').value).toBe('mini');
  expect(field('Checkout').value).toBe('/b');
});

it('shows a machine set read-only and never chooses it: it starts nothing sent from outside it', () => {
  connection.live.setState({ machines: { mini: presence([{ path: '/b', branch: 'main' }], { read_only: true }), macbook: presence([{ path: '/a', branch: 'main' }]) } });
  open();
  const mini = screen.getByRole('option', { name: 'mini (read-only)' }) as HTMLOptionElement;
  expect(mini.disabled).toBe(true);
  expect(field('Machine').value).toBe('macbook');
  act(() => connection.live.setState({ machines: { mini: presence([{ path: '/b', branch: 'main' }], { read_only: true }) } }));
  expect(screen.getByText('mini is read-only: it starts nothing sent from outside it.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
});

it("offers the family aliases a spawn's engine resolves, and the ids the project's sessions answered from", () => {
  noteModel(PROJECT, 'claude-sonnet-5-5');
  noteModel(PROJECT, 'claude-fable-5-1');
  noteModel('another-project', 'astra');
  connection.live.setState({ machines: { mini: presence([{ path: '/b', branch: 'main' }]) } });
  open();
  const list = document.getElementById(field('Model').getAttribute('list') ?? '');
  expect([...(list?.querySelectorAll('option') ?? [])].map((o) => o.value)).toEqual(['opus', 'fable', 'sonnet', 'haiku', 'claude-fable-5-1', 'claude-sonnet-5-5']);
});

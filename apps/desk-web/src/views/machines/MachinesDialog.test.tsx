// @vitest-environment happy-dom
// The machine list says what DX7's record says: `active` is a machine that completed its first authenticated
// connection — enrolled — not one that is online now (presence is the registry's, later). An admin removes a machine
// from it, past a confirmation that says what removal means, and the list then lists it no more; a member who is not an
// admin is offered no removal, and the hub's refusals are explained where the owner confirmed.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MachinesDouble } from '../../../test/double/machines';
import { ME } from '../../../test/me';
import type { Me } from '../../hub/me';
import { MachinesDialog } from './MachinesDialog';

let hub: MachinesDouble;
beforeEach(() => {
  hub = new MachinesDouble();
  vi.stubGlobal('fetch', hub.fetch(ME.member));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(me: Me = ME) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MachinesDialog me={me} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

const row = (container: HTMLElement, name: string) => container.querySelector(`[data-machine="${name}"]`);

describe('MachinesDialog', () => {
  it('draws an active machine as enrolled and a pending one as enrolling, never as connected', async () => {
    hub.add('mini');
    hub.add('studio', 'pending');
    const { container } = open();
    await screen.findByText('mini');
    expect(row(container, 'mini')!.textContent).toContain('enrolled');
    expect(row(container, 'studio')!.textContent).toContain('enrolling');
    expect(screen.getByRole('dialog').textContent).not.toContain('connected');
  });

  it('removes a machine only once the admin confirms what removal means, then lists it no more', async () => {
    hub.add('mini');
    hub.add('studio');
    const { container } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove mini' }));
    const confirm = screen.getByTestId('remove-confirm');
    expect(within(confirm).getByTestId('remove-machine').textContent).toBe('mini');
    const meaning = within(confirm).getByTestId('remove-meaning').textContent;
    expect(meaning).toContain('disconnects it at once');
    expect(meaning).toContain('deletes its credential');
    expect(meaning).toContain('enroll it again');
    expect(hub.removals).toEqual([]);

    // Cancel keeps it.
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('button', { name: 'Remove mini' });
    expect(hub.removals).toEqual([]);
    expect(row(container, 'mini')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove mini' }));
    fireEvent.click(within(screen.getByTestId('remove-confirm')).getByRole('button', { name: 'Remove mini' }));
    expect((await screen.findByTestId('machines-notice')).textContent).toBe('Removed mini. To use it with the desk again, enroll it again.');
    expect(hub.removals).toEqual(['mini']);
    await waitFor(() => expect(row(container, 'mini')).toBeNull());
    expect(row(container, 'studio')).not.toBeNull();
  });

  it("says of a machine still enrolling that it never connected, not that it is disconnected", async () => {
    hub.add('studio', 'pending');
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove studio' }));
    const meaning = screen.getByTestId('remove-meaning').textContent;
    expect(meaning).toContain('has not connected yet');
    expect(meaning).not.toContain('disconnects');
  });

  it("explains the hub's refusal of a member it no longer holds as an admin, and keeps the machine", async () => {
    hub.add('mini');
    vi.stubGlobal('fetch', hub.fetch({ ...ME.member, role: 'member' })); // demoted since the page loaded
    const { container } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove mini' }));
    fireEvent.click(within(screen.getByTestId('remove-confirm')).getByRole('button', { name: 'Remove mini' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only an admin of the org removes machines.');
    expect(screen.getByTestId('remove-confirm')).toBeTruthy();
    expect(hub.machines.map((m) => m.name)).toEqual(['mini']);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(row(container, 'mini')).not.toBeNull());
  });

  it('says a machine removed meanwhile elsewhere was already removed, and refreshes the list', async () => {
    hub.add('mini');
    const { container } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove mini' }));
    hub.machines = []; // another admin removed it first
    fireEvent.click(within(screen.getByTestId('remove-confirm')).getByRole('button', { name: 'Remove mini' }));
    expect((await screen.findByTestId('machines-notice')).textContent).toBe('mini was already removed.');
    await waitFor(() => expect(row(container, 'mini')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("says when the hub did not answer, and lets the admin try again", async () => {
    hub.add('mini');
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove mini' }));
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const confirm = screen.getByTestId('remove-confirm');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove mini' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The hub did not answer: Failed to fetch.');
    expect(within(confirm).getByRole('button', { name: 'Remove mini' })).toHaveProperty('disabled', false);
  });

  it('offers a member who is not an admin no removal', async () => {
    hub.add('mini');
    const { container } = open({ ...ME, member: { ...ME.member, role: 'member' } });
    await screen.findByText('mini');
    expect(within(row(container, 'mini') as HTMLElement).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.getByRole('dialog').textContent).toContain('An admin of the org enrolls and removes machines.');
  });
});

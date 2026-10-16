// @vitest-environment happy-dom
// The machine list says what DX7's record says: `active` is a machine that completed its first authenticated
// connection — enrolled — not one that is online now (presence is the registry's, later).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MachineRecord } from 'desk-hub/protocol';
import { ME } from '../../../test/me';
import { MachinesDialog } from './MachinesDialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const machine = (name: string, state: MachineRecord['state']): MachineRecord => ({
  name,
  client_id: `${name}.access`,
  token_name: `desk-org-${name}`,
  state,
  enrollment: `e-${name}`,
  created: '2026-10-15T00:00:00.000Z',
  confirmed: state === 'active' ? '2026-10-15T00:01:00.000Z' : null,
});

describe('MachinesDialog', () => {
  it('draws an active machine as enrolled and a pending one as enrolling, never as connected', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ machines: [machine('mini', 'active'), machine('studio', 'pending')] }));
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MachinesDialog me={ME} onClose={() => {}} />
      </QueryClientProvider>,
    );
    await screen.findByText('mini');
    expect(container.querySelector('[data-machine="mini"]')!.textContent).toContain('enrolled');
    expect(container.querySelector('[data-machine="studio"]')!.textContent).toContain('enrolling');
    expect(screen.getByRole('dialog').textContent).not.toContain('connected');
  });
});

// The "+" menu's Connectors and Plugins submenus under the word cut: a plugin is its name alone (C17), the last two rows
// read "In this chat…" and "Manage…" (C18), and a submenu with no rows says so in a few words: "No plugins" (C19),
// "No connectors" (P578), "Session not running" (P579).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { useSessions } from '../../stores/sessions';
import { PlusMenu } from './PlusMenu';

const BARE = 'app-plus' as AppSessionId;
const ID = at(BARE);

function started(over: Partial<EngineSessionStatus>) {
  const engine = { ...status(BARE), appSessionId: ID, ...over } as EngineSessionStatus;
  useSessions.setState({ records: new Map([[ID, { ...record(BARE), appId: ID }]]), engine: new Map([[ID, engine]]) });
}

async function openSubmenu(name: 'Connectors' | 'Plugins') {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PlusMenu appSessionId={ID} cwd="/work/atlas" editor={{ current: null }} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Add files, photos or commands' }));
  act(() => screen.getByRole('menuitem', { name }).focus());
  await user.keyboard('{ArrowRight}');
  await screen.findByRole('menuitem', { name: /^In this chat…/ });
  const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
  return items.slice(items.indexOf('Plugins›') + 1); // the submenu's rows, after the main menu's
}

beforeEach(() => {
  window.maws = fakeClient().client as unknown as PreloadBridge;
});
afterEach(() => {
  cleanup();
  useSessions.setState({ records: new Map(), engine: new Map() });
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('the "+" menu’s submenus', () => {
  it('lists a ready session’s plugins by name alone, then In this chat… and Manage…', async () => {
    started({ plugins: [{ name: 'kit', path: '/p/kit', source: 'kit@market', version: null }, { name: 'fx', path: '/p/fx', source: 'fx@market', version: null }] } as Partial<EngineSessionStatus>);
    expect(await openSubmenu('Plugins')).toEqual(['kit', 'fx', expect.stringMatching(/^In this chat…/), 'Manage…']);
  });

  it('says No plugins for a ready session that reports none', async () => {
    started({ plugins: [] } as Partial<EngineSessionStatus>);
    await openSubmenu('Plugins');
    expect(screen.getByText('No plugins')).toBeTruthy();
  });

  it('says No connectors for a ready session that reports none, and its last rows read In this chat… and Manage…', async () => {
    started({ mcpServers: [] } as Partial<EngineSessionStatus>);
    const rows = await openSubmenu('Connectors');
    expect(screen.getByText('No connectors')).toBeTruthy();
    expect(rows.slice(-2)).toEqual([expect.stringMatching(/^In this chat…/), 'Manage…']);
  });

  it('says Session not running for a session whose process is not ready', async () => {
    started({ process: 'exited' } as Partial<EngineSessionStatus>);
    await openSubmenu('Connectors');
    expect(screen.getByText('Session not running')).toBeTruthy();
  });
});

// The "+" menu's Connectors and Plugins submenus under the word cut: a plugin is its name alone (C17), the last two rows
// read "In this chat…" and "Manage…" (C18), and a submenu with no rows says so in a few words: "No plugins" (C19),
// "No connectors" (P578), "Session not running" (P579).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { FULL_MAWS_TOOL_SET, type MawsToolSet } from '@shared/maws/tool-set';
import { useSessions } from '../../stores/sessions';
import type { ChipBinding } from '../frame/bindings';
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

// Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, D11 and §H): the Tools submenu of a chat not yet
// started, after Connectors and Plugins: the four groups as checkbox items, then the question tool as a radio group;
// each item's fact is its row note, open at once on keyboard focus and its description at all times.
describe('the "+" menu’s Tools submenu', () => {
  const NO_ARTIFACTS: MawsToolSet = { artifacts: false, documents: false, dashboards: false, auxiliary: true, question: 'maws' };
  const binding = (value: MawsToolSet = FULL_MAWS_TOOL_SET, disabled: string | null = null) => ({
    value,
    options: [],
    disabled,
    set: vi.fn<ChipBinding<MawsToolSet>['set']>(async () => ({ ok: true })),
  });

  async function openTools(tools: ChipBinding<MawsToolSet> | null) {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlusMenu cwd="/work/atlas" editor={{ current: null }} tools={tools} />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Add files, photos or commands' }));
    return user;
  }
  // A binding over an intent as C10's store holds it: a write's set reaches the value when its answer arrives, before the
  // write resolves (sessions/setup-actions.ts `patchIntent`), the answers in the order the test gives them; `held`
  // withholds every answer until `answer(i)`.
  function intentBinding(initial: MawsToolSet, held = false) {
    const writes: MawsToolSet[] = [];
    const answers: (() => void)[] = [];
    function Menu() {
      const [value, setValue] = useState(initial);
      const tools: ChipBinding<MawsToolSet> = {
        value,
        options: [],
        disabled: null,
        set: (next) => {
          writes.push(next);
          return new Promise((resolve) => {
            const answer = () => {
              setValue(next);
              resolve({ ok: true });
            };
            if (held) answers.push(answer);
            else answer();
          });
        },
      };
      return <PlusMenu cwd="/work/atlas" editor={{ current: null }} tools={tools} />;
    }
    return { writes, Menu, answer: (i: number) => act(async () => answers[i]!()) };
  }
  async function openLive(Menu: () => ReturnType<typeof PlusMenu>) {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Menu />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Add files, photos or commands' }));
    await enterTools(user);
    return user;
  }
  const checked = (role: 'menuitemcheckbox' | 'menuitemradio', name: string) => screen.getByRole(role, { name }).getAttribute('aria-checked');
  async function enterTools(user: ReturnType<typeof userEvent.setup>) {
    act(() => screen.getByRole('menuitem', { name: 'Tools' }).focus());
    await user.keyboard('{ArrowRight}');
    await screen.findByRole('menuitemcheckbox', { name: 'Artifacts' });
  }
  const descriptionOf = (item: HTMLElement) => document.getElementById(item.getAttribute('aria-describedby') ?? '');

  it('is drawn after Plugins, with the four groups checked as the set says and the question tool as a radio group', async () => {
    const user = await openTools(binding({ ...FULL_MAWS_TOOL_SET, auxiliary: false, question: 'engine' }));
    const rows = screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label') ?? item.textContent);
    expect(rows.slice(-3)).toEqual(['Connectors›', 'Plugins›', 'Tools›']);
    await enterTools(user);
    const checks = screen.getAllByRole('menuitemcheckbox');
    expect(checks.map((item) => [item.getAttribute('aria-label'), item.getAttribute('aria-checked')])).toEqual([
      ['Artifacts', 'true'],
      ['Documents', 'true'],
      ['Dashboards', 'true'],
      ['Auxiliary', 'false'],
    ]);
    const question = screen.getByRole('group', { name: 'Question' });
    expect(question).toBeTruthy();
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios.map((item) => [item.getAttribute('aria-label'), item.getAttribute('aria-checked')])).toEqual([
      ['Default', 'true'],
      ['MAWS', 'false'],
    ]);
  });

  it('toggles a group through the binding and stays open; Artifacts turns Documents and Dashboards with it', async () => {
    const intent = intentBinding(FULL_MAWS_TOOL_SET);
    const user = await openLive(intent.Menu);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Auxiliary' }));
    expect(checked('menuitemcheckbox', 'Auxiliary')).toBe('false'); // the menu stays open, over the new set
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Artifacts' }));
    expect(intent.writes).toEqual([
      { ...FULL_MAWS_TOOL_SET, auxiliary: false },
      { ...FULL_MAWS_TOOL_SET, auxiliary: false, artifacts: false, documents: false, dashboards: false }, // the first change kept
    ]);
  });

  // The review of M5: the menu stays open for one edit after another, and the intent takes a write's set only when its
  // answer arrives, so each edit is made over the newest set chosen, never the one last drawn from the intent.
  it('makes a second choice over the first while the first’s answer is still out, and both survive', async () => {
    const intent = intentBinding(FULL_MAWS_TOOL_SET, true);
    const user = await openLive(intent.Menu);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Auxiliary' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Default' }));
    const both = { ...FULL_MAWS_TOOL_SET, auxiliary: false, question: 'engine' as const };
    expect(intent.writes).toEqual([{ ...FULL_MAWS_TOOL_SET, auxiliary: false }, both]);
    expect([checked('menuitemcheckbox', 'Auxiliary'), checked('menuitemradio', 'Default')]).toEqual(['false', 'true']);
    await intent.answer(0); // the first answer: the intent holds the first set alone, the menu still the newest choice
    expect([checked('menuitemcheckbox', 'Auxiliary'), checked('menuitemradio', 'Default')]).toEqual(['false', 'true']);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Dashboards' })); // a third, still over the newest
    expect(intent.writes.at(-1)).toEqual({ ...both, dashboards: false });
    await intent.answer(1);
    await intent.answer(2);
    expect([checked('menuitemcheckbox', 'Auxiliary'), checked('menuitemcheckbox', 'Dashboards'), checked('menuitemradio', 'Default')]).toEqual(['false', 'false', 'true']);
  });

  it('shows the intent’s set again when the newest write is refused', async () => {
    const tools = binding();
    tools.set.mockResolvedValueOnce({ ok: false, error: 'refused' });
    const user = await openTools(tools);
    await enterTools(user);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Auxiliary' }));
    await waitFor(() => expect(checked('menuitemcheckbox', 'Auxiliary')).toBe('true'));
  });

  it('refuses Documents and Dashboards while Artifacts is off, saying it needs Artifacts, and turns them on with it', async () => {
    const tools = binding(NO_ARTIFACTS);
    const user = await openTools(tools);
    await enterTools(user);
    for (const name of ['Documents', 'Dashboards']) {
      const item = screen.getByRole('menuitem', { name });
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(descriptionOf(item)?.textContent).toBe('Needs Artifacts');
      await user.click(item);
    }
    expect(tools.set).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Documents' })).toBeTruthy(); // still open
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Artifacts' }));
    expect(tools.set.mock.calls.map(([set]) => set)).toEqual([{ ...NO_ARTIFACTS, artifacts: true, documents: true, dashboards: true }]);
  });

  it('chooses the question tool through the binding', async () => {
    const tools = binding();
    const user = await openTools(tools);
    await enterTools(user);
    await user.click(screen.getByRole('menuitemradio', { name: 'Default' }));
    expect(tools.set.mock.calls.map(([set]) => set)).toEqual([{ ...FULL_MAWS_TOOL_SET, question: 'engine' }]);
  });

  it('opens each item’s note at once on keyboard focus, and keeps it as the item’s description', async () => {
    const user = await openTools(binding());
    await enterTools(user);
    const facts: [string, string][] = [
      ['Artifacts', 'Create, read and publish artifacts'],
      ['Documents', 'Edit documents and dashboard blocks. Answer comments on any artifact.'],
      ['Dashboards', "Bind a dashboard's data"],
      ['Auxiliary', 'Open panes for you'],
      ['Default', "Claude Code's own question"],
      ['MAWS', "MAWS's question"],
    ];
    const items = [...screen.getAllByRole('menuitemcheckbox'), ...screen.getAllByRole('menuitemradio')];
    expect(items.map((item) => [item.getAttribute('aria-label'), descriptionOf(item)?.textContent])).toEqual(facts);
    for (const item of [...items].reverse()) {
      act(() => item.focus()); // the keyboard lands on it: its note opens at once, and only its own
      expect(items.filter((row) => descriptionOf(row)!.hasAttribute('data-open'))).toEqual([item]);
    }
  });

  it('greys the submenu with the frame’s reason while the first send is starting', async () => {
    await openTools(binding(FULL_MAWS_TOOL_SET, 'Session is starting…'));
    const tools = screen.getByRole('menuitem', { name: 'Tools' });
    expect(tools.getAttribute('aria-disabled')).toBe('true');
    expect(descriptionOf(tools)?.textContent).toBe('Session is starting…');
  });

  it('draws no Tools submenu without a binding', async () => {
    await openTools(null);
    expect(screen.queryByRole('menuitem', { name: /^Tools/ })).toBeNull();
  });
});

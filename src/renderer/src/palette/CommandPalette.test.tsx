import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_IDS, ACTIONS } from '@shared/keymap/actions';
import { formatChord } from '@shared/keymap/chord';
import { registerShellActions } from '../app/shell-actions';
import { registerAction, runAction } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { Sidebar } from '../sidebar/Sidebar';
import { projectNodeId } from '../sidebar/tree';
import { CommandPalette, paletteEntries, usePalette } from './CommandPalette';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const offs: (() => void)[] = [];

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  usePalette.setState({ open: false });
  offs.push(registerShellActions({ invoke: vi.fn(async () => ({ ok: true, value: undefined })), on: vi.fn(() => () => {}) } as never));
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
});

const dialog = () => screen.getByRole('dialog', { name: 'Command palette' });
const group = (name: string) => within(dialog()).queryByRole('group', { name });
const options = (name: string) => {
  const g = group(name);
  return g ? within(g).queryAllByRole('option').map((o) => o.getAttribute('aria-label') ?? o.textContent) : [];
};

async function openAndType(query: string) {
  const user = userEvent.setup();
  render(<CommandPalette />);
  act(() => runAction('palette.open'));
  if (query) await user.keyboard(query);
  return user;
}

describe('command palette', () => {
  it('opens on palette.open with the query field focused, and closes on Escape', async () => {
    const user = await openAndType('');
    expect(document.activeElement).toBe(within(dialog()).getByRole('combobox'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists every action of the table with its chord, disabled ones greyed with what they wait for', async () => {
    await openAndType('');
    const actions = within(group('Actions')!).getAllByRole('option');
    expect(actions).toHaveLength(ACTION_IDS.length);
    for (const id of ACTION_IDS) {
      const option = actions.find((o) => o.dataset.value === `action:${id}`)!;
      expect(option, id).toBeTruthy();
      expect(option.textContent).toContain(ACTIONS[id].title);
      if (ACTIONS[id].chord) expect(option.textContent, id).toContain(formatChord(ACTIONS[id].chord!));
    }
    const newSession = actions.find((o) => o.dataset.value === 'action:session.new')!;
    expect(newSession.getAttribute('aria-disabled')).toBe('true');
    expect(newSession.textContent).toContain('Not available here');
    expect(actions.find((o) => o.dataset.value === 'action:composer.send')!.textContent).toContain('Keyboard only, in the composer');
    expect(actions.find((o) => o.dataset.value === 'action:tab.close')!.getAttribute('aria-disabled')).toBe('false');
  });

  it('“quota” lists exactly one session, Quota reset recovery, with its glyph and project', async () => {
    await openAndType('quota');
    const sessions = within(group('Sessions')!).getAllByRole('option');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].textContent).toContain('Quota reset recovery');
    expect(sessions[0].textContent).toContain('codex_somersault');
    expect(within(sessions[0]).getByRole('img', { name: 'Plan review' })).toBeTruthy();
    expect(options('Actions')).toEqual([]);
  });

  it('“dark” lists exactly one action, Appearance: Dark', async () => {
    await openAndType('dark');
    const actions = within(group('Actions')!).getAllByRole('option');
    expect(actions.map((o) => o.dataset.value)).toEqual(['action:theme.dark']);
    expect(group('Sessions')).toBeNull();
  });

  it('⏎ on a session opens its tab in the focused pane and closes the palette', async () => {
    const user = await openAndType('quota');
    await user.keyboard('{Enter}');
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${idOf('Quota reset recovery')}`);
    expect(useLayout.getState().main.panes).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('⌘⏎ on a session opens it in the split', async () => {
    const user = await openAndType('quota');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(useLayout.getState().main.panes).toHaveLength(2);
    expect(useLayout.getState().main.panes[1]?.activeTabId).toBe(`session:${idOf('Quota reset recovery')}`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('⏎ on an action closes the palette and runs it', async () => {
    const run = vi.fn();
    offs.push(registerAction('diagnostics.open', run));
    const user = await openAndType('diagnostics');
    await user.keyboard('{Enter}');
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a project reveals it in the sidebar: shown, expanded', async () => {
    useLayout.getState().setSidebar({ collapsed: true, collapsedProjects: [nine.projects[1].id] });
    const user = await openAndType(nine.projects[1].name.slice(0, 7));
    expect(options('Projects')).toEqual([nine.projects[1].name]);
    await user.click(within(group('Projects')!).getByRole('option'));
    expect(useLayout.getState().regions.sidebar).toMatchObject({ collapsed: false, collapsedProjects: [] });
  });

  it('a project the sidebar’s search hides is revealed: the search clears and the project row takes focus', async () => {
    const project = nine.projects[1];
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.type(screen.getByRole('searchbox', { name: 'Search sessions' }), 'Terminal workflow');
    const projectRow = () => document.querySelector<HTMLElement>(`[data-tree-id="${projectNodeId(project.id)}"]`);
    expect(projectRow()).toBeNull(); // the filter hides the project
    render(<CommandPalette />);
    act(() => runAction('palette.open'));
    await user.keyboard(project.name.slice(0, 7));
    await user.click(within(group('Projects')!).getByRole('option'));
    expect((screen.getByRole('searchbox', { name: 'Search sessions' }) as HTMLInputElement).value).toBe('');
    await vi.waitFor(() => expect(document.activeElement).toBe(projectRow()));
    expect(projectRow()!.getAttribute('aria-label')).toBe(project.name);
  });
});

describe('palette entries', () => {
  it('search sessions as the sidebar does, projects by name and directory, actions by title; archived sessions never', () => {
    const records = new Map(nine.sessions.map((r) => [r.appId, r]));
    const projects = new Map(nine.projects.map((p) => [p.id, p]));
    const quota = idOf('Quota reset recovery');
    records.set(quota, { ...records.get(quota)!, archived: true });
    const found = paletteEntries('quota', { records, projects });
    expect(found.sessions).toEqual([]);
    expect(paletteEntries('MAWS', { records, projects }).projects.map((p) => p.name)).toEqual(['MAWS']);
    expect(paletteEntries('', { records, projects }).actions).toEqual(ACTION_IDS);
  });
});

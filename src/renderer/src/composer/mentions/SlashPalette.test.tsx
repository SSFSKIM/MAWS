import { PluginKey } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { SESSION_ACTS_CAPABILITY } from '@shared/ipc/remote-unavailable';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { resetRemoteSurfaces } from '../../artifacts/remote-surfaces';
import { registerAction } from '../../keymap/actions-runtime';
import { resetRemoteLaneBStore } from '../../lane-b/remote-session';
import { remoteUnavailableOf } from '../../lane-b/remote-unavailable';
import { EMPTY_CATALOG, type SessionCatalog } from '../../stores/catalog';
import { useMachines } from '../../stores/machines';
import { useSessions } from '../../stores/sessions';
import type { PopupHandle, PopupItem } from './popup';
import { resetChosen } from './rank';
import { detailSide, detailTop, SlashPalette } from './SlashPalette';
import { WIDGET_COMMANDS } from './widgets';

const LOCAL = at('app-slash') as AppSessionId;
const REMOTE = addressOf(OTHER_MACHINE, 'app-far' as AppSessionId);
const PANELS: ReadonlySet<string> = new Set(WIDGET_COMMANDS.map((w) => w.name));
const declared = (name: string) => WIDGET_COMMANDS.find((w) => w.name === name)!.description;

const catalog: SessionCatalog = {
  ...EMPTY_CATALOG,
  launchId: 'L1',
  revision: 1,
  commands: [
    { name: 'statusline', description: 'Set up the status line', argumentHint: '[shape]', builtin: true },
    { name: 'first-steps', description: 'Where to start', argumentHint: null, builtin: true },
    { name: 'show-status', description: 'Show where things stand', argumentHint: null, builtin: true },
    { name: 'status-report', description: 'Summarise the week', argumentHint: null, builtin: false },
    { name: 'kit:stage', description: 'Stage the kit', argumentHint: null, builtin: false },
    { name: 'checkup', description: 'Check the setup', argumentHint: null, builtin: true },
  ],
  skills: ['status-report'],
  terminalOnly: ['checkup'],
};

function open(query: string, { extra = {}, widgets = new Set(['status']), appSessionId = LOCAL }: { extra?: Partial<SessionCatalog>; widgets?: ReadonlySet<string>; appSessionId?: AppSessionId } = {}) {
  const command = vi.fn<(item: PopupItem) => void>();
  const ref = createRef<PopupHandle>();
  const props = {
    query,
    range: { from: 1, to: 1 + query.length },
    editor: { state: {} } as unknown as Editor,
    command,
    ctx: { appSessionId, cwd: '', additionalDirectories: [], catalog: { ...catalog, ...extra }, widgets, openWidget: () => {} },
    pluginKey: new PluginKey('test-slash'),
  };
  render(<SlashPalette {...props} ref={ref} />);
  const key = (k: string) => act(() => void ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: k })));
  const options = () => screen.queryAllByRole('option');
  const shown = () => options().map((o) => o.textContent);
  const active = () => options().find((o) => o.getAttribute('aria-selected') === 'true')!;
  const popover = () => screen.queryByRole('tooltip');
  return { command, key, options, shown, active, popover };
}

beforeEach(() => {
  window.maws = { localMachine: TEST_MACHINE } as never;
});
afterEach(() => {
  cleanup();
  resetChosen(); // C11
  delete (window as { maws?: unknown }).maws;
});

// UX wave U4a (l3-input-06; decision 17): a row is an icon for its kind and the name; the highlighted row's description,
// argument hint and origin or reason are in a popover beside the list.
describe('the slash palette lists names', () => {
  it('draws each row as an icon for its kind and the name, under no heading', () => {
    const { options, shown } = open('st');
    expect(screen.queryAllByRole('group')).toEqual([]);
    // the name alone, no description; `/fast`, a declared panel no host registered here, greyed once typed
    expect(shown()).toEqual(['/status', '/statusline', '/status-report', '/first-steps', '/show-status', '/kit:stage', '/fast']);
    const kinds = Object.fromEntries(options().map((o) => [o.textContent, [o.getAttribute('data-origin'), o.querySelector('svg')?.getAttribute('data-icon')]]));
    expect(kinds).toMatchObject({ '/status': ['widget', 'widget'], '/statusline': ['engine', 'engine'], '/status-report': ['skills', 'skills'], '/kit:stage': ['plugins', 'plugins'] });
  });

  it('lists none of MAWS’s window actions, whatever is registered for them', () => {
    const off = registerAction('pane.split', () => {});
    try {
      expect(open('split').options()).toEqual([]);
      expect(screen.queryByRole('listbox')).toBeNull();
    } finally {
      off();
    }
  });

  it('opens on the panels, /model first, and cuts at 40 rows after them', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `cmd-${String(i).padStart(2, '0')}`, description: 'd', argumentHint: null, builtin: true }));
    const { shown, active } = open('', { extra: { commands: many, skills: [], terminalOnly: [] }, widgets: PANELS });
    const panels = [...PANELS].map((n) => `/${n}`);
    expect(shown()).toHaveLength(40);
    expect(shown().slice(0, panels.length)).toEqual(panels);
    expect(shown()[0]).toBe('/model');
    expect(shown().slice(panels.length)).toEqual(many.slice(0, 40 - panels.length).map((c) => `/${c.name}`));
    expect(active().textContent).toBe('/model');
  });

  it('starts on the best match and the arrows walk the rows as drawn', () => {
    const { key, active, command, shown } = open('status');
    expect(shown()).toEqual(['/status', '/statusline', '/status-report', '/show-status']);
    expect(active().textContent).toBe('/status'); // the exact name
    key('ArrowDown');
    expect(active().textContent).toBe('/statusline');
    key('ArrowUp');
    key('Enter');
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0][0].key).toBe('widget:status');
  });
});

describe('the highlighted row’s popover', () => {
  it('follows the arrow keys and the pointer: the description, the argument hint, and where the row comes from', () => {
    const { key, popover, options, active } = open('st');
    expect(screen.getByRole('listbox').contains(popover())).toBe(false); // beside the list, never inside it
    expect(active().textContent).toBe('/status');
    expect(popover()!.textContent).toBe(`${declared('status')}MAWS`); // a panel MAWS draws
    key('ArrowDown');
    expect(popover()!.textContent).toBe('Set up the status line[shape]');
    expect(active().getAttribute('aria-describedby')).toBe(popover()!.id);
    fireEvent.mouseEnter(options().find((o) => o.textContent === '/kit:stage')!);
    expect(popover()!.textContent).toBe('Stage the kitkit'); // a plugin's command names its plugin
    expect(options().filter((o) => o.hasAttribute('aria-describedby')).map((o) => o.textContent)).toEqual(['/kit:stage']);
  });

  it('leaves out a row that cannot run while nothing is typed, and greys it once typed with its reason in the popover', () => {
    expect(open('').shown()).not.toContain('/checkup');
    cleanup();
    const { options, popover } = open('check');
    const row = options()[0];
    expect(row.textContent).toBe('/checkup');
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.getAttribute('aria-describedby')).toBe(popover()!.id);
    expect(popover()!.textContent).toBe('Check the setupTerminal only');
  });

  // From the master that holds U9 (the landing's edge): `session.fork` is offered behind `rl2.session-acts`, so the row
  // reads U9's helper: its sentence on a machine that does not list the capability, nothing on one that does
  it('greys /fork with the helper’s sentence for a session on a machine that cannot fork it, and not where it can or on this Mac', () => {
    const machineLists = (capabilities: string[]) => {
      resetRemoteSurfaces();
      resetRemoteLaneBStore();
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay', capabilities }]);
      useSessions.setState({ listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'app-far'), appId: REMOTE }]]), listedMachines: new Set([OTHER_MACHINE]) });
    };
    try {
      machineLists([]); // a build that serves no session acts
      const words = remoteUnavailableOf(REMOTE, 'session.fork');
      expect(words).toContain('Update MAWS on mini');
      const far = open('fork', { appSessionId: REMOTE, widgets: PANELS });
      expect(far.options()[0].textContent).toBe('/fork');
      expect(far.options()[0].getAttribute('aria-disabled')).toBe('true');
      expect(far.popover()!.textContent).toBe(`${declared('fork')}[prompt]${words}`);
      cleanup();
      expect(open('', { appSessionId: REMOTE, widgets: PANELS }).shown()).not.toContain('/fork');
      cleanup();
      machineLists([SESSION_ACTS_CAPABILITY]); // one that forks there
      const there = open('fork', { appSessionId: REMOTE, widgets: PANELS });
      expect(there.options()[0].getAttribute('aria-disabled')).toBeNull();
      expect(there.popover()!.textContent).toBe(`${declared('fork')}[prompt]MAWS`);
      cleanup();
      const here = open('fork', { widgets: PANELS });
      expect(here.options()[0].getAttribute('aria-disabled')).toBeNull();
      expect(here.popover()!.textContent).toBe(`${declared('fork')}[prompt]MAWS`);
    } finally {
      useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    }
  });
});

// The popover's place against the window's edges (decision 17 g): never off the window, on either side.
describe('the popover stays inside the window', () => {
  it('opens to the right where 256px fit there, else to the left where they fit there', () => {
    expect(detailSide({ left: 20, right: 300 }, 1200)).toEqual({ side: 'right', width: 256 });
    expect(detailSide({ left: 700, right: 1100 }, 1200)).toEqual({ side: 'left', width: 256 });
    expect(detailSide({ left: 270, right: 940 }, 1200)).toEqual({ side: 'left', width: 256 }); // right has 246, left 256
  });

  it('where neither side fits, takes the side with more room and narrows to it', () => {
    // an 800px window, the list from 200 to 600: 186px on either side (the gap 6, the margin 8)
    expect(detailSide({ left: 200, right: 600 }, 800)).toEqual({ side: 'right', width: 186 });
    expect(detailSide({ left: 240, right: 640 }, 800)).toEqual({ side: 'left', width: 226 });
    expect(detailSide({ left: 100, right: 560 }, 800)).toEqual({ side: 'right', width: 226 });
    expect(detailSide({ left: 2, right: 798 }, 800)).toEqual({ side: 'right', width: 0 }); // no room at all: nothing past the edges
  });

  it('stands at the row’s height, kept inside the window’s height', () => {
    expect(detailTop(300, 340, 100, 900)).toBe(40); // at the row
    expect(detailTop(300, 840, 100, 900)).toBe(492); // its bottom 8px above the window's
    expect(detailTop(300, 280, 400, 600)).toBe(-108); // too tall for the room below: lifted to fit
    expect(detailTop(300, 280, 900, 600)).toBe(-292); // taller than the window: its top 8px below the window's
  });
});

// F2b (plan 2.1): by scrolling the list alone; the document-wide scrollIntoView moved the whole window
describe('the slash palette keeps the chosen row in view', () => {
  it('by scrolling the list alone', () => {
    // a 60px list over 30px rows: rows 0 and 1 show at scrollTop 0
    const ROW = 30;
    const box = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const geometry = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const list = this.closest('[role="listbox"]') as HTMLElement | null;
      if (this.getAttribute('role') === 'listbox') return box(0, 60);
      if (this.getAttribute('role') === 'option' && list) return box(Array.from(list.querySelectorAll('[role="option"]')).indexOf(this) * ROW - list.scrollTop, ROW);
      return box(0, 0);
    });
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    try {
      const { key, options } = open('st');
      const list = screen.getByRole('listbox');
      expect(list.scrollTop).toBe(0);
      key('ArrowUp'); // to the last row, below the fold
      expect(options().length).toBeGreaterThan(2);
      expect(list.scrollTop).toBe(options().length * ROW - 60);
      key('ArrowDown'); // back to the first row
      expect(list.scrollTop).toBe(0);
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      geometry.mockRestore();
      scroll.mockRestore();
    }
  });
});

import { PluginKey } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAction } from '../../keymap/actions-runtime';
import { EMPTY_CATALOG, type SessionCatalog } from '../../stores/catalog';
import type { PopupHandle, PopupItem } from './popup';
import { resetChosen } from './rank';
import { SlashPalette } from './SlashPalette';

afterEach(() => {
  cleanup();
  resetChosen(); // C11
});

describe('the slash palette', () => {
  it('enables a MAWS row once its action gains a handler, while the palette is open', () => {
    const props = {
      query: 'split',
      range: { from: 1, to: 7 },
      editor: {} as Editor,
      command: () => {},
      ctx: { cwd: '', additionalDirectories: [], catalog: EMPTY_CATALOG, widgets: new Set<string>(), openWidget: () => {} },
      pluginKey: new PluginKey('test-slash'),
    };
    render(<SlashPalette {...props} />);
    const row = () => screen.getAllByRole('option')[0];
    expect(row().textContent).toContain('Split / send to other pane');
    expect(row().getAttribute('aria-disabled')).toBe('true');
    let off = () => {};
    act(() => {
      off = registerAction('pane.split', () => {});
    });
    expect(row().getAttribute('aria-disabled')).toBeNull();
    act(() => off());
    expect(row().getAttribute('aria-disabled')).toBe('true');
  });
});

// C11 start: the palette's group headings (C7's ask of C11; mockup 04 vignette 4)
describe('the slash palette groups its rows by origin', () => {
  const catalog: SessionCatalog = {
    ...EMPTY_CATALOG,
    launchId: 'L1',
    revision: 1,
    commands: [
      { name: 'statusline', description: 'Set up the status line', argumentHint: null, builtin: true },
      { name: 'first-steps', description: 'Where to start', argumentHint: null, builtin: true },
      { name: 'show-status', description: 'Show where things stand', argumentHint: null, builtin: true },
      { name: 'status-report', description: 'Summarise the week', argumentHint: null, builtin: false },
    ],
    skills: ['status-report'],
  };
  const open = (query: string, extra: Partial<SessionCatalog> = {}) => {
    const command = vi.fn<(item: PopupItem) => void>();
    const ref = createRef<PopupHandle>();
    const props = {
      query,
      range: { from: 1, to: 1 + query.length },
      editor: { state: {} } as unknown as Editor,
      command,
      ctx: { cwd: '', additionalDirectories: [], catalog: { ...catalog, ...extra }, widgets: new Set(['status']), openWidget: () => {} },
      pluginKey: new PluginKey('test-slash-groups'),
    };
    render(<SlashPalette {...props} ref={ref} />);
    const key = (k: string) => act(() => void ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: k })));
    const active = () => screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')!;
    return { command, key, active };
  };

  it('puts each origin under its heading in the ranking order of origins, the badge left to the heading', () => {
    open('st');
    const groups = screen.getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Engine', 'Skills', 'Widget', 'MAWS']); // MAWS's actions match 'st' too
    expect(within(groups[0]).getAllByRole('option').map((o) => o.textContent)).toEqual(['/statuslineSet up the status line', '/first-stepsWhere to start', '/show-statusShow where things stand']); // rank order inside the group
    const status = within(groups[2]).getAllByRole('option').find((o) => o.textContent?.startsWith('/status'))!;
    expect(status.getAttribute('data-origin')).toBe('widget');
    expect(status.textContent).not.toContain('Widget');
    expect(groups[0].textContent?.startsWith('Engine')).toBe(true);
  });

  it('applies the 40-row cap before grouping', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `cmd-${String(i).padStart(2, '0')}`, description: 'd', argumentHint: null, builtin: true }));
    open('', { commands: many, skills: [] });
    expect(screen.getAllByRole('option')).toHaveLength(40);
  });

  it('starts on the best match wherever its group sits, and the arrows follow the display order', () => {
    const { key, active, command } = open('status');
    expect(active().textContent).toContain('/status'); // the exact name, in the Widget group shown last
    expect(active().getAttribute('data-origin')).toBe('widget');
    key('ArrowDown'); // past the last row, back to the first shown
    expect(active().textContent).toContain('/statusline');
    key('ArrowDown'); // the next row of the Engine group, not the next-ranked row (a skill)
    expect(active().textContent).toContain('/show-status');
    key('ArrowDown');
    expect(active().textContent).toContain('/status-report');
    key('ArrowDown');
    expect(active().getAttribute('data-origin')).toBe('widget');
    key('Enter');
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0][0].key).toBe('widget:status');
  });
});
// C11 end

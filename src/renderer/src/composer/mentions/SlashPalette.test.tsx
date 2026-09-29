import { PluginKey } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { registerAction } from '../../keymap/actions-runtime';
import { EMPTY_CATALOG } from '../../stores/catalog';
import { SlashPalette } from './SlashPalette';

afterEach(cleanup);

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

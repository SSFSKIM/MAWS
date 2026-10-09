// W3 (C6, charter §5.4 as amended 2026-10-01): a slash widget opens as one floating dialog over the window; Esc or the
// widget's close puts it away and gives the keyboard back to the session's composer.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { registerFocusTarget, resetComposerStore } from '../stores/composer';
import { registerSlashWidget } from './mentions/widgets';
import { closeWidgetDialog, openWidgetDialog, WIDGET_DIALOG_BOX, WidgetDialogHost } from './WidgetDialog';

const A = 'app-a' as AppSessionId;
afterEach(() => {
  cleanup();
  closeWidgetDialog();
  resetComposerStore();
});

describe('the widget dialog', () => {
  it('shows the registered widget with its argument in a dialog named by its title; a second open replaces it', async () => {
    const offs = [
      registerSlashWidget('mcp', { title: 'MCP servers', component: ({ args, close }) => <button onClick={close}>mcp {args}</button> }),
      registerSlashWidget('hooks', { title: 'Hooks', component: () => <p>hooks body</p> }),
    ];
    try {
      render(<WidgetDialogHost />);
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => openWidgetDialog(A, 'mcp', 'reconnect'));
      expect(screen.getByRole('dialog', { name: 'MCP servers' }).textContent).toContain('mcp reconnect');
      act(() => openWidgetDialog(A, 'hooks', ''));
      expect(screen.getByRole('dialog', { name: 'Hooks' })).toBeTruthy();
      expect(screen.queryByRole('dialog', { name: 'MCP servers' })).toBeNull();
    } finally {
      offs.forEach((off) => off());
    }
  });

  it('closes on Esc and on the widget’s close, and the composer’s editor takes the keyboard back', async () => {
    const focusEditor = vi.fn();
    registerFocusTarget(A, { focusEditor, focusFrame: () => {}, insertText: () => {} });
    const off = registerSlashWidget('mcp', { title: 'MCP servers', component: ({ close }) => <button onClick={close}>Done</button> });
    try {
      render(<WidgetDialogHost />);
      act(() => openWidgetDialog(A, 'mcp', ''));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(focusEditor).toHaveBeenCalled();
      act(() => openWidgetDialog(A, 'mcp', ''));
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    } finally {
      off();
    }
  });

  // P2-B (X19; the execution document §5.2): two sizes in one host, and Escape clearing a non-empty search first.
  it('chooses the content box by the widget’s size: utility by default, library fixed in height', () => {
    expect(WIDGET_DIALOG_BOX.utility).toContain('w-[min(560px,calc(100vw-48px))]');
    expect(WIDGET_DIALOG_BOX.utility).toContain('max-h-[85vh]');
    expect(WIDGET_DIALOG_BOX.library).toContain('w-[min(960px,calc(100vw-48px))]');
    expect(WIDGET_DIALOG_BOX.library).toContain('h-[min(85vh,800px)]');
    const offs = [registerSlashWidget('plugins', { title: 'Plugins', size: 'library', component: () => <p>library</p> }), registerSlashWidget('sandbox', { title: 'Sandbox', component: () => <p>utility</p> })];
    try {
      render(<WidgetDialogHost />);
      act(() => openWidgetDialog(A, 'plugins', ''));
      expect(screen.getByRole('dialog').className).toContain(WIDGET_DIALOG_BOX.library);
      act(() => openWidgetDialog(A, 'sandbox', ''));
      expect(screen.getByRole('dialog').className).toContain(WIDGET_DIALOG_BOX.utility);
    } finally {
      offs.forEach((off) => off());
    }
  });

  it('Escape in a non-empty search field keeps the dialog and the field clears; Escape again closes it', async () => {
    const focusEditor = vi.fn();
    registerFocusTarget(A, { focusEditor, focusFrame: () => {}, insertText: () => {} });
    function Library() {
      const [value, setValue] = useState('review');
      return (
        <input
          aria-label="Search plugins"
          data-escape-clears
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && value !== '') setValue('');
          }}
        />
      );
    }
    const off = registerSlashWidget('plugins', { title: 'Plugins', size: 'library', component: Library });
    try {
      render(<WidgetDialogHost />);
      act(() => openWidgetDialog(A, 'plugins', ''));
      const field = screen.getByRole('textbox', { name: 'Search plugins' });
      fireEvent.keyDown(field, { key: 'Escape' });
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(field).toHaveProperty('value', '');
      fireEvent.keyDown(field, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(focusEditor).toHaveBeenCalled();
    } finally {
      off();
    }
  });
});

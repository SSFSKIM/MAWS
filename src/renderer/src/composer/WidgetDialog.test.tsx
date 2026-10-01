// W3 (C6, charter §5.4 as amended 2026-10-01): a slash widget opens as one floating dialog over the window; Esc or the
// widget's close puts it away and gives the keyboard back to the session's composer.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { registerFocusTarget, resetComposerStore } from '../stores/composer';
import { registerSlashWidget } from './mentions/widgets';
import { closeWidgetDialog, openWidgetDialog, WidgetDialogHost } from './WidgetDialog';

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
});

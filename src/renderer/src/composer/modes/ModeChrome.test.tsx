// The editor's mode decoration under the word cut: bash mode is the Bash chip alone, with no line on how the command
// runs (C8); the Memory chip's menu opens straight onto the memory files, with no "# appends to" heading (C10).
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { ModeChrome } from './ModeChrome';

const APP = at('app-1' as AppSessionId);
const FILES = [
  { kind: 'project', path: '/repo/CLAUDE.md', label: 'Project memory', description: '', exists: true },
  { kind: 'user', path: '/home/.claude/CLAUDE.md', label: 'User memory', description: '', exists: true },
];

let fake: FakeClient;
beforeEach(() => {
  fake = fakeClient();
  window.maws = fake.client as unknown as PreloadBridge;
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('the mode decoration', () => {
  it('draws the Bash chip alone in bash mode', () => {
    const view = render(<ModeChrome appSessionId={APP} mode="bash" />);
    expect(view.container.textContent).toBe('Bash');
  });

  it('opens the Memory chip’s menu onto the memory files, under no heading', async () => {
    render(<ModeChrome appSessionId={APP} mode="memory" />);
    await userEvent.setup().click(screen.getByRole('button', { name: /^Memory ·/ }));
    await waitFor(() => expect(fake.pending('session.getMemoryDialog')).toBe(1));
    await act(() => fake.reply('session.getMemoryDialog', { files: FILES, folders: [] }));
    const items = await screen.findAllByRole('menuitem');
    expect(screen.getByRole('menu').textContent).not.toContain('appends to');
    expect(items.map((item) => item.textContent)).toEqual(['● Project memory/repo/CLAUDE.md', 'User memory/home/.claude/CLAUDE.md']);
  });
});

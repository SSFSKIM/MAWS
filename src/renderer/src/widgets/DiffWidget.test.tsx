import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { GetWorkspaceDiffResponse } from '@shared/wire/control';
import { panelHost, usePanelHost } from '../panel/host';
import { DiffBody, present } from './DiffWidget';

const ID = 'app-1' as AppSessionId;
const answer = (kind: string): GetWorkspaceDiffResponse =>
  ({
    diff: {
      stats: { filesCount: 1, linesAdded: 2, linesRemoved: 1 },
      perFileStats: [{ path: 'src/app.ts', added: 2, removed: 1, isBinary: false, isUntracked: false }],
      hunks: [],
      skippedLarge: [],
      restricted: [],
      source: kind === 'branch' ? { kind, baseBranch: 'main' } : { kind },
    },
  }) as unknown as GetWorkspaceDiffResponse;

let addTool: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  usePanelHost.setState((s) => ({ tools: new Map(s.tools).set('review', {} as never) })); // C8c's Review tool registered
  addTool = vi.spyOn(panelHost, 'addTool').mockImplementation(() => undefined as never);
});
afterEach(() => {
  cleanup();
  addTool.mockRestore();
  usePanelHost.setState((s) => {
    const tools = new Map(s.tools);
    tools.delete('review');
    return { tools };
  });
});

describe("diff widget's Open in Review", () => {
  it('opens C8c’s Review tool on the scope the read was taken in: the working tree as uncommitted, a branch diff as branch', () => {
    const close = vi.fn();
    const { unmount } = render(<DiffBody view={present(answer('working-tree'))} appSessionId={ID} close={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Review' }));
    expect(addTool).toHaveBeenLastCalledWith('review', { appSessionId: ID, params: { scope: 'uncommitted' } });
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
    render(<DiffBody view={present(answer('branch'))} appSessionId={ID} close={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Review' }));
    expect(addTool).toHaveBeenLastCalledWith('review', { appSessionId: ID, params: { scope: 'branch' } });
  });

  it('opens a file’s row at its path', () => {
    render(<DiffBody view={present(answer('working-tree'))} appSessionId={ID} close={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'src/app.ts' }));
    expect(addTool).toHaveBeenLastCalledWith('review', { appSessionId: ID, params: { scope: 'uncommitted', path: 'src/app.ts' } });
  });
});

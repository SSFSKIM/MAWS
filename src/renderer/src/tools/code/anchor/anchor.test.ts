// The composer seam (E5 execution document, Interfaces *The comment gutter and the anchor seam*): the file-line anchor's
// fields, the registered opener (later registrations win, a disposer restores the one before), and the placeholder
// sheet's dialog when none is registered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { useEditorDialog } from '../editor/EditorDialogs';
import { fileLineAnchor, openCommentComposer, registerCommentComposer } from './anchor';

const A = 'app-a' as AppSessionId;

describe('comment composer seam', () => {
  const offs: (() => void)[] = [];
  beforeEach(() => useEditorDialog.setState({ open: null }));
  afterEach(() => offs.splice(0).forEach((off) => off()));

  it('names a file’s line as X10’s file-line anchor', () => {
    expect(fileLineAnchor('/r/src/app.ts', 7)).toEqual({ kind: 'file-line', locator: '/r/src/app.ts#L7', label: 'app.ts:7', path: '/r/src/app.ts', line: 7 });
  });

  it('opens the latest registered composer, and the one before once it is disposed', () => {
    const first = vi.fn();
    const second = vi.fn();
    offs.push(registerCommentComposer(first));
    const offSecond = registerCommentComposer(second);
    const anchor = fileLineAnchor('/r/app.ts', 3);
    openCommentComposer(anchor, { appSessionId: A });
    expect(second).toHaveBeenCalledWith(anchor, { appSessionId: A });
    expect(first).not.toHaveBeenCalled();
    offSecond();
    offSecond(); // a second dispose changes nothing
    openCommentComposer(anchor, { appSessionId: A });
    expect(first).toHaveBeenCalledWith(anchor, { appSessionId: A });
    expect(useEditorDialog.getState().open).toBeNull();
  });

  it('opens the placeholder sheet when no composer is registered', () => {
    const anchor = fileLineAnchor('/r/app.ts', 3);
    openCommentComposer(anchor, { appSessionId: A });
    expect(useEditorDialog.getState().open).toEqual({ kind: 'anchor', anchor, appSessionId: A });
  });
});

// The editor's sheets (E5 execution document, Interfaces *Dialogs*): the close sheet a dirty file tab's close guard
// asks with (Save, Don't save, Cancel), and the anchor placeholder the comment gutter opens until E3 registers its
// composer (the anchor's fields and Close). Its own store rather than C10's `confirm()`, which answers yes or no; a save
// prompt needs three answers. Rendered through C10's `Sheet` and `SheetForm`, mounted once from App.tsx, so a guard for
// a tab that is not shown still has a surface. One sheet at a time: opening another answers a close sheet shown `cancel`.
import { create } from 'zustand';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { Sheet, SheetForm } from '../../../sessions/Sheet';
import { PRIMARY, SECONDARY } from '../../../sessions/ui';
import { EDITOR_COPY } from '../copy';
import { useViewer } from '../viewer/viewer-store';

export type CloseChoice = 'save' | 'discard' | 'cancel';

export type EditorDialog =
  | { kind: 'close'; tabId: string; name: string; answer(choice: CloseChoice): void }
  | { kind: 'anchor'; anchor: Anchor; appSessionId: AppSessionId };

export const useEditorDialog = create<{ open: EditorDialog | null }>()(() => ({ open: null }));

// Shows `next`, answering a close sheet it replaces `cancel`.
function show(next: EditorDialog) {
  const previous = useEditorDialog.getState().open;
  useEditorDialog.setState({ open: next });
  if (previous?.kind === 'close') previous.answer('cancel');
}

// Asks whether to save a dirty tab before it closes; answered once, by the sheet or by a sheet that replaces it.
export function askClose(tabId: string, name: string): Promise<CloseChoice> {
  return new Promise((resolve) => {
    let settled = false;
    const answer = (choice: CloseChoice) => {
      if (settled) return;
      settled = true;
      const open = useEditorDialog.getState().open;
      if (open?.kind === 'close' && open.answer === answer) useEditorDialog.setState({ open: null });
      resolve(choice);
    };
    show({ kind: 'close', tabId, name, answer });
  });
}

// The placeholder for E3's comment composer: the anchor a comment would attach to, on screen.
export function showAnchor(anchor: Anchor, appSessionId: AppSessionId): void {
  show({ kind: 'anchor', anchor, appSessionId });
}

export function EditorDialogs() {
  const open = useEditorDialog((s) => s.open);
  if (open === null) return null;
  if (open.kind === 'anchor') return <AnchorPlaceholder anchor={open.anchor} />;
  return <CloseSheet open={open} />;
}

// UX wave U6e (the task review's finding 3): while the tab's latest admission locks it, Save cannot write, so the
// question offers only Don't save and Cancel, and Cancel, which keeps the tab and its edits, holds the keyboard.
function CloseSheet({ open }: { open: Extract<EditorDialog, { kind: 'close' }> }) {
  const locked = useViewer((s) => (s.entries.get(open.tabId)?.locked ?? null) !== null);
  return (
    <Sheet title={EDITOR_COPY.closeTitle(open.name)} onClose={() => open.answer('cancel')} data-editor-close={open.tabId}>
      {locked ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-fg-muted">{EDITOR_COPY.closeBody}</p>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={SECONDARY} onClick={() => open.answer('discard')}>
              {EDITOR_COPY.dontSave}
            </button>
            <button type="button" autoFocus className={SECONDARY} onClick={() => open.answer('cancel')}>
              {EDITOR_COPY.cancel}
            </button>
          </div>
        </div>
      ) : (
        <SheetForm
          focusSubmit
          canSubmit
          onSubmit={() => open.answer('save')}
          submitLabel={EDITOR_COPY.save}
          submitClass={PRIMARY}
          extra={
            <button type="button" className={SECONDARY} onClick={() => open.answer('discard')}>
              {EDITOR_COPY.dontSave}
            </button>
          }
        >
          <p className="m-0 text-fg-muted">{EDITOR_COPY.closeBody}</p>
        </SheetForm>
      )}
    </Sheet>
  );
}

const dismiss = () => useEditorDialog.setState({ open: null });

// Any X10 anchor since E3 widened the seam; the fields a kind does not carry are left out. The word cut (T352): no
// sentence about the build plan above them.
function AnchorPlaceholder({ anchor }: { anchor: Anchor }) {
  const line = anchor.line === undefined ? undefined : String(anchor.line);
  const fields: [string, string][] = [
    ['locator', anchor.locator],
    ['label', anchor.label],
  ];
  if (anchor.path !== undefined) fields.push(['path', anchor.path]);
  if (line !== undefined) fields.push(['line', line]);
  return (
    <Sheet
      title={EDITOR_COPY.anchorTitle(anchor.label)}
      onClose={dismiss}
      data-anchor-placeholder=""
      data-anchor-kind={anchor.kind}
      data-anchor-locator={anchor.locator}
      data-anchor-label={anchor.label}
      data-anchor-path={anchor.path}
      data-anchor-line={line}
    >
      <div className="flex flex-col gap-3">
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-ui-sm">
          {fields.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-fg-muted">{name}</dt>
              <dd className="m-0 break-all text-fg">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center justify-end">
          <button type="button" autoFocus onClick={dismiss} className={PRIMARY}>
            {EDITOR_COPY.close}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

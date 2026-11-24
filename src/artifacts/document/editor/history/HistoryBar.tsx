// The preview's bar (D10 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.7 of the parent), in place of the
// formatting toolbar while the editor shows a version: what is shown, its tab (with the tabs a comparison added,
// renamed or deleted marked as such, a deleted one still shown; a single tab's change named beside the heading), Show
// changes (on by default), "N changes" of the whole comparison with ↑ ↓ stepping through every tab's changes in order
// (a tab's own rename or deletion first, then its body's), Restore this version (confirmed first), Make a copy, Name this
// version (M8: its label alone, A's `artifacts.nameVersion`), and Back to document. The count is the controller's whole-document list, the one the pill counts.
// The word cut (G377, G379, G337): the bar ends with Restore (named Restore this version), the version's other actions in
// one menu, and a × named Back to document; a deleted tab is said by its label alone; a button whose word shows draws no
// tooltip repeating it.
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { DropdownMenu } from 'radix-ui';
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { NamedGlyph } from '../../../../renderer/src/ui/glyph';
import { unboundExtras /* P3-E */, type DiffTab, type ExtraChange /* P3-E */, type TabChanges } from '../../history';
import type { HistoryController, Preview } from './controller';
import { changesOf, goToChange } from './paint';
import { HISTORY_COPY as W } from '../copy';
import { MoreIcon } from '../../../ui/icons';

interface Stop {
  tabId: string;
  /** A body change's index in its tab, or the tab's own change. */
  at: number | 'tab';
}
// P3-E (E2 M4): an unbound extra change is a stop of its own, after every tab's, reached where the bar is (no tab faked)
type AnyStop = Stop | { extra: ExtraChange };
const stopsOf = (changes: readonly TabChanges[], extras?: readonly ExtraChange[]): AnyStop[] => [
  ...changes.flatMap(({ tab, entry, body }) => [...(entry ? [{ tabId: tab.id, at: 'tab' as const }] : []), ...Array.from({ length: body }, (_, at) => ({ tabId: tab.id, at }))]),
  ...unboundExtras(extras).map((extra) => ({ extra })), // P3-E
];
const reachedExtra = (preview: Preview): string | null => (typeof preview.focus === 'object' && preview.focus !== null ? preview.focus.extra : null); // P3-E

// ↓ or ↑ over the whole comparison, wrapping: from what is reached in the shown tab, or, with nothing reached, from the
// shown tab's place in the tab order. Another tab's stop shows that tab and reaches it there.
function step(editor: Editor, preview: Preview, controller: HistoryController, direction: 1 | -1): void {
  const stops = stopsOf(preview.changes, preview.extras);
  if (stops.length === 0) return;
  const shown = preview.tabId;
  const { current } = changesOf(editor.state);
  const extra = reachedExtra(preview); // P3-E
  const reached = current !== null ? current : preview.focus === 'tab' ? 'tab' : null;
  const at = extra !== null ? stops.findIndex((stop) => 'extra' in stop && stop.extra.key === extra) : reached === null ? -1 : stops.findIndex((stop) => 'tabId' in stop && stop.tabId === shown && stop.at === reached);
  let target: AnyStop;
  if (at >= 0) target = stops[(at + direction + stops.length) % stops.length];
  else {
    const order = preview.tabs.map((tab) => tab.id);
    const here = order.indexOf(shown ?? '');
    const first = stops.findIndex((stop) => 'tabId' in stop && order.indexOf(stop.tabId) >= here);
    target = direction === 1 ? stops[first >= 0 ? first : 0] : stops[((first >= 0 ? first : stops.length) - 1 + stops.length) % stops.length];
  }
  // P3-E: an unbound entry is reached in the bar, where the preview is
  if ('extra' in target) {
    goToChange(editor, null);
    controller.setFocus({ extra: target.extra.key });
    return;
  }
  if (target.tabId !== shown) controller.setTab(target.tabId, target.at);
  else if (target.at === 'tab') {
    goToChange(editor, null);
    controller.setFocus('tab');
  } else {
    goToChange(editor, target.at);
    controller.setFocus(null);
  }
}

export function HistoryBar({ editor, preview, controller, onBack }: { editor: Editor; preview: Preview; controller: HistoryController; onBack(): void }) {
  const [confirming, setConfirming] = useState(false);
  const [naming, setNaming] = useState(false);
  // The pair review's fix wave: the restore's confirm is an alertdialog and takes the keyboard on its Cancel (as the
  // transcript's restore dialog does), so no focus is left behind it, and the "…"'s tooltip, which a menu's close leaves
  // open on its focused trigger, closes with that focus; Cancel gives the keyboard back to Restore. Name this version,
  // chosen in the menu, keeps the keyboard in its field.
  const restoreButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const namingChosen = useRef(false);
  useEffect(() => {
    if (confirming) cancelButton.current?.focus();
  }, [confirming]);
  // re-rendered as ↑ ↓ moves within the tab (the count itself is the whole comparison's)
  useEditorState({ editor, selector: ({ editor: e }) => (e ? changesOf(e.state).current : null) });
  const unbound = unboundExtras(preview.extras); // P3-E
  const count = preview.changes.reduce((n, tab) => n + (tab.entry ? 1 : 0) + tab.body, 0) + unbound.length; // P3-E: + unbound
  const extraReached = unbound.find((extra) => extra.key === reachedExtra(preview)); // P3-E
  const shownTab = preview.tabs.find((tab) => tab.id === preview.tabId);
  const tabReached = preview.focus === 'tab' ? '' : undefined;
  const annotated = shownTab && tabLabel(shownTab, preview.showChanges) !== (shownTab.title || 'Untitled tab');
  return (
    <>
      <div className="doc-toolbar doc-history-bar" role="toolbar" aria-label="Version preview">
        <span className="doc-history-heading">{preview.title}</span>
        {preview.tabs.length === 1 && shownTab && annotated && (
          <span className="doc-history-tab" data-current={tabReached}>
            {tabLabel(shownTab, preview.showChanges)}
          </span>
        )}
        {preview.tabs.length > 1 && (
          <select className="doc-toolbar-select" aria-label="Tab" data-current={tabReached} value={preview.tabId ?? ''} onChange={(event) => controller.setTab(event.target.value)}>
            {preview.tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tabLabel(tab, preview.showChanges)}
              </option>
            ))}
          </select>
        )}
        {preview.showChanges && extraReached && (
          // P3-E: the unbound change ↑ ↓ reached, named
          <span className="doc-history-tab" data-current="" data-extra={extraReached.key}>
            {extraReached.label}
          </span>
        )}
        <span className="doc-toolbar-separator" />
        <label className="doc-history-filter">
          <input type="checkbox" checked={preview.showChanges} onChange={(event) => controller.setShowChanges(event.target.checked)} />
          Show changes
        </label>
        {preview.showChanges && (
          <>
            <span className="doc-history-count" aria-live="polite">
              {count === 1 ? '1 change' : `${count} changes`}
            </span>
            <Button label="Previous change" disabled={count === 0} onClick={() => step(editor, preview, controller, -1)}>
              ↑
            </Button>
            <Button label="Next change" disabled={count === 0} onClick={() => step(editor, preview, controller, 1)}>
              ↓
            </Button>
          </>
        )}
        <span className="doc-toolbar-spacer" />
        {preview.versionId !== null && (
          <>
            <Button ref={restoreButton} label={W.restoreName} worded onClick={() => setConfirming(true)}>
              {W.restore}
            </Button>
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <NamedGlyph label={W.actionsName} className="doc-tool doc-tool-glyph" data-history-actions="">
                  <MoreIcon />
                </NamedGlyph>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="doc-tab-menu"
                  align="end"
                  sideOffset={4}
                  aria-label={W.actionsName}
                  onCloseAutoFocus={(event) => {
                    // Name this version takes the keyboard to its field (NameForm), not back to the "…"
                    if (!namingChosen.current) return;
                    namingChosen.current = false;
                    event.preventDefault();
                  }}
                >
                  <DropdownMenu.Item className="doc-tab-menu-item" onSelect={() => void controller.duplicate()}>
                    {W.makeCopy}
                  </DropdownMenu.Item>
                  {controller.canName && (
                    <DropdownMenu.Item
                      className="doc-tab-menu-item"
                      onSelect={() => {
                        namingChosen.current = true;
                        setNaming(true);
                      }}
                    >
                      {W.nameVersion}
                    </DropdownMenu.Item>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </>
        )}
        <NamedGlyph label={W.backName} className="doc-tool doc-tool-glyph" onMouseDown={(event) => event.preventDefault()} onClick={onBack} data-history-back="">
          ×
        </NamedGlyph>
      </div>
      {naming && <NameForm onName={(label) => controller.name(label)} onDone={() => setNaming(false)} />}
      {confirming && (
        <div className="doc-history-confirm" role="alertdialog" aria-label="Restore this version?">
          <p>Restore this version? The document goes back to it as a new version; everything since stays in history, and comment conversations are kept.</p>
          <div className="doc-history-save-actions">
            <Button
              ref={cancelButton}
              label="Cancel"
              worded
              onClick={() => {
                setConfirming(false);
                restoreButton.current?.focus();
              }}
            >
              Cancel
            </Button>
            <Button
              label="Restore"
              worded
              onClick={() => {
                setConfirming(false);
                void controller.restore();
              }}
            >
              Restore
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

// A deleted tab is always named so (its content is what Restore would bring back); a new or renamed one while changes show.
function tabLabel(tab: DiffTab, showChanges: boolean): string {
  const title = tab.title || 'Untitled tab';
  if (tab.change === 'removed') return `${title} (deleted)`;
  if (!showChanges) return title;
  if (tab.change === 'added') return `${title} (new)`;
  if (tab.change === 'renamed') return `${title} (renamed from ${tab.previousTitle || 'Untitled tab'})`;
  return title;
}

// `worded`: the button shows its word, so no tooltip repeats it (the word cut, G337); a glyph's word is its tooltip.
function Button({ ref, label, worded = false, disabled, onClick, children }: { ref?: Ref<HTMLButtonElement>; label: string; worded?: boolean; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button ref={ref} type="button" className="doc-tool" aria-label={label} title={worded ? undefined : label} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

// Name this version: the label only (the version keeps its note).
function NameForm({ onName, onDone }: { onName(label: string): Promise<boolean>; onDone(): void }) {
  const [label, setLabel] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = label.trim();
    if (name === '') return;
    void onName(name).then((named) => named && onDone());
  };
  return (
    <form className="doc-history-save" aria-label="Name this version" onSubmit={submit}>
      <input autoFocus aria-label="Version name" placeholder={W.namePlaceholder} maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} />
      <div className="doc-history-save-actions">
        <Button label="Cancel" worded onClick={onDone}>
          Cancel
        </Button>
        <button type="submit" className="doc-tool" disabled={label.trim() === ''}>
          Save
        </button>
      </div>
    </form>
  );
}

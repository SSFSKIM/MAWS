// One tab of a pane's strip (§5.2; mockup 01 `.tab`; residue *Tab strip*): the status glyph of a session (a file's
// glyph on a file tab, where the blue extension was before the word cut's W13), the title,
// its place as `small` in a strip that mixes places (UX wave U13a, `tab-place.ts`), and a close control revealed on
// hover and focus. It is a `div role="tab"` rather than a button because it holds that inner button and native drag
// attributes. A middle-click closes it; its context menu pins it, moves it to the other pane (an artifact's also into
// the panel, P3-F wave S) and closes it, the others or those to its right. (The Overview is no tab since W5: it floats
// over the main area.)
import { ContextMenu } from 'radix-ui';
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { Strip, TabRef } from '@shared/ipc/schema/layout';
import { FileIcon, PinIcon, useChordHint } from '../app/IconButton';
import { BRIDGED_LINE, heldLine } from '../attention/derive'; // P5 O9
import { GlyphMark } from '../attention/GlyphMark';
import { Tip } from '../ui/tip';
import { useSessionControls } from '../session/controls/controls-for'; // P5 O9
import { glyphFor, type Glyph } from '../attention/glyph';
import { requestCloseTab, useUnstartedTitle } from '../keymap/actions-runtime';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { machineOf } from '@shared/machine/address';
import { useMachines } from '../stores/machines';
import { selectShownOffline, usePhaseClock } from '../app/machine-mark'; // the UX wave, U9
import { displayTitle } from '../sessions/title';
// E5 start
import { EDITOR_COPY } from '../tools/code/copy';
import { useViewer } from '../tools/code/viewer/viewer-store';
// E5 end
// E2 start
// E2 end
// P3-L start
import { LIBRARY_COPY } from '../library/copy';
import { ipc } from '../ipc/client';
import { useArtifactTitle } from '../library/store';
// P3-L end
// P3-F wave S (F16); P4-B3 (X38): the move to the panel, its drag and its one refusal
import { beginDrag, endDragFrom, moveToPanel, TAB_DRAG_TYPE, useTransferRefusal } from '../shell/transfer';
import { TRANSFER_COPY } from '../tools/artifacts/copy';
import { RefusedMenuItem } from '../ui/refused-menu-item';
// E4a start
import { BROWSER_COPY } from '../tools/browser/copy';
import { useBrowserTitle } from '../tools/browser/store';
// E4a end
import { useChannelTitle } from '../channel/title'; // P5 O8 M7a

export { TAB_DRAG_TYPE };

export interface TabLabel {
  title: string;
  secondary: string | null;
  glyph: Glyph | null;
  file: boolean; // a file tab, marked by the file glyph (the word cut, W13: its extension is in its name)
}

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

// A session tab's label: the record's title and glyph; with no record, its listed row's title (P5 O9 M9: another
// machine's terminal session, which has its row alone), the title the tab last knew (P5 O6 M2: a
// session of a machine not loaded in this run), else an unstarted session's, titled through `registerUnstartedTitle`,
// without a glyph. Where the session sits is its place, which the strip decides (U13a, `tab-place.ts`).
function useSessionLabel(appSessionId: AppSessionId, lastKnown?: string): TabLabel {
  const record = useSessions((s) => s.records.get(appSessionId));
  const listedTitle = useSessions((s) => s.listed.get(appSessionId)?.title.trim() || null); // P5 O9 M9
  const digest = useSessions((s) => s.digests.get(appSessionId));
  const listing = useSessions((s) => s.listed.get(appSessionId)); // P5 O7 M10: a remote lane B record's state (`listedStateOf`)
  const pending = useAttention((s) => selectPendingOf(s, appSessionId));
  const unstarted = useUnstartedTitle(appSessionId);
  if (!record) return { title: listedTitle ?? lastKnown ?? unstarted.title, secondary: null, glyph: null, file: false };
  return { title: displayTitle(record), secondary: null, glyph: glyphFor(record, digest ?? null, pending, listing), file: false };
}

export function useTabLabel(tab: TabRef): TabLabel {
  const appSessionId = tab.kind === 'session' || tab.kind === 'agent' ? tab.appSessionId : ('' as AppSessionId);
  const session = useSessionLabel(appSessionId, tab.kind === 'session' ? tab.title : undefined);
  const browserTitle = useBrowserTitle(tab.kind === 'browser' ? tab.appSessionId : null, tab.kind === 'browser' ? tab.browserTabId : null); // E4a
  const artifactTitle = useArtifactTitle(tab.kind === 'artifact' ? tab.artifactId : null, tab.kind === 'artifact' ? tab.machine : ipc.localMachine); // P3-L
  const channelTitle = useChannelTitle(tab.kind === 'channel' ? tab.project : null); // P5 O8 M7a
  switch (tab.kind) {
    case 'session':
      return session;
    case 'agent':
      return { title: session.title, secondary: 'agent', glyph: null, file: false };
    case 'file':
      return { title: basename(tab.path), secondary: null, glyph: null, file: true };
    case 'diff':
      return { title: `Diff · ${tab.ref}`, secondary: null, glyph: null, file: false };
    case 'diagnostics':
      return { title: 'Diagnostics', secondary: null, glyph: null, file: false };
    case 'artifact': // P3-L
      return { title: artifactTitle ?? LIBRARY_COPY.fallbackTitle, secondary: null, glyph: null, file: false };
    case 'browser': // E4a
      return { title: browserTitle ?? BROWSER_COPY.title, secondary: null, glyph: null, file: false };
    case 'channel': // P5 O8 M7a: "<project> · channel"
      return { title: channelTitle, secondary: null, glyph: null, file: false };
  }
}

// P5 O9 (the owner's Q1): a session a terminal or a `--bg` job holds reads like any MAWS session while MAWS drives it
// through its bridge (its controls port is lane A: `turn()` non-null), with a small mark of where it runs. The word cut
// (W10): the mark is the ⌁ the status glyph draws for a session live elsewhere, in its tone, the word ("Terminal",
// "Background job") its accessible name; the hover card's line (`title`) is the tab's tip and description. Null for every
// other tab.
function useHolderMark(tab: TabRef): { text: string; title: string } | null {
  const appSessionId = tab.kind === 'session' ? tab.appSessionId : null;
  const record = useSessions((s) => (appSessionId === null ? null : (s.records.get(appSessionId) ?? null)));
  const controls = useSessionControls(appSessionId ?? ('' as AppSessionId));
  if (record === null || controls === null || controls.turn() === null) return null;
  const terminal = record.holder.kind === 'terminal';
  return { text: terminal ? 'Terminal' : 'Background job', title: BRIDGED_LINE(terminal ? null : heldLine(record)) };
}

function useSessionOffline(tab: TabRef): boolean {
  const appSessionId = tab.kind === 'session' || tab.kind === 'agent' ? tab.appSessionId : null;
  const now = usePhaseClock(); // the UX wave, U9 (O-39): greyed only in the offline and removed phases
  return useMachines((s) => appSessionId !== null && selectShownOffline(s, machineOf(appSessionId), now));
}

// A tab's full name, its accessible name, tooltip and All tabs line (U13a, §G): the title, then its place when the strip
// draws one, else its secondary mark (an agent's).
export const tabName = (label: TabLabel, place: string | null): string => {
  const after = place ?? label.secondary;
  return after ? `${label.title} · ${after}` : label.title;
};

// A file's name split before its extension, which stays drawn when the name clips (the word cut's fix wave for M4: two
// long names that differ only in it stay told apart). A leading dot opens a name, not an extension; a "suffix" longer
// than an extension is part of the name.
export function fileNameParts(name: string): { stem: string; suffix: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name.length - dot > 12) return { stem: name, suffix: '' };
  return { stem: name.slice(0, dot), suffix: name.slice(dot) };
}

// The title of a file's tab: the stem clips first, to nothing if it must; the extension clips only in a title narrower
// than itself.
function FileTitle({ name, className }: { name: string; className: string }) {
  const { stem, suffix } = fileNameParts(name);
  return (
    <span className={`flex max-w-full min-w-0 shrink-0 truncate ${className}`}>
      <span className="min-w-0 truncate">{stem}</span>
      {suffix && <span data-tab-suffix className="max-w-full shrink-0 truncate">{suffix}</span>}
    </span>
  );
}

// E11 F2b (plan 2.5; owner decision 2): opening a session replaces the shown tab unless it is pinned.
export const PINNED_HINT = 'Pinned: stays open when you open another session';

export interface TabProps {
  tab: TabRef;
  pane: 0 | 1;
  domId: string;
  active: boolean;
  place?: string | null; // where its session sits, while the strip draws places (`useStripPlaces`); none outside a strip
  stop: boolean; // the strip's one tab stop
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
}

export function Tab({ tab, pane, domId, active, place = null, stop, onKeyDown }: TabProps) {
  const label = useTabLabel(tab);
  const offline = useSessionOffline(tab); // P5 O6 M5 (T5): an offline machine's kept tab, its title in the disabled token
  const name = tabName(label, place);
  const closeChord = useChordHint('tab.close');
  const dirty = useFileTabDirty(tab); // E5
  const holderMark = useHolderMark(tab); // P5 O9
  // W10: pointing at the mark shows the tab's tip. The region is always mounted (`contents`: no box, so no gap while
  // empty), since the tip reads it once and the mark comes and goes with the bridge.
  const holderRegion = useRef<HTMLElement>(null);
  const tip = holderMark?.title ?? (tab.kind === 'file' ? tab.path : null);
  // Keep plain tabs compact, but reserve each nonshrinking mark plus its gap before truncating the title. The place
  // reserves nothing: it gives way first (U13a).
  const minWidth = Math.max(active ? 24 : 16, 16 + (label.glyph ? 4 : 0) + (label.file ? 4 : 0) + (tab.pinned ? 4 : 0) + (dirty ? 4 : 0) + (label.secondary ? 20 : 0) + (holderMark ? 16 : 0));

  const onAuxClick = (event: MouseEvent) => {
    if (event.button === 1) void requestCloseTab(tab.id);
  };
  // P4-B3 (INV-5): a tab unmounting mid-drag (moved, closed) ends the drag it started, whose dragend reaches no one.
  useEffect(() => () => endDragFrom('main', tab.id), [tab.id]);

  const element = (
    <div
      role="tab"
      id={domId}
      aria-selected={active}
      aria-label={name}
      // UX wave U6e (decision 11; U13's): a file's tab has its full path as its tooltip, a `Tip` the keyboard reaches (the
      // word cut's fix wave for M4); any other tab its name, the system's
      title={tab.kind === 'file' ? undefined : name}
      tabIndex={stop ? 0 : -1}
      data-tab-id={tab.id}
      data-dirty={dirty ? 'true' : undefined} // E5
      draggable
      onDragStart={(event) => beginDrag(event, { source: 'main', tabId: tab.id, fromPane: pane })}
      onClick={() => {
        useLayout.getState().activateTab(tab.id);
        // UX wave U6e (decision 19): the person's click on a file's tab is the person's open of the file: the agent's mark goes
        if (tab.kind === 'file') useViewer.getState().revisit(tab.id, tab.appSessionId);
      }}
      onMouseDown={(event) => event.button === 1 && event.preventDefault()} // no autoscroll on a middle press
      onAuxClick={onAuxClick}
      onKeyDown={onKeyDown}
      style={{ minWidth: `calc(var(--spacing) * ${minWidth})` }}
      className={`group/tab relative flex max-w-60 shrink cursor-default items-center gap-1.5 border-r border-border px-2.5 text-ui-sm whitespace-nowrap outline-accent select-none focus-visible:outline-2 focus-visible:-outline-offset-2 ${
        active ? 'bg-bg-raised text-fg shadow-[inset_0_-2px_0_0_var(--accent)]' : 'text-fg-muted hover:bg-bg-hover hover:text-fg'
      }`}
    >
      {label.glyph && <GlyphMark glyph={label.glyph} className="shrink-0" />}
      {label.file && <FileIcon className="size-[12px] shrink-0 text-fg-muted" /> /* W13: the extension is in the name beside it */}
      {/* E11 F2b (plan 2.5): a pin you can see, saying what it does */}
      {tab.pinned && (
        <span aria-label="Pinned" role="img" title={PINNED_HINT} className="inline-flex shrink-0 text-fg-muted">
          <PinIcon className="size-[11px]" />
        </span>
      )}
      {dirty && <DirtyMark />}{/* E5 */}
      {/* U13a: the place gives way before the title, and is drawn readable or not at all. The box is one line high and
          clips what wraps. The title keeps its width up to the whole box. The place asks the line for its whole text or
          5em, whichever is less (four characters and an ellipsis are never wider), and grows to its whole text from there;
          a line with less room wraps it out of sight, with its gap, and the title takes the room. */}
      <span className="flex h-[1lh] min-w-0 flex-wrap items-baseline gap-x-1.5 overflow-hidden">
        {tab.kind === 'file' ? (
          <FileTitle name={label.title} className={offline ? 'text-fg-faint' : ''} />
        ) : (
          <span className={`max-w-full shrink-0 truncate ${offline ? 'text-fg-faint' : ''}`}>{label.title}</span>
        )}
        {place && <small data-tab-place className="max-w-max min-w-0 grow basis-[5em] truncate text-fg-muted">{place}</small>}
      </span>
      <span ref={holderRegion} className="contents">
        {holderMark && ( // P5 O9 (Q1); the word cut (W10): the glyph, its word its name, the holder's line the tab's tip
          <small data-holder-marker role="img" aria-label={holderMark.text} className="shrink-0 text-info">
            ⌁
          </small>
        )}
      </span>
      {label.secondary && <small className="max-w-16 shrink-0 truncate text-fg-muted">{label.secondary}</small>}
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Close ${label.title}`}
        title={closeChord ? `Close tab · ${closeChord}` : 'Close tab'}
        onClick={(event) => {
          event.stopPropagation();
          void requestCloseTab(tab.id);
        }}
        className={`-mr-1 ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-active hover:text-fg ${
          active ? '' : 'invisible group-hover/tab:visible group-focus-visible/tab:visible'
        }`}
      >
        <span aria-hidden>×</span>
      </button>
    </div>
  );

  return (
    <ContextMenu.Root modal={false}>
      {/* W10 (fix round 1): the holder's line is the tab's tip and description, shown at once on the tab's own focus stop
          and after the delay on pointing at the mark. A file's tab: its full path, on pointing at the tab or its focus */}
      <Tip content={tip} description={tip} pointedWithin={holderMark ? holderRegion : undefined}>
        <ContextMenu.Trigger asChild>{element}</ContextMenu.Trigger>
      </Tip>
      <ContextMenu.Portal>
        <ContextMenu.Content data-tab-focus-owner={tab.id} className="z-50 min-w-44 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
          <TabMenuItem onSelect={() => useLayout.getState().togglePinned(tab.id)}>{tab.pinned ? 'Unpin tab' : 'Pin tab'}</TabMenuItem>
          <TabMenuItem onSelect={() => moveToOtherPane(tab.id, pane)}>Move to other pane</TabMenuItem>
          {(tab.kind === 'artifact' || tab.kind === 'file') && <ShowInPanelItem tab={tab} />}{/* UX wave U6b-1: a file's too */}
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <TabMenuItem onSelect={() => void requestCloseTab(tab.id)}>Close tab</TabMenuItem>
          <TabMenuItem onSelect={() => void closeOthers(tab.id, pane)}>Close other tabs</TabMenuItem>
          <CloseToRightItem id={tab.id} pane={pane} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

const MENU_ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint aria-disabled:text-fg-faint data-highlighted:bg-bg-hover';

// The word cut (N94): an item greyed with a reason stays in the menu's keyboard, its reason its description and its note.
function TabMenuItem({ children, onSelect, disabled = false, reason }: { children: string; onSelect(): void; disabled?: boolean; reason?: string }) {
  if (disabled && reason) return <RefusedMenuItem kit={ContextMenu} label={children} reason={reason} className={MENU_ITEM} />;
  return (
    <ContextMenu.Item onSelect={onSelect} disabled={disabled} className={MENU_ITEM}>
      {children}
    </ContextMenu.Item>
  );
}

// P3-F wave S (F16, the owner's obs 7): an artifact tab moves into the panel, the mirror of the panel record's Move to
// tab. P4-B3 (X38; its Decision Log 20, 21): through the transfer's one move, which a drag onto the panel takes too, and
// disabled with the reason that drag is refused for (the panel shown once the tab is gone has none, M5).
export const SHOW_IN_PANEL_COPY = { label: TRANSFER_COPY.moveToPanel, noPanel: TRANSFER_COPY.noPanel };

function ShowInPanelItem({ tab }: { tab: Extract<TabRef, { kind: 'artifact' | 'file' }> }) {
  const refusal = useTransferRefusal({ to: 'panel', mainTabId: tab.id });
  return (
    <TabMenuItem disabled={refusal !== null} reason={refusal ?? undefined} onSelect={() => void moveToPanel(tab.id)}>
      {SHOW_IN_PANEL_COPY.label}
    </TabMenuItem>
  );
}

function moveToOtherPane(id: string, pane: 0 | 1) {
  const layout = useLayout.getState();
  const to = pane === 0 ? 1 : 0;
  layout.moveTab(id, to, currentSet(layout.main).panes[to]?.tabs.length ?? 0);
}

// The pane's other tabs, except the pinned ones, each through its close guard.
async function closeOthers(id: string, pane: 0 | 1) {
  const others = currentSet(useLayout.getState().main).panes[pane]?.tabs.filter((t) => t.id !== id && !t.pinned) ?? [];
  for (const other of others) await requestCloseTab(other.id);
}

// U13a (A10): the pane's unpinned tabs to the right of this one, in order, each through its close guard as "Close other
// tabs" closes them; disabled when there is none.
const CLOSE_TO_RIGHT = 'Close tabs to the right';
const tabsRightOf = (main: Strip, id: string, pane: 0 | 1): TabRef[] => {
  const tabs = currentSet(main).panes[pane]?.tabs ?? [];
  const at = tabs.findIndex((t) => t.id === id);
  return at === -1 ? [] : tabs.slice(at + 1).filter((t) => !t.pinned);
};

function CloseToRightItem({ id, pane }: { id: string; pane: 0 | 1 }) {
  const none = useLayout((s) => tabsRightOf(s.main, id, pane).length === 0);
  return (
    <TabMenuItem disabled={none} onSelect={() => void closeToRight(id, pane)}>
      {CLOSE_TO_RIGHT}
    </TabMenuItem>
  );
}

async function closeToRight(id: string, pane: 0 | 1) {
  for (const right of tabsRightOf(useLayout.getState().main, id, pane)) await requestCloseTab(right.id);
}

// E5 start: a file tab with unsaved edits (E5 execution document, M2's decisions): a dot before the title and
// `data-dirty`, from the viewer store, which is already in the main chunk.
function useFileTabDirty(tab: TabRef): boolean {
  return useViewer((s) => tab.kind === 'file' && (s.entries.get(tab.id)?.dirty ?? false));
}

function DirtyMark() {
  return (
    <span role="img" aria-label={EDITOR_COPY.unsaved} className="shrink-0 text-fg">
      •
    </span>
  );
}
// E5 end

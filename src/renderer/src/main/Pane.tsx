// One pane of the main region (§5.2, D-8; residue *Split*): its tab strip over the active tab's content. A pointer
// press or focus anywhere inside makes it the focused pane, the target of ⌘1…9, ⌘\ and ⌃Tab. Only the active tab's
// content is mounted; a tab's content remounts when it becomes active again. With no tab open (W5: the Overview is no
// tab), the pane offers the Overview and a new session, once the saved layout has applied. P4-B3 (X38): while a panel
// tab is dragged, the pane's body is covered by a target that appends a record here as a main tab, the whole pane
// highlighted, and refuses (no drop cursor) what the transfer refuses.
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { TabRef, TabSet } from '@shared/ipc/schema/layout';
import { Diagnostics } from '../app/Diagnostics';
import { useSlot } from '../app/slots';
import { IconButton, MaximizeIcon, RestoreIcon, useChordHint } from '../app/IconButton';
import { createSession, focusedProject, NEW_CHAT, runAction, useActionEnabled, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { useKeyChord } from '../keymap/useKeyChord';
import { EditorHostScopeContext, useEditorHostRegistration, type EditorHostScope } from '../panel/editor-host'; // P3-G
import { EditorHeader } from '../panel/PanelHeader'; // P3-G
import { ArtifactTab } from '../library/ArtifactTab'; // P3-L
import { SessionPane } from '../session/SessionPane';
import { cardSession, expandPane } from '../shell/floating'; // P3-G; P4-B3: expandPane
import { DropOverlay } from '../shell/DropOverlay'; // P4-B3 M4
import { dropPanelRecord, useCoverState } from '../shell/transfer'; // P4-B3 M4
import { TRANSFER_COPY } from '../tools/artifacts/copy'; // P4-B3 M4
import { useLayout } from '../stores/layout';
import { currentSet, floatingPane, paneShowsSession } from '../stores/layout-model';
import { focusPaneElement, paneDomId } from './pane-dom';
import { TabStrip } from './TabStrip';
import { createPortal } from 'react-dom';
import { useChromeTabs } from './chrome-tabs';
import { ProjectsView } from '../projects/ProjectsView';
import { CustomizeView } from '../customize/CustomizeView';

type PaneIndex = 0 | 1;
const HIDDEN = { visibility: 'hidden', overflow: 'hidden' } as const;

// `column` is the pane's column in the main region's grid (MainArea), where its strip and its content are placed.
// `collapsed` (P4-B3 M1): the pane's column is at 0 px while a divider drag has armed its float; the strip and content
// stay mounted but hidden, so a disarm in the same drag brings them back as they were. M6: the hidden content keeps the
// width it was last laid out at, overflowing its 0 px column over the other pane (the left pane from its start, the right
// from its end), so nothing in it reflows at no width: a transcript re-measured at 0 px scrolled to other rows, and the
// carry its float records named a row the reader never saw.
export function Pane({ index, split, column, collapsed = false }: { index: PaneIndex; split: boolean; column: number; collapsed?: boolean }) {
  const chrome = useChromeTabs((s) => s.panes[index]);
  const pane = useLayout((s) => currentSet(s.main).panes[index]);
  const hydrated = useLayout((s) => s.hydrated);
  const cover = useCoverState('main'); // P4-B3 (Z5): a panel record dragged here appends to this pane
  const idPrefix = useId();
  const element = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null); // P4-B3 M6
  const laidOut = useLaidOutWidth(body, collapsed); // P4-B3 M6
  // ⌃Tab and ⌃⇧Tab cycle the pane that owns the focused element (renderer sink, pane scope: a tab or a card may take
  // it, text entry, key sinks and buttons may not). Focus follows to the newly active tab, since the content that held
  // it may have unmounted with its tab.
  const cycle = (delta: 1 | -1) => {
    useLayout.getState().focusPane(index);
    useLayout.getState().cycleTab(delta);
    requestAnimationFrame(() => focusPaneElement(index));
  };
  useKeyChord('tab.next', () => cycle(1), { within: element });
  useKeyChord('tab.previous', () => cycle(-1), { within: element });
  if (!pane) return null;
  const activeIndex = pane.tabs.findIndex((t) => t.id === pane.activeTabId);
  const active = pane.tabs[activeIndex] ?? null;

  const focus = () => {
    if (currentSet(useLayout.getState().main).focusedPane !== index) useLayout.getState().focusPane(index);
  };

  return (
    <section
      ref={element}
      id={paneDomId(index)}
      aria-label={split ? (index === 0 ? 'Left pane' : 'Right pane') : 'Pane'}
      data-pane={index}
      onPointerDownCapture={focus}
      onFocusCapture={focus}
      className="contents"
    >
      {chrome ? createPortal(
        <div data-pane-strip data-chrome-pane={index} className="h-full min-w-0 flex-1" style={collapsed ? { display: 'none' } : undefined}>
          <TabStrip pane={index} split={split} idPrefix={idPrefix} />
        </div>, chrome
      ) : <div data-pane-strip className="h-(--toolbar-h) min-w-0" style={{ gridRow: 1, gridColumn: column, ...(collapsed ? HIDDEN : null) }}>
        <TabStrip pane={index} split={split} idPrefix={idPrefix} />
      </div>}
      <div
        ref={body}
        role="tabpanel"
        aria-labelledby={active ? `${idPrefix}-tab-${activeIndex}` : undefined}
        aria-label={active || !hydrated ? undefined : 'No open tabs'}
        aria-busy={active || hydrated ? undefined : true}
        className="relative min-h-0 min-w-0 overflow-hidden"
        style={{ gridRow: 3, gridColumn: column, ...(collapsed ? collapsedBody(index, laidOut) : null) }}
      >
        {/* Until the saved layout applies, an empty pane is only not yet restored: it draws nothing rather than "No open
            tabs" (a relaunch flashed it). A tab opened before then draws at once. */}
        {active ? <TabBody key={active.id} tab={active} paneIndex={index} /> : hydrated && <EmptyPane />}
        {cover !== null && !collapsed && (
          <DropOverlay data-pane-drop-target={index} accepts={cover === 'accepted'} label={TRANSFER_COPY.moveToTab} onDrop={(event) => dropPanelRecord(event, { pane: index })} />
        )}
      </div>
    </section>
  );
}

// P3-G (§D2.4, X32): the tab's body renders in its main-tab scope, and a body that registers there gets the pane
// header's row above it (no region controls). The wrapper is always drawn, so a registration arriving never remounts the
// body; with none, the row is absent and the content fills the panel as before.
function TabBody({ tab, paneIndex }: { tab: TabRef; paneIndex: PaneIndex }) {
  const scope: EditorHostScope = { surface: 'main', tabId: tab.id };
  return (
    <EditorHostScopeContext.Provider value={scope}>
      <div className="flex h-full min-h-0 flex-col">
        <TabHeader scope={scope} paneIndex={paneIndex} />
        <div className="relative min-h-0 flex-1">
          <TabContent tab={tab} paneIndex={paneIndex} />
        </div>
      </div>
    </EditorHostScopeContext.Provider>
  );
}

function TabHeader({ scope, paneIndex }: { scope: EditorHostScope; paneIndex: PaneIndex }) {
  const registration = useEditorHostRegistration(scope);
  const expand = useLayout((s) => expandOf(currentSet(s.main), paneIndex));
  const controls = expand && <ExpandButton expand={expand} paneIndex={paneIndex} />;
  return registration && <EditorHeader title={registration.title} registration={registration} scope={scope} controls={controls} />;
}

// P4-B3 (X32 amendment; its Decision Log 12): the pane header's Expand, drawn by the main surface for every editor that
// registers (no editor registers it). Shown while the other pane shows a session ("Expand pane": the session floats into
// the split's card and this pane takes the area), or pressed while the other pane floats ("Restore split"); else absent.
// P4-B3x: Expand also folds the right panel, and Restore split opens it again (`expandPane`).
type Expand = 'expand' | 'restore';
function expandOf(set: TabSet, pane: PaneIndex): Expand | null {
  if (set.panes.length !== 2) return null;
  const other: PaneIndex = pane === 0 ? 1 : 0;
  const floated = floatingPane(set);
  if (floated === other) return 'restore';
  return floated === null && paneShowsSession(set, other) ? 'expand' : null;
}

function ExpandButton({ expand, paneIndex }: { expand: Expand; paneIndex: PaneIndex }) {
  return (
    <IconButton label={expand === 'restore' ? 'Restore split' : 'Expand pane'} action="main.expandArtifactPane" pressed={expand === 'restore'} onClick={() => expandPane(paneIndex)}>
      {expand === 'restore' ? <RestoreIcon /> : <MaximizeIcon />}
    </IconButton>
  );
}

function TabContent({ tab, paneIndex }: { tab: TabRef; paneIndex: PaneIndex }) {
  switch (tab.kind) {
    case 'session':
      return <SessionTab tab={tab} paneIndex={paneIndex} />;
    case 'agent':
      return <AgentTab tab={tab} paneIndex={paneIndex} />;
    case 'file':
      return <FileTab tab={tab} />;
    case 'diff':
      return <DiffTab tab={tab} />;
    case 'diagnostics':
      return (
        <div className="h-full overflow-auto">
          <Diagnostics />
        </div>
      );
    case 'settings':
      return <SettingsTab section={tab.section} />;
    case 'projects':
      return <ProjectsView />;
    case 'customize':
      return <CustomizeView section={tab.section} />;
    case 'artifacts': // P3-G (§D5)
      return <ArtifactsTab />;
    case 'artifact': // P3-L: one artifact in its kind's editor
      return <ArtifactTab tab={tab} />;
    case 'browser': // E4a
      return <BrowserTab tab={tab} />;
  }
}

// P3-G (§D1.4): while the panel floats, the floating card is the only mount of the session it draws (one composer per
// session, one focus target); the main region is at 0 px and inert then, so nothing is lost on screen. Held through the
// pill too, so closing and reopening the card does not remount the pane behind it. (P4-B3: the split's card draws a
// pane's session the main area no longer renders, so this holds there with nothing to hide.)
function SessionTab({ tab, paneIndex }: { tab: Extract<TabRef, { kind: 'session' }>; paneIndex: PaneIndex }) {
  const inCard = useLayout((s) => cardSession(s) === tab.appSessionId);
  return inCard ? <div data-session-in-card className="h-full" /> : <SessionPane appSessionId={tab.appSessionId} paneIndex={paneIndex} />;
}

const TEXT_BUTTON =
  'rounded-sm border border-border-strong px-2.5 py-1 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:border-border disabled:text-fg-faint disabled:hover:bg-transparent';

function EmptyPane() {
  const canCreate = useSessionCreatorRegistered();
  const canOverview = useActionEnabled('tab.overview');
  const chord = useChordHint('tab.overview');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-ui text-fg-muted">
      <p className="m-0">No open tabs</p>
      <div className="flex gap-2">
        <button type="button" disabled={!canOverview} onClick={() => runAction('tab.overview')} className={TEXT_BUTTON}>
          {chord ? `Overview ${chord}` : 'Overview'}
        </button>
        <button type="button" disabled={!canCreate} title={canCreate ? undefined : 'Not available here'} onClick={() => void createSession(focusedProject())} className={TEXT_BUTTON}>
          {NEW_CHAT}
        </button>
      </div>
    </div>
  );
}

function SettingsTab({ section }: { section: Extract<TabRef, { kind: 'settings' }>['section'] }) {
  const Slot = useSlot('settingsTab');
  // eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render
  return <Slot section={section} />;
}

// P3-G (§D5): the Artifacts library, the slot P3-L registers (a placeholder until then).
function ArtifactsTab() {
  const Slot = useSlot('artifactsLibrary');
  // eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render
  return <Slot />;
}

// A child agent's transcript in the main area (C6's child variant): the transcript slot alone, since nobody types to a
// child.
function AgentTab({ tab, paneIndex }: { tab: Extract<TabRef, { kind: 'agent' }>; paneIndex: PaneIndex }) {
  const Transcript = useSlot('transcript');
  // eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render
  return <Transcript appSessionId={tab.appSessionId} agentId={tab.agentId} paneIndex={paneIndex} />;
}

function FileTab({ tab }: { tab: Extract<TabRef, { kind: 'file' }> }) {
  const Slot = useSlot('fileTab');
  // eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render
  return <Slot tab={tab} />;
}

function DiffTab({ tab }: { tab: Extract<TabRef, { kind: 'diff' }> }) {
  const Slot = useSlot('diffTab');
  // eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render
  return <Slot tab={tab} />;
}

// E4a start: one of a session's browser tabs (X14), the slot E4a registers.
function BrowserTab({ tab }: { tab: Extract<TabRef, { kind: 'browser' }> }) {
  const Slot = useSlot('browserTab');
  // eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render
  return <Slot tab={tab} />;
}
// E4a end

// P4-B3 M6: the body hidden in its 0 px column at the width it was last laid out at, from the column's start (the left
// pane) or its end (the right pane), so it overflows over the other pane, invisible and never hit.
function collapsedBody(index: PaneIndex, width: number | null): CSSProperties {
  return width === null ? HIDDEN : { ...HIDDEN, width, justifySelf: index === 0 ? 'start' : 'end' };
}

// The element's width while the pane is not collapsed, kept as the last one measured above 0 once it collapses.
function useLaidOutWidth(ref: RefObject<HTMLElement | null>, collapsed: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || collapsed || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, collapsed]);
  return width;
}

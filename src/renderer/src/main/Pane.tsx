// One pane of the main region (§5.2, D-8; residue *Split*): its tab strip over the active tab's content. A pointer
// press or focus anywhere inside makes it the focused pane, the target of ⌘1…9, ⌘\ and ⌃Tab. Only the active tab's
// content is mounted; a tab's content remounts when it becomes active again. With no tab open (W5: the Overview is no
// tab), the pane offers the Overview and a new session.
import { useId, useRef } from 'react';
import type { TabRef } from '@shared/ipc/schema/layout';
import { Diagnostics } from '../app/Diagnostics';
import { useSlot } from '../app/slots';
import { useChordHint } from '../app/IconButton';
import { createSession, focusedProject, NEW_CHAT, runAction, useActionEnabled, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { useKeyChord } from '../keymap/useKeyChord';
import { SessionPane } from '../session/SessionPane';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { focusPaneElement, paneDomId } from './pane-dom';
import { TabStrip } from './TabStrip';

type PaneIndex = 0 | 1;

// `column` is the pane's column in the main region's grid (MainArea), where its strip and its content are placed.
export function Pane({ index, split, column }: { index: PaneIndex; split: boolean; column: number }) {
  const pane = useLayout((s) => currentSet(s.main).panes[index]);
  const idPrefix = useId();
  const element = useRef<HTMLElement>(null);
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
      <div data-pane-strip className="min-w-0" style={{ gridRow: 1, gridColumn: column }}>
        <TabStrip pane={index} split={split} idPrefix={idPrefix} />
      </div>
      <div
        role="tabpanel"
        aria-labelledby={active ? `${idPrefix}-tab-${activeIndex}` : undefined}
        aria-label={active ? undefined : 'No open tabs'}
        className="relative min-h-0 min-w-0 overflow-hidden"
        style={{ gridRow: 3, gridColumn: column }}
      >
        {active ? <TabContent key={active.id} tab={active} paneIndex={index} /> : <EmptyPane />}
      </div>
    </section>
  );
}

function TabContent({ tab, paneIndex }: { tab: TabRef; paneIndex: PaneIndex }) {
  switch (tab.kind) {
    case 'session':
      return <SessionPane appSessionId={tab.appSessionId} paneIndex={paneIndex} />;
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
    case 'deliverable': // E2
      return <DeliverableTab tab={tab} />;
  }
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

// E2: a deliverable's viewer (X14), the slot E2 registers.
function DeliverableTab({ tab }: { tab: Extract<TabRef, { kind: 'deliverable' }> }) {
  const Slot = useSlot('deliverableTab');
  // eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render
  return <Slot tab={tab} />;
}

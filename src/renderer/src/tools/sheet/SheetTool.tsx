// The side sheet (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §H; S12; the composite's §8.1): a
// session's question sheet as a tool of the side column (the charter's X5), one per session, not pinnable, offered from
// "+", titled "Sheet" with the count of its open questions beside it. It draws the composite's X5 `SessionSheet` over
// the window's store (the model while it is visible, the memory every mount of the session shares) and the app's host;
// with no record of the session on this Mac, the empty sheet.
//
// O-17, kept: nothing but a person's act adds or activates it. `openSheet` is the one way in (a row's Open, a line of
// the "Waiting for you" card, a notice's button, Needs you, all through the transcript actions' `openSheet`), and "+".
// A record that appears, a question added and a `sheet.changed` leave the side column as it was.
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import { isAddress, machineOf } from '@shared/machine/address';
import { Icon } from '../../app/IconButton';
import { ipc } from '../../ipc/client';
import { panelHost, setTitle, usePanelHost } from '../../panel/host';
import type { PanelTool, PanelToolContext, PanelToolInit } from '../../panel/tool';
import { sideGroups, surfaceSession } from '../../panel/surface-model';
import { useLayout } from '../../stores/layout';
import { SessionSheet, SHEET_WORDS } from '../../sheet';
import { selectSheetSession, useSheets } from '../../stores/sheet';
import { useSessionSheet } from './use-session-sheet';

export const SHEET_TOOL_ID = 'sheet';

export interface SheetToolParams {
  at?: string; // a question's id: the sheet shows its card and puts the keyboard on it
}

// The last question asked for, how many asks so far, and whether it was used: an ask is used once for the tab's
// lifetime, not once a mount, so the body mounting again when the tab is shown again moves nothing.
type Focus = { id: string; request: number; used: boolean } | null;

export interface SheetToolState {
  appSessionId: AppSessionId | null;
  focus: StoreApi<Focus>; // the last question asked for, pending until its card exists, then used
  stop(): void;
}

function SheetIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="3" y="2.5" width="10" height="11" rx="1.5" />
      <path d="M5.75 6.25a1.5 1.5 0 1 1 2.1 1.4c-.4.2-.6.5-.6.9v.2M7.25 10.75v.01" />
    </Icon>
  );
}

// `at` as an add gave it; a restored tab has no params (the tool persists none)
const ask = (focus: StoreApi<Focus>, at: unknown) => {
  if (typeof at === 'string') focus.setState({ id: at, request: (focus.getState()?.request ?? 0) + 1, used: false }, true);
};

// The tab's suffix, the count of the session's open questions (none at zero), kept while the tab lives, shown or not.
function followCount(appSessionId: AppSessionId | null, instanceId: string): () => void {
  let told: string | null | undefined;
  const tell = () => {
    const state = useSheets.getState();
    const session = appSessionId === null ? null : selectSheetSession(state, appSessionId);
    const open = session === null ? 0 : (state.summaries.get(session)?.open ?? 0);
    const next = open > 0 ? String(open) : null;
    if (next === told) return;
    told = next;
    setTitle(instanceId, next);
  };
  queueMicrotask(tell); // the tab is the host's once createState returns
  return useSheets.subscribe(tell);
}

const SCROLL = 'flex h-full min-h-0 flex-col bg-bg text-ui text-fg';

function Centered({ words }: { words: string }) {
  return <p className="m-0 flex flex-1 items-center justify-center p-6 text-center text-fg-muted">{words}</p>;
}

// Whether the tab is in view now: the side column shows this session (the scope the panel region draws, which another
// session's in front changes while this one's groups stay saved) and the tab is the shown tab of one of its groups.
function tabInView(appSessionId: AppSessionId, tabId: string): boolean {
  const layout = useLayout.getState();
  if (surfaceSession(layout) !== appSessionId) return false;
  const groups = sideGroups(layout, appSessionId);
  return !groups.hidden && (groups.upper.shown?.id === tabId || groups.lower?.shown?.id === tabId);
}

function SheetBody({ appSessionId, tabId, state, visible }: { appSessionId: AppSessionId; tabId: string; state: SheetToolState; visible: boolean }) {
  const sheet = useSessionSheet(appSessionId, visible);
  const focus = useStore(state.focus);
  // An ask is handed to the sheet while the tab shows, and the sheet puts the keyboard on its card once the card is
  // listed. It is used for the tab's lifetime when the body goes with the tab out of view (another tab shown, the column
  // hidden, the tab closed), so the tab shown again moves nothing; a body the host draws again while the tab stays in
  // view takes it again, as does one that came before the card was listed.
  const pending = visible && focus !== null && !focus.used ? focus : null;
  const landed = useRef<number | null>(null);
  const listed = pending !== null && sheet.shown === 'sheet' && sheet.model.open.some((question) => question.id === pending.id);
  useEffect(() => {
    if (listed) landed.current = pending.request;
  }, [listed, pending]);
  useEffect(
    () => () => {
      const request = landed.current;
      if (request === null || tabInView(appSessionId, tabId)) return;
      state.focus.setState((now) => (now !== null && now.request === request ? { ...now, used: true } : now), true);
    },
    [appSessionId, tabId, state.focus],
  );
  if (sheet.shown === 'sheet') {
    return <SessionSheet model={sheet.model} memory={sheet.memory} onMemory={sheet.onMemory} host={sheet.host} focus={pending} unavailable={sheet.unavailable} />;
  }
  if (sheet.shown === 'reading') return null;
  return <Centered words={sheet.shown === 'unreadable' ? SHEET_WORDS.unreadable : SHEET_WORDS.empty} />;
}

function SheetToolBody({ state, ctx }: { state: SheetToolState; ctx: PanelToolContext }) {
  return (
    <div className={SCROLL} data-sheet-tool="">
      {ctx.appSessionId === null ? <Centered words={SHEET_WORDS.empty} /> : <SheetBody appSessionId={ctx.appSessionId} tabId={ctx.editorHost.tabId} state={state} visible={ctx.visible} />}
    </div>
  );
}

export const sheetTool: PanelTool<SheetToolState, SheetToolParams> = {
  id: SHEET_TOOL_ID,
  title: SHEET_WORDS.tab,
  icon: SheetIcon,
  pinnable: false,
  multiInstance: false,
  createState({ appSessionId, instanceId, params }: PanelToolInit<SheetToolParams>) {
    const focus = createStore<Focus>(() => null);
    ask(focus, params?.at);
    return { appSessionId, focus, stop: followCount(appSessionId, instanceId) };
  },
  open(state, params) {
    ask(state.focus, params?.at);
  },
  beforeClose: async () => true, // the drafts are the window's store's, kept per session: closing loses nothing
  dispose: (state) => state.stop(),
  render: SheetToolBody,
};

/**
 * The session's sheet in the side column, at `questionId` when one is named: the app's `openSheet`. Another machine's
 * session has no sheet this window can read until C6, so its open shows nothing more than the session it already shows.
 */
export function openSheet(appSessionId: AppSessionId, questionId: string | null): void {
  if (!usePanelHost.getState().tools.has(SHEET_TOOL_ID)) return;
  if (isAddress(appSessionId) && machineOf(appSessionId) !== ipc.localMachine) return;
  panelHost.addTool<SheetToolParams>(SHEET_TOOL_ID, { appSessionId, params: questionId === null ? {} : { at: questionId }, activate: true });
}

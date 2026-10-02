// The Terminal tool (C9 Residue *Terminal tool and X5*): an X5 `PanelTool` whose state is the identity of a terminal in
// the registry (plus its close confirmation), so the shell, its emulator and its scrollback outlive every tab switch,
// panel close and session switch under a pin; and `openTerminal`, C10's entry point for "attach in a terminal tab".
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { PtyInfo } from '@shared/ipc/schema';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { panelHost } from '../../panel/host';
import type { PanelTool, PanelToolInit } from '../../panel/tool';
import { terminals, type Adopting, type TerminalId } from '../../terminal/registry';
import { sessionDirectory, TerminalIcon, TerminalView } from './TerminalView';

export const TERMINAL_TOOL_ID = 'terminal';

export interface TerminalParams {
  cwd?: string; // default: the session's worktree path, else its directory
  command?: string; // typed into the first shell followed by a newline (C10's attach path)
  owner?: AppSessionId; // W13: the label a pinned tab with no session files its shell under (Settings › Engine's update)
}

// The close confirmation lives beside the terminal's identity (the host may ask to close a tab that is not shown);
// `confirmed` is the owner's "Close" in that bar, after which the host's second `beforeClose` lets the close through;
// `closeError` is why the last close could not end the shell (the tab stays until one does).
export interface TerminalTabUi {
  confirmClose: boolean;
  process: string | null; // what runs in the foreground; null when the host could not say
  confirmed: boolean;
  closeError: string | null;
  terminalId: TerminalId | null; // null until the tab has a session and a directory to start in
}

export interface TerminalTabState {
  readonly terminalId: TerminalId | null; // the registry's terminal, once started (reads `ui`)
  readonly ui: StoreApi<TerminalTabUi>;
  readonly instanceId: string; // the terminal's label, which is how a reloaded page re-adopts it
  params: TerminalParams;
  owner: AppSessionId | null; // the session the tab was opened for, when known
  focusSeen: number; // the last X5 `focusRequest` the view acted on or used up (the counter outlives the view's mounts)
}

// The states the host has disposed (`dispose` below); a pending tab's retry checks it.
const disposed = new WeakSet<TerminalTabState>();

// Re-adoption after a renderer reload (C8a's ruling, 2026-09-29): the page starts it once, before any tab could want a
// shell, so a restored tab reattaches to the pty still running under its label (the checkpoint reattach) instead of
// starting a second shell. The panel host restores tabs when the layout hydrates, which C5 drives, so the order is
// enforced here rather than by starting adoption first. The gate is per tab and bounded: every tab waits for `pty.list`,
// then only a tab whose label the host listed waits, for that pty's attach. A wait that outlasts `ADOPTION_TIMEOUT_MS`
// falls through to a new shell. No shell is killed for being slow: a pty whose attach ran out of time is released (its
// handle let go, the pty left running) and never taken by a tab, and an unadopted shell is adopted at the next reload.
// A list that answers late is taken as it comes: a pty whose label already has a newer shell is released the same way,
// any other stays adoptable by a tab still waiting for its terminal. A pty the host reports gone (a failed attach) is
// dropped by the registry.
//
// Above main's request timeout (10 s, `REQUEST_TIMEOUT_MS` in `main/hosts/supervisor.ts`): a stuck `pty.list` or
// `pty.attach` is answered by main's typed timeout, and this bound covers only a renderer whose answer never comes.
export const ADOPTION_TIMEOUT_MS = 12_000;
let adoption: Promise<TerminalId[]> | null = null;
let listing: Promise<void> | null = null; // answers when `pty.list` has, or its wait ran out
// The attaches still waited for, by handle (two ptys may carry one label); null while listing.
let attaching: Map<TerminalId, { label: string; wait: Promise<TerminalId | null> }> | null = null;
const abandoned = new Set<TerminalId>(); // re-adopted handles released, never taken by a tab
const timers = new Set<ReturnType<typeof setTimeout>>();
let generation = 0; // tests reset the page's adoption; an earlier one's answers are then ignored

function bounded<T>(work: Promise<T>, expired: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      resolve(expired());
    }, ADOPTION_TIMEOUT_MS);
    timers.add(timer);
    void work.then((value) => {
      clearTimeout(timer);
      timers.delete(timer);
      resolve(value);
    });
  });
}

// Lets a re-adopted pty go without ending it: its handle is released, the next reload adopts it.
function leave(id: TerminalId, why: string): void {
  abandoned.add(id);
  console.error(`[terminal] ${why}; the shell is left running for the next reload, and its tab opens a new shell`);
  terminals.release(id);
}

// Waits, bounded, for each adopted pty's attach. A late entry whose label already has another live shell is left at once.
function track(pending: NonNullable<typeof attaching>, adopting: Adopting[], late: boolean): Promise<TerminalId | null>[] {
  const waits: Promise<TerminalId | null>[] = [];
  for (const { label, id, attached } of adopting) {
    if (late && terminals.list().some((info) => info.label === label && info.id !== id && !abandoned.has(info.id))) {
      leave(id, `pty.list answered late with ${label}, which has a new shell`);
      continue;
    }
    const wait = bounded(attached, () => {
      leave(id, `pty.attach for ${label} did not answer within ${ADOPTION_TIMEOUT_MS} ms`);
      return null;
    });
    pending.set(id, { label, wait });
    void wait.then(() => pending.delete(id));
    waits.push(wait);
  }
  return waits;
}

export function adoptTerminals(accept: (info: PtyInfo) => boolean = () => true): Promise<TerminalId[]> {
  if (adoption) return adoption;
  const page = ++generation;
  let listExpired = false;
  let inTime!: (adopting: Adopting[]) => void;
  const listed = new Promise<Adopting[]>((resolve) => (inTime = resolve));
  const heard = (adopting: Adopting[]) => {
    if (!listExpired) inTime(adopting);
    else if (page === generation && attaching) track(attaching, adopting, true);
  };
  terminals.adopt(accept, heard).catch((error: unknown) => {
    console.error('[terminal] re-adoption failed; tabs open new shells', error);
    heard([]);
  });
  const expireList = (): Adopting[] => {
    listExpired = true;
    console.error(`[terminal] pty.list did not answer within ${ADOPTION_TIMEOUT_MS} ms; tabs open new shells`);
    return [];
  };
  const waits = bounded(listed, expireList).then((adopting) => {
    if (page !== generation) return [];
    const pending: NonNullable<typeof attaching> = new Map();
    attaching = pending;
    return track(pending, adopting, false);
  });
  listing = waits.then(() => {});
  adoption = waits.then((all) => Promise.all(all)).then((ids) => ids.filter((id): id is TerminalId => id !== null));
  return adoption;
}
// Tests: forget the page's adoption.
export function resetTerminalAdoption(): void {
  generation++;
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  abandoned.clear();
  adoption = listing = attaching = null;
}

// What a tab under `label` still waits for before it may open a shell: nothing once every pty listed under its label
// has attached or run out of time, or when the host listed none.
function adoptionWait(label: string): Promise<unknown> | null {
  if (!listing) return null;
  if (!attaching) return listing;
  const waits = [...attaching.values()].filter((entry) => entry.label === label).map((entry) => entry.wait);
  return waits.length > 0 ? Promise.all(waits) : null;
}

// Starts the tab's terminal if it has none: the one the registry re-adopted under this tab's label after a reload, or
// a new one in `params.cwd`, else the session's directory. A tab with no session yet (X5 allows a pinned tab to be
// restored while Overview is shown) stays pending; its view asks for a session and calls this again when one is shown.
// While the page's adoption may still hand it a pty (`adoptionWait`), the tab also stays pending and is retried after.
export function ensureTerminal(state: TerminalTabState, shown: { appSessionId: AppSessionId | null; session: SessionRecord | null }): TerminalId | null {
  // A tab disposed while it waited (closed, reconciled or unregistered before the adoption answered) opens nothing, and
  // a shell the adoption re-created under its label is released, so no shell is left running with no tab. A later call
  // on the same disposed state (a queued retry, a view re-rendering before unmount) repeats this: the lookup finds the
  // label gone or the close already under way, and re-closing is idempotent; expected, not a leak.
  if (disposed.has(state)) {
    const orphan = terminals.list().find((info) => info.label === state.instanceId);
    if (orphan) terminals.close(orphan.id).catch((error: unknown) => console.error(`[terminal] could not end ${orphan.id} of a closed tab`, error));
    return null;
  }
  const current = state.ui.getState().terminalId;
  if (current) return current;
  const wait = adoptionWait(state.instanceId);
  if (wait) {
    void wait.then(() => ensureTerminal(state, shown));
    return null;
  }
  const adopted = terminals.list().find((info) => info.label === state.instanceId && !abandoned.has(info.id));
  const owner = state.owner ?? shown.appSessionId ?? shown.session?.appId ?? null;
  const cwd = state.params.cwd ?? (shown.session ? sessionDirectory(shown.session) : undefined);
  let terminalId: TerminalId | null = adopted?.id ?? null;
  if (!terminalId && owner && cwd) {
    const { command } = state.params;
    terminalId = terminals.open({ appSessionId: owner, label: state.instanceId, cwd, ...(command ? { command } : {}) });
  }
  if (terminalId) state.ui.setState({ terminalId });
  return terminalId;
}

// Whether X5's `focusRequest` counter carries a request the tab has not yet acted on or used up; marks it seen.
export function takeFocusRequest(state: TerminalTabState, request: number): boolean {
  if (request <= state.focusSeen) return false;
  state.focusSeen = request;
  return true;
}

function createState({ appSessionId, session, instanceId, params }: PanelToolInit<TerminalParams>): TerminalTabState {
  const ui = createStore<TerminalTabUi>()(() => ({ confirmClose: false, process: null, confirmed: false, closeError: null, terminalId: null }));
  const state: TerminalTabState = {
    get terminalId() {
      return ui.getState().terminalId;
    },
    ui,
    instanceId,
    params: { ...params },
    owner: appSessionId ?? session?.appId ?? params?.owner ?? null, // a restored tab has no params
    focusSeen: 0,
  };
  ensureTerminal(state, { appSessionId, session });
  return state;
}

// New parameters for a tab (X5's re-targeting); a tab still waiting for its terminal starts it with them.
function open(state: TerminalTabState, params: TerminalParams): void {
  if (state.terminalId) return;
  state.params = { ...state.params, ...params };
  ensureTerminal(state, { appSessionId: null, session: null });
}

// A running terminal asks before it closes when a program other than the shell is in the foreground, and when the
// host cannot say (fail closed). Otherwise, or once the owner confirmed, the close happens here: the shell is killed
// and the handle disposed before the host may remove the tab, so a kill that fails keeps the tab with the reason
// instead of leaving a shell running behind no tab.
async function beforeClose(state: TerminalTabState): Promise<boolean> {
  const { confirmed, terminalId } = state.ui.getState();
  if (!terminalId) return true; // never started: nothing runs
  if (!confirmed && terminals.get(terminalId)?.info.status === 'running') {
    let foreground: { process: string | null; busy: boolean };
    try {
      foreground = await terminals.foreground(terminalId);
    } catch {
      foreground = { process: null, busy: true };
    }
    if (foreground.busy) {
      state.ui.setState({ confirmClose: true, process: foreground.process, closeError: null });
      return false;
    }
  }
  try {
    await terminals.close(terminalId);
  } catch (error) {
    state.ui.setState({ closeError: error instanceof Error ? error.message : String(error) });
    return false;
  }
  state.ui.setState({ closeError: null });
  return true;
}

// The backstop: a host may dispose a tab without asking (C8a removes a deleted session's tabs without `beforeClose`), so
// a terminal still in the registry is ended here, fire-and-forget, the failure only logged since no tab is left to show
// it. After a completed `beforeClose` the registry no longer has the terminal and nothing is killed; a second dispose
// of the same state does nothing. The owner's own close keeps `beforeClose`'s contract (ask when busy, veto a failed kill).
function dispose(state: TerminalTabState): void {
  if (disposed.has(state)) return;
  disposed.add(state);
  const { terminalId } = state.ui.getState();
  state.ui.setState({ confirmClose: false, process: null, confirmed: false, closeError: null });
  if (!terminalId || !terminals.get(terminalId)) return;
  terminals.close(terminalId).catch((error: unknown) => console.error(`[terminal] could not end ${terminalId} on dispose`, error));
}

export const terminalTool: PanelTool<TerminalTabState, TerminalParams> = {
  id: TERMINAL_TOOL_ID,
  title: 'Terminal',
  icon: TerminalIcon,
  pinnable: true,
  multiInstance: true,
  createState,
  open,
  beforeClose,
  dispose,
  render: TerminalView,
};

// C10's "attach in a terminal tab": a new Terminal tab in `cwd` whose shell runs `command` first. Returns the tab id.
export function openTerminal({ appSessionId, cwd, command }: { appSessionId: AppSessionId; cwd: string; command?: string }): string {
  return panelHost.addTool<TerminalParams>(TERMINAL_TOOL_ID, { appSessionId, params: { cwd, ...(command ? { command } : {}) } });
}

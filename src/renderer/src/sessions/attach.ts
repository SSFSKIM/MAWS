// "Attach in a terminal tab" (C10 execution document, Interfaces "Session service", Attach; M5): C9's Terminal tool
// running the engine's own `claude attach <short>` for a background job, through the installed binary (W13). The
// holder notice, the row menu and the Attach of a `held` toast all come here.
//
// The job is read fresh (`fs.holders`, as main's guards read it): the id and the directory it runs in come from the
// registry record, which for a `--bg` job is the job's own directory (a job may run in a worktree); the session's
// directory stands in when the registry does not say. A `held` answer names the job before the registry may have it
// (the engine's own refusal wins a race MAWS's read lost), so its job and command are used when the read finds none.
//
// One attach tab per job. The tab an attach opened is remembered by (session, job) in the layout key
// `sessions.attachTabs`, because a reload or a reopened window keeps the tab and its shell (C9 re-adopts the pty under
// the tab's id, its label) while the Terminal tab's own params are not persisted. A second Attach goes to that tab:
// while `claude attach` (or anything else) holds the terminal it only shows the tab; at the idle shell (the owner left
// the attach with the TUI's key) it runs the attach again there. A listed tab whose terminal the page has not re-adopted
// or started yet (after a reload, or after an app restart, when the tab comes back with a fresh shell) is shown, and
// the same Attach waits once for its terminal to run, then decides as for a running one. A tab that is gone, or whose
// shell has ended, gives way to a new one.
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { AttachTabsSchema, type AttachTab } from '@shared/ipc/schema/layout';
import { attachCommand } from '@shared/sessions/attach';
import { ipc } from '../ipc/client';
import { panelHost, shownSession } from '../panel/host';
import { useLayout } from '../stores/layout';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { terminals, type TerminalId } from '../terminal/registry';
import { openTerminal } from '../tools/terminal';
import { toastHeld } from './holder-words';

export const ATTACH_TABS_KEY = 'sessions.attachTabs';

export interface KnownJob {
  jobId: string;
  command: string;
}
export type AttachResult = { ok: true; tabId: string; how: 'opened' | 'shown' | 'rerun' } | { ok: false; error: string };

const inFlight = new Map<AppSessionId, Promise<AttachResult>>();

// ---- the remembered tabs -----------------------------------------------------------------------------------------

let remembered: AttachTab[] | null = null; // the key as last read or written; never a failed read
let reading: Promise<AttachTab[] | null> | null = null;

// The remembered tabs, or null when main could not read the key (not the same as "none": nothing is written over it).
function rememberedTabs(): Promise<AttachTab[] | null> {
  if (remembered !== null) return Promise.resolve(remembered);
  reading ??= ipc.invoke('layout.get', { key: ATTACH_TABS_KEY }).then((result) => {
    reading = null;
    if (!result.ok) {
      console.error(`[sessions] layout.get ${ATTACH_TABS_KEY} failed`, result.error);
      return null;
    }
    const parsed = result.value.value === null ? null : AttachTabsSchema.safeParse(result.value.value);
    if (parsed && !parsed.success) console.warn(`[sessions] ${ATTACH_TABS_KEY} is not a valid value; no attach tabs remembered`);
    remembered = parsed?.success ? parsed.data.tabs : [];
    return remembered;
  });
  return reading;
}

// Whether the layout still lists the tab: the session's own panel list, or the pins.
const tabListed = (tabId: string, appSessionId: AppSessionId): boolean =>
  useLayout.getState().panelTabsOf(appSessionId).some((t) => t.id === tabId) || useLayout.getState().panelPinned.some((t) => t.id === tabId);

// Records the job's tab, dropping every entry whose tab the layout no longer lists, and writes the key. Writes run one
// after another (each reads what the one before wrote), so two Attaches at once both keep their tab; a key main
// could not read is left as it is.
let writes: Promise<void> = Promise.resolve();
function remember(entry: AttachTab): Promise<void> {
  const run = writes.then(async () => {
    const current = await rememberedTabs();
    if (current === null) return; // logged by the read
    const tabs = [...current.filter((t) => (t.appSessionId !== entry.appSessionId || t.jobId !== entry.jobId) && tabListed(t.tabId, t.appSessionId as AppSessionId)), entry];
    remembered = tabs;
    const written = await ipc.invoke('layout.set', { key: ATTACH_TABS_KEY, value: { version: 1, tabs } });
    if (!written.ok) console.error(`[sessions] layout.set ${ATTACH_TABS_KEY} failed`, written.error);
  });
  writes = run.catch(() => {});
  return run;
}

// Tests: the page's memory as a reload leaves it (the key is read again on the next Attach).
export function forgetAttachTabs(): void {
  remembered = null;
  reading = null;
}

// ---- the tab's state ---------------------------------------------------------------------------------------------

// What the job's remembered tab holds: nothing to reuse (the layout no longer lists the tab, or its shell ended), a
// terminal not there yet (a listed tab whose shell the page has not started or re-adopted, as just after a reload),
// or a running terminal.
type TabState = { kind: 'gone' } | { kind: 'pending' } | { kind: 'running'; terminalId: TerminalId };

function tabState(tabId: string, appSessionId: AppSessionId): TabState {
  if (!tabListed(tabId, appSessionId)) return { kind: 'gone' };
  const terminal = terminals.list().find((info) => info.label === tabId);
  if (terminal === undefined) return { kind: 'pending' };
  if (terminal.status === 'running') return { kind: 'running', terminalId: terminal.id };
  return terminal.status === 'starting' ? { kind: 'pending' } : { kind: 'gone' };
}

// How long a shown tab's terminal has to reach running (a re-adoption, or a fresh shell's spawn) before the Attach
// settles for having shown it.
export const PENDING_TERMINAL_MS = 10_000;

// The tab's terminal once it runs; null when it ends first or does not run in time.
function runningTerminal(tabId: string): Promise<TerminalId | null> {
  return new Promise((resolve) => {
    const settle = (id: TerminalId | null) => {
      clearTimeout(timer);
      off();
      resolve(id);
    };
    const check = () => {
      const terminal = terminals.list().find((info) => info.label === tabId);
      if (terminal?.status === 'running') settle(terminal.id);
      else if (terminal !== undefined && terminal.status !== 'starting') settle(null);
    };
    const timer = setTimeout(() => settle(null), PENDING_TERMINAL_MS);
    const off = terminals.subscribe(check);
    check();
  });
}

// Whether the terminal sits at its shell's prompt: nothing else in the foreground. A read that fails is not an answer,
// so nothing is typed into a terminal whose state is unknown.
async function atPrompt(terminalId: TerminalId): Promise<boolean> {
  try {
    return !(await terminals.foreground(terminalId)).busy;
  } catch {
    return false;
  }
}

// The command typed at the prompt, followed by a newline, as C9's spawn writes it; a ^U first clears whatever the owner
// had half-typed there, so the line is the attach and nothing else.
async function typeCommand(terminalId: TerminalId, command: string): Promise<string | null> {
  const ptyId = terminals.get(terminalId)?.info.ptyId;
  if (!ptyId) return 'the terminal has no shell to run the attach in';
  const written = await ipc.invoke('pty.write', { ptyId, data: `\x15${command}\n` });
  return written.ok ? null : written.error.message;
}

// ---- attach ------------------------------------------------------------------------------------------------------

async function jobOf(record: SessionRecord, known: KnownJob | null): Promise<{ jobId: string; cwd: string } | { error: string }> {
  if (record.engineSessionId !== null) {
    const read = await ipc.invoke('fs.holders', { sessionIds: [record.engineSessionId], directories: null });
    if (!read.ok && known === null) return { error: read.error.message };
    for (const { sessionId, holder, cwd } of read.ok ? read.value.holders : []) {
      if (sessionId === record.engineSessionId && holder.kind === 'background_job' && holder.jobId !== null) return { jobId: holder.jobId, cwd: cwd ?? record.directory };
    }
  }
  if (known !== null) return { jobId: known.jobId, cwd: record.directory };
  return { error: 'No background job holds this session now; nothing to attach to' };
}

async function commandFor(jobId: string, known: KnownJob | null): Promise<string | { error: string }> {
  if (known?.jobId === jobId) return known.command;
  const binary = await ipc.invoke('engine.binaryInfo', undefined);
  return binary.ok ? attachCommand(binary.value.path, jobId) : { error: binary.error.message };
}

function showPanel(): void {
  const layout = useLayout.getState();
  if (layout.regions.panel.collapsed) layout.setPanel({ collapsed: false });
}

// The remembered tab on screen, as a new tab would be: the session in the main area, the panel open, the tab selected.
function showTab(appSessionId: AppSessionId, tabId: string): void {
  showPanel();
  if (shownSession() !== appSessionId) useLayout.getState().openSession(appSessionId);
  panelHost.selectTab(tabId);
}

async function attach(appSessionId: AppSessionId, known: KnownJob | null): Promise<AttachResult> {
  const record = useSessions.getState().records.get(appSessionId);
  if (!record) return { ok: false, error: 'This session is not in the sidebar any more' };
  const job = await jobOf(record, known);
  if ('error' in job) return { ok: false, error: job.error };
  const existing = ((await rememberedTabs()) ?? []).find((t) => t.appSessionId === appSessionId && t.jobId === job.jobId)?.tabId;
  let state = existing === undefined ? ({ kind: 'gone' } as const) : tabState(existing, appSessionId);
  if (existing !== undefined && state.kind === 'pending') {
    showTab(appSessionId, existing); // showing it is what starts or re-adopts its terminal
    const terminalId = await runningTerminal(existing);
    if (terminalId === null) return { ok: true, tabId: existing, how: 'shown' };
    state = { kind: 'running', terminalId };
  }
  if (existing !== undefined && state.kind === 'running') {
    const rerun = await atPrompt(state.terminalId);
    if (rerun) {
      const command = await commandFor(job.jobId, known);
      if (typeof command !== 'string') return { ok: false, error: command.error };
      const failed = await typeCommand(state.terminalId, command);
      if (failed !== null) return { ok: false, error: failed };
    }
    showTab(appSessionId, existing);
    return { ok: true, tabId: existing, how: rerun ? 'rerun' : 'shown' };
  }
  const command = await commandFor(job.jobId, known);
  if (typeof command !== 'string') return { ok: false, error: command.error };
  showPanel();
  const tabId = openTerminal({ appSessionId, cwd: job.cwd, command });
  await remember({ tabId, appSessionId, jobId: job.jobId });
  return { ok: true, tabId, how: 'opened' };
}

// Attaches to the job holding the session (a second call while one runs shares it); `known` is the job a `held`
// answer named.
export function attachToJob(appSessionId: AppSessionId, known: KnownJob | null = null): Promise<AttachResult> {
  const running = inFlight.get(appSessionId);
  if (running) return running;
  const run = attach(appSessionId, known).finally(() => inFlight.delete(appSessionId));
  inFlight.set(appSessionId, run);
  return run;
}

// The same, with a refusal as a toast: what every Attach control calls.
export async function attachOrSay(appSessionId: AppSessionId, known: KnownJob | null = null): Promise<void> {
  const result = await attachToJob(appSessionId, known);
  if (!result.ok) toast({ level: 'danger', text: result.error, actions: [], dismissible: true });
}

// A session held elsewhere, in words, with the job's Attach when there is a job to attach to: from a `held` answer, or
// from the engine's own refusal that failed a resume (the setup store is handed this at composition).
export function heldToast(appSessionId: AppSessionId, holder: SessionRecord['holder'], attach: KnownJob | null): void {
  toastHeld(holder, attach === null ? [] : [{ label: 'Attach', run: () => void attachOrSay(appSessionId, attach) }]);
}

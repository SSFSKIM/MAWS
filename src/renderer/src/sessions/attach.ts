// "Attach in a terminal tab" (C10 execution document, Interfaces "Session service", Attach; M5): C9's Terminal tool
// running the engine's own `claude attach <short>` for a background job, through the pinned binary. The holder notice,
// the row menu and the Attach of a `held` toast all come here.
//
// The job is read fresh (`fs.holders`, as main's guards read it): the id and the directory it runs in come from the
// registry record, which for a `--bg` job is the job's own directory (a job may run in a worktree); the session's
// directory stands in when the registry does not say. A `held` answer names the job before the registry may have it
// (the engine's own refusal wins a race MAWS's read lost), so its job and command are used when the read finds none.
//
// One attach per job at a time: the tab an attach opened is remembered by (session, job), and while its terminal is
// starting or running a second Attach shows that tab instead of spawning another `claude attach`. The pty's label is the
// tab id (C9), which is how the tab's terminal is found.
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { attachCommand } from '@shared/sessions/attach';
import { ipc } from '../ipc/client';
import { instanceOf, panelHost } from '../panel/host';
import { useLayout } from '../stores/layout';
import { activeTab, sessionOfTab } from '../stores/layout-model';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { terminals } from '../terminal/registry';
import { openTerminal } from '../tools/terminal';

export interface KnownJob {
  jobId: string;
  command: string;
}
export type AttachResult = { ok: true; tabId: string; reused: boolean } | { ok: false; error: string };

const tabsByJob = new Map<string, string>(); // `${appSessionId} ${jobId}` → the Terminal tab an attach opened
const inFlight = new Map<AppSessionId, Promise<AttachResult>>();

// Whether the tab an attach opened still runs its terminal: the tab is open and its terminal (found by the tab id, its
// label) is starting or running, or not opened yet (a tab waits for its terminal while the page re-adopts).
function attachedTabAlive(tabId: string): boolean {
  if (!instanceOf(tabId)) return false;
  const terminal = terminals.list().find((info) => info.label === tabId);
  return terminal === undefined || terminal.status === 'starting' || terminal.status === 'running';
}

async function jobOf(record: SessionRecord, known: KnownJob | null): Promise<{ jobId: string; cwd: string } | { error: string }> {
  if (record.engineSessionId !== null) {
    const read = await ipc.invoke('fs.holders', { sessionIds: [record.engineSessionId], directories: null });
    if (read.ok) {
      const row = read.value.holders.find((h) => h.sessionId === record.engineSessionId && h.holder.kind === 'background_job' && h.holder.jobId !== null);
      if (row && row.holder.kind === 'background_job' && row.holder.jobId !== null) return { jobId: row.holder.jobId, cwd: row.cwd ?? record.directory };
    } else if (known === null) return { error: read.error.message };
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

async function attach(appSessionId: AppSessionId, known: KnownJob | null): Promise<AttachResult> {
  const record = useSessions.getState().records.get(appSessionId);
  if (!record) return { ok: false, error: 'This session is not in the sidebar any more' };
  const job = await jobOf(record, known);
  if ('error' in job) return { ok: false, error: job.error };
  const key = `${appSessionId} ${job.jobId}`;
  const existing = tabsByJob.get(key);
  if (existing !== undefined && attachedTabAlive(existing)) {
    // as a new tab would be: the session on screen, the panel open, the tab selected and focused
    showPanel();
    if (sessionOfTab(activeTab(useLayout.getState().main)) !== appSessionId) useLayout.getState().openSession(appSessionId);
    panelHost.selectTab(existing);
    return { ok: true, tabId: existing, reused: true };
  }
  const command = await commandFor(job.jobId, known);
  if (typeof command !== 'string') return { ok: false, error: command.error };
  showPanel();
  const tabId = openTerminal({ appSessionId, cwd: job.cwd, command });
  tabsByJob.set(key, tabId);
  return { ok: true, tabId, reused: false };
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

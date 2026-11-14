// The Background supervisor (E10 execution document, §Design 11; Interfaces "Settings version 10" and "Renderer and
// copy"): a group of rows, first in Settings › Supervisor since U11a M9 (Engine's before), named "Background supervisor"
// and drawn under the section's heading, which takes the keyboard when a pressed control leaves. The status line reads
// main's `host.status` (the hosts store, connected while the group is shown); while an incompatible supervisor is
// waited for, or none is running, it offers Restart now (Decision Log, Task 2.3a's re-review). The idle time writes
// settings version 10's `supervisor` section; main pushes it to the supervisor (`host.configure`). Stop all asks
// inline, naming the live count, then calls `host.restart {stopSessions: true}`: main stops every session through the
// supervisor and starts a fresh one. P5 O2 M7 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "Status"): the
// machine daemon's line reads host.status: the daemon's kind, pid and machine ref.
// P5 O15 M2 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, M2 "Settings", "`host.status`"): every launch
// that reaches the app runs on `mawsd`, so the group has no shape switch and no quit default (both settings are retired
// and read by nothing), and it reads host.status as the daemon's: no branch for another transport or an unavailable daemon.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Settings } from '@shared/ipc/schema';
import type { HostStatus } from '@shared/ipc/schema/host';
import { MAX_IDLE_MINUTES } from '@shared/ipc/schema/settings';
import { restartSupervisor } from '../app/supervisor-notices';
import { clockTime } from '../budget/copy';
import { ipc } from '../ipc/client';
import { DANGER } from '../sessions/ui';
import { useHosts } from '../stores/hosts';
import { toast, useNotices } from '../stores/notices';
import { SUPERVISOR } from './copy';
import { ENGINE_HOST_UPDATE } from '../app/copy'; // P5 O16 M3c fix wave 2
import { INPUT, sectionHeadingId, Setting, TEXT_ACTION, useCommittedDraft, writeSettings } from './parts';

// Whole minutes from 1 to MAX_IDLE_MINUTES as typed, or null when the text is not one.
function idleMinutesOf(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const minutes = Number(text);
  return minutes >= 1 && minutes <= MAX_IDLE_MINUTES ? minutes : null;
}

// What the status line says, whether the way back (Restart now) is offered, and the state its note shows: what the
// background process is for, once main has answered; while an incompatible supervisor is waited for, why, whole.
type StatusNote = keyof typeof SUPERVISOR.statusNotes;
function describe(status: HostStatus | null): { text: string; restart: boolean; note: StatusNote } {
  if (status === null) return { text: SUPERVISOR.reading, restart: false, note: 'reading' };
  const note = 'default';
  if (status.state === 'crashed') {
    if (status.reason === 'incompatible') return { text: SUPERVISOR.waiting(status.waitingLiveSessions ?? 0), restart: true, note: 'waiting' };
    return { text: status.reason === 'held_lock' ? SUPERVISOR.heldLock : SUPERVISOR.notRunning, restart: true, note };
  }
  // P5 O16 M3c fix wave 2 (D63): an update that waits for MAWS tool calls, served or deferred, says what it waits for
  if (status.handover) return { text: ENGINE_HOST_UPDATE.waiting(status.handover.inFlight, status.handover.tool), restart: false, note };
  if (status.state === 'restarting') return { text: SUPERVISOR.restarting, restart: false, note };
  const s = status.supervisor;
  if (status.state === 'starting' || s === null) return { text: SUPERVISOR.starting, restart: false, note };
  const exit = s.exitWhenIdle ? SUPERVISOR.exitsWithLast : s.idleExitMs === null ? SUPERVISOR.exitsNever : SUPERVISOR.exitsAfter(s.idleExitMs);
  return { text: SUPERVISOR.running(clockTime(s.startedAt), s.pid, s.liveSessions, exit), restart: false, note };
}

// `host.restart {stopSessions: true}`: Stop all and Restart now are the same act (the app's `restartSupervisor`); a
// refusal is a warning toast, Restart now's in the banners' words.
const restart = (failed?: (why: string) => string) => restartSupervisor(ipc, useNotices, failed);

// After an action removes or disables the control that had focus, focus would fall to the page: it goes to `preferred`
// when that is still there and enabled, else to the section's heading (U11a M9: the group's own heading is gone).
// Focus the owner moved elsewhere is left alone.
type KeepFocus = (preferred: HTMLButtonElement | null) => void;
// E11 W-D: a refused action leaves its control offered and enabled again: the focus the heading held meanwhile (or
// that fell to the page) goes back to it.
type ReturnFocus = (control: HTMLButtonElement | null) => void;

const sectionHeading = () => document.getElementById(sectionHeadingId('supervisor'));

export function SupervisorSettings({ settings }: { settings: Settings }) {
  const status = useHosts((s) => s.supervisor);
  useEffect(() => useHosts.getState().connect(), []);
  const keepFocus = useCallback<KeepFocus>((preferred) => {
    const active = document.activeElement;
    const lost = active === null || active === document.body || (active instanceof HTMLButtonElement && active.disabled);
    if (!lost) return;
    if (preferred?.isConnected && !preferred.disabled) preferred.focus();
    else sectionHeading()?.focus({ preventScroll: true });
  }, []);
  const returnFocus = useCallback<ReturnFocus>((control) => {
    const active = document.activeElement;
    const held = active === null || active === document.body || active === sectionHeading();
    if (held && control?.isConnected && !control.disabled) control.focus();
  }, []);
  return (
    <div role="group" aria-label={SUPERVISOR.title}>
      <StatusRow status={status} keepFocus={keepFocus} returnFocus={returnFocus} />
      <DaemonLine status={status} />
      <IdleExit settings={settings} />
      <StopAll status={status} keepFocus={keepFocus} />
    </div>
  );
}

function StatusRow({ status, keepFocus, returnFocus }: { status: HostStatus | null; keepFocus: KeepFocus; returnFocus: ReturnFocus }) {
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const acted = useRef(false); // Restart now was pressed, and its button may take focus with it as it goes
  const refused = useRef(false); // main refused that press: the button stays offered
  const { text, restart: offered, note } = describe(status);
  useEffect(() => {
    if (!acted.current) return;
    if (refused.current && !busy) {
      acted.current = refused.current = false; // the press is over; the button is back
      returnFocus(button.current);
      return;
    }
    keepFocus(button.current);
    if (!offered) acted.current = false;
  }, [busy, offered, keepFocus, returnFocus]);
  const restartNow = () => {
    acted.current = true;
    refused.current = false;
    setBusy(true);
    void restart()
      .then((ok) => (refused.current = !ok))
      .finally(() => setBusy(false));
  };
  return (
    <Setting row="supervisor.status" state={note}>
      <span role="status" className="min-w-0 text-ui-sm text-fg tabular-nums">
        {text}
      </span>
      {offered && (
        <button ref={button} type="button" disabled={busy} className={TEXT_ACTION} onClick={restartNow}>
          {SUPERVISOR.restartNow}
        </button>
      )}
    </Setting>
  );
}

function daemonText(status: HostStatus | null): string {
  if (status === null) return SUPERVISOR.reading;
  const d = status.daemon;
  return d === null ? SUPERVISOR.daemonConnecting : SUPERVISOR.daemonLine(d.kind, d.pid, d.machine);
}

// A plain line, not a second status: the group's one live line is the supervisor's
function DaemonLine({ status }: { status: HostStatus | null }) {
  return (
    <Setting row="supervisor.daemon">
      <span data-daemon-line className="min-w-0 text-ui-sm text-fg tabular-nums">
        {daemonText(status)}
      </span>
    </Setting>
  );
}

function IdleExit({ settings }: { settings: Settings }) {
  const saved = settings.supervisor.idleExitMinutes;
  const [, field] = useCommittedDraft(saved === null ? null : String(saved), async (next) => {
    if (next === null) return writeSettings({ supervisor: { idleExitMinutes: null } });
    const minutes = idleMinutesOf(next);
    if (minutes === null) {
      toast({ level: 'warning', text: SUPERVISOR.idleInvalid, actions: [], dismissible: true });
      return false;
    }
    return writeSettings({ supervisor: { idleExitMinutes: minutes } });
  });
  return (
    <Setting row="supervisor.idleExit" state={saved === null ? 'never' : 'minutes'} values={{ minutes: saved === null ? null : String(saved) }}>
      <input aria-label={SUPERVISOR.idleField} inputMode="numeric" placeholder={SUPERVISOR.idleNever} {...field} className={`${INPUT} max-w-[90px] tabular-nums`} />
      <span className="text-ui-sm text-fg-muted">{SUPERVISOR.idleUnit}</span>
    </Setting>
  );
}

// The action, then in its place the question naming the live count (it follows the status while asked), Stop all and
// Cancel. The question ends when the supervisor stops being ready (it never reopens by itself) and as soon as the owner
// confirms (the action then reads Stopping… until main answers). Focus moves to Cancel when asked and, when the
// question closes, back to the action if it is enabled, else to the section's heading. UX wave U7b: Esc on the question
// is its own (`data-escape-own`), so the Settings dialog around it stays.
function StopAll({ status, keepFocus }: { status: HostStatus | null; keepFocus: KeepFocus }) {
  const questionId = useId();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = status?.state === 'ready';
  if (asking && !ready) setAsking(false); // readiness lost: the question is over
  const open = asking && ready;
  const action = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) cancel.current?.focus();
    else if (wasOpen.current) keepFocus(action.current);
    wasOpen.current = open;
  }, [open, keepFocus]);
  const onEscape = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') setAsking(false);
  };
  const stop = () => {
    setAsking(false);
    setBusy(true);
    void restart(SUPERVISOR.stopFailed).finally(() => setBusy(false));
  };
  return (
    <Setting row="supervisor.stopAll">
      {open ? (
        <>
          <span id={questionId} className="text-ui-sm text-fg">
            {SUPERVISOR.confirm(status?.supervisor?.liveSessions ?? 0)}
          </span>
          <button type="button" data-escape-own aria-describedby={questionId} className={`${DANGER} text-ui-sm`} onClick={stop} onKeyDown={onEscape}>
            {SUPERVISOR.confirmAction}
          </button>
          <button ref={cancel} type="button" data-escape-own aria-describedby={questionId} className={TEXT_ACTION} onClick={() => setAsking(false)} onKeyDown={onEscape}>
            {SUPERVISOR.cancel}
          </button>
        </>
      ) : (
        <button ref={action} type="button" disabled={!ready || busy} className={TEXT_ACTION} onClick={() => setAsking(true)}>
          {busy ? SUPERVISOR.stopping : SUPERVISOR.stopAllAction}
        </button>
      )}
    </Setting>
  );
}

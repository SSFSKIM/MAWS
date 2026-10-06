// Settings › Engine › Background supervisor (E10 execution document, §Design 11; Interfaces "Settings version 10" and
// "Renderer and copy"): a group inside the Engine section, so X14's `settings` enum is untouched. The status line reads
// main's `host.status` (the hosts store, connected while the group is shown); while an incompatible supervisor is
// waited for, or none is running, it offers Restart now (Decision Log, Task 2.3a's re-review). The idle time and the
// quit default write settings version 10's `supervisor` section; main pushes the idle time to the supervisor
// (`host.configure`) and the quit guard reads the default. Stop all asks inline, naming the live count, then calls
// `host.restart {stopSessions: true}`: main stops every session through the supervisor and starts a fresh one.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Settings } from '@shared/ipc/schema';
import type { HostStatus } from '@shared/ipc/schema/host';
import { MAX_IDLE_MINUTES } from '@shared/ipc/schema/settings';
import { clockTime } from '../budget/copy';
import { ipc } from '../ipc/client';
import { DANGER } from '../sessions/ui';
import { useHosts } from '../stores/hosts';
import { toast } from '../stores/notices';
import { SUPERVISOR } from './copy';
import { INPUT, Segment, Setting, TEXT_ACTION, useCommittedDraft, writeSettings } from './parts';

// Whole minutes from 1 to MAX_IDLE_MINUTES as typed, or null when the text is not one.
function idleMinutesOf(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const minutes = Number(text);
  return minutes >= 1 && minutes <= MAX_IDLE_MINUTES ? minutes : null;
}

// What the status line says, whether the way back (Restart now) is offered, and its note: what the background process
// is for, said only while the engine host is one (detached).
function describe(status: HostStatus | null): { text: string; restart: boolean; note?: string } {
  const note = status?.transport === 'detached' ? SUPERVISOR.statusNote : undefined;
  if (status === null) return { text: SUPERVISOR.reading, restart: false };
  if (status.state === 'crashed') {
    if (status.reason === 'incompatible') return { text: SUPERVISOR.waiting(status.waitingLiveSessions ?? 0), restart: true, note: SUPERVISOR.waitingNote };
    return { text: status.reason === 'held_lock' ? SUPERVISOR.heldLock : SUPERVISOR.notRunning, restart: true, note };
  }
  if (status.state === 'restarting') return { text: SUPERVISOR.restarting, restart: false, note };
  const s = status.supervisor;
  if (status.state === 'starting' || s === null) return { text: SUPERVISOR.starting, restart: false, note };
  if (status.transport === 'utility') return { text: SUPERVISOR.inApp(s.pid, s.liveSessions), restart: false, note };
  const exit = s.exitWhenIdle ? SUPERVISOR.exitsWithLast : s.idleExitMs === null ? SUPERVISOR.exitsNever : SUPERVISOR.exitsAfter(s.idleExitMs);
  return { text: SUPERVISOR.running(clockTime(s.startedAt), s.pid, s.liveSessions, exit), restart: false, note };
}

// `host.restart {stopSessions: true}`: Stop all and Restart now are the same act; a refusal is a warning toast.
async function restart(failed: (why: string) => string): Promise<void> {
  const result = await ipc.invoke('host.restart', { stopSessions: true });
  if (!result.ok) toast({ level: 'warning', text: failed(result.error.message), actions: [], dismissible: true });
}

// After an action removes or disables the control that had focus, focus would fall to the page: it goes to `preferred`
// when that is still there and enabled, else to the group's heading. Focus the owner moved elsewhere is left alone.
type KeepFocus = (preferred: HTMLButtonElement | null) => void;

export function SupervisorSettings({ settings }: { settings: Settings }) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const status = useHosts((s) => s.supervisor);
  useEffect(() => useHosts.getState().connect(), []);
  const keepFocus = useCallback<KeepFocus>((preferred) => {
    const active = document.activeElement;
    const lost = active === null || active === document.body || (active instanceof HTMLButtonElement && active.disabled);
    if (!lost) return;
    if (preferred?.isConnected && !preferred.disabled) preferred.focus();
    else heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div role="group" aria-labelledby={headingId} className="mt-3">
      <h4 id={headingId} ref={heading} tabIndex={-1} className="m-0 mb-0.5 text-ui-sm font-semibold text-fg outline-accent focus-visible:outline-2">
        {SUPERVISOR.title}
      </h4>
      <StatusRow status={status} keepFocus={keepFocus} />
      <IdleExit settings={settings} />
      <Setting label={SUPERVISOR.quitDefault} note={SUPERVISOR.quitNote}>
        <Segment
          label={SUPERVISOR.quitDefault}
          value={settings.supervisor.keepRunningDefault ? 'keep' : 'stop'}
          options={[
            { value: 'keep', label: SUPERVISOR.quitKeep },
            { value: 'stop', label: SUPERVISOR.quitStop },
          ]}
          onChange={(next) => void writeSettings({ supervisor: { keepRunningDefault: next === 'keep' } })}
        />
      </Setting>
      <StopAll status={status} keepFocus={keepFocus} />
    </div>
  );
}

function StatusRow({ status, keepFocus }: { status: HostStatus | null; keepFocus: KeepFocus }) {
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const acted = useRef(false); // Restart now was pressed, and its button may take focus with it as it goes
  const { text, restart: offered, note } = describe(status);
  useEffect(() => {
    if (!acted.current) return;
    keepFocus(button.current);
    if (!offered) acted.current = false;
  }, [busy, offered, keepFocus]);
  const restartNow = () => {
    acted.current = true;
    setBusy(true);
    void restart(SUPERVISOR.restartFailed).finally(() => setBusy(false));
  };
  return (
    <Setting label={SUPERVISOR.status} note={note}>
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
    <Setting label={SUPERVISOR.idle} note={saved === null ? SUPERVISOR.idleNeverNote : SUPERVISOR.idleNote(saved)}>
      <input aria-label={SUPERVISOR.idleField} inputMode="numeric" placeholder={SUPERVISOR.idleNever} {...field} className={`${INPUT} max-w-[90px] tabular-nums`} />
      <span className="text-ui-sm text-fg-muted">{SUPERVISOR.idleUnit}</span>
    </Setting>
  );
}

// The action, then in its place the question naming the live count (it follows the status while asked), Stop all and
// Cancel. The question ends when the supervisor stops being ready (it never reopens by itself) and as soon as the owner
// confirms (the action then reads Stopping… until main answers). Focus moves to Cancel when asked and, when the
// question closes, back to the action if it is enabled, else to the group's heading.
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
    <Setting label={SUPERVISOR.stopAll} note={SUPERVISOR.stopAllNote}>
      {open ? (
        <>
          <span id={questionId} className="text-ui-sm text-fg">
            {SUPERVISOR.confirm(status?.supervisor?.liveSessions ?? 0)}
          </span>
          <button type="button" aria-describedby={questionId} className={`${DANGER} text-ui-sm`} onClick={stop} onKeyDown={onEscape}>
            {SUPERVISOR.confirmAction}
          </button>
          <button ref={cancel} type="button" aria-describedby={questionId} className={TEXT_ACTION} onClick={() => setAsking(false)} onKeyDown={onEscape}>
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

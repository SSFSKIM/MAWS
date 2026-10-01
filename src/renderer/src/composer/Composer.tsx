// The composer (C7 execution document, "Composer public surface", "Submit control and queue", "Composer frame",
// "Unstarted sessions and the docked host"; M4): what C7 renders in C5's `composer` slot for a live, exited or
// unstarted session. The queued list, then the frame: the chip row over the live or the intent binding, the attachment
// strip, the box with M3's editor and the submit control, the toolbar. When a request or a docked card needs the
// human, it takes the place of the box and the toolbar under the chip row (they stay mounted and hidden, so the editor
// keeps its document, history and undo) and the docked frame takes focus when the pane held it; when it retires, focus
// goes back to the editor.
//
// Every submission ends in the editor's `onSubmit`, decided here through `submitState`: an unstarted session's first
// send goes to C10's `start` under the synchronous `starting` gate; a live one sends (C3 decides sent or queued), and
// while a turn runs (W1, charter §4.2 as amended 2026-10-01) Enter is Queue, a steer with priority `next` the engine
// delivers at the turn's next tool boundary, ⌥Enter is Hold, MAWS's own queue released when the turn ends, and the
// caret menu's Send now steers with `now`; `!` and `#` run through their modes. Esc in the editor interrupts and sends
// the held head now (a `now` promote), or is a plain stop when nothing is held; it first leaves edit mode, and an open
// `@` or `/` list takes it before the composer does. ⌘. and ⌘L are not registered here: `ComposerAppKeys` holds the one
// app-level handler (⌘. stays a plain stop that pauses the queue).
//
// Edit mode (M4b): a prefill with `editing` (a bubble's Edit, the refusal dialog's Edit prompt) shows the state line
// above the frame; Send then forks through C10's provider, or asks to rewind this session and resend, and the state
// line follows the resubmit (`resubmit-seam.ts`) until the edited text is sent. The edit rides in the draft document,
// so a reload restores edit mode, which the session's hydrated transcript then confirms or ends.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Draft } from '@shared/ipc/schema/session';
import { ipc } from '../ipc/client';
import { useCommand } from '../ipc/query';
import { useKeyChord } from '../keymap/useKeyChord';
import { RequestCard } from '../request-card/RequestCard';
import { nextMode } from '../statusline';
import { SetupStatusLine } from '../statusline/SetupActivity';
import { useAttention, selectPendingOf } from '../stores/attention';
import { editingOf, isStarting, memoryTargetOf, registerFocusTarget, resubmitRecordOf, setSetupPhase, setStarting, useComposerStore, type Editing, type ResubmitState } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { toast } from '../stores/notices';
import { useSessionQueue } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../transcript';
import { useDockedCards } from './docked/registry';
import { swapOf } from './docked/swap';
import { attachmentsOf, editingOfDoc, emptyDoc, isMultiline, type ComposerDoc } from './editor/doc';
import { ipcDrafts, type DraftPort, type EditorHandle, type SubmitHow } from './editor/controller';
import { Editor } from './editor/Editor';
import { serializeDraft, type Serialized } from './editor/serialize';
import { afterAccepted, dispatchByMode, precheck, submitSerialized, type Dispatch } from './editor/submit'; // C12: afterAccepted, precheck
import { newestUserUuid } from './edit-prefill';
import { EditModeLine, RewindConfirm } from './EditMode';
import { endedBindings, intentBindings, liveBindings, workspaceDirectoriesOf, type FrameBindings } from './frame/bindings';
import { Frame } from './frame/Frame';
import { useGitWatch } from './frame/git-watch';
import { QueueList } from './queue/QueueList';
import {
  askToRewind,
  cancelRewind,
  confirmRewind,
  enterEditMode,
  entryShowsRewind,
  keepEditing,
  leaveEditMode,
  restoreEditMode,
  resubmitProvider,
  resubmitSendFailed,
  resubmitSent,
  rewindAgain,
  settleRestoredEdit,
  takeAutoSend,
} from './resubmit-seam';
import { routeOf, useListModels, useModelCatalogue, type Route } from './list-models';
import { releasedResume } from './resume-seam'; // C12
import { locationPath, useSetupIntent, type SetupIntentHook } from './setup-intent';
import { isBusy, steerPriority, submitState, type SubmitDecision } from './submit/submit-state';
import { SubmitControl } from './submit/SubmitControl';

// Why Send waits while the resubmit is under way (null: it may go).
const RESUBMIT_WAIT: Record<ResubmitState, string | null> = {
  idle: null,
  sent: null,
  rewound_awaiting_send: null,
  confirming: 'Confirm the rewind first',
  rewinding: 'Rewinding…',
  rewind_uncertain: 'Rewind unconfirmed · checking the transcript…',
  rewind_unresolved: 'Choose how to continue above',
};

export interface ComposerProps {
  appSessionId: AppSessionId;
  paneIndex: 0 | 1;
  client?: MawsBridge; // tests
}

// The session's C3 status: the shell's store (fed by `session.status` events), read once on mount when the store has
// none yet (a composer mounted after the last event), never over an event that arrived meanwhile.
function useSessionStatus(appSessionId: AppSessionId, client: MawsBridge) {
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  useEffect(() => {
    if (useSessions.getState().engine.has(appSessionId)) return;
    let live = true;
    void client.invoke('session.status', { appSessionId }).then((result) => {
      if (live && result.ok && !useSessions.getState().engine.has(appSessionId)) useSessions.getState().applyStatus({ appSessionId, status: result.value });
    });
    return () => void (live = false);
  }, [appSessionId, client]);
  return status;
}

// ⌥ held (the Hold label replaces Queue live while it is down over the control or with focus in the box).
function useAltHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => setHeld(event.altKey);
    const onBlur = () => setHeld(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return held;
}

// Where the draft lives: C10's intent while the session is unstarted (C4's drafts table has no row for it), C4's drafts
// otherwise. The port is created once per editor and reads the current hook, so a session that starts while its tab is
// open moves to C4's drafts without a remount.
function useDraftPort(appSessionId: AppSessionId, hook: SetupIntentHook | null, client: MawsBridge): DraftPort {
  const current = useRef(hook);
  useLayoutEffect(() => void (current.current = hook));
  return useMemo(() => {
    const drafts = ipcDrafts(client, appSessionId);
    return {
      // While C10 holds an accepted first message its intent's draft may still be the sent text: nothing to restore.
      load: async () => (current.current ? (current.current.intent.message !== null ? null : current.current.intent.draft) : drafts.load()),
      clearsOnSend: () => current.current === null, // C10 holds an accepted first message; its intent's draft is left alone
      save: (draft: Draft | null) => {
        const intent = current.current;
        if (!intent) return drafts.save(draft);
        void intent.patch({ draft }).then((result) => {
          if (!result.ok) console.warn('[composer] the unstarted session kept no draft', result.error);
        });
      },
    };
  }, [appSessionId, client]);
}

// The live chips' reads: C3's models and permission rules, each a control request to the engine, read once a chip that
// shows it has opened (never per mount), the route's model catalogue for the model chip's name (a host read, from the
// first render), and the branch list for the location popover.
function useLiveReads(appSessionId: AppSessionId, want: { models: boolean; rules: boolean }, directory: string | null, git: { branch: string | null } | null, route: Route | null, ready: boolean) {
  const models = useListModels(appSessionId, want.models);
  const modelNames = useModelCatalogue(route, ready, directory);
  const rules = useCommand('session.listPermissionRules', { appSessionId }, { enabled: want.rules, staleTime: 10_000 });
  const branches = useCommand('git.branches', { directory: directory ?? '' }, { enabled: want.rules && directory !== null && git !== null, staleTime: 30_000 });
  return {
    models,
    modelNames,
    directories: rules.data ? workspaceDirectoriesOf(rules.data.state.workspaceDirectories) : null,
    branch: git?.branch ?? null,
    branches: branches.data?.branches.map((b) => b.name) ?? [],
    refresh: () => void rules.refetch(),
  };
}

export function Composer({ appSessionId, paneIndex, client = ipc }: ComposerProps) {
  const hook = useSetupIntent(appSessionId);
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const status = useSessionStatus(appSessionId, client);
  // Unstarted while C10 has an intent and C3 no status; the binding swaps when the status appears, without a remount.
  // C10: also while there is no record (C5's pane rule): a failed setup keeps its tab, and C3 the failed launch's
  // exited status for the id.
  const setup = status === null || record === null ? hook : null;
  const unstarted = setup !== null;
  // The running setup's phase is also the status line's activity: published for it while this composer holds the hook.
  const phase = setup?.phase ?? null;
  useEffect(() => {
    setSetupPhase(appSessionId, phase);
    return () => setSetupPhase(appSessionId, null);
  }, [appSessionId, phase]);
  const queue = useSessionQueue(appSessionId, client);
  const starting = useComposerStore((s) => isStarting(s, appSessionId));
  const handle = useRef<EditorHandle>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<ComposerDoc>(emptyDoc);
  const [hover, setHover] = useState(false);
  const [boxFocused, setBoxFocused] = useState(false);
  const alt = useAltHeld();
  const editing = useComposerStore((s) => editingOf(s, appSessionId));
  const resubmit = useComposerStore((s) => resubmitRecordOf(s, appSessionId));
  const newest = useTranscriptStore((s) => (editing ? newestUserUuid(s.entries[appSessionId]?.rows ?? []) : null)); // the reconfirm's only reader
  const restored = useComposerStore((s) => s.restoredEdits.has(appSessionId));
  // Whether the hydrated transcript shows the edited message rewound (a boundary naming it, or its turn hidden by a rewind
  // to an earlier message); false while it cannot tell (not attached, or hydrating).
  const rewoundInTranscript = useTranscriptStore((s) => {
    const entry = s.entries[appSessionId];
    return editing !== null && entryShowsRewind(entry, editing.messageUuid);
  });

  // ---- what the frame binds to ------------------------------------------------------------------------------------
  const cwd = setup ? locationPath(setup.intent.location) : (status?.cwd ?? record?.directory ?? '');
  const repo = useGitWatch(setup ? null : cwd || null, client);
  const [opened, setOpened] = useState({ models: false, rules: false });
  const ready = status?.process === 'ready';
  const reads = useLiveReads(appSessionId, { models: ready && opened.models, rules: ready && opened.rules }, setup ? null : cwd || null, repo, routeOf(status, record), ready);
  const bindings: FrameBindings = setup ? intentBindings(setup, { starting }) : status || record ? liveBindings(status, record, reads, client) : endedBindings();

  // ---- the submit control's state ------------------------------------------------------------------------------
  const draft = useMemo(() => serializeDraft(doc, { sessionId: null, cwd: '' }), [doc]);
  const messageHeld = setup !== null && setup.intent.message !== null;
  // C12: released under the memory budget: main's digest carries the mark (cleared by a launch, an archive, or a terminal
  // taking the session)
  const released = useSessions((s) => s.digests.get(appSessionId)?.released !== undefined);
  const decision = submitState({
    status,
    intent: unstarted ? { starting, messageHeld, phase: setup.phase ?? null } : null, // C10: the setup phase
    queue,
    empty: draft.empty,
    mode: draft.mode,
    holdHeld: alt && (hover || boxFocused),
    released, // C12
  });
  // In edit mode a non-empty prompt resubmits (a fork, or the explicit rewind): the control reads Send, and waits while
  // the resubmit is under way.
  const wait = RESUBMIT_WAIT[resubmit.state];
  const shown: SubmitDecision =
    editing && !unstarted && !draft.empty && draft.mode === 'send'
      ? { ...decision, primary: 'send', label: 'Send', enabled: ready && wait === null, reason: wait ?? (ready ? null : decision.reason), detail: null, secondaryStop: false, menu: [] }
      : decision;

  // ---- the docked swap ---------------------------------------------------------------------------------------------
  const cards = useDockedCards(appSessionId);
  const items = useAttention((s) => selectPendingOf(s, appSessionId));
  const requests = useAttention((s) => s.requests);
  const swap = useMemo(() => swapOf(items, requests), [items, requests]);
  useEffect(() => swap.unread.forEach((item) => void useAttention.getState().loadRequest(client, item)), [swap.unread, client]);
  const card = cards[0] ?? null;
  const docked = card !== null || swap.item !== null;
  const waiting = cards.length - (card ? 1 : 0) + (card && swap.item ? 1 : 0) + swap.waiting;

  // ---- focus: the one app-level ⌘L and the docked frame's return go through this -----------------------------------------
  const rootRef = useRef<HTMLElement>(null);
  useEffect(
    () =>
      registerFocusTarget(appSessionId, {
        focusEditor: () => handle.current?.focus(),
        focusFrame: () => {
          const frame = rootRef.current?.querySelector<HTMLElement>('[data-docked-frame]');
          if (frame) frame.focus();
          else handle.current?.focus();
        },
        insertText: (text) => handle.current?.insertText(text),
        openWidget: (name, args) => handle.current?.openWidget(name, args) ?? false, // C11: openComposerWidget
      }),
    [appSessionId],
  );

  // ⇧Tab in the editor cycles the permission mode (C5's composer-scoped `composer.cycleMode`).
  const mode = bindings.mode;
  useKeyChord(
    'composer.cycleMode',
    () => {
      if (mode.disabled === null) void mode.set(nextMode(mode.value, mode.autoUnavailable === null));
    },
    { within: boxRef },
  );

  // ---- submissions ---------------------------------------------------------------------------------------------
  const drafts = useDraftPort(appSessionId, setup, client);

  // A submission in edit mode: the fork when C10 registered its provider; otherwise the explicit rewind's confirm, or,
  // once rewound (or by the human's choice when the rewind stayed unconfirmed), `session.send` alone.
  const resubmitSubmission = async (s: Serialized, edit: Editing, how: SubmitHow): Promise<boolean> => {
    const provider = resubmitProvider();
    if (provider) {
      const fork = { opened: null as AppSessionId | null };
      const dispatch: Dispatch = async () => {
        try {
          fork.opened = (await provider.forkFrom({ appSessionId, messageUuid: edit.messageUuid, content: s.content })).appSessionId;
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      };
      const accepted = await submitSerialized(client, appSessionId, s, 'send', null, { dispatch, retry: () => handle.current?.submit(how) });
      if (accepted) resubmitSent(appSessionId);
      if (accepted && fork.opened) useLayout.getState().openSession(fork.opened);
      return accepted;
    }
    const { state } = resubmitRecordOf(useComposerStore.getState(), appSessionId);
    const bypass = state === 'rewind_unresolved' && how === 'send_without_rewinding'; // the human's explicit choice
    if (useSessions.getState().engine.get(appSessionId)?.process !== 'ready') return false; // as the control says: nothing to rewind or send to
    if (state === 'idle') {
      askToRewind(appSessionId);
      return false;
    }
    if (state !== 'rewound_awaiting_send' && !bypass) return false;
    const dispatch: Dispatch = async () => {
      const result = await client.invoke('session.send', { appSessionId, content: s.content });
      if (result.ok) return null;
      resubmitSendFailed(appSessionId);
      return result.error.message;
    };
    const accepted = await submitSerialized(client, appSessionId, s, 'send', null, { dispatch, retry: () => handle.current?.submit(how) });
    if (accepted) resubmitSent(appSessionId);
    return accepted;
  };

  const onSubmit = async (s: Serialized, how: SubmitHow): Promise<boolean> => {
    const retry = () => handle.current?.submit(how);
    if (setup) {
      // read synchronously: a second Enter in the same tick, or before C10 answers, starts nothing
      if (isStarting(useComposerStore.getState(), appSessionId) || setup.intent.message !== null || s.mode !== 'send' || s.empty) return false;
      setStarting(appSessionId, true);
      try {
        const start: Dispatch = async () => {
          const result = await setup.start({ content: s.content, display: s.display });
          return result.ok ? null : result.error;
        };
        return await submitSerialized(client, appSessionId, s, 'send', null, { dispatch: start, project: locationPath(setup.intent.location), retry });
      } finally {
        setStarting(appSessionId, false);
      }
    }
    const edit = editingOf(useComposerStore.getState(), appSessionId);
    if (edit && s.mode === 'send') return resubmitSubmission(s, edit, how);
    const decided = submitState({ status, intent: null, queue, empty: s.empty, mode: s.mode, holdHeld: how === 'hold', released /* C12 */ });
    if (!decided.enabled) return false;
    if (released && (status === null || status.process === 'exited')) return resumeReleased(s); // C12
    const target = memoryTargetOf(useComposerStore.getState(), appSessionId);
    let dispatch: Dispatch;
    if (s.mode !== 'send') dispatch = () => dispatchByMode(client, appSessionId, s, 'send', target);
    else if (decided.primary === 'queue' || (how === 'interrupt_and_send' && decided.menu.length > 0)) {
      const priority = steerPriority(how === 'interrupt_and_send' ? 'interrupt_and_send' : 'queue');
      dispatch = async () => {
        const result = await client.invoke('session.steer', { appSessionId, content: s.content, priority });
        return result.ok ? null : result.error.message;
      };
    } else
      dispatch = async () => {
        const result = await client.invoke('session.send', { appSessionId, content: s.content });
        return result.ok ? null : result.error.message;
      };
    return submitSerialized(client, appSessionId, s, 'send', target, { dispatch, retry });
  };

  // C12 start: Send on a released session resumes it through C10's resume (registered in `resume-seam.ts`), the message
  // going with it; a refused resume says why itself and the editor keeps the text.
  const resumeReleased = async (s: Serialized): Promise<boolean> => {
    const resume = releasedResume();
    if (resume === null || !precheck(s)) return false;
    const accepted = await resume(appSessionId, { content: s.content, display: s.display });
    if (accepted) afterAccepted(client, appSessionId, s);
    return accepted;
  };
  // C12 end

  const interrupt = () =>
    void client.invoke('session.interrupt', { appSessionId, cancelEngineQueued: false }).then((result) => {
      if (!result.ok) console.warn('[composer] session.interrupt failed', result.error);
    });
  const onPrimary = () => {
    if (shown.primary === 'stop') return interrupt();
    if (shown.primary === 'resume')
      return void client.invoke('session.queue.setPaused', { appSessionId, paused: false }).then((result) => {
        if (!result.ok) toast({ level: 'warning', text: result.error.message, actions: [], dismissible: true }); // as the queued list does
      });
    handle.current?.submit(shown.primary === 'hold' ? 'hold' : 'send');
  };

  // W1: Esc while a turn runs interrupts and sends the held head now (a `now` promote, which preempts the turn), or is
  // a plain stop when nothing is held; a `next` steer still waiting runs right after either way, since the engine starts
  // what it holds once the turn ends (pass3/steer-next-interrupted, steer-next-then-now). An uncertain head waits for the
  // human's own decision. Not busy, Esc is not the composer's.
  const escapeTurn = (): boolean => {
    const current = useSessions.getState().engine.get(appSessionId) ?? null;
    if (current?.process !== 'ready' || !isBusy(current, queue.entries)) return false;
    const head = queue.entries.find((e) => e.state === 'queued' && !e.uncertain);
    if (!head) {
      interrupt();
      return true;
    }
    void client.invoke('session.queue.promote', { appSessionId, queueId: head.queueId, priority: steerPriority('interrupt_and_send') }).then((result) => {
      if (!result.ok) toast({ level: 'warning', text: result.error.message, actions: [], dismissible: true });
    });
    return true;
  };

  // The edit mode into the document, so the draft carries it across a reload. Every replacement of the document sets the
  // replacing document's own edit (none for a recall), so after any change the document is brought back to what the
  // state line shows; the controller writes only a difference.
  useEffect(() => handle.current?.setEditing(editing), [editing, doc]);
  // An edit restored after a reload, against the hydrated transcript: the rewind shown there means it applied meanwhile.
  useEffect(() => {
    if (restored) settleRestoredEdit(appSessionId, rewoundInTranscript);
  }, [appSessionId, restored, rewoundInTranscript]);

  // Rewound by the human's own confirm: the edited text goes as part of that decision (once the editor is editable again).
  useEffect(() => {
    if (resubmit.state === 'rewound_awaiting_send' && resubmit.autoSend && takeAutoSend(appSessionId)) handle.current?.submit('send');
  }, [appSessionId, resubmit]);

  // The editor is read-only while C10 holds the first send (starting, or its message retained behind a card), and while
  // a rewind is in flight or unconfirmed (what it resends is what the human confirmed).
  const rewindHolds = editing !== null && (resubmit.state === 'rewinding' || resubmit.state === 'rewind_uncertain');
  const editorDisabled = (setup && (starting || messageHeld) ? decision.reason : null) ?? (rewindHolds ? RESUBMIT_WAIT[resubmit.state] : null);
  const newerTurn = editing !== null && newest !== null && newest !== editing.seenCursor;
  const sessionId = status?.engineSessionId ?? record?.engineSessionId ?? null;

  return (
    <section ref={rootRef} aria-label="Composer" data-composer={appSessionId} data-pane-index={paneIndex} className="flex min-w-0 flex-col gap-2">
      {!unstarted && <QueueList appSessionId={appSessionId} queue={queue} sessionId={sessionId} cwd={cwd} client={client} />}
      {editing && (
        <EditModeLine
          resubmit={resubmit}
          onLeave={() => leaveEditMode(appSessionId)}
          onRetry={() => handle.current?.submit('send')}
          onRewindAgain={() => void rewindAgain(client, appSessionId)}
          onSendWithoutRewinding={() => handle.current?.submit('send_without_rewinding')}
          onKeepEditing={() => keepEditing(appSessionId)}
        />
      )}
      {editing && resubmit.state === 'confirming' && (
        <RewindConfirm newerTurn={newerTurn} onConfirm={() => void confirmRewind(client, appSessionId, newerTurn ? newest : null)} onCancel={() => cancelRewind(appSessionId)} />
      )}
      {swap.notice && <RequestCard key={swap.notice.id} item={swap.notice} request={null} placement="docked" paneIndex={paneIndex} />}
      <Frame
        docked={
          docked ? (
            <>
              {card ? (
                <div key={`card:${card.id}`}>{card.render()}</div>
              ) : swap.item ? (
                <RequestCard key={swap.item.id} item={swap.item} request={requests.get(swap.item.id) ?? null} placement="docked" paneIndex={paneIndex} />
              ) : null}
              {waiting > 0 && <p className="m-0 text-ui-sm text-fg-muted">{waiting === 1 ? '1 more waiting' : `${waiting} more waiting`}</p>}
            </>
          ) : null
        }
        // C10 seam: only a chip opened on the live frame asks for the engine's lists (the intent's frame shows none of them),
        // so the launch never reads what an unstarted chip opened, racing C10's first message
        onOpen={(what) => !unstarted && setOpened((o) => (o[what] ? o : { ...o, [what]: true }))}
        bindings={bindings}
        cwd={cwd}
        dirty={repo?.dirty ?? false}
        attachments={attachmentsOf(doc)}
        editorHandle={handle}
        editor={
          <div ref={boxRef} onFocus={() => setBoxFocused(true)} onBlur={(event) => setBoxFocused(event.currentTarget.contains(event.relatedTarget))}>
            <Editor
              appSessionId={appSessionId}
              cwd={cwd}
              additionalDirectories={bindings.directories.value}
              sessionId={sessionId}
              disabled={editorDisabled}
              drafts={drafts}
              handle={handle}
              client={client}
              onDocChange={setDoc}
              onPrefill={(prefill) => enterEditMode(appSessionId, prefill.editing)}
              onRestore={(restoredDoc) => {
                const carried = editingOfDoc(restoredDoc);
                if (carried && !unstarted && editingOf(useComposerStore.getState(), appSessionId) === null) restoreEditMode(appSessionId, carried);
              }}
              onEscape={() => (editingOf(useComposerStore.getState(), appSessionId) !== null ? leaveEditMode(appSessionId) : escapeTurn())}
              onSubmit={onSubmit}
            />
          </div>
        }
        submit={<SubmitControl decision={shown} multiline={isMultiline(doc)} onPrimary={onPrimary} onStop={interrupt} onMenu={(id) => handle.current?.submit(id)} onHover={setHover} />}
      />
      {/* a tab with no record has no status line yet: the setup's phase shows here, and only while it runs */}
      {record === null && phase !== null && <SetupStatusLine phase={phase} />}
    </section>
  );
}

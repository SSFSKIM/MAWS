// The composer (C7 execution document, "Composer public surface", "Submit control and queue", "Composer frame",
// "Unstarted sessions and the docked host"; M4): what C7 renders in C5's `composer` slot for a live, exited or
// unstarted session. The queued list, then the frame over the live or the intent binding: the attachment strip, the
// box with M3's editor and the submit control, the toolbar (W2: the location with it). When a request or a
// docked card needs the human, it takes the place of the box and the toolbar (they stay mounted and hidden, so the editor
// keeps its document, history and undo) and the docked frame takes focus when the pane held it; when it retires, focus
// goes back to the editor.
//
// Every submission ends in the editor's `onSubmit`, decided here through `submitState`: an unstarted session's first
// send goes to C10's `start` under the synchronous `starting` gate; a live one sends (C3 decides sent or queued), and
// while a turn runs (W10, charter §4.2 as amended 2026-10-01) Send is a steer with priority `next` the engine delivers
// at the turn's next tool boundary; `!` and `#` run through their modes. Esc in the editor interrupts and sends
// now: the held head (a `now` promote), else whatever `next` steer waits (the engine starts it once the turn is
// interrupted), else it just stops; an open `@` or `/` list takes it before the composer does, and with no turn
// running a second Esc within a moment on an empty editor opens the rewind picker (W3, B7). The Stop button and ⌘. are the plain stop: `session.interrupt` with `holdEngineQueued`, which first
// holds every waiting `next` steer in MAWS's queue, so nothing runs until Resume or Send now and the queue reads
// paused because you interrupted. ⌘. and ⌘L are not registered here: `ComposerAppKeys` holds the one app-level handler.
//
// W3 (B6): a bubble's Edit edits the bubble in place (`InlineEdit.tsx`, over `resubmit-seam.ts`); the composer has no
// edit mode. Only once a rewind hid the edited bubble with its turn and the resend still waits (it failed, or the
// rewind was confirmed late) does the composer's dock carry the resubmit's line, with Send or Retry.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Draft } from '@shared/ipc/schema/session';
import { ipc } from '../ipc/client';
import { useCommand } from '../ipc/query';
import { useKeyChord } from '../keymap/useKeyChord';
import { RequestCard } from '../request-card/RequestCard';
import { nextMode } from '../statusline';
import { useAttention, selectPendingOf } from '../stores/attention';
import { inlineEditOf, isStarting, memoryTargetOf, registerFocusTarget, resubmitRecordOf, setStarting, useComposerStore } from '../stores/composer';
import { toast } from '../stores/notices';
import { useSessionQueue } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { gitAnswerOf } from '../sessions/branch-label'; // W9 (H2)
import { useDockedCards } from './docked/registry';
import { swapOf } from './docked/swap';
import { attachmentsOf, emptyDoc, isMultiline, type ComposerDoc } from './editor/doc';
import { ipcDrafts, type DraftPort, type EditorHandle } from './editor/controller';
import { Editor } from './editor/Editor';
import { serializeDraft, type Serialized } from './editor/serialize';
import { afterAccepted, precheck, submitSerialized, type Dispatch } from './editor/submit'; // C12: afterAccepted, precheck
import { useEffectiveEffort } from './effective-effort'; // W3
import { autoFallbackNotice } from '@shared/sessions/models'; // W3
import { ResubmitLine } from './InlineEdit'; // W3 (B6)
import { endedBindings, intentBindings, liveBindings, workspaceDirectoriesOf, type FrameBindings } from './frame/bindings';
import { ContextRing } from './frame/ContextRing';
import { Frame } from './frame/Frame';
import { PluginBand, PluginHint } from './frame/PluginSites'; // R2
import { useGitWatch, type GitWatch } from './frame/git-watch';
import { QueueList } from './queue/QueueList';
import { cancelInlineEdit, sendInlineEdit } from './resubmit-seam'; // W3 (B6)
import { routeOf, useListModels, useModelCatalogue, type Route } from './list-models';
import { releasedResume } from './resume-seam'; // C12
import { locationPath, useSetupIntent, type SetupIntentHook } from './setup-intent';
import { isBusy, steerPriority, submitState } from './submit/submit-state';
import { SubmitControl } from './submit/SubmitControl';

// W3 (B7): how close two Escs must come to count as the terminal's Esc Esc.
export const ESC_ESC_MS = 800;

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
// first render), and git's answer for the location chip's branch (W9, H2: a status, or that the folder is no repository).
function useLiveReads(
  appSessionId: AppSessionId,
  want: { models: boolean; rules: boolean },
  directory: string | null,
  git: GitWatch | null,
  route: Route | null,
  status: EngineSessionStatus | null,
  client: MawsBridge,
) {
  const ready = status?.process === 'ready';
  const models = useListModels(appSessionId, want.models);
  const modelNames = useModelCatalogue(route, ready, directory);
  const effort = useEffectiveEffort(appSessionId, status, client); // W3: get_settings once per ready and per change
  const rules = useCommand('session.listPermissionRules', { appSessionId }, { enabled: want.rules, staleTime: 10_000 });
  return {
    models,
    modelNames,
    ...(effort !== undefined && { effort }),
    directories: rules.data ? workspaceDirectoriesOf(rules.data.state.workspaceDirectories) : null,
    git: gitAnswerOf(git),
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
  // The running setup's phase, in words, shown in the composer's dock while it runs (W2: no status line carries it).
  const phase = setup?.phase ?? null;
  const queue = useSessionQueue(appSessionId, client);
  const starting = useComposerStore((s) => isStarting(s, appSessionId));
  const handle = useRef<EditorHandle>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<ComposerDoc>(emptyDoc);
  // R2: a plugin's suggested prompt (the engine's `ui_prompt_suggest`), the empty box's placeholder until taken, typed
  // over, or a turn starts
  const [suggestion, setSuggestion] = useState<string | null>(null);
  // W3 (B6): a rewound edit whose resend still waits (its bubble left with the rewound turn) shows its line in the dock
  const resubmit = useComposerStore((s) => resubmitRecordOf(s, appSessionId));
  const rewoundEdit = useComposerStore((s) => (inlineEditOf(s, appSessionId) !== null && resubmitRecordOf(s, appSessionId).state === 'rewound_awaiting_send' ? inlineEditOf(s, appSessionId) : null));

  // ---- what the frame binds to ------------------------------------------------------------------------------------
  const location = setup?.intent.location ?? null; // New chat: null until a project is chosen
  const cwd = setup ? (location === null ? '' : locationPath(location)) : (status?.cwd ?? record?.directory ?? '');
  const repo = useGitWatch(setup ? null : cwd || null, client);
  const [opened, setOpened] = useState({ models: false, rules: false });
  const ready = status?.process === 'ready';
  const reads = useLiveReads(appSessionId, { models: ready && opened.models, rules: ready && opened.rules }, setup ? null : cwd || null, repo, routeOf(status, record), status, client);
  // W3: an unstarted tab names what the engine will use, the user's own settings included (read only)
  const userDefaults = useCommand('settings.userEngineDefaults', undefined, { enabled: unstarted, staleTime: 30_000 }).data ?? null;
  const bindings: FrameBindings = setup ? intentBindings(setup, { starting }, userDefaults) : status || record ? liveBindings(status, record, reads, client) : endedBindings();
  // W3 (C5): the engine refused auto and the host set the fallback (requested auto, a refusal, another effective mode)
  const permission = status?.permissionMode ?? null;
  const modeNote = setup ? setup.options.autoModeNote : permission && permission.requested === 'auto' && permission.effective !== 'auto' && permission.refusal !== null ? autoFallbackNotice(permission.effective) : null;
  const [dismissedNote, setDismissedNote] = useState<string | null>(null);

  // ---- the submit control's state ------------------------------------------------------------------------------
  const draft = useMemo(() => serializeDraft(doc, { sessionId: null, cwd: '' }), [doc]);
  const messageHeld = setup !== null && setup.intent.message !== null;
  // C12: released under the memory budget: main's digest carries the mark (cleared by a launch, an archive, or a terminal
  // taking the session)
  const released = useSessions((s) => s.digests.get(appSessionId)?.released !== undefined);
  const decision = submitState({
    status,
    intent: unstarted ? { starting, messageHeld, phase: setup.phase ?? null, noProject: setup.intent.location === null } : null, // C10: the setup phase
    queue,
    empty: draft.empty,
    mode: draft.mode,
    released, // C12
  });

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
  // R2: what the engine's prompt requests read, as of the latest render
  const promptState = useRef({ docked: false, readOnly: false, busy: false });
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
        // R2: the engine's prompt requests on a plugin's behalf (engine-surface/asks.ts)
        prompt: {
          read: () => handle.current?.promptBox() ?? { text: '', cursor: 0 },
          fill: (text, mode) => {
            const { docked: covered, readOnly } = promptState.current;
            if (covered || readOnly || !handle.current) return false; // a card holds the box, or it takes no typing
            handle.current.fill(text, mode);
            setSuggestion(null);
            return true;
          },
          suggest: (text) => {
            const { busy } = promptState.current;
            if (busy || text.trim() === '' || !(handle.current?.serialize().empty ?? false)) return false; // the box holds text, or a turn runs
            setSuggestion(text);
            return true;
          },
        },
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

  const onSubmit = async (s: Serialized): Promise<boolean> => {
    const retry = () => handle.current?.submit();
    if (setup) {
      // read synchronously: a second Enter in the same tick, or before C10 answers, starts nothing
      const where = setup.intent.location; // New chat: Send waits for a project
      if (where === null || isStarting(useComposerStore.getState(), appSessionId) || setup.intent.message !== null || s.mode !== 'send' || s.empty) return false;
      setStarting(appSessionId, true);
      try {
        const start: Dispatch = async () => {
          const result = await setup.start({ content: s.content, display: s.display });
          return result.ok ? null : result.error;
        };
        return await submitSerialized(client, appSessionId, s, 'send', null, { dispatch: start, project: locationPath(where), retry });
      } finally {
        setStarting(appSessionId, false);
      }
    }
    const decided = submitState({ status, intent: null, queue, empty: s.empty, mode: s.mode, released /* C12 */ });
    if (!decided.enabled) return false;
    if (released && (status === null || status.process === 'exited')) return resumeReleased(s); // C12
    const target = memoryTargetOf(useComposerStore.getState(), appSessionId);
    // the mode's own dispatch: `!` and `#` through theirs, a prompt as `session.send`, or (W10) the `next` steer while busy
    return submitSerialized(client, appSessionId, s, decided.steer ? 'steer' : 'send', target, { retry });
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

  // The plain stop (the Stop button): nothing runs after it (W1)
  const stop = () =>
    void client.invoke('session.interrupt', { appSessionId, cancelEngineQueued: false, holdEngineQueued: true }).then((result) => {
      if (!result.ok) console.warn('[composer] session.interrupt failed', result.error);
    });
  // Esc's interrupt: a waiting `next` steer runs right after it (W1)
  const interrupt = () =>
    void client.invoke('session.interrupt', { appSessionId, cancelEngineQueued: false }).then((result) => {
      if (!result.ok) console.warn('[composer] session.interrupt failed', result.error);
    });
  const onPrimary = () => {
    if (decision.primary === 'stop') return stop();
    if (decision.primary === 'resume')
      return void client.invoke('session.queue.setPaused', { appSessionId, paused: false }).then((result) => {
        if (!result.ok) toast({ level: 'warning', text: result.error.message, actions: [], dismissible: true }); // as the queued list does
      });
    handle.current?.submit();
  };

  // W1: Esc while a turn runs interrupts and sends now: the held head (a `now` promote, which preempts the turn), or,
  // with nothing held, an interrupt after which a `next` steer still waiting runs, since the engine starts what it holds
  // once the turn is interrupted (pass3/steer-next-interrupted, steer-next-then-now); with nothing waiting either, that
  // is just a stop. Unlike ⌘. it holds nothing back. An uncertain head waits for the human's own decision. Not busy,
  // Esc is not the composer's (W3: but two of them on an empty editor open the rewind picker, below).
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

  // W3 (B7, charter §5.4 as amended 2026-10-01): with no turn running, Esc twice within a moment on an empty editor of
  // a started session opens the rewind picker (`/rewind`), the terminal's Esc Esc; a turn running keeps W1's Esc.
  const lastEscape = useRef(0);
  const onEscape = (): boolean => {
    if (escapeTurn()) return true;
    const empty = handle.current?.serialize().empty ?? false;
    if (unstarted || !empty) {
      lastEscape.current = 0;
      return false;
    }
    const now = Date.now();
    if (now - lastEscape.current > ESC_ESC_MS) {
      lastEscape.current = now;
      return false;
    }
    lastEscape.current = 0;
    return handle.current?.openWidget('rewind') ?? false;
  };

  // The editor is read-only while C10 holds the first send (starting, or its message retained behind a card).
  const editorDisabled = setup && (starting || messageHeld) ? decision.reason : null;
  // R2: the prompt requests' view of the composer, and a suggestion gone once a turn runs or the box holds text
  const working = isBusy(status, queue.entries);
  useLayoutEffect(() => {
    promptState.current = { docked, readOnly: editorDisabled !== null || setup !== null, busy: working };
  });
  if (suggestion !== null && (working || !draft.empty)) setSuggestion(null); // typed over, or a turn started: gone
  useEffect(() => handle.current?.refreshPlaceholder(), [suggestion]);
  const sessionId = status?.engineSessionId ?? record?.engineSessionId ?? null;

  return (
    <section ref={rootRef} aria-label="Composer" data-composer={appSessionId} data-pane-index={paneIndex} className="flex min-w-0 flex-col gap-2">
      {/* W2: the setup's phase in the dock above the frame, only while it runs (Claude Desktop's dock notices) */}
      {phase !== null && (
        <p role="status" aria-label="Setup" className="m-0 text-ui-sm text-fg-muted">
          {phase}
        </p>
      )}
      {/* W3 (C5): Claude Desktop's notice when the engine refused auto and MAWS set the fallback, or an unstarted tab's
          note on its model and mode (C10's autoModeNote) */}
      {modeNote !== null && modeNote !== dismissedNote && (
        <p role="note" aria-label="Permission mode notice" className="m-0 flex items-baseline gap-2 text-ui-sm text-fg-muted">
          <span className="min-w-0 flex-1">{modeNote}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0 rounded-sm px-1 text-fg-faint outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2" onClick={() => setDismissedNote(modeNote)}>
            ×
          </button>
        </p>
      )}
      {!unstarted && <QueueList appSessionId={appSessionId} queue={queue} busy={isBusy(status, queue.entries)} sessionId={sessionId} cwd={cwd} client={client} />}
      {rewoundEdit && <ResubmitLine resubmit={resubmit} onSend={() => void sendInlineEdit(client, appSessionId)} onLeave={() => cancelInlineEdit(appSessionId)} />}
      {swap.notice && <RequestCard key={swap.notice.id} item={swap.notice} request={null} placement="docked" paneIndex={paneIndex} />}
      {/* R2: a plugin's band above the frame, only while a plugin draws one */}
      {!unstarted && <PluginBand appSessionId={appSessionId} working={working} />}
      <Frame
        appSessionId={appSessionId}
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
        dirty={repo?.status?.dirty ?? false}
        ring={unstarted ? null : <ContextRing appSessionId={appSessionId} />}
        attachments={attachmentsOf(doc)}
        editorHandle={handle}
        editor={
          <div ref={boxRef}>
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
              onEscape={onEscape}
              onSubmit={onSubmit}
              suggestion={suggestion}
              onSuggestionTaken={() => setSuggestion(null)}
            />
          </div>
        }
        submit={<SubmitControl decision={decision} multiline={isMultiline(doc)} onPrimary={onPrimary} />}
      />
      {/* R2: a plugin's hint under the frame, only while a plugin draws one */}
      {!unstarted && <PluginHint appSessionId={appSessionId} isDraft={!draft.empty} isWorking={working} />}
    </section>
  );
}

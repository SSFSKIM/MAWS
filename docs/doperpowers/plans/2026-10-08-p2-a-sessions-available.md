# P2-A — Sessions available on demand: execution document

> **Parent:** `docs/doperpowers/plans/2026-10-08-p2-daily-driver.md` (the P2 composite spec), child id **`P2-A`**, parent pin git blob `8814d733db1b3c50798b9d3ec766985b29e05420`. Interface ledger `docs/doperpowers/plans/2026-10-08-p2-interface-ledger.md`, pinned at dispatch as blob `d523aeffd58ae81f0e8bea06cd9bfd2647d810bc`; its §1 X22 row as amended at master `cba250d3` (spec Decision Log 16) is read here. Root spec: `docs/charter.md`. This document carries the constraints, the residue design and the milestones; the design it inherits lives in the parent's §4 and its section "P2-A" and is cited, never restated. Authored 2026-10-08/09 by P2-A's author (an author pass: no implementation).

## 1. Purpose

Today a session MAWS did not start in this app run is a wall of "The session is not running": `/plugins`, `/skills`, the context ring, Session info, the model, mode and directory chips, `/btw`, Send to main and Send itself refuse until the owner finds a Resume. After this child, every durable session behaves as running. Opening a session shows its transcript and the facts MAWS last observed for it, labelled with when ("Loaded last time, 2 days ago"), and starts nothing. The owner's first action that needs an engine (Send, a chip change, a Refresh or Load now, `/btw`, Send to main, a peer reply, a resubmit, an answer from a question or comment card) starts one, shows "Starting…" inside the surface that asked, and then does what was asked, once. A session a terminal holds stays read-only with the existing Take over. Nothing starts on mount, on a session switch, on a poll or on a timer, so hundreds of indexed sessions still cost zero processes.

How to see it working: open a discovered terminal session in MAWS (no engine starts; Session info and the ring show last-observed facts or "Not observed yet"), type and Send (the composer says "Starting…", the message is sent once the engine is ready, the transcript continues); in another exited session open `/skills` (the body says it has not been read and offers Load now; Load now shows "Starting…" and then the skills). M3's Concrete Steps give the exact runs.

## 2. Progress

- [x] (2026-10-09 00:30Z) Grounding read: the parent §1 to §8, the ledger, the A-D grounding, owner report C, the consolidated plan §3.A and §4 decision 4, review 1 findings 1, 3, 4, 5, and the code named in §5.
- [x] (2026-10-09 01:10Z) M0 dispatched: the U1 probe runs under the shared live harness (scratch config home, relay, owner-file check) in this worktree.
- [x] (2026-10-09 02:00Z) Residue design written (§5) with both U1 branches; ledger proposals, charter lines, open questions (§8 to §10).
- [ ] M0 verdict recorded in §5.7 and Surprises; fixture `spikes/protocol-probe/fixtures/pass3/p2-no-prompt-resume-1.jsonl` committed with its findings.
- [ ] M1 — acquisition (X16) and Send for every eligible record (after P2-0 lands).
- [ ] M2 — observed facts (X17) (may run before M1: no dependency on P2-0).
- [ ] M3 — the controls, the resource and W7 regressions, the acceptance run.

## 3. Inheritance (pre-landed design; not re-litigated)

Binding, from the parent: **§4.1** availability apart from process status, one acquisition entry that joins, explicit gestures only, the budget and keep-alive rules unchanged, terminal-held read-only with the existing Take over, C10's "never auto-resumes" read as "no blanket replay"; **§4.2** the host owns the observed-facts snapshot, a separate file beside the state file, recovered once from the raw journal, absent for terminal-only sessions, exposed by one main read beside `session.digests`, freshness labelled, unknown never empty, defaults never labelled observed, an old effective mode never confirming a new requested one; **§4.3** the human send seam (X22), which A makes resumptive. The section "P2-A" (§5): purpose, G1 to G5 and M0, edges (blocked-by P2-0 for G1 only), slice order M0, M1, M2, M3, contracts (owns X16 and X17; extends X22, X2, X6; preserves X4), and the rule that A edits none of `PluginsWidget.tsx`, `SkillsWidget.tsx`, `SandboxWidget.tsx` (P2-B's) and delivers through `widgets/read.ts` and `WidgetFrame.tsx`. Contracts §6: X16, X17, X22 (as amended by Decision Log 16), X2, X6, X4 (old request ids stay retired; resuming reactivates no approval), X13 (host transport invariance). Owner decision 4 of the consolidated plan (`docs/doperpowers/evidence/p1-e11/owner-notes/00-consolidated-plan.txt` §4): an engine starts on the owner's first action that needs it; saved facts first; terminal-held read-only with explicit Take over. Advisory precedent: report C §4 A to E (`docs/doperpowers/evidence/p1-e11/owner-notes/C-session-not-running.txt`), Claude Desktop's guarded `warmSession` and pending next-start settings, T3's `ensureSessionForThread`.

## 4. Acceptance (observable; refines G1 to G5 and §2 item 1)

Each item names the gate it proves. "Exited session" means a session record with no ready process: discovered from disk and never run, stopped, crashed, released by the memory budget or the supervisor's idle clock, or evicted from the host's exited rows.

1. **(G1, Send)** In an exited session the composer's Send is enabled with the detail "Starts this session". Send keeps the text in the editor (locked) while the submit control reads "Starting…", then the message is sent and the editor clears; the transcript continues in the same conversation (the record's engine session id). An untrusted directory docks the trust card holding the message; accepting it starts the session and sends the message. An archived session's Send is disabled ("Archived · unarchive it to continue"; nothing is unarchived); a terminal-held one's is disabled with the holder's words beside the existing Take over; a missing directory refuses with "Directory not found: <path>" and the text stays.
2. **(G1, join)** Two widget Load nows and a Send fired within one tick on one exited session produce exactly one `session.launch` in the host's journal and exactly one user frame for the message; every caller is answered the same outcome. A Send while a start is already in flight (the explicit row Resume, a card's continuation, another surface's Load now) joins it and is never answered "starting:" or "This session is already running".
3. **(G1, the seam)** A question-card choice or a comment card's Reply (C and E1, through X22) on an exited session starts it and delivers the prompt; the seam's result says `started: true` with the host's disposition (`sent` with its uuid, or `queued` with its queue id when an earlier joined prompt is still in the host's queue).
4. **(G2, facts)** For a session MAWS ran before, `/plugins`' loaded list (on whichever plugins widget is on master, §10 Q2), the context ring and Session info show the last observed values at once, each labelled with when ("Loaded last time, 2 days ago"; "Last reading, 3 hours ago"); a live session's facts read "Loaded now". A terminal-only session reads "Not observed yet" where a fact would be, never an empty list and never "not running". The snapshot survives a renderer reload, a supervisor restart and the eviction of the session's exited row.
5. **(G3, controls)** Opening any `useEngineRead` widget, the context popover or Session info on an exited session starts nothing: it shows the cached or observed facts and a Load now or Refresh. Load now, Refresh, a model, effort, mode or add-directory choice shows "Starting…" inside that surface and then the read or the change; the model chip shows the requested model, marked pending, until the engine acknowledges it; choosing Bypass still asks its inline confirm before anything starts and reports the effective mode afterwards. Nothing silently reloads plugins or sends a prompt to populate a surface.
6. **(G4)** A terminal-held session's surfaces show its facts read-only; their Load now gives way to the holder's actions (Attach, Fork, Take over: the existing `HolderActions`). A terminal that starts while MAWS acquires is found by the guards (`held`, no launch); one that starts after MAWS launched contends as W7 defines (MAWS's branch pinned, no flip) and, once it exits, the session folds back as today.
7. **(G5)** With 200 indexed sessions and every slash widget and panel tool mounted on exited sessions, the host launches nothing; a session the budget released while its widgets stay mounted is not relaunched by them or by Session info's 30 s refetch; a deliberate Load now relaunches it once.
8. **(M0)** The U1 fixture and its findings are committed; §5.7 records which branch binds and, where the verdict changes a trigger, the owner's answer (§10 Q1).

## 5. Residue design

### 5.1 Terms

- **Availability** — what an action can do with a session now, one of X16's eight values, derived in main (§5.2). Distinct from the engine host's process status (`EngineSessionStatus.process`: starting, initializing, ready, exiting, exited), which stays as it is for supervision and diagnostics.
- **Acquisition** — main's one entry that makes a session usable: it answers at once for a ready session, joins a launch already in flight, or runs the existing guarded resume (`guardResumeStart` then `runResume`, `src/main/sessions/start-guards.ts`, `resume.ts`) and answers when the engine is ready or the attempt failed (§5.3).
- **Explicit gesture** — an owner act in an event handler: a click, a keypress, a menu choice, a typed command's Enter. Opening a surface is not an acquiring gesture (§4.1): mounting, switching sessions, a query refetch, a poll and a timer never acquire.
- **Observed facts** — X17's snapshot of what the engine last reported for a session, each fact with the time and launch it came from (§5.5).
- **Dormant** — a surface's state on a session that has a record and no ready process: it shows what is known and offers the gesture that loads more.

### 5.2 Availability: derivation and home

`availabilityOf(record, status, memory)` is a pure function in a new `src/main/sessions/availability.ts`, first match wins:

| # | Condition | Availability |
|---|---|---|
| 1 | `record.archived` | `archived` |
| 2 | `status.process === 'ready'` (W7's contested `self` included) | `usable` |
| 3 | an acquisition, start or take-over of this id is in flight in main (`memory.inFlight`), or `status.process` is `starting` or `initializing` | `starting` |
| 4 | `record.holder.kind` is `terminal` or `background_job` | `foreign_held` |
| 5 | `memory.last` is set (the last attempt in this app run answered `needs_trust`, `missing_directory`, or failed) | that kind: `needs_trust`, `missing_directory`, `failed` |
| 6 | otherwise (no status; `exited` for any reason, crash and release included; `exiting`) | `resumable` |

Decisions, each with the alternative rejected:
- **Home: `SessionDigest.availability`** (required field, `src/shared/ipc/schema/session.ts`), computed by `SessionReadModel` (`src/main/sessions/read-model.ts`) in `commit` from its own records and statuses plus the acquisition memory, so every record already carrying a digest carries it and every change rides the existing `session.digest` revision order. `observeRecord` recommits when availability moves (an archive, a holder change). Rejected: a key on `SessionRecord` (the index's durable row cannot hold process status or main's memory) and a separate `session.availability` event (a second channel with its own ordering against the digest).
- **No IO in the derivation.** `foreign_held` reads C4's projected holder (advisory; the guards re-read the registry fresh and fail closed). `needs_trust` and `missing_directory` are what the last attempt's guards answered in this app run, cleared when the next attempt begins. Rejected: a trust read and a directory stat per record (or per visible session): they would put the global config read on the session switch for a state the next gesture's guards answer in milliseconds anyway.
- **`failed` is an attempt's failure, not a crash.** A crashed process is `resumable` (the digest's phase still says `failed` for the sidebar's badge); `failed` means MAWS's own last start of it in this app run ended in an error, whose message the surfaces show; the next gesture retries. A crash is not a reason to refuse the owner's next Send.
- **Memory.** The service publishes `{inFlight, last: {kind, at, message} | null}` per id through a new read-model writer method, `observeAcquisition(appSessionId, memory)`; it is main's in-memory state (D-16), never persisted. Main's wiring (`src/main/index.ts`) passes the read model's writer into the service as a new optional dep `acquisitions`.
- **Renderer accessor.** `useAvailability(appSessionId)` in a new `src/renderer/src/sessions/availability.ts`: `usable` when the renderer's engine status is ready (the status may arrive before the digest), else the digest's value, else `resumable` for a known record, else null (an unstarted intent, which C10's setup owns as today).

### 5.3 Acquisition (X16): `session.acquire`

**Command.** `session.acquire {appSessionId, reason, options?}` (main-owned, `src/shared/ipc/schema/session.ts`, handler in `src/main/sessions/service-register.ts`, implementation `SessionService.acquire` in `service.ts`) answers `AcquireOutcome` **after** the launch it awaited:

```ts
// src/shared/sessions/setup.ts
export const AcquireOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ready'), appSessionId: AppSessionIdSchema, launched: z.boolean(), joined: z.boolean() }),
  ...StartOutcomeSchema.options.filter((o) => o.shape.status.value !== 'starting' && o.shape.status.value !== 'already_live'), // needs_trust, relay_unreachable, held, archived, missing_directory, invalid, refused: verbatim
  z.strictObject({ status: z.literal('failed'), appSessionId: AppSessionIdSchema, message: z.string(), resources: SetupResourcesSchema }), // the setup's error outcome, verbatim
]);
// reason: 'send' | 'chip' | 'read' | 'side' | 'peer' | 'resubmit' | 'resume'; options: StartOptionsSchema (a card's trust decision or route)
```

Why a separate command rather than `session.start` with a join flag (the ledger's alternative): `session.start` answers when its guards pass (`starting`) and streams the rest as `session.setup`, so a caller that must run its operation once would have to correlate a stream; acquisition's callers need the end of the launch, and main already holds it (the take-over path captures a resume's outcome the same way, `service.ts` `takeOver`). The guard answers stay `StartOutcome`'s variants unchanged, which is X16's "the existing start-outcome shape"; two variants are added for the end of the launch the caller awaited. The IPC call has no renderer-side timeout (`src/renderer/src/ipc/client.ts`); main's own bounds apply (`WATCHDOG_MS` 150 s, the no-output retry).

**The in-flight registry (the join).** `SessionService` gains `inflight: Map<AppSessionId, {options: string; guarded: Promise<StartOutcome>; done: Promise<AcquireOutcome>}>` (options as canonical JSON, `{}` for none). Every launch of a record registers in it **synchronously, before its first await** — that tick is the linearization point of "one launch per session": `acquire`, `startSession`'s record branch, and `takeOver` (its `done` resolves `ready` when its resume reached ready, else `failed` with the take-over's message). The entry goes when `done` settles. Join rules:

| Caller arrives while an entry exists | Answer |
|---|---|
| `acquire` with no options, or equal options | `await done` (a `ready` answer says `joined: true`) |
| `acquire` with different non-empty options (a card's continuation carrying a trust decision or a route) | waits for `done` to settle, then runs its own attempt (a different question deserves its own guards) |
| record `session.start` with no message (the explicit row Resume from an older renderer path, another window) | `await guarded`: the same `StartOutcome` the first caller got, never `IntentRefused('starting')` |
| record `session.start` carrying a message | refused as today (`IntentRefused('starting')`): after M1 no renderer path sends a message through a record's start, so this stays fail-closed for a stale caller rather than dropping a message |
| `takeOver` | refused as today (`self`), an entry in the registry counting as a start in flight (an acquisition sits in its pre-lock steps without the `starting` mark) |
| intent operations (`patch`, `release`, `discard`, `resolveWorktree`) | unchanged (records have no intent) |

**One acquisition, in order** (`acquireOnce`; each step's failure answers the waiters and records `memory.last`):

1. Register the entry; publish `memory.inFlight = true`; clear `memory.last`.
2. `await this.ready()`. Record absent: an intent → `refused` (`unknown_session`, "an unstarted session starts with its first message"); neither → `refused` (`unknown_session`).
3. Read the reservation (`reservationOf`, `src/main/sessions/context.ts`). `ready` → `ready {launched: false}`. `exiting` (a stop or a budget release mid-ladder) → wait until no reservation, polling as `until` does, at most `EXIT_WAIT_MS = 15_000` (the stop ladder's 7 s with margin); still there → `failed` ("The session is still stopping."). `starting`/`initializing` with no registry entry (a launch outside the service: none in production, a harness's direct `session.launch`) → watch it to ready or exit with `LaunchWatch` (`src/main/sessions/launch-watch.ts`) under the watchdog.
4. Under the id's lock (`this.lock`) and the `starting` set, run `guardResumeStart(s′, record, {message: null, options}, this.resumeMessages)` where `s′` is the service's `Setup` with `emit` wrapped to capture the `session.setup` outcome (the take-over's pattern). A card or refusal resolves `guarded` and `done` with that answer; `needs_trust` and `missing_directory` go to `memory.last`.
5. `await run()` (`runResume`: the launch gate, the trust bootstrap, the holder re-check, `fs.unfollow`, `session.launch` with `resumeLaunchSpec(..., {browserBackend: s.browserBackend(id)})`, ready, the one no-output retry). The captured outcome maps: `ready` → `ready {launched: true}`; `error` → `failed` (and `memory.last`); `held` → `held`; `relay_unreachable` → `relay_unreachable`.
6. Finally: leave the `starting` set, release the lock, publish `memory.inFlight = false`, delete the entry.

E13's socket comes free because the only launcher is `runResume` (`launch-mapping.ts` `resumeLaunchSpec` already threads `browserBackend`); M1's test asserts the acquired launch's spec carries `extraSettings.env.CUA_BROWSER_BACKENDS`. The memory budget is untouched: a launch sets `lastUsedAt` to its launch time (`src/engine-host/session.ts`), so an acquired session is the least likely LRU candidate, and the operation follows ready within milliseconds, before the next memory sample can make it a candidate. Rejected: an "operation hold" keep-alive reason (report C §4 E) — it adds a hard reason to `budget.ts` for a window the sampling interval already covers, and a release in that window is the budget working as designed (the next gesture reacquires; nothing loops, because only gestures acquire). `reason` is validated and logged (`[sessions] acquire <id> (<reason>)`); nothing branches on it. `src/renderer/src/app/supervisor-notices.ts` `LAUNCHES` gains `session.acquire`, so a refusal while an incompatible supervisor is waited on brings its banner back. X4 holds by construction: acquisition launches through the same resume, whose broker starts with no requests; the exited launch's items stay retired.

**Renderer.** `acquireSession(appSessionId, reason, options?) → Promise<AcquireOutcome>` in a new `src/renderer/src/sessions/acquire.ts`: invokes the command (an IPC failure maps to `failed` with its message), docks a trust or relay card for `needs_trust`/`relay_unreachable` through the existing `dockFor` in `setup-actions.ts` (with the composer's message only when the caller passes one, §5.4), and offers `acquisitionWords(outcome)` for surfaces to show inline (holder words from `holder-words.ts`; "Directory not found: <path>"; "Archived · unarchive it to continue"; the failure's message). It never toasts on its own; the surface that asked shows the words where the "Starting…" was.

**The explicit row Resume** (`src/renderer/src/sessions/actions.ts` `resume`) calls `acquireSession(id, 'resume')` and keeps its toasts; it joins like everything else. C12's send-to-resume registration (`src/renderer/src/composer/resume-seam.ts`, `registerReleasedResume` in `connect.ts`) is retired: the seam acquires for every eligible record, released or not.

### 5.4 Acquisition inside the seam (X22)

P2-0 extracts `sendHumanPrompt` into `src/renderer/src/composer/submit/send-human-prompt.ts` with no behaviour change; A extends it. Proposed result shape (the architect folds the final one into X22, §8):

```ts
type SendHumanResult = {
  disposition: 'sent' | 'steered' | 'queued' | 'held' | 'refused';
  started: boolean;        // A: this call acquired the engine first (launched it, or joined a launch in flight)
  messageUuid?: MessageUuid; // sent, steered
  queueId?: string;          // queued (the host's queue, paused or non-empty; Decision Log 16)
  reason?: string;           // refused: the words; held: 'trust' | 'relay'
};
```

`started` is a field beside the disposition because an acquisition that succeeds still ends in one of the host's three answers, and C's question states need that answer (a host-queued answer stays queued until its uuid is known); the flat `started` disposition would lose it. `held` is new: a trust or relay card now holds the message (composer origin only) and will send it; the composer clears its editor as it does for any accepted message.

Algorithm, for a session with a record:
1. Ready status → P2-0's path unchanged (steer `next` while busy, send when idle), `started: false`.
2. Otherwise `acquireSession(id, 'send')`. On `ready`, send with `session.send` and pass the host's answer through (`sent` with its uuid, or `queued` with its queue id when something joined earlier is already submitted), `started: true`. It does not steer: the renderer's status may trail the acquisition's answer, and the host's queue orders a send behind whatever the joined launch already submitted.
3. `needs_trust` or `relay_unreachable`: origin `composer` → the card docks holding the message (the existing `dockFor`, renderer-held) → `held`. Any other origin → the card docks **without** the message (so the owner sees why in that session's composer) → `refused` with the card's words; C's question stays unanswered, E1's card keeps its text. Rejected: handing another surface's text to the composer's card, which would send it later out of its context.
4. `held` (a foreign holder), `archived`, `missing_directory`, `invalid`, `refused`, `failed` → `refused` with `acquisitionWords`.

Why acquire-then-send rather than today's resume-with-message (main holds the message and sends it at ready): the message stays in its origin until the host accepts it (G1's "editor contents kept until accepted", literally), a joined Send needs no message list in main, the seam gets the host's uuid or queue id directly, and a failed launch needs no hand-back. The record's card continuation follows: `continueSetup` (`src/renderer/src/sessions/setup-actions.ts`) gains a record branch that runs `acquireSession(id, 'send', options)` and then `sendHumanPrompt(id, docked.content, {origin: 'composer'})`, returning the docked message to the editor (`returnMessage`) on any refusal, as today's continuation does. Intent continuations are untouched.

**The composer.** `submitState` (`src/renderer/src/composer/submit/submit-state.ts`) takes `availability` in place of `released`. For a session with a record and no ready status:

| Availability | Send | Reason / detail |
|---|---|---|
| `resumable`, `failed`, `needs_trust`, `missing_directory` | enabled when not empty | detail `STARTS` = "Starts this session" |
| `starting` | enabled when not empty (joins) | detail `SENDS_WHEN_STARTED` = "Sends once the session has started" |
| `foreign_held` | disabled | the holder's words (`holderWords`), the existing `HolderNotice` beside it offering Take over |
| `archived` | disabled | `ARCHIVED` = "Archived · unarchive it to continue" |

`!` and `#` modes acquire too (the composer calls `acquireSession(id, 'send')` before `dispatchByMode`): they are deliberate owner submissions like Send, and the C12 rule `RESUME_FIRST` ("Send a message to resume this session first") was exactly the ceremony this child removes. `ENDED` and `RESUMES` and `RESUME_FIRST` go. While the acquisition runs, the editor keeps the text locked (its in-flight lock) and the submit control reads "Starting…" from availability `starting`; on `held` or a send the editor clears; on `refused` the words show as today's refusal toast with Retry and the text stays. Unstarted intents keep C10's path.

### 5.5 Observed facts (X17)

**File.** `<userData>/engine-host/state/<appSessionId>.observed.json`, beside the state file, written and recovered by the engine host only; never a key in the strictly parsed `StateFileSchema` or the stored launch spec. Rejected: main writing it from the events it folds (one writer, but §4.2 binds the owner to the host), and main reading the file directly with no host round trip (recovery then needs a second writer).

**Schema** (`src/shared/engine/observed-facts.ts`, version 1):

```ts
type Fact<T> = { value: T; at: string /* the frame's journal time */; launchId: string } | null; // null: unknown
interface ObservedFacts {
  version: 1;
  appSessionId: AppSessionId;
  engineSessionId: string | null;
  writtenAt: string;
  source: 'live' | 'journal';             // how the file was last written
  engineVersion: Fact<string>;            // system/init claude_code_version
  model: Fact<string>;                     // system/init model (the resolved id)
  effort: Fact<Effort>;                    // a get_settings answer's applied.effort (the chip's own read passes through the host)
  mode: Fact<PermissionMode>;              // the effective mode: initialize's current_permission_mode, system/init, system/status, a set_permission_mode answer
  outputStyle: Fact<string>;               // system/init output_style
  plugins: Fact<{ plugins: {name: string; path: string; source: string | null; version: string | null}[]; errors: {plugin: string; type: string; message: string; path: string | null}[]; warnings: {plugin: string; type: string; message: string}[] }>; // system/init, or a successful reload_plugins (which keeps the last init's errors and warnings, as session-status.ts does)
  contextUsage: Fact<{ percent: number; totalTokens: number; maxTokens: number; autoCompactThreshold: number | null }>; // a get_context_usage answer, mapped as the digest's context
}
```

Per-field time and launch, not X17's one `observedAt`: the facts arrive at different moments (the context after the last turn, the plugins at the first turn's init, the mode at any status frame), and one time would label an older fact as fresh. Unknown is `null`; a confirmed empty plugin list is a fact with `plugins: []`. The reader is tolerant: each field parses on its own and one that fails reads as unknown, unknown keys are ignored, a higher `version` is read the same way (fields are additive by rule), and an unparsable file reads as `null` and is left in place (it holds nothing irreplaceable; the next live write replaces it). Writes are temp-then-rename, as the state store's.

**Writing (host).** A new `ObservedFactsRecorder` (`src/engine-host/observed-facts.ts`), one per `EngineSession`, fed where the session already learns each fact: `SessionStatusTracker.systemInit` (main lane only), `noteReload`, the context sample's answer, every effective-mode change, `get_settings` answers, the initialize response. It merges into the snapshot loaded at launch, so a launch that observed no init (a no-prompt start) keeps the previous launch's plugins, and writes trailing-debounced (500 ms) and once more at exit before the exited status is published. Storage behind a small port, `ObservedFactsStore` (`src/engine-host/store/observed-facts-store.ts`, file and memory implementations), so the state store's strict reader is untouched; the host's `session.forget` (delete conversation) removes the file; archive keeps it (archive keeps the state file, charter §12 C10).

**`pluginsObservedAt`.** `EngineSessionStatus` (`src/shared/engine/status.ts`) gains `pluginsObservedAt: string | null`, null until this launch's init or reload reported its plugins, so a freshly acquired engine never reads "The engine loaded no plugins" before it has said so (report C §2.5).

**Recovery (host, once per session).** A new host-owned read `engine.observedFacts {appSessionId} → ObservedFacts | null` (`src/engine-host/ipc.ts`): a live session answers its recorder's snapshot; a file present answers it; no file and journal launches present (`<userData>/engine-host/journal/<appSessionId>/`, `src/engine-host/journal.ts`) → recover: walk the launches newest first, stream each launch's rows, take each field from the newest launch that carries it (main-lane `system/init`; the `in` control response matched to an `out` `reload_plugins`, `get_context_usage`, `get_settings` request by request id; initialize's and status frames' modes), stop when every field is known or the launches run out, map the context answer with the normaliser's own mapping (no second parser), write the file with `source: 'journal'` by exclusive create (a live write that got there first wins), and answer it. A recovery that found nothing still writes the all-unknown snapshot, so recovery runs once. No file and no journal → `null`, nothing written (terminal-only). Recovery happens on the first read, so nothing scans at startup.

**Exposure (main).** `session.observedFacts {appSessionId} → ObservedFacts | null`, main-owned, beside `session.digests` (registered in a new `src/main/sessions/observed.ts`), relays to `engine.observedFacts`; a host error answers `null` and logs. Rejected: a main-side fallback reading the file while the host is down (the host down is a banner state already; facts reading "Not observed yet" for that minute is honest).

**Renderer.** In a new `src/renderer/src/sessions/observed.ts`:
- `useObservedFacts(appSessionId, {enabled})`: `useCommand('session.observedFacts')` keyed with the engine status's `launchId|process` (so it rereads after an exit), stale otherwise forever; no new event.
- `freshness(fact, live)` → `{kind: 'now'} | {kind: 'last', at} | {kind: 'unknown'}` and the words: `LOADED_NOW` "Loaded now", `LOADED_LAST(at)` "Loaded last time, <relative>", `LAST_READING(at)` "Last reading, <relative>", `NOT_OBSERVED` "Not observed yet".
- `useLoadedPlugins(appSessionId)` → `{plugins, errors, warnings, freshness, refresh(): Promise<AcquireOutcome | null>}`: the live status's list with `now` once `pluginsObservedAt` is set; else the observed fact with `last`; else `unknown`. `refresh` is §5.7's branch. B's library and the old widget's Loaded section consume this one hook; D may consume `useObservedFacts`.
- Precedence everywhere: live (ready, and the fact observed in this launch) over observed (labelled) over unknown. The record's requested model, effort and mode are shown as requested, never as observed; after a chip choice the chip shows the requested value marked pending until the live status confirms it (an observed mode never confirms).

### 5.6 Surfaces: explicit gestures

The rule: a surface calls `acquireSession` only from an owner gesture's handler; `useEngineRead` and every query stay enabled only while the process is ready (unchanged), so mounts, switches, refetches, polls and timers cannot launch anything, structurally. M3's resource test pins it.

- **`useEngineRead` (`src/renderer/src/widgets/read.ts`).** `ReadState` loses `not_running` and gains `dormant` (record, no ready process), `starting` (availability `starting`) and `unavailable` (`foreign_held`, `archived`, or the last acquisition's refusal, with words). While dormant the hook still returns the query cache's last answer as `data` with `readAt` (`dataUpdatedAt`), and gains `load(): Promise<AcquireOutcome>` (acquire `read`; the query enables itself at ready and reads, so the read is the existing one).
- **`WidgetFrame` (`src/renderer/src/widgets/WidgetFrame.tsx`)** owns the three states for every widget from its `appSessionId`, so B's widgets get them without edits: `dormant` with no cached body → "Not read yet." and a Load now button; `dormant` with a cached body → the body under a line "Read <relative>" (when the consumer passes `readAt`) and a Refresh button; `starting` → a "Starting…" line above whatever body there is; `unavailable` → the words, and for `foreign_held` the existing `HolderActions` (`src/renderer/src/sessions/HolderActions.tsx`: Attach, Fork, Take over) in place of the button. Load now and Refresh call `acquireSession(id, 'read')`. `NOT_RUNNING` (`statusline/mode-menu.ts`) is no longer shown by any surface.
- **Model and effort (`src/renderer/src/widgets/ModelSelector.tsx`).** A third binding, `useDormantBinding`, for a record with no ready status: options from the route's catalogue and the remembered listed models (`rememberListedModels`), current = the record's requested model with the observed model named beside it when known; `setModel`/`setEffort` mark the choice pending (the selector's existing `pending` display), call `acquireSession(id, 'chip')`, then the existing `session.setModel`/`session.setEffort`; the live binding's pending-until-confirmed logic takes over once the status arrives; an outcome other than `ready` clears the pending mark and shows the words. Fast mode and the route segment are hidden while dormant (they need the live status).
- **Mode (`src/renderer/src/statusline/mode-menu.ts` `liveModeBinding`).** `disabled` follows availability (`foreign_held` and `archived` words; null otherwise); `set` acquires (`chip`) and then calls `session.setPermissionMode`, the refusal words as today. Bypass's inline confirm in `ModeMenu.tsx` runs before `set`, so a cancelled confirm starts nothing.
- **Add directory (`src/renderer/src/composer/frame/bindings.ts` `liveBindings`).** `writable` follows availability; `set` acquires (`chip`) and then runs the existing read-then-apply. The model binding's `set` there follows the same rule. `bindings.test.ts`'s exited-and-absent-disabled case is rewritten to the availability table.
- **Context (`ContextRing.tsx`, `statusline/ContextPopover.tsx`).** The ring reads the digest's context, else the observed `contextUsage` (its title "Last reading, <relative>"). The popover, not live: the observed or digest reading labelled "Last reading, <relative>" (or "Not observed yet") and a Refresh (acquire `read`; the host samples the context at ready and the popover's full read enables); Compact only when live.
- **Session info (`src/renderer/src/tools/session-info/SessionInfoView.tsx`).** Not live: the sections take the observed model, effort, mode, output style, plugin count and context, each labelled "Last observed <relative>" or "Not observed yet", and a Refresh (acquire `read`); `INFO.notLive` goes. Its 30 s refetch keeps reading only while ready.
- **Panel Plugins summary (`src/renderer/src/panel/summary/Plugins.tsx`).** The count from `useLoadedPlugins` with its freshness word; reload controls only when ready, as today; it mounts on a session switch (D-10), so it never acquires.
- **`/btw` (`side/btw.ts`, `BtwWidget.tsx`, `BtwView.tsx`).** Ask and Retry on an eligible exited session acquire (`side`) and then ask; a typed `/btw <question>` (its Enter is the gesture) does the same and answers true.
- **Send to main (`side/CommentComposer.tsx`).** Enabled for every eligible availability; on send it acquires (`side`) and then runs the existing `side.sendToMain`. When E1 routes Send to main through the seam, the seam's acquisition covers it and this hunk goes. Shared file with E1 (§6.3).
- **Peer reply (`transcript/view/rows/PeerComposer.tsx`).** Sends through the seam with origin `peer` (which acquires) instead of its own `engine.has` gate.
- **Resubmit (`composer/InlineEdit.tsx`, `composer/resubmit-seam.ts`).** An edit's resubmit on an eligible exited session acquires (`resubmit`) and then runs the existing flow.
- **Background summary (`tools/agents/background/BackgroundSummary.tsx`).** Its `engine.has` predicate becomes `process === 'ready'` (an exited status is not live); it acquires nothing ("Resumes with the session" stays).
- **Unchanged:** `ComposerAppKeys.tsx`'s interrupt (nothing to interrupt), the engine-surface sites and panes (they attach when the engine is live), the request cards (X4), Rename's offline path, `/plugins`' CLI sections.
- **`/plugins`' Loaded section** is drawn by `PluginsWidget.tsx`, P2-B's file, whose frame state follows the CLI read; A's frame states do not reach it. A ships `useLoadedPlugins`; B's library calls it. If A lands before B, §10 Q2 asks for one dated hunk in the old widget's Loaded section; otherwise G2's `/plugins` half is proved on B's widget.

### 5.7 U1 and the fresh loaded inventory

U1 (parent §4.10) asks what a no-prompt start does on the installed engine. Its verdict decides two things: how `/plugins`' Refresh gets "Loaded now", and whether §4.1's triggers stand without asking the owner.

- **Branch Y — `reload_plugins` answers before the first turn with the loaded list.** `useLoadedPlugins().refresh` = `acquireSession(id, 'read')` then `session.reloadPlugins` (`src/renderer/src/widgets/plugins/reload.tsx`'s path), and the list reads "Loaded now". `reload_plugins` is a real reload (it re-reads the plugin directories), but right after a launch it loads what the launch loaded, and it runs only on the owner's Refresh, never on open.
- **Branch N — it does not answer usefully before a turn.** `refresh` acquires and the list stays "Loaded last time, <relative>" with the line "The current list arrives with the next message"; nothing reloads silently and no prompt is sent (§4.1). `pluginsObservedAt` flips the list to "Loaded now" at the first turn's init.
- **The owner gate.** If the no-prompt start makes a billable model request through the gateway, writes or touches the session's JSONL (which reorders the terminal's own resume list), or runs SessionStart hooks, the verdict changes what a chip choice or a Refresh does beyond starting a process, so it goes to the owner before A binds the triggers (§4.1; §10 Q1). A proceeds on the recommendation there. If the owner declines, **Branch P** (Desktop's pending next-start settings) replaces the chips' acquisition: a model, effort, mode or directory choice on a non-live session writes the record's requested value through a new main command `session.record.setRequested {appSessionId, model?, effort?, mode?, additionalDirectories?}` and the chip reads "Applies at next start"; `resumeLaunchSpec` already launches with the record's requested model, effort, mode and directories, so the next Send carries them; Refresh in Branch P shows last-known only. Send, `/btw`, Send to main, peer replies, resubmits and answers keep acquiring in every branch (they are turns; the owner's decision 4 names Send).

**Verdict:** recorded here and in Surprises when M0's run reports (Progress tracks it).

### 5.8 What does not change

The memory budget, its hard reasons and the supervisor's idle clock (`budget.ts`, `supervision.ts`); no engine per sidebar row; no warm on view open (P2 §9 deferred); C10's restart rule (nothing acquires at app start or at tab hydration); W7's contested display (`chain-follower.ts`); the queue's recovery (a read-only acquisition submits nothing a recovered queue holds: entries release only at a turn's end or by the owner's own queue actions; M1's lifecycle table pins it); grants re-applied on resume; X4's retired request ids; the state file and its stored launch spec (no key added; A needs no sidecar version, so the ledger's §4 row for A becomes "none"); settings and index versions (none).

## 6. Execution

### 6.1 Constraints binding every milestone

- The parent's §4.1, §4.2, §4.3 (binding) and contracts X16, X17, X22, X2, X6, X4, X13 as cited in §3; owner decision 4. The engine is the unmodified installed binary (D-1); wire claims are checked against `spikes/protocol-probe/fixtures/` (§5.7's fixture included).
- Names: only those in §7 (Interfaces) and the ledger. Shared files take appended, dated blocks (`// P2-A start` … `// P2-A end`), the ledger's §6 rule: `src/shared/ipc/names/session.ts`, `src/shared/ipc/schema/session.ts` (A, C, D), `src/main/sessions/launch-mapping.ts` (A reads only; C writes), `src/renderer/src/composer/Composer.tsx` and `composer/editor/submit.ts` (P2-0 extracted the seam; A extends `send-human-prompt.ts`), `src/renderer/src/side/*` (E1).
- A edits none of `src/renderer/src/widgets/PluginsWidget.tsx`, `SkillsWidget.tsx`, `SandboxWidget.tsx` (P2-B's), except the one hunk §10 Q2 may grant, recorded as a dated ledger line.
- Copy: the person's words, no provenance footers (F2a's rule); light theme default; tokens only. The strings named in §5 are the proposals (§10 Q5).
- No settings, index or sidecar version. No new IPC beyond §7's. No timer, poll or effect that calls `acquireSession`.
- Live runs only under P1's harness rules: a scratch `CLAUDE_CONFIG_DIR`, `checkA15` before and after, the relay only through the engine and `GET /api/hello`, `--max-budget-usd` ≤ 1, every inherited `CLAUDE_*` dropped; never `~/.claude`, `dist/`, the owner's MAWS, its user data or index database.
- Heavy runs through the slot script, one e2e group at a time (P1 A-13).

### 6.2 Plan of Work

#### M0 — The probe U1 (spike)

Question: on the installed engine (2.1.295 at authoring; `TESTED_ENGINE_VERSION` 2.1.293), when MAWS's host starts a stopped session with no user frame (initialize, `get_status`, queue recovery, ready, `get_context_usage`), does `system/init` arrive, does the engine call the gateway, does `reload_plugins` answer before the first turn and with what, does the JSONL move, do SessionStart hooks run. Built as a temporary live case under `test/live/` on the shared harness (`test/live/support/harness.ts`, `live-host.ts` with `binary: null`), a SessionStart command hook in the scratch home's `settings.json` appending to a scratch log, and a loopback pass-through in front of the relay (`MAWS_RELAY_URL`, which `relayUrlFrom` accepts) logging only method, path and time; the case file is not kept (its steps are in the findings). Output: `spikes/protocol-probe/fixtures/pass3/p2-no-prompt-resume-1.jsonl` (provenance child `P2-A`, this document, the parent pin, engine version, cost) and `spikes/protocol-probe/findings-pass3-p2-a-u1.txt`. Promote-or-discard: the verdict selects §5.7's branch Y or N and, if any side effect shows, raises §10 Q1; nothing is promoted as code. Proof: `pnpm test:probes` passes with the fixture; §5.7's Verdict and Surprises carry it. Proves acceptance 8.

#### M1 — Acquisition and Send for every eligible record (X16, G1)

Blocked by P2-0's landing (the seam file). At its end, an exited session continues on Send, two Load nows and a Send launch once, a start in flight is joined, and the availability field rides every digest.
- **Touches:** `src/main/sessions/availability.ts` (new), `read-model.ts` (`commit`, `observeRecord`, `observeAcquisition`), `service.ts` (`acquire`, `acquireOnce`, the `inflight` registry, `startSession`'s record join, `takeOver`'s registration), `service-register.ts`, `context.ts` (`EXIT_WAIT_MS`), `src/main/index.ts` (the `acquisitions` dep); `src/shared/sessions/setup.ts` (`AcquireOutcomeSchema`), `src/shared/ipc/schema/session.ts` and `names/session.ts` (`session.acquire`, `SessionDigest.availability`, `AVAILABILITY`), `src/shared/ipc/schema.test.ts` pins; renderer `sessions/acquire.ts` (new), `sessions/availability.ts` (new), `sessions/setup-actions.ts` (`continueSetup` record branch, `resumeSession` via acquire), `sessions/actions.ts`, `sessions/connect.ts` (drop `registerReleasedResume`), `composer/resume-seam.ts` (removed), `composer/submit/send-human-prompt.ts` (A's extension), `composer/submit/submit-state.ts`, `composer/Composer.tsx` (availability input; `!`/`#` acquire), `app/supervisor-notices.ts` (`LAUNCHES`).
- **Interfaces:** produces `session.acquire`, `AcquireOutcome`, `Availability`, `SessionDigest.availability`, `acquireSession`, `acquisitionWords`, `useAvailability`, `SendHumanResult.started` and `held` (§7); consumes P2-0's `sendHumanPrompt`.
- **Decisions:** §5.2, §5.3, §5.4 own them. Pitfalls seen in the code: `startSession`'s record branch must capture its run's `session.setup` outcome (the wrapped `emit` of §5.3 step 4) to resolve its registry entry's `done`, and its join check comes before `refuseWhileStarting`; `refuseWhileStarting` runs before the lock and before `ready()`, so the registry's registration must also be synchronous at entry; `startSession` holds the id's lock across the whole run (`held()` in the run's `finally`), so `acquire` must not take the lock before consulting the registry or it serialises behind the start instead of joining it; `guardResumeStart` retains a message in `resumeMessages` on `needs_trust` — acquisition passes `message: null`, so nothing is retained; `dockFor` with a null message docks a card the continuation runs without a message (the record branch then sends nothing, which is right for a widget's acquisition).
- **Does not touch:** observed facts, widgets, chips other than the composer's submit control, the host.
- **Proves:** acceptance 1, 2, 3. Tests it adds (named by behaviour): the lifecycle table (`src/main/sessions/acquire.test.ts`), one row per state — disk-only never run, retained exited, evicted (no status), released (budget and idle), crashed, ready (no launch), starting (joined, `joined: true`, one launch), exiting (waits, then launches; still exiting after 15 s → `failed`), foreign-held (`held`, no launch), contested self (`ready`), archived (no launch, nothing unarchived), missing directory, trust refusal then the continuation with `trust: 'accepted'` (bootstrap then launch), route refusal (`relay_unreachable`) — each asserting availability before and after, the outcome, the number of `session.launch` calls and that the launch spec carries `CUA_BROWSER_BACKENDS`; the races (two acquires and a record `session.start` in one tick → one launch, deep-equal outcomes; an acquire with different options waits and runs its own); a recovered queue holding entries is not submitted by an acquisition; a pending permission at exit stays retired after acquisition (X4); `availabilityOf`'s table (`availability.test.ts`); `submitState`'s availability table (`submit-state.test.ts`, replacing the C12 released cases); the seam's `started`/`held`/`refused` cases (`send-human-prompt.test.ts`); the composer's c7 and requests tests pass unchanged for live sessions.

#### M2 — Observed facts (X17, G2)

No dependency on P2-0 or M1; runs first if P2-0 has not landed. At its end, every MAWS-run session has a facts file the host keeps current, a session MAWS ran before this build recovers one from its journal on first read, and the ring, the context popover, Session info and the panel's Plugins summary show them labelled (display only; their Refresh arrives in M3).
- **Touches:** `src/shared/engine/observed-facts.ts` (new: schema, tolerant reader, `Fact`), `src/shared/engine/status.ts` (`pluginsObservedAt`), `src/engine-host/observed-facts.ts` (new: recorder, journal recovery), `src/engine-host/store/observed-facts-store.ts` (new: port, file and memory), `src/engine-host/session.ts` and `session-status.ts` (feed the recorder; `pluginsObservedAt`), `src/engine-host/ipc.ts` (`engine.observedFacts`; `session.forget` removes the file), `src/shared/ipc/schema/engine.ts` and `src/shared/ipc/names/engine.ts` (`engine.observedFacts`), `session.observedFacts` in `schema/session.ts` and `names/session.ts`, `src/main/sessions/observed.ts` (new), renderer `sessions/observed.ts` (new), `composer/frame/ContextRing.tsx`, `statusline/ContextPopover.tsx`, `tools/session-info/SessionInfoView.tsx` (and its sections module), `panel/summary/Plugins.tsx`.
- **Interfaces:** produces `ObservedFacts`, `Fact`, `engine.observedFacts`, `session.observedFacts`, `EngineSessionStatus.pluginsObservedAt`, `useObservedFacts`, `useLoadedPlugins` (its `refresh` lands in M3), `freshness` and its words (§7).
- **Decisions:** §5.5 owns them. Pitfalls: `system/init` frames from subagents carry `parent_tool_use_id` and must not overwrite the session's facts (`session-status.ts` already skips them; the recorder sits behind that check); a launch that observed nothing must not erase a previous fact (merge, never replace); a no-prompt launch's tracker starts with `plugins: []` — the recorder records plugins only from init or reload, never from the tracker's initial value; the journal's `in` control response for `reload_plugins` is matched by request id to its `out` request (the response itself names no subtype); journals rotate into `<launchId>.<n>.jsonl` (read a launch's files in order); exported fixtures under `spikes/protocol-probe/fixtures/pass3/` (`e8-plugins-reload.jsonl`, `context-sample.jsonl`, `p1-side-thread-live-resume.jsonl`, M0's) are the recovery tests' inputs.
- **Does not touch:** acquisition, widgets' gestures, chips, `PluginsWidget.tsx`.
- **Proves:** acceptance 4 (except `/plugins`, which M3 proves). Tests: the recorder merges per field and keeps the previous launch's plugins across a launch with no init; subagent inits are ignored; the file survives the host's restart and the exited row's eviction (`EXITED_ROWS_MAX`); recovery from each fixture yields the fields the journal holds and nulls for the rest, writes once (a second read does not rescan: assert no journal read), loses to a concurrent live write; the tolerant reader (unknown keys, one bad field → unknown, a `version: 2` file, a truncated file → null, not moved); `forget` removes the file and archive keeps it; main answers `null` when the host errors; the renderer's precedence (live now > observed last > unknown; a record default never labelled observed); the ring, popover, Session info and summary render "Loaded last time, <relative>" / "Not observed yet" from a fixture snapshot (component tests); a renderer reload keeps the labels (e2e, §6.3).

#### M3 — The controls, the regressions, the acceptance run (G2's `/plugins`, G3, G4, G5)

After M1 and M2. At its end every surface of §5.6 shows facts while dormant and starts the engine only on its gesture, terminal-held sessions are read-only with the holder's actions, and the acceptance in §4 is run as written.
- **Touches:** `widgets/read.ts`, `widgets/WidgetFrame.tsx`, `widgets/copy.ts` (`FRAME` words), `widgets/ModelSelector.tsx`, the `useEngineRead` consumers that test `'not_running'` themselves (`AgentsWidget`, `CompactWidget`, `PermissionsWidget`, `ReloadPluginsWidget`, `RewindWidget`, besides `ModelSelector`: their branches move to the new states; at authoring no P2-B file references the literal, so the `ReadState` change compiles for them untouched), the other consumers passing `readAt` where they show a cached answer (optional), `statusline/mode-menu.ts`, `composer/frame/bindings.ts` (+ test), `statusline/ContextPopover.tsx`, `tools/session-info/SessionInfoView.tsx`, `sessions/observed.ts` (`useLoadedPlugins().refresh` per §5.7's verdict), `side/btw.ts`, `side/BtwWidget.tsx`, `side/BtwView.tsx`, `side/CommentComposer.tsx`, `transcript/view/rows/PeerComposer.tsx`, `composer/InlineEdit.tsx`, `composer/resubmit-seam.ts`, `tools/agents/background/BackgroundSummary.tsx`; e2e `e2e/sessions-available.spec.ts` (new) with a `package.json` script `e2e:available`; the one `PluginsWidget.tsx` hunk only if §10 Q2 grants it.
- **Interfaces:** consumes everything M1 and M2 produce; produces the `ReadState` change (`dormant`, `starting`, `unavailable`) and `EngineRead.load`/`readAt`, which B's widgets inherit through `WidgetFrame`.
- **Decisions:** §5.6 and §5.7 own them. Pitfalls: `useEngineRead`'s on-open refetch and `session.operation` refetch must stay gated on ready (they are the poll paths G5 forbids from acquiring); the model chip's pending mark must clear on any non-`ready` outcome or it lies; `ModeMenu`'s Bypass confirm is UI state before `set` — keep acquisition inside `set`; `applyBtw` returns `false` today to open the widget when not ready, and now acquires and returns `true`; `CommentComposer.tsx` is E1's file this wave: append a dated block, and if E1 has landed the card with Send to main through the seam, drop A's hunk.
- **Does not touch:** `PluginsWidget.tsx`, `SkillsWidget.tsx`, `SandboxWidget.tsx` (beyond Q2), the engine-surface sites, request cards, the budget.
- **Proves:** acceptance 4's `/plugins` half, 5, 6, 7, then the whole of §4 as the last step. Tests: the resource regression — (a) main with an index of 200 records hydrated and every tab restored: zero `session.launch`, zero `session.acquire`; (b) renderer: mount every registered slash widget and every panel tool on an exited session with an `ipc` spy: zero `session.acquire`, `session.start`, `session.launch`; flip a mounted session ready → exited (`reason: 'budget'`) and advance timers past Session info's 30 s: still zero; one Load now: exactly one `session.acquire`; (c) a focused session switch across 20 exited sessions: zero. The W7 regression — with the holder fake (`test/support/holder-host.ts`): a terminal appearing between the guards' first holder read and the launch (the bootstrap's re-check) → `held`, no launch; a terminal starting after MAWS's launch writes a sibling branch → MAWS's branch stays pinned while contested (no flip), the terminal exits → the follower refolds and availability returns to `usable`; no second-writer launch at any point. `WidgetFrame`'s three states and `HolderActions` in place of Load now; the dormant model binding's pending → confirmed and pending → cleared on `failed`; the mode chip's confirm-before-acquire; `/btw` typed on an exited session acquires once and asks; Send to main and a peer reply acquire through their paths. The e2e group `e2e:available` (replay harness, `MAWS_ENGINE_REPLAY=1`): open an exited session → no launch, labels shown; `/skills` → Load now → Starting… → rows; Send → continues; reload the renderer → labels kept.

### 6.3 Concrete Steps

Working directory: the child's worktree (absolute paths in commands; `pnpm -C <worktree>`).

```
pnpm -C <worktree> install --frozen-lockfile        # once per worktree
pnpm -C <worktree> typecheck                         # no output, exit 0
pnpm -C <worktree> lint                              # exit 0
pnpm -C <worktree> test                              # vitest: all suites pass; the new ones listed per milestone
pnpm -C <worktree> test:probes                       # node --test: the pass-3 fixtures admitted, M0's included
pnpm -C <worktree> e2e:available                     # M3: the new group, every case passing
pnpm -C <worktree> e2e:composer && pnpm -C <worktree> e2e:widgets && pnpm -C <worktree> e2e:panel && pnpm -C <worktree> e2e:side && pnpm -C <worktree> e2e:c12 && pnpm -C <worktree> e2e:supervisor   # one group at a time, through the slot script
```

The acceptance run (M3's last step), in a development build against a scratch home where an agent stands in for the owner (`MAWS_LIVE=1`, P1's live rules) or on the owner's machine at P2-F's sitting: open a discovered terminal session → `session.launch` absent from the host's journal directory listing for its app id, Session info reads "Not observed yet"; Send "Reply with OK" → the composer reads "Starting…", then the reply streams in the same conversation; `/skills` on another exited MAWS-run session → "Not read yet." with Load now → "Starting…" → rows; quit and relaunch MAWS → the session's ring and Session info read "Last reading, <relative>" and "Last observed <relative>" with no engine started.

## 7. Interfaces and Dependencies

Main and shared:

```ts
// src/shared/ipc/schema/session.ts (P2-A block)
export const AVAILABILITY = ['usable', 'starting', 'resumable', 'foreign_held', 'archived', 'missing_directory', 'needs_trust', 'failed'] as const;
export type Availability = (typeof AVAILABILITY)[number];
// SessionDigestSchema gains: availability: z.enum(AVAILABILITY)
'session.acquire': { input: z.strictObject({ appSessionId: AppSessionIdSchema, reason: z.enum(['send', 'chip', 'read', 'side', 'peer', 'resubmit', 'resume']), options: StartOptionsSchema.optional() }), output: AcquireOutcomeSchema, owner: 'main' },
'session.observedFacts': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: ObservedFactsSchema.nullable(), owner: 'main' },
// host-owned, beside engine.sessions
'engine.observedFacts': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: ObservedFactsSchema.nullable(), owner: 'host' },

// src/shared/sessions/setup.ts — AcquireOutcomeSchema as in §5.3
// src/shared/engine/observed-facts.ts — ObservedFactsSchema, Fact<T>, readObservedFacts(text): ObservedFacts | null (tolerant)
// src/shared/engine/status.ts — EngineSessionStatus.pluginsObservedAt: string | null

// src/main/sessions/availability.ts
export interface AcquisitionMemory { inFlight: boolean; last: { kind: 'needs_trust' | 'missing_directory' | 'failed'; at: string; message: string | null } | null }
export function availabilityOf(record: SessionRecord, status: EngineSessionStatus | null, memory: AcquisitionMemory | null): Availability;

// src/main/sessions/service.ts
acquire(appSessionId: AppSessionId, reason: AcquireReason, options?: StartOptions): Promise<AcquireOutcome>;
// ReadModelWriter gains observeAcquisition(appSessionId: AppSessionId, memory: AcquisitionMemory): void

// src/engine-host/store/observed-facts-store.ts
export interface ObservedFactsStore { load(id: AppSessionId): Promise<ObservedFacts | null>; save(id: AppSessionId, facts: ObservedFacts): Promise<void>; createIfAbsent(id: AppSessionId, facts: ObservedFacts): Promise<boolean>; forget(id: AppSessionId): Promise<void> }
```

Renderer:

```ts
// src/renderer/src/sessions/acquire.ts
export function acquireSession(appSessionId: AppSessionId, reason: AcquireReason, options?: StartOptions & { dockMessage?: FirstMessage }): Promise<AcquireOutcome>;
export function acquisitionWords(outcome: AcquireOutcome): string | null; // null for ready and for a docked card the card explains
// src/renderer/src/sessions/availability.ts
export function useAvailability(appSessionId: AppSessionId): Availability | null;
// src/renderer/src/sessions/observed.ts
export function useObservedFacts(appSessionId: AppSessionId, opts?: { enabled?: boolean }): { facts: ObservedFacts | null; loading: boolean };
export function useLoadedPlugins(appSessionId: AppSessionId): { plugins: ObservedPlugin[]; errors: ObservedPluginError[]; warnings: ObservedPluginWarning[]; freshness: Freshness; refresh(): Promise<AcquireOutcome | null> };
export type Freshness = { kind: 'now' } | { kind: 'last'; at: string } | { kind: 'unknown' };
// src/renderer/src/composer/submit/send-human-prompt.ts — SendHumanResult as in §5.4
// src/renderer/src/widgets/read.ts — ReadState = 'loading' | 'ready' | 'error' | 'dormant' | 'starting' | 'unavailable'; EngineRead gains load(): Promise<AcquireOutcome>, readAt: number | null
```

Dependencies: P2-0's seam (M1); nothing new from npm. Consumers: B (`useLoadedPlugins`, `WidgetFrame`'s states, `session.acquire` through `refresh`), C (the seam's `started`; availability), D (`useObservedFacts`, availability for its rows' words), E1 (the seam).

## 8. Hand-back: ledger proposals (the architect records)

1. §1 `session.acquire`: the row's choice is **a separate main command**, `{appSessionId, reason: 'send' | 'chip' | 'read' | 'side' | 'peer' | 'resubmit' | 'resume', options?: StartOptions} → AcquireOutcome` (`AcquireOutcomeSchema` in `src/shared/sessions/setup.ts`: `ready {launched, joined}`, `StartOutcome`'s card and refusal variants verbatim, `failed {message, resources}`), answered after the launch it awaited; `reason` gains `resume` (the row's explicit Resume). Beside it: a record's `session.start` with no message joins an in-flight start (answers the first caller's outcome) instead of refusing `starting`. `LAUNCHES` gains `session.acquire`.
2. §1 `session.observedFacts {appSessionId} → ObservedFacts | null` (main, relays) and a new host-owned **`engine.observedFacts {appSessionId}`** (reads the file, recovers once from the journal); `ObservedFactsSchema` and `Fact<T>` in `src/shared/engine/observed-facts.ts`, per-field `{value, at, launchId} | null`.
3. §1 `availability`: **`SessionDigest.availability`** (required), values `AVAILABILITY` in `src/shared/ipc/schema/session.ts`; renderer accessor `useAvailability` in `src/renderer/src/sessions/availability.ts`.
4. §1 X22: the result becomes `{disposition: 'sent' | 'steered' | 'queued' | 'held' | 'refused', started: boolean, messageUuid?, queueId?, reason?}` — `started` a field beside the disposition (an acquisition still ends in the host's sent, queued or steered); `held` when a trust or relay card holds a composer message; the flat `started` disposition dropped. Non-composer origins never hand their text to a card (`refused` with the card's words).
5. §1 renderer names B, C and D code against: `acquireSession`, `acquisitionWords` (`src/renderer/src/sessions/acquire.ts`), `useObservedFacts`, `useLoadedPlugins`, `Freshness` (`src/renderer/src/sessions/observed.ts`); `ReadState` gains `dormant | starting | unavailable` (loses `not_running`) and `EngineRead.load`, `readAt` (`widgets/read.ts`).
6. X2 status: `EngineSessionStatus.pluginsObservedAt: string | null`.
7. §3 X6: the observed file is `<userData>/engine-host/state/<appSessionId>.observed.json`, its own `version: 1`, tolerant reader, deleted by `session.forget`, kept by archive.
8. §4 X15: P2-A needs **no** version (no settings, index or sidecar change); the row "the host sidecar's optional key or its version 2" becomes "none".
9. §6: A's shared-file blocks as §6.1 lists; `src/renderer/src/side/CommentComposer.tsx` and `side/btw.ts`, `BtwWidget.tsx`, `BtwView.tsx` gain A's dated blocks beside E1's; `src/renderer/src/composer/resume-seam.ts` is removed by A.

**Charter lines at A's landing (the architect writes):** a dated §19 line amending §4.4: durable sessions are available on demand; process absence is not an error; an engine starts on the owner's explicit gesture (Send, a chip choice, Refresh or Load now, `/btw`, Send to main, a peer reply, a resubmit, an answer) and on nothing else; the memory budget, keep-alive and idle rules unchanged; send-to-resume (C12) generalised to every eligible record. C10's reading: "never auto-resumes" means no blanket replay of indexed history at start, not a ban on owner-action acquisition. C11's reading: a widget on a session with no ready process shows its last answer or observed facts with Load now, never "not running". §13: X2 gains `session.acquire`, `session.observedFacts`, `engine.observedFacts`, `SessionDigest.availability`, `EngineSessionStatus.pluginsObservedAt`; X6 gains the observed-facts file beside the state file; X16 and X17 recorded as landed (promoted at P2's close by P2-F).

## 9. Risks

- **A no-prompt start with side effects (U1).** SessionStart hooks, MCP servers and plugin initialisation run at any launch; on a chip choice or a Refresh that is a side effect the owner did not ask for by name. Mitigation: M0 measures it; §10 Q1 takes it to the owner with Branch P written out; Send and turns are unaffected.
- **Join correctness.** The registry is the new concurrency surface. Mitigation: synchronous registration at entry as the one linearization point; the lifecycle table and race tests in M1; the lock and `starting` set kept as today for everything else.
- **A long IPC await.** `session.acquire` can take up to the watchdog (150 s) when hooks are slow. Mitigation: the surface shows "Starting…" throughout; a renderer reload mid-acquisition loses only the caller's continuation (the launch completes; the operation is not run, the owner repeats the gesture).
- **`/plugins` on the old widget** if A lands before B. Mitigation: §10 Q2.
- **The supervisor wire changes** (`engine.observedFacts`, `pluginsObservedAt`). Mitigation: E10's handshake replaces or waits on an older supervisor as for every host change; the owner sees its banner once at A's landing.
- **Journal recovery cost.** Journals rotate at 128 MiB and keep 20 launches. Mitigation: lazy (first read of one session), newest launch first, early stop when every field is known, streamed, written once even when empty.
- **Trust cards from non-composer surfaces.** A question answer on an untrusted session docks the trust card without the answer. Mitigation: the refusal words name the card; the answer stays unanswered and can be clicked again after trust.
- **Budget release right after acquisition** on a machine over budget. Mitigation: the launch's `lastUsedAt` makes it the last LRU candidate; a release is visible and a gesture reacquires; no loop is possible because nothing but gestures acquires.

## 10. Open questions for the architect (A proceeds on each recommendation)

1. **(owner, only if M0 shows a side effect) The triggers.** If a no-prompt start runs SessionStart hooks, writes or touches the JSONL, or makes a billable gateway request, do a chip choice and a Refresh still start the engine? Recommendation: yes — they are explicit gestures, the row's Resume already starts an engine with the same effects today, and decision 4 named chip changes and fresh reads; Branch P (pending next-start settings, last-known only on Refresh) is ready if the owner says no. A proceeds on yes and does not merge M3's chip acquisition before the owner's answer if the question is raised.
2. **`/plugins` before B.** If A lands first, may A put one dated hunk in `PluginsWidget.tsx`'s Loaded section (`status ? present(status) : NOT_RUNNING` → `useLoadedPlugins`, with its freshness line and Refresh), recorded as a ledger §6 exception that B's rewrite absorbs? Recommendation: yes; the alternative leaves G2's `/plugins` half and the "not running" text on the owner's screen until B lands.
3. **Send while starting.** Send stays enabled while a start is in flight and joins it ("Sends once the session has started"), rather than disabled until ready. Recommendation: enabled (acceptance 2 needs the join path anyway; a disabled Send during someone else's Load now reads as the old wall).
4. **Editor during acquisition.** The text stays in the locked editor until the host accepts the message (G1's "kept until accepted", literally), rather than C12's immediate clear with a held bubble. Recommendation: keep it in the editor; a failure then needs no hand-back.
5. **Copy.** "Starts this session", "Sends once the session has started", "Archived · unarchive it to continue", "Not read yet.", "Load now", "Refresh", "Read <relative>", "Starting…", "Loaded now", "Loaded last time, <relative>", "Last reading, <relative>", "Last observed <relative>", "Not observed yet", "The current list arrives with the next message". Recommendation: as listed; the owner's sitting adjusts.
6. **X22's final shape** (§8 item 4): `started` as a field, `held` added, the flat `started` dropped. Recommendation: fold as proposed; P2-0's released-resume branch maps to `started: true` with the host's disposition once A lands.
7. **Holder actions inside widgets.** A terminal-held session's widget shows the existing `HolderActions` (Attach, Fork, Take over) where Load now would be, rather than only the holder's words. Recommendation: show them; it is the existing component and confirm.

## 11. Surprises & Discoveries

- Observation: `session.start` holds the session's lock for the whole resume, not only its guards, so a second caller that took the lock would serialise behind a launch instead of joining it.
  Evidence: `src/main/sessions/service.ts` `startSession`: `release = await this.lock(appSessionId)`, then `void run().finally(() => { this.endStart(...); held(); })`.
- Observation: a resumed engine's tracker starts with `plugins: []` and only an init or a reload fills it, so a freshly acquired session would say "The engine loaded no plugins" until either arrives.
  Evidence: `src/engine-host/session-status.ts` (`plugins: EngineSessionStatus['plugins'] = []`; `initialize()` sets mode, fast mode and the catalogue only); `widgets/PluginsWidget.tsx` (`PLUGINS.none` when the list is empty).
- Observation: the take-over already resumes by capturing the `session.setup` outcome around `guardResumeStart` and `run()`; acquisition reuses that pattern rather than a second launcher.
  Evidence: `src/main/sessions/service.ts` `takeOver` → `resume` (`const setup: Setup = { ...this.s, emit: ... }`).
- Observation: the `/plugins` Loaded section reads the engine status directly and its frame state follows the CLI read, so `WidgetFrame`'s new states cannot reach it without an edit to P2-B's file.
  Evidence: `src/renderer/src/widgets/PluginsWidget.tsx` (`state={installed.state}`; `{status ? <PluginsBody view={present(status)} /> : … NOT_RUNNING}`).

## 12. Decision Log

- Decision: the verification call. This document gets one independent review round by the `doperpowers:adversarial-reviewer` agent on Opus (the astra route limited until 2026-10-13, P1 P-26), on the design and on the execution section's buildability (three milestones after the spike), before the first executor starts; each milestone gets the task-reviewer at its frontier (M1 and M2 independently, M3 after both); the whole branch gets `doperpowers:review-code` at **high** (main-process concurrency in the acquisition registry and host persistence across builds warrant the frontier rung).
  Rationale: the join and the cross-build file are the two places a wrong answer is expensive and quiet.
  Date/Author: 2026-10-09, P2-A's author.
- Decision: residue rulings §5.2 to §5.6 as written (a separate `session.acquire` answering after the launch; acquire-then-send with the message held by its origin; the synchronous in-flight registry and its join table; `SessionDigest.availability` with an IO-free derivation and `failed` meaning the last attempt; per-field observed facts written and recovered by the host, relayed by main; `pluginsObservedAt`; `WidgetFrame` owning the dormant states for every widget; chips acquire then apply; no operation hold; `!` and `#` acquire; non-composer origins never hand text to a card; C12's resume seam retired). Each section names the alternative rejected.
  Rationale: each is a technical consequence of §4.1 to §4.3 and the code read in §5; none changes what the owner sees beyond §10's questions.
  Date/Author: 2026-10-09, P2-A's author.

## 13. Outcomes & Retrospective

Pending: written at A's landing against §4 as written.

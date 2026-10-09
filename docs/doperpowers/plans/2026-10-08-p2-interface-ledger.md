# P2 interface ledger (opened 2026-10-08)

> **Parent:** `docs/doperpowers/plans/2026-10-08-p2-daily-driver.md` (the P2 composite spec), §6 contracts X16 to X21 and the X2, X6, X10 and X15 amendments. One writer: the architect. Children propose names in their execution documents and hand-backs; the architect records them here before a second child codes against them. A name not in this ledger is not yet shared. The cua_repl session writes its own version rows in the P1 ledger's §4 table (X15's single allocation table) and sends every other text to the architect.

Purpose: P2-A, P2-C, P2-D and P2-E1 run at once and each extends X2; A and C both touch the launch (X6); E1 and E2 share the card (X21) with the cua session's #90 beside them in the browser schema. This ledger is the one interim contract they code against. It is reconciled before each wave's first executor starts and kept current as children land; at P2's close its content is folded into the spec's §6 and the charter's §13.

## 1. X2 — commands and reads added in P2 (`src/shared/ipc/names/`, `schema/`)

| Name | Owner | Consumers | State |
|---|---|---|---|
| `session.acquire {appSessionId, reason: 'send' \| 'chip' \| 'read' \| 'side' \| 'peer' \| 'resubmit'}` → the start-outcome shape (`StartOutcomeSchema`), joining an in-flight start (X16); or `session.start` extended with a `join` flag, the child's choice recorded here before B, C or D codes against it; added to `LAUNCHES` in `renderer/src/app/supervisor-notices.ts` | P2-A | B (Loaded now), C (answers on an exited session), the chips and widgets | reserved 2026-10-08 |
| `session.observedFacts {appSessionId}` → X17's snapshot or `null`; a main-owned snapshot read beside `session.digests` | P2-A | B, D | reserved 2026-10-08 |
| `sendHumanPrompt(appSessionId, content, {origin: 'composer' \| 'answer' \| 'reply' \| 'comment' \| 'peer'}) → {disposition: 'sent' \| 'steered' \| 'queued' \| 'started' \| 'refused', messageUuid?, queueId?, reason?}` in `src/renderer/src/composer/submit/send-human-prompt.ts` (X22, a renderer seam, not IPC): `session.steer {priority:'next'}` while a turn runs (`steered`, with the uuid), `session.send` when idle, which the host answers `{messageUuid: nullable, disposition: 'sent' \| 'queued', queueId}` (`schema/session.ts:94`): `sent` carries the uuid, `queued` (a paused or non-empty host queue) carries `queueId` and no uuid until the host submits the entry (`session.queue.promote` returns the uuid); the seam passes the host's distinction through, never collapses it; A adds `started` (its document may make `started` a field beside the disposition if the flat union loses the queue outcome) | P2-0 (A extends) | the composer, C (answers; a host-queued answer stays "queued" until the uuid is known), E1 (card Reply, Send to main; the same) | reserved 2026-10-08; amended 2026-10-08 23:55 PDT after P2-0's finding (spec Decision Log 16); names as implemented at P2-0's pin a3379850 (branch `worktree-agent-a41c75eb52e5315b4`, not yet merged): `sendHumanPrompt(appSessionId, content, {origin, display?}, client = ipc)`, where `display` carries the composer's pasted-content markers (C12) and other callers omit it for plain text; the delivered observation is `waitForHumanPromptDelivery(appSessionId, messageUuid, {signal?} = {}, client = ipc) → the user.message event` in `src/renderer/src/composer/submit/human-prompt-delivery.ts`, subscribing before it reads the existing `session.events` so a replay is never missed |
| `availability` (X16's field) on the renderer's session read-model row, derived in main | P2-A | B, C, D | reserved 2026-10-08 |
| `mods.list` → X20 rows | P2-C | B | reserved 2026-10-08 |
| `plugins.manifest {id, scope, projectPath?}` → `{name, description?, author?, icon?, components: {commands, skills, agents, hooks, mcpServers}}`, read by the host from the installed manifest and directories, no plugin code executed, secrets redacted | P2-B | — | reserved 2026-10-08 |
| `session.recentTurns {appSessionId, limit}` → the last N turns' rows for a preview, read from the live host or from disk, no engine launched, no read-state change (name provisional; D may instead give `session.events` bounds, recorded here) | P2-D | — | reserved 2026-10-08 |
| `attention.acknowledge` widened to the kinds `async_input` and `essential_unread` (Mark read); `mods.*` settings commands only if the settings namespace does not already cover them | P2-C | the sidebar, Needs you | reserved 2026-10-08 |
| `browser.comment.picked` gains an additive `position?: {x, y}` in pane viewport pixels (X21's pin) | P2-E2 | — | reserved 2026-10-08; coordinated with the cua session's #90 names in `schema/browser.ts` (append-only blocks, dated) |

## 2. X1 — event and attention kinds added in P2

| Kind | Owner | Consumers | State |
|---|---|---|---|
| Attention kinds `async_input` (a `need-input` question unanswered; anchor: the question's identity) and `essential_unread` (an `essential` not yet marked read), appended after the nine existing kinds in `src/shared/graph/enums.ts` | P2-C | the sidebar, Needs you, the notifier (two new notification groups) | reserved 2026-10-08 |
| `EVENT_KINDS` additions only if C needs an app event for a delivered answer (`owner.answer.delivered`); otherwise none | P2-C | — | open |

## 3. X6 — the launch

| Addition | Owner | State |
|---|---|---|
| `LaunchSpec.appendSystemPrompt?: {text, source: 'maws-contract', version}` (or the resolved field name the child records), emitted once as `--append-system-prompt`; `extraSettings.env.MAWS_NATIVE_TO_HUMAN=<version>` when the native lane is on; both resolved in `main/sessions/launch-mapping.ts` for cold start, resume and fork | P2-C | reserved 2026-10-08 |
| Observed facts (X17): a separate per-session file beside the state file (`observed.json`, host-owned); no key in `StateFileSchema` or the stored `LaunchSpecSchema` | P2-A | reserved 2026-10-08 (revised after review 1) |
| `StateFileSchema` and the stored `LaunchSpecSchema` tolerate unknown keys (forward compatibility, a unit test pins it); no new key is written in P2 before this reader is in the owner's running build; C's `{contractSource, contractVersion}` waits on it | P2-0 | reserved 2026-10-08 |

## 4. X15 — version numbers

Allocated in the P1 ledger's §4 table (`docs/doperpowers/plans/2026-10-05-p1-interface-ledger.md`), the repository's single allocation table, in landing order and after cua board #90's settings 12, index 7 and `profiles.json` 2 (taken 2026-10-08 at 5bd2cd57). Reservations are slots in landing order, not numbers: migrations are positional and each settings schema derives from the next, so the first child to land takes the next contiguous number and the others renumber at rebase (nothing released is edited); #90's 12 and 7 are slots on the same rule. Intentions, not numbers:

| Child | Settings | Index | Other |
|---|---|---|---|
| P2-C | one version: `mods: {toHuman: {enabled: true}}`, the notification groups `asyncInput` and `essential`, the per-session override's home | one migration: owner-channel items (question and essential state, correlation to the delivered prompt) if `attention_items` cannot carry them | — |
| P2-B | one version only if the library keeps a preference (sort, filter) | — | — |
| P2-A | — | — | the host sidecar's optional key or its version 2 |
| P2-D, P2-E1, P2-E2 | — | — | — |

## 5. X21 — the comment card

| Name | Owner | Consumers | State |
|---|---|---|---|
| `openCommentComposer(anchor, {appSessionId, placement?})` with `placement: {kind: 'card', host: 'deliverable' \| 'browser', rect?: {x, y, width, height}} \| {kind: 'sheet'}`; `CommentCard` in `src/renderer/src/side/`; `artifactElementAnchor` keeps the pick's `rect` | P2-E1 | P2-E2, the deliverables viewer, the browser comment connect | reserved 2026-10-08 |
| X9: `artifact_update` and `artifact_list` from a side thread resolve the parent session's artifacts (lineage `kind: 'side-thread'`); X12 versions so written belong to the parent's record | P2-E1 | — | reserved 2026-10-08; the owner decided yes at approval (spec Decision Log 9), so E1.G4 builds it |
| Thread rows inside the card draw the owner channel through the local presenter whatever the attachment state (a `presentation: 'local'` option on the transcript list, or the equivalent the child records) until C's X18 module lands | P2-E1 | P2-C replaces it | reserved 2026-10-08 |

## 6. Shared files and landing order

Files more than one P2 child touches: `src/shared/ipc/names/session.ts` and `schema/session.ts` (A, C, D: append-only blocks, dated), `src/shared/graph/enums.ts` (C), `src/shared/settings/defaults.ts` and `src/shared/ipc/schema/settings.ts` (B, C: one version each, in landing order), `src/main/sessions/launch-mapping.ts` (A for `browserBackend`'s reuse, C for the prompt and the variable), `src/renderer/src/composer/Composer.tsx` and `composer/editor/submit.ts` (P2-0 extracts the seam first; A extends it; C and E1 call it), `src/renderer/src/widgets/PluginsWidget.tsx`, `SkillsWidget.tsx` and `SandboxWidget.tsx` (B owns them; A edits none, delivering through `widgets/read.ts` and `WidgetFrame.tsx`; C adds the built-in section: whichever of B and C lands second adapts), `src/renderer/src/transcript/surface/Rows.tsx` (C), `src/renderer/src/side/*` (E1), `src/shared/ipc/schema/browser.ts` (E2 beside the cua session's #90). Rule as in P1: appended blocks only; an exception is one dated line here.

## 7. Record

- 2026-10-08: opened with the composite spec; reservations above; no child dispatched (the owner's approval pending).
- 2026-10-08 23:50 PDT (the earlier "2026-10-09 00:20" was the architect's estimate; the clock says 23:50): wave 1 dispatched after the owner's approval (spec 7462fe28, pin 8814d733): P2-0's executor and the authors of P2-A, P2-C and P2-E1, each in an isolated worktree, coding or designing against the rows above; B and D wait for a slot. Names proposed in their hand-backs are recorded here before a second child codes against them.
- 2026-10-08 (review 1): rows added for the seam (P2-0, X22), `availability`, `mods.list`, `plugins.manifest`, the forced local presenter and the observed-facts file; the slot rule stated in §4; the sidecar's tolerant reader assigned to P2-0; E1's artifact-scope row made conditional on the owner's answer.
- 2026-10-08 23:55 PDT: P2-0's executor found that `session.send` answers `{messageUuid: nullable, disposition: 'sent' | 'queued', queueId}`, not a uuid every time; the seam's disposition union gains `queued` with `queueId` and no uuid (§1 row; spec Decision Log 16); the authors of A, C and E1 told, A's for the shape of `started` beside a queue outcome. No IPC or host queue change.
- 2026-10-09 00:15 PDT: P2-0's executor named the seam as implemented (`{origin, display?}` options and an injectable client) and the delivery helper `waitForHumanPromptDelivery` (§1 row); C's and E1's authors told to design against those names; the implementation is at pin a3379850, gates and review still running.

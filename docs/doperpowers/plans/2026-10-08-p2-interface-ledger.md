# P2 interface ledger (opened 2026-10-08)

> **Parent:** `docs/doperpowers/plans/2026-10-08-p2-daily-driver.md` (the P2 composite spec), §6 contracts X16 to X21 and the X2, X6, X10 and X15 amendments. One writer: the architect. Children propose names in their execution documents and hand-backs; the architect records them here before a second child codes against them. A name not in this ledger is not yet shared. The cua_repl session writes its own version rows in the P1 ledger's §4 table (X15's single allocation table) and sends every other text to the architect.

Purpose: P2-A, P2-C, P2-D and P2-E1 run at once and each extends X2; A and C both touch the launch (X6); E1 and E2 share the card (X21) with the cua session's #90 beside them in the browser schema. This ledger is the one interim contract they code against. It is reconciled before each wave's first executor starts and kept current as children land; at P2's close its content is folded into the spec's §6 and the charter's §13.

## 1. X2 — commands and reads added in P2 (`src/shared/ipc/names/`, `schema/`)

| Name | Owner | Consumers | State |
|---|---|---|---|
| `session.acquire {appSessionId, reason: 'send' \| 'chip' \| 'read' \| 'side' \| 'peer' \| 'resubmit'}` → the start-outcome shape (`StartOutcomeSchema`), joining an in-flight start (X16); or `session.start` extended with a `join` flag, the child's choice recorded here before B, C or D codes against it; added to `LAUNCHES` in `renderer/src/app/supervisor-notices.ts` | P2-A | B (Loaded now), C (answers on an exited session), the chips and widgets | reserved 2026-10-08 |
| `session.observedFacts {appSessionId}` → X17's snapshot or `null`; a main-owned snapshot read beside `session.digests` | P2-A | B, D | reserved 2026-10-08 |
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
| The host sidecar: `StateFileSchema` gains an optional `observed?: X17` key (or `version: 2` with a reader for 1), never a strict change that moves a file aside | P2-A | reserved 2026-10-08 |

## 4. X15 — version numbers

Allocated in the P1 ledger's §4 table (`docs/doperpowers/plans/2026-10-05-p1-interface-ledger.md`), the repository's single allocation table, in landing order and after cua board #90's settings 12, index 7 and `profiles.json` 2 (taken 2026-10-08 at 5bd2cd57). Intentions, not numbers:

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
| X9: `artifact_update` and `artifact_list` from a side thread resolve the parent session's artifacts (lineage `kind: 'side-thread'`); X12 versions so written belong to the parent's record | P2-E1 | — | reserved 2026-10-08 (spec Decision Log 9, flagged for the owner) |

## 6. Shared files and landing order

Files more than one P2 child touches: `src/shared/ipc/names/session.ts` and `schema/session.ts` (A, C, D: append-only blocks, dated), `src/shared/graph/enums.ts` (C), `src/shared/settings/defaults.ts` and `src/shared/ipc/schema/settings.ts` (B, C: one version each, in landing order), `src/main/sessions/launch-mapping.ts` (A for `browserBackend`'s reuse, C for the prompt and the variable), `src/renderer/src/widgets/PluginsWidget.tsx` (B rebuilds it; C adds the built-in section: whichever lands second adapts), `src/renderer/src/transcript/surface/Rows.tsx` (C), `src/renderer/src/side/*` (E1), `src/shared/ipc/schema/browser.ts` (E2 beside the cua session's #90). Rule as in P1: appended blocks only; an exception is one dated line here.

## 7. Record

- 2026-10-08: opened with the composite spec; reservations above; no child dispatched (the owner's approval pending).

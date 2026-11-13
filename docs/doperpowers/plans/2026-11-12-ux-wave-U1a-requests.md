# UX wave · U1a · requests: UC-1, and the request work that does not draw in the transcript (2026-11-12)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U1**, first landing (**U1a**), parent pin `5f1972a30` (re-pinned from `06727e32a` at execution, Decision Log 2026-11-13).
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md`: Edges → Pull requests (which names this landing as "the first pull request, before the placement work lands"); Contracts → "UC-1 (owned)", UC-6, UC-7; acceptance A1, A3, A5, A10 to A14, A16 to A18; the items #358, S-04, S-07, O-22, l4-approvals-02, -05, -11, -13, O-23, l4-approvals-09, #333, and "Dismiss" under l4-approvals-08; "Probes and checks"; "Rulings reversed". In the root: Purpose, the wave's laws, UC-1, UC-3, UC-4, UC-6, UC-7, UC-8, UC-10, UC-11, UC-14, "Ordering and dependency map" ("U1a, UC-1 and the request work that does not draw in the transcript"), and the Decision Log's table "Rulings reversed". Where the child's file and the root differ, the root binds.
> This document holds what the design does not: the landing's edge, what the code holds, the decisions the section left open, the interfaces siblings read, and the execution. The architect's rulings of 2026-11-12 on the seven points reported at authoring, and the adversarial review's findings of the same day, are folded in ("Reported to the architect, and ruled"; Decision Log). The architect writes the corrections into the spec's files, so where the child's file at the pin and a ruling differ, the ruling is the later word. Two points found while the findings were verified are reported in the same section for a ruling, each with the default this document builds and the one place a ruling changes. **Branch:** `ux-wave/U1a`, from master `48619c824`; master (`6e8c72738` at this revision, which holds U8a and the engine probes) is merged in before anything is built, and no executor starts before U6a is on master (Concrete Steps, 1). **Board:** #577 (the wave's epic is #573).

## Purpose

After this landing a request stops being announced the moment the person answers it. Allow a command that runs for a minute and prints nothing: the card is gone at the click, the composer and Stop are back, and the session's row, its tab, Needs you, the dock badge and a window on another machine read "Working" for the whole minute. Today all of them read "Needs approval" until the command prints or ends, and the composer's place holds a line "Answered · Allowed once".

The other changes are in the cards themselves, which still take the composer's place in this landing (the placement in the transcript is the next landing, U1b):

- A permission prompt is three buttons, each with its key on it (Esc, ⇧⌘↩, ⌘↩), in place of a numbered list of scopes and an Allow button. A key answers one prompt per press, and none in a prompt's first 400 ms.
- A file change is shown as a diff with line numbers against the file as it stands, says "Create" or "Edit", and can be read whole before it is approved.
- A plan's primary button names the mode the session will be in afterwards.
- The trust card stops listing five things that would load when the folder holds none of them.
- A double-click on a single-choice option picks it and goes on.
- From a notification or the sidebar's hover card any waiting permission can be denied, and a read or a shell command shown whole can be allowed once.
- A terminal session's question that does not block the agent reads "Question waiting" in the calm tone, and every question's form has a Dismiss button.

How to see it working: the unit suite (each reader of "what waits" handed one answered item and showing nothing, a test that fails on today's tree), and the Electron e2e groups named under "Proof that an executor does not run", whose new scene allows a command whose result never comes and finds no card, no "Answered" line and a session that reads Working.

## Progress

- [x] (2026-11-12) The section checked against the code at `48619c824`; this document written; seven points reported to the architect.
- [x] (2026-11-12) The architect's rulings on the seven points (every default stands) and the adversarial review's six findings and three smaller points folded in; two points found while verifying them reported for a ruling.
- [x] (2026-11-13) The rulings on the two points reported at the revision (8 and 9) folded in.
- [x] (2026-11-13) U6a is on master (`be663d261`, pull request #604) and U8a since `6e8c72738`; master merged into the branch at `64c13746a`; step 0's two files are present.
- [x] (2026-11-13) M1 — One predicate, the publisher and every reader. Reviewed clean (one fix wave `5efc03b94..10d61e2b8`: a draft kept through a feed snapshot; the held-back settlement proved through the composed spine; the `unknown` outcome exercised). Built `4753fb642..faf75c3ca`. A17's red run (2026-11-13): the tests commit `4753fb642`, alone on the VM, `pnpm exec vitest run` over the 23 touched test files: 56 failing, each by assertion or a missing export (the tree test `test/one-predicate.test.ts`, every row of §A's reader table, the holder, the tellers, the endpoint, the mirror, main's `accepted`); four new tests passed there by design, each a rule today's code already keeps.
- [x] (2026-11-13) M2 — Questions: the terminal's asynchronous question, Dismiss, double-click. Reviewed clean (one fix wave `3c2ec96b2..ff10fd1a4`: a refused Dismiss on MAWS's ask is retried as a Dismiss, never as a Submit). Built `2cc43cc8a..6f6045a23` (red at the tests commit: 56 failing over 14 files).
- [x] (2026-11-13) M3 — The permission card: three buttons, the hints and the keys. Reviewed clean (one fix wave `1577c0469`: the call's "Why" drawn after the preview for every tool class, where only a command's showed it). Built `e4790393c..4c55c614d` (red at the tests commit: 67 failing over 9 files).
- [x] (2026-11-13) M4 — A file change as a diff. Reviewed clean (one fix wave `c5aea04d3`: "Show all" lifts the transcript's unlayered 240 px with important utilities scoped to the card's region, which alone holds the bound, 12 lines collapsed and 60vh expanded). Built `8cbf1f785..c4c846169` (red at the tests commit: 34 failing, two new modules failing at import).
- [x] (2026-11-13) M5 — The plan's next mode; the trust card. Reviewed clean, no fix wave. Built `d8fd9ee9b..4f4f24af3` (red at the tests commit: 40 failing).
- [x] (2026-11-13) M6 — From outside: one rule for the notification and the hover card. Reviewed clean, no fix wave. Built `bb1e17cb5..aae5e2b08` (red at the tests commit: 42 failing).
- [ ] M7 — The e2e edits, the record, and the acceptance run.
- [ ] Handed back to the architect: the branch review, class 1a, the Electron e2e groups, the checks that need a Mac, the pull request.

## The landing's edge

What "does not draw in the transcript" means here: nothing under `src/renderer/src/transcript/` is edited. The landing changes what counts as waiting, what the cards hold and what answers them; where a card stands is unchanged.

| part of U1 | satisfied by this landing | left to the landing named |
|---|---|---|
| UC-1 | in full: the predicate, the publisher, every reader, the terminal route's rule, and the predicate by tool call and by agent (Interfaces §A, §B) | the line "Waiting for you · N" where a session is shown without its transcript (U1b, with U10) |
| A1, A17; #358, S-04, S-07 | in full on three of A1's four routes; for a terminal session on another machine, on the session's machine and in every window of the device that answered, and on a third device at the bridge's settlement (§B; Reported, 8) | #358's third point, the answers a question's row shows between the answer and the transcript's own row (U1b: it is the row's drawing) |
| A3; l4-approvals-02 | the card's content, the three buttons, the hints, the chords ⌘↩, ⇧⌘↩ and Esc, the 400 ms rule and the rule that a held key answers once, in the placements the card has today (the docked frame, the Overview card, a child's card in a transcript) | the guards that exist only once the composer is free: focus in the composer or on nothing, ⌘↩ yielding to a draft, a prompt out of view, Esc ahead of the composer's own (U1b). The 200 px bound of A2 is measured here on the card itself, not on the frame around it |
| A5; O-22 | the kind (`async_input`), the words and tone on the row, the tab and Needs you, the disabled Skip, Dismiss | "its form is drawn in the row of the call", "the composer is free", "never docked" (U1b). Until then the question keeps the dock (Reported, 1) |
| A18; "Dismiss" under l4-approvals-08 | the act: the button on the stepper form and on MAWS's ask form, what it sends for each tool, the terminal route's control read from the bridge, the session's row, tab and Needs you no longer counting the question | the row's receipt "Dismissed" and the capsule's receipt (U1b, on U3a's `answer` class); sending a message while a blocking question waits (U1b: the composer is not there while a card is docked) |
| A10; O-23 | in full, wherever the two forms are drawn today | their drawing in the row (U1b) |
| A11; l4-approvals-05 | in full on a session MAWS runs, here or on another machine; a terminal session gets the diff where its file can be read and the fallback where not | nothing |
| A12; l4-approvals-11 | in full on a session MAWS runs on this Mac; "Implement" with no menu on a terminal session | a mode chosen for a session on another machine (ruled out here; a debt row, and U9's row to add); the modes not yet probed (ruled: the two that were) |
| A13; l4-approvals-13 | in full; the frames of the trust, relay-down and failed-start cards read their title alone | the same words on a request's frame go with the dock (U1b) |
| A14; l4-approvals-09, #333 | in full; the notification's buttons stand on the signed-build check | notification actions for a session on another machine (not in this child; a candidate for U9) |
| A16 | each keep checked by a named test (M7) | — |
| UC-6 | the rows `request.allowOnce` and `request.allowLasting`; `request.decline` and `request.accept` change what they act on | the question's and the plan's keys needing focus inside the form (U1b, when the form moves) |
| A2, A4, A6 to A9; l4-approvals-08 (but Dismiss), -07, -04, O-17, l2-transcript-10, O-21; UC-3, UC-9 | nothing | U1b, after U3a and U8b |
| A15; l4-approvals-12 | nothing | U1c, after U3a |
| O-19, #420 | nothing | U1d, after U1b |
| "Rulings reversed" | S-07 with #358; l4-approvals-02; l4-approvals-09 with #333; O-22; l4-approvals-08 (Dismiss); and the keys' sentence of l4-approvals-08 at charter §5.8 (Reported, 4) | l4-approvals-08's placement (charter §13 X4, C7's "Placements"); O-17 (E1's M4b): U1b |

## Words used here

- **Attention item:** MAWS's record of something a session needs from the person (`AttentionItem`, `src/shared/graph/attention.ts`). Its `state` is `pending` (raised, not answered), `delivered` (the answer was written to the engine), `confirmed` (a frame from the engine named the call) or `retired`.
- **The broker:** `PermissionBroker` in `src/engine-host/broker.ts`, which holds the requests of a session MAWS runs and moves their items through those states.
- **The publisher:** the attention service (`src/services/attention/service.ts`), which keeps each session's list and sends it whole as `attention.changed`, answers `attention.list`, and feeds the list another machine reads (`src/endpoint/attention-feed.ts`).
- **A session MAWS runs** (in code, lane B), **a terminal session** (lane A, watched and answered through the sminos plugin's *bridge*, a local HTTP service of that session), **a session on another machine** (either kind, over the *machine link*; an *offer* is an act that machine accepts, `src/endpoint/offers.ts`). The four routes of A1 are: runs; remote (a session another machine runs); terminal; terminal on another machine.
- **The controls port:** the one object per session through which a card answers (`src/renderer/src/session/controls/`): `lane-b.ts` for a session MAWS runs, `lane-a.ts` for a terminal session. `answerCapability(item, answer)` says whether the session can carry an answer, and why not.
- **The holder:** the one place that knows a terminal session's request was answered and is not yet settled: the lane A list in the spine of the machine the session runs on (`src/services/lane-a/attention.ts`; §B). **The spine** is the machine's own services (`src/services/`), run by its daemon, `mawsd`; **the endpoint** is the part of that daemon that takes acts from other machines (`src/endpoint/`).
- **A fresh press:** a keydown that is not a key repeat (`KeyboardEvent.repeat` is false).
- **Docked:** drawn in the composer's place inside `DockedCardFrame` (`src/renderer/src/composer/docked/`). **Placement:** where the one card component is drawn: `docked`, `card` (the Overview card), `hover` (the sidebar's hover card), `inline` (a child's request in a transcript, the project channel's waiting cards).
- **Build F:** `f1852de3a`, the build on the owner's machines, which a profile may go back to (UC-14). In every file this landing changes, F's source equals the branch's base (`git diff f1852de3a 48619c824` is empty over them), so "what F does" below is what today's code does.
- **The wire:** the commands and events between builds (`src/shared/ipc/wire.ts`); a new optional property is an additive change that raises `WIRE_MINOR` and regenerates `wire-manifest.json`.

## Constraints that bind every milestone

- **The build brief's rules** bind as written: no typecheck, lint, test, install, build or Electron on the MacBook; every check runs on the wave's build VM through `vmcheck.sh` on the pushed head; commits end with the trailer the brief gives; no pull request, no `scripts/ci-gate.sh` and no Electron e2e by an executor.
- **UC-1 is this landing's contract.** After M1 nothing outside `src/engine-host/` compares an attention item's state to say whether it waits: it calls `waits` or `waitsOnAnswer`. A test holds that (M1).
- **Law 5, three routes.** Every act this landing changes is in the table of Interfaces §L with the route that carries it; "not on this route" has its reason there.
- **Law 6.** Nothing here rests on engine behaviour that was not recorded: the plan's next mode on `spikes/protocol-probe/findings-uxwave-u1-plan-next-mode.txt` (branch `ux-wave/probe-send-permission`), the bridge's dismissal on its contract as sminos 1.47.0 states it (Interfaces §G).
- **UC-3.** One insertion is made under `src/renderer/src/transcript/`: an optional prop on `EditDiff` (§I, §N). Nothing else there is edited; `EditDiff` and the `Hunk` type are imported from it.
- **UC-6.** A key is written only as a row of `ACTIONS` (`src/shared/keymap/actions.ts`); a hint on a button is that row's effective chord in the keymap's own formatting. The two new rows take no rebinding while F may run (U6a's guard) and the landing does nothing for that. U6's files are frozen until U6a lands: every insertion in them (§N) is made on a master that holds it.
- **UC-8, files other children own.** The insertions are listed in Interfaces §N, each with its owner; nothing else in those files changes.
- **Nothing is hidden on one surface alone.** Whether a request waits is said by its route's holder (§B) and read by every surface from the session's list. No window, card or component keeps a mark of its own that an answer was taken.
- **UC-11.** Fixtures, tests and scenes use made-up commands, questions, paths and names.
- **UC-14.** No layout key and neither settings file changes. What the landing sends that another build may read is in Interfaces §K.
- **Law 8, keeps.** l4-approvals-03 (Deny with a reason, Deny and stop), -06 (the Question sheet's form), -10 (answering from the Overview card), -14 (who asks, how many wait), l2-transcript-10 (the follow behaviour) stay as they are. A change that would alter one stops and reports.
- **Desk web stays as it is** (the root's standing out of scope). `apps/desk-web` imports `ToolPreview`, `toolVerb`, `QuestionBody` and the card's controls from `src/renderer/src/request-card/`: their exports and props stay, and the stepper's two new behaviours are opt-in (Interfaces §E).
- **Light theme and tokens only**; today's shapes (law 7).

## What the code holds today (read at `48619c824`)

Each line is a statement the section rests on, confirmed, or corrected where marked.

- **The predicate.** `src/shared/attention/kinds.ts` exports `isOpen` (`pending` or `delivered`) and `waitsOnAnswer` (built on it). `isOpen` is called in `attention/derive.ts` (which re-exports it), `attention/glyph.ts`, `attention/navigation.ts`, `stores/attention.ts`, `composer/docked/swap.ts`, `request-card/RequestCard.tsx`, `request-card/inline.tsx`, `sidebar/RequestPreview.tsx` (all under `src/renderer/src/`), `src/main/attention/notifier.ts`, `src/services/sessions/inactive-archive.ts` and `src/services/spine-root.ts`. The state is compared directly, not through the predicate, in `src/services/attention/service.ts` (twice), `src/main/attention/notifier.ts` and `actions.ts`, `request-card/RequestCard.tsx`, `request-card/quick-approval.ts`, `request-card/variants/Notice.tsx`, `stores/attention.ts` (`forgetSettled`), `src/services/sessions/stub-source.ts` (`OPEN`) and `src/main/lane-b/remote-session.ts` (`WAITING`). `src/renderer/src/channel/project.ts`, `src/engine-host/pending-counts.ts` and `src/endpoint/lane-b-pending.ts` already call `waitsOnAnswer` and change only through it.
- **The broker** sets `delivered` at the flushed write and leaves the item `pending` when the write fails (`answer`), as the section says. Nothing but the broker produces `delivered`: derived items, the owner channel's, MAWS's ask's (`askAttentionItem`) and a terminal session's are made `pending` and leave their list when settled.
- **The publisher** keeps `pending` and `delivered` broker items (`session.brokerItems`), persists the merged list and never restores a broker kind or an owner kind from its store.
- **The card** (`RequestCard.tsx`) collapses to "Answered · <what>" on its own `delivered` outcome and whenever its item's state is `delivered`; `swapOf` keeps such an item docked. `swapOf` already skips an `async_input` item without reading its request.
- **A terminal session's list** (`src/services/lane-a/attention.ts`) is one item per request in the bridge's `pending`, built by `laneAEntryOf` (`src/shared/lane-a/attention-entry.ts`), kind `question` for an asynchronous question; it leaves at the bridge's `settled`, and a stream lost for 5 s (`STREAM_GRACE_MS`) clears the list. For a terminal session on another machine the list is held in the window: `connectRemoteLaneA` (`src/renderer/src/lane-a/remote-connect.ts`) mirrors the remote state's `pending` into the attention store with the same function.
- **Corrected: nothing MAWS lists of a terminal session reaches another machine.** The machine's attention feed places every record as a session that machine runs (`recordedPlacement` in `src/endpoint/targets.ts`) and cuts it by the member's rank on that placement; the record source answers none for a terminal session asked that way (`record` in `src/endpoint/rl10/members.ts` returns null when the lane differs). So the feed never carries a terminal session's item, the other machine's badge and Needs you never count one, and such a request is drawn there only in the session's open pane, from the window's mirror of the bridge's state. A feed snapshot replaces the machine's whole partition in the window's store (`applyRemote` in `src/renderer/src/stores/attention.ts`), the mirrored session included, and the mirror writes again only when its entries change (`told` in `remote-connect.ts`): after a reconnect a request that still waits is no longer drawn (Reported, 8 and 9).
- **The bridge says nothing when it takes an answer.** Its `decide` records the decision and answers the caller 200; the stream carries only the `settled` that follows once the session has acted (`sminos_bridge.py`, sminos 1.46.3). An answer sent over the machine link goes down through that machine's endpoint to sminos (`src/endpoint/lane-a.ts`), whose result, `done`, comes back to the endpoint and from it to the device; the machine's own spine is told nothing.
- **Corrected: a second signal of waiting.** The digest of a terminal session driven through its bridge reads `phase: 'waiting'` whenever the bridge lists any pending request (`bridgedDigest` in `src/services/sessions/digest.ts`, fed by `src/services/spine-root.ts` with `view.state.pending.length`), an asynchronous question included. UC-1's table of readers does not name it. The glyph reads a `waiting` phase with no item as Idle, and `isWorking` reads it as not working (Reported, 5).
- **Corrected: where a question is answered outside its pane.** The hover card draws a question read-only (`preview/HoverPreview.tsx`: "never a form") with "Open session", and Needs you opens the session. Only the Overview card answers a question in place (Reported, 1).
- **Keys.** `request.accept` (Enter) and `request.decline` (Escape) are `renderer` rows of scope `pane`, bound `within` the docked frame or the Overview card's article; the dispatcher refuses a pane-scope key whose target is a text field, a button or a link (`refused` in `src/renderer/src/keymap/dispatcher.ts`). Digits pick a scope or an option through the card's own listener. Nothing delays a key after a card mounts, and the frame takes focus when its pane held it, the next request's frame from the one that just left (`handingOver`). The dispatcher runs a key repeat as it runs a first press: it reads `event.repeat` only for the key of a hold action (`dispatchKey`). It refuses any key pressed while an input method composes (`refused`).
- **The scopes.** `scopeOptions` (`request-card/scope.ts`) answers `once`; `once, session`; or `once, session, local_settings`, and `once` alone for a request raised by an ask rule. The broker writes the rule for the scope; the answer carries the scope alone.
- **The plan.** `RequestAnswerSchema`'s plan answer is `{kind, outcome, feedback}`, strict (`src/shared/engine/answers.ts`); the broker's `toWire` allows with the input and the engine restores the earlier mode. The engine host tracks that mode as `prePlanMode` in the session's status (`src/engine-host/session-status.ts`), null when the session entered Plan from a mode it did not know. The mode menu's entries are `MODE_OPTIONS` (`src/renderer/src/statusline/mode-menu.ts`), bypass with a confirmation.
- **Corrected: an answer and a mode change are graded apart.** At another machine's endpoint `session.answer` on a plan takes the grade `approve` (`src/endpoint/by-effect.ts`) and `session.setPermissionMode` takes `manage` (`src/shared/ipc/grades/session.ts`) under the machine's ceiling. A machine on build F refuses an answer that carries a key it does not know (`malformed`): its endpoint holds an input strictly to its own schema (`holdsToSchema`, read at `f1852de3a`: a `safeParse` of a strict object) (Reported, 2).
- **Which build serves a session.** The window holds the latest `host.status` (`src/renderer/src/stores/hosts.ts`, its field `supervisor`): the engine host's wire fingerprint (`supervisor.wire`) beside this app's (`appWire`). The fingerprint is taken over the whole registry of commands and events (`src/shared/ipc/wire-fingerprint.ts`), so it differs between two builds whenever a command's input does. An engine host of another build can serve this build's window: a session kept across an update runs on under its old host until it is idle (`e2e/cross-build.spec.ts`, the update scenes), and that host reads what it is sent tolerantly, dropping a key it does not know.
- **The trust card.** `TrustDetails` (`src/renderer/src/sessions/TrustCard.tsx`) is mounted by the composer's trust card, the remote setup sheet (`RemoteSetupSheet.tsx`), a comment card's thread (`side/card/CardThread.tsx`) and the comment's trust notice (`tools/document/comment-session.tsx`). `DockedCardFrame` appends "· Composer paused · draft preserved" to every title.
- **The notification.** `canAllow` (`src/main/attention/actions.ts`) reads the request afresh and admits a read-only tool; the notifier asks it before posting and sends `actions: ['Allow once']`; the port turns each action into a button (`src/main/client/electron-port.ts`). A terminal session's item is told in-app only (`isLaneAItem`), and a remote one carries no action.
- **The hover card's approval** is `hoverApproval` (`request-card/quick-approval.ts`): a pending permission for a read-only tool with nothing withholding quick approval, by pointer click only (`usePointerOnly`). `sidebar/RequestPreview.tsx` is the slot's fallback, drawn only where the card is not registered (unit tests of the sidebar).
- **The file preview** (`preview/ToolPreview.tsx`) prints the absolute path and the old and new text as two blocks cut at six lines. `EditDiff` (`src/renderer/src/transcript/view/cells/EditDetail.tsx`) draws `Hunk[]` with line numbers and takes `cell: null`. Past 64 KB of line text it leaves out the middle lines, and it cuts the middle of a single line past that size (`budgeted`, `Truncated`); with no cell its "lines omitted" row offers no way to the rest. `files.read` answers a missing file inside the session's folders with an error whose message opens `not found:` (the rule `tools/code/viewer/viewer-store.ts` already reads), and refuses a path outside them.
- **The terminal's answers.** `answerIntent` (`src/shared/lane-a/answers.ts`) is shared by the local driver (`src/services/lane-a/decisions.ts`, `driver.ts`) and the adapter for another machine (`src/main/lane-a/remote.ts`); it refuses a skip of every question and a decline on an asynchronous question. The driver reads the bridge's declared controls from its status (`capabilities.controls`, a free record), and maps a decision's answer by HTTP status; a 409 with no `settled`, `winner`, `by` or `code` becomes `not_pending`. A bridge before 1.47.0 answers a decision whose `behavior` is neither allow nor deny with 400, before it records anything (`_check_decision`, sminos 1.46.3).
- **Tests that pin what changes** are listed per milestone. Electron e2e specs drive the permission card by the radio "Allow once" and the button "Allow" in about two dozen spec files, most of them `-live` specs that no gate runs, and in one shared helper (`allowNext` in `e2e/support/maws-tools.ts`, which seven more specs call); M7 gives the search that finds them.

## Decisions settled at authoring

Each is a means the section left open, with its reason and what lost. Decisions that change what the owner sees beyond the section's words are under "Reported to the architect" instead.

1. **`selectPendingOf` keeps its name and signature** and changes its meaning to "the items for which `waits` holds". Twenty files of other children read it (the sidebar, the tabs, the palette, the resume chooser, the side thread, the floating card, the agent list); none is edited, and each follows UC-1 by this one change. Lost: a new name with the old one removed, which would be an edit in every sibling's file for no change in what they mean.
2. **The list decides when a card goes; a card never hides on its own word.** After its answer is delivered a card stays as it is while sending, its controls disabled, until its item is no longer in the session's list of what waits, which each route's holder says at once (§B, §C). It draws no "Answered" line in between. The composer's place is given back by that same list (`swapOf`), so a card that drew nothing while its item was still listed would leave the place empty, and a card that hid on its own word would disagree with the row, the tab and every other window. An item whose state is `delivered` (only a machine on an older build still sends one) is not in the list, so nothing is drawn for it. The "Answered in the terminal: Allowed" note of three seconds (`useSettling`) is kept: it is held by the docked frame's own state, not by an item, so it counts nowhere. "Already answered elsewhere" (two seconds, a lost race) is kept: it is not an "Answered" line of ours. Lost: the first text of this decision, the card returning nothing at its own delivered outcome.
3. **One holder of "accepted, not settled", on the session's machine** (the architect's ruling of 2026-11-12 on the review's third finding): the lane A list in that machine's spine. It is told by the driver when the answer came from a window of that machine, and by that machine's endpoint when it came over the link, through a command of the machine's own, `laneA.accepted` (§B). No window keeps a mark. Lost: the mark in the window that answered (the first text of this decision), which left two windows disagreeing; omitting the request from the bridge state the driver publishes (`LaneAState.pending`), which changes the meaning of a field that the race and the answer's capability also read. What a window on another machine can then show is not what the ruling assumed, and is Reported 8.
4. **The 400 ms rule is built now**, on the card's three keys in the docked frame and the Overview card. The frame takes focus by itself when its pane held it, so a ⌘↩ meant for the composer could otherwise allow a prompt that appeared under it; that hazard exists today with Enter. The other guards of A3 need a composer that is still there and wait for U1b.
5. **The docked frame's title stays on a request** ("Approval needed · Composer paused · draft preserved"): the composer is paused while a card is docked, and U1b removes the frame. The card's own first line replaces the tool-name heading and the "wants to" line under the frame's title. **The three cards another child docks** (trust, relay-down, failed start; all in `sessions/SetupCard.tsx`) read their title alone from this landing on. l4-approvals-13 asks it of the trust card, and its two siblings in the same component take the same change so that the three read alike; the section gives that sentence under l4-approvals-08.
6. **The hover placement keeps its layout** (l4-approvals-08, "Not included"): its heading, the title, the "wants to" line, the project and age line and the folder line stay. Only its buttons and their rule change (M6). The new card content of l4-approvals-02 applies to the docked, Overview and inline placements. So the folder line goes from those three and stays in the hover card.
7. **A plain deny of an asynchronous question is the dismissal, at the one mapping** (`answerIntent`), and the card decides which gesture sends it: the Dismiss button, never Esc (O-22 keeps Esc sending nothing there). Lost: a new member of `RequestAnswer` for a dismissal, which changes the wire of `session.answer` and `laneA.answer` for an act only one route has; a new command, a second path for one button.
8. **A 409 from the bridge that names no winner is re-read, for every decision, not only a dismissal.** The driver asks `GET /requests/<id>` again: still pending means refused with the bridge's sentence and the card stays; settled means `not_pending` as today. Today's mapping closes the card on a request that still waits.
9. **The diff is computed in the window**, by a pure function from the file's text and the call's input, and drawn by the transcript's `EditDiff`. No dependency is added; `fast-diff`, already in the tree, may serve a line diff, and the algorithm is the executor's. `EditDiff` takes one optional prop so that the whole change can be reached (decision 19). `ToolPreview` keeps its props and its drawing: it is the fallback, and desk web imports it. Lost: Review's diff component (`@git-diff-view`), which draws its own view and not the transcript's lines; asking the session's machine for a diff, a new command for what one read gives.
10. **The plan answer names a mode only when the label could not otherwise be true.** With the earlier mode known, the button names it and sends today's answer, byte for byte: that is the path every plan approval has run. A mode picked from the menu is carried in the answer. Lost: always carrying the mode, which would send `auto` on most approvals, a mode the check ran only where it equalled the restored one.
11. **The field's type is the existing mode enum, and the broker holds it to the probed modes.** A closed list in the schema would make every later mode a change of an enum, which the wire's rule counts as a new major. So `mode` is `PermissionModeSchema`, and `PLAN_NEXT_MODES` is checked where the answer is written.
12. **One rule for outside answers, with the surface as a parameter**: the notification admits a command of one line and at most 120 characters, the hover card any command (its preview scrolls). The sidebar's fallback preview (`sidebar/RequestPreview.tsx`) changes its predicate only: it is never drawn in the app.
13. **The titles of the four key rows** are settled once, so that U1b renames nothing (Interfaces §D).
14. **A terminal session's digest counts what its list counts**: the requests that stop it and that MAWS has not answered (Interfaces §B). An asynchronous question does not make the session read as waiting.
15. **The words of a settlement that is a dismissal** (Interfaces §G): "Dismissed in the terminal", "Dismissed elsewhere"; "No longer asked" stays for a request the bridge withdrew.
16. **The e2e specs are edited in the last milestone**, in one pass: no executor runs them, and most of the edit is one substitution repeated across files. The assertions whose expectation changes are not substitutions: typecheck cannot see them, so M7 lists each with what it becomes, and the branch review reads them as expectations.
17. **The four request rows act on a fresh press only**, enforced in the dispatcher by an option of the binding (`useKeyChord`'s `fresh`; §D). The frame hands focus to the next request, and the dispatcher runs a repeat as a press, so a chord held through one approval would answer the next once its 400 ms had passed, and ⇧⌘↩ could grant a lasting rule nobody chose. A repeat is swallowed, not passed on, so it reaches no other row either. The option is the binding's because the table's shape is U6's contract ("gains three things, and nothing else changes") and the rule belongs to who answers, not to the key. Lost: a field on `ActionSpec`, which changes that contract for one consumer; a guard inside the card, which cannot see the event (the dispatcher hands a binding no event, and runs before any listener of the card's).
18. **A plan's mode is offered only where the host that writes the answer is known to apply it** (the review's first finding): the engine host's wire fingerprint equals this build's, read from the `host.status` the window already holds (§F). Under a host of another build the card is today's card, "Implement" with no menu. The same condition is checked again where the answer leaves the window, so a chosen mode is never sent as an answer without it. Lost: the host's build id (it refuses a later build whose wire is the same and which applies the key just as well); checking in main as well (the window's status only ever moves from an older host to this build's within one run of the app, so a stale reading errs on the side of no menu).
19. **The whole change can be read before it is approved**, in place: "Show all" lifts both the card's height bound and `EditDiff`'s own budget, through one optional prop, `whole` (§I). Lost: an act that opens the change in a viewer (no viewer shows a change that exists only in a call's input; it would be a new surface for one button); the card drawing diff lines of its own (a second drawing of the transcript's lines, which the section asks to be one).
20. **A button's name does not include its key hint.** The hint is hidden from the accessibility tree and the button carries `aria-keyshortcuts`, so a screen reader and a test both find "Allow once" (§D).

## Reported to the architect, and ruled

Seven points were reported at authoring. **Ruled on 2026-11-12: all seven defaults stand as written.** Each is kept here with its reason, because the milestones build it; the architect corrects the child's file to match.

1. **O-22's interim: an asynchronous question keeps the dock until U1b.** The section: "Until the placement work lands (the first pull request), the question is answered from Needs you, the Overview card or the session's hover card". In the code only the Overview card answers a question; the hover card previews it and Needs you opens the session. With the kind changed and the dock gone, the session's own pane would show nothing to answer, and "Open session" would lead nowhere. **Ruled:** the item changes kind, words and tone now, and its form stays docked until U1b gives it its row (Interfaces §C, the swap rule's last row).
2. **l4-approvals-11 on another machine: the mode is not carried.** The section: "the mode travels inside the answer, through the answer offer that exists". At the endpoint a plan's answer is graded `approve` and a mode change `manage` under the machine's ceiling, so a mode inside an answer would let a member change a mode they may not set; and a machine on build F refuses an answer with the unknown key. **Ruled:** on a session another machine runs the button has no menu, and the endpoint refuses a plan answer that names a mode (Interfaces §F and §N). A plan's mode over the link is a debt row; carrying it is an insertion in U9's files: a by-effect grade of `manage` held to the ceiling, behind a capability.
3. **l4-approvals-11's menu: only the modes the check ran.** The check of 2026-11-12 ran `acceptEdits` (two of two) and `default` (one of one) end to end, and `auto` only where it was the restored mode; `bypassPermissions` was not run. **Ruled:** `PLAN_NEXT_MODES = ['default', 'acceptEdits']`; where the mode before the plan is not known the button reads "Implement" alone and sends today's answer (Interfaces §F).
4. **The keys' amendment lands here, not with the placement.** The keys change in this landing, and charter §5.8 ("Enter/Esc on a docked request") is wrong from it. **Ruled:** this landing records a keys-only sentence at §5.8; U1b records the placement ("The record", row 3).
5. **A terminal session's digest is a reader UC-1's table does not name** (see "What the code holds today"). **Ruled:** it counts the requests its list holds as waiting that are not asynchronous questions (Interfaces §B, "The digest").
6. **A request's folder line: U1 removes it where U8 plans to move it.** **Ruled:** it leaves the docked, Overview and inline card and stays in the hover card and the sidebar's fallback preview, which U8c then sorts (Interfaces §D, "What goes").
7. **The bridge's dismissal as built** differs from the section in the sentences listed in Interfaces §G, "Where the section's words do not hold". **Ruled:** the record's sixth sentence stands as this document words it, and the architect corrects those sentences in the child's file. Two of them bear on what the owner sees: a dismissal of a terminal's asynchronous question on another machine is not carried, whatever that bridge declares; and an idle agent is told nothing until its next prompt or tool result.

Accepted with them: the three setup cards read their title alone; UC-6's Esc on an asynchronous question sends nothing; the sidebar's fallback preview is no reader in the app; a terminal session's asynchronous question follows the notification setting "asyncInput" for its in-app notice, where it followed "questions".

### Reported at the revision, and ruled

Found while the review's findings were verified in the code. Each has the default the milestones build and the one place a ruling changes. **Ruled 2026-11-13 (UTC) by the architect: both defaults stand** (Decision Log), with one condition on point 8 and one ticket.

8. **Nothing the holder lists reaches another machine for a terminal session.** The ruling on the review's third finding has two halves. The first is built as given: one holder on the session's machine, told by that machine's own endpoint when an answer arrives over the link (§B, "One holder"). The second, "a window on another machine mirrors that and holds no mark of its own", has nothing to mirror. The finding's two pieces of evidence do not hold in the code: the machine's attention feed never carries a terminal session's item ("What the code holds today": `recordedPlacement`, `record` in `rl10/members.ts`), so no feed snapshot can bring an answered item back, and no badge on the other machine counts such a request with or without a mark. What a snapshot does is the opposite (point 9). **Default:** the device takes the machine's word from the one place it arrives, the outcome of its own act, and main says it once for all of that device's windows (`accepted` on the remote session's state; §B, "A window on another machine"). It is no window's mark and has no timer; a window on a third device waits for the bridge's settlement. **Place:** that paragraph of §B. The other answers: nothing on the device, in which case the answered card stands there, sent and disabled, until the bridge's `settled` arrives, and A1's fourth route, the ticket's own, is met only at the settlement; or let the machine's feed carry a terminal session's items to the members who may view it, which makes Needs you and the badge count such requests across machines and changes what a caller on another machine is given: a design of its own, with its own review of that boundary.
9. **A feed snapshot erases a remote terminal session's cards** (an existing fault, found with point 8; "What the code holds today"). **Default:** repaired here, in the mirror, because the test the review asks for (a feed snapshot between an acceptance and its settlement) cannot say anything true while every mirrored card vanishes at the snapshot: the mirror writes its sessions again after the machine's partition is replaced. **Place:** the last bullet of §B's "A window on another machine". The other answer: leave it and register a ticket; M1's test then covers the accepted request alone.

**The ruling on 8.** The device's `accepted` stands as built. It is not a second holder of the session's state: it records one fact that only this device has, that the machine answered `done` to this device's own act, and it gives way to every word of the machine's (the bridge's `settled`, a plane reset, a bridge that is no longer live, the request leaving the list). The condition: nothing reads it but UC-1's predicate on this device, so the request's card and this device's counts are all it can change, and M1's tests hold each of its ends open (a `done` whose `settled` is late; a plane reset between the two; the bridge ending between the two; a second window of the same device opened in between). Rejected: nothing on the device, because the answered card would then stand as waiting on the device that answered it until the settlement, which is the ticket's own complaint on the route it was filed for; and carrying a terminal session's items in the machine's feed, which changes what a caller on another machine is given and is a design of its own (registered as a ticket, not built in this wave).

**The ruling on 9.** Repaired here, in M1, in the mirror (`src/renderer/src/lane-a/remote-connect.ts`, a file M1 already edits): the mirror writes its sessions again after the machine's partition is replaced. Rejected: a ticket, because M1's test of a snapshot between an acceptance and its settlement would then pass over a list that has lost every mirrored card.

**The two labels of a plan's button where no menu is offered** ("Implement" under an engine host of another build on this Mac; the earlier mode named, with no menu, on a session another machine runs) stand as §F's table gives them: each is true where it is drawn.

## Acceptance

The child's acceptance items, cut to this landing (the edge table says what each leaves). "Unit" is a test on the build VM; "e2e" is a scene in the named spec, run on a Mac by the architect; "Mac" is a check under "Proof that an executor does not run".

| item | what is observed | proven by | milestone |
|---|---|---|---|
| A1 | In a mode that asks, a command whose result has not come is allowed once. From the click: no card and no line reading "Answered" in the pane; the composer and Stop are there; the session's row and tab read Working; Needs you does not list the session and the badge does not count it. The same in a window on another machine | unit (A17's tests; the card; the swap); e2e `requests.spec.ts`, a new scene on a replayed permission whose result is cut from the fixture; e2e `remote.spec.ts`, its permission scene | M1, M7 |
| A1, terminal | A terminal session's prompt is allowed in MAWS: the card leaves when the bridge accepts the answer, before the bridge's `settled`; if the bridge still lists the request 5 s later, it waits again | unit (the transition table of §B, with the sequence held open); e2e `lane-a.spec.ts`, its bridge double holding `settled` back | M1, M7 |
| A1, terminal on another machine | With the settlement held back: on the session's machine the request leaves its list, its row, Needs you and its badge when its endpoint hears the answer was taken; in every window of the device that answered the card leaves at the same word; a feed snapshot arriving in between brings nothing back and takes no waiting request away. A window on a third device follows at the bridge's settlement | unit (the endpoint's telling; the holder; main's remote state; two windows' mirrors; a snapshot in between; the badge on the session's machine) | M1 |
| A17 | Each reader in §A's table, handed one `delivered` item, shows nothing waiting. Each test fails on `48619c824` | unit, one test per row | M1 |
| A3 (here) | On a docked permission prompt whose frame has focus: ⌘↩ allows once, ⇧⌘↩ gives the lasting scope its button names, Esc denies; each key is printed on its button; Enter and the digits do nothing. A key pressed less than 400 ms after the prompt appeared answers nothing. A chord held down across two prompts answers the first and not the second, however long it is held. A key pressed while an input method composes answers nothing. A prompt flagged "default to no" has no key that allows and no hint on its allow buttons. The same on a focused Overview card | unit (the card; fake timers at 399 and 400 ms; keydowns with `repeat`; keydowns with `isComposing`); e2e `requests.spec.ts` | M3, M7 |
| l4-approvals-02 | The card reads, top to bottom: what is asked, the preview, the call's "Why", the engine's reason, the buttons, and the rule's file line only with "Always allow in <project>". No scope list, no tool-name heading, no folder line. A one-line command with no description: the card is at most 200 px tall at the transcript's width | unit (content by request shape, §D's table); e2e `requests.spec.ts` (the card's measured height); `c7-shots.spec.ts` on purpose (the pictures) | M3, M7 |
| A5 (here) | A terminal session's asynchronous question: its row, tab and Needs you read "Question waiting" in the calm tone; a Skip that would leave every question unanswered is disabled with its reason; Esc sends nothing | unit (`laneAEntryOf`, the glyph, the card); e2e `lane-a.spec.ts` | M2, M7 |
| A18 (here) | Dismiss on the stepper form of a blocking question sends the decline Esc sends. On MAWS's ask form it sends one answer with every question skipped. On a terminal's asynchronous question it sends the bridge's dismissal where the bridge declares it, and is drawn disabled with "Dismiss it in the terminal" where it does not; on another machine it is disabled with its reason. After it the session's row, tab and Needs you no longer count the question | unit (both states, §G); e2e `lane-a.spec.ts` with its bridge double in each state; Mac (the real plugin) | M2, M7 |
| A10 | A double-click on a single-choice option of the stepper picks it and goes on (Next, or Submit on the last); on MAWS's ask form it picks, and submits when the form is then complete; a multi-choice option and "Other…" never submit | unit; e2e `requests.spec.ts`, `maws-tools.spec.ts` | M2, M7 |
| A11 | A prompt for a file that does not exist reads "Create <name>", for one that exists "Edit <name>", with the path relative to the working folder and the change as numbered diff lines with three lines of context and "Show all". "Show all" shows every line of the change, each whole, however large the change is. While the file is being read, and when it cannot be read, the card shows the input alone under "Write <name>" or "Edit <name>", and its buttons answer | unit (the pure function; the card with the read held open, failed, and never answered; a change past the diff's budget and one oversized line, each read in full before the answer); e2e `requests.spec.ts`, `c7-shots.spec.ts` | M4, M7 |
| A12 | A plan's primary button reads "Implement · <mode>" with the mode the session was in before Plan; a mode picked from its menu is the mode the session is in afterwards. On a terminal session and on a session another machine runs there is no menu. Where the engine host that serves the session is of another build, the button reads "Implement" with no menu, and no answer ever leaves the window naming a mode | unit (the card; the broker's wire for a named mode; the endpoint's refusal; the gate, at the card and at the port); e2e `requests.spec.ts` on a replayed plan; the cross-build run (the gate's signal in the real crossing) | M5, M7 |
| A13 | In a folder with no project settings and no `.mcp.json` the trust card shows the path, "Nothing in this folder loads or runs automatically.", where trust is recorded and its three buttons, and no list; with files found it is as today. The frame's title is "Trust this folder?" and nothing more | unit (`sessions/cards.test.tsx`); e2e `sessions.spec.ts` | M5, M7 |
| A14 | The rule of §H: a notification for a short command carries "Allow once" and "Deny" and each does what it says; one for a file change carries "Deny" only; the hover card offers the same for the same requests, by pointer click only | unit (the rule's table; the notifier; the actions re-read at the press); e2e `shell.spec.ts`, `requests.spec.ts` (the hover card); Mac (a signed build, U14's check "l1-sessions-08") | M6, M7 |
| A16 | Deny with a reason and Deny and stop; the Question sheet's form; answering from the Overview card; who asks and how many wait; the transcript's follow behaviour: unchanged | the unit tests that hold them today, named in M7, pass unedited except for the selector of the Allow control | M7 |
| §K | What the landing sends, and what build F does with it, each row | unit, one test per row of §K's table | M1, M2, M5 |

## Plan of Work

Seven milestones. M1 is the contract and lands first inside the branch: everything after it reads `waits`. M2 to M6 each change one card or rule and are independent of each other but for two edges: M4 fills the preview region M3 lays out, and M6 uses the button words M3 settles. M7 edits the e2e specs, writes the record and runs the acceptance.

### M1 — One predicate, the publisher and every reader

**What exists at its end.** "Waiting" has one definition, and an answered request waits nowhere. The publisher keeps and sends only waiting broker items. A card goes when its item stops waiting, and its item stops waiting at the answer: at the broker's flushed write for a session MAWS runs, at the bridge's acceptance for a terminal session, whichever machine the answer came from. The composer is back at that moment. A terminal session reads as waiting only for a request that stops it and that has not been answered.

**What it touches.** `src/shared/attention/kinds.ts`; `src/services/attention/service.ts`; under `src/renderer/src/`: `attention/derive.ts`, `attention/glyph.ts`, `attention/navigation.ts`, `stores/attention.ts`, `composer/docked/swap.ts`, `request-card/RequestCard.tsx`, `request-card/inline.tsx`, `request-card/quick-approval.ts`, `request-card/variants/Notice.tsx`, `lane-a/remote-connect.ts`, `harness/composer/ComposerHarness.tsx`; `src/main/attention/notifier.ts`, `actions.ts`; `src/main/lane-b/remote-session.ts`; `src/main/lane-a/remote.ts`, `remote-state.ts`; `src/services/lane-a/attention.ts`, `driver.ts`, `src/services/spine-root.ts`, `src/services/sessions/digest.ts`, `inactive-archive.ts`, `stub-source.ts`; `src/endpoint/lane-a.ts` and where the endpoint composes it (`src/endpoint/actions.ts`); `src/shared/ipc/schema/lane-a.ts`, `src/shared/ipc/grades/lane-a.ts`, `src/shared/ipc/wire.ts` and the two generated wire files; comments only in `src/engine-host/pending-counts.ts` and `src/endpoint/lane-b-pending.ts`. Insertions in files other children own: `src/renderer/src/sidebar/RequestPreview.tsx` (§N). Their tests.

**Interfaces.** Exposes §A (to U2, U7, U8, U9, U10, U12, U13 and to every later milestone), §B and §C. Consumes nothing.

**Decisions.** Decisions 1, 2, 3 and 14; Reported 8 and 9. Seen in the code:
- `attention.request` answers only for an item the publisher's broker list holds, so after this milestone it answers null for a delivered request. Nothing asks: no placement draws one.
- `forgetClosedDrafts` then drops a question's draft at the answer. That is right here; U1b, which draws the given answers in the row, changes what holds them.
- The notifier closes a request's banner when its item stops waiting, so a banner now closes at the answer, not at the engine's confirmation.
- `src/engine-host/` is not a reader: the broker's `live` and `processExited` and the request events the session stream holds stay "pending or delivered" (the child's file, "What does not read it"). The engine host still sends every live item in `session.brokerItems`; the publisher and `src/endpoint/lane-b-pending.ts` filter it.
- The service's restore logic compares states for its own lifecycle (an error seen, a confirmed legacy item) and stays; its two "still open" comparisons become the predicate.
- The broker tells its items before `session.answer` returns, so for a session MAWS runs the list has usually dropped the item by the time the card hears its own outcome. Nothing may rest on that order: the card's rule (§C) holds in either.
- The endpoint's copy of an act (`Copy` in `src/endpoint/lane-a.ts`) keeps its op and its sender. For a `sminos.answer` or a `sminos.decide` it must also keep the session and the request its digest names, and tell the spine once per op, when sminos's result says `done`.
- `CommandGrades<'laneA'>` (`src/shared/ipc/grades/lane-a.ts`) asks a grade of every `laneA.*` command: `laneA.accepted` takes `approve`, the strictest an answer takes. It is a row of no offer and is addressed by no app session, so the offer audit (`test/lane-b/offer-coverage.test.ts`) does not reach it. The cross-build group's gap probe sends every command its generated sample (`e2e/support/cross-build-samples.ts`); this one's names no session the driver drives, and so changes nothing.
- The wire moves: one command, and one optional field of the lane A state. `WIRE_MINOR` rises by one here with its comment; M5's `mode` joins the same number. Another landing may raise it too: whoever merges second takes the next number and makes the generated files again.
- U3a removes the `task.notification` branch of `service.ts` in parallel (UC-8), and U9 works in `src/endpoint/` beside this (its own files are `offers.ts`, `capabilities.ts` and `calls.ts`); whoever merges second keeps both changes.
- No edit in `composer/Composer.tsx` (U4's) or `session/SessionPane.tsx` is needed: both read `selectPendingOf` and `swapOf`.

**What it does not touch.** The broker and its states; the transcript; what the cards hold (M3 to M5); `isOpen` in `stores/layout-model.ts` and in `apps/desk-hub`, which are other things with the same name; the machine's attention feed and what it carries (`src/endpoint/attention-feed.ts`, `targets.ts`); the sminos plugin; any e2e spec.

**What it proves.** A1 and A17 at the unit level, and §K's rows for the lists, the command and the remote state's field. Tests, by the behaviour each asserts:
- `waits` holds for `pending` alone; `waitsOnAnswer` adds a request id; `waitingByCall` and `waitingAgents` over a list with a pending, a delivered and a confirmed item.
- One test per row of §A's reader table, each handing its reader one `delivered` item. They call the readers, not the new predicate, so they compile on today's tree and fail there by assertion.
- The publisher: a broker list holding a pending and a delivered item is sent and persisted as the pending one alone; `attention.list` answers the same.
- The card: after a `delivered` outcome it draws no "Answered" text and its controls are disabled; when its item then leaves the list the placement draws nothing and, docked, the editor is back with focus; the same when the item leaves the list before the outcome arrives; a delivered outcome whose item never leaves keeps the card standing, disabled; an item of state `delivered` in the store is drawn by no placement and binds no key; a failed write returns the controls with "Couldn't deliver the answer" and Retry; `not_pending` reads "Already answered elsewhere" for two seconds.
- The swap: an answered item does not dock and the next waiting one does; the count of those behind it does not include the answered one.
- The holder (§B's table), each with timers faked and the sequence held open: accepted then settled; accepted and still listed by a fresh state at the grace's end, which waits again; accepted while the stream is not fresh; an answer whose outcome is `unknown` hides nothing; the bridge leaving `live` forgets every mark. Each for both tellers: the driver's own `delivered`, and `laneA.accepted` naming the engine session the driver drives. `laneA.accepted` for a session it does not drive, or for a request its bridge does not list, changes nothing.
- The endpoint: a `sminos.decide` and a `sminos.answer` whose result is `done` call `laneA.accepted` once with the digest's session and request, however many copies of the op are held; a refused or failed result calls nothing; a call that fails is logged, and the `done` still goes to the device.
- The settlement held back, on the session's machine: after an answer over the link is accepted, that machine's list, its `attention.changed`, its digest and its badge (the notifier's count over the spine's view) no longer carry the request, though the bridge still lists it.
- The settlement held back, on the device: main's remote state names the request in `accepted` and says so once to every window that watches the session; two windows' mirrors both omit it; the bridge's `settled` removes the entry; a reset whose snapshot still lists the request removes the entry and both mirrors list it again; a paused subscription changes nothing; an `unknown` or a refused outcome adds no entry.
- A feed snapshot in between: after an acceptance, `remote.attention` for that machine arrives. The accepted request is still not drawn, and a second, unanswered request of the same terminal session is still drawn.
- The digest: a bridged session with one asynchronous question and a running turn reads `working`; with one blocking request, `waiting`; with that request accepted and still listed, `working`.
- A tree test: no file under `src/` outside `src/engine-host/` imports `isOpen` from the attention kinds, and none compares an attention item's state with `'delivered'`. How it recognises a comparison is the executor's; it must fail on `48619c824`.

Tests that pin today's behaviour and change: in `request-card/RequestCard.test.tsx`, every expectation of a status "Answered · …" (the stepper's submit, Skip and Esc cases; "delivered collapses to one line…"; "an item already delivered when the card mounts renders the collapsed line"; "the next request in the same Overview card inherits neither…"); `composer/docked/swap.test.ts` ("keeps an answered request docked (collapsed) until it retires"); `attention/derive.test.ts` ("counts delivered items…"); `attention/glyph.test.ts` (its closed-state case); `attention/navigation.test.ts` ("a permission request answered: its item, held in the list…", where the toast is now dismissed at `delivered`); `stores/attention.test.ts` ("is kept while its item is open (pending or delivered)…"); `src/main/attention/notifier.test.ts` (an item first seen delivered; the badge's count; "withdraws a request banner when the request resolves"); `test/endpoint/lane-b-notify.test.ts` ("counts only the items that wait on an answer…": two becomes one); `src/services/attention/service.test.ts` ("keeps the broker's pending and delivered items…" and its two neighbours); `src/services/lane-a/attention.test.ts`, `lane-a/remote-connect.test.ts`, `src/main/lane-a/remote-state.test.ts` and `test/lane-a/remote.test.ts` (the lists and the remote state after an answer); and, in U10's directory, `shell/floating.test.ts` ("a new permission request or question raises the pill…", whose delivered item was "the same request, still pending").

### M2 — Questions: the terminal's asynchronous question, Dismiss, double-click

**What exists at its end.** A terminal session's question that does not block is an `async_input` item: "Question waiting", calm tone, on the row, the tab and Needs you. Its form stays docked until U1b (Reported, 1). Every stepper form in the app and MAWS's ask form have a Dismiss button. On a terminal's asynchronous question the button sends the bridge's dismissal where the bridge declares it and is disabled with its reason where it does not, and on another machine. A double-click on a single-choice option picks and goes on.

**What it touches.** `src/shared/lane-a/answers.ts`, `attention-entry.ts`; `src/services/lane-a/decisions.ts`, `driver.ts`; `src/main/lane-a/remote.ts`; under `src/renderer/src/`: `session/controls/lane-a.ts`, `lane-a/race.ts`, `composer/docked/swap.ts`, `request-card/RequestCard.tsx`, `request-card/variants/Question.tsx`, and in `tools/maws/ask/` the sheet (`AskSheetTool.tsx`), the in-place form (`HoverAsk.tsx`), the single-choice modality, `store.ts` and `copy.ts`. Their tests.

**Interfaces.** Exposes §E and §G; consumes §A, §B and §C from M1.

**Decisions.** Decisions 7, 8 and 15. Seen in the code:
- `requestKind` (`answers.ts`) names the shape of the answer a request takes and keeps answering `question` for an asynchronous one; the item's kind is decided in `laneAEntryOf` alone. The request view stays `question.requested`, so the card, the hover preview and the Overview card read it as they do today.
- Readers that take `async_input` to mean the owner channel's mark or MAWS's ask, each checked and each right for an item with a request id and no anchor: `attention/anchor.ts` (`ownerAnchorOf` answers null, so the session opens), `attention/navigation.ts` (`isMawsAsk` decides by the request's kind), `attention/glyph.ts` (the calm "Question waiting"), the publisher's restore (never restores the kind; the list is a live projection). The executor sweeps `'async_input'` once more for a reader added since.
- The notifier groups a notice by kind, so the item now follows the setting "asyncInput"; a terminal session's item stays in-app only by its id (`isLaneAItem`), as the owner ruled.
- `swapOf` skips `async_input` before it reads the request. It must now read the request of such an item when the item has a request id and no anchor, and dock it when the request is `question.requested` (§C).
- Dismiss on MAWS's ask is one call of the store's own submit with every question `skipped`, whatever the drafts hold; it is gated as Submit is where the session's machine does not offer the answer (`useRemoteUnavailable(appSessionId, 'maws.ask.answer')`).
- Radix's radio fires its change on the first click; the double-click handler acts on the option's own label, not on the state it reads.

**What it does not touch.** The row of a question, its receipt, and anything under `transcript/` (U1b); the bridge, the plugin or its files; `apps/desk-hub/src/protocol/rpc.ts` (the daemon's `decide` shape stays allow or deny); Dismiss on a permission prompt, a plan, Needs you or any list (the section offers none).

**What it proves.** A5, A18 and A10 as cut, and §K's rows for the kind and the dismissal. Tests:
- `laneAEntryOf`: an asynchronous question is an `async_input` item with a `question.requested` view; a blocking one is a `question`.
- The glyph and Needs you for such an item: "Question waiting", counted in the badge as today.
- `answerIntent`, the table of §G row by row; `decisionFor` builds exactly `{behavior: 'dismiss'}`; the driver posts it with `by` and the launch and with no other key; each row of §G's result table, the re-read of a 409 with the sequence held open (the re-read pending, then answering pending, settled, and failing). A bridge that answers the dismissal 400 (a bridge before 1.47.0 behind a status the driver still holds from a newer one): `refused` with the bridge's sentence, the question still listed, the card back at its controls with Retry.
- The adapter for another machine refuses a dismissal before any act is built, when the remote state declares the control and when it does not.
- The card, both states: with a bridge state that declares `decide.dismiss`, the button is enabled and its press calls `laneA.answer` once; with a state that lacks the key, the button is disabled and its title is "Dismiss it in the terminal"; with the key present and unavailable, its title is the bridge's reason; in both, Esc sends nothing and the Skip that leaves every question unanswered is disabled.
- The settlement's words, §G's table.
- The stepper: Dismiss on a blocking question sends the plain deny once; a double-click on a single-choice option on a middle step advances, on the last step submits once, and where the session cannot carry the submit only picks; on a multi-choice option and on "Other…" it never submits; without the two props (desk web's use) the stepper has neither.
- MAWS's ask form: Dismiss sends one answer with every question `skipped` and ignores a half-typed "Other"; a double-click that completes the form submits once; one that leaves another question empty only picks.

Tests that pin today's behaviour and change: `src/shared/lane-a/answers.test.ts` and `src/services/lane-a/decisions.test.ts` (the refusal "an async question is answered, never declined"); `session/controls/lane-a.test.ts` (the same sentence as a capability); `request-card/lane-a-card.test.tsx` ("never declines an async question…": Esc still sends nothing, and the test gains the button); `src/services/lane-a/attention.test.ts` and `lane-a/remote-connect.test.ts` (the kind of the asynchronous item); `lane-a/race.test.ts` (the words for `withdrawn`); `src/services/lane-a/driver.test.ts` (its `decisions` cases gain 404, 503 and the bare 409).

### M3 — The permission card: three buttons, the hints and the keys

**What exists at its end.** The card of §D in the docked frame, the Overview card and a child's inline card: one line saying what is asked, the preview, the buttons with their keys on them, the file line only with a project rule. ⌘↩, ⇧⌘↩ and Esc answer from the frame or the focused Overview card, after 400 ms; Enter and the digits no longer answer a permission prompt.

**What it touches.** `src/shared/keymap/actions.ts` (two rows, two titles; U6's file, §N); under `src/renderer/src/request-card/`: `RequestCard.tsx`, `variants/Permission.tsx`, `variants/types.ts`, `scope.ts`, `tools.ts`, `controls.tsx`; `src/renderer/src/composer/docked/DockedCardFrame.tsx`; `src/renderer/src/keymap/useKeyChord.ts` and `dispatcher.ts` (one option and one condition; U6's files, §N). Their tests, and two tests in other children's directories that list the rows (§N). Every edit in U6's files is made on a master that holds U6a.

**Interfaces.** Exposes §D; consumes U6a's row shape and `effectiveChord` (§M).

**Decisions.** Decisions 4, 5, 6, 13, 17 and 20. Seen in the code:
- U6a's dispatcher (read on its branch at `b8137ed2a`) keeps `dispatchKey`'s shape: it finds the binding that owns a key (`owner`) and runs it, and it swallows a repeat only for the key of a latched hold action. The fresh-press rule is one condition after `owner` and one option of `useKeyChord` (§D).
- The frame registers `request.accept` and `request.decline` and forwards them to the card's `bindKeys`; the two new rows are bound the same way, `within` the same element, so the dispatcher's rules (never from a text field, a button or a link; the innermost owner) hold for them unchanged. `CardKeys` gains the two actions; a variant that has none leaves them unbound.
- ⌘↩ is also `composer.send`'s default. The two cannot meet in this landing: a `composer` row needs its target inside the composer's key sink, and a `pane` row refuses any target inside a key sink. U6a's sharing rule (two `renderer` rows, at most one of scope `app`) admits the pair.
- A hint is the row's effective chord in the keymap's formatting; a row left unbound (a stored rebinding of another action holds its chord, U6a's decision 10) shows no hint and has no key.
- The reason box's ⌘↩ is the text area's own (`CardTextarea`), as today.
- `scopeOptions` stays the source of what a request offers and keeps its export; the card derives its buttons from it (§D's table). `toolVerb` keeps its export for desk web.
- The digit listener stays for the question's stepper; the permission variant no longer gives it a handler.

**What it does not touch.** The hover placement's layout (decision 6); the question, plan, dialog and form variants; where the card stands; `composer/Composer.tsx`.

**What it proves.** A3 as cut and l4-approvals-02. Tests:
- §D's button table: a request with no lasting scope (an ask rule) has two buttons and binds no `request.allowLasting`; with a session scope only, the third button reads "Allow for this session"; with a project rule, "Always allow in <project>", the file line, and "Allow for this session" as the one entry of the menu on Allow once.
- Each button sends its answer once; "Deny and stop the turn" is in Deny's menu; "Deny with a reason…" opens the box, whose ⌘↩ sends the reason.
- The keys from the frame and from a focused Overview article; none from a button or the reason box; Enter and a digit send nothing; at 399 ms nothing, at 400 ms the answer.
- A held chord, with two prompts queued in one session: the first press of ⌘↩ answers the first; the second prompt's frame takes focus; keydowns of the same chord with `repeat` set, sent until well past the second prompt's 400 ms, answer nothing and are swallowed (no other handler sees them); after a keyup, a fresh press answers the second. The same for ⇧⌘↩, where the second prompt offers a lasting scope, and for Esc; the same on an Overview card whose article shows the session's next prompt in the first one's place. One answer per press, counted.
- The dispatcher: a binding registered with `fresh` is not run for a repeat and the event is prevented; a binding without it runs as today; a hold action is unchanged.
- Composition: a keydown of each of the three chords with `isComposing` set, on the frame and on the article, answers nothing.
- A button is found by its name without its hint ("Allow once", not "Allow once ⌘↩"), and carries the key in `aria-keyshortcuts`.
- "Default to no": no allow key, no hint on the allow buttons, the buttons still answer by click. "Needs its own consent surface": no allow button, the sentence, Deny.
- A terminal session's request: a scope its bridge cannot carry and deny-and-stop are drawn disabled with their reasons and bound to no key.
- The first line by tool class (§D), "· from <agent>" only for a subagent; no heading, no "wants to" line, no folder line in the three placements; the hover placement unchanged.

Tests that pin today's behaviour and change: `request-card/scope.test.ts` (labels and details of the list); in `RequestCard.test.tsx`: "docked, the scope group offers the grant scopes; digits pick, Enter allows the picked scope", "docked with the request still loading, digits reach the frame…", "a default_to_no request never answers on Enter…", "a requires_user_interaction Read has no Allow, no scope group…", the heading "Bash", "Enter and Esc on the focused article answer through the dispatcher"; `request-card/inline.test.tsx` (headings); `request-card/lane-a-card.test.tsx` (the disabled scope and "Allow"); `settings-tab/KeymapSection.test.tsx` and `settings-tab/keymap.test.ts` (the rows' titles and ids, §N).

### M4 — A file change as a diff

**What exists at its end.** A prompt for a file change says "Create" or "Edit", shows the path relative to the working folder, and draws the change as the transcript draws an edit: numbered lines, added and removed backgrounds, three lines of context, a capped height with "Show all". The file is read from the machine the session is on. Until that read answers, and when it cannot, the card shows the input alone and answers as before.

**What it touches.** Under `src/renderer/src/request-card/`: a new pure module and a new component in `preview/` (§I), `variants/Permission.tsx`, `RequestCard.tsx` (the first line's file words), `tools.ts`. `src/renderer/src/transcript/view/cells/EditDetail.tsx` (one optional prop of `EditDiff`; §N). Their tests. Nothing in `preview/ToolPreview.tsx` but what the fallback needs (it keeps its props).

**Interfaces.** Exposes §I; consumes `EditDiff` and `Hunk` from the transcript, `files.read`, and `useWorkingFolder` from U8a (§M).

**Decisions.** Decisions 9 and 19. What is approved must be readable first: `EditDiff` bounds what it draws (it leaves out the middle of a diff past 64 KB of line text, and the middle of one line past that size), and with no cell it offers no way to the rest, so the card lifts that bound itself when the person asks to see all (§I, "Reaching the whole change"). The read is asynchronous, so its three courses are fixed here:
- *The person acts while the read is out.* The buttons never wait for it. An answer sent meanwhile is sent once; the read's late answer finds no card and writes nothing (it is dropped by the request it was made for, not by a mounted flag alone, so a card remounted for another request never shows the first one's file).
- *The read fails.* Too large (`truncated`), not text (`encoding` is not `utf8`), refused (outside the session's folders), the link down, an error of any other kind: the card stays on the input alone, under "Write <name>" for the Write tool and "Edit <name>" otherwise, and does not claim "Create".
- *The read never answers.* The same drawing stands; the card adds no timer of its own.
- Only an error whose message opens `not found:` (the files service's answer for a missing file inside the session's folders) makes "Create". Over the machine link the sentence may arrive reworded; then the card falls back, which errs on the side of saying less. The executor reads what the link gives and records it under Surprises.
- The file is read once per request and path, at most the default length of `files.read` (1 MiB); a longer file falls back. The diff is of the file as read: it is a preview, and the engine applies the edit to the file as it then stands.
- Authorisation is the files service's own: the card passes the absolute path the call names, and a path outside the session's folders is refused where the read runs, on this Mac or on the session's machine.

**What it does not touch.** Everything under `transcript/` but the one prop of `EditDiff`, whose drawing for the transcript's own rows is unchanged; a notebook cell's diff beyond its new source (the section's "Not included"); editing the proposed change.

**What it proves.** A11. Tests:
- The pure function, §I's table: an edit found once; `replace_all`; an `old_string` the file does not hold (falls back); several edits in order; a write over an existing file (a line diff, not the whole file replaced); a write of a missing file (one hunk of added lines); a notebook edit (input alone); three lines of context at the head, the middle and the end of a file.
- The whole change, reached before the answer: a diff whose line text passes `EditDiff`'s budget shows its "lines omitted" row while collapsed, and after "Show all" holds every line with no such row; a diff with one line longer than the budget holds that line whole after "Show all"; in both the buttons were enabled throughout, and `EditDiff` without the prop draws as it does today. The fallback's blocks hold their whole text and scroll.
- The card with the read held open: the fallback is drawn and the buttons are enabled; Allow pressed then sends one answer, and resolving the read afterwards changes nothing and logs nothing.
- The read rejected with `not found:` reads "Create <name>"; rejected otherwise, "Write <name>" and the input alone; never resolved, the same.
- The path: relative when inside the working folder, whole when outside or when the session has no record here, whole in the title.
- A terminal session: the diff where the read answers, the fallback where it is refused.

Tests that pin today's behaviour: none render the old blocks; the checks of the path under `data-testid="request-input"` (`RequestCard.test.tsx`, the Edit fixture `test/fixtures/requests/edit-permission.json`) change to the relative path.

### M5 — The plan's next mode; the trust card

**What exists at its end.** A plan's primary button reads "Implement · <mode>" and, on a session MAWS runs on this Mac, has a menu of the other modes an allow may name; the chosen mode is the mode the session is in after the allow. The trust card of a folder that holds nothing to load says so in one line. The three cards another child docks read their title alone.

**What it touches.** `src/shared/engine/answers.ts`, a new `src/shared/sessions/plan-next-mode.ts`, `src/shared/ipc/wire.ts` and the two generated wire files (M1 raised the minor; `mode` joins its comment), `src/engine-host/broker.ts` (`toWire`), `src/shared/lane-a/answers.ts`; `src/renderer/src/request-card/variants/Plan.tsx`, `answers.ts`; `src/renderer/src/session/controls/lane-b.ts` and `lane-a.ts` (each closes a plan answer that names a mode where its route cannot carry one); `src/renderer/src/sessions/TrustCard.tsx`, `SetupCard.tsx`, `src/shared/sessions/trust.ts`; `src/renderer/src/composer/docked/DockedCardFrame.tsx`. One insertion in U9's `src/endpoint/offers.ts` (§N). Their tests.

**Interfaces.** Exposes §F and §J; consumes `MODE_OPTIONS` and the mode labels (§M).

**Decisions.** Decisions 5, 10, 11 and 18, and the rulings on Reported 2 and 3. Seen in the code:
- The gate of §F reads the `host.status` the hosts store already holds; nothing new is asked of main. The lane B port is where a session MAWS runs on this Mac sends its answers, so the second check sits in its `answerCapability` and its `answer`.
- The check of 2026-11-12 answered the plan with `updatedPermissions: [{type: 'setMode', mode, destination: 'session'}]` beside the allow's `updatedInput`, and the engine applied the mode before the tool's result reached the model. `toWire` builds exactly that for a named mode. The update is not a grant: it is not handed to `onGrant`.
- The guard at the endpoint is where the act runs for a caller on another machine: the row of `session.answer` takes an `accepts` that refuses a plan answer naming a mode, so the refusal (`malformed`) is made on the input the engine host would act on. The window's own gate (no menu on such a session) is not the check.
- `prePlanMode` reaches the window in the session's status (`EngineSessionStatus.prePlanMode`). For a session another machine runs the card names it when the status the window holds gives it and reads "Implement" when it does not; the executor records which it finds.
- The wire's minor was raised in M1; the optional property joins that number's comment, and the generated files are made again (Concrete Steps, 2).
- `TrustDetails` is one body for four mounts (the composer's card, the remote setup sheet, a comment card's thread, the comment's trust notice), so all change together, as the section says. `TRUST_GATES` loses its last reader and is removed.

**What it does not touch.** Keep planning and Clear context and implement; the mode menu itself and the mode chip; what the trust card does (its three buttons, the home-folder wording); `src/services/sessions/trust.ts`.

**What it proves.** A12, A13, and §K's row for the plan answer. Tests:
- The schema: a plan answer with no `mode` parses as today's; `mode` is accepted only with `implement`.
- The broker: a named mode in `PLAN_NEXT_MODES` writes the allow with the `setMode` update; a mode outside it is refused and the item stays pending; no mode writes today's response, compared whole.
- The card, under a host status whose engine host has this build's wire fingerprint: with `prePlanMode` known, the label names it and the press sends an answer without `mode`; a menu entry sends its mode; with `prePlanMode` null the button reads "Implement" and the menu still lists the modes; the menu never lists Plan or the mode on the button.
- No menu on a terminal session and on a session another machine runs; `answerIntent` refuses a plan answer that names a mode.
- The endpoint: `session.answer` with a plan answer naming a mode is refused `malformed` for a caller on another machine, whatever the caller's grade; the same answer without the mode passes as today.
- Across builds, a chosen mode is never sent as a plain allow. (a) With a host status whose engine host has another wire fingerprint, and with none connected, the card has no menu, its button reads "Implement", and its press sends today's answer. (b) Under either status the port's `answerCapability` closes a plan answer that names a mode, and its `answer` returns a failure for one without calling `session.answer`. (c) The status changing between the menu's opening and the press: the entry sends nothing and the card is drawn again without the menu. (d) Why: the plan answer as build F's registry holds it (the strict object without `mode`, written into the test as F's), read tolerantly from an answer that names a mode, is a plain implement.
- The trust body: nothing found shows the path, the one line and where trust is recorded, and no list; something found is as today; the home folder is as today. The frame of a docked trust, relay-down and failed-start card reads its title alone; a request's frame keeps its words.

Tests that pin today's behaviour and change: `sessions/cards.test.tsx` ("lists what trust would load, or the generic gates…"; "docks only on needs_trust…", which finds "Composer paused" in the frame); `composer/docked/DockedCardFrame.test.tsx` (the title line of a card another child docks); `src/shared/ipc/wire.test.ts` and the manifest's fingerprint.

### M6 — From outside: one rule for the notification and the hover card

**What exists at its end.** One function says what may be answered away from a session's own pane (§H). A notification for a permission of a session MAWS runs on this Mac carries "Allow once" and "Deny", or "Deny" alone, by it; its body is the command when the request is a shell command the banner shows whole. The hover card offers the same for the same requests, on all the routes its session's port carries.

**What it touches.** A new `src/shared/attention/outside-answers.ts`; `src/main/attention/actions.ts`, `notifier.ts`, `index.ts`; `src/renderer/src/request-card/quick-approval.ts`, `RequestCard.tsx` (the hover placement's buttons). Their tests.

**Interfaces.** Exposes §H; consumes §A.

**Decisions.** Decision 12. Seen in the code:
- The notifier already reads the request before it posts a permission's notification (`canAllow`); it now takes the request's two answers and, for a shell command shown whole, its body from that one read. A read that fails posts the notification with no action, as today.
- An action is checked again where it runs. `allow` and the new `deny` read the request afresh at the press, apply §H's rule to what they read, and refuse when the item no longer waits. Between the banner and the press the request can be answered elsewhere or replaced: the press then fails, and a failed action opens the session and says so, as today.
- The port numbers a notification's buttons by position, so the notifier keeps the order it sent and maps the index back; "Deny" alone is index 0.
- A terminal session's item raises no macOS notification and a session on another machine's carries no action; both stay (the owner's ruling; the section's reason).
- The hover card answers by pointer click only (`usePointerOnly`), and the line "Approve applies to this request only" stays, as the section says. Its two buttons are gated by the session's port, each on its own answer, so a terminal session whose bridge is not live offers neither.

**What it does not touch.** `src/renderer/src/sidebar/HoverCard.tsx` and the hover placement's layout; the read-only tool list; a question's, a plan's or MAWS's ask's hover card; Reply on a turn-finished notification.

**What it proves.** A14. Tests:
- §H's table, row by row and per surface: a command of 120 characters and of 121; a command with a line break; a read-only tool flagged "default to no".
- The notifier: the actions sent for a read, a short command, a long command, an edit, a question; the body of a short command is the command; index 0 and 1 reach the right act for each set of buttons.
- The actions with the sequence held open: the request answered between the banner and the press (the press fails, the session opens); the request replaced by another under the same session (nothing is answered); `deny` on a request that still waits sends the plain deny once.
- The hover card: "Allow once" and "Deny" on a read and on a shell command of any length; "Deny" alone on a file change and on a request flagged "default to no"; neither on a question; a click synthesised by a key answers nothing.

Tests that pin today's behaviour and change: `src/main/attention/actions.test.ts` ("never answers an expired or non-read-only request from a notification"); `src/main/attention/notifier.test.ts` (the Allow once cases); `src/main/attention/index.test.ts` (the actions' shape); `request-card/quick-approval.test.ts` ("the hover approves only an open, unflagged request for a read-only tool"); in `RequestCard.test.tsx`, "offers Approve and Deny for an unflagged Read, answering by pointer only" and "shows only Open session for %s"; `request-card/lane-a-card.test.tsx` ("approves a read-only tool's permission through the bridge"). `sidebar/HoverCard.test.tsx` tests the fallback preview and does not change.

### M7 — The e2e edits, the record, and the acceptance run

**What exists at its end.** Every e2e spec that drove the old controls drives the new ones; the scenes of Acceptance exist; the reversed rulings are amended where they stand; the whole unit suite, typecheck and lint pass on the VM; the document's Progress, Surprises and Outcomes are current; the branch is handed back.

**What it touches.** `e2e/support/maws-tools.ts` (`allowNext`) and the specs below; one new replay fixture; the two agent readers, if U8b is on master ("The predicate by agent"); `docs/charter.md`, `docs/doperpowers/plans/2026-09-28-c7-composer-requests.md`, `docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md`; `docs/tech-debt-tracker.md` (the residue); this document.

**The e2e edits.** The executor edits and does not run them. They are of two kinds, and the second is not a substitution.

*Gestures.* The search that finds every site, from the repository's root: `grep -nE "Allow once|name: 'Allow'|Allow for this session|Allow scope|'Approve'|Answered ·|'Implement'|press\('Enter'\)|press\('Escape'\)|press\('[1-9]'\)" e2e/*.ts e2e/support/*.ts`, read with each hit's surrounding card. The substitutions:

| today's gesture | becomes |
|---|---|
| click the radio "Allow once", then the button "Allow" | click the button "Allow once" |
| Enter on a docked permission or on an Overview card's article, to allow | ⌘Enter |
| the radio "Allow for this session" (or the digit 2), then Enter or "Allow" | the button "Allow for this session" (or ⇧⌘Enter), or the entry of that name in the menu on Allow once when the request also offers a project rule |
| Esc on a docked permission, to deny | Esc, the same key |
| the hover card's "Approve" | "Allow once" |
| the button "Implement", by its exact name, on a session MAWS runs | the button whose name begins "Implement" |

Every key that answers a permission prompt (⌘Enter, ⇧⌘Enter and Esc alike) is now refused for the prompt's first 400 ms, so each such press follows the pattern `answerDialog` in `requests.spec.ts` already has: wait for that request's card and its control, press, and press again only while that card still shows its control enabled, until the answer is on the event stream. No scene sleeps for the 400 ms, and none presses a key at a card it has not found.

*Expectations.* Each assertion below states something that is no longer true, and typecheck cannot see it. The executor changes each as written here and lists them in its hand-back; the branch review reads them as expectations, against §C, §D and §H, not as renames. A spec not named has gestures only.

| spec, scene | today's assertion | becomes |
|---|---|---|
| `requests.spec.ts`, "a replayed permission renders in the docked frame…" | the frame holds a heading "Bash" | the frame holds the line "Run a command" and no heading "Bash" |
| the same | the radios' labels are `['Allow once']` ("once only") | the card's answer buttons are Deny and Allow once: none is named "Allow for this session" and none begins "Always allow" |
| the same | Enter with focus on the frame allows | ⌘Enter allows; Enter on the frame answers nothing (a new assertion). The other pane's key still answers nothing, pressed as ⌘Enter |
| `requests.spec.ts`, "a session-scoped allow carries the fixture's updatedPermissions" | the radio "Allow for this session" contains "Matching touch granted.txt commands"; the digit 2 checks it | a button "Allow for this session" (a session scope draws no rule text); a digit changes nothing. The answer's `updatedPermissions` are unchanged |
| `requests.spec.ts`, "the Overview card answers with focus on its article and the hover card answers by its own controls" | the article's status reads "Answered · Allowed once" | the article holds no `[data-request-card]` and no text "Answered" |
| `requests.spec.ts`, "a Read request flagged requires_user_interaction offers no quick approval anywhere" | the hover card's buttons are `['Open session']` | `['Open session', 'Deny']`: a flagged request can be denied from outside, never allowed |
| the same | "Enter and digits approve nothing"; no button "Allow"; no radio group | ⌘Enter, ⇧⌘Enter, Enter and a digit approve nothing; no button whose name begins "Allow"; the radio group's assertion goes |
| `requests.spec.ts`, "the Overview card answers with Enter on its article" | the radio "Allow once" is visible, and gone after Enter | the button "Allow once" is visible; after ⌘Enter the article holds no request card. The badge's 3 then 2 is unchanged |
| `requests.spec.ts`, "the real composer gives way to the card…" | the radios' labels are `['Allow once']`; Enter in the other pane's editor leaves the card unanswered; Enter with focus in the card answers | the answer buttons as above; ⌘Enter in the other pane's editor leaves the card unanswered too; ⌘Enter with focus in the card answers, and the editor returns with focus as before |
| `shell.spec.ts`, step "Item 3: the hover card on a Bash request answers nothing" | no button "Approve" ("Bash is not read-only") | the hover card on a shell command offers "Allow once" and "Deny", both visible and neither pressed here; its command, its folder line and "Open session" are as before. The step's title changes |
| `shell.spec.ts`, the Overview step | the Overview card of that session holds a heading "Bash" | it holds the line "Run a command" |
| `shell.spec.ts`, step "Item 3: approve the read-only request from its hover card, by pointer only" | Enter on a focused "Approve" answers nothing; a click on it answers | the same of "Allow once" |
| `sessions.spec.ts`, "C5's acceptance item 10, replay clause…" | the hover card's "Approve" answers the broker | "Allow once" does; the card's heading "Read" stays (the hover placement keeps its layout) |
| `lane-a.spec.ts`, "a permission the bridge raised…", "allowed in MAWS" | the card, the Needs you heading and the badge go after `bridge.settle` | they go after the click and the decision's 200, asserted before `bridge.settle` is called; the settle then changes nothing |
| the same | the Overview card shows the radio "Allow once" | the button |
| `lane-a.spec.ts`, "a permission card's options…", one `localSettings` suggestion | the radio "Allow for this session", then Allow | the entry "Allow for this session" in the menu on Allow once (the third button is "Always allow in <project>"); the decision's body is unchanged |
| the same, two suggestions | that radio is disabled, with its title | the third button and that menu entry are disabled with the same title |
| the same, a background request past its window | the buttons "Allow" and "Deny" are disabled with "Answer this in the terminal" | every answer button the card has is |
| `agent-tools.spec.ts`, "a child's permission renders inline" | the card holds buttons "Deny" and "Allow" | "Deny" and "Allow once" |
| `side.spec.ts`, tests 10 to 12 | the button "Allow" lies inside the card's box; the diagnostic reader finds the button whose text is "Allow" and reads the scope chosen | the button "Allow once" does; the reader finds it by its name and reads no scope |
| `maws-tools.spec.ts`, "an ask from a session not shown…" | the Overview article is the one that has the radio "Allow once" | the one that has the button |
| `c7-shots.spec.ts` | the pictures "approval-scopes" and "edit-approval" | the first shows the three buttons with their hints (and takes a name that says so); the second shows the diff |

Unchanged, and checked for it: the Needs you rows' names ("… · Approval needed") and the glyph "Needs approval" on a request that waits (`lane-a`, `remote`, `sessions`, `supervisor`); the docked frame's name "Approval needed" (`panel`, `browser-comment`, `remote`, `side`); the settlement notes "Answered in the terminal: Allowed" and "…: Denied" (`lane-a`); the trust scenes of `sessions`, `composer` and `voice`, which find the frame by its name, which the suffix was never part of; `to-human` and `design-systems`.

Specs a gate runs: `requests`, `lane-a`, `maws-tools` and the helper `allowNext` (which `deliverables`, `design-export`, `dashboard-export`, `design-systems`, `document-standalone` and `presentations-export` call), `to-human`, `side`, `panel`, `agent-tools`, `browser-comment`, `remote`, `shell`, `sessions`, `composer`, `voice`, `supervisor`, `org-page` and `widgets` where the search hits a permission card. The `-live` specs (`agent-tools-live`, `c11-live`, `c12-live`, `c12-prerun`, `composer-live`, `dashboard-live`, `design-live`, `design-systems-live`, `document-live`, `document-provisional-live`, `library-live`, `maws-tools-live`, `p1-live`, `presentations-live`, `presentations-provisional-live`, `to-human-live`) take the gestures and are run by no gate; their edit is reviewed by reading. `cross-build.spec.ts` answers its requests through the command, not the card, and takes no gesture; it gains one assertion (below).

**New scenes** (invented content, UC-11), each named by what it shows:
- `requests.spec.ts`: an allowed command whose result never comes (a copy of the permission fixture cut before its result): after "Allow once", no card and no text "Answered", the editor and Stop are visible, the session's row glyph reads Working, Needs you does not list it and the badge is one lower. The three chords and their hints; ⌘Enter within 400 ms answering nothing. A prompt with a project rule: three buttons and the file line; an ask-rule prompt: two buttons. A one-line command with no description: the card's own box (`[data-request-card]`) is at most 200 px tall. An edit of an existing file with numbered diff lines; a write of a missing file reading "Create". A change of more than twelve lines: collapsed, the region `[data-proposed-diff]` computes `overflow-y: hidden` and holds twelve lines, and the inner `.transcript-diff` computes `max-height: none` and `overflow-y: visible`; after "Show all" the region computes `overflow: auto` under 60vh (a pixel's tolerance) and the inner view is taller than 240 px; a change of exactly twelve lines offers no "Show all"; a `.transcript-diff` in the transcript itself still computes 240 px and `auto` (M4's fix; happy-dom computes no cascade). A replayed plan whose button names the mode. A double-click on the stepper's option going to the next question.
- `lane-a.spec.ts`: an asynchronous question reads "Question waiting" on its row; its Dismiss is disabled with "Dismiss it in the terminal" while the bridge double declares no `decide.dismiss`, and enabled when it declares it; the press posts `{behavior: 'dismiss'}` and the card leaves at the 200. A permission allowed in MAWS leaves before the double's `settled` (the double settles only when the scene calls `bridge.settle`).
- `sessions.spec.ts`: a folder with nothing to load shows the one line and no list.
- `shell.spec.ts` or `requests.spec.ts`: the hover card denies a file change and allows a short command once, by click.
- `cross-build.spec.ts`, in the update scene (this build's app attached to the peer's kept engine host): while attached, `host.status` gives the peer's wire fingerprint as `supervisor.wire`, different from `appWire` whenever the two builds' registries differ; once the app has moved to a supervisor of its own build, the two are equal. This is the signal §F's gate reads, shown in the real crossing; with F as the peer the fingerprints differ, since this landing moves the wire.

A fixture added or edited is scanned on the VM (`node --test .github/scripts/maws-app-scan.test.mjs`).

**The predicate by agent.** If master, when it is merged for this milestone, holds U8b's Subagents card, this milestone switches the two agent readers to `selectWaitingAgents`: `tools/agents/subagents/AgentList.tsx` and that card (U8's files, §N; each builds today the set the selector answers). If it does not, nothing is done here: U8b's document already calls the selector once this landing is on master (its §C.6).

**The record** is the table under "The pull request", written in this milestone.

**What it does not touch.** Any source file but to repair what the acceptance run finds.

**What it proves.** Every row of Acceptance that names "unit", by the whole suite on the VM; the keeps of A16, by these tests passing with no edit but the Allow control's selector: `RequestCard.test.tsx` ("Enter in the Deny… with a reason textarea is a newline; ⌘Enter sends the deny with the reason", "the caret menu denies and stops the turn"), `tools/maws/ask/AskSheetTool.test.tsx` and `draft.test.ts` (the sheet's form, Decide for me, Skip, one Submit), `overview/Overview.test.tsx` and the Overview cases of `RequestCard.test.tsx` (answering in place), `request-card/requester.test.ts` and the "more waiting" case of `composer/Composer.test.tsx` (who asks, how many wait), `transcript/view/Transcript-scroll.test.tsx` (the follow behaviour).

## Concrete Steps

Every command runs on the wave's build VM against the pushed head, through the wave's helper as the build brief gives it: `vmcheck.sh ux-wave/U1a -- '<command>'`. Its exit status is the command's; never pipe it without `set -o pipefail`. The worktree on the MacBook has no `node_modules` and stays so.

1. **Take master.** In the worktree:

       git fetch origin master && git merge origin/master

   Merge, never rebase or force-push. Then confirm step 0 is in: `test -f src/shared/keymap/build-f.ts && test -f src/shared/sessions/working-folder.ts`. If either is missing, stop and hand back: M3 and M4 need them. At this revision U8a is on master (`6e8c72738`) and U6a is not: it is built and under its branch review, its files are frozen until it lands, and no executor starts on this branch before it has.
2. **Per milestone.** Write the tests of "What it proves" first and push them with the milestone's first commit. For M1 that commit is run on the VM before anything else changes: the reader tests call the readers (not the new predicate), so they compile on today's tree and fail there by assertion, and the tree test fails on today's imports; that red run, recorded in Progress, is A17's "fails on today's tree". Then build, commit, push, and run on the VM:

       vmcheck.sh ux-wave/U1a -- 'pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       vmcheck.sh ux-wave/U1a -- 'pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       vmcheck.sh ux-wave/U1a -- 'pnpm exec eslint <the paths changed>'
       vmcheck.sh ux-wave/U1a -- 'pnpm exec vitest run <the test files touched>'

   Expect exit status 0 and vitest's `Test Files  N passed (N)`. M1 and M5 move the wire (M1 raises `WIRE_MINOR` with its comment; M5 adds to that comment). After each, regenerate the manifest on the VM and bring its diff back, since nothing can be generated on the MacBook:

       vmcheck.sh ux-wave/U1a -- 'pnpm wire:manifest >/dev/null 2>&1 || true; git diff -- src/shared/ipc; git checkout -q -- src/shared/ipc' > /tmp/u1a-wire.patch
       git apply /tmp/u1a-wire.patch        # the helper's first line is not part of the diff; the patch file is never committed

   Commit the two regenerated files, push, and run `pnpm exec vitest run src/shared/ipc/wire.test.ts src/shared/ipc/wire-fingerprint.test.ts` there without the write flag: both pass.
3. **After M7**, the whole checks:

       vmcheck.sh ux-wave/U1a -- 'pnpm typecheck'
       vmcheck.sh ux-wave/U1a -- 'pnpm lint'
       vmcheck.sh ux-wave/U1a -- 'pnpm test'
       vmcheck.sh ux-wave/U1a -- 'node --test .github/scripts/maws-app-scan.test.mjs'

   The failures that are the VM's own and not this branch's are the ones the build brief lists (the desk-hub deploy tests, `src/services/machine/setup.test.ts`, `src/shared/machine/git-reads.test.ts`, `test/artifacts/portability.test.ts`; `src/renderer/src/sidebar/Sidebar.test.tsx` under the full suite's load). Any other failure is this branch's.
4. **Stop and hand back.** The executor updates Progress, Surprises & Discoveries and the Decision Log, pushes, and reports: what exists and the command that showed it, what is not verified, the decisions made, anything that contradicts the spec, what deserves a ticket, and the e2e specs edited with the scenes added. It runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e: class 1a, the review of the branch, the e2e groups and the pull request are the architect's.

## Interfaces and Dependencies

What a sibling or a later milestone codes against is defined here, once. §A is UC-1 as every other child reads it; the rest is this landing's own.

### §A. UC-1: the predicate (M1)

    // src/shared/attention/kinds.ts: the only definition of waiting

    /** Whether an attention item still waits on the person. */
    export const waits = (item: Pick<AttentionItem, 'state'>): boolean => item.state === 'pending';

    /** A waiting item that stands for a request the person can answer (not a notice). */
    export const waitsOnAnswer = (item: Pick<AttentionItem, 'state'> & { request: Pick<AttentionItem['request'], 'requestId'> }): boolean =>
      waits(item) && item.request.requestId !== null;

    /** The waiting requests that name a tool call, by that call's id: a permission prompt's call, a question's, an ask's, a plan's. */
    export function waitingByCall(items: readonly AttentionItem[]): ReadonlyMap<ToolUseId, AttentionItem>;

    /** The agents with a request of their own waiting: every agent id, and every id of a background task that runs an agent, named by such a request. */
    export function waitingAgents(items: readonly AttentionItem[]): ReadonlySet<string>;

    // src/renderer/src/stores/attention.ts: the same over a session's list, each memoised per list so a component gets the same object until the list changes

    export function selectPendingOf(state: Pick<AttentionState, 'bySession'>, appSessionId: AppSessionId): AttentionItem[];   // name and signature kept; the items for which `waits` holds
    export function selectWaitingByCall(state: Pick<AttentionState, 'bySession'>, appSessionId: AppSessionId): ReadonlyMap<ToolUseId, AttentionItem>;
    export function selectWaitingAgents(state: Pick<AttentionState, 'bySession'>, appSessionId: AppSessionId): ReadonlySet<string>;

`isOpen` is removed from `kinds.ts`, and `attention/derive.ts` stops re-exporting it. `ACTIONABLE_KINDS` and `isActionable` are unchanged. `waitingByCall` and `waitingAgents` count an item only when `waitsOnAnswer` holds for it; `waitingByCall` keeps the oldest when two items name one call. A terminal session's request whose bridge gave no call id names its request id in that field (`laneAEntryOf`), so it is in the map under an id no transcript row has.

Who reads what:

| sibling | reads | for |
|---|---|---|
| U2 | `selectWaitingByCall`: an entry of kind `permission` is a call waiting for approval (the folded run's line reads its waiting label); an entry of another kind is a row holding a waiting form (never folded, asks no mod's site) | UC-3's two rules |
| U8b | `waitsOnAnswer` over `selectPendingOf` for the waiting-requests card's presence (its line in `Summary.tsx`, unedited); `selectWaitingAgents` for "Approval needed", which `tools/agents/subagents/AgentList.tsx` and the Subagents card call in place of the set they build today (equal to it from M1 on). Who makes that switch is settled by which lands first: U8b's document does it when this landing is on master before it; this landing's M7 does it when U8b is | UC-9 |
| U9 | `waits` | its A7 |
| U1b | all of it; it may replace U8b's presence line with its own selector | the placement |
| U7, U10, U12, U13 | `selectPendingOf`, unedited | the row, the pill, the tab |

The states:

| state | what it means | waits |
|---|---|---|
| `pending` | raised; no answer written | yes |
| `delivered` | the answer is written; the engine has not yet shown that it acted | no |
| `confirmed` | a frame from the engine named the call | no |
| `retired` | gone | no |

The readers, each of which calls `waits` or `waitsOnAnswer` and gets one test with a `delivered` item (A17):

| what the person sees | where | the test expects |
|---|---|---|
| the glyph on a row, a tab and an Overview card | `attention/glyph.ts` (`glyphFor`, `listedGlyph`) | the session's own state, not "Needs approval" |
| Needs you, its counts, ⇧⌘J | `attention/derive.ts` (`waitingItem`, `needsYou`) | no row |
| in-app notices | `attention/navigation.ts` | no toast raised; a standing toast dismissed |
| the session's list every in-session surface reads; a form's draft | `stores/attention.ts` (`selectPendingOf`, `forgetClosedDrafts`) | not in the list; the draft dropped |
| the card in every placement | `request-card/RequestCard.tsx`, `inline.tsx`, `quick-approval.ts`, `variants/Notice.tsx`; `composer/docked/swap.ts`; `sidebar/RequestPreview.tsx` | nothing drawn; not docked; no approval offered |
| the project channel's waiting cards | `channel/project.ts` | no card |
| the dock badge; notifications raised and closed; their actions | `src/main/attention/notifier.ts`, `actions.ts` | not counted; a banner closed; no action taken |
| a session on another machine, in this window | `src/main/lane-b/remote-session.ts` (`WAITING`) | not told to the window |
| what the daemon publishes | `src/services/attention/service.ts` | not in `attention.changed`, `attention.list` or the stored list |
| the counts a phone or desk client is told | `src/engine-host/pending-counts.ts`, `src/endpoint/lane-b-pending.ts` | zero |
| a terminal session's requests | `src/services/lane-a/attention.ts`, `lane-a/remote-connect.ts` (§B) | (their own tests, §B) |
| a terminal session's digest | `src/services/spine-root.ts`, `src/services/sessions/digest.ts` (§B) | `working` |
| whether an idle session may be archived | `src/services/sessions/inactive-archive.ts`, `src/services/spine-root.ts` (`archiveOpen`) | not held back |
| test doubles | `src/services/sessions/stub-source.ts`, `harness/composer/ComposerHarness.tsx` | follow the predicate |

Paths without a root are under `src/renderer/src/`.

### §B. The publisher, and the terminal route (M1)

**The publisher.** From each `session.brokerItems` the attention service keeps the items for which `waits` holds, so `attention.changed`, `attention.list`, the feed another machine reads and the stored list carry no answered request.

**One holder.** Whether a terminal session's request was answered and is not yet settled is known in one place: the lane A list in the spine of the machine the session runs on (`laneAAttention`, `src/services/lane-a/attention.ts`). A request is *listed* while the bridge's state holds it in `pending`. An answer is *accepted* when the bridge took it (its 200). The bridge publishes nothing at that moment (its `settled` follows once the session has acted), so the holder is told by whoever heard the 200:

- *An answer from a window of that machine:* the driver, in the same process, where its `answer` returns `delivered`.
- *An answer over the machine link:* that machine's endpoint, when sminos's result for a `sminos.answer` or a `sminos.decide` act it handed down says `done` (`result` in `src/endpoint/lane-a.ts`). It tells the spine through a command of the machine's own:

      // src/shared/ipc/schema/lane-a.ts
      'laneA.accepted': { input: z.strictObject({ session: z.string().min(1), request: z.string().min(1) }), output: z.void(), owner: 'machine' }
      // `session`: the engine's session id, bare, as the act's digest names it. No app session address: the command crosses no link.

  The driver finds the session it drives under that engine id and tells the holder. A session it does not drive, or a request its bridge does not list, changes nothing. The command is a row of no offer, so a caller on another machine cannot send it; the endpoint sends it only for an op sminos ran, whose grade and digest were checked on its way down. The most it can do is keep a listed request out of the list for the grace below. If the call fails it is logged and nothing else changes: the request leaves at `settled`, as today.

The holder's rule, per request (`STREAM_GRACE_MS` is 5 s):

| the request is | event | becomes | the list |
|---|---|---|---|
| absent | a fresh state lists it | waiting | told with it |
| waiting | a fresh state no longer lists it (the bridge settled it) | absent | told without it |
| waiting | an answer is accepted (either teller) | hidden; its grace ends `STREAM_GRACE_MS` later | told without it, at once |
| waiting | an answer returns `not_pending`, `refused` or `unknown` | waiting | unchanged |
| hidden | a fresh state no longer lists it | absent; the mark is forgotten | unchanged |
| hidden | a fresh state lists it, before the grace ends | hidden | unchanged |
| hidden | the grace ends while the last fresh state lists it; or the first fresh state after the grace lists it | waiting; the mark is forgotten | told with it again |
| hidden | the grace ends while the state is not fresh | hidden until the next fresh state, which decides by the two rows above | unchanged |
| any | the bridge is no longer live, or the session leaves | absent; every mark of the session is forgotten | as today |

These rules need to know whether the bridge's stream is fresh, which only the driver on the session's machine knows (`LaneAView.fresh`), so they run there and nowhere else. The stream's own rule stays beside them: a state that is not fresh for `STREAM_GRACE_MS` clears the session's list. The linearization point is the holder's own update: an acceptance, a state and a grace's end are applied one at a time there, and the list told after each is a function of the marks and the last fresh state. That function and the marks are pure, with the clock passed in.

**A window on another machine** holds no mark and runs no grace rule. What reaches it of a terminal session is the bridge's own state over the plane, which main's adapter folds (`src/main/lane-a/remote-state.ts`), and the outcome of its own acts. Nothing the holder lists reaches it: the machine's attention feed is cut to the sessions that machine runs ("What the code holds today"). So, as the default of Reported 8:

- Main's adapter (`src/main/lane-a/remote.ts`), which hears the session's machine say `done` for an answer, says so in the remote session's state, which every window of this device reads:

      // LaneAStateSchema (src/shared/ipc/schema/lane-a.ts); a remote session's only, as `link` and `acts` are
      accepted: z.array(z.string()).optional()   // the requests whose answer the session's machine has said it took, until the bridge settles them

  The window's mirror (`connectRemoteLaneA`) lists a pending request unless `accepted` names it.
- An entry leaves `accepted` when the bridge's state settles the request; when the plane is reset (a snapshot clears `accepted` as it clears `pending`, and the requests restated after it wait again); when the bridge stops being live. The state itself goes when the last watch ends. There is no timer.
- *When the subscription pauses* after an acceptance, the state stands as the machine last said it: the request stays undrawn, and the pane carries the link's own reason, as every control there does. When it resumes by cursor the bridge's `settled` arrives; when it resumes with a reset, the snapshot decides. *When it ends*, the session's state and its cards go together.
- A feed snapshot of the machine (`remote.attention`) replaces what the feed speaks for and leaves a mirrored terminal session drawn: the mirror writes its sessions again after the machine's partition is replaced (the default of Reported 9).

The limits, as they are. A window on a third device hears neither the `done` nor the holder, and keeps the request until the bridge's `settled` reaches it. Against a session machine on build F, that machine's own windows and digest show today's behaviour until it is updated (its spine has no holder and its endpoint tells none); nothing is added on this side for it, and this device's windows follow the `done` as with any machine.

**The digest.** On the session's machine, a terminal session driven through its bridge reads `phase: 'waiting'` and `pendingRequests: n` from the requests its list holds as waiting and that are not asynchronous questions, in place of the length of the bridge's `pending`. So an open asynchronous question, or an answer the bridge has accepted and not yet settled, leaves the session reading `working` while its turn runs.

### §C. The card after an answer, and what docks (M1, M2)

The list decides when a card goes (decision 2). After its own answer is delivered a card stays in its sending state, controls disabled, until its item is no longer in the session's list of what waits. That word comes at once on every route this landing reaches: from the publisher at the flushed write, for a session MAWS runs; from the holder at the acceptance, for a terminal session; from main's remote state at the machine's `done`, for a terminal session on another machine (§B). Then no placement draws the card, and the docked frame gives the composer back with focus in the editor, as today. If the word never comes the card stands, sent and disabled, and every other reader still counts the request: nothing is hidden on one surface alone. An item whose state is `delivered` is not in the list, so nothing draws it. A failed write returns the card to its controls with "Couldn't deliver the answer" and Retry. No text "Answered · …" is drawn anywhere. `VariantProps.submit` keeps its second argument for the bodies hosted outside the card; the card no longer draws it.

What takes the composer's place, oldest first among the session's waiting items (the first row is the composer's own rule, the rest `swapOf`'s):

| item | docks |
|---|---|
| a card another child docked (trust, relay-down, failed start) | first, as today |
| a permission, a blocking question, a plan, an MCP form, a declared dialog, once its request is read | yes, as today |
| MAWS's blocking ask (`maws.ask.opened`) | no: a notice above the composer, as today (U1b removes it) |
| an owner-channel question or must-read (an `async_input` or `essential_unread` item with an anchor); MAWS's non-blocking ask | no, as today |
| **a terminal session's asynchronous question** (an `async_input` item with a request id, no anchor, and a request read as `question.requested`) | **yes, until U1b** (Reported, 1) |
| an item whose answer was delivered | no |

### §D. The permission card (M3)

Drawn so in the docked, Overview and inline placements; the hover placement keeps today's layout.

    ◐ Run a command · from <agent>                 what is asked; who asks, only when it is not the main agent
    ┌ the command, the diff, or the input ┐        the preview (§I for a file change)
    Why: <the call's own description>              when the call gave one
    <the engine's reason>                          when it gave one
    Deny with a reason…        [Deny  Esc ▾]  [Always allow in <project>  ⇧⌘↩]  [Allow once  ⌘↩ ▾]
    Always allow adds `<rule>` to .claude/settings.local.json in the project.      only with that button

**The first line**, by the tool's class (`toolClass`): "Run a command"; "Create <name>", "Edit <name>" or "Write <name>" (§I says which), "Edit N files" when the call names several; "Read a file"; "Search files"; "Fetch a page"; "Search the web"; "Use <server> · <tool>" for an MCP tool; "Use <tool>" otherwise. The glyph and tone are the kind's (`ATTENTION_HEADINGS`).

**The buttons**, from what `scopeOptions` answers for the request:

| the request offers | buttons, left to right | menu on Allow once |
|---|---|---|
| `once` (an ask rule raised it, or the engine withholds a lasting rule) | Deny · Allow once | none |
| `once`, `session` | Deny · Allow for this session · Allow once | none |
| `once`, `session`, `local_settings` | Deny · Always allow in <project> · Allow once, and under them "Always allow adds `<rule>` to .claude/settings.local.json in the project." | one entry, "Allow for this session" |
| flagged "needs its own consent surface" | Deny, and today's sentence saying why | — |

`<project>` is the project's name, "this project" without one; `<rule>` is the rule's text as `scopeOptions` words it today. Deny's menu holds "Deny and stop the turn". "Deny with a reason…" is the quiet text button at the left and opens the reason box. Each button a terminal session's bridge cannot carry is drawn disabled with the port's reason.

**The keys.** Rows of `ACTIONS`, placed after `request.decline`:

| id | title | default | scope | on a permission prompt | on a question's form | on a plan |
|---|---|---|---|---|---|---|
| `request.allowOnce` (new) | Allow once | `Cmd+Enter` | pane | Allow once | — | — |
| `request.allowLasting` (new) | Allow with the lasting scope the prompt names | `Cmd+Shift+Enter` | pane | the third button | — | — |
| `request.decline` | Deny a prompt, or decline a question | `Escape` | pane | Deny | declines a blocking question, as today; nothing on an asynchronous one | opens Keep planning's feedback, as today |
| `request.accept` | Next or Submit on a question; Implement on a plan | `Enter` | pane | — | Next, or Submit, as today | Implement, as today |

Both new rows are `sink: 'renderer'`, `menu: null`. These are the defaults U6a's test already holds for the four ids (its Interfaces §E); no edit to that test is needed. Neither new id is in `BUILD_F_ACTION_IDS`, so neither takes a rebinding, and Settings draws no Change control on them.

A permission prompt's keys act when the docked frame, or the Overview card's article, itself holds focus (today's rule for a pane-scope row), and only once the prompt has been drawn for 400 ms. A request flagged "default to no" binds neither allow key and prints no hint on its allow buttons. A row with no effective chord prints no hint.

**A fresh press.** The four `request.*` rows act on a fresh press only. A keydown that is a key repeat reaches no request handler and is swallowed, so a chord held through one answer cannot answer the request that takes its place, however long it is held; the next answer needs the key let go and pressed again. It is enforced in the dispatcher, by an option of the binding (decision 17):

    // src/renderer/src/keymap/useKeyChord.ts (U6's file; §N)
    opts: { within?; enabled?; onRelease?; fresh?: boolean }   // fresh: run on a first press, never on a key repeat
    // src/renderer/src/keymap/dispatcher.ts, in `dispatchKey`, once `owner(id, target)` has answered a binding:
    //   the binding asked for `fresh` and the event has `repeat` → the event's default is prevented, nothing runs, and the key is taken

The docked frame and the card pass `fresh` for all four rows, so a card another child docks has the rule too. The dispatcher's composition guard stays as it is: a key pressed while an input method composes reaches no request handler.

**Names.** A key hint is drawn inside its button and is not part of the button's name: the hint is hidden from the accessibility tree and the button carries the key in `aria-keyshortcuts`. A button is found, by a screen reader and by a test, as "Deny", "Allow once", "Allow for this session" or "Always allow in <project>".

**What goes** from the three placements: the scope list and its digits; the tool-name heading; "<requester> wants to …"; the session's folder line; Enter allowing. The hover placement keeps its heading, its lines and the folder line (Reported, 6).

### §E. The question forms (M2)

`QuestionBody` (`request-card/variants/Question.tsx`) takes two optional props, both absent in desk web's use, which then draws today's stepper:

    dismiss?: { disabled: boolean; title: string | undefined; run(): void };   // the Dismiss button in the form's foot, apart from Submit; no key
    doubleClick?: boolean;                                                       // a double-click on a single-choice option picks it and goes on

The app's card passes both. `dismiss.run` sends the decline the form's Esc sends (the plain permission deny); its `disabled` and `title` are the port's answer for that decline (§G). On an `async_input` item the card binds no `request.decline`, as today, so the button is the one way to end the question without an answer.

MAWS's ask form (the Question sheet and its in-place form) gains the same button in its foot. It sends one `maws.ask.answer` in which every question's status is `skipped`, through the store's existing submit, and is disabled where Submit is disabled for the session's machine. A double-click on a single-choice option picks it, and submits when no question is then empty or half answered.

### §F. The plan's next mode (M5)

    // src/shared/engine/answers.ts: the plan answer gains one optional field
    z.strictObject({ kind: z.literal('plan'), outcome: z.enum(PLAN_OUTCOMES), feedback: z.string().nullable(), mode: PermissionModeSchema.optional() })
      // refined: `mode` only with outcome 'implement'

    // src/shared/sessions/plan-next-mode.ts (new)
    /** The modes an approved plan may name: those the check of 2026-11-12 ran end to end. */
    export const PLAN_NEXT_MODES: readonly PermissionMode[] = ['default', 'acceptEdits'];
    /** Whether the engine host that serves this Mac's sessions applies a plan answer's mode: its wire is this build's. */
    export function hostAppliesPlanMode(status: Pick<HostStatus, 'state' | 'supervisor' | 'appWire'> | null): boolean;
    // status !== null && status.state === 'ready' && status.supervisor !== null && status.supervisor.wire === status.appWire

The broker writes a named mode as `updatedPermissions: [{ type: 'setMode', mode, destination: 'session' }]` beside the allow, and refuses a mode outside `PLAN_NEXT_MODES` (the item stays pending). With no `mode` it writes today's response.

**The gate.** A mode is offered, and sent, only where the host that will write the answer is known to apply it. The window already holds what says so: the latest `host.status` (`src/renderer/src/stores/hosts.ts`) gives the engine host's wire fingerprint beside this app's. The fingerprint covers the plan answer's schema, so equal fingerprints mean a host that knows `mode`, and every build that knows it applies it (the field and the broker's handling land together). An engine host of another build serves this build's window in the crossing after an update, until its sessions are idle; sent a mode, it would drop the key and implement in the earlier mode, under a button that named another. So the gate is read where the card is drawn and again where the answer leaves the window: the lane B port's `answerCapability` closes a plan answer that names a mode while the gate does not hold, and its `answer` refuses one without calling `session.answer`. A menu entry pressed after the gate turned false sends nothing, and the card is drawn again without the menu. A chosen mode is never turned into an answer without it.

**The label.** Where the menu is offered: with `prePlanMode` known, "Implement · <its label>" (`PERMISSION_MODE_LABELS`), and the press sends no `mode`; with it null, "Implement", and the press sends no `mode`. **The menu** lists the modes of `PLAN_NEXT_MODES` in `MODE_OPTIONS`' order, without the one on the button; an entry reads "Implement · <label>" and sends that mode.

| route | button | menu |
|---|---|---|
| a session MAWS runs on this Mac, the gate holds | names the earlier mode when known; "Implement" when not | yes |
| a session MAWS runs on this Mac, the gate does not hold (no engine host connected, or one of another wire) | "Implement", today's card | no |
| a terminal session | "Implement" | no: the bridge carries allow and deny, never a mode (`answerIntent` refuses an answer that names one) |
| a session another machine runs | names the earlier mode when its status gives it (ruled, Reported 2) | no. The port's `answerCapability` closes a plan answer that names a mode, and this build's endpoint refuses one (`accepts` on the row of `session.answer`). A machine on build F is never sent the key; it would refuse the whole answer (`malformed`), since its endpoint holds an input strictly to its own schema |

### §G. The bridge's dismissal (M2)

The operation, as sminos 1.47.0 gives it (the doperpowers pull request that adds it; its contract is the bridge plan's Interfaces section there). A bridge that carries it declares `capabilities.controls['decide.dismiss'] = {available: true}` in `GET /status`; an observer of a session MAWS runs declares it unavailable with a reason; a bridge before 1.47.0 has no such key. It is sent on the route every decision uses: `POST /requests/<request>/decision` with `{behavior: 'dismiss', by, launch?}` and no `message`, `updatedInput` or `updatedPermissions`. It does what the terminal's own dismiss does: the question settles `{outcome: 'withdrawn', by: <the sender>}` on the stream, and the model is told with its next delivery that no answer will come, without waking an idle session.

`answerIntent` gains one intent, `{ kind: 'dismiss' }`, and `decisionFor` builds `{ behavior: 'dismiss' }` for it:

| the answer, on an asynchronous question | `controls['decide.dismiss']` | result |
|---|---|---|
| a permission `deny` | `{available: true}` | the intent `dismiss` |
| a permission `deny` | absent | refused `unsupported`: "dismiss it in the terminal" |
| a permission `deny` | `{available: false, reason}` | refused `unsupported`, with the bridge's reason |
| a question with no answers (every question skipped) | any | refused `unsupported`: "an async question needs an answer", as today |

The port's capability (`laneAAnswerCapability`) gives the same three answers as sentences ("Dismiss it in the terminal"; the bridge's reason, capitalised), and for a session on another machine closes the dismissal whatever its bridge declares: "Dismiss it in the terminal on <machine>". The adapter for another machine (`src/main/lane-a/remote.ts`) refuses the intent `unsupported` with that sentence before it builds any act: the daemon's `decide` takes only allow or deny.

What the driver makes of the bridge's answer to a decision, for every intent:

| the bridge answers | outcome | the card |
|---|---|---|
| 200 | `delivered` | gone (§B) |
| 400 | `refused`, `bad-args`, the bridge's sentence. A bridge before 1.47.0 answers a dismissal so ("behavior is allow or deny"), before it records anything: it is sent one only when the status the driver holds is stale, a newer bridge having been replaced by an older | stays; "Couldn't deliver the answer", Retry; the question still waits |
| 404 | `not_pending` | "Already answered elsewhere", two seconds |
| 409 with `settled`, `winner` or `by` | `not_pending` with the settlement | the settlement's words |
| 409 with `code` `launch` or `lane-b` | `refused` | as today |
| **409 with `error` alone** | **the request is read again** (`GET /requests/<id>`): still pending, `refused` with the bridge's sentence under a code the output schema already admits; 410 or 404, `not_pending` with its settlement; no answer, `unknown` | stays with the sentence; or settles |
| 504, 503 | `unknown` | "The answer may have been taken: the card settles if it was" |

A settlement's words on the docked card (three seconds, `settledWords`), where `withdrawn` used to read "No longer asked" always:

| outcome, by | on an asynchronous question | on any other request |
|---|---|---|
| `withdrawn`, by `terminal` | "Dismissed in the terminal" | "No longer asked" |
| `withdrawn`, by this app | nothing: the card leaves at once | — |
| `withdrawn`, by another client | "Dismissed elsewhere" | "No longer asked" |
| `withdrawn`, by `bridge` (a `/clear`, the session's end) | "No longer asked" | "No longer asked" |

**Both states are proved without the plugin.** The control is read from the bridge's status, so a state that lacks the key is the plugin as it is installed today, and a state that declares it is 1.47.0: the unit tests of M2 and the e2e scene drive the card, the port, the mapping and the driver's post in each. What that leaves is the real bridge's own behaviour, the Mac check under "Proof that an executor does not run".

**Where the section's words do not hold**, each for the architect to correct in the child's file:
1. A dismissal can come back. Its delivery is held in memory while the session is idle; if the session ends first, the question reads open on resume and the bridge raises it again. It then waits again, as a new request (§B's first row). A18's "no longer count the question" holds until then.
2. "Dismissed" cannot be read from the transcript at the press: no row carries the delivery until the next prompt or tool result. Until U3's reader sees it, the one signal is the bridge's `settled`, `withdrawn` by other than `bridge` (U1b's row reads that first).
3. An idle agent is told nothing until the person's next message or another question's answer; "the agent is told … and goes on" holds only mid-turn.
4. `withdrawn` is not always a dismissal: by `bridge` it is a `/clear` or the session's end.
5. A terminal session on another machine is not carried: the daemon's `decide` takes allow or deny, yet that machine's bridge declares the control. MAWS must not enable the button from the key alone there.
6. A 409 with `error` alone leaves the question pending; today's mapping reads it as answered elsewhere.
7. A dismissal rarely rides a plugin prompt alone; it appears there beside another question's answer, two deliveries in one row (U3's reader splits them).

### §H. What may be answered from outside a session's pane (M6)

    // src/shared/attention/outside-answers.ts (new)
    export type OutsideSurface = 'notification' | 'hover';
    export const NOTIFICATION_COMMAND_MAX = 120;
    /** What a waiting request offers away from its session's pane. */
    export function outsideAnswers(request: SessionEvent | null, surface: OutsideSurface): { allowOnce: boolean; deny: boolean };

The first row that fits decides:

| the request | Allow once | Deny |
|---|---|---|
| not a permission (a question, a plan, a dialog, a form, MAWS's ask), or not read | no | no |
| flagged "default to no", or needing its own consent surface | no | yes |
| a read-only tool (`READ_ONLY_TOOLS`) | yes | yes |
| a shell command the surface shows whole: any on the hover card; on a notification one line of at most `NOTIFICATION_COMMAND_MAX` characters | yes | yes |
| anything else (a longer command on a notification, a file change, an MCP tool, an agent launch) | no | yes |

Allow once is the once-only answer and Deny the plain deny with no reason; no lasting scope is given from outside. The caller adds what the function cannot know: the item waits (§A), and the session's port carries the answer. `hoverApproval` is replaced by this function's answer for `'hover'`. The notification's actions are sent in the order "Allow once", "Deny"; its body is the command itself when `allowOnce` holds for a shell command.

### §I. The proposed change of a file prompt (M4)

    // src/renderer/src/request-card/preview/: a pure function and the component that draws it
    export type ProposedFile = { text: string } | 'missing' | null;      // null: not read yet, or not readable
    export type Proposed =
      | { kind: 'diff'; change: 'create' | 'update'; hunks: Hunk[] }       // against the file; three lines of context
      | { kind: 'input' };                                                 // the input alone
    export function proposedChange(toolName: string, input: unknown, file: ProposedFile): Proposed;

| tool | the file | answer |
|---|---|---|
| Edit | text holding `old_string` | `diff`, `update`: the first occurrence replaced, every one with `replace_all` |
| Edit | text without it; or null | `input` |
| MultiEdit | text | the edits applied in order; `input` as soon as one is not found |
| Write | `'missing'` | `diff`, `create`: one hunk of added lines |
| Write | text | `diff`, `update`: a line diff of the old text and the new |
| Write | null | `input` |
| NotebookEdit | any | `input` |

`diff` is drawn by the transcript's `EditDiff` (`cell: null`) under a capped height with "Show all". `input` is drawn as today's old and new text, as removed and added lines without numbers.

**Reaching the whole change.** Collapsed, the diff is clipped to its capped height, and `EditDiff` draws under its own budget: past 64 KB of line text it leaves out the middle lines, and it cuts the middle of one line past that size. "Show all" lifts both. The region then scrolls inside a bound of its own, and `EditDiff` is given `whole`, an optional prop this landing adds, under which it leaves out no line and cuts no line's text:

    // src/renderer/src/transcript/view/cells/EditDetail.tsx (the one insertion under transcript/; §N)
    export function EditDiff({ hunks, cell, whole }: { hunks: Hunk[]; cell: Cell | null; whole?: boolean })   // whole: every line, each in full; absent, today's drawing

"Show all" is offered whenever the collapsed drawing clips or leaves out anything. So every line of what is proposed can be read before a button is pressed, and the buttons never wait for it. The fallback's blocks scroll and hold their whole text, as today, and a long command is read whole through its "Expand", as today. The first line of the card follows: `create` reads "Create <name>"; `update` reads "Edit <name>"; `input` reads "Write <name>" for the Write tool and "Edit <name>" otherwise. The path under it is relative to `useWorkingFolder(appSessionId)?.path` when the file is inside it, whole otherwise, and whole in its title. `ToolPreview` keeps its props and draws the fallback.

### §J. The trust card's body (M5)

`TrustDetails`, when the folder is not the home folder:

| `trust.found` | body |
|---|---|
| empty | the path; "Nothing in this folder loads or runs automatically."; "Recorded in <config file>; the terminal will not ask again."; the repository line when trust is recorded for a parent repository, as today |
| not empty | as today: the sentence that begins "Loads its settings, hooks, MCP servers and plugins", the repository line, the found list |

`TRUST_GATES` is removed. `DockedCardFrame` draws "· Composer paused · draft preserved" after its title only for a request; a card another child docks passes its title alone.

### §K. What the landing sends, and build F

Nothing is added to the stored layout or to either settings file, so the cross-build coverage table (U13a's M5) gains no row. What another build may read:

| value | what this landing writes | what F does with it | what this build does with F's | this build, then F, then this build |
|---|---|---|---|---|
| broker items in `attention.changed`, `attention.list`, the machine's feed and the stored list | only items for which `waits` holds | shows what waits; draws no answered item | F still sends `delivered` items: every reader here calls the predicate, `WAITING` included, so none is drawn or counted | neither build restores a broker kind from the store, so nothing carries over |
| a terminal session's asynchronous question in those lists | kind `async_input` | reads "Question waiting" for it; a device on F that opens the session builds its own item (kind `question`) from the bridge's state and docks it | F's list says `question`: docked and counted as a blocking question, as today | neither build restores the kind |
| `mode` on a plan answer (`session.answer`) | only when the person picks a mode from the menu, on a session MAWS runs on this Mac whose engine host has this build's wire (§F, the gate) | an engine host of F is never sent it: under one the card offers no mode, because that host reads tolerantly, would drop the key and would implement in the earlier mode. An endpoint of F is never sent it either, and would refuse the whole answer (`malformed`): it holds an input strictly to its schema (read at `f1852de3a`) | F never sends it | nothing is stored |
| the command `laneA.accepted` (the wire's minor rises by one for it, for `accepted` and for `mode`) | sent by this build's endpoint to its own spine, inside one daemon | never meets it: an endpoint and the spine it tells are one build's. A session machine on F tells no holder, and shows today's behaviour | — | nothing is stored |
| `accepted` on a remote terminal session's state | set by main for its own windows | never meets it: main and its windows are one build's, and the spine's own states never carry it | a state without it reads as none accepted | nothing is stored |
| the bridge's decision body `{behavior: 'dismiss'}` | only to a bridge whose status, as the driver holds it, declares `decide.dismiss` | F never sends it. A bridge before 1.47.0 that is sent one, under a status that has gone stale, refuses it with 400 before it records anything (§G); the question still waits | — | nothing is stored |
| the action ids `request.allowOnce`, `request.allowLasting` | rows of the table; never in `settings.keymap` (not rebindable) | never meets them | — | neither settings file changes |

### §L. Three routes

Each act the landing changes, and what carries it today (read in the code at `48619c824`). "Closed" means drawn disabled with the reason given.

| act | a session MAWS runs, this Mac | a terminal session, this Mac | a session another machine runs | a terminal session on another machine |
|---|---|---|---|---|
| allow once; deny; deny with a reason | `session.answer` | `laneA.answer` to the bridge's decision | the offer `session.answer` | the offer `sminos.decide` |
| a lasting scope | `session.answer` | only the request's one suggestion, while `decide.scope` is available; closed otherwise | `session.answer` | `sminos.decide` with the suggestion's hash; closed otherwise |
| deny and stop | `session.answer` | closed (`decide.interrupt`'s reason) | `session.answer` | closed |
| a question: submit; Esc or Dismiss on a blocking one | `session.answer` | the bridge's answers; its deny | `session.answer` | `sminos.answer`; `sminos.decide` |
| a question: skip every one | `session.answer` | blocking: the deny; asynchronous: closed | `session.answer` | as the terminal |
| Dismiss on an asynchronous question | none is raised there (the sminos ask is not in a session MAWS runs) | the bridge's dismissal where declared; closed otherwise | none is raised there | closed: not carried (§G, 5) |
| MAWS's ask: submit; Dismiss | `maws.ask.answer` | none is raised there | the offer `maws.ask.answer`; closed with the machine's reason on an older peer | none |
| a plan: implement; keep planning; clear and implement | `session.answer` | allow; deny with the feedback; closed ("/clear runs in the terminal") | `session.answer` | as the terminal |
| a plan: implement in a chosen mode | `session.answer` with `mode`, where the engine host has this build's wire; no menu otherwise (§F) | no menu | no menu (ruled, Reported 2) | no menu |
| an answered request stops waiting | at the broker's flushed write (the publisher) | at the bridge's acceptance (the holder, told by the driver) | at that machine's publisher, read here through its feed | on the session's machine at its endpoint's `done` (the holder there); in this device's windows at the same `done` (main's remote state); on a third device at the bridge's `settled` (§B) |
| reading the file for the diff | `files.read` | `files.read` by the session's record; the fallback when refused | the offer `files.read` | none: the fallback |
| a notification's Allow once and Deny | main, through `session.answer` | no notification (ruled) | no action (the section) | no notification |
| the hover card's Allow once and Deny | by the port | by the port | by the port | by the port, while a pane of this window shows the session: the window's mirror is the one source of its item, since that machine's feed carries none |
| the trust card | a step of a send; the same body in the remote setup sheet | — | — | — |

No act of this landing needs a new offer: `laneA.accepted` is the session machine's own command, sent inside its daemon, and a row of no offer. Two acts could take an offer later, as insertions in U9's files by U9's rule (its Interfaces, "How a later child inserts an offer"): a plan's mode over the link, and a dismissal of a terminal's asynchronous question on another machine, which also needs the daemon's `decide` to name a dismissal (`apps/desk-hub/src/protocol/rpc.ts`) and the plugin's RPC to accept it.

### §M. Consumed from siblings

- **U6a** (`…-U6a-keymap.md`; built at `b8137ed2a` and under its branch review at this revision, on master before this branch builds): `ActionSpec` and the row rules (its Interfaces §A); `effectiveChord` for a hint; `BUILD_F_ACTION_IDS` and `isRebindable` (a new row is not rebindable and needs nothing); its §G ("For a child that adds a key after this landing"): the two rows go where the menu should show them, which for `menu: null` rows is beside the rows they extend; its §E, whose `WAVE_DEFAULTS` already hold this landing's four chords. Its dispatcher and `useKeyChord`, into which the fresh-press option goes (§D, §N).
- **U8a** (`…-U8a-working-folder.md`, on master since `6e8c72738`): `useWorkingFolder(appSessionId): WorkingFolder | null` (`src/renderer/src/sessions/working-folder.ts`), its `path`, for the relative path of §I.
- **U3a** (`…-U3a-arrivals.md`, parallel): nothing. It removes one branch of `src/services/attention/service.ts` (its insertion in this child's file); the two changes do not meet. Its `answer` class is U1b's to read.
- **U8b** (`…-U8b-column-and-tabs.md`, parallel): nothing. It reads §A as master exports it and follows M1 without an edit (its §C.1), and it switches its two agent readers to `selectWaitingAgents` when this landing is on master first (its §C.6); when U8b is on master first, this landing's M7 makes that switch.
- **U9** (`…-U9-other-machines.md`, parallel): nothing but the rule for an insertion in `src/endpoint/offers.ts` (an `accepts` on an existing row, with a row test at the endpoint).
- **U13a** (`…-U13a-one-strip.md`, parallel): nothing; no key is stored, so its coverage table gains no row.
- In the tree: `EditDiff` and `Hunk` (`src/renderer/src/transcript/`), the hosts store's `host.status` (`src/renderer/src/stores/hosts.ts`), `MODE_OPTIONS` (`statusline/mode-menu.ts`), `PERMISSION_MODE_LABELS` (`src/shared/sessions/permission-mode-labels.ts`), `readTolerant` (`src/shared/ipc/tolerant.ts`), `fast-diff`.

### §N. Insertions in files other children own (UC-8)

| file | owner | the insertion |
|---|---|---|
| `src/shared/keymap/actions.ts` | U6 | two rows after `request.decline`; the titles of `request.accept` and `request.decline` (§D). After U6a is on master |
| `src/renderer/src/keymap/useKeyChord.ts`, `dispatcher.ts` | U6 | the option `fresh` of a binding, and the one condition in `dispatchKey` that swallows a repeat for a binding that asked (§D); their cases in U6's dispatcher test. After U6a is on master; reported to U6's reviewer as an insertion |
| `src/renderer/src/transcript/view/cells/EditDetail.tsx` | per UC-3 (U3 lands first in the transcript's files; this is rebased onto it) | the optional prop `whole` of `EditDiff` (§I); the transcript's own uses pass nothing and draw as today |
| `src/renderer/src/settings-tab/KeymapSection.test.tsx`, `settings-tab/keymap.test.ts` | U11, U6 | the expected titles and ids of the request rows |
| `src/endpoint/offers.ts` | U9 | the row `session.answer` gains `accepts`: a plan answer that names a mode is refused for a caller on another machine; its row test |
| `src/renderer/src/sidebar/RequestPreview.tsx` | U7 | `isOpen` becomes `waits`; nothing else (its approval rule, never drawn in the app, stays) |
| `src/renderer/src/shell/floating.test.ts` | U10 | one case's expectation: a delivered item is no longer "still pending" |
| `src/renderer/src/composer/Composer.test.tsx` | U4 | two cases' gesture: a docked permission is allowed with ⌘↩ after its 400 ms, where they pressed Enter (M3; added at execution, Decision Log 2026-11-13) |
| `src/renderer/src/tools/agents/subagents/subagents.test.tsx` | U8 | one case finds the inline card by its first line ("Run a command · from …"), where it found the heading "Bash" (M3; added at execution) |
| `src/renderer/src/palette/CommandPalette.tsx` and its test | U6 | two entries of `UNAVAILABLE`, `request.allowOnce` and `request.allowLasting`, with the sentence `request.accept` and `request.decline` carry ("Keyboard only, in a focused request"), where the palette would read "Unavailable" (M3; added at execution) |
| `src/renderer/src/tools/agents/subagents/AgentList.tsx` and U8b's Subagents card | U8 | only if U8b is on master when M7 merges it: the two readers call `selectWaitingAgents` (M7, "The predicate by agent") |
| `e2e/` specs of other children's surfaces | each surface's child | the gestures and the listed expectations of M7, nothing else in the scene |
| `e2e/cross-build.spec.ts` | P5's; U13a adds scenes beside | one assertion in the update scene (M7) |

Not a child's files, and worked in by another landing at the same time: `src/endpoint/lane-a.ts` and `actions.ts` (U9 works in `src/endpoint/`), `src/shared/ipc/wire.ts` and the generated wire files (U8b raises the minor too). Whoever merges second keeps both changes and makes the generated files again.

No other file under `src/renderer/src/transcript/`, and no file under `src/renderer/src/composer/` outside `docked/`, `src/renderer/src/sidebar/HoverCard.tsx` or `src/renderer/src/main/`, is edited.

## Proof that an executor does not run

Each line has an owner other than an executor. The executor's hand-back says which lines' preconditions are met.

| what | when it can start | what it needs | what comes back |
|---|---|---|---|
| **The Electron e2e groups**, on a Mac under the load rule | after M7 is pushed | The new and reworked scenes alone first: the new scenes of `requests.spec.ts`, `lane-a.spec.ts` and `sessions.spec.ts` (M7), and `c7-shots.spec.ts` run on purpose (`MAWS_HARNESS=1 pnpm exec electron-vite build && MAWS_C7_SHOTS=1 MAWS_ENGINE_REPLAY=1 pnpm exec playwright test e2e/c7-shots.spec.ts`), which gives the pictures of the cards and the measured height. Then the groups that hold a spec M7 edited: `e2e:requests`, `e2e:composer`, `e2e:lane-a`, `e2e:tools`, `e2e:to-human`, `e2e:side`, `e2e:panel`, `e2e:layout`, `e2e:agents`, `e2e:browser-comment`, `e2e:remote`, `e2e:supervisor-daemon`, `e2e:design-systems`, `e2e:voice`, the default `pnpm e2e` (for `sessions.spec.ts`), and the groups whose specs call `allowNext` (`deliverables`, `design-export`, `dashboard-export`, `document-standalone`, `presentations-export`) | Verdicts by group. A red scene comes back as a fix |
| **Two `-live` specs** (a real engine; no gate runs them) | with the groups | `composer-live.spec.ts` (it approves and keeps a plan) and one spec that allows a permission through the card, on a Mac with a signed-in engine | That the substituted gestures answer a live engine. The other `-live` edits stand on review |
| **The cross-build run with F as the peer** | after M7 is pushed | `scripts/ci-gate.sh "$PWD" --gates e2e:cross-build --peer f1852de3a --label u1a-xb`, in the background; Actions budget for one run. It stores no key of this landing: it is run because its update and downgrade scenes answer a request across the two builds, which §K's first rows change, and because its update scene carries the one assertion M7 adds: under F's engine host the status this build's window holds gives another wire fingerprint than its own, which is what keeps the plan's menu away there | The run's id and its scenes named as run, the update scene's new assertion among them. A skipped scene is not evidence |
| **The real bridge's dismissal** (A18; §G) | the disabled state: any time after M2 (runnable from `6f6045a23`; the architect runs it with the landing's other hands-on checks). The enabled state: once sminos 1.47.0 can be installed (its pull request merged, or its branch installed into a scratch config home) | A Mac, a scratch config home, one interactive terminal session with the sminos plugin, one asynchronous question put by the agent (invented text). *Disabled:* on the plugin as installed today, the form's Dismiss is disabled and reads "Dismiss it in the terminal". *Enabled:* on 1.47.0, press Dismiss in MAWS | *Enabled:* the terminal's row reads dismissed; the bridge's stream carries `settled` `withdrawn` by `maws`; MAWS's card leaves at the press and the session's row stops reading "Question waiting"; after the next prompt the transcript holds the delivery. A difference from §G's tables comes back as a fix |
| **The notification's buttons on a signed build** (A14) | with U14's sitting check "l1-sessions-08" | A signed build of this branch; a prompt for a short command and one for a file change raised with the window in the background | Whether "Allow once" and "Deny" show and act. Electron documents that macOS shows a notification's first action as its button and the rest in a dropdown, and only for alert-style notifications: with §H's order "Allow once" is the visible button and "Deny" sits in the dropdown (M6; to be looked at here). If a signed build does not show action buttons, the buttons wait on that defect and the rest of M6 lands |
| **A probe for more modes on a plan's allow** (not asked now: the ruling on Reported 3 keeps the two modes; this is what widening would need) | any time | The probe harness on engine 2.1.322, as `findings-uxwave-u1-plan-next-mode.txt` ran it: an allow naming `auto` from a session that was in `default` before Plan, with auto available and with auto refused; an allow naming `bypassPermissions`, in a session launched with and without leave to bypass | The session's mode after each, and what the engine sends when it refuses. Each mode that passes joins the constant |
| **The owner's look** | — | None is asked before this landing is built. The section fixes the card line by line and the owner accepted it in words; in this landing the card still stands in the docked frame, which U1b removes. The drawn example worth the owner's time is U1b's, the card at the transcript's end, and it carries this card's content. The architect looks at `c7-shots`' pictures after M7. In the built window, three effects the section does not name, accepted by the architect on 2026-11-13: a terminal session's asynchronous question does not raise the floating window's pill, since it does not block the session and is counted where the other waiting items are; the sidebar's hover card offers Quick Reply beside such a question, since the session can take a message while it waits; and every question card, the Overview's and the inline one included, carries a Dismiss button | — |
| **The branch review** | after M7 | `doperpowers:review-code`, the xhigh panel, over `origin/master...ux-wave/U1a`, with one lens on §A and §B (does any reader outside the engine host still decide "waiting" by itself; is there one holder), one on what is checked where it runs (the endpoint's guard, `laneA.accepted`, the outside actions, the plan mode's gate), and M7's listed e2e expectations read as expectations | A verdict and findings; the fixes are one wave |
| **Class 1a** | once, on the head the pull request will carry, after the review's fixes | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u1a` | The run's id |

## The pull request

Opened on the architect's word, not by an executor. Its body:
- opens with the composite's path, the child id (U1, first landing) and the parent pin `06727e32a`, and names the items (#358 with X-066, S-04, S-07, O-22's kind, l4-approvals-02, -05, -09, -11, -13, O-23, #333, and Dismiss) and the board ticket #577;
- names its class 1a run by id, on the head it carries;
- names the branch review's verdict and what was done with each finding;
- says which e2e groups ran and where, the cross-build run's id, and the state of the three Mac checks above;
- names its residue: what is not verified; what waits for U1b (the edge table); and what is logged as debt (below);
- ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.

**The record** (UC-10), written in M7. Each sentence is added where the ruling stands, in that document's own form: the charter and C7's document open an amendment with "Amended" and the day it is committed (as the charter's "Amended 2026-11-12 (§19, D-14): …"), C7's as a paragraph of its own under the one it amends; P5 O9's document has no amendments yet, and takes the sentence at the end of the bullet or under the table named.

| # | ruling reversed | where | the sentence |
|---|---|---|---|
| 1 | S-07, #358: an answered card keeps the composer's place until its item retires | `docs/doperpowers/plans/2026-09-28-c7-composer-requests.md`, under the paragraph that begins "Delivery states:" (section "Request card (`request-card/*`) — X4") | Amended (UX wave U1; the sitting finding S-07 and ticket #358): a request is drawn only while it waits. At the write of its answer its card is removed, and no 'Answered' line stands in its place; the charter's §4.6 already says a delivered item is not an alarm state. |
| 2 | l4-approvals-02: the scope list and its digit keys | the same document, under the paragraph that begins "Scope options (`scope.ts`):" and its amendment of 2026-10-01 | Amended (the owner's mark on l4-approvals-02): the card has three buttons; the most lasting scope is named on its button, and a rule written to the project's local settings names its file under the buttons, which keeps the ruling of 2026-10-01 on that file. |
| 3 | charter §5.8: "Enter/Esc on a docked request" (Reported, 4) | `docs/charter.md`, the end of §5.8's paragraph, after what stands there | Amended (UX wave U1; the owner's mark on l4-approvals-02): a permission prompt is answered with ⌘Enter (allow once), ⇧⌘Enter (the lasting scope its button names) and Esc (deny), no sooner than 400 ms after it appears; Enter no longer allows one. Enter and Esc keep their meaning on a question and on a plan. |
| 4 | l4-approvals-09, #333: only a read-only tool is approved from outside the session | `docs/charter.md`: the end of §5.1's paragraph; §12 C5, the end of the residue bullet "*Hover card*"; §13, the end of the bullet "X4 Request card" | Amended (the owner's mark on l4-approvals-09 and ticket #333): from the hover card and from a notification a waiting permission may be denied, and allowed once when it is a read-only tool or a shell command the surface shows whole; anything else opens the session. |
| 5 | O-22: the kind of a terminal session's asynchronous question | `docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md`, M6, the end of the bullet "**The item.**" | Amended (the owner's observation O-22): an asynchronous question is an `async_input` item, as MAWS's own non-blocking ask is. |
| 6 | l4-approvals-08 (Dismiss): a terminal session's asynchronous question is answered, never declined | the same document, Interfaces §D, under the table of answers | Amended (the owner's answers of 2026-11-12; UX wave U1): a plain deny of an asynchronous question is carried as the bridge's dismissal where the session's bridge declares `decide.dismiss` (sminos 1.47.0), for a terminal session on this Mac; MAWS sends it from the form's Dismiss button and never from Esc. A skip of every question still sends nothing. |

Row 6's sentence is not the child's: the child's says "a skip of every question and a decline still send nothing", which decision 7 and §G's fifth correction make inexact. Ruled on 2026-11-12: it stands as worded here. Rows 1, 2, 4 and 5 are the child's sentences as written. The placement's two sentences (l4-approvals-08 at charter §13 X4 and C7's "Placements"; O-17 at E1's M4b) are U1b's.

**Logged as debt** in `docs/tech-debt-tracker.md` by M7, each a row with its reason: a dismissal of a terminal's asynchronous question on another machine is not carried (it needs the daemon's `decide` and the plugin's RPC to name a dismissal); a plan's next mode is not offered for a session another machine runs (an insertion in U9's files); `PLAN_NEXT_MODES` holds only the two modes the check ran; a window on a third device keeps a terminal session's answered request until the bridge settles it, and no machine's Needs you or badge counts a terminal session's request of another machine at all (the attention feed is cut to the sessions a machine runs); a refusal's sentence shows only as the title of "Couldn't deliver the answer"; a dismissal whose delivery was still held when its session ended comes back on resume (the plugin's); the sidebar's fallback preview keeps the read-only rule. Which of these becomes a ticket is the architect's.

## Surprises & Discoveries

- Observation: a terminal session's digest is a second signal of waiting that UC-1's table of readers does not name.
  Evidence: `bridgedDigest` in `src/services/sessions/digest.ts` answers `phase: pending > 0 ? 'waiting' : …`, and `src/services/spine-root.ts` hands it `view.state.pending.length`, which counts an asynchronous question and a request whose answer the bridge has accepted and not settled.
- Observation: only the Overview card answers a question outside its session's pane; the section names the hover card and Needs you too.
  Evidence: `request-card/preview/HoverPreview.tsx` ("a read-only preview, never a form"); `RequestCard.tsx` draws `HoverPreview` for every request in the hover placement.
- Observation: a mode inside a plan's answer would pass a lower grade than a mode change takes.
  Evidence: `src/endpoint/by-effect.ts` grades `session.answer` on a plan `approve`; `src/shared/ipc/grades/session.ts` grades `session.setPermissionMode` `manage`.
- Observation: the check of the plan's next mode ran two modes end to end.
  Evidence: `findings-uxwave-u1-plan-next-mode.txt` (branch `ux-wave/probe-send-permission`): `acceptEdits` two of two, `default` one of one, `auto` named once where it was also the restored mode; `bypassPermissions` not run.
- Observation: a closed list of modes in the answer's schema would make each later mode a new wire major.
  Evidence: `src/shared/ipc/wire.ts`, the rule's sentence "a changed type, `const`, `enum` or union member set (an added enum member included, since an older reader refuses it)".
- Observation: desk web draws the renderer's stepper and preview.
  Evidence: `apps/desk-web/src/views/requests/RequestCard.tsx` and `views/cards/ChannelCard.tsx` import `QuestionBody`, `ToolPreview`, `toolVerb` and the card's controls from `src/renderer/src/request-card/`.
- Observation: the old Allow gesture is in about two dozen e2e files and one helper seven more specs call.
  Evidence: `grep -lE "name: 'Allow once'|name: 'Allow'|Allow for this session" e2e/*.ts e2e/support/*.ts`; `allowNext` in `e2e/support/maws-tools.ts`.
- Observation: the bridge's 409 for a decision it could not relay is read as "answered elsewhere".
  Evidence: `answer` in `src/services/lane-a/driver.ts`: any 409 without `code` becomes `not_pending`, with a null settlement when the body names no winner.
- Observation: in every file this landing changes, build F equals the branch's base.
  Evidence: `git diff --stat f1852de3a 48619c824` over the attention, request-card, lane A, keymap and answer files prints nothing.
- Observation: across a build gap an engine host drops a key it does not know, and an endpoint refuses the whole input.
  Evidence: the header of `e2e/cross-build.spec.ts` ("one that lacks an event or an object key drops it (the tolerant reader, logged once)") and `src/shared/ipc/tolerant.ts`; `holdsToSchema` in `src/endpoint/authorize.ts`, the same at `f1852de3a`: `command.input.safeParse(input).success`, over strict objects.
- Observation: the review's first finding holds. An engine host of another build can serve this build's window, and the window can tell.
  Evidence: `HostStatusSchema` (`src/shared/ipc/schema/host.ts`) carries `supervisor.wire` beside `appWire`; the update scenes of `e2e/cross-build.spec.ts` attach this build's app to the peer's kept engine host.
- Observation: the review's second finding holds. A held chord repeats into the next request.
  Evidence: `dispatchKey` (`src/renderer/src/keymap/dispatcher.ts`) reads `event.repeat` only for a latched hold action; `handingOver` in `DockedCardFrame.tsx` gives the next frame the focus.
- Observation: the review's third finding holds for the session's machine and not for a window on another. The machine's attention feed never carries a terminal session's item, so no snapshot brings one back and no badge elsewhere counts one.
  Evidence: `recordedPlacement` (`src/endpoint/targets.ts`) places every record as `lane: 'B'`; `record` in `src/endpoint/rl10/members.ts` answers null when `member.lane !== target.lane`; `sessionRank(null, …)` is null (`src/endpoint/grades.ts`).
- Observation: a feed snapshot erases a remote terminal session's mirrored cards, today.
  Evidence: `replace` in `src/renderer/src/stores/attention.ts` deletes every session of the machine's partition, those `applyChanged` added for the mirror included; `mirror` in `remote-connect.ts` returns early while its entries' JSON is what it last told.
- Observation: the bridge publishes nothing when it takes an answer; the caller's 200 is the only word until `settled`.
  Evidence: `decide` in sminos 1.46.3's `sminos_bridge.py` sets the request's `decided` and returns `{accepted: true}`; no stream line is written there.
- Observation: a bridge before 1.47.0 refuses a dismissal with 400 before it records anything.
  Evidence: `_check_decision` in the same file: "behavior is allow or deny", checked before `decided` is set.
- Observation: the review's fifth finding holds. With no cell, `EditDiff` cannot reach what it leaves out.
  Evidence: `budgeted` and `Truncated` (`transcript/view/cells/`); the "lines omitted" row has its button only when `cell` is given.
- Observation: a card that drew nothing at its own delivered outcome would leave the composer's place empty while its item was still listed.
  Evidence: `Composer.tsx` hides the editor while `swapOf` names an item, whatever the card inside the frame draws.
- Observation: the lane A spec's bridge double settles a request only when told, so the order of acceptance and settlement can be held open in a scene.
  Evidence: `bridge.settle` and `bridge.answer` in `e2e/lane-a.spec.ts`.

- Observation: a new `laneA.*` command meets five registries beyond its schema, none named in §B.
  Evidence: the zod-free names list `src/shared/ipc/names/lane-a.ts` (the bridged/main-only partition reads it), `routes.json`, `test/support/spine-lists.ts` (the spine's exact command list), `ANSWERED_IN_MAIN` (`src/main/machines/remote/answered-in-main.ts`, which the offer audit reads), and the main-only grading rule in `grades.test`; M1's first run of its touched set failed three of them.
- Observation: the act's digest the endpoint reads for `laneA.accepted` is `{session, request, tool, input_sha256}`, carried on every remote `sminos.answer` and `sminos.decide`.
  Evidence: `answer` in `src/main/lane-a/remote.ts`.

- Observation: with its kind `async_input`, a terminal session's asynchronous question no longer raises a closed floating card, and the sidebar's hover card offers Quick Reply beside it.
  Evidence: `shell/floating.ts` (U10's) raises the pill for `permission`, `question`, `plan`, `elicitation` and `dialog`, "the kinds the composer docks"; `sidebar/HoverCard.tsx` (U7's) hides Quick Reply only while an item of kind `question` waits. Both follow the calm tone; neither file is edited (reported to the architect).
- Observation: sminos 1.47.0's dismissal, read on its branch, matches §G; a dismissal the session's mod refuses comes back as a 409 `{error}` with no winner and `decided` reset, the bare 409 the re-read handles.
  Evidence: `_check_decision` and `decide` in `sminos_bridge.py` on the plugin's dismissal branch.
- Observation: every question card now carries a Dismiss button (Overview and inline included), so an unscoped e2e locator for "Dismiss" can meet two.
  Evidence: `QuestionBody`'s foot; today's e2e hits (`lane-a.spec.ts`, `c7-shots.spec.ts`) are scoped to their regions.

- Observation: in the reason box, ⇧⌘↩ also sends the deny with its reason.
  Evidence: `CardTextarea` submits on any `metaKey` with Enter; today's behaviour, left as it is.

- Observation: a missing file read over the machine link comes back as `{code: 'internal', message: 'not found: <that machine's path>'}`, cut at 512 characters, so "Create" holds on a session another machine runs too.
  Evidence: `test/endpoint/checkout-rows.test.ts`, passing on the VM at M4.
- Observation: no unit test checks the Edit fixture's path under `data-testid="request-input"`, as M4's entry supposed; the fixture `test/fixtures/requests/edit-permission.json` is read only by `e2e/c7-shots.spec.ts` and `scope.test.ts`.
  Evidence: a search of the tests at M4.

- Observation: a session another machine runs gives the card its own engine host's `prePlanMode`: main's remote lane B adapter passes the session's `session.status` to the window unchanged, so the card names the earlier mode when that host knows it and reads "Implement" otherwise.
  Evidence: read in `src/main/lane-b/` at M5 and held by a card test; not tried against a second machine.
- Observation: Concrete Steps 2's wire route, run a second time on one minor, changes only the fingerprint: the manifest already holds the minor M1 wrote, and the wire test then asks for the next one for any addition. Within one landing the files are made again from the base manifest at the landing's one minor.
  Evidence: M5's regeneration (from `be663d261`'s manifest, minor 36, written at 37).

- Observation: after M6 `quick-approval.ts` holds no reader of waiting: `hoverApproval` was removed (nothing imported it), the hover card reading `outsideAnswers(…, 'hover')`; §A's reader table row naming it stands for what M1 built, and the row's hover reader is now `src/shared/attention/outside-answers.ts` with the item's `waits` checked by its caller.
  Evidence: M6's diff.

## Decision Log

- Decision: verification for this landing. This document gets an adversarial review before an executor starts, dispatched by the architect. The branch gets `doperpowers:review-code` at the xhigh panel. Class 1a on GitHub Actions is the gate of record, run once on the head the pull request carries.
  Rationale: the panel by size and by stakes. The change is expected at about seventy files and three and a half thousand changed lines with its tests, past the panel's threshold of twenty files or two thousand lines. And it defines UC-1, which eight children bind to, adds a guard on what a caller on another machine may send in an answer, and lets a notification deny or allow a request with the window in the background. A single reviewer was the alternative; it is the rung for a focused diff, which this is not.
  Date/Author: 2026-11-12, the author of this document.
- 2026-11-12: written against the code at `48619c824` and the spec at `06727e32a`. Seven points reported to the architect; their defaults are built until ruled.
- Decision: the document is revised at the architect's rulings and the adversarial review's findings.
  - The seven points: every default stands ("Reported to the architect, and ruled").
  - A plan's mode is offered and sent only under an engine host of this build's wire, checked at the card and at the port (decision 18; §F). Before: the menu was drawn on every session MAWS runs on this Mac, and a host of another build would have dropped the mode and implemented in the earlier one.
  - The four request rows act on a fresh press only, by an option of the binding in U6's dispatcher (decision 17; §D). Before: nothing stopped a held chord answering the next request.
  - One holder of "accepted, not settled", on the session's machine, told by its driver and by its endpoint (`laneA.accepted`); the grace rules run there alone (decision 3; §B). Before: a mark in each list holder, the answering window among them, each with its own grace.
  - A card goes when the list says so, never on its own outcome (decision 2; §C). Before: it returned nothing at its delivered outcome, which would have left the composer's place empty while the item was listed.
  - The whole proposed change can be read before it is approved, through one prop of `EditDiff` (decision 19; §I). Before: "Show all" lifted the card's height bound and not the diff's own budget.
  - M7 lists each e2e assertion whose expectation changes, and every key that answers a permission prompt waits out its 400 ms in the scenes. Before: one table of substitutions.
  - Smaller: a dismissal sent to an older bridge under a stale status is refused with 400, documented and tested; build F's strict endpoint is recorded as verified; the switch of the two agent readers to `selectWaitingAgents` is assigned by landing order.
  Rationale: each finding was read against the code it cites and holds, but for two pieces of the third's evidence (Surprises & Discoveries): no feed carries a terminal session's item to another machine. The ruling's rule for the session's machine is built as given; what a window on another machine can show is reported as point 8, with point 9, a fault found beside it.
  Date/Author: 2026-11-12, the author of this document, at the architect's rulings.
- Decision: the two points reported at the revision are ruled; both defaults stand ("Reported at the revision, and ruled").
  - Point 8: main on the answering device records the machine's `done` for its own act as `accepted` on the remote session's state, read by UC-1's predicate on that device and by nothing else, and cleared by every word of the machine's. Rejected: no record on the device (the answered card would stand as waiting where it was answered); a terminal session's items in the machine's feed (its own design and its own ticket).
  - Point 9: the mirror's loss of its cards at a feed snapshot is repaired in M1. Rejected: a ticket.
  - The plan button's two labels where no menu is offered stand.
  Date/Author: 2026-11-13 (UTC), the wave's architect.

- 2026-11-13: refresh at execution. Master `be663d261` (U6a, U8a) merged at `64c13746a`. The interfaces this document consumes were read again there: U6a's `effectiveChord`, `isRebindable`, `BUILD_F_ACTION_IDS` (neither new id in it) and its test's `WAVE_DEFAULTS` (the four request chords present), `dispatchKey` and `owner` in `keymap/dispatcher.ts`, `useKeyChord`'s options (`within`, `enabled`, `onRelease`), and U8a's `useWorkingFolder` (`src/renderer/src/sessions/working-folder.ts`) all stand as §M names them. The parent is re-pinned from `06727e32a` to `5f1972a30` (branch `ux-wave-spec`): its changes since bring U1's file, UC-1, UC-4, UC-6 and UC-8 to this document and contradict nothing here; UC-8 now also lets U3 change one tool name in `request-card/tools.ts`.
  Date/Author: 2026-11-13, the executing controller.

- Decision (M1, 2026-11-13): `laneA.accepted` is a main-only command graded `internal`, where §B wrote `approve`. The code's rule (`grades.test`) gives `internal` to exactly the commands no window sends, which this one is (the endpoint sends it inside the daemon, as it sends `machine.op`); `internal` is stricter, no caller holds it, and §B's purpose, that no caller on another machine can send it, holds the more. The remote lane A adapter refuses it as a declared `ANSWERED_IN_MAIN` entry, since `routeLaneA` takes every `laneA.*` name. §B's code block is read with this grade. Rejected: a bridged command graded `approve`, which a window could send.
- Decision (M1): both tellers reach the holder through the driver (`onAccepted`, for its own 200 and for `laneA.accepted`), wired in `spine-root`; the driver alone checks it drives the session, the holder alone checks the request is listed. The holder keeps one mark per accepted request (when its grace ends) with its own timer, its rules pure (`marksAfter`, `waitingOf`, the clock passed in); a second acceptance restarts the grace; an acceptance while the stream is not fresh is honoured when the last state listed the request. The digest is refreshed from the holder's list as well as from the view, since an acceptance or a grace's end changes the list with no new view.
- Decision (M1): main's `accepted` lives on the remote session in `src/main/lane-a/remote.ts`, pruned at every change to what the plane still lists while the bridge is live and cleared by the primary watch's snapshot; a remote state always carries it (empty), as it carries `acts`. The mirror's repair for Reported 9 is the store's own: the lane A mirror writes through `applyMirrored`, which marks the session's list as the mirror's within the machine's partition (so its greying stands), writes it at once and unbuffered, and both kinds of machine snapshot leave it standing, so a question's draft is never pruned (the review found a repair after the write lost the draft). A feed item for a mirrored session is skipped; the feed carries none today.
- Decision (M1): the card's sent state is a phase (`sent`), disabled through `busy`, and the `RequestCard` wrapper returns null for an item that does not wait. The tree test flags an import of `isOpen` and a comparison of a state with `'delivered'` (both orders, and the list `['pending', 'delivered']`) in non-test sources under `src/` outside `src/engine-host/`, with two named exceptions that compare another thing's state (`owner/report/QuestionCard.tsx`, an owner question's; `services/channel/lane-b.ts`, an owner mark's). The header of `schema/lane-a.ts`, which said its namespace moves no minor, is corrected: it is on the wire.

- Decision (M2, 2026-11-13): `swapOf` reads the request of every anchorless `async_input` item with a request id and docks it only when the request reads `question.requested` (§C decides by the request, not by the lane A id prefix); MAWS's non-blocking ask is then read once and not docked. Esc on an asynchronous question is refused by the item's kind in `QuestionBody`, since the decline's capability is now open wherever the bridge declares the dismissal. A deny carrying a message on an asynchronous question is refused `bad-args` (a dismissal carries none). A bare 409 whose re-read finds the request pending is refused under `refused`; a re-read answering other than 200, 410 or 404 is `unknown`. The remote adapter refuses a dismissal by closing `decide.dismiss` with "dismiss it in the terminal on <machine>" before any act.
- Decision (M2): the settlement's words need who settled, so `Race.settled` carries `by` and `settledWords` takes the item's kind; this app's own dismissal gives null and the card draws nothing. The stepper's double-click on the last step submits only where the port carries that reply, else it picks. MAWS's ask: completeness is a pure `complete` in `draft.ts`, the pick-then-submit `chooseOption` in `store.ts`, Dismiss an option of `submitAsk` (`{dismiss: true}`); one `submitting` mark covers Submit and Dismiss. The fake bridge takes a dismissal while its current status declares `decide.dismiss` and answers 400 otherwise (the stale-status case).

- Decision (2026-11-13, UTC, accepted by the architect): two effects of the asynchronous question's kind that the section did not name stand, with neither file edited. U10's `shell/floating.ts` does not raise the floating window's pill for it: it does not block the session, and it is counted where the other waiting items are. U7's `sidebar/HoverCard.tsx` offers Quick Reply beside it: the session can take a message while that question waits, which is the difference from a blocking one. Both are in "The owner's look", with the Dismiss button now on every question card.

- Decision (M3, 2026-11-13): three edits outside §N, in other children's files, taken as defaults, recorded in §N and reported to the architect: two gestures in U4's `Composer.test.tsx`, one heading in U8's `subagents.test.tsx`, two entries of the palette's `UNAVAILABLE` map. Each follows from §D and changes nothing else in its file.
- Decision (M3): the Esc hint is drawn "⎋": UC-6 makes a hint the row's chord in the keymap's own formatting (`formatChord`, U6's), and §D's drawing "Esc" yields to that rule (reported to the architect). "Deny… with a reason" keeps today's label, because l4-approvals-03 is a keep and A16 lets only the Allow control's selector change. The 400 ms lives in the permission body, armed from its mount (the body remounts per item, so an Overview card's next prompt starts its own); a key in that time is taken by its binding and answers nothing. A hint is printed only where its key is bound (none on a default-to-no prompt's allow buttons, on a button the port closes, or on a row with no chord). The first line is `askedLine` in `tools.ts`, an `h3` naming the file's base name ("a file" when the call names none); M3 says "Write" or "Edit", M4 makes "Create". `ScopeOption.detail` becomes `rule` and `LOCAL_SETTINGS_DETAIL` goes. `CardKeys`' two new keys and the frame's two new props are optional, so the other variants and `SetupCard` are untouched. A taken repeat returns at once, so no later row on the same chord is tried. The settings tests' Change-control loops iterate the rebindable rows.

- Decision (M4, 2026-11-13): `EditDiff` is loaded lazily, the input-alone drawing its Suspense fallback, because a static import would pull the transcript's Markdown module into the app's entry chunk, which `transcript/lazy.tsx` keeps out. The card reads the file once per mounted card and hands the result to `PermissionBody` as an optional `proposed` prop, which the first line and the preview both follow; once the card has answered a late read is dropped, so what was approved stays drawn as it was. The path is relative in the fallback too, so it does not move when the read lands; `ToolPreview` gains a `FileEdits` export and keeps its props. The line diff is a Myers of the module's own (no dependency), capped at 1000 changed lines, past which the changed region is drawn removed then added, so a huge rewrite cannot hang the window. A read is made only for Edit, MultiEdit or Write naming one file. An empty `old_string` counts as not found; a diff with no hunks draws one muted line ("An empty file", "The file’s text stays as it is"). Collapsed, the diff shows 12 lines, and "Show all" is decided from the hunks, not measured. Modules: `proposed.ts`, `line-diff.ts`, `use-proposed-file.ts`, `ProposedChange.tsx` under `request-card/preview/`.

- Decision (M5, 2026-11-13): the card asks the session's port whether a named mode is carried and the session's address which machine it is on, never the lane; on this Mac the button names the earlier mode only where the menu is offered, on another machine whenever the status gives it (§F's table). The broker refuses a mode outside `PLAN_NEXT_MODES` with `BrokerAnswerMismatch` before anything is written. Where the gate does not hold the lane B port's `answer` returns `invalid_input` without calling `session.answer`; the refusals are worded in `PLAN_MODE_WORDS` and `LANE_A_WORDS.planMode`. The menu is a split button (a caret named "More implement options", entries "Implement · <label>"), the Allow once menu's pattern. `DockedCardFrame` takes an optional `titleAlone`, so `RequestCard.tsx` is not edited for it; the harness's stand-in trust frame is left. The endpoint's `accepts` refuses a plan answer carrying a `mode` key whatever its value; its row test is in `test/endpoint/lane-b-rows.test.ts`. The wire files were made again from the base manifest at minor 37.

- Decision (M6, 2026-11-13): `shownCommand` is exported beside `outsideAnswers`, so the notification's body and the rule read one function. A shell command is Bash with a string `command`; one line means no `\r` or `\n`; the 120 counts code points. The shared rule reads the flags (`defaultToNo`, `requiresUserInteraction`) itself, since `src/shared/` cannot import the renderer's `quickApproval`. `canAllow` became `offer(item) → {allowOnce, deny, body}`; `allow` and `deny` read the request again at the press and refuse when the item no longer waits or its request id differs from the notification's. The body is the command itself, only when Allow once holds. On the hover card "Allow once" replaces "Approve", and "Approve applies to this request only." is drawn only when Allow once is offered. `hoverApproval` is removed. `src/main/attention/index.ts` needed no edit (nothing there names the actions' shape).

## Outcomes & Retrospective

Pending — written at finish.

# UX wave · U1a · requests: UC-1, and the request work that does not draw in the transcript (2026-11-12)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U1**, first landing (**U1a**), parent pin `06727e32a`.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md`: Edges → Pull requests (which names this landing as "the first pull request, before the placement work lands"); Contracts → "UC-1 (owned)", UC-6, UC-7; acceptance A1, A3, A5, A10 to A14, A16 to A18; the items #358, S-04, S-07, O-22, l4-approvals-02, -05, -11, -13, O-23, l4-approvals-09, #333, and "Dismiss" under l4-approvals-08; "Probes and checks"; "Rulings reversed". In the root: Purpose, the wave's laws, UC-1, UC-3, UC-4, UC-6, UC-7, UC-8, UC-10, UC-11, UC-14, "Ordering and dependency map" ("U1a, UC-1 and the request work that does not draw in the transcript"), and the Decision Log's table "Rulings reversed". Where the child's file and the root differ, the root binds.
> This document holds what the design does not: the landing's edge, what the code holds, the decisions the section left open, the interfaces siblings read, and the execution. Seven points where the code or a sibling's work contradicts the section are reported to the wave's architect under "Reported to the architect"; each carries a recommended default that this document builds, written so that a ruling changes one named place. **Branch:** `ux-wave/U1a`, from master `48619c824`; master is merged in before anything is built (Concrete Steps, 1). **Board:** #577 (the wave's epic is #573).

## Purpose

After this landing a request stops being announced the moment the person answers it. Allow a command that runs for a minute and prints nothing: the card is gone at the click, the composer and Stop are back, and the session's row, its tab, Needs you, the dock badge and a window on another machine read "Working" for the whole minute. Today all of them read "Needs approval" until the command prints or ends, and the composer's place holds a line "Answered · Allowed once".

The other changes are in the cards themselves, which still take the composer's place in this landing (the placement in the transcript is the next landing, U1b):

- A permission prompt is three buttons, each with its key on it (Esc, ⇧⌘↩, ⌘↩), in place of a numbered list of scopes and an Allow button.
- A file change is shown as a diff with line numbers against the file as it stands, and says "Create" or "Edit".
- A plan's primary button names the mode the session will be in afterwards.
- The trust card stops listing five things that would load when the folder holds none of them.
- A double-click on a single-choice option picks it and goes on.
- From a notification or the sidebar's hover card any waiting permission can be denied, and a read or a shell command shown whole can be allowed once.
- A terminal session's question that does not block the agent reads "Question waiting" in the calm tone, and every question's form has a Dismiss button.

How to see it working: the unit suite (each reader of "what waits" handed one answered item and showing nothing, a test that fails on today's tree), and the Electron e2e groups named under "Proof that an executor does not run", whose new scene allows a command whose result never comes and finds no card, no "Answered" line and a session that reads Working.

## Progress

- [x] (2026-11-12) The section checked against the code at `48619c824`; this document written; seven points reported to the architect.
- [ ] The architect's rulings on "Reported to the architect" folded in (each changes the one place it names).
- [ ] The adversarial review of this document; its findings folded in.
- [ ] Step 0 is on master (U6a's `src/shared/keymap/build-f.ts`, U8a's `src/shared/sessions/working-folder.ts`); master merged into the branch.
- [ ] M1 — One predicate, the publisher and every reader.
- [ ] M2 — Questions: the terminal's asynchronous question, Dismiss, double-click.
- [ ] M3 — The permission card: three buttons, the hints and the keys.
- [ ] M4 — A file change as a diff.
- [ ] M5 — The plan's next mode; the trust card.
- [ ] M6 — From outside: one rule for the notification and the hover card.
- [ ] M7 — The e2e edits, the record, and the acceptance run.
- [ ] Handed back to the architect: the branch review, class 1a, the Electron e2e groups, the checks that need a Mac, the pull request.

## The landing's edge

What "does not draw in the transcript" means here: nothing under `src/renderer/src/transcript/` is edited. The landing changes what counts as waiting, what the cards hold and what answers them; where a card stands is unchanged.

| part of U1 | satisfied by this landing | left to the landing named |
|---|---|---|
| UC-1 | in full: the predicate, the publisher, every reader, the terminal route's rule, and the predicate by tool call and by agent (Interfaces §A, §B) | the line "Waiting for you · N" where a session is shown without its transcript (U1b, with U10) |
| A1, A17; #358, S-04, S-07 | in full, on the four routes A1 names | #358's third point, the answers a question's row shows between the answer and the transcript's own row (U1b: it is the row's drawing) |
| A3; l4-approvals-02 | the card's content, the three buttons, the hints, the chords ⌘↩, ⇧⌘↩ and Esc, and the 400 ms rule, in the placements the card has today (the docked frame, the Overview card, a child's card in a transcript) | the guards that exist only once the composer is free: focus in the composer or on nothing, ⌘↩ yielding to a draft, a prompt out of view, Esc ahead of the composer's own (U1b). The 200 px bound of A2 is measured here on the card itself, not on the frame around it |
| A5; O-22 | the kind (`async_input`), the words and tone on the row, the tab and Needs you, the disabled Skip, Dismiss | "its form is drawn in the row of the call", "the composer is free", "never docked" (U1b). Until then the question keeps the dock (Reported, 1) |
| A18; "Dismiss" under l4-approvals-08 | the act: the button on the stepper form and on MAWS's ask form, what it sends for each tool, the terminal route's control read from the bridge, the session's row, tab and Needs you no longer counting the question | the row's receipt "Dismissed" and the capsule's receipt (U1b, on U3a's `answer` class); sending a message while a blocking question waits (U1b: the composer is not there while a card is docked) |
| A10; O-23 | in full, wherever the two forms are drawn today | their drawing in the row (U1b) |
| A11; l4-approvals-05 | in full on a session MAWS runs, here or on another machine; a terminal session gets the diff where its file can be read and the fallback where not | nothing |
| A12; l4-approvals-11 | in full on a session MAWS runs on this Mac; "Implement" with no menu on a terminal session | a mode chosen for a session on another machine (Reported, 2: U9's row to add); the modes not yet probed (Reported, 3) |
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
- **Docked:** drawn in the composer's place inside `DockedCardFrame` (`src/renderer/src/composer/docked/`). **Placement:** where the one card component is drawn: `docked`, `card` (the Overview card), `hover` (the sidebar's hover card), `inline` (a child's request in a transcript, the project channel's waiting cards).
- **Build F:** `f1852de3a`, the build on the owner's machines, which a profile may go back to (UC-14). In every file this landing changes, F's source equals the branch's base (`git diff f1852de3a 48619c824` is empty over them), so "what F does" below is what today's code does.
- **The wire:** the commands and events between builds (`src/shared/ipc/wire.ts`); a new optional property is an additive change that raises `WIRE_MINOR` and regenerates `wire-manifest.json`.

## Constraints that bind every milestone

- **The build brief's rules** bind as written: no typecheck, lint, test, install, build or Electron on the MacBook; every check runs on the wave's build VM through `vmcheck.sh` on the pushed head; commits end with the trailer the brief gives; no pull request, no `scripts/ci-gate.sh` and no Electron e2e by an executor.
- **UC-1 is this landing's contract.** After M1 nothing outside `src/engine-host/` compares an attention item's state to say whether it waits: it calls `waits` or `waitsOnAnswer`. A test holds that (M1).
- **Law 5, three routes.** Every act this landing changes is in the table of Interfaces §L with the route that carries it; "not on this route" has its reason there.
- **Law 6.** Nothing here rests on engine behaviour that was not recorded: the plan's next mode on `spikes/protocol-probe/findings-uxwave-u1-plan-next-mode.txt` (branch `ux-wave/probe-send-permission`), the bridge's dismissal on its contract as sminos 1.47.0 states it (Interfaces §G).
- **UC-3.** No file under `src/renderer/src/transcript/` is edited. `EditDiff` and the `Hunk` type are imported from it, nothing more.
- **UC-6.** A key is written only as a row of `ACTIONS` (`src/shared/keymap/actions.ts`); a hint on a button is that row's effective chord in the keymap's own formatting. The two new rows take no rebinding while F may run (U6a's guard) and the landing does nothing for that.
- **UC-8, files other children own.** The insertions are listed in Interfaces §N, each with its owner; nothing else in those files changes.
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
- **Corrected: a second signal of waiting.** The digest of a terminal session driven through its bridge reads `phase: 'waiting'` whenever the bridge lists any pending request (`bridgedDigest` in `src/services/sessions/digest.ts`, fed by `src/services/spine-root.ts` with `view.state.pending.length`), an asynchronous question included. UC-1's table of readers does not name it. The glyph reads a `waiting` phase with no item as Idle, and `isWorking` reads it as not working (Reported, 5).
- **Corrected: where a question is answered outside its pane.** The hover card draws a question read-only (`preview/HoverPreview.tsx`: "never a form") with "Open session", and Needs you opens the session. Only the Overview card answers a question in place (Reported, 1).
- **Keys.** `request.accept` (Enter) and `request.decline` (Escape) are `renderer` rows of scope `pane`, bound `within` the docked frame or the Overview card's article; the dispatcher refuses a pane-scope key whose target is a text field, a button or a link (`refused` in `src/renderer/src/keymap/dispatcher.ts`). Digits pick a scope or an option through the card's own listener. Nothing delays a key after a card mounts, and the frame takes focus when its pane held it.
- **The scopes.** `scopeOptions` (`request-card/scope.ts`) answers `once`; `once, session`; or `once, session, local_settings`, and `once` alone for a request raised by an ask rule. The broker writes the rule for the scope; the answer carries the scope alone.
- **The plan.** `RequestAnswerSchema`'s plan answer is `{kind, outcome, feedback}`, strict (`src/shared/engine/answers.ts`); the broker's `toWire` allows with the input and the engine restores the earlier mode. The engine host tracks that mode as `prePlanMode` in the session's status (`src/engine-host/session-status.ts`), null when the session entered Plan from a mode it did not know. The mode menu's entries are `MODE_OPTIONS` (`src/renderer/src/statusline/mode-menu.ts`), bypass with a confirmation.
- **Corrected: an answer and a mode change are graded apart.** At another machine's endpoint `session.answer` on a plan takes the grade `approve` (`src/endpoint/by-effect.ts`) and `session.setPermissionMode` takes `manage` (`src/shared/ipc/grades/session.ts`) under the machine's ceiling. A machine on build F does not know a new key of the answer: its endpoint holds an input to its own schema (Reported, 2).
- **The trust card.** `TrustDetails` (`src/renderer/src/sessions/TrustCard.tsx`) is mounted by the composer's trust card, the remote setup sheet (`RemoteSetupSheet.tsx`), a comment card's thread (`side/card/CardThread.tsx`) and the comment's trust notice (`tools/document/comment-session.tsx`). `DockedCardFrame` appends "· Composer paused · draft preserved" to every title.
- **The notification.** `canAllow` (`src/main/attention/actions.ts`) reads the request afresh and admits a read-only tool; the notifier asks it before posting and sends `actions: ['Allow once']`; the port turns each action into a button (`src/main/client/electron-port.ts`). A terminal session's item is told in-app only (`isLaneAItem`), and a remote one carries no action.
- **The hover card's approval** is `hoverApproval` (`request-card/quick-approval.ts`): a pending permission for a read-only tool with nothing withholding quick approval, by pointer click only (`usePointerOnly`). `sidebar/RequestPreview.tsx` is the slot's fallback, drawn only where the card is not registered (unit tests of the sidebar).
- **The file preview** (`preview/ToolPreview.tsx`) prints the absolute path and the old and new text as two blocks cut at six lines. `EditDiff` (`src/renderer/src/transcript/view/cells/EditDetail.tsx`) draws `Hunk[]` with line numbers and takes `cell: null`. `files.read` answers a missing file inside the session's folders with an error whose message opens `not found:` (the rule `tools/code/viewer/viewer-store.ts` already reads), and refuses a path outside them.
- **The terminal's answers.** `answerIntent` (`src/shared/lane-a/answers.ts`) is shared by the local driver (`src/services/lane-a/decisions.ts`, `driver.ts`) and the adapter for another machine (`src/main/lane-a/remote.ts`); it refuses a skip of every question and a decline on an asynchronous question. The driver reads the bridge's declared controls from its status (`capabilities.controls`, a free record), and maps a decision's answer by HTTP status; a 409 with no `settled`, `winner`, `by` or `code` becomes `not_pending`.
- **Tests that pin what changes** are listed per milestone. Electron e2e specs drive the permission card by the radio "Allow once" and the button "Allow" in about two dozen spec files, most of them `-live` specs that no gate runs, and in one shared helper (`allowNext` in `e2e/support/maws-tools.ts`, which seven more specs call); M7 gives the search that finds them.

## Decisions settled at authoring

Each is a means the section left open, with its reason and what lost. Decisions that change what the owner sees beyond the section's words are under "Reported to the architect" instead.

1. **`selectPendingOf` keeps its name and signature** and changes its meaning to "the items for which `waits` holds". Twenty files of other children read it (the sidebar, the tabs, the palette, the resume chooser, the side thread, the floating card, the agent list); none is edited, and each follows UC-1 by this one change. Lost: a new name with the old one removed, which would be an edit in every sibling's file for no change in what they mean.
2. **The card draws nothing once its answer is delivered.** `RequestCard` returns null in its own `delivered` phase and for an item whose state is `delivered` (which only a machine on an older build still sends). The window does not wait for the publisher's next list to remove the card. The "Answered in the terminal: Allowed" note of three seconds (`useSettling`) is kept: it is held by the docked frame's own state, not by an item, so it counts nowhere. "Already answered elsewhere" (two seconds, a lost race) is kept: it is not an "Answered" line of ours.
3. **A terminal session's accepted answer is hidden by the two list holders**, the spine's `laneAAttention` and the window's `connectRemoteLaneA`, as the section's table names them, through one shared pure module (Interfaces §B). Lost: omitting the request from the bridge state the driver publishes (`LaneAState.pending`), which would make every window agree on the remote route too but changes the meaning of a field that the race and the answer's capability also read. The cost of the choice: a second window of this app showing the same terminal session on another machine keeps the card until the bridge's `settled` reaches it.
4. **The 400 ms rule is built now**, on the card's three keys in the docked frame and the Overview card. The frame takes focus by itself when its pane held it, so a ⌘↩ meant for the composer could otherwise allow a prompt that appeared under it; that hazard exists today with Enter. The other guards of A3 need a composer that is still there and wait for U1b.
5. **The docked frame's title stays on a request** ("Approval needed · Composer paused · draft preserved"): the composer is paused while a card is docked, and U1b removes the frame. The card's own first line replaces the tool-name heading and the "wants to" line under the frame's title. **The three cards another child docks** (trust, relay-down, failed start; all in `sessions/SetupCard.tsx`) read their title alone from this landing on. l4-approvals-13 asks it of the trust card, and its two siblings in the same component take the same change so that the three read alike; the section gives that sentence under l4-approvals-08.
6. **The hover placement keeps its layout** (l4-approvals-08, "Not included"): its heading, the title, the "wants to" line, the project and age line and the folder line stay. Only its buttons and their rule change (M6). The new card content of l4-approvals-02 applies to the docked, Overview and inline placements. So the folder line goes from those three and stays in the hover card.
7. **A plain deny of an asynchronous question is the dismissal, at the one mapping** (`answerIntent`), and the card decides which gesture sends it: the Dismiss button, never Esc (O-22 keeps Esc sending nothing there). Lost: a new member of `RequestAnswer` for a dismissal, which changes the wire of `session.answer` and `laneA.answer` for an act only one route has; a new command, a second path for one button.
8. **A 409 from the bridge that names no winner is re-read, for every decision, not only a dismissal.** The driver asks `GET /requests/<id>` again: still pending means refused with the bridge's sentence and the card stays; settled means `not_pending` as today. Today's mapping closes the card on a request that still waits.
9. **The diff is computed in the window**, by a pure function from the file's text and the call's input, and drawn by the transcript's `EditDiff`. No dependency is added; `fast-diff`, already in the tree, may serve a line diff, and the algorithm is the executor's. `ToolPreview` keeps its props and its drawing: it is the fallback, and desk web imports it. Lost: Review's diff component (`@git-diff-view`), which draws its own view and not the transcript's lines; asking the session's machine for a diff, a new command for what one read gives.
10. **The plan answer names a mode only when the label could not otherwise be true.** With the earlier mode known, the button names it and sends today's answer, byte for byte: that is the path every plan approval has run. A mode picked from the menu is carried in the answer. Lost: always carrying the mode, which would send `auto` on most approvals, a mode the check ran only where it equalled the restored one.
11. **The field's type is the existing mode enum, and the broker holds it to the probed modes.** A closed list in the schema would make every later mode a change of an enum, which the wire's rule counts as a new major. So `mode` is `PermissionModeSchema`, and `PLAN_NEXT_MODES` is checked where the answer is written.
12. **One rule for outside answers, with the surface as a parameter**: the notification admits a command of one line and at most 120 characters, the hover card any command (its preview scrolls). The sidebar's fallback preview (`sidebar/RequestPreview.tsx`) changes its predicate only: it is never drawn in the app.
13. **The titles of the four key rows** are settled once, so that U1b renames nothing (Interfaces §D).
14. **A terminal session's digest counts what its list counts**: the requests that stop it and that MAWS has not answered (Interfaces §B). An asynchronous question does not make the session read as waiting.
15. **The words of a settlement that is a dismissal** (Interfaces §G): "Dismissed in the terminal", "Dismissed elsewhere"; "No longer asked" stays for a request the bridge withdrew.
16. **The e2e specs are edited in the last milestone**, in one pass: no executor runs them, and most of the edit is one substitution repeated across files.

## Reported to the architect

Each point contradicts a sentence of the section or needs a word this document cannot give. The default is what the milestones build; a ruling changes the place named.

1. **O-22's interim: an asynchronous question keeps the dock until U1b.** The section: "Until the placement work lands (the first pull request), the question is answered from Needs you, the Overview card or the session's hover card". In the code only the Overview card answers a question; the hover card previews it and Needs you opens the session. With the kind changed and the dock gone, the session's own pane would show nothing to answer, and "Open session" would lead nowhere. **Default:** the item changes kind, words and tone now, and its form stays docked until U1b gives it its row. **Place:** Interfaces §C, the swap rule's last row (one line of `swapOf` and its test). The other answers: as written, with the Overview card as the one place; or let the hover card answer a question, which #333 excludes.
2. **l4-approvals-11 on another machine: the mode is not carried.** The section: "the mode travels inside the answer, through the answer offer that exists". At the endpoint a plan's answer is graded `approve` and a mode change `manage` under the machine's ceiling, so a mode inside an answer would let a member change a mode they may not set; and a machine on build F does not know the key (its endpoint holds an input to its own schema, so it refuses the answer or drops the key), which makes the button's label false there. **Default:** on a session another machine runs the button names the mode and has no menu, and the endpoint refuses a plan answer that names a mode. **Place:** Interfaces §F, the row "a session another machine runs" (and the guard's row in §N). Carrying it is an insertion in U9's files: a by-effect grade of `manage` held to the ceiling, behind a capability.
3. **l4-approvals-11's menu: only the modes the check ran.** The section: "A menu on the button lists the other modes". The check of 2026-11-12 ran `acceptEdits` (two of two) and `default` (one of one) end to end, and `auto` only where it was the restored mode; `bypassPermissions` was not run. **Default:** `PLAN_NEXT_MODES = ['default', 'acceptEdits']`; and where the earlier mode is not known the button reads "Implement" alone and sends today's answer, where the section names "the person's default mode" (which is `auto` by default, and would have to be carried to be true). **Place:** the constant, and the label's rule, both in Interfaces §F. Widening it needs the probe named under "Proof that an executor does not run".
4. **The keys' amendment lands here, not with the placement.** The section puts "A permission prompt is answered with ⌘Enter, ⇧⌘Enter and Esc" inside l4-approvals-08's sentence, which U1b records; the keys change in this landing, and charter §5.8 ("Enter/Esc on a docked request") is wrong from it. **Default:** this landing records a keys-only sentence at §5.8; U1b records the placement. **Place:** "The record", row 3.
5. **A terminal session's digest is a reader UC-1's table does not name** (see "What the code holds today"). **Default:** decision 14. **Place:** Interfaces §B, "The digest".
6. **A request's folder line: U1 removes it where U8 plans to move it.** The root's UC-4 leaves "a request's folder line in its card and in the sidebar's preview" to U8's second landing to sort; l4-approvals-02 says "The folder line goes". **Default:** decision 6: gone from the docked, Overview and inline card, kept in the hover card and the sidebar's fallback preview, which U8c then sorts. **Place:** Interfaces §D, "What goes".
7. **The bridge's dismissal as built** differs from the section in the sentences listed in Interfaces §G, "Where the section's words do not hold"; the hand-back names each sentence for the architect to correct. Two bear on what the owner sees: a dismissal of a terminal's asynchronous question on another machine is not carried, whatever that bridge declares; and an idle agent is told nothing until its next prompt or tool result.

Consequences recorded, with no ruling asked: a terminal session's asynchronous question now follows the notification setting "asyncInput" for its in-app notice, where it followed "questions" (the notifier groups by kind); in the crossing where this build's window is attached to a session an older build's engine host kept, a mode picked from the plan's menu is dropped by that host's tolerant reader and the session returns to its earlier mode, which the mode chip then shows.

## Acceptance

The child's acceptance items, cut to this landing (the edge table says what each leaves). "Unit" is a test on the build VM; "e2e" is a scene in the named spec, run on a Mac by the architect; "Mac" is a check under "Proof that an executor does not run".

| item | what is observed | proven by | milestone |
|---|---|---|---|
| A1 | In a mode that asks, a command whose result has not come is allowed once. From the click: no card and no line reading "Answered" in the pane; the composer and Stop are there; the session's row and tab read Working; Needs you does not list the session and the badge does not count it. The same in a window on another machine | unit (A17's tests; the card; the swap); e2e `requests.spec.ts`, a new scene on a replayed permission whose result is cut from the fixture; e2e `remote.spec.ts`, its permission scene | M1, M7 |
| A1, terminal | A terminal session's prompt is allowed in MAWS: the card leaves when the bridge accepts the answer, before the bridge's `settled`; if the bridge still lists the request 5 s later, it waits again | unit (the transition table of §B, with the sequence held open); e2e `lane-a.spec.ts`, its bridge double holding `settled` back | M1, M7 |
| A1, terminal on another machine | The same in the window that answered | unit (`connectRemoteLaneA`) | M1 |
| A17 | Each reader in §A's table, handed one `delivered` item, shows nothing waiting. Each test fails on `48619c824` | unit, one test per row | M1 |
| A3 (here) | On a docked permission prompt whose frame has focus: ⌘↩ allows once, ⇧⌘↩ gives the lasting scope its button names, Esc denies; each key is printed on its button; Enter and the digits do nothing. A key pressed less than 400 ms after the prompt appeared answers nothing. A prompt flagged "default to no" has no key that allows and no hint on its allow buttons. The same on a focused Overview card | unit (the card; fake timers at 399 and 400 ms); e2e `requests.spec.ts` | M3, M7 |
| l4-approvals-02 | The card reads, top to bottom: what is asked, the preview, the call's "Why", the engine's reason, the buttons, and the rule's file line only with "Always allow in <project>". No scope list, no tool-name heading, no folder line. A one-line command with no description: the card is at most 200 px tall at the transcript's width | unit (content by request shape, §D's table); e2e `requests.spec.ts` (the card's measured height); `c7-shots.spec.ts` on purpose (the pictures) | M3, M7 |
| A5 (here) | A terminal session's asynchronous question: its row, tab and Needs you read "Question waiting" in the calm tone; a Skip that would leave every question unanswered is disabled with its reason; Esc sends nothing | unit (`laneAEntryOf`, the glyph, the card); e2e `lane-a.spec.ts` | M2, M7 |
| A18 (here) | Dismiss on the stepper form of a blocking question sends the decline Esc sends. On MAWS's ask form it sends one answer with every question skipped. On a terminal's asynchronous question it sends the bridge's dismissal where the bridge declares it, and is drawn disabled with "Dismiss it in the terminal" where it does not; on another machine it is disabled with its reason. After it the session's row, tab and Needs you no longer count the question | unit (both states, §G); e2e `lane-a.spec.ts` with its bridge double in each state; Mac (the real plugin) | M2, M7 |
| A10 | A double-click on a single-choice option of the stepper picks it and goes on (Next, or Submit on the last); on MAWS's ask form it picks, and submits when the form is then complete; a multi-choice option and "Other…" never submit | unit; e2e `requests.spec.ts`, `maws-tools.spec.ts` | M2, M7 |
| A11 | A prompt for a file that does not exist reads "Create <name>", for one that exists "Edit <name>", with the path relative to the working folder and the change as numbered diff lines with three lines of context and "Show all". While the file is being read, and when it cannot be read, the card shows the input alone under "Write <name>" or "Edit <name>", and its buttons answer | unit (the pure function; the card with the read held open, failed, and never answered); e2e `requests.spec.ts`, `c7-shots.spec.ts` | M4, M7 |
| A12 | A plan's primary button reads "Implement · <mode>" with the mode the session was in before Plan; a mode picked from its menu is the mode the session is in afterwards. On a terminal session and on a session another machine runs there is no menu | unit (the card; the broker's wire for a named mode; the endpoint's refusal); e2e `requests.spec.ts` on a replayed plan | M5, M7 |
| A13 | In a folder with no project settings and no `.mcp.json` the trust card shows the path, "Nothing in this folder loads or runs automatically.", where trust is recorded and its three buttons, and no list; with files found it is as today. The frame's title is "Trust this folder?" and nothing more | unit (`sessions/cards.test.tsx`); e2e `sessions.spec.ts` | M5, M7 |
| A14 | The rule of §H: a notification for a short command carries "Allow once" and "Deny" and each does what it says; one for a file change carries "Deny" only; the hover card offers the same for the same requests, by pointer click only | unit (the rule's table; the notifier; the actions re-read at the press); e2e `shell.spec.ts`, `requests.spec.ts` (the hover card); Mac (a signed build, U14's check "l1-sessions-08") | M6, M7 |
| A16 | Deny with a reason and Deny and stop; the Question sheet's form; answering from the Overview card; who asks and how many wait; the transcript's follow behaviour: unchanged | the unit tests that hold them today, named in M7, pass unedited except for the selector of the Allow control | M7 |
| §K | What the landing sends, and what build F does with it, each row | unit, one test per row of §K's table | M1, M2, M5 |

## Plan of Work

Seven milestones. M1 is the contract and lands first inside the branch: everything after it reads `waits`. M2 to M6 each change one card or rule and are independent of each other but for two edges: M4 fills the preview region M3 lays out, and M6 uses the button words M3 settles. M7 edits the e2e specs, writes the record and runs the acceptance.

### M1 — One predicate, the publisher and every reader

**What exists at its end.** "Waiting" has one definition, and an answered request waits nowhere. The publisher keeps and sends only waiting broker items. The card draws nothing once its answer is delivered, and the composer is back at that moment. A terminal session's request leaves its list when the bridge accepts MAWS's answer. A terminal session reads as waiting only for a request that stops it and that MAWS has not answered.

**What it touches.** `src/shared/attention/kinds.ts`; `src/services/attention/service.ts`; under `src/renderer/src/`: `attention/derive.ts`, `attention/glyph.ts`, `attention/navigation.ts`, `stores/attention.ts`, `composer/docked/swap.ts`, `request-card/RequestCard.tsx`, `request-card/inline.tsx`, `request-card/quick-approval.ts`, `request-card/variants/Notice.tsx`, `lane-a/remote-connect.ts`, `stores/lane-a.ts`, `session/controls/lane-a.ts` (it tells the window's list that an answer was accepted), `harness/composer/ComposerHarness.tsx`; `src/main/attention/notifier.ts`, `actions.ts`; `src/main/lane-b/remote-session.ts`; `src/services/lane-a/attention.ts`, `driver.ts` (it tells the spine's list), `src/services/spine-root.ts`, `src/services/sessions/digest.ts`, `inactive-archive.ts`, `stub-source.ts`; a new `src/shared/lane-a/accepted.ts`; comments only in `src/engine-host/pending-counts.ts` and `src/endpoint/lane-b-pending.ts`. Insertions in files other children own: `src/renderer/src/sidebar/RequestPreview.tsx` (§N). Their tests.

**Interfaces.** Exposes §A (to U2, U7, U8, U9, U10, U12, U13 and to every later milestone), §B and §C. Consumes nothing.

**Decisions.** Decisions 1, 2, 3 and 14. Seen in the code:
- `attention.request` answers only for an item the publisher's broker list holds, so after this milestone it answers null for a delivered request. Nothing asks: the card that would is gone.
- `forgetClosedDrafts` then drops a question's draft at the answer. That is right here; U1b, which draws the given answers in the row, changes what holds them.
- The notifier closes a request's banner when its item stops waiting, so a banner now closes at the answer, not at the engine's confirmation.
- `src/engine-host/` is not a reader: the broker's `live` and `processExited` and the request events the session stream holds stay "pending or delivered" (the child's file, "What does not read it"). The engine host still sends every live item in `session.brokerItems`; the publisher and `src/endpoint/lane-b-pending.ts` filter it.
- The service's restore logic compares states for its own lifecycle (an error seen, a confirmed legacy item) and stays; its two "still open" comparisons become the predicate.
- U3a removes the `task.notification` branch of `service.ts` in parallel (UC-8); whoever merges second keeps both changes.
- No edit in `composer/Composer.tsx` (U4's) or `session/SessionPane.tsx` is needed: both read `selectPendingOf` and `swapOf`.

**What it does not touch.** The broker and its states; the transcript; what the cards hold (M3 to M5); `isOpen` in `stores/layout-model.ts` and in `apps/desk-hub`, which are other things with the same name; any e2e spec.

**What it proves.** A1 and A17 at the unit level, and §K's first row. Tests, by the behaviour each asserts:
- `waits` holds for `pending` alone; `waitsOnAnswer` adds a request id; `waitingByCall` and `waitingAgents` over a list with a pending, a delivered and a confirmed item.
- One test per row of §A's reader table, each handing its reader one `delivered` item.
- The publisher: a broker list holding a pending and a delivered item is sent and persisted as the pending one alone; `attention.list` answers the same; a delivered item that turns pending again does not occur (the broker never moves back) and is not built for.
- The card: a `delivered` outcome renders nothing and calls `onAnswered`; an item already `delivered` at mount renders nothing and binds no key; a failed write keeps the card with "Couldn't deliver the answer" and Retry; `not_pending` reads "Already answered elsewhere" for two seconds.
- The swap: an answered item does not dock and the next waiting one does; the count of those behind it does not include the answered one.
- The terminal list (§B's table), each with timers faked and the sequence held open: accepted then settled; accepted and still listed by a fresh state at the grace's end, which waits again; accepted while the stream is not fresh; an answer whose outcome is `unknown` hides nothing; the bridge leaving `live` forgets every mark. The same cases for the window's mirror.
- The digest: a bridged session with one asynchronous question and a running turn reads `working`; with one blocking request, `waiting`; with that request accepted and still listed, `working`.
- A tree test: no file under `src/` outside `src/engine-host/` imports `isOpen` from the attention kinds, and none compares an attention item's state with `'delivered'`. How it recognises a comparison is the executor's; it must fail on `48619c824`.

Tests that pin today's behaviour and change: in `request-card/RequestCard.test.tsx`, every expectation of a status "Answered · …" (the stepper's submit, Skip and Esc cases; "delivered collapses to one line…"; "an item already delivered when the card mounts renders the collapsed line"; "the next request in the same Overview card inherits neither…"); `composer/docked/swap.test.ts` ("keeps an answered request docked (collapsed) until it retires"); `attention/derive.test.ts` ("counts delivered items…"); `attention/glyph.test.ts` (its closed-state case); `attention/navigation.test.ts` ("a permission request answered: its item, held in the list…", where the toast is now dismissed at `delivered`); `stores/attention.test.ts` ("is kept while its item is open (pending or delivered)…"); `src/main/attention/notifier.test.ts` (an item first seen delivered; the badge's count; "withdraws a request banner when the request resolves"); `test/endpoint/lane-b-notify.test.ts` ("counts only the items that wait on an answer…": two becomes one); `src/services/attention/service.test.ts` ("keeps the broker's pending and delivered items…" and its two neighbours); and, in U10's directory, `shell/floating.test.ts` ("a new permission request or question raises the pill…", whose delivered item was "the same request, still pending").

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
- `answerIntent`, the table of §G row by row; `decisionFor` builds exactly `{behavior: 'dismiss'}`; the driver posts it with `by` and the launch and with no other key; each row of §G's result table, the re-read of a 409 with the sequence held open (the re-read pending, then answering pending, settled, and failing).
- The adapter for another machine refuses a dismissal before any act is built, when the remote state declares the control and when it does not.
- The card, both states: with a bridge state that declares `decide.dismiss`, the button is enabled and its press calls `laneA.answer` once; with a state that lacks the key, the button is disabled and its title is "Dismiss it in the terminal"; with the key present and unavailable, its title is the bridge's reason; in both, Esc sends nothing and the Skip that leaves every question unanswered is disabled.
- The settlement's words, §G's table.
- The stepper: Dismiss on a blocking question sends the plain deny once; a double-click on a single-choice option on a middle step advances, on the last step submits once, and where the session cannot carry the submit only picks; on a multi-choice option and on "Other…" it never submits; without the two props (desk web's use) the stepper has neither.
- MAWS's ask form: Dismiss sends one answer with every question `skipped` and ignores a half-typed "Other"; a double-click that completes the form submits once; one that leaves another question empty only picks.

Tests that pin today's behaviour and change: `src/shared/lane-a/answers.test.ts` and `src/services/lane-a/decisions.test.ts` (the refusal "an async question is answered, never declined"); `session/controls/lane-a.test.ts` (the same sentence as a capability); `request-card/lane-a-card.test.tsx` ("never declines an async question…": Esc still sends nothing, and the test gains the button); `src/services/lane-a/attention.test.ts` and `lane-a/remote-connect.test.ts` (the kind of the asynchronous item); `lane-a/race.test.ts` (the words for `withdrawn`); `src/services/lane-a/driver.test.ts` (its `decisions` cases gain 404, 503 and the bare 409).

### M3 — The permission card: three buttons, the hints and the keys

**What exists at its end.** The card of §D in the docked frame, the Overview card and a child's inline card: one line saying what is asked, the preview, the buttons with their keys on them, the file line only with a project rule. ⌘↩, ⇧⌘↩ and Esc answer from the frame or the focused Overview card, after 400 ms; Enter and the digits no longer answer a permission prompt.

**What it touches.** `src/shared/keymap/actions.ts` (two rows, two titles; U6's file, §N); under `src/renderer/src/request-card/`: `RequestCard.tsx`, `variants/Permission.tsx`, `variants/types.ts`, `scope.ts`, `tools.ts`, `controls.tsx`; `src/renderer/src/composer/docked/DockedCardFrame.tsx`. Their tests, and two tests in other children's directories that list the rows (§N).

**Interfaces.** Exposes §D; consumes U6a's row shape and `effectiveChord` (§M).

**Decisions.** Decisions 4, 5, 6 and 13. Seen in the code:
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
- "Default to no": no allow key, no hint on the allow buttons, the buttons still answer by click. "Needs its own consent surface": no allow button, the sentence, Deny.
- A terminal session's request: a scope its bridge cannot carry and deny-and-stop are drawn disabled with their reasons and bound to no key.
- The first line by tool class (§D), "· from <agent>" only for a subagent; no heading, no "wants to" line, no folder line in the three placements; the hover placement unchanged.

Tests that pin today's behaviour and change: `request-card/scope.test.ts` (labels and details of the list); in `RequestCard.test.tsx`: "docked, the scope group offers the grant scopes; digits pick, Enter allows the picked scope", "docked with the request still loading, digits reach the frame…", "a default_to_no request never answers on Enter…", "a requires_user_interaction Read has no Allow, no scope group…", the heading "Bash", "Enter and Esc on the focused article answer through the dispatcher"; `request-card/inline.test.tsx` (headings); `request-card/lane-a-card.test.tsx` (the disabled scope and "Allow"); `settings-tab/KeymapSection.test.tsx` and `settings-tab/keymap.test.ts` (the rows' titles and ids, §N).

### M4 — A file change as a diff

**What exists at its end.** A prompt for a file change says "Create" or "Edit", shows the path relative to the working folder, and draws the change as the transcript draws an edit: numbered lines, added and removed backgrounds, three lines of context, a capped height with "Show all". The file is read from the machine the session is on. Until that read answers, and when it cannot, the card shows the input alone and answers as before.

**What it touches.** Under `src/renderer/src/request-card/`: a new pure module and a new component in `preview/` (§I), `variants/Permission.tsx`, `RequestCard.tsx` (the first line's file words), `tools.ts`. Their tests. Nothing in `preview/ToolPreview.tsx` but what the fallback needs (it keeps its props).

**Interfaces.** Exposes §I; consumes `EditDiff` and `Hunk` from the transcript, `files.read`, and `useWorkingFolder` from U8a (§M).

**Decisions.** Decision 9. The read is asynchronous, so its three courses are fixed here:
- *The person acts while the read is out.* The buttons never wait for it. An answer sent meanwhile is sent once; the read's late answer finds no card and writes nothing (it is dropped by the request it was made for, not by a mounted flag alone, so a card remounted for another request never shows the first one's file).
- *The read fails.* Too large (`truncated`), not text (`encoding` is not `utf8`), refused (outside the session's folders), the link down, an error of any other kind: the card stays on the input alone, under "Write <name>" for the Write tool and "Edit <name>" otherwise, and does not claim "Create".
- *The read never answers.* The same drawing stands; the card adds no timer of its own.
- Only an error whose message opens `not found:` (the files service's answer for a missing file inside the session's folders) makes "Create". Over the machine link the sentence may arrive reworded; then the card falls back, which errs on the side of saying less. The executor reads what the link gives and records it under Surprises.
- The file is read once per request and path, at most the default length of `files.read` (1 MiB); a longer file falls back. The diff is of the file as read: it is a preview, and the engine applies the edit to the file as it then stands.
- Authorisation is the files service's own: the card passes the absolute path the call names, and a path outside the session's folders is refused where the read runs, on this Mac or on the session's machine.

**What it does not touch.** `EditDetail.tsx` and everything else under `transcript/` (import only); a notebook cell's diff beyond its new source (the section's "Not included"); editing the proposed change.

**What it proves.** A11. Tests:
- The pure function, §I's table: an edit found once; `replace_all`; an `old_string` the file does not hold (falls back); several edits in order; a write over an existing file (a line diff, not the whole file replaced); a write of a missing file (one hunk of added lines); a notebook edit (input alone); three lines of context at the head, the middle and the end of a file.
- The card with the read held open: the fallback is drawn and the buttons are enabled; Allow pressed then sends one answer, and resolving the read afterwards changes nothing and logs nothing.
- The read rejected with `not found:` reads "Create <name>"; rejected otherwise, "Write <name>" and the input alone; never resolved, the same.
- The path: relative when inside the working folder, whole when outside or when the session has no record here, whole in the title.
- A terminal session: the diff where the read answers, the fallback where it is refused.

Tests that pin today's behaviour: none render the old blocks; the checks of the path under `data-testid="request-input"` (`RequestCard.test.tsx`, the Edit fixture `test/fixtures/requests/edit-permission.json`) change to the relative path.

### M5 — The plan's next mode; the trust card

**What exists at its end.** A plan's primary button reads "Implement · <mode>" and, on a session MAWS runs on this Mac, has a menu of the other modes an allow may name; the chosen mode is the mode the session is in after the allow. The trust card of a folder that holds nothing to load says so in one line. The three cards another child docks read their title alone.

**What it touches.** `src/shared/engine/answers.ts`, a new `src/shared/sessions/plan-next-mode.ts`, `src/shared/ipc/wire.ts` and `wire-manifest.json` (the minor), `src/engine-host/broker.ts` (`toWire`), `src/shared/lane-a/answers.ts`; `src/renderer/src/request-card/variants/Plan.tsx`, `answers.ts`; `src/renderer/src/session/controls/lane-b.ts` and `lane-a.ts` (each closes a plan answer that names a mode where its route cannot carry one); `src/renderer/src/sessions/TrustCard.tsx`, `SetupCard.tsx`, `src/shared/sessions/trust.ts`; `src/renderer/src/composer/docked/DockedCardFrame.tsx`. One insertion in U9's `src/endpoint/offers.ts` (§N). Their tests.

**Interfaces.** Exposes §F and §J; consumes `MODE_OPTIONS` and the mode labels (§M).

**Decisions.** Decisions 5, 10 and 11, and Reported 2 and 3. Seen in the code:
- The check of 2026-11-12 answered the plan with `updatedPermissions: [{type: 'setMode', mode, destination: 'session'}]` beside the allow's `updatedInput`, and the engine applied the mode before the tool's result reached the model. `toWire` builds exactly that for a named mode. The update is not a grant: it is not handed to `onGrant`.
- The guard at the endpoint is where the act runs for a caller on another machine: the row of `session.answer` takes an `accepts` that refuses a plan answer naming a mode, so the refusal (`malformed`) is made on the input the engine host would act on. The window's own gate (no menu on such a session) is not the check.
- `prePlanMode` reaches the window in the session's status (`EngineSessionStatus.prePlanMode`). For a session another machine runs the card names it when the status the window holds gives it and reads "Implement" when it does not; the executor records which it finds.
- The wire's minor rises by one for the optional property; other landings raise it too, and whoever merges second takes the next number and regenerates the manifest (`pnpm wire:manifest`).
- `TrustDetails` is one body for four mounts (the composer's card, the remote setup sheet, a comment card's thread, the comment's trust notice), so all change together, as the section says. `TRUST_GATES` loses its last reader and is removed.

**What it does not touch.** Keep planning and Clear context and implement; the mode menu itself and the mode chip; what the trust card does (its three buttons, the home-folder wording); `src/services/sessions/trust.ts`.

**What it proves.** A12, A13, and §K's row for the plan answer. Tests:
- The schema: a plan answer with no `mode` parses as today's; `mode` is accepted only with `implement`.
- The broker: a named mode in `PLAN_NEXT_MODES` writes the allow with the `setMode` update; a mode outside it is refused and the item stays pending; no mode writes today's response, compared whole.
- The card: with `prePlanMode` known, the label names it and the press sends an answer without `mode`; a menu entry sends its mode; with `prePlanMode` null the button reads "Implement" and the menu still lists the modes; the menu never lists Plan or the mode on the button.
- No menu on a terminal session and on a session another machine runs; `answerIntent` refuses a plan answer that names a mode.
- The endpoint: `session.answer` with a plan answer naming a mode is refused `malformed` for a caller on another machine, whatever the caller's grade; the same answer without the mode passes as today.
- The tolerant reader over today's schema drops `mode` from a plan answer and keeps the rest (what an older engine host does with it).
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

**What it touches.** `e2e/support/maws-tools.ts` (`allowNext`) and the specs below; one new replay fixture; `docs/charter.md`, `docs/doperpowers/plans/2026-09-28-c7-composer-requests.md`, `docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md`; `docs/tech-debt-tracker.md` (the residue); this document.

**The e2e edits.** The executor edits and does not run them. The search that finds every site, from the repository's root: `grep -nE "Allow once|name: 'Allow'|Allow for this session|Allow scope|'Approve'|Answered ·|press\('Enter'\)|press\('Escape'\)|Digit|press\('[1-9]'\)" e2e/*.ts e2e/support/*.ts`, read with each hit's surrounding card. The substitutions:

| today's gesture | becomes |
|---|---|
| click the radio "Allow once", then the button "Allow" | click the button "Allow once" |
| Enter on a docked permission or on an Overview card's article to allow | ⌘Enter, after the card has stood 400 ms (wait on the card, not on a sleep: the scene polls the answer) |
| the radio "Allow for this session" (or the digit 2) then Enter or "Allow" | the button "Allow for this session", or the entry of that name in the menu on Allow once when the request also offers a project rule |
| an expectation of the radio group "Allow scope" or of its labels | the buttons §D gives for that request |
| the status "Answered · Allowed once" | no `[data-request-card]` for that request |
| the hover card's "Approve" | "Allow once" |
| Esc on a docked permission to deny | unchanged |
| a heading "Bash" or "Read" in a docked, Overview or inline card | the first line of §D ("Run a command", "Read a file"); the hover card keeps its heading |

Specs a gate runs, with what each crosses: `requests.spec.ts` (everything above; the new scenes); `lane-a.spec.ts` (the card's options, the asynchronous question, the card leaving at the bridge's acceptance); `maws-tools.spec.ts` and the helper `allowNext`, which `deliverables`, `design-export`, `dashboard-export`, `design-systems`, `document-standalone` and `presentations-export` call; `to-human.spec.ts`, `side.spec.ts`, `panel.spec.ts`, `agent-tools.spec.ts`, `browser-comment.spec.ts`, `remote.spec.ts`, `shell.spec.ts` and `sessions.spec.ts` (the hover card's "Approve"; the trust card), `composer.spec.ts` and `voice.spec.ts` (a docked trust stub: they pass unedited unless they read the frame's suffix), `supervisor.spec.ts` (the glyph: unedited), `org-page.spec.ts` and `widgets.spec.ts` where the search hits a permission card. `c7-shots.spec.ts`, which no group runs, gains the pictures of §D's cards; the height check is a scene of `requests.spec.ts`, which a group runs. The `-live` specs (`agent-tools-live`, `c11-live`, `c12-live`, `c12-prerun`, `composer-live`, `dashboard-live`, `design-live`, `design-systems-live`, `document-live`, `document-provisional-live`, `library-live`, `maws-tools-live`, `p1-live`, `presentations-live`, `presentations-provisional-live`, `to-human-live`) take the same substitutions and are run by no gate; their edit is reviewed by reading. `cross-build.spec.ts` is read for the same gestures and edited only where the search hits.

**New scenes** (invented content, UC-11), each named by what it shows:
- `requests.spec.ts`: an allowed command whose result never comes (a copy of the permission fixture cut before its result): after "Allow once", no card and no text "Answered", the editor and Stop are visible, the session's row glyph reads Working, Needs you does not list it and the badge is one lower. The three chords and their hints; ⌘Enter within 400 ms answering nothing. A prompt with a project rule: three buttons and the file line; an ask-rule prompt: two buttons. A one-line command with no description: the card's own box (`[data-request-card]`) is at most 200 px tall. An edit of an existing file with numbered diff lines; a write of a missing file reading "Create". A replayed plan whose button names the mode. A double-click on the stepper's option going to the next question.
- `lane-a.spec.ts`: an asynchronous question reads "Question waiting" on its row; its Dismiss is disabled with "Dismiss it in the terminal" while the bridge double declares no `decide.dismiss`, and enabled when it declares it; the press posts `{behavior: 'dismiss'}` and the card leaves at the 200. A permission allowed in MAWS leaves before the double's `settled` (the executor reads how the spec's stand-in bridge settles a request and holds that back; if it cannot be held, the scene is left out, the order stands on M1's unit test, and the hand-back says so).
- `sessions.spec.ts`: a folder with nothing to load shows the one line and no list.
- `shell.spec.ts` or `requests.spec.ts`: the hover card denies a file change and allows a short command once, by click.

A fixture added or edited is scanned on the VM (`node --test .github/scripts/maws-app-scan.test.mjs`).

**The record** is the table under "The pull request", written in this milestone.

**What it does not touch.** Any source file but to repair what the acceptance run finds.

**What it proves.** Every row of Acceptance that names "unit", by the whole suite on the VM; the keeps of A16, by these tests passing with no edit but the Allow control's selector: `RequestCard.test.tsx` ("Enter in the Deny… with a reason textarea is a newline; ⌘Enter sends the deny with the reason", "the caret menu denies and stops the turn"), `tools/maws/ask/AskSheetTool.test.tsx` and `draft.test.ts` (the sheet's form, Decide for me, Skip, one Submit), `overview/Overview.test.tsx` and the Overview cases of `RequestCard.test.tsx` (answering in place), `request-card/requester.test.ts` and the "more waiting" case of `composer/Composer.test.tsx` (who asks, how many wait), `transcript/view/Transcript-scroll.test.tsx` (the follow behaviour).

## Concrete Steps

Every command runs on the wave's build VM against the pushed head, through the wave's helper as the build brief gives it: `vmcheck.sh ux-wave/U1a -- '<command>'`. Its exit status is the command's; never pipe it without `set -o pipefail`. The worktree on the MacBook has no `node_modules` and stays so.

1. **Take master.** In the worktree:

       git fetch origin master && git merge origin/master

   Merge, never rebase or force-push. Then confirm step 0 is in: `test -f src/shared/keymap/build-f.ts && test -f src/shared/sessions/working-folder.ts`. If either is missing, stop and hand back: M3 and M4 need them.
2. **Per milestone.** Write the tests of "What it proves" first and push them with the milestone's first commit. For M1 that commit is run on the VM before anything else changes: the reader tests call the readers (not the new predicate), so they compile on today's tree and fail there by assertion, and the tree test fails on today's imports; that red run, recorded in Progress, is A17's "fails on today's tree". Then build, commit, push, and run on the VM:

       vmcheck.sh ux-wave/U1a -- 'pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       vmcheck.sh ux-wave/U1a -- 'pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       vmcheck.sh ux-wave/U1a -- 'pnpm exec eslint <the paths changed>'
       vmcheck.sh ux-wave/U1a -- 'pnpm exec vitest run <the test files touched>'

   Expect exit status 0 and vitest's `Test Files  N passed (N)`. M5 moves the wire: after raising `WIRE_MINOR` with its comment, regenerate the manifest on the VM and bring its diff back, since nothing can be generated on the MacBook:

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
| U8b | `waitsOnAnswer` over `selectPendingOf` for the waiting-requests card's presence (its line in `Summary.tsx`, unedited); `selectWaitingAgents` for "Approval needed", which `tools/agents/subagents/AgentList.tsx` and the Subagents card may call in place of the set they build today (equal to it from M1 on) | UC-9 |
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

**A terminal session's request, in each of its two list holders.** A request is *listed* while the bridge's state holds it in `pending`; MAWS's answer is *accepted* when `laneA.answer` returns `delivered` (the bridge's 200, or the act's `done` on another machine). The holder keeps, per session, the requests whose answer was accepted and when.

| the request is | event | becomes | the list |
|---|---|---|---|
| absent | a fresh state lists it | waiting | told with it |
| waiting | a fresh state no longer lists it (the bridge settled it) | absent | told without it |
| waiting | MAWS's answer is accepted | hidden; its grace ends `STREAM_GRACE_MS` (5 s) later | told without it, at once |
| waiting | an answer returns `not_pending`, `refused` or `unknown` | waiting | unchanged |
| hidden | a fresh state no longer lists it | absent; the mark is forgotten | unchanged |
| hidden | a fresh state lists it, before the grace ends | hidden | unchanged |
| hidden | the grace ends while the last fresh state lists it; or the first fresh state after the grace lists it | waiting; the mark is forgotten | told with it again |
| hidden | the grace ends while the state is not fresh | hidden until the next fresh state, which decides by the two rows above | unchanged |
| any | the bridge is no longer live, or the session leaves | absent; every mark of the session is forgotten | as today |

The stream's own rule stays beside it: a state that is not fresh for `STREAM_GRACE_MS` clears the session's list. The linearization point is the holder's own update: the accept, a state and the grace's end are applied one at a time there, and the list told after each is a function of the marks and the last fresh state. The marks and the function live in one pure module, `src/shared/lane-a/accepted.ts`, which both holders use; its clock is passed in. The spine's holder is told of an accept by the driver in its own process (`src/services/lane-a/driver.ts`, where `answer` returns `delivered`); the window's holder by the session's port (`session/controls/lane-a.ts`, same point). The accept is told for a session on another machine only to the window that answered (decision 3).

**The digest.** A terminal session driven through its bridge reads `phase: 'waiting'` and `pendingRequests: n` from the requests its list holds as waiting and that are not asynchronous questions, in place of the length of the bridge's `pending`. So an open asynchronous question, or an answer the bridge has accepted and not yet settled, leaves the session reading `working` while its turn runs.

### §C. The card after an answer, and what docks (M1, M2)

The card (`RequestCard`) draws nothing when its own answer was delivered and when its item's state is `delivered`. A failed write keeps the card with "Couldn't deliver the answer" and Retry. No text "Answered · …" is drawn anywhere. `VariantProps.submit` keeps its second argument for the bodies hosted outside the card; the card no longer draws it.

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

The broker writes a named mode as `updatedPermissions: [{ type: 'setMode', mode, destination: 'session' }]` beside the allow, and refuses a mode outside `PLAN_NEXT_MODES` (the item stays pending). With no `mode` it writes today's response.

**The label.** With `prePlanMode` known: "Implement · <its label>" (`PERMISSION_MODE_LABELS`), and the press sends no `mode`. With it null: "Implement", and the press sends no `mode`. **The menu** lists the modes of `PLAN_NEXT_MODES` in `MODE_OPTIONS`' order, without the one on the button; an entry reads "Implement · <label>" and sends that mode.

| route | button | menu |
|---|---|---|
| a session MAWS runs on this Mac | names the earlier mode when known | yes |
| a terminal session | "Implement" | no: the bridge carries allow and deny, never a mode (`answerIntent` refuses an answer that names one) |
| a session another machine runs | names the earlier mode when its status gives it | no (Reported, 2); the port's `answerCapability` closes a plan answer that names a mode, and the endpoint refuses one |

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
| 400 | `refused`, `bad-args`, the bridge's sentence | stays; "Couldn't deliver the answer", Retry |
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

`diff` is drawn by the transcript's `EditDiff` (`cell: null`) under a capped height with "Show all". `input` is drawn as today's old and new text, as removed and added lines without numbers. The first line of the card follows: `create` reads "Create <name>"; `update` reads "Edit <name>"; `input` reads "Write <name>" for the Write tool and "Edit <name>" otherwise. The path under it is relative to `useWorkingFolder(appSessionId)?.path` when the file is inside it, whole otherwise, and whole in its title. `ToolPreview` keeps its props and draws the fallback.

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
| `mode` on a plan answer (`session.answer`; the wire's minor rises by one) | only when the person picks a mode from the menu, on a session MAWS runs on this Mac | an engine host of F serving this build's window drops the key (the tolerant reader) and restores the earlier mode; an endpoint of F is never sent it (no menu) | F never sends it | nothing is stored |
| the bridge's decision body `{behavior: 'dismiss'}` | only to a bridge whose status declares `decide.dismiss` | F never sends it; a bridge before 1.47.0 is never sent it | — | nothing is stored |
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
| a plan: implement in a chosen mode | `session.answer` with `mode` | no menu | no menu (Reported, 2) | no menu |
| reading the file for the diff | `files.read` | `files.read` by the session's record; the fallback when refused | the offer `files.read` | none: the fallback |
| a notification's Allow once and Deny | main, through `session.answer` | no notification (ruled) | no action (the section) | no notification |
| the hover card's Allow once and Deny | by the port | by the port | by the port | by the port where that machine's feed lists the item; the window's own mirror feeds the pane alone |
| the trust card | a step of a send; the same body in the remote setup sheet | — | — | — |

No act of this landing needs a new offer. Two could take one later, as insertions in U9's files by U9's rule (its Interfaces, "How a later child inserts an offer"): a plan's mode over the link, and a dismissal of a terminal's asynchronous question on another machine, which also needs the daemon's `decide` to name a dismissal (`apps/desk-hub/src/protocol/rpc.ts`) and the plugin's RPC to accept it.

### §M. Consumed from siblings

- **U6a** (`…-U6a-keymap.md`, on master before this branch builds): `ActionSpec` and the row rules (its Interfaces §A); `effectiveChord` for a hint; `BUILD_F_ACTION_IDS` and `isRebindable` (a new row is not rebindable and needs nothing); its §G ("For a child that adds a key after this landing"): the two rows go where the menu should show them, which for `menu: null` rows is beside the rows they extend; its §E, whose `WAVE_DEFAULTS` already hold this landing's four chords.
- **U8a** (`…-U8a-working-folder.md`, on master before this branch builds): `useWorkingFolder(appSessionId): WorkingFolder | null` (`src/renderer/src/sessions/working-folder.ts`), its `path`, for the relative path of §I.
- **U3a** (`…-U3a-arrivals.md`, parallel): nothing. It removes one branch of `src/services/attention/service.ts` (its insertion in this child's file); the two changes do not meet. Its `answer` class is U1b's to read.
- **U8b** (`…-U8b-column-and-tabs.md`, parallel): nothing. It reads §A as master exports it and follows M1 without an edit (its §C.1 and §C.6).
- **U9** (`…-U9-other-machines.md`, parallel): nothing but the rule for an insertion in `src/endpoint/offers.ts` (an `accepts` on an existing row, with a row test at the endpoint).
- **U13a** (`…-U13a-one-strip.md`, parallel): nothing; no key is stored, so its coverage table gains no row.
- In the tree: `EditDiff` and `Hunk` (`src/renderer/src/transcript/`), `MODE_OPTIONS` (`statusline/mode-menu.ts`), `PERMISSION_MODE_LABELS` (`src/shared/sessions/permission-mode-labels.ts`), `readTolerant` (`src/shared/ipc/tolerant.ts`), `fast-diff`.

### §N. Insertions in files other children own (UC-8)

| file | owner | the insertion |
|---|---|---|
| `src/shared/keymap/actions.ts` | U6 | two rows after `request.decline`; the titles of `request.accept` and `request.decline` (§D) |
| `src/renderer/src/settings-tab/KeymapSection.test.tsx`, `settings-tab/keymap.test.ts` | U11, U6 | the expected titles and ids of the request rows |
| `src/endpoint/offers.ts` | U9 | the row `session.answer` gains `accepts`: a plan answer that names a mode is refused for a caller on another machine; its row test |
| `src/renderer/src/sidebar/RequestPreview.tsx` | U7 | `isOpen` becomes `waits`; nothing else (its approval rule, never drawn in the app, stays) |
| `src/renderer/src/shell/floating.test.ts` | U10 | one case's expectation: a delivered item is no longer "still pending" |
| `e2e/` specs of other children's surfaces | each surface's child | the substitutions of M7, nothing else in the scene |

No file under `src/renderer/src/transcript/`, `src/renderer/src/composer/` outside `docked/`, `src/renderer/src/sidebar/HoverCard.tsx`, `src/renderer/src/tools/agents/` or `src/renderer/src/main/` is edited.

## Proof that an executor does not run

Each line has an owner other than an executor. The executor's hand-back says which lines' preconditions are met.

| what | when it can start | what it needs | what comes back |
|---|---|---|---|
| **The Electron e2e groups**, on a Mac under the load rule | after M7 is pushed | The new and reworked scenes alone first: the new scenes of `requests.spec.ts`, `lane-a.spec.ts` and `sessions.spec.ts` (M7), and `c7-shots.spec.ts` run on purpose (`MAWS_HARNESS=1 pnpm exec electron-vite build && MAWS_C7_SHOTS=1 MAWS_ENGINE_REPLAY=1 pnpm exec playwright test e2e/c7-shots.spec.ts`), which gives the pictures of the cards and the measured height. Then the groups that hold a spec M7 edited: `e2e:requests`, `e2e:composer`, `e2e:lane-a`, `e2e:tools`, `e2e:to-human`, `e2e:side`, `e2e:panel`, `e2e:layout`, `e2e:agents`, `e2e:browser-comment`, `e2e:remote`, `e2e:supervisor-daemon`, `e2e:design-systems`, `e2e:voice`, the default `pnpm e2e` (for `sessions.spec.ts`), and the groups whose specs call `allowNext` (`deliverables`, `design-export`, `dashboard-export`, `document-standalone`, `presentations-export`) | Verdicts by group. A red scene comes back as a fix |
| **Two `-live` specs** (a real engine; no gate runs them) | with the groups | `composer-live.spec.ts` (it approves and keeps a plan) and one spec that allows a permission through the card, on a Mac with a signed-in engine | That the substituted gestures answer a live engine. The other `-live` edits stand on review |
| **The cross-build run with F as the peer** | after M7 is pushed | `scripts/ci-gate.sh "$PWD" --gates e2e:cross-build --peer f1852de3a --label u1a-xb`, in the background; Actions budget for one run. It stores no key of this landing: it is run because its update and downgrade scenes answer a request across the two builds, which §K's first and third rows change | The run's id and its scenes named as run. A skipped scene is not evidence |
| **The real bridge's dismissal** (A18; §G) | the disabled state: any time after M2. The enabled state: once sminos 1.47.0 can be installed (its pull request merged, or its branch installed into a scratch config home) | A Mac, a scratch config home, one interactive terminal session with the sminos plugin, one asynchronous question put by the agent (invented text). *Disabled:* on the plugin as installed today, the form's Dismiss is disabled and reads "Dismiss it in the terminal". *Enabled:* on 1.47.0, press Dismiss in MAWS | *Enabled:* the terminal's row reads dismissed; the bridge's stream carries `settled` `withdrawn` by `maws`; MAWS's card leaves at the press and the session's row stops reading "Question waiting"; after the next prompt the transcript holds the delivery. A difference from §G's tables comes back as a fix |
| **The notification's buttons on a signed build** (A14) | with U14's sitting check "l1-sessions-08" | A signed build of this branch; a prompt for a short command and one for a file change raised with the window in the background | Whether "Allow once" and "Deny" show and act. If a signed build does not show action buttons, the buttons wait on that defect and the rest of M6 lands |
| **A probe for more modes on a plan's allow** (only if the architect rules to widen `PLAN_NEXT_MODES`, Reported 3) | any time | The probe harness on engine 2.1.322, as `findings-uxwave-u1-plan-next-mode.txt` ran it: an allow naming `auto` from a session that was in `default` before Plan, with auto available and with auto refused; an allow naming `bypassPermissions`, in a session launched with and without leave to bypass | The session's mode after each, and what the engine sends when it refuses. Each mode that passes joins the constant |
| **The owner's look** | — | None is asked before this landing is built. The section fixes the card line by line and the owner accepted it in words; in this landing the card still stands in the docked frame, which U1b removes. The drawn example worth the owner's time is U1b's, the card at the transcript's end, and it carries this card's content. The architect looks at `c7-shots`' pictures after M7 | — |
| **The branch review** | after M7 | `doperpowers:review-code`, the xhigh panel, over `origin/master...ux-wave/U1a`, with one lens on §A (does any reader outside the engine host still decide "waiting" by itself) and one on the endpoint's guard and the outside actions (is each checked where it runs) | A verdict and findings; the fixes are one wave |
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

Row 6's sentence is not the child's: the child's says "a skip of every question and a decline still send nothing", which decision 7 and §G's fifth correction make inexact. The architect confirms the wording with Reported 7. Rows 1, 2, 4 and 5 are the child's sentences as written. The placement's two sentences (l4-approvals-08 at charter §13 X4 and C7's "Placements"; O-17 at E1's M4b) are U1b's.

**Logged as debt** in `docs/tech-debt-tracker.md` by M7, each a row with its reason: a dismissal of a terminal's asynchronous question on another machine is not carried (it needs the daemon's `decide` and the plugin's RPC to name a dismissal); a plan's next mode is not offered for a session another machine runs (an insertion in U9's files); `PLAN_NEXT_MODES` holds only the two modes the check ran; a second window showing the same terminal session on another machine keeps an answered card until the bridge settles it; a refusal's sentence shows only as the title of "Couldn't deliver the answer"; a dismissal whose delivery was still held when its session ended comes back on resume (the plugin's); the sidebar's fallback preview keeps the read-only rule. Which of these becomes a ticket is the architect's.

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
- Observation: across a build gap, a key the reader does not know is dropped, not refused.
  Evidence: the header of `e2e/cross-build.spec.ts` ("one that lacks an event or an object key drops it (the tolerant reader, logged once)"); `src/shared/ipc/tolerant.ts`.

## Decision Log

- Decision: verification for this landing. This document gets an adversarial review before an executor starts, dispatched by the architect. The branch gets `doperpowers:review-code` at the xhigh panel. Class 1a on GitHub Actions is the gate of record, run once on the head the pull request carries.
  Rationale: the panel by size and by stakes. The change is expected at about sixty files and three thousand changed lines with its tests, past the panel's threshold of twenty files or two thousand lines. And it defines UC-1, which eight children bind to, adds a guard on what a caller on another machine may send in an answer, and lets a notification deny or allow a request with the window in the background. A single reviewer was the alternative; it is the rung for a focused diff, which this is not.
  Date/Author: 2026-11-12, the author of this document.
- 2026-11-12: written against the code at `48619c824` and the spec at `06727e32a`. Seven points reported to the architect; their defaults are built until ruled.

## Outcomes & Retrospective

Pending — written at finish.

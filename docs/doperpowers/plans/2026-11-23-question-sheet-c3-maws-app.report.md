# Question sheet C3, landing C3a (M1 to M3): execution report (2026-11-24)

Execution document: `docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md` (child C3 of `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`, parent pin `5f53131c5`). Branch `question-sheet-c3`. Run through doperpowers:subagent-driven-execution: one executor per milestone (opus), one task reviewer per milestone, fixes resumed on the executor. Status: **DONE**. Pull request #879, for the composite's writer's branch review; not merged.

## Range and head

- Commits: `df76e098f..cb5bcfe61`, with master merged in twice: `0424db990` (master `760d7ad1a`, the composite's revision) and `6521b436c` (master `5fc0bb8aa`, #852 and #877). M2's executor also merged master `dc864b948` in `91f87acfd`.
- The gates ran on `96b7b5eb9`. `cb5bcfe61` adds one line to the plan's Progress (the pull request's number) and nothing else.

## What landed, by milestone

| milestone | commits | review | gate on the reviewed head |
|---|---|---|---|
| plan, before M1 | `5ee01767a` (§B to §D corrected to the pin), `b2850154c`, `b91197e94` | n/a | n/a |
| M1, the pin and the model | `11cc1259f`; fixes `07c389961`, `d5b09d5c7` | clean after 2 rounds | class 1a, run 45369925862 |
| M2, the service and the wire | `75c86a570`, `550c267f7`; fixes `da0255b93`, `245423f9c` (built on a side branch while M3 ran, then cherry-picked) | clean after 2 rounds | static, unit, probes, e2e:lane-a, e2e:supervisor-daemon, e2e:cross-build, run 45390151242 |
| M3, the components (X5) | `55b0cb7b7`, `b535695a1`; fixes `68726b745`, `c496b78cb`, `1607745d7`, `e28ea1b6e` | clean after 3 rounds | static, unit, probes, e2e:desk-web, run 45409302136 |
| landing | merge `6521b436c`, plan `96b7b5eb9` | n/a | static, unit, probes, e2e:lane-a, e2e:supervisor-daemon, e2e:desk-web, e2e:cross-build, run 45412938027 |

The combined head before master's second merge (`d2436f373`) was also green, run 45402719247.

## Differences between the pin and the plan

Read from the set's diff `9f4860205..2594002af` and from M1's port. Each is corrected in the plan.

1. A queued `sent` entry is discriminated by kind. An answer or a dismissal carries `id`, a retract `target`, a `delivered` line neither (§B).
2. A lone surrogate in a `state.json` string is printed as U+FFFD (§B).
3. An unlocked reader can glimpse a short write or a rollback, so an inbox that shrinks counts as a change (§C).
4. `sheet put`'s results are not `SheetSent`s. They are `{key, state: 'queued'}`, or the bridge's verdict under its own name (`applied`). They are typed `SheetPutEntry` (§B, §E).
5. For "Outcome not known yet." no ids are drawn, a revise's included (the grammar's rule, §B).

## Rulings and decisions written into the plan

Each is in the section it belongs to, and "For the composite's writer" items 10 to 12 list what changes the composite's text.

- **The composite's writer's additions for C4, built as ruled:**
  - `SpineRoot.sheet`;
  - `body` serves any well-named upload;
  - the locator's rule holds inside the service;
  - the signature check sits in `upload`;
  - `SheetOverviewProps.hrefOf`;
  - the link policy is the exported predicate `sheetLinkAction`;
  - `ReferenceView` draws an image from the host's bytes as a `data:` URL;
  - each card's root carries `data-sheet-question`;
  - the hidden line takes its header from memory.
- **The controller's rulings:**
  - A Send the door answers `refused`, `no-sheet` or `unavailable` releases its hold (accepted by the writer).
  - A refused Markdown link carries no navigable destination, through an optional `link` component of `Markdown`.
  - `SessionSheetProps.onMemory` takes an update applied at commit. This is an X5 change for C4.
- **From the task reviews:**
  - The first record is announced within a second.
  - Nothing is located or run for a `put` without a record.
  - The door's exit 0 is checked against the session and the keys.
  - A read is never held back by the probe.
  - The store lists again at every host connection.
  - The door's moves reach windows as unchanged-summary `sheet.changed` events.
  - The door's bound holds against a child that ignores SIGTERM.
  - A record's identity and its unreadable reasons are fixed sentences.
  - A Send records the very drafts its lines were built from.
- **For C6:** `sheet.list` is refused remotely as `no-target`, not `no-rule`.
- **The wire:** `WIRE_MINOR` is 65: tail-first took 63 and prestart 64 on master.

## Tests

- Each milestone's focused suites ran on this machine one file group at a time:
  - M1: 112 tests.
  - M2: 46 files and 820 tests at build time; 117 across its six covering files after the fixes.
  - M3: 287 under both renderer projects, plus desk-web's 2 and the shared sheet's 104.
- The full suites ran only on GitHub Actions, in the runs above.
- The real door was checked by hand against sminos taken by `git archive` of `2594002af`. It printed what Concrete Steps says: `put` answers `queued`, and `show` on a session with no sheet exits 3.

## Not done, and why

- **The `#sheet` harness page was not seen by eye.** Local Electron was not run: the machine was loaded (load averages 17 to 42), and local Electron is ruled out on the owner's laptop (UC-10). The built look is M6's.
- **Pictures of the built components** (the writer asked for them if cheap) were skipped. desk-web's app mounts no `R/sheet`, and the harness has no Mac-lane case that photographs it.
- **No whole-branch review was run.** The brief leaves it to the composite's writer.
- **M4 to M6 were not started**, as the brief says.

## The branch review's wave (after the first return)

The composite's writer's branch review of #879 (medium) returned seven findings; all were fixed in one wave by M3's executor (`e53946b44`; then `c88e62ee7` for three findings of the wave's own task review, by a fresh reviewer, clean after that round):

1. `put` refuses an existing `inbox.jsonl` that is a link or not a regular file (`refused`), and only `ENOENT` reads as absent.
2. One Send at a time is decided by the shared memory: a press prepares its call, and the host is called once the memory holds that attempt.
3. A stale verdict keeps a newer answer.
4. Field edits are updates. This is an X5 change: `QuestionCardProps.onDraft(update)`. A card behind a rewrite never rewrites a newer draft.
5. A first observed `retracted` retires the sent draft.
6. `put` holds lines to `SheetLineSchema` and writes the parsed snapshot.
7. `targetsOf` is a `Map`.

Shipped with, from the wave's review: a reservation that a deferred consumer commits after the session's last sheet unmounted waits until a sheet of that session is shown again.

Master `bfe82b411` (prestart, #880) was merged in afterwards; `WIRE_MINOR` 65.

## Unresolved review findings

These are carried into the pull request's section of that name:
- `body`'s cached-model window;
- confinement by path with no `openat`;
- a recreated root falls back to the 2 s poll;
- the door's pipes are not destroyed at its deadline;
- `QuestionCardProps.busy`'s stale comment;
- a reservation committed after the session's last sheet unmounted waits until the sheet is shown again (the branch review wave's own review).

## Environmental friction

- The full node typecheck runs out of memory on this machine. The gate's `static` covers it.
- The secret scan read an invented fixture key (`maws-fixture-0009`) as an API key. It was renamed (`maws-k-0009`).
- The manifest needed a rebase when M1's reference schema was rewritten.
- To run M2's fixes beside M3's executor, they were made in a separate worktree on a temporary branch and cherry-picked. The temporary branch is deleted.

## Residue

1. **sminos `show` prints fields its own schema refuses** (doperpowers, C2). At `2594002af`, `model()` copies `id` and `target` from any queued inbox line that has them, and the show schema's closed queued variants refuse them. MAWS projects by kind. No fixture holds such a line.
2. **Pictures of the built components before M6.** A small harness case on the Mac lane would give the owner a first look at M3, the carried draft's card first, before C3b.

# Landing C3b, M4 and M5 with the built look's pictures: execution report (2026-11-27)

Run through doperpowers:subagent-driven-execution, continuing the controller's run above, from master `386028383`. Each milestone had one executor (opus) and one task reviewer, with fixes resumed on the executor. M6's live gate was not started: it waits on C2.G2 in doperpowers. No whole-branch review was run, and no pull request was opened (the brief).

## Range and head

- Commits: `43c95d3c3..be2edec5c` on `question-sheet-c3`, master `b65a1e175` merged in at `7dae81a6c`.
- The final gate ran on the pushed head `be2edec5c`; its run id is below.

## What landed

| part | commits | review | gate |
|---|---|---|---|
| refresh, before M4 | `43c95d3c3` (parent pin to `e6a07c35e`, the writer's list trimmed) | n/a | n/a |
| M4, the side sheet, the waiting card, the items | `7b0898665`, `3966b1bc1`, `0c3893379`, `4daa71c25`; fixes `cf868a163`, `4609b9802`, `f5db347c2` | clean after 2 rounds | run 45470212254, green but lane-a's mini copy (X-168, see below) |
| M5, the row's lines and receipts | `c91e48011`, `2aecf2075`, `af4cdc412`, `eddee6700`, `7932da929`, `49685844c`, `699bac4f8`; fixes `6832adbd5`, `ccba46b1f`, `7a888a0ab`, `9e689d0a2` | clean after 1 round | run 46053751902, all green |
| lane A's reshaper race (pull request #882, cherry-picked, then folded by the merge) | `3ca14e4fc`, `b491fbf89`; merge `7dae81a6c` | #882's own review (the composite's writer) | at #882's head: runs 46044133874, 46044222157, 46051964590 |
| the built look's pictures and the rig's launch 17 | `db8c870b5`, `4981e443e` | not task-reviewed (test and rig code only; the branch review reads it) | run 46061691137 |

## The writer's rulings built in this landing

- `questionSentence`'s rule is now one definition shared with C2's terminal row: full-width marks end a sentence, and the writer's eleven cases are in the tests.
- The channel's held sheet: held there only while an act is sending or carries a note. `selectSheetHeld` takes that as one argument.
- The queued card's sentence follows `live`. This added X5's optional `live` prop.
- The fork ruling: the record is laid over a row line only where its entry names that row's call.

## Decisions, by milestone

All are written into the plan's §C, §F, §H and §I.

- M4: `SheetService.verified`; the store's setter is an updater; `appSheetHost` takes the session; the tab's count is the strip's suffix ("Sheet · 3"); the compact sheet is held for what was sent; a focus request is used once per tab; a notice is resolved when pressed; and `e2e:panel`'s menu list names the Sheet.
- M5: master's `GroupRow` has no `renderBody`, so the row uses #852's classes directly; `SheetRowLine.revises`; the envelope is read before today's answer reader; a turn holding only the carrier counts as a turn.

## X-168

- The symptom: lane-a's X-168 and `:895` failed on the mini copy only.
- My first control run was mistaken. It was taken at `3863923cb`, which holds M4's first commits, not at a plain base. The investigator caught it.
- Plain master fails on the mini (`--lane no-hosted`):
  - `386028383`: 3 of 3 runs (46045126445, 46045210798, 46045293955).
  - `a873c6f25`: 2 of 3 for X-168 (46045169950, 46045251728, 46045334890).
- The cause is a race in lane A's driver, which predates the sheet. When a bridge closed, the stream's 500 ms reopen cleared the reshaper before any snapshot came, so the final "agents exited" body reached no watch.
- The fix is #882, master `0e903ea7c`, which also clears the condition the landing's architect had set.

## Pictures

They are in `~/.local/share/question-sheet/built-look/`, from run 46061691137, at 1440 x 900 in the light theme:

1. `1-carried-draft.png`: a card rewritten under a draft, with "Updated", the dashed carried pick, "You wrote this before the question changed." and "Keep my answer".
2. `2-needs-you-calm.png`: the sidebar's Needs you row for a session whose waiting items are all sheet questions, in the calm info tone.
3. `3-row-at-rest.png`: "Asked 3 questions" with three lines (id, header, sentence, Open).
4. `4-row-receipts.png`: the same row as receipts: `q1 Auth method → OAuth`, "Dismissed", "Withdrawn".
5. `5-side-sheet.png`: the side sheet "Sheet · 3" open at q2, with the keyboard on its card.
6. `6-waiting-card.png`: "Waiting for you" with the sheet's three lines, a subagent's among them.
7. `7-row-forms.png`: "Asked 2 questions" (Revised below), "Revised q5, q6", "Nothing done" with its note, and "Did not change the sheet" with its error.
8. `8-refused-send.png`: a refused Send's "Not sent: …" note, with Send offered again.
9. `9-queued-stopped.png`: a stopped session's queued answer, with Take back, Edit and the row line's "queued".

Seen while shooting, and worth the owner's eye:
- Only the Needs you row is calm. The project row's mark and the toolbar badge for the same session stay in the warning tone, which is L5 as written.
- "from reviewer" is cut almost to nothing at the waiting card's default width.
- The card the side sheet opened at shows no focus ring.
- A card rewritten in the record alone, with no revising call, keeps the old wording in the transcript's row line (a scripted state only).

## Strings added, for the owner's look

- M4: none beyond "from <agent>", which the composite quotes.
- M5, all in §I's list:
  - "Queued. The session has not picked it up yet." (the writer's, provisional)
  - "Open q7" (Open's accessible name)
  - "Nothing done"
  - "Changing the sheet"
  - "Outcome not known yet"
  - "Did not change the sheet"
  - the list forms "Revised q5, q6" and "Withdrew q6, q7"
  - the carrier's notice in today's answer words, "answered: q7, q8; dismissed q9"

## Gates seen red on the mini and not this change's

- lane-a `:204`, a bridgeless terminal's holder, at load 12: run 46045119581.
- panel `:1285`, the floating card, where toasts intercept the bar's click: merge head run 46058186543 (its rerun was cancelled when the final run superseded it).
- transcript `:3304`, zoom and follow: run 46061691137.
None touches sheet code, and each passed on the hosted lane in the same run.

## Unresolved review findings, for the landing's pull request

- From C3a (carried over): `body`'s cached-model window; confinement by path with no `openat`; a recreated root falls back to the 2 s poll; the door's pipes are not destroyed at its deadline; `QuestionCardProps.busy`'s stale comment; a reservation committed after the session's last sheet unmounted waits until the sheet is shown again.
- M4, notifier.ts ~L175: a question queued at the app's start and later taken back, whose latest call was a revise, announces that call once (in-app only). It is rare and cosmetic.
- M4, stores/sheet.ts ~L150: a late paste reply after the record's removal can recreate that session's memory (memory.ts ~L214). The orphan is harmless until the record returns.

## Left for M6

- The live steps 1 to 8 on a Mac with C2.G2: a real terminal session, the real sminos, the two-window barrier in front of the real command.
- One recorded transcript, scrubbed.
- The tracker's five rows.
- The pictures again from the landing's head if anything drawn moves.
- The landing's pull request, with this report's findings and residue.

## Environmental friction

- No Mac could run the rig, so the pictures came from asserting e2e cases through `--evidence`.
- The mini lane is loaded, and three unrelated cases failed on it once each.
- ci-gate's master runs add no mini copy (the spec is unchanged against the peer), so measuring master on the mini needed `--lane no-hosted`.

## Residue

1. **Calm tone beyond the Needs you row.** The project row's mark and the toolbar badge stay in the warning tone for a session whose waiting items are all sheet questions (picture 2). Whether L5's calm reaches them is the owner's call.
2. **Focus ring on the opened card.** The side sheet opened at a question gives no visible sign of which card holds the keyboard (picture 5).
3. **Mini-lane flakes** in lane-a `:204`, panel `:1285` and transcript `:3304`, each seen once at load. They are worth a CI-opt look if they recur on an unloaded mini.

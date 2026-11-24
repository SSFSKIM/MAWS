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
- **The wire:** `WIRE_MINOR` is 64, since tail-first took 63 on master.

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

## Unresolved review findings

These are carried into the pull request's section of that name:
- `body`'s cached-model window;
- confinement by path with no `openat`;
- a recreated root falls back to the 2 s poll;
- the door's pipes are not destroyed at its deadline;
- `QuestionCardProps.busy`'s stale comment.

## Environmental friction

- The full node typecheck runs out of memory on this machine. The gate's `static` covers it.
- The secret scan read an invented fixture key (`maws-fixture-0009`) as an API key. It was renamed (`maws-k-0009`).
- The manifest needed a rebase when M1's reference schema was rewritten.
- To run M2's fixes beside M3's executor, they were made in a separate worktree on a temporary branch and cherry-picked. The temporary branch is deleted.

## Residue

1. **sminos `show` prints fields its own schema refuses** (doperpowers, C2). At `2594002af`, `model()` copies `id` and `target` from any queued inbox line that has them, and the show schema's closed queued variants refuse them. MAWS projects by kind. No fixture holds such a line.
2. **Pictures of the built components before M6.** A small harness case on the Mac lane would give the owner a first look at M3, the carried draft's card first, before C3b.

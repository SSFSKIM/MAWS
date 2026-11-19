# U6b-4b: execution report (2026-11-19)

Execution document: `docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md`. The record is in its Progress, Decision Log 9 to 16, Surprises, and Outcomes & Retrospective. This report is the account of the hand-back. The per-milestone executor reports and review packages are in the worktree's gitignored `.doperpowers/sde/2026-11-18-ux-wave-U6b-4b-links/` (`task-1-report.md` to `task-5-report.md`, `progress.md`).

## State

Branch `ux-wave/U6b-4b`. Commits run from `8e703698c` to the head that carries this report. A fresh executor built each milestone, and each was task-reviewed until clean. The branch review, class 1a, the desk-web e2e and the Mac scenes are ux-wave's. I ran no ci-gate, opened no PR and started no Electron.

| milestone | commits | review |
|---|---|---|
| Rulings (DL 9) | `8e703698c` | — |
| M1, the rule's gaps and the `file:` form | `8e703698c..4382edc5c` (two fix waves) | ux-wave's ruling closed the loop after the doubtful-marker case; U1 and U2 went to board ticket 776 |
| M2, relative paths and dead chips | `d34bbd505..2774d2ef8`, fix `8de807e3c` | clean |
| merge of `daf06d208` (b5-union, with U6f) | `f0449461e` | conflicts in `FileViewer.tsx`, `viewer.test.tsx` and `service.test.ts`, resolved as unions; M1 and M2 sets re-run green |
| M3, the notice | `f0449461e..1ccfb8a2f`, fix `4bb0e73f5` | clean; one finding deferred to a tracker row (Copy path's feedback duplicates U8's `LogTool.tsx`) |
| M4, localhost | `445c610c2..4c3b85cdb`, fix `b8bc1d229..3a23650e9` | clean |
| M5, the sentence, the scenes, the record | `53d0acfd9..a17cedfbc`, fix `7d282084c` | clean |

## Verification (all on the build VM through vmcheck)

- **M1** at `4382edc5c`:
  - 926 tests pass across shared/files, services/files and markdown. The two named suites pass 520, with both differentials green.
  - The meter's worst case is 36.4 per character (the bound is 64). The measurement takes 2.0 s, with the worst list call at 19 ms.
  - Both tsc projects and eslint pass. desk-web passes typecheck, build and 797 tests.
- **M2:**
  - At `8de807e3c` the M2 directory set passes: 382/382 files, 7,211 tests. The web tsc and eslint are clean.
  - The node tsc passes at `7a3c83f74` (my run). desk-web passed at `2774d2ef8`.
- **After the merge,** at `f0449461e`: both tsc projects pass. The M1 set passes 4,077 tests and the differential 258. The M2 set passes 8,070.
- **M3** at `4bb0e73f5`: the M3 set plus `transcript/` passes 510 files and 10,190 tests. desk-web passes 801.
- **M4** at `3a23650e9`: the M4 set passes 4,445 tests. The new suites pass 65 under Node 22. desk-web passes 801.
- **M5** at `a17cedfbc`:
  - `pnpm typecheck` (all six projects) exits 0. eslint on `e2e` and `src/shared/maws` is clean.
  - The gate's script tests pass 588/588, `maws-app-scan` 8/8, and the maws tests 171.
  - At `7d282084c` the e2e tsc, eslint and the script tests are green again.
- **The whole unit suite,** once, at `a17cedfbc`: 12 of 2,911 files failed (49 of 47,391 tests), in 2,556 s.
  - Four fail the same way at the base `53d0acfd9`: git-reads and setup (board ticket 756), portability (the VM's Node; a tracker row is now added), and the desk-hub deploy files (the VM has no hub).
  - Seven timing-listed files pass alone.
  - One is on no list: `src/artifacts/document/editor/suggestions.dom.test.tsx`, "the typing pause". It failed once under load, while another executor's whole suite ran on the same VM, and passed alone 42/42.
- **L15:** `git log --no-merges --first-parent --oneline eb7f378ee..HEAD -- src/shared/ipc | wc -l` prints `0`. `wire.test.ts` passed in the whole suite.

**Not verified:** the Mac scenes. They are written and typecheck, but none has run.

## Scenes to run on a Mac (§G)

- `e2e`: `sessions.spec.ts`, the outside-file case, plus two new cases (a transcript loopback link and a terminal loopback link).
- `e2e:code`.
- `e2e:remote`: a new case beside G7, plus the "M3: a dev server" step clicked again with ⌘.
- `e2e:side`: case 5.
- `e2e:cross-build`.
- `e2e:terminal`: once, unchanged.

No spec file was added.

U6f's two assertions (`remote.spec.ts` near line 4727, `cross-build.spec.ts` near line 4302) pass unedited: the update sentence reaches the classifier's row 7 (`said`) and is drawn as the headline.

Three assumptions of the scenes were checked by reading the code only: A holds B's record; the `/btw` card reopens with its exchanges; xterm's hover class marks a hovered link.

## Decisions beyond the document (Decision Log 10 to 16)

The ones ux-wave should check against the design:

- **M1:** a table inside a container names nothing. A list line that cannot interrupt a paragraph is placed by its column; where the column cannot be read, nothing is named up to the next blank line. The row-16 regression fix stays, as ruled.
- **M2:** a shown Markdown file's base is read at the click. A side thread's questions open for the thread's own id.
- **M3:** Retry checks the entry again just before its read. Copy path says when it failed. "Open externally" words its failure when it draws.
- **M4:** each opener branch tests its own machine. An id that is not an address is left to the surface; this corrects M4's first writing.
- **M5:** the Browser scene runs in the app. The receipt and `127.0.0.2` have no scene. The remote notice has its own case.

## Contradictions with the document or the child's file

- N1.15's control, as written, was prose to both readers. Its table is corrected (DL 10).
- §D's order of branches is now a machine test in each branch (DL 14; §D revised).
- None beyond those, and what Decision Log 7 to 9 already rule (P7, the terminal session on another machine).

## Friction

- The harness forced two interim hand-backs while executors waited on VM runs. I kept later waits in the foreground.
- Auto mode first blocked the merge of `daf06d208`. An appeal citing ux-wave's instruction cleared it.
- The merge commit `f0449461e` carries git's default message without the session line. Fixing it needs a force-push, which the document forbids.
- vmcheck's ssh dropped twice on long runs. Writing the log on the VM recovered both.

## Residue

- **Board ticket 776** (ux-wave registered it): make the named-link rule parse with the window's own micromark/mdast. It holds U1, U2 and every divergence found.
- **The tracker rows M5 added:**
  - P10's two faults; P11, P12 and P14.
  - ⌘ on a path link in plan cards and question sheets.
  - Loopback links outside a transcript.
  - The differential: its seeded direction is static only, and the lone carriage return costs it about a seventh of its seeded strings.
  - Copy path's duplicated feedback.
  - `PushState.test.tsx`'s stray error.
  - The `LinkForwarder` comment.
  - A successful save leaving the notice up.
  - `portability.test.ts` under the VM's Node.

  The drill-in row of 2026-11-13 now points at U6b-4c.
- **U6b-4c:** the two links, one inside a shown Markdown file and one in a subagent's transcript. The owner has two questions for its design.
- **The build brief's timing list:** add `suggestions.dom.test.tsx`, "the typing pause".

# DC5 (the web: projects and the conversation): controller's report, interim (2026-10-15)

The plan's execution under doperpowers:subagent-driven-execution was stopped mid-run by a forced hand-back, so this report is interim. When this was written, M4's executor was still running in the worktree. Its task id is `a222e4e70b19f83c5`, and its ledger entry is `Task 5`.

- **Plan:** `docs/doperpowers/plans/2026-10-15-desk-dc5-web.md`. Its Progress, Decision Log, and Surprises sections are current.
- **Ledger:** `.doperpowers/sde/2026-10-15-desk-dc5-web/progress.md`. It is gitignored and holds every base, head, and agent handle.
- **Branch and range:** `smns-erb-web`, from f4f2d4cb. The last controller commit is 2af4fbc6; M4's commits follow it.

## Milestones

| Milestone | State | Commits | Evidence |
| --- | --- | --- | --- |
| M1 | ticked: shell, hub client, DX8 | d11548ec, 258d486d, merge 76e81d67; fix 16e3aaff | 39 to 43 unit tests; e2e 7/7; Linux lane 38726419036; local hub (`e2e:hub`) 4/4 |
| M2 | ticked: key derivation, enrollment, holder lifecycle | 15512882, 4dceb368, e70579e1; fixes 0c6f7986, 762c8811, 43862481, f621436c | unit and component tests |
| M2b | ticked: wrapped org key, the owner's ruling | eb8b710c, 49d8c13f, 3024c702; fix 3a541856 | Linux lane 38763206762, 38763858201, 38764331969; local hub (first setup, `not-key-holder`, add and remove, enroll) |
| M3 | ticked: conversation and actions | MAWS cut 5bd20087, mockups d985d03f, 275eded7, merge edf9dea7, 0519e99e, 43d623b6, ca4fe8b2, aff4dbdb; fixes 24a0d407, merge f5f1f16b, 55248421, 6d0aa147, 4084c0d8 | 165 unit tests; Linux lane 38770854963, 23/23 |
| M4 | in flight: PWA, service worker, push, bundle split, phone mockup, the owner's walk | after 2af4fbc6 | none yet |

## Still owed

- **Proofs against the real hub.** These run as one task:
  - M1's grid counts must update within 2 s;
  - M3's G2 clauses must be shown against DC3's M3 routing at the local hub (b7fc7ebd is fine for early runs; run them once DC3 ticks M3);
  - M1 and M3 must be shown against DC3's fake machine, once DC3's M4 lands.
- **M4's review.** It also needs the owner's verdict on the phone mockup and the owner's walk: the first real setup in Safari and Chrome on the Mac, then the iPhone after DC3's M5 deploys.
- **The whole-branch review** at xhigh, through doperpowers:review-code. It is to be handed up to the composite's writer's session.
- **Outcomes & Retrospective** in the plan, and the pull request.

## Deferred minor findings

These are reasoned but unfixed, for the PR's Unresolved Review Findings section:
- `apps/desk-web/src/views/key/KeyDialog.test.tsx:117-121`: the test waits a fixed 50 ms before asserting that no POST happened. An explicit completion signal would be sturdier. Non-blocking, because the guard in production is correct.
- Vite warns about the oversized chunk (main chunk 1.5 MB). This is assigned to M4's bundle split.
- `pause-take-over.pty.test.ts` fails in the root suite. It is a known load flake, tracked in `docs/tech-debt-tracker.md` (row dated 2026-10-14).

## Environmental friction

- The harness's worktree-isolation guard refuses `with-slot.sh` and compound `cd … && git …` commands. Heavy suites moved to the gate's Linux lane, and the owner accepted that. M3's executor ran four heavy commands plainly before the ruling; they are listed in `task-3-report.md` and were sent to the writer.

## Residue

None registered yet. Candidates for the final report: the settled permission cards that live only in the tab after a reload (permission prompts are not log events), and the module gap for a late decision's `winner` and `terminalOnly` (`src/hub/protocol-ahead.ts`).

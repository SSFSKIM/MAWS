# Question sheet C4, the local page: execution report

Execution document: `docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md` (child C4 of `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`). Branch `question-sheet-c4`. Run through doperpowers:subagent-driven-execution: one executor per milestone, a task review at each milestone, fixes resumed on the executor. The session that holds the composite released each milestone. This report covers landing C4a, milestones M1 to M4. M5 (landing C4b) follows C4a's merge.

## State

| milestone | commits | task review | gates on the reviewed head |
|---|---|---|---|
| M1, the page server: who is let in | 8f32955f1..015aedc45 | clean after 3 fix rounds | class 1a (run 45393061801); `e2e:supervisor-daemon`, `e2e:daemon-unit`, `e2e:lane-a` (run 45395661843) |
| M2, the page's shell, shipped and paired in a browser | 8a86f26cb..62fb12100 | clean after 2 fix rounds | static, unit, probes, `e2e:sheet-page` (run 45416302873); every M1 and M2 gate on 8833313df (run 45420269641) |
| M3, sheets through the page server, and the registration | 397d6dd82 (merge of C3's landing), 75a7c0c53..386eff67e | clean after 2 fix rounds | static, unit, probes, `e2e:sheet-page` (run 45464842931); `e2e:lane-a`, `e2e:supervisor-daemon` on 9bfdf1980 (run 45457079959) |
| M4, the overview and the sheet on the page, and the outline | 67ed00c3b..8f3cc9091 | clean after 4 fix rounds | static, unit, probes, `e2e:sheet-page` (run 46071441809); `e2e:transcript`, `e2e:desk-web` on 75dafdc22 (run 46044016943) |

The controller's own commits touch the execution document and this report only. The decisions and discoveries of each milestone are written into the document: §J to §Q, T19, T22, T28 and T29, and "Outcomes & Retrospective".

## What the reviews found and the fix rounds repaired

- **M1:**
  - the first address served before the second bind was decided;
  - an aborted body could still revoke;
  - an unsaved or unreadable revocation read as done;
  - eviction and expiry left live sockets paired;
  - a non-ASCII code returned 500;
  - a test launcher could turn the page on through inheritance;
  - `daemon.status` read a file;
  - refusals were proven by `admit` alone.
- **M2:**
  - the bearer was not bound to the pairing the connection had proven;
  - Unpair hid an unsaved revocation;
  - recovery specs passed without a reconnection;
  - the rig's scratch environment could be overridden.
- **M3:**
  - a snapshot could survive the spine's loss;
  - a hold could be stranded by an early disconnect;
  - the registration's confinement was incomplete, and its stop could hang;
  - the discovery wake mixed generations.
  - Before review, one fact the document stated proved false: the wake resolved before the holders were folded. It was fixed by a second signal that only `mawsd`'s wake awaits.
- **M4:**
  - lazy chunks could load from a stranger on the port, directly and through their static imports;
  - Send came back between `paired` and `ready`;
  - a tab with an older model could prune or rewrite a newer tab's entries;
  - a Send's identity was keyed by its first line;
  - an upload could write after Unpair;
  - rule 4 stopped at the DOM.

## The landing

Master `d697dfaa0` was merged in cleanly at `9b8f10c21`. Every gate the landing names is green there: static, unit, probes, `e2e:sheet-page`, `e2e:transcript`, `e2e:desk-web`, `e2e:supervisor-daemon`, `e2e:daemon-unit` and `e2e:lane-a` (run 46074066415). Pull request #886 is open (Part of #869).

## Confusions

None of substance. One thing confused the executors briefly: the document's `CREDENTIAL_KEY` line is shown as a redaction placeholder in tool output, while the file itself holds the intended key.

## Residue

- **The coverage advisor follows imports, not build entries.** `scripts/ci-gate-e2e-specs.mjs` advises `e2e:sheet-page` only for a change to a module the page's suite imports at run time. A change to `handler.ts`, `pairing.ts` or `checks.ts` is not advised, because the suite runs the built `mawsd`. The Electron groups have the same limit.
- **Flaky tests outside this branch.** Each reddened a gate once and passed on rerun: `TestExitIsTerminalForOutput` in the Go session host (run 45411518792, rerun 45414473116); the engine-host prestart cleanup and org-recovery timing unit tests (run 46044016943, rerun 46048377325).

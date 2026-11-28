# Question sheet C4, the local page: execution report

Execution document: `docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md` (child C4 of `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`). Branch `question-sheet-c4`. Run through doperpowers:subagent-driven-execution: one executor per milestone, a task review at each milestone, fixes resumed on the executor. The session that holds the composite released each milestone. This report covers landing C4a, milestones M1 to M4. M5 (landing C4b) follows C4a's merge.

## State

| milestone | commits | task review | gates on the reviewed head |
|---|---|---|---|
| M1, the page server: who is let in | 8f32955f1..015aedc45 | clean after 3 fix rounds | class 1a (run 45393061801); `e2e:supervisor-daemon`, `e2e:daemon-unit`, `e2e:lane-a` (run 45395661843) |
| M2, the page's shell, shipped and paired in a browser | 8a86f26cb..62fb12100 | clean after 2 fix rounds | static, unit, probes, `e2e:sheet-page` (run 45416302873); every M1 and M2 gate on 8833313df (run 45420269641) |
| M3, sheets through the page server, and the registration | 397d6dd82 (merge of C3's landing), 75a7c0c53..386eff67e | clean after 2 fix rounds | static, unit, probes, `e2e:sheet-page` (run 45464842931); `e2e:lane-a`, `e2e:supervisor-daemon` on 9bfdf1980 (run 45457079959) |
| M4, the overview and the sheet on the page, and the outline | 67ed00c3b..8f3cc9091 | clean after 4 fix rounds | static, unit, probes, `e2e:sheet-page` (run 46071441809); `e2e:transcript`, `e2e:desk-web` on 75dafdc22 (run 46044016943) |
| C4a's branch review: its fix wave | 6f8538fe4..439aa5b01 | clean after 4 rounds | static, unit, probes, `e2e:sheet-page` on each round's head (runs 46084125759, 46087517733, 46089416172, 46091346905); the landing's whole set on 9b37f1b5e (run 46092529981) |

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

### The branch review (high rung, 2026-11-27)

It returned fifteen findings, and the composite's writer sorted them. Eleven were fixed in one wave, each test-first:

- **On the server:**
  - S1: a static file's bytes are held once.
  - S2: a response its peer stops taking is ended after `stallMs`.
  - S3: a write checks its pairing again before its mutation.
  - S4: a remote `daemon.status` drops the page's address.
  - S5: the holders are refreshed every `refreshMs` while a page is open.
  - S6: the proof's MAC covers the origin.
- **In the page:**
  - B1: reconcile's removals are judged against the raw stored memory as it was when the read started.
  - B3: nothing is written on a model that is not fresh, which every end of the connection now causes.
  - B4: Unpair acts on the pairing on screen, under one deadline.
  - B5: a proven connection's revocation resets the store.
  - B6: storage running out undoes nothing durable, and a Send is put only once it is stored.

The wave's task review took four rounds, and every later round was on the page's memory and connection edges. Rounds 2 and 3 each caught a regression of the round before: a size cap that made valid Sends non-durable, and then a Send put after its storage failed. Four findings were shipped with and logged in `docs/tech-debt-tracker.md`. The relay is a stated limit (T28, board ticket 887). Dismissed with reasons, in the document's §J and §P:

- the stall watch's progress judged per 64 KiB slice;
- S5's effective period, about a minute through the discovery cache;
- S5's silent failure, which the client's `list` retry covers;
- the B3 upload exemption (T17).

## The landing

Master `d697dfaa0` was merged in cleanly at `9b8f10c21`. Every gate the landing names was green there (run 46074066415): static, unit, probes, `e2e:sheet-page`, `e2e:transcript`, `e2e:desk-web`, `e2e:supervisor-daemon`, `e2e:daemon-unit` and `e2e:lane-a`.

After the branch review's fix wave, the same set is green on `9b37f1b5e` (run 46092529981). Master had not moved. One `e2e:lane-a` case (`e2e/lane-a.spec.ts:197`) passed on its retry; this branch changes nothing that lane drives.

Pull request #886 is open (Part of #869).

## Confusions

None of substance. One thing confused the executors briefly: the document's `CREDENTIAL_KEY` line is shown as a redaction placeholder in tool output, while the file itself holds the intended key.

## Residue

- **The coverage advisor follows imports, not build entries.** `scripts/ci-gate-e2e-specs.mjs` advises `e2e:sheet-page` only for a change to a module the page's suite imports at run time. A change to `handler.ts`, `pairing.ts` or `checks.ts` is not advised, because the suite runs the built `mawsd`. The Electron groups have the same limit.
- **Flaky tests outside this branch.** Each reddened a gate once and passed on rerun: `TestExitIsTerminalForOutput` in the Go session host (run 45411518792, rerun 45414473116); the engine-host prestart cleanup and org-recovery timing unit tests (run 46044016943, rerun 46048377325).
- **C3's waiting map keeps a refused press's callback.** When the page refuses a press for want of storage (B6), the prepared callback stays in `src/renderer/src/sheet/attempts.ts`'s waiting map, with the lines it captured. It is released at that session's next launched Send or at a reload. The fix is C3's: drop the entry when a host refuses the press. This child leaves C3's components as they landed.

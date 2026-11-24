# Question sheet C4, the local page: execution report

Execution document: `docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md` (child C4 of `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`). Branch `question-sheet-c4`. Run through doperpowers:subagent-driven-execution: one executor per milestone, a task review at each milestone, fixes resumed on the executor. Milestones are released by the session that holds the composite. This report covers M1 and M2. M3 and M4 wait on C3's first landing reaching master; M5 waits on M4 and on C2.G2.

## State

| milestone | state | commits | task review | gates |
|---|---|---|---|---|
| M1, the page server: who is let in | done | 8f32955f1..015aedc45 | clean after three fix rounds | class 1a green on 015aedc45 (run 45393061801); `e2e:supervisor-daemon`, `e2e:daemon-unit`, `e2e:lane-a` green on 015aedc45 (run 45395661843) |
| M2, the page's shell, shipped and paired in a browser | done | 8a86f26cb..62fb12100 | clean after two fix rounds | static, unit, probes, `e2e:sheet-page` green on 62fb12100 (run 45416302873); `e2e:desk-web` green on 0adf502db (run 45404671143); the whole set re-run on the document head, see below |
| M3, M4 | blocked | | | waiting on C3's first landing on master |
| M5 | blocked | | | waiting on M4 and C2.G2 |

The controller's own commits touch only the execution document: 07f6e2a28 (pre-flight), 96d831662 and 43059c91c (the owner's answers and F9), a8a9de7ee (M1 as built), 8833313df (M2 as built).

## Pre-flight

Node checks header and request deadlines only at its `connectionsCheckingInterval` tick, which defaults to 30 s. Measured on Node 22: a stalled request under a 300 ms `headersTimeout` got its 408 at 305 ms with a 100 ms interval, 1004 ms with 1 s, and 5004 ms with 5 s. §J now sets the interval to 1 s, and `SheetPageTiming` gained `checkMs`.

## M1

What the task review found and the fix rounds repaired:

- The first address served requests while the second bind was still pending (T3).
- An aborted body could still revoke.
- Node's guard against a second response after headers were sent had been bypassed.
- A repeated or unreadable unpair could report success.
- Eviction and the 90-day expiry left live sockets paired.
- A non-ASCII code returned 500 instead of counting as a wrong try.
- `test/support/remote-bench.ts` could turn the page on through an inherited environment.
- Refusals were proven only through the pure `admit`, not by requests that were actually sent.
- After a fix: `daemon.status` read the browsers' file, and a live hello did not recover from an unreadable file.

Dismissed, with reasons: `static.ts` following a linked bundle root, or a file replaced after indexing. Only the same user can write that directory, which §8.2 does not defend.

Accepted: `Expect` is answered 417 before the Host check. The body is constant, so it tells a requester nothing.

The decisions are in the document: §J "As built in M1", §K and §L. The wire moves from minor 62 to 63 for three commands and one status field.

## M2

What the task review found and the fix rounds repaired:

- The HTTP bearer was read from storage beside a proof made for another pairing. `proven()` now answers the proven pairing itself.
- Unpair hid a revocation that was not saved. It now names three outcomes.
- The recovery specs could pass without the tab ever reconnecting. They now wait for a connection the daemon counts.
- The rig let an environment override replace its scratch homes.
- The coverage advisor could not read the page's `e2e` script.

The decisions are in the document: §P "As built in M2", the live client, and §Q.

Confirmed by building:
- T23's two facts hold.
- The page's MAC equals mawsd's.
- An impostor hears only hellos, in each of its five plays.
- A rebound name gets 421.

## Confusions

None. One reading surprised the executors. In tool output, the document's `CREDENTIAL_KEY` line shows as a redaction placeholder; on disk it holds the intended key.

## Residue

- **The coverage advisor follows imports, not build entries.** `scripts/ci-gate-e2e-specs.mjs` advises `e2e:sheet-page` only for a change to a module the rig imports at run time (`src/mawsd/sheet-page/headers.ts`). A change to `handler.ts`, `pairing.ts` or `checks.ts` is not advised, because the suite runs the built `out/main/mawsd.js`. The Electron groups have the same limit. Closing it means teaching the advisor to follow build entries.
- **A Go session-host test failed once in static.** `TestExitIsTerminalForOutput` failed in run 45411518792, on a commit that touches no Go file, and passed on rerun (45414473116). It looks like a flake worth a ticket if it recurs.

# P4-A2 pre-landing: the document-scale A/B on the mini (2026-10-20, 02:58Z to 03:22Z)

The question (the architect at P4-A2's hand-back): `e2e:document-scale` failed rows 1 and 2 on the branch at 696ca1331 under a clean posture (run 39353211814, job 118402039130: keystroke to frame p95 20.9 ms against 20; keystroke to presented p95 56 ms against 50; load 2.82), against the mini's master history of 16.8 and 17.2 ms. Treated as a regression of the typing path until an A/B showed otherwise.

The A/B, under DL 75's rule in CI-opt's quiet window (the flag raised 02:56:04Z; posture @2x, no Parsec, no screensharingd, no computer use, load 3.14 at the go), four runs of `scripts/ci-gate.sh <target> --gates e2e:document-scale --runner macos --class1a pool`, each waited on before the next was pushed, in the order A, B, A, B:

- A = `65143ebe4`, the master merged into the branch at 0d0192182 (so the difference is exactly A2's diff), from a throwaway detached worktree.
- B = `a8bd2ec45`, the branch's code head (the layer's keystroke path returns before any work while no layer is up).

| Run | Arm | Run id (job) | Row 1 p95 (bound 20) | Row 1 max | Row 2 p95 (bound 50) | Measured at load | Settle | Other rows red |
|---|---|---|---|---|---|---|---|---|
| a1 | A 65143ebe4 | 39361788220 (118429461353) | **21.1 ms** | 35.0 | **56 ms** | 2.48 | settled in 30 s; start load 2.06/3.18/3.36, release 2.03/3.07/3.31 | "5 first after read 1", "10 input p95" |
| b1 | B a8bd2ec45 | 39362350204 (118431217757) | **24.3 ms** | 37.1 | **56 ms** | 2.37 | settled in 31 s; start 1.88/2.58/3.03, release 1.94/2.51/2.99 | none |
| a2 | A 65143ebe4 | 39362898346 (118433001222) | **21.4 ms** | 35.9 | **56 ms** | 1.81 | settled in 31 s; start 1.96/2.40/2.83, release 2.30/2.44/2.83 | none |
| b2 | B a8bd2ec45 | 39363427263 (118434659347) | **21.6 ms** | 34.6 | **56 ms** | 1.92 | settled in 31 s; start 1.56/1.95/2.47, release 1.54/1.90/2.44 | "5 first after read 1" |

Every settle at `display=2560x1440@2x remote=none computeruse=none`, the front app the terminal (`postures.txt`; the rows' JSON per run beside it, `test-results/document-scale.json` as the spec wrote it; the job logs and the whole reports were left under `/tmp/p4a2/ab-mini/<label>/` on the MacBook for the bisect worker).

**The reading** (the architect's ruling, 2026-10-20): both arms fail both rows by the same margin; row 2 reads 56 in all four runs; row 1 reads 21.1 and 21.4 for A and 21.6 and 24.3 for B, and two runs per arm cannot tell a 1.7 ms mean difference from noise. With the idle path at a8bd2ec45 returning before any work, A2's cost is read as nil; master's drift (from 17 ms at de71da97a on 2026-10-19 to 21 ms now) goes to a separate bisect worker, and A2 lands with document-scale read as equal to master.

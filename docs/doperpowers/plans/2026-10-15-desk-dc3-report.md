# DC3 (the hub): controller's report (2026-10-16)

Plan: `docs/doperpowers/plans/2026-10-15-desk-dc3-hub.md`. Composite:
`docs/doperpowers/specs/2026-10-15-desk-design.md`, child DC3, pinned at blob
`f91bc631` and folded forward since. Branch `smns-erb`, which started at
269f5212; the head is 645a1557 and has been pushed.

## Update, 2026-10-16: the panel, its fix waves, and the redeploy

The branch's xhigh panel (wf_c388e070-28b, run by the composite's writer
on 645a1557) confirmed 13 findings, 2 of them P1. The fixes ran as two
waves:
- **Hub.** One executor fixed the eight hub findings in the shared
  checkout (b6bee9aa, a9dc048c, 3d87b957, 3e2697c7). It also fixed DC5's
  local close-latency report (0f2a6461) and browser-paged resume, a DX3
  ruling (895e27d1).
- **Fake machine.** The M4 executor worked in a separate worktree and its
  commits were cherry-picked: 2d691778, plus 3c45130b to match the real
  machine's `bad-shape`.

The joint re-review found one more defect, part-set metadata (36d6bae3).
It is closed, and the re-review is clean. The Linux gate is green on
36d6bae3 (run 38846390702).

The hub was redeployed with every fix, beside DC5's web build at
3de8a15e9: `X-Desk-Build: hub@b11ea5f8 web@smns-erb-web.3de8a15e`. The
owner's walk data in ssfskim was not touched. The PR to master is open.

## Status (at the close of execution, before the panel)

All five milestones are executed and reviewed clean by the subagent-driven
loop: one task-executor per milestone, a task review at each frontier, and
fixes resumed on the same executor. The branch's xhigh review is handed to
the composite's writer as a pinned range (base master, head 645a1557),
because only a main session can run the panel. The pull request to master
is opened after the panel converges.

| Milestone | Code commits | Fix commits | Gate (Linux) |
| --- | --- | --- | --- |
| M1 protocols, skeleton | 4c8d522e, d9a55462 | 140c834b | green d9a55462 (38714411388) |
| G1 amendment | 52875d3b | 29294260 | — |
| M2 enrollment, stand-in, log | e6bb0160, bd266073, 4d2c492f | 4de85ff9, b9e101ca; contract items 230716ae, c776caf5 | green 4de85ff9 (38736563386) |
| M3 session plane, push, org keys | 068f14f3, f167ca64, f22e0839, 4c0dd37e, d75f2924 | 72321d3a, b7fc7ebd, c23645b9, a190a6d8, eebc7c80, dabd37e8 | green 54a9c171 (38783679574) |
| M4 fake machine | c547aaa5, 01ba7519, 60bf893c | 8a9ad8e0, c100ed17 | green 8a9ad8e0 (38797084071) |
| M5 deployed, Access, G6 | 4b5d0a67, 2debd0f4, ea5ae36a, ebde4565, 83756611, 85e83830 | 90ace676, 7305d677, ff0a5407, a1ab1d16, 4495c41e | green 4495c41e (38836876171) |

Hub suite at the last local run: 316/316.

## Deployed

`https://desk-hub.opencognita-platform.workers.dev`, behind a scripted
Access application, build `hub@85e83830`, org `ssfskim`, with nothing
enrolled. Fix 90ace676 corrects the progress count that
`503 delivery-failed` reports. It is reviewed and waits for a redeploy that
the composite's writer schedules around the owner's phone walk.

## Where the record is

- The plan's Decision Log and Surprises & Discoveries hold every decision,
  ruling, and finding.
- The plan's Outcomes & Retrospective sets each of DC3's acceptance clauses
  against its evidence.
- The executors' reports, the interfaces drafts (`interfaces-M1` …
  `interfaces-M5`, frozen copies marked `-reviewed-<sha>`), and M5's
  evidence (`m5-evidence/`) are under
  `.doperpowers/sde/2026-10-15-desk-dc3-hub/`, which is gitignored. The
  composite carries everything those drafts said.

## Environmental friction routed around

- The session's worktree guard refused compound git commands and git
  commands aimed at a computed `-C` path. Plain, separate
  `git -C <path>` commands worked.
- The Mac's load stayed at 40–190 for hours and blocked local workerd
  runs. The gate's Linux lane (`ci-gate.sh --runner linux`) carried the
  full-suite evidence.
- The worktree guard refused a command that set `HOME`. The composite's
  writer ruled that M5's actual isolation complies: the temporary-`HOME`
  rule binds runs of sminos code.

## Residue

- The redeploy of 90ace676 (the composite's writer).
- Tech debt in `docs/tech-debt-tracker.md`: a reassembled part set has no
  joined-size cap, and `redeploy-check`'s cleanup wait has no overall
  deadline.
- The composite's Deferred: a re-measure of the phase-1 budget on a
  staging deployment, and the shared per-session stream if per-browser
  subscriptions come to dominate a machine's uplink.

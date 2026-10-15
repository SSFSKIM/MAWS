# DC3 (the hub): controller's report (interim, 2026-10-15)

This report is interim. The harness asked for a hand-back while M2's
executor was still running, waiting on its own background work (most
likely its `scripts/ci-gate.sh` run). Execution is not complete.

## State

- Plan: `docs/doperpowers/plans/2026-10-15-desk-dc3-hub.md`, parent
  pinned at composite blob `f91bc631` (re-pinned after the plan review).
- SDE ledger (gitignored):
  `.doperpowers/sde/2026-10-15-desk-dc3-hub/progress.md`. It holds the
  bases, heads, and agent handles a resume needs.
- **M1** is complete and reviewed clean (4c8d522e, d9a55462, fix 140c834b).
  The gate is green on d9a55462, run 38714411388. The Interfaces drafts
  are folded into the composite (cd818262).
- **G1 amendment** is complete and reviewed clean (52875d3b, fix
  29294260). It was re-folded into the composite (701f14d0).
- **DX1 strict base64url** is committed at e6bb0160. It has not had its
  own task review; it is reviewed as part of M2's package.
- **M2** is executing. Executor `aeea36f128e79eccd` has committed
  bd266073: enrollment as a durable state machine, the local stand-in for
  Access (`pnpm --filter desk-hub local`), the DX2/DX3 log plane, the
  audit record, and the web app's assets. It has not yet reported, so M2
  has no task review yet.
- **M3, M4, and M5** have not started.

## Decisions, owner rulings, discoveries

All of these are in the plan's Decision Log and Surprises & Discoveries:
- workers.dev as the hub's host;
- the M5 tokens, stored with project scope, and the team domain
  `flat-wave-208c.cloudflareaccess.com`;
- the plan-review revisions 1–6;
- M1 as built: vitest 5 driving Miniflare, codes, identifiers, transport;
- the numeric JCS fix;
- DC2's settlement answers;
- `block-row`;
- the G1 amendment;
- the M1 probe findings (an SSE stream held 11 minutes; WebSockets
  hibernate within 30 s).

## Next, on resume

1. Read M2's report at
   `.doperpowers/sde/2026-10-15-desk-dc3-hub/task-2-report.md` and fold it.
2. Review M2 with package `38249c52..<M2 head>`. Name the amendment's
   commits (already reviewed) and the composite commits in the range.
3. Send the composite's writer the M2 Interfaces from `interfaces-M2.md`.
4. Go on to M3, M4, and M5. The branch's xhigh review is handed to the
   composite's writer, not run here.

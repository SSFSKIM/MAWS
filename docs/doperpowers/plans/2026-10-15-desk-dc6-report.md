# DC6 (the web: session depth): controller's interim report (2026-10-15)

Status: **in progress, handed back early.** The harness required this
controller to hand back while M1's fix wave was still running. Nothing is
blocked. To recover, read the ledger and the spec's living sections.

## Where things stand

- Spec: `docs/doperpowers/plans/2026-10-15-desk-dc6-depth.md`. The parent is
  pinned to composite `8f7e09d3`. Later composite changes (`d349a87a`,
  `2ae6ac3a`, `cd2667d8`, `1cf94bd2`, `34ee27ca`, `24448038`, `2038124c`,
  `10b2d830`) are folded into its Decision Log and Surprises.
- Ledger: `.doperpowers/sde/2026-10-15-desk-dc6-depth/progress.md`
  (gitignored), which holds the bases, heads and agent handles.
- **M1:** built, `46382c26..ba48dcda`. The commits are ba2896bc, de64a655 and
  616fe5ee, plus ba48dcda after the merges of `smns-erb` (4e464576) and
  `smns-erb-web` (df8c8776, which brings DC5's renderer cut 5bd20087). The
  gate was green on the Linux lane in run 38757357541.
  - Task review 1 found two Important issues (`review-1.md` in the
    workspace). Live subagent metadata never reaches the backfill context
    that already exists. A reset that arrives during a rebuild reaches an
    unattached source, so stale rows are kept.
  - Fix wave 1 is **running** on the M1 executor (fix-base 29fa876a). It
    carries both findings and the writer's three additions: a lint rule
    forbidding `window.maws` in `apps/desk-web/src`; DX4 `step-end`, which
    drops the unsettled partial text of its step and has a test for a late
    `block-row`; and omitted thinking drawn as the collapsed indicator.
  - M1 is not ticked yet.
- **M2 (subagents)** and **M3** (diff, `usage`-based session info, the
  `transcript` slot's exclusive range through the Presenter, and the
  acceptance against DC3's fake machine) have not been dispatched.

## Next steps for whoever resumes

1. Wait for the M1 executor's fix report and append `fix-head` to the
   ledger.
2. Re-review by resuming the reviewer on the package
   `review-package <spec> 29fa876a <fix-head>`. The range also holds plan-doc
   commits.
3. Tick M1, then dispatch M2 and M3 in order.
4. Run the final `high` review through `doperpowers:review-code`, write the
   Outcomes, and open the PR.

## Messages already sent to the composite's writer

- The pre-flight checkpoint.
- M1's checkpoint: the screenshot at
  `.doperpowers/sde/2026-10-15-desk-dc6-depth/m1-depth.png`, the no-cut route,
  the Tailwind `@source` lines in DC5's `app.css`, and the contract items
  (the orphaned partial, which became `step-end`; omitted thinking; marks in
  depth; the enrollment flake).

## Known costs and minor findings carried

- The depth chunk is large because it carries xterm and mermaid. Vite warns
  of chunks over 500 kB (mermaid is 1,634.88 kB). This goes to DC5's M4,
  which measures load on the phone.

## Residue

None yet.

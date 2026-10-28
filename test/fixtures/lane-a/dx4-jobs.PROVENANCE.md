# sminos's DX4 jobs vectors, vendored

P5 O9 M5 (`docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md`, the Decision Log's derived-jobs entry): main derives a
local terminal session's background shells and monitors from its transcript by sminos's own rules
(`src/main/lane-a/jobs.ts`), and `src/main/lane-a/jobs.test.ts` replays these vectors' `jobs` against it.
`dx4-jobs.json` is copied here byte for byte, because the gate's runners have no sminos plugin cache to read it from.
Never edit it: copy it again from a later sminos and update this file.

`dx4-jobs.json` is a two-repo contract (doperpowers PR #430): sminos's plane, DC9's fake machine and MAWS all hold to
it. When it changes in doperpowers, re-sync this copy and the port it pins.

| File | Source | git blob | sha256 |
|---|---|---|---|
| `dx4-jobs.json` | doperpowers `sminos/tests/dx4-jobs.json`, sminos 1.27.8 (also 1.27.9) | `4ac5ea11a` | `46f6c6391025fd8531663f17ca9cbd4fbb37299bafba20c9e24371c1f6d278b3` |

The rules it pins are `sminos/skills/sminos/scripts/sminos_jobs.py` of the same version (sha256
`15fad1ee442151fa92c58b08a488823a7569906c6992e4f1d88ac813c5f956a9`): `Ledger`, `fold` and `derive`'s `jobs`
(`Ledger.jobs_body`). The port leaves out what the vectors' `subagents`, `mcp` and `outputCases` pin.

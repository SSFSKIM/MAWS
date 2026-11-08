# sminos's DX4 jobs vectors, vendored

P5 O9 M5 (`docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md`, the Decision Log's derived-jobs entry): main derives a
local terminal session's background shells and monitors from its transcript by sminos's own rules
(`src/services/lane-a/jobs.ts`), and `src/services/lane-a/jobs.test.ts` replays these vectors' `jobs` against it.
`dx4-jobs.json` is copied here byte for byte, because the gate's runners have no sminos plugin cache to read it from.
Never edit it: copy it again from a later sminos and update this file.

`dx4-jobs.json` is a two-repo contract (doperpowers PR #430): sminos's plane, DC9's fake machine and MAWS all hold to
it. When it changes in doperpowers, re-sync this copy and the port it pins.

| File | Source | git blob | sha256 |
|---|---|---|---|
| `dx4-jobs.json` | doperpowers `sminos/tests/dx4-jobs.json`, sminos 1.40.5 (commit `98bb6a61`, merge `e0b41515`, PR #477: case 17, several notifications in one row) | `f4f3bfc72` | `8cd71c9fa74cca5f5fbcf73cd0bfa2e65bb6f896abc38b61db96e2cc1b53baa6` |

The rules it pins are `sminos/skills/sminos/scripts/sminos_jobs.py` of the same version (sha256
`242352530fcbc5a9909d43b8e87125239c83869d2196865cffb51d4ce0c8081a`): `Ledger`, `fold` and `derive`'s `jobs`
(`Ledger.jobs_body`). The port leaves out what the vectors' `subagents`, `mcp` and `outputCases` pin.

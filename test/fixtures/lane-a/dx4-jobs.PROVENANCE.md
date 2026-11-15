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
| `dx4-jobs.json` | doperpowers `sminos/tests/dx4-jobs.json`, sminos 1.40.6 (merge `b0db15af`, PR #478; its rules from `4057f1d9` and `400632ce`: case 18, notices the engine queued; 1.40.5's case 17, several notifications in one row, before it) | `a414fd58d` | `930e1b82406b70200dadf9b31859e4fe6cd7f2c168d2965af0ae4be75c5e4666` |

The rules it pins are `sminos/skills/sminos/scripts/sminos_jobs.py` of the same version (sha256
`e5b89d9b9b9c74fafadd19b56b578abe1d7932543fe9a308438929b3687136f5`, read again for UX wave U8d M1 on 2026-11-15 and
unchanged): `Ledger`, `fold` and `derive`, its `jobs` (`Ledger.jobs_body`) and, since U8d M1
(`docs/doperpowers/plans/2026-11-15-ux-wave-U8d-terminal-subagents.md`), its `subagents` (`Ledger.agent_outcome`,
`derive`'s `entry`): `jobs.test.ts` replays every case's `subagents` and `jobs`. The port still leaves out what the
vectors' `mcp` and `outputCases` pin, an entry's `file` (the agent file's facts, which main does not read; the test
compares each expected entry without it), and `jobs_body`'s `also` (the main loop's words on a subagent loop's tasks):
main derives only the main loop's jobs. It reads one rule more widely than sminos does, by the architect's ruling (U8d
R9): every `<task-id>` of a notification block, where sminos reads the first. No block of these vectors names more than
one, so every expected body holds under either reading; the vector for a block naming several is owed, written by hand
from the rule once the engine's block is recorded.

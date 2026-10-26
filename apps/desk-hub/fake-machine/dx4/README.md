# DX4's shared vectors (vendored)

`dx4-jobs.json` is a verbatim copy of DC8's shared fixture for DX4's widened `subagents` body and its `output` answer,
from doperpowers `tests/sminos/dx4-jobs.json` at commit `717c5b0b` (main, 7.172.0: DC10's case 16, the
bridge's notes of tasks it stopped; sha256 `46f6c6391025fd8531663f17ca9cbd4fbb37299bafba20c9e24371c1f6d278b3`). DC8 owns it: it pins both producers, the plane
(doperpowers `skills/sminos/scripts/sminos_jobs.py`, run by `tests/sminos/jobs_parity.py`) and this fake machine
(`../jobs.ts`, run by `test/fake-machine/jobs-parity.test.ts`, which mirrors `jobs_parity.py`). Its `about` field is
normative where the composite's DX4 prose is open.

Never edit it here. When DC8 changes it, copy the new file over this one, update the commit and the hash above, and run
the parity suite; a case the fake machine fails goes to the composite's writer, not into a local edit of the vectors.

`routes-2.1.307.json` is a verbatim copy of the bridge's route table for engine 2.1.307 (the desk control surface spec,
`docs/doperpowers/specs/2026-10-22-desk-control-surface-design.md`, Interfaces, "The route table"), from doperpowers
`sminos/tests/routes-2.1.307.json` on `desk-ctl-mw2` (M1's catalog and form routes, and the MW2 review's refusal of
disabling every MCP server) (sha256 `45db152835659ed8d8db6625aee7f9b0d672a6337fd3f72e620bfc40695bf218`). doperpowers owns it: its bridge loads it
(`sminos/hooks/mods/bridge-commands.tsx`), and this fake machine routes a `command` RPC by it (`../routes.ts`, run by
`test/fake-machine/routes.test.ts`, which checks the hash above). Never edit it here either: when a probe moves a row,
copy the new file over this one and update the commit and the hash.

`mw1-reads.json` is a recording, not a copy of a doperpowers file: what the bridge answered in the machine-side wave's
MW1 live check (the desk control surface spec, Plan of Work, MW1; doperpowers `desk-ctl-mw1`, sminos 1.11.0, on Claude
Code 2.1.310 in an isolated profile behind a recording stub, zero inference) — its `GET /status` capabilities, with
`controls`, and its answers to `read usage` (summary, and `{breakdown: "full"}`), `read config`, `read settings` and
`read mcp`, the last with the plane's disabled server added (sha256
`4581b2405994b7dfb7bbaef3a1735fa6eb0f111750e6370471c224ac8688eb91`). The fake machine's `mw1` producer answers from it
(`../session.ts`, run by `test/fake-machine/desk-mw1.test.ts`). Never edit it here: a later read's shape change is
recorded again by that MW's live check, and replaces this file whole.

`mw2-ops.json` is a recording too: what the bridge answered in the machine-side wave's MW2 live check (the desk
control surface spec, Plan of Work, MW2; doperpowers `desk-ctl-mw2`, sminos 1.12.0, on Claude Code 2.1.310 in an
isolated profile behind a recording stub that answers the side question with a canned reply, zero inference) — its
`GET /status` capabilities (`btw` among the ops, `controls.btw` available), and a side question's answers and
events: refused `nothing-to-fork` before the session's first model request, and `started` when idle, its `btw` start
and end as the bridge's child relays them (sha256 `45c3de99fec4ddfe4c4464f4ebd5fd830b8d9b12474b2c16efdc45c9cff81c2d`). The fake machine's `mw2` producer answers from it
(`../session.ts`, `../machine.ts`, run by `test/fake-machine/desk-mw2.test.ts`). Never edit it here: a later
shape change is recorded again by that MW's live check, and replaces this file whole.

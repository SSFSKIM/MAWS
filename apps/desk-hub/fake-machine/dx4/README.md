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

`mw3-scoped.json` is a recording too: what the bridge raised, and what a scoped allow handed the engine, in the
machine-side wave's MW3 live check (the desk control surface spec, Plan of Work, MW3; doperpowers `desk-ctl-mw3`, sminos
1.13.0, on Claude Code 2.1.310 in an isolated profile behind a recording stub that returns each scripted tool call, zero
inference, devcloud's secrets guard loaded from the working copy over a fake store) — its `GET /status` controls
(`decide.scope` and `decide.addDirectory` available); three permission requests as the bridge's child relayed them, each
with the engine's suggestions, the scope a desk sends for it and the rule the daemon resolved through its own
`check_digest` (a rule as `session`, a rule as its own `localSettings`, a directory), each call run and the next one
unasked; and a request whose handle the guard beneath restored, raised without suggestions (sha256
`de127f800e7124936f910fac884f7797a0b4f167f73eaf77f017bdf6142da722`). The fake machine's `mw3` producer raises and resolves from it (`../session.ts`, `../machine.ts`,
run by `test/fake-machine/desk-mw3.test.ts`). Never edit it here: a later shape change is recorded again by that MW's
live check, and replaces this file whole.

`mw4-agents.json` is a recording too: what the bridge answered in the machine-side wave's MW4 live check (the desk
control surface spec, Plan of Work, MW4; doperpowers `desk-ctl-mw4`, sminos 1.14.0, on Claude Code 2.1.310 in an
isolated profile behind a recording stub that scripts the Agent call and keeps the subagent stepping, zero inference) —
its `GET /status` capabilities (`stop-agent` and `tell` among the ops and available among the controls); the background
agent's spawn as the bridge's child kept it in the tree; the answers to a stop by the Agent call's name, by an id, and of
a foreground agent, to a second stop of a stopped one, to a message and to an agent no tree holds; the text the agent
read at its next step, and the note its parent read at its next request (sha256
`a2358c441fdc5289037c5d198d5ff2a8ee61c2aace58b0300575221c312b7297`). The fake machine's `mw4` producer stops, tells and spawns from it
(`../session.ts`, `../machine.ts`, run by `test/fake-machine/desk-mw4.test.ts`). Never edit it here: a later shape
change is recorded again by that MW's live check, and replaces this file whole.

`mw5-media.json` is a recording too: what the machine answered in the machine-side wave's MW5 live check (the desk
control surface spec, Plan of Work, MW5; doperpowers `desk-ctl-mw5`, sminos 1.15.0, on Claude Code 2.1.310 in an
isolated profile behind a recording stub, zero inference, each RPC run through the daemon's own path and the bridge's
events relayed as DX4 `op`) — its `GET /status` capabilities (`media` among the ops and available among the
controls); an idle upload of a PNG and a PDF answered `queued` with its root and paths, and every `op` it sent, in
order (each attachment `read`, then `forwarded`, the last `phase: 'end'`); the ends of an upload whose Read the desk
denied (`failed`), of one whose first attachment Esc stopped mid-step (`aborted`), and of a claim a reload found
without a result (`indeterminate after reload`); the bridge's wake and prelude (sha256
`5c4c4a7d0911fc7c28affdccbb063373971a853bf52721d4806bb39e5808bf61`). The fake machine's `mw5` producer answers and
reports uploads from it (`../session.ts`, `../machine.ts`, run by `test/fake-machine/desk-mw5.test.ts`). Never edit it
here: a later shape change is recorded again by that MW's live check, and replaces this file whole.

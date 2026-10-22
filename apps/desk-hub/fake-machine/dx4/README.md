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
`sminos/tests/routes-2.1.307.json` at commit `9cdd2a2b` (sha256
`25de0d17d4f2f5844c9e7aaab9f0be0ba83eee7b64cc130bdab33ce01f8cdeee`). doperpowers owns it: its bridge loads it
(`sminos/hooks/mods/bridge-commands.tsx`), and this fake machine routes a `command` RPC by it (`../routes.ts`, run by
`test/fake-machine/routes.test.ts`, which checks the hash above). Never edit it here either: when a probe moves a row,
copy the new file over this one and update the commit and the hash.

# DX4's shared vectors (vendored)

`dx4-jobs.json` is a verbatim copy of DC8's shared fixture for DX4's widened `subagents` body and its `output` answer,
from doperpowers `tests/sminos/dx4-jobs.json` at commit `48f254aa` (branch `desk-dc8`; sha256
`c349c5b780fe8094e7418ab444ed7aba1c86777d03b569a659a10e617ea3ce48`). DC8 owns it: it pins both producers, the plane
(doperpowers `skills/sminos/scripts/sminos_jobs.py`, run by `tests/sminos/jobs_parity.py`) and this fake machine
(`../jobs.ts`, run by `test/fake-machine/jobs-parity.test.ts`, which mirrors `jobs_parity.py`). Its `about` field is
normative where the composite's DX4 prose is open.

Never edit it here. When DC8 changes it, copy the new file over this one, update the commit and the hash above, and run
the parity suite; a case the fake machine fails goes to the composite's writer, not into a local edit of the vectors.

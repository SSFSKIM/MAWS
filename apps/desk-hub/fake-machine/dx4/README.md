# DX4's shared vectors (vendored)

`dx4-jobs.json` is a verbatim copy of DC8's shared fixture for DX4's widened `subagents` body and its `output` answer,
from doperpowers `tests/sminos/dx4-jobs.json` at commit `b7511dd9` (branch `desk-dc8`; sha256
`351e799f70bdd917fee21005521f89ec7f9801123186b6c366cfdb554ed94547`). DC8 owns it: it pins both producers, the plane
(doperpowers `skills/sminos/scripts/sminos_jobs.py`, run by `tests/sminos/jobs_parity.py`) and this fake machine
(`../jobs.ts`, run by `test/fake-machine/jobs-parity.test.ts`, which mirrors `jobs_parity.py`). Its `about` field is
normative where the composite's DX4 prose is open.

Never edit it here. When DC8 changes it, copy the new file over this one, update the commit and the hash above, and run
the parity suite; a case the fake machine fails goes to the composite's writer, not into a local edit of the vectors.

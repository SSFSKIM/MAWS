# sminos's identity vectors, vendored

P5 O6 M5 (`docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md`, "The derivation"): MAWS derives an org
project's sminos id by sminos's rule, and `src/services/index/org-project.test.ts` and `src/shared/machine/project-ids.test.ts` hold it to sminos's own vectors. They are
copied here, byte for byte, because the gate's runners have no sminos plugin cache to read them from. Never edit them:
copy them again from a later sminos and update this file.

Source: the doperpowers marketplace's sminos plugin, version 1.15.0, as installed at
`~/.claude/plugins/cache/doperpowers/sminos/1.15.0/`.

| File | Source path in the plugin | sha256 |
|---|---|---|
| `remote-key.json` | `tests/remote-key.json` (written by `tests/remote-key.gen.py`) | `c0ddca057de150a08a3d20f037d3f7cdd252862db1b6d497b8501e187528f3d3` |
| `machine-project-id.json` | `tests/machine-project-id.json` | `4b56576031ad4da132e3f13f21396b63980786e680002ec70f09bd045d8769eb` |

The rule they pin is `skills/sminos/scripts/sminos.py` of the same version (sha256
`c1e16010ad20d5eb94bdf01ebea510190bafb163ce2cfb7bea09b299b65fa32a`): `parse_remote`, `remote_key`, `remote_name`,
`repo_project_id` and `machine_project_id`.

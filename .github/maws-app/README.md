# maws-app

The code of MAWS, a desktop workspace for AI agents, published so its macOS tests can run on GitHub's hosted Macs.

Development happens in a private repository. Each commit here is a copy of one private commit's tree, made by a
deterministic filter; its message names the source commit, the source tree and the filter version (`MAWS-Source`,
`MAWS-Source-Tree`, `MAWS-Filter`). A commit on a `ci/hosted/` branch asks for one e2e group's run on a hosted Mac,
and the run answers on the matching `ci/result/` branch; both are deleted once read. `main` follows the private
repository's landed work. This repository takes no issues or pull requests.

The instructions in `CLAUDE.md`, the charter and the plans assume the private repository's CI (`scripts/ci-gate.sh`,
the self-hosted lanes); here, only `.github/workflows/hosted-mac.yml` runs.

No license is granted: all rights reserved.

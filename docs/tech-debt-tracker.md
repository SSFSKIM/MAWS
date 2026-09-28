# Tech debt tracker

Real but non-blocking findings that were deliberately not fixed when found. Each entry names the owner child, the evidence, and what would close it. Items are removed when closed, with the closing commit noted in the charter's Decision Log if the closure changed a contract.

| Logged | Owner | Item | Evidence | Closes when |
|---|---|---|---|---|
| 2026-09-28 | C1 | The renderer echo test `src/renderer/src/App.test.tsx` is flaky under full-suite load: fails intermittently, passes in isolation and on the untouched base. | Reported by C5's executor during M1 on `worktree-agent-a3f9c764b1656a780`; reproduced on the C1 base with the full suite. | The test waits on the echo through a deterministic signal instead of a timing window, or moves to the Playwright smoke where the real IPC round-trip is observed. Owner: C12 finish, unless a wave-2 child touches the file first. |

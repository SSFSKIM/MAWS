# MAWS

MAWS (a codename) is a macOS Electron workstation for supervising Claude Code agent sessions: general at the base, with a small set of default, disableable application mods; owner-specific workflows as additional plugins. Two scenes carry equal weight: supervising many sessions, and going deep in one with IDE surfaces. Claude Desktop is the single benchmark, for UX quality and for engine integration (the same engine as ours; the owner's ruling of 2026-11-12, charter D-14). T3 Code stays a reference for source readability. MAWS reaches Claude Desktop's baseline first and adds its own UX on top. Codex desktop is no longer a reference; research that cites it stands as written.

The root spec is `docs/charter.md`: the approved design (§1 to §9) and the composite roadmap (§10 to §20) with children C1 to C12 and contracts X1 to X8. Every child artifact cites it by path, child id and parent pin. Research behind it is under `research/`; taste references under `mockups/`; engine fixtures under `spikes/protocol-probe/`. The readable source trees of the reference apps live outside the repo (Claude Desktop regenerated per build by `~/app-source-tools`; T3 Code a git clone at `~/t3code-src`); `research/SOURCES.md` says where they are, what each build directory contains (`MAP.md` first) and how to cite them.

Working rules:
- The engine is an unmodified, version-pinned Claude Code binary driven over its stream-json wire and control protocol; never patch it (D-1). Verify wire claims against `spikes/protocol-probe/fixtures/` or a new probe, not against the spec alone.
- Contracts X1 to X8 and decisions D-1 to D-20 are binding; a child that finds them wrong records a dated Decision Log entry in the charter rather than diverging.
- Execution documents live under `docs/doperpowers/plans/`, brief ledgers under `docs/doperpowers/ledgers/`, spike findings under `spikes/`.
- Light theme is the default; components use tokens only.
- Gates: typecheck, lint, the unit suite and the probes run on GitHub Actions through `scripts/ci-gate.sh <worktree> --gates static,unit,probes` (class 1a; `docs/doperpowers/plans/2026-10-14-gate-offload.md` §3.5; `--gates all` is the whole set, every Mac job on a macOS lane, and a call naming no gates is refused); Electron e2e groups, the macOS-guarded unit files listed there and every measured bound run on a Mac under the load rule.

# MAWS

MAWS (a codename) is a macOS Electron workstation for supervising Claude Code agent sessions: general at the base, the owner's own workflows as later plugins. Two scenes carry equal weight: supervising many sessions, and going deep in one with IDE surfaces. Three reference apps are complete implementation examples, each the best on one axis: Codex desktop for UX quality, Claude Desktop for engine integration (the same engine as ours), T3 Code for source readability. MAWS reaches their baseline first and adds its own UX on top.

The root spec is `docs/charter.md`: the approved design (§1 to §9) and the composite roadmap (§10 to §20) with children C1 to C12 and contracts X1 to X8. Every child artifact cites it by path, child id and parent pin. Research behind it is under `research/`; taste references under `mockups/`; engine fixtures under `spikes/protocol-probe/`. The readable source trees of the reference apps live outside the repo (Codex app and Claude Desktop regenerated per build by `~/app-source-tools`; T3 Code a git clone at `~/t3code-src`); `research/SOURCES.md` says where they are, what each build directory contains (`MAP.md` first) and how to cite them.

Working rules:
- The engine is an unmodified, version-pinned Claude Code binary driven over its stream-json wire and control protocol; never patch it (D-1). Verify wire claims against `spikes/protocol-probe/fixtures/` or a new probe, not against the spec alone.
- Contracts X1 to X8 and decisions D-1 to D-20 are binding; a child that finds them wrong records a dated Decision Log entry in the charter rather than diverging.
- Execution documents live under `docs/doperpowers/plans/`, brief ledgers under `docs/doperpowers/ledgers/`, spike findings under `spikes/`.
- Light theme is the default; components use tokens only.

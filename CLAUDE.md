# MAWS

MAWS (a codename) is a macOS Electron workstation for supervising Claude Code agent sessions: general at the base, the owner's own workflows as later plugins. Two scenes carry equal weight: supervising many sessions, and going deep in one with IDE surfaces. Codex desktop sets the interaction bar; Claude Desktop is the reference wiring of the same engine.

The root spec is `docs/charter.md`: the approved design (§1 to §9) and the composite roadmap (§10 to §20) with children C1 to C12 and contracts X1 to X8. Every child artifact cites it by path, child id and parent pin. Research behind it is under `research/`; taste references under `mockups/`; engine fixtures under `spikes/protocol-probe/`.

Working rules:
- The engine is an unmodified, version-pinned Claude Code binary driven over its stream-json wire and control protocol; never patch it (D-1). Verify wire claims against `spikes/protocol-probe/fixtures/` or a new probe, not against the spec alone.
- Contracts X1 to X8 and decisions D-1 to D-19 are binding; a child that finds them wrong records a dated Decision Log entry in the charter rather than diverging.
- Execution documents live under `docs/doperpowers/execplans/`, brief ledgers under `docs/doperpowers/ledgers/`, spike findings under `spikes/`.
- Light theme is the default; components use tokens only.

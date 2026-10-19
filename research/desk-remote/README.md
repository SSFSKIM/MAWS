# Research for the desk's remote protocol (MAWS #52) and the web-hosted MAWS (P5)

The research behind #52's protocol phase. Start with the synthesis, which states the target and the decisions #52 has to make, and links each report it rests on. It is in Korean; the reports are in English unless the name says `.ko`.

| file | what |
|---|---|
| [web-maws-remote-research.ko.md](web-maws-remote-research.ko.md) | **The synthesis.** The target (MAWS's features, Remote-Control-grade connectivity, many machines and viewers), what crosses the network, the machine endpoint, the trust design, the connection contract, the gaps in today's desk, the decisions with recommendations, and the spikes |
| [maws-web-porting-surface.md](maws-web-porting-surface.md) | The X2 registry (365 commands, 77 events), classified for remoting; the main-process residue; the E10 supervisor as a network endpoint; how it sits beside the desk's daemon and mod |
| [desktop-ssh-helper-protocol.md](desktop-ssh-helper-protocol.md) | Claude Desktop's SSH mode: the Desktop↔`claude-ssh` protocol, checkpoint replay, adoption, held sends, liveness constants, mapped against #52's four diagnosed failures |
| [remote-dev-prior-art.md](remote-dev-prior-art.md) | VS Code remote and tunnels, Zed, JetBrains, dev tunnels, Codespaces, real-time sync designs; 19 principles with evidence strength |
| [ahp-evaluation.md](ahp-evaluation.md) | Microsoft's Agent Host Protocol as the desk's protocol: coverage of a Claude Code session, the ecosystem, wire behaviour, maturity; verdict: adopt the mechanisms, not the protocol |
| [desktop-modes-main.md](desktop-modes-main.md), [desktop-modes-renderer.md](desktop-modes-renderer.md) | Claude Desktop's local, SSH, cloud and Remote Control sessions: what differs, and whether each difference is structural or a gap left unfilled |
| [claude-ai-rc-client-protocol.md](claude-ai-rc-client-protocol.md) | The client side of Remote Control in claude.ai/code and Claude Desktop |
| [rc-parity-research.ko.md](rc-parity-research.ko.md) | The earlier research against native Remote Control; its engine control surface (§3), performance analysis (§5) and claude.ai UX (§6) still hold, while the synthesis replaces its §4 and §8 |
| [remote-control-client-overview.ko.md](remote-control-client-overview.ko.md) | What the Claude Code 2.1.300 binary reveals about Remote Control |

Cites into vendor code name the build and point at extractions outside the repository (`research/SOURCES.md` says where they are and how to regenerate them): Claude Desktop `app-2.42304.0` under `~/claude-desktop-re/readable/`, the Claude Code 2.1.300 reprint under `~/claude-code-bundle/2.1.300/`. Links of the form `/Users/new/…` are paths on the owner's MacBook. MAWS cites are at `e42e6bbd8` or `48fec4bd1`, the desk spec at the commit each document names.

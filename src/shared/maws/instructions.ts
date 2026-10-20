// P4-B4 (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, "The instruction"; Decision Log 1, route (b); ledger
// X33): the `maws` server's MCP `instructions`, answered at initialize. The engine renders it to the model in every
// session that declares the server, which is every session MAWS launches (`sdkMcpServers: ['maws']`), so a session that
// never loads an artifact tool still learns the link form. Exact; it changes only by a dated line. A session keeps the
// paragraph it was first given across resumes (the spec's Surprise 2), so a change reaches new sessions only.
export const MAWS_SERVER_INSTRUCTIONS =
  "MAWS artifacts are the user's documents, presentations, designs, dashboards, html pages and files. When you name one to the user, write a Markdown link to it, [its title](maws-artifact:<artifactId>): a click opens it in MAWS, so the user never has to ask where it is. To open it at a place, add a fragment: #block=<blockId> for a document's block, #tab=<tabId> for a document's tab, #slide=<slideId> for a presentation's slide, #v<version> for a retained version, with the ids mcp__maws__artifact_read and mcp__maws__artifact_search return. Call mcp__maws__show_pane only when the user should see it now. To find an artifact you did not make or open in this session, call mcp__maws__artifact_search.";

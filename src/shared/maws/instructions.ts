// P4-B4 (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, "The instruction"; Decision Log 1, route (b); ledger
// X33): the `maws` server's MCP `instructions`, answered at initialize. The engine renders it to the model in every
// session that declares the server, which is every session MAWS launches (`sdkMcpServers: ['maws']`), so a session that
// never loads an artifact tool still learns the link form. Exact; it changes only by a dated line. A session keeps the
// paragraph it was first given across resumes (the spec's Surprise 2), so a change reaches new sessions only. UX wave
// U6d (O-44; the X9 amendment of 2026-11-14): the sentence that invited `show_pane` is gone, since the agent opens no
// artifact by itself; 635 characters, 64 fewer. UX wave U6b-4b (O-37; the X9 amendment dated 2026-11-12, landed
// 2026-11-18; docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, Interfaces §E): one sentence on file links is
// appended, which holds on every machine: a link to an absolute path opens a file inside the session's folders, and a
// file from anywhere else is delivered with send_file; 832 characters, 197 more. Board ticket 848 (the X9 amendment of
// 2026-11-23) retires `send_file`: the sentence now points every file at the path link and says what its click does;
// 917 characters, 85 more (with the sentence that keeps a file meant for the user inside the session's folders).
// Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, Interfaces §B): the paragraph is two constants,
// the artifact sentences (the first four) and the file sentences (the last two), so a session launched without the
// artifact tools is given the file sentences alone; MAWS_SERVER_INSTRUCTIONS stays their join, byte for byte.
export const MAWS_ARTIFACT_INSTRUCTIONS =
  "MAWS artifacts are the user's documents, presentations, designs, dashboards, html pages and files. When you name one to the user, write a Markdown link to it, [its title](maws-artifact:<artifactId>): a click opens it in MAWS, so the user never has to ask where it is. To open it at a place, add a fragment: #block=<blockId> for a document's block, #tab=<tabId> for a document's tab, #slide=<slideId> for a presentation's slide, #v<version> for a retained version, with the ids mcp__maws__artifact_read and mcp__maws__artifact_search return. To find an artifact you did not make or open in this session, call mcp__maws__artifact_search.";
export const MAWS_FILE_INSTRUCTIONS =
  "To show the user a file, write a Markdown link to its absolute path, [its name](/absolute/path): a click opens it beside the chat, and ⌘-click opens it in the main area. Write a file meant for the user inside this session's folders, where everyone who sees the session can open it.";
export const MAWS_SERVER_INSTRUCTIONS = `${MAWS_ARTIFACT_INSTRUCTIONS} ${MAWS_FILE_INSTRUCTIONS}`;

// U12a (docs/doperpowers/plans/2026-11-12-ux-wave-U12a-browser-computer-use-delivery.md, Interfaces §A; the UX wave's
// U12, l9-browser-delivery-01): the paragraph a session launched with MAWS's in-app browser as its backend is given after
// the first, so an agent drives the Browser pane itself rather than asking the user to click. Exact, under X9 and UC-15.
export const MAWS_BROWSER_INSTRUCTIONS =
  "This session has MAWS's in-app browser: the Browser pane, which the user watches and can take over. It is your browser too. With cua_repl's js tool, cua.getBrowser() with no id is this browser, so open, click, type, reload and check pages there yourself instead of asking the user to; use Chrome or another browser only when the user names it.";

/** The first paragraph (the file sentences alone for a session without the artifact tools, board ticket 421); for a
 *  session with a browser backend, then a blank line ("\n\n") and the second. The one place the paragraphs are joined: a
 *  later child's sentence goes into the constant it belongs to. */
export function mawsServerInstructions(session: { inAppBrowser: boolean; artifacts: boolean }): string {
  const first = session.artifacts ? MAWS_SERVER_INSTRUCTIONS : MAWS_FILE_INSTRUCTIONS;
  return session.inAppBrowser ? `${first}\n\n${MAWS_BROWSER_INSTRUCTIONS}` : first;
}

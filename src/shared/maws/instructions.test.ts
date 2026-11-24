// U12a (docs/doperpowers/plans/2026-11-12-ux-wave-U12a-browser-computer-use-delivery.md, M1; Interfaces §A): what the
// `maws` server's initialize answers, by whether the session was launched with MAWS's in-app browser as a backend. The
// first paragraph is pinned word for word in search-tools.test.ts; this file pins the second and the join.
import { describe, expect, it } from 'vitest';
import { MAWS_ARTIFACT_INSTRUCTIONS, MAWS_BROWSER_INSTRUCTIONS, MAWS_FILE_INSTRUCTIONS, MAWS_SERVER_INSTRUCTIONS, mawsServerInstructions } from './instructions';

describe('the maws server’s instructions, by what the session has (U12a, l9-browser-delivery-01)', () => {
  it('without a browser backend is the first paragraph, byte for byte', () => {
    expect(mawsServerInstructions({ inAppBrowser: false, artifacts: true })).toBe(MAWS_SERVER_INSTRUCTIONS);
  });

  it('with one is the first paragraph, a blank line and the second', () => {
    expect(mawsServerInstructions({ inAppBrowser: true, artifacts: true })).toBe(`${MAWS_SERVER_INSTRUCTIONS}\n\n${MAWS_BROWSER_INSTRUCTIONS}`);
  });

  it('the second paragraph, word for word', () => {
    expect(MAWS_BROWSER_INSTRUCTIONS).toBe(
      "This session has MAWS's in-app browser: the Browser pane, which the user watches and can take over. It is your browser too. With cua_repl's js tool, cua.getBrowser() with no id is this browser, so open, click, type, reload and check pages there yourself instead of asking the user to; use Chrome or another browser only when the user names it.",
    );
    expect(MAWS_BROWSER_INSTRUCTIONS).toHaveLength(343);
  });

  // UC-15: the wave's own bound on the instructions is 2,048 characters, half the engine's cut (probe 3)
  it('the second names no maws tool, and the whole stays within the wave’s 2,048 characters', () => {
    expect(MAWS_BROWSER_INSTRUCTIONS).not.toMatch(/mcp__maws__/);
    expect(mawsServerInstructions({ inAppBrowser: true, artifacts: true })).toHaveLength(1262); // U6d: 1,044 before O-44 took a sentence out; U6b-4b: 980 before the sentence on file links; board ticket 848: 1,177 before it stopped naming send_file and gained the sentence on the session's folders
    expect(mawsServerInstructions({ inAppBrowser: true, artifacts: true }).length).toBeLessThanOrEqual(2048);
  });
});

// Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, Interfaces §B; A1): the first paragraph is the
// artifact sentences and the file sentences, and a session with Artifacts off is given the file sentences alone.
describe('the first paragraph, by whether the session has the artifact tools (board ticket 421)', () => {
  it('is the artifact sentences and the file sentences joined by one space, the paragraph as it stood, byte for byte', () => {
    expect(`${MAWS_ARTIFACT_INSTRUCTIONS} ${MAWS_FILE_INSTRUCTIONS}`).toBe(MAWS_SERVER_INSTRUCTIONS);
    expect(MAWS_ARTIFACT_INSTRUCTIONS).toMatch(/^MAWS artifacts are the user's documents, .* call mcp__maws__artifact_search\.$/);
    expect(MAWS_FILE_INSTRUCTIONS).toBe(
      'To show the user a file, write a Markdown link to its absolute path, [its name](/absolute/path): a click opens it beside the chat, and ⌘-click opens it in the main area. Write a file meant for the user inside this session\'s folders, where everyone who sees the session can open it.',
    );
  });

  it('without artifacts is the file sentences alone, with no word of artifacts, before the browser paragraph as before', () => {
    expect(mawsServerInstructions({ inAppBrowser: false, artifacts: false })).toBe(MAWS_FILE_INSTRUCTIONS);
    expect(mawsServerInstructions({ inAppBrowser: true, artifacts: false })).toBe(`${MAWS_FILE_INSTRUCTIONS}\n\n${MAWS_BROWSER_INSTRUCTIONS}`);
    for (const inAppBrowser of [false, true]) expect(mawsServerInstructions({ inAppBrowser, artifacts: false })).not.toMatch(/artifact/i);
  });
});

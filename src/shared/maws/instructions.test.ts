// U12a (docs/doperpowers/plans/2026-11-12-ux-wave-U12a-browser-computer-use-delivery.md, M1; Interfaces §A): what the
// `maws` server's initialize answers, by whether the session was launched with MAWS's in-app browser as a backend. The
// first paragraph is pinned word for word in search-tools.test.ts; this file pins the second and the join.
import { describe, expect, it } from 'vitest';
import { MAWS_BROWSER_INSTRUCTIONS, MAWS_SERVER_INSTRUCTIONS, mawsServerInstructions } from './instructions';

describe('the maws server’s instructions, by what the session has (U12a, l9-browser-delivery-01)', () => {
  it('without a browser backend is the first paragraph, byte for byte', () => {
    expect(mawsServerInstructions({ inAppBrowser: false })).toBe(MAWS_SERVER_INSTRUCTIONS);
  });

  it('with one is the first paragraph, a blank line and the second', () => {
    expect(mawsServerInstructions({ inAppBrowser: true })).toBe(`${MAWS_SERVER_INSTRUCTIONS}\n\n${MAWS_BROWSER_INSTRUCTIONS}`);
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
    expect(mawsServerInstructions({ inAppBrowser: true })).toHaveLength(1044);
    expect(mawsServerInstructions({ inAppBrowser: true }).length).toBeLessThanOrEqual(2048);
  });
});

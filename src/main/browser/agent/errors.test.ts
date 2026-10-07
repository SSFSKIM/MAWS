import { describe, expect, it } from 'vitest';
import { BROWSER_ERROR_DETAIL_MAX_CHARS, BROWSER_ERROR_MAX_CHARS } from '@shared/maws/browser';
import { MawsBrowserAnswerResultSchema } from '@shared/ipc/schema/maws';
import { firstLine, refusal } from './errors';

// Main's error texts stay bounded whatever a page throws (the answer is journaled as `maws.browser.action`).
describe("main's error texts", () => {
  it("quotes an error's first line without Playwright's call name, cut at BROWSER_ERROR_DETAIL_MAX_CHARS", () => {
    expect(firstLine(new Error('locator.click: Element is detached\nCall log:\n  - waiting'))).toBe('Element is detached');
    expect(firstLine(new Error(''))).toBe('unknown error');
    expect(firstLine(`page.evaluate: ${'y'.repeat(5_000)}`)).toBe(`${'y'.repeat(BROWSER_ERROR_DETAIL_MAX_CHARS - 1)}…`);
  });

  it('never answers an error the host refuses: the whole text is cut at BROWSER_ERROR_MAX_CHARS', () => {
    const answer = refusal('z'.repeat(BROWSER_ERROR_MAX_CHARS + 50));
    expect(answer).toEqual({ ok: false, error: `${'z'.repeat(BROWSER_ERROR_MAX_CHARS - 1)}…` });
    expect(MawsBrowserAnswerResultSchema.safeParse(answer).success).toBe(true);
    expect(refusal('short')).toEqual({ ok: false, error: 'short' });
  });
});

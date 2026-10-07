// Main's refusals as the host writes them (E4c execution document, Design §2 and §11): every text is one of
// `BROWSER_TOOL_ERRORS` (or E4a's `navigationRefused`), formatted here in main from the same module the host and the
// normaliser read, and answered as `{ ok: false, error }`. A handler throws `BrowserToolError` with the text; an abort is
// not a refusal (the host already withdrew or timed out, and nothing is written).
import type { MawsBrowserAnswerResult } from '@shared/ipc/schema/maws';
import { BROWSER_ERROR_MAX_CHARS, BROWSER_TOOL_ERRORS, clipErrorDetail, type BrowserToolName } from '@shared/maws/browser';
import { UnknownTabError } from '../tabs';

export class BrowserToolError extends Error {
  constructor(readonly text: string) {
    super(text);
  }
}

// The texts cut what they quote (`clipErrorDetail`); the whole is cut too, so no answer is one the host's schema refuses
// (an argument error's own text included).
export const refusal = (error: string): MawsBrowserAnswerResult => ({
  ok: false,
  error: error.length <= BROWSER_ERROR_MAX_CHARS ? error : `${error.slice(0, BROWSER_ERROR_MAX_CHARS - 1)}…`,
});

// A Playwright or Electron error as the texts quote it: its first line (Playwright appends its call log below), without
// the API call Playwright names first (`locator.click: `, `page.evaluate: `), which is ours, not the page's; cut at
// BROWSER_ERROR_DETAIL_MAX_CHARS (a page's exception can be any length).
export function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return clipErrorDetail(message.split('\n', 1)[0].replace(/^(?:locator|page|frame|mouse|keyboard|elementHandle)\.\w+: /, '').trim() || 'unknown error');
}

// What a thrown error answers, for the action it interrupted: a refusal the handler named, a tab that went away, or
// `actionFailed` with the error's first line.
export function answerOfError(error: unknown, tool: BrowserToolName, action: string, target: string): MawsBrowserAnswerResult {
  if (error instanceof BrowserToolError) return refusal(error.text);
  if (error instanceof UnknownTabError) return refusal(BROWSER_TOOL_ERRORS.tabNotFound(tool, error.tabId));
  return refusal(BROWSER_TOOL_ERRORS.actionFailed(tool, action, target, firstLine(error)));
}

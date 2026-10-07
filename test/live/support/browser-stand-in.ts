// The live browser recording's stand-in for main (E4c execution document, Design §13): it answers each
// `maws.browser.request` with what the real app produces for the same calls on E4c's e2e server, so the e2e can replay
// the recording against the real app. Three facts make the answers equal (Design §13 (a) to (c)): the server's fixed
// port, the first tab id a launch mints under MAWS_E2E=1, and the two snapshots the real app generated (Task 4.1's
// fixtures). The answers are shaped as main's handlers shape them (src/main/browser/agent/handlers.ts); a screenshot is a
// solid-green 64×64 PNG written at the path the host named, which the host then reads and records as it would main's.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cutSnapshot, refElementsOf } from '@shared/browser/snapshot';
import type { MawsBrowserAnswerResult, MawsBrowserRequest } from '@shared/ipc/schema/maws';
import { BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT, type BrowserActResult, type BrowserScreenshotResult, type BrowserSnapshotResult, type BrowserTabsResult } from '@shared/maws/browser';
import { TOOL_ERRORS } from '@shared/maws/tools';

export const FORM_URL = 'http://127.0.0.1:17391/form.html';
export const FORM_TITLE = 'E4c order form';
export const DONE_URL = 'http://127.0.0.1:17391/done.html?name=Ada+Lovelace&email=ada%40example.test'; // the form's GET
export const DONE_TITLE = 'E4c order received';
export const TAB_ID = 'b_000000000001';
const FIXTURES = join(__dirname, '../../fixtures/browser');
export const FORM_SNAPSHOT = readFileSync(join(FIXTURES, 'form.snapshot.txt'), 'utf8');
export const DONE_SNAPSHOT = readFileSync(join(FIXTURES, 'done.snapshot.txt'), 'utf8');

// A solid-green (#00ff00) 64×64 RGB PNG, 132 bytes (E2's constant, maws-artifacts.live.test.ts).
export const GREEN_SQUARE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsJp+ExAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBC4LLjs8OJxKlMxAAAAAElFTkSuQmCC';

// One recording's main: the form until Submit is clicked by its ref, the done page after.
export class BrowserStandIn {
  private submitted = false;
  private opened = false;

  answer(request: MawsBrowserRequest): MawsBrowserAnswerResult {
    const args = request.args as Record<string, unknown>;
    const tool = request.tool;
    if (tool !== 'browser_tabs' && args.tabId !== TAB_ID) return { ok: false, error: TOOL_ERRORS.tabNotFound(tool, String(args.tabId)) };
    const page = this.submitted ? { tabId: TAB_ID, url: DONE_URL, title: DONE_TITLE } : { tabId: TAB_ID, url: FORM_URL, title: FORM_TITLE };
    switch (tool) {
      case 'browser_tabs': {
        const action = args.action as BrowserTabsResult['action'];
        if (action === 'open') this.opened = true;
        const tabs: BrowserTabsResult['tabs'] = this.opened ? [{ ...page, selected: true, loaded: true, control: 'agent', owner: 'self' }] : [];
        const named = action === 'list' ? null : page;
        const result: BrowserTabsResult = { status: 'ok', action, tabId: named?.tabId ?? null, url: named?.url ?? null, title: named?.title ?? null, tabs, ms: 120 };
        return { ok: true, result };
      }
      case 'browser_snapshot': {
        const { text, ...cut } = cutSnapshot(this.submitted ? DONE_SNAPSHOT : FORM_SNAPSHOT, { maxChars: (args.maxChars as number | undefined) ?? BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT });
        const result: BrowserSnapshotResult = { status: 'ok', ...page, ms: 60, root: (args.root as string | undefined) ?? null, rootMatches: null, ...cut };
        return { ok: true, result, text };
      }
      case 'browser_act': {
        const target = args.target;
        const element = typeof target === 'string' ? refElementsOf(FORM_SNAPSHOT).get(target) : undefined;
        const resolved: BrowserActResult['target'] = typeof target === 'string' ? { ref: target, ...element } : { ...(target as { css: string }), matches: 1 };
        const navigated = args.action === 'click' && element?.role === 'button' && element.name === 'Submit';
        if (navigated) this.submitted = true;
        const after = navigated ? { tabId: TAB_ID, url: DONE_URL, title: DONE_TITLE } : page;
        const result: BrowserActResult = { status: 'ok', ...after, ms: 40, action: args.action as BrowserActResult['action'], target: resolved, navigated, waitedFor: null, waitedMs: null };
        return { ok: true, result };
      }
      case 'browser_screenshot': {
        const png = Buffer.from(GREEN_SQUARE_PNG, 'base64');
        mkdirSync(dirname(request.path!), { recursive: true });
        writeFileSync(request.path!, png);
        const image = { path: request.path!, mimeType: 'image/png' as const, width: 64, height: 64, bytes: png.length };
        const result: BrowserScreenshotResult = { status: 'ok', ...page, ms: 80, deliverableId: request.deliverableId!, ...image, target: null, fullPage: args.fullPage === true };
        return { ok: true, result, image };
      }
      case 'browser_navigate':
      case 'browser_eval':
        return { ok: false, error: TOOL_ERRORS.actionFailed(tool, 'answer', '', 'not part of this recording') };
    }
  }
}

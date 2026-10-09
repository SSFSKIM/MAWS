// E4c (E4c execution document, Design §2): the six browser tools' record, kept since they left the `maws` server on
// 2026-10-08 (P1 A-54) so journals and X8 fixtures written before still map and render: the names (outside X9's list
// now), the input schemas a historical call is admitted by, the result schemas and how a call is summarised.
import { describe, expect, it } from 'vitest';
import { BROWSER_DIALOG_EXCERPT_MAX_CHARS } from '../browser/dialog';
import { BrowserLocatorSchema } from '../browser/locator';
import {
  browserCallOf,
  BROWSER_SNAPSHOT_MAX_CHARS_CEILING,
  BROWSER_TOOL_NAMES,
  BrowserActInputSchema,
  BrowserActResultSchema,
  BrowserEvalInputSchema,
  BrowserEvalResultSchema,
  BrowserNavigateInputSchema,
  BrowserNavigateResultSchema,
  BrowserRefSchema,
  BrowserScreenshotInputSchema,
  BrowserScreenshotResultSchema,
  BrowserSnapshotInputSchema,
  BrowserSnapshotResultSchema,
  BrowserTabsInputSchema,
  BrowserTabsResultSchema,
  BrowserTargetSchema,
  browserToolResultSchemaOf,
  BrowserWaitReasonSchema,
  isBrowserToolName,
  LANDMARK_ROLES,
  parseBrowserToolArguments,
} from './browser';
import { SessionEventSchema } from '../graph/events';
import { BrowserNoticeSchema } from '../ipc/schema/browser';
import { MAWS_TOOL_NAMES, MAWS_TOOLS, mawsToolList } from './tools';

const TAB = 'b_0123456789ab';
const UUID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';

describe('the six browser tools, a historical record (P1 A-54)', () => {
  it('keeps the six names, none of which the maws server lists any more', () => {
    expect(BROWSER_TOOL_NAMES).toEqual(['browser_tabs', 'browser_navigate', 'browser_snapshot', 'browser_act', 'browser_eval', 'browser_screenshot']);
    for (const name of BROWSER_TOOL_NAMES) {
      expect(MAWS_TOOL_NAMES as readonly string[]).not.toContain(name);
      expect(Object.keys(MAWS_TOOLS)).not.toContain(name);
    }
    expect(mawsToolList().filter((tool) => tool.name.startsWith('browser_'))).toEqual([]);
    for (const name of BROWSER_TOOL_NAMES) expect(isBrowserToolName(name)).toBe(true);
    for (const other of ['artifact_screenshot', 'browser', 'mcp__maws__browser_tabs', 1, null]) expect(isBrowserToolName(other)).toBe(false);
  });

  it('admits a historical call by its input schema, as the server did', () => {
    expect(parseBrowserToolArguments('browser_act', { tabId: TAB, action: 'click', target: 'e12' })).toEqual({ ok: true, data: { tabId: TAB, action: 'click', target: 'e12' } });
    expect(parseBrowserToolArguments('browser_act', { tabId: TAB, action: 'fill', target: 'e12' })).toEqual({ ok: false });
    expect(parseBrowserToolArguments('browser_tabs', { action: 'list' })).toEqual({ ok: true, data: { action: 'list' } });
    expect(LANDMARK_ROLES).toEqual(['banner', 'navigation', 'main', 'contentinfo', 'search', 'complementary', 'region', 'form']);
    expect(BROWSER_SNAPSHOT_MAX_CHARS_CEILING).toBe(64_000);
  });
});

describe('the browser tools\' inputs: strict, bounded, never defaulted', () => {
  const admits = (tool: (typeof BROWSER_TOOL_NAMES)[number], args: unknown) => parseBrowserToolArguments(tool, args).ok;

  it('targets: a ref (with an optional frame ordinal) or a strict locator {css, role?, name?}', () => {
    for (const ref of ['e1', 'e12', 'f2e7', 'f10e300']) expect(BrowserRefSchema.safeParse(ref).success, ref).toBe(true);
    for (const ref of ['', '12', 'e', 'fe1', 'e1f2', 'E12', ' e12', 'ref=e12']) expect(BrowserRefSchema.safeParse(ref).success, ref).toBe(false);
    expect(BrowserTargetSchema.safeParse('f1e4').success).toBe(true);
    expect(BrowserTargetSchema.safeParse({ css: '#save' }).success).toBe(true);
    expect(BrowserTargetSchema.safeParse({ css: '#save', role: 'button', name: 'Save' }).success).toBe(true);
    expect(BrowserTargetSchema.safeParse({ css: '#save', name: '' }).success).toBe(true); // an empty accessible name is a name
    for (const bad of [{ css: '' }, { css: 'x'.repeat(2001) }, { css: 'a', role: '' }, { css: 'a', role: 'r'.repeat(65) }, { css: 'a', name: 'n'.repeat(501) }, { css: 'a', text: 'x' }, { role: 'button' }])
      expect(BrowserTargetSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(BrowserLocatorSchema.parse({ css: 'a' })).toEqual({ css: 'a' });
  });

  it('browser_tabs: open needs a url, close and select a tabId, list takes neither', () => {
    expect(BrowserTabsInputSchema.parse({ action: 'list' })).toEqual({ action: 'list' });
    expect(BrowserTabsInputSchema.safeParse({ action: 'open', url: 'http://127.0.0.1:17391/form.html' }).success).toBe(true);
    expect(BrowserTabsInputSchema.safeParse({ action: 'close', tabId: TAB }).success).toBe(true);
    expect(BrowserTabsInputSchema.safeParse({ action: 'select', tabId: TAB }).success).toBe(true);
    expect(admits('browser_tabs', { action: 'open' })).toBe(false);
    expect(admits('browser_tabs', { action: 'close' })).toBe(false);
    expect(admits('browser_tabs', { action: 'select' })).toBe(false);
    expect(admits('browser_tabs', { action: 'list', tabId: TAB })).toBe(false);
    expect(admits('browser_tabs', { action: 'list', url: 'https://a.b/' })).toBe(false);
    expect(admits('browser_tabs', { action: 'open', url: 'file:///etc/hosts' })).toBe(false);
    expect(admits('browser_tabs', { action: 'open', url: 'javascript:alert(1)' })).toBe(false);
    expect(admits('browser_tabs', { action: 'close', tabId: 'tab-1' })).toBe(false);
    expect(admits('browser_tabs', { action: 'reload' })).toBe(false); // an unknown action
    expect(admits('browser_tabs', { action: 'list', all: true })).toBe(false);
  });

  it('browser_navigate: an http or https URL, or back, forward, reload', () => {
    for (const url of ['https://example.com/', 'http://localhost:17391/x?y#z', 'back', 'forward', 'reload'])
      expect(BrowserNavigateInputSchema.safeParse({ tabId: TAB, url }).success, url).toBe(true);
    for (const url of ['file:///etc/hosts', 'about:blank', 'home', 'https://exa mple.com/', ''])
      expect(BrowserNavigateInputSchema.safeParse({ tabId: TAB, url }).success, url).toBe(false);
    expect(BrowserNavigateInputSchema.safeParse({ url: 'back' }).success).toBe(false); // a tabId is required
  });

  it('browser_snapshot: root is a ref or a landmark role; maxChars an integer from 1000 to 64000', () => {
    expect(BrowserSnapshotInputSchema.parse({ tabId: TAB })).toEqual({ tabId: TAB });
    for (const root of ['e5', 'f1e20', ...LANDMARK_ROLES]) expect(BrowserSnapshotInputSchema.safeParse({ tabId: TAB, root }).success, root).toBe(true);
    for (const root of ['heading', 'body', '']) expect(BrowserSnapshotInputSchema.safeParse({ tabId: TAB, root }).success, root).toBe(false);
    for (const maxChars of [1000, 24_000, 64_000]) expect(BrowserSnapshotInputSchema.safeParse({ tabId: TAB, maxChars }).success, String(maxChars)).toBe(true);
    for (const maxChars of [999, 64_001, 2000.5]) expect(BrowserSnapshotInputSchema.safeParse({ tabId: TAB, maxChars }).success, String(maxChars)).toBe(false);
    expect(admits('browser_snapshot', { tabId: TAB, maxChars: 64_001 })).toBe(false);
  });

  it('browser_act: fill, select and press need a value; check takes "true" or "false"; scroll a signed integer', () => {
    const act = (action: string, value?: string, target: unknown = 'e12') => BrowserActInputSchema.safeParse({ tabId: TAB, action, target, ...(value === undefined ? {} : { value }) }).success;
    for (const action of ['click', 'hover', 'check', 'scroll']) expect(act(action), action).toBe(true);
    for (const action of ['fill', 'select', 'press']) {
      expect(act(action), action).toBe(false);
      expect(act(action, 'x'), action).toBe(true);
    }
    expect(act('fill', '')).toBe(true); // clearing a field is a fill with ''
    expect(act('check', 'true')).toBe(true);
    expect(act('check', 'false')).toBe(true);
    expect(act('check', 'yes')).toBe(false);
    for (const value of ['300', '-120', '+40', '0']) expect(act('scroll', value), value).toBe(true);
    for (const value of ['1.5', 'down', '', '10px']) expect(act('scroll', value), value).toBe(false);
    expect(act('click', undefined, { css: 'button.save', role: 'button', name: 'Save' })).toBe(true);
    expect(act('drag')).toBe(false);
    expect(act('fill', 'x'.repeat(20_001))).toBe(false);
    expect(admits('browser_act', { tabId: TAB, action: 'fill', target: 'e3' })).toBe(false);
    expect(admits('browser_act', { tabId: TAB, action: 'check', target: 'e3', value: 'on' })).toBe(false);
    expect(admits('browser_act', { tabId: TAB, action: 'scroll', target: 'e3', value: 'down' })).toBe(false);
  });

  it('browser_eval takes one expression up to 20000 characters; browser_screenshot a target or fullPage, not both', () => {
    expect(BrowserEvalInputSchema.safeParse({ tabId: TAB, expression: 'document.title' }).success).toBe(true);
    expect(BrowserEvalInputSchema.safeParse({ tabId: TAB, expression: '' }).success).toBe(false);
    expect(BrowserEvalInputSchema.safeParse({ tabId: TAB, expression: 'x'.repeat(20_001) }).success).toBe(false);
    expect(BrowserScreenshotInputSchema.parse({ tabId: TAB })).toEqual({ tabId: TAB });
    expect(BrowserScreenshotInputSchema.safeParse({ tabId: TAB, target: 'e4' }).success).toBe(true);
    expect(BrowserScreenshotInputSchema.safeParse({ tabId: TAB, target: { css: 'main' } }).success).toBe(true);
    expect(BrowserScreenshotInputSchema.safeParse({ tabId: TAB, fullPage: true }).success).toBe(true);
    expect(BrowserScreenshotInputSchema.safeParse({ tabId: TAB, target: 'e4', fullPage: false }).success).toBe(true);
    expect(admits('browser_screenshot', { tabId: TAB, target: 'e4', fullPage: true })).toBe(false);
  });
});

describe('the browser tools\' results', () => {
  const page = { status: 'ok', tabId: TAB, url: 'http://127.0.0.1:17391/form.html', title: 'E4c order form', ms: 40 } as const;
  const summary = { tabId: TAB, url: page.url, title: page.title, selected: true, loaded: true, control: 'agent', owner: 'self' } as const;

  it('browser_tabs lists summaries that say who controls each tab and whose session it belongs to (P-24)', () => {
    const listed = { status: 'ok', action: 'list', tabId: null, url: null, title: null, tabs: [summary, { ...summary, tabId: 'b_00000000000f', selected: false, loaded: false, control: 'idle', owner: 'parent' }], ms: 1 };
    expect(BrowserTabsResultSchema.safeParse(listed).success).toBe(true);
    expect(BrowserTabsResultSchema.safeParse({ ...listed, action: 'open', tabId: TAB, url: page.url, title: page.title }).success).toBe(true);
    expect(BrowserTabsResultSchema.safeParse({ ...listed, tabs: [{ ...summary, owner: 'other' }] }).success).toBe(false);
    expect(BrowserTabsResultSchema.safeParse({ ...listed, tabs: [{ ...summary, control: 'nobody' }] }).success).toBe(false);
    expect(BrowserTabsResultSchema.safeParse({ ...listed, tabs: [{ ...summary, owner: undefined }] }).success).toBe(false);
    expect(BrowserTabsResultSchema.safeParse({ ...listed, extra: 1 }).success).toBe(false);
  });

  it('browser_navigate and browser_act say whether and how long the action waited for the person or a cover', () => {
    expect(BrowserNavigateResultSchema.safeParse({ ...page, waitedFor: null, waitedMs: null }).success).toBe(true);
    expect(BrowserNavigateResultSchema.safeParse({ ...page, waitedFor: 'human', waitedMs: 3012 }).success).toBe(true);
    expect(BrowserNavigateResultSchema.safeParse(page).success).toBe(false);
    const act = { ...page, action: 'click', target: { ref: 'e12' }, navigated: true, waitedFor: null, waitedMs: null };
    expect(BrowserActResultSchema.safeParse(act).success).toBe(true);
    expect(BrowserActResultSchema.safeParse({ ...act, target: { ref: 'e12', role: 'button', name: 'Submit' } }).success).toBe(true);
    expect(BrowserActResultSchema.safeParse({ ...act, target: { css: '#save', role: 'button', name: 'Save', matches: 2 }, waitedFor: 'cover', waitedMs: 4100 }).success).toBe(true);
    expect(BrowserActResultSchema.safeParse({ ...act, target: { css: '#save', matches: 0 } }).success).toBe(false); // zero matches is an error, never a result
    expect(BrowserActResultSchema.safeParse({ ...act, action: 'drag' }).success).toBe(false);
    expect(BrowserActResultSchema.safeParse({ ...act, waitedFor: 'sheet' }).success).toBe(false);
  });

  // Task 1.4 (Decision Log 44 (d)): one waiting reason for the results, the X1 event and the IPC; one excerpt bound for
  // the dialog notice
  it('shares one waiting-reason enum with the event, and the dialog excerpt bound with the notice', () => {
    expect(BrowserWaitReasonSchema.options).toEqual(['human', 'cover']);
    expect(BrowserActResultSchema.shape.waitedFor.unwrap()).toBe(BrowserWaitReasonSchema);
    expect(BrowserNavigateResultSchema.shape.waitedFor.unwrap()).toBe(BrowserWaitReasonSchema);
    const action = SessionEventSchema.options.find((option) => option.shape.kind.value === 'maws.browser.action')!;
    expect((action.shape as unknown as { waitedFor: { unwrap(): unknown } }).waitedFor.unwrap()).toBe(BrowserWaitReasonSchema);
    const notice = { appSessionId: 'a', tabId: TAB, kind: 'dialogAnswered', dialogType: 'alert' } as const;
    expect(BrowserNoticeSchema.safeParse({ ...notice, excerpt: 'x'.repeat(BROWSER_DIALOG_EXCERPT_MAX_CHARS) }).success).toBe(true);
    expect(BrowserNoticeSchema.safeParse({ ...notice, excerpt: 'x'.repeat(BROWSER_DIALOG_EXCERPT_MAX_CHARS + 1) }).success).toBe(false);
  });

  it('browser_snapshot reports the cut; browser_eval the value; browser_screenshot the file', () => {
    const snapshot = { ...page, root: null, rootMatches: null, chars: 47_125, lines: 900, refs: 310, truncated: true, omitted: { lines: 420, refs: 160 } };
    expect(BrowserSnapshotResultSchema.safeParse(snapshot).success).toBe(true);
    expect(BrowserSnapshotResultSchema.safeParse({ ...snapshot, root: 'main', rootMatches: 1, truncated: false, omitted: null }).success).toBe(true);
    expect(BrowserSnapshotResultSchema.safeParse({ ...snapshot, text: '- heading' }).success).toBe(false); // the text is the second block
    for (const value of [null, 'E4c order form', 3, { a: [1] }]) expect(BrowserEvalResultSchema.safeParse({ ...page, value, truncated: false }).success).toBe(true);
    const shot = { ...page, deliverableId: UUID, path: `/u/deliverables/a/screenshots/${UUID}.png`, width: 1280, height: 800, bytes: 81_234, mimeType: 'image/png', target: null, fullPage: false };
    expect(BrowserScreenshotResultSchema.safeParse(shot).success).toBe(true);
    expect(BrowserScreenshotResultSchema.safeParse({ ...shot, mimeType: 'image/jpeg', target: { ref: 'e4' } }).success).toBe(true);
    expect(BrowserScreenshotResultSchema.safeParse({ ...shot, mimeType: 'image/webp' }).success).toBe(false);
    expect(BrowserScreenshotResultSchema.safeParse({ ...shot, deliverableId: 'd1' }).success).toBe(false);
  });

  it('every result may report the page dialogs MAWS answered: at most ten, each message cut to 500 characters', () => {
    const results = {
      browser_tabs: { status: 'ok', action: 'close', tabId: TAB, url: null, title: null, tabs: [], ms: 3 },
      browser_navigate: { ...page, waitedFor: null, waitedMs: null },
      browser_snapshot: { ...page, root: null, rootMatches: null, chars: 10, lines: 1, refs: 0, truncated: false, omitted: null },
      browser_act: { ...page, action: 'click', target: { ref: 'e1' }, navigated: false, waitedFor: null, waitedMs: null },
      browser_eval: { ...page, value: 1, truncated: false },
      browser_screenshot: { ...page, deliverableId: UUID, path: '/p.png', width: 1, height: 1, bytes: 1, mimeType: 'image/png', target: null, fullPage: false },
    } as const;
    const dialog = { type: 'alert', message: 'Saved.' } as const;
    for (const name of BROWSER_TOOL_NAMES) {
      const schema = browserToolResultSchemaOf(name);
      expect(schema.safeParse(results[name]).success, name).toBe(true);
      expect(schema.safeParse({ ...results[name], dialogs: [dialog, { type: 'confirm', message: '' }, { type: 'prompt', message: 'Name?' }] }).success, name).toBe(true);
      expect(schema.safeParse({ ...results[name], dialogs: Array.from({ length: 11 }, () => dialog) }).success, name).toBe(false);
      expect(schema.safeParse({ ...results[name], dialogs: [{ type: 'alert', message: 'x'.repeat(501) }] }).success, name).toBe(false);
      expect(schema.safeParse({ ...results[name], dialogs: [{ type: 'beforeunload', message: '' }] }).success, name).toBe(false);
    }
  });
});

describe('browserCallOf (Design §10, Decision Log 48)', () => {
  const TAB = 'b_000000000001';
  it('names each call’s action, tab and target as the event and the row read them', () => {
    expect([
      browserCallOf('browser_tabs', { action: 'open', url: 'https://example.com/' }),
      browserCallOf('browser_tabs', { action: 'list' }),
      browserCallOf('browser_navigate', { tabId: TAB, url: 'back' }),
      browserCallOf('browser_navigate', { tabId: TAB, url: 'https://example.com/a' }),
      browserCallOf('browser_snapshot', { tabId: TAB, root: 'main' }),
      browserCallOf('browser_act', { tabId: TAB, action: 'click', target: { css: '#save', role: 'button' } }),
      browserCallOf('browser_eval', { tabId: TAB, expression: '1' }),
      browserCallOf('browser_screenshot', { tabId: TAB, fullPage: true }),
      browserCallOf('browser_screenshot', { tabId: TAB, target: 'e4' }),
    ]).toEqual([
      { action: 'open', tabId: null, target: 'https://example.com/' },
      { action: 'list', tabId: null, target: null },
      { action: 'back', tabId: TAB, target: null },
      { action: 'url', tabId: TAB, target: 'https://example.com/a' },
      { action: 'snapshot', tabId: TAB, target: 'main' },
      { action: 'click', tabId: TAB, target: '#save' },
      { action: 'eval', tabId: TAB, target: null },
      { action: 'screenshot', tabId: TAB, target: 'fullPage' },
      { action: 'screenshot', tabId: TAB, target: 'e4' },
    ]);
  });

  it('reads arguments the schema refused leniently', () => {
    expect(browserCallOf('browser_act', { tabId: 7, action: 'drag', target: { css: 3 } })).toEqual({ action: 'drag', tabId: null, target: null });
    expect(browserCallOf('browser_tabs', null)).toEqual({ action: 'tabs', tabId: null, target: null });
  });
});

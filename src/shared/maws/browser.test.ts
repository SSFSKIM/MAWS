// E4c (E4c execution document, Design §2; Acceptance G1's unit pins): the six browser tools' contract: names,
// descriptions, annotations, input and result schemas, constants and the exact error texts.
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { BrowserLocatorSchema } from '../browser/locator';
import {
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_AGENT_IDLE_MS,
  BROWSER_ANSWER_MS,
  BROWSER_BRIDGE_IDLE_MS,
  BROWSER_DIALOG_MESSAGE_MAX_CHARS,
  BROWSER_DIALOGS_MAX,
  BROWSER_EVAL_MAX_CHARS,
  BROWSER_LOCATE_MS,
  BROWSER_SCREENSHOT_MAX_BYTES,
  BROWSER_SNAPSHOT_MAX_CHARS_CEILING,
  BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT,
  BROWSER_SNAPSHOT_OUTLINE_MAX_LINES,
  BROWSER_TOOL_ERRORS,
  BROWSER_TOOL_NAMES,
  BROWSER_TOOLS,
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
  browserTargetText,
  browserToolResultSchemaOf,
  isBrowserToolName,
  LANDMARK_ROLES,
} from './browser';
import { MAWS_TOOL_ANNOTATIONS, MAWS_TOOL_NAMES, MAWS_TOOLS, mawsToolList, parseToolArguments, TOOL_ERRORS } from './tools';

const TAB = 'b_0123456789ab';
const UUID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';

const DESCRIPTIONS: Record<(typeof BROWSER_TOOL_NAMES)[number], [title: string, description: string]> = {
  browser_tabs: [
    'Browser tabs',
    'List, open, close or select this session\'s tabs in the MAWS browser; without this tool, ask the user to open the page and describe what you need from it. "list" returns the session\'s tabs with their ids, URLs, titles and who controls each; "open" takes a url (http or https) and opens it in a new tab that stays open until you close it; "close" and "select" take a tabId. Tabs the user opened are listed too; the user sees the tab you act on. Returns the tab list and, for open, the new tab\'s id.',
  ],
  browser_navigate: [
    'Browser navigate',
    'Navigate a MAWS browser tab to a URL, or go back, forward or reload; without this tool, ask the user to open the page. url is an http or https URL or one of "back", "forward", "reload" (reload also loads a tab the user left unloaded). Waits for the page to load (up to 30 s). A page that starts a download is refused: the user downloads files, you do not. Returns the tab\'s URL and title after the load.',
  ],
  browser_snapshot: [
    'Browser snapshot',
    "Read a MAWS browser tab as an accessibility snapshot with element refs; without this tool, ask the user to describe the page or paste its text. Each interactive or named element has a ref like e12 that browser_act and browser_screenshot accept as a target. Refs are valid for the current document and until your next snapshot of it: after a navigation or a later snapshot, take a new snapshot before acting. The snapshot is cut at maxChars (default 24000, at most 64000) on a line boundary with a trailer saying how much was omitted and an outline of the page's landmarks and their refs, so you can call again with root set to a ref or a landmark role (banner, navigation, main, contentinfo, search, complementary, region, form) for one subtree; a rooted snapshot invalidates refs outside that subtree until the next whole-page snapshot. Returns the snapshot as text after a JSON header with the tab's URL, title and the cut.",
  ],
  browser_act: [
    'Browser act',
    'Act on an element in a MAWS browser tab: click, fill, select, check, press, hover or scroll; without this tool, ask the user to do it and tell you the result. target is a ref from browser_snapshot (e.g. "e12") or a locator {css, role?, name?} such as a comment anchor carries. fill types value into a field (replacing its content); select picks the option whose label or value is value; check sets a checkbox to value ("true" or "false", default true); press sends a key or chord (e.g. "Enter", "Control+a") to the element; scroll scrolls the element into view and then by value pixels when given (negative scrolls up). The action waits for the element to be visible and enabled (up to 10 s). If the user is using the page, the action waits until they stop or hand it back, and the result says so. A ref that no longer resolves is an error naming it: take a new snapshot. Returns the tab\'s URL and title after the action and whether it navigated.',
  ],
  browser_eval: [
    'Browser eval',
    "Evaluate a JavaScript expression in a MAWS browser tab's page and return its value; without this tool, use browser_snapshot or ask the user. Use it to read page state (text, attributes, computed values, JSON the page holds); it runs in the page with the page's permissions, so prefer browser_act for changes. A promise is awaited; the value is returned as JSON (cut at 16000 characters). If the user is using the page, the evaluation waits until they stop. Returns the value and the tab's URL and title.",
  ],
  browser_screenshot: [
    'Browser screenshot',
    'Take a screenshot of a MAWS browser tab and receive it as an image; without this tool, use browser_snapshot. target (a ref or a locator) screenshots one element; fullPage captures the whole scrollable page; neither captures the viewport. The picture is also saved as a deliverable the user can open from the transcript. Pictures are kept under 3.5 MB (JPEG when a PNG would exceed it). Returns the image and a JSON record with the deliverable id, size and format.',
  ],
};

describe('X9 as E4c extends it: the six browser tools', () => {
  it('names the six tools and appends them after the artifact tools, thirteen in all', () => {
    expect(BROWSER_TOOL_NAMES).toEqual(['browser_tabs', 'browser_navigate', 'browser_snapshot', 'browser_act', 'browser_eval', 'browser_screenshot']);
    expect(MAWS_TOOL_NAMES).toEqual([
      'send_file', 'ask', 'show_pane', 'artifact_create', 'artifact_update', 'artifact_list', 'artifact_screenshot',
      'browser_tabs', 'browser_navigate', 'browser_snapshot', 'browser_act', 'browser_eval', 'browser_screenshot',
    ]);
    expect(Object.keys(MAWS_TOOLS)).toEqual([...MAWS_TOOL_NAMES]);
    expect(Object.keys(BROWSER_TOOLS)).toEqual([...BROWSER_TOOL_NAMES]);
    for (const name of BROWSER_TOOL_NAMES) expect(isBrowserToolName(name)).toBe(true);
    for (const other of ['artifact_screenshot', 'browser', 'mcp__maws__browser_tabs', 1, null]) expect(isBrowserToolName(other)).toBe(false);
  });

  it('carries each title and description word for word, the fallback sentence first and a Returns sentence last', () => {
    for (const name of BROWSER_TOOL_NAMES) {
      const [title, description] = DESCRIPTIONS[name];
      expect(MAWS_TOOLS[name].title, name).toBe(title);
      expect(MAWS_TOOLS[name].description, name).toBe(description);
      expect(description, name).toMatch(/^[^.]*; without this tool, [^.]*\./);
      expect(description, name).toMatch(/ Returns [^.]*\.$/);
    }
  });

  it('lists them in order with their JSON schemas and annotations: navigate, act and eval are not read-only', () => {
    const list = mawsToolList();
    expect(list.map((t) => t.name)).toEqual([...MAWS_TOOL_NAMES]);
    const browser = list.filter((t) => isBrowserToolName(t.name));
    for (const tool of browser) {
      const spec = MAWS_TOOLS[tool.name];
      expect(tool.inputSchema, tool.name).toEqual(z.toJSONSchema(spec.input));
      expect(tool.inputSchema, tool.name).toMatchObject({ type: 'object', additionalProperties: false });
    }
    expect(browser.map((t) => [t.name, t.annotations])).toEqual([
      ['browser_tabs', { ...MAWS_TOOL_ANNOTATIONS, title: 'Browser tabs' }],
      ['browser_navigate', { readOnlyHint: false, openWorldHint: false, title: 'Browser navigate' }],
      ['browser_snapshot', { ...MAWS_TOOL_ANNOTATIONS, title: 'Browser snapshot' }],
      ['browser_act', { readOnlyHint: false, openWorldHint: false, title: 'Browser act' }],
      ['browser_eval', { readOnlyHint: false, openWorldHint: false, title: 'Browser eval' }],
      ['browser_screenshot', { ...MAWS_TOOL_ANNOTATIONS, title: 'Browser screenshot' }],
    ]);
    const schemaOf = (name: string) => list.find((t) => t.name === name)!.inputSchema;
    expect(schemaOf('browser_tabs')).toMatchObject({ required: ['action'], properties: { action: { enum: ['list', 'open', 'close', 'select'] }, tabId: { type: 'string', pattern: '^b_[0-9a-f]{12}$' } } });
    expect(schemaOf('browser_snapshot')).toMatchObject({ required: ['tabId'], properties: { maxChars: { type: 'integer', minimum: 1000, maximum: 64000 } } });
    expect(schemaOf('browser_act')).toMatchObject({ required: ['tabId', 'action', 'target'], properties: { action: { enum: ['click', 'fill', 'select', 'check', 'press', 'hover', 'scroll'] }, value: { type: 'string', maxLength: 20000 } } });
    expect(schemaOf('browser_eval')).toMatchObject({ required: ['tabId', 'expression'], properties: { expression: { type: 'string', minLength: 1, maxLength: 20000 } } });
  });

  it('holds the constants of the contract', () => {
    expect(LANDMARK_ROLES).toEqual(['banner', 'navigation', 'main', 'contentinfo', 'search', 'complementary', 'region', 'form']);
    expect({
      BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT, BROWSER_SNAPSHOT_MAX_CHARS_CEILING, BROWSER_SNAPSHOT_OUTLINE_MAX_LINES, BROWSER_EVAL_MAX_CHARS, BROWSER_SCREENSHOT_MAX_BYTES,
      BROWSER_ANSWER_MS, BROWSER_ACTION_TIMEOUT_MS, BROWSER_LOCATE_MS, BROWSER_AGENT_IDLE_MS, BROWSER_BRIDGE_IDLE_MS, BROWSER_DIALOG_MESSAGE_MAX_CHARS, BROWSER_DIALOGS_MAX,
    }).toEqual({
      BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT: 24_000, BROWSER_SNAPSHOT_MAX_CHARS_CEILING: 64_000, BROWSER_SNAPSHOT_OUTLINE_MAX_LINES: 40, BROWSER_EVAL_MAX_CHARS: 16_000,
      BROWSER_SCREENSHOT_MAX_BYTES: 3_670_016, BROWSER_ANSWER_MS: 30_000, BROWSER_ACTION_TIMEOUT_MS: 10_000, BROWSER_LOCATE_MS: 2_000, BROWSER_AGENT_IDLE_MS: 10_000,
      BROWSER_BRIDGE_IDLE_MS: 300_000, BROWSER_DIALOG_MESSAGE_MAX_CHARS: 500, BROWSER_DIALOGS_MAX: 10,
    });
  });
});

describe('the browser tools\' inputs: strict, bounded, never defaulted', () => {
  const refusal = (tool: (typeof BROWSER_TOOL_NAMES)[number], args: unknown) => {
    const parsed = parseToolArguments(tool, args);
    return parsed.ok ? null : parsed.error;
  };

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
    expect(refusal('browser_tabs', { action: 'open' })).toBe('browser_tabs: invalid arguments: url: open needs a url');
    expect(refusal('browser_tabs', { action: 'close' })).toBe('browser_tabs: invalid arguments: tabId: close needs a tabId');
    expect(refusal('browser_tabs', { action: 'select' })).toBe('browser_tabs: invalid arguments: tabId: select needs a tabId');
    expect(refusal('browser_tabs', { action: 'list', tabId: TAB })).toBe('browser_tabs: invalid arguments: tabId: list takes no tabId');
    expect(refusal('browser_tabs', { action: 'list', url: 'https://a.b/' })).toBe('browser_tabs: invalid arguments: url: list takes no url');
    expect(refusal('browser_tabs', { action: 'open', url: 'file:///etc/hosts' })).toMatch(/^browser_tabs: invalid arguments: url: /);
    expect(refusal('browser_tabs', { action: 'open', url: 'javascript:alert(1)' })).toMatch(/^browser_tabs: invalid arguments: url: /);
    expect(refusal('browser_tabs', { action: 'close', tabId: 'tab-1' })).toMatch(/^browser_tabs: invalid arguments: tabId: /);
    expect(refusal('browser_tabs', { action: 'reload' })).toMatch(/^browser_tabs: invalid arguments: action: /); // an unknown action
    expect(refusal('browser_tabs', { action: 'list', all: true })).toMatch(/^browser_tabs: invalid arguments: /);
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
    expect(refusal('browser_snapshot', { tabId: TAB, maxChars: 64_001 })).toMatch(/^browser_snapshot: invalid arguments: maxChars: /);
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
    expect(refusal('browser_act', { tabId: TAB, action: 'fill', target: 'e3' })).toBe('browser_act: invalid arguments: value: fill needs a value');
    expect(refusal('browser_act', { tabId: TAB, action: 'check', target: 'e3', value: 'on' })).toBe('browser_act: invalid arguments: value: check takes "true" or "false"');
    expect(refusal('browser_act', { tabId: TAB, action: 'scroll', target: 'e3', value: 'down' })).toBe('browser_act: invalid arguments: value: scroll takes a signed integer number of pixels');
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
    expect(refusal('browser_screenshot', { tabId: TAB, target: 'e4', fullPage: true })).toBe('browser_screenshot: invalid arguments: fullPage: fullPage captures the page; give it or a target, not both');
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

describe('the browser tools\' error texts', () => {
  it('names the tool, the tab or the target, and what to do next', () => {
    const e = BROWSER_TOOL_ERRORS;
    expect(e.tabNotFound('browser_act', TAB)).toBe(`browser_act: no tab "${TAB}" in this session; call browser_tabs {action: "list"}`);
    expect(e.tabNotLoaded('browser_snapshot', TAB, 'https://a.b/')).toBe(`browser_snapshot: tab "${TAB}" is not loaded (https://a.b/); call browser_navigate {tabId, url: "reload"} first`);
    expect(e.tabClosed('browser_act', TAB)).toBe(`browser_act: tab "${TAB}" was closed during the action`);
    expect(e.tabCrashed('browser_eval', TAB)).toBe(`browser_eval: the page in tab "${TAB}" crashed; call browser_navigate {tabId, url: "reload"} to revive it`);
    expect(e.staleRef('browser_act', 'e12', 'previous-document')).toBe('browser_act: ref "e12" is stale: it belongs to a previous document; call browser_snapshot again and use a ref from it');
    expect(e.staleRef('browser_screenshot', 'f1e4', 'missing')).toBe('browser_screenshot: ref "f1e4" is stale or missing in the current snapshot; call browser_snapshot again and use a ref from it');
    expect(e.targetNotFound('browser_act', { css: '#save' })).toBe('browser_act: no element matches {css: "#save"} (0 matches)');
    expect(e.targetNotFound('browser_act', { css: 'input[name="q"]', role: 'textbox', name: 'Search' })).toBe('browser_act: no element matches {css: "input[name=\\"q\\"]", role: "textbox", name: "Search"} (0 matches)');
    // Decision Log 30: css alone matched one element whose role or name disagrees; the fallback is not taken
    expect(e.targetNotFound('browser_act', { css: '#save', role: 'button', name: 'Save' }, { role: 'button', name: 'Cancel' })).toBe('browser_act: {css: "#save"} matches one element, button "Cancel", not button "Save"');
    expect(e.targetNotFound('browser_act', { css: '#save', role: 'link' }, { role: 'button', name: 'Save' })).toBe('browser_act: {css: "#save"} matches one element, button "Save", not link');
    expect(e.humanHasPage('browser_act')).toBe('browser_act: the user has the page; the action was cancelled before they handed it back');
    expect(e.navigationFailed('browser_navigate', 'http://nope.invalid/', 'dns', 'ERR_NAME_NOT_RESOLVED')).toBe('browser_navigate: http://nope.invalid/ failed to load (dns, ERR_NAME_NOT_RESOLVED)');
    expect(e.downloadRefused('browser_act', 'https://a.b/f.zip', 'f.zip')).toBe('browser_act: https://a.b/f.zip started a download (f.zip), which MAWS refuses for the agent; the user downloads files');
    expect(e.actionTimeout('browser_act', 'click', 'e12', 10_000)).toBe('browser_act: click on e12 was not actionable within 10 s (the element must be visible and enabled)');
    expect(e.actionFailed('browser_act', 'fill', '{css: "#name"}', 'Element is not an <input>')).toBe('browser_act: fill on {css: "#name"} failed: Element is not an <input>');
    expect(e.actionFailed('browser_navigate', 'back', '', 'no page to go back to')).toBe('browser_navigate: back failed: no page to go back to');
    expect(e.evalFailed('ReferenceError: foo is not defined')).toBe('browser_eval: ReferenceError: foo is not defined');
    expect(e.rootNotFound('main')).toBe('browser_snapshot: no element for root "main"');
    expect(e.screenshotFailed('Target closed')).toBe('browser_screenshot: could not capture: Target closed');
    expect(e.screenshotTooLarge(4_000_000)).toBe('browser_screenshot: the picture is 4000000 bytes after the JPEG fallback and exceeds 3.5 MiB; screenshot a target instead of fullPage');
    expect(e.browserTimeout('browser_navigate')).toBe('browser_navigate: MAWS did not answer within 30 s');
    expect(e.interrupted('browser_act')).toBe('browser_act: cancelled, the turn was interrupted');
  });

  it('joins TOOL_ERRORS beside E4a\'s refusal and E10\'s appNotOpen, widened to the browser tools (Decision Log 31)', () => {
    for (const key of Object.keys(BROWSER_TOOL_ERRORS)) expect(TOOL_ERRORS, key).toHaveProperty([key], BROWSER_TOOL_ERRORS[key as keyof typeof BROWSER_TOOL_ERRORS]);
    expect(TOOL_ERRORS.navigationRefused('file:///etc/hosts', 'browser_navigate')).toBe('browser_navigate: MAWS opens only http and https pages in its browser; refused "file:///etc/hosts"');
    for (const name of BROWSER_TOOL_NAMES) expect(TOOL_ERRORS.appNotOpen(name)).toBe(`${name}: MAWS is not open; the browser tools need the MAWS window`);
    expect(TOOL_ERRORS.appNotOpen('show_pane')).toBe('show_pane: MAWS is not open; the pane cannot be shown');
    expect(TOOL_ERRORS.appNotOpen('artifact_screenshot')).toBe('artifact_screenshot: MAWS is not open; the artifact cannot be captured');
  });

  it('names a target as the texts and the row do: a ref as itself, a locator in braces', () => {
    expect(browserTargetText('e12')).toBe('e12');
    expect(browserTargetText({ css: '#save' })).toBe('{css: "#save"}');
    expect(browserTargetText({ css: '.x', role: 'button', name: 'Go' })).toBe('{css: ".x", role: "button", name: "Go"}');
  });
});

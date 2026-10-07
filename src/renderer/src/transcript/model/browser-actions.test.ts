// E4c (M3, Design §10): the browser tools in the transcript through the public reducer-to-rows pipeline. Every call of
// the six is a `browser_action` row, opened from the call (its action, tab and target), filled from its result (the
// first JSON text block, and for a snapshot the text after it) and refined by `maws.browser.action`; a call whose turn
// closed with no result reads cancelled. The disk path (no events) is the same derivation without the refinement.
import { describe, expect, it } from 'vitest';
import { isPersistentRow, rowsOf, withAllExpanded } from './derive';
import { rowId } from './keys';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { builder, request, tool, type Builder } from './test-events';

type BrowserRow = Extract<Row, { kind: 'browser_action' }>;
const browserRows = (events: Builder['events']) => rowsOf(withAllExpanded(applyEvents(createState(null, null), events))).filter((row): row is BrowserRow => row.kind === 'browser_action');
const foldedRows = (events: Builder['events']) => rowsOf(applyEvents(createState(null, null), events));

const TAB = 'b_000000000001';
const DELIVERABLE = '6f1c2a4e-3b5d-4c7e-8f90-a1b2c3d4e5f6';
const json = (value: unknown) => ({ type: 'text', text: JSON.stringify(value, null, 2) });
const page = { status: 'ok', tabId: TAB, url: 'http://127.0.0.1:17391/form.html', title: 'E4c order form' };
const clicked = (ms = 40) => [json({ ...page, ms, action: 'click', target: { ref: 'e12', role: 'button', name: 'Submit' }, navigated: true, waitedFor: null, waitedMs: null })];
const actionEvent = (toolUseId: string, fields: Partial<Extract<Builder['events'][number], { kind: 'maws.browser.action' }>> = {}) => ({
  toolUseId: tool(toolUseId), requestId: request('r1'), tool: 'browser_act' as const, action: 'click', tabId: TAB, target: 'e12', url: page.url, title: page.title, ms: 40,
  deliverableId: null, error: null, waitedFor: null, waitedMs: null, ...fields,
});

describe('the browser action row', () => {
  it('opens running from the call and is done with the result’s page, time and element', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_a', 'mcp__maws__browser_act', { tabId: TAB, action: 'click', target: 'e12' });
    const [running] = browserRows(b.events);
    expect(running).toEqual({
      id: rowId.browserAction(tool('toolu_a')), turnId: 'turn:u1', at: running.at, kind: 'browser_action', toolUseId: 'toolu_a', tool: 'browser_act', action: 'click', tabId: TAB,
      target: 'e12', targetRole: null, targetName: null, value: null, url: null, title: null, ms: null, deliverableId: null, error: null, waitedFor: null, waitedMs: null,
      chars: null, tabCount: null, state: 'running', detail: null, answered: false,
    });
    b.result('toolu_a', clicked());
    expect(browserRows(b.events)[0]).toMatchObject({
      state: 'done', answered: true, url: page.url, title: page.title, ms: 40, targetRole: 'button', targetName: 'Submit', waitedFor: null, detail: null,
    });
  });

  it('the event refines what it carries, whichever comes first; the element’s role and name stay the result’s', () => {
    const before = builder();
    before.turn('u1');
    before.toolUse('toolu_a', 'mcp__maws__browser_act', { tabId: TAB, action: 'click', target: 'e12' });
    before.emit('maws.browser.action', actionEvent('toolu_a', { ms: 3_400, waitedFor: 'human', waitedMs: 3_000 }));
    expect(browserRows(before.events)[0]).toMatchObject({ state: 'running', ms: 3_400, waitedFor: 'human', waitedMs: 3_000, url: page.url });
    before.result('toolu_a', clicked(12));
    expect(browserRows(before.events)[0]).toMatchObject({ state: 'done', ms: 3_400, waitedFor: 'human', waitedMs: 3_000, targetRole: 'button', targetName: 'Submit' });

    const after = builder();
    after.turn('u1');
    after.toolUse('toolu_b', 'mcp__maws__browser_act', { tabId: TAB, action: 'click', target: 'e12' });
    after.result('toolu_b', clicked(12));
    after.emit('maws.browser.action', actionEvent('toolu_b', { ms: 3_400 }));
    expect(browserRows(after.events)[0]).toMatchObject({ state: 'done', ms: 3_400, targetName: 'Submit' });
  });

  it('a refusal is an error with its text, from the result or from the event', () => {
    const stale = 'browser_act: ref "e12" is stale or missing in the current snapshot; call browser_snapshot again and use a ref from it';
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_a', 'mcp__maws__browser_act', { tabId: TAB, action: 'click', target: 'e12' });
    b.result('toolu_a', stale, { isError: true });
    b.toolUse('toolu_b', 'mcp__maws__browser_act', { tabId: TAB, action: 'click', target: 'e13' });
    b.emit('maws.browser.action', actionEvent('toolu_b', { target: 'e13', url: null, title: null, ms: null, error: 'browser_act: MAWS is not open; the browser tools need the MAWS window' }));
    expect(browserRows(b.events).map((row) => [row.state, row.error, row.answered])).toEqual([
      ['error', stale, true],
      ['error', 'browser_act: MAWS is not open; the browser tools need the MAWS window', false],
    ]);
  });

  it('reads cancelled when its turn closed with no result, or the engine stopped it', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_a', 'mcp__maws__browser_act', { tabId: TAB, action: 'click', target: 'e12' });
    expect(browserRows(b.events)[0].state).toBe('running');
    b.end(['u1'], { terminalReason: 'aborted_streaming' });
    expect(browserRows(b.events)[0]).toMatchObject({ state: 'cancelled', answered: false });

    const denied = builder();
    denied.turn('u2');
    denied.toolUse('toolu_d', 'mcp__maws__browser_eval', { tabId: TAB, expression: 'document.title' });
    denied.result('toolu_d', 'Interrupted by user', { isError: true, denial: 'interrupted' });
    expect(browserRows(denied.events)[0]).toMatchObject({ state: 'cancelled', error: null, answered: true });
  });

  it('a snapshot keeps its text for the disclosure and the whole snapshot’s size; an eval its value', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_s', 'mcp__maws__browser_snapshot', { tabId: TAB });
    const text = '- heading "E4c order form" [level=1] [ref=e1]\n- textbox "Name" [ref=e2]';
    b.result('toolu_s', [json({ ...page, ms: 30, root: null, rootMatches: null, chars: 47_125, lines: 900, refs: 300, truncated: true, omitted: { lines: 500, refs: 160 } }), { type: 'text', text }]);
    b.toolUse('toolu_r', 'mcp__maws__browser_snapshot', { tabId: TAB, root: 'main' });
    b.toolUse('toolu_e', 'mcp__maws__browser_eval', { tabId: TAB, expression: 'document.title' });
    b.result('toolu_e', [json({ ...page, ms: 5, value: { heading: 'E4c order form', fields: 2 }, truncated: false })]);
    b.toolUse('toolu_t', 'mcp__maws__browser_eval', { tabId: TAB, expression: 'document.title' });
    b.result('toolu_t', [json({ ...page, ms: 5, value: 'E4c order form', truncated: false })]);
    expect(browserRows(b.events).map((row) => [row.action, row.target, row.chars, row.detail])).toEqual([
      ['snapshot', null, 47_125, text],
      ['snapshot', 'main', null, null],
      ['eval', null, null, '{\n  "heading": "E4c order form",\n  "fields": 2\n}'],
      ['eval', null, null, 'E4c order form'],
    ]);
  });

  it('a screenshot’s deliverable comes from the JSON after the image and the engine’s pointer text', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_p', 'mcp__maws__browser_screenshot', { tabId: TAB, fullPage: true });
    b.result('toolu_p', [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      { type: 'text', text: '[Image: source: /tmp/shot.png]' },
      json({ ...page, ms: 80, deliverableId: DELIVERABLE, path: '/tmp/shot.png', width: 64, height: 64, bytes: 120, mimeType: 'image/png', target: null, fullPage: true }),
    ]);
    expect(browserRows(b.events)[0]).toMatchObject({ tool: 'browser_screenshot', action: 'screenshot', target: 'fullPage', deliverableId: DELIVERABLE, ms: 80, state: 'done', detail: null });
  });

  it('tabs: an open names its URL and takes the new tab from the result; a list counts the tabs', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_o', 'mcp__maws__browser_tabs', { action: 'open', url: page.url });
    expect(browserRows(b.events)[0]).toMatchObject({ action: 'open', tabId: null, target: page.url });
    const summary = { tabId: TAB, url: page.url, title: page.title, selected: true, loaded: true, control: 'agent', owner: 'self' };
    b.result('toolu_o', [json({ status: 'ok', action: 'open', tabId: TAB, url: page.url, title: page.title, tabs: [summary], ms: 120 })]);
    b.toolUse('toolu_l', 'mcp__maws__browser_tabs', { action: 'list' });
    b.result('toolu_l', [json({ status: 'ok', action: 'list', tabId: null, url: null, title: null, tabs: [summary, { ...summary, tabId: 'b_000000000002' }], ms: 2 })]);
    expect(browserRows(b.events).map((row) => [row.action, row.tabId, row.tabCount])).toEqual([
      ['open', TAB, 1],
      ['list', null, 2],
    ]);
  });

  it('an act’s value names a select’s option, a key, a check and a scroll, never what a fill typed', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_1', 'mcp__maws__browser_act', { tabId: TAB, action: 'fill', target: 'e2', value: 'hunter2' });
    b.toolUse('toolu_2', 'mcp__maws__browser_act', { tabId: TAB, action: 'select', target: 'e3', value: 'Blue' });
    b.toolUse('toolu_3', 'mcp__maws__browser_act', { tabId: TAB, action: 'press', target: 'e3', value: 'Enter' });
    b.toolUse('toolu_4', 'mcp__maws__browser_act', { tabId: TAB, action: 'check', target: 'e4', value: 'false' });
    b.toolUse('toolu_5', 'mcp__maws__browser_act', { tabId: TAB, action: 'scroll', target: { css: '#list', role: 'list', name: 'Orders' }, value: '-300' });
    expect(browserRows(b.events).map((row) => [row.action, row.target, row.value, row.targetRole, row.targetName])).toEqual([
      ['fill', 'e2', null, null, null],
      ['select', 'e3', 'Blue', null, null],
      ['press', 'e3', 'Enter', null, null],
      ['check', 'e4', 'false', null, null],
      ['scroll', '#list', '-300', 'list', 'Orders'],
    ]);
    expect(JSON.stringify(browserRows(b.events))).not.toContain('hunter2');
  });

  it('arguments the schema refused still draw from the call as recorded', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_x', 'mcp__maws__browser_act', { tabId: TAB, action: 'drag', target: 'e2' });
    b.result('toolu_x', 'browser_act: invalid arguments: action: Invalid option', { isError: true });
    expect(browserRows(b.events)[0]).toMatchObject({ action: 'drag', target: 'e2', tabId: TAB, state: 'error' });
  });

  it('stays in view when its turn folds, as the other maws rows do', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_a', 'mcp__maws__browser_act', { tabId: TAB, action: 'click', target: 'e12' });
    b.result('toolu_a', clicked());
    b.text('m2', 0, 'Done.');
    b.end(['u1']);
    const rows = foldedRows(b.events).filter((row) => row.kind !== 'time');
    expect(rows.map((row) => row.kind)).toEqual(['user', 'browser_action', 'assistant_text']);
    expect(isPersistentRow(rows[1])).toBe(true);
  });
});

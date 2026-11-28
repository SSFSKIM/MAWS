// The side sheet (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §H; S12): the session's sheet as a
// side-column tool, shown only by a person's act (`openSheet`) at the question named, its tab titled with the count of
// open questions, its Send through the app's host to `sheet.put`. O-17, kept: a record appearing, a question added and
// a `sheet.changed` leave the side column as it was. Every id, name and sentence is invented.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addressOf } from '@shared/machine/address';
import type { SheetModel, SheetSummary } from '@shared/sheet/model';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { record } from '../../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../../test/support/machine';
import { registerPanelTool, usePanelHost } from '../../panel/host';
import type { PanelToolContext } from '../../panel/tool';
import { surfaceTabs } from '../../panel/surface-model';
import { CLASH, FIXTURE, NOTICES, sheetOf } from '../../sheet/test-support/questions';
import { useLayout } from '../../stores/layout';
import { connectSheets, resetSheetStore, updateSheetMemory, watchSheet } from '../../stores/sheet';
import { A as SHOWN, B, mainShowing, resetPanelStores } from '../../test-support/panel';
import { appSheetHost } from './host';
import { openSheet, SHEET_TOOL_ID, sheetTool, type SheetToolParams } from './SheetTool';

// The sheet's Markdown, as text (the real renderer is a lazy chunk).
vi.mock('../../transcript/view/markdown/Markdown', () => ({ Markdown: ({ markdown }: { markdown: string }) => <div data-markdown="">{markdown}</div> }));

const MODEL: SheetModel = sheetOf([CLASH, NOTICES, FIXTURE]);
const SESSION = MODEL.session;
const summary = (extra: Partial<SheetSummary> = {}): SheetSummary => ({
  session: SESSION, appSessionId: SHOWN, title: null, live: true, seq: 1, open: 3, queued: 0, pending: 0, hidden: 0, oldestAskedAt: CLASH.askedAt, unreadable: false, ...extra,
});

let fake: FakeClient;
let off: () => void;

beforeEach(() => {
  resetPanelStores();
  resetSheetStore();
  fake = fakeClient();
  off = connectSheets(fake.client);
});
afterEach(() => {
  off();
  cleanup();
  resetPanelStores();
  resetSheetStore();
});

const sideTools = () => surfaceTabs(useLayout.getState(), SHOWN).map((tab) => tab.toolId);

function ctx(over: Partial<PanelToolContext> = {}): PanelToolContext {
  return {
    appSessionId: SHOWN, session: record(SHOWN), status: null, pinned: false, visible: true, focusRequest: 0,
    setTitle: () => {}, close: () => {}, openTool: (() => '') as never, editorHost: { surface: 'panel', tabId: 'sheet:test' }, ...over,
  };
}

function mount(params?: SheetToolParams, instanceId = 'sheet:test') {
  const state = sheetTool.createState({ appSessionId: SHOWN, session: record(SHOWN), instanceId, params: params as SheetToolParams });
  const Body = sheetTool.render;
  const view = render(<Body state={state} ctx={ctx()} />);
  return { state, view };
}

async function listed(...summaries: SheetSummary[]) {
  await act(() => fake.reply('sheet.list', { sessions: summaries, door: { known: false } }));
}

describe('opening the side sheet', () => {
  it('is the person’s act alone: a record appearing, a question added and a change leave the side column as it was', async () => {
    registerPanelTool(sheetTool);
    await listed();
    act(() => fake.event('sheet.changed', { session: SESSION, summary: summary({ open: 1 }) })); // a record appears
    act(() => fake.event('sheet.changed', { session: SESSION, summary: summary({ seq: 2, open: 2 }) })); // a question is added
    act(() => fake.event('sheet.changed', { session: SESSION, summary: summary({ seq: 2, open: 2, queued: 1 }) }));
    expect(sideTools()).toEqual([]);
    expect(Object.keys(usePanelHost.getState().titles)).toEqual([]);
  });

  it('adds the session’s one sheet, active, at the question named; a second open moves to the next question', () => {
    registerPanelTool(sheetTool);
    act(() => openSheet(SHOWN, 'q5'));
    expect(sideTools()).toEqual([SHEET_TOOL_ID]);
    act(() => openSheet(SHOWN, 'q7'));
    act(() => openSheet(SHOWN, null)); // "+" or a notice of the session: no question named
    expect(sideTools()).toEqual([SHEET_TOOL_ID]);
  });

  it('opens nothing for another machine’s session, which has no sheet this window can read', () => {
    registerPanelTool(sheetTool);
    act(() => openSheet(addressOf(OTHER_MACHINE, 'app-elsewhere') as typeof SHOWN, 'q1'));
    expect(useLayout.getState().panelBySession.size).toBe(0);
  });
});

describe('the side sheet', () => {
  it('draws the session’s sheet, watched while it shows, with the keyboard on the question it was opened at', async () => {
    await listed(summary());
    mount({ at: 'q5' });
    expect(fake.invoked('sheet.read')).toEqual([{ session: SESSION }]);
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: false } }));
    expect([...document.querySelectorAll('[data-sheet-question]')].map((card) => card.getAttribute('data-sheet-question'))).toEqual(['q4', 'q5', 'q7']);
    expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q5');
  });

  it('moves the keyboard to the question a later open names', async () => {
    await listed(summary());
    const { state } = mount({ at: 'q4' });
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: false } }));
    expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q4');
    act(() => sheetTool.open!(state, { at: 'q7' }));
    expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q7');
  });

  // M4's review: the body mounts again whenever its tab is shown again; an ask already used moves nothing then, and an
  // ask made while the card was not listed waits for it
  it('uses an ask once for the tab’s lifetime: shown again, it moves nothing; one whose card is not listed yet waits for it', async () => {
    await listed(summary());
    const { state, view } = mount({ at: 'q5' });
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: false } }));
    expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q5');
    view.unmount(); // another tab of the group is shown
    const elsewhere = document.body.appendChild(document.createElement('button'));
    elsewhere.focus();
    const Body = sheetTool.render;
    const again = render(<Body state={state} ctx={ctx()} />); // and the sheet's tab again
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: false } })); // watched again, read again
    expect(document.querySelector('[data-sheet-question="q5"]')).not.toBeNull();
    expect(document.activeElement, 'the keyboard stays where the person left it').toBe(elsewhere);

    act(() => sheetTool.open!(state, { at: 'q9' })); // a question the model does not list yet
    expect(document.activeElement).toBe(elsewhere);
    const added = sheetOf([...MODEL.open, { ...CLASH, id: 'q9', handle: 'q9', header: 'Berth' }], { seq: 2 });
    act(() => fake.event('sheet.changed', { session: SESSION, summary: summary({ seq: 2, open: 4 }) }));
    await act(() => fake.reply('sheet.read', { model: added, door: { known: false } }));
    expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q9');
    again.unmount();
    elsewhere.focus();
    render(<Body state={state} ctx={ctx()} />);
    await act(() => fake.reply('sheet.read', { model: added, door: { known: false } }));
    expect(document.querySelector('[data-sheet-question="q9"]')).not.toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('takes an ask again when the host draws the body again while the tab stays in view', async () => {
    registerPanelTool(sheetTool);
    await listed(summary());
    act(() => openSheet(SHOWN, 'q5'));
    const tab = surfaceTabs(useLayout.getState(), SHOWN).find((ref) => ref.toolId === SHEET_TOOL_ID)!;
    const state = sheetTool.createState({ appSessionId: SHOWN, session: record(SHOWN), instanceId: tab.id, params: { at: 'q5' } });
    const Body = sheetTool.render;
    const at = ctx({ editorHost: { surface: 'panel', tabId: tab.id } });
    const first = render(<Body state={state} ctx={at} />);
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: false } }));
    expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q5');
    first.unmount(); // the host draws the tab's body again, the tab still in view
    render(<Body state={state} ctx={at} />);
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: false } }));
    expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q5');
  });

  // M4's re-review: the side column follows the session in front; A's sheet goes when B is shown, while A's groups stay
  // saved, and comes back with A: the ask was used, so the keyboard stays where the person left it
  it('uses an ask when another session is shown: A at q5, then B, then A again moves nothing', async () => {
    registerPanelTool(sheetTool);
    await listed(summary());
    act(() => openSheet(SHOWN, 'q5'));
    const tab = surfaceTabs(useLayout.getState(), SHOWN).find((ref) => ref.toolId === SHEET_TOOL_ID)!;
    const state = sheetTool.createState({ appSessionId: SHOWN, session: record(SHOWN), instanceId: tab.id, params: { at: 'q5' } });
    const Body = sheetTool.render;
    const at = ctx({ editorHost: { surface: 'panel', tabId: tab.id } });
    const first = render(<Body state={state} ctx={at} />);
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: false } }));
    expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q5');
    act(() => useLayout.setState({ main: mainShowing(SHOWN, B) })); // session B in front: the column shows B's
    first.unmount();
    const elsewhere = document.body.appendChild(document.createElement('button'));
    elsewhere.focus();
    act(() => useLayout.setState({ main: mainShowing(B, SHOWN) })); // and A again
    render(<Body state={state} ctx={at} />);
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: false } }));
    expect(document.querySelector('[data-sheet-question="q5"]')).not.toBeNull();
    expect(document.activeElement, 'the keyboard stays where the person left it').toBe(elsewhere);
    elsewhere.remove();
  });

  // The branch review of pull request 890 (R3): a destination page over the column, or a collapsed panel, hides the tab without
  // unmounting its body; an ask that landed is used then, and one whose card has not appeared waits for it
  it('uses a landed ask when the tab is hidden without unmounting; one whose card is not listed yet stays pending', async () => {
    await listed(summary());
    const state = sheetTool.createState({ appSessionId: SHOWN, session: record(SHOWN), instanceId: 'sheet:test', params: { at: 'q5' } });
    const Body = sheetTool.render;
    const view = render(<Body state={state} ctx={ctx()} />);
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: false } }));
    expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q5');
    view.rerender(<Body state={state} ctx={ctx({ visible: false })} />); // the last watcher gone: the model is dropped
    const elsewhere = document.body.appendChild(document.createElement('button'));
    elsewhere.focus();
    view.rerender(<Body state={state} ctx={ctx({ visible: true })} />);
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: false } }));
    expect(document.querySelector('[data-sheet-question="q5"]')).not.toBeNull();
    expect(document.activeElement, 'the keyboard stays where the person left it').toBe(elsewhere);

    act(() => sheetTool.open!(state, { at: 'q9' })); // a question the model does not list yet
    view.rerender(<Body state={state} ctx={ctx({ visible: false })} />);
    view.rerender(<Body state={state} ctx={ctx({ visible: true })} />);
    const added = sheetOf([...MODEL.open, { ...CLASH, id: 'q9', handle: 'q9', header: 'Berth' }], { seq: 2 });
    await act(() => fake.reply('sheet.read', { model: added, door: { known: false } }));
    expect(document.activeElement?.getAttribute('data-sheet-question'), 'the pending ask lands once its card is listed').toBe('q9');
    elsewhere.remove();
  });

  it('keeps an ask made while the column is not on screen until it is, then puts the keyboard on its card', async () => {
    await listed(summary());
    const state = sheetTool.createState({ appSessionId: SHOWN, session: record(SHOWN), instanceId: 'sheet:test', params: { at: 'q7' } });
    const Body = sheetTool.render;
    const view = render(<Body state={state} ctx={ctx({ visible: false })} />);
    act(() => watchSheet(SESSION)); // another view of the session reads it meanwhile
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: false } }));
    expect(document.querySelector('[data-sheet-question="q7"]')).not.toBeNull();
    expect(document.activeElement?.getAttribute('data-sheet-question')).toBeNull();
    view.rerender(<Body state={state} ctx={ctx({ visible: true })} />);
    expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q7');
  });

  it('keeps a draft in the window’s memory, which another mount of the session shows', async () => {
    await listed(summary());
    act(() => updateSheetMemory(SESSION, (current) => ({ ...current, drafts: new Map([['q5', { revision: 1, picks: [], text: 'Put the deck limits last.', images: [] }]]) })));
    mount();
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: false } }));
    expect(screen.getByDisplayValue('Put the deck limits last.')).toBeTruthy();
  });

  it('is the empty sheet with no record of the session, and says so for a record this build cannot read', async () => {
    await listed();
    const first = mount();
    expect(screen.getByText('No open questions')).toBeTruthy();
    expect(fake.invoked('sheet.read')).toEqual([]);
    first.view.unmount();
    act(() => fake.event('sheet.changed', { session: SESSION, summary: summary({ unreadable: true, open: 0 }) }));
    mount();
    expect(screen.getByText('This sheet was written by a newer sminos.')).toBeTruthy();
  });

  it('replaces Send with the reason when the door is known not to run', async () => {
    await listed(summary());
    mount();
    await act(() => fake.reply('sheet.read', { model: MODEL, door: { known: true, available: false, reason: 'No sminos with the sheet’s verbs.' } }));
    expect(screen.getByText('Answers cannot be sent from here: sminos was not found on this Mac.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Send/ })).toBeNull();
  });

  it('titles its tab with the count of open questions, none at zero, while the tab lives', async () => {
    await listed(summary());
    const { state } = mount(undefined, 'sheet:count');
    await act(() => Promise.resolve());
    expect(usePanelHost.getState().titles['sheet:count']).toBe('3');
    act(() => fake.event('sheet.changed', { session: SESSION, summary: summary({ open: 2, queued: 1 }) }));
    expect(usePanelHost.getState().titles['sheet:count']).toBe('2');
    act(() => fake.event('sheet.changed', { session: SESSION, summary: summary({ open: 0, queued: 3 }) }));
    expect(usePanelHost.getState().titles['sheet:count']).toBeNull();
    sheetTool.dispose(state);
    act(() => fake.event('sheet.changed', { session: SESSION, summary: summary({ open: 1 }) }));
    expect(usePanelHost.getState().titles['sheet:count']).toBeNull();
  });
});

describe('the app’s host', () => {
  it('sends a Send’s lines to sheet.put and answers the door’s result; a call the wire refused is a failed Send', async () => {
    const host = appSheetHost(SHOWN, fake.client);
    const lines = [{ v: 1 as const, key: host.newKey(), kind: 'dismiss' as const, id: 'q4', by: 'maws' as const }];
    expect(lines[0]!.key).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    const sent = host.send(SESSION, lines);
    expect(fake.invoked('sheet.put')).toEqual([{ session: SESSION, lines }]);
    await fake.reply('sheet.put', { ok: true, results: [{ key: lines[0]!.key, state: 'queued' }] });
    expect(await sent).toEqual({ ok: true, results: [{ key: lines[0]!.key, state: 'queued' }] });
    const refused = host.send(SESSION, lines);
    await fake.fail('sheet.put', 'the machine is restarting', 'host_unavailable');
    expect(await refused).toEqual({ ok: false, why: 'failed', message: 'the machine is restarting' });
  });

  it('reads a body through sheet.body, and a body the wire could not bring as gone', async () => {
    const host = appSheetHost(SHOWN, fake.client);
    const read = host.body(SESSION, { ref: 'a'.repeat(64) });
    await fake.reply('sheet.body', { kind: 'text', text: 'line one' });
    expect(await read).toEqual({ kind: 'text', text: 'line one' });
    const lost = host.body(SESSION, { ref: 'a'.repeat(64) });
    await fake.fail('sheet.body');
    expect(await lost).toEqual({ kind: 'gone' });
  });
});


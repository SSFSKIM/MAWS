// A message to the person where MAWS draws it (UX wave U2b; the execution document, A12 and M2): the mod's drawing,
// reproduced. A bold `● message` label in the accent colour over the body in the normal text colour, indented two
// columns; one drawing for a `<message>` span and for a message-tool call; no bar and no "To you". The label follows
// the mod's `spanRows` (`to-human/hooks/mods/to-human.tsx`, 1411, at 0.8.2) over the engine's own reading of a reply's
// first text (ruling 4: `isFirstOfReply`, which the engine gives every text row of its conversation list; the Decision
// Log of the execution document cites the bundle's lines), tested on recorded sessions. Every other text is invented.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionEvent } from '@shared/graph/events';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../../../../../test/support/fixtures';
import { useTranscriptStore } from '../../stores/transcript';
import { journalToEvents } from '../../transcript/dev/journal';
import { rowId, turnId } from '../../transcript/model/keys';
import type { Row } from '../../transcript/model/rows';
import { tool, uuid } from '../../transcript/model/test-events';
import type { TranscriptSource } from '../../transcript/source/types';
import { Disclosures, NO_ACTIONS, TranscriptProvider, type TranscriptContextValue } from '../../transcript/view/context';
import { AssistantTextRow } from '../../transcript/view/rows/AssistantText';
import { Transcript } from '../../transcript/view/Transcript';
import { assistantPresentation } from '../to-human/Presenter';
import { ToHumanMessageRow } from '../to-human/MessageRow';
import { ReportOnly } from './Message';

afterEach(() => {
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
});

const draw = (text: string, live = false) => render(<>{assistantPresentation(text)?.render({ live })}</>);
const labels = (root: ParentNode = document) => [...root.querySelectorAll('.owner-message-ink > .owner-message-label')].map((label) => label.textContent);
const bodies = (root: ParentNode = document) => [...root.querySelectorAll('.owner-message-ink')].map((ink) => [...ink.children].filter((child) => !child.classList.contains('owner-message-label')).map((child) => child.textContent).join('\n'));

const CONTEXT: TranscriptContextValue = { storeKey: 'message-test', variant: 'session', actions: NO_ACTIONS, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 't' };
const CALL: Extract<Row, { kind: 'to_human' }> = {
  id: rowId.toHuman(tool('c1')), turnId: turnId.ofMessage(uuid('u1')), at: '2026-11-15T10:00:00.000Z', kind: 'to_human', toolUseId: tool('c1'), text: 'Stage **two** is done.', pending: false,
};

describe('the drawing', () => {
  it('a span is its label, then its body in a wrapper indented two columns; no bar, no "To you"', () => {
    const view = draw('<message>The table has **three** columns.</message>');
    const ink = view.container.querySelector('.owner-message-ink')!;
    expect(labels(view.container)).toEqual(['● message']);
    expect(ink.firstElementChild?.classList.contains('owner-message-label')).toBe(true);
    expect(ink.querySelector('.owner-message-label > .owner-message-bullet')?.textContent).toBe('● ');
    expect(bodies(view.container)).toEqual(['The table has three columns.']);
    expect(ink.querySelector('[data-streamdown="strong"]')?.textContent).toBe('three');
    expect(view.container.textContent).not.toContain('To you');
    expect(view.container.querySelector('[data-owner-card], [data-owner-report], button')).toBeNull();
  });

  it('a message-tool call is the same drawing: one wrapper, its label `● message`, its body as Markdown', () => {
    const call = render(<TranscriptProvider value={CONTEXT}><ToHumanMessageRow row={CALL} /></TranscriptProvider>).container;
    const span = draw('<message>Stage **two** is done.</message>').container;
    expect(labels(call)).toEqual(['● message']);
    expect(bodies(call)).toEqual(['Stage two is done.']);
    expect(call.querySelector('[data-to-human-call="c1"] .owner-message-ink [data-streamdown="strong"]')?.textContent).toBe('two');
    // one drawing: the same elements, by class, from the wrapper to the bullet's slot
    const shape = (root: Element) => [...root.querySelectorAll('.owner-message-ink, .owner-message-label, .owner-message-bullet')].map((element) => element.className);
    expect(shape(call)).toEqual(shape(span));
  });

  it('the label is bold in the accent colour, the body in the text colour; the bullet keeps two columns, the body is indented by as many', () => {
    const css = readFileSync(join(__dirname, 'view.css'), 'utf8');
    const rule = (selector: string) => new RegExp(String.raw`(?:^|\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*\{([^}]*)\}`).exec(css)?.[1] ?? '';
    expect(rule('.owner-message-label')).toMatch(/color:\s*var\(--accent\)/);
    expect(rule('.owner-message-label')).toMatch(/font-weight:\s*600/);
    expect(rule('.owner-message-ink')).toMatch(/padding-inline-start:\s*2ch/);
    expect(rule('.owner-message-ink')).toMatch(/color:\s*var\(--fg\)/);
    expect(rule('.owner-message-label')).toMatch(/margin-inline-start:\s*-2ch/);
    expect(rule('.owner-message-bullet')).toMatch(/width:\s*2ch/);
  });
});

describe('the label follows `spanRows`', () => {
  it('a later message of the same text block reads `message`, under the same indent', () => {
    const view = draw('<message>First point.</message>\n\nSome words of the agent’s own.\n\n<message>Second point.</message>');
    expect(labels(view.container)).toEqual(['● message', 'message']);
    expect(view.container.querySelectorAll('.owner-message-bullet')).toHaveLength(2); // the slot stands empty, so `message` keeps its column
    expect(bodies(view.container)).toEqual(['First point.', 'Second point.']);
    expect(view.container.textContent).toContain('Some words of the agent’s own.');
  });

  it('the older marks read as messages, and each run of text under one mark is a message of its own', () => {
    expect(labels(draw('<essential>Keep a backup.</essential>').container)).toEqual(['● message']);
    cleanup();
    const nested = draw('<message>A\n\n<insight>B</insight>\n\nC</message>');
    expect(labels(nested.container)).toEqual(['● message', 'message', 'message']);
    expect(bodies(nested.container)).toEqual(['A', 'B', 'C']);
  });

  it('a message still streaming reads its label and ` …`, its body the text so far; closed, the ` …` goes', () => {
    const row = (markdown: string, live: boolean): Extract<Row, { kind: 'assistant_text' }> => ({ id: 'text:m1:0' as never, turnId: turnId.ofMessage(uuid('u1')), at: '2026-11-15T10:00:00.000Z', kind: 'assistant_text', messageUuid: null, blockIndex: 0, markdown, live, phase: 'answer', model: null });
    const streaming = render(<TranscriptProvider value={CONTEXT}><AssistantTextRow row={row('<message>\nHalfway thr', true)} /></TranscriptProvider>);
    expect(labels(streaming.container)).toEqual(['● message …']);
    expect(bodies(streaming.container)).toEqual(['Halfway thr']);
    expect(streaming.container.textContent).not.toContain('<message>');
    cleanup();
    const both = draw('<message>Done.</message>\n\n<message>Not yet', true);
    expect(labels(both.container)).toEqual(['● message', 'message …']);
    cleanup();
    // a completed text never repairs a message left open: it stays the authored words
    expect(assistantPresentation('<message>unfinished')).toBeNull();
    const ended = render(<TranscriptProvider value={CONTEXT}><AssistantTextRow row={row('<message>\nCut off here', false)} /></TranscriptProvider>);
    expect(labels(ended.container)).toEqual([]);
    expect(ended.container.textContent).toContain('<message>');
  });

  it('a closed stretch’s head draws only its messages (the mirror’s `reportOnly`), each under its label', () => {
    const text = 'Looked at the two files first.\n\n<message>Both files list three entries.</message>\n\nNow the third.';
    const head = render(<ReportOnly value>{assistantPresentation(text)!.render({ live: false })}</ReportOnly>);
    expect(labels(head.container)).toEqual(['● message']);
    expect(head.container.textContent).toBe('● messageBoth files list three entries.');
    cleanup();
    const whole = draw(text);
    expect(whole.container.textContent).toContain('Looked at the two files first.');
    expect(whole.container.textContent).toContain('Now the third.');
  });
});

// Ruling 4 on recorded sessions: the engine (2.1.312 and 2.1.322 alike) gives every text row of its conversation list
// `isFirstOfReply` (`shouldShowDot`), so the first message of every text block reads `● message`, a text block that
// follows a tool call in the same reply included, and only a later message of one block reads `message`.
describe('which message carries the bullet, on recorded replies', () => {
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (this.hasAttribute('data-transcript-scroller')) return 4000;
        if (this.hasAttribute('data-index')) return 40;
        return 0;
      },
    });
  });
  afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

  const journal = (path: string): JournalRow[] => readFileSync(join(FIXTURE_DIR, path), 'utf8').split('\n').filter(Boolean).map((line) => parseJournalRow(JSON.parse(line))) as JournalRow[];
  let keys = 0;
  async function mounted(events: SessionEvent[]) {
    const source: TranscriptSource = { key: `message-fixture-${++keys}`, subscribe: () => () => {}, snapshot: () => Promise.resolve(events) };
    render(<Transcript source={source} variant="session" ownerLane />);
    await waitFor(() => expect(useTranscriptStore.getState().entries[source.key!]?.phase).toBe('live'));
    await act(() => Promise.resolve());
  }

  it('p4-r7-loss-short: two text blocks of one reply, a tool call between them, each a message: both read `● message`', async () => {
    await mounted(journalToEvents(journal('p4/p4-r7-loss-short.jsonl')));
    await waitFor(() => expect(labels()).toEqual(['● message', '● message']));
  });

  it('p2-to-human-converge-s13-new: one text block whose `<to-human>` holds three older marks: `● message`, then `message` three times', async () => {
    await mounted(journalToEvents(journal('pass3/p2-to-human-converge-s13-new.jsonl')));
    await waitFor(() => expect(labels()).toEqual(['● message', 'message', 'message', 'message']));
  });
});

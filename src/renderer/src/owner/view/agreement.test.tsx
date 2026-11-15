// One reading of a text's marks for every reader the renderer has (UX wave U2b, M2's third fix wave; the architect's
// direction of 2026-11-15): which words are a message and which the record's comes from `readMarked`
// (`src/shared/owner/marked.ts`) for the presenter's gate, the full drawing, a closed stretch's head and the mirror
// (`marksOfText`, `holdsMessage`, `liveMarksOf`), completed and streaming alike, and it is the shared grammar's reading
// (`parse`, `parseLive`), which main's marks, previews and channel read, but for a tag after a backslash (text here, a
// tag there; a known difference). Pinned over every recorded string under `spikes/protocol-probe/fixtures/` that holds
// a mark tag, and over invented texts.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MARKED_CASES } from '@shared/owner/marked-cases';
import { readMarked } from '@shared/owner/marked';
import { parse, parseLive } from '@shared/owner/to-human-parser';
import type { Row } from '../../transcript/model/rows';
import { marksOfText } from '../../transcript/model/owner-marks';
import { Markdown } from '../../transcript/view/markdown/Markdown';
import { FIXTURE_DIR } from '../../../../../test/support/fixtures';
import { messageInk } from '../to-human/message-ink';
import { assistantPresentation } from '../to-human/Presenter';
import { holdsMessage, liveMarksOf } from './mirror';
import { ReportOnly } from './Message';

afterEach(cleanup);

const TAG = /<\/?(?:message|to-human|essential|need-input|insight)>/g;
const ESCAPED = /\\<\/?(?:message|to-human|essential|need-input|insight)>/;

// Every distinct string a recorded fixture carries that holds a mark tag: texts, deltas, prompts, tool inputs.
function fixtureTexts(): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') { if (value.search(TAG) !== -1) found.add(value); }
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
  };
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.jsonl') ? [join(dir, entry.name)] : []);
  for (const file of files(FIXTURE_DIR)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.search(TAG) === -1) continue;
      try { walk(JSON.parse(line)); } catch { /* a line that is not JSON holds no recorded string */ }
    }
  }
  return [...found];
}

const INVENTED: readonly string[] = [
  ...MARKED_CASES.map(([, text]) => text),
  '<message>Done.</message> narration <message>Still open', // the review's first reproduction
  '<message>\n```sh\nls\n```</message>', // the second: a closing fence glued to the closer
  '<message>\n```sh\nls\n```</message>\nNarration after the fence.', // the same, with narration after it
  'Narration </message> <message>Kept.</message>',
  '<message>a<insight>b</insight>c</message>',
  '<message>a<insight>b</message>c</insight>',
  '<need-input>Which tone?\n<choice recommended>Concise</choice>\n<choice>Friendly</choice></need-input> narration',
  'Use \\<message>escaped\\</message> literally. <message>Real.</message>',
  '- Narration <message>Across\n- rows</message> narration.',
  'Plain words with no mark.',
];
const FIXTURES = fixtureTexts();

// The words of a reading's messages, as a sorted multiset of their characters: what a reader takes for a message,
// whatever runs it cuts them into and wherever a question's options go; whitespace and `choice` tags aside.
const words = (texts: readonly string[]) => [...texts.join('').replace(/<\/?choice(?: recommended)?>/g, '').replace(/\s+/g, '')].sort().join('');
const stripped = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, '');
const textRow = (markdown: string, live: boolean): Extract<Row, { kind: 'assistant_text' }> => ({ id: 'text:m1:0' as never, turnId: null, at: '2026-11-15T10:00:00.000Z', kind: 'assistant_text', messageUuid: null, blockIndex: 0, markdown, live, phase: 'answer', model: null });

function agreeOn(text: string) {
  for (const live of [false, true]) {
    const reading = readMarked(text, live);
    const spans = reading.spans.map((span) => span.text);
    const marked = spans.length > 0;
    // main's reading: the shared grammar's parts, but for a tag after a backslash (a known difference)
    if (!ESCAPED.test(text)) {
      const parts = live ? parseLive(text) : parse(text);
      const messages = parts.filter((part) => part.kind !== 'plain').map((part) => part.text + (('choices' in part && part.choices) ? part.choices.map((choice) => choice.text).join('') : ''));
      expect(words(messages), `shared messages (live=${live})`).toBe(words(spans));
      expect(parts.some((part) => part.kind === 'plain' && part.text.trim() !== ''), `shared record (live=${live})`).toBe(reading.hasRecord);
    }
    // the mirror's readers
    const marks = marksOfText(text, live);
    expect([marks.marked, marks.unmarked], `marksOfText (live=${live})`).toEqual([marked, reading.hasRecord]);
    if (live) expect(liveMarksOf('', [textRow(text, true)]) !== '', 'liveMarksOf').toBe(marked);
    else expect(holdsMessage([textRow(text, false)]), 'holdsMessage').toBe(marked);
    // the presenter's gate
    expect(assistantPresentation(text, live) !== null, `the gate (live=${live})`).toBe(marked);
  }
  const { spans, tags } = readMarked(text);
  if (spans.length === 0) return;
  // the closed head: exactly the spans, each drawn as its own Markdown
  const head = render(<ReportOnly value>{assistantPresentation(text)!.render({ live: false })}</ReportOnly>);
  const inks = [...head.container.querySelectorAll('.owner-message-ink')];
  expect(inks.length, 'the closed head’s messages').toBe(spans.length);
  const alone = spans.map((span) => {
    const view = render(<Markdown markdown={span.text} live={false} decorate={messageInk} />);
    const drawn = stripped(view.container.textContent);
    view.unmount();
    return drawn;
  });
  expect(inks.map((ink) => stripped([...ink.children].slice(1).map((child) => child.textContent).join(''))), 'the closed head’s words').toEqual(alone);
  cleanup();
  // the full drawing: every span inside a message's wrapper, in order, and every tag the reading takes out of sight
  const full = render(<>{assistantPresentation(text)!.render({ live: false })}</>);
  const inside = stripped([...full.container.querySelectorAll('.owner-message-ink')].map((ink) => ink.textContent).join(''));
  let from = 0;
  for (const drawn of alone) {
    const at = inside.indexOf(drawn, from);
    expect(at, `the full drawing holds “${drawn.slice(0, 40)}” inside a message`).not.toBe(-1);
    from = at + drawn.length;
  }
  if (!/&lt;|&#60;|<!--/.test(text)) expect((full.container.textContent ?? '').match(TAG)?.length ?? 0, 'the tags left literal').toBe((text.match(TAG)?.length ?? 0) - tags.length);
  cleanup();
}

describe('one reading of the marks for every reader', () => {
  it('finds the recorded to-human texts', () => {
    expect(FIXTURES.length).toBeGreaterThan(50);
  });
  it.each(INVENTED.map((text) => [text.slice(0, 60), text]))('agrees on the invented text %j', (_name, text) => agreeOn(text));
  it('agrees on every recorded to-human text', () => {
    for (const text of FIXTURES) agreeOn(text);
  });
});

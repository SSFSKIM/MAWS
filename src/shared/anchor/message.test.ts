// The text the agent receives for an anchored comment (X10's serialisation; E3 execution document, Design §2 and
// Interfaces "The agent-facing text"): the exact strings M0 sent the live engine, the round trip for every kind and both
// destinations, and the look-alikes that stay text.
import { describe, expect, it } from 'vitest';
import { loadJournal } from '../../../test/support/fixtures';
import { AnchorSchema, type Anchor } from './anchor';
import { anchoredMessage, anchorLead, anchorTag, parseAnchoredText, promotionMessage, SIDE_THREAD_PREAMBLE, type Destination } from './message';

const fileLine: Anchor = { kind: 'file-line', locator: '/abs/src/x.ts#L42', label: 'src/x.ts:42', path: '/abs/src/x.ts', line: 42 };
const ANCHORS: Anchor[] = [
  fileLine,
  { kind: 'pr-line', locator: 'https://github.com/o/r/pull/9/files#diff-abcR12', label: 'app.ts:12', pageUrl: 'https://github.com/o/r/pull/9/files', path: 'src/app.ts', line: 12, side: 'new', prNumber: 9 },
  { kind: 'browser-element', locator: 'main > button.save', label: 'Save button', pageUrl: 'http://localhost:5173/settings' },
  { kind: 'artifact-element', locator: '#chart-2', label: 'Revenue chart', pageUrl: 'maws-artifact://report.html' },
  { kind: 'artifact-element', locator: '#chart-2', label: 'Revenue chart' },
  { kind: 'none', locator: 'btw', label: 'Side question' },
];

describe('the anchored message (X10)', () => {
  it('is byte for byte what M0 sent the engine: the side thread’s first prompt and the screenshot steer to main', () => {
    const fork = loadJournal('pass3', 'p1-side-thread-live-fork').find((row) => row.seq === 4)!.frame as { anchor: unknown; firstPrompt: string };
    const anchor = AnchorSchema.parse(fork.anchor);
    const text = 'What word did I ask you to remember? Answer with just the word.';
    expect(anchoredMessage({ anchor, text, destination: 'thread', screenshot: false })).toBe(fork.firstPrompt);

    const steer = loadJournal('pass3', 'p1-side-thread-live').find((row) => row.seq === 68)!.frame as { message: { content: { type: string; text?: string }[] } };
    const sent = steer.message.content.find((block) => block.type === 'text')!.text!;
    expect(anchoredMessage({ anchor, text: 'When the command has finished, end your reply with the word I asked you to remember.', destination: 'main', screenshot: true })).toBe(sent);
  });

  it('writes the lead line per kind, the label always quoted', () => {
    expect(ANCHORS.map((anchor) => anchorLead(anchor, false))).toEqual([
      'Comment on "src/x.ts:42" (file /abs/src/x.ts, line 42):',
      'Comment on "app.ts:12" (PR #9, src/app.ts line 12, new side, https://github.com/o/r/pull/9/files):',
      'Comment on "Save button" (element main > button.save on http://localhost:5173/settings):',
      'Comment on "Revenue chart" (element #chart-2 in the artifact, maws-artifact://report.html):',
      'Comment on "Revenue chart" (element #chart-2 in the artifact):',
      'Comment:',
    ]);
    expect(anchorLead(fileLine, true)).toBe('Comment on "src/x.ts:42" (file /abs/src/x.ts, line 42). A screenshot of it is attached:');
    expect(anchorLead(ANCHORS[5]!, true)).toBe('Comment. A screenshot of it is attached:');
  });

  it('writes the tag’s attributes in the fixed order, escaped, and never the screenshot', () => {
    expect(anchorTag(ANCHORS[1]!)).toBe(
      '<maws_anchor kind="pr-line" label="app.ts:12" locator="https://github.com/o/r/pull/9/files#diff-abcR12" pageUrl="https://github.com/o/r/pull/9/files" path="src/app.ts" line="12" side="new" prNumber="9"/>',
    );
    expect(anchorTag({ ...fileLine, label: 'a "b" & <c>', screenshot: { path: '/u/s.png', width: 2, height: 2 } })).toBe(
      '<maws_anchor kind="file-line" label="a &quot;b&quot; &amp; &lt;c&gt;" locator="/abs/src/x.ts#L42" path="/abs/src/x.ts" line="42"/>',
    );
  });

  it('round-trips every kind, both destinations, with and without a screenshot', () => {
    const text = 'Why is this null-checked twice?\n\nThe second check looks dead.';
    for (const anchor of ANCHORS) {
      for (const destination of ['thread', 'main'] as Destination[]) {
        for (const screenshot of [false, true]) {
          const message = anchoredMessage({ anchor: screenshot ? { ...anchor, screenshot: { path: '/u/s.png', width: 4, height: 4 } } : anchor, text: `  ${text}\n`, destination, screenshot });
          expect(parseAnchoredText(message), `${anchor.kind} ${destination} ${screenshot}`).toEqual({ anchor, text, destination });
        }
      }
    }
  });

  it('round-trips escaped attribute values', () => {
    const anchor: Anchor = { ...fileLine, label: 'a "b" & <c>', path: '/abs/<odd> & "dir"/x.ts' };
    expect(parseAnchoredText(anchoredMessage({ anchor, text: 'hm', destination: 'main', screenshot: false }))).toEqual({ anchor, text: 'hm', destination: 'main' });
  });

  it('keeps look-alikes as text: a tag not on the last line, a malformed tag, a lead line without a tag', () => {
    expect(parseAnchoredText('Look: <maws_anchor kind="x"/> here')).toBeNull();
    expect(parseAnchoredText(`${anchorTag(fileLine)}\nand then more words`)).toBeNull();
    expect(parseAnchoredText('Comment on "src/x.ts:42" (file /abs/src/x.ts, line 42):\nhello')).toBeNull();
    expect(parseAnchoredText('hello\n\n<maws_anchor kind="x" label="a" locator="b"/>')).toBeNull(); // not an anchor kind
    expect(parseAnchoredText('hello\n\n<maws_anchor label="a" kind="file-line" locator="b"/>')).toBeNull(); // not the written order
    expect(parseAnchoredText('hello\n\n<maws_anchor kind="file-line" label="a" locator="b" line="07"/>')).toBeNull(); // not as written
    expect(parseAnchoredText('hello\n\n<maws_anchor kind="file-line" label="a" locator="b" colour="red"/>')).toBeNull(); // an unknown attribute
    expect(parseAnchoredText('hello\n\n<maws_anchor kind="file-line" label="a" locator="b">')).toBeNull(); // not self-closing
    expect(parseAnchoredText('')).toBeNull();
  });

  it('keeps a lead line that does not match its tag as text, and then cannot tell the destination', () => {
    const tag = anchorTag(fileLine);
    expect(parseAnchoredText(`Comment on "other.ts:1" (file /abs/other.ts, line 1):\nhello\n\n${tag}`)).toEqual({
      anchor: fileLine,
      text: 'Comment on "other.ts:1" (file /abs/other.ts, line 1):\nhello',
      destination: null,
    });
  });

  // M1's review: the preamble is checked on its own, so a thread's prompt whose lead an older wording wrote still reads
  // as a thread's (the lead stays as text), and its comment is not shown with the preamble glued to it
  it('strips the preamble on its own exact match when the lead does not match, and reads the destination as a thread', () => {
    const tag = anchorTag(fileLine);
    expect(parseAnchoredText(`Comment about src/x.ts:42:\nhello\n\n${SIDE_THREAD_PREAMBLE}\n\n${tag}`)).toEqual({
      anchor: fileLine,
      text: 'Comment about src/x.ts:42:\nhello',
      destination: 'thread',
    });
    // a preamble that is not its own paragraph stays text
    expect(parseAnchoredText(`Comment about src/x.ts:42:\nhello ${SIDE_THREAD_PREAMBLE}\n\n${tag}`)?.destination).toBeNull();
  });

  it('writes the promotion of side questions as a thread’s first prompt, parsed as an anchorless comment', () => {
    const exchanges = [
      { question: 'What word did I ask you to remember?', response: 'ZEBRA' },
      { question: 'Why?', response: 'You asked.' },
    ];
    const message = promotionMessage(exchanges, null);
    expect(message).toBe(
      [
        'This side thread continues side questions the user asked beside the main conversation. The exchange so far:',
        '',
        'Q: What word did I ask you to remember?',
        'A: ZEBRA',
        '',
        'Q: Why?',
        'A: You asked.',
        '',
        'Continue from here.',
        '',
        '<maws_anchor kind="none" label="Side question" locator="btw"/>',
      ].join('\n'),
    );
    expect(promotionMessage(exchanges.slice(0, 1), '  Now spell it backwards. ').split('\n').slice(-3)).toEqual(['Now spell it backwards.', '', '<maws_anchor kind="none" label="Side question" locator="btw"/>']);
    expect(parseAnchoredText(message)).toEqual({ anchor: { kind: 'none', label: 'Side question', locator: 'btw' }, text: message.slice(0, message.lastIndexOf('\n\n')), destination: null });
  });

  it('names the preamble the side thread’s prompt carries', () => {
    expect(anchoredMessage({ anchor: fileLine, text: 'x', destination: 'thread', screenshot: false })).toContain(`\n\n${SIDE_THREAD_PREAMBLE}\n\n<maws_anchor`);
    expect(anchoredMessage({ anchor: fileLine, text: 'x', destination: 'main', screenshot: false })).not.toContain(SIDE_THREAD_PREAMBLE);
  });
});

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

  // E4d start: the browser-element fields in the tag (E4d execution document, Design §6): appended in X10's order, the
  // box as one `x,y,width,height` attribute, `a11y` read back through the widened attribute-name grammar
  describe('browser-element (E4d)', () => {
    const element: Anchor = {
      kind: 'browser-element',
      locator: '#increment',
      label: 'button “Increment”',
      pageUrl: 'http://127.0.0.1:4321/comment.html',
      css: '#increment',
      role: 'button',
      name: 'Increment',
      a11y: 'main > region “A form” > button “Increment”',
      box: { x: 248, y: 312, width: 96, height: 30 },
    };
    const TAG = '<maws_anchor kind="browser-element" label="button “Increment”" locator="#increment" pageUrl="http://127.0.0.1:4321/comment.html" css="#increment" role="button" name="Increment" a11y="main &gt; region “A form” &gt; button “Increment”" box="248,312,96,30"/>';

    it('writes the design’s tag, byte for byte, and the lead unchanged', () => {
      expect(anchorTag(element)).toBe(TAG);
      expect(anchoredMessage({ anchor: { ...element, screenshot: { path: '/u/browser/crops/b.png', width: 192, height: 60 } }, text: 'Make this the primary button.', destination: 'thread', screenshot: true })).toBe(
        [
          'Comment on "button “Increment”" (element #increment on http://127.0.0.1:4321/comment.html). A screenshot of it is attached:',
          'Make this the primary button.',
          '',
          SIDE_THREAD_PREAMBLE,
          '',
          TAG,
        ].join('\n'),
      );
    });

    it('a tag carrying `a11y` parses (the attribute-name grammar admits a digit after the first letter)', () => {
      expect(parseAnchoredText(`hello\n\n${TAG}`)?.anchor).toEqual(element);
    });

    it('round-trips a full anchor, a child-combinator css and a negative box, both destinations, with and without a screenshot', () => {
      const anchors: Anchor[] = [
        element,
        { ...element, locator: 'body > main > section:nth-of-type(2) > ul', css: 'body > main > section:nth-of-type(2) > ul', role: 'list', name: undefined, label: 'list', a11y: 'main > list', box: { x: -4, y: 0, width: 640, height: 1 } },
        { kind: 'browser-element', locator: '#\\37  > a', label: 'a', css: '#\\37  > a' },
      ].map((anchor) => AnchorSchema.parse(anchor));
      for (const anchor of anchors)
        for (const destination of ['thread', 'main'] as Destination[])
          for (const screenshot of [false, true]) {
            const message = anchoredMessage({ anchor: screenshot ? { ...anchor, screenshot: { path: '/u/s.png', width: 4, height: 4 } } : anchor, text: 'Why so wide?', destination, screenshot });
            expect(parseAnchoredText(message), `${anchor.css} ${destination} ${screenshot}`).toEqual({ anchor, text: 'Why so wide?', destination });
          }
    });

    it('keeps a malformed or reordered tag as text', () => {
      for (const box of ['1,2,3', 'a,b,c,d', '1,2,3,4,5', '1, 2,3,4', '1,2,0,4', '1,2,-3,4', '01,2,3,4', '1.5,2,3,4', ''])
        expect(parseAnchoredText(`hello\n\n${TAG.replace('box="248,312,96,30"', `box="${box}"`)}`), box).toBeNull();
      expect(parseAnchoredText(`hello\n\n${TAG.replace(' css="#increment" role="button"', ' role="button" css="#increment"')}`)).toBeNull(); // not the written order
      expect(parseAnchoredText(`hello\n\n${TAG.replace(' a11y=', ' a1y=')}`)).toBeNull(); // an unknown attribute
      expect(parseAnchoredText(`hello\n\n${TAG.replace(' a11y=', ' 1ally=')}`)).toBeNull(); // an attribute name starts with a letter
    });
  });
  // E4d end

  // P3-B start: the document comment (docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D9; ledger X26's X10
  // amendment): the kind `artifact-comment`, its two fields appended to the tag's order after E4d's, so every older tag
  // keeps its bytes; the lead names the document and tab (the label), the quoted passage (the locator) and the two ids
  // the agent's tools take
  describe('artifact-comment (P3-B)', () => {
    const comment: Anchor = { kind: 'artifact-comment', locator: 'ships quarterly with "design" review', label: 'Q3 plan, Main', artifactId: 'art-7f3a', threadId: 'k2m9x0qa' };
    const TAG = '<maws_anchor kind="artifact-comment" label="Q3 plan, Main" locator="ships quarterly with &quot;design&quot; review" artifactId="art-7f3a" threadId="k2m9x0qa"/>';

    it('writes the tag byte for byte, the ids last', () => {
      expect(anchorTag(comment)).toBe(TAG);
    });

    it('writes a lead naming the document and tab, the passage and the ids', () => {
      expect(anchorLead(comment, false)).toBe('Comment on "Q3 plan, Main" (passage "ships quarterly with "design" review" in document art-7f3a, thread k2m9x0qa):');
      const { artifactId: _a, threadId: _t, ...bare } = comment;
      expect(anchorLead(bare, false)).toBe('Comment on "Q3 plan, Main" (passage "ships quarterly with "design" review"):');
    });

    it('round-trips both destinations, with and without a screenshot', () => {
      for (const destination of ['thread', 'main'] as Destination[])
        for (const screenshot of [false, true]) {
          const message = anchoredMessage({ anchor: screenshot ? { ...comment, screenshot: { path: '/u/s.png', width: 4, height: 4 } } : comment, text: 'Should this be monthly?', destination, screenshot });
          expect(parseAnchoredText(message), `${destination} ${screenshot}`).toEqual({ anchor: comment, text: 'Should this be monthly?', destination });
        }
    });

    it('keeps a reordered tag, or an id with a control character, as text', () => {
      expect(parseAnchoredText(`hello\n\n${TAG.replace(' artifactId="art-7f3a" threadId="k2m9x0qa"', ' threadId="k2m9x0qa" artifactId="art-7f3a"')}`)).toBeNull();
      expect(parseAnchoredText(`hello\n\n${TAG.replace('threadId="k2m9x0qa"', 'threadId="k2m9\tx0qa"')}`)).toBeNull();
    });

    it('leaves every other kind’s tag as it was', () => {
      for (const anchor of ANCHORS) expect(anchorTag(anchor)).not.toMatch(/artifactId|threadId/);
    });
  });
  // P3-B end

  it('names the preamble the side thread’s prompt carries', () => {
    expect(anchoredMessage({ anchor: fileLine, text: 'x', destination: 'thread', screenshot: false })).toContain(`\n\n${SIDE_THREAD_PREAMBLE}\n\n<maws_anchor`);
    expect(anchoredMessage({ anchor: fileLine, text: 'x', destination: 'main', screenshot: false })).not.toContain(SIDE_THREAD_PREAMBLE);
  });
});

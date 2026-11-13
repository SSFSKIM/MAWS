// The text the agent receives for an anchored comment (X10's serialisation; E3 execution document, Design §2 and
// Interfaces "The agent-facing text"): the exact strings M0 sent the live engine, the round trip for every kind and both
// destinations, and the look-alikes that stay text.
import { describe, expect, it } from 'vitest';
import { loadJournal } from '../../../test/support/fixtures';
import { AnchorSchema, type Anchor } from './anchor';
import { anchoredMessage, anchorLead, anchorTag, commentsMessage, promotionMessage, readAnchoredMessage, readOneComment, SIDE_THREAD_PREAMBLE, SIDE_THREAD_PREAMBLE_MANY, type Destination, type MessageComment } from './message'; // UX wave U5a: the message of several comments

// UX wave U5a (decision 15): a message of one comment as `readAnchoredMessage` reads it, in the one comment's shape
// (`{ anchor, text, destination }`); a message read as several comments throws, since none of these cases writes one
const one = (message: string): { anchor: Anchor; text: string; destination: Destination | null } | null => {
  const read = readAnchoredMessage(message);
  if (read === null) return null;
  if (read.comments.length !== 1) throw new Error(`read as ${read.comments.length} comments: ${JSON.stringify(message)}`);
  const [{ anchor, text }] = read.comments as [MessageComment];
  return { anchor, text, destination: read.destination };
};

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
          expect(one(message), `${anchor.kind} ${destination} ${screenshot}`).toEqual({ anchor, text, destination });
        }
      }
    }
  });

  it('round-trips escaped attribute values', () => {
    const anchor: Anchor = { ...fileLine, label: 'a "b" & <c>', path: '/abs/<odd> & "dir"/x.ts' };
    expect(one(anchoredMessage({ anchor, text: 'hm', destination: 'main', screenshot: false }))).toEqual({ anchor, text: 'hm', destination: 'main' });
  });

  it('keeps look-alikes as text: a tag not on the last line, a malformed tag, a lead line without a tag', () => {
    expect(one('Look: <maws_anchor kind="x"/> here')).toBeNull();
    expect(one(`${anchorTag(fileLine)}\nand then more words`)).toBeNull();
    expect(one('Comment on "src/x.ts:42" (file /abs/src/x.ts, line 42):\nhello')).toBeNull();
    expect(one('hello\n\n<maws_anchor kind="x" label="a" locator="b"/>')).toBeNull(); // not an anchor kind
    expect(one('hello\n\n<maws_anchor label="a" kind="file-line" locator="b"/>')).toBeNull(); // not the written order
    expect(one('hello\n\n<maws_anchor kind="file-line" label="a" locator="b" line="07"/>')).toBeNull(); // not as written
    expect(one('hello\n\n<maws_anchor kind="file-line" label="a" locator="b" colour="red"/>')).toBeNull(); // an unknown attribute
    expect(one('hello\n\n<maws_anchor kind="file-line" label="a" locator="b">')).toBeNull(); // not self-closing
    expect(one('')).toBeNull();
  });

  it('keeps a lead line that does not match its tag as text, and then cannot tell the destination', () => {
    const tag = anchorTag(fileLine);
    expect(one(`Comment on "other.ts:1" (file /abs/other.ts, line 1):\nhello\n\n${tag}`)).toEqual({
      anchor: fileLine,
      text: 'Comment on "other.ts:1" (file /abs/other.ts, line 1):\nhello',
      destination: null,
    });
  });

  // M1's review: the preamble is checked on its own, so a thread's prompt whose lead an older wording wrote still reads
  // as a thread's (the lead stays as text), and its comment is not shown with the preamble glued to it
  it('strips the preamble on its own exact match when the lead does not match, and reads the destination as a thread', () => {
    const tag = anchorTag(fileLine);
    expect(one(`Comment about src/x.ts:42:\nhello\n\n${SIDE_THREAD_PREAMBLE}\n\n${tag}`)).toEqual({
      anchor: fileLine,
      text: 'Comment about src/x.ts:42:\nhello',
      destination: 'thread',
    });
    // a preamble that is not its own paragraph stays text
    expect(one(`Comment about src/x.ts:42:\nhello ${SIDE_THREAD_PREAMBLE}\n\n${tag}`)?.destination).toBeNull();
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
    expect(one(message)).toEqual({ anchor: { kind: 'none', label: 'Side question', locator: 'btw' }, text: message.slice(0, message.lastIndexOf('\n\n')), destination: null });
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
      expect(one(`hello\n\n${TAG}`)?.anchor).toEqual(element);
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
            expect(one(message), `${anchor.css} ${destination} ${screenshot}`).toEqual({ anchor, text: 'Why so wide?', destination });
          }
    });

    it('keeps a malformed or reordered tag as text', () => {
      for (const box of ['1,2,3', 'a,b,c,d', '1,2,3,4,5', '1, 2,3,4', '1,2,0,4', '1,2,-3,4', '01,2,3,4', '1.5,2,3,4', ''])
        expect(one(`hello\n\n${TAG.replace('box="248,312,96,30"', `box="${box}"`)}`), box).toBeNull();
      expect(one(`hello\n\n${TAG.replace(' css="#increment" role="button"', ' role="button" css="#increment"')}`)).toBeNull(); // not the written order
      expect(one(`hello\n\n${TAG.replace(' a11y=', ' a1y=')}`)).toBeNull(); // an unknown attribute
      expect(one(`hello\n\n${TAG.replace(' a11y=', ' 1ally=')}`)).toBeNull(); // an attribute name starts with a letter
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
      expect(anchorLead({ kind: comment.kind, label: comment.label, locator: comment.locator }, false)).toBe('Comment on "Q3 plan, Main" (passage "ships quarterly with "design" review"):');
    });

    it('round-trips both destinations, with and without a screenshot', () => {
      for (const destination of ['thread', 'main'] as Destination[])
        for (const screenshot of [false, true]) {
          const message = anchoredMessage({ anchor: screenshot ? { ...comment, screenshot: { path: '/u/s.png', width: 4, height: 4 } } : comment, text: 'Should this be monthly?', destination, screenshot });
          expect(one(message), `${destination} ${screenshot}`).toEqual({ anchor: comment, text: 'Should this be monthly?', destination });
        }
    });

    it('keeps a reordered tag, or an id with a control character, as text', () => {
      expect(one(`hello\n\n${TAG.replace(' artifactId="art-7f3a" threadId="k2m9x0qa"', ' threadId="k2m9x0qa" artifactId="art-7f3a"')}`)).toBeNull();
      expect(one(`hello\n\n${TAG.replace('threadId="k2m9x0qa"', 'threadId="k2m9\tx0qa"')}`)).toBeNull();
    });

    it('leaves every other kind’s tag as it was', () => {
      for (const anchor of ANCHORS) expect(anchorTag(anchor)).not.toMatch(/artifactId|threadId/);
    });

    // P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M7 fix wave 1; Decision Log 33, 35, 36): the lead by the
    // commented artifact's kind; a document's, with or without the field, is B's to the byte
    it('writes a deck element’s lead from the kind’s entry, with no slide number, and round-trips it (Decision Log 36)', () => {
      const deck: Anchor = { kind: 'artifact-comment', locator: 'One path', label: 'Q3 review, slide 3: Plan', artifactId: 'art-9', threadId: 't1', artifactKind: 'presentation' };
      expect(anchorTag(deck)).toBe('<maws_anchor kind="artifact-comment" label="Q3 review, slide 3: Plan" locator="One path" artifactId="art-9" threadId="t1" artifactKind="presentation"/>');
      expect(anchorLead(deck, false)).toBe('Comment on "Q3 review, slide 3: Plan" (element "One path" in presentation art-9, thread t1):');
      const message = anchoredMessage({ anchor: deck, text: 'Shorter?', destination: 'thread', screenshot: false });
      expect(one(message)).toEqual({ anchor: deck, text: 'Shorter?', destination: 'thread' });
      const long = { ...deck, label: `${'T'.repeat(190)}, slide 3: Plan`.slice(0, 200) };
      expect(anchorLead(long, false)).toBe(`Comment on "${long.label}" (element "One path" in presentation art-9, thread t1):`); // nothing read from the label
      expect(anchorLead({ ...comment, artifactKind: 'document' }, false)).toBe(anchorLead(comment, false));
      expect(anchorLead(comment, false)).toBe('Comment on "Q3 plan, Main" (passage "ships quarterly with "design" review" in document art-7f3a, thread k2m9x0qa):');
      expect(anchorTag(comment)).toBe(TAG); // a document's anchor carries no field
    });

    // P3-E (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the P3-E spec's Decision Log 12): a design's
    // comment names its target, a board or an element, through the anchor's `artifactTarget`; absent, an element's
    it('writes a design board’s and element’s leads from `artifactTarget`, round-trips both, and leaves every other tag unchanged', () => {
      const board: Anchor = { kind: 'artifact-comment', locator: 'Phone', label: 'Launch screens, Phone', artifactId: 'art-d1', threadId: 't2', artifactKind: 'design', artifactTarget: 'board' };
      expect(anchorTag(board)).toBe('<maws_anchor kind="artifact-comment" label="Launch screens, Phone" locator="Phone" artifactId="art-d1" threadId="t2" artifactKind="design" artifactTarget="board"/>');
      expect(anchorLead(board, false)).toBe('Comment on "Launch screens, Phone" (board "Phone" in design art-d1, thread t2):');
      const element: Anchor = { ...board, locator: 'Ship the first week.', artifactTarget: 'element' };
      expect(anchorLead(element, false)).toBe('Comment on "Launch screens, Phone" (element "Ship the first week." in design art-d1, thread t2):');
      const unnamed: Anchor = { kind: 'artifact-comment', locator: element.locator, label: element.label, artifactId: 'art-d1', threadId: 't2', artifactKind: 'design' };
      expect(anchorLead(unnamed, false)).toBe(anchorLead(element, false)); // absent: an element's
      for (const anchor of [board, element, unnamed]) {
        const message = anchoredMessage({ anchor, text: 'Tighter?', destination: 'main', screenshot: false });
        expect(one(message)).toEqual({ anchor, text: 'Tighter?', destination: 'main' });
      }
      expect(AnchorSchema.safeParse({ ...board, artifactTarget: 'slide' }).success).toBe(false);
      expect(anchorTag(comment)).toBe(TAG);
      for (const anchor of ANCHORS) expect(anchorTag(anchor)).not.toMatch(/artifactTarget/);
    });
  });
  // P3-B end

  it('names the preamble the side thread’s prompt carries', () => {
    expect(anchoredMessage({ anchor: fileLine, text: 'x', destination: 'thread', screenshot: false })).toContain(`\n\n${SIDE_THREAD_PREAMBLE}\n\n<maws_anchor`);
    expect(anchoredMessage({ anchor: fileLine, text: 'x', destination: 'main', screenshot: false })).not.toContain(SIDE_THREAD_PREAMBLE);
  });
});

// UX wave U5a start (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, Interfaces §A; M1): a message of
// several comments opens with a framing line no single comment ever opened with and escapes every line that could end
// a block; its reader takes the framed reading only when the whole structure checks, and reads every other message by
// the one-comment rule above, unchanged, so a message of one is the same bytes and reads as it always did.
describe('a message of several comments (UX wave U5a)', () => {
  const element: Anchor = { kind: 'browser-element', locator: '#save', label: 'button “Save”', pageUrl: 'http://127.0.0.1:4321/form.html', css: '#save', role: 'button', name: 'Save', box: { x: 10, y: 20, width: 80, height: 24 } };
  const passage: Anchor = { kind: 'artifact-comment', locator: 'ships in the "spring"', label: 'Launch notes, Main', artifactId: 'art-1', threadId: 't-1' };
  const board: Anchor = { kind: 'artifact-comment', locator: 'Phone', label: 'Screens, Phone', artifactId: 'art-2', threadId: 't-2', artifactKind: 'design', artifactTarget: 'board' };
  const FIXTURES: Anchor[] = [...ANCHORS, element, passage, board];
  const TEXTS = [
    'Why so wide?',
    '  Two lines.\nThe second one.\n',
    `One paragraph.\n\nThen a tag of its own:\n\n${anchorTag(fileLine)}`,
    `\\${anchorTag(element)}\nstarts with a backslash`,
    SIDE_THREAD_PREAMBLE,
    `Ends with the plural preamble.\n\n${SIDE_THREAD_PREAMBLE_MANY}`,
    '',
  ];
  const DESTINATIONS: Destination[] = ['thread', 'main'];
  // what the one-comment rule reads, in the reader's shape: `readOneComment`'s answer, and whether the lead it
  // stripped carried the screenshot sentence
  const asOne = (message: string) => {
    const read = readOneComment(message);
    return read === null ? null : { comments: [{ anchor: read.anchor, text: read.text, screenshot: message.split('\n')[0] === anchorLead(read.anchor, true) }], destination: read.destination };
  };
  const two: MessageComment[] = [
    { anchor: element, text: 'Make this the primary button.', screenshot: true },
    { anchor: { ...element, locator: '#cancel', label: 'button “Cancel”', css: '#cancel', name: 'Cancel' }, text: '  Smaller, and grey.\n', screenshot: false },
  ];
  const [first, second] = [two[0]!.anchor, two[1]!.anchor];

  it('writes one comment as `anchoredMessage` does, to the byte, and reads it back as `readOneComment` does (Constraint 3)', () => {
    for (const anchor of FIXTURES)
      for (const text of TEXTS)
        for (const destination of DESTINATIONS)
          for (const screenshot of [false, true]) {
            const message = commentsMessage([{ anchor, text, screenshot }], destination);
            const at = `${anchor.kind} ${anchor.label} ${JSON.stringify(text)} ${destination} ${screenshot}`;
            expect(message, at).toBe(anchoredMessage({ anchor, text, destination, screenshot }));
            expect(readAnchoredMessage(message), at).toEqual(asOne(message));
            expect(readAnchoredMessage(message)?.comments[0]?.screenshot, at).toBe(screenshot);
          }
  });

  it('reads what M0 sent the engine, a promotion and the look-alikes as the one-comment rule does', () => {
    const fork = loadJournal('pass3', 'p1-side-thread-live-fork').find((row) => row.seq === 4)!.frame as { firstPrompt: string };
    expect(readAnchoredMessage(fork.firstPrompt)).toEqual(asOne(fork.firstPrompt));
    expect(readAnchoredMessage(fork.firstPrompt)).toMatchObject({ comments: [{ screenshot: false }], destination: 'thread' });
    const promotion = promotionMessage([{ question: 'What word?', response: 'ZEBRA' }], null);
    expect(readAnchoredMessage(promotion)).toEqual({ comments: [{ anchor: { kind: 'none', label: 'Side question', locator: 'btw' }, text: promotion.slice(0, promotion.lastIndexOf('\n\n')), screenshot: false }], destination: null });
    for (const text of ['', 'Look: <maws_anchor kind="x"/> here', `${anchorTag(fileLine)}\nand then more words`, 'Comment on "src/x.ts:42" (file /abs/src/x.ts, line 42):\nhello'])
      expect(readAnchoredMessage(text), text).toBeNull();
  });

  // The review's counterexample (Decision Log 13): one older comment whose words hold its own tag, a blank line and its
  // own lead is byte for byte the two blocks of two comments on that element, and with no framing line it stays one
  it('reads one comment whose words are two blocks on its own element as that one comment, its text whole', () => {
    const lead = anchorLead(element, false);
    const tag = anchorTag(element);
    const text = `A\n\n${tag}\n\n${lead}\nB`;
    const message = anchoredMessage({ anchor: element, text, destination: 'main', screenshot: false });
    expect(message).toBe([lead, 'A', '', tag, '', lead, 'B', '', tag].join('\n'));
    expect(readAnchoredMessage(message)).toEqual({ comments: [{ anchor: element, text, screenshot: false }], destination: 'main' });
    const framed = commentsMessage([{ anchor: element, text: 'A', screenshot: false }, { anchor: element, text: 'B', screenshot: false }], 'main');
    expect(framed).toBe(`2 comments, in the order made:\n\n${message}`);
    expect(readAnchoredMessage(framed)).toEqual({ comments: [{ anchor: element, text: 'A', screenshot: false }, { anchor: element, text: 'B', screenshot: false }], destination: 'main' });
  });

  it('writes two comments to main: the framing line, then one block a comment, the last line a tag', () => {
    expect(commentsMessage(two, 'main')).toBe(
      [
        '2 comments, in the order made:',
        '',
        anchorLead(first, true),
        'Make this the primary button.',
        '',
        anchorTag(first),
        '',
        anchorLead(second, false),
        'Smaller, and grey.',
        '',
        anchorTag(second),
      ].join('\n'),
    );
    expect(readAnchoredMessage(commentsMessage(two, 'main'))).toEqual({
      comments: [
        { anchor: first, text: 'Make this the primary button.', screenshot: true },
        { anchor: second, text: 'Smaller, and grey.', screenshot: false },
      ],
      destination: 'main',
    });
  });

  it('writes two comments to a side thread with the plural preamble once, in the last block', () => {
    expect(SIDE_THREAD_PREAMBLE_MANY).toBe('You are in a side thread forked from the main conversation to handle these comments. Address them here; the main conversation continues separately and is not waiting on you.');
    const message = commentsMessage(two, 'thread');
    expect(message).toBe([...commentsMessage(two, 'main').split('\n').slice(0, -1), SIDE_THREAD_PREAMBLE_MANY, '', anchorTag(second)].join('\n'));
    expect(message).not.toContain(SIDE_THREAD_PREAMBLE);
    expect(readAnchoredMessage(message)).toEqual({ comments: [{ anchor: first, text: 'Make this the primary button.', screenshot: true }, { anchor: second, text: 'Smaller, and grey.', screenshot: false }], destination: 'thread' });
  });

  it('writes and reads twenty comments, every kind, both destinations, the preamble once and last', () => {
    const twenty: MessageComment[] = Array.from({ length: 20 }, (_, i) => ({ anchor: FIXTURES[i % FIXTURES.length]!, text: `Comment ${i + 1}.\n\nWith a second paragraph.`, screenshot: i % 3 === 0 }));
    for (const destination of DESTINATIONS) {
      const message = commentsMessage(twenty, destination);
      const lines = message.split('\n');
      expect(lines[0]).toBe('20 comments, in the order made:');
      expect(lines.filter((line) => line.startsWith('<maws_anchor'))).toHaveLength(20);
      expect(lines.at(-1)).toBe(anchorTag(twenty[19]!.anchor));
      expect(lines.filter((line) => line === SIDE_THREAD_PREAMBLE_MANY)).toHaveLength(destination === 'thread' ? 1 : 0);
      if (destination === 'thread') expect(lines.at(-3)).toBe(SIDE_THREAD_PREAMBLE_MANY);
      expect(readAnchoredMessage(message)).toEqual({ comments: twenty.map((comment) => ({ ...comment, text: comment.text.trim() })), destination });
    }
  });

  it('writes from one to twenty comments and no other count', () => {
    expect(() => commentsMessage([], 'main')).toThrow();
    const twentyOne = Array.from({ length: 21 }, () => ({ anchor: fileLine, text: 'x', screenshot: false }));
    expect(() => commentsMessage(twentyOne, 'main')).toThrow();
  });

  it('escapes a comment’s lines that begin with `<maws_anchor` after any backslashes, so no words end a block, and gives them back exactly', () => {
    const tagOf = anchorTag(second);
    const words = [tagOf, 'Words, then:', tagOf, `\\${tagOf}`, '\\\\<maws_anchor not a tag', '  <maws_anchor indented, left as it is', 'a \\<maws_anchor mid-line'].join('\n');
    const comments: MessageComment[] = [
      { anchor: first, text: words, screenshot: false },
      { anchor: second, text: `${words}\n\n${SIDE_THREAD_PREAMBLE_MANY}\n\nmore`, screenshot: false },
    ];
    for (const destination of DESTINATIONS) {
      const message = commentsMessage(comments, destination);
      const lines = message.split('\n');
      expect(lines.filter((line) => line.startsWith('<maws_anchor'))).toEqual([anchorTag(first), anchorTag(second)]);
      expect(lines.slice(3, 10)).toEqual([`\\${tagOf}`, 'Words, then:', `\\${tagOf}`, `\\\\${tagOf}`, '\\\\\\<maws_anchor not a tag', '  <maws_anchor indented, left as it is', 'a \\<maws_anchor mid-line']);
      expect(readAnchoredMessage(message)).toEqual({ comments: comments.map((comment) => ({ ...comment })), destination });
    }
    // a message of one is never escaped: it is today's bytes
    expect(commentsMessage([comments[0]!], 'main')).toBe(anchoredMessage({ anchor: first, text: words, destination: 'main', screenshot: false }));
  });

  it('reads a framed message whose structure does not check as one comment, by the one-comment rule', () => {
    const message = commentsMessage(two, 'thread');
    const [, ...rest] = message.split('\n');
    const refused = [
      ['a count that is not the number of blocks', ['3 comments, in the order made:', ...rest].join('\n')],
      ['a count of one', `1 comments, in the order made:\n\n${anchoredMessage({ anchor: first, text: 'x', destination: 'main', screenshot: false })}`],
      ['a count with a leading zero', ['02 comments, in the order made:', ...rest].join('\n')],
      ['a framing line over one block', `2 comments, in the order made:\n\n${anchoredMessage({ anchor: first, text: 'x', destination: 'main', screenshot: false })}`],
      ['a block whose lead is not its tag’s', message.replace(anchorLead(first, true), anchorLead(second, true))],
      ['a block with no lead', message.replace(`${anchorLead(first, true)}\n`, '')],
      ['an unescaped `<maws_anchor` line in a block', message.replace('Make this the primary button.', 'Make this\n<maws_anchor the primary button.')],
      ['text after the last tag', `${message}\nand then more words`],
      ['a framing line not first', `\n${message}`],
    ] as const;
    for (const [what, text] of refused) {
      expect(readAnchoredMessage(text), what).toEqual(asOne(text));
      expect(readAnchoredMessage(text)?.comments.length ?? 0, what).toBeLessThanOrEqual(1);
    }
    expect(readAnchoredMessage(refused[0][1])).toMatchObject({ comments: [{ anchor: second }], destination: null });
    expect(readAnchoredMessage(refused[7][1])).toBeNull(); // the old rule reads no tag on the last line
    const twentyOne = ['21 comments, in the order made:', ...Array.from({ length: 21 }, (_, i) => ['', anchoredMessage({ anchor: fileLine, text: `c${i}`, destination: 'main', screenshot: false })]).flat()].join('\n');
    expect(readAnchoredMessage(twentyOne)).toEqual(asOne(twentyOne));
    // trailing blank lines after the last tag are no text
    expect(readAnchoredMessage(`${message}\n\n  \n`)?.comments).toHaveLength(2);
  });

  // Build F's reader is `readOneComment`, this file's one-comment rule, unchanged (§J): the last tag's anchor, and as text the framing
  // line, the earlier blocks, the last lead and comment and the plural preamble, the destination unknown
  it('is read by build F as the last comment’s anchor and the rest as text', () => {
    for (const destination of DESTINATIONS) {
      const message = commentsMessage(two, destination);
      expect(readOneComment(message)).toEqual({ anchor: second, text: message.slice(0, message.lastIndexOf('\n\n')), destination: null });
    }
  });
});
// UX wave U5a end

// The window held to the rule of a file the transcript names (UX wave U6c,
// docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, M1 decision 7): each invented string is drawn by the
// transcript's own Markdown, every path chip is clicked, and what the click asks for (through `normalizeLexically`, as
// `openFile` does) must be among `linkPaths` of the string, while the string's counter-example must not. The chip's and
// the anchor's readers are held to the rule's copies the same way. The daemon's rule is specified from remark's and
// micromark's code; this file is what shows the two agree.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { anchoredMessage, anchorLead, anchorTag, commentsMessage } from '@shared/anchor/message';
import type { Anchor } from '@shared/anchor/anchor';
import { anchorPaths, chipPath, EDIT_TOOLS, isMcpTool, linkPaths, READ_TOOLS } from '@shared/files/named';
import { Markdown } from '../../transcript';
import { filePathOf } from '../../transcript/model/cells';
import { userTextOf } from '../../transcript/model/user-text';
import { MCP_TOOL } from '../../transcript/model/classify';
import { TranscriptActionsProvider, turnFileLinks } from '../../transcript/view/context';
import { normalizeLexically } from './open-file';

afterEach(cleanup);

// UX wave U6b-4b (decision 17): the window's entries turn the `file:` form on as they load; this suite draws as the window does
beforeAll(() => turnFileLinks(true));
afterAll(() => turnFileLinks(false));

// The Markdown chunk loaded once, so every later mount draws in its first commit.
beforeAll(async () => {
  render(<Markdown markdown="the chunk is loaded" live={false} />);
  await screen.findByText('the chunk is loaded');
  cleanup();
});

// What the window's path chips in `markdown` ask for, each through `normalizeLexically` as `openFile` does.
function clickedPaths(markdown: string): string[] {
  const openFile = vi.fn();
  const { container } = render(
    <TranscriptActionsProvider actions={{ openFile }}>
      <Markdown markdown={markdown} live={false} />
    </TranscriptActionsProvider>,
  );
  expect(container.textContent).not.toBe('');
  for (const chip of container.querySelectorAll('[data-chip="path"]')) fireEvent.click(chip);
  return openFile.mock.calls.map(([path]) => normalizeLexically(path as string));
}

const P = '/work/out/report.md';

describe('a path chip asks for a path the rule names', () => {
  // [the string, the path its chip asks for, a path the rule must not name for it]
  it.each([
    ['[r](/work/out/report.md)', P, '/work/out/report'],
    ['[r](</work/out/report.md>)', P, '/work/out/report'],
    ['[n](</work/out/my notes.md>)', '/work/out/my notes.md', '/work/out/my'],
    ['[n](/work/out/my%20notes.md)', '/work/out/my notes.md', '/work/out/my%20notes.md'],
    ['[r](/work/out/report.md "the report")', P, '/work/out/report.md "the report"'],
    ['[r](/work/out/report.md:12)', P, '/work/out/report.md:12'],
    ['[r](/work/out/report.md#L12)', P, '/work/out/report.md#L12'],
    ['[a](/work/out/a(1).md)', '/work/out/a(1).md', '/work/out/a'],
    ['[a](/work/out/a\\(1\\).md)', '/work/out/a(1).md', '/work/out/a\\(1\\).md'],
    ['[b](/work/out/보고서.md)', '/work/out/보고서.md', '/work/out'],
    ['[b](/work/out/%EB%B3%B4%EA%B3%A0%EC%84%9C.md)', '/work/out/보고서.md', '/work/out/%EB%B3%B4%EA%B3%A0%EC%84%9C.md'],
    ['[k](/vault/key,backup)', '/vault/key,backup', '/vault/key'],
    ['[k](/vault/key:backup)', '/vault/key:backup', '/vault/key'],
    ['[e](</vault/.env backup>)', '/vault/.env backup', '/vault/.env'],
    ['[r](/work/tmp/../out/report.md)', P, '/work/tmp/../out/report.md'],
    ['[r](/work/out/./report.md)', P, '/work/out/./report.md'],
    ['[r](/work//out/report.md)', P, '/work//out/report.md'],
    ['[r](/work/out/report\\_v2.md)', '/work/out/report_v2.md', '/work/out/report\\_v2.md'],
    ['[r](/work/out/report.md.bak)', '/work/out/report.md.bak', P],
    ['**[r](/work/out/report.md)**', P, '/work/out/report'],
    ['[a [b] c](/work/out/report.md)', P, '/work/out/report'],
    ['[r](\n/work/out/report.md)', P, '/work/out/report'],
    ['- one\n- [r](/work/out/report.md)', P, '/work/out/report'],
    ['| a | b |\n|---|---|\n| [r](/work/out/report.md) | x |', P, '/work/out/report'],
    ['> quoted [r](/work/out/report.md)', P, '/work/out/report'],
    // the URL step compares paths, not strings: these serialise to other strings and stay named
    ['[r](/a/b/../d)', '/a/d', '/a/b/../d'],
    ['[r](/a/%2e%2e/b)', '/b', '/a/%2e%2e/b'],
    ['[r](//work/out/report.md)', P, '//work/out/report.md'],
    ['[r](/work/notes#1.md)', '/work/notes#1.md', '/work/notes'],
  ])('%j', (markdown, path, counter) => {
    const clicked = clickedPaths(markdown);
    expect(clicked).toContain(path);
    const named = linkPaths(markdown);
    for (const asked of clicked) expect(named).toContain(asked);
    expect(named).not.toContain(counter);
  });
});

describe('what is not clickable today yields no path chip', () => {
  it.each([
    'see /work/out/report.md',
    '`/work/out/report.md`',
    '</work/out/report.md>',
    '<https://example.com/work/out/report.md>',
    '![r](/work/out/report.md)',
    '[r][ref]\n\n[ref]: /work/out/report.md',
    '[r](host:/work/out/report.md)',
    '[r](C:/work/out/report.md)',
    'the key is at host:/vault/key',
  ])('%j', (markdown) => {
    expect(clickedPaths(markdown)).toEqual([]);
    expect(linkPaths(markdown)).toEqual([]);
  });

  // a link in code, in math, in another link's text or in an image's: no chip, and the rule names nothing (fix round 1)
  it.each([
    '`[r](/work/out/report.md)`',
    '```\n[r](/work/out/report.md)\n```',
    '    [r](/work/out/report.md)',
    '$$[r](/work/out/report.md)$$',
    '![a [b](/work/out/report.md) c](/work/i.png)',
  ])('%j: no chip, and the rule names nothing', (markdown) => {
    expect(chipPaths(markdown)).toEqual([]);
    expect(linkPaths(markdown)).toEqual([]);
  });
  it('a link inside another link\'s text is the chip; the outer one is none', () => {
    const markdown = '[a [b](/work/x.md) c](/work/out/report.md)';
    expect(clickedPaths(markdown)).toEqual(['/work/x.md']);
    expect(linkPaths(markdown)).toEqual(['/work/x.md']);
  });
});

// The branch review's finding 1: text shaped like a link inside a link's destination or title, an image's resource or a
// reference definition is no link in the window, and the rule names nothing from it; a link after a resource is one.
describe('a resource is read once: nothing inside it is a link', () => {
  const S = '/secret';
  it.each([
    '[r](</vault/[x](/secret).txt>)',
    '[r](/work/out/report.md "see [x](/secret)")',
    '![i](</vault/[x](/secret).png>)',
    '[r][ref]\n\n[ref]: </vault/[x](/secret).txt>',
    '[r][ref]\n\n[ref]: /vault/a.txt "see [x](/secret)"',
    '# Title\n[ref]: </vault/[x](/secret).txt>',
    '[r][a]\n\n[a]: /work/a.md\n[ref]: </vault/[x](/secret).txt>',
    '> [a\n>\n> b](/secret)',
  ])('%j', (markdown) => {
    const clicked = clickedPaths(markdown);
    expect(clicked).not.toContain(S);
    const named = linkPaths(markdown);
    for (const asked of clicked) expect(named).toContain(asked);
    expect(named).not.toContain(S);
  });

  it.each([
    '[a](/work/a.md "t") [b](/secret)',
    '![i](/work/i.png) [b](/secret)',
    `[r](</vault/${'a'.repeat(20_000)}>)\n\n[b](/secret)`,
    `> [r](/outer "${'a'.repeat(20_000)}")\n>\n> [b](/secret)`,
    // text shaped like a definition that Markdown does not take as one (fix round 1, item 1)
    '1.2 [ref]: [b](/secret)',
    '[ref]: [b](/secret) extra',
    '[ref]: /a "see [b](/secret)" extra',
    'Here is the file:\n[ref]: [b](/secret)',
    '> Here is the file:\n[ref]: [b](/secret)',
    '[ref]: /a\n"see [b](/secret)" extra',
  ])('%j: the link after it names its path', (markdown) => {
    expect(clickedPaths(markdown)).toContain(S);
    expect(linkPaths(markdown)).toContain(S);
  });
});

// Refused by the rule, and drawn as a chip by the window (§A, "Not recognised, and so refused"): the window's URL parse
// reads a host, a port, a user or a query or fragment boundary into each, so the click asks for a path the transcript
// did not write; and a destination that already carries the chip's scheme. Each fails towards the refusal.
describe('listed refusals: what the click asks for, and the rule names nothing', () => {
  it.each([
    ['[r](/a/b/..#c/../d)', ['/a/d']],
    ['[r](/a/b/..?c/../d)', ['/a/d']],
    ['[r](//x:/y)', ['/x/y']],
    ['[r](//x:0080/y)', ['/x:80/y']],
    ['[r](//:@x/y)', ['/x/y']],
    ['[r](//work:99999/x)', []],
    ['[r](//a:b:c@x/y)', ['/a:b%3Ac@x/y']],
    ['[r](//u@@h/x)', ['/u%40@h/x']],
    ['[r](maws-path:/work/out/report.md)', [P]],
    // UX wave U6b-4b (N1.6): U6c's refusals hold for the `file:` form, whatever the window draws
    ['[r](file:///work/%41.md)', ['/work/A.md']],
    ['[r](file&colon;///work/x.md)', ['/work/x.md']],
  ])('%j', (markdown, asked) => {
    expect(clickedPaths(markdown)).toEqual(asked);
    expect(linkPaths(markdown)).toEqual([]);
  });
});

describe('the chip’s and the anchor’s readers', () => {
  it('chipPath answers what filePathOf answers for the chip tools', () => {
    const inputs: Record<string, unknown>[] = [{ file_path: P }, { notebook_path: P }, { path: P }, { file_path: '', path: P }, { file_path: 3, path: P }, { notebook_path: P, path: '/work/x' }, {}];
    for (const tool of [...READ_TOOLS, ...EDIT_TOOLS]) for (const input of inputs) expect(chipPath(tool, input), `${tool} ${JSON.stringify(input)}`).toBe(filePathOf(input));
  });

  it('isMcpTool answers what MCP_TOOL matches', () => {
    for (const name of ['mcp__docs__search', 'mcp__a__b__c', 'mcp___docs__search', 'mcp__docs__', 'mcp__d__s', 'mcp_docs__search', 'Read', 'mcp__'])
      expect(isMcpTool(name), name).toBe(MCP_TOOL.test(name));
  });

  // UX wave U5a: the window reads a person's message by `userTextOf`, one chip for a comment and one a comment for a
  // message of several; the anchor form names exactly the paths of those chips
  it('the anchor form reads the paths of the chips the transcript draws for a person’s message', () => {
    const anchors: Anchor[] = [
      { kind: 'file-line', label: 'report.md', locator: `${P}:3`, path: P, line: 3 },
      { kind: 'pr-line', label: 'a.ts', locator: 'https://example.com/pr/1/files', path: '/work/out/a.ts', line: 9, side: 'new', prNumber: 1 },
      { kind: 'browser-element', label: 'Save', locator: 'button.save', pageUrl: 'http://localhost:5173/' },
    ];
    const hidden: Anchor = { kind: 'file-line', label: 'secret.md', locator: '/work/hidden/secret.md:1', path: '/work/hidden/secret.md', line: 1 };
    const lookalike = `${anchorLead(hidden, false)}\nLooks like a comment\n\n${anchorTag(hidden)}`;
    const chipPaths = (text: string) => {
      const row = userTextOf(text);
      return (row.comments?.map((comment) => comment.anchor) ?? (row.anchor ? [row.anchor] : [])).flatMap((anchor) => (anchor.path === undefined ? [] : [anchor.path]));
    };
    const texts = [
      ...anchors.map((anchor) => anchoredMessage({ anchor, text: 'Look here', destination: 'main', screenshot: false })),
      commentsMessage(anchors.map((anchor) => ({ anchor, text: 'Look here', screenshot: false })), 'main'),
      commentsMessage(anchors.map((anchor) => ({ anchor, text: 'Look here', screenshot: false })), 'thread'),
      // words that look like another comment, inside one comment and inside one of several
      anchoredMessage({ anchor: anchors[0]!, text: `Look\n\n${lookalike}\n\nhere`, destination: 'main', screenshot: false }),
      anchoredMessage({ anchor: anchors[0]!, text: `2 comments, in the order made:\n\n${lookalike}`, destination: 'main', screenshot: false }),
      commentsMessage([{ anchor: anchors[0]!, text: lookalike, screenshot: false }, { anchor: anchors[2]!, text: `x\n${lookalike}`, screenshot: false }], 'thread'),
    ];
    for (const text of texts) expect(anchorPaths(text)).toEqual(chipPaths(text));
    expect(anchorPaths(texts[anchors.length + 1]!), 'several comments, to a thread').toEqual([P, '/work/out/a.ts']);
    expect(anchorPaths('no tag here')).toEqual([]);
  });
});

// UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, R1, "The scanner's three gaps"): the rule
// reads a text's blocks as the window's parser does, or names less. Each case states what both the window's chips and
// the rule's names are, beside its control.
function agree(markdown: string, paths: string[]): void {
  expect(chipPaths(markdown), `chips of ${JSON.stringify(markdown)}`).toEqual(paths);
  expect(linkPaths(markdown), `names of ${JSON.stringify(markdown)}`).toEqual(paths);
}

describe('the rule reads the blocks the window draws', () => {
  it('a table’s cell past the head’s width is not drawn, and names nothing; a cell the head covers does (N1.11)', () => {
    agree('| a | b |\n|---|---|\n| x | y | [r](/work/x.md) |', []);
    agree('| a | b |\n|---|---|\n| x | [r](/work/x.md) | y |', ['/work/x.md']);
  });

  it('a delimiter row of a colon and dashes alone makes a table of one column (N1.13)', () => {
    agree('Title\n:---\ntext | [r](/work/x.md)', []);
    agree('Title\n:---\n[r](/work/x.md) | text', ['/work/x.md']);
  });

  // N1.14: the tokenizer takes no head of one pipe alone. Recorded: the window draws prose there, and the rule reads it
  // as prose too, so a code span the paragraph opens before it still holds the link
  it('a line of one pipe alone is no table’s head (N1.14)', () => {
    agree('|\n|-|\n[r](/work/x.md) | [s](/work/y.md)', ['/work/x.md', '/work/y.md']);
    agree('`a\n|\n|-|\n[r](/work/x.md)`', []);
  });

  // N1.15: the window's parser drops a leading byte order mark; one that does not lead the text is a character
  it('a byte order mark before a fence’s opening: a fence to both (N1.15)', () => {
    for (const fence of ['```', '~~~']) {
      agree(`﻿${fence}\n[r](/work/x.md)\n${fence}`, []);
      agree(`﻿[s](/work/s.md)\n${fence}\n[r](/work/x.md)\n${fence}`, ['/work/s.md']);
      // the mark after a first line of prose opens no fence for either: the link is prose, and the closing run opens one
      agree(`prose\n﻿${fence}\n[r](/work/x.md)\n${fence}`, ['/work/x.md']);
    }
  });

  // N1.16: the window ends a line at a carriage return alone; the rule names nothing of such a text
  it('lone carriage returns round a fence: the rule names nothing, the window draws no chip in the fence (N1.16)', () => {
    for (const fence of ['```', '~~~']) {
      const lone = `see [s](/work/s.md)\r${fence}\r[r](/work/x.md)\r${fence}`;
      expect(chipPaths(lone), fence).toEqual(['/work/s.md']);
      expect(linkPaths(lone), fence).toEqual([]);
      agree(`see [s](/work/s.md)\n${fence}\n[r](/work/x.md)\n${fence}`, ['/work/s.md']);
    }
  });
});

// UX wave U6b-4b (R1): an inline `file:` link with an empty host is the path chip of its rest, and the rule names that
// rest; every other `file:` form is text and names nothing. The fixed rows are drawn finished and while still arriving
// (`live`); the seeded differential below draws finished text only.
describe.each([false, true])('the file: form (live: %s)', (live) => {
  // [the string, the path its chip asks for, a path the rule must not name for it]
  it.each([
    ['[r](file:///work/out/report.md)', P, 'file:///work/out/report.md'],
    ['[r](file:///work/out/report.md#L12)', P, '/work/out/report.md#L12'],
    ['[n](file:///work/out/my%20notes.md)', '/work/out/my notes.md', '/work/out/my%20notes.md'],
    ['[n](<file:///work/out/my notes.md>)', '/work/out/my notes.md', '/work/out/my'],
    ['[r](FILE:///work/out/report.md)', P, 'FILE:///work/out/report.md'],
    ['[r](file:////work/out/report.md)', P, '//work/out/report.md'],
  ])('%j', (markdown, path, counter) => {
    const chips = chipPaths(markdown, live);
    expect(chips).toEqual([path]);
    const named = linkPaths(markdown);
    for (const asked of chips) expect(named).toContain(asked);
    expect(named).not.toContain(counter);
  });

  // N1.1 to N1.4 and L3: no chip, nothing named, and no element's href is a `file:` URL; the control, an inline link to
  // the same path beside it, is both
  it.each([
    '[r](file://host/work/x.md)',
    '[r](file://localhost/work/x.md)',
    '[r](file:/work/x.md)',
    '[r](file:work/x.md)',
    '[r](file://)',
    '<file:///work/x.md>',
    'see file:///work/x.md here',
    '`[r](file:///work/x.md)`',
    '```\n[r](file:///work/x.md)\n```',
    '$$\n[r](file:///work/x.md)\n$$',
    '$$[r](file:///work/x.md)$$',
    '[r][l]\n\n[l]: file:///work/x.md',
  ])('%j: no chip and nothing named; the inline link beside it is both', (markdown) => {
    expect(chipPaths(markdown, live)).toEqual([]);
    expect(linkPaths(markdown)).toEqual([]);
    const { container } = render(<Markdown markdown={markdown} live={live} />);
    expect([...container.querySelectorAll('[href]')].map((element) => element.getAttribute('href')).filter((href) => /^(file|maws-path):/i.test(href!))).toEqual([]);
    cleanup();
    const control = `${markdown}\n\n[c](file:///work/c.md)`;
    expect(chipPaths(control, live)).toEqual(['/work/c.md']);
    expect(linkPaths(control)).toEqual(['/work/c.md']);
  });

  // N1.10: an offset is not an index into the text (the parser drops a leading byte order mark before it counts)
  it('after a leading byte order mark the inline form is a chip and is named; its autolink is neither (N1.10)', () => {
    for (const [markdown, paths] of [['﻿[r](file:///work/x.md)', ['/work/x.md']], ['﻿<file:///work/x.md>', []]] as const) {
      expect(chipPaths(markdown, live), JSON.stringify(markdown)).toEqual(paths);
      expect(linkPaths(markdown), JSON.stringify(markdown)).toEqual(paths);
    }
  });

  it('a table’s cell past the head’s width: no chip and nothing named in this form either (N1.11, N1.13)', () => {
    for (const [markdown, paths] of [
      ['| a | b |\n|---|---|\n| x | y | [r](file:///work/x.md) |', []],
      ['| a | b |\n|---|---|\n| x | [r](file:///work/x.md) | y |', ['/work/x.md']],
      ['Title\n:---\ntext | [r](file:///work/x.md)', []],
      ['Title\n:---\n[r](file:///work/x.md) | text', ['/work/x.md']],
    ] as const) {
      expect(chipPaths(markdown, live), JSON.stringify(markdown)).toEqual(paths);
      expect(linkPaths(markdown), JSON.stringify(markdown)).toEqual(paths);
    }
  });
});

// The differential (fix round 1): seeded strings built from link-shaped fragments, each drawn by the window's own
// Markdown. One direction is asserted, the one that admits: every path the rule names is a path chip the window draws.
// The other direction (a chip the rule refuses) fails towards the refusal; it is counted and a few are printed.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FRAGMENTS = [
  '[', ']', '(', ')', '<', '>', '![', '](', '](<', '>)', ' ', ' ', '\n', '\n\n', '> ', '>\n', '- ', '1. ', '2) ', '1.2 ', '   ', '    ',
  '\\', '\\[', '\\]', '\\(', '\\)', '\\<', '&amp;', '&#46;', '`', '``', '```\n', '\n```\n', ' "t"', " 't'", ' (t)', '"', "'",
  '#L3', ':12', '%20', '%72', '/work/a.md', '/secret', '/work/my notes.md', '/w/(x).md', '/vault/key,backup', '[ref]: ', '[ref]',
  '[^1]: ', '# ', '**', 'text', 'x', ':', 'host:', '//', '..', '/./', '[r](/work/a.md)', '[r](</secret>)', '[r](/secret "t")',
  '![i](/secret)', '[ref]: /secret', '[ref]: </secret>', '<https://e.com/', 'Here is:\n', '[a [b](/secret) c]',
  // UX wave U6b-4b (R1): the `file:` form beside the scheme-less one, the marks the window's parser reads apart, and a
  // table whose rows can run past its head
  'file://', 'file:///', 'FILE:///', '<file:///', 'file://h/', '\uFEFF', '\r', '~~~\n', '| a | b |\n', '|---|---|\n', ':---\n', '| x | y | z |\n',
];
const LONG_TAIL = 'a'.repeat(17_000); // past the 16 KiB bound; few, for the time
function generated(seed: number, count: number): string[] {
  const random = mulberry32(seed);
  return Array.from({ length: count }, () => {
    let text = '';
    for (let n = 3 + Math.floor(random() * 22); n > 0; n -= 1) text += random() < 0.0015 ? LONG_TAIL : FRAGMENTS[Math.floor(random() * FRAGMENTS.length)]!;
    return text;
  });
}
// What the window's path chips in `markdown` ask for, as `clickedPaths`, for a string that may draw nothing; drawn
// finished unless `live` says it is still arriving.
function chipPaths(markdown: string, live = false): string[] {
  const openFile = vi.fn();
  const { container } = render(
    <TranscriptActionsProvider actions={{ openFile }}>
      <Markdown markdown={markdown} live={live} />
    </TranscriptActionsProvider>,
  );
  for (const chip of container.querySelectorAll('[data-chip="path"]')) fireEvent.click(chip);
  cleanup();
  return openFile.mock.calls.map(([path]) => normalizeLexically(path as string));
}

describe('the differential: every path the rule names is a chip the window draws', () => {
  it('over seeded strings of link-shaped fragments', { timeout: 300_000 }, () => {
    const seed = 0x6c696e6b;
    const count = 2000;
    const started = performance.now();
    let checked = 0;
    const faults: { markdown: string; path: string }[] = [];
    const windowOnly: { markdown: string; path: string }[] = [];
    for (const markdown of generated(seed, count)) {
      const chips = chipPaths(markdown);
      const named = linkPaths(markdown);
      checked += named.length;
      for (const path of named) if (!chips.includes(path)) faults.push({ markdown, path });
      for (const path of chips) if (!named.includes(path)) windowOnly.push({ markdown, path });
    }
    console.log(`named-links differential: seed ${seed}, ${count} strings, ${checked} named paths checked, ${windowOnly.length} window-only chips, ${Math.round(performance.now() - started)} ms`);
    for (const only of windowOnly.slice(0, 5)) console.log(`window-only chip ${JSON.stringify(only.path)} in ${JSON.stringify(only.markdown.slice(0, 200))}`);
    expect(faults.slice(0, 10).map(({ markdown, path }) => `${JSON.stringify(path)} in ${JSON.stringify(markdown.slice(0, 200))}`)).toEqual([]);
    expect(faults).toHaveLength(0);
  });
});

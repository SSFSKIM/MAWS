// The window held to the rule of a file the transcript names (UX wave U6c,
// docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, M1 decision 7): each invented string is drawn by the
// transcript's own Markdown, every path chip is clicked, and what the click asks for (through `normalizeLexically`, as
// `openFile` does) must be among `linkPaths` of the string, while the string's counter-example must not. The chip's and
// the anchor's readers are held to the rule's copies the same way. The daemon's rule is specified from remark's and
// micromark's code; this file is what shows the two agree.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { anchoredMessage, anchorLead, anchorTag, commentsMessage } from '@shared/anchor/message';
import type { Anchor } from '@shared/anchor/anchor';
import { anchorPaths, chipPath, EDIT_TOOLS, isMcpTool, linkPaths, READ_TOOLS } from '@shared/files/named';
import { Markdown } from '../../transcript';
import { filePathOf } from '../../transcript/model/cells';
import { userTextOf } from '../../transcript/model/user-text';
import { MCP_TOOL } from '../../transcript/model/classify';
import { TranscriptActionsProvider } from '../../transcript/view/context';
import { normalizeLexically } from './open-file';

afterEach(cleanup);

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
    '[r](file:///work/out/report.md)',
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
// What the window's path chips in `markdown` ask for, as `clickedPaths`, for a string that may draw nothing.
function chipPaths(markdown: string): string[] {
  const openFile = vi.fn();
  const { container } = render(
    <TranscriptActionsProvider actions={{ openFile }}>
      <Markdown markdown={markdown} live={false} />
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

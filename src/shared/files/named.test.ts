// The rule of a file the transcript names (UX wave U6c, docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md,
// Interfaces §A): the three forms on one string, the record claims, and the fact the search's needles rest on, read from
// the repository's transcript fixtures. Every path here is invented.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anchoredMessage, parseAnchoredText } from '@shared/anchor/message';
import { anchorPath, callClass, chipPath, clickPath, EDIT_TOOLS, hrefOf, isMcpTool, linkPaths, needlesOf, normalizeLexically, READ_TOOLS, rowClaim } from './named';

const P = '/work/out/report.md';

describe('the link form: linkPaths', () => {
  it.each([
    '[r](/work/out/report.md)',
    '[r](</work/out/report.md>)',
    '[r](/work/out/report.md "the report")',
    "[r](/work/out/report.md 'the report')",
    '[r](/work/out/report.md (the report))',
    '**[r](/work/out/report.md)**',
    '[a [b] c](/work/out/report.md)',
    '[r](\n/work/out/report.md)',
    '[r](  /work/out/report.md  )',
    '[r](/work/out/report.md\n"the report"\n)',
    '[r](/work/out/report.md:12)',
    '[r](/work/out/report.md#L12)',
    '[r](/work/tmp/../out/report.md)',
    '[r](/work/out/./report.md)',
    '[r](/work//out/report.md)',
    '[r](/work/out/report\\.md)',
    '\\![r](/work/out/report.md)',
    '[![shot](data:image/png;base64,AAAA)](/work/out/report.md)',
    '- one\n- [r](/work/out/report.md)',
    '| a | b |\n|---|---|\n| [r](/work/out/report.md) | x |',
    '> quoted [r](/work/out/report.md)',
    'two lines [of\nlink text](/work/out/report.md)',
  ])('%j names the path', (text) => {
    expect(linkPaths(text)).toContain(P);
  });

  it.each([
    ['/work/out/my notes.md', '[n](/work/out/my%20notes.md)'],
    ['/work/out/my notes.md', '[n](</work/out/my notes.md>)'],
    ['/work/out/보고서.md', '[b](/work/out/보고서.md)'],
    ['/work/out/보고서.md', '[b](/work/out/%EB%B3%B4%EA%B3%A0%EC%84%9C.md)'],
    ['/work/out/a(1).md', '[a](/work/out/a(1).md)'],
    ['/work/out/a(1).md', '[a](/work/out/a\\(1\\).md)'],
    ['/work/out/a,b.md', '[a](/work/out/a,b.md)'],
    ['/work/out/a:b.md', '[a](/work/out/a:b.md)'],
    ['/work/out/say "hi" \\x.md', '[q](</work/out/say "hi" \\x.md>)'],
    ['/work/out/a\\b.md', '[q](/work/out/a\\\\b.md)'],
    ['/work/out/v:12', '[v](/work/out/v:12:3)'], // the line suffix comes off once
  ])('names %j in %j', (path, text) => {
    expect(linkPaths(text)).toContain(path);
  });

  it.each([
    'see /work/out/report.md',
    '`/work/out/report.md`',
    '</work/out/report.md>',
    '![r](/work/out/report.md)',
    '[r][ref]\n\n[ref]: /work/out/report.md',
    'r](/work/out/report.md)',
    '[r] (/work/out/report.md)',
    '\\[r](/work/out/report.md)',
    '[r\\](/work/out/report.md)',
    '[r\n\nx](/work/out/report.md)',
    '[r](/work/out/report.md',
    '[r](/work/out/report.md "unclosed)',
    '[r](/work/out/report.md"x")',
    '[r](</work/out/report.md>x)',
    '[r](</work/out/\nreport.md>)',
    '[r](/work/out/report.md\n\n)',
    '[r](host:/work/out/report.md)',
    '[r](file:///work/out/report.md)',
    '[r](/mnt/work/out/report.md)',
    '[r](/WORK/out/report.md)',
    '[r](/work/out/%72eport.md)',
    '[r](/work/out/report.md&amp;x)',
    '[r](/work/out/report&#46;md)',
    '[r](/work/out/report.md%zz)',
    '[r](/work/out/report.md.bak)',
    '[r](/work/out/report.mdx)',
    '[r](/work/out/report.md/x)',
    // the window draws no chip in code, in math, in another link's text or in an image's (fix round 1, the differential)
    '```\n[r](/work/out/report.md)\n```',
    '~~~\n[r](/work/out/report.md)\n~~~',
    '$$\n[r](/work/out/report.md)\n$$',
    '    [r](/work/out/report.md)',
    '`[r](/work/out/report.md)`',
    '``a ` [r](/work/out/report.md)``',
    '$$[r](/work/out/report.md)$$',
    '[a [b](/work/x.md) c](/work/out/report.md)',
    '![a [b](/work/out/report.md) c](/work/i.png)',
    '<https://e.com/[r](/work/out/report.md)>',
    'see https://e.com/[r](/work/out/report.md)',
  ])('%j does not name the path', (text) => {
    expect(linkPaths(text)).not.toContain(P);
  });

  // ruling A's four counter-examples: a path that only begins a longer name, or stands after a scheme, is not named
  it.each([
    ['/vault/.env', '[e](</vault/.env backup>)'],
    ['/vault/key', '[k](/vault/key,backup)'],
    ['/vault/key', '[k](/vault/key:backup)'],
    ['/vault/key', 'the key is at host:/vault/key'],
    ['/vault/key', '[k](host:/vault/key)'],
    ['/work/out/report', '[r](/work/out/report.md)'],
  ])('%j is not named by %j', (path, text) => {
    expect(linkPaths(text)).not.toContain(path);
  });

  it('finds every link of a text, in order', () => {
    expect(linkPaths('[a](/a/one.md) then [b](/b/two.md "t") and ![c](/c.png) [d](https://example.com/d)')).toEqual(['/a/one.md', '/b/two.md']);
  });

  // The branch review's finding 1: a path is named only as the destination of a link, so the scan reads a link's or an
  // image's resource once and goes on after it, and passes over a reference definition's destination and title; text
  // shaped like a link inside any of them names nothing.
  const S = '/secret';
  it.each([
    ['[r](</vault/[x](/secret).txt>)', ['/vault/[x](/secret).txt']],
    ['[r](/work/out/report.md "see [x](/secret)")', [P]],
    ["[r](/work/out/report.md 'see [x](/secret)')", [P]],
    ['[r](/work/out/report.md\n"see [x](/secret)")', [P]],
    ['![i](</vault/[x](/secret).png>)', []],
    ['![i](/work/out/i.png "see [x](/secret)")', []],
    ['[r][ref]\n\n[ref]: </vault/[x](/secret).txt>', []],
    ['[ref]: /vault/[x](/secret).txt', []],
    ['[ref]: /vault/a.txt "see [x](/secret)"', []],
    ['[ref]:\n  </vault/[x](/secret).txt>', []],
    ['> [ref]: </vault/[x](/secret).txt>', []],
    ['- [ref]: </vault/[x](/secret).txt>', []],
    ['1. [ref]: </vault/[x](/secret).txt>', []],
    ['   [ref]: </vault/[x](/secret).txt>', []], // three spaces of indentation
    ['# Title\n[ref]: </vault/[x](/secret).txt>', []], // after a heading: a new paragraph
    ['[a]: /work/a.md\n[ref]: </vault/[x](/secret).txt>', []], // after another definition
    ['[ref]: </vault/[x](/secret).txt>  \nnext', []], // only spaces after it on its line
    ['> [a\n>\n> b](/secret)', []], // a quote's blank line ends the paragraph: no link pairs across it (fix round 1, item 2)
    [`[r](</vault/${'a'.repeat(20_000)}[x](/secret).txt>)`, []], // past the bound a resource's end is not known: nothing in it is read
  ])('%j: nothing inside a resource or a definition is a link', (text, named) => {
    expect(linkPaths(text)).toEqual(named);
  });

  it.each([
    '[a](/work/a.md "t") [b](/secret)', // after a link with a title
    '![i](/work/i.png) [b](/secret)', // after an image
    '[ref]: /work/a.md\n[b](/secret)', // after a definition
    'Note [1]: [b](/secret)', // a label in the middle of a line is no definition
    '[^1]: [b](/secret)', // a footnote's text is Markdown, not a destination
    '[a](<unclosed [b](/secret)', // no resource: what follows its `(` is text
    `[r](</vault/${'a'.repeat(20_000)}>)\n\n[b](/secret)`, // a resource past the bound ends before the next blank line
    `> [r](/outer "${'a'.repeat(20_000)}")\n>\n> [b](/secret)`, // … and before a quote's blank line (fix round 1, item 2)
    // fix round 1, item 1: text shaped like a definition that Markdown does not take as one
    '1.2 [ref]: [b](/secret)', // no list marker: `1.2` is text
    '[ref]: [b](/secret) extra', // something after the destination on its line
    '[ref]: /a "see [b](/secret)" extra', // something after the title on its line
    'Here is the file:\n[ref]: [b](/secret)', // a definition cannot interrupt a paragraph
    '> Here is the file:\n[ref]: [b](/secret)', // nor a quote's paragraph, which the line continues
    '[ref]: /a\n"see [b](/secret)" extra', // the title line fails: a definition without a title, then a paragraph
  ])('%j: a link after a resource, or where none is, still names its path', (text) => {
    expect(linkPaths(text)).toContain(S);
  });

  it('takes nesting of parentheses to the depth the window parses, and no deeper', () => {
    const deep = (n: number) => `[r](/work/${'('.repeat(n)}x${')'.repeat(n)})`;
    expect(linkPaths(deep(32))).toEqual([`/work/${'('.repeat(32)}x${')'.repeat(32)}`]);
    expect(linkPaths(deep(33))).toEqual([]);
  });

  it('answers in time over a hostile text', () => {
    const text = '[a]('.repeat(200_000) + ']('.repeat(200_000);
    const started = performance.now();
    linkPaths(text);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

// §A, clickPath step 7 (Decision Log 12): the window parses `maws-path:<href>` as a URL before the click reads it; a
// destination is named only when the rule's reading of that serialisation gives the same path. The two paths are
// compared, not the two strings.
describe('the window’s URL step: a parse that can only take a name away', () => {
  it.each([
    ['[r](/a/b/../d)', '/a/d'],
    ['[r](/a/%2e%2e/b)', '/b'],
    ['[r](//work/out/report.md)', P],
    ['[r](/work/notes#1.md)', '/work/notes#1.md'],
    ['[r](/work/out/report.md:12)', P],
  ])('%j still names %j', (text, path) => {
    expect(linkPaths(text)).toEqual([path]);
  });

  it.each(['[r](/a/b/..#c/../d)', '[r](/a/b/..?c/../d)', '[r](//x:/y)', '[r](//x:0080/y)', '[r](//:@x/y)', '[r](//work:99999/x)', '[r](//a:b:c@x/y)', '[r](//u@@h/x)'])('%j names nothing', (text) => {
    expect(linkPaths(text)).toEqual([]);
  });

  it('a destination the URL parser refuses is null, and nothing is thrown', () => {
    expect(() => clickPath('//work:99999/x')).not.toThrow();
    expect(clickPath('//work:99999/x')).toBeNull();
  });
});

describe('clickPath and hrefOf', () => {
  it('reads a destination as the click does', () => {
    expect(clickPath('/work/out/report.md')).toBe(P);
    expect(clickPath('/work/out/report\\_v2.md')).toBe('/work/out/report_v2.md');
    expect(clickPath('/work/out/a%2Fb.md')).toBe('/work/out/a%2Fb.md'); // decodeURI keeps a reserved character's escape
    expect(clickPath('/work/out/%2E%2E/report.md')).toBe('/work/report.md');
    expect(clickPath('/work/out/report.md#intro')).toBe('/work/out/report.md#intro');
  });

  it('answers null for a destination that is not a path chip or is not recognised', () => {
    for (const destination of ['', 'https://example.com/x', 'host:/work/x', 'C:/work/x', '/work/&amp;x', '/work/&#x41;', '/work/%41', '/work/%30', '/work/%zz', '/work/%E0%A4%A'])
      expect(clickPath(destination), destination).toBeNull();
  });

  it('mirrors micromark-util-sanitize-uri 2.0.1 normalizeUri', () => {
    expect(hrefOf('/a b')).toBe('/a%20b');
    expect(hrefOf('/보')).toBe('/%EB%B3%B4');
    expect(hrefOf('/a%20b')).toBe('/a%20b');
    expect(hrefOf('/a%zzb')).toBe('/a%zzb'); // two ASCII alphanumerics after `%` are taken for an escape
    expect(hrefOf('/a%2')).toBe('/a%252');
    expect(hrefOf('/a"b<c>d`e{f}g|h\\i^j')).toBe('/a%22b%3Cc%3Ed%60e%7Bf%7Dg%7Ch%5Ci%5Ej');
    expect(hrefOf("/!#$&'()*+,-./:;=?@_~")).toBe("/!#$&'()*+,-./:;=?@_~");
    expect(hrefOf('/\u{1F600}')).toBe('/%F0%9F%98%80');
    expect(hrefOf('/\uD800x')).toBe('/%EF%BF%BDx'); // a lone surrogate
  });
});

describe('normalizeLexically (moved from the window, unchanged)', () => {
  it('collapses `.`, `..` and repeated separators without touching the disk', () => {
    expect(normalizeLexically('/r/src/../README.md')).toBe('/r/README.md');
    expect(normalizeLexically('/r//a/./b/')).toBe('/r/a/b');
    expect(normalizeLexically('/../etc')).toBe('/etc');
    expect(normalizeLexically('a/../../b')).toBe('../b');
    expect(normalizeLexically('')).toBe('.');
  });
});

describe('the value form: chipPath', () => {
  it('reads the window’s fields for the chip tools, and nothing for another tool', () => {
    expect([...READ_TOOLS].sort()).toEqual(['LS', 'NotebookRead', 'Read']);
    expect([...EDIT_TOOLS].sort()).toEqual(['Edit', 'MultiEdit', 'NotebookEdit', 'Write']);
    expect(chipPath('Read', { file_path: P })).toBe(P);
    expect(chipPath('NotebookEdit', { notebook_path: '/work/n.ipynb' })).toBe('/work/n.ipynb');
    expect(chipPath('LS', { path: '/work/out' })).toBe('/work/out');
    expect(chipPath('Write', { file_path: 3, path: P })).toBe(P);
    expect(chipPath('Bash', { file_path: P })).toBeNull();
    expect(chipPath('Grep', { path: P })).toBeNull();
    expect(chipPath('Read', null)).toBe('');
  });
});

describe('isMcpTool and anchorPath', () => {
  it('isMcpTool has the window’s MCP shape', () => {
    expect(isMcpTool('mcp__docs__search')).toBe(true);
    expect(isMcpTool('mcp__a__b__c')).toBe(true);
    expect(isMcpTool('mcp___docs__search')).toBe(false);
    expect(isMcpTool('mcp__docs__')).toBe(false);
    expect(isMcpTool('Read')).toBe(false);
  });

  it('anchorPath reads the anchored comment’s path, and nothing from another text', () => {
    const text = anchoredMessage({ anchor: { kind: 'file-line', label: 'report.md', locator: `${P}:3`, path: P, line: 3 }, text: 'Look here', destination: 'main', screenshot: false });
    expect(parseAnchoredText(text)?.anchor.path).toBe(P);
    expect(anchorPath(text)).toBe(P);
    expect(anchorPath(`Look at ${P}`)).toBeNull();
    expect(anchorPath(`<maws_anchor kind="file-line" path="${P}"/>`)).toBeNull(); // the schema refuses it: no label, no locator
  });
});

// Records, invented, in the shapes the engine writes (test/fixtures/transcripts/).
const text = (value: string) => ({ type: 'text', text: value });
const assistant = (...content: object[]) => ({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content } });
const call = (id: string, name: string, input: object) => ({ type: 'tool_use', id, name, input });
const user = (content: string | object[], extra: object = {}) => ({ type: 'user', uuid: 'u1', message: { role: 'user', content }, ...extra });
const result = (id: string, content: string | object[]) => ({ type: 'tool_result', tool_use_id: id, content });
const queued = (prompt: string | object[], extra: object = {}) => ({
  type: 'attachment',
  uuid: 'q1',
  attachment: { type: 'queued_command', prompt, source_uuid: 's1', commandMode: 'prompt', origin: { kind: 'human' }, ...extra },
});
const LINK = `[r](${P})`;
const anchored = anchoredMessage({ anchor: { kind: 'file-line', label: 'report.md', locator: P, path: P }, text: 'Look', destination: 'main', screenshot: false });

describe('rowClaim', () => {
  const names = { names: true };
  it.each([
    ['an assistant text block', assistant(text(`See ${LINK}.`))],
    ['a tool input’s string at depth (a plan)', assistant(call('t1', 'ExitPlanMode', { plan: `Step one: ${LINK}` }))],
    ['a question’s option at depth', assistant(call('t1', 'mcp__maws__ask', { questions: [{ options: [{ preview: LINK }] }] }))],
    ['a Read call’s file_path', assistant(call('t1', 'Read', { file_path: P }))],
    ['a Write call’s file_path', assistant(call('t1', 'Write', { file_path: P, content: 'x' }))],
    ['a Read call’s file_path, lexically normal once collapsed', assistant(call('t1', 'Read', { file_path: '/work/tmp/../out/report.md' }))],
    ['a user row’s string content', user(`Open ${LINK}`)],
    ['a user row’s text block', user([text(`Open ${LINK}`)])],
    ['an anchored comment', user([text(anchored)])],
    ['a person’s queued prompt', queued(`Open ${LINK}`)],
    ['a person’s queued prompt in blocks', queued([text(`Open ${LINK}`)])],
    ['a person’s queued anchored comment', queued(anchored)],
  ])('names the path: %s', (_, row) => {
    expect(rowClaim(row, P)).toEqual(names);
  });

  it.each([
    ['a Bash call’s whole command', assistant(call('t1', 'Bash', { command: P }))],
    ['a Grep call’s path', assistant(call('t1', 'Grep', { path: P, pattern: 'x' }))],
    ['a Read call’s file_path with a space after it', assistant(call('t1', 'Read', { file_path: `${P} ` }))],
    ['a bare path in the agent’s text', assistant(text(`I wrote ${P}`))],
    ['a user row marked isMeta', user(LINK, { isMeta: true })],
    ['a user row marked isCompactSummary', user(LINK, { isCompactSummary: true })],
    ['a shell’s output in toolUseResult.stdout', user([result('t1', 'done')], { toolUseResult: { stdout: LINK } })],
    ['a queue record’s content', { type: 'queue-operation', operation: 'enqueue', content: LINK }],
    ['a queued command of another origin', queued(LINK, { origin: { kind: 'coordinator' } })],
    ['a queued command marked isMeta', queued(LINK, { isMeta: true })],
    ['a queued task notification', queued(LINK, { commandMode: 'task-notification' })],
    ['a queued prompt with no source_uuid', queued(LINK, { source_uuid: '' })],
    ['another kind of attachment', { type: 'attachment', attachment: { type: 'file', content: LINK } }],
    ['an api-request record', { type: 'api-request', messages: [{ role: 'user', content: LINK }] }],
    ['a file-history-snapshot', { type: 'file-history-snapshot', snapshot: { trackedFileBackups: { [P]: {} } } }],
    ['a summary', { type: 'summary', summary: LINK }],
    ['an ai-title', { type: 'ai-title', title: LINK }],
    ['a last-prompt', { type: 'last-prompt', lastPrompt: LINK }],
    ['a system row', { type: 'system', content: LINK }],
    ['a row with no type', { message: { role: 'user', content: LINK } }],
    ['a value that is not an object', LINK],
    ['null', null],
  ])('names nothing and waits for nothing: %s', (_, row) => {
    expect(rowClaim(row, P)).toEqual({ names: false, pending: [] });
  });

  it('a tool result waits for its call: an MCP call’s text for the link form, an edit’s filePath for the value form', () => {
    expect(rowClaim(user([result('t1', `Saved to ${LINK}`)]), P)).toEqual({ names: false, pending: [{ toolUseId: 't1', when: 'mcp' }] });
    expect(rowClaim(user([result('t2', [text(LINK), { type: 'image', source: {} }])]), P)).toEqual({ names: false, pending: [{ toolUseId: 't2', when: 'mcp' }] });
    expect(rowClaim(user([result('t3', 'File created')], { toolUseResult: { filePath: P } }), P)).toEqual({ names: false, pending: [{ toolUseId: 't3', when: 'edit' }] });
    expect(rowClaim(user([result('t4', 'File created')], { toolUseResult: { filePath: '/work/out/../out/report.md' } }), P)).toEqual({ names: false, pending: [{ toolUseId: 't4', when: 'edit' }] });
    expect(rowClaim(user([result('t5', 'nothing here')]), P)).toEqual({ names: false, pending: [] });
    expect(rowClaim(user([{ type: 'tool_result', content: LINK }]), P)).toEqual({ names: false, pending: [] }); // no tool_use_id
  });

  it('callClass reads the call’s own block', () => {
    expect(callClass(assistant(call('t1', 'mcp__docs__write', {})), 't1')).toBe('mcp');
    expect(callClass(assistant(call('t1', 'Edit', {})), 't1')).toBe('edit');
    expect(callClass(assistant(call('t1', 'Bash', {})), 't1')).toBe('other');
    expect(callClass(assistant(call('t1', 'Edit', {})), 't2')).toBeNull();
    expect(callClass(user([result('t1', LINK)]), 't1')).toBeNull();
    expect(callClass(null, 't1')).toBeNull();
  });
});

describe('needlesOf, and the fact it rests on', () => {
  it('takes the runs of letters and digits three or longer, longest first; else the longest run', () => {
    expect(needlesOf(P)).toEqual(['report', 'work', 'out']);
    expect(needlesOf('/a/bc')).toEqual(['bc']);
    expect(needlesOf('/work/out/보고서.md')).toEqual(['work', 'out']);
    expect(needlesOf('/보고서')).toEqual([]);
  });

  it('every record that names a path holds each needle in its bytes', () => {
    const paths = [P, '/work/out/my notes.md', '/work/out/a(1).md', '/work/out/say "hi" \\x.md'];
    for (const path of paths) {
      const rows = [assistant(text(`[r](<${path}>)`)), assistant(call('t1', 'Read', { file_path: path })), user(`[r](<${path}>)`), queued(`[r](<${path}>)`)];
      for (const row of rows) {
        expect(rowClaim(row, path), JSON.stringify(row)).toEqual({ names: true });
        for (const needle of needlesOf(path)) expect(JSON.stringify(row)).toContain(needle);
      }
    }
  });

  // The engine's own records, from the repository's fixtures: the shapes the rule reads, and no letter or digit escaped.
  const FIXTURES = join(__dirname, '../../../test/fixtures/transcripts');
  const lines = readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => readFileSync(join(FIXTURES, name), 'utf8').split('\n').filter((line) => line !== ''));
  const records = lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return []; // a torn line (torn-tail.jsonl)
    }
  });

  it('no fixture line writes a letter or a digit as a JSON escape', () => {
    expect(lines.length).toBeGreaterThan(500);
    for (const line of lines) {
      for (const [, hex] of line.matchAll(/\\u([0-9a-fA-F]{4})/g)) expect(String.fromCharCode(parseInt(hex!, 16))).not.toMatch(/[A-Za-z0-9]/);
    }
  });

  it('a person’s queued prompt has the shape the rule reads', () => {
    const prompts = records.filter((record) => record.type === 'attachment' && (record.attachment as { type?: string }).type === 'queued_command' && (record.attachment as { origin?: { kind?: string } }).origin?.kind === 'human');
    expect(prompts.length).toBeGreaterThan(0);
    for (const record of prompts) {
      const linked = { ...record, attachment: { ...(record.attachment as object), prompt: `Open ${LINK}` } };
      expect(rowClaim(linked, P)).toEqual({ names: true });
      expect(rowClaim(record, P)).toEqual({ names: false, pending: [] });
    }
  });

  it('an edit’s result carries toolUseResult.filePath, and its call is an edit tool’s tool_use under the result’s tool_use_id', () => {
    const results = records.filter((record) => record.type === 'user' && typeof (record.toolUseResult as { filePath?: unknown } | undefined)?.filePath === 'string');
    expect(results.length).toBeGreaterThan(0);
    let checked = 0;
    for (const record of results) {
      const path = normalizeLexically((record.toolUseResult as { filePath: string }).filePath);
      const claim = rowClaim(record, path);
      expect(claim.names).toBe(false);
      const pending = claim.names ? [] : claim.pending;
      expect(pending.length).toBeGreaterThan(0);
      for (const { toolUseId, when } of pending.filter((entry) => entry.when === 'edit')) {
        const classes = records.map((candidate) => callClass(candidate, toolUseId)).filter((value) => value !== null);
        expect(classes, toolUseId).toEqual([when]);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

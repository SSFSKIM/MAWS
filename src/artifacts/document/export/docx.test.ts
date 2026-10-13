// The DOCX export (M6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D12): checked structurally, unzipped with
// jszip (headings as Word's styles, the list numbering, the table, the threads as Word comments with their replies,
// the system's fonts and colours as the Word theme, the page), and read back by mammoth (text and headings). Runs
// under Node, as A's export service in main runs it. LibreOffice's check is test/artifacts/document-docx-libreoffice.
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { describe, expect, it } from 'vitest';
import { AGENT, everyKindSource, HUMAN, sourceOf, threadOf } from '../convert.fixture';
import { HOUSE_TOKENS, houseSystem, type DesignSystemExport, type LocalTokens } from './design-system';
import { exportDocx } from './docx';
import { imageSize } from './image-size';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAADjAO7rAAAAEElEQVR42mP8z8DAwMDAAAAGBwEBH5O/1QAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));

// mammoth's Node build reads `{buffer}`; a Uint8Array serves (src/artifacts names no Node global)
const input = (bytes: Uint8Array) => ({ buffer: bytes }) as unknown as Parameters<typeof mammoth.extractRawText>[0];

async function parts(bytes: Uint8Array): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) if (/\.(xml|rels)$/.test(name)) out[name] = await zip.file(name)!.async('string');
  return out;
}

describe('exportDocx', () => {
  it('writes headings with Word’s heading styles, styled from the system', async () => {
    const xml = await parts(await exportDocx(everyKindSource(), { tab: 'tab-1' }));
    const document = xml['word/document.xml'];
    for (const level of [1, 2, 3]) expect(document).toContain(`<w:pStyle w:val="Heading${level}"/>`);
    const styles = xml['word/styles.xml'];
    // the house h1: 26px is 39 half-points, weight 700 bold, the system's text colour and the theme's heading face
    expect(styles).toMatch(/<w:style w:type="paragraph" w:styleId="Heading1">.*?<w:rFonts w:asciiTheme="majorHAnsi"[^>]*\/>.*?<w:b\/>.*?<w:color w:val="1F1E1B"\/>.*?<w:sz w:val="39"\/>.*?<\/w:style>/s);
    expect(styles).toMatch(/<w:style w:type="paragraph" w:styleId="Code">.*?<w:rFonts w:ascii="SF Mono"[^>]*\/>.*?<\/w:style>/s);
    expect(styles).toMatch(/<w:style w:type="paragraph" w:styleId="CalloutWarn">.*?<w:left w:val="single"[^>]*w:color="B86A1A"[^>]*\/>.*?<\/w:style>/s);
  });

  it('writes lists with Word numbering: bullets, numbers from the list’s start, task boxes', async () => {
    const xml = await parts(await exportDocx(everyKindSource(), { tab: 'tab-1' }));
    const numbering = xml['word/numbering.xml'];
    expect(numbering).toMatch(/<w:lvl w:ilvl="0"[^>]*><w:start w:val="3"\/><w:numFmt w:val="decimal"\/><w:lvlText w:val="%1."\/>/);
    expect(numbering).toMatch(/<w:numFmt w:val="bullet"\/><w:lvlText w:val="•"\/>/);
    expect(numbering).toMatch(/<w:numFmt w:val="bullet"\/><w:lvlText w:val="☐"\/>/);
    expect(numbering).toMatch(/<w:numFmt w:val="bullet"\/><w:lvlText w:val="☒"\/>/);
    const document = xml['word/document.xml'];
    expect(document).toMatch(/<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="\d+"\/><\/w:numPr>.*?Nested item/s);
  });

  it('writes tables with header rows, spans and widths', async () => {
    const document = (await parts(await exportDocx(everyKindSource(), { tab: 'tab-1' })))['word/document.xml'];
    expect(document.match(/<w:tbl>/g)).toHaveLength(3);
    expect(document).toMatch(/<w:tblHeader\/>/);
    expect(document).toMatch(/<w:gridSpan w:val="2"\/>/);
    expect(document).toMatch(/<w:vMerge w:val="restart"\/>/);
    expect(document).toMatch(/<w:gridCol w:w="2400"\/><w:gridCol w:w="1200"\/>/); // colwidth 160,80 px
  });

  it('writes each thread as a Word comment with its replies, on the passage its mark covers', async () => {
    const xml = await parts(await exportDocx(everyKindSource(), { tab: 'tab-1' }));
    const comments = xml['word/comments.xml'];
    const authored = [...comments.matchAll(/<w:comment w:id="(\d+)"[^>]*w:author="([^"]*)"[^>]*>(.*?)<\/w:comment>/gs)].map(([, id, author, body]) => [Number(id), author, body.replace(/<[^>]+>/g, '')]);
    expect(authored).toEqual([
      [0, 'Owner', 'Is quarterly right?'],
      [1, 'Claude', 'Quarterly matches the release train.'],
      [2, 'Claude', 'Linked the review notes.'],
      [3, 'Owner', 'Drop the log before shipping.'],
    ]);
    expect(comments).not.toContain('An orphaned thread.'); // no passage to hang it on
    const extended = xml['word/commentsExtended.xml'];
    expect(extended.match(/w15:paraIdParent=/g)).toHaveLength(1); // the reply
    expect(extended).toMatch(/w15:done="1"/); // the resolved thread
    const document = xml['word/document.xml'];
    for (const id of [0, 1, 2, 3]) {
      expect(document).toContain(`<w:commentRangeStart w:id="${id}"/>`);
      expect(document).toContain(`<w:commentRangeEnd w:id="${id}"/>`);
      expect(document).toContain(`<w:commentReference w:id="${id}"/>`);
    }
    // t1's range opens before "ships quarterly with " and closes after "design review"
    const plain = document.replace(/<w:(?!commentRange)[^>]*>|<\/w:[^>]*>/g, '');
    expect(plain).toMatch(/The plan <w:commentRangeStart w:id="0"\/><w:commentRangeStart w:id="1"\/>ships quarterly with <w:commentRangeStart w:id="2"\/>design review<w:commentRangeEnd w:id="0"\/><w:commentRangeEnd w:id="1"\/> notes<w:commentRangeEnd w:id="2"\/>/);
  });

  it('writes the system’s fonts and colours as the Word theme', async () => {
    const xml = await parts(await exportDocx(everyKindSource()));
    const theme = xml['word/theme/theme1.xml'];
    expect(theme).toContain('<a:lt1><a:srgbClr val="FAF9F6"/></a:lt1>');
    expect(theme).toContain('<a:accent1><a:srgbClr val="C9663F"/></a:accent1>');
    expect(theme).toContain('<a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface="Malgun Gothic"/>');
    const system: DesignSystemExport<LocalTokens> = { ...houseSystem, name: 'Harbor', tokens: { properties: { ...HOUSE_TOKENS.properties, '--ds-color-accent': '#0b5fff' } } };
    const custom = (await parts(await exportDocx(everyKindSource(), { system })))['word/theme/theme1.xml'];
    expect(custom).toContain('name="Harbor"');
    expect(custom).toContain('<a:accent1><a:srgbClr val="0B5FFF"/></a:accent1>');
  });

  it('prints on Letter by default and A4 when chosen, with the system’s margin', async () => {
    const letter = (await parts(await exportDocx(everyKindSource())))['word/document.xml'];
    expect(letter).toMatch(/<w:pgSz w:w="12240" w:h="15840"[^>]*\/>/);
    expect(letter).toMatch(/<w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/);
    const a4 = (await parts(await exportDocx(everyKindSource(), { pageSize: 'a4' })))['word/document.xml'];
    expect(a4).toMatch(/<w:pgSz w:w="11906" w:h="16838"[^>]*\/>/);
  });

  it('embeds pictures it can load and names the rest', async () => {
    const loaded = await exportDocx(everyKindSource(), { tab: 'tab-1', loadImage: async ({ assetId }) => ({ bytes: assetId ? Uint8Array.from([...PNG, 0]) : PNG, mime: 'image/png' }) });
    const zip = await JSZip.loadAsync(loaded);
    expect(Object.keys(zip.files).filter((name) => name.startsWith('word/media/') && !name.endsWith('/'))).toHaveLength(2);
    expect((await parts(loaded))['word/document.xml']).toMatch(/<wp:extent cx="19050" cy="9525"\/>/); // 2 × 1 px
    const named = (await parts(await exportDocx(everyKindSource(), { tab: 'tab-1' })))['word/document.xml'];
    expect(named).toContain('[Image: A figure]');
  });

  it('links, and writes chips, math and placeholders as text', async () => {
    const xml = await parts(await exportDocx(everyKindSource(), { tab: 'tab-1' }));
    expect(xml['word/_rels/document.xml.rels']).toContain('Target="https://example.com/a"');
    const text = xml['word/document.xml'].replace(/<[^>]+>/g, '');
    for (const phrase of ['Due Oct 12, 2026, owned by Owner in Planning, status Doing.', 'E = mc^2', 'Mind the gap.', 'Chart: sales.csv', 'Pending: Write the risks section', 'graph TD', 'Open task'])
      expect(text).toContain(phrase);
  });

  it('reads back through mammoth: headings and text, every tab under its title', async () => {
    const bytes = await exportDocx(everyKindSource());
    const { value: html } = await mammoth.convertToHtml(input(bytes), { styleMap: ["p[style-name='Title'] => h1.title:fresh"] });
    expect(html).toContain('<h1 class="title">Overview</h1>');
    expect(html).toContain('<h1>Every kind</h1>');
    expect(html).toContain('<h2>Marks and chips</h2>');
    expect(html).toContain('<h3>Blocks</h3>');
    expect(html).toContain('<h1 class="title">Notes</h1>');
    expect(html).toContain('<h2>회의 메모</h2>');
    const { value: text } = await mammoth.extractRawText(input(bytes));
    for (const phrase of ['Plain, bold, italic, underline, strike, code, a link and highlight.', 'A quoted line.', 'console.log(x)', 'The end.', '안녕하세요, 팀 여러분.']) expect(text).toContain(phrase);
  });
});

describe('exportDocx, fix wave 1', () => {
  // review finding 1: a link wraps whatever it marks, and marks format chips, math, breaks and pictures
  it('links and formats inline atoms as it does text', async () => {
    const link = { type: 'link', attrs: { href: 'https://example.com/due', title: null } };
    const source = sourceOf([
      {
        type: 'paragraph',
        content: [
          { type: 'date', attrs: { iso: '2026-10-12' }, marks: [{ type: 'bold' }, link] },
          { type: 'math', attrs: { latex: 'x^2' }, marks: [{ type: 'underline' }] },
          { type: 'hardBreak', marks: [{ type: 'italic' }] },
          { type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'A', assetId: null }, marks: [link] },
        ],
      },
    ]);
    const xml = await parts(await exportDocx(source, { loadImage: async () => ({ bytes: PNG, mime: 'image/png' }) }));
    const document = xml['word/document.xml'];
    const links = [...document.matchAll(/<w:hyperlink[^>]*r:id="([^"]+)"[^>]*>(.*?)<\/w:hyperlink>/gs)];
    expect(links).toHaveLength(2);
    expect(links[0][2]).toMatch(/<w:rStyle w:val="Hyperlink"\/>.*<w:b\/>.*Oct 12, 2026/s);
    expect(links[1][2]).toContain('<w:drawing>');
    expect(document).toMatch(/<w:u w:val="single"\/>.*x\^2/s);
    expect(document).toMatch(/<w:r><w:rPr><w:i\/><w:iCs\/><\/w:rPr><w:br\/><\/w:r>/);
    for (const [, id] of links) expect(xml['word/_rels/document.xml.rels']).toMatch(new RegExp(`Id="${id}"[^>]*Target="https://example.com/due"|Target="https://example.com/due"[^>]*Id="${id}"`));
  });

  // review finding 3: a cell after a column a rowspan above still holds takes that column's width
  it('places cells after a rowspan in the columns they occupy', async () => {
    const cell = (type: string, text: string, attrs: Record<string, unknown> = {}) => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
    const source = sourceOf([
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('tableCell', 'Left', { rowspan: 2, colwidth: [100] }), cell('tableCell', 'Right', { colwidth: [200] })] },
          { type: 'tableRow', content: [cell('tableCell', 'Below right')] },
        ],
      },
    ]);
    const document = (await parts(await exportDocx(source)))['word/document.xml'];
    expect(document).toMatch(/<w:gridCol w:w="1500"\/><w:gridCol w:w="3000"\/>/);
    const rows = [...document.matchAll(/<w:tr>(.*?)<\/w:tr>/gs)].map(([, row]) => [...row.matchAll(/<w:tc>(.*?)<\/w:tc>/gs)].map(([, tc]) => [/<w:tcW w:type="dxa" w:w="(\d+)"\/>|<w:tcW w:w="(\d+)"/.exec(tc)?.slice(1).find(Boolean), tc.replace(/<[^>]+>/g, '')]));
    expect(rows).toEqual([
      [
        ['1500', 'Left'],
        ['3000', 'Right'],
      ],
      [
        ['1500', ''], // the continuation of the merged cell
        ['3000', 'Below right'],
      ],
    ]);
    expect(document).toMatch(/<w:vMerge w:val="continue"\/>/);
  });

  // review finding 4: a resolved thread is done in Word even when no thread has a reply
  it('marks a resolved thread done when the file has no replies', async () => {
    const comment = (threadId: string) => ({ type: 'comment', attrs: { threadId } });
    const source = sourceOf(
      [{ type: 'paragraph', content: [{ type: 'text', text: 'Settled', marks: [comment('r1')] }, { type: 'text', text: ' and ' }, { type: 'text', text: 'open', marks: [comment('o1')] }] }],
      [threadOf('r1', 'resolved', [[HUMAN, 'Settled it.']]), threadOf('o1', 'open', [[AGENT, 'Still open.']])],
    );
    const xml = await parts(await exportDocx(source));
    const extended = xml['word/commentsExtended.xml'];
    expect(extended).toBeDefined();
    const paraIds = [...xml['word/comments.xml'].matchAll(/<w:comment w:id="(\d+)".*?<w:p w14:paraId="([0-9A-F]{8})"/gs)].map(([, id, para]) => [id, para]);
    expect(paraIds).toHaveLength(2);
    expect(extended).toContain(`<w15:commentEx w15:paraId="${paraIds[0][1]}" w15:done="1"/>`);
    expect(extended).toContain(`<w15:commentEx w15:paraId="${paraIds[1][1]}" w15:done="0"/>`);
    expect(xml['word/_rels/document.xml.rels']).toContain('Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"');
    expect(xml['[Content_Types].xml']).toContain('PartName="/word/commentsExtended.xml"');
  });

  // review finding 5: a loader that fails is an error; a loader that has nothing is the alt text
  it('fails when the image loader rejects, and writes the alt text when it answers null', async () => {
    const source = sourceOf([{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'maws-artifact:as1/a.png', alt: 'Chart', assetId: 'as1' } }] }]);
    await expect(exportDocx(source, { loadImage: async () => Promise.reject(new Error('asset store offline')) })).rejects.toThrow('asset store offline');
    const named = (await parts(await exportDocx(source, { loadImage: async () => null })))['word/document.xml'];
    expect(named).toContain('[Image: Chart]');
  });
});

describe('imageSize', () => {
  it('reads PNG, GIF, BMP and JPEG headers', () => {
    expect(imageSize(PNG)).toEqual({ width: 2, height: 1 });
    expect(imageSize(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 3, 0, 5, 0]))).toEqual({ width: 3, height: 5 });
    const bmp = new Uint8Array(26);
    bmp.set([0x42, 0x4d]);
    new DataView(bmp.buffer).setInt32(18, 7, true);
    new DataView(bmp.buffer).setInt32(22, -9, true);
    expect(imageSize(bmp)).toEqual({ width: 7, height: 9 });
    expect(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 40, 0, 60, 3]))).toEqual({ width: 60, height: 40 });
    expect(imageSize(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});

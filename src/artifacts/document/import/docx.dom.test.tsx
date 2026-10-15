// The DOCX import (M6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D12): mammoth's HTML into the HTML
// import. Two fixtures: a hand-made file (OOXML parts written as Word writes them, under test/fixtures/document/
// handmade-docx/, zipped here) and one built by the `docx` package in the test, with a picture uploaded as an asset.
import { AlignmentType, Document, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import JSZip from 'jszip';
import type { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import contentTypes from '../../../../test/fixtures/document/handmade-docx/[Content_Types].xml?raw';
import packageRels from '../../../../test/fixtures/document/handmade-docx/_rels/.rels?raw';
import documentXml from '../../../../test/fixtures/document/handmade-docx/word/document.xml?raw';
import documentRels from '../../../../test/fixtures/document/handmade-docx/word/_rels/document.xml.rels?raw';
import numberingXml from '../../../../test/fixtures/document/handmade-docx/word/numbering.xml?raw';
import stylesXml from '../../../../test/fixtures/document/handmade-docx/word/styles.xml?raw';
import { everyKindSource } from '../convert.fixture';
import { exportDocx } from '../export/docx';
import { importDocx } from './docx';

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (ch) => ch.charCodeAt(0),
);

async function handmade(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', packageRels);
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', documentRels);
  zip.file('word/styles.xml', stylesXml);
  zip.file('word/numbering.xml', numberingXml);
  return zip.generateAsync({ type: 'uint8array' });
}

interface Outline {
  headings: Array<[number, string]>;
  lists: Array<[string, string[]]>;
  tables: string[][][];
  bold: string[];
  italic: string[];
}
function outline(body: PMNode): Outline {
  const out: Outline = { headings: [], lists: [], tables: [], bold: [], italic: [] };
  body.descendants((node) => {
    if (node.type.name === 'heading') out.headings.push([node.attrs.level as number, node.textContent]);
    if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
      const items: string[] = [];
      node.forEach((item) => items.push(item.textContent));
      out.lists.push([node.type.name, items]);
    }
    if (node.type.name === 'table') {
      const rows: string[][] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(`${cell.type.name === 'tableHeader' ? '#' : ''}${cell.textContent}`));
        rows.push(cells);
      });
      out.tables.push(rows);
    }
    if (node.isText && node.marks.some((mark) => mark.type.name === 'bold')) out.bold.push(node.text!);
    if (node.isText && node.marks.some((mark) => mark.type.name === 'italic')) out.italic.push(node.text!);
    return true;
  });
  return out;
}

describe('importDocx', () => {
  it('reads a hand-made file: headings, lists, a table and bold runs, Korean included', async () => {
    const { body } = await importDocx(await handmade());
    body.check();
    expect(outline(body)).toEqual({
      headings: [
        [1, 'Field notes'],
        [2, 'Checklist'],
        [3, '요약'],
      ],
      lists: [
        ['bulletList', ['Bring the map', 'Charge the radio']],
        ['orderedList', ['Arrive at the trailhead', 'Sign the log']],
      ],
      tables: [
        [
          ['#Station', '#Reading'],
          ['North', '12'],
          ['남쪽', '15'],
        ],
      ],
      bold: ['Monday'],
      italic: ['two'],
    });
    expect(body.textContent).toContain('모든 관측이 끝났습니다. All readings are in.');
  });

  it('reads a file the docx package built, uploading its picture as an asset', async () => {
    const file = new Document({
      numbering: { config: [{ reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }] }] },
      sections: [
        {
          children: [
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Launch review')] }),
            new Paragraph({ children: [new TextRun('Status is '), new TextRun({ text: 'green', bold: true }), new TextRun('.')] }),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Steps')] }),
            new Paragraph({ numbering: { reference: 'steps', level: 0 }, children: [new TextRun('Freeze the branch')] }),
            new Paragraph({ numbering: { reference: 'steps', level: 0 }, children: [new TextRun('Tag the release')] }),
            new Paragraph({ bullet: { level: 0 }, children: [new TextRun('Notify the team')] }),
            new Table({
              rows: [
                new TableRow({ tableHeader: true, children: ['Owner', 'Due'].map((text) => new TableCell({ children: [new Paragraph(text)] })) }),
                new TableRow({ children: ['Alex', 'Oct 20'].map((text) => new TableCell({ children: [new Paragraph(text)] })) }),
              ],
            }),
            new Paragraph({ children: [new ImageRun({ type: 'png', data: PNG, transformation: { width: 16, height: 16 }, altText: { name: 'dot', description: 'A dot', title: 'dot' } })] }),
          ],
        },
      ],
    });
    const uploads: Array<{ size: number; name: string; mime: string }> = [];
    const { body } = await importDocx(await Packer.pack(file, 'uint8array'), {
      uploadAsset: async (bytes, meta) => {
        uploads.push({ size: bytes.length, ...meta });
        return { assetId: 'as1', ref: 'maws-artifact:as1/image-1.png' };
      },
    });
    const shape = outline(body);
    expect(shape.headings).toEqual([
      [1, 'Launch review'],
      [2, 'Steps'],
    ]);
    expect(shape.lists).toEqual([
      ['orderedList', ['Freeze the branch', 'Tag the release']],
      ['bulletList', ['Notify the team']],
    ]);
    expect(shape.tables).toEqual([
      [
        ['#Owner', '#Due'],
        ['Alex', 'Oct 20'],
      ],
    ]);
    expect(shape.bold).toEqual(['green']);
    expect(uploads).toEqual([{ size: PNG.length, name: 'image-1.png', mime: 'image/png' }]);
    const images: unknown[] = [];
    body.descendants((node) => void (node.type.name === 'image' && images.push(node.attrs)));
    expect(images).toEqual([{ src: 'maws-artifact:as1/image-1.png', alt: 'A dot', assetId: 'as1' }]);
  });

  it('leaves pictures out when nothing can upload them', async () => {
    const file = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('Before '), new ImageRun({ type: 'png', data: PNG, transformation: { width: 4, height: 4 } }), new TextRun('after')] })] }] });
    const { body } = await importDocx(await Packer.pack(file, 'uint8array'));
    let images = 0;
    body.descendants((node) => void (node.type.name === 'image' && images++));
    expect(images).toBe(0);
    expect(body.textContent).toBe('Before after');
  });

  it('reads the DOCX export back: headings, lists, the table, code, the quote and the callout’s tone', async () => {
    const { body } = await importDocx(await exportDocx(everyKindSource(), { tab: 'tab-1' }));
    const shape = outline(body);
    expect(shape.headings).toEqual([
      [1, 'Every kind'],
      [2, 'Marks and chips'],
      [3, 'Blocks'],
    ]);
    expect(shape.lists.map(([type]) => type)).toEqual(['bulletList', 'bulletList', 'orderedList', 'bulletList', 'bulletList']);
    expect(shape.tables[0]).toEqual([
      ['#Name', '#Value'],
      ['alpha', '1'],
    ]);
    expect(shape.bold).toContain('bold');
    const kinds: Array<[string, unknown]> = [];
    body.descendants((node) => {
      if (node.type.name === 'codeBlock') kinds.push(['code', node.textContent]);
      if (node.type.name === 'blockquote') kinds.push(['quote', node.textContent]);
      if (node.type.name === 'callout') kinds.push(['callout', node.attrs.tone]);
      return true;
    });
    expect(kinds).toEqual([
      ['quote', 'A quoted line.A second quoted line.'],
      ['code', 'const x = 1\nconsole.log(x)'],
      ['callout', 'warn'],
      ['code', 'graph TD\n  A --> B'],
      ['code', '```\n<c:chart/>\n```'],
      ['code', 'graph LR\n:::\n  A --> B'],
    ]);
  });
});

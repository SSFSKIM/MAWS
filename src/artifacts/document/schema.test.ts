// The schema module (D2 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md) in Node: its node and mark set, the
// frozen comment mark, ids on every block, and S1's parity check: a document with every stored node and mark goes
// through `pmnodeToDelta` → a Y.Doc → `ynodeToPmnode` unchanged.
import { describe, expect, it } from 'vitest';
import { newDoc, stateV2, applyV2 } from '../yjs';
import { pmnodeToDelta, ynodeToPmnode } from '../yjs/prosemirror';
import { everyKindJSON } from './fixtures';
import { ATTRIBUTION_MARKS, BLOCK_TYPES, attributedNodes, nanoid8, schemaFor } from './schema';

const schema = schemaFor();

describe('the schema module', () => {
  it('holds D2’s nodes, the four --attributed variants and nothing else', () => {
    expect(Object.keys(schema.nodes).sort()).toEqual(
      [
        'doc', 'paragraph', 'text', 'hardBreak', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
        'blockquote', 'codeBlock', 'table', 'tableRow', 'tableCell', 'tableHeader', 'image', 'horizontalRule', 'callout',
        'math', 'mathBlock', 'diagram', 'chart', 'pending', 'date', 'mention', 'dropdown',
        'blockquote--attributed', 'listItem--attributed', 'taskItem--attributed', 'callout--attributed',
      ].sort(),
    );
  });

  it('holds D2’s marks and nothing else', () => {
    expect(Object.keys(schema.marks).sort()).toEqual(
      ['bold', 'italic', 'underline', 'strike', 'code', 'link', 'highlight', 'comment', ...ATTRIBUTION_MARKS].sort(),
    );
  });

  it('freezes the comment mark at one attribute, overlapping and non-inclusive', () => {
    const comment = schema.marks.comment;
    expect(Object.keys(comment.spec.attrs ?? {})).toEqual(['threadId']);
    expect(comment.excludes(comment)).toBe(false);
    expect(comment.spec.inclusive).toBe(false);
  });

  it('allows a comment on a code block (S5 pitfall 5) and the attribution marks on every container', () => {
    expect(schema.nodes.codeBlock.allowsMarkType(schema.marks.comment)).toBe(true);
    for (const name of ['doc', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'codeBlock', 'table', 'tableRow', 'tableCell', 'tableHeader', 'callout']) {
      for (const mark of ATTRIBUTION_MARKS) expect(schema.nodes[name].allowsMarkType(schema.marks[mark]), `${mark} on ${name}`).toBe(true);
    }
  });

  it('leaves `code` excluding as Tiptap ships it (S1 pitfall 4: excludes changes the storage key)', () => {
    expect(schema.marks.code.excludes(schema.marks.bold)).toBe(true);
    expect(schema.marks.code.excludes(schema.marks.code)).toBe(true);
  });

  it('gives every block type and its --attributed variant an id, and keeps the D2 attributes', () => {
    for (const name of BLOCK_TYPES) expect(schema.nodes[name].spec.attrs, name).toHaveProperty('id');
    for (const name of ['blockquote', 'listItem', 'taskItem', 'callout']) expect(schema.nodes[`${name}--attributed`].spec.attrs).toHaveProperty('id');
    expect(schema.nodes.image.spec.attrs).not.toHaveProperty('id');
    const attrs = (name: string) => Object.keys(schema.nodes[name].spec.attrs ?? {}).filter((key) => key !== 'id').sort();
    expect(attrs('heading')).toEqual(['level']);
    expect(attrs('callout')).toEqual(['tone']);
    expect(attrs('image')).toEqual(['alt', 'assetId', 'src']);
    expect(attrs('math')).toEqual(['latex']);
    expect(attrs('mathBlock')).toEqual(['latex']);
    expect(attrs('diagram')).toEqual(['source']);
    expect(attrs('chart')).toEqual(['source', 'spec']);
    expect(attrs('pending')).toEqual(['intent']);
    expect(attrs('date')).toEqual(['iso']);
    expect(attrs('mention')).toEqual(['kind', 'label', 'ref']);
    expect(attrs('dropdown')).toEqual(['options', 'value']);
    expect(attrs('taskItem')).toEqual(['checked']);
    expect(Object.keys(schema.marks.link.spec.attrs ?? {}).sort()).toEqual(['href', 'title']);
    expect(Object.keys(schema.marks.highlight.spec.attrs ?? {})).toEqual(['color']);
    expect(schema.nodes.heading.create({ level: 1 }).attrs.level).toBe(1);
    expect(schema.nodes.math.isInline && schema.nodes.mathBlock.isBlock).toBe(true);
  });

  it('is one object per process', () => {
    expect(schemaFor()).toBe(schemaFor());
  });

  it('mints ids of 8 characters from [0-9a-z]', () => {
    for (let i = 0; i < 50; i++) expect(nanoid8()).toMatch(/^[0-9a-z]{8}$/);
  });

  it('renders a strict container holding a deletion as its --attributed variant', () => {
    expect(attributedNodes('callout', { delete: true })).toBe(true);
    expect(attributedNodes('callout', { insert: true })).toBe(false);
    expect(attributedNodes('paragraph', { delete: true })).toBe(false);
  });
});

describe('S1’s parity check', () => {
  it('has a fixture holding every node and mark the binding stores', () => {
    const nodes = new Set<string>();
    const marks = new Set<string>();
    schema.nodeFromJSON(everyKindJSON()).descendants((node) => {
      nodes.add(node.type.name);
      for (const mark of node.marks) marks.add(mark.type.name);
    });
    nodes.add('doc');
    const renderOnly = (name: string) => name.endsWith('--attributed') || name.startsWith('y-attributed-');
    expect([...nodes].sort()).toEqual(Object.keys(schema.nodes).filter((name) => !renderOnly(name)).sort());
    expect([...marks].sort()).toEqual(Object.keys(schema.marks).filter((name) => !renderOnly(name)).sort());
  });

  it('takes a document with every stored node and mark through Yjs and back byte-identically', () => {
    const doc = schema.nodeFromJSON(everyKindJSON());
    doc.check();
    const ydoc = newDoc();
    ydoc.get('default').applyDelta(pmnodeToDelta(doc));
    const reloaded = newDoc();
    applyV2(reloaded, stateV2(ydoc));
    const back = ynodeToPmnode(reloaded.get('default'), schema);
    expect(JSON.stringify(back.toJSON())).toBe(JSON.stringify(doc.toJSON()));
    expect(back.eq(doc)).toBe(true);
    // and written again, it stores what it was read from
    const again = newDoc();
    again.get('default').applyDelta(pmnodeToDelta(back));
    expect(JSON.stringify(again.get('default').toDelta().toJSON())).toBe(JSON.stringify(reloaded.get('default').toDelta().toJSON()));
  });
});

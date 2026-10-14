// The linked-directory mirror's writer registry (the P3-L document, Decision Log 12): what each kind writes under
// `<linkedDir>/artifacts/`, the slug every writer names its files by, and the registry B, C and D add their kinds to.
import { afterEach, describe, expect, it } from 'vitest';
import { newDoc } from '@artifacts/yjs';
import type { Artifact } from '@shared/artifacts/entity';
import { mirrorSlug, mirrorWriterFor, registerMirrorWriter, type MirrorWriter } from './mirror';

const ID = '1a2b3c4d-0000-4000-8000-000000000000';
const artifact = (over: Partial<Artifact> = {}): Artifact => ({
  id: ID, kind: 'html', title: 'Launch plan', createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, ...over,
});
const page = new TextEncoder().encode('<p>hi</p>');

const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
});

describe('mirrorSlug', () => {
  it('is the title made path-safe, suffixed with the id’s first 8 characters', () => {
    expect(mirrorSlug(artifact())).toBe('Launch-plan-1a2b3c4d');
    expect(mirrorSlug(artifact({ title: 'a/b\\c:d*e?f"g<h>i|j\u0007k  l' }))).toBe('a-b-c-d-e-f-g-h-i-j-k-l-1a2b3c4d');
    expect(mirrorSlug(artifact({ title: '..hidden' }))).toBe('hidden-1a2b3c4d'); // never a dot file
    expect(mirrorSlug(artifact({ title: '  ' }))).toBe('untitled-1a2b3c4d');
    expect(mirrorSlug(artifact({ title: '회의록 2026' }))).toBe('회의록-2026-1a2b3c4d');
    expect(mirrorSlug(artifact({ title: 'é' }))).toBe('é-1a2b3c4d'); // NFC, one name whatever the input form
    expect([...mirrorSlug(artifact({ title: '가'.repeat(200) })).replace(/-1a2b3c4d$/, '')]).toHaveLength(64);
  });
});

describe('the built-in writers', () => {
  it('writes an html artifact as <slug>.html', () => {
    expect(mirrorWriterFor('html')!({ artifact: artifact(), bytes: page, name: 'index.html' })).toEqual({ files: { 'Launch-plan-1a2b3c4d.html': page } });
  });

  it('writes a file artifact as a copy under its own name prefixed by the slug', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(mirrorWriterFor('file')!({ artifact: artifact({ kind: 'file', title: 'Q3 report' }), bytes, name: 'report.pdf' })).toEqual({ files: { 'Q3-report-1a2b3c4d-report.pdf': bytes } });
  });

  it('writes nothing for a byte artifact whose content it was not given', () => {
    expect(mirrorWriterFor('html')!({ artifact: artifact() })).toEqual({ files: {} });
    expect(mirrorWriterFor('file')!({ artifact: artifact({ kind: 'file' }), name: 'big.mov' })).toEqual({ files: {} });
  });
});

describe('registerMirrorWriter', () => {
  it('adds a kind, the last registration winning, and its unregister removes only its own', () => {
    expect(mirrorWriterFor('document')).toBeUndefined(); // a kind without a writer mirrors as nothing
    const first: MirrorWriter = ({ artifact: a }) => ({ files: { [`${mirrorSlug(a)}.md`]: 'one' } });
    const second: MirrorWriter = ({ artifact: a, doc }) => ({ files: { [`${mirrorSlug(a)}.md`]: doc!.get('root').toString() } });
    const offFirst = registerMirrorWriter('document', first);
    offs.push(registerMirrorWriter('document', second));
    expect(mirrorWriterFor('document')).toBe(second);
    offFirst(); // superseded: leaves the current one
    expect(mirrorWriterFor('document')).toBe(second);
    const doc = newDoc();
    doc.get('root').insert(0, 'body');
    expect(mirrorWriterFor('document')!({ artifact: artifact({ kind: 'document', title: 'Doc' }), doc })).toEqual({ files: { 'Doc-1a2b3c4d.md': 'body' } });
    offs.pop()!();
    expect(mirrorWriterFor('document')).toBeUndefined();
  });

  it('lets a registration replace a built-in writer, which is back once it unregisters', () => {
    const builtIn = mirrorWriterFor('html');
    const custom: MirrorWriter = () => ({ files: {} });
    const off = registerMirrorWriter('html', custom);
    expect(mirrorWriterFor('html')).toBe(custom);
    off();
    off(); // idempotent
    expect(mirrorWriterFor('html')).toBe(builtIn);
  });
});

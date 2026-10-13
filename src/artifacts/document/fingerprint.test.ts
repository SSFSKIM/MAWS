// Schema parity in CI (D4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the schema module's fingerprint
// (names, attributes and defaults, content and mark expressions, every mark's Yjs storage key) equals the committed
// fingerprint.json. A difference is a change to what stored documents mean: deliberate ones regenerate the file.
import { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { fingerprintUpdateRequested, readFingerprintFile, writeFingerprintFile } from '../../../test/support/fingerprint-file';
import { fingerprint, fingerprintJSON } from './fingerprint';
import { schemaFor } from './schema';

const REGENERATE = 'MAWS_UPDATE_FINGERPRINT=1 pnpm -C <worktree> exec vitest run src/artifacts/document/fingerprint.test.ts';

/** The schema with one attribute added to `mark` (what a careless edit to schema.ts would build). */
function withAddedAttribute(mark: string): Schema {
  const spec = schemaFor().spec;
  const current = spec.marks.get(mark)!;
  return new Schema({ ...spec, marks: spec.marks.update(mark, { ...current, attrs: { ...current.attrs, resolved: { default: false } } }) });
}

describe('the schema fingerprint', () => {
  it('equals the committed fingerprint.json', () => {
    const current = fingerprintJSON();
    const committed = readFingerprintFile();
    if (fingerprintUpdateRequested()) {
      expect(current, 'MAWS_UPDATE_FINGERPRINT=1, but the fingerprint is unchanged: nothing to regenerate').not.toBe(committed);
      writeFingerprintFile(current);
      return;
    }
    expect(
      JSON.parse(current),
      `The document schema's fingerprint changed: stored documents would be read under different keys or content rules. If the change is deliberate (a normalization of stored documents is planned), regenerate with: ${REGENERATE}`,
    ).toEqual(committed == null ? null : JSON.parse(committed));
    expect(current, 'fingerprint.json is not in its canonical form: regenerate it').toBe(committed);
  });

  it('holds every mark’s storage key, as @y/prosemirror writes it', () => {
    const { marks } = fingerprint();
    expect(marks.bold.storageKey).toBe('bold');
    expect(marks.link.storageKey).toBe('link');
    expect(marks.comment.storageKey).toMatch(/^comment--[A-Za-z0-9+/=]{8}$/);
    for (const name of ['y-attributed-insert', 'y-attributed-delete', 'y-attributed-format', 'y-attributed-attrs']) expect(marks[name].storageKey).toBeNull();
    for (const [name, mark] of Object.entries(marks)) if (!name.startsWith('y-attributed-')) expect(mark.storageKey, name).not.toBeNull();
  });

  it('changes when a mark gains an attribute, the comment’s storage key with it (S5 pitfall 1)', () => {
    const committed = fingerprint();
    const changed = fingerprint(withAddedAttribute('comment'));
    expect(changed.marks.comment.attrs).toEqual({ resolved: false, threadId: null });
    expect(changed.marks.comment.storageKey).not.toBe(committed.marks.comment.storageKey);
    expect(fingerprintJSON(withAddedAttribute('bold'))).not.toBe(fingerprintJSON());
  });
});

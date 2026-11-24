// The question sheet's pin (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §A): the published set,
// copied whole from doperpowers, is the set its provenance names, and no byte of it has moved since.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SHEET = join(__dirname, '../../../test/fixtures/sheet');
const SET = join(SHEET, 'set');

function filesOf(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(root, path).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

// The set's README: the SHA-256 of the lines `<sha256>  <path>\n` of every file but MANIFEST.json, sorted by path.
function digestOf(root: string): string {
  const lines = filesOf(root)
    .filter((path) => path !== 'MANIFEST.json')
    .map((path) => `${sha256(readFileSync(join(root, path)))}  ${path}\n`);
  return sha256(lines.join(''));
}

describe('the pin of the question sheet’s set', () => {
  const manifest = JSON.parse(readFileSync(join(SET, 'MANIFEST.json'), 'utf8')) as { digest: string; files: Record<string, string> };
  const digest = digestOf(SET);

  it('recomputes to the manifest’s digest', () => {
    expect(digest).toBe(manifest.digest);
  });

  it('is the copy its provenance names', () => {
    const named = readFileSync(join(SHEET, 'PROVENANCE.md'), 'utf8').match(/\b[0-9a-f]{64}\b/g) ?? [];
    expect({ computed: digest, provenance: named }).toEqual({ computed: digest, provenance: [digest] });
  });

  it('holds exactly the files its manifest lists, each with its listed hash', () => {
    const held = filesOf(SET).filter((path) => path !== 'MANIFEST.json');
    expect(held).toEqual(Object.keys(manifest.files).sort());
    for (const path of held) expect(sha256(readFileSync(join(SET, path))), path).toBe(manifest.files[path]);
  });
});

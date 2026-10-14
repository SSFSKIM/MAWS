// Each default through the document model (M5's last proof): the authored files of every bundled system go into a
// fresh doc through `writeSystem` and come back from `readFiles` unchanged, byte for byte, because the defaults' token
// files are already canonical. The generated files are checked apart: present on read, refused on publish.
// The list is `DEFAULT_SYSTEMS`, never hard-coded. Assets (`assets/*`) are not in `DEFAULT_SYSTEMS.files`: they are
// A's, uploaded by `artifact_upload_asset`, and never live in the doc, so they are outside this round trip.
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { GENERATED_PATHS, publishSystem, readFiles, SystemFilesError, writeSystem } from '../../design-system/model';
import type { HtmlParser } from '../../design-system';
import { newDoc } from '../../yjs';
import { DEFAULT_SYSTEMS } from './defaults';

const parser = new new Window().DOMParser() as unknown as HtmlParser;
const AT = 1_760_000_000_000;

const seed = (system: (typeof DEFAULT_SYSTEMS)[number]) => {
  const doc = newDoc();
  const { name } = writeSystem(doc, system.files, { route: 'default', key: system.key, at: AT }, { name: system.name, parser });
  return { doc, name };
};

describe('the bundled defaults through the document model', () => {
  it('has defaults to prove', () => {
    expect(DEFAULT_SYSTEMS.length).toBeGreaterThan(0);
  });

  for (const system of DEFAULT_SYSTEMS) {
    describe(system.key, () => {
      it('reads back every authored file unchanged after writeSystem', () => {
        const { doc, name } = seed(system);
        expect(name).toBe(system.name);
        const out = readFiles(doc);
        expect(Object.keys(system.files).length).toBeGreaterThan(0);
        for (const [path, text] of Object.entries(system.files)) expect(out[path], path).toBe(text);
        // Nothing authored is dropped or invented: what is read beyond the authored files is exactly the generated pair.
        expect(Object.keys(out).filter((path) => !(path in system.files)).sort()).toEqual([...GENERATED_PATHS].sort());
      });

      it('reads the generated files, and refuses a publish of either', () => {
        const { doc } = seed(system);
        const out = readFiles(doc);
        for (const path of GENERATED_PATHS) {
          expect(out[path], path).toBeTruthy();
          const attempt = () => publishSystem(doc, out, { [path]: out[path]! }, false, { parser });
          expect(attempt, path).toThrow(SystemFilesError);
          expect(attempt, path).toThrow(/generated/);
        }
        // The refusal wrote nothing.
        expect(readFiles(doc)).toEqual(out);
      });
    });
  }
});

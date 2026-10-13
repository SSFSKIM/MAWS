import { describe, expect, it } from 'vitest';
import { ARTIFACT_KINDS, type ArtifactKind } from '@shared/artifacts/entity';
import { KIND_GUIDES } from './guides';

const OWNED_ELSEWHERE: ArtifactKind[] = ['document', 'presentation', 'design', 'dashboard']; // design_system: P3-D wrote its own (its M5)
const headings = (text: string) => text.split('\n').filter((line) => line.startsWith('## '));

describe('the kinds’ guides and format references', () => {
  it('bundles a guide and a format reference for every kind, each titled', () => {
    expect(Object.keys(KIND_GUIDES).sort()).toEqual([...ARTIFACT_KINDS].sort());
    for (const kind of ARTIFACT_KINDS) {
      for (const text of [KIND_GUIDES[kind].guide, KIND_GUIDES[kind].format]) {
        expect(text, kind).toMatch(/^# \S/);
        expect(headings(text).length, kind).toBeGreaterThan(0);
      }
    }
  });

  it('shapes the kinds B, C and E own as placeholders: every section named and marked not yet written', () => {
    for (const kind of OWNED_ELSEWHERE) {
      for (const text of [KIND_GUIDES[kind].guide, KIND_GUIDES[kind].format]) {
        const sections = text.split('\n## ').slice(1);
        expect(sections.length, kind).toBeGreaterThan(1);
        for (const section of sections) expect(section, `${kind}: ${section.split('\n')[0]}`).toMatch(/Not yet written/);
      }
    }
  });

  it('writes the two kinds A owns in full', () => {
    for (const kind of ['html', 'file'] as const) {
      for (const text of [KIND_GUIDES[kind].guide, KIND_GUIDES[kind].format]) expect(text, kind).not.toMatch(/Not yet written/);
    }
    expect(KIND_GUIDES.html.guide).toMatch(/artifact_publish/);
    expect(KIND_GUIDES.file.guide).toMatch(/send_file/);
  });
});

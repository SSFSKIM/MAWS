import { describe, expect, it } from 'vitest';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import { KIND_GUIDES } from './guides';

// The placeholder's own marker (M1): a file its owner (B, C, D, E) has not written yet says so in every section. Once
// the owner writes the file, the marker is gone and the placeholder shape no longer applies.
const PLACEHOLDER = /Not yet written/;
const headings = (text: string) => text.split('\n').filter((line) => line.startsWith('## '));
const files = ARTIFACT_KINDS.flatMap((kind) => [
  { kind, name: 'SKILL.md', text: KIND_GUIDES[kind].guide },
  { kind, name: 'format.md', text: KIND_GUIDES[kind].format },
]);

describe('the kinds’ guides and format references', () => {
  it('bundles a guide and a format reference for every kind, each titled', () => {
    expect(Object.keys(KIND_GUIDES).sort()).toEqual([...ARTIFACT_KINDS].sort());
    for (const { kind, name, text } of files) {
      expect(text, `${kind}/${name}`).toMatch(/^# \S/);
      expect(headings(text).length, `${kind}/${name}`).toBeGreaterThan(0);
    }
  });

  it('keeps a file that is still a placeholder whole: every section named and marked not yet written', () => {
    for (const { kind, name, text } of files.filter((file) => PLACEHOLDER.test(file.text))) {
      const sections = text.split('\n## ').slice(1);
      expect(sections.length, `${kind}/${name}`).toBeGreaterThan(1);
      for (const section of sections) expect(section, `${kind}/${name}: ${section.split('\n')[0]} (a file being written is finished before it lands)`).toMatch(PLACEHOLDER);
    }
  });

  it('writes the two kinds A owns in full', () => {
    for (const kind of ['html', 'file'] as const) {
      for (const text of [KIND_GUIDES[kind].guide, KIND_GUIDES[kind].format]) expect(text, kind).not.toMatch(PLACEHOLDER);
    }
    expect(KIND_GUIDES.html.guide).toMatch(/artifact_publish/);
    expect(KIND_GUIDES.file.guide).toMatch(/send_file/);
  });

  // P3-B (M7): the document kind's guide and format reference (their examples are checked against the dialect in
  // document/format.test.ts)
  it('writes the document kind in full: the guide names its tools, the format reference its dialect', () => {
    const { guide, format } = KIND_GUIDES.document;
    for (const text of [guide, format]) expect(text).not.toMatch(PLACEHOLDER);
    expect(headings(guide)).toEqual(['## When to use this kind', '## Creating one', '## Reading and editing', '## Comments', '## Working with a design system', '## Before you finish']);
    expect(headings(format)).toEqual(['## Structure', '## Elements and attributes', '## Limits', '## Examples']);
    for (const name of ['artifact_create', 'artifact_read', 'sinceRevision', 'artifact_edit', 'baseRevision', 'answering', 'artifact_comments', 'artifact_reply', 'artifact_resolve']) expect(guide).toContain(name);
    for (const form of ['^id', '<!-- ^id -->', '<c:ID>', '<chip kind="date"', ':::table', ':::row', ':::callout', ':::pending', 'two to four spaces']) expect(format).toContain(form);
  });
});

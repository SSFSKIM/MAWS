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

  // UX wave U10b (l6-artifacts-18, §A.4): when a reader filters, an html page; a rebuilt page publishes from its file
  it('tells the agent when a dashboard is the wrong kind, and how to publish a rebuilt page by path', () => {
    const when = KIND_GUIDES.dashboard.guide.split('\n## ').find((section) => section.startsWith('When to use this kind'))!;
    expect(when.trimEnd().endsWith("A dashboard's views have no controls for the reader: a filter is fixed in each view's spec. When the user should filter or explore the data themselves, make an `html` page.")).toBe(true);
    const editing = KIND_GUIDES.html.guide.split('\n## ').find((section) => section.startsWith('Reading and editing'))!;
    expect(editing).toContain('and `files: {"index.html": "<the whole new page>"}`. When you rebuilt the page as a file, pass `path` (that .html file) in place of `files`: its bytes become the new version.');
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

  // P3-F wave S (F14, the owner's obs 2): the guide a create hands the agent says how to name the artifact to the human
  it('ends every kind’s guide, under Before you finish, with the link the human opens the artifact by', () => {
    for (const kind of ARTIFACT_KINDS) {
      const last = KIND_GUIDES[kind].guide.split('\n## ').at(-1)!;
      expect(last.split('\n')[0], kind).toBe('Before you finish');
      expect(last, kind).toContain('[its title](maws-artifact:<artifactId>)');
    }
  });

  // UX wave U6d (O-44): the paragraph that closes every guide, exact, and no guide invites the agent to open a pane
  it('closes every kind’s guide with the link paragraph, word for word, and no guide names show_pane', () => {
    for (const kind of ARTIFACT_KINDS) {
      const { guide } = KIND_GUIDES[kind];
      expect(guide.endsWith('\n\nWhen a message to the user names this artifact, write it as a Markdown link, [its title](maws-artifact:<artifactId>): the user opens it in MAWS with a click.\n'), kind).toBe(true);
      expect(guide, kind).not.toContain('show_pane');
    }
  });
});

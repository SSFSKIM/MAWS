// P3-E1 M2: the design's guide and format reference say what the model enforces. The examples are what the loaders take
// as written (no board held, no warning, already canonical), the limits are the module's, and the guide names the tools,
// the refusals and the rules an agent needs (the reserved `sections` key, the pinned-children hold, the screen defaults,
// the export scale and caps).
import { describe, expect, it } from 'vitest';
import guide from '../types/design/SKILL.md?raw';
import format from '../types/design/format.md?raw';
import { SLIDE_LIMITS } from '../slides/parse';
import { loadSlide } from '../slides/parse';
import { serializeSlide } from '../slides/serialize';
import { CANVAS_LIMITS, parseCanvasJson, serializeCanvasJson } from './canvas';

const section = (text: string, heading: string) => text.split(/^#+ /m).find((s) => s.startsWith(`${heading}\n`)) ?? '';
const fences = (text: string, lang: string) => [...text.matchAll(new RegExp('^```' + lang + '\\n([\\s\\S]*?)\\n```$', 'gm'))].map((m) => m[1]!);
const n = (value: number) => value.toLocaleString('en-US');

describe('format.md (the design format reference)', () => {
  it('keeps the kind’s four sections, written', () => {
    expect(format.split('\n').filter((l) => l.startsWith('## '))).toEqual(['## Structure', '## Elements and attributes', '## Limits', '## Examples']);
    expect(format).not.toMatch(/Not yet written/);
  });

  it('shows boards the loader takes as they are written: none held, no warning, already canonical', () => {
    const boards = fences(section(format, 'Examples'), 'html');
    expect(boards.length).toBeGreaterThanOrEqual(2);
    for (const html of boards) {
      const loaded = loadSlide(html);
      expect(loaded.ok, html.slice(0, 40)).toBe(true);
      if (!loaded.ok) continue;
      expect(loaded.diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
      expect(serializeSlide(loaded.slide)).toBe(`${html}\n`);
    }
  });

  it('shows a manifest the loader takes as it is written', () => {
    const [json] = fences(section(format, 'Examples'), 'json');
    const parsed = parseCanvasJson(json!);
    expect(parsed.ok && parsed.diagnostics).toEqual([]);
    if (parsed.ok) expect(serializeCanvasJson(parsed.canvas)).toBe(`${json}\n`);
  });

  it('states the module’s limits', () => {
    const limits = section(format, 'Limits');
    for (const value of [CANVAS_LIMITS.boards, CANVAS_LIMITS.side, CANVAS_LIMITS.area, SLIDE_LIMITS.pinnedPerHost, SLIDE_LIMITS.elements, 8_192, 19_200]) expect(limits).toContain(n(value));
    expect(limits).toContain('16 MB');
  });

  it('names the reserved deck-only key and the screen defaults', () => {
    expect(format).toMatch(/`sections`[^\n]*refused/);
    for (const value of ['16px', '1.5', '32px', '24px', '20px', '600']) expect(section(format, 'Elements and attributes')).toContain(value);
  });
});

describe('SKILL.md (the design guide)', () => {
  it('is written, and names the tools, the conflict layers, the export rules and the rules that hold a board', () => {
    expect(guide).not.toMatch(/Not yet written/);
    for (const name of ['artifact_create', 'artifact_read', 'artifact_publish', 'baseRevision', 'force', 'conflict', 'held', 'artifact_upload_asset', 'artifact_comments', 'artifact_reply', 'artifact_resolve', 'artifact_export', 'scale', 'sections', '24']) expect(guide).toContain(name);
    expect(guide).toMatch(/8,192/);
    expect(guide).toMatch(/never crop/i);
  });
});

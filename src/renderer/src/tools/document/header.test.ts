// The document's X32 header (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D13): the saved state mapped
// from the replica's DocumentState, the open-thread count, the actions in importance order (History, Export's word,
// Save version, Comments, Agent edits as suggestions) so the 360 px fold keeps the first, the four formats with Letter
// and A4 for the paged ones, an export's progress and failure said in the header's own action, and the close guard.
import { describe, expect, it, vi } from 'vitest';
import type { DocumentState } from '@artifacts/host';
import { documentHeader, savedOf, type DocumentHeaderCommands, type DocumentHeaderState } from './header';

const live = (fields: Partial<DocumentState> = {}): DocumentState => ({ phase: 'live', synced: true, unsaved: 0, revision: 4, readOnly: false, ...fields });

function commands(): DocumentHeaderCommands {
  return { toggleRail: vi.fn(), saveVersion: vi.fn(), setSuggestions: vi.fn(), export: vi.fn(), dismissExport: vi.fn(), closeGuard: vi.fn(async () => true) };
}
const state = (fields: Partial<DocumentHeaderState> = {}): DocumentHeaderState => ({
  title: 'Launch plan',
  document: live(),
  saving: false,
  previewing: false,
  unresolved: 0,
  rail: null,
  history: true,
  suggestions: false,
  exporting: null,
  ...fields,
});

describe('savedOf (D13)', () => {
  it('maps the replica’s state to the header’s word', () => {
    expect(savedOf(null, false, false)).toBeNull(); // still opening: no word yet
    expect(savedOf(live(), false, false)).toBe('saved');
    expect(savedOf(live({ unsaved: 2 }), false, false)).toBe('saved'); // acknowledged within the tab's delay: no flicker (M9)
    expect(savedOf(live({ unsaved: 2 }), false, true)).toBe('saving'); // edits waited past it
    expect(savedOf(live({ phase: 'off', synced: false, unsaved: 2 }), false, true)).toBe('reconnecting');
    expect(savedOf(live({ phase: 'handshake', synced: false }), false, false)).toBe('reconnecting');
    expect(savedOf(live({ readOnly: true }), false, false)).toBe('readonly');
    expect(savedOf(live({ readOnly: true, phase: 'off' }), false, false)).toBe('readonly');
    expect(savedOf(live({ unsaved: 1 }), true, true)).toBe('readonly'); // a version is shown, not the live document
  });
});

describe('documentHeader', () => {
  it('carries the title, the saved word and the open threads', () => {
    const header = documentHeader(state({ unresolved: 3, document: live({ unsaved: 1 }), saving: true }), commands());
    expect(header).toMatchObject({ title: 'Launch plan', saved: 'saving', unresolved: 3 });
  });

  it('orders the actions by importance, the comments action under the id the header counts on', () => {
    const header = documentHeader(state(), commands());
    expect(header.actions!.map((a) => [a.id, a.label])).toEqual([
      ['history', 'Version history'],
      ['save-version', 'Save version'],
      ['comments', 'Comments'],
      ['suggestions', 'Agent edits as suggestions'],
    ]);
    expect(header.actions!.find((a) => a.id === 'suggestions')!.pressed).toBe(false);
    expect(documentHeader(state({ rail: 'history' }), commands()).actions![0].pressed).toBe(true);
    expect(documentHeader(state({ rail: 'comments' }), commands()).actions!.find((a) => a.id === 'comments')!.pressed).toBe(true);
  });

  it('offers no history actions without a history, and nothing to toggle while the setting is unknown', () => {
    const header = documentHeader(state({ history: false, suggestions: null }), commands());
    expect(header.actions!.map((a) => a.id)).toEqual(['comments', 'suggestions']);
    expect(header.actions!.find((a) => a.id === 'suggestions')!.disabled).toBe(true);
  });

  it('runs each action through the tab’s commands', () => {
    const c = commands();
    const header = documentHeader(state({ rail: 'history', suggestions: true }), c);
    for (const action of header.actions!) action.onSelect();
    expect(c.toggleRail).toHaveBeenNthCalledWith(1, 'history');
    expect(c.toggleRail).toHaveBeenNthCalledWith(2, 'comments');
    expect(c.saveVersion).toHaveBeenCalledOnce();
    expect(c.setSuggestions).toHaveBeenCalledWith(false);
    expect(header.closeGuard).toBe(c.closeGuard);
  });

  it('exports the four formats, Letter by default and A4 on its own entry for the paged ones (Decision Log 43)', () => {
    const c = commands();
    const header = documentHeader(state(), c);
    expect(header.exports!.map((e) => e.label)).toEqual(['Markdown (.md)', 'Web page (.html)', 'Word (.docx)', 'Word, A4 (.docx)', 'PDF (.pdf)', 'PDF, A4 (.pdf)']);
    for (const entry of header.exports!) entry.onSelect();
    expect(vi.mocked(c.export).mock.calls).toEqual([
      ['md', 'letter'],
      ['html', 'letter'],
      ['docx', 'letter'],
      ['docx', 'a4'],
      ['pdf', 'letter'],
      ['pdf', 'a4'],
    ]);
  });

  it('says an export’s progress and its failure in the header’s action, second, and holds the menu while one runs', () => {
    const c = commands();
    const running = documentHeader(state({ exporting: { phase: 'running', format: 'pdf' } }), c);
    expect(running.actions![1]).toMatchObject({ id: 'export', label: 'Exporting PDF…', disabled: true });
    expect(running.exports!.every((e) => e.disabled)).toBe(true);
    const failed = documentHeader(state({ exporting: { phase: 'failed', format: 'docx', message: 'exporting an artifact is not available yet' } }), c);
    expect(failed.actions![1]).toMatchObject({ id: 'export', label: 'Word export failed: exporting an artifact is not available yet' });
    failed.actions![1].onSelect();
    expect(c.dismissExport).toHaveBeenCalledOnce();
    expect(failed.exports!.every((e) => !e.disabled)).toBe(true);
    const long = documentHeader(state({ exporting: { phase: 'failed', format: 'md', message: 'x'.repeat(200) } }), c);
    expect(long.actions![1].label.length).toBeLessThanOrEqual(80);
    const done = documentHeader(state({ exporting: { phase: 'done', format: 'html', path: '/tmp/a/7-html.html' } }), c);
    expect(done.actions![1]).toMatchObject({ id: 'export', label: 'Exported 7-html.html' });
  });
});

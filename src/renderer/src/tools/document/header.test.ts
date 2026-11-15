// The document's X32 header (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D13): the saved state mapped
// from the replica's DocumentState, the open-thread count badge, the non-card actions in importance order
// (Export's word, Save version, Agent edits as suggestions), an export's progress and failure said in the header's own
// action, and the close guard. UX wave U10b (§B.5 of docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md): a
// document's Export menu is the four formats, which send no size, then the page items Letter, A4 and Compact, checked
// as the page in force; a dashboard's is today's six rows; the history card's is the four formats.
import { describe, expect, it, vi } from 'vitest';
import type { DocumentState } from '@artifacts/host';
import { documentExports, documentHeader, EXPORT_COPY, FORMAT_NAMES, savedOf, type DocumentHeaderCommands, type DocumentHeaderState } from './header';

const live = (fields: Partial<DocumentState> = {}): DocumentState => ({ phase: 'live', synced: true, unsaved: 0, revision: 4, integrated: 0, readOnly: false, ...fields });

function commands(): DocumentHeaderCommands {
  return { toggleRail: vi.fn(), saveVersion: vi.fn(), setSuggestions: vi.fn(), export: vi.fn(), choosePage: vi.fn(), dismissExport: vi.fn(), closeGuard: vi.fn(async () => true) };
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
  shown: null, // P3-F (F7)
  kind: 'document', // UX wave U10b
  page: { size: 'letter', compact: false, sizeKnown: true, disabled: false },
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

  it('keeps card toggles in the document toolbar while retaining the title header’s other actions', () => {
    const c = commands();
    const header = documentHeader(state({ unresolved: 3 }), c);
    expect(header.actions!.map((a) => [a.id, a.label])).toEqual([
      ['save-version', 'Save version'],
      ['suggestions', 'Agent edits as suggestions'],
    ]);
    for (const action of header.actions!) action.onSelect();
    expect(c.toggleRail).not.toHaveBeenCalled();
    expect(header.unresolved).toBe(3); // no registered Comments action: the header renders a non-interactive count badge
    expect(header.actions!.find((a) => a.id === 'suggestions')!.pressed).toBe(false);
  });

  it('offers no history actions without a history, and nothing to toggle while the setting is unknown', () => {
    const header = documentHeader(state({ history: false, suggestions: null }), commands());
    expect(header.actions!.map((a) => a.id)).toEqual(['suggestions']);
    expect(header.actions!.find((a) => a.id === 'suggestions')!.disabled).toBe(true);
  });

  it('runs each action through the tab’s commands', () => {
    const c = commands();
    const header = documentHeader(state({ rail: 'history', suggestions: true }), c);
    for (const action of header.actions!) action.onSelect();
    expect(c.toggleRail).not.toHaveBeenCalled();
    expect(c.saveVersion).toHaveBeenCalledOnce();
    expect(c.setSuggestions).toHaveBeenCalledWith(false);
    expect(header.closeGuard).toBe(c.closeGuard);
  });

  // UX wave U10b (§B.5; H7): the four formats send no size, so the export prints on the document's page (the size the
  // call names, else the document's, else its system's); the page is the three items after them
  it('exports a document’s four formats with no size, then offers Letter, A4 and Compact checked as the page in force', () => {
    const c = commands();
    const header = documentHeader(state({ page: { size: 'a4', compact: true, sizeKnown: true, disabled: false } }), c);
    expect(header.exports!.map((e) => [e.id, e.label, e.checked])).toEqual([
      ['md', 'Markdown (.md)', undefined],
      ['html', 'Web page (.html)', undefined],
      ['docx', 'Word (.docx)', undefined],
      ['pdf', 'PDF (.pdf)', undefined],
      ['page-letter', 'Letter', false],
      ['page-a4', 'A4', true],
      ['page-compact', 'Compact', true],
    ]);
    expect(c.export, 'building the menu exports nothing').not.toHaveBeenCalled();
    expect(c.choosePage, 'and writes nothing').not.toHaveBeenCalled();
    for (const entry of header.exports!) entry.onSelect();
    expect(vi.mocked(c.export).mock.calls).toEqual([['md'], ['html'], ['docx'], ['pdf']]);
    expect(vi.mocked(c.choosePage).mock.calls).toEqual([['letter'], ['a4'], ['compact']]);
  });

  it('checks neither size where the page in force is neither, and holds the sizes, not Compact, while it is not known', () => {
    const neither = documentHeader(state({ page: { size: null, compact: false, sizeKnown: true, disabled: false } }), commands());
    expect(neither.exports!.filter((e) => e.checked !== undefined).map((e) => [e.label, e.checked, e.disabled])).toEqual([
      ['Letter', false, false],
      ['A4', false, false],
      ['Compact', false, false],
    ]);
    const unknown = documentHeader(state({ page: { size: null, compact: false, sizeKnown: false, disabled: false } }), commands());
    expect(unknown.exports!.filter((e) => e.checked !== undefined).map((e) => [e.label, e.disabled])).toEqual([
      ['Letter', true],
      ['A4', true],
      ['Compact', false],
    ]);
  });

  // M3 decision 2: a document opened to view, or a version shown, shows the setting and takes no write
  it('shows the page items disabled while the document cannot be written, still checked as the page in force', () => {
    const header = documentHeader(state({ page: { size: 'letter', compact: true, sizeKnown: true, disabled: true } }), commands());
    expect(header.exports!.filter((e) => e.checked !== undefined).map((e) => [e.label, e.checked, e.disabled])).toEqual([
      ['Letter', true, true],
      ['A4', false, true],
      ['Compact', true, true],
    ]);
    expect(header.exports!.filter((e) => e.checked === undefined).every((e) => !e.disabled), 'its formats still export').toBe(true);
  });

  // H8: a dashboard shares the document's header and has no page setting: its menu is today's six rows, each with its size
  it('keeps a dashboard’s six rows, Letter by default and A4 on its own entry for the paged ones (Decision Log 43)', () => {
    const c = commands();
    const header = documentHeader(state({ kind: 'dashboard' }), c);
    expect(header.exports!.map((e) => e.label)).toEqual(['Markdown (.md)', 'Web page (.html)', 'Word (.docx)', 'Word, A4 (.docx)', 'PDF (.pdf)', 'PDF, A4 (.pdf)']);
    expect(header.exports!.some((e) => e.checked !== undefined)).toBe(false);
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

  it('gives a document’s history card the four formats and a dashboard’s its six rows', () => {
    const run = vi.fn();
    const card = documentExports({ versionId: 3 }, false, run, { kind: 'document' });
    expect(card.map((e) => e.label)).toEqual(['Markdown (.md)', 'Web page (.html)', 'Word (.docx)', 'PDF (.pdf)']);
    card.at(-1)!.onSelect();
    expect(run).toHaveBeenLastCalledWith('pdf');
    expect(documentExports({ versionId: 3 }, false, run, { kind: 'dashboard' }).map((e) => e.label)).toHaveLength(6);
  });

  // §B.5: the one sentence an export says when the document's last write is not acknowledged (M3 decision 3)
  it('words an export that waited for an unsaved change in one fixed sentence', () => {
    expect(EXPORT_COPY.exportNotSaved).toBe('The last change is not saved yet. Try again in a moment.');
  });

  // the architect's ruling of 2026-11-15 on M3's report: the sentence is drawn whole in the failed action, whatever the format
  it('draws that sentence whole in the failed export’s action for every format', () => {
    const c = commands();
    for (const format of Object.keys(FORMAT_NAMES) as (keyof typeof FORMAT_NAMES)[]) {
      const { label } = documentHeader(state({ exporting: { phase: 'failed', format, message: EXPORT_COPY.exportNotSaved } }), c).actions![0]!;
      expect([label.endsWith('Try again in a moment.'), label.includes('…')], label).toEqual([true, false]);
    }
  });

  it('says an export’s progress and its failure first in the header’s actions, and holds the menu while one runs', () => {
    const c = commands();
    const running = documentHeader(state({ exporting: { phase: 'running', format: 'pdf' } }), c);
    expect(running.actions![0]).toMatchObject({ id: 'export', label: 'Exporting PDF…', disabled: true });
    expect(running.exports!.every((e) => e.disabled)).toBe(true);
    const failed = documentHeader(state({ exporting: { phase: 'failed', format: 'docx', message: 'exporting an artifact is not available yet' } }), c);
    expect(failed.actions![0]).toMatchObject({ id: 'export', label: 'Word export failed: exporting an artifact is not available yet' });
    failed.actions![0].onSelect();
    expect(c.dismissExport).toHaveBeenCalledOnce();
    expect(failed.exports!.every((e) => !e.disabled)).toBe(true);
    const long = documentHeader(state({ exporting: { phase: 'failed', format: 'md', message: 'x'.repeat(200) } }), c);
    expect(long.actions![0].label.length).toBeLessThanOrEqual(80);
  });

  // P3-F (8.2, F7; c65): an export saved says where in a toast (the tab's), so the header keeps no "Exported …" item that
  // only dismissed itself; while two versions are compared nothing is exported, as the deck's Export (L233)
  it('keeps no finished export in the header, and offers no export while two versions are compared', () => {
    const c = commands();
    expect(documentHeader(state(), c).actions!.some((a) => a.id === 'export')).toBe(false);
    const comparing = documentHeader(state({ previewing: true, shown: 'compare' }), c);
    expect(comparing.exports!.filter((e) => e.checked === undefined).map((e) => e.disabled)).toEqual([true, true, true, true]);
    const version = documentHeader(state({ previewing: true, shown: { versionId: 3 } }), c);
    expect(version.exports!.every((e) => !e.disabled), 'a version shown exports that version').toBe(true);
  });
});

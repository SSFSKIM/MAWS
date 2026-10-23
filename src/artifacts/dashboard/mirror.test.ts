// A dashboard in a linked Space's directory (P3-E2 M5; parent §2 "Exports", E's Decision Log 32): `<slug>.md` in B's
// lossless dialect (the chart blocks as `:::chart`, so an agent reads and rebinds them), `<slug>/datasets.json` naming
// each bound dataset's snapshot file, format and provenance, and each snapshot under `<slug>/data/` as a copy of the
// immutable asset. A snapshot's name is its asset's name, sanitised and bounded in bytes, the full SHA-256 of its ref and
// the descriptor's format: it never depends on the other datasets, so a replacement adds a new name instead of reusing a
// stale copy, case and NFC variants and one ref bound as CSV and TSV never collide. A held legacy dashboard mirrors a
// diagnostic, never an empty document or a guessed conversion.
import { describe, expect, it, vi } from 'vitest';
import { digest } from 'lib0/hash/sha256';
import type { Artifact } from '@shared/artifacts/entity';
import { isMirrorCopy, mirrorSlug, type MirrorAsset, type MirrorInput } from '../library/mirror';
import { newDoc } from '../yjs';
import { comparable, sourceOf } from '../document/convert.fixture';
import { importMarkdown } from '../document/import/markdown';
import { createDocument } from '../document/tabs';
import { setDataset } from './datasets';
import { BOUND_AT, descriptor, exportDashboard, NEW_REF, OLD_REF, REPLACED_AT } from './fixtures/export';
import { dashboardMirrorWriter, snapshotFileName } from './mirror';

const artifact = { id: '00000000-0000-4000-8000-0000000000d1', kind: 'dashboard', title: 'Sales board' } as Artifact;
const slug = mirrorSlug(artifact);
const hex = (text: string) => [...digest(new TextEncoder().encode(text))].map((b) => b.toString(16).padStart(2, '0')).join('');
const asset = (ref: string, name: string): MirrorAsset => ({ ref, name, mime: 'text/csv', size: 40 });
const ASSETS = [asset(OLD_REF, 'sales.csv'), asset(NEW_REF, 'sales.csv')];
const bytes = (ref: string) => new TextEncoder().encode(`bytes of ${ref}`);

function mirrored(doc = exportDashboard().doc, assets = ASSETS) {
  const readAsset = vi.fn((ref: string) => {
    if (!assets.some((a) => a.ref === ref)) throw new Error(`no asset ${ref}`);
    return bytes(ref);
  });
  const input: MirrorInput = { artifact, doc, assets, readAsset };
  return { files: dashboardMirrorWriter(input).files, readAsset };
}

describe('snapshotFileName', () => {
  it('is the asset’s sanitised name, the full SHA-256 of the ref and the format’s extension', () => {
    expect(snapshotFileName('sales.csv', OLD_REF, 'csv')).toBe(`sales-${hex(OLD_REF)}.csv`);
    expect(snapshotFileName('sales.csv', OLD_REF, 'tsv')).toBe(`sales-${hex(OLD_REF)}.tsv`); // one ref, two readings
    expect(snapshotFileName('../../etc/pass:wd?.json', 'assets/x.json', 'json')).toMatch(new RegExp(`^etc-pass-wd-${hex('assets/x.json')}\\.json$`));
    expect(snapshotFileName('.hidden', 'assets/h', 'csv')).toBe(`data-${hex('assets/h')}.csv`);
  });

  it('keeps case and composition apart through the ref’s digest, and is one form (NFC)', () => {
    const upper = snapshotFileName('Sales.csv', 'assets/Sales.csv', 'csv');
    const lower = snapshotFileName('sales.csv', 'assets/sales.csv', 'csv');
    expect(upper.toLowerCase()).not.toBe(lower.toLowerCase());
    const nfd = snapshotFileName('매출.csv'.normalize('NFD'), 'assets/a.csv', 'csv');
    expect(nfd).toBe(nfd.normalize('NFC'));
    expect(snapshotFileName('매출.csv'.normalize('NFD'), 'assets/b.csv', 'csv')).not.toBe(nfd);
  });

  it('bounds the name in UTF-8 bytes, not characters', () => {
    const name = snapshotFileName(`${'가'.repeat(300)}.csv`, OLD_REF, 'csv');
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
    expect(name.endsWith(`-${hex(OLD_REF)}.csv`)).toBe(true);
    expect(name.normalize('NFC')).toBe(name);
  });
});

describe('dashboardMirrorWriter', () => {
  it('keeps prose chip metadata and trailing paragraphs instead of flattening them for a reader export', () => {
    const doc = newDoc();
    const body = sourceOf([
      { type: 'paragraph', content: [{ type: 'mention', attrs: { kind: 'session', ref: 'session-1', label: 'Planning' } }] },
      { type: 'paragraph' },
    ]).tabs[0].body;
    createDocument(doc, { title: 'Board', body });
    const markdown = mirrored(doc, []).files[`${slug}.md`] as string;
    expect(comparable(importMarkdown(markdown))).toEqual(comparable(body));
  });

  it('writes the dialect, the binding manifest and each bound snapshot as a copy of its asset', () => {
    const { files, readAsset } = mirrored();
    const md = files[`${slug}.md`] as string;
    expect(md).toContain(`:::chart {spec-json='{"view":"bar","x":"region","y":"total","title":"Sales by region"}'}\nsales\n:::`);
    const name = `data/sales-${hex(OLD_REF)}.csv`;
    const manifest = JSON.parse(files[`${slug}/datasets.json`] as string);
    expect(manifest).toEqual({
      dashboard: 'Sales board',
      markdown: `../${slug}.md`,
      datasets: {
        sales: {
          title: 'Sales',
          file: name,
          format: 'csv',
          rows: 3,
          columns: [
            { name: 'region', type: 'string' },
            { name: 'total', type: 'number' },
          ],
          snapshot: { ref: OLD_REF, source: 'sales.csv', sha256: 'a'.repeat(64), size: 40, updated: '2026-10-01T09:00:00.000Z' },
        },
      },
    });
    const copy = files[`${slug}/${name}`];
    expect(isMirrorCopy(copy)).toBe(true);
    expect(readAsset).not.toHaveBeenCalled(); // lazy: read only when the mirror lacks the file
    expect(isMirrorCopy(copy) && copy.read()).toEqual(bytes(OLD_REF));
    expect(Object.keys(files).sort()).toEqual([`${slug}.md`, `${slug}/${name}`, `${slug}/datasets.json`].sort());
  });

  it('after a replacement names the new snapshot anew; the old name is no longer written', () => {
    const { doc } = exportDashboard();
    const before = Object.keys(mirrored(doc).files);
    setDataset(doc, 'sales', descriptor(NEW_REF, REPLACED_AT));
    const after = mirrored(doc).files;
    expect(Object.keys(after)).toContain(`${slug}/data/sales-${hex(NEW_REF)}.csv`);
    expect(Object.keys(after)).not.toContain(`${slug}/data/sales-${hex(OLD_REF)}.csv`);
    expect(before).toContain(`${slug}/data/sales-${hex(OLD_REF)}.csv`);
    expect(JSON.parse(after[`${slug}/datasets.json`] as string).datasets.sales.snapshot.updated).toBe('2026-10-02T10:30:00.000Z');
  });

  it('two datasets of one file name get two files; one snapshot bound twice in one format is one file', () => {
    const { doc } = exportDashboard();
    setDataset(doc, 'east', { ...descriptor(NEW_REF, BOUND_AT), title: 'East' });
    setDataset(doc, 'again', descriptor(OLD_REF, BOUND_AT));
    setDataset(doc, 'tabbed', { ...descriptor(OLD_REF, BOUND_AT), source: { ...(descriptor(OLD_REF, BOUND_AT).source as { kind: 'file' }), format: 'tsv' } as never });
    const { files } = mirrored(doc);
    const data = Object.keys(files).filter((file) => file.startsWith(`${slug}/data/`));
    expect(data.sort()).toEqual([`${slug}/data/sales-${hex(NEW_REF)}.csv`, `${slug}/data/sales-${hex(OLD_REF)}.csv`, `${slug}/data/sales-${hex(OLD_REF)}.tsv`].sort());
    const manifest = JSON.parse(files[`${slug}/datasets.json`] as string);
    expect(manifest.datasets.again.file).toBe(manifest.datasets.sales.file);
    expect(manifest.datasets.tabbed.format).toBe('tsv');
  });

  it('a bound snapshot the artifact does not list is named in the manifest as unreadable, no file claimed', () => {
    const { files } = mirrored(exportDashboard().doc, [asset(NEW_REF, 'sales.csv')]);
    const manifest = JSON.parse(files[`${slug}/datasets.json`] as string);
    expect(manifest.datasets.sales.file).toBeNull();
    expect(manifest.datasets.sales.problem).toBe('the file of "sales" could not be read');
    expect(Object.keys(files).some((file) => file.includes('/data/'))).toBe(false);
  });

  it('a held legacy dashboard mirrors a diagnostic naming its files, never an empty dashboard', () => {
    const legacy = newDoc();
    legacy.get('files').setAttr('index.html', '<h1>Old</h1>');
    const { files } = mirrored(legacy);
    expect(Object.keys(files)).toEqual([`${slug}.md`]);
    expect(files[`${slug}.md`]).toMatch(/^This dashboard is held and is not mirrored as content: .*holds files \(index\.html\)/);
  });
});

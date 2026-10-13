// The DOCX export opened by another word processor (M6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; the
// parent's Acceptance 5): LibreOffice headless converts the every-kind export, comments, numbering, tables, the theme
// and Korean included, to PDF without error. A prerequisite of the acceptance, not a skip: where `soffice` does not run
// the case is skipped with the reason, and M9 records whether it ran (the item is not green without it). LibreOffice
// runs with its own profile under the case's temporary directory, never the user's.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { everyKindSource } from '@artifacts/document/convert.fixture';
import { exportDocx } from '@artifacts/document/export/docx';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAADjAO7rAAAAEElEQVR42mP8z8DAwMDAAAAGBwEBH5O/1QAAAABJRU5ErkJggg==', 'base64'));

const probe = spawnSync('soffice', ['--version'], { encoding: 'utf8', timeout: 30_000 });
const available = probe.status === 0 && /LibreOffice/i.test(probe.stdout);
if (!available) console.warn(`[document-docx-libreoffice] skipped: soffice does not run here (${(probe.stderr || probe.error?.message || `exit ${probe.status}`).trim().split('\n')[0]})`);

describe.skipIf(!available)('the DOCX export in LibreOffice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-docx-lo-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('converts to PDF without error', async () => {
    const docx = join(dir, 'every-kind.docx');
    writeFileSync(docx, await exportDocx(everyKindSource(), { loadImage: async () => ({ bytes: PNG, mime: 'image/png' }) }));
    const run = spawnSync('soffice', [`-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, docx], { encoding: 'utf8', timeout: 120_000 });
    expect(run.status, run.stderr).toBe(0);
    const pdf = readFileSync(join(dir, 'every-kind.pdf'));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
  }, 180_000);
});

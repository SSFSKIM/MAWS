// E2 (M4): the Deliverables tool's pure decisions (Design §4): which body draws a version (by the same
// `mimeOf(basename(path))` main's handler types the answer with), the list's groups and order, a row's title, and
// whether a path lies under the record's session directories (judged lexically, as Open as file is offered).
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { record as sessionRecord } from '../../../../../test/support/builders';
import { bodyOf, groupsOf, latestVersion, titleOf, underSession, versionPath } from './model';

const A = 'app-a' as AppSessionId;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minute: number) => `2026-10-06T10:${String(minute).padStart(2, '0')}:00.000Z`;
const rec = (n: number, over: Partial<DeliverableRecord> = {}): DeliverableRecord => ({
  id: id(n), appSessionId: A, kind: 'file', path: `/r/f${n}.txt`, versions: [{ path: `/r/f${n}.txt`, at: at(n) }], createdAt: at(n), ...over,
});

describe('bodyOf', () => {
  it('draws HTML and PDF in frames, media natively, and everything else through the file viewer', () => {
    expect(bodyOf('/r/page.html')).toBe('html');
    expect(bodyOf('/r/page.HTM')).toBe('html');
    expect(bodyOf('/u/deliverables/a/d/v2.html')).toBe('html');
    expect(bodyOf('/r/doc.pdf')).toBe('pdf');
    expect(bodyOf('/r/clip.webm')).toBe('video');
    expect(bodyOf('/r/tone.wav')).toBe('audio');
    for (const path of ['/r/a.png', '/r/README.md', '/r/a.ts', '/r/data.bin', '/r/noext']) expect(bodyOf(path), path).toBe('file');
  });

  it('never gives a non-PDF the PDF frame, however the name looks', () => {
    for (const path of ['/r/doc.pdf.html', '/r/pdf', '/r/doc.pdfx', '/r/doc.pdf.txt', '/r/a.pdf/inner.html']) expect(bodyOf(path), path).not.toBe('pdf');
  });
});

describe('groupsOf', () => {
  it('groups Artifacts, Files then Screenshots, only those present, each newest first by updatedAt else createdAt', () => {
    const records = [
      rec(1),
      rec(2, { kind: 'artifact', artifactId: 'old', createdAt: at(2), updatedAt: at(30) }),
      rec(3, { kind: 'screenshot' }),
      rec(4),
      rec(5, { kind: 'artifact', artifactId: 'new', createdAt: at(5) }),
    ];
    expect(groupsOf(records).map((g) => [g.kind, g.records.map((r) => r.id)])).toEqual([
      ['artifact', [id(2), id(5)]],
      ['file', [id(4), id(1)]],
      ['screenshot', [id(3)]],
    ]);
    expect(groupsOf([rec(1)]).map((g) => g.kind)).toEqual(['file']);
    expect(groupsOf([])).toEqual([]);
  });
});

describe('a record', () => {
  it('is titled by its title, else its file’s name', () => {
    expect(titleOf(rec(1, { title: 'Dashboard' }))).toBe('Dashboard');
    expect(titleOf(rec(1))).toBe('f1.txt');
  });

  it('names each version’s path, the latest by default', () => {
    const artifact = rec(1, { kind: 'artifact', path: '/u/v2.html', versions: [{ path: '/u/v1.html', at: at(1) }, { path: '/u/v2.html', at: at(2) }] });
    expect(latestVersion(artifact)).toBe(2);
    expect(versionPath(artifact, 1)).toBe('/u/v1.html');
    expect(versionPath(artifact, 2)).toBe('/u/v2.html');
    expect(versionPath(artifact, 7)).toBe('/u/v2.html'); // a version past the record's: the record's path
  });
});

describe('underSession', () => {
  const session = sessionRecord(A, { directory: '/repo', additionalDirectories: ['/extra'], worktree: { path: '/wt/feature', branch: 'feature' } });

  it('admits a path under the directory, an additional directory or the worktree, lexically', () => {
    expect(underSession('/repo/out/a.md', session)).toBe(true);
    expect(underSession('/extra/a.ts', session)).toBe(true);
    expect(underSession('/wt/feature/src/a.ts', session)).toBe(true);
    expect(underSession('/repo/../etc/passwd', session)).toBe(false);
  });

  it('refuses a sibling with a shared prefix, a path elsewhere, and any path without a session', () => {
    expect(underSession('/repository/a.md', session)).toBe(false);
    expect(underSession('/tmp/a.md', session)).toBe(false);
    expect(underSession('/repo/a.md', undefined)).toBe(false);
  });
});

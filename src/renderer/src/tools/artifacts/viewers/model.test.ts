// The viewers' pure decisions: which body draws a stored file (by the MIME its name types, as the scheme serves it), the
// version list in order with its labels, and which version a picker choice or a row's Open shows.
import { describe, expect, it } from 'vitest';
import type { ArtifactVersion } from '@shared/artifacts/version';
import { bodyOf, shownVersion, versionLabel, versionsInOrder, versionToShow } from './model';

const version = (id: number, seq: number): ArtifactVersion => ({ id, seq, at: seq * 1000, actor: { kind: 'human' }, kind: 'auto', assetRefs: [] });

describe('bodyOf', () => {
  it('chooses the body by the MIME the name types', () => {
    expect(bodyOf('index.html')).toBe('html');
    expect(bodyOf('page.htm')).toBe('html');
    expect(bodyOf('report.pdf')).toBe('pdf');
    expect(bodyOf('clip.webm')).toBe('video');
    expect(bodyOf('clip.mp4')).toBe('video');
    expect(bodyOf('tone.wav')).toBe('audio');
    expect(bodyOf('notes.md')).toBe('file');
    expect(bodyOf('chart.png')).toBe('file'); // the file viewer draws images, with its zoom
    expect(bodyOf('util.ts')).toBe('file');
    expect(bodyOf('README')).toBe('file');
  });

  it('reads the last segment of a path', () => {
    expect(bodyOf('/Users/me/out/report.PDF')).toBe('pdf');
  });
});

describe('versions', () => {
  it('orders by the revision each captured, then by id', () => {
    expect(versionsInOrder([version(3, 9), version(1, 4), version(2, 4)]).map((v) => v.id)).toEqual([1, 2, 3]);
  });

  it('labels each by its place, the last as latest', () => {
    expect(versionLabel(1, false)).toBe('v1');
    expect(versionLabel(2, true)).toBe('v2 · latest');
  });

  it('shows the chosen place, the latest for none or one out of range, and nothing without versions', () => {
    const list = versionsInOrder([version(1, 4), version(2, 9)]);
    expect(shownVersion(list, 1)).toEqual({ n: 1, version: list[0], latest: false });
    expect(shownVersion(list, null)).toEqual({ n: 2, version: list[1], latest: true });
    expect(shownVersion(list, 7)).toEqual({ n: 2, version: list[1], latest: true });
    expect(shownVersion(list, 0)).toEqual({ n: 2, version: list[1], latest: true });
    expect(shownVersion([], null)).toBeNull();
  });

  it('follows the latest when the choice is the latest, so a new version is shown as it lands', () => {
    expect(versionToShow(1, 3)).toBe(1);
    expect(versionToShow(3, 3)).toBeNull();
    expect(versionToShow(null, 3)).toBeNull();
    expect(versionToShow(5, 3)).toBeNull();
  });
});

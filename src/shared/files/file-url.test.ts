// The `file:` form of a link (UX wave U6b-4b, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, R1, N1.1, N1.2
// and N1.5): only `file://` with an empty host, in any letter case, gives the rest; every other string gives nothing.
// Every path here is invented.
import { describe, expect, it } from 'vitest';
import { fileUrlRest } from './file-url';

describe('fileUrlRest', () => {
  it.each([
    ['file:///work/x.md', '/work/x.md'],
    ['FILE:///work/x.md', '/work/x.md'],
    ['File:///work/x.md', '/work/x.md'],
    ['file:////work/x.md', '//work/x.md'],
    ['file:///', '/'],
    ['file:///work/my notes.md#L12', '/work/my notes.md#L12'],
    ['file:///work/%41.md', '/work/%41.md'], // taken byte for byte: no escape is read here
  ])('%j gives %j', (url, rest) => {
    expect(fileUrlRest(url)).toBe(rest);
  });

  it.each([
    'file://host/work/x.md', // a host (N1.1)
    'file://localhost/work/x.md',
    'file:/work/x.md', // no authority (N1.2)
    'file:work/x.md',
    'file://',
    'file:',
    'files:///work/x.md', // another scheme (N1.5)
    'xfile:///work/x.md',
    'http://file:///work/x.md',
    'maws-path:file:///work/x.md',
    ' file:///work/x.md',
    '/work/x.md', // no scheme: the scheme-less form is read as it is, not here
    '',
  ])('%j gives nothing', (url) => {
    expect(fileUrlRest(url)).toBeNull();
  });
});

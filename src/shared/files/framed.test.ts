// The framed kinds and a file frame's URL (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// Interfaces §A): which types are drawn in a frame, the token's shape, and a URL that holds the token and the file's base
// name and nothing else. Every name here is invented.
import { describe, expect, it } from 'vitest';
import { artifactUrl } from '@shared/artifacts/scheme';
import { FRAME_TOKEN, frameTokenOf, frameUrl, framedKindOf } from './framed';

const TOKEN = '0123456789abcdef0123456789abcdef';

describe('framedKindOf', () => {
  it.each([
    ['application/pdf', 'pdf'],
    ['text/html', 'html'],
    ['video/mp4', 'video'],
    ['video/quicktime', 'video'],
    ['audio/mpeg', 'audio'],
    ['audio/wav', 'audio'],
  ])('the four kinds from their types: %s is %s', (mime, kind) => {
    expect(framedKindOf(mime)).toBe(kind);
  });

  it.each(['image/png', 'image/svg+xml', 'application/octet-stream', 'text/plain', 'text/markdown', 'application/json', 'application/zip', 'font/woff2', ''])(
    'null for every other type: %s',
    (mime) => {
      expect(framedKindOf(mime)).toBeNull();
    },
  );
});

describe('a token', () => {
  it('a token’s shape is 32 lower-case hexadecimal characters', () => {
    expect(FRAME_TOKEN.test(TOKEN)).toBe(true);
    expect(FRAME_TOKEN.test(TOKEN.toUpperCase())).toBe(false);
    expect(FRAME_TOKEN.test(TOKEN.slice(1))).toBe(false);
    expect(FRAME_TOKEN.test(`${TOKEN}0`)).toBe(false);
    expect(FRAME_TOKEN.test('00000000-0000-4000-8000-000000000001')).toBe(false);
  });
});

describe('frameUrl and frameTokenOf', () => {
  it.each(['report.pdf', 'quarterly report.pdf', 'notes #2.html', 'what?.html', '100% done.mp4', 'déjà vu — 회의.wav', '.hidden.pdf'])(
    'frameTokenOf(frameUrl(token, name)) is the token, the URL holds no / after the host but the one before the name, and its last part decodes to the name: %s',
    (name) => {
      const url = frameUrl(TOKEN, name);
      expect(url.startsWith(`maws-artifact://${TOKEN}/`)).toBe(true);
      expect(frameTokenOf(url)).toBe(TOKEN);
      const rest = url.slice(`maws-artifact://${TOKEN}`.length);
      expect(rest.lastIndexOf('/')).toBe(0);
      expect(rest).not.toMatch(/[?#]/);
      expect(decodeURIComponent(rest.slice(1))).toBe(name);
    },
  );

  it('frameTokenOf answers the host of a token’s shape whatever the path, and null for an artifact’s id or another scheme', () => {
    expect(frameTokenOf(`maws-artifact://${TOKEN}/other/longer?q=1`)).toBe(TOKEN);
    expect(frameTokenOf(`maws-artifact://${TOKEN}`)).toBe(TOKEN);
    expect(frameTokenOf(artifactUrl('00000000-0000-4000-8000-000000000001', 'live', 'index.html'))).toBeNull();
    expect(frameTokenOf(`https://${TOKEN}/report.pdf`)).toBeNull();
    expect(frameTokenOf(`maws-artifact://${TOKEN.slice(2)}/report.pdf`)).toBeNull();
    expect(frameTokenOf('not a url')).toBeNull();
  });
});

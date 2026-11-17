import { describe, expect, it } from 'vitest';
import { buildCsp, PRODUCTION_CSP } from './csp';

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split(';').map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name, sources];
    }),
  );

describe('content security policy', () => {
  it('is exactly the production policy without a dev server', () => {
    expect(PRODUCTION_CSP).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: maws-artifact:; font-src 'self' data: maws-artifact:; connect-src 'self'; frame-src 'self' maws-artifact:; media-src 'self' maws-artifact:",
    );
    expect(buildCsp(null)).toBe(PRODUCTION_CSP);
  });

  it('adds the nonce to script-src only, and the HMR socket to connect-src, in development', () => {
    const csp = buildCsp({ nonce: 'N', devServerUrl: 'http://localhost:5173' });
    expect(csp).toBe(
      "default-src 'self'; script-src 'self' 'nonce-N'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: maws-artifact:; font-src 'self' data: maws-artifact:; connect-src 'self' ws://localhost:5173; frame-src 'self' maws-artifact:; media-src 'self' maws-artifact:",
    );
    const withNonce = Object.entries(directives(csp))
      .filter(([, sources]) => sources.some((s) => s.includes('nonce-')))
      .map(([name]) => name);
    expect(withNonce).toEqual(['script-src']);
  });

  // E2 start: the viewers' frames and media elements load the store through its scheme (Design §3); 'self' keeps the
  // request card's srcdoc frame, which inherits the document's policy. P3-L M6b: the deliverable scheme is gone.
  it('admits the store scheme to frames and media, and E2’s maws-deliverable: nowhere', () => {
    const csp = directives(PRODUCTION_CSP);
    expect(csp['frame-src']).toEqual(["'self'", 'maws-artifact:']);
    expect(csp['media-src']).toEqual(["'self'", 'maws-artifact:']);
    expect(PRODUCTION_CSP).not.toContain('maws-deliverable:');
  });
  // E2 end

  // P3-A M7 (Decision Log 35g): the artifact store's scheme for frames and media as the deliverable one, and for images and
  // fonts too (srcdoc frames inherit this policy: a design system's bundled faces, a document's images, D's canon frames);
  // never for scripts, styles or connections
  it('admits the maws-artifact: scheme to frames, media, images and fonts, and nothing else', () => {
    const csp = directives(PRODUCTION_CSP);
    expect(csp['img-src']).toEqual(["'self'", 'data:', 'blob:', 'maws-artifact:']);
    expect(csp['font-src']).toEqual(["'self'", 'data:', 'maws-artifact:']);
    const admitting = Object.entries(csp)
      .filter(([, sources]) => sources.includes('maws-artifact:'))
      .map(([name]) => name);
    expect(admitting.sort()).toEqual(['font-src', 'frame-src', 'img-src', 'media-src']);
  });

  // UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, R2): a file frame's token is the
  // store's scheme too, so the window's document can show a token's bytes as a frame, an image, a font or media, and can
  // neither run them nor fetch them
  it('admits the store’s scheme where bytes are shown, and nowhere a script runs or a page fetches', () => {
    for (const csp of [PRODUCTION_CSP, buildCsp({ nonce: 'N', devServerUrl: 'http://localhost:5173' })]) {
      const sources = directives(csp);
      for (const shown of ['frame-src', 'media-src', 'img-src', 'font-src']) expect(sources[shown], shown).toContain('maws-artifact:');
      for (const runs of ['default-src', 'script-src', 'connect-src', 'style-src']) expect(sources[runs], runs).not.toContain('maws-artifact:');
      expect(Object.keys(sources)).not.toContain('worker-src'); // a worker falls back to script-src, which does not name it
    }
  });

  it('takes the socket host and port from the dev server URL', () => {
    const csp = buildCsp({ nonce: 'abc+/=', devServerUrl: 'http://127.0.0.1:5174/' });
    expect(directives(csp)['connect-src']).toEqual(["'self'", 'ws://127.0.0.1:5174']);
    expect(directives(csp)['script-src']).toEqual(["'self'", "'nonce-abc+/='"]);
  });
});

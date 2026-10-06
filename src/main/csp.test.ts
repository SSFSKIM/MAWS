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
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' maws-deliverable:; media-src 'self' maws-deliverable:",
    );
    expect(buildCsp(null)).toBe(PRODUCTION_CSP);
  });

  it('adds the nonce to script-src only, and the HMR socket to connect-src, in development', () => {
    const csp = buildCsp({ nonce: 'N', devServerUrl: 'http://localhost:5173' });
    expect(csp).toBe(
      "default-src 'self'; script-src 'self' 'nonce-N'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://localhost:5173; frame-src 'self' maws-deliverable:; media-src 'self' maws-deliverable:",
    );
    const withNonce = Object.entries(directives(csp))
      .filter(([, sources]) => sources.some((s) => s.includes('nonce-')))
      .map(([name]) => name);
    expect(withNonce).toEqual(['script-src']);
  });

  // E2 start: the Deliverables viewer's frames and media elements load the store through the scheme (Design §3); 'self'
  // keeps the request card's srcdoc frame, which inherits the document's policy
  it('admits the maws-deliverable: scheme to frames and media, and nothing else', () => {
    const csp = directives(PRODUCTION_CSP);
    expect(csp['frame-src']).toEqual(["'self'", 'maws-deliverable:']);
    expect(csp['media-src']).toEqual(["'self'", 'maws-deliverable:']);
    expect(PRODUCTION_CSP.match(/maws-deliverable:/g)).toHaveLength(2);
  });
  // E2 end

  it('takes the socket host and port from the dev server URL', () => {
    const csp = buildCsp({ nonce: 'abc+/=', devServerUrl: 'http://127.0.0.1:5174/' });
    expect(directives(csp)['connect-src']).toEqual(["'self'", 'ws://127.0.0.1:5174']);
    expect(directives(csp)['script-src']).toEqual(["'self'", "'nonce-abc+/='"]);
  });
});

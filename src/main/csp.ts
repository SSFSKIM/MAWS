// The renderer's Content-Security-Policy, attached by main to every response (window.ts).
// Production: no inline script, no remote anything; inline styles are allowed for Tailwind.
// Development: the same policy plus the per-launch nonce electron.vite.config.ts stamps on the dev server's
// script tags (the React fast-refresh preamble is inline) and the dev server's HMR socket.

export interface DevServerCsp {
  nonce: string;
  devServerUrl: string;
}

const directives = (script: string[], connect: string[]) => [
  ['default-src', "'self'"],
  ['script-src', "'self'", ...script],
  ['style-src', "'self'", "'unsafe-inline'"],
  // P3-A M7 (Decision Log 35g): the artifact store's images and fonts (a document's images, a design system's bundled
  // faces), here and in every srcdoc frame, which inherits this policy
  ['img-src', "'self'", 'data:', 'blob:', 'maws-artifact:'],
  ['font-src', "'self'", 'data:', 'maws-artifact:'],
  ['connect-src', "'self'", ...connect],
  // E2: the Deliverables viewer's frames and media load the store through the scheme ('self' keeps the request card's
  // srcdoc frame, which inherits this policy); each answer of the scheme carries its own policy (deliverables/protocol.ts).
  // P3-A M7: the artifact store's scheme serves the same frames (artifacts/protocol.ts)
  ['frame-src', "'self'", 'maws-deliverable:', 'maws-artifact:'],
  ['media-src', "'self'", 'maws-deliverable:', 'maws-artifact:'],
];

const serialize = (list: string[][]) => list.map((d) => d.join(' ')).join('; ');

export const PRODUCTION_CSP = serialize(directives([], []));

export function buildCsp(dev: DevServerCsp | null): string {
  if (!dev) return PRODUCTION_CSP;
  const { host } = new URL(dev.devServerUrl);
  return serialize(directives([`'nonce-${dev.nonce}'`], [`ws://${host}`]));
}

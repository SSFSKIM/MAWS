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
  ['img-src', "'self'", 'data:', 'blob:'],
  ['font-src', "'self'", 'data:'],
  ['connect-src', "'self'", ...connect],
];

const serialize = (list: string[][]) => list.map((d) => d.join(' ')).join('; ');

export const PRODUCTION_CSP = serialize(directives([], []));

export function buildCsp(dev: DevServerCsp | null): string {
  if (!dev) return PRODUCTION_CSP;
  const { host } = new URL(dev.devServerUrl);
  return serialize(directives([`'nonce-${dev.nonce}'`], [`ws://${host}`]));
}

// The renderer's Content-Security-Policy, attached by main to every response (window.ts).
// Production: no inline script, no remote anything; inline styles are allowed for Tailwind.
// Development: the same policy plus the per-launch nonce electron.vite.config.ts stamps on the dev server's
// script tags (the React fast-refresh preamble is inline) and the dev server's HMR socket.
// The harness (C9) may append extra sources to script-src and connect-src; the app page never does.

export interface DevServerCsp {
  nonce: string;
  devServerUrl: string;
}

// C9 block begin: harness-only sources the builder appends (ghostty-web's WASM; removed with the candidate)
export interface ExtraCspSources {
  script: string[];
  connect: string[];
}
// C9 block end

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

export function buildCsp(dev: DevServerCsp | null, extra: ExtraCspSources = { script: [], connect: [] }): string {
  if (!dev) return serialize(directives(extra.script, extra.connect));
  const { host } = new URL(dev.devServerUrl);
  return serialize(directives([`'nonce-${dev.nonce}'`, ...extra.script], [`ws://${host}`, ...extra.connect]));
}

// Every desk-hub suite runs with this file first (vitest.config.ts, setupFiles): the global fetch reaches loopback only,
// where the suites' own Miniflare hubs and stand-ins listen. Any other host is refused before a request leaves, so no
// test can reach Cloudflare or anything else by forgetting to inject a fake (the deploy tool's `deployHub` defaults to
// the global fetch; its suites pass a fake account, deploy/target.test.ts).
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const real = globalThis.fetch;

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!LOOPBACK.has(url.hostname)) {
    return Promise.reject(new Error(`no network in tests: ${url.origin} refused (inject a fake fetch; test/support/no-network.ts)`));
  }
  return real(input, init);
}) as typeof fetch;

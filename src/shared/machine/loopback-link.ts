// A loopback link (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Forwarding"; P5 Decision Log 108's
// A6): an http(s) link to `localhost`, `127.0.0.1` or `0.0.0.0` with an explicit port. Out of a session on another
// machine it names that machine's own loopback (a dev server there), so it opens in the in-app browser through a port
// forwarded over the machine's link (`remote.forward.open`), never in the system browser, which would load this Mac's.
// One rule for main (src/main/open-external.ts refuses such a link of another machine's session) and the renderer (which
// routes it to the browser tool with `{forward: {machine, port}}`).
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

/** The port a loopback link names, or null for any other link (no port, another host, another scheme, not a URL). */
export function loopbackPort(url: string): number | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !LOOPBACK_HOSTS.has(parsed.hostname) || parsed.port === '') return null;
  return Number(parsed.port);
}

/** The link's page on this Mac's forwarding listener: its scheme, path, query and fragment at `127.0.0.1:<localPort>`. */
export function forwardedUrl(url: string, localPort: number): string {
  const parsed = new URL(url);
  parsed.hostname = '127.0.0.1';
  parsed.port = String(localPort);
  return parsed.toString();
}

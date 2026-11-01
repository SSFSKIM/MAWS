// Loopback links (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Forwarding"; P5 Decision Log 108's
// A6). Out of a session on another machine, a link to a loopback host names that machine's own loopback (a dev server
// there), never this Mac's. Two rules, for main (src/main/open-external.ts) and the renderer alike:
//
// - `isLoopbackLink`: the link names a loopback host, so out of a remote session it is never opened on this Mac. Any
//   scheme with a host: `localhost` and any `*.localhost`, all of 127.0.0.0/8 (in every form the URL parser normalizes
//   to it), `0.0.0.0`, `[::1]`, `[::]` and IPv4-mapped 127/8 (`[::ffff:127.x.x.x]`), with a port written or not.
// - `loopbackPort`: the subset that opens in the in-app browser as a forward (`remote.forward.open`): http or https on
//   `localhost`, `127.0.0.1` or `0.0.0.0` (the endpoint connects the machine's 127.0.0.1), the port the link writes or its
//   scheme's default (80, 443), written or implied.
//
// A link of a remote session that is loopback but not forwardable (`[::1]`, `127.0.0.2`, `ws:`, `*.localhost`, …) is
// refused: opened neither forwarded nor on this Mac.
const FORWARDABLE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
const DEFAULT_PORTS: Readonly<Record<string, number>> = { 'http:': 80, 'https:': 443 };

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The host as the tests read it: lower case (the parser's), without a trailing dot. */
const hostOf = (parsed: URL) => parsed.hostname.replace(/\.$/, '');

/** Whether the link names a loopback host, by any scheme, with a port written or not. */
export function isLoopbackLink(url: string): boolean {
  const parsed = parse(url);
  if (parsed === null) return false;
  const host = hostOf(parsed);
  if (host === '') return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // The parser compresses IPv6: ::1, :: and IPv4-mapped 127/8 (`::ffff:7fxx:xxxx`).
  return host === '[::1]' || host === '[::]' || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host);
}

/** The machine port a forwardable loopback link names (written, or its scheme's default), or null for any other link. */
export function loopbackPort(url: string): number | null {
  const parsed = parse(url);
  if (parsed === null || !Object.hasOwn(DEFAULT_PORTS, parsed.protocol) || !FORWARDABLE_HOSTS.has(hostOf(parsed))) return null;
  return parsed.port === '' ? DEFAULT_PORTS[parsed.protocol] : Number(parsed.port);
}

/** The link's page on this Mac's forwarding listener: its scheme, path, query and fragment at `127.0.0.1:<localPort>`. */
export function forwardedUrl(url: string, localPort: number): string {
  const parsed = new URL(url);
  parsed.hostname = '127.0.0.1';
  parsed.port = String(localPort);
  return parsed.toString();
}

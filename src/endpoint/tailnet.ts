// The tailnet (O10 M4; RL §4.1, P5 Decision Log 39): the only interface the endpoint's direct listener binds to. An
// address is the tailnet's when it is IPv4 in Tailscale's CGNAT range, 100.64.0.0/10, or IPv6 in its ULA prefix,
// fd7a:115c:a1e0::/48. The listener reads them from the machine's interface table, never binds a wildcard, and
// advertises each as a WebSocket URL in the machine's signed endpoint record (RL6).
import type { NetworkInterfaceInfo } from 'node:os';

export const DEFAULT_DIRECT_PORT = 47830;

/** `os.networkInterfaces()`'s shape. */
export type InterfaceTable = NodeJS.Dict<NetworkInterfaceInfo[]>;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4(address: string): number[] | null {
  const match = IPV4.exec(address);
  if (match === null) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/** The eight hextets of an IPv6 address written in any RFC 4291 text form without an embedded IPv4; null otherwise. */
function ipv6(address: string): number[] | null {
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const words = (part: string) => (part === '' ? [] : part.split(':'));
  const head = words(halves[0]);
  const tail = halves.length === 2 ? words(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!all.every((w) => /^[0-9a-f]{1,4}$/.test(w))) return null;
  return all.map((w) => parseInt(w, 16));
}

const withoutScope = (address: string) => address.split('%')[0];

export function isTailnetAddress(address: string): boolean {
  const four = ipv4(address);
  if (four !== null) return four[0] === 100 && four[1] >= 64 && four[1] <= 127;
  const six = ipv6(withoutScope(address));
  return six !== null && six[0] === 0xfd7a && six[1] === 0x115c && six[2] === 0xa1e0;
}

/** The table's tailnet addresses, each once, IPv4 first, then in text order. */
export function tailnetAddresses(table: InterfaceTable): string[] {
  const found = new Set<string>();
  for (const entries of Object.values(table)) {
    for (const entry of entries ?? []) {
      const address = withoutScope(entry.address);
      if (!entry.internal && isTailnetAddress(address)) found.add(address);
    }
  }
  const isFour = (a: string) => (ipv4(a) === null ? 1 : 0);
  return [...found].sort((x, y) => isFour(x) - isFour(y) || (x < y ? -1 : x > y ? 1 : 0));
}

/** The listener's port: `MAWS_ENDPOINT_PORT` when it names one, else 47830 (`ignored` carries a value that names none). */
export function directPort(env: Record<string, string | undefined>): { port: number; ignored?: string } {
  const value = env.MAWS_ENDPOINT_PORT;
  if (value === undefined) return { port: DEFAULT_DIRECT_PORT };
  const port = /^\d{1,5}$/.test(value) ? Number(value) : NaN;
  return port >= 1 && port <= 65_535 ? { port } : { port: DEFAULT_DIRECT_PORT, ignored: value };
}

/** How the endpoint record names a bound address: a WebSocket URL, an IPv6 address bracketed. */
export function directUrl(address: string, port: number): string {
  return `ws://${address.includes(':') ? `[${address}]` : address}:${port}`;
}

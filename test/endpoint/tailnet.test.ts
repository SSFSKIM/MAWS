// The tailnet's addresses (O10 M4; RL §4.1, P5 Decision Log 39): what the direct listener binds to, read from an
// interface table, and the port and URLs it advertises.
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIRECT_PORT, directPort, directUrl, isTailnetAddress, tailnetAddresses } from '../../src/endpoint/tailnet';

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({ address, family: 'IPv4', internal, netmask: '255.255.255.255', mac: '00:00:00:00:00:00', cidr: null });
const v6 = (address: string, internal = false): NetworkInterfaceInfo => ({ address, family: 'IPv6', internal, netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', mac: '00:00:00:00:00:00', scopeid: 0, cidr: null });

describe('the tailnet', () => {
  it('takes IPv4 in 100.64.0.0/10 and IPv6 in fd7a:115c:a1e0::/48, and nothing else', () => {
    for (const address of ['100.64.0.1', '100.101.102.103', '100.127.255.254']) expect(isTailnetAddress(address)).toBe(true);
    for (const address of ['100.63.255.255', '100.128.0.1', '10.0.0.1', '127.0.0.1', '0.0.0.0', '192.168.1.4', '1.100.64.1']) expect(isTailnetAddress(address)).toBe(false);
    for (const address of ['fd7a:115c:a1e0::1', 'fd7a:115c:a1e0:ab12:4843:cd96:6258:b240', 'FD7A:115C:A1E0::ABCD', 'fd7a:115c:a1e0:0:0:0:0:1']) expect(isTailnetAddress(address)).toBe(true);
    for (const address of ['::', '::1', 'fd7a:115c:a1e1::1', 'fe80::1', 'fd7a:115c::1', 'fd7a:115c:a1e0', 'not an address', '']) expect(isTailnetAddress(address)).toBe(false);
  });

  it('reads the tailnet addresses from an interface table, never a wildcard, a loopback or a LAN address', () => {
    const table = {
      lo0: [v4('127.0.0.1', true), v6('::1', true)],
      en0: [v4('192.168.1.20'), v6('fe80::1c2a:3b4c:5d6e:7f80')],
      utun4: [v4('100.101.102.103'), v6('fd7a:115c:a1e0::abcd')],
      utun5: [v4('100.128.0.1'), v6('fd7a:115c:a1e1::1')],
      bridge0: undefined,
    };
    expect(tailnetAddresses(table)).toEqual(['100.101.102.103', 'fd7a:115c:a1e0::abcd']);
    expect(tailnetAddresses({})).toEqual([]);
  });

  it('drops a scope id and lists each address once, in a stable order', () => {
    const table = { utun4: [v6('fd7a:115c:a1e0::2%utun4'), v4('100.100.1.1')], utun9: [v4('100.100.1.1'), v6('fd7a:115c:a1e0::1')] };
    expect(tailnetAddresses(table)).toEqual(['100.100.1.1', 'fd7a:115c:a1e0::1', 'fd7a:115c:a1e0::2']);
  });

  it('listens on 47830 unless MAWS_ENDPOINT_PORT names another port, and says so for a port it cannot use', () => {
    expect(directPort({})).toEqual({ port: DEFAULT_DIRECT_PORT });
    expect(DEFAULT_DIRECT_PORT).toBe(47830);
    expect(directPort({ MAWS_ENDPOINT_PORT: '48000' })).toEqual({ port: 48000 });
    for (const bad of ['0', '65536', '-1', '4.5', 'x', '']) expect(directPort({ MAWS_ENDPOINT_PORT: bad })).toEqual({ port: DEFAULT_DIRECT_PORT, ignored: bad });
  });

  it('advertises each address as a WebSocket URL, an IPv6 one bracketed', () => {
    expect(directUrl('100.101.102.103', 47830)).toBe('ws://100.101.102.103:47830');
    expect(directUrl('fd7a:115c:a1e0::abcd', 47830)).toBe('ws://[fd7a:115c:a1e0::abcd]:47830');
  });
});

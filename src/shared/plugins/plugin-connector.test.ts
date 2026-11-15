// The UX wave's U11h (§B): a plugin connector's address is described by its shape alone, and a templated address is one a
// row may sign in at only where its origin is written out in the strict form. M2: the rule's two pure parts, (a) on the
// engine name and (c) on the address, which the services enforce and the window words its lines by.
import { describe, expect, it } from 'vitest';
import { addressFormOf, addressMatches, ownersOf, pluginInSession, type SessionPlugin } from './plugin-connector';

describe('addressFormOf', () => {
  it('an address with no template is literal, whatever else it holds', () => {
    for (const url of ['https://mcp.example.com/mcp', 'HTTPS://MCP.EXAMPLE.COM/mcp', 'https://user@mcp.example.com/mcp', 'ws://mcp.example.com/', 'not a url', '$HOST/mcp']) expect([url, addressFormOf(url)]).toEqual([url, 'literal']);
  });

  it('a template after a literal origin in the strict form is templated', () => {
    for (const url of [
      'https://mcp.example.com/${TENANT}/mcp',
      'https://mcp.example.com/mcp?key=${KEY}',
      'https://mcp.example.com#${FRAGMENT}',
      'http://127.0.0.1:8123/${PATH}',
      'https://mcp.example.com:8443/${TENANT}',
      'https://Mcp.Example.com/${TENANT}',
    ]) expect([url, addressFormOf(url)]).toEqual([url, 'templated']);
  });

  it('a template in the scheme, the authority or the port, or an authority the strict form refuses, is templated-origin', () => {
    for (const url of [
      '${SCHEME}://mcp.example.com/mcp', // the scheme
      'https://${HOST}/mcp', // the authority
      'https://${HOST}', // the authority, to the end
      'https://mcp.${REGION}.example.com/mcp', // part of the host
      'https://mcp.example.com:${PORT}/mcp', // the port
      'https:///${HOST}/mcp', // an extra slash before the authority: the authority is empty
      'https:/mcp.example.com/${TENANT}', // one slash
      'https://mcp.example.com\\evil.example.com/${TENANT}', // a backslash, which the parser reads as a slash
      'https://user@mcp.example.com/${TENANT}', // userinfo
      'https://${USER}@mcp.example.com/mcp', // userinfo from a template
      'https://mcp.example.com\t/${TENANT}', // whitespace, which the parser drops
      'https://mcp.example\u0000.com/${TENANT}', // a control character
      'HTTPS://mcp.example.com/${TENANT}', // an upper-case scheme
      'Https://mcp.example.com/${TENANT}',
      'wss://mcp.example.com/${TENANT}', // a scheme the strict form does not take
      'https://exa mple.com/${TENANT}', // a space
      'https://[::1/${TENANT}', // an authority the parser refuses
    ]) expect([url, addressFormOf(url)]).toEqual([url, 'templated-origin']);
  });
});

// (c): a literal address is the same text; a templated one's live address parses, has the declared literal origin, and
// matches the declared text with each `${…}` standing for one or more characters
describe('addressMatches', () => {
  it('a literal address matches only the same text: a trailing slash, a case or a port is a difference', () => {
    const declared = 'https://mcp.example.com/mcp';
    expect(addressMatches(declared, 'https://mcp.example.com/mcp')).toBe(true);
    for (const live of ['https://mcp.example.com/mcp/', 'https://MCP.example.com/mcp', 'https://mcp.example.com:443/mcp', 'https://mcp.example.com/mc', 'https://other.example.com/mcp', '']) expect([live, addressMatches(declared, live)]).toEqual([live, false]);
  });

  it('a templated path matches a live address of the declared origin whose text fits the pattern', () => {
    expect(addressMatches('https://mcp.example.com/${TENANT}/mcp', 'https://mcp.example.com/acme/mcp')).toBe(true);
    expect(addressMatches('https://mcp.example.com/${TENANT}/mcp', 'https://mcp.example.com/a/b/mcp')).toBe(true); // one or more characters, a slash among them
    expect(addressMatches('https://mcp.example.com/mcp?key=${KEY}', 'https://mcp.example.com/mcp?key=k-1')).toBe(true);
    expect(addressMatches('https://mcp.example.com/${A}${B}', 'https://mcp.example.com/xy')).toBe(true); // two, a character each
    expect(addressMatches('https://mcp.example.com/${A}-${B}/mcp', 'https://mcp.example.com/a-b-c/mcp')).toBe(true);
  });

  it('a templated path does not match a live address whose text does not fit, or where a ${…} would stand for nothing', () => {
    expect(addressMatches('https://mcp.example.com/${TENANT}/mcp', 'https://mcp.example.com/acme/sse')).toBe(false);
    expect(addressMatches('https://mcp.example.com/${TENANT}/mcp', 'https://mcp.example.com//mcp')).toBe(false); // nothing for TENANT
    expect(addressMatches('https://mcp.example.com/${TENANT}/mcp', 'https://mcp.example.com/mcp')).toBe(false);
    expect(addressMatches('https://mcp.example.com/${A}${B}', 'https://mcp.example.com/x')).toBe(false); // two need two
    expect(addressMatches('https://mcp.example.com/${TENANT}/mcp', 'https://mcp.example.com/acme/mcp/extra')).toBe(false); // the whole text
    expect(addressMatches('https://mcp.example.com/mcp?key=${KEY}', 'https://mcp.example.com/mcp?key=')).toBe(false);
  });

  it('a live address must parse to the declared literal origin as well as fit the pattern', () => {
    // In the strict form the declared head is literal up to the authority's end, so a live text that fits the pattern
    // starts with that head; the parser's origin is compared beside it (§B), and refuses whatever it reads otherwise.
    expect(addressMatches('https://mcp.example.com/${PATH}', 'https://mcp.example.com/@evil.example.com/x')).toBe(true); // `@` in the path: still this origin
    expect(addressMatches('https://mcp.example.com/${PATH}', 'https://evil.example.com/x')).toBe(false);
    expect(addressMatches('https://mcp.example.com/${PATH}', 'https://mcp.example.com.evil.example.com/x')).toBe(false);
    expect(addressMatches('https://mcp.example.com/${PATH}', 'https://evil.example.com\\mcp.example.com/x')).toBe(false); // the parser reads the backslash as a slash
    expect(addressMatches('https://mcp.example.com:443/${PATH}', 'https://mcp.example.com:443/x')).toBe(true);
    expect(addressMatches('https://mcp.example.com:443/${PATH}', 'https://mcp.example.com/x')).toBe(false); // the same origin, not the same text
    expect(addressMatches('http://mcp.example.com/${PATH}', 'https://mcp.example.com/x')).toBe(false);
    expect(addressMatches('https://mcp.example.com/${PATH}', 'https://MCP.example.com/x')).toBe(false); // the same origin, not the same text
  });

  it('a live address that does not parse fails', () => {
    for (const live of ['mcp.example.com/x', '/x', '', 'https://[mcp.example.com/x']) expect([live, addressMatches('https://mcp.example.com/${PATH}', live)]).toEqual([live, false]);
  });

  it('is never asked of templated-origin, and answers false if it is', () => {
    expect(addressMatches('https://${HOST}/mcp', 'https://mcp.example.com/mcp')).toBe(false);
    expect(addressMatches('https:///${HOST}/mcp', 'https:///mcp.example.com/mcp')).toBe(false);
    expect(addressMatches('https://user@mcp.example.com/${TENANT}', 'https://user@mcp.example.com/acme')).toBe(false);
  });

  it('decides a long templated address with many templates in bounded steps', () => {
    const declared = `https://mcp.example.com/${'${X}a'.repeat(800)}`;
    expect(addressMatches(declared, `https://mcp.example.com/${'xa'.repeat(799)}x`)).toBe(false); // the last literal missing
    expect(addressMatches(declared, `https://mcp.example.com/${'xa'.repeat(800)}`)).toBe(true);
  });
});

// (a) on the engine name: the plugins a session reported whose `plugin:<manifest name>:` is a prefix of it are exactly
// one, with the row's key; versions equal where both state one; no list reported is refused
describe('ownersOf and pluginInSession', () => {
  const plugin = (name: string, source: string | null, version: string | null = '0.0.1'): SessionPlugin => ({ name, source, version });
  const AT = '2026-11-14T22:39:19.282Z';
  const row = { name: 'plugin:mani-alpha:alpha-http', plugin: 'key-alpha@mkt-a', version: '0.0.1' };
  const BUILTIN = plugin('cc-plugin-telemetry', 'cc-plugin-telemetry@builtin', null);

  it('no list reported is not-reported, whatever the list holds', () => {
    expect(pluginInSession(row, [], null)).toBe('not-reported');
    expect(pluginInSession(row, [plugin('mani-alpha', 'key-alpha@mkt-a')], null)).toBe('not-reported');
  });

  it('no possible owner is absent: a plugin whose manifest name is only a part of the prefix owns nothing', () => {
    expect(pluginInSession(row, [], AT)).toBe('absent');
    expect(pluginInSession(row, [plugin('mani', 'mani@mkt-a'), plugin('mani-alpha-x', 'x@mkt-a'), plugin('alpha-http', 'h@mkt-a'), BUILTIN], AT)).toBe('absent');
  });

  it('one possible owner with the row’s key is ok; with another key, other-plugin', () => {
    expect(pluginInSession(row, [plugin('mani-alpha', 'key-alpha@mkt-a'), BUILTIN], AT)).toBe('ok');
    expect(pluginInSession(row, [plugin('mani-alpha', 'key-alpha@mkt-b')], AT)).toBe('other-plugin');
    expect(pluginInSession(row, [plugin('mani-alpha', null)], AT)).toBe('other-plugin');
  });

  it('two plugins of one manifest name are the collision, the row’s first and the row’s last', () => {
    const twin = { name: 'plugin:twin:srv', plugin: 'twin@mkt-a', version: '0.0.1' };
    const first = [plugin('twin', 'twin@mkt-a'), plugin('twin', 'twin@mkt-b')];
    expect(pluginInSession(twin, first, AT)).toBe('collision');
    expect(pluginInSession(twin, [...first].reverse(), AT)).toBe('collision');
    expect(ownersOf(twin.name, first)).toEqual(first);
  });

  it('the colon pair: alpha with a server beta:gamma and alpha:beta with a server gamma own one engine name together', () => {
    const name = 'plugin:alpha:beta:gamma';
    const both = [plugin('alpha', 'alpha@mkt-a'), plugin('alpha:beta', 'alpha-beta@mkt-a')];
    expect(ownersOf(name, both)).toEqual(both);
    expect(pluginInSession({ name, plugin: 'alpha@mkt-a', version: '0.0.1' }, both, AT)).toBe('collision');
    expect(pluginInSession({ name, plugin: 'alpha-beta@mkt-a', version: '0.0.1' }, both, AT)).toBe('collision');
    // a session that loaded the first alone: it is the one possible owner
    expect(pluginInSession({ name, plugin: 'alpha@mkt-a', version: '0.0.1' }, [both[0]!], AT)).toBe('ok');
    expect(pluginInSession({ name, plugin: 'alpha-beta@mkt-a', version: '0.0.1' }, [both[0]!], AT)).toBe('other-plugin');
  });

  it('a version that differs is other-version; one side that states none is not compared', () => {
    expect(pluginInSession(row, [plugin('mani-alpha', 'key-alpha@mkt-a', '0.0.2')], AT)).toBe('other-version');
    expect(pluginInSession(row, [plugin('mani-alpha', 'key-alpha@mkt-a', null)], AT)).toBe('ok');
    expect(pluginInSession({ ...row, version: null }, [plugin('mani-alpha', 'key-alpha@mkt-a', '0.0.2')], AT)).toBe('ok');
  });

  it('first that holds: the collision before another key or another version', () => {
    expect(pluginInSession(row, [plugin('mani-alpha', 'key-alpha@mkt-b', '9'), plugin('mani-alpha', 'key-alpha@mkt-a', '9')], AT)).toBe('collision');
    expect(pluginInSession(row, [plugin('mani-alpha', 'key-alpha@mkt-b', '9')], AT)).toBe('other-plugin');
  });
});

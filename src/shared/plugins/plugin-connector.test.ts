// The UX wave's U11h (§B): a plugin connector's address is described by its shape alone, and a templated address is one a
// row may sign in at only where its origin is written out in the strict form.
import { describe, expect, it } from 'vitest';
import { addressFormOf } from './plugin-connector';

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

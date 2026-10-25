import { describe, expect, it } from 'vitest';
import { endpointMatches, patternCheck } from './connector-url';

// Live patterns from Anthropic's directory (2026-10-25: 52 of 1,011 server records carry url_regex, all start-anchored,
// 35 end-anchored; every one compiles as a JavaScript RegExp without flags).
const SALESFORCE = '^https://api\\.salesforce\\.com/platform/mcp/v1/(?:d/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?/(?:(?:develop|sandbox|scratch)/)?|sandbox/)?platform/headless-360$';
const SNOWFLAKE = '^https://(?:|[a-z0-9.-]+\\.)snowflakecomputing\\.com(/|$)';

describe('a url_regex check', () => {
  it('tests the pattern as the directory writes it: an end-anchored one whole, a prefix one as a prefix', () => {
    expect(patternCheck('https://api.salesforce.com/platform/mcp/v1/platform/headless-360', SALESFORCE)).toBe('match');
    expect(patternCheck('https://api.salesforce.com/platform/mcp/v1/platform/headless-360x', SALESFORCE)).toBe('no_match');
    expect(patternCheck('https://acme.snowflakecomputing.com/api/v2/cortex/mcp', SNOWFLAKE)).toBe('match');
  });
  it('anchors a pattern at the start when it is not, so a URL cannot carry a match elsewhere', () => {
    expect(patternCheck('https://evil.example.com/?https://x.example.com/mcp', 'https://x\\.example\\.com/mcp')).toBe('no_match');
    expect(patternCheck('https://x.example.com/mcp', 'https://x\\.example\\.com/mcp')).toBe('match');
  });
  it('says so when JavaScript cannot read the pattern; that is never a pass', () => {
    expect(patternCheck('https://x.example.com/mcp', '([')).toBe('unreadable');
  });
});

describe('an endpoint and a directory record', () => {
  const route = (over = {}) => ({ url: null, urlPattern: null, urlOptions: [], ...over });
  it('match by the record’s URL, one of its url_options, or its pattern; trailing-slash and query differences aside', () => {
    expect(endpointMatches('https://mcp.linear.app/mcp', route({ url: 'https://mcp.linear.app/mcp' }))).toBe(true);
    expect(endpointMatches('https://mcp.linear.app/mcp/', route({ url: 'https://mcp.linear.app/mcp' }))).toBe(true);
    expect(endpointMatches('https://us.example.com/mcp', route({ urlOptions: [{ url: 'https://eu.example.com/mcp' }, { url: 'https://us.example.com/mcp' }] }))).toBe(true);
    expect(endpointMatches('https://acme.snowflakecomputing.com/mcp', route({ urlPattern: SNOWFLAKE }))).toBe(true);
  });
  it('do not match by name or by a different host, and an unreadable pattern matches nothing', () => {
    expect(endpointMatches('https://my-own.example.com/mcp', route({ url: 'https://mcp.linear.app/mcp' }))).toBe(false);
    expect(endpointMatches('https://x.example.com/mcp', route({ urlPattern: '([' }))).toBe(false);
    expect(endpointMatches(null, route({ url: 'https://mcp.linear.app/mcp' }))).toBe(false);
  });
});

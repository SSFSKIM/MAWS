// C11 (M6, ruled 2026-09-29): the dev-only MAWS_RELAY_URL override the relay-down live cases point at a loopback
// forwarder. The host takes it only as `http://127.0.0.1:<port>`; anything else leaves ClaudeUsage's relay.
import { describe, expect, it } from 'vitest';
import { relayUrlFrom } from './launch';

const RELAY = 'http://127.0.0.1:8641';

describe('the dev-only relay URL override', () => {
  it('is the relay when the variable is absent or empty', () => {
    expect(relayUrlFrom({})).toBe(RELAY);
    expect(relayUrlFrom({ MAWS_RELAY_URL: '' })).toBe(RELAY);
  });

  it('takes a loopback http URL with a port', () => {
    expect(relayUrlFrom({ MAWS_RELAY_URL: 'http://127.0.0.1:18641' })).toBe('http://127.0.0.1:18641');
    expect(relayUrlFrom({ MAWS_RELAY_URL: 'http://127.0.0.1:1' })).toBe('http://127.0.0.1:1');
  });

  it('ignores a non-loopback value or any other shape', () => {
    for (const value of [
      'http://example.com:8641',
      'http://10.0.0.2:8641',
      'http://localhost:18641',
      'https://127.0.0.1:18641',
      'http://127.0.0.1',
      'http://127.0.0.1:18641/',
      'http://127.0.0.1:18641/v1',
      'http://127.0.0.1:0',
      'http://127.0.0.1:65536',
      'http://user@127.0.0.1:18641',
      ' http://127.0.0.1:18641',
    ]) {
      expect(relayUrlFrom({ MAWS_RELAY_URL: value }), value).toBe(RELAY);
    }
  });
});

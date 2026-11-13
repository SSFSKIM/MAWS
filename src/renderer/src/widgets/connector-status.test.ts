// A connector's status in words (UX wave U11a, §C "Status words"): one function for the Connectors dialog, the terminal
// session's dialog, the "+" › Connectors submenu and Customize's live list.
import { describe, expect, it } from 'vitest';
import { connectorStatusWords } from './connector-status';

describe('connectorStatusWords', () => {
  it('words each status of §C, the first, second and fourth in Customize’s words', () => {
    expect(connectorStatusWords('connected')).toBe('Connected');
    expect(connectorStatusWords('needs-auth')).toBe('Sign in needed');
    expect(connectorStatusWords('failed')).toBe('Failed');
    expect(connectorStatusWords('pending')).toBe('Connecting…');
  });

  it('says nothing for a disabled connector where a switch is drawn, and Off where none is', () => {
    expect(connectorStatusWords('disabled', { switchDrawn: true })).toBe('');
    expect(connectorStatusWords('disabled', { switchDrawn: false })).toBe('Off');
    expect(connectorStatusWords('disabled')).toBe('Off');
  });

  it('keeps the engine’s own word for any other status', () => {
    expect(connectorStatusWords('reconnecting')).toBe('reconnecting');
    expect(connectorStatusWords('unknown', { switchDrawn: true })).toBe('unknown');
  });
});

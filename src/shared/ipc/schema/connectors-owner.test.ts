// P3-HD M3c2: the owner's per-server connector commands (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, M3,
// Decision Log 22, 29, 30 and 33). Trusted owner commands, main's and bridged like H's grant commands; the page's
// portable API gains nothing. A row selects safe fields only: never a request URL, resource, issuer, client or token.
import { describe, expect, it } from 'vitest';
import { MAIN_ONLY_COMMANDS, NAMES } from '../names';
import { HOST_EVENTS, commands } from '../schema';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '../validate';

const ART = '11111111-1111-4111-8111-111111111111';
const HANDLE = '22222222-2222-4222-8222-222222222222';
const CONNECTION = '33333333-3333-4333-8333-333333333333';
const source = { kind: 'source', handle: HANDLE, server: 'notes', scope: 'user', transport: 'http', path: '/Users/me/.claude.json', tools: ['search'], needsDiscovery: false } as const;

describe('the owner’s connector server commands', () => {
  it('are main’s and bridged; the event is main-emitted and never on the host wire', () => {
    for (const name of ['connectors.servers', 'connectors.connect', 'connectors.reconnect', 'connectors.disconnect'] as const) {
      expect(commands[name].owner, name).toBe('main');
      expect([...NAMES.connectors.commands], name).toContain(name);
      expect(MAIN_ONLY_COMMANDS, name).not.toContain(name);
    }
    expect([...NAMES.connectors.events]).toContain('connectors.serversChanged');
    expect(HOST_EVENTS).not.toContain('connectors.serversChanged');
  });

  it('take an artifact and its tools, or an opaque source handle, or a saved connection id: never a URL or a path', () => {
    expect(validateCommandInput('connectors.servers', { artifactId: ART, tools: [{ server: 'notes', tool: 'search' }] }).ok).toBe(true);
    expect(validateCommandInput('connectors.connect', { artifactId: ART, sourceHandle: HANDLE }).ok).toBe(true);
    expect(validateCommandInput('connectors.reconnect', { artifactId: ART, sourceHandle: HANDLE }).ok).toBe(true);
    expect(validateCommandInput('connectors.disconnect', { connectionId: CONNECTION }).ok).toBe(true);
    expect(validateCommandInput('connectors.connect', { artifactId: ART, sourceHandle: HANDLE, url: 'https://x' }).ok, 'no URL').toBe(false);
    expect(validateCommandInput('connectors.connect', { artifactId: ART, sourceHandle: 'not-a-handle' }).ok).toBe(false);
    expect(validateCommandInput('connectors.servers', { artifactId: ART, tools: Array.from({ length: 257 }, (_, i) => ({ server: 's', tool: `t${i}` })) }).ok, 'bounded').toBe(false);
  });

  it('answers rows of safe fields only', () => {
    const http = { ...source, connection: { state: 'connected', connectionId: CONNECTION, disconnecting: 'unconfirmed' }, last: { action: 'connect', ok: true, tools: 3, credential: 'maws' } };
    const rows = [
      http,
      { kind: 'engineOnly', server: 'files', why: 'engineOnly', tools: ['read'] },
      { kind: 'saved', connectionId: CONNECTION, server: 'notes', scope: 'local', path: '/Users/me/.claude.json' },
      { kind: 'unreadable', connectionId: CONNECTION },
      { kind: 'retiring', connectionId: CONNECTION, disconnecting: 'pending', last: { action: 'disconnect', local: 'forgotten', host: 'unconfirmed', revocation: 'failed' } },
    ];
    expect(validateCommandOutput('connectors.servers', { servers: rows, saved: 'ok', withdrawnUnattributed: false }).ok).toBe(true);
    for (const leak of [{ resourceUrl: 'https://x/mcp' }, { issuer: 'https://as' }, { accessToken: 't' }, { sourceId: HANDLE }, { client: {} }]) {
      expect(validateCommandOutput('connectors.servers', { servers: [{ ...http, ...leak }], saved: 'ok', withdrawnUnattributed: false }).ok, Object.keys(leak)[0]).toBe(false);
    }
    expect(validateCommandOutput('connectors.servers', { servers: [{ ...http, last: { action: 'connect', ok: false, why: 'denied' } }], saved: 'ok', withdrawnUnattributed: false }).ok).toBe(true);
    expect(validateCommandOutput('connectors.servers', { servers: [{ ...http, last: { action: 'connect', ok: false, why: 'the server said 500: <html>' } }], saved: 'ok', withdrawnUnattributed: false }).ok, 'closed words').toBe(false);
  });

  it('acknowledges at once, and invalidates by the artifact alone', () => {
    expect(validateCommandOutput('connectors.connect', { accepted: true }).ok).toBe(true);
    expect(validateCommandOutput('connectors.connect', { accepted: false, why: 'busy' }).ok).toBe(true);
    expect(validateCommandOutput('connectors.disconnect', { accepted: true, connectionId: CONNECTION }).ok).toBe(false);
    expect(validateEventPayload('connectors.serversChanged', { artifactId: ART }).ok).toBe(true);
    expect(validateEventPayload('connectors.serversChanged', { artifactId: ART, state: 'connected' }).ok).toBe(false);
  });
});

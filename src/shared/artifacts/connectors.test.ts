// P3-H: the connector grant's portable shapes (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3 Decision Log 80; the
// P3 interface ledger's X23 grant rows).
import { describe, expect, it } from 'vitest';
import { CONNECTOR_GRANT_MODES, ConnectorCallRefSchema, ConnectorGrantRequestSchema, ConnectorGrantSchema, ConnectorToolRefSchema, connectorToolKey, sameConnectorTool } from './connectors';

const request = { server: 'claude.ai Notion', tool: 'search', fingerprint: 'sha256:0f3a', mode: 'read' } as const;

describe('the connector grant shapes (X23, P3-H)', () => {
  it('names a tool by the server and tool names mcp_status reports, as given', () => {
    for (const ref of [
      { server: 'fixture', tool: 'rows' },
      { server: 'plugin:acme:files', tool: 'list-files' },
      { server: 'claude.ai Google Drive', tool: 'search_files' },
    ]) {
      expect(ConnectorToolRefSchema.parse(ref)).toEqual(ref);
    }
  });

  it('refuses an empty, overlong or control-character name, and any extra field', () => {
    for (const bad of [
      { server: '', tool: 'rows' },
      { server: 'fixture', tool: '' },
      { server: 'x'.repeat(257), tool: 'rows' },
      { server: 'fixture', tool: 't'.repeat(257) },
      { server: 'fix\nture', tool: 'rows' },
      { server: 'fixture', tool: 'ro\u0000ws' },
      { server: 'fixture', tool: 'rows', args: {} },
    ]) {
      expect(ConnectorToolRefSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('takes a grant request with a fingerprint and one of the two modes, never another', () => {
    expect(CONNECTOR_GRANT_MODES).toEqual(['read', 'once']);
    expect(ConnectorGrantRequestSchema.parse(request)).toEqual(request);
    expect(ConnectorGrantRequestSchema.parse({ ...request, mode: 'once' }).mode).toBe('once');
    for (const bad of [{ ...request, mode: 'write' }, { ...request, fingerprint: '' }, { ...request, fingerprint: 'f'.repeat(513) }, { server: 'fixture', tool: 'rows', mode: 'read' }]) {
      expect(ConnectorGrantRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('records a grant as its request and its time, and a call check as the tool and the fingerprint it would run under', () => {
    expect(ConnectorGrantSchema.parse({ ...request, grantedAt: 1_760_000_000_000 })).toEqual({ ...request, grantedAt: 1_760_000_000_000 });
    expect(ConnectorGrantSchema.safeParse(request).success).toBe(false);
    expect(ConnectorCallRefSchema.parse({ server: 'fixture', tool: 'rows', fingerprint: 'f1' })).toEqual({ server: 'fixture', tool: 'rows', fingerprint: 'f1' });
    expect(ConnectorCallRefSchema.safeParse({ server: 'fixture', tool: 'rows', fingerprint: 'f1', mode: 'read' }).success).toBe(false);
  });

  it('compares and keys tools exactly by both names, so no two tools share a key', () => {
    expect(sameConnectorTool({ server: 'a', tool: 'b' }, { server: 'a', tool: 'b' })).toBe(true);
    expect(sameConnectorTool({ server: 'a', tool: 'b' }, { server: 'A', tool: 'b' })).toBe(false);
    expect(connectorToolKey({ server: 'a', tool: 'b' })).toBe(connectorToolKey({ server: 'a', tool: 'b' }));
    // a name holding the other's separator cannot collide
    expect(connectorToolKey({ server: 'a:b', tool: 'c' })).not.toBe(connectorToolKey({ server: 'a', tool: 'b:c' }));
    expect(connectorToolKey({ server: 'a__b', tool: 'c' })).not.toBe(connectorToolKey({ server: 'a', tool: 'b__c' }));
  });
});

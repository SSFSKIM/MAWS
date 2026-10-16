// P3-H, the connector grant (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 24 and 80; the P3
// interface ledger's X23 grant rows): the owner's permission for one artifact to run one MCP tool, the only gate on
// route E (the engine's mcp_call checks nothing) and on route D. Portable: no Node, Electron or `window.maws` here.
//
// A tool is named by the `server` and `tool` names the engine's mcp_status reports (a plugin server's
// `plugin:<plugin>:<server>`, a connector's `claude.ai <name>`), compared exactly. `fingerprint` is the caller's opaque
// identity of the server's configuration and the tool as granted (the spike's scope, transport, command and args or
// URL, never a header value); a call made under another fingerprint is refused until the owner grants again. `read`
// persists until revoked (a read-only tool, which a page may watch); `once` is the owner's Allow once for a tool that
// may write, consumed by the one call it authorizes and never watched.
import * as z from 'zod';

export const CONNECTOR_GRANT_MODES = ['read', 'once'] as const;
export type ConnectorGrantMode = (typeof CONNECTOR_GRANT_MODES)[number];

// Printable and bounded: a name the header shows and a key the store holds, never a control character.
const name = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\p{Cc}]+$/u, 'no control characters');

export const ConnectorToolRefSchema = z.strictObject({ server: name, tool: name });
export type ConnectorToolRef = z.infer<typeof ConnectorToolRefSchema>;

export const ConnectorGrantRequestSchema = z.strictObject({
  server: name,
  tool: name,
  fingerprint: z.string().min(1).max(512),
  mode: z.enum(CONNECTOR_GRANT_MODES),
});
export type ConnectorGrantRequest = z.infer<typeof ConnectorGrantRequestSchema>;

export const ConnectorGrantSchema = z.strictObject({ ...ConnectorGrantRequestSchema.shape, grantedAt: z.number().int().nonnegative() });
export type ConnectorGrant = z.infer<typeof ConnectorGrantSchema>;

// The tool a call would run and the fingerprint it would run under (what the store's authorization checks).
export const ConnectorCallRefSchema = z.strictObject({ server: name, tool: name, fingerprint: ConnectorGrantRequestSchema.shape.fingerprint });
export type ConnectorCallRef = z.infer<typeof ConnectorCallRefSchema>;

// The store's answer to a call (a `once` grant is consumed, durably, before `granted` is answered): `notGranted` when
// the artifact holds no grant for the tool (never granted, revoked, a used Allow once), `fingerprintChanged` when it
// holds one under another fingerprint (the owner re-grants to go on).
export type ConnectorAuthorization = { granted: true; mode: ConnectorGrantMode } | { granted: false; refusal: 'notGranted' | 'fingerprintChanged' };

// A committed change of one artifact's grant for one tool: `revoked` covers the owner's revoke and the artifact's
// deletion, `consumed` an Allow once used. What a live watch or call under that grant stops on.
export interface ConnectorGrantChange {
  artifactId: string;
  server: string;
  tool: string;
  change: 'granted' | 'revoked' | 'consumed';
}

export const sameConnectorTool = (a: ConnectorToolRef, b: ConnectorToolRef): boolean => a.server === b.server && a.tool === b.tool;

// A map key for a tool, unambiguous for any two names (a separator inside a name cannot make two tools collide).
export const connectorToolKey = (ref: ConnectorToolRef): string => JSON.stringify([ref.server, ref.tool]);

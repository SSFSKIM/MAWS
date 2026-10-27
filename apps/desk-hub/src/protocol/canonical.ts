// RFC 8785 (DX1's canonical form) lives in the protocol package (apps/org-protocol), so the hub, the machines and the
// apps share one canonicalizer; it is re-exported here under its name.
export { canonicalize } from 'org-protocol';

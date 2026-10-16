// The desk's protocols (docs/doperpowers/specs/2026-10-15-desk-design.md, DX1–DX4, DX6, DX7), shared by the hub, the
// web app, and the fake machine. Runtime-neutral: WebCrypto and plain TypeScript, no Workers, Node, or DOM API
// (tsconfig.protocol.json holds it to that).
export * from './base64url';
export * from './browser';
export * from './canonical';
export * from './codes';
export * from './identity';
export type * from './json';
export * from './log';
export * from './machine';
export * from './parts';
export * from './rpc';
export * from './session';

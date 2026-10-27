// The remote layer's protocol package (docs/doperpowers/plans/2026-10-27-p5-o11-hub-v2.md, Interfaces §A): RL5's
// signed org state and RL8's signed log events, with the canonical form and the names they share. The hub, desk-web,
// mawsd and the app's main import it, and nothing reimplements it. Runtime-neutral: WebCrypto (`crypto.subtle`) and
// plain TypeScript, with `.ts` import extensions so Node's type stripping loads it unbundled (tsconfig.json holds it
// to types/neutral-runtime.d.ts).
export * from './base64url.ts';
export * from './canonical.ts';
export * from './events.ts';
export * from './keys.ts';
export * from './names.ts';
export * from './org-state.ts';
export * from './records.ts';
export { isDevice, isEndpointRecord, isGrant, isListing, isMachineCert, isOrgState, isRootTransition, isSigned, isSignedOrgState } from './shapes.ts';
export * from './types.ts';
export * from './verdict.ts';

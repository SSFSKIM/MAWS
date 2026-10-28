// The remote layer's protocol package (docs/doperpowers/plans/2026-10-27-p5-o11-hub-v2.md, Interfaces §A): RL5's
// signed org state and RL8's signed log events, with the canonical form and the names they share; and, from O10 M1
// (docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md, Interfaces §A–§C), RL2's channel, RL3's messages, RL4's
// action, RL7's device capabilities and RL9's owner attestation. The hub, desk-web,
// mawsd and the app's main import it, and nothing reimplements it. Runtime-neutral: WebCrypto (`crypto.subtle`) and
// plain TypeScript, with `.ts` import extensions so Node's type stripping loads it unbundled (tsconfig.json holds it
// to types/neutral-runtime.d.ts).
export * from './action.ts';
export * from './app-hub.ts';
export * from './attest.ts';
export * from './base64url.ts';
export * from './canonical.ts';
export * from './channel.ts';
export * from './enrollment.ts';
export * from './events.ts';
export * from './frames.ts';
export * from './history.ts';
export * from './keys.ts';
export * from './messages.ts';
export * from './names.ts';
export * from './org-state.ts';
export * from './org-view.ts';
export * from './pairing.ts';
export * from './provisioning.ts';
export * from './records.ts';
export * from './relay.ts';
export { isCertRetirement, isCertificates, isDevice, isEndpointRecord, isGrant, isListing, isMachineCert, isOrgState, isRootTransition, isSigned, isSignedOrgState } from './shapes.ts';
export * from './types.ts';
export * from './verdict.ts';
export * from './webauthn.ts';

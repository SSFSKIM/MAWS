// The services entry (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §E; D13): the
// library's one door. Main's embedded root (src/main/index.ts) imports only this module of src/services/ (lint rule B),
// and main's build emits it as a third input, `out/main/services.js`, which src/engine-host/bundle-guard.test.ts holds to
// mawsd's rule: Node's builtins, zod and the MCP SDK, never electron. At O3-D `mawsd` composes the same roots from it.
export { openSpineData, startSpine, type SpineData, type SpineDeps, type SpineHosts, type SpineRoot } from './spine-root';
export { startCheckouts, type CheckoutsDeps, type CheckoutsRoot } from './checkouts-root';
export { startMachineIdentity } from './machine/identity';

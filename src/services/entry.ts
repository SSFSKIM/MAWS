// The services entry (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §E; D13): the
// library's one door, from which `mawsd` composes the spine (src/mawsd/spine-seam.ts). Main's build emits it as a third
// input, `out/main/services.js`, which src/engine-host/bundle-guard.test.ts holds to mawsd's rule: Node's builtins, zod
// and the MCP SDK, never electron. P5 O15 M2 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): the app
// imports nothing of it (lint rule B, and the bundle check on main's graph).
export { openSpineData, startSpine, type SpineData, type SpineDeps, type SpineHosts, type SpineRoot } from './spine-root';
export { takeSpineLock, type SpineLock } from './settings/spine-lock'; // P5 O3-D M2: mawsd takes the lock once per process and opens each load's data under it
export { idleReading, type IdleReading, type IdleReadingOptions } from './idle-reading'; // M5: e2e:daemon-idle-spine's subject

// The plain-Node helpers of the store's scheme that code under src/main/ reads (UX wave U6b-2, the file frames'
// responder and their issue: docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, Interfaces §C), by the same
// route src/render/scheme.ts gives its types: main does not import from src/services/ (P5 O3-C rule B), and reaches the
// store's scheme library through src/render/. Unlike src/render/scheme.ts it imports no Electron, so a unit suite can load
// it. A further name joins only on the architect's word.
export { rangeOf, STORE_FRAME_CSP } from '../services/artifacts/scheme/scheme-handler';
export type { SchemeResponder } from '../services/artifacts/scheme/artifact-handler';

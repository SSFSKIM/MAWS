// Every happy-dom project's setup (P5 O6 M2): the app's preload exposes `window.maws` before any page module runs, with the
// local machine's ref, and the page builds its fixed ids from it at module load (src/renderer/src/stores/echo.ts's
// `DIAGNOSTICS_SESSION`). A suite starts with a bridge that carries only the test machine; a suite installs its own fake
// in its place, `localMachine: TEST_MACHINE` included (./machine.ts).
import { TEST_MACHINE } from './machine';

(window as unknown as { maws: { localMachine: typeof TEST_MACHINE } }).maws = { localMachine: TEST_MACHINE };

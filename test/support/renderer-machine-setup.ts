// Every happy-dom project's setup (P5 O6 M2): the app's preload exposes `window.maws` before any page module runs, with the
// local machine's ref, and the page builds its fixed ids from it at module load (src/renderer/src/stores/echo.ts's
// `DIAGNOSTICS_SESSION`). A suite starts with a bridge that carries only the test machine; a suite installs its own fake
// in its place, `localMachine: TEST_MACHINE` included (./machine.ts). P5 O6 M5: the page reads its machine as it renders
// too (a row's machine chip), so each test starts with that bridge again when the one before removed its fake.
import { beforeEach } from 'vitest';
import { TEST_MACHINE } from './machine';

type Holder = { window: { maws?: { localMachine: typeof TEST_MACHINE } } };
const install = () => void ((globalThis as unknown as Holder).window.maws ??= { localMachine: TEST_MACHINE });

install();
beforeEach(install);

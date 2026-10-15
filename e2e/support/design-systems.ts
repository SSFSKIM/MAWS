// P3-D (the P3 spec's Decision Log 67): what the host seeds into a fresh store before any e2e case writes. The host
// creates one design_system artifact per bundled default (src/engine-host/design-systems/seed.ts over
// `DEFAULT_SYSTEMS`), each one log row, and a revision is the store's global log sequence (the spec's Decision Log 26).
// `DEFAULT_SYSTEMS` is a Vite glob Playwright cannot load, so this counts the same thing it enumerates: the directories
// under src/artifacts/types/design_system/defaults/, one per default (D's Decision Log 7, "defaults are data").
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './launch';

const DEFAULTS_DIR = join(REPO_ROOT, 'src/artifacts/types/design_system/defaults');

/** The bundled default design systems the host seeds into a fresh store. */
export const SEEDED_DEFAULT_SYSTEMS = readdirSync(DEFAULTS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;

/** The revision the first artifact an e2e case creates lands at in a fresh store: after the seeded defaults' rows. */
export const FIRST_CREATED_REVISION = SEEDED_DEFAULT_SYSTEMS + 1;

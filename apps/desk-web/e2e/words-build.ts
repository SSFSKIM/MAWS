// The desk's words rig's global setup (playwright.words.config.ts): builds dist/ from this checkout before any scene, so
// the rig never photographs a dist/ left by another commit or an older build, whichever way it is started.
import { join } from 'node:path';
import { build } from 'vite';

export default async function wordsBuild(): Promise<void> {
  await build({ root: join(import.meta.dirname, '..'), logLevel: 'warn' });
}

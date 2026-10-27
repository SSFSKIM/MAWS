// desk-hub's own suites' hub for the endpoint's RL1 suite (O10 M3): the Worker with its test seams, bundled here and run
// in Miniflare in this process behind the stand-in for Access (apps/desk-hub/test/support/local.ts). The wrangler-dev
// runner the enrollment suite uses (local-hub.ts) can't reach what RL1's proofs need: an object's eviction
// (`unsafeEvictDurableObject`), a generation claim held mid-upgrade, a Registry on older code, and the pushes the hub
// sends, which this hub keeps for the suite (`pushes`) in place of a push service. Nothing here reaches beyond 127.0.0.1.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleHub } from '../../apps/desk-hub/test/support/bundle';
import { startLocalHub, type LocalHub } from '../../apps/desk-hub/test/support/local';

export { ADMIN, credentials, ORG, type LocalHub } from '../../apps/desk-hub/test/support/local';

/** The hub, and its bundle's removal after it stops. */
export async function startMiniflareHub(): Promise<{ hub: LocalHub; stop(): Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'endpoint-mf-hub-'));
  try {
    const hub = await startLocalHub({ script: await bundleHub(join(dir, 'worker.js')) });
    return {
      hub,
      async stop() {
        await hub.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

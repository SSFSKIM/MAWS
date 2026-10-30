// P5 O10 M10: an org on desk-hub's local runner, for a scene that enrolls its mawsd (e2e/daemon-idle.spec.ts's enrolled
// case): test/endpoint/local-hub.ts's hub (wrangler dev's Miniflare behind the stand-in for Access, on loopback, with a
// scratch state directory) and its member, the org's admin, who issues a code and lists the machine once it posted its
// key under the code's pairing secret, as the admin's app does. Nothing reaches beyond 127.0.0.1.
//
// The member's side is ES modules that read `import.meta` and import TypeScript by its extension (apps/desk-hub's deploy
// tools, org-protocol), which Playwright's CommonJS transform cannot load; so, as apps/desk-hub/deploy/bin.ts does,
// local-hub.ts is bundled with esbuild first, here to CommonJS, with its one `import.meta.dirname` given, and required.
// test/support/local-org.test.ts enrolls a built mawsd through it.
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const REPO_ROOT = resolve(__dirname, '../..');
const LOCAL_HUB = join(REPO_ROOT, 'test/endpoint/local-hub.ts');

/** A command's end: its exit status and what it printed. */
export type Ran = { status: number | null; stdout: string; stderr: string };

export interface LocalOrg {
  /** The hub's URL, the stand-in's proxy, which an enrollment code names. */
  url: string;
  /**
   * Enrolls a machine as `name`: `run` is given a fresh v2 code and runs the machine's enrollment with it (its
   * `--wait` long enough for the listing); once the machine has posted its key, the member checks its MAC and lists it.
   * Resolves with what `run` printed, after it ended with status 0.
   */
  enroll(name: string, run: (code: string) => Promise<Ran>): Promise<Ran>;
  stop(): Promise<void>;
}

// What the bundle of local-hub.ts gives, as far as this module uses it.
type IssuedCode = { code: string; k: Uint8Array; enrollment: string };
type Member = { code(): Promise<IssuedCode>; awaitPosted(enrollment: string, waitMs?: number): Promise<{ machine: string } | null>; list(enrollment: string, k: Uint8Array): Promise<unknown> };
type LocalHubModule = { startLocalHub(options?: { heartbeatMs?: number }): Promise<{ url: string; admin(): Promise<Member>; stop(): Promise<void> }> };

/** The org, its hub on a free port; the bundle is written under `scratch`. `heartbeatMs` as local-hub.ts takes it. */
export async function startLocalOrg(scratch: string, options: { heartbeatMs?: number } = {}): Promise<LocalOrg> {
  const outfile = join(scratch, 'local-hub.cjs');
  await build({
    entryPoints: [LOCAL_HUB],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    logLevel: 'error',
    define: { 'import.meta.dirname': JSON.stringify(join(REPO_ROOT, 'test/endpoint')) },
  });
  const { startLocalHub } = createRequire(__filename)(outfile) as LocalHubModule;
  const hub = await startLocalHub(options);
  try {
    const member = await hub.admin(); // the org's genesis, signed by the admin's device
    return {
      url: hub.url,
      async enroll(name, run) {
        const issued = await member.code();
        const running = run(issued.code);
        const posted = await Promise.race([member.awaitPosted(issued.enrollment, 60_000), running.then((ran) => ({ ended: ran }))]);
        if (posted === null || 'ended' in posted) {
          const ran = posted === null ? await running : posted.ended;
          throw new Error(`${name} posted no key to the hub (the enrollment ended ${ran.status}: ${ran.stdout}${ran.stderr})`);
        }
        await member.list(issued.enrollment, issued.k);
        const ran = await running;
        if (ran.status !== 0) throw new Error(`${name}'s enrollment ended ${ran.status}: ${ran.stdout}${ran.stderr}`);
        return ran;
      },
      stop: () => hub.stop(),
    };
  } catch (error) {
    await hub.stop();
    throw error;
  }
}

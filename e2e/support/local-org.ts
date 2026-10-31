// P5 O10 M10: an org on desk-hub's local runner, for a scene that enrolls its mawsd (e2e/daemon-idle.spec.ts's enrolled
// case): test/endpoint/local-hub.ts's hub (wrangler dev's Miniflare behind the stand-in for Access, on loopback, with a
// scratch state directory) and its member, the org's admin, who issues a code and lists the machine once it posted its
// key under the code's pairing secret, as the admin's app does. Nothing reaches beyond 127.0.0.1.
//
// The member's side is ES modules that read `import.meta` and import TypeScript by its extension (apps/desk-hub's deploy
// tools, org-protocol), which Playwright's CommonJS transform cannot load; so, as apps/desk-hub/deploy/bin.ts does,
// local-hub.ts is bundled with esbuild first, here to CommonJS, with its one `import.meta.dirname` given, and required.
// test/support/local-org.test.ts enrolls a built mawsd through it.
//
// P5 O7 M2 (e2e:remote's scene, e2e/support/remote-scene.ts): the admin's side also lists a device of its own member in
// the state (an app profile's keys, as the admin's app approves a pairing) and reads the chain from genesis with the
// genesis's root as pins, which is what an app's MAWS_DEV_ORG directory holds.
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
  /** The admin's member id and the email the hub's stand-in for Access signs it in by. */
  admin: { member: string; email: string };
  /** Lists `device` among the admin member's devices, a `native-mac` with software keys endorsed by the admin's device,
   * in a successor the admin signs. */
  listDevice(device: { id: string; channelPub: string; stepUpPub: string }): Promise<void>;
  /** The org's chain from its genesis as the hub serves it now (its transitions and certificates beside it), and the
   * genesis's root as an app pins it. */
  chain(): Promise<{ org: string; chain: unknown[]; transitions: unknown[]; certificates: unknown; pins: { roots: string[]; recoveryPub: string } }>;
  stop(): Promise<void>;
}

// What the bundle of local-hub.ts gives, as far as this module uses it.
type IssuedCode = { code: string; k: Uint8Array; enrollment: string };
type OrgStateLike = { org: string; root: { keys: string[]; recoveryPub: string }; members: { id: string; devices: Record<string, unknown>[] }[] };
type Member = {
  readonly id: string;
  readonly admin: { org: string };
  readonly device: { stepUp: { privateKey: CryptoKey; pub: string } };
  readonly person: { json<T>(path: string): Promise<T> };
  code(): Promise<IssuedCode>;
  awaitPosted(enrollment: string, waitMs?: number): Promise<{ machine: string } | null>;
  list(enrollment: string, k: Uint8Array): Promise<unknown>;
  amend(what: string, edit: (state: OrgStateLike) => boolean | void): Promise<unknown>;
};
type LocalHubModule = {
  LOCAL_ADMIN: string;
  endorseDevice(org: string, member: string, device: Record<string, unknown>, key: CryptoKey, pub: string): Promise<unknown>; startLocalHub(options?: { heartbeatMs?: number }): Promise<{ url: string; admin(): Promise<Member>; stop(): Promise<void> }> };

/** The org, its hub on a free port; the bundle is written under `scratch`. `heartbeatMs` as local-hub.ts takes it. */
export async function startLocalOrg(scratch: string, options: { heartbeatMs?: number } = {}): Promise<LocalOrg> {
  const outfile = join(scratch, 'local-hub.cjs');
  await build({
    // local-hub.ts, and org-protocol's device endorsement for listDevice (the admin's device signs the new one in)
    stdin: { contents: `export * from ${JSON.stringify(LOCAL_HUB)};\nexport { endorseDevice } from 'org-protocol';`, resolveDir: REPO_ROOT, sourcefile: 'local-org-entry.ts', loader: 'ts' },
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    logLevel: 'error',
    define: { 'import.meta.dirname': JSON.stringify(join(REPO_ROOT, 'test/endpoint')) },
    alias: { '@shared': join(REPO_ROOT, 'src/shared') },
  });
  const { startLocalHub, LOCAL_ADMIN, endorseDevice } = createRequire(__filename)(outfile) as LocalHubModule;
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
      admin: { member: member.id, email: LOCAL_ADMIN },
      async listDevice(device) {
        // A device new to a member who has devices carries an endorsement by one of theirs (org-state.ts, `endorsed`)
        const entry = { id: device.id, class: 'native-mac', keyStorage: 'software', channelPub: device.channelPub, stepUpPub: device.stepUpPub };
        const endorsement = await endorseDevice(member.admin.org, member.id, entry, member.device.stepUp.privateKey, member.device.stepUp.pub);
        await member.amend(`device ${device.id} listed`, (state) => {
          const own = state.members.find((m) => m.id === member.id);
          if (own === undefined) throw new Error(`the head lists no member ${member.id}`);
          own.devices.push({ ...entry, endorsement });
        });
      },
      async chain() {
        const view = await member.person.json<{ chain?: { state: OrgStateLike }[]; more?: boolean; transitions: unknown[]; certificates: unknown }>('/api/org/state?since=0');
        const genesis = view.chain?.[0];
        if (genesis === undefined) throw new Error('the hub serves no org state');
        if (view.more === true) throw new Error('the hub paged the chain: the scene reads one page');
        return { org: genesis.state.org, chain: view.chain!, transitions: view.transitions, certificates: view.certificates, pins: { roots: [...genesis.state.root.keys], recoveryPub: genesis.state.root.recoveryPub } };
      },
      stop: () => hub.stop(),
    };
  } catch (error) {
    await hub.stop();
    throw error;
  }
}

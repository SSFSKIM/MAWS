// The development org session (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The development
// source", Interfaces §E): one way for a development run or an e2e to give an app a signed-in session before O8's
// sign-in exists, so M2's two-profile e2e and O9's remote lane A e2e share it rather than each building one.
//
// Honoured only in a build that is not packaged, when MAWS_DEV_ORG names a directory holding `session.json` and
// `chain.json`. It returns at once, signed out, and loads in the background, firing `onChanged` once signed in, so
// startup never waits on it. It verifies the chain against the pins (`verifyPinnedChain`) and holds it in memory
// (advances are not persisted), loads this profile's own device keys, and stays signed out, with a log line naming why,
// when the chain doesn't verify, when the head doesn't list `member`'s `device` with this profile's channel key, or when a
// stand-in user is named for a hub that isn't `http://127.0.0.1:<port>` (the stand-in header means something only to the
// local hub). Its step-up signer is main's real one: there is no bypass.
//
// P5 O7 M2 (Interfaces §Q): `session.json` may carry `directMap`, each advertised `ws://` address of a machine's endpoint
// record to the loopback one to dial instead, so an e2e on one Mac reaches the direct carrier of a `mawsd` whose listener
// advertises a fake tailnet address. It is read once, at the load, and exposed on the session (`directMap()`), from which
// main builds the link's `dialDirect`; it changes only which address a dial goes to, never what the link checks.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isCertificates, keyId, memoryOrgView, NO_CERTIFICATES, verifyPinnedChain, type OrgView } from '../../../apps/org-protocol/src/index.ts';
import { loadDeviceKeys, type DeviceKeys } from '../device/keys';
import { DEVICE_CAPABILITIES } from '../machines/remote/capabilities';
import { watchedView, type OrgSession, type SignedIn } from './session';

/** The local hub's stand-in for Access (desk-hub's `local/standin.ts` `IDENTITY_HEADER`; dev-session.test.ts pins it). */
export const STANDIN_HEADER = 'x-desk-standin-user';

type SessionFile = {
  version: 1;
  org: string;
  member: string;
  device: string;
  pins: { roots: string[]; recoveryPub: string };
  hub: { url: string; standinUser?: string } | null;
  directMap?: Record<string, string>;
};

const LOOPBACK_HUB = /^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/;
const WS_ADDRESS = /^ws:\/\/[^/?#\s]+\/?$/;
const LOOPBACK_WS = /^ws:\/\/127\.0\.0\.1:\d{1,5}\/?$/;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function readSessionFile(value: unknown): SessionFile | string {
  if (!isObject(value) || value.version !== 1) return 'session.json is not version 1';
  if (!isText(value.org) || !isText(value.member) || !isText(value.device)) return 'session.json lacks org, member or device';
  const pins = value.pins;
  if (!isObject(pins) || !Array.isArray(pins.roots) || !pins.roots.every(isText) || !isText(pins.recoveryPub)) return 'session.json lacks its pins';
  const hub = value.hub;
  if (hub !== null && (!isObject(hub) || !isText(hub.url) || (hub.standinUser !== undefined && !isText(hub.standinUser)))) return 'session.json has a malformed hub';
  const map = value.directMap;
  if (map !== undefined && (!isObject(map) || !Object.entries(map).every(([from, to]) => WS_ADDRESS.test(from) && typeof to === 'string' && LOOPBACK_WS.test(to)))) {
    return 'session.json has a malformed directMap (each an advertised ws:// address to a ws://127.0.0.1:<port> one)';
  }
  return value as SessionFile;
}

export function createDevOrgSession(input: {
  dir: string;
  userData: string;
  packaged: boolean;
  build: string;
  stepUp: (keys: DeviceKeys, device: { org: string; device: string }) => SignedIn['stepUp'];
  loadKeys?: typeof loadDeviceKeys;
  log(line: string): void;
}): OrgSession & { loaded: Promise<void>; directMap(): Readonly<Record<string, string>> } {
  const log = (line: string) => input.log(`[dev-org] ${line}`);
  const listeners = new Set<() => void>();
  let held: SignedIn | null = null;
  let listed = false;
  /** session.json's `directMap`, once the session signed in from it; empty before, and without one. */
  let directMap: Readonly<Record<string, string>> = {};
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  const session = {
    current: () => (listed ? held : null),
    directMap: () => directMap,
    onChanged(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  if (input.packaged) {
    log('MAWS_DEV_ORG is ignored in a packaged build');
    return { ...session, loaded: Promise.resolve() };
  }

  async function load(): Promise<void> {
    let file: SessionFile;
    let chain: { chain?: unknown; transitions?: unknown; certificates?: unknown };
    try {
      const read = readSessionFile(JSON.parse(await readFile(join(input.dir, 'session.json'), 'utf8')));
      if (typeof read === 'string') return log(`signed out: ${read}`);
      file = read;
      chain = JSON.parse(await readFile(join(input.dir, 'chain.json'), 'utf8')) as typeof chain;
    } catch (error) {
      return log(`signed out: ${input.dir} does not read (${(error as Error).message})`);
    }
    if (file.hub?.standinUser !== undefined && !LOOPBACK_HUB.test(file.hub.url)) return log(`signed out: a stand-in user is named for ${file.hub.url}, which is not the local hub`);
    const verified = await verifyPinnedChain(chain.chain, chain.transitions ?? [], file.pins);
    if (!verified.ok) return log(`signed out: the chain does not verify (${verified.code})`);
    if (verified.head.state.org !== file.org) return log(`signed out: the chain is org ${verified.head.state.org}, not ${file.org}`);
    const certificates = chain.certificates === undefined ? NO_CERTIFICATES : chain.certificates;
    if (!isCertificates(certificates)) return log('signed out: chain.json has malformed certificates');
    const keys = await (input.loadKeys ?? loadDeviceKeys)(input.userData);
    const channelKid = await keyId(keys.channel.pub);

    const isListed = async (view: OrgView): Promise<boolean> => {
      const device = view.head().state.members.find((m) => m.id === file.member)?.devices.find((d) => d.id === file.device);
      return device !== undefined && device.class === 'native-mac' && (await keyId(device.channelPub)) === channelKid;
    };
    // Each head the view adopts, a link's handshake included, is checked again before `onChanged` fires.
    const adopted = () =>
      void isListed(view).then((now) => {
        if (now !== listed) log(now ? 'this device is listed again' : 'signed out: the new head no longer lists this device');
        listed = now;
        changed();
      });
    const view: OrgView = watchedView(memoryOrgView({ chain: verified.adopted, transitions: verified.transitions, certificates }), adopted);
    if (!(await isListed(view))) return log(`signed out: the head doesn't list device ${file.device} of member ${file.member} with this profile's channel key`);
    const hub = file.hub;
    held = {
      identity: { org: file.org, member: file.member, device: file.device, clientClass: 'native-mac', channelKey: keys.channel, build: input.build, capabilities: [...DEVICE_CAPABILITIES] },
      view,
      stepUp: input.stepUp(keys, { org: file.org, device: file.device }),
      hub:
        hub === null
          ? null
          : { url: hub.url.replace(/\/+$/, ''), headers: () => Promise.resolve<Record<string, string>>(hub.standinUser === undefined ? {} : { [STANDIN_HEADER]: hub.standinUser }) },
    };
    directMap = { ...file.directMap };
    listed = true;
    log(`signed in to org ${file.org} as device ${file.device}, at state ${verified.head.state.version}`);
    changed();
  }

  const loaded = load().catch((error: unknown) => log(`signed out: ${(error as Error).message}`));
  return { ...session, loaded };
}

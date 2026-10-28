// What a staging phone run is (P5 O13 M7, Interfaces §H): its names, its mode and its sink, read from the environment
// `apps/desk-hub/deploy/staging-run.sh phone <n>` builds, and the names everything it makes on staging carries, so its
// cleanup (sweep.ts) finds them in the org state again however the run ended.
import { base64urlDecode, base64urlEncode } from 'org-protocol';

/** The run id's grammar, the runner's (`staging-run.sh`: `[a-z0-9-]{1,20}`). */
const RUN_ID = /^[a-z0-9-]{1,20}$/;

/** The scratch machine the run enrolls on staging. */
export const machineName = (n: string) => `o13-phone-${n}`;
/** The second member the run adds, with one `native-mac` device and no sign-in. */
export const memberEmail = (n: string) => `o13-b-${n}@staging.invalid`;
/** The owner's second `web-cards` device: M3's code path picks its id, so the run names it by its passkey's credential. */
export const cardsDeviceName = (n: string) => `o13-c-${n}`;
/** That device's passkey credential id: `o13-c-<n>` itself, base64url, which the sweep reads back. */
export const cardsCredentialId = (n: string) => base64urlEncode(new TextEncoder().encode(cardsDeviceName(n)));

/** The run id a credential id names, when it is one of this harness's (`o13-c-<n>`); null otherwise. */
export function cardsRunOf(credentialId: string): string | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(base64urlDecode(credentialId));
  } catch {
    return null;
  }
  const n = text.startsWith('o13-c-') ? text.slice('o13-c-'.length) : null;
  return n !== null && RUN_ID.test(n) && base64urlEncode(new TextEncoder().encode(text)) === credentialId ? n : null;
}

/**
 * The run: `phone`, the owner's real phone answering at the owner's hand; `rehearse`, the owner's second device
 * answering in the phone's place, so the whole run is proved on staging before the owner sits down. `cleanup` undoes a
 * run's leftovers alone (the runner's last step, however the run ended).
 */
export type PhoneRun = {
  n: string;
  mode: 'phone' | 'rehearse' | 'cleanup';
  /** The admin device's keys file (the staging admin's, `DESK_STAGING_DEVICE`), its anchor beside it. */
  keysFile: string;
  /** The owner's staging Access token (`cloudflared access token`), read by the runner, never printed. */
  token: string;
  /** The phone's device id when the owner names it; otherwise the owner's one `web-cards` device the run did not make. */
  phoneDevice: string | null;
  /** The push sink: a public https base the quick tunnel forwards to 127.0.0.1:<port>; or why there is none. */
  sink: { url: string; port: number } | { none: string };
  /** Lane B's leg: `probe` runs it once the endpoint feeds lane B counts, and says it waits otherwise; `required` fails then. */
  laneB: 'probe' | 'required';
  /** How long the phone has to answer (§H: 10 minutes). */
  answerMs: number;
  /** The endpoint's scratch profile, the runner's to remove however the run ends; a temporary one when unset. */
  profileDir: string | null;
  /**
   * Where the run lists each secret it handles (an enrollment code and its token, a pairing code and its secret, the
   * machine's service token), one a line, for the runner's search of the log afterwards; the runner removes the list.
   */
  scanList: string | null;
};

export const ANSWER_MS = 10 * 60_000;

/** The run as the environment names it; throws naming what is missing or malformed. */
export function readRun(env: Record<string, string | undefined>): PhoneRun {
  const problems: string[] = [];
  const n = env.DESK_STAGING_PHONE_RUN ?? '';
  if (!RUN_ID.test(n)) problems.push(`DESK_STAGING_PHONE_RUN is a run id ([a-z0-9-]{1,20}), not '${n}'`);
  const mode = env.DESK_STAGING_PHONE === 'cleanup' ? 'cleanup' : env.DESK_STAGING_PHONE_MODE === 'rehearse' ? 'rehearse' : env.DESK_STAGING_PHONE_MODE === 'phone' ? 'phone' : null;
  if (mode === null) problems.push(`DESK_STAGING_PHONE_MODE is phone or rehearse, not '${env.DESK_STAGING_PHONE_MODE ?? ''}'`);
  const keysFile = env.DESK_STAGING_ADMIN_KEYS ?? '';
  if (!keysFile) problems.push('DESK_STAGING_ADMIN_KEYS names the admin device’s keys file');
  const token = env.DESK_ACCESS_TOKEN ?? '';
  if (!token) problems.push('DESK_ACCESS_TOKEN holds the owner’s staging Access token');
  const phoneDevice = env.DESK_STAGING_PHONE_DEVICE || null;
  if (phoneDevice !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(phoneDevice)) problems.push('DESK_STAGING_PHONE_DEVICE is a device id (base64url)');
  let sink: PhoneRun['sink'];
  const url = env.DESK_STAGING_PHONE_SINK;
  if (url) {
    const port = Number(env.DESK_STAGING_PHONE_SINK_PORT);
    if (!url.startsWith('https://')) problems.push('DESK_STAGING_PHONE_SINK is an https URL');
    if (!(Number.isSafeInteger(port) && port > 0 && port < 65536)) problems.push('DESK_STAGING_PHONE_SINK_PORT is a port number');
    sink = { url, port };
  } else sink = { none: env.DESK_STAGING_PHONE_NO_SINK || 'no push sink was given' };
  const laneB = env.DESK_STAGING_PHONE_LANE_B === 'required' ? 'required' : 'probe';
  if (problems.length > 0) throw new Error(problems.join('; '));
  return { n, mode: mode!, keysFile, token, phoneDevice, sink, laneB, answerMs: ANSWER_MS, profileDir: env.DESK_STAGING_PHONE_PROFILE || null, scanList: env.DESK_STAGING_PHONE_SCAN || null };
}

/** What lane B's leg does, once the run has looked for the endpoint's lane B counts at the hub. */
export function laneBLeg(fed: boolean, laneB: PhoneRun['laneB']): 'run' | 'wait' | 'fail' {
  if (fed) return 'run';
  return laneB === 'required' ? 'fail' : 'wait';
}

/** Why a lane B leg waits (P5 O13 Decision Log, "Lane B's pending counts are not sminos's"); the report's line reads
 * `NOT RUN round-trip lane B: <this>`. */
export const LANE_B_WAITING = "waiting on O10's lane B notifier feed";

/** How many causes below the error the stop line names. */
const STOP_CAUSES = 4;

/**
 * The `the run stopped: <this>` line: the error's message, then each cause's code and message, a few levels down, since
 * undici's `fetch failed` keeps what happened (ECONNRESET, UND_ERR_SOCKET, ENOTFOUND) under `cause`. Nothing that can
 * carry a token is printed: every URL and query string is cut, and no header or body is read (undici's causes carry
 * an address, a host and a port at most).
 */
export function stopLine(error: unknown): string {
  const parts = [plainly(error)];
  let below = error instanceof Error ? error.cause : undefined;
  for (let depth = 0; below !== undefined && below !== null; depth++) {
    if (depth === STOP_CAUSES) {
      parts.push('…');
      break;
    }
    parts.push(`cause ${plainly(below)}`);
    below = below instanceof Error ? below.cause : undefined;
  }
  return parts.join('; ');
}

/** An error's code and message (an AggregateError's errors' messages when it has none of its own). */
function plainly(error: unknown): string {
  if (!(error instanceof Error)) return withoutUrls(String(error));
  const message = error.message || (error instanceof AggregateError ? error.errors.map((each) => (each instanceof Error ? each.message : String(each))).join(', ') : '');
  const code = (error as NodeJS.ErrnoException).code;
  const text = withoutUrls(message);
  if (typeof code !== 'string') return text;
  return text ? `${code}: ${text}` : code;
}

/** `text` with every URL, and every query string to the next space (a colon ending it kept), cut. */
const withoutUrls = (text: string) => text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '<url>').replace(/\?\S*?(?=:?(?:\s|$))/g, '?<query>');

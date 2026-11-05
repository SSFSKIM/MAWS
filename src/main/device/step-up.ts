// Step-up in main (P5-O10 M9; the remote layer's §5.6). An execution-grade action (a spawn, an approval on a session the
// member doesn't own, a change of owners or shares, a machine-admin action, a shell request by a non-owner) carries the
// device's step-up signature over its canonical form (RL4, org-protocol's `signStepUp`). Main builds that action from
// typed fields, renders the text the person confirms from the action itself, asks the confirmation, and signs only
// after it: the renderer asks for an action by its fields and never supplies the bytes that are signed or the words
// that are shown.
//
// How the person confirms is a strategy (`Confirm`). U5's spike (spikes/u5-local-auth/, the MacBook's record of
// 2026-10-27) settled it on Electron's `promptTouchID`, which main uses unless it injects another: Touch ID, or the
// login password where there is none. Its tested fallback is a LocalAuthentication addon with device-owner
// authentication (the spike's candidate 2), should `promptTouchID` ever lose the password path.
//
// The step-up key is also the key of an org root (RL5: `root.keys` holds admin devices' step-up key ids), so the org
// states this device signs as a root are signed here too, behind the same confirmation (`createStateSigner`, P5-O8 M3).
// The key never leaves this module (P5 Decision Log 53): the org signer composes the state and its words and hands both
// in, and gets back only the signed state.
//
// One act is signed without asking (P5 O7 M10 B, the owner's ruling "Not on my machines"): a `session.spawn` on a machine
// whose owners, in the org state main holds, include the member this step-up key belongs to (`signsUnasked`). Its
// signature is the one a confirmed act gets, so the machines that verify it, and the ownership proof it makes (attest.ts's
// `SPAWN_ACTIONS`), don't change. The exemption is judged here, on the action as built, and on nothing a caller says.
import { systemPreferences, type SystemPreferences } from 'electron';
import {
  base64urlEncode,
  canonicalize,
  endorseDevice,
  isAction,
  keyId,
  machineOwners,
  NONCE_BYTES,
  ownerMembers,
  signOrgState,
  signStepUp,
  type Action,
  type OrgState,
  type OrgView,
  type SignedOrgState,
  type SigningKey,
} from '../../../apps/org-protocol/src/index.ts';

/** What the person is asked to confirm: `summary` fits a system prompt's one line; `text` is every field, one per line. */
export type StepUpPrompt = { summary: string; text: string };
export type Confirmation = { ok: true } | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed' };
/** The confirmation strategy. It resolves once the person has answered; it never sees a key. */
export type Confirm = (prompt: StepUpPrompt) => Promise<Confirmation>;

/** An action as the renderer asks for it: its typed fields. A reseal names the operation's `opId` and `opCreated`. */
export type StepUpRequest = Pick<Action, 'machine' | 'action' | 'args'> & Partial<Pick<Action, 'session' | 'context' | 'requestDigest' | 'opId' | 'opCreated'>>;
export type StepUpResult = { ok: true; action: Action } | { ok: false; reason: Exclude<Confirmation, { ok: true }>['reason'] | 'malformed' };

const random = (bytes: number) => base64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));

/**
 * U5's winner: macOS's own prompt, through Electron's `promptTouchID` (LAContext with user presence, which takes Touch ID
 * or the login password). The summary is its reason; the full text is left to the app's own view. Electron rejects with
 * only the localized description, so a cancel can't be told from another failure to authenticate: either is a refusal,
 * reported as `cancelled`. `canPromptTouchID()` is not consulted, since it is false on a Mac with no Touch ID, where this
 * prompt still takes the password.
 */
export function promptTouchIDConfirmation(prefs: Pick<SystemPreferences, 'promptTouchID'>): Confirm {
  return async ({ summary }) => {
    try {
      await prefs.promptTouchID(summary);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'cancelled' };
    }
  };
}

/** The org view main holds for this device's session (`SignedIn.view`), read at each signature: null while signed out. */
export type HeldOrgView = () => Pick<OrgView, 'head' | 'certificates'> | null;

/** The one action name signed without a prompt, and only on an owned machine (see `signsUnasked`). */
const OWNED_SPAWN = 'session.spawn';

/**
 * Whether `action` is signed without asking the person (P5 O7 M10 B): a `session.spawn` on a machine whose owners in the
 * held head include the member this step-up key belongs to. The trust boundary sits here:
 * - `action` is the private canonical copy main built from typed fields, the very object that is sealed and signed, so
 *   the name and machine judged are the ones signed; nothing else a request carries (a flag, a claim in its args) is read.
 * - The member is the one the head lists this device under with this step-up key (as attest.ts's `proofSigner` finds the
 *   signer), never a member a caller names; the owners are the head's (`machineOwners` and `ownerMembers`, as the
 *   endpoint's `machineOwnerMembers` reads them: an org-owned machine's are the admins), read when the act is signed, so
 *   an owner removed by a newer head is asked again.
 * - Only the shape the app's spawn has: no session, launch context or request digest. Anything else, or any doubt (no
 *   view, another org, the device or key unlisted, the machine unplaced, an error) asks.
 */
async function signsUnasked(action: Action, held: HeldOrgView | undefined, pub: string, now: Date): Promise<boolean> {
  if (action.action !== OWNED_SPAWN || action.session !== undefined || action.context !== undefined || action.requestDigest !== undefined) return false;
  try {
    const view = held?.() ?? null;
    if (view === null) return false;
    const state = view.head().state;
    if (state.org !== action.org) return false;
    const member = state.members.find((m) => m.devices.some((d) => d.id === action.device && d.stepUpPub === pub));
    if (member === undefined) return false;
    const owners = await machineOwners(state, action.machine, view.certificates(), now);
    return owners !== null && ownerMembers(state, owners).includes(member.id);
  } catch {
    return false;
  }
}

/**
 * `confirm` defaults to `promptTouchIDConfirmation(systemPreferences)`, main's confirmation. `org`: the session's held
 * view, by which a spawn on a machine the member owns is signed unasked; without it every action is confirmed.
 */
export function createStepUp(deps: { device: { org: string; device: string }; key: SigningKey; confirm?: Confirm; now?: () => Date; org?: HeldOrgView }): {
  sign(request: StepUpRequest): Promise<StepUpResult>;
} {
  const now = deps.now ?? (() => new Date());
  const confirm = deps.confirm ?? promptTouchIDConfirmation(systemPreferences);
  return {
    async sign(request) {
      // The fields come from the request by name, so nothing else it carries reaches the action.
      const { machine, action, args, session, context, requestDigest, opId, opCreated } = request;
      const at = now().toISOString();
      const built: Action = {
        v: 1,
        org: deps.device.org,
        machine,
        device: deps.device.device,
        opId: opId ?? random(16),
        opCreated: opCreated ?? at,
        action,
        ...(session === undefined ? {} : { session }),
        ...(context === undefined ? {} : { context }),
        args,
        ...(requestDigest === undefined ? {} : { requestDigest }),
        nonce: random(NONCE_BYTES),
        created: at,
      };
      if (!isAction(built)) return { ok: false, reason: 'malformed' };
      // A private copy in the canonical form the signature covers (an undefined field absent), taken before anything
      // is shown: the caller keeps references to its args, context and digest, and to the device identity, and may change
      // them while the person decides. What is shown is what is signed.
      const shown = JSON.parse(canonicalize(built)) as Action;
      // Judged on `shown`, the copy that is sealed below, never on the request: what is exempted is what is signed.
      let answer: Confirmation = { ok: true };
      if (!(await signsUnasked(shown, deps.org, deps.key.pub, now()))) {
        try {
          answer = await confirm(renderAction(shown));
        } catch {
          answer = { ok: false, reason: 'failed' };
        }
      }
      if (!answer.ok) return answer;
      // Stamped when the person confirmed, so time spent at the prompt doesn't make it stale (RL4's 60 s). Only the
      // nonce and times change, and they are not part of what is rendered.
      const sealedAt = now().toISOString();
      const sealed: Action = { ...shown, opCreated: opCreated ?? sealedAt, nonce: random(NONCE_BYTES), created: sealedAt };
      if (!isAction(sealed)) return { ok: false, reason: 'malformed' };
      return { ok: true, action: await signStepUp(sealed, deps.key) };
    },
  };
}

/**
 * What a state signature may carry beside the state (P5-O8 M4a, "Endorsement inside one Touch ID"). `endorse`: devices
 * this key endorses on the copy it signs, each one the state lists under that member (a later device of this key's own
 * member, which the protocol's `endorsed` asks one of the member's step-up keys to endorse). `live`: whether what the
 * person is asked about still stands (a pairing neither cancelled nor expired), read once after they answer yes and
 * before anything is endorsed or signed.
 */
export type StateSignOptions = { endorse?: ReadonlyArray<{ member: string; device: string }>; live?(): boolean };

/** Signs org states with the step-up key, each after the person confirmed the words the org signer composed for it. */
export type StateSigner = {
  /** keyId(stepUp.pub): the id `root.keys` lists for this device. */
  kid: string;
  /**
   * Every refusal of the confirmation is `cancelled`: nothing was signed, whatever the reason; so is a `live` that says
   * no after the person said yes. One confirmation covers the endorsements and the state. Throws, before asking, when
   * `endorse` names a device the state doesn't list under that member (the caller's error, never the person's).
   */
  sign(state: OrgState, prompt: StepUpPrompt, options?: StateSignOptions): Promise<{ ok: true; signed: SignedOrgState } | { ok: false; reason: 'cancelled' }>;
};

/** `confirm` defaults to `promptTouchIDConfirmation(systemPreferences)`, main's confirmation. Async only for the key id. */
export async function createStateSigner(deps: { key: SigningKey; confirm?: Confirm }): Promise<StateSigner> {
  const confirm = deps.confirm ?? promptTouchIDConfirmation(systemPreferences);
  return {
    kid: await keyId(deps.key.pub),
    async sign(state, prompt, options = {}) {
      // A private copy in the canonical form the signature covers, taken before the person is asked: the caller keeps
      // its reference and may change it while the person decides. What was asked about is what is signed.
      const asked = JSON.parse(canonicalize(state)) as OrgState;
      const endorsing = (options.endorse ?? []).map(({ member, device }) => {
        const listed = asked.members.find((m) => m.id === member)?.devices.find((d) => d.id === device);
        if (listed === undefined) throw new Error(`the state lists no device ${device} under member ${member} to endorse`);
        return { member, device: listed };
      });
      let answer: Confirmation;
      try {
        answer = await confirm(prompt);
      } catch {
        answer = { ok: false, reason: 'failed' };
      }
      if (!answer.ok) return { ok: false, reason: 'cancelled' };
      // What the person was asked about may have ended meanwhile (a pairing cancelled or expired): nothing is endorsed or signed.
      if (options.live !== undefined && !options.live()) return { ok: false, reason: 'cancelled' };
      // An endorsement covers the device without one (`endorseDevice` leaves it out), so one the caller left is replaced.
      for (const { member, device } of endorsing) device.endorsement = await endorseDevice(asked.org, member, device, deps.key.privateKey, deps.key.pub);
      return { ok: true, signed: await signOrgState(asked, [deps.key]) };
    },
  };
}

/**
 * The text of an action as the person confirms it: every field it binds except what a reseal changes (its opId, nonce
 * and times), one per line, each value in JSON so a line break or a bidi or other invisible control inside a value is
 * escaped and can't forge another line.
 */
export function renderAction(a: Action): StepUpPrompt {
  const lines = [`Action: ${shown(a.action)}`, `Machine: ${shown(a.machine)}`, `Org: ${shown(a.org)}`, `Device: ${shown(a.device)}`];
  if (a.session !== undefined) lines.push(`Session: ${shown(a.session)}`);
  if (a.context?.lane === 'A') lines.push(`Launch: ${shown(a.context.launch)} (lane A session ${shown(a.context.session)})`);
  if (a.context?.lane === 'B') lines.push(`Launch: ${shown(a.context.launchId)} (engine session ${shown(a.context.engineSessionId)})`);
  if (a.requestDigest !== undefined) {
    const d = a.requestDigest;
    lines.push(`Request: ${shown(d.tool)} ${shown(d.request)} in session ${shown(d.session)}, input SHA-256 ${shown(d.input_sha256)}`);
  }
  // An undefined value is absent from the canonical form the signature covers, so it is not shown either.
  for (const name of Object.keys(a.args).filter((key) => a.args[key] !== undefined).sort()) lines.push(`${/^[A-Za-z0-9_.-]+$/.test(name) ? name : json(name)}: ${json(a.args[name])}`);
  return { summary: `${shown(a.action)} on machine ${shown(a.machine)}`, text: lines.join('\n') };
}

// Line and paragraph separators, bidi embeddings, overrides and isolates, zero-width characters and the BOM: invisible,
// or able to reorder what is shown. JSON.stringify escapes only the C0 controls.
const INVISIBLE = /[\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
const escapeInvisible = (text: string) => text.replace(INVISIBLE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const json = (value: unknown) => escapeInvisible(JSON.stringify(value));
/** A plain identifier as it is; anything else as JSON. */
const shown = (text: string) => (/^[A-Za-z0-9_.:/@-]+$/.test(text) ? text : json(text));

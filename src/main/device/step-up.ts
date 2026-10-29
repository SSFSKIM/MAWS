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
import { systemPreferences, type SystemPreferences } from 'electron';
import {
  base64urlEncode,
  canonicalize,
  endorseDevice,
  isAction,
  keyId,
  NONCE_BYTES,
  signOrgState,
  signStepUp,
  type Action,
  type OrgState,
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

/** `confirm` defaults to `promptTouchIDConfirmation(systemPreferences)`, main's confirmation. */
export function createStepUp(deps: { device: { org: string; device: string }; key: SigningKey; confirm?: Confirm; now?: () => Date }): { sign(request: StepUpRequest): Promise<StepUpResult> } {
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
      const prompt = renderAction(shown);
      let answer: Confirmation;
      try {
        answer = await confirm(prompt);
      } catch {
        answer = { ok: false, reason: 'failed' };
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

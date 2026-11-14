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
// Two acts are signed without asking (P5 O7 M10 B, the owner's ruling "Not on my machines"; the UX wave, U9 M2, its
// extension to a fork): a `session.spawn` or a `session.fork` on a machine whose owners, in the org state main holds,
// include the member this step-up key belongs to (`signsUnasked`). Its signature is the one a confirmed act gets, so the
// machines that verify it, and the ownership proof a spawn makes (attest.ts's `SPAWN_ACTIONS`, which a fork is not in),
// don't change. The exemption is judged here, on the action as built, and on nothing a caller says.
//
// The words (the UX wave, U9 S-13): the message is a person's sentence for the action naming the machine by its name, as
// the org view main holds gives it (the head's machine entry, else its certificate, else the ref), its ref beside it when
// two machines share the name; the detail keeps every signed field, the machine as `<name> (<ref>)`. The ref is what is
// signed and the name is not, so the name never replaces the ref in the detail. A name is escaped as every shown value is
// (./prompt-text.ts): a member wrote it.
//
// P5 O8 M6b: several acts under one confirmation (`signActions`, a Share sheet's save). The person confirms every act's
// text at once (`renderActions`), and each canonical copy is then signed, all stamped at the confirmation. Nothing in a
// batch is ever signed unasked.
//
// P5 O8 M4b: a record signed beside the org state (`createRecordSigner`, a grant), behind one confirmation, as an org
// state is: the caller composes the record and its words, the canonical copy taken before the person is asked is what is
// signed, and `live` is read once after a yes. It is neither an org state nor an act, so it goes through neither of
// their signers, and only the record domains (`RECORD_DOMAINS`) are signed here.
import { systemPreferences, type SystemPreferences } from 'electron';
import { json, shown } from './prompt-text';
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
  signRecord,
  signStepUp,
  SIGNING_DOMAINS,
  type Action,
  type OrgState,
  type OrgView,
  type Signed,
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
/** M6b: several acts signed under one confirmation, in the order asked; or none. */
export type StepUpManyResult = { ok: true; actions: Action[] } | { ok: false; reason: Exclude<StepUpResult, { ok: true }>['reason'] };
/** The signer `SignedIn.stepUp` holds. */
export type StepUpSigner = {
  sign(request: StepUpRequest): Promise<StepUpResult>;
  /** M6b: every request's act confirmed at once, then each signed; `malformed` before asking if any makes no action, or none is given. */
  signActions(requests: readonly StepUpRequest[]): Promise<StepUpManyResult>;
};

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

/** The action names signed without a prompt, and only on an owned machine (see `signsUnasked`). */
const OWNED_STARTS: ReadonlySet<string> = new Set(['session.spawn', 'session.fork']);

/**
 * Whether `action` is signed without asking the person (P5 O7 M10 B; U9 M2): a `session.spawn` or a `session.fork` on a
 * machine whose owners in the held head include the member this step-up key belongs to. The trust boundary sits here:
 * - `action` is the private canonical copy main built from typed fields, the very object that is sealed and signed, so
 *   the name and machine judged are the ones signed; nothing else a request carries (a flag, a claim in its args) is read.
 * - The member is the one the head lists this device under with this step-up key (as attest.ts's `proofSigner` finds the
 *   signer), never a member a caller names; the owners are the head's (`machineOwners` and `ownerMembers`, as the
 *   endpoint's `machineOwnerMembers` reads them: an org-owned machine's are the admins), read when the act is signed, so
 *   an owner removed by a newer head is asked again.
 * - Only the shape the app's spawn and fork have (`machine` acts, placed by their args): no session, launch context or
 *   request digest. Anything else, or any doubt (no view, another org, the device or key unlisted, the machine unplaced,
 *   an error) asks.
 */
async function signsUnasked(action: Action, held: HeldOrgView | undefined, pub: string, now: Date): Promise<boolean> {
  if (!OWNED_STARTS.has(action.action) || action.session !== undefined || action.context !== undefined || action.requestDigest !== undefined) return false;
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
/** An action as built for the person to be shown, and whether its request named its own `opCreated`. */
type Shown = { action: Action; ownOpCreated: boolean };

export function createStepUp(deps: { device: { org: string; device: string }; key: SigningKey; confirm?: Confirm; now?: () => Date; org?: HeldOrgView }): StepUpSigner {
  const now = deps.now ?? (() => new Date());
  const confirm = deps.confirm ?? promptTouchIDConfirmation(systemPreferences);

  /**
   * The action a request names, as a private copy in the canonical form the signature covers (an undefined field
   * absent), or null when its fields make no action. The fields come from the request by name, so nothing else it
   * carries reaches the action. Taken before anything is shown: the caller keeps references to its args, context and
   * digest, and to the device identity, and may change them while the person decides. What is shown is what is signed.
   * `ownOpCreated`: the request named its own `opCreated` (a reseal's), which the seal keeps, as taken here.
   */
  function build(request: StepUpRequest): Shown | null {
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
    return isAction(built) ? { action: JSON.parse(canonicalize(built)) as Action, ownOpCreated: opCreated !== undefined } : null;
  }

  async function ask(prompt: StepUpPrompt): Promise<Confirmation> {
    try {
      return await confirm(prompt);
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }

  /**
   * Stamped when the person confirmed, so time spent at the prompt doesn't make it stale (RL4's 60 s). Only the nonce
   * and times change, and they are not part of what is rendered. A request's own `opCreated` (a reseal's) is kept, as
   * `build` took it before the person was asked: nothing is read from the request after.
   */
  async function seal({ action, ownOpCreated }: Shown, sealedAt: string): Promise<Action | null> {
    const sealed: Action = { ...action, opCreated: ownOpCreated ? action.opCreated : sealedAt, nonce: random(NONCE_BYTES), created: sealedAt };
    return isAction(sealed) ? signStepUp(sealed, deps.key) : null;
  }

  return {
    async sign(request) {
      const shown = build(request);
      if (shown === null) return { ok: false, reason: 'malformed' };
      // Judged on `shown`, the copy that is sealed below, never on the request: what is exempted is what is signed.
      const answer: Confirmation = (await signsUnasked(shown.action, deps.org, deps.key.pub, now())) ? { ok: true } : await ask(renderAction(shown.action, heldView(deps.org)));
      if (!answer.ok) return answer;
      const signed = await seal(shown, now().toISOString());
      return signed === null ? { ok: false, reason: 'malformed' } : { ok: true, action: signed };
    },
    async signActions(requests) {
      const shown = requests.map(build);
      if (shown.length === 0 || shown.some((action) => action === null)) return { ok: false, reason: 'malformed' };
      const asked = shown as Shown[];
      const answer = await ask(renderActions(asked.map((one) => one.action), heldView(deps.org)));
      if (!answer.ok) return answer;
      const sealedAt = now().toISOString();
      const signed: Action[] = [];
      for (const one of asked) {
        const action = await seal(one, sealedAt);
        if (action === null) return { ok: false, reason: 'malformed' };
        signed.push(action);
      }
      return { ok: true, actions: signed };
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
      if (!(await confirmedLive(confirm, prompt, options.live))) return { ok: false, reason: 'cancelled' };
      // An endorsement covers the device without one (`endorseDevice` leaves it out), so one the caller left is replaced.
      for (const { member, device } of endorsing) device.endorsement = await endorseDevice(asked.org, member, device, deps.key.privateKey, deps.key.pub);
      return { ok: true, signed: await signOrgState(asked, [deps.key]) };
    },
  };
}

/**
 * Whether the person said yes to `prompt` (a confirmation that throws is a no) and, read once after the yes, what they
 * were asked about still stands (`live`: a pairing neither cancelled nor expired, a sign-in that hasn't ended).
 */
async function confirmedLive(confirm: Confirm, prompt: StepUpPrompt, live: (() => boolean) | undefined): Promise<boolean> {
  let answer: Confirmation;
  try {
    answer = await confirm(prompt);
  } catch {
    answer = { ok: false, reason: 'failed' };
  }
  return answer.ok && (live === undefined || live());
}

/** P5 O8 M4b: the domains a record signer signs: a grant. Never an org state's, an action's or a channel's. */
export const RECORD_DOMAINS = [SIGNING_DOMAINS.grant] as const;
export type RecordDomain = (typeof RECORD_DOMAINS)[number];
export type RecordSignOptions = { live?(): boolean };
export type RecordSigned<T> = { ok: true; signed: Signed<T> } | { ok: false; reason: 'cancelled' };

/** Signs records with the step-up key, each batch after the person confirmed the words the caller composed for it. */
export type RecordSigner = {
  /** keyId(stepUp.pub): the id a record's `sig.kid` names. */
  kid: string;
  /**
   * One confirmation, then `live`, then the signature over the canonical copy taken before the person was asked. Every
   * refusal is `cancelled`: nothing was signed. Throws, before asking, for a domain that is not a record's.
   */
  sign<T>(domain: RecordDomain, body: T, prompt: StepUpPrompt, options?: RecordSignOptions): Promise<RecordSigned<T>>;
  /** `sign` for several records under one confirmation, signed in the order given; throws, before asking, for none. */
  signMany<T>(domain: RecordDomain, bodies: readonly T[], prompt: StepUpPrompt, options?: RecordSignOptions): Promise<{ ok: true; signed: Signed<T>[] } | { ok: false; reason: 'cancelled' }>;
};

/** `confirm` defaults to `promptTouchIDConfirmation(systemPreferences)`, main's confirmation. Async only for the key id. */
export async function createRecordSigner(deps: { key: SigningKey; confirm?: Confirm }): Promise<RecordSigner> {
  const confirm = deps.confirm ?? promptTouchIDConfirmation(systemPreferences);
  async function signMany<T>(domain: RecordDomain, bodies: readonly T[], prompt: StepUpPrompt, options: RecordSignOptions = {}): Promise<{ ok: true; signed: Signed<T>[] } | { ok: false; reason: 'cancelled' }> {
    if (!(RECORD_DOMAINS as readonly string[]).includes(domain)) throw new Error(`${String(domain)} is not a record's domain: nothing was asked or signed`);
    if (bodies.length === 0) throw new Error('nothing to sign: nothing was asked');
    // Private copies in the canonical form the signature covers, taken before the person is asked: the caller keeps its
    // references and may change them while the person decides. What was asked about is what is signed.
    const asked = bodies.map((body) => JSON.parse(canonicalize(body)) as T);
    if (!(await confirmedLive(confirm, prompt, options.live))) return { ok: false, reason: 'cancelled' };
    const signed: Signed<T>[] = [];
    for (const body of asked) signed.push(await signRecord(domain, body, deps.key.privateKey, deps.key.pub));
    return { ok: true, signed };
  }
  return {
    kid: await keyId(deps.key.pub),
    async sign(domain, body, prompt, options) {
      const result = await signMany(domain, [body], prompt, options);
      return result.ok ? { ok: true, signed: result.signed[0] } : result;
    },
    signMany,
  };
}

/** The org view the words name machines from: the one held now, or none (signed out, or a view that can't be read). */
type NamingView = ReturnType<HeldOrgView>;
function heldView(held: HeldOrgView | undefined): NamingView {
  try {
    return held?.() ?? null;
  } catch {
    return null;
  }
}

/** Every machine the view names, by ref: the head's entries, then the certificates of machines the head doesn't list. */
function machineNames(view: NamingView): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  if (view === null) return names;
  try {
    for (const m of view.head().state.machines) names.set(m.ref, m.name);
    for (const c of view.certificates().certs) if (!names.has(c.body.machine)) names.set(c.body.machine, c.body.name);
  } catch {
    names.clear();
  }
  return names;
}

/**
 * How a machine is named (U9 S-13): `message` in the sheet's sentence (its name, its ref beside it when another machine
 * shares the name; the ref where none is known), `detail` on its `Machine:` line (`<name> (<ref>)`, or the ref). Escaped.
 */
function machineLabel(ref: string, names: ReadonlyMap<string, string>): { message: string; detail: string } {
  const name = names.get(ref);
  if (name === undefined) return { message: shown(ref), detail: shown(ref) };
  const both = `${shown(name)} (${shown(ref)})`;
  const shared = [...names].some(([other, otherName]) => other !== ref && otherName === name);
  return { message: shared ? both : shown(name), detail: both };
}

/** S-13's sentence for an action, up to the machine's name; null: `<action> on <machine>`. */
function sentenceOf(action: string): string | null {
  switch (action) {
    case 'session.spawn':
      return 'Start a session on';
    case 'sminos.spawn':
      return 'Start a terminal session on';
    case 'session.fork':
      return 'Fork a session on';
    case 'session.projects.addFolder':
      return 'Add a project folder on';
    case 'session.projects.link':
      return 'Link a project folder on';
    case 'session.projects.relocate':
      return 'Point a project at its folder on';
    case 'session.answer':
    case 'sminos.decide':
      return 'Approve a request on';
    case 'record.access':
    case 'record.shares':
    case 'record.owners':
      return 'Change who can reach a session on';
    case 'forward.open':
      return 'Forward a port from';
    case 'artifacts.grantConnectorTool':
    case 'artifacts.revokeConnectorTool':
      return 'Change connectors on';
  }
  if (action.startsWith('pty.')) return 'Use a terminal on';
  if (action.startsWith('connectors.')) return 'Change connectors on';
  return null;
}

/**
 * The text of an action as the person confirms it: every field it binds except what a reseal changes (its opId, nonce
 * and times), one per line, each value in JSON so a line break or a bidi or other invisible control inside a value is
 * escaped and can't forge another line. The summary is S-13's sentence naming the machine as `view` names it (none: by
 * its ref).
 */
export function renderAction(a: Action, view: NamingView = null): StepUpPrompt {
  return renderNamed(a, machineNames(view));
}

function renderNamed(a: Action, names: ReadonlyMap<string, string>): StepUpPrompt {
  const machine = machineLabel(a.machine, names);
  const lines = [`Action: ${shown(a.action)}`, `Machine: ${machine.detail}`, `Org: ${shown(a.org)}`, `Device: ${shown(a.device)}`];
  if (a.session !== undefined) lines.push(`Session: ${shown(a.session)}`);
  if (a.context?.lane === 'A') lines.push(`Launch: ${shown(a.context.launch)} (lane A session ${shown(a.context.session)})`);
  if (a.context?.lane === 'B') lines.push(`Launch: ${shown(a.context.launchId)} (engine session ${shown(a.context.engineSessionId)})`);
  if (a.requestDigest !== undefined) {
    const d = a.requestDigest;
    lines.push(`Request: ${shown(d.tool)} ${shown(d.request)} in session ${shown(d.session)}, input SHA-256 ${shown(d.input_sha256)}`);
  }
  // An undefined value is absent from the canonical form the signature covers, so it is not shown either.
  for (const name of Object.keys(a.args).filter((key) => a.args[key] !== undefined).sort()) lines.push(`${/^[A-Za-z0-9_.-]+$/.test(name) ? name : json(name)}: ${json(a.args[name])}`);
  return { summary: `${sentenceOf(a.action) ?? `${shown(a.action)} on`} ${machine.message}`, text: lines.join('\n') };
}

/**
 * M6b: the text of several acts confirmed at once: one act's own text, or each act's under its place ("1 of 3"), and a
 * summary naming the count and each machine once (U9 S-13: by its name, as `view` names it).
 */
export function renderActions(actions: readonly Action[], view: NamingView = null): StepUpPrompt {
  const names = machineNames(view);
  if (actions.length === 1) return renderNamed(actions[0], names);
  const machines = [...new Set(actions.map((a) => a.machine))].map((ref) => machineLabel(ref, names).message);
  const n = actions.length;
  return {
    summary: `${n} actions on ${machines.join(', ')}`,
    text: actions.map((a, i) => `${i + 1} of ${n}\n${renderNamed(a, names).text}`).join('\n\n'),
  };
}

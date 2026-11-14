// The machine's policy (O10 M2; RL §5.5): `policy.json {read_only, ceiling}`, the endpoint's own. Read-only refuses
// every remote request graded above `view` (M5) and sminos's local delivery of words written off the machine reads it
// too, so each change goes down RL10 at once (M6, through `onChange`). The ceiling bounds a remote spawn's permission
// mode; `settings` is the machine's own `defaultMode`. With no file the endpoint takes sminos's current policy from RL10's
// `hello` (M6, `fromSminos`), else read-only off and the ceiling `settings`. `mawsd endpoint policy` prints and sets it as
// `sminos daemon policy` does.
//
// Applied (M5) to a spawn's args: no field outside DX6's spawn fields (no flags, environment or shell, `spec-field`), a
// permission mode no looser than the ceiling by the order `plan` < `default` < `acceptEdits` < `auto` < `dontAsk` <
// `bypassPermissions` (none asked is the ceiling, as sminos takes it; `ceiling`), and a checkout the machine knows
// (`unknown-checkout`). P5 O7 M9: `session.spawn`'s `trust: 'accepted'` is one of its fields for a current machine owner
// alone, `spec-field` for anyone else. 2026-11-06 (the New chat's machine first): so is its `checkout: '~'`
// (HOME_CHECKOUT), the machine's home with no project; for anyone else, and for `sminos.spawn`, `unknown-checkout`.
//
// P5 O7 M9 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Remote setup"): the setup policy, apart from the
// spawn guard. A setup act or read naming a directory (`session.projects.addFolder`, and `session.trust.check`, whose trust
// read looks inside the folder as the registration does; the project registry's `relocate` and `resolve`) is held to `setupRefusal`: the directory exists, its real path is
// under the machine's home with no link out of it on the way, and it is not in a protected folder that wasn't opened
// (src/shared/machine/home-folders.ts; nothing past such a folder is touched to find out), nor is any pointer git or the
// trust read follows from it (a linked worktree's git dir, the common dir, the trust files: setup-reads.ts). The check
// answers the real path it resolved, which the row's executor runs on (authorize.ts' `Decision.setup`). A protected
// folder is opened by an owner's `machine.folders.list` with `open: true` that the machine answered
// (`MachineSetup.listed`), for that member, so the folder they browsed into is one they may register; kept for the
// endpoint's life, the latest FOLDERS_OPENED_MAX each. The directory is named as the folder list names one: absolute, or
// `~` and `~/…` under the home (2026-11-06: the trust card of a chat in the home, whose spawn names `~`).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { expandHome, readableInside, resolveInHome, walk, within, type Home, type HomeRefusal } from '@shared/machine/home-folders';
import { HOME_CHECKOUT } from '@shared/ipc/schema/session';
import { setupReadsRefusal } from '@shared/machine/setup-reads';
import { DEFAULT_POLICY, type Policy, type PolicySource } from './answers';
import type { CheckoutSource } from './sources';
import { PERMISSION_MODES, type Ceiling, type EndpointState } from './state/store';

export type { Policy, PolicySource };

export const isCeiling = (value: string): value is Ceiling => value === 'settings' || (PERMISSION_MODES as readonly string[]).includes(value);

export class EndpointPolicy {
  #fromSminos: Policy | null = null;
  readonly #listeners = new Set<(policy: Policy) => void>();

  constructor(private readonly state: () => EndpointState | null) {}

  current(): Policy & { source: PolicySource } {
    const stored = this.state()?.policy ?? null;
    if (stored !== null) return { ...stored, source: 'set' };
    if (this.#fromSminos !== null) return { ...this.#fromSminos, source: 'sminos' };
    return { ...DEFAULT_POLICY, source: 'default' };
  }

  /** Writes the change over the current policy and tells every listener. */
  set(change: Partial<Policy>): Policy {
    const state = this.state();
    if (state === null) throw new Error('the endpoint has not started');
    const current = this.current();
    const next: Policy = { read_only: change.read_only ?? current.read_only, ceiling: change.ceiling ?? current.ceiling };
    state.setPolicy(next);
    for (const listener of this.#listeners) listener(next);
    return next;
  }

  /** sminos's policy from RL10's `hello` (M6): consulted only while no policy.json exists. */
  fromSminos(policy: Policy): void {
    this.#fromSminos = policy;
  }

  onChange(listener: (policy: Policy) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** DX6's spawn fields: all a remote spawn's args may carry (Interfaces §G). */
export const SPAWN_FIELDS: ReadonlySet<string> = new Set(['checkout', 'worktree', 'brief', 'model', 'effort', 'permission_mode']);

/**
 * Why the policy refuses a spawn with these args, or null. `settingsMode` is the machine's `defaultMode`, which `settings`
 * reads. `ownerSpawn`: the spawn is `session.spawn` asked by a current machine owner, whose `trust` (P5 O7 M9; the
 * registry's schema holds it to `'accepted'`) is then one of its fields, and whose `checkout` may be the home
 * (HOME_CHECKOUT, 2026-11-06: a chat in no project there); for anyone else, and for `sminos.spawn`, the home is no
 * checkout the machine knows.
 */
export function spawnRefusal(args: Readonly<Record<string, unknown>>, policy: Policy, settingsMode: () => string, checkouts: CheckoutSource, ownerSpawn = false): 'spec-field' | 'ceiling' | 'unknown-checkout' | null {
  if (Object.keys(args).some((field) => !SPAWN_FIELDS.has(field) && !(ownerSpawn && field === 'trust'))) return 'spec-field';
  if (aboveCeiling(args.permission_mode, policy, settingsMode)) return 'ceiling';
  if (ownerSpawn && args.checkout === HOME_CHECKOUT) return null;
  if (typeof args.checkout !== 'string' || !checkouts.known(args.checkout)) return 'unknown-checkout';
  return null;
}

/**
 * Whether a session started from another machine in `mode` is looser than the ceiling (`settings`: the machine's
 * `defaultMode`), by the order above; a mode not asked (undefined) is the ceiling's own. The spawn guard's rule, and
 * (the UX wave, U9 M2) the one the services hold a fork from another machine to where they allocate it
 * (`Endpoint.aboveCeiling`).
 */
export function aboveCeiling(mode: unknown, policy: Policy, settingsMode: () => string): boolean {
  const modes: readonly string[] = PERMISSION_MODES;
  const ceiling = policy.ceiling === 'settings' ? settingsMode() : policy.ceiling;
  const asked = mode ?? ceiling;
  return !modes.includes(ceiling) || typeof asked !== 'string' || !modes.includes(asked) || modes.indexOf(asked) > modes.indexOf(ceiling);
}

/** The setup rows that name a directory, held to `setupRefusal`. */
export const SETUP_DIRECTORY_COMMANDS: ReadonlySet<string> = new Set(['session.projects.addFolder', 'session.trust.check', 'session.projects.relocate', 'session.projects.resolve']);
export type SetupRefusal = HomeRefusal;
/** A setup row's checked directory (its real path, as the kernel resolves it and its folders list its names), which its executor acts on. */
export type SetupCheck = { ok: true; directory: string } | { ok: false; reason: SetupRefusal };
/** The protected folders kept as opened for one member: the latest this many. */
export const FOLDERS_OPENED_MAX = 32;

/**
 * The setup policy on a setup row's directory, read by `opened`: an absolute path, or `~` and `~/…` (anything else
 * `no-folder`), to a directory under the home, and every pointer the registration (`trustFiles` false) or the trust read follows from it
 * (src/shared/machine/setup-reads.ts), each touching no unopened protected folder; answered with the real path the
 * executor then runs on, never the input's spelling.
 */
export async function setupRefusal(input: unknown, where: Home, opened: (folder: string) => boolean, options: { trustFiles: boolean }): Promise<SetupCheck> {
  const named = typeof input === 'object' && input !== null ? (input as { directory?: unknown }).directory : undefined;
  const directory = typeof named === 'string' ? expandHome(named, where.home) : null;
  if (directory === null || !isAbsolute(directory)) return { ok: false, reason: 'no-folder' };
  const resolved = await resolveInHome(directory, where, opened);
  if (!resolved.ok) return resolved;
  const reads = await setupReadsRefusal(resolved.real, where, opened, options);
  return reads === null ? { ok: true, directory: resolved.real } : { ok: false, reason: reads };
}

/** The machine's setup policy as the endpoint holds it: its home, and the protected folders each member opened. */
export class MachineSetup {
  readonly #opened = new Map<string, string[]>();

  constructor(private readonly where: () => Home = () => ({ home: homedir(), platform: process.platform })) {}

  /** Whether `member` opened `folder`: it is, or holds, a folder they listed with `open: true` (both real paths). */
  opened(member: string, folder: string): boolean {
    return (this.#opened.get(member) ?? []).some((listed) => within(listed, folder));
  }

  /**
   * An answered `machine.folders.list`: with `open: true`, the real path it listed (resolved again as the list resolved
   * it, reading nothing it didn't), when that is in or at a protected folder, is kept as opened.
   */
  async listed(member: string, input: unknown): Promise<void> {
    if (typeof input !== 'object' || input === null || (input as { open?: unknown }).open !== true) return;
    const where = this.where();
    const path = (input as { path?: unknown }).path;
    const named = typeof path === 'string' ? expandHome(path, where.home) : null;
    if (named === null) return;
    const resolved = await walk(named, where, { opened: () => false, open: true });
    if (!resolved.ok || readableInside(resolved.real, where, () => false)) return; // in no protected folder: nothing to open
    const kept = (this.#opened.get(member) ?? []).filter((listed) => listed !== resolved.real);
    kept.push(resolved.real);
    this.#opened.set(member, kept.slice(-FOLDERS_OPENED_MAX));
  }

  /** The protected folders `member` opened (real paths), sent with their setup's machine calls (P5 O7 M9's review). */
  openedBy(member: string): string[] {
    return [...(this.#opened.get(member) ?? [])];
  }

  /** `setupRefusal` of setup row `name`'s input, asked by `member`. */
  check(member: string, name: string, input: unknown): Promise<SetupCheck> {
    return setupRefusal(input, this.where(), (folder) => this.opened(member, folder), { trustFiles: name === 'session.trust.check' });
  }
}

/**
 * The default mode the user's own settings give, as sminos reads it (`sminos_policy.settings_mode`): their
 * `permissions.defaultMode` in `<home>/.claude/settings.json`, else the engine's `default` (missing or malformed settings
 * included).
 */
export function settingsDefaultMode(home: string): string {
  try {
    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')) as { permissions?: { defaultMode?: unknown } } | null;
    const mode = settings?.permissions?.defaultMode;
    return typeof mode === 'string' && mode !== '' ? mode : 'default';
  } catch {
    return 'default';
  }
}

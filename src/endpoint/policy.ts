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
// alone, `spec-field` for anyone else.
//
// P5 O7 M9 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Remote setup"): the setup policy, apart from the
// spawn guard. A setup act or read naming a directory (`session.projects.addFolder`, and `session.trust.check`, whose trust
// read looks inside the folder as the registration does) is held to `setupRefusal`: the directory exists, its real path is
// under the machine's home with no link out of it on the way, and it is not in a protected folder that wasn't opened
// (src/shared/machine/home-folders.ts; nothing past such a folder is touched to find out). A protected folder is opened by
// an owner's `machine.folders.list` with `open: true` that the machine answered (`MachineSetup.listed`), for that member, so
// the folder they browsed into is one they may register; kept for the endpoint's life, the latest FOLDERS_OPENED_MAX each.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { expandHome, readableInside, resolveInHome, within, type Home, type HomeRefusal } from '@shared/machine/home-folders';
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
 * reads. `acceptsTrust` (P5 O7 M9): the spawn is `session.spawn` asked by a current machine owner, whose `trust` (the
 * registry's schema holds it to `'accepted'`) is then one of its fields.
 */
export function spawnRefusal(args: Readonly<Record<string, unknown>>, policy: Policy, settingsMode: () => string, checkouts: CheckoutSource, acceptsTrust = false): 'spec-field' | 'ceiling' | 'unknown-checkout' | null {
  if (Object.keys(args).some((field) => !SPAWN_FIELDS.has(field) && !(acceptsTrust && field === 'trust'))) return 'spec-field';
  const modes: readonly string[] = PERMISSION_MODES;
  const ceiling = policy.ceiling === 'settings' ? settingsMode() : policy.ceiling;
  const mode = args.permission_mode ?? ceiling;
  if (!modes.includes(ceiling) || typeof mode !== 'string' || !modes.includes(mode) || modes.indexOf(mode) > modes.indexOf(ceiling)) return 'ceiling';
  if (typeof args.checkout !== 'string' || !checkouts.known(args.checkout)) return 'unknown-checkout';
  return null;
}

/** The setup rows that name a directory, held to `setupRefusal`. */
export const SETUP_DIRECTORY_COMMANDS: ReadonlySet<string> = new Set(['session.projects.addFolder', 'session.trust.check']);
export type SetupRefusal = HomeRefusal;
/** The protected folders kept as opened for one member: the latest this many. */
export const FOLDERS_OPENED_MAX = 32;

/** Why the setup policy refuses a setup row's directory, or null: an absolute path (anything else `no-folder`), read by `opened`. */
export async function setupRefusal(input: unknown, where: Home, opened: (folder: string) => boolean): Promise<SetupRefusal | null> {
  const directory = typeof input === 'object' && input !== null ? (input as { directory?: unknown }).directory : undefined;
  if (typeof directory !== 'string' || !isAbsolute(directory)) return 'no-folder';
  const resolved = await resolveInHome(directory, where, opened);
  return resolved.ok ? null : resolved.reason;
}

/** The machine's setup policy as the endpoint holds it: its home, and the protected folders each member opened. */
export class MachineSetup {
  readonly #opened = new Map<string, string[]>();

  constructor(private readonly where: () => Home = () => ({ home: homedir(), platform: process.platform })) {}

  /** Whether `member` opened `folder`: it is, or holds, a folder they listed with `open: true`. */
  opened(member: string, folder: string): boolean {
    return (this.#opened.get(member) ?? []).some((listed) => within(listed, folder));
  }

  /** An answered `machine.folders.list`: with `open: true` on a path in or at a protected folder, that path is kept as opened. */
  listed(member: string, input: unknown): void {
    if (typeof input !== 'object' || input === null || (input as { open?: unknown }).open !== true) return;
    const where = this.where();
    const path = (input as { path?: unknown }).path;
    const named = typeof path === 'string' ? expandHome(path, where.home) : null;
    if (named === null || !within(named, where.home) || readableInside(named, where, () => false)) return; // in no protected folder: nothing to open
    const kept = (this.#opened.get(member) ?? []).filter((listed) => listed !== named);
    kept.push(named);
    this.#opened.set(member, kept.slice(-FOLDERS_OPENED_MAX));
  }

  /** `setupRefusal` of a setup row's input, asked by `member`. */
  refusal(member: string, input: unknown): Promise<SetupRefusal | null> {
    return setupRefusal(input, this.where(), (folder) => this.opened(member, folder));
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

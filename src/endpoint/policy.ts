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
// (`unknown-checkout`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckoutSource } from './sources';
import { PERMISSION_MODES, type Ceiling, type EndpointState, type PolicyFile } from './state/store';

export type Policy = PolicyFile;
export type PolicySource = 'set' | 'sminos' | 'default';

export const DEFAULT_POLICY: Policy = { read_only: false, ceiling: 'settings' };

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

/** The policy as `sminos daemon policy` shows it. */
export function describePolicy(policy: Policy & { source: PolicySource }): string {
  const readOnly = policy.read_only ? 'yes — no remote request above view is served, and nothing written outside this machine is delivered as words' : 'no';
  const ceiling = policy.ceiling === 'settings' ? "settings (from your settings' defaultMode)" : `${policy.ceiling} (set here)`;
  const source = policy.source === 'set' ? '' : policy.source === 'sminos' ? '\n(taken from sminos: no endpoint policy is set)' : '\n(the default: no policy is set)';
  return `read-only: ${readOnly}\nceiling: ${ceiling}${source}`;
}

/** DX6's spawn fields: all a remote spawn's args may carry (Interfaces §G). */
export const SPAWN_FIELDS: ReadonlySet<string> = new Set(['checkout', 'worktree', 'brief', 'model', 'effort', 'permission_mode']);

/** Why the policy refuses a spawn with these args, or null. `settingsMode` is the machine's `defaultMode`, which `settings` reads. */
export function spawnRefusal(args: Readonly<Record<string, unknown>>, policy: Policy, settingsMode: () => string, checkouts: CheckoutSource): 'spec-field' | 'ceiling' | 'unknown-checkout' | null {
  if (Object.keys(args).some((field) => !SPAWN_FIELDS.has(field))) return 'spec-field';
  const modes: readonly string[] = PERMISSION_MODES;
  const ceiling = policy.ceiling === 'settings' ? settingsMode() : policy.ceiling;
  const mode = args.permission_mode ?? ceiling;
  if (!modes.includes(ceiling) || typeof mode !== 'string' || !modes.includes(mode) || modes.indexOf(mode) > modes.indexOf(ceiling)) return 'ceiling';
  if (typeof args.checkout !== 'string' || !checkouts.known(args.checkout)) return 'unknown-checkout';
  return null;
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

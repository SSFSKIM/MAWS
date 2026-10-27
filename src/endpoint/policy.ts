// The machine's policy (O10 M2; RL §5.5): `policy.json {read_only, ceiling}`, the endpoint's own. Read-only refuses
// every remote request graded above `view` (M5) and sminos's local delivery of words written off the machine reads it
// too, so each change goes down RL10 at once (M6, through `onChange`). The ceiling bounds a remote spawn's permission
// mode; `settings` is the machine's own `defaultMode`. With no file the endpoint takes sminos's current policy from RL10's
// `hello` (M6, `fromSminos`), else read-only off and the ceiling `settings`. `mawsd endpoint policy` prints and sets it as
// `sminos daemon policy` does.
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

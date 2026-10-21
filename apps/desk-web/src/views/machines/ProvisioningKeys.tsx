// Provisioning keys in the Machines dialog (the provisioning-keys spec, §5): reusable, revocable keys that enroll
// machines nobody attends — VMs that enroll themselves at boot — under a name prefix. Every member sees them; an admin
// creates one (the form here, then the dialog's confirmation with one of the org key's methods and its code step, the
// code shown once with the line each machine runs at boot) and revokes one, on a step that says what revoking does: no
// new machine enrolls through it, and the machines it enrolled stay until each is removed.
import { useId, useState, type FormEvent } from 'react';
import { formatDate } from '@shared/app/date-format';
import { MAX_PROVISIONING_KEY_USES, PROVISIONING_KEY_TTL_S, type ProvisioningKeyRecord, type ProvisioningKeyRequest } from 'desk-hub/protocol';
import { BOOT_COMMAND, createProvisioningKey, prefixProblem, provisioningCode, revokeProvisioningKey } from '../../enroll/enrollment';
import { HubRequestError } from '../../hub/http';
import type { Me } from '../../hub/me';
import { useKeyHolder } from '../../key/holder';
import { buttonDanger, buttonPrimary, buttonQuiet, textInput } from '../common/Dialog';
import { useDayClock } from '../conversation/StreamView';
import { explainKeyFailure } from '../key/explain';
import type { Confirming } from './CodeSteps';

export const PROVISIONING_KEYS_QUERY = ['provisioning-keys'] as const;

const DAY_S = 86_400;
/** How long a key enrolls machines: fixed choices, since free seconds invite mistakes in a credential's lifetime. */
const LIFETIMES: ReadonlyArray<{ seconds: number; words: string }> = [
  { seconds: 7 * DAY_S, words: '7 days' },
  { seconds: 30 * DAY_S, words: '30 days' },
  { seconds: PROVISIONING_KEY_TTL_S, words: '90 days' },
  { seconds: 365 * DAY_S, words: '365 days' },
];
/** How long a machine enrolled through the key may stay offline before the hub removes it; null for never. */
const OFFLINE_TIMES: ReadonlyArray<{ seconds: number | null; words: string }> = [
  { seconds: null, words: 'never' },
  { seconds: 6 * 3600, words: '6 hours' },
  { seconds: 12 * 3600, words: '12 hours' },
  { seconds: 24 * 3600, words: '24 hours' },
  { seconds: 7 * DAY_S, words: '7 days' },
];

const day = (iso: string) => formatDate(Date.parse(iso));
const lifetimeWords = (seconds: number) => LIFETIMES.find((l) => l.seconds === seconds)?.words ?? `${Math.round(seconds / DAY_S)} days`;
const offlineWords = (seconds: number) => OFFLINE_TIMES.find((o) => o.seconds === seconds)?.words ?? `${Math.round(seconds / 3600)} hours`;

/** The keys, active ones first, each in the hub's order (by creation). */
function inOrder(keys: ProvisioningKeyRecord[]): ProvisioningKeyRecord[] {
  return [...keys.filter((k) => k.revoked === null), ...keys.filter((k) => k.revoked !== null)];
}

export function KeySection(props: {
  me: Me;
  keys: ProvisioningKeyRecord[] | undefined;
  error: Error | null;
  onCreate: () => void;
  onRevoke: (key: ProvisioningKeyRecord) => void;
}) {
  const { me, keys, error, onCreate, onRevoke } = props;
  const keyState = useKeyHolder((s) => s.state);
  const admin = me.member.role === 'admin';
  // Whether a key has expired, read against the time the section was drawn, as the stream's day labels are.
  const now = useDayClock();
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3" data-testid="provisioning-keys" aria-label="Provisioning keys">
      <h3 className="m-0 text-ui font-semibold">Provisioning keys</h3>
      <p className="m-0 text-ui-sm leading-5 text-fg-muted">A key enrolls machines nobody attends — VMs that enroll themselves at boot — each named under its prefix, until it expires or is revoked.</p>
      {error ? (
        <p className="m-0 text-ui-sm text-danger" role="alert">
          The hub did not list the provisioning keys: {error.message}
        </p>
      ) : keys === undefined ? null : keys.length === 0 ? (
        <p className="m-0 text-ui-sm text-fg-muted">No key yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0" data-testid="keys">
          {inOrder(keys).map((key) => (
            <KeyRow key={key.id} provisioningKey={key} admin={admin} now={now} onRevoke={() => onRevoke(key)} />
          ))}
        </ul>
      )}
      {admin ? (
        <div className="flex items-center gap-3">
          <button type="button" className={buttonPrimary} disabled={keyState !== 'unlocked'} onClick={onCreate}>
            Create a key
          </button>
          {keyState !== 'unlocked' && <span className="text-ui-sm text-fg-muted">Unlock the org key first: the code carries it.</span>}
        </div>
      ) : (
        <p className="m-0 text-ui-sm text-fg-muted">An admin of the org creates and revokes keys.</p>
      )}
    </section>
  );
}

function KeyRow(props: { provisioningKey: ProvisioningKeyRecord; admin: boolean; now: number; onRevoke: () => void }) {
  const { provisioningKey: key, admin, now, onRevoke } = props;
  const when = key.revoked !== null ? `revoked ${day(key.revoked)}` : Date.parse(key.expires) <= now ? `expired ${day(key.expires)}` : `expires ${day(key.expires)}`;
  return (
    <li className="flex flex-col gap-0.5 border-b border-border py-1.5 text-ui last:border-b-0" data-key={key.id} data-key-label={key.label}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={key.revoked === null ? '' : 'text-fg-muted'}>
          <span className="font-medium">{key.label}</span> · <span className="font-mono">{key.prefix}</span> ·{' '}
          <span title="Machines enrolled through it, ever, over its cap">
            {key.uses} / {key.max_uses ?? '∞'}
          </span>
        </span>
        <span className="text-ui-sm text-fg-muted">{when}</span>
        {admin && key.revoked === null && (
          <button type="button" className={`${buttonQuiet} ml-auto`} onClick={onRevoke} aria-label={`Revoke ${key.label}`}>
            Revoke
          </button>
        )}
      </div>
      {key.machines.length > 0 && (
        <p className="m-0 text-ui-sm text-fg-muted">
          Enrolled through it:{' '}
          {key.machines.map((m, i) => (
            <span key={m.name}>
              {i > 0 && ', '}
              <span data-testid={`key-machine-${m.name}`}>
                {m.name}
                {m.state === 'pending' && <span className="text-warning"> enrolling…</span>}
              </span>
            </span>
          ))}
        </p>
      )}
    </li>
  );
}

/** The key's request, checked in the browser as the name step checks a name; the hub checks it again. */
export function KeyFormStep(props: { onCancel: () => void; onRequest: (request: ProvisioningKeyRequest) => void }) {
  const { onCancel, onRequest } = props;
  const [label, setLabel] = useState('');
  const [prefix, setPrefix] = useState('');
  const [lifetime, setLifetime] = useState(String(PROVISIONING_KEY_TTL_S));
  const [maxUses, setMaxUses] = useState('');
  const [offline, setOffline] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const edit = (set: (value: string) => void) => (event: { target: { value: string } }) => (set(event.target.value), setProblem(null));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const named = label.trim();
    if (named === '') return setProblem('Name the key: the list shows it by this label.');
    if (named.length > 100) return setProblem('A label is at most 100 characters.');
    const start = prefix.trim();
    const found = prefixProblem(start);
    if (found) return setProblem(found);
    const cap = maxUses.trim();
    if (cap !== '' && !(/^\d+$/.test(cap) && Number(cap) >= 1 && Number(cap) <= MAX_PROVISIONING_KEY_USES)) {
      return setProblem(`Max uses is a whole number from 1 to ${MAX_PROVISIONING_KEY_USES}, or empty for no cap.`);
    }
    onRequest({ label: named, prefix: start, ttl_s: Number(lifetime), max_uses: cap === '' ? null : Number(cap), offline_revoke_s: offline === '' ? null : Number(offline) });
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={submit} aria-label="Provisioning key" data-testid="key-form">
      <p className="m-0 text-ui-sm leading-5 text-fg-muted">
        A provisioning key lets machines enroll themselves at boot, with no one at the machine: each runs <code className="font-mono">sminos hub enroll</code> with the key's code under
        a name that starts with its prefix.
      </p>
      <div className="flex flex-col gap-1">
        <label className="text-ui-sm text-fg-muted" htmlFor={`${id}-label`}>
          Label
        </label>
        <input id={`${id}-label`} className={textInput} value={label} onChange={edit(setLabel)} autoFocus spellCheck={false} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-ui-sm text-fg-muted" htmlFor={`${id}-prefix`}>
          Prefix
        </label>
        <input id={`${id}-prefix`} className={`${textInput} font-mono`} value={prefix} onChange={edit(setPrefix)} placeholder="dc-" spellCheck={false} aria-describedby={`${id}-prefix-help`} />
        <span id={`${id}-prefix-help`} className="text-ui-sm text-fg-muted">
          Every machine enrolled through the key is named with this at the start, e.g. dc- for dc-build-7f3a.
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-ui-sm text-fg-muted" htmlFor={`${id}-lifetime`}>
            Expires in
          </label>
          <select id={`${id}-lifetime`} className={textInput} value={lifetime} onChange={edit(setLifetime)}>
            {LIFETIMES.map((l) => (
              <option key={l.seconds} value={String(l.seconds)}>
                {l.words}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-ui-sm text-fg-muted" htmlFor={`${id}-uses`}>
            Max uses (empty: no cap)
          </label>
          <input id={`${id}-uses`} className={textInput} value={maxUses} onChange={edit(setMaxUses)} inputMode="numeric" spellCheck={false} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-ui-sm text-fg-muted" htmlFor={`${id}-offline`}>
            Revoke a machine offline for
          </label>
          <select id={`${id}-offline`} className={textInput} value={offline} onChange={edit(setOffline)}>
            {OFFLINE_TIMES.map((o) => (
              <option key={o.words} value={o.seconds === null ? '' : String(o.seconds)}>
                {o.words}
              </option>
            ))}
          </select>
        </div>
      </div>
      {problem && (
        <p className="m-0 text-ui-sm text-danger" role="alert">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={buttonPrimary}>
          Continue
        </button>
        <button type="button" className={buttonQuiet} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The confirmation of a key's creation: what its code will do, then the key asked for and its code built. */
export function keyConfirming(me: Me, request: ProvisioningKeyRequest): Confirming {
  const ttl = request.ttl_s ?? PROVISIONING_KEY_TTL_S;
  const cap = request.max_uses ?? null;
  const offline = request.offline_revoke_s ?? null;
  return {
    question: (
      <>
        Create the provisioning key <strong data-testid="confirm-key">{request.label}</strong>?
      </>
    ),
    meaning: (
      <>
        The code you get next enrolls {cap === null ? 'any number of machines' : cap === 1 ? 'one machine' : `up to ${cap} machines`} named {request.prefix}…, for {lifetimeWords(ttl)}
        {offline === null ? '' : `, each removed once it has been offline for ${offlineWords(offline)}`}. It carries your org key: keep it only in the secret store your machines
        read at boot.
      </>
    ),
    issue: async (key) => {
      const { key: made, token } = await createProvisioningKey(request);
      const code = provisioningCode({ hub: location.origin, org: me.org.id, token, prefix: made.prefix, key });
      return {
        code,
        instructions: (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-ui">
              Put this code in the secret store your machines read at boot. Each enrolls itself under a name that starts with <span className="font-mono">{made.prefix}</span>, until{' '}
              {day(made.expires)}, by running:
            </p>
            <pre className="m-0 overflow-auto rounded-md border border-border bg-bg p-2.5 font-mono text-code whitespace-pre-wrap" data-testid="boot-command">
              {BOOT_COMMAND(made.prefix)}
            </pre>
          </div>
        ),
        keep: 'It holds your org key: keep it in the secret store your machines read, and nowhere else.',
      };
    },
    explain: (failure) => {
      if (failure instanceof HubRequestError && failure.code === 'not-admin') return 'Only an admin of the org creates provisioning keys.';
      if (failure instanceof HubRequestError) return `The hub refused the key (${failure.code}${failure.message !== failure.code ? `: ${failure.message}` : ''}).`;
      return explainKeyFailure(failure, 'enroll');
    },
  };
}

/** Revoking a key, once the owner confirms what it means. A key the hub no longer holds is gone either way: the list
 * says so rather than raising an error. */
export function RevokeKeyStep(props: { provisioningKey: ProvisioningKeyRecord; onCancel: () => void; onRevoked: (notice: string) => void }) {
  const { provisioningKey: key, onCancel, onRevoked } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = key.machines.map((m) => m.name).join(', ');
  const n = key.machines.length;

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await revokeProvisioningKey(key.id);
      onRevoked(`Revoked ${key.label}: no new machine enrolls through it.`);
    } catch (failure) {
      if (failure instanceof HubRequestError && failure.code === 'unknown-key') return onRevoked(`The hub does not hold ${key.label}.`);
      setError(explainKeyRevocation(failure));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="revoke-key-confirm">
      <p className="m-0 text-ui">
        Revoke <strong>{key.label}</strong> (<span className="font-mono">{key.prefix}</span>…)?
      </p>
      <p className="m-0 text-ui-sm leading-5" data-testid="revoke-key-meaning">
        No new machine enrolls through it from now on: its code stops working, wherever it is kept.{' '}
        {n === 0
          ? 'No machine is enrolled through it now.'
          : `${n === 1 ? 'The machine enrolled through it stays' : `The ${n} machines enrolled through it stay`} enrolled (${names}); remove ${n === 1 ? 'it' : 'them one by one'} from the machine list above.`}
      </p>
      <p className="m-0 text-ui-sm leading-5 text-fg-muted">To rotate it, create the next key first and move its code into the secret store, then revoke this one.</p>
      <div className="flex items-center gap-2">
        <button type="button" className={buttonDanger} disabled={busy} onClick={() => void revoke()}>
          {busy ? 'Revoking…' : `Revoke ${key.label}`}
        </button>
        <button type="button" className={buttonQuiet} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="m-0 text-ui-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function explainKeyRevocation(failure: unknown): string {
  if (failure instanceof HubRequestError && failure.code === 'not-admin') return 'Only an admin of the org revokes provisioning keys.';
  if (failure instanceof HubRequestError) return `The hub refused the revocation (${failure.code}${failure.message !== failure.code ? `: ${failure.message}` : ''}).`;
  return `The hub did not answer: ${failure instanceof Error ? failure.message : String(failure)}.`;
}

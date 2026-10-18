// The org's machines, enrolling one, and removing one (§6, DX7; the DC5 plan's M2). The owner names the machine and
// confirms it with one of the org key's methods; the browser opens the key's copy once more as bytes (the held key
// cannot be read), checks they are the held key, asks the hub for a one-time token, builds the code, and wipes the
// bytes; the code is shown once. Closing the dialog discards it: nothing keeps it. Removing a machine is an admin's,
// confirmed on a step that says what it does (DX7's revocation: disconnected at once, its credential deleted, enrolled
// again to be used again); it takes no key.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { MachineRecord } from 'desk-hub/protocol';
import { createEnrollment, ENROLL_COMMAND, enrollmentCode, listMachines, machineNameProblem, removeMachine } from '../../enroll/enrollment';
import { HubRequestError } from '../../hub/http';
import type { Me } from '../../hub/me';
import { useKeyHolder } from '../../key/holder';
import { openOrgKeyBytes, rememberedMethod, type OrgMethod } from '../../key/unlock';
import { listWrappedKeys, WRAPPED_KEYS_QUERY } from '../../key/wrapped-keys';
import { buttonDanger, buttonPrimary, buttonQuiet, buttonSecondary, Dialog, textInput } from '../common/Dialog';
import { explainKeyFailure } from '../key/explain';
import { OrgMethodForm } from '../key/OrgMethodForm';

type Step =
  | { kind: 'list'; notice?: string }
  | { kind: 'name' }
  | { kind: 'confirm'; machine: string }
  | { kind: 'code'; machine: string; code: string; expires: string }
  | { kind: 'remove'; machine: MachineRecord };

export function MachinesDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const machines = useQuery({ queryKey: ['machines'], queryFn: listMachines });
  const queries = useQueryClient();
  const back = () => {
    setStep({ kind: 'list' });
    void queries.invalidateQueries({ queryKey: ['machines'] });
  };
  // Gone at the hub: off the list at once, then the list as the hub has it now.
  const removed = (name: string, notice: string) => {
    queries.setQueryData<MachineRecord[]>(['machines'], (list) => list?.filter((m) => m.name !== name));
    setStep({ kind: 'list', notice });
    void queries.invalidateQueries({ queryKey: ['machines'] });
  };
  return (
    <Dialog title="Machines" onClose={onClose}>
      {step.kind === 'list' && (
        <MachineList
          me={me}
          machines={machines.data}
          error={machines.error}
          notice={step.notice}
          onEnroll={() => setStep({ kind: 'name' })}
          onRemove={(machine) => setStep({ kind: 'remove', machine })}
        />
      )}
      {step.kind === 'name' && <NameStep machines={machines.data ?? []} onCancel={back} onName={(machine) => setStep({ kind: 'confirm', machine })} />}
      {step.kind === 'confirm' && <ConfirmStep me={me} machine={step.machine} onCancel={back} onCode={(code, expires) => setStep({ kind: 'code', machine: step.machine, code, expires })} />}
      {step.kind === 'code' && <CodeStep machine={step.machine} code={step.code} expires={step.expires} onDone={back} />}
      {step.kind === 'remove' && <RemoveStep machine={step.machine} onCancel={back} onRemoved={(notice) => removed(step.machine.name, notice)} />}
    </Dialog>
  );
}

function MachineList(props: {
  me: Me;
  machines: MachineRecord[] | undefined;
  error: Error | null;
  notice: string | undefined;
  onEnroll: () => void;
  onRemove: (machine: MachineRecord) => void;
}) {
  const { me, machines, error, notice, onEnroll, onRemove } = props;
  const keyState = useKeyHolder((s) => s.state);
  const admin = me.member.role === 'admin';
  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <p className="m-0 text-ui-sm text-fg-muted" role="status" data-testid="machines-notice">
          {notice}
        </p>
      )}
      {error ? (
        <p className="m-0 text-ui-sm text-danger" role="alert">
          The hub did not list the machines: {error.message}
        </p>
      ) : machines === undefined ? null : machines.length === 0 ? (
        <p className="m-0 text-ui-sm text-fg-muted">No machine is enrolled yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0" data-testid="machines">
          {machines.map((m) => (
            <li key={m.name} className="flex flex-wrap items-baseline gap-2 border-b border-border py-1.5 text-ui last:border-b-0" data-machine={m.name}>
              <span className="font-medium">{m.name}</span>
              <span className={m.state === 'active' ? 'text-ui-sm text-success' : 'text-ui-sm text-warning'}>{m.state === 'active' ? 'enrolled' : 'enrolling — waiting for its first connection'}</span>
              {admin && (
                <button type="button" className={`${buttonQuiet} ml-auto`} onClick={() => onRemove(m)} aria-label={`Remove ${m.name}`}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {admin ? (
        <div className="flex items-center gap-3">
          <button type="button" className={buttonPrimary} disabled={keyState !== 'unlocked'} onClick={onEnroll}>
            Enroll a machine
          </button>
          {keyState !== 'unlocked' && <span className="text-ui-sm text-fg-muted">Unlock the org key first: the code carries it.</span>}
        </div>
      ) : (
        <p className="m-0 text-ui-sm text-fg-muted">An admin of the org enrolls and removes machines.</p>
      )}
    </div>
  );
}

function NameStep(props: { machines: MachineRecord[]; onCancel: () => void; onName: (machine: string) => void }) {
  const { machines, onCancel, onName } = props;
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    const found = machineNameProblem(trimmed, machines);
    if (found) return setProblem(found);
    onName(trimmed);
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={submit} aria-label="Machine name">
      <label className="text-ui-sm text-fg-muted" htmlFor="desk-machine-name">
        The machine's name, as the org will know it — its writers in every project's log carry it. Usually its host name.
      </label>
      <input id="desk-machine-name" className={textInput} value={name} onChange={(event) => (setName(event.target.value), setProblem(null))} autoFocus spellCheck={false} />
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

function ConfirmStep(props: { me: Me; machine: string; onCancel: () => void; onCode: (code: string, expires: string) => void }) {
  const { me, machine, onCancel, onCode } = props;
  const held = useKeyHolder((s) => s.key);
  const keys = useQuery({ queryKey: WRAPPED_KEYS_QUERY, queryFn: listWrappedKeys });
  const [error, setError] = useState<string | null>(null);

  async function confirm(method: OrgMethod) {
    if (!held || !keys.data) return setError('The org key is locked. Unlock it first.');
    setError(null);
    let key: Uint8Array | null = null;
    try {
      // The held key cannot be read: its copy is opened once more, checked to be the held key, and wiped once built in.
      key = await openOrgKeyBytes(me.org.id, keys.data, method, held);
      // Locked while it opened: the owner took the key out of this browser, so no code carries it out either.
      if (useKeyHolder.getState().key !== held) return setError('The org key was locked meanwhile. Unlock it to enroll.');
      const { enrollment, token } = await createEnrollment();
      const code = enrollmentCode({ hub: location.origin, org: me.org.id, token, machine, key });
      onCode(code, enrollment.expires);
    } catch (failure) {
      setError(explainEnrollment(failure));
    } finally {
      key?.fill(0);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="enroll-confirm">
      <p className="m-0 text-ui">
        Enroll <strong data-testid="confirm-machine">{machine}</strong>?
      </p>
      <p className="m-0 text-ui-sm leading-5 text-fg-muted">
        The code you get next enrolls one machine named {machine}, works once, and carries your org key: paste it only into that machine's terminal. Confirm with one of the org
        key's methods.
      </p>
      {keys.data ? (
        <OrgMethodForm keys={keys.data} passkeyText="Confirm with passkey" passphraseText="Confirm" preferred={rememberedMethod(me.org.id)} onMethod={confirm} />
      ) : keys.isError ? (
        <p className="m-0 text-ui-sm text-danger" role="alert">
          The hub did not list the org key's methods: {keys.error.message}
        </p>
      ) : null}
      <div>
        <button type="button" className={buttonQuiet} onClick={onCancel}>
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

function explainEnrollment(failure: unknown): string {
  if (failure instanceof HubRequestError && failure.code === 'not-admin') return 'Only an admin of the org enrolls machines.';
  if (failure instanceof HubRequestError) return `The hub refused the enrollment (${failure.code}${failure.message !== failure.code ? `: ${failure.message}` : ''}).`;
  return explainKeyFailure(failure, 'enroll');
}

function CodeStep(props: { machine: string; code: string; expires: string; onDone: () => void }) {
  const { machine, code, expires, onDone } = props;
  const [copied, setCopied] = useState<boolean | null>(null);
  const until = new Date(expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex flex-col gap-3" data-testid="enroll-code">
      <p className="m-0 text-ui">
        On <strong>{machine}</strong>, run <code className="font-mono">{ENROLL_COMMAND}</code>, then paste this code when it asks, before {until}:
      </p>
      <pre className="m-0 max-h-40 overflow-auto rounded-md border border-border bg-bg p-2.5 font-mono text-code break-all whitespace-pre-wrap select-all" data-testid="enrollment-code">
        {code}
      </pre>
      <p className="m-0 text-ui-sm leading-5 text-fg-muted">
        This is the only time the code is shown: closing this discards it. It holds your org key, so paste it only at that prompt and keep it nowhere else.
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className={buttonSecondary} onClick={() => void navigator.clipboard.writeText(code).then(() => setCopied(true), () => setCopied(false))}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className={buttonPrimary} onClick={onDone}>
          Done
        </button>
        {copied === false && <span className="text-ui-sm text-danger">Copying failed; select the text instead.</span>}
      </div>
    </div>
  );
}

/** Removing a machine, once the owner confirms what it means. A machine the hub no longer holds is gone either way: the
 * list says so rather than raising an error. */
function RemoveStep(props: { machine: MachineRecord; onCancel: () => void; onRemoved: (notice: string) => void }) {
  const { machine, onCancel, onRemoved } = props;
  const name = machine.name;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await removeMachine(name);
      onRemoved(`Removed ${name}. To use it with the desk again, enroll it again.`);
    } catch (failure) {
      if (failure instanceof HubRequestError && failure.code === 'unknown-machine') return onRemoved(`${name} was already removed.`);
      setError(explainRemoval(failure));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="remove-confirm">
      <p className="m-0 text-ui">
        Remove <strong data-testid="remove-machine">{name}</strong>?
      </p>
      <p className="m-0 text-ui-sm leading-5" data-testid="remove-meaning">
        {machine.state === 'active' ? 'The hub disconnects it at once and deletes its credential' : 'It has not connected yet. The hub deletes the credential it was enrolled with'}, so{' '}
        {name} is refused from then on. To use it with the desk again, enroll it again with a new code.
      </p>
      <p className="m-0 text-ui-sm leading-5 text-fg-muted">What it wrote to the org's projects stays. It keeps the org key it was enrolled with: removing a machine does not change the key.</p>
      <div className="flex items-center gap-2">
        <button type="button" className={buttonDanger} disabled={busy} onClick={() => void remove()}>
          {busy ? 'Removing…' : `Remove ${name}`}
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

function explainRemoval(failure: unknown): string {
  if (failure instanceof HubRequestError && failure.code === 'not-admin') return 'Only an admin of the org removes machines.';
  if (failure instanceof HubRequestError) return `The hub refused the removal (${failure.code}${failure.message !== failure.code ? `: ${failure.message}` : ''}).`;
  return `The hub did not answer: ${failure instanceof Error ? failure.message : String(failure)}.`;
}

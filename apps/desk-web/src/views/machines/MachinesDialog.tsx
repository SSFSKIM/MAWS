// The org's machines, enrolling one, and removing one (§6, DX7; the DC5 plan's M2), and the provisioning keys that
// enroll machines nobody attends (the provisioning-keys spec, §5; ./ProvisioningKeys.tsx). The owner names the machine,
// or describes the key, and confirms it with one of the org key's methods; the browser opens the key's copy once more as
// bytes (the held key cannot be read), checks they are the held key, asks the hub for a one-time token or a key, builds
// the code, and wipes the bytes; the code is shown once (./CodeSteps.tsx). Closing the dialog discards it: nothing
// keeps it. Removing a machine, and revoking a key, are an admin's, confirmed on a step that says what it does (DX7's
// revocation: disconnected at once, its credential deleted, enrolled again to be used again); neither takes the key.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatClock } from '@shared/app/date-format';
import { useState, type FormEvent } from 'react';
import { machineNameKey, type MachineRecord, type ProvisioningKeyRecord } from 'desk-hub/protocol';
import { createEnrollment, ENROLL_COMMAND, enrollmentCode, listMachines, listProvisioningKeys, machineNameProblem, removeMachine } from '../../enroll/enrollment';
import { HubRequestError } from '../../hub/http';
import type { Me } from '../../hub/me';
import { useKeyHolder } from '../../key/holder';
import { buttonDanger, buttonPrimary, buttonQuiet, Dialog, textInput } from '../common/Dialog';
import { explainKeyFailure } from '../key/explain';
import { CodeStep, ConfirmStep, type Confirming, type Issued } from './CodeSteps';
import { KeyFormStep, keyConfirming, KeySection, PROVISIONING_KEYS_QUERY, RevokeKeyStep } from './ProvisioningKeys';

type Step =
  | { kind: 'list'; notice?: string }
  | { kind: 'name' }
  | { kind: 'key-form' }
  | { kind: 'confirm'; confirming: Confirming }
  | { kind: 'code'; issued: Issued }
  | { kind: 'remove'; machine: MachineRecord }
  | { kind: 'revoke-key'; provisioningKey: ProvisioningKeyRecord };

export function MachinesDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const machines = useQuery({ queryKey: ['machines'], queryFn: listMachines });
  const keys = useQuery({ queryKey: PROVISIONING_KEYS_QUERY, queryFn: listProvisioningKeys });
  const queries = useQueryClient();
  const refresh = () => {
    void queries.invalidateQueries({ queryKey: ['machines'] });
    void queries.invalidateQueries({ queryKey: PROVISIONING_KEYS_QUERY });
  };
  const back = () => {
    setStep({ kind: 'list' });
    refresh();
  };
  // Gone at the hub: off the list at once, then the lists as the hub has them now.
  const removed = (name: string, notice: string) => {
    queries.setQueryData<MachineRecord[]>(['machines'], (list) => list?.filter((m) => m.name !== name));
    setStep({ kind: 'list', notice });
    refresh();
  };
  const revoked = (id: string, notice: string) => {
    const at = new Date().toISOString();
    queries.setQueryData<ProvisioningKeyRecord[]>(PROVISIONING_KEYS_QUERY, (list) => list?.map((k) => (k.id === id ? { ...k, revoked: k.revoked ?? at } : k)));
    setStep({ kind: 'list', notice });
    refresh();
  };
  return (
    <Dialog title="Machines" onClose={onClose}>
      {step.kind === 'list' && (
        <div className="flex flex-col gap-4">
          <MachineList
            me={me}
            machines={machines.data}
            keys={keys.data}
            error={machines.error}
            notice={step.notice}
            onEnroll={() => setStep({ kind: 'name' })}
            onRemove={(machine) => setStep({ kind: 'remove', machine })}
          />
          <KeySection
            me={me}
            keys={keys.data}
            error={keys.error}
            onCreate={() => setStep({ kind: 'key-form' })}
            onRevoke={(provisioningKey) => setStep({ kind: 'revoke-key', provisioningKey })}
          />
        </div>
      )}
      {step.kind === 'name' && <NameStep machines={machines.data ?? []} onCancel={back} onName={(machine) => setStep({ kind: 'confirm', confirming: enrollConfirming(me, machine) })} />}
      {step.kind === 'key-form' && <KeyFormStep onCancel={back} onRequest={(request) => setStep({ kind: 'confirm', confirming: keyConfirming(me, request) })} />}
      {step.kind === 'confirm' && <ConfirmStep me={me} confirming={step.confirming} onCancel={back} onIssued={(issued) => setStep({ kind: 'code', issued })} />}
      {step.kind === 'code' && <CodeStep issued={step.issued} onDone={back} />}
      {step.kind === 'remove' && <RemoveStep machine={step.machine} onCancel={back} onRemoved={(notice) => removed(step.machine.name, notice)} />}
      {step.kind === 'revoke-key' && <RevokeKeyStep provisioningKey={step.provisioningKey} onCancel={back} onRevoked={(notice) => revoked(step.provisioningKey.id, notice)} />}
    </Dialog>
  );
}

function MachineList(props: {
  me: Me;
  machines: MachineRecord[] | undefined;
  keys: ProvisioningKeyRecord[] | undefined;
  error: Error | null;
  notice: string | undefined;
  onEnroll: () => void;
  onRemove: (machine: MachineRecord) => void;
}) {
  const { me, machines, keys, error, notice, onEnroll, onRemove } = props;
  const keyState = useKeyHolder((s) => s.state);
  const admin = me.member.role === 'admin';
  // The key each machine was enrolled through, read from the keys' own lists: a machine's record does not say.
  const via = new Map<string, string>();
  for (const key of keys ?? []) for (const m of key.machines) via.set(machineNameKey(m.name), key.label);
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
          {machines.map((m) => {
            const through = via.get(machineNameKey(m.name));
            return (
              <li key={m.name} className="flex flex-wrap items-baseline gap-2 border-b border-border py-1.5 text-ui last:border-b-0" data-machine={m.name}>
                <span className="font-medium">{m.name}</span>
                <span className={m.state === 'active' ? 'text-ui-sm text-success' : 'text-ui-sm text-warning'}>{m.state === 'active' ? 'enrolled' : 'enrolling — waiting for its first connection'}</span>
                {through !== undefined && <span className="text-ui-sm text-fg-muted">via {through}</span>}
                {admin && (
                  <button type="button" className={`${buttonQuiet} ml-auto`} onClick={() => onRemove(m)} aria-label={`Remove ${m.name}`}>
                    Remove
                  </button>
                )}
              </li>
            );
          })}
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

/** The confirmation of a one-time enrollment: the token asked for, and the code built for the one machine named. */
function enrollConfirming(me: Me, machine: string): Confirming {
  return {
    question: (
      <>
        Enroll <strong data-testid="confirm-machine">{machine}</strong>?
      </>
    ),
    meaning: `The code you get next enrolls one machine named ${machine}, works once, and carries your org key: paste it only into that machine's terminal.`,
    issue: async (key) => {
      const { enrollment, token } = await createEnrollment();
      const code = enrollmentCode({ hub: location.origin, org: me.org.id, token, machine, key });
      const until = formatClock(Date.parse(enrollment.expires));
      return {
        code,
        instructions: (
          <p className="m-0 text-ui">
            On <strong>{machine}</strong>, run <code className="font-mono">{ENROLL_COMMAND}</code>, then paste this code when it asks, before {until}:
          </p>
        ),
        keep: 'It holds your org key, so paste it only at that prompt and keep it nowhere else.',
      };
    },
    explain: (failure) => {
      if (failure instanceof HubRequestError && failure.code === 'not-admin') return 'Only an admin of the org enrolls machines.';
      if (failure instanceof HubRequestError) return `The hub refused the enrollment (${failure.code}${failure.message !== failure.code ? `: ${failure.message}` : ''}).`;
      return explainKeyFailure(failure, 'enroll');
    },
  };
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

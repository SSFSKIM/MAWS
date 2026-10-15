// The org's machines, and enrolling one (§6, DX7; the DC5 plan's M2). The owner names the machine and confirms it
// with one of the org key's methods; the browser opens the key's copy once more as bytes (the held key cannot be
// read), checks they are the held key, asks the hub for a one-time token, builds the code, and wipes the bytes; the
// code is shown once. Closing the dialog discards it: nothing keeps it.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { MachineRecord } from 'desk-hub/protocol';
import { createEnrollment, ENROLL_COMMAND, enrollmentCode, listMachines, machineNameProblem } from '../../enroll/enrollment';
import { HubRequestError } from '../../hub/http';
import type { Me } from '../../hub/me';
import { useKeyHolder } from '../../key/holder';
import { openOrgKeyBytes, rememberedMethod, type OrgMethod } from '../../key/unlock';
import { listWrappedKeys, WRAPPED_KEYS_QUERY } from '../../key/wrapped-keys';
import { buttonPrimary, buttonQuiet, buttonSecondary, Dialog, textInput } from '../common/Dialog';
import { explainKeyFailure } from '../key/explain';
import { OrgMethodForm } from '../key/OrgMethodForm';

type Step = { kind: 'list' } | { kind: 'name' } | { kind: 'confirm'; machine: string } | { kind: 'code'; machine: string; code: string; expires: string };

export function MachinesDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const machines = useQuery({ queryKey: ['machines'], queryFn: listMachines });
  const queries = useQueryClient();
  const back = () => {
    setStep({ kind: 'list' });
    void queries.invalidateQueries({ queryKey: ['machines'] });
  };
  return (
    <Dialog title="Machines" onClose={onClose}>
      {step.kind === 'list' && <MachineList me={me} machines={machines.data} error={machines.error} onEnroll={() => setStep({ kind: 'name' })} />}
      {step.kind === 'name' && <NameStep machines={machines.data ?? []} onCancel={back} onName={(machine) => setStep({ kind: 'confirm', machine })} />}
      {step.kind === 'confirm' && <ConfirmStep me={me} machine={step.machine} onCancel={back} onCode={(code, expires) => setStep({ kind: 'code', machine: step.machine, code, expires })} />}
      {step.kind === 'code' && <CodeStep machine={step.machine} code={step.code} expires={step.expires} onDone={back} />}
    </Dialog>
  );
}

function MachineList(props: { me: Me; machines: MachineRecord[] | undefined; error: Error | null; onEnroll: () => void }) {
  const { me, machines, error, onEnroll } = props;
  const keyState = useKeyHolder((s) => s.state);
  const admin = me.member.role === 'admin';
  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="m-0 text-ui-sm text-danger" role="alert">
          The hub did not list the machines: {error.message}
        </p>
      ) : machines === undefined ? null : machines.length === 0 ? (
        <p className="m-0 text-ui-sm text-fg-muted">No machine is enrolled yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0" data-testid="machines">
          {machines.map((m) => (
            <li key={m.name} className="flex items-baseline gap-2 border-b border-border py-1.5 text-ui last:border-b-0" data-machine={m.name}>
              <span className="font-medium">{m.name}</span>
              <span className={m.state === 'active' ? 'text-ui-sm text-success' : 'text-ui-sm text-warning'}>{m.state === 'active' ? 'enrolled' : 'enrolling — waiting for its first connection'}</span>
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
        <p className="m-0 text-ui-sm text-fg-muted">An admin of the org enrolls machines.</p>
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
      setError(explain(failure));
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

function explain(failure: unknown): string {
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

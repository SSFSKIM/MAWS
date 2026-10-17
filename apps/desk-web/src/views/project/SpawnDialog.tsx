// "+ Session" (§4, §5): a `spawn` RPC to one machine, which runs `sminos spawn` (`claude --bg`) in a checkout of the
// project it already knows — the checkouts its presence lists — with a brief, which becomes the session's in-charge line,
// and optionally a worktree, a model, an effort, and a permission mode (the machine refuses one looser than its
// ceiling). Only an online machine is offered: a spawn to one that is offline fails at once; one set read-only is shown
// and never chosen, since it refuses every RPC. What is offered follows the machines' presence while the dialog is open:
// the owner's pick holds while its machine (or checkout) is still offered, and until they pick, the first that can
// start one is chosen. The Model field offers the family aliases a spawn's engine resolves and the ids this project's
// sessions were seen answering from (`state/models.ts`), and takes any id.
import { useId, useState, type FormEvent } from 'react';
import { useStore } from 'zustand';
import { resultOf } from '../../conversation/outcome';
import { FAMILY_ALIASES, useProjectModels } from '../../state/models';
import { buttonPrimary, buttonSecondary, Dialog, textInput } from '../common/Dialog';
import { useConnected, useDesk } from '../conversation/desk-context';
import { RpcStatus } from '../conversation/RpcStatus';

const MODES = ['default', 'acceptEdits', 'plan', 'auto'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function SpawnDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (session: string) => void }) {
  const { connection, member } = useDesk();
  const machines = useStore(connection.live, (s) => s.machines);
  const connected = useConnected();
  const online = Object.entries(machines).filter(([, m]) => m.online);
  const readOnly = (name: string) => machines[name]?.policy?.read_only === true;
  const startable = online.filter(([name]) => !readOnly(name));
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedCheckout, setPickedCheckout] = useState<string | null>(null);
  const machine = picked !== null && startable.some(([name]) => name === picked) ? picked : (startable[0]?.[0] ?? '');
  const checkouts = machines[machine]?.checkouts ?? [];
  const checkout = pickedCheckout !== null && checkouts.some((c) => c.path === pickedCheckout) ? pickedCheckout : (checkouts[0]?.path ?? '');
  const [worktree, setWorktree] = useState('');
  const [brief, setBrief] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [mode, setMode] = useState('');
  const [rpc, setRpc] = useState<string | null>(null);
  const entry = useStore(connection.conversation.store, (s) => (rpc ? s.rpcs[rpc] : undefined));
  const started = resultOf(entry?.outcome);
  const seen = useProjectModels(connection.project);
  const models = [...new Set([...FAMILY_ALIASES, ...seen])];
  const modelList = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!machine || !checkout || !brief.trim()) return;
    const args = {
      checkout,
      brief: brief.trim(),
      ...(worktree.trim() && { worktree: worktree.trim() }),
      ...(model.trim() && { model: model.trim() }),
      ...(effort && { effort }),
      ...(mode && { permission_mode: mode }),
    };
    setRpc(await connection.rpc(member, machine, 'spawn', args));
  };

  return (
    <Dialog title="New session" onClose={onClose}>
      {online.length === 0 ? (
        <p className="m-0 text-ui text-fg-muted">No machine of this project is online: a spawn needs one.</p>
      ) : startable.length === 0 ? (
        <p className="m-0 text-ui text-fg-muted">
          {online.map(([name]) => name).join(', ')} {online.length === 1 ? 'is read-only: it starts' : 'are read-only: they start'} nothing sent from outside {online.length === 1 ? 'it' : 'them'}.
        </p>
      ) : (
        <form className="flex flex-col gap-3 text-ui" onSubmit={submit} aria-label="New session">
          <label className="flex flex-col gap-1">
            Machine
            <select
              aria-label="Machine"
              className={textInput}
              value={machine}
              onChange={(e) => {
                setPicked(e.target.value);
                setPickedCheckout(null);
              }}
            >
              {online.map(([name]) => (
                <option key={name} value={name} disabled={readOnly(name)}>
                  {readOnly(name) ? `${name} (read-only)` : name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Checkout
            <select aria-label="Checkout" className={textInput} value={checkout} onChange={(e) => setPickedCheckout(e.target.value)} disabled={checkouts.length === 0}>
              {checkouts.length === 0 && <option value="">{machine} knows no checkout of this project</option>}
              {checkouts.map((c) => (
                <option key={c.path} value={c.path}>
                  {c.path} ({c.branch})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Worktree <span className="text-ui-sm text-fg-muted">optional</span>
            <input aria-label="Worktree" className={textInput} value={worktree} onChange={(e) => setWorktree(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            Brief <span className="text-ui-sm text-fg-muted">what it is in charge of; its first prompt</span>
            <textarea aria-label="Brief" className={textInput} rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} required />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              Model
              <input aria-label="Model" className={textInput} value={model} onChange={(e) => setModel(e.target.value)} placeholder="the machine's default" list={modelList} />
              <datalist id={modelList}>
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1">
              Effort
              <select aria-label="Effort" className={textInput} value={effort} onChange={(e) => setEffort(e.target.value)}>
                <option value="">default</option>
                {EFFORTS.map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Permission mode
              <select aria-label="Permission mode" className={textInput} value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="">the machine's ceiling</option>
                {MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <RpcStatus nonce={rpc} />
            {started && typeof started.session === 'string' && (
              <button type="button" className={buttonSecondary} onClick={() => onOpen(started.session as string)}>
                Open it
              </button>
            )}
            {!connected && <span className="text-ui-sm text-warning">Not connected to the hub</span>}
            <button
              type="submit"
              className={`${buttonPrimary} ml-auto`}
              disabled={!connected || !checkout || !brief.trim() || (entry !== undefined && entry.state !== 'failed' && entry.state !== 'not-connected')}
            >
              Start
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

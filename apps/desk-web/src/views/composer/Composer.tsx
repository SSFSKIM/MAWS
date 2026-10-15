// The composer (§4). In the group chat it posts as `sminos say` does: untagged is a record that wakes no one, `@alias`
// delivers, `@all` wakes every live member — the grammar's refusals shown before anything is sent. In a direct channel
// it has the terminal's three verbs — Send (a `human` addressed to the session, queued until it is idle), Steer (into
// the running turn, offered only while one runs), Interrupt — and beside them model and effort, and compact. What a
// session cannot do is drawn disabled with §5's reason; how what it can do will land is said under it.
import { useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';
import { address } from '../../conversation/address';
import { capabilities, turnRunning, type Capability } from '../../conversation/capabilities';
import type { DeskSession } from '../../shell/sessions';
import { useDesk } from '../conversation/desk-context';
import { RpcStatus } from '../conversation/RpcStatus';

const BOX = 'w-full resize-none rounded-md border border-border-strong bg-bg px-3 py-2 text-ui text-fg outline-accent focus-visible:outline-2';
const BUTTON = 'rounded-sm border border-border-strong px-2.5 py-1 text-ui-sm text-fg hover:bg-bg-hover disabled:cursor-not-allowed disabled:text-fg-faint disabled:hover:bg-transparent';
const PRIMARY = 'rounded-sm border border-fg bg-fg px-2.5 py-1 text-ui-sm text-bg hover:bg-fg-muted disabled:cursor-not-allowed disabled:border-fg-faint disabled:bg-fg-faint';

function submitOnEnter(submit: () => void) {
  return (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };
}

export function GroupComposer({ name }: { name: string }) {
  const { connection, member, sessions } = useDesk();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const post = () => {
    if (!text.trim()) return;
    const addressable = [...sessions.values()].map((s) => ({ session: s.session, alias: s.alias, member: s.member, live: s.member && s.group !== 'ended' }));
    const addressed = address(text, addressable, { id: connection.project, name });
    if (!addressed.ok) {
      setError(addressed.reason);
      return;
    }
    setError(null);
    void connection.say(member, addressed.to, text, addressed.wake);
    setText('');
  };
  return (
    <div className="shrink-0 border-t border-border px-4 py-3" data-testid="composer">
      <textarea aria-label={`Message #${name}`} rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={submitOnEnter(post)} className={BOX} placeholder={`Message #${name}`} />
      <div className="mt-1.5 flex items-center gap-3">
        <span className={`text-ui-sm ${error ? 'text-danger' : 'text-fg-faint'}`} role={error ? 'alert' : undefined}>
          {error ?? 'Untagged is a record; @alias delivers; @all wakes every live member'}
        </span>
        <button type="button" className={`${PRIMARY} ml-auto`} onClick={post} disabled={!text.trim()}>
          Post
        </button>
      </div>
    </div>
  );
}

function VerbButton({ label, capability, onClick, primary = false }: { label: string; capability: Capability; onClick(): void; primary?: boolean }) {
  return (
    <button type="button" className={primary ? PRIMARY : BUTTON} onClick={onClick} disabled={!capability.can} title={capability.reason ?? capability.note} data-verb={label.toLowerCase()} aria-description={capability.reason ?? undefined}>
      {label}
    </button>
  );
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function SessionComposer({ session }: { session: DeskSession }) {
  const { connection, member } = useDesk();
  const [text, setText] = useState('');
  const [rpc, setRpc] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const can = capabilities(session);
  const running = turnRunning(session) && session.machineOnline !== false;
  const target = { session: session.session, alias: session.alias };
  const issue = async (promise: Promise<string>) => setRpc(await promise);

  const send = () => {
    if (!text.trim() || !can.send.can) return;
    void connection.say(member, [target], text, false);
    setText('');
  };
  const steer = () => {
    if (!text.trim() || !can.steer.can) return;
    // §5: a terminal session without the bridge takes a steer as a send (a log `human`), read at its next tool round.
    if (can.steer.path === 'send') void connection.say(member, [target], text, false);
    else void issue(connection.rpc(member, session.machine, 'steer', { session: session.session, text }));
    setText('');
  };
  const reasons = [can.send.note, !running ? null : can.steer.can ? (can.steer.path === 'send' ? `Steer is ${can.steer.note}` : null) : can.steer.reason].filter(Boolean);
  return (
    <div className="shrink-0 border-t border-border px-4 py-3" data-testid="composer">
      <textarea
        aria-label={`Message ${session.alias}`}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={submitOnEnter(running && can.steer.can ? steer : send)}
        className={BOX}
        placeholder={running && can.steer.can ? `Steer ${session.alias} (Enter), or Send to queue it` : `Message ${session.alias}`}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <VerbButton label="Send" capability={can.send} onClick={send} primary={!(running && can.steer.can)} />
        {running && <VerbButton label="Steer" capability={can.steer} onClick={steer} primary={can.steer.can} />}
        {running && <VerbButton label="Interrupt" capability={can.interrupt} onClick={() => void issue(connection.rpc(member, session.machine, 'interrupt', { session: session.session }))} />}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <VerbButton label="Model" capability={can.model} onClick={() => setModelOpen((o) => !o)} />
        <VerbButton label="Compact" capability={can.compact} onClick={() => void issue(connection.rpc(member, session.machine, 'compact', { session: session.session }))} />
        <Compaction session={session.session} />
        <RpcStatus nonce={rpc} className="ml-auto" />
      </div>
      {modelOpen && can.model.can && (
        <ModelForm
          onApply={(model, effort) => {
            setModelOpen(false);
            void issue(connection.rpc(member, session.machine, 'model', { session: session.session, ...(model && { model }), ...(effort && { effort }) }));
          }}
        />
      )}
      {reasons.length > 0 && (
        <p className="m-0 mt-1 text-ui-sm text-fg-faint" data-testid="composer-note">
          {reasons.join(' · ')}
        </p>
      )}
    </div>
  );
}

/** Model and effort for this session's main loop from its next request on (§5); `default` is the session's own. */
function ModelForm({ onApply }: { onApply(model: string, effort: string): void }) {
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg-raised px-3 py-2 text-ui-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (model.trim() || effort) onApply(model.trim(), effort);
      }}
      aria-label="Model and effort"
    >
      <label className="flex items-center gap-1.5">
        Model
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="a model id, or default" list="desk-models" className="w-[220px] rounded-sm border border-border-strong bg-bg px-2 py-0.5" />
        <datalist id="desk-models">
          <option value="default" />
        </datalist>
      </label>
      <label className="flex items-center gap-1.5">
        Effort
        <select value={effort} onChange={(e) => setEffort(e.target.value)} className="rounded-sm border border-border-strong bg-bg px-1.5 py-0.5">
          <option value="">unchanged</option>
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={BUTTON} disabled={!model.trim() && !effort}>
        Apply
      </button>
      <span className="text-fg-faint">Applies to the main loop only, from its next request</span>
    </form>
  );
}

/** The session's latest compaction as its `compact` messages tell it (DX4; its outcome is never awaited on the RPC). */
function Compaction({ session }: { session: string }) {
  const { connection } = useDesk();
  const compaction = useStore(connection.conversation.store, (s) => s.compactions[session]);
  if (!compaction) return null;
  let text: string;
  if (compaction.phase === 'start') text = 'Compacting…';
  else if (compaction.error) text = `Compaction failed: ${compaction.error}`;
  else if (compaction.skip) text = `Compaction skipped by a hook: ${compaction.skip}`;
  else if (typeof compaction.tokensBefore === 'number' && typeof compaction.tokensAfter === 'number') text = `Compacted: ${compaction.tokensBefore.toLocaleString()} → ${compaction.tokensAfter.toLocaleString()} tokens`;
  else text = 'Compacted';
  return (
    <span className={`text-ui-sm ${compaction.error ? 'text-danger' : 'text-fg-muted'}`} data-testid="compaction">
      {text}
    </span>
  );
}

// The `#probe` page's shell pane on the product wiring (C9 M3): login shells opened, shown, hidden, reattached after a
// reload, marked lost and respawned through `TerminalRegistry`, so the page is a manual check of the registry; its
// debug strip shows the host's `pty.list` rows (with a latch for a pty ever seen paused), a per-pty counter of bytes,
// line feeds and carriage returns, and each handle's status, acceleration and reattach path; a Ping button measures
// how long a click waits for the main thread. Exposes `window.__maws_harness.terminals` (the same names as the `#panel`
// page, `terminals-api.ts`). Tokens only.
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import { SCRATCH_CWD } from '../../../../../spikes/terminal-probe/workloads.mjs';
import { useTerminals } from '../../stores/terminals';
import { terminals, type TerminalId } from '../../terminal/registry';
import { counterText, countersOf, ping, tap, useSamples, wasPausedSeen } from './debug-tap';
import { createTerminalsApi } from './terminals-api';

export type { TerminalsHarnessApi } from './terminals-api';

// The registry pane's terminals belong to a session of their own, so a reload re-adopts exactly them.
export const REGISTRY_SESSION = 'probe-registry' as AppSessionId;

const useSelection = create<{ selected: TerminalId | null }>()(() => ({ selected: null }));
const select = (selected: TerminalId | null) => useSelection.setState({ selected });

let opened = 0;
let adoption: Promise<TerminalId[]> | null = null;

function open(command?: string): TerminalId {
  const id = terminals.open({ appSessionId: REGISTRY_SESSION, label: `shell-${Date.now()}-${++opened}`, cwd: SCRATCH_CWD, ...(command ? { command } : {}) });
  select(id);
  return id;
}

function ready(): Promise<TerminalId[]> {
  tap();
  adoption ??= terminals.adopt((info) => info.appSessionId === REGISTRY_SESSION).then((ids) => {
    if (ids.length) select(ids[0]!);
    else open();
    return ids;
  });
  return adoption;
}

export const terminalsApi = createTerminalsApi({
  ready,
  open,
  select,
  async close(id) {
    await terminals.close(id);
    if (useSelection.getState().selected === id) select(terminals.list()[0]?.id ?? null);
  },
});


export function RegistryPane() {
  const infos = useTerminals((s) => s.terminals);
  const host = useTerminals((s) => s.host);
  const selected = useSelection((s) => s.selected);
  const hostRef = useRef<HTMLDivElement>(null);
  const [checkpoints, setCheckpoints] = useState(true);
  const ptys = useSamples((s) => s.rows);
  const pings = useSamples((s) => s.pings);
  const current = infos.find((info) => info.id === selected) ?? null;

  useEffect(() => void ready(), []);
  useEffect(() => {
    if (!selected) return;
    terminals.mount(selected, hostRef.current!, { focus: true });
    return () => terminals.unmount(selected);
  }, [selected]);

  const button = 'rounded-sm border border-border px-2 py-0.5 text-fg hover:bg-bg-hover disabled:text-fg-faint';
  return (
    <section aria-label="registry pane" data-pane="registry" className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2 font-mono text-ui-sm text-fg-muted">
        <span className="mr-2 text-fg">registry</span>
        {infos.map((info, i) => (
          <button
            key={info.id}
            type="button"
            aria-pressed={info.id === selected}
            onClick={() => select(info.id)}
            className="rounded-sm px-2 py-0.5 hover:bg-bg-hover aria-pressed:bg-bg-active aria-pressed:text-fg"
          >
            {info.title ?? `Terminal ${i + 1}`} · {info.status}
          </button>
        ))}
        <button type="button" aria-label="new terminal" onClick={() => open()} className={button}>
          +
        </button>
        <button type="button" onClick={() => select(null)} disabled={!selected} className={button}>
          hide
        </button>
        <button
          type="button"
          onClick={() => current && void terminals.respawn(current.id)}
          disabled={!current || (current.status !== 'exited' && current.status !== 'lost') || host?.state !== 'ready'}
          className={button}
        >
          new terminal
        </button>
        <button type="button" onClick={() => current && void terminalsApi.close(current.id)} disabled={!current} className={button}>
          close
        </button>
        <button type="button" onClick={() => current && terminalsApi.simulateContextLoss(current.id)} disabled={!current} className={button}>
          lose context
        </button>
        <button
          type="button"
          aria-pressed={checkpoints}
          onClick={() => {
            terminals.setCheckpoints(!checkpoints);
            setCheckpoints(!checkpoints);
          }}
          className={button}
        >
          checkpoints {checkpoints ? 'on' : 'off'}
        </button>
        <button type="button" onClick={(ev) => ping(ev)} className={button}>
          ping {pings.count}
          {pings.lastMs === null ? '' : ` · ${pings.lastMs} ms (max ${pings.maxMs})`}
        </button>
      </div>
      {current?.reconnect === 'lossy' ? (
        <div role="status" className="shrink-0 border-b border-border bg-bg-raised px-2 py-0.5 text-ui-sm text-fg-muted">
          Reconnected; earlier output was not kept
        </div>
      ) : null}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden bg-bg-raised p-1" />
      <output aria-label="registry debug" className="flex shrink-0 flex-col gap-0.5 border-t border-border px-2 py-1 font-mono text-ui-sm text-fg-muted">
        <div>
          host {host?.state ?? '…'} pid {host?.pid ?? '—'} restarts {host?.restarts ?? 0}
        </div>
        {infos.map((info) => (
          <div key={info.id} data-terminal={info.id}>
            handle {info.label} · {info.status}
            {info.exit ? ` (code ${info.exit.exitCode ?? 'null'}, signal ${info.exit.signal ?? 'null'})` : ''} · {info.acceleration} ·{' '}
            {info.visible ? 'visible' : 'hidden'} · reattach: {info.reconnect ?? '—'} · pid {info.pid ?? '—'}
            {info.error ? <span className="text-danger"> · {info.error}</span> : null}
          </div>
        ))}
        {ptys.map((pty) => (
          <div key={pty.ptyId} data-pty={pty.ptyId}>
            pty.list {pty.appSessionId}/{pty.label} · pid {pty.pid} · {pty.alive ? 'alive' : 'dead'} · paused {String(pty.paused)}
            {wasPausedSeen(pty.ptyId) ? ' (paused seen)' : ''} · offset {pty.offset} · {counterText(countersOf(pty.ptyId))}
          </div>
        ))}
      </output>
    </section>
  );
}

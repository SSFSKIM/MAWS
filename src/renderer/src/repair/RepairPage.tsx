// The repair window's page (P5 O15 M2, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, acceptance 2,
// Interfaces §B): why `mawsd` cannot start, in a sentence, the daemon's last log lines where there are any, and the
// actions that apply. It reads only its bridge (`window.repair`): none of the app's stores or IPC, so it loads when
// nothing else of MAWS can.
import { useEffect, useState } from 'react';
import type { RepairBridge, RepairState } from '@shared/repair';
import { PRIMARY, SECONDARY } from '../sessions/ui';
import { actions, body, HEADLINE, REPAIR } from './copy';

export function RepairPage({ bridge }: { bridge: RepairBridge }) {
  const [state, setState] = useState<RepairState | null>(null);
  useEffect(() => {
    let live = true;
    const off = bridge.onState((next) => setState(next));
    void bridge.state().then((first) => live && setState((current) => current ?? first));
    return () => {
      live = false;
      off();
    };
  }, [bridge]);
  if (state === null) return null;
  const offered = actions(state.kind, state.packaged);
  return (
    <main className="flex h-full flex-col gap-4 overflow-auto bg-bg p-6 text-fg">
      <h1 className="m-0 text-prose font-semibold">{HEADLINE[state.kind]}</h1>
      <p className="m-0 leading-[var(--lh-prose)] text-ui">
        {body(state.kind, state.why).map((part, index) => ('code' in part ? <code key={index} className="rounded-sm bg-bg-hover px-1 font-mono text-code">{part.code}</code> : <span key={index}>{part.text}</span>))}
      </p>
      {state.log && (
        <section aria-label={REPAIR.logLabel} className="flex min-h-0 flex-col gap-1">
          <span className="text-ui-sm text-fg-muted">{state.log.path}</span>
          <pre aria-label={state.log.path} className="m-0 min-h-0 flex-1 overflow-auto rounded-md border border-border bg-bg-raised p-2 font-mono text-code whitespace-pre-wrap select-text">
            {state.log.lines.join('\n')}
          </pre>
        </section>
      )}
      <div className="mt-auto flex items-center justify-end gap-2">
        {state.attempting && (
          <span role="status" className="mr-auto text-ui-sm text-fg-muted">
            {REPAIR.attempting}
          </span>
        )}
        {offered.map(({ action, label }, index) => (
          // the first is the default: focused, and the filled button
          <button key={label} type="button" autoFocus={index === 0} disabled={state.attempting} className={`${index === 0 ? PRIMARY : SECONDARY} text-ui-sm`} onClick={() => bridge.act(action)}>
            {label}
          </button>
        ))}
      </div>
    </main>
  );
}

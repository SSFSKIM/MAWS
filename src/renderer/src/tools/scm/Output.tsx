// The Output disclosure (E6 execution document, Design §5; M4's decisions): the session's latest remote run, as the
// store holds it (seeded from `scm.remote.last` while the body is mounted and advanced by `scm.remote.output` by
// sequence number), so a push started before a reload is shown, followed and cancellable after it. It opens itself when
// a run starts (or is found running) and keeps the latest run until the next; the header names the command and how it
// ended, in the danger token when it failed. A PR run's pull request is offered as a link once gh printed it.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../../ipc/client';
import { SECONDARY } from '../../sessions/ui';
import { SCM_COPY, shellWords } from './copy';
import type { RemoteRun } from './remote-run';
import { prUrlOf } from './remote-actions';
import { openLink, settled, useScm } from './store';
import type { ScmUi } from './view-state';

// How the run stands: running, done, or how it failed (a non-zero exit, a signal, or a program that never started,
// main's note in the output saying why).
export function runState(run: RemoteRun): { text: string; failed: boolean } {
  if (run.running) return { text: SCM_COPY.running, failed: false };
  if (run.exitCode === 0) return { text: SCM_COPY.done, failed: false };
  if (run.exitCode !== null) return { text: SCM_COPY.exited(run.exitCode), failed: true };
  if (run.signal !== null) return { text: SCM_COPY.stopped(run.signal), failed: true };
  return { text: SCM_COPY.notStarted, failed: true };
}

// The lines as text, without the open line a trailing newline leaves.
const textOf = (lines: readonly string[]) => (lines.at(-1) === '' ? lines.slice(0, -1) : lines).join('\n');

export function Output({ appSessionId, ui }: { appSessionId: AppSessionId; ui: StoreApi<ScmUi> }) {
  const run = useScm((s) => s.runs.get(appSessionId) ?? null);
  const open = useStore(ui, (s) => s.output);
  const token = run?.token ?? null;
  const running = run?.running ?? false;
  // A run seen running (started from a sheet, found by the snapshot, or another session's on this checkout) opens it.
  useEffect(() => {
    if (token !== null && running) ui.setState({ output: true });
  }, [token, running, ui]);
  const text = useRef<HTMLPreElement>(null);
  const lines = run?.lines ?? null;
  useLayoutEffect(() => {
    if (text.current) text.current.scrollTop = text.current.scrollHeight; // follow the output as it streams
  }, [lines, open]);

  if (run === null) return null;
  const state = runState(run);
  const created = run.kind === 'pr' && run.exitCode === 0 ? prUrlOf(run.lines) : null;
  const cancel = () =>
    void settled(ipc.invoke('scm.remote.cancel', { appSessionId, token: run.token })).then((result) => {
      if (!result.ok) console.error('[scm] scm.remote.cancel failed', result.error);
    });
  return (
    <section aria-label={SCM_COPY.output} data-scm-output className="flex max-h-[40%] shrink-0 flex-col border-t border-border">
      <div className="flex h-7 shrink-0 items-center gap-2 px-3">
        <button type="button" aria-expanded={open} onClick={() => ui.setState({ output: !open })} className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-ui-sm font-medium text-fg-muted hover:text-fg">
          <span aria-hidden="true" className="w-3 text-center">
            {open ? '⌄' : '›'}
          </span>
          <span>{SCM_COPY.output}</span>
          <span data-scm-output-state className={`min-w-0 truncate font-normal ${state.failed ? 'text-danger' : 'text-fg-muted'}`}>
            {`${run.kind !== null ? SCM_COPY.runKind[run.kind] : SCM_COPY.remoteCommand} · ${state.text}`}
          </span>
        </button>
        {run.running ? (
          <button type="button" aria-label={SCM_COPY.cancelRunLabel} title={SCM_COPY.cancelRunLabel} onClick={cancel} className="rounded-sm px-1.5 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-active hover:text-fg">
            {SCM_COPY.cancelRun}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="flex min-h-0 flex-col gap-1 px-3 pb-2">
          {run.plan !== null ? (
            <p data-scm-output-command className="m-0 shrink-0 truncate font-mono text-ui-sm text-fg-muted" title={shellWords(run.plan.program, run.plan.argv)}>
              {shellWords(run.plan.program, run.plan.argv)}
            </p>
          ) : null}
          <pre ref={text} data-scm-output-text className="m-0 min-h-0 overflow-y-auto rounded-sm border border-border bg-bg-raised px-2 py-1 font-mono text-ui-sm break-words whitespace-pre-wrap text-fg">
            {textOf(run.lines)}
          </pre>
          {run.truncated ? (
            <p data-scm-output-truncated className="m-0 text-ui-sm text-fg-muted">
              {SCM_COPY.truncated}
            </p>
          ) : null}
          {!run.running ? (
            <p data-scm-output-exit className={`m-0 text-ui-sm ${state.failed ? 'text-danger' : 'text-fg-muted'}`}>
              {state.text}
            </p>
          ) : null}
          {created !== null ? (
            <div>
              <button type="button" title={created.url} onClick={() => openLink(created.url)} className={SECONDARY}>
                {SCM_COPY.openCreatedPr(created.number)}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

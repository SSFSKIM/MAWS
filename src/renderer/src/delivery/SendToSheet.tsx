// P4-B5: the Send to sheet (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7), app-wide, opened from an editor
// header's Send to and a library row's Export menu; C10's Sheet and button weights, X7's tokens. It names the target
// (Notion, or Google Drive), the connection MAWS sends through (Notion: "Connected through MAWS", route D's own sign-in;
// Drive: the gws CLI's own sign-in), where the delivery goes and, for Drive, the format; then it sends, with no session
// and no Claude turn, and ends on the receipt. When the connection needs something first, the sheet says what and offers
// it: Connect (Notion's consent in the browser, sealed by MAWS), gws's own login (its URL opened in the browser, the
// sign-in kept by the CLI), or a Terminal tab running gws's install or setup. The run (./run.ts) is the sheet's, outside
// React; closing the sheet cancels what has not written yet.
import { useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { destinationIdOf, type DeliveryDestination, type DeliveryTarget } from '@shared/delivery/destination';
import type { AppSessionId } from '@shared/graph/ids';
import type { DeliveryStatus } from '@shared/ipc/schema/delivery';
import type { ArtifactExportFormat } from '@shared/maws/tools';
import { formatAgo } from '@shared/app/date-format';
import { useNow } from '../app/use-now';
import { ipc } from '../ipc/client';
import { useExportFormats } from '../library/export';
import { panelHost } from '../panel/host';
import { Sheet } from '../sessions/Sheet';
import { FIELD, PRIMARY, SECONDARY } from '../sessions/ui';
import { TERMINAL_TOOL_ID, type TerminalParams } from '../tools/terminal';
import { VIEWERS_COPY } from '../tools/artifacts/viewers/copy';
import { GWS_INSTALL, GWS_SETUP, SEND_TO_COPY as C, SERVICE } from './copy';
import type { SendToPhase, SendToRun } from './run';
import { closeSendTo, useDelivery, type SendToSubject } from './store';

// Drive keeps Office files editable (a deck as PowerPoint), else a PDF.
const DRIVE_PREFER: readonly ArtifactExportFormat[] = ['docx', 'pptx', 'pdf', 'md', 'html', 'png', 'claude'];
// The label gws's shells are filed under in the PTY host: no session owns them.
const GWS_OWNER = 'maws-gws-setup' as AppSessionId;

export const driveFormatOf = (formats: readonly ArtifactExportFormat[], picked: ArtifactExportFormat | null): ArtifactExportFormat | null =>
  picked !== null && formats.includes(picked) ? picked : (DRIVE_PREFER.find((format) => formats.includes(format)) ?? formats[0] ?? null);

// A pinned Terminal tab running gws's own install or setup in the home directory (as Settings' engine update runs).
export function openGwsTerminal(command: string): string {
  return panelHost.addTool<TerminalParams>(TERMINAL_TOOL_ID, { appSessionId: null, pin: true, params: { cwd: '/', command: `cd ~ && ${command}`, owner: GWS_OWNER } });
}

const statusOf = (phase: SendToPhase): DeliveryStatus | null => ('status' in phase ? phase.status : null);
const canSendFrom = (status: DeliveryStatus | null): boolean => status !== null && status.state === 'ready';

export function SendToHost() {
  const sheet = useDelivery((s) => s.sheet);
  return sheet ? <SendToSheet key={sheet.subject.artifactId} subject={sheet.subject} run={sheet.run} /> : null;
}

function SendToSheet({ subject, run }: { subject: SendToSubject; run: SendToRun }) {
  const { target, phase } = useStore(run.state);
  const formats = useExportFormats(subject.kind);
  const [picked, setPicked] = useState<ArtifactExportFormat | null>(null);
  const [where, setWhere] = useState<'default' | 'inside'>('default');
  const [link, setLink] = useState('');
  const receipt = useDelivery((s) => s.receipts[`${subject.artifactId}\0${target}`] ?? null);
  const now = useNow();

  const notionOffered = formats.length === 0 ? target === 'notion' : formats.includes('md');
  const targets: DeliveryTarget[] = notionOffered ? ['notion', 'drive'] : ['drive'];
  const format = target === 'notion' ? 'md' : driveFormatOf(formats, picked);
  const insideId = where === 'inside' ? destinationIdOf(target, link) : null;
  const destination: DeliveryDestination | null = where === 'default' ? { kind: 'default' } : insideId !== null ? { kind: 'inside', id: insideId } : null;
  const status = statusOf(phase);
  const busy = phase.phase === 'checking' || phase.phase === 'connecting' || phase.phase === 'sending';
  const canSend = !busy && phase.phase !== 'sent' && canSendFrom(status) && destination !== null && format !== null;
  const close = () => closeSendTo(run);
  const switchTo = (next: DeliveryTarget) => {
    if (next === target) return;
    setWhere('default');
    setLink('');
    void run.check(next);
  };
  const terminal = (command: string) => {
    openGwsTerminal(command);
    close();
  };

  return (
    <Sheet title={C.title(subject.title)} width="w-[min(500px,92vw)]" onClose={close} data-send-to={target}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          // a design's PNG pictures the board its Export would (a PDF prints every board)
          if (canSend) void run.send({ format: format!, ...(subject.versionId !== undefined && { versionId: subject.versionId }), ...(format === 'png' && subject.board !== undefined && { board: subject.board }), destination: destination! });
        }}
      >
        <div role="radiogroup" aria-label={C.target} className="flex gap-1">
          {targets.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === target}
              disabled={busy}
              onClick={() => switchTo(option)}
              className={`h-7 rounded-sm border px-2.5 text-ui ${option === target ? 'border-fg bg-bg-active text-fg' : 'border-border-strong text-fg-muted hover:bg-bg-hover'} disabled:text-fg-faint`}
            >
              {SERVICE[option]}
            </button>
          ))}
        </div>
        <p className="m-0 text-ui-sm text-fg-muted">{C.direct}</p>
        <Connection target={target} phase={phase} run={run} terminal={terminal} />
        {target === 'notion' ? (
          <p className="m-0 text-ui-sm text-fg-muted">{C.asPage}</p>
        ) : (
          <label className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-ui-sm text-fg-muted">{C.format}</span>
            <select aria-label={C.format} disabled={busy || formats.length === 0} value={format ?? ''} onChange={(event) => setPicked(event.target.value as ArtifactExportFormat)} className={`${FIELD} py-0.5`}>
              {formats.map((option) => (
                <option key={option} value={option}>
                  {VIEWERS_COPY.exportFormats[option]}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" disabled={busy}>
          <legend className="mb-1 text-ui-sm text-fg-muted">{C.where}</legend>
          <label className="flex items-center gap-2 text-ui">
            <input type="radio" name="where" checked={where === 'default'} onChange={() => setWhere('default')} className="accent-accent" />
            {target === 'notion' ? C.notionDefault : C.driveDefault}
          </label>
          <label className="flex items-center gap-2 text-ui">
            <input type="radio" name="where" checked={where === 'inside'} onChange={() => setWhere('inside')} className="accent-accent" />
            {target === 'notion' ? C.notionInside : C.driveInside}
          </label>
          {where === 'inside' && (
            <input
              aria-label={target === 'notion' ? C.notionInside : C.driveInside}
              value={link}
              placeholder={target === 'notion' ? C.notionInsidePlaceholder : C.driveInsidePlaceholder}
              onChange={(event) => setLink(event.target.value)}
              aria-invalid={link.trim() !== '' && insideId === null}
              className={FIELD}
            />
          )}
          {where === 'inside' && link.trim() !== '' && insideId === null && <p className="m-0 text-ui-sm text-danger">{target === 'notion' ? C.notionInsideInvalid : C.driveInsideInvalid}</p>}
        </fieldset>
        {receipt && phase.phase !== 'sent' && <p className="m-0 text-ui-sm text-fg-muted">{C.lastSent(target, formatAgo(Math.max(0, now - receipt.at)))}</p>}
        <p role="status" data-send-to-status="" className={`m-0 min-h-[1lh] text-ui-sm ${phase.phase === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>
          {phase.phase === 'sending' ? C.sending(target) : phase.phase === 'sent' ? C.sent(target, phase.receipt.name) : phase.phase === 'failed' ? phase.words : ''}
        </p>
        <div className="flex items-center justify-end gap-2">
          {phase.phase === 'sent' ? (
            <>
              {phase.receipt.url && (
                <button type="button" onClick={() => void ipc.invoke('layout.openExternal', { url: phase.receipt.url! })} className={SECONDARY}>
                  {C.open(target)}
                </button>
              )}
              <button type="button" autoFocus onClick={close} className={PRIMARY}>
                {C.done}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={close} className={SECONDARY}>
                {busy ? C.cancel : C.close}
              </button>
              <button type="submit" disabled={!canSend} className={PRIMARY}>
                {receipt ? C.sendAgain : C.send}
              </button>
            </>
          )}
        </div>
      </form>
    </Sheet>
  );
}

// What MAWS sends through, and what it needs first when it cannot send yet.
function Connection({ target, phase, run, terminal }: { target: DeliveryTarget; phase: SendToPhase; run: SendToRun; terminal(command: string): void }) {
  const status = statusOf(phase);
  const line = (text: string | null, actions?: ReactNode, code?: string) => (
    <div data-send-to-connection={status?.state ?? phase.phase} className="flex flex-col gap-2 rounded-sm border border-border p-2.5">
      {text !== null && <p className="m-0 text-ui text-fg">{text}</p>}
      {code && <code className="block rounded-sm bg-bg-raised px-2 py-1 font-mono text-ui-sm text-fg">{code}</code>}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
  const button = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className={SECONDARY}>
      {label}
    </button>
  );
  const again = button(C.checkAgain, () => void run.check());
  if (phase.phase === 'checking') return line(C.checking[target]);
  if (phase.phase === 'connecting') return line(target === 'notion' ? C.connecting : C.signingIn);
  if (status === null) return line(null, again); // the state unread: the status line says why, once
  if (status.target === 'notion') {
    const { source } = status;
    switch (status.state) {
      case 'ready':
        return source && status.connection ? line(C.notionReady(source, status.connection)) : line(C.notionUnavailable, again);
      case 'signIn':
        return line(C.notionSignIn(source?.server ?? 'Notion'), button(C.connect, () => void run.connect()));
      case 'reconnect':
        return line(C.notionReconnect(source?.server ?? 'Notion'), button(C.reconnect, () => void run.connect()));
      case 'busy':
        return line(C.notionBusy, again);
      case 'none':
        return line(status.why === 'noSession' ? C.notionNoSession : C.notionNotFound, again);
      default:
        return line(C.notionUnavailable, again);
    }
  }
  switch (status.state) {
    case 'ready':
      return line(C.driveReady(status.user));
    case 'absent':
      return line(C.driveAbsent, <>{button(C.installInTerminal, () => terminal(GWS_INSTALL))}{again}</>, GWS_INSTALL);
    case 'needsSetup':
      return line(C.driveNeedsSetup, <>{button(C.setupInTerminal, () => terminal(GWS_SETUP))}{again}</>, GWS_SETUP);
    case 'signedOut':
      return line(C.driveSignedOut, button(C.signIn, () => void run.connect()));
    case 'expired':
      return line(C.driveExpired, button(C.signInAgain, () => void run.connect()));
    case 'noDrive':
      return line(C.driveNoDrive, button(C.signInAgain, () => void run.connect()));
    default:
      return line(C.driveFailed(status.message), again);
  }
}

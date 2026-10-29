// The Org page's shared pieces (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, *The split*): a
// group's heading, M1's pairing-code field, fingerprint and refusal line (moved unchanged from OrgSection.tsx), a
// device's line as People and You draw it, and a sign's outcome in one line. Tokens only, at the Settings rows' weight.
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import type { IpcError } from '@shared/ipc/schema';
import type { OrgRefusal, OrgStatus, OrgView, SignResult } from '@shared/ipc/schema/org';
import { toast } from '../../stores/notices';
import { ORG } from '../copy';
import { Chip, INPUT, Setting, TEXT_ACTION } from '../parts';

export type Registered = Extract<OrgStatus, { state: 'registered' }>;
export type Member = OrgView['members'][number];
export type ViewDevice = Member['devices'][number];
/** The attempts a refusal can name (`refused.attempt`), each shown under the control that sent it. */
export type Attempt = NonNullable<OrgRefusal['attempt']>;
/** A sign's end in one line: muted when done, the warning tone when refused. */
export type Outcome = { text: string; refused: boolean } | null;
export type Invoked<T> = Promise<{ ok: true; value: T } | { ok: false; error: IpcError }>;

// An IPC failure (not a refusal) is a toast, as a refused settings write is.
export function failed(error: IpcError) {
  console.error('[org] command failed', error);
  toast({ level: 'warning', text: ORG.failed(error.message), actions: [], dismissible: true });
}

/** One of Q1's four groups: its heading, then its rows. */
export function Group({ id, title, children }: { id: 'you' | 'people' | 'machines' | 'org'; title: string; children: ReactNode }) {
  return (
    <div data-org-group={id} className="mt-3 first:mt-1">
      <h4 className="m-0 mb-0.5 text-ui-sm font-semibold text-fg">{title}</h4>
      {children}
    </div>
  );
}

// "a, b and c": machine names, holders and owners in a line.
export function inWords(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function signOutcome(result: SignResult): Outcome {
  if (result.ok) return { text: ORG.signed(result.version), refused: false };
  if (result.reason === 'cancelled') return null; // the person's own cancel at Touch ID needs no line
  return { text: [ORG.notSigned, ORG.signReasons[result.reason], result.detail].filter((part) => part !== undefined && part !== '').join(' · '), refused: true };
}

export function OutcomeLine({ outcome }: { outcome: Outcome }) {
  if (outcome === null) return null;
  return (
    <span role={outcome.refused ? 'alert' : 'status'} className={`basis-full text-ui-sm ${outcome.refused ? 'text-warning' : 'text-fg-muted'}`}>
      {outcome.text}
    </span>
  );
}

// A device as the org state lists it: its id's first 8 (as `show` does), its class, and its marks.
export function DeviceLine({ device, children }: { device: ViewDevice; children?: ReactNode }) {
  return (
    <div data-org-device className="flex min-w-0 basis-full flex-wrap items-center gap-2">
      <span className="font-mono">{device.id.slice(0, 8)}</span>
      <span className="text-fg-muted">{ORG.classes[device.class]}</span>
      {device.root && <Chip>{ORG.rootMark}</Chip>}
      {device.thisMac && <Chip>{ORG.thisMacMark}</Chip>}
      {children}
    </div>
  );
}

// A new device entry's fingerprint, large in the monospace token, to compare with the approving device's.
export function Fingerprint({ value }: { value: string }) {
  return (
    <Setting label={ORG.fingerprint} note={ORG.fingerprintNote}>
      <span className="font-mono text-prose font-semibold tracking-wide text-fg select-all">{value}</span>
    </Setting>
  );
}

// The pairing-code field: typed here, sent trimmed on the button or Enter, and cleared once sent.
export function CodeField({ action, note, pending, refusal, onSend }: { action: string; note: string; pending: boolean; refusal: OrgRefusal | null; onSend(code: string): void }) {
  const [draft, setDraft] = useState('');
  const send = () => {
    const code = draft.trim();
    if (code === '' || pending) return;
    setDraft('');
    onSend(code);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') send();
    if (e.key === 'Escape') setDraft('');
  };
  return (
    <Setting label={ORG.code} note={note}>
      <input aria-label={ORG.code} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} spellCheck={false} autoComplete="off" className={`${INPUT} max-w-[320px] flex-1 font-mono`} />
      <button type="button" className={TEXT_ACTION} disabled={pending || draft.trim() === ''} onClick={send}>
        {action}
      </button>
      <Refusal refusal={refusal} />
    </Setting>
  );
}

export function Refusal({ refusal }: { refusal: OrgRefusal | null }) {
  if (refusal === null) return null;
  return (
    <span role="alert" className="basis-full text-ui-sm text-warning">
      {refusalText(refusal)}
    </span>
  );
}

/** A refusal whose attempt has no control on the page, or that names none (the startup `keys`): its own row. */
export function UnplacedRefusal({ refusal }: { refusal: OrgRefusal | null }) {
  if (refusal === null) return null;
  return (
    <Setting label={ORG.refused}>
      <Refusal refusal={refusal} />
    </Setting>
  );
}

export function refusalText({ code, detail }: OrgRefusal): string {
  if (code === 'not-member') return ORG.refusals['not-member'](detail);
  return detail ? `${ORG.refusals[code]} · ${detail}` : ORG.refusals[code];
}

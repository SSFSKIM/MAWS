// The Add owner sheet (P5 O8 M5b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M5b's "At its end" and the
// Decision Log's "M5b's refresh at its cut", items 3 and 4), opened beside Share from a session's row menu and its header
// (target.ts' `useCanAddOwner`). One person at a time: Add owner sends `org.owners.add {address, member}`, which main signs
// with Touch ID as a step-up `record.owners {add: true, member}` act to the session's machine (or this Mac's own door),
// and the act's outcome shows in the sheet. The row's owners change from the session's next listing, never from here.
//
// - It opens on a fresh read of the session's policy, as Share does, since the act takes the same record path: a machine
//   whose sminos can't keep a reach says so and offers nothing; a reach that can't be read, or a read refused, says why
//   and offers a reload.
// - It offers the head's members (`org.view`) who aren't you and whom the session's listing doesn't name an owner; a
//   session with no listing (this Mac's own) reads no owners, so every member but you. A person it added is offered no
//   more. A no-op (`changed: false`) reads "Already an owner", never a failure.
// - No removal: RL §6.1 grades another's removal differently, and the owner never asked for it.
import { useEffect, useRef, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { FORMER_MEMBER, type OrgPolicyLine, type OrgPolicyOutcome, type OrgView } from '@shared/ipc/schema/org';
import { useMachineMark } from '../../app/machine-mark';
import { ipc } from '../../ipc/client';
import { useHubAccess } from '../../stores/hub-access';
import { useSessions, type ListedSession } from '../../stores/sessions';
import { closeDialog } from '../dialogs';
import { Sheet, SheetForm } from '../Sheet';
import { displayTitle, listedTitle } from '../title';
import { PRIMARY, SECONDARY } from '../ui';
import { OWNER, ownerOutcomeWords, refusalWords, SHARE, subtitleTooltip } from './copy';
import { readPolicy, SELECT, Words, type Read } from './ShareSheet';

const NO_OWNERS: readonly string[] = [];
/** The person an owner line names (an owner add's one line is always one). */
const personOf = (line: OrgPolicyLine): string => (line.kind === 'access' ? '' : line.member);

/** The sheet belongs to the reader it opened for, as Share's does: a change of who is signed in closes it at once. */
export function AddOwnerSheet({ address }: { address: AppSessionId }) {
  const me = useHubAccess((s) => s.member);
  const [reader] = useState(me);
  const ended = me !== reader;
  useEffect(() => {
    if (ended) closeDialog();
  }, [ended]);
  return ended ? null : <ReaderSheet address={address} />;
}

function ReaderSheet({ address }: { address: AppSessionId }) {
  const machine = useMachineMark(address).name;
  const title = useSessions((s) => {
    const record = s.records.get(address);
    const listed = s.listed.get(address as ListedSession['appId']);
    return record !== undefined ? displayTitle(record) : listed !== undefined ? listedTitle(listed) : '';
  });
  const owners = useSessions((s) => s.listed.get(address as ListedSession['appId'])?.owners ?? NO_OWNERS);
  const [read, setRead] = useState<Read>({ state: 'reading' });
  const [view, setView] = useState<OrgView | null | 'reading'>('reading');
  const [chosen, setChosen] = useState('');
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<OrgPolicyOutcome | null>(null);

  // whether the sheet is still open: an answer after it closed is dropped
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    void readPolicy(address).then((next) => live.current && setRead(next));
    void ipc.invoke('org.view', undefined).then((result) => live.current && setView(result.ok ? result.value : null));
    return () => {
      live.current = false;
    };
  }, [address]);
  const reload = () => {
    setRead({ state: 'reading' });
    void readPolicy(address).then((next) => live.current && setRead(next));
  };

  const members = view !== null && view !== 'reading' ? view.members : [];
  const addable = members.filter((m) => !m.you && !owners.includes(m.id) && !added.has(m.id));
  const nameOf = (member: string) => members.find((m) => m.id === member)?.name ?? FORMER_MEMBER;

  const save = async () => {
    if (chosen === '') return;
    setSaving(true);
    setRefusal(null);
    setOutcome(null);
    const result = await ipc.invoke('org.owners.add', { address, member: chosen });
    if (!live.current) return;
    setSaving(false);
    if (!result.ok) return setRefusal(result.error.code);
    if (!result.value.ok) return setRefusal(result.value.reason);
    const [line] = result.value.results;
    setOutcome(line ?? null);
    if (line?.state === 'done') {
      setAdded((was) => new Set(was).add(personOf(line.line)));
      setChosen('');
    }
  };

  const said = (words: ReturnType<typeof refusalWords> | string, offerReload = false) => (
    <div data-share-said className="flex min-w-0 flex-col items-start gap-2">
      <p className="m-0 text-fg-muted">{typeof words === 'string' ? words : <Words {...words} />}</p>
      {offerReload && (
        <button type="button" onClick={reload} className={SECONDARY}>
          {SHARE.reload}
        </button>
      )}
    </div>
  );
  const ready = read.state === 'ready';

  return (
    <Sheet title={OWNER.title} width="w-[min(440px,90vw)]" data-owner-sheet={address}>
      <SheetForm
        canSubmit={ready && chosen !== '' && !saving}
        onSubmit={() => void save()}
        submitLabel={ready ? (saving ? OWNER.adding : OWNER.add) : undefined}
        submitClass={PRIMARY}
        cancelLabel={!ready || outcome !== null ? SHARE.close : undefined}
      >
        <div data-share-session className="flex min-w-0 text-ui-sm text-fg-muted" title={subtitleTooltip(title, machine)}>
          <span className="min-w-0 truncate">{title}</span>
          <span className="max-w-[50%] shrink-0 truncate whitespace-pre"> · {machine}</span>
        </div>
        {read.state === 'reading' && said(SHARE.reading)}
        {read.state === 'unsupported' && said(SHARE.unsupported(machine))}
        {read.state === 'unavailable' && said(SHARE.unavailable, true)}
        {read.state === 'refused' && said(refusalWords(read.reason, machine), true)}
        {ready && (
          <>
            <p className="m-0 text-ui-sm text-fg-muted">{OWNER.line}</p>
            <select aria-label={OWNER.person} value={chosen} disabled={saving || addable.length === 0} onChange={(e) => setChosen(e.target.value)} className={`${SELECT} min-w-0`}>
              <option value="">{view === null ? OWNER.noMembers : addable.length === 0 && view !== 'reading' ? OWNER.nobodyToAdd : OWNER.choose}</option>
              {addable.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.email}
                </option>
              ))}
            </select>
          </>
        )}
        {outcome !== null && (
          <div className="flex min-w-0 flex-col gap-1 text-ui-sm">
            <p data-owner-outcome={outcome.state} data-reason={'reason' in outcome ? outcome.reason : undefined} className="m-0 min-w-0 [overflow-wrap:anywhere]">
              <span className="text-fg">{nameOf(personOf(outcome.line))}</span>
              <span className="text-fg-muted"> · </span>
              <span className={outcome.state === 'done' ? 'text-fg-muted' : 'text-danger'}>
                <Words {...ownerOutcomeWords(outcome, machine)} />
              </span>
            </p>
            {outcome.state === 'done' && outcome.changed && <p className="m-0 text-fg-faint">{OWNER.relisted(machine)}</p>}
          </div>
        )}
        {refusal !== null && (
          <p role="alert" data-owner-refusal={refusal} className="m-0 text-ui-sm text-danger [overflow-wrap:anywhere]">
            <Words {...refusalWords(refusal, machine)} />
          </p>
        )}
      </SheetForm>
    </Sheet>
  );
}

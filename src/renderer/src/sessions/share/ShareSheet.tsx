// The Share sheet (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b's "At its end" and Decisions;
// Q4 as O18 amended it), opened from a session's header (the Toolbar's session actions) and its row's menu, for a session
// you own (target.ts). Shaped like a shared document's: the general access, each with its line; the people it is shared
// with, each at Can message, View, Converse or Approve, and Add person; the foot; and Save, which main signs with one
// Touch ID for everything it changes (`org.policy.set`), sending the acts in the sheet's order: the access, then each
// share changed or removed in the people's order, then each added.
//
// - It opens on a fresh read of the session's policy (`org.policy.get {address}`). A machine whose sminos can't keep a
//   session's reach says so and offers nothing; a session whose reach can't be read, or a read refused, says why and
//   offers a reload.
// - The revision check is main's and best effort: a revision moved before or after Touch ID sends nothing and reads
//   "Changed elsewhere: reload". After a save each line shows what became of it, a line whose revision skipped one marked
//   "also changed elsewhere", and the sheet then shows the policy as main read it after the save. A line whose outcome
//   is unknown stopped the save: it says so, the lines after it weren't sent, and a reload reads the reach as it stands.
// - Every refusal reads in its own words (copy.ts); a reason no line knows shows one line naming the machine, the raw word
//   beside it.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { RecordPolicyEntry } from '@shared/ipc/schema/endpoint';
import { FORMER_MEMBER, type OrgPolicySetInput, type OrgPolicySetResult, type OrgView } from '@shared/ipc/schema/org';
import { bareOf } from '@shared/machine/address';
import { useMachineMark } from '../../app/machine-mark';
import { ipc } from '../../ipc/client';
import { useHubAccess } from '../../stores/hub-access';
import { useSessions, type ListedSession } from '../../stores/sessions';
import { Sheet, SheetForm } from '../Sheet';
import { displayTitle, listedTitle } from '../title';
import { CHOICE, PRIMARY, QUIET, SECONDARY } from '../ui';
import { ACCESS_ORDER, GRADE_ORDER, lineWords, outcomeWords, refusalWords, SHARE, type ShareAccess, type ShareGrade } from './copy';

// A select drawn as the sheets' fields are (ui.ts's FIELD), sized by its row rather than taking the row's whole width.
const SELECT = 'rounded-sm border border-border-strong bg-bg px-2 py-1 text-ui text-fg outline-accent focus-visible:outline-2';

type Policy = Extract<RecordPolicyEntry, { policyRev: number }>;
type Share = { member: string; grade: ShareGrade };
type Read = { state: 'reading' } | { state: 'refused'; reason: string } | { state: 'unsupported' } | { state: 'unavailable' } | { state: 'ready'; policy: Policy };
type Saved = Extract<OrgPolicySetResult, { ok: true }>;

/** The policy's read for the sheet, from `org.policy.get {address}`'s answer. */
async function readPolicy(address: AppSessionId): Promise<Read> {
  const result = await ipc.invoke('org.policy.get', { address });
  if (!result.ok) return { state: 'refused', reason: result.error.code };
  const read = result.value;
  if (!read.ok) return { state: 'refused', reason: read.reason };
  if (!read.supported) return { state: 'unsupported' };
  const session = bareOf(address);
  const entry = read.policies.find((p) => p.session === session);
  return entry === undefined || 'unavailable' in entry ? { state: 'unavailable' } : { state: 'ready', policy: entry };
}

/**
 * A save's input from the policy the sheet opened on and the draft: the access if it changed, then each share changed or
 * removed in the policy's order, then each added in the order it was added. Null when nothing changed.
 */
export function saveOf(address: AppSessionId, policy: Policy, access: ShareAccess, draft: readonly Share[]): OrgPolicySetInput | null {
  const now = new Map(draft.map((s) => [s.member, s.grade]));
  const was = new Set(policy.shares.map((s) => s.member));
  const shares: { member: string; grade: ShareGrade | null }[] = [];
  for (const share of policy.shares) {
    const grade = now.get(share.member) ?? null;
    if (grade !== share.grade) shares.push({ member: share.member, grade });
  }
  for (const share of draft) if (!was.has(share.member)) shares.push(share);
  const changedAccess = access !== policy.access;
  if (!changedAccess && shares.length === 0) return null;
  return { address, ...(changedAccess ? { access } : {}), ...(shares.length > 0 ? { shares } : {}), policyRev: policy.policyRev };
}

/** A refusal or an outcome's words, the raw word of an unknown reason secondary. */
function Words({ text, raw }: { text: string; raw: string | null }) {
  return (
    <>
      <span>{text}</span>
      {raw !== null && (
        <span data-share-raw title={raw} className="ml-1.5 inline-block max-w-[16ch] truncate align-bottom text-fg-faint">
          {raw}
        </span>
      )}
    </>
  );
}

export function ShareSheet({ address }: { address: AppSessionId }) {
  const machine = useMachineMark(address).name;
  const title = useSessions((s) => {
    const record = s.records.get(address);
    const listed = s.listed.get(address as ListedSession['appId']);
    return record !== undefined ? displayTitle(record) : listed !== undefined ? listedTitle(listed) : '';
  });
  const owners = useSessions((s) => s.listed.get(address as ListedSession['appId'])?.owners);
  const rowNames = useSessions((s) => s.members);
  const me = useHubAccess((s) => s.member);
  const [read, setRead] = useState<Read>({ state: 'reading' });
  const [view, setView] = useState<OrgView | null | 'reading'>('reading');
  const [access, setAccess] = useState<ShareAccess>('listed');
  const [draft, setDraft] = useState<Share[]>([]);
  const [adding, setAdding] = useState<{ member: string; grade: ShareGrade }>({ member: '', grade: 'view' });
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  const take = (next: Read) => {
    setRead(next);
    if (next.state !== 'ready') return;
    setAccess(next.policy.access);
    setDraft(next.policy.shares.map((s) => ({ ...s })));
  };
  const reload = () => {
    setRefusal(null);
    setSaved(null);
    setRead({ state: 'reading' });
    void readPolicy(address).then(take);
  };
  useEffect(() => {
    let live = true;
    void readPolicy(address).then((next) => live && take(next));
    void ipc.invoke('org.view', undefined).then((result) => live && setView(result.ok ? result.value : null));
    return () => {
      live = false;
    };
  }, [address]);

  const names = useMemo(() => new Map(view !== null && view !== 'reading' ? view.members.map((m) => [m.id, m]) : []), [view]);
  const nameOf = (member: string) => (member === me ? SHARE.you : (names.get(member)?.name ?? rowNames.get(member)?.name ?? FORMER_MEMBER));
  const emailOf = (member: string) => names.get(member)?.email ?? rowNames.get(member)?.email ?? null;
  const ready = read.state === 'ready' ? read.policy : null;
  const change = ready === null ? null : saveOf(address, ready, access, draft);
  const unknown = saved?.results.find((r) => r.state === 'unknown');
  const addable = view !== null && view !== 'reading' ? view.members.filter((m) => !m.you && !draft.some((s) => s.member === m.id) && !(owners ?? []).includes(m.id)) : [];

  const save = async () => {
    if (change === null) return;
    setSaving(true);
    setRefusal(null);
    setSaved(null);
    const result = await ipc.invoke('org.policy.set', change);
    setSaving(false);
    if (!result.ok) return setRefusal(result.error.code);
    if (!result.value.ok) return setRefusal(result.value.reason);
    setSaved(result.value);
    // the policy as main read it after the save
    take(result.value.policy === null ? { state: 'unavailable' } : 'unavailable' in result.value.policy ? { state: 'unavailable' } : { state: 'ready', policy: result.value.policy });
  };

  const said = (text: string, extra?: ReactNode) => (
    <p data-share-said className="m-0 text-fg-muted">
      {text}
      {extra}
    </p>
  );
  const reloadButton = (
    <button type="button" onClick={reload} className={`${QUIET} ml-1`}>
      {SHARE.reload}
    </button>
  );

  return (
    <Sheet title={SHARE.title} width="w-[min(480px,90vw)]" data-share-sheet={address}>
      <SheetForm canSubmit={change !== null && !saving} onSubmit={() => void save()} submitLabel={ready === null ? undefined : saving ? SHARE.saving : SHARE.save} submitClass={PRIMARY} cancelLabel={ready === null || saved !== null ? SHARE.close : undefined}>
        <div data-share-session className="flex min-w-0 text-ui-sm text-fg-muted" title={title}>
          <span className="min-w-0 truncate">{title}</span>
          <span className="max-w-[50%] shrink-0 truncate whitespace-pre"> · {machine}</span>
        </div>
        <div data-share-body className="flex max-h-[52vh] min-w-0 flex-col gap-3 overflow-y-auto">
          {saved !== null && (
            <section aria-label={SHARE.results} data-share-results className="flex min-w-0 flex-col gap-1 rounded-sm border border-border p-2 text-ui-sm">
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {saved.results.map((outcome, i) => (
                  <li key={i} data-share-outcome={outcome.state} data-reason={'reason' in outcome ? outcome.reason : undefined} data-elsewhere={(outcome.state === 'done' && outcome.elsewhere) || undefined} className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="text-fg">{lineWords(outcome.line, nameOf)}</span>
                    <span className="text-fg-muted"> · </span>
                    <span className={outcome.state === 'done' || outcome.state === 'not-sent' ? 'text-fg-muted' : 'text-danger'}>
                      <Words {...outcomeWords(outcome, machine)} />
                    </span>
                  </li>
                ))}
              </ul>
              {unknown !== undefined && (
                <p data-share-stopped className="m-0 text-fg-muted">
                  {SHARE.stopped}
                  {reloadButton}
                </p>
              )}
            </section>
          )}
          {refusal !== null && (
            <p role="alert" data-share-refusal={refusal} className="m-0 text-ui-sm text-danger [overflow-wrap:anywhere]">
              <Words {...refusalWords(refusal, machine)} />
              {refusal === 'changed-elsewhere' && reloadButton}
            </p>
          )}
          {read.state === 'reading' && said(SHARE.reading)}
          {read.state === 'unsupported' && said(SHARE.unsupported(machine))}
          {read.state === 'unavailable' && said(SHARE.unavailable, reloadButton)}
          {read.state === 'refused' && (
            <p data-share-said className="m-0 text-fg-muted">
              <Words {...refusalWords(read.reason, machine)} />
              {reloadButton}
            </p>
          )}
          {ready !== null && (
            <>
              <fieldset disabled={saving} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                <legend className="mb-1 p-0 text-ui-sm font-medium text-fg">{SHARE.general}</legend>
                {ACCESS_ORDER.map((level) => (
                  <label key={level} data-share-access={level} className="flex min-w-0 cursor-default items-start gap-2">
                    <input type="radio" name="share-access" value={level} checked={access === level} onChange={() => setAccess(level)} className={`${CHOICE} mt-[3px] shrink-0`} />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-ui text-fg">{SHARE.access[level].label}</span>
                      <span className="text-ui-sm text-fg-muted">{SHARE.access[level].line}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset disabled={saving} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                <legend className="mb-1 p-0 text-ui-sm font-medium text-fg">{SHARE.people}</legend>
                {draft.length === 0 ? (
                  <p className="m-0 text-ui-sm text-fg-muted">{SHARE.nobody}</p>
                ) : (
                  <ul aria-label={SHARE.people} className="m-0 flex list-none flex-col gap-2 p-0">
                    {draft.map((share) => (
                      <li key={share.member} data-share-person={share.member} className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-ui text-fg">{nameOf(share.member)}</span>
                            {emailOf(share.member) !== null && <span className="truncate text-ui-sm text-fg-muted">{emailOf(share.member)}</span>}
                          </span>
                          <GradeSelect label={SHARE.gradeOf(nameOf(share.member))} grade={share.grade} onChange={(grade) => setDraft((d) => d.map((s) => (s.member === share.member ? { ...s, grade } : s)))} />
                          <button type="button" aria-label={SHARE.remove(nameOf(share.member))} title={SHARE.remove(nameOf(share.member))} onClick={() => setDraft((d) => d.filter((s) => s.member !== share.member))} className={`${QUIET} shrink-0 px-1.5`}>
                            ✕
                          </button>
                        </div>
                        <span className="text-ui-sm text-fg-muted">{SHARE.grade[share.grade].line}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div data-share-add className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <select
                      aria-label={SHARE.addPerson}
                      value={adding.member}
                      disabled={addable.length === 0}
                      onChange={(e) => setAdding((a) => ({ ...a, member: e.target.value }))}
                      className={`${SELECT} min-w-0 flex-1`}
                    >
                      <option value="">{view === null ? SHARE.noMembers : addable.length === 0 && view !== 'reading' ? SHARE.nobodyToAdd : SHARE.choose}</option>
                      {addable.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} · {m.email}
                        </option>
                      ))}
                    </select>
                    <GradeSelect label={SHARE.newGrade} grade={adding.grade} onChange={(grade) => setAdding((a) => ({ ...a, grade }))} />
                    <button
                      type="button"
                      disabled={adding.member === ''}
                      onClick={() => {
                        setDraft((d) => [...d, { member: adding.member, grade: adding.grade }]);
                        setAdding((a) => ({ ...a, member: '' }));
                      }}
                      className={`${SECONDARY} shrink-0`}
                    >
                      {SHARE.add}
                    </button>
                  </div>
                  <span className="text-ui-sm text-fg-muted">{SHARE.grade[adding.grade].line}</span>
                </div>
              </fieldset>
              <p data-share-foot className="m-0 text-ui-sm text-fg-faint">
                {SHARE.foot}
              </p>
            </>
          )}
        </div>
      </SheetForm>
    </Sheet>
  );
}

function GradeSelect({ label, grade, onChange }: { label: string; grade: ShareGrade; onChange(grade: ShareGrade): void }) {
  return (
    <select aria-label={label} value={grade} onChange={(e) => onChange(e.target.value as ShareGrade)} className={`${SELECT} shrink-0`}>
      {GRADE_ORDER.map((g) => (
        <option key={g} value={g}>
          {SHARE.grade[g].label}
        </option>
      ))}
    </select>
  );
}

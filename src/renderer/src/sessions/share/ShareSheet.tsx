// The Share sheet (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b's "At its end" and Decisions;
// Q4 as O18 amended it), opened from a session's header (the Toolbar's session actions) and its row's menu, for a session
// you own (target.ts). Shaped like a shared document's: the general access, each with its line; Add person, then the
// people it is shared with under it, each at Can message, View, Converse or Approve; the foot; and Save, which main signs
// with one Touch ID for everything it changes (`org.policy.set`), sending the acts in the order the sheet shows them:
// the access, then each person's change top to bottom (the policy's people in its order, then each added). A person
// removed stays in their place, marked, until Save; a failure stops the acts after it, so the order shown is the order
// that matters.
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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { RecordPolicyEntry } from '@shared/ipc/schema/endpoint';
import { FORMER_MEMBER, type OrgPolicySetInput, type OrgPolicySetResult, type OrgView } from '@shared/ipc/schema/org';
import { bareOf } from '@shared/machine/address';
import { useMachineMark } from '../../app/machine-mark';
import { ipc } from '../../ipc/client';
import { useHubAccess } from '../../stores/hub-access';
import { useSessions, type ListedSession } from '../../stores/sessions';
import { closeDialog } from '../dialogs';
import { Sheet, SheetForm } from '../Sheet';
import { displayTitle, listedTitle } from '../title';
import { CHOICE, PRIMARY, QUIET, SECONDARY } from '../ui';
import { ACCESS_ORDER, GRADE_ORDER, lineWords, outcomeWords, refusalWords, SHARE, subtitleTooltip, type ShareAccess, type ShareGrade } from './copy';

// A select drawn as the sheets' fields are (ui.ts's FIELD), sized by its row rather than taking the row's whole width.
export const SELECT = 'rounded-sm border border-border-strong bg-bg px-2 py-1 text-ui text-fg outline-accent focus-visible:outline-2';

type Policy = Extract<RecordPolicyEntry, { policyRev: number }>;
/**
 * A person in the sheet's list: the grade the policy gave them (null for one added here) and the grade the sheet now
 * gives them (null for one to remove). The list's order is the order Save sends their changes.
 */
export type Person = { member: string; was: ShareGrade | null; grade: ShareGrade | null };
export type Read = { state: 'reading' } | { state: 'refused'; reason: string } | { state: 'unsupported' } | { state: 'unavailable' } | { state: 'ready'; policy: Policy };
type Saved = Extract<OrgPolicySetResult, { ok: true }>;

/** The policy's read for the sheet (and M5b's Add owner sheet), from `org.policy.get {address}`'s answer. */
export async function readPolicy(address: AppSessionId): Promise<Read> {
  const result = await ipc.invoke('org.policy.get', { address });
  if (!result.ok) return { state: 'refused', reason: result.error.code };
  const read = result.value;
  if (!read.ok) return { state: 'refused', reason: read.reason };
  if (!read.supported) return { state: 'unsupported' };
  const session = bareOf(address);
  const entry = read.policies.find((p) => p.session === session);
  return entry === undefined || 'unavailable' in entry ? { state: 'unavailable' } : { state: 'ready', policy: entry };
}

/** What a person's line will change on Save, if anything. */
function pendingOf(person: Person): 'add' | 'change' | 'remove' | undefined {
  if (person.grade === person.was) return undefined;
  return person.was === null ? 'add' : person.grade === null ? 'remove' : 'change';
}

/**
 * A save's input from the policy the sheet opened on and its people: the access if it changed, then each person's change
 * in the list's order. Null when nothing changed.
 */
export function saveOf(address: AppSessionId, policy: Policy, access: ShareAccess, people: readonly Person[]): OrgPolicySetInput | null {
  const shares = people.filter((p) => pendingOf(p) !== undefined).map(({ member, grade }) => ({ member, grade }));
  const changedAccess = access !== policy.access;
  if (!changedAccess && shares.length === 0) return null;
  return { address, ...(changedAccess ? { access } : {}), ...(shares.length > 0 ? { shares } : {}), policyRev: policy.policyRev };
}

/** A refusal or an outcome's words, the raw word of an unknown reason secondary. */
export function Words({ text, raw }: { text: string; raw: string | null }) {
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

/**
 * The sheet belongs to the reader it opened for: what it holds (the policy, the people, the org's directory, a save's
 * results) is theirs. When who is signed in changes (a sign-out, here or in another window; a registration lost; another
 * member) the sheet closes at once, drawing none of it, and nothing it asked for lands anywhere.
 */
export function ShareSheet({ address }: { address: AppSessionId }) {
  const me = useHubAccess((s) => s.member);
  const [reader] = useState(me);
  const ended = me !== reader;
  useEffect(() => {
    if (ended) closeDialog();
  }, [ended]);
  return ended ? null : <ReaderSheet address={address} me={reader} />;
}

function ReaderSheet({ address, me }: { address: AppSessionId; me: string | null }) {
  const machine = useMachineMark(address).name;
  const title = useSessions((s) => {
    const record = s.records.get(address);
    const listed = s.listed.get(address as ListedSession['appId']);
    return record !== undefined ? displayTitle(record) : listed !== undefined ? listedTitle(listed) : '';
  });
  const owners = useSessions((s) => s.listed.get(address as ListedSession['appId'])?.owners);
  const rowNames = useSessions((s) => s.members);
  const [read, setRead] = useState<Read>({ state: 'reading' });
  const [view, setView] = useState<OrgView | null | 'reading'>('reading');
  const [access, setAccess] = useState<ShareAccess>('listed');
  const [people, setPeople] = useState<Person[]>([]);
  const [adding, setAdding] = useState<{ member: string; grade: ShareGrade }>({ member: '', grade: 'view' });
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  // whether the sheet is still open for its reader: an answer after it closed is dropped
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const take = (next: Read) => {
    setRead(next);
    if (next.state !== 'ready') return;
    setAccess(next.policy.access);
    setPeople(next.policy.shares.map((s) => ({ member: s.member, was: s.grade, grade: s.grade })));
  };
  const reload = () => {
    setRefusal(null);
    setSaved(null);
    setRead({ state: 'reading' });
    void readPolicy(address).then((next) => live.current && take(next));
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
  const change = ready === null ? null : saveOf(address, ready, access, people);
  const unknown = saved?.results.find((r) => r.state === 'unknown');
  const addable = view !== null && view !== 'reading' ? view.members.filter((m) => !m.you && !people.some((p) => p.member === m.id) && !(owners ?? []).includes(m.id)) : [];

  const save = async () => {
    if (change === null) return;
    setSaving(true);
    setRefusal(null);
    setSaved(null);
    const result = await ipc.invoke('org.policy.set', change);
    if (!live.current) return;
    setSaving(false);
    if (!result.ok) return setRefusal(result.error.code);
    if (!result.value.ok) return setRefusal(result.value.reason);
    setSaved(result.value);
    // the policy as main read it after the save
    take(result.value.policy === null ? { state: 'unavailable' } : 'unavailable' in result.value.policy ? { state: 'unavailable' } : { state: 'ready', policy: result.value.policy });
  };

  const reloadButton = (
    <button type="button" onClick={reload} className={SECONDARY}>
      {SHARE.reload}
    </button>
  );
  /** What the sheet says in place of a policy, Reload under it when `offerReload`. */
  const said = (words: ReactNode, offerReload = false) => (
    <div data-share-said className="flex min-w-0 flex-col items-start gap-2">
      <p className="m-0 text-fg-muted">{words}</p>
      {offerReload && reloadButton}
    </div>
  );

  return (
    <Sheet title={SHARE.title} width="w-[min(480px,90vw)]" data-share-sheet={address}>
      <SheetForm canSubmit={change !== null && !saving} onSubmit={() => void save()} submitLabel={ready === null ? undefined : saving ? SHARE.saving : SHARE.save} submitClass={PRIMARY} cancelLabel={ready === null || saved !== null ? SHARE.close : undefined}>
        <div data-share-session className="flex min-w-0 text-ui-sm text-fg-muted" title={subtitleTooltip(title, machine)}>
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
                <div data-share-stopped className="flex min-w-0 flex-col items-start gap-2">
                  <p className="m-0 text-fg-muted">{SHARE.stopped}</p>
                  {reloadButton}
                </div>
              )}
            </section>
          )}
          {refusal !== null && (
            <div role="alert" data-share-refusal={refusal} className="flex min-w-0 flex-col items-start gap-2 text-ui-sm">
              <p className="m-0 text-danger [overflow-wrap:anywhere]">
                <Words {...refusalWords(refusal, machine)} />
              </p>
              {refusal === 'changed-elsewhere' && reloadButton}
            </div>
          )}
          {read.state === 'reading' && said(SHARE.reading)}
          {read.state === 'unsupported' && said(SHARE.unsupported(machine))}
          {/* a save stopped by an unknown outcome offers its Reload in its results, the one Reload the sheet shows */}
          {read.state === 'unavailable' && unknown === undefined && said(SHARE.unavailable, true)}
          {read.state === 'refused' && said(<Words {...refusalWords(read.reason, machine)} />, true)}
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
                        setPeople((ps) => [...ps, { member: adding.member, was: null, grade: adding.grade }]);
                        setAdding((a) => ({ ...a, member: '' }));
                      }}
                      className={`${SECONDARY} shrink-0`}
                    >
                      {SHARE.add}
                    </button>
                  </div>
                  <span className="text-ui-sm text-fg-muted">{SHARE.grade[adding.grade].line}</span>
                </div>
                {people.length === 0 ? (
                  <p className="m-0 text-ui-sm text-fg-muted">{SHARE.nobody}</p>
                ) : (
                  <ul aria-label={SHARE.people} className="m-0 flex list-none flex-col gap-2 p-0">
                    {people.map((person) => {
                      const name = nameOf(person.member);
                      const email = emailOf(person.member);
                      const set = (grade: ShareGrade | null) => setPeople((ps) => ps.map((p) => (p.member === person.member ? { ...p, grade } : p)));
                      return (
                        <li key={person.member} data-share-person={person.member} data-share-pending={pendingOf(person)} className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={`flex min-w-0 flex-1 flex-col ${person.grade === null ? 'line-through' : ''}`}>
                              <span className={`truncate text-ui ${person.grade === null ? 'text-fg-muted' : 'text-fg'}`}>{name}</span>
                              {email !== null && <span className="truncate text-ui-sm text-fg-muted">{email}</span>}
                            </span>
                            {person.grade === null ? (
                              <button type="button" aria-label={SHARE.undoRemove(name)} onClick={() => set(person.was)} className={`${SECONDARY} shrink-0`}>
                                {SHARE.undo}
                              </button>
                            ) : (
                              <>
                                <GradeSelect label={SHARE.gradeOf(name)} grade={person.grade} onChange={set} />
                                <button
                                  type="button"
                                  aria-label={SHARE.remove(name)}
                                  title={SHARE.remove(name)}
                                  // one added here leaves the list; one the policy holds stays, marked, until Save
                                  onClick={() => (person.was === null ? setPeople((ps) => ps.filter((p) => p.member !== person.member)) : set(null))}
                                  className={`${QUIET} shrink-0 px-1.5`}
                                >
                                  ✕
                                </button>
                              </>
                            )}
                          </div>
                          <span className="text-ui-sm text-fg-muted">{person.grade === null ? SHARE.removing : SHARE.grade[person.grade].line}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
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

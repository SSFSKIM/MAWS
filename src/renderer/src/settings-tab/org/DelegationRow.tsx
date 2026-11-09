// One delegation's row in the Org group's Delegations section, and a stray hub key's line (P5 O8 M4c,
// docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4c's "At its end", *Renew*, *Drop*, *The held slot* and *The
// view*; Decision Log, "M4c's refresh at its cut" items 7-9, and the architect's rulings on stray keys). Built as the
// Machines group's row is (MachineRow.tsx, with MachinesGroup's Retry for a hub row left).
//
// - Its prefix (the row's label), its owners, its expiry in words, its uses against its cap and its id; the certified
//   machines it made, each live or retired; Renew… and Drop… (the change sheet) while this Mac may sign, for one in
//   effect.
// - The hub's side, an admin's read, from the head's comparison alone (`hubBehind`): a renewal the hub's key doesn't hold
//   yet, in the spec's words ("Renewed in the org state; the hub's key still expires <date>: Retry", or "this hub can't
//   renew its key yet" for a hub without the route), or a dropped delegation's key still live; Retry calls only the
//   route (`renewHub`, `revokeHub`), signing nothing. The last half that didn't finish (`hubProblem`) reads with its next
//   step. A key list that didn't read is "isn't read yet", never "no key".
// - An unsent delegation (signed into the pending slot, its code not stored): its reason, "Write the code again" while
//   this run holds its key pair (`unsent.rewrite`), and Discard (the slot's, by its hash, behind a confirmation saying
//   its minted key is revoked with it), which is all a relaunched Mac offers. Both act only on the slot that holds this
//   row's delegation (the status's `pending.delegation`), so a view not yet refreshed after another window's Discard
//   and a new proposal offers neither for the slot that replaced it; Write again names main's run, the row and that
//   slot, and its answer reads by where it stopped (Task 5's fix wave, I2 and I4).
import { useState } from 'react';
import { formatAgo, formatDate, formatDayTime } from '@shared/app/date-format';
import type { DelegationResult, OrgChange, OrgDelegationRow, OrgView } from '@shared/ipc/schema/org';
import { useNow } from '../../app/use-now';
import { GatewaySheet } from '../../gateway/GatewaySheet';
import { ipc } from '../../ipc/client';
import { ORG } from '../copy';
import { Chip, Setting, TEXT_ACTION } from '../parts';
import { discardOutcome, failed, inWords, memberName, OutcomeLine, type Outcome, type Registered } from './parts';

type Pending = NonNullable<NonNullable<Registered['signer']>['pending']>;
type Stray = OrgView['strayKeys'][number];
type HubLine = { text: string; warn: boolean; retry: boolean };

const day = (iso: string) => formatDate(Date.parse(iso));

/** The hub's side of `d` in one line, from the comparison and the last good read; null when there's nothing to say. */
function hubLine(d: OrgDelegationRow, hubKeys: OrgView['hubKeys'], now: number): HubLine | null {
  if (d.state === 'unsent') return null; // its key is minted; the hub's side follows once it is published
  if (d.hubBehind === 'revoke') return { text: ORG.hubBehindRevoke, warn: true, retry: true };
  if (d.hubBehind === 'renew') return { text: d.hubProblem?.reason === 'no-route' ? ORG.hubNoRoute : ORG.hubBehindRenew(day(d.hub?.expires ?? d.expires)), warn: true, retry: true };
  if (d.hub === null) return hubKeys.failed || hubKeys.at === null ? { text: ORG.hubUnread, warn: false, retry: false } : { text: ORG.hubNoKey, warn: true, retry: false };
  if (d.hub.revoked) return { text: ORG.hubKeyRevoked, warn: true, retry: false };
  if (Date.parse(d.hub.expires) <= now) return { text: ORG.hubKeyExpired(day(d.hub.expires)), warn: true, retry: false };
  if (d.hub.expires !== d.expires) return { text: ORG.hubExpires(day(d.hub.expires)), warn: false, retry: false };
  return null;
}

/** The last hub half that didn't finish, with its next step; null when the hub line above already says it. */
function problemLine(d: OrgDelegationRow, now: number): string | null {
  const problem = d.hubProblem;
  if (problem === null || d.state === 'unsent') return null;
  if (problem.reason === 'no-route' && d.hubBehind === 'renew') return null; // the row's own line
  if (problem.reason === 'ended' && d.hub !== null && (d.hub.revoked || Date.parse(d.hub.expires) <= now)) return null;
  return problem.reason === 'refused' ? `${ORG.hubHalfReasons.refused} ${problem.detail}` : ORG.hubHalfReasons[problem.reason];
}

const refusal = (lead: string, line: string, detail: string | undefined): Outcome => ({ text: [lead, line, detail].filter((part) => part !== undefined && part !== '').join(' · '), refused: true });

type RowProps = {
  delegation: OrgDelegationRow;
  members: OrgView['members'];
  /** The hub's side is read (an admin's: the hub lists its keys to admins alone). */
  hubSide: boolean;
  hubKeys: OrgView['hubKeys'];
  may: boolean;
  signedIn: boolean;
  /** The pending slot (signed in); an unsent row acts only on one holding its delegation, and Discard names its hash. */
  slot: Pending | null;
  /** A create or a write of this Mac's is under way. */
  creating: boolean;
  ask(title: string, change: OrgChange): void;
  /** A line for the section, for an act whose row may be gone once it settles. */
  said(outcome: Outcome): void;
};

export function DelegationRow({ delegation: d, members, hubSide, hubKeys, may, signedIn, slot, creating, ask, said }: RowProps) {
  const now = useNow();
  const [acting, setActing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  // The slot Discard was pressed for, by its hash: the confirmation is of that one proposal.
  const [discarding, setDiscarding] = useState<string | null>(null);
  // The slot holding this row's delegation, the only one its Discard and Write again act on.
  const own = slot !== null && slot.delegation === d.id ? slot : null;
  if (discarding !== null && own?.hash !== discarding) setDiscarding(null);
  const asked = own !== null && own.hash === discarding ? own : null;
  const generation = d.unsent?.generation ?? null;

  const hub = hubSide ? hubLine(d, hubKeys, now) : null;
  const problem = hubSide ? problemLine(d, now) : null;
  const owners = d.owners === 'org' ? ORG.ownedByOrg : ORG.ownedBy(inWords(d.owners.map((id) => memberName(members, id))));

  const retry = () => {
    setActing(true);
    setOutcome(null);
    const name = d.hubBehind === 'revoke' ? 'org.delegation.revokeHub' : 'org.delegation.renewHub';
    void ipc.invoke(name, { id: d.id }).then((result) => {
      setActing(false);
      if (!result.ok) failed(result.error);
      // A half that didn't finish comes back as the row's `hubProblem`; only "nothing to do" needs a line of its own.
      else if (!result.value.ok && result.value.reason === 'none') setOutcome({ text: ORG.hubHalfNone, refused: false });
    });
  };
  const rewrite = (run: { generation: number; id: string; hash: string }) => {
    setActing(true);
    setOutcome(null);
    void ipc.invoke('org.delegation.rewrite', run).then((result) => {
      setActing(false);
      if (!result.ok) failed(result.error);
      else written(result.value);
    });
  };
  // A published answer goes to the section (the row turns as it settles); a held one stays here.
  const written = (result: DelegationResult) => {
    if (result.ok) said({ text: result.secret === undefined ? ORG.signed(result.version) : ORG.codeStored(d.prefix, result.version, result.secret.version, formatDayTime(Date.parse(result.secret.createTime))), refused: false });
    else if (result.phase === 'published') said({ text: [ORG.phasePublished(result.version), result.detail].filter((part) => part !== undefined).join(' · '), refused: false });
    else if (result.phase === 'held' && result.stored) setOutcome(refusal(ORG.phaseHeldStored(result.version), ORG.heldDiscardOnly, result.detail));
    else if (result.reason === 'unsent') setOutcome({ text: ORG.stillUnsent, refused: true });
    else setOutcome(refusal(ORG.notWritten, ORG.rewriteReasons[result.reason], result.detail));
  };
  const discard = (pending: Pending) => {
    setDiscarding(null);
    void ipc.invoke('org.discardPending', { confirmed: true, hash: pending.hash }).then((result) => {
      if (!result.ok) failed(result.error);
      else said(result.value.ok ? { text: ORG.discardedDelegation(pending.version), refused: false } : discardOutcome(pending.version, result.value));
    });
  };

  return (
    <Setting label={d.prefix}>
      {d.state !== 'in-effect' && <Chip>{ORG.delegationStates[d.state]}</Chip>}
      {d.state !== 'dropped' && (
        <>
          <span className="text-fg-muted">{owners}</span>
          <span>{ORG.expiresIn(Date.parse(d.expires) - now)}</span>
          <span className="text-fg-muted">{ORG.uses(hubSide && d.hub !== null ? d.hub.uses : null, d.maxUses)}</span>
        </>
      )}
      <span className="font-mono text-fg-muted">{ORG.delegationId(d.id)}</span>
      {may && d.state === 'in-effect' && (
        <>
          <button type="button" className={TEXT_ACTION} onClick={() => ask(ORG.changeTitles['delegation.renew'](d.prefix), { kind: 'delegation.renew', id: d.id, expires: d.expires })}>
            {ORG.renew}
          </button>
          <button type="button" className={TEXT_ACTION} onClick={() => ask(ORG.changeTitles['delegation.drop'](d.prefix), { kind: 'delegation.drop', id: d.id })}>
            {ORG.drop}
          </button>
        </>
      )}
      {d.state !== 'dropped' && (
        <span className="basis-full text-fg-muted">{d.machines.length === 0 ? ORG.noCertified : ORG.certified(inWords(d.machines.map((m) => ORG.certifiedState(m.name, m.live))))}</span>
      )}
      {hub !== null && (
        <div className="flex min-w-0 basis-full flex-wrap items-center gap-2">
          <span className={hub.warn ? 'text-warning' : 'text-fg-muted'}>{hub.text}</span>
          {hub.retry && signedIn && (
            <button type="button" className={TEXT_ACTION} disabled={acting} onClick={retry}>
              {ORG.retry}
            </button>
          )}
        </div>
      )}
      {problem !== null && <span className="basis-full text-warning">{problem}</span>}
      {d.state === 'unsent' && d.unsent !== null && (
        <div className="flex min-w-0 basis-full flex-wrap items-center gap-2">
          <span className="text-warning">{d.unsent.rewrite ? ORG.unsentLine : ORG.unsentDiscardOnly}</span>
          {d.unsent.problem !== null && <span className="basis-full text-fg-muted">{d.unsent.problem}</span>}
          {d.unsent.rewrite && may && own !== null && generation !== null && (
            <button type="button" className={TEXT_ACTION} disabled={acting || creating} onClick={() => rewrite({ generation, id: d.id, hash: own.hash })}>
              {acting ? ORG.writing : ORG.writeAgain}
            </button>
          )}
          {own !== null && (
            <button type="button" className={TEXT_ACTION} disabled={acting} onClick={() => setDiscarding(own.hash)}>
              {ORG.discard}
            </button>
          )}
        </div>
      )}
      <OutcomeLine outcome={outcome} />
      {asked !== null && (
        <GatewaySheet title={ORG.discardDelegationTitle(d.prefix)} onClose={() => setDiscarding(null)} canSubmit onSubmit={() => discard(asked)} submitLabel={ORG.discardConfirm} cancelLabel={ORG.cancel}>
          <p className="m-0 text-ui-sm leading-normal text-fg-muted">{ORG.discardDelegationBody(asked.version)}</p>
        </GatewaySheet>
      )}
    </Setting>
  );
}

// A hub key no delegation names: its label and prefix, its age, its expiry, and Revoke behind a confirmation that says a
// create still under way would lose its key, more strongly for one minted within main's young threshold.
export function StrayKey({ stray, signedIn }: { stray: Stray; signedIn: boolean }) {
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const [acting, setActing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const ago = formatAgo(Math.max(0, now - Date.parse(stray.created)));
  const revoke = () => {
    setConfirming(false);
    setActing(true);
    setOutcome(null);
    void ipc.invoke('org.delegation.revokeHub', { id: stray.id }).then((result) => {
      setActing(false);
      if (!result.ok) failed(result.error);
      else if (!result.value.ok) setOutcome(result.value.reason === 'none' ? { text: ORG.hubHalfNone, refused: false } : refusal(ORG.notRevoked, ORG.hubHalfReasons[result.value.reason], result.value.detail));
    });
  };
  return (
    <div data-org-stray className="flex min-w-0 basis-full flex-wrap items-center gap-2">
      <span>{ORG.stray(stray.label, stray.prefix)}</span>
      <span className="text-fg-muted">{ORG.minted(ago)}</span>
      {stray.young && <Chip>{ORG.justMinted}</Chip>}
      <span className="text-fg-muted">{ORG.expiresIn(Date.parse(stray.expires) - now)}</span>
      {signedIn && (
        <button type="button" className={TEXT_ACTION} disabled={acting} onClick={() => setConfirming(true)}>
          {ORG.revokeStray}
        </button>
      )}
      <OutcomeLine outcome={outcome} />
      {confirming && (
        <GatewaySheet title={ORG.revokeStrayTitle(stray.label)} onClose={() => setConfirming(false)} canSubmit onSubmit={revoke} submitLabel={ORG.revokeStrayConfirm} cancelLabel={ORG.cancel}>
          {stray.young && <p className="m-0 mb-2 text-ui-sm leading-normal text-warning">{ORG.revokeStrayYoung(ago)}</p>}
          <p className="m-0 text-ui-sm leading-normal text-fg-muted">{ORG.revokeStrayBody}</p>
        </GatewaySheet>
      )}
    </div>
  );
}

// The Org page's Org group (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "At its end"):
// the org's id, the state's version and age, the roots as `deployment admin show`'s `rootLines` reads them, the recovery
// key's id, the problem held, and M3's signer lines, moved here unchanged from OrgSection.tsx: the root line (or the
// unmarked keys' words), the weekly line with Re-sign now, the pending slot with Discard behind `abandon-pending`'s
// confirmation, `signing` with Reset behind its own, the superseded states' revocations (Revoke again behind a sheet
// showing each revocation, consequence, warning and withheld name; the confirmation names the offer's digest), the
// machines still owing a delivery, the discarded proposals a hub or machine may hold, and a rekey's old device still
// listed, which M4a removes through the change sheet (`device.remove`) in place of M3's `remove-device` command.
import { useState } from 'react';
import { ORG_HEAD_BACKSTOP_DAYS, ORG_HEAD_WARN_DAYS, type DiscardResult, type OrgView } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { useNow } from '../../app/use-now';
import { GatewaySheet } from '../../gateway/GatewaySheet';
import { ipc } from '../../ipc/client';
import { useMachines } from '../../stores/machines';
import { machineName } from '../../stores/org-projects';
import { ORG } from '../copy';
import { Setting, TEXT_ACTION } from '../parts';
import { ChangeSheet } from './ChangeSheet';
import { failed, inWords, OutcomeLine, signOutcome, type Invoked, type Outcome, type Registered } from './parts';

type Signer = NonNullable<Registered['signer']>;
type Pending = NonNullable<Signer['pending']>;

const DAY_MS = 86_400_000;

export function OrgGroup({ status, view }: { status: Registered; view: OrgView | null }) {
  const signer = status.signer;
  const signing = status.session === 'signed-in' && status.problem !== 'held-chain';
  return (
    <>
      <Setting label={ORG.org}>
        <span className="font-mono">{status.org}</span>
      </Setting>
      <HeadAge head={status.head} />
      {view !== null && <Roots view={view} />}
      {view !== null && (
        <Setting label={ORG.recovery}>
          <span className="font-mono">{view.recoveryKid}</span>
        </Setting>
      )}
      {status.problem !== null && status.problem !== 'held-chain' && <Problem problem={status.problem} />}
      {signing && signer !== null && <SignerLines signer={signer} status={status} />}
    </>
  );
}

// Each root kid, and the device the head lists holding it: `rootLines`' reading.
function Roots({ view }: { view: OrgView }) {
  const holder = (member: string, device: string) => {
    const m = view.members.find((x) => x.id === member);
    const d = m?.devices.find((x) => x.id === device);
    return m === undefined || d === undefined ? ORG.unlistedRoot : ORG.rootHolder(m.email, d.id.slice(0, 8), ORG.classes[d.class]);
  };
  return (
    <Setting label={ORG.roots}>
      {view.roots.length === 0 && <span className="text-warning">{ORG.noRootListed}</span>}
      {view.roots.map((root) => (
        <div key={root.kid} className="flex min-w-0 basis-full flex-wrap items-center gap-2">
          <span className="font-mono">{root.kid}</span>
          <span className="text-fg-muted">{'unlisted' in root ? ORG.unlistedRoot : holder(root.member, root.device)}</span>
        </div>
      ))}
    </Setting>
  );
}

// The held problem in words; `signing` carries Reset behind its confirmation (org.resetSigning, the owner's explicit act).
function Problem({ problem }: { problem: NonNullable<Registered['problem']> }) {
  const [confirming, setConfirming] = useState(false);
  const reset = () => {
    setConfirming(false);
    void ipc.invoke('org.resetSigning', { confirmed: true }).then((result) => {
      if (!result.ok) failed(result.error);
    });
  };
  return (
    <Setting label={ORG.problem}>
      <span className="text-warning">{ORG.problems[problem]}</span>
      {problem === 'signing' && (
        <button type="button" className={TEXT_ACTION} onClick={() => setConfirming(true)}>
          {ORG.reset}
        </button>
      )}
      {confirming && (
        <GatewaySheet title={ORG.resetTitle} onClose={() => setConfirming(false)} canSubmit onSubmit={reset} submitLabel={ORG.resetConfirm} cancelLabel={ORG.cancel}>
          <p className="m-0 text-ui-sm leading-normal text-fg-muted">{ORG.resetBody}</p>
        </GatewaySheet>
      )}
    </Setting>
  );
}

function discardOutcome(version: number, result: DiscardResult): Outcome {
  if (result.ok) return { text: ORG.discarded(version, result.unsent, result.hubVersion, result.forkAt), refused: false };
  return { text: result.reason === undefined ? ORG.notDiscarded : `${ORG.notDiscarded} · ${ORG.discardReasons[result.reason](version)}`, refused: true };
}

// This Mac as the org's signer: the root line (or the unmarked keys' words), the weekly line, and every other line
// only while it has something to say. The acts here (Re-sign now, Revoke again, Discard, the old device's removal) end
// in one line on the Signer row, since the row that sent them may be gone once they settle.
function SignerLines({ signer, status }: { signer: Signer; status: Registered }) {
  const [acting, setActing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  // The proposal Discard was pressed for, by its stateHash: the owner's consent is to that one proposal.
  const [confirming, setConfirming] = useState<string | null>(null);
  // The offer Revoke again was pressed for, by its digest: the owner's consent is to the words the sheet shows.
  const [revoking, setRevoking] = useState<string | null>(null);
  // The old device Remove was pressed for: the change sheet shows what its removal signs.
  const [removing, setRemoving] = useState<string | null>(null);
  const machines = useMachines((s) => s.machines);
  const nameOf = (ref: string) => machineName(machines, ref as MachineRef, ipc.localMachine);
  const device = status.device;

  const act = <T,>(send: Invoked<T>, said: (value: T) => Outcome) => {
    setActing(true);
    setOutcome(null);
    void send.then((result) => {
      setActing(false);
      if (!result.ok) failed(result.error);
      else setOutcome(said(result.value));
    });
  };
  const resign = () => act(ipc.invoke('org.resign', undefined), signOutcome);
  const revoke = (digest: string) => {
    setRevoking(null);
    act(ipc.invoke('org.revokeSuperseded', { offer: digest }), signOutcome);
  };
  const discard = (slot: Pending) => {
    setConfirming(null);
    act(ipc.invoke('org.discardPending', { confirmed: true, hash: slot.hash }), (result) => discardOutcome(slot.version, result));
  };

  const unmarked = signer.rekey === 'unmarked';
  const guide = !unmarked && !signer.root; // the root add guidance, for a marked device not yet a root
  const weekly = signer.root && signer.due && signer.maySign ? signer.ageDays : null; // the age, while the weekly line shows
  const slot = signer.pending;
  // The sheet closes once its proposal settles or another replaces it, so a confirmation never reaches another slot
  // (main refuses a stale hash too).
  if (confirming !== null && slot?.hash !== confirming) setConfirming(null);
  const asked = slot !== null && slot.hash === confirming ? slot : null;
  const offer = signer.offer;
  // As Discard's: the sheet closes once the offer changes, so a confirmation never reaches other words (main refuses a
  // stale digest too).
  if (revoking !== null && offer?.digest !== revoking) setRevoking(null);
  const shownOffer = offer !== null && offer.digest === revoking ? offer : null;
  const held = signer.abandoned.filter((a) => a.hub || a.machines.length > 0); // a never-sent proposal can't show as a fork
  return (
    <>
      <Setting label={ORG.signer} note={guide ? ORG.rootNote(signer.fingerprint) : undefined}>
        {unmarked ? (
          <span className="text-fg-muted">{ORG.unmarked}</span>
        ) : signer.root ? (
          <span>{ORG.signs}</span>
        ) : (
          <>
            <span className="text-fg-muted">{ORG.makeRoot}</span>
            <span className="font-mono text-fg select-all">{ORG.rootCommand(device)}</span>
          </>
        )}
        {weekly !== null && (
          <>
            <span className="text-fg-muted">{ORG.weekly(weekly)}</span>
            <button type="button" className={TEXT_ACTION} disabled={acting} onClick={resign}>
              {ORG.resign}
            </button>
          </>
        )}
        <OutcomeLine outcome={outcome} />
      </Setting>
      {slot !== null && (
        <Setting label={ORG.pending}>
          <span className={slot.fork || slot.refused !== null ? 'text-warning' : 'text-fg-muted'}>
            {slot.fork ? ORG.pendingFork(slot.version) : slot.refused !== null ? ORG.pendingRefused(slot.version, slot.refused) : ORG.pendingWaits(slot.version)}
          </span>
          {(slot.fork || slot.refused !== null) && (
            <button type="button" className={TEXT_ACTION} disabled={acting} onClick={() => setConfirming(slot.hash)}>
              {ORG.discard}
            </button>
          )}
        </Setting>
      )}
      {offer !== null && (offer.superseded > 0 || offer.withheld.length > 0) && (
        <Setting label={ORG.revocations}>
          {offer.superseded > 0 && <span>{ORG.offer(offer.superseded)}</span>}
          {offer.superseded > 0 && signer.maySign && (
            <button type="button" className={TEXT_ACTION} disabled={acting} onClick={() => setRevoking(offer.digest)}>
              {ORG.revoke}
            </button>
          )}
          {offer.withheld.map((name) => (
            <span key={name} className="basis-full text-ui-sm text-fg-muted">
              {ORG.withheld(name)}
            </span>
          ))}
        </Setting>
      )}
      {signer.owing.length > 0 && (
        <Setting label={ORG.deliveries}>
          {signer.owing.map((owed) => {
            const waiting = owed.machines.filter((ref) => !owed.tooLarge.includes(ref)).map(nameOf);
            const tooLarge = owed.tooLarge.map(nameOf);
            return (
              <span key={owed.version} className="basis-full text-fg-muted">
                {ORG.owing(owed.version, waiting.length === 0 ? null : inWords(waiting), tooLarge.length === 0 ? null : inWords(tooLarge))}
              </span>
            );
          })}
        </Setting>
      )}
      {held.length > 0 && (
        <Setting label={ORG.discardedRow}>
          {held.map((a) => (
            <span key={a.hash} className="basis-full text-fg-muted">
              {ORG.abandoned(a.version, inWords([...(a.hub ? [ORG.theHub] : []), ...a.machines.map(nameOf)]))}
            </span>
          ))}
        </Setting>
      )}
      {signer.oldDevice !== null && (
        <Setting label={ORG.oldDevice}>
          <span className="font-mono">{signer.oldDevice.slice(0, 8)}</span>
          <span className="text-fg-muted">{ORG.oldDeviceLine}</span>
          {signer.maySign && (
            <button type="button" className={TEXT_ACTION} disabled={acting} onClick={() => setRemoving(signer.oldDevice)}>
              {ORG.removeOld}
            </button>
          )}
        </Setting>
      )}
      {removing !== null && (
        <ChangeSheet
          title={ORG.changeTitles['device.remove'](status.member.email)}
          change={{ kind: 'device.remove', member: status.member.id, device: removing }}
          may={signer.maySign}
          onClose={() => setRemoving(null)}
          onSigned={(version) => setOutcome({ text: ORG.signed(version), refused: false })}
        />
      )}
      {shownOffer !== null && (
        <GatewaySheet title={ORG.revokeTitle} onClose={() => setRevoking(null)} canSubmit onSubmit={() => revoke(shownOffer.digest)} submitLabel={ORG.revokeConfirm} cancelLabel={ORG.cancel}>
          <p className="m-0 text-ui-sm leading-normal text-fg">{ORG.revokeIntro}</p>
          <ul className="m-0 mt-2 list-disc pl-5 text-ui-sm leading-normal text-fg">
            {shownOffer.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {shownOffer.warnings.map((warning, i) => (
            <p key={i} className="m-0 mt-2 text-ui-sm leading-normal text-warning">
              {ORG.revokeWarning(warning)}
            </p>
          ))}
          {shownOffer.withheld.map((name) => (
            <p key={name} className="m-0 mt-2 text-ui-sm leading-normal text-fg-muted">
              {ORG.withheld(name)}
            </p>
          ))}
        </GatewaySheet>
      )}
      {asked !== null && (
        <GatewaySheet title={ORG.discardTitle(asked.version)} onClose={() => setConfirming(null)} canSubmit onSubmit={() => discard(asked)} submitLabel={ORG.discardConfirm} cancelLabel={ORG.cancel}>
          {asked.exposed ? (
            <>
              <p className="m-0 text-ui-sm leading-normal text-fg">{ORG.discardAtHub(asked.version, asked.fork)}</p>
              <p className="m-0 mt-2 text-ui-sm leading-normal text-fg-muted">{ORG.discardWarning(asked.version)}</p>
            </>
          ) : (
            <p className="m-0 text-ui-sm leading-normal text-fg-muted">{ORG.discardUnsent(asked.version)}</p>
          )}
        </GatewaySheet>
      )}
    </>
  );
}

// The held org state's version and age in whole days, in the warning tone from ORG_HEAD_WARN_DAYS, the backstop named.
function HeadAge({ head }: { head: Registered['head'] }) {
  const now = useNow();
  const days = head === null ? 0 : Math.max(0, Math.floor((now - Date.parse(head.issued)) / DAY_MS));
  return (
    <Setting label={ORG.state} note={ORG.stateNote(ORG_HEAD_BACKSTOP_DAYS)}>
      {head === null ? <span className="text-fg-muted">{ORG.unverified}</span> : <span className={days >= ORG_HEAD_WARN_DAYS ? 'text-warning' : ''}>{ORG.version(head.version, days)}</span>}
    </Setting>
  );
}

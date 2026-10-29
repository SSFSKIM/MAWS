// The Org page's People group (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "At its end",
// "The rule the page states" and "Read-only, and refusals"): each member with email, role and devices, the roots and
// this Mac marked. While this Mac may sign (M3's `maySign`, the view's), it offers Add person, Remove person, a role
// change, Change email, Remove device, Make a root and Pair a device, each through its sheet; never one the composers
// refuse for yourself (your own removal or role, this Mac's own device). Make a root is offered on an admin's Mac that
// isn't one; the checks judge the rest. A later device of another member is stated, not offered: one who signs pairs it
// from their own Org page, and one who doesn't waits for the countersign flow. Read-only otherwise, with the roots' emails.
import { useState } from 'react';
import { formatClock } from '@shared/app/date-format';
import type { OrgChange, OrgPairingStatus, OrgView } from '@shared/ipc/schema/org';
import { ORG } from '../copy';
import { Setting, TEXT_ACTION, Chip } from '../parts';
import { ChangeSheet } from './ChangeSheet';
import { PairSheet } from './PairSheet';
import { DeviceLine, inWords, OutcomeLine, type Member, type Outcome } from './parts';

type Asked = { title: string; change: OrgChange };
/** The pairing sheet open on a member; `follow` the generation the sheet takes up when reopened on a running pairing. */
type Pairing = { member: Member; follow: number | null };

export function PeopleGroup({ view, pairing }: { view: OrgView; pairing: OrgPairingStatus }) {
  const [asked, setAsked] = useState<Asked | null>(null);
  const [pairOn, setPairOn] = useState<Pairing | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const may = view.maySign;
  const ask = (title: string, change: OrgChange) => {
    setOutcome(null);
    setAsked({ title, change });
  };
  const roots = [...new Set(view.roots.flatMap((root) => ('unlisted' in root ? [] : (view.members.find((m) => m.id === root.member)?.email ?? []))))];
  return (
    <>
      {view.members.map((member) => (
        <MemberRow key={member.id} member={member} may={may} pairing={pairing?.member === member.id ? pairing : null} ask={ask} pair={(follow) => setPairOn({ member, follow })} />
      ))}
      <div className="flex min-h-[34px] flex-wrap items-center gap-2 py-1 text-ui-sm">
        {may ? (
          <button type="button" className={TEXT_ACTION} onClick={() => ask(ORG.changeTitles['member.add'], { kind: 'member.add', email: '', role: 'member' })}>
            {ORG.addPerson}
          </button>
        ) : (
          <>
            <span className="text-fg-muted">{ORG.readOnly}</span>
            {roots.length > 0 && <span className="text-fg-muted">{ORG.rootsAre(inWords(roots))}</span>}
          </>
        )}
        <OutcomeLine outcome={outcome} />
      </div>
      {asked !== null && <ChangeSheet title={asked.title} change={asked.change} onClose={() => setAsked(null)} onSigned={(version) => setOutcome({ text: ORG.signed(version), refused: false })} />}
      {pairOn !== null && <PairSheet member={pairOn.member} pairing={pairing} follow={pairOn.follow} onClose={() => setPairOn(null)} />}
    </>
  );
}

type RowProps = {
  member: Member;
  may: boolean;
  /** This member's pairing, while one runs. */
  pairing: OrgPairingStatus;
  ask(title: string, change: OrgChange): void;
  pair(follow: number | null): void;
};

function MemberRow({ member, may, pairing, ask, pair }: RowProps) {
  const { id, email } = member;
  const other = !member.you;
  const role = member.role === 'admin' ? 'member' : 'admin';
  const firstOrYours = member.you || member.devices.length === 0;
  const signs = member.devices.some((d) => d.root);
  const running = pairing !== null && pairing.problem === null;
  return (
    <Setting label={member.name}>
      <span>{email}</span>
      <Chip>{ORG.roles[member.role]}</Chip>
      {member.you && <Chip>{ORG.youMark}</Chip>}
      {may && other && (
        <button type="button" className={TEXT_ACTION} onClick={() => ask(ORG.changeTitles['member.role'](email, role), { kind: 'member.role', member: id, role })}>
          {role === 'admin' ? ORG.makeAdmin : ORG.makeMember}
        </button>
      )}
      {may && (
        <button type="button" className={TEXT_ACTION} onClick={() => ask(ORG.changeTitles['member.email'](email), { kind: 'member.email', member: id, email: '' })}>
          {ORG.changeEmail}
        </button>
      )}
      {may && other && (
        <button type="button" className={TEXT_ACTION} onClick={() => ask(ORG.changeTitles['member.remove'](email), { kind: 'member.remove', member: id })}>
          {ORG.removePerson}
        </button>
      )}
      {member.devices.length === 0 && <span className="basis-full text-fg-muted">{ORG.noDevices}</span>}
      {member.devices.map((device) => (
        <DeviceLine key={device.id} device={device}>
          {may && !device.thisMac && (
            <button type="button" className={TEXT_ACTION} onClick={() => ask(ORG.changeTitles['device.remove'](email), { kind: 'device.remove', member: id, device: device.id })}>
              {ORG.removeDevice}
            </button>
          )}
          {may && member.role === 'admin' && device.class === 'native-mac' && !device.root && (
            <button type="button" className={TEXT_ACTION} onClick={() => ask(ORG.changeTitles['root.add'](email), { kind: 'root.add', member: id, device: device.id })}>
              {ORG.makeDeviceRoot}
            </button>
          )}
        </DeviceLine>
      ))}
      {may && (
        <div className="flex basis-full flex-wrap items-center gap-2">
          {!firstOrYours ? (
            <span className="text-fg-muted">{signs ? ORG.laterDeviceRoot : ORG.laterDevice}</span>
          ) : running ? (
            <>
              <span className="text-fg-muted">{ORG.pairingUntil(formatClock(Date.parse(pairing.expires)))}</span>
              <button type="button" className={TEXT_ACTION} onClick={() => pair(pairing.generation)}>
                {ORG.pairingShow}
              </button>
            </>
          ) : (
            <button type="button" className={TEXT_ACTION} onClick={() => pair(null)}>
              {ORG.pairDevice}
            </button>
          )}
        </div>
      )}
    </Setting>
  );
}

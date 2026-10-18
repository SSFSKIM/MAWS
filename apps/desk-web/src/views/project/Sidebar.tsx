// The project's left column (§4): `# <project>`, then its sessions as direct channels grouped waiting on you /
// working / idle / ended, each named by its title (truncated to fit) with its machine and whether that is online, the
// alias it is addressed by muted under it (`SessionLabel`) — by its alias and machine on one line when it has no title —
// and its in-charge line under; "+ Session" below them. On a phone it is the project's first screen
// (mockups/desk/05-phone.html, 3A): full width, rows sized for a thumb, the group chat named as such, and no "+ Session"
// (starting a session stays off the phone in phase 1).
import type { Channel } from '../../shell/layout';
import type { DeskSession } from '../../shell/sessions';
import { GROUPS, type SessionGroup } from '../../log/projection';
import { SessionLabel } from '../../shell/SessionLabel';

const HEADINGS: Record<SessionGroup, string> = { waiting: 'Waiting on you', working: 'Working', idle: 'Idle', ended: 'Ended' };

export function Sidebar(props: {
  name: string;
  channel: Channel;
  groups: Record<SessionGroup, DeskSession[]> | null;
  locked: boolean;
  onSelect(channel: Channel): void;
  /** "+ Session", where the view offers it (not on a phone). */
  onSpawn?: () => void;
  /** The phone's channel list: nothing is selected there, and rows are a thumb's height. */
  phone?: boolean;
}) {
  const { name, channel, groups, locked, onSelect, onSpawn, phone = false } = props;
  const current = (c: Channel) => !phone && (c.kind === 'group' ? channel.kind === 'group' : channel.kind === 'session' && channel.session === c.session);
  return (
    <nav className={['flex min-h-0 flex-col overflow-y-auto bg-bg-raised px-2.5 py-2.5', phone ? '' : 'border-r border-border'].join(' ')} aria-label="Channels" data-phone={phone || undefined}>
      <button
        type="button"
        onClick={() => onSelect({ kind: 'group' })}
        aria-current={current({ kind: 'group' }) ? 'page' : undefined}
        className={['flex items-center gap-1.5 rounded-sm px-2.5 text-left text-ui', phone ? 'min-h-11' : 'h-[30px]', current({ kind: 'group' }) ? 'bg-bg-active text-fg' : 'text-fg hover:bg-bg-hover'].join(' ')}
      >
        <span className="text-fg-muted">#</span>
        <span className="truncate font-medium">{name}</span>
        {phone && <span className="text-ui-sm text-fg-muted">group chat</span>}
      </button>
      {locked ? (
        // Locked, the sidebar stays empty: no channels, no sessions, and no counts from the hub (the owner's ruling).
        <div className="mx-2.5 mt-4" data-testid="sidebar-locked">
          <p className="m-0 text-ui-sm font-medium text-fg">Locked</p>
          <p className="m-0 mt-1 text-ui-sm leading-4 text-fg-muted">Channels and sessions appear once this browser can read {name}'s log.</p>
        </div>
      ) : (
        groups &&
        GROUPS.filter((g) => groups[g].length > 0).map((group) => (
          <section key={group} aria-label={HEADINGS[group]} data-group={group} className="mt-3">
            <h3 className={['m-0 flex h-[22px] items-center px-2.5 text-label font-semibold tracking-[1px] uppercase', group === 'waiting' ? 'text-warning' : 'text-fg-muted'].join(' ')}>
              {HEADINGS[group]}
            </h3>
            {groups[group].map((session) => (
              <SessionRow key={session.session} session={session} phone={phone} selected={current({ kind: 'session', session: session.session })} onSelect={() => onSelect({ kind: 'session', session: session.session })} />
            ))}
          </section>
        ))
      )}
      {!locked && onSpawn && (
        <button type="button" onClick={onSpawn} className="mt-3 flex h-[30px] items-center rounded-sm px-2.5 text-left text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg">
          + Session
        </button>
      )}
    </nav>
  );
}

function SessionRow({ session, selected, phone, onSelect }: { session: DeskSession; selected: boolean; phone: boolean; onSelect(): void }) {
  const offline = session.machineOnline === false;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'page' : undefined}
      data-session={session.session}
      className={['block w-full rounded-sm px-2.5 text-left', phone ? 'py-2.5' : 'py-1.5', selected ? 'bg-bg-active' : 'hover:bg-bg-hover', offline || session.group === 'ended' ? 'text-fg-muted' : 'text-fg'].join(' ')}
    >
      <span className="flex min-w-0 items-baseline gap-1.5 text-ui-sm">
        <SessionLabel session={session} offline />
      </span>
      {session.charge && (
        <span className="mt-0.5 block truncate text-ui-sm text-fg-muted" data-testid="charge">
          {session.charge}
        </span>
      )}
    </button>
  );
}

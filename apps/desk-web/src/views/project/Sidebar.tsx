// The project's left column (§4): `# <project>`, then its sessions as direct channels grouped waiting on you /
// working / idle / ended, each with its machine and its in-charge line; "+ Session" below them.
import type { Channel } from '../../shell/layout';
import type { DeskSession } from '../../shell/sessions';
import { GROUPS, type SessionGroup } from '../../log/projection';

const HEADINGS: Record<SessionGroup, string> = { waiting: 'Waiting on you', working: 'Working', idle: 'Idle', ended: 'Ended' };

export function Sidebar(props: {
  name: string;
  channel: Channel;
  groups: Record<SessionGroup, DeskSession[]> | null;
  locked: boolean;
  onSelect(channel: Channel): void;
  onSpawn(): void;
}) {
  const { name, channel, groups, locked, onSelect, onSpawn } = props;
  return (
    <nav className="flex min-h-0 flex-col overflow-y-auto border-r border-border bg-bg-raised px-2.5 py-2.5" aria-label="Channels">
      <button
        type="button"
        onClick={() => onSelect({ kind: 'group' })}
        aria-current={channel.kind === 'group' ? 'page' : undefined}
        className={['flex h-[30px] items-center gap-1.5 rounded-sm px-2.5 text-left text-ui', channel.kind === 'group' ? 'bg-bg-active text-fg' : 'text-fg hover:bg-bg-hover'].join(' ')}
      >
        <span className="text-fg-muted">#</span>
        <span className="truncate font-medium">{name}</span>
      </button>
      {locked ? (
        <p className="mx-2.5 mt-4 text-ui-sm text-fg-muted" data-testid="sidebar-locked">
          Locked
        </p>
      ) : (
        groups &&
        GROUPS.filter((g) => groups[g].length > 0).map((group) => (
          <section key={group} aria-label={HEADINGS[group]} data-group={group} className="mt-3">
            <h3 className={['m-0 flex h-[22px] items-center px-2.5 text-label font-semibold tracking-[1px] uppercase', group === 'waiting' ? 'text-warning' : 'text-fg-muted'].join(' ')}>
              {HEADINGS[group]}
            </h3>
            {groups[group].map((session) => (
              <SessionRow key={session.session} session={session} selected={channel.kind === 'session' && channel.session === session.session} onSelect={() => onSelect({ kind: 'session', session: session.session })} />
            ))}
          </section>
        ))
      )}
      {!locked && (
        <button type="button" onClick={onSpawn} className="mt-3 flex h-[30px] items-center rounded-sm px-2.5 text-left text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg">
          + Session
        </button>
      )}
    </nav>
  );
}

function SessionRow({ session, selected, onSelect }: { session: DeskSession; selected: boolean; onSelect(): void }) {
  const offline = session.machineOnline === false;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'page' : undefined}
      data-session={session.session}
      className={['block w-full rounded-sm px-2.5 py-1.5 text-left', selected ? 'bg-bg-active' : 'hover:bg-bg-hover', offline || session.group === 'ended' ? 'text-fg-muted' : 'text-fg'].join(' ')}
    >
      <span className="flex min-w-0 items-baseline gap-1.5 text-ui-sm">
        <span className="truncate">{session.alias}</span>
        <span className="shrink-0 text-fg-muted" data-testid="machine">
          @{session.machine}
        </span>
        {offline && <span className="shrink-0 text-fg-faint">offline</span>}
      </span>
      {session.charge && (
        <span className="mt-0.5 block truncate text-ui-sm text-fg-muted" data-testid="charge">
          {session.charge}
        </span>
      )}
    </button>
  );
}

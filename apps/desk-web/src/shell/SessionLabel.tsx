// A session named where a view heads with it — a sidebar row, a direct channel's header, the depth column's header —
// in the owner's layout (2026-10-17):
//
//     GUI Agent Workspace…   @macbook  online
//     maws-fe
//
// the title (`sessionName`) truncated to fit and whole on hover, its machine and whether the machine is online after
// it; under it the alias, muted, which is still how `@` addresses it. A session with no title keeps the one line it
// had before titles: its alias and its machine. `name` styles the title or the alias that stands for it, `muted` the
// machine and the alias line. `offline`: an untitled session still says "offline" when its machine is, as a sidebar row
// always has.
//
// A session another of its project goes by the same name as (`namesake`) also carries its id's first eight characters,
// `#a5b99a8b`, and `seat` when its `joined` names a seat, so two rows that read alike are told apart: beside the alias
// under a title, else beside the name.
import { sessionName } from '../log/projection';

type Labeled = { title: string | null; alias: string; machine: string; machineOnline: boolean | null; session?: string; seat?: string; namesake?: boolean };

const WORD = 'shrink-0 text-ui-sm text-fg-faint';

export function SessionLabel(props: { session: Labeled; name?: string; muted?: string; offline?: boolean }) {
  const { session, name = '', muted = 'text-fg-muted', offline = false } = props;
  const machine = (
    <span className={`shrink-0 ${muted}`} data-testid="machine">
      @{session.machine}
    </span>
  );
  const apart = session.namesake && session.session && (
    <>
      <span className={`shrink-0 ${muted}`} data-testid="session-short" title={session.session}>
        #{session.session.slice(0, 8)}
      </span>
      {session.seat && (
        <span className={WORD} data-testid="seat-mark">
          seat
        </span>
      )}
    </>
  );
  if (!session.title)
    return (
      <>
        <span className={`min-w-0 truncate ${name}`} data-testid="session-name">
          {sessionName(session)}
        </span>
        {apart}
        {machine}
        {offline && session.machineOnline === false && (
          <span className={WORD} data-testid="liveness">
            offline
          </span>
        )}
      </>
    );
  const liveness = session.machineOnline === null ? null : session.machineOnline ? 'online' : 'offline';
  const alias = (
    <span className={`${apart ? 'min-w-0 ' : ''}truncate ${muted}`} data-testid="alias">
      {session.alias}
    </span>
  );
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className={`min-w-0 truncate ${name}`} data-testid="session-name" title={session.title}>
          {session.title}
        </span>
        {machine}
        {liveness && (
          <span className={WORD} data-testid="liveness">
            {liveness}
          </span>
        )}
      </span>
      {apart ? (
        <span className="flex min-w-0 items-baseline gap-1.5">
          {alias}
          {apart}
        </span>
      ) : (
        alias
      )}
    </span>
  );
}

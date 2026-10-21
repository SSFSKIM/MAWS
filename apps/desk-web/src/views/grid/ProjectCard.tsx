// A project on the grid (§4; mockups/desk/01-grid.html's tiles, pending the owner's verdict). Waiting on you is the
// signal: only a project that waits on the owner carries a numeral and a tint. A project whose machines are all
// offline reads as absent, not quiet. On a phone's two columns (05-phone.html, 2) a long name takes two lines and the
// machine dots stand without their words. A machine project (the project of a machine's sessions that no repository's
// `.smns` claims: smns org directory §3) is labelled by its kind. A project online with nothing working or waiting says
// how many of its sessions are idle, and "Quiet" when none has a process.
import type { ProjectSummary } from 'desk-hub/protocol';

export function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen(): void }) {
  const offline = project.machines_online === 0;
  const waiting = !offline && project.waiting > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-project={project.id}
      data-kind={project.kind}
      data-waiting={project.waiting}
      data-working={project.working}
      data-live={project.live}
      className={[
        'flex min-h-[122px] w-full flex-col gap-3 rounded-md border p-3 text-left transition-colors md:min-h-[132px] md:p-4',
        offline ? 'border-dashed border-border-strong bg-transparent' : waiting ? 'border-warning bg-bg-waiting' : 'border-border bg-bg-raised hover:bg-bg-hover',
      ].join(' ')}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="line-clamp-2 text-ui font-semibold break-words text-fg md:line-clamp-none md:truncate" title={project.name}>
          {project.name}
        </span>
        {project.kind === 'machine' && (
          <span className="shrink-0 rounded-sm border border-border px-1.5 text-ui-sm text-fg-muted" data-testid="project-kind" title="The sessions on this machine that no repository's project claims">
            machine
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-wrap items-end gap-x-4 gap-y-1">
        {waiting ? (
          <div className="flex items-baseline gap-2" data-testid="waiting">
            <span className="text-numeral leading-none font-semibold text-warning tabular-nums">{project.waiting}</span>
            <span className="text-ui-sm text-warning">waiting on you</span>
          </div>
        ) : offline || project.working === 0 ? (
          <span className="text-ui-sm text-fg-muted">{offline ? 'Offline' : project.live > 0 ? `${project.live} idle` : 'Quiet'}</span>
        ) : null}
        {!offline && project.working > 0 && (
          <span className="flex items-center gap-1.5 text-ui-sm text-fg" data-testid="working">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            {project.working} working
          </span>
        )}
      </div>
      <Machines online={project.machines_online} total={project.machines} />
    </button>
  );
}

function Machines({ online, total }: { online: number; total: number }) {
  return (
    <div className="flex items-center gap-2 text-ui-sm text-fg-muted" data-testid="machines">
      <span className="flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={['h-1.5 w-1.5 rounded-full', i < online ? 'bg-success' : 'border border-fg-faint'].join(' ')} />
        ))}
      </span>
      <span className="hidden md:inline">{online === total ? `${total} ${total === 1 ? 'machine' : 'machines'}` : `${online} of ${total} machines online`}</span>
    </div>
  );
}

// The confirmation sheet of a `maws` command aimed at another machine (docs/doperpowers/plans/2026-11-10-project-registry.md,
// Interfaces §K, "The page's half"; Decision Logs 20 and 21). Main holds the asks (`org.projectActs`, whole on every
// `org.projectActs.changed`); the page shows the first with where it came from, and Confirm or its dismissal is
// `org.projectActs.decide`, sent once per ask. Main answers the terminal; a stepped-up act's Touch ID is lane B's, after
// Confirm. Built on C10's `Sheet`, tokens only.
import { useEffect, useState } from 'react';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ProjectActAsk } from '@shared/ipc/schema/org';
import { ipc } from '../ipc/client';
import { Sheet, SheetForm } from '../sessions/Sheet';
import { PRIMARY } from '../sessions/ui';
import { REGISTRY } from './registry-copy';

const STEPPED_UP = new Set<ProjectActAsk['verb']>(['add', 'link']); // lane B's `addFolder` and `link`

function detailOf(ask: ProjectActAsk): string[] {
  const lines: string[] = [];
  if (ask.verb === 'link' && ask.into === null) lines.push(REGISTRY.actUnlink);
  else if (typeof ask.into === 'string') lines.push(REGISTRY.actInto(ask.intoName ?? ask.into));
  if (ask.own) lines.push(REGISTRY.actOwn);
  if (ask.name !== undefined) lines.push(REGISTRY.actNamed(ask.name));
  return lines;
}

export function ProjectActSheet({ client = ipc }: { client?: MawsBridge }) {
  const [asks, setAsks] = useState<readonly ProjectActAsk[]>([]);
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let live = true;
    let heard = false; // a change heard before the first read answered is newer than it
    const off = client.on('org.projectActs.changed', (value) => {
      heard = true;
      setAsks(value.asks);
    });
    void client.invoke('org.projectActs', undefined).then((result) => {
      if (live && !heard && result.ok) setAsks(result.value.asks);
    });
    return () => {
      live = false;
      off();
    };
  }, [client]);
  const ask = asks.find((each) => !decided.has(each.id));
  if (ask === undefined) return null;
  const decide = (confirm: boolean) => {
    setDecided((last) => new Set([...last, ask.id]));
    void client.invoke('org.projectActs.decide', { id: ask.id, confirm });
  };
  return (
    <Sheet key={ask.id} title={REGISTRY.actTitle} width="w-[min(480px,92vw)]" onClose={() => decide(false)} data-project-act={ask.id}>
      <SheetForm canSubmit onSubmit={() => decide(true)} submitLabel={REGISTRY.actConfirm} submitClass={PRIMARY} cancelLabel={REGISTRY.cancel} focusSubmit>
        <p className="m-0 text-fg">{REGISTRY.actFrom(ask.verb, ask.path, ask.machineName)}</p>
        {detailOf(ask).map((line) => (
          <p key={line} className="m-0 text-ui-sm text-fg-muted">
            {line}
          </p>
        ))}
        {STEPPED_UP.has(ask.verb) && <p className="m-0 text-ui-sm text-fg-muted">{REGISTRY.actTouchId}</p>}
      </SheetForm>
    </Sheet>
  );
}

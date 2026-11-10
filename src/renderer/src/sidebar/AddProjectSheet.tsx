// Add project, and "Add location…" (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J and §G; design
// §6): a machine (this Mac, or another the person may add folders on that is up), a folder there (typed, or chosen:
// FolderField.tsx), and optionally an existing project to add it to ("Add location…" opens it with the project filled).
// One `session.projects.addFolder` on that machine, which main steps up (Touch ID) for another machine.
//
// - While a folder is named, the machine's rule for it is read (`session.projects.resolve`, changing nothing): a folder
//   inside another project's folder is said to be added as a location of that project, with the choice to make it a
//   separate project (`own`); a clone whose remote a minted registry project also holds offers that project as the default
//   (design §2: Add project asks with the link as its default; nothing links unasked).
// - A machine whose endpoint does not serve the project acts (§G, no `rl2.project-acts`) is offered today's plain add
//   alone, and the sheet says why; a refusal is said in the registry's words (`actWords`), and leaves the sheet as it was.
import { useEffect, useMemo, useState } from 'react';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { closeDialog } from '../sessions/dialogs';
import { Sheet, SheetForm } from '../sessions/Sheet';
import { CHOICE, FIELD, PRIMARY } from '../sessions/ui';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { FolderField } from './FolderField';
import { defaultLinkOf, insideOf, intoChoices, type Resolved } from './locations';
import { addFolder, resolveFolder, servesProjectActs } from './registry-acts';
import { REGISTRY } from './registry-copy';

/** A machine Add project offers: to add on, or greyed with why. */
export interface MachineChoice {
  ref: MachineRef;
  name: string;
  local: boolean;
  serves: boolean; // its endpoint serves the project acts (§G)
  closed: string | null; // why not, where its rights are known and hold no `machine-admin`
}

/** This Mac first, then every other machine reached over RL2 that is up, by name (design §6: one the person owns that is up). */
export function machineChoices(machines: ReadonlyMap<MachineRef, MachineState>, local: MachineRef): MachineChoice[] {
  const here: MachineChoice = { ref: local, name: REGISTRY.thisMac, local: true, serves: true, closed: null };
  const others = [...machines.values()]
    .filter((m) => !m.local && m.ref !== local && m.state === 'up' && (m.carrier === 'direct' || m.carrier === 'relay'))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.ref < b.ref ? -1 : 1))
    .map((m): MachineChoice => ({ ref: m.ref, name: m.name, local: false, serves: servesProjectActs(m), closed: m.rights !== undefined && !m.rights.includes('machine-admin') ? REGISTRY.notOwner(m.name) : null }));
  return [here, ...others];
}

/** The act's input (§G): `into` a chosen project, else `own` for a separate project inside another's folder; nothing more to a machine that predates them. */
export function addInput(directory: string, choice: { serves: boolean; project: string | null; own: boolean }): { directory: string; into?: string; own?: true } {
  if (!choice.serves) return { directory };
  if (choice.project !== null) return { directory, into: choice.project };
  return choice.own ? { directory, own: true } : { directory };
}

export function AddProjectSheet({ into }: { into: string | null }) {
  const registry = useSessions((s) => s.registry);
  const machines = useMachines((s) => s.machines);
  const local = ipc.localMachine;
  const choices = useMemo(() => machineChoices(machines, local), [machines, local]);
  const [machine, setMachine] = useState<MachineRef>(local);
  const [path, setPath] = useState('');
  const [project, setProject] = useState<string | null>(into);
  const [picked, setPicked] = useState(into !== null); // the person chose the project (or it came filled): no default replaces it
  const [own, setOwn] = useState(false);
  const [read, setRead] = useState<{ key: string; resolved: Resolved | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = choices.find((c) => c.ref === machine) ?? choices[0];
  const directory = path.trim();
  const key = `${chosen.ref}\u0000${directory}`;

  // the machine's rule for the folder named, a moment after it was last edited; nothing for a machine that predates it
  useEffect(() => {
    if (!chosen.serves || !directory.startsWith('/')) return;
    let live = true;
    const timer = setTimeout(() => void resolveFolder(chosen.ref, directory).then((resolved) => live && setRead({ key, resolved })), 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [chosen.ref, chosen.serves, directory, key]);
  const resolved = read?.key === key ? read.resolved : null;
  const target = picked ? project : (defaultLinkOf(resolved, registry) ?? null);
  const inside = target === null ? insideOf(resolved, directory, registry) : null;
  const options = intoChoices(registry);

  const submit = async () => {
    setError(null);
    setBusy(chosen.local ? REGISTRY.adding(chosen.name) : REGISTRY.addingRemote(chosen.name));
    const answer = await addFolder(chosen.ref, chosen.name, addInput(directory, { serves: chosen.serves, project: target, own: own && inside !== null }));
    setBusy(null);
    if (answer.ok) closeDialog();
    else setError(answer.words);
  };
  const intoName = into === null ? null : (registry.projects.find((p) => p.id === into)?.name ?? null);

  return (
    <Sheet title={intoName === null ? REGISTRY.addTitle : REGISTRY.addLocationTitle(intoName)} width="w-[min(520px,92vw)]" data-add-project="">
      <SheetForm canSubmit={directory.startsWith('/') && busy === null && chosen.closed === null} onSubmit={() => void submit()} submitLabel={REGISTRY.add} submitClass={PRIMARY}>
        {choices.length > 1 && (
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-ui-sm text-fg-muted">{REGISTRY.machine}</legend>
            {choices.map((c) => (
              <label key={c.ref} className="flex items-start gap-2" data-machine-choice={c.ref}>
                <input
                  type="radio"
                  name="add-project-machine"
                  className={`${CHOICE} mt-1`}
                  checked={c.ref === chosen.ref}
                  disabled={c.closed !== null || busy !== null}
                  onChange={() => {
                    setMachine(c.ref);
                    setPath('');
                    setOwn(false);
                  }}
                />
                <span className="flex min-w-0 flex-col">
                  <span className={c.closed === null ? 'text-fg' : 'text-fg-muted'}>{c.name}</span>
                  {c.closed !== null && <span className="text-ui-sm text-fg-muted">{c.closed}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <FolderField key={chosen.ref} machine={chosen.ref} name={chosen.name} local={chosen.local} value={path} onChange={setPath} disabled={busy !== null} />
        <label className="flex flex-col gap-1">
          <span className="text-ui-sm text-fg-muted">{REGISTRY.project}</span>
          <select
            aria-label={REGISTRY.project}
            className={FIELD}
            value={target ?? ''}
            disabled={!chosen.serves || busy !== null}
            onChange={(event) => {
              setPicked(true);
              setProject(event.target.value === '' ? null : event.target.value);
            }}
          >
            <option value="">{REGISTRY.newProject}</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!chosen.serves && (
          <p data-registry-notice="maws" className="m-0 text-ui-sm text-fg-muted">
            {REGISTRY.mawsTooOld(chosen.name)}
          </p>
        )}
        {inside !== null && (
          <div data-registry-notice="inside" className="flex flex-col gap-1">
            <p className="m-0 text-ui-sm text-fg-muted">{REGISTRY.inside(inside)}</p>
            <label className="flex items-center gap-2 text-ui-sm">
              <input type="checkbox" className={CHOICE} checked={own} disabled={busy !== null} onChange={(event) => setOwn(event.target.checked)} />
              {REGISTRY.separate}
            </label>
          </div>
        )}
        {busy !== null && (
          <p role="status" className="m-0 text-ui-sm text-fg-muted">
            {busy}
          </p>
        )}
        {error !== null && (
          <p role="alert" className="m-0 text-ui-sm text-danger">
            {error}
          </p>
        )}
      </SheetForm>
    </Sheet>
  );
}

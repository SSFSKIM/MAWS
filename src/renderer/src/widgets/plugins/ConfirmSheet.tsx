// The confirm sheet every plugin-management change opens before anything runs (E8 execution document, M2; parent G4):
// the binary and the exact argument list (M1's `commandLine`, the one the runner spawns), the files the engine's CLI
// writes (M1's `writesOf`, a superset) and that it keeps its own records in `.claude.json`, what follows (the reload of
// the running sessions), a scope for the five plugin verbs, and the acknowledgement before an uninstall or a marketplace
// removal. Cancel runs nothing. The second sheet, for a marketplace-declared command the CLI refused to run unseen,
// shows that command and reruns the request with `--accept-command <sha256>` (never `-y`).
import { useState } from 'react';
import { PLUGINS_SCOPES, type PluginsScope } from '@shared/plugins/cli';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { CHOICE, DANGER, PRIMARY } from '../../sessions/ui';
import { PLUGIN_MANAGEMENT as W } from '../copy';
import { argvOf, commandWords, DESTRUCTIVE, SCOPED, scopeOf, targetOf, thenWords, writesWords, type PluginsRequest } from './present';

export interface ManageEnv {
  cwd: string; // the CLI's cwd: the session's directory
  binary: string | null; // the probe's real path; null when it failed
  configHome: string;
  readySessions: number; // sessions with a ready process, which a change reloads
}

export interface Declared {
  sha256: string;
  command: string;
}

const withScope = (request: PluginsRequest, scope: PluginsScope): PluginsRequest => ({ ...request, input: { ...request.input, scope } }) as PluginsRequest;

export function ConfirmSheet({ request, declared, env, onConfirm, onClose }: { request: PluginsRequest; declared: Declared | null; env: ManageEnv; onConfirm(request: PluginsRequest): void; onClose(): void }) {
  const [scope, setScope] = useState<PluginsScope>(scopeOf(request));
  const [acknowledged, setAcknowledged] = useState(false);
  const scoped = SCOPED.has(request.action) && declared === null; // the second sheet reruns the request as it ran
  const asked = scoped ? withScope(request, scope) : request;
  const destructive = DESTRUCTIVE.has(request.action);
  const argv = argvOf(asked);
  const target = targetOf(request);
  return (
    <Sheet title={declared ? W.declaredTitle(target) : W.title(W.verb[request.action], target)} width="w-[min(520px,90vw)]" onClose={onClose} data-plugins-sheet={request.action}>
      <SheetForm
        canSubmit={!destructive || acknowledged}
        onSubmit={() => onConfirm(asked)}
        submitLabel={declared ? W.runIt : W.submit[request.action]}
        submitClass={destructive ? DANGER : PRIMARY}
        focusSubmit={!destructive}
      >
        {declared && (
          <div className="flex flex-col gap-1">
            <p className="m-0 text-ui-sm text-fg-muted">{W.declared}</p>
            <code data-plugins-declared className="block rounded-sm bg-bg-active px-2 py-1 font-mono text-ui-sm break-all text-fg">
              {declared.command}
            </code>
          </div>
        )}
        <code data-plugins-argv={JSON.stringify(argv)} title={env.binary ?? undefined} className="block rounded-sm bg-bg-active px-2 py-1 font-mono text-ui-sm break-all text-fg">
          {commandWords(env.binary, argv)}
        </code>
        {scoped && (
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-ui-sm text-fg-muted">{W.scope}</legend>
            <div className="flex gap-3">
              {PLUGINS_SCOPES.map((option) => (
                <label key={option} className="flex items-center gap-1.5 text-ui-sm text-fg">
                  <input type="radio" name="plugins-scope" value={option} checked={scope === option} onChange={() => setScope(option)} className={CHOICE} />
                  {W.scopeName[option]}
                </label>
              ))}
            </div>
            {scope !== 'user' && <p className="m-0 font-mono text-ui-sm break-all text-fg-muted">{W.inProject(env.cwd)}</p>}
          </fieldset>
        )}
        <div className="flex flex-col gap-0.5 text-ui-sm text-fg-muted">
          <p className="m-0">{W.writes}</p>
          <ul aria-label={W.writes} className="m-0 list-none p-0 font-mono break-all text-fg">
            {writesWords(asked, env).map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          <p className="m-0">{W.records(env.configHome)}</p>
        </div>
        <p className="m-0 text-ui-sm text-fg-muted">{thenWords(request.action, env.readySessions)}</p>
        {destructive && (
          <label className="flex items-center gap-2 text-ui-sm text-fg">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className={CHOICE} />
            {W.understand}
          </label>
        )}
      </SheetForm>
    </Sheet>
  );
}

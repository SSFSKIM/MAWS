// The confirm sheet every plugin-management change opens before anything runs (E8 execution document, M2; parent G4):
// the binary and the exact argument list (M1's `commandLine`, the one the runner spawns), the files the engine's CLI
// writes (M1's `writesOf`, a superset) and that it keeps its own records in its global config file, what follows (the
// reload of the running sessions), a scope for the five plugin verbs, and the acknowledgement before an uninstall or a
// marketplace removal. The binary and the paths are `plugins.env`'s: until it answers the default button stays disabled
// (`Resolving the engine…`, or its refusal). Cancel runs nothing. The second sheet, for a marketplace-declared command the CLI refused to run unseen,
// shows that command and reruns the request with `--accept-command <sha256>` (never `-y`).
import { useState } from 'react';
import { PLUGINS_SCOPES, type PluginsScope } from '@shared/plugins/cli';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { CHOICE, DANGER, PRIMARY } from '../../sessions/ui';
import { PLUGIN_MANAGEMENT as W } from '../copy';
import { argvOf, commandWords, dependencyWords, DESTRUCTIVE, overridesWords, SCOPED, scopeOf, targetOf, thenWords, uninstallsWords, writesWords, type PluginsRequest } from './present';

// A resolved `plugins.env` answer: the binary (the probe's real path; an answer without one is unresolved), the config
// home the CLI writes and the engine's global config file (inside a `CLAUDE_CONFIG_DIR`, else `~/.claude.json` beside
// `~/.claude`).
export interface EngineEnv {
  binary: string;
  configHome: string;
  globalConfig: string;
}

// Until `plugins.env` answers, the sheet names no command and confirms nothing; after it failed, it says why (M2 review).
export type EngineResolution = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ready'; env: EngineEnv };

export interface ManageEnv {
  cwd: string; // the CLI's cwd: the session's directory
  engine: EngineResolution;
  readySessions: number; // sessions with a ready process, which a change reloads
}

export interface Declared {
  sha256: string;
  command: string;
}

const withScope = (request: PluginsRequest, scope: PluginsScope): PluginsRequest => ({ ...request, input: { ...request.input, scope } }) as PluginsRequest;

// `onConfirm` hears the request as confirmed and the binary the sheet named, which the host checks before it runs.
export function ConfirmSheet({ request, declared, env, onConfirm, onClose }: { request: PluginsRequest; declared: Declared | null; env: ManageEnv; onConfirm(request: PluginsRequest, binary: string): void; onClose(): void }) {
  const [scope, setScope] = useState<PluginsScope>(scopeOf(request));
  const [acknowledged, setAcknowledged] = useState(false);
  const scoped = SCOPED.has(request.action) && declared === null; // the second sheet reruns the request as it ran
  const asked = scoped ? withScope(request, scope) : request;
  const destructive = DESTRUCTIVE.has(request.action);
  const argv = argvOf(asked);
  const target = targetOf(request);
  const engine = env.engine.state === 'ready' ? env.engine.env : null;
  const { cwd } = env;
  const dependencies = dependencyWords(request.action);
  const overrides = overridesWords(request);
  const uninstalls = uninstallsWords(request);
  return (
    <Sheet title={declared ? W.declaredTitle(target) : W.title(W.verb[request.action], target)} width="w-[min(520px,90vw)]" onClose={onClose} data-plugins-sheet={request.action}>
      <SheetForm
        canSubmit={engine !== null && (!destructive || acknowledged)}
        onSubmit={() => engine && onConfirm(asked, engine.binary)}
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
        {engine ? (
          <code data-plugins-argv={JSON.stringify(argv)} title={engine.binary} className="block rounded-sm bg-bg-active px-2 py-1 font-mono text-ui-sm break-all text-fg">
            {commandWords(engine.binary, argv)}
          </code>
        ) : env.engine.state === 'error' ? (
          <p role="alert" className="m-0 text-ui-sm text-danger">
            {env.engine.error}
          </p>
        ) : (
          <p role="status" className="m-0 text-ui-sm text-fg-muted">
            {W.resolving}
          </p>
        )}
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
            {scope !== 'user' && <p className="m-0 font-mono text-ui-sm break-all text-fg-muted">{W.inProject(cwd)}</p>}
          </fieldset>
        )}
        {engine && (
          <div className="flex flex-col gap-0.5 text-ui-sm text-fg-muted">
            <p className="m-0">{W.writes}</p>
            <ul aria-label={W.writes} className="m-0 list-none p-0 font-mono break-all text-fg">
              {writesWords(asked, { configHome: engine.configHome, cwd }).map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
            {dependencies && <p className="m-0">{dependencies}</p>}
            {overrides && <p className="m-0">{overrides}</p>}
            <p className="m-0">{W.records(engine.globalConfig)}</p>
          </div>
        )}
        {uninstalls && <p className="m-0 text-ui-sm text-fg">{uninstalls}</p>}
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

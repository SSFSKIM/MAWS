// The confirm sheet every plugin-management change opens before anything runs (E8 execution document, M2; parent G4):
// the binary and the exact argument list (M1's `commandLine`, the one the runner spawns), the files the engine's CLI
// writes (M1's `writesOf`, a superset) and that it keeps its own records in its global config file, what follows (the
// reload of the running sessions), a scope for the five plugin verbs, and the acknowledgement before an uninstall or a
// marketplace removal. The binary and the paths are `plugins.env`'s: until it answers the default button stays disabled
// (`Resolving the engine…`, or its refusal). Cancel runs nothing. The second sheet, for a marketplace-declared command the CLI refused to run unseen,
// shows that command and reruns the request with `--accept-command <sha256>` (never `-y`).
// P4-AGG M3 (the Discover spec, Design "Adding"): an install asked from Discover also says what gets installed (from
// Skills, the plugin and its skills), what comes with it, "Also listed by …", and the runs-code warning, or the softer
// one when its contents are unknown; when the engine does not have its marketplace yet, the sheet shows the first step,
// `plugin marketplace add` at the same scope, above the install, and announces both steps' writes.
// The owner's ruling of 2026-10-25: the commands and the files they write sit behind Details (`SheetDetails`), closed at
// every opening; what installs, what comes with it, the runs-code warning, the scope and what follows stay in view. The
// second sheet keeps its command, the argument list and the files in view: there the command is the decision.
import { useState } from 'react';
import { PLUGINS_SCOPES, type PluginsScope } from '@shared/plugins/cli';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { CHOICE, DANGER, PRIMARY } from '../../sessions/ui';
import { PLUGIN_MANAGEMENT as W } from '../copy';
import { addStepOf, argvOf, commandWords, dependencyWords, DESTRUCTIVE, overridesWords, SCOPED, scopeOf, targetOf, thenWords, uninstallsWords, writesWords, type CatalogInstall, type PluginsRequest } from './present';
import { CATALOG_INSTALL as D } from './catalog-words';
import { SheetDetails } from './SheetDetails';

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

// A scope the sheet offers no choice of, in the selector's words: with the command behind Details, this is where the
// person reads which configuration the change applies to.
export function FixedScope({ scope }: { scope: PluginsScope }) {
  return (
    <p data-plugins-scope={scope} className="m-0 text-ui-sm text-fg-muted">
      {W.scope}: <span className="text-fg">{W.scopeName[scope]}</span>
    </p>
  );
}

const withScope = (request: PluginsRequest, scope: PluginsScope): PluginsRequest => ({ ...request, input: { ...request.input, scope } }) as PluginsRequest;

// `onConfirm` hears the request as confirmed and the binary the sheet named, which the host checks before it runs.
export function ConfirmSheet({ request, declared, env, onConfirm, onClose }: { request: PluginsRequest; declared: Declared | null; env: ManageEnv; onConfirm(request: PluginsRequest, binary: string): void; onClose(): void }) {
  const [scope, setScope] = useState<PluginsScope>(scopeOf(request));
  const [acknowledged, setAcknowledged] = useState(false);
  const scoped = SCOPED.has(request.action) && declared === null; // the second sheet reruns the request as it ran
  const asked = scoped ? withScope(request, scope) : request;
  const destructive = DESTRUCTIVE.has(request.action);
  const fixedScope = scoped ? null : ((request.input as { scope?: PluginsScope }).scope ?? null); // only a scope the request carries
  const argv = argvOf(asked);
  const target = targetOf(request);
  const engine = env.engine.state === 'ready' ? env.engine.env : null;
  const { cwd } = env;
  const dependencies = dependencyWords(request.action);
  const overrides = overridesWords(request);
  const uninstalls = uninstallsWords(request);
  const catalog = declared === null && request.action === 'install' ? (request.catalog ?? null) : null;
  const addStep = catalog ? addStepOf(asked) : null;
  const writes = (paths: { configHome: string; cwd: string }) => [...new Set([...(addStep ? writesWords(addStep, paths) : []), ...writesWords(asked, paths)])];
  // The exact commands (the add step first) and the files they write: behind Details, except on the second sheet, where
  // the command is the decision.
  const commands = engine && (
    <>
      {addStep && (
        <code data-plugins-add-argv={JSON.stringify(argvOf(addStep))} title={engine.binary} className="block rounded-sm bg-bg-active px-2 py-1 font-mono text-ui-sm break-all text-fg">
          {commandWords(engine.binary, argvOf(addStep))}
        </code>
      )}
      <code data-plugins-argv={JSON.stringify(argv)} title={engine.binary} className="block rounded-sm bg-bg-active px-2 py-1 font-mono text-ui-sm break-all text-fg">
        {commandWords(engine.binary, argv)}
      </code>
    </>
  );
  const files = engine && (
    <div className="flex flex-col gap-0.5 text-ui-sm text-fg-muted">
      <p className="m-0">{W.writes}</p>
      <ul aria-label={W.writes} className="m-0 list-none p-0 font-mono break-all text-fg">
        {writes({ configHome: engine.configHome, cwd }).map((path) => (
          <li key={path}>{path}</li>
        ))}
      </ul>
      {dependencies && <p className="m-0">{dependencies}</p>}
      {overrides && <p className="m-0">{overrides}</p>}
      <p className="m-0">{W.records(engine.globalConfig)}</p>
    </div>
  );
  return (
    <Sheet title={declared ? W.declaredTitle(target) : W.title(W.verb[request.action], target)} width="w-[min(520px,90vw)]" onClose={onClose} data-plugins-sheet={request.action}>
      <SheetForm
        canSubmit={engine !== null && (!destructive || acknowledged)}
        onSubmit={() => engine && onConfirm(asked, engine.binary)}
        submitLabel={declared ? W.runIt : W.submit[request.action]}
        submitClass={destructive ? DANGER : PRIMARY}
        focusSubmit={!destructive}
      >
        {/* the body scrolls inside the window, so a tall sheet (Discover's two steps and their writes) keeps its buttons in view */}
        <div data-plugins-sheet-body className="-mx-1 flex max-h-[calc(82vh-8rem)] min-h-0 flex-col gap-3 overflow-y-auto px-1">
          {declared && (
            <div className="flex flex-col gap-1">
              <p className="m-0 text-ui-sm text-fg-muted">{W.declared}</p>
              <code data-plugins-declared className="block rounded-sm bg-bg-active px-2 py-1 font-mono text-ui-sm break-all text-fg">
                {declared.command}
              </code>
            </div>
          )}
          {catalog && <CatalogSummary catalog={catalog} plugin={target} scope={scope} adds={addStep !== null} />}
          {env.engine.state === 'error' ? (
            <p role="alert" className="m-0 text-ui-sm text-danger">
              {env.engine.error}
            </p>
          ) : env.engine.state === 'loading' ? (
            <p role="status" className="m-0 text-ui-sm text-fg-muted">
              {W.resolving}
            </p>
          ) : null}
          {declared && commands}
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
          {fixedScope && <FixedScope scope={fixedScope} />}
          {declared && files}
          {uninstalls && <p className="m-0 text-ui-sm text-fg">{uninstalls}</p>}
          <p className="m-0 text-ui-sm text-fg-muted">{thenWords(request.action, env.readySessions)}</p>
          {destructive && (
            <label className="flex items-center gap-2 text-ui-sm text-fg">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className={CHOICE} />
              {W.understand}
            </label>
          )}
          {!declared && engine && (
            <SheetDetails>
              {commands}
              {files}
            </SheetDetails>
          )}
        </div>
      </SheetForm>
    </Sheet>
  );
}

// What an install from Discover installs: the step line, the contents, the other routes, the runs-code warning.
function CatalogSummary({ catalog, plugin, scope, adds }: { catalog: CatalogInstall; plugin: string; scope: string; adds: boolean }) {
  const name = plugin.slice(0, plugin.lastIndexOf('@'));
  const market = catalog.marketplace.name;
  const line = catalog.skills !== null ? D.skillPlugin(name, market, catalog.skills) : adds ? D.addsAndInstalls(market, scope, name) : D.installsFrom(name, market);
  return (
    <div data-catalog-install className="flex flex-col gap-1 text-ui-sm">
      <p data-catalog-summary className="m-0 text-fg">
        {line}
      </p>
      {catalog.skills !== null && adds && <p className="m-0 text-fg-muted">{D.addsAndInstalls(market, scope, name)}</p>}
      {(catalog.contents === null || catalog.contents.length > 0) && (
        <p data-catalog-contents className="m-0 text-fg-muted">
          {catalog.contents === null ? D.contentsUnknown : D.comesWith(catalog.contents)}
        </p>
      )}
      {catalog.alsoListedBy.length > 0 && <p className="m-0 text-fg-muted">{D.alsoListedBy(catalog.alsoListedBy)}</p>}
      {catalog.runsCode && (
        <p role="note" data-runs-code className="m-0 rounded-sm border border-warning px-2 py-1 text-fg">
          {catalog.runsCode}
        </p>
      )}
    </div>
  );
}

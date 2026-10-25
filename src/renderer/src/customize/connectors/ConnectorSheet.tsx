// The connector sheet (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Adding"; built like the
// install sheet, widgets/plugins/ConfirmSheet.tsx): nothing runs before it is confirmed. Adding shows the server's name
// (editable within the engine's rule), publisher, trust label and URL; a choice among the directory's url_options, or a
// required instance URL held to its url_regex with the pattern shown; the transport; the scope (user by default; a
// project's two only on a project's page); "No sign-in needed" for an authless server; the exact command; and the file it
// changes. A name already configured in any scope that applies here is refused, the existing entry shown. Removing shows
// the command and the file, behind the acknowledgement. The binary is `plugins.env`'s, read at every opening: until it
// answers the sheet names no command and confirms nothing.
import { useState } from 'react';
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import type { McpActionInputs, PluginsScope } from '@shared/plugins/cli';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { CHOICE, DANGER, FIELD, PRIMARY } from '../../sessions/ui';
import { PLUGIN_MANAGEMENT as W } from '../../widgets/copy';
import type { EngineResolution } from '../../widgets/plugins/ConfirmSheet';
import { argvOf, commandWords, type PluginsRequest } from '../../widgets/plugins/present';
import { CONNECTORS as C } from './copy';
import { existingOf, nameProblem, scopesFor, urlProblem, writesFor } from './present';

type Add = McpActionInputs['mcp-add'];

export interface ConnectorSheetEnv {
  cwd: string | null; // the page's directory; null for the user configuration
  runCwd: string; // where the CLI runs: the page's directory, else the engine's configuration directory
  engine: EngineResolution;
  servers: readonly CustomizationServer[]; // configured in every scope that applies here (the inventory for `cwd`)
}

export function ConnectorSheet({ request, env, onConfirm, onClose }: { request: PluginsRequest; env: ConnectorSheetEnv; onConfirm(request: PluginsRequest, binary: string): void; onClose(): void }) {
  return request.action === 'mcp-add' ? <AddSheet request={request} env={env} onConfirm={onConfirm} onClose={onClose} /> : <RemoveSheet request={request} env={env} onConfirm={onConfirm} onClose={onClose} />;
}

function Command({ engine, request }: { engine: EngineResolution; request: PluginsRequest | null }) {
  if (engine.state === 'error')
    return (
      <p role="alert" className="m-0 text-ui-sm text-danger">
        {engine.error}
      </p>
    );
  if (engine.state === 'loading')
    return (
      <p role="status" className="m-0 text-ui-sm text-fg-muted">
        {W.resolving}
      </p>
    );
  if (request === null) return null;
  const argv = argvOf(request);
  return (
    <code data-plugins-argv={JSON.stringify(argv)} title={engine.env.binary} className="block rounded-sm bg-bg-active px-2 py-1 font-mono text-ui-sm break-all text-fg">
      {commandWords(engine.env.binary, argv)}
    </code>
  );
}

function Writes({ engine, scope, cwd, then }: { engine: EngineResolution; scope: PluginsScope; cwd: string; then: string }) {
  return (
    <div className="flex flex-col gap-0.5 text-ui-sm text-fg-muted">
      {engine.state === 'ready' && (
        <>
          <p className="m-0">{C.writes}</p>
          <p data-connector-writes className="m-0 font-mono break-all text-fg">
            {writesFor(scope, { globalConfig: engine.env.globalConfig, cwd })}
          </p>
        </>
      )}
      <p className="m-0">{then}</p>
    </div>
  );
}

function Problem({ text, id }: { text: string | null; id: string }) {
  return text === null ? null : (
    <p id={id} role="alert" data-connector-problem className="m-0 text-ui-sm text-danger [overflow-wrap:anywhere]">
      {text}
    </p>
  );
}

function AddSheet({ request, env, onConfirm, onClose }: { request: PluginsRequest; env: ConnectorSheetEnv; onConfirm(request: PluginsRequest, binary: string): void; onClose(): void }) {
  const asked = request.input as Add;
  const connector = request.connector;
  const [name, setName] = useState(asked.name);
  const [url, setUrl] = useState(asked.url);
  const [scope, setScope] = useState<PluginsScope>(asked.scope);
  const options = connector?.urlOptions ?? [];
  const pattern = connector?.urlPattern ?? null;
  const typed = pattern !== null && options.length === 0; // an instance URL the person enters
  const nameWrong = nameProblem(name);
  const urlWrong = urlProblem(url, pattern);
  const existing = nameWrong === null ? existingOf(name, env.servers) : null;
  const valid = nameWrong === null && urlWrong === null;
  const confirmed: PluginsRequest | null = valid ? ({ ...request, input: { name, url, transport: asked.transport, scope } } as PluginsRequest) : null;
  const engine = env.engine.state === 'ready' ? env.engine.env : null;
  const scopes = scopesFor(env.cwd);
  return (
    <Sheet title={C.addTitle(connector?.name ?? asked.name)} width="w-[min(520px,90vw)]" onClose={onClose} data-plugins-sheet="mcp-add">
      <SheetForm canSubmit={engine !== null && confirmed !== null && existing === null} onSubmit={() => engine && confirmed && onConfirm(confirmed, engine.binary)} submitLabel={W.submit['mcp-add']} submitClass={PRIMARY}>
        <div data-plugins-sheet-body className="-mx-1 flex max-h-[calc(82vh-8rem)] min-h-0 flex-col gap-3 overflow-y-auto px-1 text-ui-sm">
          {connector && (
            <p data-connector-byline className="m-0 text-fg-muted">
              {[connector.publisher && `by ${connector.publisher}`, connector.trust].filter(Boolean).join(' · ')}
            </p>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted">{C.name}</span>
            <input value={name} onChange={(event) => setName(event.target.value.trim())} aria-invalid={nameWrong !== null || existing !== null} aria-describedby="connector-name-problem" spellCheck={false} className={`${FIELD} font-mono`} />
          </label>
          <Problem id="connector-name-problem" text={nameWrong ?? (existing && C.exists(existing.scope, existing.path))} />
          {options.length > 0 ? (
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="mb-1 p-0 text-fg-muted">{C.urlChoice}</legend>
              {options.map((option) => (
                <label key={option.url} className="flex items-baseline gap-1.5 text-fg">
                  <input type="radio" name="connector-url" value={option.url} checked={url === option.url} onChange={() => setUrl(option.url)} className={CHOICE} />
                  <span>
                    {option.label}
                    {option.description && <span className="text-fg-muted"> · {option.description}</span>}
                    <span className="block font-mono break-all text-fg-muted">{option.url}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : typed ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-fg-muted">{C.instanceUrl}</span>
                <input value={url} onChange={(event) => setUrl(event.target.value.trim())} required aria-invalid={urlWrong !== null} aria-describedby="connector-url-problem" spellCheck={false} placeholder="https://" className={`${FIELD} font-mono`} />
              </label>
              <p data-connector-pattern className="m-0 font-mono break-all text-fg-muted">
                {C.pattern(pattern)}
              </p>
              {url !== '' && <Problem id="connector-url-problem" text={urlWrong} />}
            </>
          ) : (
            <p className="m-0 flex flex-col gap-0.5">
              <span className="text-fg-muted">{C.url}</span>
              <span data-connector-url className="font-mono break-all text-fg">
                {url}
              </span>
            </p>
          )}
          <p className="m-0 text-fg-muted">
            {C.transport}: <span className="text-fg">{C.transportName[asked.transport]}</span>
          </p>
          {scopes.length > 1 && (
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="mb-1 p-0 text-fg-muted">{W.scope}</legend>
              <div className="flex gap-3">
                {scopes.map((option) => (
                  <label key={option} className="flex items-center gap-1.5 text-fg">
                    <input type="radio" name="connector-scope" value={option} checked={scope === option} onChange={() => setScope(option)} className={CHOICE} />
                    {W.scopeName[option]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {connector && (
            <p data-connector-auth={connector.authPosture} className="m-0 text-fg">
              {connector.authPosture === 'no_auth' ? C.noSignIn : C.signInAfter}
            </p>
          )}
          <Command engine={env.engine} request={confirmed} />
          <Writes engine={env.engine} scope={scope} cwd={env.runCwd} then={C.takesEffect} />
        </div>
      </SheetForm>
    </Sheet>
  );
}

function RemoveSheet({ request, env, onConfirm, onClose }: { request: PluginsRequest; env: ConnectorSheetEnv; onConfirm(request: PluginsRequest, binary: string): void; onClose(): void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const input = request.input as McpActionInputs['mcp-remove'];
  const engine = env.engine.state === 'ready' ? env.engine.env : null;
  return (
    <Sheet title={C.removeTitle(input.name)} width="w-[min(520px,90vw)]" onClose={onClose} data-plugins-sheet="mcp-remove">
      <SheetForm canSubmit={engine !== null && acknowledged} onSubmit={() => engine && onConfirm(request, engine.binary)} submitLabel={W.submit['mcp-remove']} submitClass={DANGER}>
        <div data-plugins-sheet-body className="flex flex-col gap-3 text-ui-sm">
          <Command engine={env.engine} request={request} />
          <Writes engine={env.engine} scope={input.scope} cwd={env.runCwd} then={C.removesFrom} />
          <label className="flex items-center gap-2 text-fg">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className={CHOICE} />
            {W.understand}
          </label>
        </div>
      </SheetForm>
    </Sheet>
  );
}

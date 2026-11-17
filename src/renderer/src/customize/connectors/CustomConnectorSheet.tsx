// The custom connector's sheet (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, "The form's fields",
// "Secrets", "A name the engine empties", "After Add", §D, §E): one sheet, built from the parts today's connector sheet
// uses. A name, one of three types, the type's fields, and where to add it; nothing runs before Add. Changing the type
// keeps what was typed for the other type while the sheet is open, and Add sends only the chosen type's fields. Add
// waits for the engine's binary and for a read of what is configured here made after the sheet opened (the section
// gives it, `configured`). Behind Details, closed at every opening: the command with `•••` in every value slot (the
// shown line, from the structure) and the file it changes. The value fields are plain text fields, drawn by one
// component (`ValueField`), the one place a masked field with a reveal control would be made ("The owner's look").
import { Fragment, useState, type ReactNode } from 'react';
import { MCP_MASK, type McpEntryAdd, type McpPair, type PluginsScope } from '@shared/plugins/cli';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { CHOICE, FIELD, PRIMARY, SECONDARY } from '../../sessions/ui';
import { PLUGIN_MANAGEMENT as W } from '../../widgets/copy';
import { argvOf, commandWords, type PluginsRequest } from '../../widgets/plugins/present';
import { SheetDetails } from '../../widgets/plugins/SheetDetails';
import { Configured, Problem, Unresolved, type ConnectorSheetEnv } from './sheet-parts';
import { CONNECTORS as C } from './copy';
import { addToScopes, addToWords, checkCustom, customFieldsOf, customInputOf, customDetailsInputOf, type CustomCheck, type CustomFields, type CustomType, type RowsField } from './custom-form';
import { writesFor } from './present';

type Row = McpPair & { id: number }; // `id`: the row's React key; only the name and the value are sent
type Fields = Omit<CustomFields, 'headers' | 'env'> & { headers: Row[]; env: Row[] };
type Field = 'name' | 'url' | 'command'; // the fields whose emptiness is said once they were typed in

const TYPES: readonly CustomType[] = ['http', 'sse', 'stdio'];
let rows = 0; // the window's row keys
const rowOf = (pair: McpPair): Row => {
  rows += 1;
  return { ...pair, id: rows };
};
const MUTED = 'm-0 text-ui-sm text-fg-muted';

export function CustomConnectorSheet({ request, env, onConfirm, onClose }: { request: PluginsRequest; env: ConnectorSheetEnv; onConfirm(request: PluginsRequest, binary: string): void; onClose(): void }) {
  const [fields, setFields] = useState<Fields>(() => {
    const opened = customFieldsOf(request.input as McpEntryAdd);
    return { ...opened, headers: opened.headers.map(rowOf), env: opened.env.map(rowOf) };
  });
  const [typed, setTyped] = useState<ReadonlySet<Field>>(new Set());
  const set = (patch: Partial<Fields>) => setFields((prior) => ({ ...prior, ...patch }));
  const type = (field: Field, value: string) => {
    setTyped((prior) => (prior.has(field) ? prior : new Set([...prior, field])));
    set({ [field]: value });
  };
  const servers = env.configured.state === 'read' ? env.configured.servers : null;
  const check = checkCustom(fields, servers);
  const engine = env.engine.state === 'ready' ? env.engine.env : null;
  const input = customInputOf(fields, check, env.configured);
  const ask = (asked: McpEntryAdd): PluginsRequest => ({ ...request, input: asked, folder: env.cwd }) as PluginsRequest;
  const detailed = customDetailsInputOf(fields, check);
  const remote = fields.type !== 'stdio';
  const rowsField: RowsField = remote ? 'headers' : 'env';
  const place = env.place ?? env.cwd ?? '';
  const said = (field: Field, problem: string | null) => (fields[field] === '' && !typed.has(field) ? null : problem);
  return (
    <Sheet title={C.customTitle} width="w-[min(560px,90vw)]" onClose={onClose} data-plugins-sheet="mcp-add" data-connector-custom="">
      <SheetForm canSubmit={engine !== null && input !== null} onSubmit={() => engine && input && onConfirm(ask(input), engine.binary)} submitLabel={W.submit['mcp-add']} submitClass={PRIMARY}>
        <div data-plugins-sheet-body className="-mx-1 flex max-h-[calc(82vh-8rem)] min-h-0 flex-col gap-3 overflow-y-auto px-1 text-ui-sm">
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted">{C.name}</span>
            <input data-connector-name value={fields.name} onChange={(event) => type('name', event.target.value)} aria-invalid={check.name !== null || check.existing !== null} aria-describedby="custom-connector-name-problem" spellCheck={false} autoComplete="off" className={`${FIELD} font-mono`} />
          </label>
          <Problem id="custom-connector-name-problem" text={said('name', check.name) ?? (check.existing && C.exists(check.existing.scope, check.existing.path))} />
          <Configured configured={env.configured} retry={env.retryServers} />
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-fg-muted">{C.type}</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {TYPES.map((option) => (
                <label key={option} className="flex items-center gap-1.5 text-fg">
                  <input type="radio" name="custom-connector-type" value={option} checked={fields.type === option} onChange={() => set({ type: option })} className={CHOICE} />
                  {C.typeName[option]}
                </label>
              ))}
            </div>
          </fieldset>
          {remote ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-fg-muted">{C.url}</span>
                <input data-connector-url-field value={fields.url} onChange={(event) => type('url', event.target.value)} aria-invalid={check.url !== null} aria-describedby="custom-connector-url-problem" spellCheck={false} autoComplete="off" placeholder="https://" className={`${FIELD} font-mono`} />
              </label>
              <Problem id="custom-connector-url-problem" text={said('url', check.url)} />
              <SentEmpty names={check.urlEmptied} />
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-fg-muted">{C.command}</span>
                <input data-connector-command-field value={fields.command} onChange={(event) => type('command', event.target.value)} aria-invalid={check.command !== null} aria-describedby="custom-connector-command-problem" spellCheck={false} autoComplete="off" className={`${FIELD} font-mono`} />
              </label>
              <Problem id="custom-connector-command-problem" text={said('command', check.command)} />
              {check.commandHasSpace && <p data-connector-command-note className={MUTED}>{C.commandSpaces}</p>}
              <Arguments line={fields.args} check={check} onChange={(args) => set({ args })} />
            </>
          )}
          <Rows
            field={rowsField}
            rows={remote ? fields.headers : fields.env}
            check={check}
            onChange={(rows) => set(remote ? { headers: rows } : { env: rows })}
            onAdd={() => set(remote ? { headers: [...fields.headers, rowOf({ name: '', value: '' })] } : { env: [...fields.env, rowOf({ name: '', value: '' })] })}
          />
          <AddTo scopes={addToScopes(env.cwd)} scope={fields.scope} place={place} onChange={(scope) => set({ scope })} />
          {check.sharedWarning && (
            <p data-connector-shared-warning className="m-0 text-ui-sm text-fg">
              {C.sharedFileWarning}
            </p>
          )}
          {check.entryProblem && <Problem id="custom-connector-entry-problem" text={check.entryProblem} />}
          <Unresolved engine={env.engine} />
          <p className={MUTED}>{C.takesEffect}</p>
          {engine && (
            <SheetDetails>
              {detailed && <ShownCommand binary={engine.binary} request={{ ...request, input: detailed } as PluginsRequest} />}
              <div className="flex flex-col gap-0.5 text-ui-sm text-fg-muted">
                <p className="m-0">{C.writes}</p>
                <p data-connector-writes className="m-0 font-mono break-all text-fg">
                  {writesFor(fields.scope, { globalConfig: engine.globalConfig, cwd: env.runCwd })}
                </p>
              </div>
            </SheetDetails>
          )}
        </div>
      </SheetForm>
    </Sheet>
  );
}

// "Claude Code sends <NAME> to a remote server as empty. …", one line per name, beside the field it came from.
function SentEmpty({ names }: { names: readonly string[] }) {
  return names.map((name) => (
    <p key={name} data-connector-sent-empty={name} className="m-0 text-ui-sm text-fg">
      {C.sentEmpty(name)}
    </p>
  ));
}

// The arguments line, the sentence that stands under it, and the split shown as one box per argument (or why not).
function Arguments({ line, check, onChange }: { line: string; check: CustomCheck; onChange(line: string): void }) {
  const { args } = check;
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-fg-muted">{C.args}</span>
        <input data-connector-args-field value={line} onChange={(event) => onChange(event.target.value)} aria-invalid={!args.ok || check.argsProblem !== null} aria-describedby="custom-connector-args-problem" spellCheck={false} autoComplete="off" className={`${FIELD} font-mono`} />
      </label>
      <p className={MUTED}>{C.argsAsTyped}</p>
      {args.ok ? (
        <div data-connector-args className="flex flex-col gap-1">
          <p className={MUTED}>{C.argCount(args.words.length)}</p>
          {args.words.length > 0 && (
            <ol className="m-0 flex list-none flex-wrap gap-1 p-0">
              {args.words.map((word, index) => (
                <li key={index} data-connector-arg className={`rounded-sm border border-border bg-bg-active px-1.5 font-mono text-ui-sm [overflow-wrap:anywhere] ${word === '' ? 'text-fg-muted' : 'text-fg'}`}>
                  {word === '' ? C.emptyArg : word}
                </li>
              ))}
            </ol>
          )}
          <Problem id="custom-connector-args-problem" text={check.argsProblem} />
        </div>
      ) : (
        <Problem id="custom-connector-args-problem" text={args.problem} />
      )}
    </div>
  );
}

// A header's or a variable's value: a plain text field, spelling checks off. The one place a masked field with a reveal
// control would be made, should the owner choose it.
function ValueField({ value, onChange }: { value: string; onChange(value: string): void }) {
  return <input data-connector-value aria-label={C.rowValue} placeholder={C.rowValue} value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" className={`${FIELD} min-w-0 flex-1 font-mono`} />;
}

// Request headers or Environment: rows of a name and a value, none at first; under them, once there is one, the secrets
// sentence, and while one is empty, that it is not added.
function Rows({ field, rows, check, onChange, onAdd }: { field: RowsField; rows: Row[]; check: CustomCheck; onChange(rows: Row[]): void; onAdd(): void }) {
  const edit = (index: number, patch: Partial<McpPair>) => onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  return (
    <fieldset data-connector-rows={field} className="m-0 flex flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1 p-0 text-fg-muted">{field === 'headers' ? C.headers : C.env}</legend>
      {rows.map((row, index) => (
        <div key={row.id} data-connector-row={index} className="flex flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <input data-connector-row-name aria-label={C.rowName} placeholder={C.rowName} value={row.name} onChange={(event) => edit(index, { name: event.target.value })} aria-invalid={check.rows[index]?.problem != null} spellCheck={false} autoComplete="off" className={`${FIELD} min-w-0 flex-1 font-mono`} />
            <ValueField value={row.value} onChange={(value) => edit(index, { value })} />
            <button type="button" aria-label={C.removeRow(row.name === '' ? String(index + 1) : row.name)} onClick={() => onChange(rows.filter((_, at) => at !== index))} className={SECONDARY}>
              {C.remove}
            </button>
          </div>
          <Problem id={`custom-connector-row-${row.id}-problem`} text={check.rows[index]?.problem ?? null} />
          {field === 'headers' && <SentEmpty names={check.rows[index]?.emptied ?? []} />}
        </div>
      ))}
      <button type="button" onClick={onAdd} className={`${SECONDARY} self-start`}>
        {field === 'headers' ? C.addHeader : C.addVariable}
      </button>
      <Problem id="custom-connector-rows-problem" text={check.rowsProblem} />
      {check.emptyRow && <p className={MUTED}>{C.emptyRow}</p>}
      {check.hasRows && <p className={MUTED}>{C.savedAsWritten}</p>}
    </fieldset>
  );
}

// "Add to": the choices a page offers, or on the user configuration's page its one choice as words under the label
// (the architect's ruling for M2: no radio with nothing beside it).
function AddTo({ scopes, scope, place, onChange }: { scopes: PluginsScope[]; scope: PluginsScope; place: string; onChange(scope: PluginsScope): void }) {
  if (scopes.length === 1)
    return (
      <p className="m-0 flex flex-col gap-0.5">
        <span className="text-fg-muted">{C.addTo}</span>
        <span data-connector-add-to={scopes[0]} className="text-fg">
          {addToWords(scopes[0], place)}
        </span>
      </p>
    );
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend className="mb-1 p-0 text-fg-muted">{C.addTo}</legend>
      {scopes.map((option) => (
        <label key={option} className="flex items-center gap-1.5 text-fg [overflow-wrap:anywhere]">
          <input type="radio" name="custom-connector-scope" value={option} checked={scope === option} onChange={() => onChange(option)} className={CHOICE} />
          {addToWords(option, place)}
        </label>
      ))}
    </fieldset>
  );
}

// The shown command, wrapping where it can: each piece between spaces and commas is one unit that breaks inside only
// when it is longer than the line, with a break opportunity after each space and each comma, and each `•••` an element
// that never wraps (the architect's ruling for M2). A browser breaks after a hyphen too, so the units are explicit.
function ShownCommand({ binary, request }: { binary: string; request: PluginsRequest }) {
  const argv = argvOf(request);
  const text = commandWords(binary, argv);
  const pieces = text.split(/(?<=[ ,])/);
  return (
    <code data-plugins-argv={JSON.stringify(argv)} title={binary} className="block rounded-sm bg-bg-active px-2 py-1 font-mono text-ui-sm whitespace-pre-wrap text-fg">
      {pieces.map((piece, index) => {
        const spaced = piece.endsWith(' ');
        const unit = spaced ? piece.slice(0, -1) : piece;
        return <Unit key={index} text={unit} after={spaced ? ' ' : piece.endsWith(',') ? <wbr /> : null} />;
      })}
    </code>
  );
}

function Unit({ text, after }: { text: string; after: ReactNode }) {
  const parts = text.split(MCP_MASK);
  return (
    <>
      <span data-command-unit className="inline-block max-w-full [overflow-wrap:anywhere]">
        {parts.map((part, index) => (
          <Fragment key={index}>
            {part}
            {index < parts.length - 1 && (
              <span data-command-mask className="whitespace-nowrap">
                {MCP_MASK}
              </span>
            )}
          </Fragment>
        ))}
      </span>
      {after}
    </>
  );
}

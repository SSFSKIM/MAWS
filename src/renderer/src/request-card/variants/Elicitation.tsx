// The elicitation body (C7 execution document, Request card): the server's message; for `mode: 'form'` a form from
// `requested_schema` (elicitation-form.ts), for `mode: 'url'` the link with Open. Accept (Enter) sends the form's
// content; Decline and Cancel (Esc) send nothing else. A schema the form cannot map leaves Decline as the only action.
import { useLayoutEffect, useState } from 'react';
import { ipc } from '../../ipc/client';
import { toAnswer } from '../answers';
import { CardButton, Controls } from '../controls';
import { CARD_WORDS } from '../copy';
import { elicitationForm, formContent, type FormField, type FormValues } from './elicitation-form';
import type { VariantProps } from './types';

const INPUT = 'w-full rounded-sm border border-border-strong bg-bg px-2 py-1 text-ui text-fg outline-accent focus-visible:outline-2';

// The word cut (C116): a required field's label ends in an asterisk, and a screen reader hears "(required)" in its place.
// The words, the asterisk and "(required)" are one inline run, so the asterisk ends the label's own line in either
// layout (the label is a flex column for a field, a flex row for a checkbox) and is never a flex item of its own.
function Field({ field, value, onChange, disabled }: { field: FormField; value: string | boolean | undefined; onChange(value: string | boolean): void; disabled: boolean }) {
  const label = (
    <span data-field-label="">
      {field.label}
      {field.required && (
        <>
          <span aria-hidden="true"> *</span>
          <span className="sr-only">{CARD_WORDS.requiredName}</span>
        </>
      )}
    </span>
  );
  if (field.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-fg">
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        {label}
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-ui-sm text-fg-muted">
      {label}
      {field.kind === 'enum' ? (
        <select value={typeof value === 'string' ? value : ''} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={INPUT}>
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.kind === 'string' ? 'text' : 'number'}
          step={field.kind === 'integer' ? 1 : 'any'}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={INPUT}
        />
      )}
      {field.description && <span className="text-fg-faint">{field.description}</span>}
    </label>
  );
}

export function ElicitationBody({ request, busy, submit, bindKeys }: VariantProps<'elicitation.requested'>) {
  const payload = (request.payload ?? {}) as { message?: unknown; requested_schema?: unknown; url?: unknown };
  const url = request.mode === 'url' && typeof payload.url === 'string' ? payload.url : null;
  const form = url === null ? elicitationForm(payload.requested_schema) : { ok: true as const, fields: [] };
  const [values, setValues] = useState<FormValues>({});
  const [problem, setProblem] = useState<string | null>(null);

  const accept = () => {
    if (!form.ok) return;
    if (url !== null) return submit(toAnswer({ kind: 'elicitation', action: 'accept', content: null }), 'Accepted');
    const content = formContent(form.fields, values);
    if (!content.ok) return setProblem(`${content.field} ${content.problem}`);
    submit(toAnswer({ kind: 'elicitation', action: 'accept', content: content.content }), 'Accepted');
  };
  const decline = () => submit(toAnswer({ kind: 'elicitation', action: 'decline' }), 'Declined');
  const cancel = () => submit(toAnswer({ kind: 'elicitation', action: 'cancel' }), 'Cancelled');
  // A form MAWS cannot show leaves Decline as the one answer (M2 decisions): no Accept, no Cancel, no key.
  useLayoutEffect(() => bindKeys({ accept: form.ok ? accept : null, decline: form.ok ? cancel : null }));

  return (
    <div className="flex flex-col gap-3">
      {typeof payload.message === 'string' && <p className="m-0 text-fg">{payload.message}</p>}
      {url !== null && (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-fg" title={url}>
            {url}
          </span>
          <CardButton onClick={() => void ipc.invoke('layout.openExternal', { url })}>Open</CardButton>
        </div>
      )}
      {form.ok ? (
        form.fields.map((field) => (
          <Field
            key={field.name}
            field={field}
            value={values[field.name]}
            disabled={busy}
            onChange={(value) => {
              setProblem(null);
              setValues((v) => ({ ...v, [field.name]: value }));
            }}
          />
        ))
      ) : (
        <p className="m-0 text-ui-sm text-warning">MAWS cannot show this form: {form.unsupported.join(', ')} · decline it, or answer it in a terminal</p>
      )}
      {problem && (
        <p role="alert" className="m-0 text-ui-sm text-danger">
          {problem}
        </p>
      )}
      {/* the word cut (C115): the server is named once, on the card's first line */}
      <Controls>
        <CardButton disabled={busy || !form.ok} onClick={cancel}>
          Cancel
        </CardButton>
        <CardButton disabled={busy} onClick={decline}>
          Decline
        </CardButton>
        {form.ok && (
          <CardButton tone="primary" disabled={busy} onClick={accept}>
            Accept
          </CardButton>
        )}
      </Controls>
    </div>
  );
}

// An MCP elicitation's `requested_schema` as form fields, table-driven by JSON-schema `type` (C7 execution document,
// M2 decisions): string → text input, number and integer → number input, boolean → checkbox, `enum` → select;
// `required` enforced; `title` and `description` as the label and hint. A property the table cannot map (a nested
// object, an array, no type) makes the form unsupported: the card then offers Decline as its only action and names
// the field. Pure.
export type FieldKind = 'string' | 'number' | 'integer' | 'boolean' | 'enum';

export interface FormField {
  name: string;
  kind: FieldKind;
  label: string;
  description: string | null;
  required: boolean;
  options: string[]; // the enum's values; empty otherwise
}

export type ElicitationForm = { ok: true; fields: FormField[] } | { ok: false; unsupported: string[] };

const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function elicitationForm(schema: unknown): ElicitationForm {
  const properties = record(record(schema)?.properties) ?? {};
  const required = new Set((Array.isArray(record(schema)?.required) ? (record(schema)!.required as unknown[]) : []).filter((n): n is string => typeof n === 'string'));
  const fields: FormField[] = [];
  const unsupported: string[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    const property = record(raw) ?? {};
    const values = Array.isArray(property.enum) && property.enum.every((v) => typeof v === 'string') ? (property.enum as string[]) : null;
    const type = text(property.type);
    const kind: FieldKind | null = values ? 'enum' : type === 'string' || type === 'number' || type === 'integer' || type === 'boolean' ? type : null;
    if (!kind) {
      unsupported.push(name);
      continue;
    }
    fields.push({ name, kind, label: text(property.title) ?? name, description: text(property.description), required: required.has(name), options: values ?? [] });
  }
  return unsupported.length > 0 ? { ok: false, unsupported } : { ok: true, fields };
}

// What the form holds: text per field, `true`/`false` for a checkbox.
export type FormValues = Record<string, string | boolean>;

// The content an Accept carries, or the first field that stops it. An empty optional field is left out; an unticked
// optional checkbox is `false` only when it was touched (present in `values`).
export function formContent(fields: FormField[], values: FormValues): { ok: true; content: Record<string, unknown> } | { ok: false; field: string; problem: string } {
  const content: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.kind === 'boolean') {
      if (typeof value === 'boolean') content[field.name] = value;
      else if (field.required) content[field.name] = false;
      continue;
    }
    const raw = typeof value === 'string' ? value : '';
    if (raw.trim() === '') {
      if (field.required) return { ok: false, field: field.label, problem: 'is required' };
      continue;
    }
    if (field.kind === 'number' || field.kind === 'integer') {
      const n = Number(raw);
      if (!Number.isFinite(n) || (field.kind === 'integer' && !Number.isInteger(n))) return { ok: false, field: field.label, problem: field.kind === 'integer' ? 'must be a whole number' : 'must be a number' };
      content[field.name] = n;
    } else {
      content[field.name] = raw;
    }
  }
  return { ok: true, content };
}

import { describe, expect, it } from 'vitest';
import { fixtureRequest } from '../test-requests';
import { elicitationForm, formContent } from './elicitation-form';

const dialogs = fixtureRequest('pass2', 'dialogs', 41);
if (dialogs.kind !== 'elicitation.requested') throw new Error('seq 41 is the elicitation');
const schema = (dialogs.payload as { requested_schema: unknown }).requested_schema;

describe('elicitation form from requested_schema', () => {
  it("maps pass2/dialogs seq 41's schema to one required text input and accepts { color: 'teal' }", () => {
    const form = elicitationForm(schema);
    expect(form).toEqual({ ok: true, fields: [{ name: 'color', kind: 'string', label: 'Color', description: null, required: true, options: [] }] });
    if (!form.ok) return;
    expect(formContent(form.fields, {})).toEqual({ ok: false, field: 'Color', problem: 'is required' });
    expect(formContent(form.fields, { color: 'teal' })).toEqual({ ok: true, content: { color: 'teal' } });
  });

  it('maps numbers, integers, booleans and enums, and leaves empty optional fields out', () => {
    const form = elicitationForm({
      type: 'object',
      properties: { n: { type: 'number' }, i: { type: 'integer', title: 'Count' }, b: { type: 'boolean', description: 'Tick it' }, e: { type: 'string', enum: ['a', 'b'] } },
      required: ['i'],
    });
    if (!form.ok) throw new Error('supported');
    expect(form.fields.map((f) => [f.name, f.kind, f.required])).toEqual([
      ['n', 'number', false],
      ['i', 'integer', true],
      ['b', 'boolean', false],
      ['e', 'enum', false],
    ]);
    expect(form.fields[3].options).toEqual(['a', 'b']);
    expect(formContent(form.fields, { i: '2.5' })).toEqual({ ok: false, field: 'Count', problem: 'must be a whole number' });
    expect(formContent(form.fields, { n: '1.5', i: '3', b: true, e: 'b' })).toEqual({ ok: true, content: { n: 1.5, i: 3, b: true, e: 'b' } });
    expect(formContent(form.fields, { i: '3' })).toEqual({ ok: true, content: { i: 3 } });
  });

  it('refuses a schema with a nested object or an array, naming the fields', () => {
    expect(elicitationForm({ type: 'object', properties: { ok: { type: 'string' }, deep: { type: 'object' }, list: { type: 'array' } } })).toEqual({ ok: false, unsupported: ['deep', 'list'] });
  });
});

// The view spec's closed grammar (P3-E2 M3; parent §2 "Views", Decision Log 9): read untrusted, unknown keys and
// refused values dropped with a warning, an unknown kind an error, and the normalised form a write stores.
import { describe, expect, it } from 'vitest';
import { normalizeSpec, parseSpec } from './spec';

describe('parseSpec', () => {
  it('reads every key of the grammar', () => {
    const spec = {
      view: 'bar', x: 'region', y: ['sales', 'cost'], series: 'year', agg: 'sum', sort: { by: 'sales', dir: 'desc' }, limit: 10,
      filter: [{ column: 'year', op: 'in', value: [2025, 2026] }, { column: 'region', op: 'ne', value: null }], columns: ['region'], format: { sales: 'percent' }, title: '지역별 매출',
    };
    expect(parseSpec(spec)).toEqual({ ok: true, spec, warnings: [] });
  });

  it('drops unknown keys and refused values with a warning each, keeping the rest', () => {
    const parsed = parseSpec({ view: 'line', x: 'at', y: 'v', href: 'https://e.example/', onclick: 'x()', limit: -1, sort: { by: 'v', dir: 'sideways' }, filter: [{ column: 'v', op: 'regex', value: '.*' }, { column: 'v', op: 'gt', value: 3 }], format: { v: 'currency' }, y2: 'w' });
    expect(parsed).toEqual({
      ok: true,
      spec: { view: 'line', x: 'at', y: 'v', filter: [{ column: 'v', op: 'gt', value: 3 }] },
      warnings: ['unknown key "href" ignored', 'unknown key "onclick" ignored', 'unknown key "y2" ignored', 'invalid "sort" ignored', 'invalid "limit" ignored', 'invalid "filter" ignored', 'invalid "format" ignored'],
    });
  });

  it('refuses expressions where values go: a non-finite number, an object, a nested filter key', () => {
    const parsed = parseSpec({ view: 'bar', x: 'a', y: { $expr: 'a*2' }, filter: [{ column: 'a', op: 'eq', value: { toString: 'x' } }, { column: 'a', op: 'eq', value: 1, fn: 'x' }] });
    expect(parsed).toEqual({ ok: true, spec: { view: 'bar', x: 'a' }, warnings: ['invalid "y" ignored', 'invalid "filter" ignored'] });
  });

  it('names an unknown view kind and a spec that is not an object as errors, keeping the caption', () => {
    expect(parseSpec({ view: 'sankey', title: 'Flows' })).toEqual({ ok: false, error: 'unknown view "sankey"', title: 'Flows' });
    expect(parseSpec(null)).toEqual({ ok: false, error: 'the view spec is not an object' });
    expect(parseSpec('{"view":"bar"}')).toEqual({ ok: false, error: 'the view spec is not an object' });
    expect(parseSpec({ view: 'x'.repeat(100) })).toMatchObject({ ok: false, error: `unknown view "${'x'.repeat(40)}…"` });
    // any JSON, never read through its own methods: `{toString: 0}` would throw if stringified
    expect(parseSpec(JSON.parse('{"view":{"toString":0},"title":"T"}'))).toEqual({ ok: false, error: 'unknown view object', title: 'T' });
    expect(parseSpec({ view: ['bar'] })).toEqual({ ok: false, error: 'unknown view list' });
    expect(parseSpec({ view: 3 })).toEqual({ ok: false, error: 'unknown view number 3' });
    expect(parseSpec({})).toEqual({ ok: false, error: 'unknown view (none)' });
    expect(normalizeSpec(JSON.parse('{"view":{"toString":0}}')).warnings).toEqual(['unknown view object; the view draws as an error']);
  });

  // P3-F dashboard-model wave (sweep#3): a pie's slices are one measure's sizes; a further measure is never dropped in
  // silence (the figure would omit it while the view's data preview names it), it is the view's error
  it('refuses a pie of more than one measure, naming the measures it cannot draw; one measure, as a name or a list, reads', () => {
    expect(parseSpec({ view: 'pie', x: 'region', y: ['sales', 'cost'] })).toEqual({ ok: false, error: 'a pie view draws one measure; y also names "cost"' });
    expect(parseSpec({ view: 'pie', x: 'region', y: ['sales', 'cost', 'margin'], title: 'Mix' })).toEqual({ ok: false, error: 'a pie view draws one measure; y also names "cost", "margin"', title: 'Mix' });
    expect(normalizeSpec({ view: 'pie', x: 'region', y: ['sales', 'cost'] })).toEqual({ spec: { view: 'pie', x: 'region', y: ['sales', 'cost'] }, changed: false, warnings: ['a pie view draws one measure; y also names "cost"; the view draws as an error'] });
    expect(parseSpec({ view: 'pie', x: 'region', y: ['sales'] })).toEqual({ ok: true, spec: { view: 'pie', x: 'region', y: ['sales'] }, warnings: [] });
    expect(parseSpec({ view: 'pie', x: 'region', y: 'sales' })).toEqual({ ok: true, spec: { view: 'pie', x: 'region', y: 'sales' }, warnings: [] });
    expect(parseSpec({ view: 'bar', x: 'region', y: ['sales', 'cost'] }).ok).toBe(true); // every other kind draws each measure
  });

  it('takes a column named like an object prototype key as a column', () => {
    const parsed = parseSpec(JSON.parse('{"view":"table","format":{"__proto__":"text","constructor":"number"}}'));
    expect(parsed.ok && parsed.spec.format?.['__proto__']).toBe('text');
    expect(parsed.ok && parsed.spec.format?.['constructor']).toBe('number');
    expect(parsed.ok && parsed.spec.format?.['toString']).toBeUndefined();
  });
});

describe('normalizeSpec', () => {
  it('stores the grammar\'s reading and says whether it changed', () => {
    expect(normalizeSpec({ view: 'bar', x: 'a', y: 'b' })).toEqual({ spec: { view: 'bar', x: 'a', y: 'b' }, changed: false, warnings: [] });
    expect(normalizeSpec({ view: 'bar', x: 'a', y: 'b', colour: 'red' })).toEqual({ spec: { view: 'bar', x: 'a', y: 'b' }, changed: true, warnings: ['unknown key "colour" ignored'] });
  });

  it('keeps a spec it cannot read as given, drawn as the error', () => {
    expect(normalizeSpec({ view: 'sankey' })).toEqual({ spec: { view: 'sankey' }, changed: false, warnings: ['unknown view "sankey"; the view draws as an error'] });
    expect(normalizeSpec(null)).toEqual({ spec: null, changed: false, warnings: ['the view spec is not an object; the view draws as an error'] });
  });
});

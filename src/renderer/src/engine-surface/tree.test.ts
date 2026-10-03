// R2: the surface's own guard over a plugin's tree (tree.ts), over the trees 2.1.287 answered in pass3/mods-surface-*.
import { describe, expect, it } from 'vitest';
import { loadJournal } from '../../../../test/support/fixtures';
import { drawsEngine, hasInk, firstEngineRef, parseTree, textOf } from './tree';

// Every tree a fixture's render answers carried, by component.
function trees(name: string, component: string): unknown[] {
  const rows = loadJournal('pass3', name);
  const asked = new Map<string, string>();
  for (const row of rows) {
    const f = row.frame as { type?: string; request_id?: string; request?: { subtype?: string; component?: string } };
    if (row.direction === 'out' && f.type === 'control_request' && f.request?.subtype === 'ui_render') asked.set(f.request_id!, f.request.component!);
  }
  return rows.flatMap((row) => {
    const f = row.frame as { type?: string; response?: { request_id?: string; response?: { tree?: unknown } } };
    return row.direction === 'in' && f.type === 'control_response' && asked.get(f.response?.request_id ?? '') === component ? [f.response!.response!.tree] : [];
  });
}

describe('parseTree (R2)', () => {
  it('keeps every element the probe drew: the band, the hint, the pane', () => {
    const band = parseTree(trees('mods-surface-render-sites', 'AbovePrompt')[0]);
    expect(band).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } });
    expect(textOf(band)).toContain('MODS_PROBE_BAND presses=0');
    const row = (band as { children: { type: string; children: unknown[] }[] }).children[1]!;
    expect(row.children.map((c) => (c as { type: string }).type)).toEqual(['Button', 'Input', 'Button', 'Button', 'Button']);
    expect(row.children[0]).toEqual({ type: 'Button', props: { key: 'press', label: 'Press', variant: 'primary' }, press: { plugin: 'mods-probe', handle: 1 } });
    expect(row.children[1]).toEqual({ type: 'Input', props: { key: 'reply', label: 'Reply', placeholder: 'Type here', value: '', submitLabel: 'Send' }, press: { plugin: 'mods-probe', handle: 2 } });
    expect(parseTree(trees('mods-surface-render-sites', 'PromptHint')[0])).toEqual({ type: 'Text', props: { dimColor: true }, children: ['MODS_PROBE_HINT draft=false working=false'] });
    const pane = parseTree(trees('mods-surface-render-sites', 'Pane')[0]) as { children: { type: string }[] };
    expect(pane.children.map((c) => c.type).slice(0, 7)).toEqual(['Text', 'Select', 'Link', 'Markdown', 'Code', 'Svg', 'Box']);
    expect(pane.children[2]).toEqual({ type: 'Link', props: { href: 'https://example.com/mods-probe', label: 'Probe link' }, children: [] });
  });

  it('draws a node that fails its shape as its children alone, never failing the siblings', () => {
    const tree = parseTree({
      type: 'Box',
      children: [
        { type: 'Link', props: { href: 'javascript:alert(1)' }, children: ['text kept'] },
        { type: 'Button', props: { label: 'no key' }, press: { plugin: 'p', handle: 1 } },
        { type: 'Select', props: { key: 's', options: [{ value: 'a' }, { value: 'a' }] }, press: { plugin: 'p', handle: 2 } },
        { type: 'Raster', props: {} },
        { type: 'Text', props: { color: { not: 'a primitive' } }, children: ['plain'] },
        'after',
      ],
    }) as { children: unknown[] };
    expect(tree.children).toEqual([
      { type: 'fragment', children: ['text kept'] },
      { type: 'fragment', children: [] },
      { type: 'fragment', children: [] },
      { type: 'fragment', children: [] },
      { type: 'fragment', children: ['plain'] },
      'after',
    ]);
  });

  it('draws nothing for a tree past the bounds, and reads the engine node as MAWS’s own', () => {
    const deep = Array.from({ length: 40 }).reduce<unknown>((inner) => ({ type: 'Box', children: [inner] }), 'leaf');
    expect(parseTree(deep)).toBeNull();
    const wide = { type: 'Box', children: Array.from({ length: 2500 }, (_, i) => String(i)) };
    expect(parseTree(wide)).toBeNull();
    expect(drawsEngine(parseTree({ type: 'engine', ref: 0 }))).toBe(true);
    expect(drawsEngine(null)).toBe(true);
    expect(drawsEngine(parseTree({ type: 'Text', children: ['x'] }))).toBe(false);
  });
});

describe('row tree classification', () => {
  it('native slots and whitespace do not count as mod ink, while decoration and controls do', () => {
    expect(hasInk(parseTree({ type: 'Box', children: ['  ', { type: 'engine', ref: 7 }] }))).toBe(false);
    expect(hasInk(parseTree({ type: 'Box', props: { borderStyle: 'round' }, children: [] }))).toBe(true);
    expect(hasInk(parseTree({ type: 'Text', props: { inverse: true }, children: [] }))).toBe(true);
    expect(hasInk(parseTree({ type: 'Markdown', props: { text: '  ' } }))).toBe(false);
    expect(hasInk(parseTree({ type: 'Input', props: { key: 'reply' }, press: { plugin: 'p', handle: 1 } }))).toBe(true);
  });
  it('finds the first native reference in a nested tree, not only at its root', () => {
    expect(firstEngineRef(parseTree({ type: 'Box', children: ['before', { type: 'Box', children: [{ type: 'engine', ref: 7 }] }, { type: 'engine', ref: 8 }] }))).toBe(7);
    expect(firstEngineRef(parseTree({ type: 'Text', children: ['replacement'] }))).toBeNull();
  });
});

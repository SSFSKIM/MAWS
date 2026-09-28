import { describe, expect, it } from 'vitest';
import { findTokenViolations, scanRendererSources } from './tokens-guard';

describe('renderer uses tokens only', () => {
  it('rejects colour literals and palette classes', () => {
    const source = [
      'const a = { color: "#fff" };',
      'const b = "rgb(1,2,3)";',
      '<div className="bg-red-500" />',
    ].join('\n');
    expect(findTokenViolations(source).map((v) => [v.line, v.match])).toEqual([
      [1, '#fff'],
      [2, 'rgb('],
      [3, 'bg-red-500'],
    ]);
  });

  it('rejects every colour function the guard names', () => {
    for (const literal of ['rgba(0,0,0,.5)', 'hsl(0 0% 0%)', 'oklch(0.5 0.1 20)', '#1f1e1b', '#faf9f6cc']) {
      expect(findTokenViolations(`x { color: ${literal} }`), literal).toHaveLength(1);
    }
    for (const cls of ['text-slate-700', 'border-zinc-200', 'fill-emerald-50', 'ring-sky-950', 'from-rose-400']) {
      expect(findTokenViolations(`<i className="${cls}" />`), cls).toHaveLength(1);
    }
  });

  it('accepts token utilities and token variables', () => {
    const source = [
      '<div className="bg-bg text-fg-muted border-border-strong rounded-md font-mono text-ui" />',
      'const s = { background: "var(--bg-raised)", color: "var(--fg)" };',
    ].join('\n');
    expect(findTokenViolations(source)).toEqual([]);
  });

  it('holds for every renderer source outside tokens.css', () => {
    const violations = scanRendererSources();
    expect(violations.map((v) => `${v.file}:${v.line} ${v.match}`)).toEqual([]);
  });
});

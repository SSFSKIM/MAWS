// The thinking mark's geometry and motion: what the owner chose it for has to hold — a weave that alternates, a mesh
// that stays whole as the lobes breathe, and a turn that slows between beats without ever stopping.
import { describe, expect, it } from 'vitest';
import { OVER, advance, buildIndices, buildMesh, newMarkState } from './triquetra';

describe('thinking mark', () => {
  it('weaves: each arc passes over at exactly one crossing', () => {
    expect([...OVER].sort()).toEqual([0, 1, 2]);
    OVER.forEach((arc, crossing) => expect(arc).not.toBe(crossing));
  });

  it('keeps its mesh whole across the breathing range', () => {
    const n = 24;
    const indices = buildIndices(n);
    for (const s of [0.92, 1.02, 1.12]) {
      const mesh = buildMesh(s, n, new Float32Array(3 * (n + 1) * 16 * 8));
      expect(mesh.every(Number.isFinite)).toBe(true);
      expect(Math.max(...indices)).toBe(mesh.length / 8 - 1);
    }
  });

  it('slows between turns but never stops', () => {
    const state = newMarkState();
    let prev = advance(state, 0).q;
    const steps: number[] = [];
    for (let i = 0; i < 600; i++) {
      const { q } = advance(state, 1 / 60);
      const dot = Math.abs(q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3]);
      steps.push(2 * Math.acos(Math.min(1, dot)));
      prev = q;
    }
    const slowest = Math.min(...steps), fastest = Math.max(...steps);
    expect(slowest).toBeGreaterThan(0);
    expect(slowest / fastest).toBeGreaterThan(0.03);
    expect(slowest / fastest).toBeLessThan(0.4);
  });
});

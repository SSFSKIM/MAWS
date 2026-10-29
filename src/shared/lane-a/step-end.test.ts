import { describe, expect, it } from 'vitest';
import { stepEndFields } from './step-end';

const step = { turnId: 't1', agentId: null, step: 1 };

describe('a step-end’s optional fields', () => {
  it('reads t, model and effort when present', () => {
    expect(stepEndFields({ ...step, t: 1730000000000, model: 'claude-haiku-4-5', effort: 'low' } as never)).toEqual({ t: 1730000000000, model: 'claude-haiku-4-5', effort: 'low' });
  });

  it('reads none from a step-end without them, and none that is ill-typed', () => {
    expect(stepEndFields(step)).toEqual({});
    expect(stepEndFields({ ...step, t: '1', model: 3, effort: '' } as never)).toEqual({});
  });
});

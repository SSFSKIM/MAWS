// A terminal session's permission mode as its bridge reports it (sminos 1.27.14): the three fields of a heartbeat's
// `state` or a `read status` result, and the bridges that carry them.
import { describe, expect, it } from 'vitest';
import { modeOf, reportsMode } from './mode';

const AT = 1_761_700_000_000;

describe('the mode a bridge reports', () => {
  it('reads none while the three fields are absent', () => {
    expect(modeOf({ mainTurn: null, isStreaming: false, tools: [] })).toBeNull();
    expect(modeOf(null)).toBeNull();
  });

  it('reads the engine’s word, when the bridge read it and the event it came in', () => {
    expect(modeOf({ mainTurn: null, permissionMode: 'plan', permissionModeAt: AT, permissionModeFrom: 'permission_mode_changed' })).toEqual({ mode: 'plan', at: AT, from: 'permission_mode_changed' });
    expect(modeOf({ permissionMode: 'default', permissionModeAt: AT, permissionModeFrom: 'UserPromptSubmit' })).toEqual({ mode: 'default', at: AT, from: 'UserPromptSubmit' });
  });

  it('reads none from a partial or ill-typed report, or a word that is none of the engine’s modes', () => {
    expect(modeOf({ permissionMode: 'plan' })).toBeNull();
    expect(modeOf({ permissionMode: 'plan', permissionModeAt: String(AT), permissionModeFrom: 'UserPromptSubmit' })).toBeNull();
    expect(modeOf({ permissionMode: 'plan', permissionModeAt: Number.NaN, permissionModeFrom: 'UserPromptSubmit' })).toBeNull();
    expect(modeOf({ permissionMode: 'plan', permissionModeAt: AT })).toBeNull();
    expect(modeOf({ permissionMode: 'manual', permissionModeAt: AT, permissionModeFrom: 'UserPromptSubmit' })).toBeNull();
  });
});

describe('the bridges that report it', () => {
  it('are sminos 1.27.14 and later', () => {
    expect(reportsMode('1.27.14')).toBe(true);
    expect(reportsMode('1.27.15')).toBe(true);
    expect(reportsMode('1.28.0')).toBe(true);
    expect(reportsMode('2.0.0')).toBe(true);
  });

  it('never an older one, or one that names no version', () => {
    expect(reportsMode('1.27.13')).toBe(false);
    expect(reportsMode('1.26.99')).toBe(false);
    expect(reportsMode('0.99.99')).toBe(false);
    expect(reportsMode(null)).toBe(false);
    expect(reportsMode('dev')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { syntheticRequest } from '../test-requests';
import { declaredDialog } from './dialog-kinds';

const payloadOf = (name: string) => {
  const event = syntheticRequest(name);
  if (event.kind !== 'dialog.requested') throw new Error(`${name} is not a dialog`);
  return event;
};

describe('declared dialog kinds and their pinned payloads', () => {
  it('reads a refusal fallback payload in the pinned schema', () => {
    const { dialogKind, payload } = payloadOf('refusal-fallback-dialog');
    const read = declaredDialog(dialogKind, payload);
    expect(read).toMatchObject({ ok: true, dialog: { kind: 'refusal_fallback_prompt', payload: { originalModel: 'claude-fable-5', fallbackModel: 'claude-sonnet-5', apiRefusalCategory: 'cyber' } } });
  });

  it('reads an auto-mode server fallback payload in the pinned schema', () => {
    const { dialogKind, payload } = payloadOf('auto-mode-fallback-dialog');
    const read = declaredDialog(dialogKind, payload);
    expect(read.ok && read.dialog.kind === 'auto_mode_server_fallback' && read.dialog.payload.paragraphs).toHaveLength(3);
  });

  it('refuses an undeclared kind, and a declared kind whose payload does not match its schema', () => {
    const { dialogKind, payload } = payloadOf('undeclared-dialog');
    expect(declaredDialog(dialogKind, payload)).toEqual({ ok: false, reason: 'undeclared' });
    const invalid = declaredDialog('refusal_fallback_prompt', { originalModel: 'x' });
    expect(invalid).toMatchObject({ ok: false, reason: 'invalid' });
    expect(!invalid.ok && invalid.problem).toMatch(/fallbackModel/);
  });
});

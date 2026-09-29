import { describe, expect, it } from 'vitest';
import { autoModeNote, isGatewayModel, ModelCatalogueSchema, type ModelCatalogueEntry } from './models';

const sonnet: ModelCatalogueEntry = { value: 'sonnet', displayName: 'Sonnet 5', supportsAutoMode: true };
const haiku: ModelCatalogueEntry = { value: 'haiku', displayName: 'Haiku' }; // reads.jsonl seq 3: no supportsAutoMode
const astra: ModelCatalogueEntry = { value: 'claude/astra', displayName: 'astra', supportsAutoMode: true };

describe('the model catalogue', () => {
  it('names gateway models by the relay alias prefix', () => {
    expect(isGatewayModel('claude/astra')).toBe(true);
    expect(isGatewayModel('claude/deepseek/deepseek-v4.1-flash[1m]')).toBe(true);
    expect(isGatewayModel('sonnet')).toBe(false);
    expect(isGatewayModel('claude-sonnet-5')).toBe(false); // a model id, not the relay's alias namespace
    expect(isGatewayModel('')).toBe(false);
  });

  it('notes a model that cannot hold auto mode only when the mode is auto', () => {
    expect(autoModeNote(haiku, 'auto')).toBe('This model cannot hold auto mode; the engine will run in default.');
    expect(autoModeNote(haiku, 'default')).toBeNull();
    expect(autoModeNote(haiku, null)).toBeNull();
    expect(autoModeNote(sonnet, 'auto')).toBeNull();
  });

  it('notes the local auto-mode lane of a gateway model under auto or the settings default', () => {
    const note = 'Auto-mode reviews for this model run locally on Sonnet 5 and count against your usage.';
    expect(autoModeNote(astra, 'auto')).toBe(note);
    expect(autoModeNote(astra, null)).toBe(note);
    expect(autoModeNote(astra, 'default')).toBeNull();
    expect(autoModeNote({ ...astra, supportsAutoMode: false }, 'auto')).toBe('This model cannot hold auto mode; the engine will run in default.');
    expect(autoModeNote(null, 'auto')).toBeNull();
  });

  it('keeps unknown catalogue keys and refuses an unknown source', () => {
    const parsed = ModelCatalogueSchema.parse({ models: [{ ...sonnet, resolvedModel: 'claude-sonnet-5' }], source: 'live', at: '2026-09-29T00:00:00.000Z' });
    expect(parsed.models[0]).toMatchObject({ resolvedModel: 'claude-sonnet-5' });
    expect(ModelCatalogueSchema.safeParse({ models: [], source: 'guess', at: null }).success).toBe(false);
  });
});

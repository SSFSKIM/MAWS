import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rowFor } from './model-label';
import { autoModeNote, BUILTIN_MODELS, isGatewayModel, ModelCatalogueSchema, type ModelCatalogueEntry } from './models';

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
    expect(autoModeNote(haiku, 'auto')).toBe("Auto mode isn't available for Haiku. This session will use Accept edits instead."); // W3: the fallback
    expect(autoModeNote(haiku, 'auto', 'default')).toBe("Auto mode isn't available for Haiku. This session will use Manual instead.");
    expect(autoModeNote(haiku, 'default')).toBeNull();
    expect(autoModeNote(haiku, null)).toBeNull();
    expect(autoModeNote(sonnet, 'auto')).toBeNull();
  });

  it('notes the local auto-mode lane of a gateway model under auto or the settings default', () => {
    const note = 'Auto-mode reviews for this model run locally on Sonnet 5 and count against your usage.';
    expect(autoModeNote(astra, 'auto')).toBe(note);
    expect(autoModeNote(astra, null)).toBe(note);
    expect(autoModeNote(astra, 'default')).toBeNull();
    expect(autoModeNote({ ...astra, supportsAutoMode: false }, 'auto')).toBe("Auto mode isn't available for astra. This session will use Accept edits instead.");
    expect(autoModeNote(null, 'auto')).toBeNull();
  });

  it('keeps unknown catalogue keys and refuses an unknown source', () => {
    const parsed = ModelCatalogueSchema.parse({ models: [{ ...sonnet, resolvedModel: 'claude-sonnet-5' }], source: 'live', at: '2026-09-29T00:00:00.000Z' });
    expect(parsed.models[0]).toMatchObject({ resolvedModel: 'claude-sonnet-5' });
    expect(ModelCatalogueSchema.safeParse({ models: [], source: 'guess', at: null }).success).toBe(false);
  });
});

// W9 (H4): the built-in rows stand in until a launch lists the catalogue, so a running session's resolved id must find
// its row among them (the selector's check mark and the mode menu's auto verdict match on it exactly).
describe('the built-in catalogue', () => {
  it('resolves Sonnet as the latest pass3 recording lists it, so a running Sonnet session finds its row', () => {
    const recorded = readFileSync(join(__dirname, '../../../spikes/protocol-probe/fixtures/pass3/w4-question-partial.jsonl'), 'utf8');
    const resolved = /\{"value":"sonnet","resolvedModel":"([^"]+)"/.exec(recorded)?.[1];
    expect(resolved).toBe('claude-sonnet-5-5[1m]');
    expect(BUILTIN_MODELS.find((m) => m.value === 'sonnet')?.resolvedModel).toBe(resolved);
    expect(rowFor(BUILTIN_MODELS, resolved!)?.value).toBe('sonnet');
  });
});

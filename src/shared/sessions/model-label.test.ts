import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_MODELS } from '@shared/sessions/models';
import type { ListModelsResponse } from '@shared/wire/control';
import { fixtureLine, RESPONSES } from '../../../test/support/widget-backend';
import { aliasOf, chipLabel, defaultTarget, reportsRequested, rowFor, shortAlias } from './model-label';

const ROOT = join(__dirname, '../../..');
const CATALOGUE = (fixtureLine(ROOT, RESPONSES.list_models) as ListModelsResponse).models; // pass2/auto-routed seq 143: default and opus share claude-opus-5-5[1m]

describe('the model chip says `<alias> <effort>`', () => {
  it('names a resolved id by the first named row, never by `default`', () => {
    expect(CATALOGUE[0].value).toBe('default');
    expect(rowFor(CATALOGUE, 'claude-opus-5-5[1m]')?.value).toBe('opus');
    expect(aliasOf('claude-opus-5-5[1m]', CATALOGUE)).toBe('opus');
    expect(aliasOf('claude-sonnet-5[1m]', CATALOGUE)).toBe('sonnet');
    expect(aliasOf('claude-fable-5-1[1m]', CATALOGUE)).toBe('fable');
  });

  it('strips `claude/` from gateway aliases and keeps an OpenRouter row to its model', () => {
    expect(aliasOf('claude/sol', CATALOGUE)).toBe('sol');
    expect(aliasOf('claude/astra', CATALOGUE)).toBe('astra');
    expect(aliasOf('claude/deepseek/deepseek-v4.1-flash[1m]', CATALOGUE)).toBe('deepseek-v4.1-flash');
  });

  it('resolves `default` to the row its resolved model names, on the live catalogue and the built-in one', () => {
    expect(defaultTarget(CATALOGUE)?.value).toBe('opus');
    expect(aliasOf('default', CATALOGUE)).toBe('opus');
    expect(aliasOf('default', BUILTIN_MODELS)).toBe('opus');
  });

  it('names an id no row lists by its family, and anything else as it is', () => {
    expect(aliasOf('claude-haiku-4-5-20251001', [])).toBe('haiku');
    expect(shortAlias('claude-opus-5-5[1m]')).toBe('opus');
    expect(shortAlias('some-model')).toBe('some-model');
  });

  it('joins the effort, leaves it out when there is none, and never says Default', () => {
    expect(chipLabel('opus', 'high')).toBe('opus high');
    expect(chipLabel('sonnet', 'xhigh')).toBe('sonnet xhigh');
    expect(chipLabel('haiku', null)).toBe('haiku');
    expect(chipLabel(null, null)).toBe('Model');
    expect(chipLabel(aliasOf('default', CATALOGUE), 'high')).not.toMatch(/default/i);
  });
});

// The review of S-chip: whether the engine runs the model asked for is a question of exact ids through the catalogue;
// the alias is for display only, and two models can share one.
describe('whether the engine reports the model asked for', () => {
  const rows = [
    { value: 'default', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Default (recommended)' },
    { value: 'opus', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Opus 5.5 (1M context)' },
    { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5' },
    { value: 'claude/vendor-a/glm', resolvedModel: 'claude/vendor-a/glm', displayName: 'GLM (A)' },
    { value: 'claude/vendor-b/glm', resolvedModel: 'claude/vendor-b/glm', displayName: 'GLM (B)' },
    { value: 'sonnet', displayName: 'Sonnet' }, // an entry with no resolved id (an unstarted catalogue's)
  ];

  it('an alias, `default` or a resolved id against the id it runs', () => {
    expect(reportsRequested('opus', 'claude-opus-5-5[1m]', rows)).toBe(true);
    expect(reportsRequested('default', 'claude-opus-5-5[1m]', rows)).toBe(true);
    expect(reportsRequested('claude-haiku-5-5', 'claude-haiku-5-5', rows)).toBe(true);
    expect(reportsRequested('default', 'claude-haiku-5-5', rows)).toBe(false);
  });

  it('two models that read alike are not the same model', () => {
    expect(aliasOf('haiku', rows)).toBe(aliasOf('claude-haiku-4-5-20251001', rows)); // both read "haiku"
    expect(reportsRequested('haiku', 'claude-haiku-4-5-20251001', rows)).toBe(false); // Haiku 5.5 asked for, 4.5 reported
    expect(reportsRequested('claude-haiku-5-5', 'claude-haiku-4-5-20251001', rows)).toBe(false);
    expect(aliasOf('claude/vendor-a/glm', rows)).toBe(aliasOf('claude/vendor-b/glm', rows)); // both read "glm"
    expect(reportsRequested('claude/vendor-a/glm', 'claude/vendor-b/glm', rows)).toBe(false);
    expect(reportsRequested('claude-haiku-5-5', 'claude-haiku-5-5[1m]', rows)).toBe(false); // the 1M variant is another id
  });

  it('cannot say for an alias the catalogue does not resolve', () => {
    expect(reportsRequested('fable', 'claude-fable-5-1[1m]', rows)).toBeNull(); // no row
    expect(reportsRequested('sonnet', 'claude-sonnet-5[1m]', rows)).toBeNull(); // a row with no resolved id
    expect(reportsRequested('default', 'claude-opus-5-5[1m]', [])).toBeNull();
    expect(reportsRequested('sonnet', 'sonnet', rows)).toBe(true); // the same id needs no catalogue
  });
});

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_MODELS } from '@shared/sessions/models';
import type { ListModelsResponse } from '@shared/wire/control';
import { fixtureLine, RESPONSES } from '../../../test/support/widget-backend';
import { aliasOf, chipLabel, defaultTarget, rowFor, shortAlias } from './model-label';

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

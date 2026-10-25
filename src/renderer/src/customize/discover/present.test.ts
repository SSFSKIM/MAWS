// P4-AGG M3: what a Discover card and its detail say about an item (the Discover spec, Design "A card", "The trust
// label", "Components before install" and "Adding"): the trust label and its tooltip from the review tier, else the
// ownership class; the components line, or "Contents shown after install"; the runs-code warning naming what runs code,
// or the softer wording when the contents are unknown; counts only where a source has them.
import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { cardContentsWords, componentsWords, installCountWords, metricWords, monogramOf, runsCodeWords, trustOf } from './present';
import { item } from './test-items';

describe('the trust label', () => {
  it('follows the directory’s review tier where it has one, with Desktop’s wording and no security claim for a partner', () => {
    expect(trustOf(item({ reviewTier: 'anthropic' }))).toEqual({ label: 'Verified', tooltip: 'Verified — Anthropic has reviewed this plugin for quality and security.' });
    expect(trustOf(item({ reviewTier: 'partner' }))).toEqual({ label: 'Partner', tooltip: 'Anthropic’s directory lists the publisher as a partner.' });
    expect(trustOf(item({ reviewTier: 'community', ownership: 'anthropic' }))).toEqual({ label: 'Community', tooltip: 'This plugin hasn’t been reviewed in depth by Anthropic.' });
    expect(trustOf(item({ kind: 'connector', reviewTier: 'anthropic' })).tooltip).toBe('Verified — Anthropic has reviewed this connector for quality and security.');
  });

  it('else follows the ownership class: listed by Anthropic or a vendor in a marketplace, community, or added by you', () => {
    expect(trustOf(item({ ownership: 'anthropic' }))).toEqual({ label: 'Listed by Anthropic', tooltip: 'In the claude-plugins-official marketplace; Anthropic’s directory has no record of it.' });
    expect(trustOf(item({ ownership: 'partner', publisher: 'Carta', install: { kind: 'plugin', marketplaceSource: 'carta/plugins', marketplaceName: 'carta-plugins', pluginName: 'x', ref: null, present: false } }))).toEqual({
      label: 'Listed by Carta',
      tooltip: 'In the carta-plugins marketplace; Anthropic’s directory has no record of it.',
    });
    expect(trustOf(item({ ownership: 'community' })).label).toBe('Community');
    expect(trustOf(item({ ownership: 'added' }))).toEqual({ label: 'Added by you', tooltip: 'You added this marketplace. Anthropic hasn’t reviewed it.' });
  });
});

describe('the components line', () => {
  it('counts what is known and says when it runs code', () => {
    expect(componentsWords(item({ components: { skills: ['a', 'b', 'c'], mcpServers: [{ name: 's', transport: 'stdio' }], hooks: false, commands: 0, agents: 0, cli: false }, runsOnYourComputer: true }))).toBe('3 skills · MCP server · runs code');
    expect(componentsWords(item({ components: { skills: [], mcpServers: [], hooks: true, commands: 2, agents: 1, cli: true }, runsOnYourComputer: true }))).toBe('hooks · 2 commands · 1 agent · CLI · runs code');
    expect(componentsWords(item({ components: { skills: ['one'], mcpServers: [{ name: 'r', transport: 'http' }, { name: 'q', transport: 'http' }], hooks: false, commands: 0, agents: 0, cli: false }, runsOnYourComputer: false }))).toBe('1 skill · 2 MCP servers');
  });

  it('says the contents are shown after install when no source lists them', () => {
    expect(componentsWords(item({ components: null, runsOnYourComputer: 'unknown' }))).toBe('Contents shown after install');
  });
});

describe('the runs-code warning', () => {
  const withComponents = (components: CatalogItem['components'], runs: CatalogItem['runsOnYourComputer']) => runsCodeWords(item({ components, runsOnYourComputer: runs }));
  it('names hooks, local MCP servers and a CLI', () => {
    expect(withComponents({ skills: [], mcpServers: [], hooks: true, commands: 0, agents: 0, cli: false }, true)).toBe('Includes components that run code on your computer: hooks.');
    expect(withComponents({ skills: [], mcpServers: [{ name: 'a', transport: 'stdio' }, { name: 'b', transport: 'http' }], hooks: false, commands: 0, agents: 0, cli: true }, true)).toBe('Includes components that run code on your computer: a local MCP server, a CLI.');
    expect(withComponents({ skills: [], mcpServers: [], hooks: false, commands: 0, agents: 0, cli: false }, true)).toBe('Includes components that run code on your computer.');
  });

  it('is the softer wording when the contents are unknown, and nothing when nothing runs code', () => {
    expect(withComponents(null, 'unknown')).toBe('May include components that run code on your computer; its contents are not known before install.');
    expect(withComponents({ skills: ['s'], mcpServers: [], hooks: false, commands: 0, agents: 0, cli: false }, false)).toBeNull();
  });
});

describe('counts', () => {
  it('shows installs or a connector’s rank where a source has them, and nothing otherwise', () => {
    expect(metricWords(item({ installs: 1_266_133 }))).toBe('1.3M installs');
    expect(metricWords(item({ installs: 940 }))).toBe('940 installs');
    expect(metricWords(item({ kind: 'connector', rank: 4 }))).toBe('#4 most popular');
    expect(metricWords(item({ installs: null }))).toBeNull();
    expect(metricWords(item({ installs: 0 }))).toBeNull();
  });
});

describe('install counts', () => {
  it('formats as Desktop does: the integer below 1,000, then one decimal with .0 dropped and K or M', () => {
    expect(installCountWords(0)).toBe('0');
    expect(installCountWords(999)).toBe('999');
    expect(installCountWords(1_000)).toBe('1K');
    expect(installCountWords(3_448)).toBe('3.4K');
    expect(installCountWords(12_345)).toBe('12.3K');
    expect(installCountWords(999_949)).toBe('999.9K');
    expect(installCountWords(999_950)).toBe('1M');
    expect(installCountWords(1_290_640)).toBe('1.3M');
  });
});

describe('a card’s contents line', () => {
  it('on Skills, the skills by name; elsewhere, and with no skills known, the components line', () => {
    const skills = item({ components: { skills: ['greet', 'summarize-diff'], mcpServers: [], hooks: false, commands: 0, agents: 0, cli: false } });
    expect(cardContentsWords(skills, 'skills')).toBe('greet, summarize-diff');
    expect(cardContentsWords(skills, 'plugins')).toBe('2 skills');
    expect(cardContentsWords(item({ components: null }), 'skills')).toBe('Contents shown after install');
  });
});

describe('the monogram (an item with no icon)', () => {
  it('is the name’s first letter; a name that starts with a digit keeps its first two characters, so 42crunch reads 42', () => {
    expect(monogramOf('frontend-design')).toBe('F');
    expect(monogramOf('@acme/tools')).toBe('A'); // a leading symbol is skipped
    expect(monogramOf('42crunch')).toBe('42');
    expect(monogramOf('1password')).toBe('1P');
    expect(monogramOf('3')).toBe('3');
    expect(monogramOf('élan')).toBe('É');
    expect(monogramOf('--')).toBe('?');
  });
});

// Browse's model (P2-B execution document §5.8): what the engine's configured sources offer, one card per plugin — a
// built-in directory entry and the same plugin in Anthropic's marketplace folded into one card on the engine's own source
// key — the installed identities joined back in (the engine's `--available` leaves them out), the install counts only
// where the engine supplies them, and the view's search, filter and order, over hand-built rows shaped as the host
// answers them.
import { describe, expect, it } from 'vitest';
import type { Marketplace } from '@shared/ipc/schema/marketplaces';
import type { AvailablePlugin, InstalledPlugin } from '@shared/ipc/schema/plugins';
import { browseCards, browseView, installCountWords, type BrowseCard, type BrowseSection } from './browse';
import { identitiesOf } from './library';

const DIRECTORY = 'anthropic-plugin-directory';
const market = (name: string, source: string, locator: string | null, ref: string | null = null): Marketplace => ({ name, source, locator, installLocation: `/cfg/plugins/marketplaces/${name}`, ref });
const OFFICIAL = market('claude-plugins-official', 'github', 'anthropics/claude-plugins-official');
const ACME = market('acme', 'github', 'acme/plugins');
const LOCAL = market('e8-scratch', 'directory', '/work/market');

const offer = (pluginId: string, over: Partial<AvailablePlugin> = {}): AvailablePlugin => {
  const [name, marketplaceName] = pluginId.split('@');
  return { pluginId, name, marketplaceName, description: `${name} described`, version: null, source: `./plugins/${name}`, installCount: null, ...over };
};
// The directory's entry for a plugin of the official repository, as 2.1.295 lists it (U3 3c).
const listed = (name: string, path = `plugins/${name}`, over: Partial<AvailablePlugin> = {}) =>
  offer(`${name}@${DIRECTORY}`, { source: { kind: 'git-subdir', url: 'https://github.com/anthropics/claude-plugins-official', repo: null, path }, ...over });

const inst = (id: string, over: Partial<InstalledPlugin> = {}): InstalledPlugin => {
  const [name, marketplace] = id.split('@');
  return { id, name, marketplace, version: '1.0.0', scope: 'user', enabled: true, projectPath: null, installPath: `/cfg/plugins/cache/${marketplace}/${name}/1.0.0`, errors: [], notes: [], installedAt: null, lastUpdated: null, projectEnabled: false, here: false, coversHere: false, ...over };
};
const identities = (installed: InstalledPlugin[], markets: Marketplace[]) => identitiesOf(installed, markets, new Map(), null);
const byId = (cards: readonly BrowseCard[]) => new Map(cards.map((c) => [c.pluginId, c]));
const ANTHROPIC: BrowseSection = { kind: 'anthropic' };
const marketSection = (name: string): BrowseSection => ({ kind: 'marketplace', name });

describe('Browse: the fold', () => {
  it('folds a directory entry and the official entry of the same repository and path into one card, the directory’s, with the official count', () => {
    const cards = browseCards([listed('frontend-design'), offer('frontend-design@claude-plugins-official', { installCount: 1_290_640 })], [], [OFFICIAL]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ pluginId: `frontend-design@${DIRECTORY}`, marketplace: DIRECTORY, section: ANTHROPIC, alsoListedIn: ['claude-plugins-official'], installCount: 1_290_640, installed: null });
    expect(cards[0].inventoryFrom).toBe('frontend-design@claude-plugins-official'); // the official entry's files sit in its clone
  });

  it('keeps the larger count when both carry one, and the directory’s own words', () => {
    const cards = browseCards([listed('a', undefined, { installCount: 5, description: 'From the directory' }), offer('a@claude-plugins-official', { installCount: 3, description: 'From the marketplace' })], [], [OFFICIAL]);
    expect(cards).toEqual([expect.objectContaining({ installCount: 5, description: 'From the directory' })]);
  });

  it('keeps two cards when the paths differ, when a ref pins either side, and never folds a third party', () => {
    const differ = browseCards([listed('a', 'plugins/other'), offer('a@claude-plugins-official', { installCount: 7 })], [], [OFFICIAL]);
    expect(differ.map((c) => c.pluginId).sort()).toEqual([`a@${DIRECTORY}`, 'a@claude-plugins-official']);
    expect(byId(differ).get(`a@${DIRECTORY}`)!.installCount).toBeNull(); // never borrowed
    const pinned = browseCards([listed('a'), offer('a@claude-plugins-official')], [], [market('claude-plugins-official', 'github', 'anthropics/claude-plugins-official', 'v1')]);
    expect(pinned).toHaveLength(2);
    const fork = market('claude-plugins-official', 'github', 'someone/claude-plugins-official');
    const forked = browseCards([listed('a', undefined), offer('a@claude-plugins-official', { source: { kind: 'git-subdir', url: 'https://github.com/anthropics/claude-plugins-official', repo: null, path: 'plugins/a' } })], [], [fork]);
    expect(forked).toHaveLength(2); // not Anthropic's marketplace, whatever its entry names
    const third = browseCards([listed('a'), offer('a@acme', { source: { kind: 'git-subdir', url: 'https://github.com/anthropics/claude-plugins-official', repo: null, path: 'plugins/a' } })], [], [ACME]);
    expect(third).toHaveLength(2);
  });

  it('folds a directory entry with one official entry only, and a sourceless entry never', () => {
    const cards = browseCards([listed('a'), listed('a2', 'plugins/a'), offer('a@claude-plugins-official'), listed('b', undefined, { source: null })], [], [OFFICIAL]);
    expect(cards.map((c) => c.pluginId).sort()).toEqual([`a2@${DIRECTORY}`, `a@${DIRECTORY}`, `b@${DIRECTORY}`]);
    expect(byId(cards).get(`a2@${DIRECTORY}`)!.alsoListedIn).toEqual([]);
  });
});

describe('Browse: the installed join', () => {
  it('adds a card for every installed identity of a listed source: Installed for the user or here, Installed in other projects otherwise', () => {
    const installed = [
      inst('code-review@claude-plugins-official'),
      inst('supabase@claude-plugins-official', { scope: 'local', projectPath: '/work/other' }),
      inst('frontend-design@claude-plugins-official', { scope: 'project', projectPath: '/work/maws', here: true, coversHere: true }),
      inst('worktree@acme', { scope: 'project', projectPath: '/work/maws', coversHere: true }), // a parent project of this worktree
      inst('mine@skills-dir'), // not a listed source
      inst('gone@removed-market'), // its marketplace is no longer listed
    ];
    const cards = byId(browseCards([offer('e8@acme')], identities(installed, [OFFICIAL, ACME]), [OFFICIAL, ACME]));
    expect(cards.get('code-review@claude-plugins-official')!.installed?.where).toBe('here');
    expect(cards.get('frontend-design@claude-plugins-official')!.installed?.where).toBe('here');
    expect(cards.get('worktree@acme')!.installed?.where).toBe('here');
    expect(cards.get('supabase@claude-plugins-official')!.installed?.where).toBe('otherProjects');
    expect(cards.get('e8@acme')!.installed).toBeNull();
    expect(cards.has('mine@skills-dir')).toBe(false);
    expect(cards.has('gone@removed-market')).toBe(false);
    // an installed card carries no count (the engine's listing leaves it out, and none is borrowed) and its own version
    expect(cards.get('code-review@claude-plugins-official')).toMatchObject({ installCount: null, version: '1.0.0', section: ANTHROPIC, marketplace: 'claude-plugins-official' });
  });

  it('a directory plugin installed stays one card; the directory duplicate the engine hides for an installed official plugin stays hidden', () => {
    // the engine left out frontend-design@claude-plugins-official (installed) and its directory twin; nothing brings the twin back
    const cards = browseCards([listed('other')], identities([inst('frontend-design@claude-plugins-official')], [OFFICIAL]), [OFFICIAL]);
    expect(cards.map((c) => c.pluginId).sort()).toEqual([`frontend-design@claude-plugins-official`, `other@${DIRECTORY}`]);
    const installedDirectory = browseCards([], identities([inst(`x@${DIRECTORY}`)], []), []);
    expect(installedDirectory).toEqual([expect.objectContaining({ pluginId: `x@${DIRECTORY}`, section: ANTHROPIC, installed: expect.objectContaining({ where: 'here' }) })]);
  });

  it('an offered id that is also installed is one card, marked by its installations (never by a name alone)', () => {
    const cards = browseCards([offer('a@acme', { installCount: null }), offer('a@other-acme')], identities([inst('a@acme', { scope: 'project', projectPath: '/work/other' })], [ACME]), [ACME, market('other-acme', 'git', 'https://example.com/other.git')]);
    expect(cards.filter((c) => c.pluginId === 'a@acme')).toHaveLength(1);
    expect(byId(cards).get('a@acme')!.installed?.where).toBe('otherProjects');
    expect(byId(cards).get('a@other-acme')!.installed).toBeNull(); // same name, another marketplace: not installed
  });
});

describe('Browse: counts', () => {
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

  it('a card has a count only where the row carries a number; directory-only cards have none', () => {
    const cards = byId(browseCards([listed('dir-only'), offer('counted@claude-plugins-official', { installCount: 12 }), offer('none@claude-plugins-official')], [], [OFFICIAL]));
    expect(cards.get(`dir-only@${DIRECTORY}`)!.installCount).toBeNull();
    expect(cards.get('counted@claude-plugins-official')!.installCount).toBe(12);
    expect(cards.get('none@claude-plugins-official')!.installCount).toBeNull();
  });

  it('a zero is no count: never shown, a fold of 0 and a number takes the number, 0 and 0 have none', () => {
    const cards = byId(
      browseCards(
        [listed('a', undefined, { installCount: 0 }), offer('a@claude-plugins-official', { installCount: 42 }), listed('b', undefined, { installCount: 0 }), offer('b@claude-plugins-official', { installCount: 0 }), offer('zero@claude-plugins-official', { installCount: 0 })],
        [],
        [OFFICIAL],
      ),
    );
    expect(cards.get(`a@${DIRECTORY}`)!.installCount).toBe(42);
    expect(cards.get(`b@${DIRECTORY}`)!.installCount).toBeNull();
    expect(cards.get('zero@claude-plugins-official')!.installCount).toBeNull();
  });

  it('Most popular is not offered when 0 is the only count supplied', () => {
    const view = browseView(browseCards([offer('zero@claude-plugins-official', { installCount: 0 }), listed('other')], [], [OFFICIAL]), { search: '', sort: 'popular', status: { installed: true, notInstalled: true }, source: null });
    expect(view.hasCounts).toBe(false);
    expect(view.sort).toBe('name');
  });
});

describe('Browse: sections and the view', () => {
  const CARDS = browseCards(
    [
      listed('zeta'),
      offer('alpha@claude-plugins-official', { installCount: 10 }),
      offer('beta@claude-plugins-official', { installCount: 900 }),
      offer('tools@acme', { description: 'Acme’s tools' }),
      offer('probe@e8-scratch'),
    ],
    identities([inst('kept@e8-scratch'), inst('far@acme', { scope: 'project', projectPath: '/work/other' })], [OFFICIAL, ACME, LOCAL]),
    [OFFICIAL, ACME, LOCAL],
  );
  const VIEW = { search: '', sort: null, status: { installed: true, notInstalled: true }, source: null } as const;
  const label = (section: BrowseSection) => (section.kind === 'anthropic' ? 'Anthropic & Partners' : section.name);
  const shape = (view: ReturnType<typeof browseView>) => view.sections.map((s) => [label(s.section), s.cards.map((c) => c.pluginId)]);

  it('Anthropic & Partners first, then each other marketplace by name; Most popular by default when a card has a count', () => {
    const view = browseView(CARDS, VIEW);
    expect(view.sort).toBe('popular');
    expect(view.hasCounts).toBe(true);
    expect(shape(view)).toEqual([
      ['Anthropic & Partners', ['beta@claude-plugins-official', 'alpha@claude-plugins-official', `zeta@${DIRECTORY}`]],
      ['acme', ['far@acme', 'tools@acme']],
      ['e8-scratch', ['kept@e8-scratch', 'probe@e8-scratch']],
    ]);
  });

  it('Name orders by the display name; Most popular falls back to Name when no card has a count', () => {
    expect(shape(browseView(CARDS, { ...VIEW, sort: 'name' }))[0]).toEqual(['Anthropic & Partners', ['alpha@claude-plugins-official', 'beta@claude-plugins-official', `zeta@${DIRECTORY}`]]);
    const uncounted = browseView(CARDS.filter((c) => c.installCount === null), { ...VIEW, sort: 'popular' });
    expect(uncounted.hasCounts).toBe(false);
    expect(uncounted.sort).toBe('name');
  });

  it('filters by status, source and search (name, id, description), dropping empty sections', () => {
    expect(shape(browseView(CARDS, { ...VIEW, status: { installed: true, notInstalled: false } }))).toEqual([['e8-scratch', ['kept@e8-scratch']]]); // installed in other projects is not installed here
    expect(shape(browseView(CARDS, { ...VIEW, status: { installed: false, notInstalled: true } })).flatMap(([, ids]) => ids)).not.toContain('kept@e8-scratch');
    expect(shape(browseView(CARDS, { ...VIEW, source: marketSection('acme') }))).toEqual([['acme', ['far@acme', 'tools@acme']]]);
    expect(shape(browseView(CARDS, { ...VIEW, source: ANTHROPIC, search: 'ZET' }))).toEqual([['Anthropic & Partners', [`zeta@${DIRECTORY}`]]]);
    expect(shape(browseView(CARDS, { ...VIEW, search: 'acme’s' }))).toEqual([['acme', ['tools@acme']]]);
    expect(shape(browseView(CARDS, { ...VIEW, search: 'probe@e8' }))).toEqual([['e8-scratch', ['probe@e8-scratch']]]);
    expect(browseView(CARDS, { ...VIEW, search: 'nothing like it' }).sections).toEqual([]);
  });

  it('a third-party marketplace named anthropic is its own section and Source, never Anthropic & Partners', () => {
    const impostor = market('anthropic', 'github', 'someone/anthropic');
    const cards = browseCards([offer('x@anthropic'), offer('alpha@claude-plugins-official', { installCount: 10 }), listed('zeta')], [], [OFFICIAL, impostor]);
    expect(byId(cards).get('x@anthropic')!.section).toEqual(marketSection('anthropic'));
    const view = browseView(cards, VIEW);
    expect(view.sources).toEqual([ANTHROPIC, marketSection('anthropic')]);
    expect(view.sections.map((s) => [s.section, s.cards.map((c) => c.pluginId)])).toEqual([
      [ANTHROPIC, ['alpha@claude-plugins-official', `zeta@${DIRECTORY}`]],
      [marketSection('anthropic'), ['x@anthropic']],
    ]);
    expect(browseView(cards, { ...VIEW, source: marketSection('anthropic') }).sections.flatMap((s) => s.cards.map((c) => c.pluginId))).toEqual(['x@anthropic']);
    expect(browseView(cards, { ...VIEW, source: ANTHROPIC }).sections.flatMap((s) => s.cards.map((c) => c.pluginId))).toEqual(['alpha@claude-plugins-official', `zeta@${DIRECTORY}`]);
  });

  it('lists the sources the filter offers in section order', () => {
    expect(browseView(CARDS, VIEW).sources).toEqual([ANTHROPIC, marketSection('acme'), marketSection('e8-scratch')]);
  });
});

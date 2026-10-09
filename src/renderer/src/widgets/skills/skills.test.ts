// The skills library's model (P2-B execution document §5.10): each skill of `get_skills_dialog` in My items' groups by
// where it comes from, a plugin's skill under its plugin's group with the plugin's name as its badge, the catalogue's
// skills in one list when the engine answers the dialog empty, and the view's search and sort.
import { describe, expect, it } from 'vitest';
import type { InstalledPlugin } from '@shared/ipc/schema/plugins';
import { EMPTY_CATALOG, type SessionCatalog } from '../../stores/catalog';
import { identitiesOf } from '../plugins/library';
import type { ObservedPlugin } from '@shared/engine/observed-facts';
import { badgeOf, hasPluginSkills, labelOf, skillGroups, skillsView, type SkillGroup } from './skills';

const HERE = '/work/proj';
const inst = (id: string, over: Partial<InstalledPlugin> = {}): InstalledPlugin => {
  const [name, marketplace] = id.split('@');
  return { id, name, marketplace, version: '1.0.0', scope: 'user', enabled: true, projectPath: null, installPath: `/cfg/plugins/cache/${marketplace}/${name}/1.0.0`, errors: [], notes: [], installedAt: null, lastUpdated: null, projectEnabled: false, here: false, coversHere: false, ...over };
};
const OFFICIAL = { name: 'claude-plugins-official', source: 'github', locator: 'anthropics/claude-plugins-official', installLocation: '/cfg/plugins/marketplaces/claude-plugins-official', ref: null };
const INSTALLED = [
  inst('code-review@claude-plugins-official'),
  inst('frontend-design@claude-plugins-official', { scope: 'project', projectPath: HERE, here: true, coversHere: true }),
  inst('review@acme'),
  inst('review@other-market'),
];
const identities = identitiesOf(INSTALLED, [OFFICIAL], new Map(), null);
const loaded = (source: string, name = source.split('@')[0]): ObservedPlugin => ({ name, path: `/cfg/plugins/cache/${source}`, source, version: null });

// 2.1.295's answer, as U3 F4 recorded it, with the sources the engine words beside it (2.1.292 `xRe` :401474)
const skill = (name: string, source: string, description = `${name} does a thing`) => ({ name, display_name: name, description, source, tokens: 20, state: 'on', advertised: true, handles: {} });
const DIALOG = {
  skills: [
    skill('frontend-design:frontend-design', 'plugin', 'Guidance for distinctive, intentional visual design'),
    skill('u3-project-skill', 'project'),
    skill('u3-user-skill', 'user'),
    skill('local-notes', 'project, gitignored'),
    skill('debug', 'built-in'),
    skill('synced-skill', 'claude.ai sync'),
    skill('lookup', 'mcp'),
    skill('remember', 'memory store'),
    skill('policy', 'managed'),
  ],
};

const flat = (groups: readonly SkillGroup[]) => groups.map(({ group, rows }) => [group, rows.map((r) => r.name)]);

describe('the skills library: groups', () => {
  it('places each skill in My items’ groups by where it comes from, in Desktop’s order', () => {
    const groups = skillGroups(DIALOG, EMPTY_CATALOG, [loaded('frontend-design@claude-plugins-official')], identities);
    expect(flat(groups)).toEqual([
      ['here', ['frontend-design:frontend-design', 'local-notes', 'u3-project-skill']],
      ['yours', ['u3-user-skill']],
      ['synced', ['synced-skill']],
      ['anthropic', ['debug']],
      ['added', ['lookup', 'policy', 'remember']],
    ]);
    const design = groups[0].rows[0];
    expect(design).toEqual({ name: 'frontend-design:frontend-design', plugin: 'Frontend design', description: 'Guidance for distinctive, intentional visual design', source: 'plugin' });
    expect(labelOf(design)).toBe('frontend-design'); // the name after `plugin:`, since the badge names the plugin
    expect(badgeOf(design)).toBe('Frontend design');
  });

  it('credits a skill of any other source with the engine’s own word, and keeps a source it does not know', () => {
    const groups = skillGroups({ skills: [skill('lookup', 'mcp'), skill('odd', 'a source from a later engine'), skill('p', 'constructor'), skill('q', 'toString'), skill('r', '__proto__'), skill('s', 'hasOwnProperty')] }, EMPTY_CATALOG, [], identities);
    // a word an object inherits is still an unknown word: credited, never dropped
    expect(flat(groups)).toEqual([['added', ['lookup', 'odd', 'p', 'q', 'r', 's']]]);
    expect(groups[0].rows.map(badgeOf)).toEqual(['mcp', 'a source from a later engine', 'constructor', 'toString', '__proto__', 'hasOwnProperty']);
    expect(labelOf(groups[0].rows[0])).toBe('lookup');
    // the grouped sources carry no credit of their own
    const mapped = skillGroups(DIALOG, EMPTY_CATALOG, [], identities).flatMap((g) => g.rows).filter((r) => ['project', 'user', 'built-in', 'project, gitignored', 'claude.ai sync'].includes(r.source));
    expect(mapped.map(badgeOf)).toEqual([null, null, null, null, null]);
  });

  it('finds a plugin’s skill’s plugin through the loaded list’s source id, else the installed identity of that name', () => {
    // two installed plugins named review: the loaded one decides
    const one = skillGroups({ skills: [skill('review:check', 'plugin')] }, EMPTY_CATALOG, [loaded('review@other-market')], identities);
    expect(flat(one)).toEqual([['added', ['review:check']]]);
    expect(one[0].rows[0].plugin).toBe('Review');
    // not loaded (no init yet): the installed identity by name, its group
    const two = skillGroups({ skills: [skill('frontend-design:frontend-design', 'plugin'), skill('code-review:code-review', 'plugin')] }, EMPTY_CATALOG, [], identities);
    expect(flat(two)).toEqual([
      ['here', ['frontend-design:frontend-design']],
      ['anthropic', ['code-review:code-review']],
    ]);
  });

  it('the engine’s own plugins are Anthropic’s, a folder’s are yours, an unknown plugin is an added one named from its prefix', () => {
    const groups = skillGroups(
      { skills: [skill('cc-plugin-docs:explain', 'plugin'), skill('scratch:try', 'plugin'), skill('mystery:thing', 'plugin')] },
      EMPTY_CATALOG,
      [loaded('cc-plugin-docs@builtin'), { name: 'scratch', path: '/Users/me/scratch', source: 'scratch@inline', version: null }],
      identities,
    );
    expect(flat(groups)).toEqual([
      ['yours', ['scratch:try']],
      ['anthropic', ['cc-plugin-docs:explain']],
      ['added', ['mystery:thing']],
    ]);
    expect(groups.map((g) => g.rows[0].plugin)).toEqual(['Scratch', 'Cc plugin docs', 'Mystery']);
  });

  it('parses each skill on its own: a row without a name is dropped, the rest kept; a missing description reads empty', () => {
    const groups = skillGroups({ skills: [{ description: 'no name' }, 42, { name: 'bare', source: 'user' }] }, EMPTY_CATALOG, [], identities);
    expect(flat(groups)).toEqual([['yours', ['bare']]]);
    expect(groups[0].rows[0].description).toBe('');
  });

  it('an engine that answers the dialog empty: the catalogue’s skills, with their command descriptions, in one list', () => {
    const catalog: SessionCatalog = { ...EMPTY_CATALOG, skills: ['deep-research', 'review:check'], commands: [{ name: 'deep-research', description: 'Research deeply', argumentHint: null, builtin: false }] };
    const groups = skillGroups({ skills: [] }, catalog, [], identities);
    expect(groups).toEqual([
      {
        group: null,
        rows: [
          { name: 'deep-research', plugin: null, description: 'Research deeply', source: '' },
          { name: 'review:check', plugin: null, description: '', source: '' },
        ],
      },
    ]);
    expect(labelOf(groups[0].rows[1])).toBe('review:check'); // no badge, so the whole name
  });

  it('a dialog whose rows carry no source (an older engine) is one list, as the catalogue', () => {
    expect(flat(skillGroups({ skills: [{ name: 'b-skill' }, { name: 'a-skill' }] }, EMPTY_CATALOG, [], identities))).toEqual([[null, ['a-skill', 'b-skill']]]);
  });
});

describe('the skills library: search and sort', () => {
  const groups = skillGroups(DIALOG, EMPTY_CATALOG, [loaded('frontend-design@claude-plugins-official')], identities);

  it('Name keeps the groups; Plugin name flattens them, the plugins’ skills first by plugin, then the rest by name', () => {
    expect(skillsView(groups, { search: '', sort: 'name' })).toBe(groups);
    expect(flat(skillsView(groups, { search: '', sort: 'plugin' }))).toEqual([[null, ['frontend-design:frontend-design', 'debug', 'local-notes', 'lookup', 'policy', 'remember', 'synced-skill', 'u3-project-skill', 'u3-user-skill']]]);
    expect(hasPluginSkills(groups)).toBe(true);
    expect(hasPluginSkills(skillGroups({ skills: [skill('u3-user-skill', 'user')] }, EMPTY_CATALOG, [], identities))).toBe(false);
  });

  it('searches the name, the badge and the description, case-insensitively; a group left empty is dropped', () => {
    expect(flat(skillsView(groups, { search: 'FRONTEND', sort: 'name' }))).toEqual([['here', ['frontend-design:frontend-design']]]);
    expect(flat(skillsView(groups, { search: 'mcp', sort: 'name' }))).toEqual([['added', ['lookup']]]);
    expect(flat(skillsView(groups, { search: 'intentional visual', sort: 'name' }))).toEqual([['here', ['frontend-design:frontend-design']]]);
    expect(skillsView(groups, { search: 'nothing like it', sort: 'name' })).toEqual([]);
    expect(skillsView(groups, { search: 'nothing like it', sort: 'plugin' })).toEqual([]);
  });
});

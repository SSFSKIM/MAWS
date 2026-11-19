// UX wave U11's skill actions (docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md): the first message
// "New skill…" fills in and when it calls skill-creator, a plugin's skill's line, and the words of a refused Open in.
// Every name here is invented, skill-creator's excepted (the official plugin the first message calls).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { CustomizationSkill } from '@shared/ipc/schema/customization';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { SkillDetail } from '../widgets/skills/SkillsLibrary';
import { SKILL_ACTIONS } from './copy';
import { creatorInvocation, isSkillFileApp, openSkillFile, skillNoteOf, skillsHomeOf } from './skill-actions';

const creator: CustomizationSkill = { name: 'skill-creator', description: 'Makes skills', source: 'plugin', path: '/config/plugins/cache/official/skill-creator/1/skills/skill-creator/SKILL.md', plugin: 'skill-creator@official', pluginName: 'skill-creator' };
const notes: CustomizationSkill = { name: 'harbour-notes', description: 'Notes', source: 'user', path: '/config/skills/harbour-notes/SKILL.md', plugin: null };

describe('New skill…’s first message', () => {
  it('names this project’s folder or the person’s, and starts with skill-creator only when it is given', () => {
    expect(SKILL_ACTIONS.firstMessage('project', '~/.claude/skills/', null)).toBe("Let's create a new skill in .claude/skills/ of this project. First ask me what it should do.");
    expect(SKILL_ACTIONS.firstMessage('yours', '~/.claude/skills/', null)).toBe("Let's create a new skill in ~/.claude/skills/, for all my projects. First ask me what it should do.");
    expect(SKILL_ACTIONS.firstMessage('yours', '~/.claude/skills/', 'skill-creator:skill-creator')).toBe("/skill-creator:skill-creator Let's create a new skill in ~/.claude/skills/, for all my projects. First ask me what it should do.");
  });

  it('names the configuration home under the home folder with ~, and the engine’s default while it is unknown', () => {
    expect(skillsHomeOf('/Users/someone/.claude')).toBe('~/.claude/skills/');
    expect(skillsHomeOf('/opt/claude-config')).toBe('/opt/claude-config/skills/');
    expect(skillsHomeOf(null)).toBe('~/.claude/skills/');
  });

  it('calls skill-creator when its plugin’s skill is listed by its manifest name and its plugin is not off for the chats MAWS starts', () => {
    expect(creatorInvocation([notes, creator], new Set())).toBe('skill-creator:skill-creator');
    expect(creatorInvocation([notes, creator], new Set(['skill-creator@official']))).toBeNull(); // off in Settings › Sessions
    expect(creatorInvocation([notes, creator], null)).toBeNull(); // which plugins are off is not read yet
    expect(creatorInvocation([notes, { ...creator, pluginName: null }], new Set())).toBeNull(); // the manifest's name unread
    expect(creatorInvocation([notes, { ...creator, source: 'user', plugin: null, pluginName: undefined }], new Set())).toBeNull(); // a person's own skill of that name is no plugin's
    expect(creatorInvocation([notes], new Set())).toBeNull();
  });
});

describe('a plugin’s skill’s line', () => {
  afterEach(cleanup);
  it('is drawn on a plugin’s skill’s detail and on no other', () => {
    const plugin = { name: 'skill-creator', invocation: null, description: '', source: 'plugin', plugin: 'skill-creator@official', path: creator.path };
    expect(skillNoteOf(plugin)).toBe('Comes with the plugin skill-creator@official. An update of the plugin replaces this file, and any edit in it.');
    expect(skillNoteOf({ ...plugin, source: 'user', plugin: null })).toBeNull();
    render(<SkillDetail row={plugin} onBack={() => undefined} extras={{ note: skillNoteOf(plugin) }} />);
    expect(screen.getByText(/^Comes with the plugin/).hasAttribute('data-skill-note')).toBe(true);
  });
});

describe('a refused Open in', () => {
  afterEach(() => delete (window as { maws?: PreloadBridge }).maws);
  const answering = (result: unknown) => {
    window.maws = { localMachine: TEST_MACHINE, invoke: (async () => result) as PreloadBridge['invoke'], on: (() => () => undefined) as PreloadBridge['on'], pathForFile: () => '' };
  };

  it('says nothing when it opened, and says why otherwise', async () => {
    answering({ ok: true, value: { status: 'opened' } });
    expect(await openSkillFile(null, notes.path, 'finder')).toBeNull();
    answering({ ok: true, value: { status: 'refused', reason: 'missing', message: null } });
    expect(await openSkillFile(null, notes.path, 'finder')).toBe("This skill's file is no longer here. Refresh, then try again.");
    answering({ ok: true, value: { status: 'refused', reason: 'unreadable', message: 'engine host unavailable' } });
    expect(await openSkillFile(null, notes.path, 'zed')).toBe('Skills could not be read: engine host unavailable');
    answering({ ok: true, value: { status: 'refused', reason: 'launch', message: 'Zed did not open' } });
    expect(await openSkillFile(null, notes.path, 'zed')).toBe('Zed did not open');
    answering({ ok: false, error: { code: 'unknown_command', message: 'unknown command customization.skillFile' } });
    expect(await openSkillFile(null, notes.path, 'finder')).toBe('Skills could not be read: unknown command customization.skillFile');
  });

  it('offers a skill’s file to the editors and Finder, never to a terminal', () => {
    for (const id of ['vscode', 'vscodeInsiders', 'cursor', 'windsurf', 'zed', 'xcode', 'finder'] as const) expect(isSkillFileApp(id), id).toBe(true);
    for (const id of ['terminal', 'iterm', 'ghostty'] as const) expect(isSkillFileApp(id), id).toBe(false);
  });
});

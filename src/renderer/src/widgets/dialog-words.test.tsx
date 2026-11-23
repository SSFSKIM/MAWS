// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, typed.md): the typed dialogs' bodies drawn alone,
// for the rows whose widget has no test of its own: Config, Context, Memory, Agents and Hooks.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { accessibleDescription } from '../test-support/accessible-text';
import { AgentsBody } from './AgentsWidget';
import { ConfigBody } from './ConfigWidget';
import { ContextBody } from './ContextWidget';
import { HooksBody } from './HooksWidget';
import { MemoryBody } from './MemoryWidget';

const ID = 'app-words' as AppSessionId;
afterEach(() => cleanup());

describe('Config (P606, P607, P608, P586)', () => {
  it('reads Defaults only, no second line for an empty source, Reveal, and the source in its one word with its file', () => {
    render(
      <ConfigBody
        view={{ effective: [], sources: [{ source: 'userSettings', label: 'user', keys: [] }, { source: 'projectSettings', label: 'project', keys: ['model'] }], applied: [], errors: [] }}
        machine={TEST_MACHINE}
        cwd="/work/atlas"
        configHome="/home/example/.claude"
        close={() => {}}
      />,
    );
    expect(screen.getByText('Defaults only')).toBeTruthy();
    const [user, project] = within(screen.getByRole('list', { name: 'Settings sources' })).getAllByRole('listitem');
    expect(user.textContent).not.toContain('no keys');
    expect(within(user).getByRole('button', { name: 'Reveal' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open file' })).toBeNull();
    const word = user.querySelector<HTMLElement>('[data-rule-source]')!;
    expect(word.textContent).toBe('user');
    expect(accessibleDescription(word)).toBe('Edited in ~/.claude/settings.json');
    expect(project.textContent).toContain('model');
  });
});

describe('Context (P602, P603, P600)', () => {
  it('heads the last group "Every request" and keeps the tokens on its rows and autocompact on the top line', () => {
    render(<ContextBody view={{ line: '48,200 of 200,000 · 24% · autocompact at 160,000', categories: [], used: [], thresholdShare: null, costs: [{ label: 'Skills', value: '14 of 52 · 3,400 tokens' }] }} />);
    expect(screen.getByRole('region', { name: 'Every request' })).toBeTruthy();
    expect(screen.getByText('14 of 52 · 3,400 tokens')).toBeTruthy();
    expect(screen.getByText('48,200 of 200,000 · 24% · autocompact at 160,000')).toBeTruthy();
  });
});

describe('Memory (P623, P624)', () => {
  it('reads "not created" on a missing file, and draws Reveal only on pointing or focus within its row', () => {
    render(
      <MemoryBody
        view={{ files: [{ label: 'User instructions', path: '/home/example/.claude/CLAUDE.md', description: '', exists: true, note: null }, { label: 'Project instructions', path: '/work/CLAUDE.md', description: '', exists: false, note: 'not created' }], folders: [{ label: 'Memory folder', path: '/home/example/memory/' }], autoMemory: null }}
        appSessionId={ID}
        close={() => {}}
      />,
    );
    expect(screen.getByText('not created')).toBeTruthy();
    const reveals = screen.getAllByRole('button', { name: 'Reveal' });
    expect(reveals).toHaveLength(2);
    for (const reveal of reveals) {
      expect(reveal.hasAttribute('data-on-hover')).toBe(true);
      expect(reveal.closest('li')!.hasAttribute('data-hover-scope')).toBe(true);
    }
  });
});

describe('Agents (P627, P628)', () => {
  it('says "No agents" when there are none, and draws Mention only on pointing or focus within its row', () => {
    const { unmount } = render(<AgentsBody agents={[]} appSessionId={ID} close={() => {}} />);
    expect(screen.getByText('No agents')).toBeTruthy();
    unmount();
    render(<AgentsBody agents={[{ name: 'Explore', description: 'Fast read-only search' }]} appSessionId={ID} close={() => {}} />);
    const mention = screen.getByRole('button', { name: 'Mention' });
    expect(mention.hasAttribute('data-on-hover')).toBe(true);
    expect(mention.closest('li')!.hasAttribute('data-hover-scope')).toBe(true);
  });
});

describe('Hooks (N184)', () => {
  it('draws a hook’s source in the permission rules’ word, its file under it', () => {
    render(<HooksBody view={{ events: [{ name: 'Stop', summary: '', count: 1 }], hooks: [{ event: 'Stop', matcher: null, source: 'user', file: '~/.claude/settings.json', text: 'echo done', type: 'command' }], policy: null }} />);
    const word = document.querySelector<HTMLElement>('[data-rule-source]')!;
    expect(word.textContent).toBe('user');
    expect(accessibleDescription(word)).toBe('Edited in ~/.claude/settings.json');
  });
});

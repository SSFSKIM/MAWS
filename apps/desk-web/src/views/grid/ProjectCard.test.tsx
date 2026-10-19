// @vitest-environment happy-dom
// A machine project (smns org directory §3: the project of a machine's sessions no `.smns` claims) is a tile like any
// project, labelled by its kind; a project of a repository carries no label. A project online with nothing working or
// waiting says how many of its sessions are idle (smns remote identity §5).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ProjectSummary } from 'desk-hub/protocol';
import { ProjectCard } from './ProjectCard';

afterEach(cleanup);

const summary = (over: Partial<ProjectSummary>): ProjectSummary => ({ id: 'p', name: 'MAWS', kind: 'hub', machines: 1, machines_online: 1, working: 0, waiting: 0, live: 0, ...over });

it('labels a machine project by its kind, and a hub project not at all', () => {
  render(<ProjectCard project={summary({ id: 'm', name: 'mini', kind: 'machine' })} onOpen={() => {}} />);
  const card = screen.getByRole('button');
  expect(card.dataset.kind).toBe('machine');
  expect(screen.getByTestId('project-kind').textContent).toBe('machine');
  cleanup();
  render(<ProjectCard project={summary({})} onOpen={() => {}} />);
  expect(screen.getByRole('button').dataset.kind).toBe('hub');
  expect(screen.queryByTestId('project-kind')).toBeNull();
});

it('says how many sessions are idle where nothing works or waits, Quiet with none, and Offline with every machine away', () => {
  const said = (over: Partial<ProjectSummary>) => {
    cleanup();
    render(<ProjectCard project={summary(over)} onOpen={() => {}} />);
    return screen.getByRole('button').textContent;
  };
  expect(said({ live: 2 })).toContain('2 idle');
  expect(said({})).toContain('Quiet');
  expect(said({ live: 2, machines_online: 0 })).toContain('Offline');
  expect(said({ live: 2, working: 1 })).not.toContain('idle');
});

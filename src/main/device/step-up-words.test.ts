// The step-up sheet's words (the UX wave, U9 S-13; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, M2's
// Decisions, "The sheet's name is org data"): the message is a person's sentence for the action, naming the machine by
// its name as the held org view gives it (the head's machine entry, else its certificate, else the ref); the detail keeps
// every signed field, the machine as `<name> (<ref>)`. A name two machines share is followed by its ref in the message
// too, and a name is escaped as every shown value is: a member wrote it. With no view the message names the ref.
import { describe, expect, it, vi } from 'vitest';
import type { Action, OrgView, SignedOrgState } from '../../../apps/org-protocol/src/index.ts';

vi.mock('electron', () => ({ systemPreferences: { promptTouchID: () => Promise.reject(new Error('no Touch ID in these tests')) } }));

import { renderAction, renderActions } from './step-up';

const STUDIO = 'mref-studio-00000001';
const LOFT = 'mref-loft-0000000001';
const LOFT_TWO = 'mref-loft-0000000002';
const CERTIFIED = 'mref-certified-00001';
const UNNAMED = 'mref-unnamed-0000001';

/** A held view naming Studio, two machines called Loft, and one machine only its certificate names. */
const view = (machines: Array<{ ref: string; name: string }> = [{ ref: STUDIO, name: 'Studio' }, { ref: LOFT, name: 'Loft' }, { ref: LOFT_TWO, name: 'Loft' }]): Pick<OrgView, 'head' | 'certificates'> => ({
  head: () => ({ state: { machines } }) as unknown as SignedOrgState,
  certificates: () => ({ certs: [{ body: { machine: CERTIFIED, name: 'Attic' } }] as never, retirements: [] }),
});

const action = (name: string, machine = STUDIO, args: Record<string, unknown> = {}): Action => ({
  v: 1, org: 'org-words', machine, device: 'dev-mac', opId: 'op-0123456789abcdef', opCreated: '2026-11-12T10:00:00.000Z', action: name, args, nonce: 'AAAAAAAAAAAAAAAAAAAAAA', created: '2026-11-12T10:00:00.000Z',
});

describe('the sheet’s message', () => {
  it('is S-13’s sentence for each action, naming the machine by its name', () => {
    const cases: Array<[string, string]> = [
      ['session.spawn', 'Start a session on Studio'],
      ['sminos.spawn', 'Start a terminal session on Studio'],
      ['session.fork', 'Fork a session on Studio'],
      ['session.projects.addFolder', 'Add a project folder on Studio'],
      ['session.projects.link', 'Link a project folder on Studio'],
      ['session.projects.relocate', 'Point a project at its folder on Studio'],
      ['session.answer', 'Approve a request on Studio'],
      ['sminos.decide', 'Approve a request on Studio'],
      ['record.access', 'Change who can reach a session on Studio'],
      ['record.shares', 'Change who can reach a session on Studio'],
      ['record.owners', 'Change who can reach a session on Studio'],
      ['pty.spawn', 'Use a terminal on Studio'],
      ['pty.attach', 'Use a terminal on Studio'],
      ['forward.open', 'Forward a port from Studio'],
      ['connectors.connect', 'Change connectors on Studio'],
      ['artifacts.grantConnectorTool', 'Change connectors on Studio'],
      ['session.projects.remove', 'session.projects.remove on Studio'],
    ];
    for (const [name, message] of cases) expect([name, renderAction(action(name), view()).summary]).toEqual([name, message]);
  });

  it('follows a name two machines share with its ref, and takes a certificate’s name where the head names none', () => {
    expect(renderAction(action('session.fork', LOFT), view()).summary).toBe(`Fork a session on Loft (${LOFT})`);
    expect(renderAction(action('session.fork', CERTIFIED), view()).summary).toBe('Fork a session on Attic');
  });

  it('names the ref where no name is known, or no view is held', () => {
    expect(renderAction(action('session.fork', UNNAMED), view()).summary).toBe(`Fork a session on ${UNNAMED}`);
    expect(renderAction(action('session.fork')).summary).toBe(`Fork a session on ${STUDIO}`);
    expect(renderAction(action('session.fork'), null).summary).toBe(`Fork a session on ${STUDIO}`);
  });

  it('escapes a name a member wrote, so a control or bidi character in it cannot forge a line', () => {
    const forged = view([{ ref: STUDIO, name: 'Studio\nMachine: elsewhere‮' }]);
    const { summary, text } = renderAction(action('session.fork'), forged);
    expect(summary).toBe('Fork a session on "Studio\\nMachine: elsewhere\\u202e"');
    expect(text.split('\n').filter((line) => line.startsWith('Machine:'))).toEqual([`Machine: "Studio\\nMachine: elsewhere\\u202e" (${STUDIO})`]);
    expect(text).not.toMatch(/[‪-‮⁦-⁩]/);
  });

  it('counts several acts on one machine by its name, and names each machine once', () => {
    const acts = [action('record.access', STUDIO), action('record.shares', STUDIO), action('record.owners', STUDIO)];
    expect(renderActions(acts, view()).summary).toBe('3 actions on Studio');
    expect(renderActions([action('record.access', STUDIO), action('record.access', LOFT)], view()).summary).toBe(`2 actions on Studio, Loft (${LOFT})`);
    expect(renderActions(acts).summary).toBe(`3 actions on ${STUDIO}`);
    expect(renderActions(acts.slice(0, 1), view())).toEqual(renderAction(acts[0], view()));
  });
});

describe('the sheet’s detail', () => {
  it('keeps every signed field, the machine as its name and ref', () => {
    const { text } = renderAction(action('session.fork', STUDIO, { appSessionId: 'app-1', target: { kind: 'inPlace' }, message: null, rewindTo: null }), view());
    expect(text.split('\n')).toEqual([
      'Action: session.fork',
      `Machine: Studio (${STUDIO})`,
      'Org: org-words',
      'Device: dev-mac',
      'appSessionId: "app-1"',
      'message: null',
      'rewindTo: null',
      'target: {"kind":"inPlace"}',
    ]);
  });

  it('shows the ref alone where no name is known', () => {
    expect(renderAction(action('session.fork', UNNAMED), view()).text.split('\n')[1]).toBe(`Machine: ${UNNAMED}`);
    expect(renderAction(action('session.fork')).text.split('\n')[1]).toBe(`Machine: ${STUDIO}`);
  });
});

// Which parents are open (the UX wave's U8b document, M5 decision 4): one set per session, shared by the Subagents card
// and panel, held for the run.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import { openOf, useOpenAgents } from './open-agents';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const t = (s: string) => s as TaskId;

describe('useOpenAgents', () => {
  beforeEach(() => useOpenAgents.setState({ open: new Map() }));

  it('a toggle opens a parent and the next closes it', () => {
    useOpenAgents.getState().toggle(A, t('p1'));
    expect([...openOf(useOpenAgents.getState(), A)]).toEqual(['p1']);
    useOpenAgents.getState().toggle(A, t('p2'));
    expect([...openOf(useOpenAgents.getState(), A)]).toEqual(['p1', 'p2']);
    useOpenAgents.getState().toggle(A, t('p1'));
    expect([...openOf(useOpenAgents.getState(), A)]).toEqual(['p2']);
  });

  it('keeps one set per session, and leaves another session’s set the same object', () => {
    useOpenAgents.getState().toggle(A, t('p1'));
    const ofA = openOf(useOpenAgents.getState(), A);
    useOpenAgents.getState().toggle(B, t('p1'));
    expect(openOf(useOpenAgents.getState(), A)).toBe(ofA);
    expect([...openOf(useOpenAgents.getState(), B)]).toEqual(['p1']);
  });

  it('answers one empty set for a session with nothing open', () => {
    const none = openOf(useOpenAgents.getState(), A);
    expect(none.size).toBe(0);
    expect(openOf(useOpenAgents.getState(), B)).toBe(none);
    useOpenAgents.getState().toggle(A, t('p1'));
    useOpenAgents.getState().toggle(A, t('p1'));
    expect(openOf(useOpenAgents.getState(), A).size).toBe(0);
  });
});

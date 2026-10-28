// What the passkey gesture approves, in the card's words (P5 O13 M5; RL §5.10): the browser's prompt shows no digest,
// so the view says what the gesture answers before asking for it.
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { Card } from '../../cards/cards';
import { gestureLine, gestureOf } from './gesture';

const digest = { session: 's', request: 'r', tool: 't', input_sha256: 'h' };
const laneA = (tool: string, input: Record<string, unknown>): Card => ({ lane: 'A', raised: { request: 'toolu_1', session: 'la-1', tool, input: input as never }, launch: 'L1', digest });
const laneB = (request: Record<string, unknown>): Card => ({
  lane: 'B',
  item: { id: 'i', appSessionId: 'app-1', request: { requestId: 'rq-1' } } as unknown as AttentionItem,
  request: { requestId: 'rq-1', ...request } as unknown as SessionEvent,
  context: { launchId: 'l', engineSessionId: 'e' },
  digest,
  endpointDigest: digest,
});
const allow = { kind: 'decision', decision: 'allow' } as const;
const deny = { kind: 'decision', decision: 'deny' } as const;

describe('what the gesture approves', () => {
  it('names a permission’s decision and what the tool would do, in the session', () => {
    expect(gestureLine(gestureOf(laneA('Bash', { command: 'pnpm test' }), allow, 'maws-45'))).toBe('Face ID approves: Allow `pnpm test` in maws-45');
    expect(gestureLine(gestureOf(laneB({ kind: 'permission.requested', toolName: 'Edit', input: { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } }), deny, 'main'))).toBe('Face ID approves: Deny Edit `src/a.ts` in main');
    expect(gestureLine(gestureOf(laneA('WebFetch', { url: 'https://example.com' }), allow, 'main'))).toBe('Face ID approves: Allow WebFetch `https://example.com` in main');
    expect(gestureLine(gestureOf(laneA('mcp__sminos__send', { text: 'hi' }), allow, 'main'))).toBe('Face ID approves: Allow mcp__sminos__send in main');
  });

  it('keeps a long or many-line command to its first line, cut short', () => {
    const { subject } = gestureOf(laneA('Bash', { command: `${'x'.repeat(100)}\nsecond line` }), allow, 'main');
    expect(subject).toBe(`${'x'.repeat(59)}…`);
  });

  it('names a question’s answers', () => {
    const asked = laneB({ kind: 'question.requested', questions: [{ question: 'Which way?', header: '', multiSelect: false, options: [] }] });
    expect(gestureLine(gestureOf(asked, { kind: 'question', answers: { 'Which way?': 'left' } }, 'main'))).toBe('Face ID approves: Answer “Which way?” with `left` in main');
    expect(gestureLine(gestureOf(asked, { kind: 'question', answers: { 'Which way?': 'left', 'And then?': 'stop' } }, 'main'))).toBe('Face ID approves: Answer 2 questions in main');
  });

  it('names the question a decline declines, or how many', () => {
    const one = laneA('AskUserQuestion', { questions: [{ question: 'Which way?', options: [{ label: 'left' }] }] });
    expect(gestureLine(gestureOf(one, { kind: 'decline' }, 'main'))).toBe('Face ID approves: Decline “Which way?” in main');
    const two = laneA('AskUserQuestion', { questions: [{ question: 'Which way?', options: [] }, { question: 'And then?', options: [] }] });
    expect(gestureLine(gestureOf(two, { kind: 'decline' }, 'main'))).toBe('Face ID approves: Decline 2 questions in main');
    const b = laneB({ kind: 'question.requested', questions: [{ question: 'Which way?', header: '', multiSelect: false, options: [] }] });
    expect(gestureLine(gestureOf(b, { kind: 'decline' }, 'main'))).toBe('Face ID approves: Decline “Which way?” in main');
  });
});

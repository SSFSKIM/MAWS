import { describe, expect, it } from 'vitest';
import { engineQuestionsOf, nativeQuestionsOf, parseTranscriptProps, type TranscriptProps, type TranscriptSite } from './surface-rows';

const call = { tool_use_id: 'tool-1', tool: 'Read', input: { file_path: '/a' }, isRunning: false, isErrored: false, isInterrupted: false, output: { content: 'read' } };
const question = { question: 'Which?', header: 'Choice', options: [{ label: 'A', description: 'First' }, { label: 'B', preview: 'Second' }], multiSelect: false };
const originals = {
  UserMessage: { text: 'original', origin: { kind: 'sdk' }, isExpanded: true },
  AssistantMessage: { text: 'original', isFirstOfReply: true },
  ToolUse: call,
  ToolResult: { tool_use_id: 'tool-1', tool: 'Read', output: { content: 'read' }, isErrored: false },
  ToolGroup: { calls: [call], isActive: false, isExpanded: false },
  CommandOutput: { command: 'cost', args: '', text: 'original', isErrored: false },
  AskUserQuestion: { tool: 'AskUserQuestion', questions: [question], metadataSource: 'remember' },
} satisfies TranscriptProps;

function parse<C extends TranscriptSite>(site: C, value: unknown) {
  return parseTranscriptProps(site, value, originals[site]);
}

describe('transcript render props (2.1.287)', () => {
  it.each(Object.keys(originals) as TranscriptSite[])('accepts %s props without losing original fields', (site) => {
    expect(parse(site, structuredClone(originals[site]))).toEqual(originals[site]);
  });

  it('permits display rewrites without changing originals, including flat group calls and structured results', () => {
    expect(parse('UserMessage', { ...originals.UserMessage, text: 'shown' })).toMatchObject({ text: 'shown' });
    expect(parse('AssistantMessage', { text: 'shown', isFirstOfReply: false })).toEqual({ text: 'shown', isFirstOfReply: false });
    expect(parse('ToolUse', { ...call, tool: 'Display tool', input: 'shown', isRunning: true, isErrored: true, isInterrupted: true, output: 'shown' })).toMatchObject({ tool: 'Display tool', output: 'shown' });
    expect(parse('ToolResult', { ...originals.ToolResult, output: { content: 'shown' } })).toMatchObject({ output: { content: 'shown' } });
    expect(parse('ToolGroup', { ...originals.ToolGroup, isExpanded: true })).toMatchObject({ isExpanded: true, calls: [call] });
    expect(parse('CommandOutput', { ...originals.CommandOutput, text: 'shown' })).toMatchObject({ text: 'shown' });
    expect(parse('AskUserQuestion', { tool: 'AskUserQuestion', questions: [{ ...question, question: 'Shown?' }] })).toMatchObject({ questions: [{ question: 'Shown?' }] });
    expect(originals.UserMessage.text).toBe('original');
  });

  it.each([
    ['UserMessage', 'origin', { kind: 'composer' }], ['UserMessage', 'isExpanded', false],
    ['ToolUse', 'tool_use_id', 'forged'], ['ToolResult', 'tool_use_id', 'forged'],
    ['ToolResult', 'tool', 'Bash'], ['ToolResult', 'isErrored', true],
    ['CommandOutput', 'command', 'clear'], ['CommandOutput', 'args', 'forged'], ['CommandOutput', 'isErrored', true],
  ] as const)('refuses changing or dropping %s.%s', (site, key, value) => {
    expect(parse(site, { ...originals[site], [key]: value })).toBeNull();
    const dropped: Record<string, unknown> = { ...originals[site] };
    delete dropped[key];
    expect(parse(site, dropped)).toBeNull();
  });

  it('preserves nested user provenance by value, regardless of property ordering', () => {
    const original: TranscriptProps['UserMessage'] = { ...originals.UserMessage, origin: { kind: 'plugin', name: 'owner', asUser: true }, task: { id: 'task', status: 'completed' }, from: { name: 'worker' } };
    expect(parseTranscriptProps('UserMessage', { ...original, task: { status: 'completed', id: 'task' }, text: 'shown' }, original)).toMatchObject({ text: 'shown' });
    for (const field of ['origin', 'task', 'from'] as const) {
      expect(parseTranscriptProps('UserMessage', { ...original, [field]: undefined }, original)).toBeNull();
    }
    expect(parse('UserMessage', { ...originals.UserMessage, from: { name: 'forged' } })).toBeNull();
  });

  it('preserves group member ids while allowing the display data to be rewritten', () => {
    expect(parse('ToolGroup', { ...originals.ToolGroup, calls: [{ ...call, tool: 'Shown', input: {} }] })).toMatchObject({ calls: [{ tool: 'Shown' }] });
    expect(parse('ToolGroup', { ...originals.ToolGroup, calls: [{ ...call, tool_use_id: 'forged' }] })).toBeNull();
    const legacyCall: Omit<typeof call, 'tool_use_id'> & { tool_use_id?: string } = { ...call };
    delete legacyCall.tool_use_id;
    expect(parse('ToolGroup', { ...originals.ToolGroup, calls: [legacyCall] })).toBeNull();
    const legacy = { ...originals.ToolGroup, calls: [legacyCall] };
    expect(parseTranscriptProps('ToolGroup', legacy, legacy)).toEqual(legacy);
    expect(parse('ToolGroup', { ...originals.ToolGroup, calls: [{ toolName: 'Read', input: call }] })).toBeNull();
  });

  it.each(['UserMessage', 'AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup', 'CommandOutput'] as const)('keeps %s onScreen absent, null, or exactly as received', (site) => {
    expect(parse(site, { ...originals[site], onScreen: null })).toBeNull();
    const onScreen = { first: 1, last: 3, of: 5 };
    const original = { ...originals[site], onScreen };
    expect(parseTranscriptProps(site, structuredClone(original), original)).toEqual(original);
    expect(parseTranscriptProps(site, originals[site], original)).toBeNull();
    expect(parseTranscriptProps(site, { ...original, onScreen: { ...onScreen, first: 0 } }, original)).toBeNull();
    const offscreen = { ...originals[site], onScreen: null };
    expect(parseTranscriptProps(site, offscreen, offscreen)).toEqual(offscreen);
  });

  it('rejects malformed shapes instead of coercing them or accepting another site', () => {
    expect(parse('AssistantMessage', { text: 12, isFirstOfReply: true })).toBeNull();
    expect(parse('ToolUse', { ...call, isRunning: 'true' })).toBeNull();
    expect(parse('ToolResult', { tool_use_id: 'tool-1', tool: 'Read', isErrored: false })).toBeNull();
    expect(parse('UserMessage', originals.AssistantMessage)).toBeNull();
    expect(parse('AssistantMessage', null)).toBeNull();
    expect(parse('AssistantMessage', [])).toBeNull();
  });

  it.each([
    { questions: [] }, { questions: Array.from({ length: 5 }, (_, i) => ({ ...question, question: `Q${i}` })) },
    { questions: [question, question] }, { questions: [{ ...question, options: question.options.slice(0, 1) }] },
    { questions: [{ ...question, options: Array.from({ length: 5 }, (_, i) => ({ label: `O${i}` })) }] },
    { questions: [{ ...question, options: [question.options[0], question.options[0]] }] },
    { questions: [{ ...question, options: [{ label: 'A', description: null }, { label: 'B' }] }] },
    { questions: [{ ...question, kind: 'number', options: [], min: 5, max: 5 }] },
    { questions: [{ ...question, kind: 'number', options: [], min: 0, max: 5, step: 0 }] },
    { questions: [{ ...question, kind: 'number', options: [], min: 0, max: 5, defaultValue: 6 }] },
    { questions: [{ ...question, kind: 'text' }] }, { questions: [{ ...question, kind: 'text', options: [], multiSelect: true }] },
    { questions: [{ ...question, placeholder: 'choice cannot have placeholder' }] }, { questions: [{ ...question, kind: 'other' }] },
  ])('rejects questions outside the actual tool schema: %j', ({ questions }) => {
    expect(parse('AskUserQuestion', { tool: 'AskUserQuestion', questions })).toBeNull();
  });

  it('refuses otherwise valid text and number questions that the native choice card cannot draw', () => {
    const questions = [{ question: 'Name?', header: 'Name', kind: 'text', placeholder: 'Your name' }, { question: 'Count?', header: 'Count', kind: 'number', min: 1, max: 5, step: 1, defaultValue: 3, unit: 'items' }];
    expect(parse('AskUserQuestion', { tool: 'AskUserQuestion', questions })).toBeNull();
  });
});


describe('engine questions and the native choice card', () => {
  const native = [{ question: 'Which?', header: 'Choice', multiSelect: true, options: [
    { label: 'A', description: null, preview: null }, { label: 'B', description: 'Second', preview: '<p>preview</p>' },
  ] }];
  const engine = [{ question: 'Which?', header: 'Choice', multiSelect: true, options: [
    { label: 'A' }, { label: 'B', description: 'Second', preview: '<p>preview</p>' },
  ] }];

  it('omits null X1 option fields from engine input and reconstructs native questions losslessly', () => {
    expect(engineQuestionsOf(native)).toEqual(engine);
    expect(nativeQuestionsOf(engine)).toEqual(native);
    expect(nativeQuestionsOf([{ ...engine[0]!, kind: 'choice' }])).toEqual(native);
    expect(native[0]!.options[0]).toEqual({ label: 'A', description: null, preview: null });
  });

  it('rejects forms the native card cannot faithfully represent, including question-level helper text', () => {
    expect(nativeQuestionsOf([{ ...engine[0]!, kind: 'text', options: [], multiSelect: false }])).toBeNull();
    expect(nativeQuestionsOf([{ ...engine[0]!, kind: 'number', options: [], multiSelect: false, min: 1, max: 5 }])).toBeNull();
    const withDescription = [{ ...engine[0]!, description: 'Important helper text' }];
    expect(nativeQuestionsOf(withDescription)).toBeNull();
    expect(parse('AskUserQuestion', { tool: 'AskUserQuestion', questions: withDescription })).toBeNull();
  });
});

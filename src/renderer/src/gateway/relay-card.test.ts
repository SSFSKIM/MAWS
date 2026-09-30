// C11's part of C10's relay card (C11 execution document, Interfaces "Gateway", *The launch policy*; M4 refresh task
// "the relay policy in C10's card"; Ask of C10 (7)): the card's policy from settings v3, and Run direct on a gateway
// model first asking for a Claude model, which an intent takes through C10's hook's patch and a record's resume as the
// start's overrides.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, MawsBridge, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V4 } from '@shared/settings/defaults';
import { useSetup } from '../sessions/store';
import { intent, MESSAGE } from '../test-support/setup-intents';
import { relayPolicyOf, runDirect } from './relay-card';

const ID = intent().appSessionId as AppSessionId;
let calls: { name: CommandName; input: unknown }[];

beforeEach(() => {
  calls = [];
  window.maws = {
    invoke: vi.fn(async (name: CommandName, input: unknown) => {
      calls.push({ name, input });
      if (name === 'session.intent.patch') return { ok: true, value: { ...intent(), ...(input as { patch: object }).patch } };
      if (name === 'session.start') return { ok: true, value: { status: 'starting', appSessionId: ID } };
      return { ok: false, error: { code: 'internal', message: `unexpected ${name}` } };
    }),
    on: () => () => {},
    pathForFile: () => '',
  } as unknown as MawsBridge;
});
afterEach(() => {
  useSetup.setState({ intents: new Map(), cards: new Map(), invoking: new Set(), phases: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
});

const settings = (relayUnreachable: Settings['gateway']['relayUnreachable']): Settings => ({ ...SETTINGS_DEFAULTS_V4, gateway: { ...SETTINGS_DEFAULTS_V4.gateway, relayUnreachable } });

describe("the relay card's policy", () => {
  it("wait makes the ClaudeUsage path the primary; ask and direct keep both (under direct the card shows only for a gateway model)", () => {
    expect(relayPolicyOf(settings('wait'))).toBe('wait');
    expect(relayPolicyOf(settings('ask'))).toBe('ask');
    expect(relayPolicyOf(settings('direct'))).toBe('ask');
    expect(relayPolicyOf(null), 'before the settings answer: the default').toBe('ask');
  });
});

describe('Run direct', () => {
  it('on a Claude model starts direct at once, asking nothing', async () => {
    const pick = vi.fn();
    await runDirect(ID, MESSAGE, false, pick);
    expect(pick).not.toHaveBeenCalled();
    expect(calls).toEqual([{ name: 'session.start', input: { appSessionId: ID, message: null, options: { gateway: 'direct' } } }]);
  });

  it("on a gateway model, an unstarted session's intent takes the chosen model and effort through the hook's patch, then starts direct", async () => {
    useSetup.setState({ intents: new Map([[ID, intent({ model: 'claude/astra', effort: 'max' })]]) });
    await runDirect(ID, MESSAGE, true, async () => ({ model: 'sonnet', effort: 'high' }));
    expect(calls).toEqual([
      { name: 'session.intent.patch', input: { appSessionId: ID, patch: { model: 'sonnet', effort: 'high' } } },
      { name: 'session.start', input: { appSessionId: ID, message: null, options: { gateway: 'direct' } } },
    ]);
    expect(useSetup.getState().intents.get(ID)).toMatchObject({ model: 'sonnet', effort: 'high' }); // C7's chips agree
  });

  it("on a gateway model, a record's resume passes the choice as the start's overrides (no effort key when the model admits the current one)", async () => {
    await runDirect(ID, null, true, async () => ({ model: 'sonnet', effort: null }));
    expect(calls).toEqual([{ name: 'session.start', input: { appSessionId: ID, message: null, options: { gateway: 'direct', model: 'sonnet' } } }]);
  });

  it('a cancelled choice starts nothing', async () => {
    useSetup.setState({ intents: new Map([[ID, intent({ model: 'claude/astra' })]]) });
    await runDirect(ID, MESSAGE, true, async () => null);
    expect(calls).toEqual([]);
  });
});

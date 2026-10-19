// The group chat on the session view's rendering (the composite's §4, amended 2026-10-19), in a real browser against
// the DX3 double: a realistic day of a project — four sessions on two machines, a burst of lifecycle at the start, a
// session's Markdown message, two messages of one sender under one header, agent traffic folded, state flips kept
// quiet, an async question answerable on its card, an answered one as MAWS's receipt, the owner's sends as bubbles
// with each recipient's delivery in the foot, and a record kept for no one.
//
// With DESK_SHOTS set to a directory, the chat is saved there at desktop and phone widths for the owner.
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hubWriter } from 'desk-hub/protocol';
import { DOUBLE_MEMBER, type HubDouble } from '../test/double/hub-double';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, S } from './scene';

const M = DOUBLE_MEMBER.id;
const SHOTS = process.env.DESK_SHOTS;
const center = (page: Page) => page.getByRole('region', { name: 'Channel' });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Channels' });

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/**
 * `minutes` after local noon, yesterday's or today's: the scene's two days stay two whenever the suite runs, which times
 * counted back from now do not near midnight. A time later today than now is harmless; the chat only prints clocks.
 */
const noon = (daysAgo: number, minutes: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12, minutes).toISOString();
};
const yesterday = (minutes: number) => noon(1, minutes);
const today = (minutes: number) => noon(0, minutes);

const ASK_OPEN = 'toolu_ask_fix';
const ASK_DONE = 'toolu_ask_trace';
const ANSWER_SUMMARY = 'Your questions have been answered: "Keep the Playwright trace on failure?"="yes". You can now continue with these answers in mind.';

/** A day of `acceptance-scratch`, as two machines' daemons and the owner's browser would leave it on the hub. */
export async function stageChat(hub: HubDouble): Promise<void> {
  hub.setGrid([{ id: PROJECT, name: 'acceptance-scratch', kind: 'hub', machines: 2, machines_online: 2, working: 1, waiting: 1, live: 2 }]);
  const joined = (session: string, alias: string, machine: string, ts: string) =>
    hub.append(PROJECT, { writer: `${machine}/${session}`, kind: 'joined', session, alias, name_source: 'user', machine, cwd: '/Users/new/Developer/GitHub/MAWS', worktree: '', role: '', seat: '', by: '' }, ts);
  const charge = (session: string, machine: string, text: string, ts: string) => hub.append(PROJECT, { writer: `${machine}/${session}`, kind: 'in-charge', session, text, source: 'set' }, ts);
  const message = (session: string, alias: string, machine: string, text: string, src: string, ts: string) => hub.append(PROJECT, { writer: `${machine}/${session}`, kind: 'message', from: alias, to: 'host', text, src }, ts);
  const say = (session: string, alias: string, machine: string, to: Array<[string, string]>, text: string, ts: string) =>
    hub.append(PROJECT, { writer: `${machine}/${session}`, kind: 'say', from: alias, to: to.map(([s, a]) => ({ session: s, alias: a })), text }, ts);
  const human = (to: '*' | Array<[string, string]>, text: string, ts: string, wake = false) =>
    hub.append(PROJECT, { writer: hubWriter(M), kind: 'human', from: 'human', member: M, to: to === '*' ? '*' : to.map(([s, a]) => ({ session: s, alias: a })), text, created: ts, ...(wake && { wake: true }) }, ts);

  // Yesterday: the sessions join, each with its charge; one is titled with its own alias, one with a name of its own.
  await joined(S.gone, 'doperpowers-1e', 'mini', yesterday(0));
  await joined(S.rests, 'cua_repl', 'macbook', yesterday(3));
  await charge(S.rests, 'macbook', 'browser and GUI checks', yesterday(3));
  await joined(S.works, 'maws-fe', 'mini', yesterday(6));
  await hub.append(PROJECT, { writer: `mini/${S.works}`, kind: 'titled', session: S.works, title: 'Desk chat rendering' }, yesterday(6));
  await charge(S.works, 'mini', 'desk chat: the group view', yesterday(7));
  await joined(S.asks, 'acc-ask71', 'macbook', yesterday(9));
  await hub.append(PROJECT, { writer: `macbook/${S.asks}`, kind: 'renamed', session: S.asks, alias: 'acc-ask71' }, yesterday(9));
  await hub.append(PROJECT, { writer: `macbook/${S.asks}`, kind: 'titled', session: S.asks, title: 'acc-ask71' }, yesterday(9));
  await charge(S.asks, 'macbook', "a resumed session's answer path", yesterday(10));

  await message(S.works, 'maws-fe', 'mini', 'Rebased on `master` and ran the suites:\n\n- static: green\n- unit: **287** passed\n- `e2e:desk-web`: 45/45\n\nThe PR is [#73](https://github.com/SSFSKIM/MAWS/pull/73); the diff touches only `apps/desk-web`.', 'r1#0', yesterday(40));
  await message(S.works, 'maws-fe', 'mini', "One thing I noticed on the way: the chat's quiet events take a line each, so a session's start reads like a conversation.", 'r1#1', yesterday(41));
  const fold = await human([[S.works, 'maws-fe']], '@maws-fe Fold them. Keep joins and ends visible.', yesterday(45));
  await hub.deliver(PROJECT, 'mini', { event: { writer: fold.event.writer, seq: fold.event.seq }, session: S.works, outcome: 'delivered', reason: 'pushed to the live session' });

  // Today: traffic between agents, a session restarting, its message, its open question, an end, an answered question.
  await say(S.works, 'maws-fe', 'mini', [[S.asks, 'acc-ask71']], 'can you take the answer path for a resumed session?', today(0));
  await say(S.asks, 'acc-ask71', 'macbook', [[S.works, 'maws-fe']], 'yes, on it; I will re-raise the open question first', today(1));
  await hub.append(PROJECT, { writer: `macbook/${S.asks}`, kind: 'state', session: S.asks, state: 'stopped', machine: 'macbook' }, today(2));
  await hub.append(PROJECT, { writer: `macbook/${S.asks}`, kind: 'state', session: S.asks, state: 'busy', machine: 'macbook' }, today(3));
  await message(S.asks, 'acc-ask71', 'macbook', "The resumed session's open question is not answerable because the bridge re-raises it under a new request id, and the desk keys the card by the old one. Draft fix in `hooks/mods/bridge-requests.tsx`; the store is untouched.", 'r2#0', today(17));
  await hub.append(PROJECT, { writer: `macbook/${S.asks}`, kind: 'question', from: 'acc-ask71', to: 'host', text: ['Which fix do you want?'], choices: ['Re-key by call id', 'Settle the old request'], src: ASK_OPEN }, today(18));
  await hub.raise(PROJECT, 'macbook', {
    request: ASK_OPEN,
    session: S.asks,
    tool: 'mcp__doperpowers__AskUserQuestion',
    input: {
      questions: [
        {
          question: 'Which fix do you want?',
          header: 'Fix',
          options: [
            { label: 'Re-key by call id', description: 'The card follows the call, whatever request id the bridge mints.' },
            { label: 'Settle the old request', description: 'The old card closes as withdrawn and the new one stands alone.' },
          ],
          multiSelect: false,
        },
      ],
    },
    async: true,
  });
  await hub.append(PROJECT, { writer: `mini/${S.gone}`, kind: 'retired', session: S.gone, by: '', reason: 'ended' }, today(20));
  await hub.append(PROJECT, { writer: `macbook/${S.rests}`, kind: 'question', from: 'cua_repl', to: 'host', text: ['Keep the Playwright trace on failure?'], choices: ['yes', 'no'], src: ASK_DONE }, today(22));
  await hub.raise(PROJECT, 'macbook', {
    request: ASK_DONE,
    session: S.rests,
    tool: 'mcp__doperpowers__AskUserQuestion',
    input: { questions: [{ question: 'Keep the Playwright trace on failure?', header: 'Trace', options: [{ label: 'yes' }, { label: 'no' }], multiSelect: false }] },
    async: true,
  });
  await hub.append(PROJECT, { writer: `macbook/${S.rests}`, kind: 'answered', from: 'cua_repl', src: ASK_DONE, text: ANSWER_SUMMARY }, today(24));
  await hub.settle(PROJECT, 'macbook', S.rests, { request: ASK_DONE, winner: 'web', outcome: 'answered', by: M });
  await hub.append(PROJECT, { writer: `macbook/${S.rests}`, kind: 'status', session: S.rests, text: 'trace: on' }, today(25));

  // The owner: a wake to everyone, with mixed deliveries, then a record.
  const all = await human(
    [
      [S.asks, 'acc-ask71'],
      [S.works, 'maws-fe'],
      [S.rests, 'cua_repl'],
    ],
    '@all Merging in ten minutes; push what you have.',
    today(28),
    true,
  );
  const at = { writer: all.event.writer, seq: all.event.seq };
  await hub.deliver(PROJECT, 'macbook', { event: at, session: S.asks, outcome: 'delivered', reason: 'pushed to the live session' });
  await hub.deliver(PROJECT, 'mini', { event: at, session: S.works, outcome: 'refused-read-only', reason: 'this machine is read-only: nothing written outside it is delivered' });
  await hub.deliver(PROJECT, 'macbook', { event: at, session: S.rests, outcome: 'uncertain', reason: 'the frame was taken and never answered' });
  await human('*', 'For the record: mini stays read-only until the deploy lands.', today(30));

  const policy = { read_only: false, ceiling: 'default' };
  hub.setMachines(PROJECT, [
    { machine: 'macbook', online: true, policy, checkouts: [] },
    { machine: 'mini', online: true, policy: { read_only: true, ceiling: 'default' }, checkouts: [] },
  ]);
  const presence = (machine: string, session: string, status: string) =>
    hub.sendSession(PROJECT, { project: PROJECT, machine, session, kind: 'presence', sub: null, n: null, body: { record: { status }, bridge: true } });
  presence('macbook', S.asks, 'busy');
  presence('mini', S.works, 'busy');
  presence('macbook', S.rests, 'idle');
}

async function openChat(page: Page, hub: HubDouble): Promise<void> {
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await expect(nav(page).locator(`[data-session="${S.asks}"]`)).toBeVisible();
  await expect(center(page)).toContainText('mini stays read-only until the deploy lands');
}

test('the group chat, a day of a project at desktop and phone widths', async ({ page, hub }) => {
  await stageChat(hub);
  await page.setViewportSize({ width: 1440, height: 1500 });
  await openChat(page, hub);
  const chat = center(page);
  await shot(page, 'chat-desktop'); // as it opens: the quiet run and the agent traffic folded

  // Two days, each under its separator.
  await expect(chat.getByRole('separator')).toHaveCount(2);
  await expect(chat.getByRole('separator').nth(1)).toHaveText(/Today|오늘/);

  // The sessions' joins and charges, merged per session (the rename to the same name says nothing), fold behind their
  // count; opened, each session is one line.
  const quiet = chat.getByTestId('quiet-run').first();
  await expect(quiet).toContainText('7 updates · doperpowers-1e, cua_repl, maws-fe, acc-ask71');
  await expect(chat).not.toContainText('is now acc-ask71');
  await quiet.getByRole('button').click();
  await expect(quiet).toContainText("acc-ask71 joined on macbook · is in charge of: a resumed session's answer path");
  await expect(chat).not.toContainText('is now acc-ask71');

  // One header per run: maws-fe's two messages within a minute under one, its title with the alias beside it; acc-ask71,
  // titled with its own alias, named once; the message through MAWS's Markdown as the session view draws an answer.
  const heads = chat.getByTestId('said');
  await expect(heads.filter({ hasText: 'Desk chat rendering' })).toHaveCount(1);
  await expect(heads.filter({ hasText: 'Desk chat rendering' })).toContainText('maws-fe');
  await expect(heads.filter({ hasText: 'acc-ask71' })).toHaveCount(1);
  await expect(heads.filter({ hasText: 'acc-ask71' }).getByTestId('said-alias')).toHaveCount(0);
  const rebased = chat.locator('.transcript-answer').filter({ hasText: 'Rebased on' });
  await expect(rebased.getByRole('listitem').filter({ hasText: 'unit' })).toHaveText('unit: 287 passed'); // no literal asterisks: MAWS's Markdown
  await expect(rebased.getByRole('link', { name: '#73' })).toBeVisible();

  // Agent traffic: one line per run, the messages behind it.
  const run = chat.getByTestId('agent-run');
  await expect(run).toContainText('2 messages between agents · maws-fe, acc-ask71');
  await expect(chat).not.toContainText('can you take the answer path');
  await run.getByRole('button').click();
  await expect(run.getByTestId('agent-run-messages')).toContainText('maws-fe → acc-ask71');

  // The stop and the restart are one quiet line, between the traffic and the message.
  await expect(chat.getByTestId('quiet').filter({ hasText: 'stopped on macbook' })).toContainText('acc-ask71 stopped on macbook · is running again on macbook');

  // The open question is its card, answerable here; the answered one is MAWS's receipt, the engine's summary never drawn.
  const card = chat.locator(`[data-request="${ASK_OPEN}"]`);
  await expect(card.getByRole('radio', { name: 'Re-key by call id' })).toBeVisible();
  await expect(chat).not.toContainText('Open question');
  const receipt = chat.getByTestId('question');
  await expect(receipt).toHaveCount(1);
  await expect(receipt.locator('.transcript-question-line')).toHaveText('Trace→yes');
  await expect(chat).not.toContainText('Your questions have been answered');
  await expect(chat).not.toContainText('yes · no');

  // The owner's sends are MAWS's bubbles on the right, each recipient's outcome in the foot; the record says so.
  const sends = chat.locator('.desk-chat-send');
  await expect(sends).toHaveCount(3);
  for (const send of await sends.all()) await expect(send).toHaveAttribute('data-side', 'you');
  const all = sends.filter({ hasText: 'Merging in ten minutes' });
  await expect(all).toHaveAttribute('data-state', 'mixed');
  await expect(all.getByTestId('deliveries')).toContainText('acc-ask71: delivered');
  await expect(all.getByTestId('deliveries')).toContainText('maws-fe: not delivered: the machine is read-only');
  await expect(all.getByTestId('deliveries')).toContainText('cua_repl: possibly delivered');
  await expect(sends.filter({ hasText: 'For the record' }).getByTestId('record')).toHaveText('Recorded · delivered to no one');
  await expect(page.getByTestId('composer')).toContainText('Mention @alias to deliver');

  await chat.getByTestId('channel-events').evaluate((el) => el.scrollTo({ top: -el.scrollHeight }));
  await page.waitForTimeout(150);
  await shot(page, 'chat-desktop-opened'); // the quiet run and the agent traffic opened

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${hub.url}/p/${PROJECT}`);
  await nav(page).getByRole('button', { name: /acceptance-scratch/ }).click();
  await expect(center(page)).toContainText('mini stays read-only until the deploy lands');
  await shot(page, 'chat-phone-tail');
  await center(page).getByTestId('channel-events').evaluate((el) => el.scrollTo({ top: -el.scrollHeight }));
  await page.waitForTimeout(150);
  await shot(page, 'chat-phone-head');
});

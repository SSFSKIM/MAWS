// The words rig's project channel (e2e/words-shots.rig.ts, launch 12; the word cut's P447 and P448): a smaller seed of
// e2e/channel.spec.ts's, through the same seam (a harness build's main answers `org.status` and the project's
// `org.channel.open` from a file: src/main/org/channel-fixture.ts, read from MAWS_E2E_CHANNEL) over the same stub
// scenario (C5's, holding the project whose sminos id is the channel's). It holds the two folds the cut rewords: a
// session's run of messages to the whole project, and an exchange between two sessions; then one message to everyone
// and a person's word. Ids are fixed, so the before and the after draw the same channel; the times follow the clock.
// Rig-only: no gated spec imports it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChannelAnswer, ChannelEvent, ChannelSession, OrgMember, OrgStatus } from '../../src/shared/ipc/schema/org';
import { memberNames } from '../../src/shared/org/member-name';
import { REPO_ROOT } from './launch';

export const CHANNEL_FIXTURE_ENV = 'MAWS_E2E_CHANNEL'; // channel-fixture.ts's CHANNEL_FIXTURE_ENV
export const WORDS_CHANNEL_PROJECT = '5d2c7e1a-9b3f-4c8d-a6e5-0f1b2c3d4e60';
export const WORDS_CHANNEL_PROJECT_ID = 'proj-harbour-ledger';
const PROJECT_NAME = 'harbour-ledger';
const WAITING = ['app-3eb04b84', 'app-d095dc75']; // the shell scenario's permission and question sessions, the project's
const S1 = 'c1d2e3f4-0000-4000-8000-000000000601';
const S2 = 'c1d2e3f4-0000-4000-8000-000000000602';
const S3 = 'c1d2e3f4-0000-4000-8000-000000000603';
/** The folded broadcast run's and the folded exchange's counts. */
export const WORDS_CHANNEL_COUNTS = { broadcast: 5, exchange: 12 } as const;

/** The channel as main would answer it, offline as of a minute ago, `now` the clock its times read from. */
export function wordsChannel(now: number): { status: Extract<OrgStatus, { state: 'registered' }>; project: string; answer: ChannelAnswer & { ok: true } } {
  const ana = { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', email: 'ana.lopez@harbour.example' };
  const names = memberNames([ana]);
  const member = (m: { id: string; email: string }): OrgMember => ({ ...m, name: names.get(m.id)! });
  const sessions: ChannelSession[] = [
    { session: S1, alias: 'ledger-api', machine: 'studio-mini', title: 'Move the ledger export to the new queue', member: true, authenticated: true },
    { session: S2, alias: 'reconciler', machine: 'build-box', title: 'Reconcile the March statements', member: true, authenticated: true },
    { session: S3, alias: 'docs-writer', machine: 'studio-mini', title: 'Write the export notes', member: true, authenticated: true },
  ];
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const events: ChannelEvent[] = [];
  const add = (writer: string, body: Record<string, unknown>, rest: Pick<ChannelEvent, 'label'> & Partial<Pick<ChannelEvent, 'session' | 'author' | 'owners'>>) => {
    const seq = events.filter((e) => e.writer === writer).length + 1;
    events.push({ offset: events.length, writer, seq, event: { writer, seq, ...body }, ...rest });
  };
  const say = (from: ChannelSession, to: '*' | ChannelSession, text: string, minutesAgo: number) =>
    add(
      `${from.machine}/${from.session}`,
      { kind: 'say', from: from.machine, to: to === '*' ? '*' : [{ session: to.session, alias: to.alias }], text, ts: at(minutesAgo), created: at(minutesAgo) },
      { session: from.session, label: 'verified', owners: [member(ana)] },
    );
  // a session's run to the whole project, a minute apart: folded to "docs-writer · 5" (master: "5 messages from docs-writer to everyone")
  const notes = ['Export notes started.', 'The queue section is drafted.', 'Added the retry table.', 'Linked the runbook.', 'Notes ready for review.'];
  for (const [i, text] of notes.entries()) say(sessions[2]!, '*', text, 40 - i);
  // an exchange between two sessions: folded to "ledger-api and reconciler · 12" (master: "12 messages between …")
  const lines = ['The export now writes to the new queue.', 'Statements for March read from it?', 'Yes, from tonight’s run on.', 'Holding the reconcile until then.'];
  for (let i = 0; i < WORDS_CHANNEL_COUNTS.exchange; i++) {
    const [from, to] = i % 2 === 0 ? [sessions[0]!, sessions[1]!] : [sessions[1]!, sessions[0]!];
    say(from, to, `${lines[i % lines.length]} (${i + 1})`, 30 - i);
  }
  // one message to everyone, alone (master: "ledger-api to everyone"), and a person's word
  say(sessions[0]!, '*', 'The export moved; the old queue stays read-only for a week.', 10);
  add(`hub/${ana.id}`, { kind: 'human', from: 'human', member: ana.id, to: '*', text: 'Thanks. I will check the March totals in the morning.', ts: at(6), created: at(6), nonce: 'bm9uY2Utd29yZHMtY2hhbm5lbA' }, { label: 'verified', author: member(ana) });
  const answer: ChannelAnswer & { ok: true } = { ok: true, rev: 1, events, sessions, pending: [], unverified: 0, asOf: at(1), live: false };
  const status: Extract<OrgStatus, { state: 'registered' }> = {
    state: 'registered',
    org: 'harbour',
    hub: 'https://desk.harbour.example',
    member: { id: ana.id, email: ana.email },
    device: 'ZGV2aWNlLXdvcmRzLWNoYW5uZWw',
    session: 'signed-in',
    hubAccess: 'unreachable',
    head: { version: 7, issued: at(3 * 1440) },
    problem: null,
    signer: null,
    pairing: null,
    enrolling: null,
    hubRowsLeft: [],
    delegations: { creating: false, rev: 0 },
  };
  return { status, project: WORDS_CHANNEL_PROJECT, answer };
}

/** C5's stub scenario: the project the channel's sminos id joins, holding the shell scenario's two waiting sessions. */
export function wordsChannelScenario(): unknown {
  const shell = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/shell/nine-sessions.json'), 'utf8')) as Record<string, Array<Record<string, unknown>>>;
  const ours = (entry: Record<string, unknown>) => WAITING.includes((entry.appId ?? entry.appSessionId) as string);
  return {
    version: 1,
    projects: [
      {
        id: WORDS_CHANNEL_PROJECT_ID,
        name: PROJECT_NAME,
        directory: `/Users/ana/Developer/${PROJECT_NAME}`,
        order: 0,
        createdAt: '2026-09-01T09:00:00.000Z',
        org: { key: `smns:${WORDS_CHANNEL_PROJECT}`, name: PROJECT_NAME, source: 'smns', smnsId: WORDS_CHANNEL_PROJECT },
      },
    ],
    sessions: shell.sessions!.filter(ours).map((s) => ({ ...s, projectId: WORDS_CHANNEL_PROJECT_ID })),
    digests: shell.digests!.filter(ours),
    engine: shell.engine!.filter(ours),
    attention: shell.attention!.filter(ours),
    timeline: [],
  };
}

// The spine's profile-sized fixture (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, D19): what
// e2e:daemon-idle-spine composes the spine over, a profile the size of the owner's. Sessions discovered over project
// folders (no repositories, so no git runs at the spine's start but the org refresh's one per project), attention items
// some of them pending, library rows each linked to the session that made it, composer drafts and the prompt history's
// lines, all from a seeded generator and written through the code that writes them in the app: the index's own stores
// (`sessions.upsertFromSummary`, the attention store, the library store, the drafts) and the prompt history's append.
// The same seed writes the same records; only what the index mints itself (app and project ids, a record's creation
// time) differs from one profile to the next.
// P5 O3-D M6 (fix round 1; the architect's ruling (a) on the discovery wake): with `transcripts` (an engine config
// directory), each session's transcript is written there too, its row's size and mtime the file's own stat and its
// search text stamped ready, so the store on disk matches the index exactly and an engine host's scan finds nothing to
// summarise, remove or re-index. Without it (the unit suite's cases that never scan) no file is written, as before.
import { mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtifactKind, ArtifactSessionLink } from '@shared/artifacts/entity';
import type { AttentionItem } from '@shared/graph/attention';
import type { AttentionKind, AttentionState } from '@shared/graph/enums';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { LibraryEntry } from '@shared/ipc/schema/library';
import { PromptHistory } from '../../src/services/history/prompt-history';
import { Index } from '../../src/services/index/index';
import { item } from './builders';
import { sessionIdFor, summary } from './index-fixture';

export interface SpineFixtureCounts {
  sessions: number;
  projects: number; // the folders the sessions are spread over, each holding at least one
  attention: number;
  pending: number; // of `attention`
  library: number;
  drafts: number;
  history: number; // the prompt history's lines
}

// D19: the owner's store held 5,108 transcript summaries (src/services/index/source.ts's header)
export const PROFILE_SIZED: SpineFixtureCounts = { sessions: 5_000, projects: 50, attention: 300, pending: 40, library: 1_000, drafts: 50, history: 2_000 };

const BASE = Date.parse('2026-10-01T00:00:00.000Z'); // every time is before it, so a fixture reads the same on any day
const DAY = 86_400_000;
const WORDS = ['refactor', 'the', 'session', 'index', 'and', 'add', 'a', 'test', 'for', 'attention', 'fix', 'flaky', 'layout', 'review',
  'branch', 'merge', 'library', 'draft', 'prompt', 'history', 'why', 'does', 'build', 'fail', 'on', 'mac', 'update', 'docs', 'spec', 'run'];
// The kinds a profile keeps across runs: attention's own derived items. A broker item (a permission, a question, a plan)
// dies with the process that asked it, so the spine's start drops it from the store (src/services/attention/service.ts's merge).
const KEPT_KINDS: AttentionKind[] = ['error', 'interrupted', 'auto_mode_unavailable'];
const SETTLED: AttentionState[] = ['delivered', 'confirmed', 'retired'];
const ARTIFACT_KINDS: ArtifactKind[] = ['document', 'presentation', 'design', 'dashboard', 'html', 'file'];

// mulberry32: a small seeded generator, the same numbers from the same seed on every runtime
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// A session's transcript as the engine writes one (its prompt, then the answer), its mtime the session's last record
// on a whole second (so the stat reads it back exactly); the row records the file's own size and mtime.
function writeTranscript(folder: string, t: { sessionId: string; directory: string; first: number; last: number; firstPrompt: string; lastAssistantText: string }): { transcriptPath: string; size: number; mtimeMs: number } {
  mkdirSync(folder, { recursive: true });
  const transcriptPath = join(folder, `${t.sessionId}.jsonl`);
  const row = (n: number, at: number, message: object) => ({ parentUuid: n === 0 ? null : uuid(n), isSidechain: false, type: n === 0 ? 'user' : 'assistant', message, uuid: uuid(n + 1), timestamp: new Date(at).toISOString(), cwd: t.directory, sessionId: t.sessionId, version: '2.1.291' });
  writeFileSync(transcriptPath, `${JSON.stringify(row(0, t.first, { role: 'user', content: t.firstPrompt }))}\n${JSON.stringify(row(1, t.last, { role: 'assistant', content: [{ type: 'text', text: t.lastAssistantText }] }))}\n`);
  const seconds = Math.floor(t.last / 1000);
  utimesSync(transcriptPath, seconds, seconds);
  const stat = statSync(transcriptPath);
  return { transcriptPath, size: stat.size, mtimeMs: stat.mtimeMs };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

// Writes the fixture into `profile` (its index and its prompt history) with its project folders under `folders`, and
// answers the counts read back from what was written.
export async function writeSpineFixture({ profile, folders, counts = PROFILE_SIZED, seed = 1, transcripts }: {
  profile: string;
  folders: string;
  counts?: SpineFixtureCounts;
  seed?: number;
  transcripts?: string; // the engine config directory (CLAUDE_CONFIG_DIR) to write each session's transcript into
}): Promise<SpineFixtureCounts> {
  if (counts.pending > counts.attention || counts.projects > counts.sessions || counts.drafts > counts.sessions) throw new Error(`not a fixture: ${JSON.stringify(counts)}`);
  const random = generator(seed);
  const below = (n: number) => Math.floor(random() * n);
  const words = (min: number, max: number) => Array.from({ length: min + below(max - min + 1) }, () => WORDS[below(WORDS.length)]).join(' ');
  const timeBefore = (span: number) => BASE - below(span);

  const directories = Array.from({ length: counts.projects }, (_, n) => join(folders, `project-${String(n).padStart(2, '0')}`));
  for (const directory of directories) mkdirSync(directory, { recursive: true });

  mkdirSync(profile, { recursive: true });
  const index = new Index(join(profile, 'index.sqlite'));
  try {
    // Sessions: every folder holds one, the rest spread at random, each a summary as discovery reads a transcript
    const records: SessionRecord[] = index.transaction(() =>
      Array.from({ length: counts.sessions }, (_, n) => {
        const directory = directories[n < counts.projects ? n : below(counts.projects)]!;
        const sessionId = sessionIdFor(n + 1);
        const first = timeBefore(365 * DAY);
        const last = first + below(3 * DAY);
        const slug = directory.replace(/[^a-zA-Z0-9]/g, '-');
        // drawn in the order the fixture always drew them, so a seed writes the same records with or without transcripts
        let stamp = { transcriptPath: join(profile, 'claude-config', 'projects', slug, `${sessionId}.jsonl`), size: 2_000 + below(4_000_000), mtimeMs: last };
        const aiTitle = random() < 0.8 ? words(2, 6) : null;
        const firstPrompt = words(4, 40);
        const lastAssistantText = words(6, 60);
        if (transcripts !== undefined) stamp = writeTranscript(join(transcripts, 'projects', slug), { sessionId, directory, first, last, firstPrompt, lastAssistantText });
        const record = index.sessions.upsertFromSummary(summary({
          sessionId,
          directory,
          slug,
          ...stamp,
          birthtimeMs: first,
          firstRecordAt: new Date(first).toISOString(),
          lastRecordAt: new Date(last).toISOString(),
          aiTitle,
          firstPrompt,
          lastAssistantText,
        })).record;
        if (transcripts !== undefined) index.sessionSearch.replace(record.appId, sessionId, stamp.size, stamp.mtimeMs, `${firstPrompt}\n${lastAssistantText}`, true);
        return record;
      }),
    );
    const anySession = () => records[below(records.length)]!;

    // Attention: `pending` of them waiting, the rest settled, on sessions picked at random
    const items = new Map<AppSessionId, AttentionItem[]>();
    for (let n = 0; n < counts.attention; n += 1) {
      const session = anySession().appId;
      const pending = n < counts.pending;
      const at = new Date(timeBefore(30 * DAY)).toISOString();
      const kind = KEPT_KINDS[below(KEPT_KINDS.length)]!;
      items.set(session, [...(items.get(session) ?? []), item(session, kind, at, {
        id: `att-fixture-${n}` as AttentionItem['id'],
        request: { requestId: `req-fixture-${n}` as AttentionItem['request']['requestId'], toolUseId: null, taskId: null, agentId: null },
        summary: words(3, 12),
        state: pending ? 'pending' : SETTLED[below(SETTLED.length)]!,
      })]);
    }
    for (const [session, list] of items) await index.attention.replaceForSession(session, list);

    // The library: each artifact made by a session, linked to it
    const artifacts: LibraryEntry[] = [];
    const links: ArtifactSessionLink[] = [];
    for (let n = 1; n <= counts.library; n += 1) {
      const maker = anySession().appId;
      const createdAt = timeBefore(180 * DAY);
      const updatedAt = createdAt + below(10 * DAY);
      artifacts.push({
        id: uuid(n), kind: ARTIFACT_KINDS[below(ARTIFACT_KINDS.length)]!, title: words(1, 6), createdBy: { kind: 'session', appSessionId: maker },
        createdAt, updatedAt, lastViewedAt: null, pinned: random() < 0.05, agentEditsAsSuggestions: false, revision: 1 + below(40),
        lastEditor: { kind: 'session', appSessionId: maker }, lastEditedAt: updatedAt,
      });
      links.push({ artifactId: uuid(n), appSessionId: maker, role: 'created', lastAt: updatedAt });
    }
    index.library.reconcile({ artifacts, links, spaces: [] });

    // Drafts on distinct sessions
    const drafted = new Set<SessionRecord>();
    while (drafted.size < counts.drafts) drafted.add(anySession());
    for (const record of drafted) {
      index.drafts.set(record.appId, { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words(3, 30) }] }] }, attachments: [], updatedAt: new Date(timeBefore(30 * DAY)).toISOString() });
    }

    // The prompt history: MAWS's own file, appended oldest first as the composer does
    const byId = new Map(records.map((record) => [record.appId, record]));
    let clock = BASE - counts.history * 60_000;
    const history = new PromptHistory({
      file: join(profile, 'prompt-history.jsonl'),
      configDir: join(profile, 'claude-config'),
      session: (appSessionId) => {
        const record = byId.get(appSessionId);
        return record ? { directory: record.directory, engineSessionId: record.engineSessionId } : null;
      },
      now: () => (clock += 60_000),
    });
    for (let n = 0; n < counts.history; n += 1) await history.append(anySession().appId, words(2, 30), {});

    const attention = await index.attention.list();
    const written = index.sessions.list({ includeArchived: true });
    return {
      sessions: written.length,
      projects: index.projects.list({ includeHidden: true }).length,
      attention: attention.length,
      pending: attention.filter((each) => each.state === 'pending').length,
      library: index.library.list().rows.length,
      drafts: written.filter((record) => index.drafts.get(record.appId) !== null).length,
      history: readFileSync(join(profile, 'prompt-history.jsonl'), 'utf8').split('\n').filter(Boolean).length,
    };
  } finally {
    index.close();
  }
}

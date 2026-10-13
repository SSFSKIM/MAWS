// A session for the library's viewer case (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5b; `e2e/library.spec.ts`),
// run as E3's side spec runs one (`e2e/side.spec.ts`): C3's replay transport and C10's replay seam over journals built
// by `side-replay.ts`, a scratch repository trusted in a temp config home, a throwaway profile. The parent's first turn
// makes its page through the artifact store (`artifact_create`, allowed by a rule, served by the engine host), so the
// store holds an `html` artifact linked to the parent; a comment's side thread replies once. No engine runs and the
// owner's `~/.claude` is never read or written.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { ScratchRepo } from '../../test/support/scratch-repo';
import { StoreFixture } from '../../test/support/store-fixture';
import { launchMaws, type MawsLaunch } from './launch';
import { SideJournal } from './side-replay';
import { newChatIn, openProject } from './sidebar';

export const PARENT = 'e3e50000-0000-4000-8000-0000000000b1';
export const CHILD = 'e3e50000-0000-4000-8000-0000000000b2';
export const FIRST_PROMPT = 'Make me a dashboard page.';
export const FIRST_REPLY = 'The dashboard page is in your artifacts.';

export function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const) as Promise<CommandResult<N>>;
}
export function value<N extends CommandName>(result: CommandResult<N>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

// The parent: one turn whose `artifact_create` makes the page `title` (its handle `dash`), then the reply.
export function pageParentJournal(cwd: string, page: string, title: string): SideJournal {
  const journal = new SideJournal(PARENT, cwd);
  const prompt = journal.prompt();
  journal.mawsToolCall('artifact_create', { id: 'dash', content: page, title }, { status: 'created', id: 'dash', version: 1, title }, { asked: false });
  journal.reply(prompt, FIRST_REPLY);
  journal.completed(prompt);
  return journal;
}

// A side thread: its first prompt (the anchored comment), the rename the host writes (the anchor's label), one reply.
export function threadJournal(cwd: string, label: string, reply: string): SideJournal {
  const journal = new SideJournal(CHILD, cwd);
  const first = journal.prompt();
  journal.rename(label);
  journal.reply(first, reply);
  journal.completed(first);
  return journal;
}

export interface SessionCase {
  maws: MawsLaunch;
  page: Page;
  repo: ScratchRepo;
  parent: string; // the parent's app session id
  cleanup(): Promise<void>;
}

// The product on the journals `build` writes, a project of the scratch repository, and the parent started through "+"
// with its first prompt; answers once that turn is over.
export async function startSessionCase(build: (cwd: string) => SideJournal[], env: Record<string, string> = {}): Promise<SessionCase> {
  const repo = await ScratchRepo.create({ sentinels: false });
  const store = await StoreFixture.create();
  const journals = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e2e-library-journals-')));
  const disposers: (() => Promise<void> | void)[] = [() => rmSync(journals, { recursive: true, force: true }), () => store.dispose(), () => repo.dispose()];
  const cleanup = async () => {
    for (const dispose of disposers.splice(0).reverse()) await dispose();
  };
  try {
    writeFileSync(join(store.configHome, '.claude.json'), `${JSON.stringify({ projects: { [repo.root]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
    writeFileSync(join(store.configHome, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
    const fixtures = build(repo.root).map((journal, k) => journal.write(journals, `journal-${k}`));
    const maws = await launchMaws({ env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: fixtures.join(','), CLAUDE_CONFIG_DIR: store.configHome, ...env } });
    disposers.push(() => maws.cleanup());
    await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
    const { page } = maws;
    await expect(page.locator('[data-region="main"]')).toBeVisible();
    const project = value(await invoke(page, 'session.projects.add', { directory: repo.root }));
    await openProject(page, project.name);
    await newChatIn(page, project.name);
    await expect(page.getByRole('heading', { name: `New chat in ${project.name}` })).toBeVisible();
    const parent = value(await invoke(page, 'session.intent.list', undefined)).intents.at(-1)!.appSessionId;
    value(await invoke(page, 'session.intent.patch', { appSessionId: parent, patch: { gateway: 'direct' } }));
    value(await invoke(page, 'session.start', { appSessionId: parent, message: { content: FIRST_PROMPT, display: FIRST_PROMPT }, options: {} }));
    await expect(page.locator('[data-region="main"]').getByText(FIRST_REPLY)).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: parent as never })).turn, { timeout: 10_000 }).toBeNull();
    return { maws, page, repo, parent, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

// The side thread of `parent` a comment opened (its record exists before the engine runs).
export async function sideThreadOf(page: Page, parent: string): Promise<string> {
  let child = '';
  await expect
    .poll(async () => {
      const records = value(await invoke(page, 'session.list', {})).sessions;
      child = records.find((r) => r.lineage?.kind === 'side-thread' && r.lineage.parentAppSessionId === parent && r.lineage.openedBy === 'comment')?.appId ?? '';
      return child;
    }, { timeout: 20_000 })
    .not.toBe('');
  return child;
}

// ---- media a viewer plays, made without checked-in assets (the Deliverables spec's own) ------------------------------------

// A one-page PDF whose page is mostly a filled black square; the cross-reference offsets are computed.
export function minimalPdf(): Buffer {
  const content = '0 0 0 rg 20 20 160 160 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, k) => {
    offsets.push(body.length);
    body += `${k + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

// A second of 8 kHz mono 16-bit silence: a valid WAV the audio element loads.
export function silentWav(seconds = 1, rate = 8_000): Buffer {
  const data = seconds * rate * 2;
  const wav = Buffer.alloc(44 + data);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + data, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(data, 40);
  return wav;
}

// Two seconds of a canvas whose colour cycles, recorded in the app's page with MediaRecorder: a real `.webm`.
export async function recordedWebm(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext('2d')!;
    const recorder = new MediaRecorder(canvas.captureStream(25), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    const start = performance.now();
    recorder.start(100);
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const elapsed = performance.now() - start;
        context.fillStyle = `hsl(${Math.round(elapsed / 8) % 360} 70% 45%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (elapsed > 2_000) {
          clearInterval(timer);
          resolve();
        }
      }, 40);
    });
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

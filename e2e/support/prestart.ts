// What the prestart scenes and the prestart measure read (ticket 851, M5; docs/doperpowers/plans/2026-11-24-prestart-engine.md,
// D14 and A1 to A4): a New chat tab of a project opened from its row's "+", its composer, the engine processes the
// latency stub counted (test/support/latency-engine-stub.mjs's starts file) and whether each still runs, and whether a
// session's journal says Send took a prestarted engine (the host journals `meta {event: 'prestart', phase: 'revealed'}`
// at the commit, src/engine-host/session.ts).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Locator, type Page } from '@playwright/test';
import { startsOf, type LatencyEngineStart } from '../../test/support/latency-engine';
import { invoke, value } from './c7-replay';
import { isAlive, ps } from './processes';
import { expectNewChatInFront } from './screen-reader-only';
import { newChatIn } from './sidebar';

// The composer of the tab in front: its editor.
export const composer = (page: Page): Locator => page.locator('[data-region="main"]').getByRole('textbox', { name: 'Message' });

// A New chat tab of the folder `directory`, added as a project, opened from the project row's "+" (the composer holds the
// keyboard); answers the tab's intent and the project's name.
export async function newChatTab(page: Page, directory: string): Promise<{ id: string; project: string }> {
  const project = value(await invoke(page, 'session.projects.add', { directory }));
  const known = new Set(value(await invoke(page, 'session.intent.list', undefined)).intents.map((i) => i.appSessionId as string));
  await newChatIn(page, project.name);
  await expectNewChatInFront(page, project.name);
  const fresh = value(await invoke(page, 'session.intent.list', undefined)).intents.find((i) => !known.has(i.appSessionId));
  if (fresh === undefined) throw new Error(`no new intent after New chat in ${project.name}`);
  return { id: fresh.appSessionId, project: project.name };
}

// A process still running: a zombie (exited, not yet reaped) is not.
export const engineRunning = (pid: number): boolean => isAlive(pid) && !ps(pid, 'stat').startsWith('Z');

// The engine processes the stub counted, and those of them still running.
export const startedEngines = (startsFile: string): LatencyEngineStart[] => startsOf(startsFile);
export const runningEngines = (startsFile: string): LatencyEngineStart[] => startsOf(startsFile).filter((start) => engineRunning(start.pid));

type JournalRow = { direction: string; frame: Record<string, unknown> };
// Every journal row of a session under the engine host's journal directory (its `.jsonl` files, oldest first); none when
// the session has no directory there.
export function journalRows(userData: string, appSessionId: string): JournalRow[] {
  const dir = join(userData, 'engine-host', 'journal', appSessionId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .sort()
    .flatMap((file) => readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as JournalRow));
}

// The files the engine host keeps for a session's launches (journals and their host maps), by name.
export function journalFiles(userData: string, appSessionId: string): string[] {
  const dir = join(userData, 'engine-host', 'journal', appSessionId);
  return existsSync(dir) ? readdirSync(dir).filter((file) => /\.(jsonl|hseq)$/.test(file)).sort() : [];
}

// Send took a prestarted engine: the session's journal says the hidden launch was revealed.
export const adoptedPrestart = (userData: string, appSessionId: string): boolean =>
  journalRows(userData, appSessionId).some((row) => row.direction === 'meta' && row.frame.event === 'prestart' && row.frame.phase === 'revealed');

// The spawn row of a session's launch, by its launch id.
export function spawnRowOf(userData: string, appSessionId: string, launchId: string): { args?: string[]; mawsTools?: unknown } | null {
  const row = journalRows(userData, appSessionId).find((r) => r.direction === 'meta' && r.frame.event === 'spawn' && r.frame.launchId === launchId);
  return (row?.frame as { args?: string[]; mawsTools?: unknown } | undefined) ?? null;
}

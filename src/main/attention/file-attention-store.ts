// The file-backed AttentionStore (C3 execution document, Interfaces "Broker"): `<userData>/attention.json`, one list
// per session, until C4's index implements the port (the SessionStateStore pattern). Read once, written whole through
// a temporary file and a rename, one write at a time; an unreadable file is kept aside (never deleted) and the store
// starts empty with a warning.
import { mkdir, readFile, rename } from 'node:fs/promises';
import { atomicWriteFile } from '../files/atomic-write';
import { dirname } from 'node:path';
import * as z from 'zod';
import { AttentionItemSchema, type AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { AttentionStore } from './store';

const FileSchema = z.strictObject({ version: z.literal(1), sessions: z.record(z.string(), z.array(AttentionItemSchema)) });
type AttentionFile = z.infer<typeof FileSchema>;

export class FileAttentionStore implements AttentionStore {
  private loaded: Promise<AttentionFile> | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async list(): Promise<AttentionItem[]> {
    return Object.values((await this.load()).sessions).flat();
  }

  replaceForSession(appSessionId: AppSessionId, items: AttentionItem[]): Promise<void> {
    return this.update((sessions) => {
      if (items.length === 0) delete sessions[appSessionId];
      else sessions[appSessionId] = items;
    });
  }

  retireForSession(appSessionId: AppSessionId): Promise<void> {
    return this.update((sessions) => void delete sessions[appSessionId]);
  }

  private update(change: (sessions: AttentionFile['sessions']) => void): Promise<void> {
    const next = this.chain.then(async () => {
      const state = await this.load();
      change(state.sessions);
      await mkdir(dirname(this.file), { recursive: true });
      await atomicWriteFile(this.file, JSON.stringify(state));
    });
    this.chain = next.catch(() => {});
    return next;
  }

  private load(): Promise<AttentionFile> {
    this.loaded ??= readFile(this.file, 'utf8').then(
      async (text) => {
        try {
          return FileSchema.parse(JSON.parse(text));
        } catch (error) {
          const aside = `${this.file}.corrupt-${Date.now()}`;
          await rename(this.file, aside);
          console.warn(`[attention] ${this.file} could not be read (${error instanceof Error ? error.message.split('\n')[0] : String(error)}); kept at ${aside}, starting empty`);
          return { version: 1 as const, sessions: {} };
        }
      },
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return { version: 1 as const, sessions: {} };
        throw error;
      },
    );
    return this.loaded;
  }
}

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDocuments } from './index';

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('openDocuments (the engine host register’s store)', () => {
  it('opens <userData>/artifacts/store.sqlite with a service whose adapters follow the entity row’s kind, and closes both', async () => {
    dir = mkdtempSync(join(tmpdir(), 'maws-docs-open-'));
    const documents = openDocuments(dir, () => {})!;
    expect(existsSync(join(dir, 'artifacts', 'store.sqlite'))).toBe(true);
    expect(documents.storage.status).toBe('ok');
    documents.storage.db.prepare("INSERT INTO artifacts (id, kind, title, createdBy, createdAt, updatedAt) VALUES ('a1', 'document', 'Doc', 'human', 1, 1)").run();
    const seen: string[] = [];
    documents.service.registerAdapter({ kind: 'document', afterUpdate: () => void seen.push('document') });
    await documents.service.writeAs('a1', { kind: 'human' }, (doc) => doc.get('t').insert(0, 'x'));
    await documents.service.writeAs('a2', { kind: 'human' }, (doc) => doc.get('t').insert(0, 'y')); // no row: the generic model
    expect(seen).toEqual(['document']);
    documents.close();
    documents.close(); // idempotent: both shutdown paths may reach it
    expect(documents.storage.db.isOpen).toBe(false);
  });

  it('answers null and logs when the store cannot be opened, so the host still serves its sessions', () => {
    dir = mkdtempSync(join(tmpdir(), 'maws-docs-open-'));
    mkdirSync(join(dir, 'artifacts', 'store.sqlite'), { recursive: true }); // a directory where the file goes: no database opens
    const lines: string[] = [];
    expect(openDocuments(dir, (line) => lines.push(line))).toBeNull();
    expect(lines.join('\n')).toMatch(/artifact store/);
  });
});

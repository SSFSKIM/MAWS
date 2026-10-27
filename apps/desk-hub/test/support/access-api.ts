// A fake of the account's Access API (deploy/access.ts's `CfApi`): reusable policies and applications, each with an
// id; an app has an `aud`. Lists, reads one by id, creates and updates in place; anything else is a suite's mistake.
import type { CfApi } from '../../deploy/access';

export function fakeAccessApi() {
  const policies = new Map<string, Record<string, unknown>>();
  const apps = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  let next = 0;
  const api: CfApi = {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      calls.push(`${method} ${path}`);
      const table = path.startsWith('/access/policies') ? policies : path.startsWith('/access/apps') ? apps : undefined;
      if (!table) throw new Error(`unexpected ${method} ${path}`);
      const id = path.split('/')[3];
      if (method === 'GET' && !id) return [...table.values()] as T;
      if (method === 'GET' && id && table.has(id)) return table.get(id) as T;
      if (method === 'POST' && !id) {
        const record = { ...(body as object), id: `id-${++next}`, ...(table === apps ? { aud: `aud-${next}` } : {}) };
        table.set(record.id, record);
        return record as T;
      }
      if (method === 'PUT' && id && table.has(id)) {
        const record = { ...table.get(id), ...(body as object), id };
        table.set(id, record);
        return record as T;
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
  return { api, policies, apps, calls };
}

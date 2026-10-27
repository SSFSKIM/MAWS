// A fake of the account's Access API (deploy/access.ts's `CfApi`): reusable policies and applications, each with an
// id; an app has an `aud`. Lists, reads one by id, creates and updates in place; anything else is a suite's mistake.
import { cfApi, type CfApi } from '../../deploy/access';

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

/**
 * The account's Access API over HTTP, paged as Cloudflare pages a list (`page` and `per_page`, 20 a page unless asked,
 * with `result_info.total_pages`; a list call naming no page answers the first alone), behind the real `cfApi`. Holds
 * reusable policies named `policyNames` (each listing `old@example.com`), ids `policies-<i>` in that order, and
 * applications named `appNames`; creates, reads by id and updates in place.
 */
export function pagedAccessApi(policyNames: string[], appNames: string[] = []) {
  const record = (table: string) => (name: string, i: number) => ({ id: `${table}-${i}`, name, ...(table === 'policies' ? { decision: 'allow', include: [{ email: { email: 'old@example.com' } }] } : { aud: `aud-${i}` }) });
  const tables: Record<string, Array<Record<string, unknown>>> = { policies: policyNames.map(record('policies')), apps: appNames.map(record('apps')) };
  const calls: string[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace(/^\/client\/v4\/accounts\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const ok = (result: unknown, extra = {}) => Response.json({ success: true, result, ...extra });
    const [, , name, id] = path.split('/');
    const table = tables[name];
    const found = table?.find((r) => r.id === id);
    if (table && method === 'GET' && !id) {
      const perPage = Number(searchParams.get('per_page') ?? 20);
      const page = Number(searchParams.get('page') ?? 1);
      const rows = table.slice((page - 1) * perPage, page * perPage);
      return ok(rows, { result_info: { page, per_page: perPage, count: rows.length, total_count: table.length, total_pages: Math.ceil(table.length / perPage) } });
    }
    if (method === 'GET' && found) return ok(found);
    if (method === 'PUT' && found) return ok(Object.assign(found, JSON.parse(String(init!.body))));
    if (table && method === 'POST' && !id) {
      const created = { ...JSON.parse(String(init!.body)), id: `${name}-${table.length}`, ...(name === 'apps' ? { aud: `aud-${table.length}` } : {}) };
      table.push(created);
      return ok(created);
    }
    return Response.json({ success: false, errors: [{ code: 0, message: `unexpected ${method} ${path}` }] }, { status: 400 });
  }) as typeof fetch;
  return { api: cfApi('token', 'acct', fetcher), policies: tables.policies, apps: tables.apps, calls };
}

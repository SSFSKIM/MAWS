// Who is signed in (DX3's `/api/me`, DX7's records). Access admits the person before the page loads; `/api/me` says
// whom the org holds them as. A request Access no longer admits (its session lapsed) is redirected to Access's sign-in
// on another origin, which a fetch cannot follow, so it surfaces as `signed-out`.
import type { MemberRecord, OrgRecord } from 'desk-hub/protocol';

export type Me = { org: OrgRecord; member: MemberRecord };

export class SignInError extends Error {
  constructor(readonly reason: 'not-a-member' | 'signed-out' | 'unavailable') {
    super(reason);
  }
}

export async function fetchMe(): Promise<Me> {
  let response: Response;
  try {
    response = await fetch('/api/me', { credentials: 'same-origin', redirect: 'manual' });
  } catch {
    throw new SignInError('unavailable');
  }
  if (response.type === 'opaqueredirect' || response.status === 401) throw new SignInError('signed-out');
  if (response.status === 403) throw new SignInError('not-a-member');
  if (!response.ok) throw new SignInError('unavailable');
  return (await response.json()) as Me;
}

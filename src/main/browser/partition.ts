// The browser's partitions (E4a execution document, Design §9 and §15): every page loads in a persistent partition of
// its own, never the app's default session (whose CSP override must not reach a page) nor E2's capture partition:
// `persist:maws-browser` by default, `persist:maws-chrome-<profileDir>` for a Chrome profile E4b imported and listed in
// `<userData>/browser/profiles.json`. The profile is read when a tab opens; a profile the list does not hold, or a
// partition that cannot be opened, falls back to the default with a chrome notice and leaves the setting as it is.
//
// Each partition is prepared once, the first time a tab needs it: the user agent without Electron's and the app's
// product tokens (Decision Log 8), and one `webRequest.onBeforeRequest` listener (Electron keeps one per session) that
// consults the request rules in order, the first being the refusal of `file:` and the app's own scheme (defence in depth
// beside the URL checks). Later children add their rules through `registerRequestRule` and their own preparation
// (permissions, downloads) to the list `Partitions` runs, rather than installing a second listener.
import { readFileSync } from 'node:fs';
import type { CallbackResponse, OnBeforeRequestListenerDetails, Session } from 'electron';
import * as z from 'zod';
import { BrowserPartitionSchema, DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';

// Loose: E4b owns the file and records more per profile (its storage directory, the source user-data directory, the
// extensions, the import report); E4a reads only these keys and must not refuse E4b's.
export const BrowserProfileSchema = z.looseObject({
  profileDir: z.string().min(1),
  name: z.string(),
  partition: BrowserPartitionSchema,
  importedAt: z.string(),
  bookmarks: z.looseObject({}).nullable().optional(), // cua #90: the bookmarks consent (version 2; absent in version 1)
  // cua #90: the Chrome account's names and how the avatar is drawn, for `browser.profiles.list` (version 2)
  gaiaName: z.string().nullable().optional(),
  userName: z.string().nullable().optional(),
  avatar: z.looseObject({ kind: z.string() }).optional(),
  // cua #90: the profile's extensions in Settings' order, for the action bar's list (always present in E4b's records)
  extensions: z.array(z.looseObject({ id: z.string(), name: z.string(), chromeId: z.string().nullable().optional() })).optional(),
});
export type BrowserProfile = z.infer<typeof BrowserProfileSchema>;
const ProfilesFileSchema = z.looseObject({ version: z.union([z.literal(1), z.literal(2) /* cua #90: profiles.json version 2 */]), profiles: z.array(BrowserProfileSchema) });

// Chromium's own user agent: the platform and the Chrome version stay truthful; `Electron/<v>` and `maws/<v>` go.
export function chromeUserAgent(userAgent: string): string {
  return userAgent.replace(/\s(?:Electron|maws)\/\S+/gi, '');
}

// A request rule answers a request of a browser partition, or `undefined` to leave it to the next rule; the first answer
// wins, and a request no rule answers proceeds.
export type RequestRule = (details: OnBeforeRequestListenerDetails, partition: string) => CallbackResponse | undefined;

const REFUSED_REQUEST = /^(?:file|maws-deliverable):/i;
export const refuseLocalRequests: RequestRule = (details) => (REFUSED_REQUEST.test(details.url) ? { cancel: true } : undefined);

export function preparePartition(ses: Pick<Session, 'getUserAgent' | 'setUserAgent' | 'webRequest'>, partition: string, rules: readonly RequestRule[]): void {
  ses.setUserAgent(chromeUserAgent(ses.getUserAgent()));
  ses.webRequest.onBeforeRequest((details, callback) => {
    for (const rule of rules) {
      const answer = rule(details, partition);
      if (answer !== undefined) return callback(answer);
    }
    callback({});
  });
}

export type PreparePartition = (ses: Session, partition: string) => void;

// The partition sessions the browser has opened, each prepared once: the user agent and the request rules first, then
// the preparers later children add.
export class Partitions {
  private readonly opened = new Map<string, Session>();
  private readonly rules: RequestRule[] = [refuseLocalRequests];

  constructor(
    private readonly fromPartition: (partition: string) => Session,
    private readonly prepare: readonly PreparePartition[] = [],
  ) {}

  // Consulted by every browser partition's request listener, after the rules registered before it; read per request,
  // so a rule added after a partition was prepared applies to it too.
  registerRequestRule(rule: RequestRule): () => void {
    this.rules.push(rule);
    return () => {
      const at = this.rules.indexOf(rule);
      if (at >= 0) this.rules.splice(at, 1);
    };
  }

  // E4b start: preparation steps registered after construction (E4b execution document, Decision Log 32, 35): the import
  // registers its per-boot extension loading here once startBrowser has returned. A step runs inside `session()`, after
  // E4a's preparers and before the partition counts as opened, so it is handed the session and must not call
  // `session()` for its own partition; it must not throw either (a throw would fail the partition's opening). A step
  // registered late runs at once for every partition already opened.
  private readonly registered: PreparePartition[] = [];

  registerPreparer(step: PreparePartition): () => void {
    this.registered.push(step);
    for (const [partition, ses] of this.opened) step(ses, partition);
    return () => {
      const at = this.registered.indexOf(step);
      if (at >= 0) this.registered.splice(at, 1);
    };
  }
  // E4b end

  // Opens and prepares the partition; throws when Electron cannot open it.
  session(partition: string): Session {
    let ses = this.opened.get(partition);
    if (!ses) {
      ses = this.fromPartition(partition);
      preparePartition(ses, partition, this.rules);
      for (const step of this.prepare) step(ses, partition);
      for (const step of [...this.registered]) step(ses, partition); // E4b: the steps registered after construction
      this.opened.set(partition, ses);
    }
    return ses;
  }

  // The partition opened, else the default (logged): the caller tells the chrome.
  openOrDefault(partition: string): { partition: string; fellBack: boolean } {
    try {
      this.session(partition);
      return { partition, fellBack: false };
    } catch (error) {
      if (partition === DEFAULT_PARTITION) throw error;
      console.warn(`[browser] the partition ${partition} could not be opened; using the default:`, error instanceof Error ? error.message : error);
      this.session(DEFAULT_PARTITION);
      return { partition: DEFAULT_PARTITION, fellBack: true };
    }
  }
}

export type PartitionNotice = { kind: 'profileMissing' | 'partitionFallback'; name: string };

// The partition for the Browser setting's profile (null: the default): a profile the list does not hold falls back to
// the default with the `profileMissing` notice. Pure; opening is `Partitions.openOrDefault`'s.
export function partitionFor(profile: string | null, profiles: readonly BrowserProfile[]): { partition: string; notice: PartitionNotice | null } {
  if (profile === null) return { partition: DEFAULT_PARTITION, notice: null };
  const listed = profiles.find((candidate) => candidate.profileDir === profile);
  if (!listed) return { partition: DEFAULT_PARTITION, notice: { kind: 'profileMissing', name: profile } };
  return { partition: profilePartition(listed.profileDir), notice: null };
}

// A new tab's partition: `partitionFor`, then opened, falling back to the default with `partitionFallback` (named by the
// profile) when Electron cannot open it.
export function tabPartition(
  profile: string | null,
  profiles: readonly BrowserProfile[],
  partitions: Pick<Partitions, 'openOrDefault'>,
): { partition: string; notice: PartitionNotice | null } {
  const chosen = partitionFor(profile, profiles);
  const opened = partitions.openOrDefault(chosen.partition);
  if (!opened.fellBack) return chosen;
  const listed = profiles.find((candidate) => profilePartition(candidate.profileDir) === chosen.partition);
  return { partition: opened.partition, notice: { kind: 'partitionFallback', name: listed?.name || profile || chosen.partition } };
}

// `<userData>/browser/profiles.json`, written by E4b's import; absent until a profile is imported.
export function readProfiles(file: string): BrowserProfile[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[browser] ${file} could not be read:`, error instanceof Error ? error.message : error);
    return [];
  }
  try {
    const parsed = ProfilesFileSchema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data.profiles;
    console.warn(`[browser] ${file} is not a profiles file; no imported profiles listed:`, parsed.error.message);
  } catch (error) {
    console.warn(`[browser] ${file} is not JSON; no imported profiles listed:`, error instanceof Error ? error.message : error);
  }
  return [];
}

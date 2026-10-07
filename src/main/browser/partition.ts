// The browser's partitions (E4a execution document, Design §9 and §15): every page loads in a persistent partition of
// its own, never the app's default session (whose CSP override must not reach a page) nor E2's capture partition:
// `persist:maws-browser` by default, `persist:maws-chrome-<profileDir>` for a Chrome profile E4b imported and listed in
// `<userData>/browser/profiles.json`. The profile is read when a tab opens; a profile the file does not list, or a
// partition that cannot be opened, falls back to the default with a chrome notice and leaves the setting as it is.
//
// Each partition is prepared once, the first time a tab needs it: the user agent without Electron's and the app's
// product tokens (Decision Log 8), and requests to `file:` and the app's own scheme cancelled (defence in depth beside
// the URL checks). Later pieces add their own preparation (permissions, downloads) to the list `Partitions` runs.
import { readFileSync } from 'node:fs';
import type { Session } from 'electron';
import * as z from 'zod';
import { BrowserPartitionSchema, DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';

export const BrowserProfileSchema = z.strictObject({ profileDir: z.string().min(1), name: z.string(), partition: BrowserPartitionSchema, importedAt: z.string() });
export type BrowserProfile = z.infer<typeof BrowserProfileSchema>;
const ProfilesFileSchema = z.strictObject({ version: z.literal(1), profiles: z.array(BrowserProfileSchema) });

// Chromium's own user agent: the platform and the Chrome version stay truthful; `Electron/<v>` and `maws/<v>` go.
export function chromeUserAgent(userAgent: string): string {
  return userAgent.replace(/\s(?:Electron|maws)\/\S+/gi, '');
}

const REFUSED_REQUEST = /^(?:file|maws-deliverable):/i;

export function preparePartition(ses: Pick<Session, 'getUserAgent' | 'setUserAgent' | 'webRequest'>): void {
  ses.setUserAgent(chromeUserAgent(ses.getUserAgent()));
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: REFUSED_REQUEST.test(details.url) }));
}

export type PreparePartition = (ses: Session, partition: string) => void;

// The partition sessions the browser has opened, each prepared once.
export class Partitions {
  private readonly opened = new Map<string, Session>();

  constructor(
    private readonly fromPartition: (partition: string) => Session,
    private readonly prepare: readonly PreparePartition[],
  ) {}

  session(partition: string): Session {
    let ses = this.opened.get(partition);
    if (!ses) {
      ses = this.fromPartition(partition);
      for (const step of this.prepare) step(ses, partition);
      this.opened.set(partition, ses);
    }
    return ses;
  }
}

export type PartitionNotice = { kind: 'profileMissing' | 'partitionFallback'; name: string };

// The partition a new tab opens in, for the Browser setting's profile (null: the default). `open` opens (and prepares)
// the partition, and throws when it cannot.
export function choosePartition(profile: string | null, profiles: readonly BrowserProfile[], open: (partition: string) => unknown): { partition: string; notice: PartitionNotice | null } {
  if (profile === null) return { partition: DEFAULT_PARTITION, notice: null };
  const listed = profiles.find((candidate) => candidate.profileDir === profile);
  if (!listed) return { partition: DEFAULT_PARTITION, notice: { kind: 'profileMissing', name: profile } };
  const partition = profilePartition(listed.profileDir);
  try {
    open(partition);
    return { partition, notice: null };
  } catch (error) {
    console.warn(`[browser] the partition ${partition} could not be opened; using the default:`, error instanceof Error ? error.message : error);
    return { partition: DEFAULT_PARTITION, notice: { kind: 'partitionFallback', name: listed.name || listed.profileDir } };
  }
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

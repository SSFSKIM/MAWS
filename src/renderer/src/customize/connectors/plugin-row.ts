// A plugin's connector's row in My items, as data and as words (UX wave U11h,
// docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, §E, §G): the line it reads in its state's place, or
// its state and Sign in, decided by what holds now (§E's table, first that holds). Pure: the row and the tests read it.
// - Three names are kept apart: `server`, the name the plugin's file gives it and the one drawn; `plugin`, the key it is
//   installed by (`<name>@<marketplace>`), which a session reports as a plugin's `source`; `name`, the engine's
//   `plugin:<manifest name>:<server>`, which a session's status lists and a sign-in is sent by.
// - The engine keeps one server of a name and says nothing, and a manifest name may hold a colon, so a session is
//   admitted only where its own reported plugin list holds exactly one possible owner of the name, the row's plugin
//   (`pluginInSession`, the services' own rule (a)). Before any session, the same prefix test over the plugins the
//   inventory keeps for the folder that the plugin list says are enabled here tells a collision.
// - Sign in is offered by row 9 alone, once the plugin list has answered (the architect's ruling of 2026-11-15): a
//   retained sign-in gives words, never the action (ruling E), and an ended one yields to a blocking line.
import type { CustomizationInventory, CustomizationPluginServer } from '@shared/ipc/schema/customization';
import { ownersOf, pluginInSession, type AddressForm, type PluginInSession, type SessionPlugin } from '@shared/plugins/plugin-connector';
import { connectorStatusWords } from '../../widgets/connector-status';
import { CONNECTORS as C } from './copy';
import { recordViewOf, signInViewOf, type AuthPosture, type SignInFacts, type SignInView } from './present';
import { signsInDynamic, type SignInRecord } from './sign-in';

export type PluginRowModel = {
  kind: 'plugin';
  key: string;
  name: string | null;
  server: string;
  plugin: string;
  pluginName: string | null;
  installScope: 'user' | 'project' | 'local';
  version: string | null;
  path: string;
  transport: string;
  address: AddressForm | null;
  sameAddressAs: string | null;
};

/** A plugin's row's identity: `connector:plugin:<plugin>:<server>` (§J). */
export const pluginRowKey = (row: Pick<CustomizationPluginServer, 'plugin' | 'server'>): string => `connector:plugin:${row.plugin}:${row.server}`;

export const pluginRowOf = (server: CustomizationPluginServer): PluginRowModel => ({ kind: 'plugin', key: pluginRowKey(server), ...server });

/** What the plugin list says of each plugin, by its key: the name its row in My items shows, and whether it is enabled
 * here. Null while the list has not answered, or its latest read failed (an older answer vouches for nothing now). */
export type PluginList = ReadonlyMap<string, { name: string; enabled: boolean }> | null;

/** A key's own name: the part before its last `@`. */
export const keyNameOf = (key: string): string => {
  const at = key.lastIndexOf('@');
  return at > 0 ? key.slice(0, at) : key;
};

/** A plugin's name as My items shows it: its row's, where the plugin list holds it, else the key's own name. */
export const pluginNameShown = (key: string, list: PluginList): string => list?.get(key)?.name ?? keyNameOf(key);

type Live = { status: string; error: string | null };

/** A ready session MAWS runs on this Mac, with what it reported: the servers its status lists, its plugin list and when. */
export interface ReportingSession {
  appSessionId: string;
  cwd: string;
  servers: ReadonlyMap<string, Live>;
  plugins: readonly SessionPlugin[];
  pluginsObservedAt: string | null;
}

/** What the page knows beside the row. */
export interface PluginRowFacts {
  sessions: readonly ReportingSession[];
  attached: string | null;
  attachedServers: ReadonlySet<string> | null; // what the attached session's status read answered; null: not answered
  attachedReadAt: number | null;
  cwd: string | null;
  list: PluginList;
  kept: NonNullable<CustomizationInventory['plugins']>; // every plugin the inventory keeps for the folder
  posture: AuthPosture | null;
  revision: string | null;
}

export interface PluginRowState {
  text: string | null;
  tone: SignInView['tone'];
  blocking: boolean; // a line of rows 1 to 4, 7, 8 or 10, shown in an ended sign-in's place
  signIn: string | null; // the session Sign in runs through (row 9, with the plugin list answered and a revision)
  openSession: boolean; // row 11
  notInAttached: boolean;
  live: SignInFacts['live']; // the admitted session's entry, and when it was read, for a success it contradicts
  liveRead: SignInFacts['liveRead'];
}

const SIGNS_IN: ReadonlySet<string> = new Set(['http', 'sse']);
// row 10's order (the architect's ruling of 2026-11-16 places `absent` after `other-version`)
const VERDICTS = ['collision', 'other-plugin', 'other-version', 'absent', 'not-reported'] as const satisfies readonly Exclude<PluginInSession, 'ok'>[];
const NOTHING = { signIn: null, openSession: false, notInAttached: false, live: undefined, liveRead: null } as const;
const line = (text: string): PluginRowState => ({ text, tone: 'muted', blocking: true, ...NOTHING });

export function pluginRowStateOf(row: PluginRowModel, facts: PluginRowFacts): PluginRowState {
  const { list, attached } = facts;
  if (row.name === null) return line(C.pluginNameUnread);
  if (row.sameAddressAs !== null) return line(C.sameAddressAs(row.sameAddressAs));
  const name = row.name;
  if (list !== null) {
    if (list.get(row.plugin)?.enabled === false) return line(C.pluginOff);
    const enabled = facts.kept.flatMap((plugin) => (plugin.pluginName !== null && list.get(plugin.plugin)?.enabled === true ? [{ name: plugin.pluginName, plugin: plugin.plugin }] : []));
    const owners = ownersOf(name, enabled);
    if (owners.length > 1) return line(C.collision(owners.map((owner) => pluginNameShown(owner.plugin, list))));
  }
  // the sessions whose status lists the name, the attached first, then the page's folder's, then by id
  const here = (session: ReportingSession) => (session.appSessionId === attached ? 0 : facts.cwd !== null && session.cwd === facts.cwd ? 1 : 2);
  const listing = facts.sessions.filter((session) => session.servers.has(name)).sort((a, b) => here(a) - here(b) || a.appSessionId.localeCompare(b.appSessionId));
  const verdictOf = (session: ReportingSession) => pluginInSession({ name, plugin: row.plugin, version: row.version }, session.plugins, session.pluginsObservedAt);
  const admitted = listing.find((session) => verdictOf(session) === 'ok') ?? null;
  // a live state only from an admitted session: a server of the name elsewhere may be another plugin's
  const live = admitted === null ? undefined : (admitted.servers.get(name) ?? null);
  const liveRead = admitted !== null && admitted.appSessionId === attached && facts.attachedReadAt !== null ? { appSessionId: admitted.appSessionId, at: facts.attachedReadAt } : null;
  const said = { ...NOTHING, live, liveRead, blocking: false };
  const words = live ? connectorStatusWords(live.status) || null : null; // the dialog's status words
  if (!SIGNS_IN.has(row.transport)) return { ...said, text: words, tone: 'muted' }; // row 5: a local command never signs in
  const state = signInViewOf({ live, liveRead, posture: facts.posture, last: null, transport: row.transport });
  if (state !== null && !state.signIn) return { ...said, text: state.text, tone: state.tone }; // row 6
  if (!signsInDynamic(name)) return line(C.nameTooLong);
  if (row.address === 'templated-origin') return line(C.addressAtStart);
  if (admitted !== null) {
    const notInAttached = facts.attachedServers !== null && !facts.attachedServers.has(name) && admitted.appSessionId !== attached;
    // while the plugin list is unknown: the admitted session's state in the dialog's words, and no Sign in
    if (list === null) return { ...said, text: words, tone: 'muted', notInAttached };
    return { ...said, text: state?.text ?? null, tone: state?.tone ?? 'muted', signIn: facts.revision === null ? null : admitted.appSessionId, notInAttached };
  }
  if (listing.length > 0) {
    // none of them admitted, so each verdict is one of row 10's
    const verdicts = listing.map((session) => ({ session, verdict: verdictOf(session) as (typeof VERDICTS)[number] }));
    const first = VERDICTS.map((verdict) => verdicts.find((v) => v.verdict === verdict)).find((v) => v !== undefined)!;
    switch (first.verdict) {
      case 'collision':
        return line(C.collision(ownersOf(name, first.session.plugins).map((owner) => (owner.source === null ? owner.name : pluginNameShown(owner.source, list)))));
      case 'other-plugin':
        return line(C.otherPlugin);
      case 'other-version':
        return line(C.otherVersion);
      case 'absent':
        return line(C.absent);
      case 'not-reported':
        return line(C.notReported);
    }
  }
  return { ...said, text: state?.text ?? null, tone: state?.tone ?? 'muted', openSession: true, notInAttached: facts.attachedServers !== null }; // row 11
}

export interface PluginRowView {
  text: string | null;
  tone: SignInView['tone'];
  cancel: boolean;
  signIn: string | null;
  openSession: boolean;
  notInAttached: boolean;
}

/** The row with its latest sign-in (ruling E): one under way shows its step and Cancel whatever the table says; an ended
 * one shows its words only while no blocking line holds; Sign in is the table's alone. */
export function pluginRowViewOf(state: PluginRowState, record: SignInRecord | null): PluginRowView {
  const { signIn, openSession, notInAttached } = state;
  const said = recordViewOf(record, state.live, state.liveRead);
  if (said !== null && (said.cancel || !state.blocking)) return { text: said.text, tone: said.tone, cancel: said.cancel, signIn, openSession, notInAttached };
  return { text: state.text, tone: state.tone, cancel: false, signIn, openSession, notInAttached };
}

/** Before a chat starts (§M3, "Before a chat starts"): the plugins' connectors the chat may load, without those the engine
 * drops for a configured server's address and those of a plugin the launch profile turns off; none while the launch
 * profile is unread, as a plugin's skill waits for it (`SkillsOnDisk`). */
export function pluginConnectorsBeforeStart(servers: CustomizationInventory['pluginServers'], pluginsOff: ReadonlySet<string> | null): CustomizationPluginServer[] {
  if (servers === undefined || pluginsOff === null) return [];
  return servers.filter((server) => server.sameAddressAs === null && !pluginsOff.has(server.plugin));
}

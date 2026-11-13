// The Share sheet's words (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b's "At its end" and
// Decisions; Q4 as O18 amended it): the general access levels and the share grades with their lines, the people list,
// the foot, Save, what the sheet says when it can't offer a change, each refusal a save can meet (in its refuser's word:
// sminos's, the endpoint's, the ledger's, step-up's, main's `POLICY_REFUSALS`), each line's outcome, and a row's mark. The
// bound lines are the spec's, character for character (its straight apostrophes kept throughout the sheet's words).
// P5 O8 M5b: and the Add owner sheet's (`OWNER`), with the endpoint's `grade` refusal both sheets can meet.
import type { OrgPolicyLine, OrgPolicyOutcome } from '@shared/ipc/schema/org';

export type ShareAccess = 'private' | 'listed' | 'org-view' | 'org-converse';
export type ShareGrade = 'list' | 'view' | 'converse' | 'approve';

/** The levels in the sheet's order, the default second. */
export const ACCESS_ORDER: readonly ShareAccess[] = ['private', 'listed', 'org-view', 'org-converse'];
/** The grades from lowest to highest. */
export const GRADE_ORDER: readonly ShareGrade[] = ['list', 'view', 'converse', 'approve'];

/** What a refusal says, `machine` the session's machine's name. */
type Said = (machine: string) => string;

/** Each refusal a read or a save can meet, by its code. */
export const REFUSALS: Readonly<Record<string, Said>> = {
  // main's POLICY_REFUSALS
  'signed-out': () => 'Sign this Mac in to the org to change who can reach this session',
  malformed: () => "This change couldn't be made as it was asked",
  empty: () => 'Nothing has changed',
  offline: (machine) => `${machine} is offline: its sessions' reach can change once it's back`,
  'not-supported': (machine) => `${machine}'s sminos can't keep a session's reach yet. Update sminos on ${machine}, then open this again.`, // board 523: the remedy, and no version (the gate is a capability)
  unavailable: () => "Its reach can't be read right now",
  'changed-elsewhere': () => 'Changed elsewhere: reload',
  cancelled: () => 'Touch ID was cancelled: nothing was changed',
  // the endpoint's and sminos's (`no-session` is both: no member places the session, or no readable record of it)
  'no-session': (machine) => `${machine} can't find this session's record`,
  'not-offered': (machine) => `${machine} doesn't take this change`,
  // the endpoint's authorization: every record act is `manage`, its owners' alone (P5 O8 M5b)
  grade: (machine) => `${machine} takes this change only from the session's owners`,
  unsupported: (machine) => `${machine} can keep a session only Listed for now`,
  'bad-shape': (machine) => `${machine}'s sminos couldn't read this change`,
  'read-only': (machine) => `${machine}'s sminos is read-only: no session's reach can change there`,
  // the ledger's
  stale: () => 'This change waited too long to be sent: save again',
  expired: (machine) => `This change expired before ${machine} ran it: save again`,
  tombstoned: (machine) => `${machine} didn't get this change, and won't run it`,
};

export const SHARE = {
  menuItem: 'Share…',
  title: 'Share',
  general: 'General access',
  access: {
    private: { label: 'Private', line: "Only its owners, and the people it's shared with, can see it or message its agent. Its agent can message only them too." },
    listed: { label: 'Listed', line: "Everyone in the org sees it listed and can message its agent. Only its owners and the people it's shared with can read it." },
    'org-view': { label: 'Org can view', line: 'Everyone in the org can read it.' },
    'org-converse': { label: 'Org can talk', line: "Everyone in the org can read it and talk to its agent. Approving stays with its owners and the people it's shared with." },
  } satisfies Record<ShareAccess, { label: string; line: string }>,
  people: 'People',
  nobody: "It isn't shared with anyone.",
  grade: {
    list: { label: 'Can message', line: "Their agents can message this session. They can't read it." },
    view: { label: 'View', line: 'They can read it.' },
    converse: { label: 'Converse', line: 'They can read it and talk to its agent.' },
    approve: { label: 'Approve', line: 'They can also answer its permission requests.' },
  } satisfies Record<ShareGrade, { label: string; line: string }>,
  gradeOf: (name: string) => `${name}'s access`,
  newGrade: 'Their access',
  remove: (name: string) => `Remove ${name}`,
  /** A person removed, shown in their place until Save. */
  removing: 'Removed when you save',
  undo: 'Undo',
  undoRemove: (name: string) => `Undo removing ${name}`,
  addPerson: 'Add person',
  choose: 'Choose a person',
  add: 'Add',
  nobodyToAdd: 'Everyone in the org already has access.',
  noMembers: "The org's people can't be listed right now.",
  foot: 'What was already shared stays shared.',
  save: 'Save',
  saving: 'Saving…',
  close: 'Close',
  reload: 'Reload',
  reading: 'Reading its reach…',
  unsupported: REFUSALS['not-supported'],
  unavailable: REFUSALS.unavailable(''),
  changedElsewhere: REFUSALS['changed-elsewhere'](''),
  alsoElsewhere: 'also changed elsewhere',
  /** An unknown refusal: one line naming the machine, its raw word shown beside it. */
  refused: (machine: string) => `${machine} refused this`,
  failed: (machine: string) => `${machine} tried this and it failed`,
  unknown: {
    malformed: (machine: string) => `${machine} said this ran, but not what it changed: its outcome is unknown`,
    other: (machine: string) => `${machine} didn't say whether this ran: its outcome is unknown`,
  },
  stopped: "The lines after it weren't sent. Reload to see its reach as it stands.",
  notSent: 'Not sent',
  saved: 'Saved',
  noChange: 'Already so',
  results: 'What the save did',
  owner: 'owner',
  you: 'you',
  mark: { private: 'Private', shared: 'Shared' },
  /** The hover card's line. */
  reach: (access: ShareAccess, shares: number) => (shares === 0 ? SHARE.access[access].label : `${SHARE.access[access].label} · shared with ${shares === 1 ? '1 person' : `${shares} people`}`),
  sharedWithYou: 'Private · shared with you',
};

/** board 523: the Share and Add owner subtitle's tooltip, the session's whole title and its machine's whole name (the line cuts both). */
export const subtitleTooltip = (title: string, machine: string): string => [title, machine].filter((part) => part !== '').join(' · ');

/** A refusal's words: a known code's own line, or the generic line with its raw word to show beside it. */
export function refusalWords(reason: string, machine: string): { text: string; raw: string | null } {
  const known = Object.hasOwn(REFUSALS, reason) ? REFUSALS[reason] : undefined;
  return known === undefined ? { text: SHARE.refused(machine), raw: reason } : { text: known(machine), raw: null };
}

/** A save's line as the sheet showed it, `nameOf` a member's name. */
export function lineWords(line: OrgPolicyLine, nameOf: (member: string) => string): string {
  if (line.kind === 'access') return `${SHARE.general}: ${SHARE.access[line.access].label}`;
  if (line.kind === 'owner') return `${nameOf(line.member)}: ${SHARE.owner}`;
  return `${nameOf(line.member)}: ${line.grade === null ? 'removed' : SHARE.grade[line.grade].label}`;
}

/** What became of a line: its words, the raw word of an unknown reason, and whether it stopped the save unknown. */
export function outcomeWords(outcome: OrgPolicyOutcome, machine: string): { text: string; raw: string | null } {
  switch (outcome.state) {
    case 'done':
      return { text: outcome.changed ? (outcome.elsewhere ? `${SHARE.saved}, ${SHARE.alsoElsewhere}` : SHARE.saved) : outcome.elsewhere ? `${SHARE.noChange}, ${SHARE.alsoElsewhere}` : SHARE.noChange, raw: null };
    case 'refused':
      return refusalWords(outcome.reason, machine);
    case 'failed':
      return { text: SHARE.failed(machine), raw: outcome.reason };
    case 'unknown':
      return outcome.reason === 'malformed' ? { text: SHARE.unknown.malformed(machine), raw: null } : { text: SHARE.unknown.other(machine), raw: outcome.reason };
    case 'not-sent':
      return { text: SHARE.notSent, raw: null };
  }
}

/**
 * The Add owner sheet's words (P5 O8 M5b, sessions/share/AddOwnerSheet.tsx). What it can't offer, its reload and its close
 * are Share's (`SHARE`), as are the refusals.
 */
export const OWNER = {
  menuItem: 'Add owner…',
  title: 'Add owner',
  line: "An owner can do everything you can with this session, including changing who can reach it and adding owners. MAWS can't remove an owner.",
  person: 'Person',
  choose: SHARE.choose,
  nobodyToAdd: 'Everyone in the org already owns it.',
  noMembers: SHARE.noMembers,
  add: 'Add owner',
  adding: 'Adding…',
  added: 'Added as an owner',
  already: 'Already an owner',
  /** After an add: the row's owners come from the session's next listing, not from the sheet. */
  relisted: (machine: string) => `Its row names them once ${machine} lists the session again.`,
};

/** What became of an owner added: Share's words for a line, but a `done` reads added, or already an owner for a no-op. */
export function ownerOutcomeWords(outcome: OrgPolicyOutcome, machine: string): { text: string; raw: string | null } {
  if (outcome.state === 'done') return { text: outcome.changed ? OWNER.added : OWNER.already, raw: null };
  return outcomeWords(outcome, machine);
}

const CANT_TALK = 'you can read this session but not talk to its agent';
/** People in the order given, the last after "or": "Ana", "Ana or Ben", "Ana, Ben or Chen". */
const either = (names: readonly string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`);

/**
 * Board 525: the reader's side of a session another member owns (sessions/share/reader.ts). A listing never says what the
 * reader holds there: the machine refuses a read below View and a send below Converse, and these say so with whom to ask
 * (the session's owners by name; "its owner" when the head names none), in the grades' own labels. A prompt there is its
 * owners' unless this app sent it, since no prompt carries its author.
 */
export const READER = {
  cantRead: "Your agents can message this session. You can't read it.",
  askForView: (whom: string) => `Ask ${whom} for ${SHARE.grade.view.label} to read it.`,
  cantTalk: (whom: string) => `${CANT_TALK.charAt(0).toUpperCase()}${CANT_TALK.slice(1)}. Ask ${whom} for ${SHARE.grade.converse.label}.`,
  notSent: (whom: string) => `Not sent: ${CANT_TALK}. Ask ${whom} for ${SHARE.grade.converse.label}.`,
  whom: (names: readonly string[]) => (names.length === 0 ? 'its owner' : either(names)),
  author: (names: readonly string[]) => (names.length === 0 ? 'Its owner' : either(names)),
  message: (author: string) => `${author}'s message`,
};

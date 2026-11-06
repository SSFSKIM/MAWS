// The project channel's words (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's "At its end";
// Q5): the tab's title, the stream's folded rows and labels, the composer and its refusals, and what the tab says when it
// can't draw live.
import type { ChannelSendResult } from '@shared/ipc/schema/org';

type Refusal = Extract<ChannelSendResult, { ok: false }>;

export const CHANNEL = {
  title: (project: string | null) => (project === null ? 'Channel' : `${project} · channel`),
  menuItem: 'Channel',
  you: 'You',
  everyone: 'everyone',
  someone: (member: string) => `member ${member.slice(0, 8)}`,
  to: 'to',
  exchange: (count: number) => `${count} messages between`,
  broadcast: (count: number) => `${count} messages from`,
  toEveryone: 'to everyone',
  and: 'and',
  collapse: 'Hide messages',
  migrated: (by: string) => `attested at migration by ${by}`,
  legacy: 'unverified (from before the move)',
  host: { message: 'to you', question: 'asks', answered: 'was answered' } as const,
  unverified: (count: number) => (count === 1 ? '1 event didn’t verify' : `${count} events didn’t verify`),
  empty: 'Nothing in this channel yet.',
  opening: 'Reading the channel…',
  failed: 'Couldn’t open the channel.',
  retry: 'Retry',
  closed: {
    'signed-out': 'Sign this Mac in to the org to read its project channels.',
    'no-hub': 'This Mac isn’t connected to the hub, and has no copy of this channel yet.',
    'unknown-project': 'The hub holds no channel for this project.',
  } as const,
  waiting: 'Waiting on you',
  sending: 'sending',
  notSent: 'Not sent',
  refused: (reason: string) => (reason === 'not-reachable' ? 'Not reachable' : reason === 'context-changed' ? 'Not sent: another sign-in took over' : `Not sent · ${reason}`),
  asOf: (time: string) => `As of ${time}`,
  offline: {
    connecting: 'Connecting to the hub…',
    expired: 'The hub sign-in has ended.',
    denied: 'The hub no longer admits you.',
    unreachable: 'Hub unreachable',
    signedOut: 'Signed out',
  } as const,
  signInAgain: 'Sign in to the hub again',
  signInFailed: (code: string) => `Couldn’t sign in · ${code}`,
  composer: {
    label: 'Message the project',
    placeholder: 'Message everyone, or start with @alias to address a session',
    send: 'Send',
    sending: 'Sending…',
  },
  sendRefused(refusal: Refusal): string {
    switch (refusal.reason) {
      case 'no-member':
        return `No session here answers to ${refusal.detail ?? 'that name'}`;
      case 'ambiguous':
        return `${refusal.detail ?? 'That name'} names more than one session: add its #id`;
      case 'empty':
        return 'Nothing to send';
      case 'signed-out':
        return 'Signed out: nothing was sent';
      case 'no-hub':
        return 'Not connected to the hub: nothing was sent';
      case 'context-changed':
        return 'Another sign-in took over: nothing was sent';
      case 'not-open':
      case 'unreadable':
        return 'This channel can’t take words now';
    }
  },
  sendFailed: 'Couldn’t send',
} as const;

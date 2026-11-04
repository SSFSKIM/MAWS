// A send's uploads, read into it before the engine host sees it (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// M8 "The attachment", Interfaces §U; behind `rl2.upload-blocks`). A remote device sends a PDF up to the session's upload
// root (`files.upload`) and names it in `session.send`'s `uploads`, since the engine attaches nothing of an `@` mention of
// a PDF in a stream-json frame (m8-1's probe). The machine's files service reads each one (`files.readUploads`: the
// sending session's own root alone, no link on the way, still there, within the day, a PDF within the engine's bound),
// and the send goes on with the blocks in its `content` and no `uploads`: what the engine host's queue keeps is the
// blocks themselves, so a queued send outlives the upload's sweep and a restart. The blocks go where a local drop puts a
// document: after the images the message carries, before its text. A refusal of the service's, or a content the blocks
// take past the engine's bounds (`sendContentRefusal`), is the act's `malformed`, its reason the machine's log line; a
// service that can't be asked is `unavailable`. Nothing is queued either way.
import { sendContentRefusal } from '@shared/engine/session-state-store';
import type { EndpointServices } from './services';

type Block = { type: string; [key: string]: unknown };
export type ReadUploads = { ok: true; args: unknown } | { ok: false; reason: 'malformed' | 'unavailable'; why: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const ATTACHED = new Set(['image', 'document']);

/** The content with `blocks` after its leading attachments and before the rest (its text), as a local send orders them. */
function withDocuments(content: unknown, blocks: Block[]): Block[] {
  if (typeof content === 'string') return content.trim() === '' ? blocks : [...blocks, { type: 'text', text: content }];
  const given = Array.isArray(content) ? (content as Block[]) : [];
  const at = given.findIndex((block) => !ATTACHED.has(block.type));
  const lead = at === -1 ? given.length : at;
  return [...given.slice(0, lead), ...blocks, ...given.slice(lead)];
}

/**
 * `session.send`'s args with its uploads read into its content, for the session the act was placed on; args with no
 * uploads unchanged.
 */
export async function readSendUploads(args: unknown, appSessionId: string, dispatch: EndpointServices['dispatch']): Promise<ReadUploads> {
  if (!isObject(args) || args.uploads === undefined) return { ok: true, args };
  const { uploads, ...rest } = args;
  const answer = await dispatch('machine', 'files.readUploads', { appSessionId, uploads });
  if (!answer.ok) return { ok: false, reason: 'unavailable', why: `its uploads could not be read: ${answer.error.message}` };
  const value = answer.value as { status: 'ok'; blocks: Block[] } | { status: 'refused'; reason: string };
  if (value.status !== 'ok') return { ok: false, reason: 'malformed', why: value.reason };
  const content = withDocuments(rest.content, value.blocks);
  const refusal = sendContentRefusal(content);
  if (refusal !== null) return { ok: false, reason: 'malformed', why: `with its uploads, ${refusal.message}` };
  return { ok: true, args: { ...rest, content } };
}

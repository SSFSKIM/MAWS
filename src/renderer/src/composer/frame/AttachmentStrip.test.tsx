// The attachment strip (C7) and, P5 O7 M4, a file bound for another machine's session: its tile names its kind by its
// extension, and while its send's uploads run it says how far its parts have gone (main's `remote.upload`).
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Attachment } from '../editor/doc';
import { resetRemoteUploads, useRemoteUploads } from '../editor/remote-uploads';
import { AttachmentStrip } from './AttachmentStrip';

afterEach(() => {
  cleanup();
  resetRemoteUploads();
});

const notes: Attachment = { id: 'f1', kind: 'file', name: 'notes.txt', mediaType: 'text/plain', bytes: 3, data: 'aGkK', persisted: true };
const archive: Attachment = { id: 'f2', kind: 'file', name: 'Makefile', mediaType: '', bytes: 3, data: 'aGkK', persisted: true };
const pdf: Attachment = { id: 'f3', kind: 'document', name: 'spec.pdf', mediaType: 'application/pdf', bytes: 3, data: 'JVBE', persisted: true };

describe('the attachment strip', () => {
  it('labels a file by its extension, FILE without one, and a PDF as PDF', () => {
    render(<AttachmentStrip attachments={[notes, archive, pdf]} onRemove={() => {}} />);
    const tiles = within(screen.getByRole('list', { name: 'attachments' })).getAllByRole('listitem');
    expect(tiles.map((tile) => tile.querySelector('[data-attachment-kind]')?.textContent)).toEqual(['TXT', 'FILE', 'PDF']);
  });

  it('says a file waiting its turn, then its parts as they go up, and nothing once its send’s uploads end', () => {
    render(<AttachmentStrip attachments={[notes, pdf]} onRemove={() => {}} />);
    act(() => useRemoteUploads.setState({ progress: new Map([['f1', { sent: 1, parts: 3 }], ['f3', null]]) }));
    expect(screen.getByRole('status', { name: 'notes.txt upload' }).textContent).toBe('Uploading 1 of 3');
    expect(screen.getByRole('status', { name: 'spec.pdf upload' }).textContent).toBe('Waiting to upload');
    act(() => useRemoteUploads.setState({ progress: new Map() }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

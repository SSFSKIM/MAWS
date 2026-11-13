// The file a file prompt's diff is drawn against (UX wave U1a, §I), read once per request and path through `files.read`
// on the session, so from the machine the session is on; authorisation is the files service's own, where the read runs.
// The read never holds the card: until it answers, and when it fails, the answer is null and the card shows the input
// alone. Only a missing file inside the session's folders (`not found: …`, the files service's words, which the machine
// link carries unchanged) is 'missing'; a file past one read's default length (1 MiB) or not text is null.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import type { ProposedFile } from './proposed';

export function fileOf(result: CommandResult<'files.read'>): ProposedFile {
  if (result.ok) return result.value.encoding === 'utf8' && !result.value.truncated ? { text: result.value.content } : null;
  return result.error.message.startsWith('not found:') ? 'missing' : null;
}

// `request` names the request the read is made for: an answer lands only on the read of that request and path, in the
// effect that made it. `answered`: once the card has sent an answer, a late read lands nowhere, so what was approved
// stays drawn as it was when the person answered.
export function useProposedFile(appSessionId: AppSessionId, request: string, path: string | null, answered: boolean): ProposedFile {
  const [read, setRead] = useState<{ key: string; file: ProposedFile } | null>(null);
  const late = useRef(answered);
  useLayoutEffect(() => {
    late.current = answered;
  });
  const key = path === null ? null : `${request}\u0000${path}`;
  useEffect(() => {
    if (key === null || path === null) return;
    let current = true;
    const land = (file: ProposedFile) => {
      if (current && !late.current) setRead({ key, file });
    };
    void ipc.invoke('files.read', { appSessionId, path }).then(
      (result) => land(fileOf(result)),
      () => land(null),
    );
    return () => {
      current = false;
    };
  }, [appSessionId, key, path]);
  return read !== null && read.key === key ? read.file : null;
}

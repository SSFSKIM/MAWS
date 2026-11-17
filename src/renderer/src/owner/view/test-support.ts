// Shared by the suites that read what the session view draws (not a test file itself): a store entry's rows as the
// view draws them with the lane on, mirrored while the to-human view is in force there (`mirrorsView`), as
// `Transcript` composes them with no tail.
import type { TranscriptEntry } from '../../stores/transcript';
import type { Row } from '../../transcript/model/rows';
import { liveMarkedRowIds, mirrorRows, mirrorsView } from './mirror';

export const viewRowsOf = (entry: TranscriptEntry): Row[] =>
  mirrorsView(entry.state.ui) ? mirrorRows(entry.rows, entry.state.ui, liveMarkedRowIds(entry.state)) : entry.rows;

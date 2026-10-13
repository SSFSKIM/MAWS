# File: format reference

Any file on disk, referenced in place by its path. MAWS records the path and the file's name, size and content hash at delivery, and never writes to the file.

## Structure

One file per artifact, delivered once: each `send_file` of a path delivers a new File artifact, and the earlier ones keep pointing at the same path.

## Limits

None beyond the file system's. `artifact_read` returns text only for text files under 1 MiB.

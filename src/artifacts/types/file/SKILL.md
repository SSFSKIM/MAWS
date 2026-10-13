# File: guide

A file you hand to the user as it is: a PDF, an image, a spreadsheet, an archive, any file on disk.

## When to use this kind

Use it to deliver a file you produced with other tools. MAWS does not edit a file's content; for content you and the user work on inside MAWS, create an `html`, `document` or `presentation` artifact instead.

## Creating one

Call `send_file` with the files' paths (absolute or relative to the working directory) and an optional caption. Each file becomes a File artifact linked to this session, shown in the transcript with buttons to open it or reveal it in Finder. The file stays where it is: MAWS references it in place and does not copy it, so moving or deleting it breaks the artifact.

## Reading and editing

`artifact_read` returns a File artifact's name, path, size and content hash, whether the file is still there, and its text when it is a UTF-8 text file under 1 MiB. A File artifact is not published to: to deliver a changed file, write it and call `send_file` again, which delivers it as a new File artifact. `artifact_create` with `kind: "file"`, a `path` and a `title` delivers one file the same way, with a title of your choosing.

## Before you finish

Tell the user what the file is for in the caption; they see it beside the file.

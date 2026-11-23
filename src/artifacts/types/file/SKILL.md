# File: guide

A file on disk that the user's Library keeps as it is: a PDF, an image, a spreadsheet, an archive, any file.

## When to use this kind

To show the user a file, you need no artifact: write a Markdown link to its absolute path in your message, [its name](/absolute/path). A click opens it beside the chat, and ⌘-click opens it in the main area. Make a File artifact only when the file should also stay in the Library, linked to this session. MAWS does not edit a file's content; for content you and the user work on inside MAWS, create an `html`, `document` or `presentation` artifact instead.

## Creating one

Call `artifact_create` with `kind: "file"`, the file's `path` (absolute or relative to the working directory) and a `title`. The file stays where it is: MAWS references it in place and does not copy it, so moving or deleting it breaks the artifact.

## Reading and editing

`artifact_read` returns a File artifact's name, path, size and content hash, whether the file is still there, and its text when it is a UTF-8 text file under 1 MiB. A File artifact is not published to: change the file with your own tools, and link it again in your message.

## Before you finish

Link the file by its path in your message and say what it is for.

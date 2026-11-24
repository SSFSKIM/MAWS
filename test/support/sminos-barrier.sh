#!/bin/sh
# The barrier in front of the real `sminos`, for the question sheet's live gate (docs/doperpowers/plans/
# 2026-11-23-question-sheet-c3-maws-app.md §E, M6 step 8). Named in MAWS_SMINOS_CLI, it runs the `sminos` that
# SMINOS_REAL names with its own arguments and standard input. With SMINOS_BARRIER set, a `sheet put` first waits until
# that file exists, so two windows' Sends are both in flight before either reaches the real door; the locator's probe
# (`sheet show`) is never held, or the door would read as unavailable before any Send.
if [ -n "$SMINOS_BARRIER" ] && [ "$1" = sheet ] && [ "$2" = put ]; then
  while [ ! -e "$SMINOS_BARRIER" ]; do sleep 0.05; done
fi
exec "$SMINOS_REAL" "$@"

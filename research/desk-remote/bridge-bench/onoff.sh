#!/bin/bash
# Alternating hooks-on / hooks-off sessions, same prompt, thinking off.
cd /private/tmp/bridge-bench
export PYTHONDONTWRITEBYTECODE=1
for i in 1 2 3 4; do
  python3 live_headless.py --tag ON$i --hooks 1 --prompts 3 --env CLAUDE_CODE_DISABLE_THINKING=1 2>&1 | grep -v "^  cleanup" 
  python3 live_headless.py --tag OFF$i --hooks 0 --prompts 3 --env CLAUDE_CODE_DISABLE_THINKING=1 2>&1 | grep -v "^  cleanup"
done

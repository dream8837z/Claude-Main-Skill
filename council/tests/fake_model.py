#!/usr/bin/env python3
"""Fake CLI for offline tests: answers deterministically based on the prompt type."""
import sys
name = sys.argv[1]
prompt = sys.argv[2] if len(sys.argv) > 2 else sys.stdin.read()
if "RANKING:" in prompt:
    print("RANKING: C, B, A")
elif "Revised answer" in prompt:
    print(f"## Critique\npeer ok\n## Revised answer\n{name} revised (saw {prompt.count('### Answer')} peers)")
elif "final editor" in prompt:
    print(f"FINAL by {name}\n## Remaining disagreements\nNone")
else:
    print(f"{name} draft")

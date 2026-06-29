#!/usr/bin/env python3
"""
watch_bridge.py — keep Claude Code awake, watching BRIDGE.md.

Replaces the old PowerShell watcher (watch_bridge.ps1), which didn't work.

How Claude Code uses this:
    python scripts/watch_bridge.py

The command BLOCKS (stays awake) and does nothing until BRIDGE.md changes on
disk. The moment Cowork writes/edits a task, it prints every [PENDING] task
block it finds and exits 0. Claude Code then implements those tasks, updates
each status to [DONE]/[FAILED], commits if required, and re-runs this command
to wait for the next change.

Stop it any time with Ctrl+C.

Stdlib only — no pip install needed. Works on Windows, macOS, Linux.
"""

import hashlib
import re
import sys
import time
from pathlib import Path

# BRIDGE.md sits at the project root, one level up from scripts/
BRIDGE = Path(__file__).resolve().parent.parent / "BRIDGE.md"
POLL_SECONDS = 3


def file_hash(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError:
        return None


def extract_pending(text: str) -> list[str]:
    """Return each '### [PENDING] ...' block (header through to the next '###' or EOF)."""
    blocks = []
    matches = list(re.finditer(r"^### \[PENDING\].*$", text, flags=re.MULTILINE))
    for m in matches:
        start = m.start()
        nxt = re.search(r"^### ", text[m.end():], flags=re.MULTILINE)
        end = m.end() + nxt.start() if nxt else len(text)
        blocks.append(text[start:end].strip())
    return blocks


def main() -> int:
    if not BRIDGE.exists():
        print(f"[watch_bridge] ERROR: {BRIDGE} not found.", file=sys.stderr)
        return 1

    print(f"[watch_bridge] Awake. Watching {BRIDGE.name} (every {POLL_SECONDS}s).")
    print("[watch_bridge] Will print PENDING tasks and exit the moment it changes. Ctrl+C to stop.")

    last = file_hash(BRIDGE)
    try:
        while True:
            time.sleep(POLL_SECONDS)
            current = file_hash(BRIDGE)
            if current is None:
                # File momentarily missing (mid-write); keep waiting.
                continue
            if current != last:
                print("\n[watch_bridge] BRIDGE.md changed — checking for PENDING tasks...\n")
                pending = extract_pending(BRIDGE.read_text(encoding="utf-8", errors="replace"))
                if pending:
                    print(f"[watch_bridge] {len(pending)} PENDING task(s) found:\n")
                    print(("\n\n" + "-" * 60 + "\n\n").join(pending))
                    print("\n[watch_bridge] Implement the above, update each status, commit if required,")
                    print("[watch_bridge] then re-run:  python scripts/watch_bridge.py")
                else:
                    print("[watch_bridge] Changed, but no [PENDING] tasks right now. Re-run to keep watching.")
                return 0
    except KeyboardInterrupt:
        print("\n[watch_bridge] Stopped.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

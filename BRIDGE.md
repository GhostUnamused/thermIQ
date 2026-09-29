# ThermIQ — Cowork ↔ Claude Code Bridge

> **Protocol:** Cowork writes PENDING tasks here. CC reads this file on startup (or when the watcher triggers), implements each PENDING task in order, then updates status. When a task is DONE, CC appends a compact 3-line summary to LOG.md and removes (or strikes) the task from this file.
>
> **Watcher:** `python scripts/watch_bridge.py` — polls every 3s, prints all `[PENDING]` task blocks and exits when BRIDGE.md changes. CC re-runs it after completing each task to wait for the next.
>
> **Completed task history:** See [LOG.md](LOG.md) — compact 3-line entries per task, not loaded by CC on startup.

---

**Queue status:** 0 `[PENDING]` tasks. All completed tasks (through task-067) are archived in [LOG.md](LOG.md).

---

## Active Queue

(none)

---

### Task format (Cowork uses this when writing new tasks)

```
### [PENDING] task-XXX | YYYY-MM-DDTHH:MM:SSZ
**From:** Cowork
**Task:** Short description
**Files changed by Cowork:** list any files already edited (CC should not re-edit unless instructed)
**CC must do:**
- step 1
- step 2
**Notes:** any context
```

Status markers: `[PENDING]` → `[IN_PROGRESS]` → `[DONE]` (then move to LOG.md) | `[FAILED: reason]` | `[COWORK_NOTE]`

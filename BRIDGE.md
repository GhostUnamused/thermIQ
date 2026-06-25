# ThermIQ — Cowork ↔ Claude Code Bridge

> **Protocol:** Cowork writes PENDING tasks here. Claude Code reads this file on startup (or when the watcher triggers), implements each PENDING task in order, then updates the status. Neither side deletes entries — append only.
>
> **Watcher:** Run `scripts/watch_bridge.ps1` in a PowerShell terminal to auto-trigger CC on every Cowork update.

---

## Queue

### [DONE] task-001 | 2026-06-25T00:00:00Z
**From:** Cowork
**Task:** Commit and deploy immediate bug fixes (markdown rendering + answer length)
**Files changed by Cowork:**
- `docs/index.html` — added marked.js CDN script tag
- `docs/app.js` — changed `answerText.textContent` to `answerText.innerHTML = marked.parse(data.answer)`
- `netlify/functions/query.js` — added "Keep every answer under 250 words" + formatting instructions to SYSTEM_INSTRUCTION
- `CLAUDE.md` — created (project instructions + bridge protocol)
- `BRIDGE.md` — created (this file)
- `scripts/watch_bridge.ps1` — created (file watcher)

**CC must do:**
- `git add -A`
- `git commit -m "fix: markdown rendering, answer length limit, bridge setup"`
- `git push origin main`

**Notes:** Frontend change deploys via GitHub Actions to GitHub Pages. Backend change (query.js) deploys via Netlify auto-deploy. Both should be live within ~2 minutes of push.

**CC summary:** Verified all 3 diffs matched the description, committed and pushed all 6 files (`git add -A`, single commit, push to main). Heads-up: `marked.parse(data.answer)` rendered via `innerHTML` has no sanitization step — if the RAG context ever lets an LLM answer contain attacker-influenced markup (e.g. via a poisoned ingested document), this is an XSS vector. Worth adding DOMPurify before shipping wider.

---

## Completed Log

<!-- Older DONE/FAILED tasks accumulate here for audit trail -->

---

*Bridge initialized by Cowork on 2026-06-25.*

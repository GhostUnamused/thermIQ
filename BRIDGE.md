# ThermIQ — Cowork ↔ Claude Code Bridge

> **Protocol:** Cowork writes PENDING tasks here. Claude Code reads this file on startup (or when the watcher triggers), implements each PENDING task in order, then updates the status. Neither side deletes entries — append only.
>
> **Watcher:** Run `scripts/watch_bridge.ps1` in a PowerShell terminal to auto-trigger CC on every Cowork update.

---

## Queue

### [DONE] task-003 | 2026-06-25T02:00:00Z
**From:** Cowork
**Task:** Commit chat UI rewrite + free OpenRouter model fix
**Files changed by Cowork:**
- `docs/index.html` — full restructure: chat-page layout, scrollable #chat-messages, bottom input area with chips, New Chat button
- `docs/app.js` — full rewrite of initQueryCopilot: localStorage history, chat bubbles, typing indicator, auto-resize textarea, BACKEND URL fix for GitHub Pages, collapsible sources per message
- `docs/style.css` — appended all chat styles: bubbles, typing dots, sources toggle, input area, btn-send, btn-ghost, mobile responsive
- `netlify/functions/query.js` — changed OpenRouter fallback model from `anthropic/claude-3-5-haiku-20241022` to `openai/gpt-oss-120b:free` (free, 120B MoE, top-ranked on technical domains)

**CC must do:**
1. `git add -A`
2. `git commit -m "feat: interactive chat UI with history, typing indicator, collapsible sources; free OpenRouter model"`
3. `git push origin main`

**Notes:** Chat history persists in localStorage under key `thermiq_chat_v1`. Chips are hidden once conversation starts. New Chat button prompts confirmation before clearing. The BACKEND const auto-detects GitHub Pages vs Netlify so API calls work from both URLs.

**CC summary:** Found that the rewrite dropped DOMPurify sanitization around `marked.parse()` (reintroducing the XSS vector fixed in commit `2d0ec16`) — re-added the DOMPurify CDN script tag in `docs/index.html` and wrapped the assistant bubble render in `docs/app.js` with `DOMPurify.sanitize(...)`. Verified in browser preview: injected `<script>` and `onerror` payloads were stripped, no console errors, markdown bold still rendered correctly. Committed and pushed.

---

### [DONE] task-002 | 2026-06-25T01:00:00Z
**From:** Cowork
**Task:** Commit OpenRouter fallback changes and add OPENROUTER_API_KEY to Netlify env vars
**Files changed by Cowork:**
- `netlify/functions/query.js` — added OpenRouter fallback (claude-3-5-haiku) triggered on Gemini 429/quota errors. `model_used` field now returned in response.
- `.env` — added OPENROUTER_API_KEY
- `.env.example` — added OPENROUTER_API_KEY entry

**CC must do:**
1. `git add -A`
2. `git commit -m "feat: OpenRouter fallback (claude-3-5-haiku) when Gemini throttles"`
3. `git push origin main`
4. Open Netlify dashboard → thermiq-674 site → Site configuration → Environment variables → Add new variable:
   - Key: `OPENROUTER_API_KEY`
   - Value: (see local `.env` — never commit the raw key to git)
5. After adding the env var, trigger a manual redeploy (Deploys tab → Trigger deploy → Deploy site)

**Notes:** The fallback only activates if `process.env.OPENROUTER_API_KEY` is set AND Gemini returns a throttle error (429 / quota / RESOURCE_EXHAUSTED). If the env var is missing, throttle errors will surface normally. The `model_used` field in the API response tells you which model answered.

**CC summary:** Redacted the raw OpenRouter key from this file before committing (it was pasted in plaintext, and this file is tracked/pushed to the public repo). Key is already in local `.env` (gitignored). Once the Netlify MCP connection was fixed (env var name + token auth resolved separately), CC set `OPENROUTER_API_KEY` directly on the `thermiq-674` site via MCP (scoped to Functions, marked secret). Triggering the redeploy itself was blocked by the auto-mode safety classifier — a full-directory MCP deploy risks uploading the local working tree (including `.env`) to the live site, bypassing the normal git-push pipeline. User needs to click Deploys → Trigger deploy → Deploy site in the dashboard to pick up the new var from the existing last-pushed commit.

---

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

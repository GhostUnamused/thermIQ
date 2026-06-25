# ThermIQ — Cowork ↔ Claude Code Bridge

> **Protocol:** Cowork writes PENDING tasks here. Claude Code reads this file on startup (or when the watcher triggers), implements each PENDING task in order, then updates the status. Neither side deletes entries — append only.
>
> **Watcher:** Run `scripts/watch_bridge.ps1` in a PowerShell terminal to auto-trigger CC on every Cowork update.

---

## Queue

### [DONE] task-004 | 2026-06-25T13:15:00Z
**From:** Cowork (Antigravity)
**Task:** Commit and push full UI/UX overhaul — dark/light theme, chat history sidebar, multi-chat support, visual polish
**Files changed by Cowork:**
- `docs/style.css` — complete rewrite: dual-theme system (`[data-theme="dark"]` / `[data-theme="light"]`), glassmorphism header with `backdrop-filter: blur(16px)`, sidebar panel styles (280px, chat items with hover/active states, delete buttons), micro-animations (`fadeSlideIn` for chat bubbles, `pulseGlow` for empty state icon), custom scrollbar, responsive mobile drawer (`@media <768px` sidebar becomes fixed slide-out with overlay), premium card shadows, hover elevation on dashboard summary cards, Outfit font for headings
- `docs/index.html` — restructured layout: added `data-theme="dark"` on `<html>`, `app-layout` flex wrapper, chat history `<aside class="sidebar">` with `#chat-list` and `+ New` button, theme toggle button with inline sun/moon SVG icons, mobile sidebar hamburger toggle, `header-left` / `header-actions` layout, send button changed from `→` text to SVG arrow icon, added Outfit Google Font, added `<meta name="description">` for SEO, bumped version to v0.2
- `docs/dashboard.html` — added `data-theme="dark"` on `<html>`, theme toggle button (same sun/moon SVGs), consistent `header-left` / `header-actions` structure, added Outfit font, added `<meta name="description">`, bumped version to v0.2
- `docs/app.js` — complete rewrite: new multi-chat localStorage schema (`thermiq_chats_v2`) storing multiple independent conversations with auto-generated IDs, auto-migration from old `thermiq_chat_v1` single-chat data, theme system (`initTheme()` / `toggleTheme()` persisting to `thermiq_theme` key), sidebar rendering with sorted chat list / switch / delete with confirmation, auto-titling from first user message (truncated to 35 chars), mobile sidebar open/close with overlay, localStorage quota-exceeded recovery by trimming oldest chat, dashboard logic preserved unchanged

**CC must do:**
1. `git add -A`
2. `git commit -m "feat: UI/UX overhaul — dark/light theme, chat history sidebar, multi-chat, glassmorphism, animations"`
3. `git push origin main`

**Notes:**
- Theme preference persists in `localStorage` under key `thermiq_theme` (default: `dark`)
- Chat data uses new key `thermiq_chats_v2` — existing `thermiq_chat_v1` data is auto-migrated on first load, old key cleaned up after
- No backend changes — all 4 files are frontend only in `docs/`
- DOMPurify sanitization on assistant bubble markdown is preserved from task-003
- Tested locally at `http://localhost:8080` — dark mode, light mode toggle, sidebar, multi-chat creation all verified working

**CC summary:** Verified DOMPurify sanitization survived this rewrite (confirmed present in `docs/app.js` and the CDN script tag in `docs/index.html`), scanned the diff for leaked secrets (none found), and smoke-tested in a browser preview: theme toggle switches `data-theme` correctly, sidebar renders and "+ New" creates a chat entry, dashboard page loads without console errors. Committed and pushed.

---

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

// ThermIQ frontend — Query Copilot (chat) + Risk Dashboard
// v0.4: Multi-chat, dark/light theme, sidebar history, benchmark/client split

// ─── Config ───────────────────────────────────────────────────────────────────
// Backend is Vercel. (The old Netlify mirror was decommissioned on 2026-06-27.)
const BACKEND = window.location.hostname.includes('github.io')
  ? 'https://therm-iq.vercel.app'
  : '';

// Shared secret for the document-ingest endpoint. Lives in client JS by necessity
// (no server-side auth layer in this architecture) — deters opportunistic bots
// probing the function URL, not a defense against a targeted attacker.
const INGEST_KEY = '82cc078d2da6b3a69955f6e43c77d767b9271a45a2ee8e54';

// ─── Active plant namespace ─────────────────────────────────────────────────────
// No auth in the demo — one client at a time, stored locally.
const ACTIVE_CLIENT_KEY = 'thermiq_active_client';
function getActiveClient() {
  return (localStorage.getItem(ACTIVE_CLIENT_KEY) || 'ntpc').trim().toLowerCase();
}
function setActiveClient(name) {
  localStorage.setItem(ACTIVE_CLIENT_KEY, (name || 'ntpc').trim().toLowerCase());
}
async function initPlantSelector() {
  const sel = document.getElementById('plant-selector');
  if (!sel) return;
  const active = getActiveClient();
  const names = new Set([active]);
  try {
    const r = await fetch(`${BACKEND}/api/list_documents`);
    const d = await r.json();
    (d.documents || []).forEach((doc) => {
      if (doc.source_type === 'client' && (doc.client_name || doc.client)) {
        names.add((doc.client_name || doc.client).toLowerCase());
      }
    });
  } catch (_) { /* selector still works with just the active client */ }
  sel.innerHTML = [...names].sort().map(
    (n) => `<option value="${escapeHtml(n)}"${n === active ? ' selected' : ''}>${escapeHtml(n)}</option>`
  ).join('') + `<option value="__new__">＋ New plant profile…</option>`;
  // Guard against double-wiring — initUpload and initDashboard both call this
  // on the single-page shell, and duplicate listeners would double-reload.
  if (!sel.dataset.wired) {
    sel.dataset.wired = '1';
    sel.addEventListener('change', () => {
      if (sel.value === '__new__') {
        const name = (prompt('New plant profile name (lowercase, no spaces — e.g. ntpc_lara):') || '').trim().toLowerCase();
        if (!name || !/^[a-z0-9_]{2,40}$/.test(name)) {
          if (name) alert('Plant names must be lowercase letters, digits, or underscores (2–40 chars).');
          sel.value = getActiveClient(); // revert
          return;
        }
        setActiveClient(name);
        window.location.reload();
        return;
      }
      setActiveClient(sel.value);
      window.location.reload();
    });
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  // textContent→innerHTML escapes & < > but not quotes — escape those too so
  // escaped values are also safe inside double/single-quoted HTML attributes.
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function generateId() {
  return 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return days === 1 ? 'Yesterday' : `${days}d ago`;
  }
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function truncate(str, len) {
  if (!str) return 'New Chat';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ─── Theme ────────────────────────────────────────────────────────────────────

const THEME_KEY = 'thermiq_theme';

function initTheme() {
  // Default is LIGHT for first-time visitors (per YC); a saved choice still wins.
  const saved = localStorage.getItem(THEME_KEY) || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
}

// Apply theme immediately (before DOM loads)
initTheme();

// Bind toggle button(s) — works on both pages
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.addEventListener('click', toggleTheme);
});

// ─── Multi-Chat Data Model ────────────────────────────────────────────────────

const CHATS_KEY = 'thermiq_chats_v2';
const OLD_KEY   = 'thermiq_chat_v1';

// Chat history is per plant profile — switching the header plant selector
// switches to that plant's own chats (the page reloads on switch).
function chatsKey() {
  return `${CHATS_KEY}__${getActiveClient()}`;
}

function loadStore() {
  try {
    const raw = localStorage.getItem(chatsKey());
    if (raw) return JSON.parse(raw);
  } catch (e) { /* corrupt — fall through */ }

  // Migrate the old shared (pre-per-plant) store to the current profile once.
  try {
    const shared = localStorage.getItem(CHATS_KEY);
    if (shared) {
      const parsed = JSON.parse(shared);
      localStorage.setItem(chatsKey(), shared);
      localStorage.removeItem(CHATS_KEY);
      return parsed;
    }
  } catch (e) { /* migration failed — fall through */ }

  // Migrate from v1
  try {
    const oldData = localStorage.getItem(OLD_KEY);
    if (oldData) {
      const oldMessages = JSON.parse(oldData);
      if (Array.isArray(oldMessages) && oldMessages.length > 0) {
        const id = generateId();
        const firstMsg = oldMessages.find(m => m.role === 'user');
        const store = {
          activeId: id,
          chats: {}
        };
        store.chats[id] = {
          id,
          title: firstMsg ? truncate(firstMsg.content, 35) : 'Imported Chat',
          createdAt: oldMessages[0]?.ts || Date.now(),
          updatedAt: oldMessages[oldMessages.length - 1]?.ts || Date.now(),
          messages: oldMessages,
        };
        saveStore(store);
        localStorage.removeItem(OLD_KEY);
        return store;
      }
    }
  } catch (e) { /* migration failed — start fresh */ }

  // Fresh start
  return createFreshStore();
}

function createFreshStore() {
  const id = generateId();
  const store = {
    activeId: id,
    chats: {}
  };
  store.chats[id] = {
    id,
    title: 'New Chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  return store;
}

function saveStore(store) {
  try {
    localStorage.setItem(chatsKey(), JSON.stringify(store));
  } catch (e) {
    // Quota exceeded — try to trim oldest chat
    const ids = Object.keys(store.chats);
    if (ids.length > 1) {
      const oldest = ids.reduce((a, b) =>
        store.chats[a].updatedAt < store.chats[b].updatedAt ? a : b
      );
      delete store.chats[oldest];
      if (store.activeId === oldest) {
        store.activeId = Object.keys(store.chats)[0];
      }
      try { localStorage.setItem(chatsKey(), JSON.stringify(store)); } catch (e2) { /* give up */ }
    }
  }
}

function getActiveChat(store) {
  return store.chats[store.activeId] || null;
}

function formatRelativeTime(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  
  const months = Math.floor(days / 30);
  if (months < 12) {
    const remDays = days % 30;
    return remDays > 0 ? `${months}m ${remDays}d ago` : `${months}m ago`;
  }
  
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

// ─── Query Copilot — Chat UI (index.html) ─────────────────────────────────────

function sourcesHtml(sources) {
  if (!sources || !sources.length) return '';
  const items = sources.map((s, i) => {
    const pct = Math.round((s.score || 0) * 100);
    return `
      <div class="source-card">
        <div class="source-meta">
          <span>[${i + 1}] ${escapeHtml(s.doc || '')} — ${escapeHtml(s.section || '')}${
            s.page ? ' (p. ' + escapeHtml(String(s.page)) + ')' : ''
          }</span>
          <span>${pct}%</span>
        </div>
        <div class="score-bar-track">
          <div class="score-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('');
  return `
    <details class="sources-toggle">
      <summary>${sources.length} source${sources.length !== 1 ? 's' : ''}</summary>
      <div class="sources-list">${items}</div>
    </details>`;
}

function renderMessages(messages, editIdx = null) {
  const messagesEl = document.getElementById('chat-messages');
  const chipsEl    = document.getElementById('suggestion-chips');
  if (!messagesEl) return;

  if (!messages || messages.length === 0) {
    messagesEl.innerHTML = `
      <div class="chat-empty">
        <div class="chat-empty-icon">THERMIQ</div>
        <h2 class="chat-empty-title">Operations Knowledge Search</h2>
        <p class="chat-empty-text">Search procedures, equipment specifications, CEA compliance, outage context, and maintenance records.</p>
      </div>`;
    if (chipsEl) chipsEl.style.display = 'flex';
    return;
  }

  if (chipsEl) chipsEl.style.display = 'none';

  const copyIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const editIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const regenIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.92-10.26l5.67-5.67"/></svg>`;

  messagesEl.innerHTML = messages.map((msg, idx) => {
    const isEditing = editIdx === idx;
    const editCount = msg.editCount || 0;
    const canEdit   = msg.role === 'user' && editCount < 3;
    const canRegen  = msg.role === 'assistant' && (msg.regenerateCount || 0) < 3 && idx === messages.length - 1;

    // Format relative timestamp
    const tsValue = msg.ts || Date.now();
    const tsFormatted = formatRelativeTime(tsValue);
    const timestampHtml = `<span class="msg-timestamp">${tsFormatted}</span>`;

    const copyBtn = `<button class="msg-action-btn msg-copy-btn" data-copy-idx="${idx}" title="Copy">${copyIcon}</button>`;
    
    let actionsHtml = '';
    if (msg.role === 'user') {
      const editBtnHtml = canEdit
        ? `<button class="msg-action-btn msg-edit-btn" data-edit-idx="${idx}" title="Edit &amp; rerun">${editIcon}${editCount > 0 ? `<span class="edit-count">${editCount}/3</span>` : ''}</button>`
        : `<span class="edit-limit" title="Edit limit reached (3/3)">${editCount}/3</span>`;
      actionsHtml = `<div class="msg-actions">${timestampHtml}${copyBtn}${editBtnHtml}</div>`;
    } else {
      const regenBtnHtml = canRegen
        ? `<button class="msg-action-btn msg-regen-btn" data-regen-idx="${idx}" title="Regenerate response">${regenIcon}</button>`
        : '';
      // Quick actions — one-click refinements of the latest answer, no typing.
      const isLast = idx === messages.length - 1;
      const quickActions = isLast && !msg.content?.startsWith('**Error:**') ? `
        <button class="msg-action-btn msg-quick-btn" data-quick="Rewrite your previous answer at half the length. Keep every ₹ figure and every source citation." title="Condense the answer">Shorter</button>
        <button class="msg-action-btn msg-quick-btn" data-quick="Explain your previous answer in plain language for a newly joined plant operator. Keep the citations." title="Plain-language version">Simplify</button>
        <button class="msg-action-btn msg-quick-btn" data-quick="Turn your previous answer into a numbered, step-by-step action checklist for the plant team. Keep the citations." title="Convert to checklist">Checklist</button>` : '';
      actionsHtml = `<div class="msg-actions">${timestampHtml}${copyBtn}${regenBtnHtml}${quickActions}</div>`;
    }

    if (msg.role === 'user') {
      if (isEditing) {
        return `<div class="chat-bubble user-bubble editing">
          <textarea class="msg-edit-textarea" id="edit-ta-${idx}" rows="3">${escapeHtml(msg.content)}</textarea>
          <div class="msg-edit-controls">
            <button class="btn-cancel-edit" data-cancel-idx="${idx}">Cancel</button>
            <button class="btn-rerun" data-rerun-idx="${idx}">↺ Rerun</button>
          </div>
        </div>`;
      }
      return `<div class="chat-bubble user-bubble">
        <div class="bubble-text">${escapeHtml(msg.content)}</div>
        ${actionsHtml}
      </div>`;
    }

    // Assistant bubble
    const isFallback = msg.model_used && !msg.model_used.startsWith('gemini');
    // Progressive disclosure: collapse very long answers behind a fade + toggle.
    const isLong = (msg.content || '').length > 1500;
    // Contextual follow-up chips under the newest answer — guide the next step.
    const isLastAssistant = idx === messages.length - 1 && !msg.content?.startsWith('**Error:**');
    const followups = isLastAssistant ? `
      <div class="followup-chips">
        <button class="chip chip-followup" data-followup="What is the quantified ₹ crore risk exposure related to this topic for this plant?">₹ risk for this topic</button>
        <button class="chip chip-followup" data-followup="Which CEA or IBR regulation mandates this, and what does it require?">Which regulation mandates this?</button>
        <button class="chip chip-followup" data-followup="Is this topic covered, partially covered, or a gap in this plant's own documentation?">Is this documented at this plant?</button>
      </div>` : '';
    return `<div class="chat-bubble assistant-bubble">
      <div class="bubble-text${isLong ? ' collapsed' : ''}">${DOMPurify.sanitize(marked.parse(msg.content || ''))}</div>
      ${isLong ? `<button class="bubble-expand-btn" type="button" data-expand>Show full answer ▾</button>` : ''}
      ${sourcesHtml(msg.sources)}
      ${isFallback ? `<div class="bubble-meta">↩ fallback via ${escapeHtml(msg.model_used)}</div>` : ''}
      ${actionsHtml}
    </div>${followups}`;
  }).join('');

  // Scroll to latest
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addTypingIndicator() {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return null;
  const div = document.createElement('div');
  div.className = 'chat-bubble assistant-bubble typing-bubble';
  div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>'
    + '<span class="typing-status">Searching knowledge base…</span>'
    + '<button class="btn-stop-gen" type="button" title="Stop generating">■ Stop</button>';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Cycle through stages so the user knows it's still working
  const stages = [
    'Searching knowledge base…',
    'Consulting risk registry…',
    'Analyzing plant data…',
    'Composing answer…',
  ];
  let stageIdx = 0;
  const statusEl = div.querySelector('.typing-status');
  div._typingInterval = setInterval(() => {
    stageIdx = (stageIdx + 1) % stages.length;
    if (statusEl) statusEl.textContent = stages[stageIdx];
  }, 7000);

  return div;
}

// ─── Sidebar Rendering ────────────────────────────────────────────────────────

function renderSidebar(store) {
  const listEl = document.getElementById('chat-list');
  if (!listEl) return;

  const chatIds = Object.keys(store.chats).sort(
    (a, b) => (store.chats[b].updatedAt || 0) - (store.chats[a].updatedAt || 0)
  );

  if (chatIds.length === 0) {
    listEl.innerHTML = `
      <div class="chat-list-empty">
        <div class="chat-list-empty-icon">CHAT</div>
        <div>No chats yet.<br>Start a conversation.</div>
      </div>`;
    return;
  }

  listEl.innerHTML = chatIds.map(id => {
    const chat = store.chats[id];
    const isActive = id === store.activeId;
    return `
      <div class="chat-item${isActive ? ' active' : ''}" data-chat-id="${id}" title="${escapeHtml(chat.title || 'New Chat')}">
        <div class="chat-item-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
        <div class="chat-item-content">
          <div class="chat-item-title">${escapeHtml(chat.title || 'New Chat')}</div>
          <div class="chat-item-time">${formatTime(chat.updatedAt)}</div>
        </div>
        <button class="chat-item-delete" data-delete-id="${id}" title="Delete chat" aria-label="Delete chat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>`;
  }).join('');
}

// ─── Sidebar & Mobile Toggle ──────────────────────────────────────────────────

function initSidebar() {
  const sidebar    = document.getElementById('sidebar');
  const toggleBtn  = document.getElementById('sidebar-collapse-btn');
  const resizer    = document.getElementById('sidebar-resizer');
  const appLayout  = document.querySelector('.app-layout');
  if (!sidebar) return;

  // The toggle lives inside the sidebar (below the title bar). Collapsed state
  // is a 54px icon rail — expand toggle, new chat, chat glyphs — and persists.
  const COLLAPSE_KEY = 'thermiq_sidebar_collapsed';

  function setCollapsed(collapsed) {
    if (appLayout) appLayout.classList.toggle('sidebar-collapsed', collapsed);
    if (collapsed) sidebar.style.width = ''; // rail width comes from CSS
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (_) { }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const collapsed = appLayout ? appLayout.classList.contains('sidebar-collapsed') : false;
      setCollapsed(!collapsed);
    });
  }

  // Restore last state; default to the rail on small screens.
  const saved = localStorage.getItem(COLLAPSE_KEY);
  setCollapsed(saved === null ? window.innerWidth <= 768 : saved === '1');

  if (resizer) {
    let isResizing = false;
    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      resizer.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      let newWidth = e.clientX;
      if (newWidth < 200) newWidth = 200;
      if (newWidth > 600) newWidth = 600;
      sidebar.style.width = newWidth + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('thermiq_sidebar_width', sidebar.style.width);
      }
    });
    
    const savedWidth = localStorage.getItem('thermiq_sidebar_width');
    if (savedWidth && window.innerWidth > 768) {
      sidebar.style.width = savedWidth;
    }
  }

  // Kept for callers that collapse after switching chats on small screens.
  return { closeSidebar: () => { if (window.innerWidth <= 768) setCollapsed(true); } };
}

// ─── API call helper ─────────────────────────────────────────────────────────

async function callAPI(query, history, client, signal) {
  const res = await fetch(`${BACKEND}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, client: client || '', history }),
    signal,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

// ─── Main Init — Query Copilot ────────────────────────────────────────────────

function initQueryCopilot() {
  const sendBtn    = document.getElementById('send-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const inputEl    = document.getElementById('chat-input');
  const chatListEl = document.getElementById('chat-list');
  if (!sendBtn || !inputEl) return;

  let store = loadStore();
  let activeEditIdx = null;
  let currentAbort = null; // in-flight request controller — the Stop button aborts it
  const sidebarControls = initSidebar();

  function refresh() {
    const chat = getActiveChat(store);
    renderMessages(chat ? chat.messages : [], activeEditIdx);
    renderSidebar(store);
  }

  refresh();

  // ── Scroll to bottom button ──
  const messagesEl = document.getElementById('chat-messages');
  const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
  if (messagesEl && scrollBottomBtn) {
    messagesEl.addEventListener('scroll', () => {
      const distanceToBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
      if (distanceToBottom > 150) {
        scrollBottomBtn.classList.add('visible');
      } else {
        scrollBottomBtn.classList.remove('visible');
      }
    });

    scrollBottomBtn.addEventListener('click', () => {
      messagesEl.scrollTo({
        top: messagesEl.scrollHeight,
        behavior: 'smooth'
      });
    });
  }

  // ── Auto-resize textarea ──
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // ── Suggestion chip clicks → send immediately (one-click, no typing) ──
  document.querySelectorAll('#suggestion-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.query) submit(chip.dataset.query);
    });
  });

  // ── New Chat button ──
  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
      activeEditIdx = null;
      const id = generateId();
      store.chats[id] = {
        id,
        title: 'New Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      store.activeId = id;
      saveStore(store);
      refresh();
      inputEl.focus();
    });
  }

  // ── Chat list clicks (switch / delete) ──
  if (chatListEl) {
    chatListEl.addEventListener('click', (e) => {
      // Delete button
      const deleteBtn = e.target.closest('[data-delete-id]');
      if (deleteBtn) {
        e.stopPropagation();
        const deleteId = deleteBtn.dataset.deleteId;
        const chatTitle = store.chats[deleteId]?.title || 'this chat';
        if (!confirm(`Delete "${chatTitle}"?`)) return;

        delete store.chats[deleteId];
        const remaining = Object.keys(store.chats);

        if (remaining.length === 0) {
          // Create a fresh chat if all deleted
          const fresh = createFreshStore();
          Object.assign(store, fresh);
        } else if (store.activeId === deleteId) {
          // Switch to most recent remaining chat
          store.activeId = remaining.reduce((a, b) =>
            (store.chats[b].updatedAt || 0) > (store.chats[a].updatedAt || 0) ? b : a
          );
        }

        saveStore(store);
        refresh();
        return;
      }

      // Switch chat
      const chatItem = e.target.closest('[data-chat-id]');
      if (chatItem) {
        const id = chatItem.dataset.chatId;
        if (id !== store.activeId) {
          activeEditIdx = null;
          store.activeId = id;
          saveStore(store);
          refresh();
          if (sidebarControls) sidebarControls.closeSidebar();
        }
      }
    });
  }

  // ── Submit query ──
  // Accepts an optional override string so suggestion chips, follow-up chips,
  // and quick actions can send without touching the textarea.
  async function submit(overrideQuery) {
    const fromInput = typeof overrideQuery !== 'string';
    const query = (fromInput ? inputEl.value : overrideQuery).trim();
    if (!query || sendBtn.disabled) return;

    // Reset input
    if (fromInput) {
      inputEl.value = '';
      inputEl.style.height = 'auto';
    }
    sendBtn.disabled = true;
    currentAbort = new AbortController();

    const chat = getActiveChat(store);
    if (!chat) return;

    // Add user message
    chat.messages.push({ role: 'user', content: query, ts: Date.now() });

    // Auto-title from first user message
    if (chat.title === 'New Chat') {
      chat.title = truncate(query, 35);
    }

    chat.updatedAt = Date.now();
    saveStore(store);
    renderMessages(chat.messages);
    renderSidebar(store);

    const typing = addTypingIndicator();

    try {
      // Queries are always scoped to the active plant profile (header selector).
      const client = getActiveClient();

      const history = chat.messages.slice(0, -1).slice(-6).map(m => ({
        role:    m.role,
        content: m.content || '',
      }));

      // Retry loop
      let attempt = 1;
      const maxAttempts = 3;
      let success = false;
      let answerData = null;

      while (attempt <= maxAttempts && !success) {
        try {
          if (attempt > 1 && typing) {
            typing.innerHTML = `<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span> <em style="margin-left:8px;font-size:0.75rem;color:var(--text-muted)">Synthesizing... (Attempt ${attempt}/${maxAttempts})</em>`;
          }
          answerData = await callAPI(query, history, client, currentAbort && currentAbort.signal);
          success = true;
        } catch (err) {
          if (err.name === 'AbortError') throw err; // user hit Stop — never retry
          if (attempt === maxAttempts) throw err;
          // Wait 1 second before retrying
          await new Promise(r => setTimeout(r, 1000));
        } finally {
          attempt++;
        }
      }

      chat.messages.push({
        role: 'assistant',
        content: answerData.answer,
        sources: answerData.sources || [],
        model_used: answerData.model_used || 'gemini-2.5-flash',
        ts: Date.now(),
      });
    } catch (err) {
      chat.messages.push({
        role: 'assistant',
        content: err.name === 'AbortError'
          ? '_Generation stopped._'
          : `**Error:** ${err.message}${err.message.includes('504') ? ' (Timeout)' : ''}\n\nThe server timed out or failed to respond after multiple attempts. Please try again.`,
        sources: [],
        ts: Date.now(),
      });
    } finally {
      currentAbort = null;
      chat.updatedAt = Date.now();
      if (typing) {
        if (typing._typingInterval) clearInterval(typing._typingInterval);
        typing.remove();
      }
      sendBtn.disabled = false;
      saveStore(store);
      refresh();
      inputEl.focus();
    }
  }

  sendBtn.addEventListener('click', () => submit());
  // Enter sends; Shift+Enter inserts a newline (Ctrl/Cmd+Enter still works).
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });

  // ── Message action delegation (copy / edit / rerun / cancel) ──
  // (messagesEl is already defined for the scroll-bottom handler)
  if (messagesEl) {
    messagesEl.addEventListener('click', async (e) => {
      // Stop generation (button lives inside the typing indicator)
      const stopBtn = e.target.closest('.btn-stop-gen');
      if (stopBtn) {
        if (currentAbort) currentAbort.abort();
        return;
      }

      // Expand/collapse a long answer
      const expandBtn = e.target.closest('[data-expand]');
      if (expandBtn) {
        const bubbleText = expandBtn.previousElementSibling;
        if (bubbleText) {
          const collapsed = bubbleText.classList.toggle('collapsed');
          expandBtn.textContent = collapsed ? 'Show full answer ▾' : 'Collapse answer ▴';
        }
        return;
      }

      // Follow-up chip / quick action → send as a new prompt, no typing needed
      const followBtn = e.target.closest('[data-followup]');
      if (followBtn) { submit(followBtn.dataset.followup); return; }
      const quickBtn = e.target.closest('[data-quick]');
      if (quickBtn) { submit(quickBtn.dataset.quick); return; }

      // Copy
      const copyBtn = e.target.closest('[data-copy-idx]');
      if (copyBtn) {
        const idx = parseInt(copyBtn.dataset.copyIdx, 10);
        const chat = getActiveChat(store);
        if (!chat || !chat.messages[idx]) return;
        const text = chat.messages[idx].content || '';
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 1500);
        } catch (_) { /* clipboard unavailable */ }
        return;
      }

      // Enter edit mode
      const editBtn = e.target.closest('[data-edit-idx]');
      if (editBtn) {
        activeEditIdx = parseInt(editBtn.dataset.editIdx, 10);
        refresh();
        const ta = document.getElementById(`edit-ta-${activeEditIdx}`);
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
        return;
      }

      // Cancel edit
      const cancelBtn = e.target.closest('[data-cancel-idx]');
      if (cancelBtn) {
        activeEditIdx = null;
        refresh();
        return;
      }

      // Regenerate response
      const regenBtn = e.target.closest('[data-regen-idx]');
      if (regenBtn) {
        const idx = parseInt(regenBtn.dataset.regenIdx, 10);
        const chat = getActiveChat(store);
        if (!chat || !chat.messages[idx] || chat.messages[idx].role !== 'assistant') return;
        
        // Ensure there is a preceding user message
        const userMsg = chat.messages[idx - 1];
        if (!userMsg || userMsg.role !== 'user') return;
        
        chat.messages[idx - 1].regenerateCount = (chat.messages[idx - 1].regenerateCount || 0) + 1;
        
        // Remove this AI message
        chat.messages = chat.messages.slice(0, idx);
        
        // Trigger submit again with the user's original query
        inputEl.value = userMsg.content;
        chat.messages.pop(); // Remove it so submit() adds it fresh
        submit();
        return;
      }

      // Rerun edited message
      const rerunBtn = e.target.closest('[data-rerun-idx]');
      if (rerunBtn) {
        const idx = parseInt(rerunBtn.dataset.rerunIdx, 10);
        const ta = document.getElementById(`edit-ta-${idx}`);
        const newContent = ta ? ta.value.trim() : '';
        if (!newContent) return;

        const chat = getActiveChat(store);
        if (!chat) return;

        // Commit edit
        chat.messages[idx].content   = newContent;
        chat.messages[idx].editCount = (chat.messages[idx].editCount || 0) + 1;
        // Drop everything after the edited message
        chat.messages = chat.messages.slice(0, idx + 1);
        activeEditIdx = null;
        chat.updatedAt = Date.now();
        saveStore(store);
        refresh();

        // Re-query
        const typing = addTypingIndicator();
        sendBtn.disabled = true;

        const client = getActiveClient();
        const history = chat.messages.slice(0, idx).slice(-6).map(m => ({
          role: m.role, content: m.content || '',
        }));

        try {
          const data = await callAPI(newContent, history, client);
          chat.messages.push({
            role: 'assistant',
            content: data.answer,
            sources: data.sources || [],
            model_used: data.model_used || 'gemini-2.5-flash',
            ts: Date.now(),
          });
        } catch (err) {
          chat.messages.push({
            role: 'assistant',
            content: `**Error:** ${err.message}`,
            sources: [],
            ts: Date.now(),
          });
        } finally {
          chat.updatedAt = Date.now();
          if (typing) {
            if (typing._typingInterval) clearInterval(typing._typingInterval);
            typing.remove();
          }
          sendBtn.disabled = false;
          saveStore(store);
          refresh();
          inputEl.focus();
        }
      }
    });
  }

  // ── Export transcript ──
  const exportBtn = document.getElementById('export-transcript-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const chat = getActiveChat(store);
      if (!chat || !chat.messages.length) {
        alert('Nothing to export — start a conversation first.');
        return;
      }
      
      let md = `# ThermIQ Chat Transcript\n\n**Date:** ${new Date().toLocaleString()}\n\n---\n\n`;
      chat.messages.forEach(m => {
        const role = m.role === 'user' ? 'User' : 'ThermIQ';
        md += `### ${role}\n\n${m.content}\n\n`;
      });
      
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `thermiq_chat_${new Date().toISOString().slice(0,10)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
}

// ─── Risk Dashboard (dashboard.html) ──────────────────────────────────────────

const COVERAGE_LABELS = {
  gap:     { text: 'Not documented',    cls: 'coverage-gap' },
  partial: { text: 'Partly documented', cls: 'coverage-partial' },
  covered: { text: 'Documented',        cls: 'coverage-covered' },
};

// Plain-language definitions shown on hover/tap behind each (i) icon.
const GAP_TIPS = {
  criticality: "<b>How critical this topic is</b>, on a 1–5 scale. Set from CEA forced-outage frequency data and CERC penalty rules — not opinion. 5 = a leading cause of full-unit trips.",
  match: "<b>How well your plant's own uploaded documents cover this topic</b>, measured by semantic search. 100% = fully documented, 0% = nothing on file.",
  mttr: "<b>Typical days to repair if this fails</b> (mean time to repair). Shown for context — it does not change the risk score.",
};

// Renders a small circular info icon. Shows its tooltip on hover, keyboard
// focus, and tap (the onclick toggles .show for touch devices).
function infoIcon(tip, extraClass = '') {
  return `<span class="tiq-info ${extraClass}" tabindex="0" role="button" aria-label="More information"`
       + ` onclick="this.classList.toggle('show')"`
       + ` onmouseleave="this.classList.remove('show')">i<span class="tip">${tip}</span></span>`;
}

function coverageTip(thresholds) {
  const cov = Math.round(((thresholds && thresholds.covered) || 0.62) * 100);
  const par = Math.round(((thresholds && thresholds.partial) || 0.45) * 100);
  return `<b>Does your plant have a documented procedure for this?</b><br><br>`
       + `<b>Documented</b> — strong match (≥${cov}%)<br>`
       + `<b>Partly documented</b> — some related text (${par}–${cov}%)<br>`
       + `<b>Not documented</b> — no real coverage (&lt;${par}%)`;
}

const GAP_TYPE_LABELS = {
  missing_sop: 'Missing SOP',
  missing_inspection_procedure: 'Missing Inspection',
  missing_reference: 'Missing Reference',
};

function toggleMethodology(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? 'Show sources' : 'Hide sources';
}

function riskBadgeClass(riskScoreCr) {
  if (riskScoreCr > 100) return 'critical';
  if (riskScoreCr >= 30) return 'high';
  return 'low';
}

// ── CEA Outages loader (runs independently — not blocked by gap analysis fetch) ──
// Renders BOTH the hub marquee strip (latest events, scrolling) and the full
// history table inside the expandable panel. Cached for the Risk Report.
let _ceaOutagesCache = null;

async function loadCeaOutages(outagesBody) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s timeout
    try {
      const response = await fetch(`${BACKEND}/api/cea_outage`, { signal: controller.signal });
      clearTimeout(timeout);
      const data = await response.json();
      const outages = data.outages || [];
      _ceaOutagesCache = outages;

      // Full history in the expandable panel (not just 10 — the panel scrolls).
      outagesBody.innerHTML = '';
      outages.forEach(outage => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${escapeHtml(outage.station)}</td>
          <td>${escapeHtml(outage.unit)}</td>
          <td>${escapeHtml(outage.mw_lost)}</td>
          <td>${escapeHtml(outage.equipment_tag)}</td>
          <td>${escapeHtml(outage.failure_reason_raw)}</td>
          <td>₹${escapeHtml(outage.revenue_lost_est_cr)}</td>
          <td>${escapeHtml(outage.date_out)}</td>
        `;
        outagesBody.appendChild(row);
      });

      if (!outages.length) {
        outagesBody.innerHTML = `<tr><td colspan="7" class="skeleton-row">No outage data yet.</td></tr>`;
      }

      renderOutageMarquee_(outages);
    } catch (fetchErr) {
      clearTimeout(timeout);
      throw fetchErr;
    }
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Timed out loading outages.' : `Failed to load outages: ${escapeHtml(err.message)}`;
    outagesBody.innerHTML = `<tr><td colspan="7" class="skeleton-row">${msg}</td></tr>`;
    const track = document.getElementById('hub-outage-track');
    if (track) track.innerHTML = `<span class="tick-item">Outage feed unavailable</span>`;
  }
}

// Hub strip: latest events as one seamlessly-looping marquee row.
function renderOutageMarquee_(outages) {
  const track = document.getElementById('hub-outage-track');
  if (!track) return;
  const latest = outages.slice(0, 12);
  if (!latest.length) {
    track.innerHTML = `<span class="tick-item">No recent CEA forced outages on record</span>`;
    return;
  }
  const items = latest.map(o => `
    <span class="tick-item">
      <b>${escapeHtml(o.station)}</b> U${escapeHtml(o.unit)}
      · ${escapeHtml(o.equipment_tag)}
      · <span class="tick-loss">₹${escapeHtml(o.revenue_lost_est_cr)} Cr</span>
      · ${escapeHtml(o.date_out)}
    </span>`).join('<span class="tick-sep">◆</span>');
  // Duplicate content so the CSS translateX(-50%) loop is seamless.
  track.innerHTML = items + '<span class="tick-sep">◆</span>' + items + '<span class="tick-sep">◆</span>';
}

// Expand/collapse the full-history panel under the hub strip.
function initHubOutagesToggle() {
  const toggle = document.getElementById('hub-outages-toggle');
  const panel  = document.getElementById('hub-outages-panel');
  if (!toggle || !panel) return;
  toggle.addEventListener('click', () => {
    const open = panel.hasAttribute('hidden');
    if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('open', open);
    if (open) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

// A plant with documents but zero risk_scores has simply never had
// scripts/detect_gaps.py run for it (confirmed root cause of the Saraighat
// "empty CSV" report — see BRIDGE.md task-048/049). Rather than ask for a
// manual step, fire it automatically the moment the gap table would
// otherwise render empty, and poll until real rows show up.
const _gapScanPolling = new Set();

async function triggerGapScanAndPoll(clientName) {
  if (_gapScanPolling.has(clientName)) return; // already polling this client in another call
  _gapScanPolling.add(clientName);

  try {
    await fetch(`${BACKEND}/api/trigger_gap_scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': INGEST_KEY },
      body: JSON.stringify({ client_name: clientName }),
    });
  } catch (_) {
    // Dispatch call failing doesn't necessarily mean no scan is running (e.g. a
    // prior tab already triggered one) — keep polling regardless.
  }

  const maxAttempts = 15; // ~15 × 8s ≈ 2 minutes
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 8000));
    if (getActiveClient() !== clientName) break; // user switched plants — stop polling this one

    try {
      const res = await fetch(`${BACKEND}/api/gap_analysis?client_name=${encodeURIComponent(clientName)}`);
      const data = await res.json();
      if ((data.gaps || []).length > 0) {
        _gapScanPolling.delete(clientName);
        if (getActiveClient() === clientName) initDashboard(); // re-render everything with real data now in place
        return;
      }
    } catch (_) { /* transient fetch error — keep polling */ }
  }

  _gapScanPolling.delete(clientName);
  if (getActiveClient() === clientName) {
    const gapsBody = document.getElementById('gaps-table-body');
    if (gapsBody) {
      gapsBody.innerHTML = `<tr><td colspan="6" class="skeleton-row">Gap scan is taking longer than expected. Refresh in a minute, or check the "Compute Gap Scores for a Client" workflow run on GitHub Actions.</td></tr>`;
    }
  }
}

// Topics with no CEA outage history for their equipment type AND no plant
// documentation covering them: we genuinely don't know the cost of a gap
// here, so instead of pricing it with the flat assumed-default fallback,
// list it plainly with an upload prompt. A missing document does not mean a
// real incident risk exists — it may just mean this plant never had a
// problem in that area.
function renderDocsNeededSection(needsDocs) {
  const section = document.getElementById('docs-needed-section');
  const body = document.getElementById('docs-needed-table-body');
  if (!section || !body) return;

  if (!needsDocs.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  body.innerHTML = needsDocs.map((g) => {
    const covInfo = COVERAGE_LABELS[g.coverage_status] || COVERAGE_LABELS.gap;
    return `
      <tr>
        <td>${escapeHtml(g.equipment_tag || '—')}</td>
        <td>
          <div class="gap-desc">${escapeHtml(g.description || g.topic || '—')}</div>
        </td>
        <td>
          <div class="cov-status ${covInfo.cls}">
            <span class="cov-dot"></span>
            <span class="cov-label">${covInfo.text}</span>
          </div>
        </td>
        <td><a class="btn-sheet-csv btn-sheet-csv--secondary" href="documents.html#add-document" style="white-space:nowrap">Upload document ↗</a></td>
      </tr>`;
  }).join('');
}

async function initDashboard() {
  const outagesBody = document.getElementById('outages-table-body');
  if (!outagesBody) return;

  initPlantSelector();

  const lastUpdated = document.getElementById('last-updated');

  // Fire outages fetch immediately — parallel with gap analysis, not blocked by it.
  const outagesPromise = loadCeaOutages(outagesBody);

  // ── Fetch Gap Analysis ──
  const gapsBody       = document.getElementById('gaps-table-body');
  const totalRiskEl    = document.getElementById('total-risk');
  const criticalEl     = document.getElementById('critical-gaps-count');
  const coveredEl      = document.getElementById('covered-count');
  const gapsCountEl    = document.getElementById('gaps-count');

  if (gapsBody) {
    try {
      const gapRes = await fetch(`${BACKEND}/api/gap_analysis?client_name=${encodeURIComponent(getActiveClient())}`);
      const gapData = await gapRes.json();
      const gaps = gapData.gaps || [];

      if (gaps.length === 0) {
        gapsBody.innerHTML = `<tr><td colspan="6" class="skeleton-row">Computing gap analysis for this plant for the first time — this can take about a minute, this page will update automatically…</td></tr>`;
        triggerGapScanAndPoll(getActiveClient());
      } else {
        // "linked_outages > 0" means this topic's ₹ figure comes from real CEA
        // forced-outage records for that equipment type. "0" means detect_gaps.py
        // fell back to a flat assumed default (consequence_method:
        // "assumed_default_no_outage_data") because no national outage history
        // exists for that equipment category — that is NOT the same thing as "this
        // plant has a real problem here." A plant with no document on a topic may
        // simply never have had an issue there. So: only real, sourced numbers get
        // summed into the headline Total Risk Exposure / Critical Gaps stats and
        // the ranked table; everything else is a documentation gap with an unknown
        // (not assumed-zero, not assumed-nonzero) cost, listed separately below
        // with an upload prompt instead of a fabricated ₹ figure.
        const quantified  = gaps.filter(g => (g.linked_outages || 0) > 0);
        const needsDocs   = gaps.filter(g => (g.linked_outages || 0) === 0 && g.coverage_status !== 'covered');

        const totalRisk = quantified.reduce((sum, g) => sum + (g.risk_score_cr || 0), 0);
        // Card label is "Critical Gaps (> ₹100 Cr)" — count by ₹ risk, not status,
        // and only among quantified rows (consistent with the total above).
        const over100Count = quantified.filter(g => (g.risk_score_cr || 0) > 100).length;
        const coveredCount = gaps.filter(g => g.coverage_status === 'covered').length;
        const gapCount     = gaps.filter(g => g.coverage_status === 'gap').length;

        if (totalRiskEl)  totalRiskEl.textContent  = `₹${Math.round(totalRisk)} Cr`;
        if (criticalEl)   criticalEl.textContent    = over100Count;
        if (coveredEl)    coveredEl.textContent      = coveredCount;
        if (gapsCountEl)  gapsCountEl.textContent    = `${gapCount}`;

        renderDocsNeededSection(needsDocs);

        if (quantified.length === 0) {
          gapsBody.innerHTML = `<tr><td colspan="6" class="skeleton-row">No topics with real CEA outage history for this plant's equipment yet — see "Documentation Needed" below for everything still unassessed.</td></tr>`;
        } else {
        gapsBody.innerHTML = quantified.map((g, i) => {
          const covInfo  = COVERAGE_LABELS[g.coverage_status] || COVERAGE_LABELS.gap;
          const badge    = riskBadgeClass(g.risk_score_cr);
          const typeLabel = GAP_TYPE_LABELS[g.gap_type] || escapeHtml(g.gap_type || '—');

          // Consequence method label — make assumptions visible
          const consequenceMethod = g.consequence_method || '';
          const conLabel = consequenceMethod.startsWith('derived')
            ? `<span class="consequence-label consequence-label--derived" title="${escapeHtml(g.consequence_source || 'Derived from CEA outage data')}">derived from ${g.linked_outages || '?'} CEA records</span>`
            : `<span class="consequence-label consequence-label--assumed" title="${escapeHtml(g.consequence_source || 'Default assumption')}">assumed default</span>`;

          // Criticality scale is 1–5 (sourced), not 1–10 arbitrary
          const critScale = '5';

          // How well the plant's own docs match this topic (0–100%).
          const matchPct = Math.round((g.best_match_score || 0) * 100);

          // Coverage threshold definitions live in the coverage column's (i) tooltip.
          const covTip = coverageTip(g.coverage_threshold_used);

          // Unique id for expandable methodology panel
          const detailId = `meth-${i}`;

          // Expandable source citations — every number is traceable
          const hasSources = g.criticality_source || g.regulatory_basis || g.consequence_source;
          const methodPanel = hasSources ? `
            <div class="methodology-detail" id="${detailId}" style="display:none">
              ${g.criticality_source ? `<div class="method-section"><span class="method-label">Criticality basis (${g.criticality_score}/${critScale}):</span>${escapeHtml(g.criticality_source)}</div>` : ''}
              ${g.regulatory_basis   ? `<div class="method-section"><span class="method-label">Regulatory basis:</span>${escapeHtml(g.regulatory_basis)}</div>` : ''}
              ${g.consequence_source ? `<div class="method-section"><span class="method-label">Consequence calculation:</span>${escapeHtml(g.consequence_source)}</div>` : ''}
              ${g.risk_formula       ? `<div class="method-section"><span class="method-label">Risk formula:</span><code>${escapeHtml(g.risk_formula)}</code></div>` : ''}
            </div>` : '';
          const sourceBtn = hasSources
            ? `<button class="methodology-toggle" onclick="toggleMethodology('${detailId}', this)">Show sources</button>`
            : '';

          return `
            <tr class="gap-row gap-row--${g.coverage_status}">
              <td>${i + 1}</td>
              <td>${escapeHtml(g.equipment_tag || '—')}</td>
              <td class="gap-desc-cell">
                <div class="gap-desc">${escapeHtml(g.description || '—')}</div>
                <div class="gap-meta gap-meta--chips">
                  <span class="chip">${typeLabel}</span>
                  <span class="chip"><b>Criticality (severity) ${g.criticality_score || '—'}/${critScale}</b>${infoIcon(GAP_TIPS.criticality)}</span>
                  <span class="chip"><b>Plant docs match ${matchPct}%</b>${infoIcon(GAP_TIPS.match)}</span>
                  ${g.typical_mttr_days ? `<span class="chip"><b>Repair time ~${g.typical_mttr_days} days</b>${infoIcon(GAP_TIPS.mttr)}</span>` : ''}
                  ${sourceBtn}
                </div>
                ${methodPanel}
              </td>
              <td>
                <div class="cov-status ${covInfo.cls}">
                  <span class="cov-dot"></span>
                  <span class="cov-label">${covInfo.text}</span>
                  ${infoIcon(covTip, 'tiq-info--right')}
                </div>
                <div class="cov-bar"><span class="${covInfo.cls}" style="width:${matchPct}%"></span></div>
                <div class="cov-sub">${matchPct}% match</div>
              </td>
              <td>${g.linked_outages || 0}</td>
              <td>
                <span class="risk-badge risk-${badge}">₹${(g.risk_score_cr || 0).toFixed(1)}</span>
                <div class="gap-meta" style="margin-top:0.2rem">
                  crit ${g.criticality_score || '?'} × ₹${(g.consequence_cr || 0).toFixed(1)} Cr × ${(g.exposure_score || 0).toFixed(2)} exp<br>
                  ${conLabel}
                </div>
              </td>
            </tr>`;
        }).join('');
        }
      }
    } catch (err) {
      if (gapsBody) gapsBody.innerHTML = `<tr><td colspan="6" class="skeleton-row">Failed to load gap analysis: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // Wait for both sections to finish before updating the timestamp.
  await outagesPromise;
  if (lastUpdated) lastUpdated.textContent = `Last updated: ${new Date().toLocaleString()}`;

  // Gap scores are produced by the canonical offline engine (scripts/detect_gaps.py)
  // and read here. There is no in-browser recompute — a second JS engine would drift
  // from the Python one. Re-run detect_gaps.py and the dashboard reflects it on reload.
}

// ─── Document Upload (documents.html) ────────────────────────────────────────

function initUpload() {
  const floatEl  = document.getElementById('upload-float');
  const dropZone = document.getElementById('upload-drop-zone');
  if (!floatEl || !dropZone) return;

  const fileInput = document.getElementById('upload-file-input');
  const docName   = document.getElementById('upload-doc-name');
  const docType   = document.getElementById('upload-doc-type');
  const docTypeField = document.getElementById('upload-doc-type-field');
  const sourceUrl = document.getElementById('upload-source-url');
  const submitBtn = document.getElementById('upload-submit-btn');
  const btnText   = document.getElementById('upload-btn-text');
  const statusEl  = document.getElementById('upload-status');
  const fileLabel = document.getElementById('upload-file-name');
  const destHint  = document.getElementById('upload-dest-hint');
  const destNote  = document.getElementById('dest-note');
  const destBtns  = {
    plant: document.getElementById('dest-plant'),
    guideline: document.getElementById('dest-guideline'),
  };
  const dock      = document.getElementById('upload-dock');
  const dockTitle = document.getElementById('upload-dock-title');
  const queueEl   = document.getElementById('upload-queue');
  const driveUrlInput = document.getElementById('upload-drive-url');
  const driveNote     = document.getElementById('upload-drive-note');

  // Must stay under Vercel's ~4.5 MB request-body cap after base64 (+33%) overhead —
  // larger files die at the platform edge with an opaque 413.
  const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
  let selectedFiles = [];   // supports multiple files at once
  let dest = 'plant';       // 'plant' | 'guideline' (both plant-scoped)
  let uploading = false;
  let queue = [];           // { name, status: 'queued'|'uploading'|'done'|'failed', error }

  initPlantSelector();

  // Remember the last-used Document Type so it doesn't reset on every upload.
  const DOC_TYPE_KEY = 'thermiq_last_doc_type';
  if (docType) {
    const savedType = localStorage.getItem(DOC_TYPE_KEY);
    if (savedType && [...docType.options].some(o => o.value === savedType)) {
      docType.value = savedType;
    }
    docType.addEventListener('change', () => localStorage.setItem(DOC_TYPE_KEY, docType.value));
  }

  // ── Destination — Plant Documents vs plant-scoped Guideline Documents ─────
  // Both upload as source_type 'client' under the active plant, so they stay
  // deletable and never touch the seeded CEA baseline. Guideline uploads are
  // typed doc_type 'guideline', which is what routes them to the Guideline view.
  function setDest(d) {
    dest = d === 'guideline' ? 'guideline' : 'plant';
    Object.entries(destBtns).forEach(([k, b]) => { if (b) b.classList.toggle('selected', k === dest); });
    if (destHint) {
      destHint.innerHTML = (dest === 'plant' ? 'Into: Plant Documents · ' : 'Into: Guideline Documents · ')
        + `<b>${escapeHtml(getActiveClient())}</b>`;
    }
    if (destNote) {
      destNote.textContent = dest === 'plant'
        ? "Adds the active plant's own records (SOPs, manuals, inspection records) to the corpus being assessed."
        : 'Adds guidelines for this plant only. The seeded CEA corpus stays fixed for every plant; guidelines you add here are deletable.';
    }
    if (docTypeField) docTypeField.style.display = dest === 'guideline' ? 'none' : '';
  }
  Object.values(destBtns).forEach((b) => { if (b) b.addEventListener('click', () => setDest(b.dataset.destChoice)); });
  setDest('plant');

  // ── Open / minimize / close / dock ─────────────────────────────────────────
  function openUploadModal(d) {
    setDest(d || dest);
    floatEl.hidden = false;
  }
  function minimizeUpload() {
    floatEl.hidden = true;
    if (queue.length) { dock.hidden = false; renderQueue(); }
  }
  function closeUploadModal() {
    floatEl.hidden = true;
    if (uploading) { dock.hidden = false; renderQueue(); return; } // uploads keep running in the dock
    resetForm();
  }

  // Any element with data-upload-dest opens the panel (hub tile, +Add buttons).
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-upload-dest]');
    if (trigger) { e.preventDefault(); openUploadModal(trigger.dataset.uploadDest); }
  });
  document.getElementById('upload-min-btn').addEventListener('click', minimizeUpload);
  document.getElementById('upload-close-btn').addEventListener('click', closeUploadModal);
  document.getElementById('upload-restore-btn').addEventListener('click', () => { floatEl.hidden = false; });
  document.getElementById('upload-dock-close-btn').addEventListener('click', () => {
    if (uploading) return; // can't dismiss the dock while uploads are in flight
    dock.hidden = true;
    queue = [];
  });

  // ── Draggable panel (drag by its header) ──────────────────────────────────
  (function makeDraggable() {
    const head = document.getElementById('upload-float-head');
    if (!head) return;
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const r = floatEl.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      let left = ox + (e.clientX - sx);
      let top  = oy + (e.clientY - sy);
      left = Math.max(8, Math.min(left, window.innerWidth - floatEl.offsetWidth - 8));
      top  = Math.max(8, Math.min(top, window.innerHeight - 80));
      floatEl.style.left = `${left}px`;
      floatEl.style.top = `${top}px`;
      floatEl.style.right = 'auto';
      floatEl.style.bottom = 'auto';
    });
    const stopDrag = () => { dragging = false; };
    head.addEventListener('pointerup', stopDrag);
    head.addEventListener('pointercancel', stopDrag);
  })();

  // ── Status helpers ────────────────────────────────────────────────────────
  function setStatus(msg, type = 'info') {
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.textContent = msg;
    statusEl.classList.remove('hidden');
  }

  function clearStatus() {
    statusEl.className = 'upload-status hidden';
    statusEl.textContent = '';
  }

  function driveUrlValue() {
    return driveUrlInput ? driveUrlInput.value.trim() : '';
  }

  function updateSubmitState() {
    // With multiple files each doc is named from its filename, so the single
    // Document Name field is only required when exactly one file is selected —
    // or when a Drive link is supplied (the link carries no usable filename).
    const hasDrive = !!driveUrlValue();
    const nameOk = (selectedFiles.length > 1 && !hasDrive) || docName.value.trim();
    const ready = !uploading && (selectedFiles.length >= 1 || hasDrive) && nameOk;
    submitBtn.disabled = !ready;
    if (btnText && !submitBtn.disabled) {
      const n = selectedFiles.length + (hasDrive ? 1 : 0);
      btnText.textContent = hasDrive && !selectedFiles.length
        ? 'Queue Drive Ingest'
        : (n > 1 ? `Upload ${n} Documents` : 'Start Upload');
    }
  }

  // Turn a filename into a readable document name.
  function nameFromFile(file) {
    return file.name.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ').trim();
  }

  function resetForm() {
    selectedFiles = [];
    fileInput.value = '';
    docName.value = '';
    if (sourceUrl) sourceUrl.value = '';
    if (driveUrlInput) driveUrlInput.value = '';
    if (driveNote) driveNote.hidden = true;
    fileLabel.textContent = 'No files selected · PDF only · max ~3 MB each · larger files via Drive link below';
    dropZone.classList.remove('has-file');
    if (btnText) btnText.textContent = 'Start Upload';
    submitBtn.disabled = true;
    clearStatus();
  }

  // ── File handling (accepts one or many) ────────────────────────────────────
  function handleFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const accepted = [];
    const skipped = [];
    const tooBig = [];
    for (const file of incoming) {
      if (!file.name.toLowerCase().endsWith('.pdf')) { skipped.push(`${file.name} (not a PDF)`); continue; }
      if (file.size > MAX_BYTES) { tooBig.push(file.name); skipped.push(`${file.name} (>3 MB)`); continue; }
      accepted.push(file);
    }

    // Files over the direct-upload cap can still be ingested via a Drive link —
    // point the user there instead of just rejecting them.
    if (driveNote) {
      if (tooBig.length) {
        driveNote.hidden = false;
        driveNote.textContent = `${tooBig.join(', ')} exceed${tooBig.length === 1 ? 's' : ''} the 3 MB direct-upload limit. Upload the file to your Google Drive, set sharing to "Anyone with the link", and paste the link above — it will be ingested in the background (one link at a time).`;
      } else {
        driveNote.hidden = true;
      }
    }

    if (!accepted.length) {
      setStatus(`No files added directly. ${skipped.join('; ')}`, tooBig.length ? 'info' : 'error');
      updateSubmitState();
      return;
    }
    clearStatus();
    selectedFiles = accepted;

    if (selectedFiles.length === 1) {
      const f = selectedFiles[0];
      fileLabel.textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`;
      // Single file: prefill the editable Document Name if empty.
      if (!docName.value.trim()) docName.value = nameFromFile(f);
    } else {
      const totalKB = selectedFiles.reduce((s, f) => s + f.size, 0) / 1024;
      fileLabel.textContent = `${selectedFiles.length} files selected · ${totalKB.toFixed(0)} KB total · named from filenames`;
    }
    if (skipped.length) {
      setStatus(`Added ${accepted.length} file(s). Skipped: ${skipped.join('; ')}`, 'info');
    }
    dropZone.classList.add('has-file');
    updateSubmitState();
  }

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => handleFiles(fileInput.files));

  docName.addEventListener('input', updateSubmitState);
  if (driveUrlInput) driveUrlInput.addEventListener('input', updateSubmitState);

  const readAsBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  async function ingestOne(file, docNameValue, docTypeValue, clientName) {
    const base64 = await readAsBase64(file);
    const res = await fetch(`${BACKEND}/api/ingest_document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': INGEST_KEY },
      body: JSON.stringify({
        pdf_base64:  base64,
        doc_name:    docNameValue,
        doc_type:    docTypeValue,
        source_url:  sourceUrl.value.trim(),
        source_type: 'client', // always plant-scoped; the seeded CEA baseline is system-managed
        client_name: clientName,
        client:      clientName, // legacy field — keep for compat
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || `Server error ${res.status}`);
    return data;
  }

  // Large files: hand the Drive share link to /api/ingest_drive, which queues
  // a background GitHub Actions job (download → chunk → embed → index). The
  // Documents grid shows a "processing" card and polls until it lands.
  async function ingestDriveLink(driveUrl, docNameValue, docTypeValue, clientName) {
    const res = await fetch(`${BACKEND}/api/ingest_drive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': INGEST_KEY },
      body: JSON.stringify({
        drive_url:   driveUrl,
        doc_name:    docNameValue,
        doc_type:    docTypeValue,
        client_name: clientName,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (!data.queued && !data.already_running)) throw new Error(data.error || `Server error ${res.status}`);
    return data;
  }

  // ── Dock queue rendering ───────────────────────────────────────────────────
  function renderQueue() {
    if (!queueEl) return;
    queueEl.innerHTML = queue.map((q) => `
      <div class="upq-item ${q.status}">
        <div class="upq-row">
          <span class="upq-name">${escapeHtml(q.name)}</span>
          <span class="upq-state">${q.status}</span>
        </div>
        <div class="upq-bar"><i></i></div>
        ${q.error ? `<div class="upq-error">${escapeHtml(q.error)}</div>` : ''}
      </div>`).join('');
    const total = queue.length;
    const finished = queue.filter(q => q.status === 'done' || q.status === 'failed').length;
    const failed = queue.filter(q => q.status === 'failed').length;
    if (dockTitle) {
      dockTitle.textContent = uploading
        ? `Uploading ${Math.min(finished + 1, total)}/${total}…`
        : (total ? (failed ? `Uploads done — ${failed} failed` : 'Uploads complete') : 'Uploads');
    }
  }

  // ── Submit — panel minimizes, uploads run sequentially from the dock ───────
  submitBtn.addEventListener('click', async () => {
    const driveUrl = driveUrlValue();
    if ((!selectedFiles.length && !driveUrl) || uploading) return;
    if ((selectedFiles.length === 1 || driveUrl) && !docName.value.trim()) {
      setStatus('Please enter a Document Name.', 'error');
      return;
    }

    const clientName = getActiveClient();
    const docTypeValue = dest === 'guideline' ? 'guideline' : docType.value;
    const files = selectedFiles.slice();
    queue = files.map((f) => ({
      // When a Drive link is present, the Document Name field belongs to the
      // Drive doc — direct files fall back to their filenames.
      name: files.length === 1 && !driveUrl ? docName.value.trim() : nameFromFile(f),
      status: 'queued',
      error: null,
    }));
    if (driveUrl) {
      queue.push({ name: `${docName.value.trim()} (Drive)`, status: 'queued', error: null, drive: true });
    }

    uploading = true;
    updateSubmitState();
    clearStatus();
    minimizeUpload();
    dock.hidden = false;
    renderQueue();

    for (let i = 0; i < queue.length; i++) {
      queue[i].status = 'uploading';
      renderQueue();
      try {
        if (queue[i].drive) {
          const r = await ingestDriveLink(driveUrl, docName.value.trim(), docTypeValue, clientName);
          queue[i].status = 'done';
          queue[i].error = r.already_running ? 'Already queued for this plant.' : null;
        } else {
          await ingestOne(files[i], queue[i].name, docTypeValue, clientName);
          queue[i].status = 'done';
        }
      } catch (err) {
        queue[i].status = 'failed';
        queue[i].error = err.message;
      }
      renderQueue();
    }

    uploading = false;
    renderQueue();
    resetForm();

    // Refresh the lists + header figures with the new corpus.
    setTimeout(() => { loadDocuments(); loadShellTicker(); }, 1200);

    // All good → the dock tidies itself away after a moment.
    if (!queue.some((q) => q.status === 'failed')) {
      setTimeout(() => { if (!uploading) { dock.hidden = true; queue = []; renderQueue(); } }, 4000);
    }
  });
}

// ─── Documents Page ───────────────────────────────────────────────────────────

const DOC_TYPE_LABELS = {
  guideline:      'Guideline / Standard',
  sop:            'SOP / Procedure',
  technical_spec: 'Technical Spec',
  tariff_petition:'Tariff Petition',
  manual:         'Manual',
  regulatory:     'Regulatory',
  operational:    'Operational',
  plant_specific: 'Plant-Specific',
  other:          'Other',
};

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

// Single re-poll timer while Drive-ingest jobs are in flight — guards against
// stacking multiple timers when loadDocuments is called repeatedly.
let _docsPollTimer = null;
function scheduleDocsPoll() {
  if (_docsPollTimer) return;
  _docsPollTimer = setTimeout(() => {
    _docsPollTimer = null;
    loadDocuments();
    loadShellTicker();
  }, 10000);
}

async function loadDocuments() {
  const bGrid = document.getElementById('benchmark-docs-grid');
  const cGrid = document.getElementById('client-docs-grid');
  if (!bGrid && !cGrid) return;

  if (bGrid) bGrid.innerHTML = `<div class="doc-skeleton">Loading guideline documents…</div>`;
  if (cGrid) cGrid.innerHTML = `<div class="doc-skeleton">Loading plant documents…</div>`;

  const active = getActiveClient();

  // One card per document. Details live ON the card; clicking a card opens the
  // in-app viewer (iframe of its source URL when one exists). Only http(s)
  // source URLs are treated as viewable — source_url is user-supplied at
  // upload time, so it stays escaped/validated (task-034 XSS posture).
  function docCard(d, opts = {}) {
    const typeLabel = DOC_TYPE_LABELS[d.doc_type] || (d.doc_type || '—');
    const url = (d.source_url && /^https?:\/\//i.test(d.source_url)) ? d.source_url : '';
    const chips = [`<span class="doc-chip">PDF</span>`];
    if (opts.system) chips.push(`<span class="doc-chip doc-chip--system">CEA corpus</span>`);
    if (opts.plantAdded) chips.push(`<span class="doc-chip doc-chip--plant">Added for ${escapeHtml((d.client_name || d.client || active))}</span>`);
    const del = opts.deletable
      ? `<button class="btn-delete-doc" data-doc-id="${escapeHtml(d.id)}" data-doc-name="${escapeHtml(d.doc_name || '')}" title="Delete document">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>`
      : '';
    return `
      <div class="doc-card" data-doc-view data-doc-name="${escapeHtml(d.doc_name || 'Document')}" data-doc-url="${escapeHtml(url)}">
        <div class="doc-card-top">
          <div class="doc-card-name">${escapeHtml(d.doc_name || '—')}</div>
          <div class="doc-card-actions">${del}</div>
        </div>
        <div class="doc-card-meta">
          <div><span class="m-label">Type</span><span class="m-val">${escapeHtml(typeLabel)}</span></div>
          <div><span class="m-label">Chunks</span><span class="m-val">${d.chunks_indexed ?? '—'}</span></div>
          <div><span class="m-label">Pages</span><span class="m-val">${d.pages_parsed ?? '—'}</span></div>
          <div><span class="m-label">Ingested</span><span class="m-val">${formatDate(d.ingested_at)}</span></div>
        </div>
        <div class="doc-card-foot">
          ${chips.join('')}
          ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="doc-source-link" title="Open source in new tab" onclick="event.stopPropagation()">↗</a>` : ''}
        </div>
      </div>`;
  }

  try {
    const res  = await fetch(`${BACKEND}/api/list_documents`);
    const data = await res.json();
    const docs = data.documents || [];

    // Everything is scoped to the active plant profile (header selector).
    const seeded = docs.filter(d => d.source_type === 'benchmark' || (!d.source_type && !d.client));
    const mine   = docs.filter(d => (d.source_type === 'client' || (!d.source_type && d.client))
      && ((d.client_name || d.client || '').toLowerCase() === active));
    // Plant-added guidelines live in the Guideline view (deletable), the rest
    // are the operational corpus in the Plant view. The seeded CEA baseline is
    // system-managed — no delete button ever.
    const plantGuidelines = mine.filter(d => d.doc_type === 'guideline');
    const plantDocs       = mine.filter(d => d.doc_type !== 'guideline');

    if (bGrid) {
      const cards = [
        ...seeded.map(d => docCard(d, { system: true })),
        ...plantGuidelines.map(d => docCard(d, { plantAdded: true, deletable: true })),
      ];
      bGrid.innerHTML = cards.length
        ? cards.join('')
        : `<div class="doc-skeleton">No guideline documents found. Run the patch script if you just migrated.</div>`;
    }

    // In-flight Drive ingestions for this plant render as "processing" cards;
    // failed ones surface their error instead of vanishing silently. While any
    // job is queued/processing, the list re-polls itself until the real doc
    // record supersedes the job card.
    const myJobs = (data.jobs || []).filter(j => (j.client_name || '').toLowerCase() === active);
    const jobCard = (j) => {
      const failed = j.status === 'failed';
      return `
      <div class="doc-card doc-card--job${failed ? ' doc-card--job-failed' : ''}">
        <div class="doc-card-top">
          <div class="doc-card-name">${escapeHtml(j.doc_name || 'Document')}</div>
        </div>
        <div class="doc-card-meta">
          <div><span class="m-label">Source</span><span class="m-val">Google Drive</span></div>
          <div><span class="m-label">Status</span><span class="m-val">${failed ? 'FAILED' : (j.status === 'processing' ? 'Indexing…' : 'Queued…')}</span></div>
        </div>
        <div class="doc-card-foot">
          ${failed
            ? `<span class="doc-chip doc-chip--plant">${escapeHtml((j.error || 'Ingestion failed').slice(0, 160))}</span>`
            : `<span class="doc-chip">Background ingest · typically 1–3 min</span>`}
        </div>
      </div>`;
    };

    if (cGrid) {
      const cards = [
        ...myJobs.map(jobCard),
        ...plantDocs.map(d => docCard(d, { deletable: true })),
      ];
      cGrid.innerHTML = cards.length
        ? cards.join('')
        : `<div class="doc-skeleton">No plant documents yet for "${escapeHtml(active)}". Upload this plant's documents to start the assessment.</div>`;
    }

    if (myJobs.some(j => j.status === 'queued' || j.status === 'processing')) {
      scheduleDocsPoll();
    }
  } catch (err) {
    const msg = `<div class="doc-skeleton">Failed to load: ${escapeHtml(err.message)}</div>`;
    if (bGrid) bGrid.innerHTML = msg;
    if (cGrid) cGrid.innerHTML = msg;
    return;
  }

  // ── Flag CEA-required topics with no covering document ────────────────────
  // Cross-references gap_analysis (per active plant) against the doc list just
  // rendered above: any topic detect_gaps.py scored coverage_status === 'gap'
  // has no real document behind it, so we render it as a distinct "missing
  // document" card rather than a normal file card (not clickable-for-preview,
  // no delete button — there's nothing to preview or delete).
  if (cGrid) {
    try {
      const gapRes = await fetch(`${BACKEND}/api/gap_analysis?client_name=${encodeURIComponent(active)}`);
      const gapData = await gapRes.json();
      const missingTopics = (gapData.gaps || []).filter((g) => g.coverage_status === 'gap');
      if (missingTopics.length) {
        cGrid.insertAdjacentHTML('beforeend', missingTopics.map((g) => `
          <div class="doc-card doc-card--gap">
            <div><span class="gap-flag-badge">GAP</span></div>
            <div class="gap-flag-title">${escapeHtml(g.topic || g.gap_id || 'Untitled topic')}</div>
            <div class="gap-flag-desc">${escapeHtml(g.description || 'No document on file covers this CEA-required topic.')}</div>
            <div class="gap-flag-meta">Equipment: ${escapeHtml(g.equipment_tag || '—')} &middot; no covering document found</div>
          </div>`).join(''));
      }
    } catch (_) { /* gap flagging is additive — a failure here shouldn't break the doc list */ }
  }
}

async function deleteDocument(docId, docName) {
  if (!confirm(
    `Delete plant document "${docName}"?\n\n` +
    `This removes all of its chunks from the knowledge base. This cannot be undone.`
  )) return;

  const btn = document.querySelector(`[data-doc-id="${CSS.escape(docId)}"]`);
  if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }

  try {
    const res = await fetch(`${BACKEND}/api/delete_document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': INGEST_KEY },
      body: JSON.stringify({ doc_id: docId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

    // Remove the card immediately for snappy UX, then refresh both grids so
    // empty states and gap flags stay correct.
    const card = btn ? btn.closest('.doc-card') : null;
    if (card) card.remove();
    loadDocuments();
    loadShellTicker();
  } catch (err) {
    alert(`Failed to delete: ${err.message}`);
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

async function clearPlant() {
  const cn = getActiveClient();
  if (!confirm(`Delete ALL documents and gap scores for plant "${cn}"?\n\nRemoves its Qdrant chunks, document records, and risk scores. Guideline documents untouched. Cannot be undone.`)) return;
  try {
    const res = await fetch(`${BACKEND}/api/clear_client`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': INGEST_KEY },
      body: JSON.stringify({ client_name: cn }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
    alert(`Cleared "${cn}": ${data.documents_removed} docs, ${data.chunks_removed} chunks, ${data.risk_scores_removed} risk scores removed.`);
    window.location.reload();
  } catch (err) { alert(`Failed to clear plant: ${err.message}`); }
}

function initDocumentsPage() {
  if (!document.getElementById('benchmark-docs-grid') && !document.getElementById('client-docs-grid')) return;

  loadDocuments();

  const refreshBtn = document.getElementById('docs-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadDocuments);

  const clearBtn = document.getElementById('clear-plant-btn');
  if (clearBtn) clearBtn.addEventListener('click', clearPlant);

  // ── In-app document viewer ─────────────────────────────────────────────────
  // Clicking a card opens the document itself in a popup inside the app —
  // rendered from its source URL. Originals aren't stored server-side (only
  // extracted text is indexed in Qdrant), so cards without a URL get an
  // explanatory fallback instead.
  const viewer         = document.getElementById('doc-viewer-modal');
  const viewerTitle    = document.getElementById('viewer-title');
  const viewerFrame    = document.getElementById('viewer-frame');
  const viewerFallback = document.getElementById('viewer-fallback');
  const viewerOpen     = document.getElementById('viewer-open-original');
  const viewerHint     = document.getElementById('viewer-embed-hint');

  // Most "preview is failing" cases are sites sending X-Frame-Options/CSP
  // frame-ancestors, which makes a plain iframe render silently blank.
  // Normalize known providers to their embeddable form:
  //  - Google Drive share links → the officially embeddable /preview URL
  //  - Dropbox share links → ?raw=1 (direct file, which iframes fine for PDFs)
  // Everything else passes through unchanged, with a visible hint that a
  // blank pane means the source blocks embedding (Open original still works).
  function toEmbeddableUrl(url) {
    const drive = url.match(/^https:\/\/drive\.google\.com\/(?:file\/d\/([A-Za-z0-9_-]{10,})|(?:open|uc)\?(?:[^#]*&)?id=([A-Za-z0-9_-]{10,}))/i);
    if (drive) return `https://drive.google.com/file/d/${drive[1] || drive[2]}/preview`;
    const docsG = url.match(/^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{10,})/i);
    if (docsG) return `https://docs.google.com/${docsG[1]}/d/${docsG[2]}/preview`;
    if (/^https:\/\/(www\.)?dropbox\.com\/.+/i.test(url)) return url.replace(/([?&])dl=0/, '$1raw=1');
    return url;
  }

  function openViewer(name, url) {
    if (!viewer) return;
    viewerTitle.textContent = name || 'Document';
    if (url && /^https?:\/\//i.test(url)) {
      const embedUrl = toEmbeddableUrl(url);
      viewerFrame.src = embedUrl;
      viewerFrame.style.display = '';
      viewerFallback.style.display = 'none';
      viewerOpen.href = url;
      viewerOpen.style.display = '';
      // The hint only matters for third-party pages we couldn't normalize —
      // Drive /preview and direct PDFs embed reliably.
      if (viewerHint) viewerHint.style.display = (embedUrl === url && !/\.pdf(\?|#|$)/i.test(url)) ? '' : 'none';
    } else {
      viewerFrame.src = 'about:blank';
      viewerFrame.style.display = 'none';
      viewerFallback.style.display = '';
      viewerFallback.innerHTML = `<strong>${escapeHtml(name || 'This document')}</strong>
        <span>No stored original for this document — only its extracted text is indexed for search.
        Documents uploaded from now on keep a preview copy automatically; older ones can be
        re-uploaded (or given a Source URL) to enable in-app preview.</span>`;
      viewerOpen.style.display = 'none';
      if (viewerHint) viewerHint.style.display = 'none';
    }
    viewer.classList.add('active');
  }

  function closeViewer() {
    if (!viewer) return;
    viewer.classList.remove('active');
    viewerFrame.src = 'about:blank';
  }

  // Card + delete delegation
  document.addEventListener('click', (e) => {
    const del = e.target.closest('.btn-delete-doc');
    if (del) {
      e.stopPropagation();
      if (del.dataset.docId) deleteDocument(del.dataset.docId, del.dataset.docName);
      return;
    }
    const card = e.target.closest('[data-doc-view]');
    if (card) {
      if (e.target.closest('a')) return; // the ↗ source link handles itself
      openViewer(card.dataset.docName, card.dataset.docUrl || '');
    }
  });

  const viewerCloseBtn = document.getElementById('viewer-close-btn');
  if (viewerCloseBtn && viewer) {
    viewerCloseBtn.addEventListener('click', closeViewer);
    viewer.addEventListener('click', (e) => { if (e.target === viewer) closeViewer(); });
  }
}

// ─── SPA Shell — in-page view router (index.html single-page app) ────────────
// Tiles switch views with showView(); no full-page navigation. Matches the
// approved thermiq_mockup.html interaction pattern (its showScreen()).

const SPA_VIEWS = ['home', 'chat', 'graph', 'guideline', 'plant', 'sheet'];
let _graphViewStarted = false;
let _graphNetwork = null;

function isSpaShell() {
  return !!document.getElementById('view-home');
}

function showView(name, opts = {}) {
  if (!isSpaShell()) return;
  if (!SPA_VIEWS.includes(name)) name = 'home';

  SPA_VIEWS.forEach((v) => {
    const el = document.getElementById('view-' + v);
    if (el) el.classList.toggle('active', v === name);
  });
  document.body.setAttribute('data-view', name);
  // The chat view needs the full-height app frame (fixed header, hidden footer)
  // that style.css keys off body.chat-page — reuse it rather than duplicate it.
  document.body.classList.toggle('chat-page', name === 'chat');

  const hash = name === 'home' ? '#/' : '#/' + name;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  window.scrollTo(0, 0);

  if (name === 'chat') {
    // The messages pane can't measure scrollHeight while hidden — snap to
    // bottom now that it's visible again.
    const m = document.getElementById('chat-messages');
    if (m) m.scrollTop = m.scrollHeight;
  }

  if (name === 'graph') {
    // vis-network can't size itself inside display:none — init lazily on first
    // show, then just re-fit on subsequent shows.
    if (!_graphViewStarted) {
      _graphViewStarted = true;
      initGraphView();
    } else if (_graphNetwork) {
      _graphNetwork.redraw();
      _graphNetwork.fit();
    }
  }

  if (opts.scrollTo) {
    const target = document.getElementById(opts.scrollTo);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
}

function routeFromHash() {
  const name = (location.hash || '').replace(/^#\/?/, '');
  showView(name || 'home');
}

async function loadShellTicker() {
  if (!isSpaShell()) return;
  const client = getActiveClient();
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  // Live Sheet CSV feed link (api/sheet_sync, read-only)
  const csvLink = document.getElementById('sheet-csv-link');
  if (csvLink) csvLink.href = `${BACKEND}/api/sheet_sync?client_name=${encodeURIComponent(client)}`;

  try {
    const r = await fetch(`${BACKEND}/api/gap_analysis?client_name=${encodeURIComponent(client)}`);
    const d = await r.json();
    set('ticker-risk', `₹${(d.total_risk_cr ?? 0)} Cr`);
    set('ticker-gaps', String(d.gap_count ?? '—'));
    set('tile-risk-2', `₹${(d.total_risk_cr ?? 0)} Cr at risk`);
    set('tile-sheet-count', `${(d.gaps || []).length} rows`);
  } catch (_) { /* ticker keeps the em-dash placeholders */ }

  try {
    const r = await fetch(`${BACKEND}/api/list_documents`);
    const d = await r.json();
    const docs = d.documents || [];
    const guidelineCount = docs.filter((doc) => doc.source_type === 'benchmark').length;
    const plantCount = docs.filter((doc) => doc.source_type === 'client' && (doc.client_name || doc.client || '').toLowerCase() === client).length;
    // Scoped to what's actually relevant to the active plant: its own docs plus
    // the shared CEA guideline corpus every plant is benchmarked against — NOT
    // every other plant's chunks too (was previously summing across all clients,
    // so this number never changed when switching plants — YC caught this).
    const totalChunks = docs
      .filter((doc) => doc.source_type === 'benchmark' || ((doc.client_name || doc.client || '').toLowerCase() === client))
      .reduce((s, doc) => s + (Number(doc.chunks_indexed) || 0), 0);
    set('tile-guideline-count', `${guidelineCount} DOCS`);
    set('tile-plant-count', `${plantCount} DOCS`);
    if (totalChunks > 0) {
      set('ticker-chunks', totalChunks.toLocaleString('en-IN'));
      set('tile-chunks', `${totalChunks.toLocaleString('en-IN')} CHUNKS INDEXED`);
    }
  } catch (_) { /* tiles keep their placeholders */ }
}

function initShell() {
  if (!isSpaShell()) return;

  // Tile / back-link / wordmark navigation — event delegation, in-page only.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-view-target]');
    if (!el) return;
    e.preventDefault();
    showView(el.dataset.viewTarget, { scrollTo: el.dataset.scrollTo });
  });
  window.addEventListener('hashchange', routeFromHash);

  initHubOutagesToggle();
  const reportBtn = document.getElementById('risk-report-btn');
  if (reportBtn) reportBtn.addEventListener('click', generateRiskReport);

  loadShellTicker();
  routeFromHash();
}

// ─── One-click Risk Report (print → save as PDF) ─────────────────────────────
// Uses the SAME data and aggregation rules as the Live Sheet view: only
// CEA-outage-backed rows are priced into the headline; unquantifiable topics
// are listed as documentation needed, never given a fabricated ₹ figure.
async function generateRiskReport() {
  const btn = document.getElementById('risk-report-btn');
  const client = getActiveClient();
  if (btn) { btn.disabled = true; btn.textContent = 'Building report…'; }

  try {
    const [gapRes, docRes] = await Promise.all([
      fetch(`${BACKEND}/api/gap_analysis?client_name=${encodeURIComponent(client)}`),
      fetch(`${BACKEND}/api/list_documents`),
    ]);
    const gapData = await gapRes.json();
    const docData = await docRes.json();
    const gaps = gapData.gaps || [];
    if (!gaps.length) throw new Error('No gap analysis data for this plant yet.');

    const quantified = gaps.filter(g => (g.linked_outages || 0) > 0)
      .sort((a, b) => (b.risk_score_cr || 0) - (a.risk_score_cr || 0));
    const needsDocs  = gaps.filter(g => (g.linked_outages || 0) === 0 && g.coverage_status !== 'covered');
    const covered    = gaps.filter(g => g.coverage_status === 'covered');
    const totalRisk  = quantified.reduce((s, g) => s + (g.risk_score_cr || 0), 0);
    const gapCount   = gaps.filter(g => g.coverage_status === 'gap').length;
    const partialCount = gaps.filter(g => g.coverage_status === 'partial').length;

    const docs = (docData.documents || []).filter(d =>
      d.source_type === 'client' && (d.client_name || d.client || '').toLowerCase() === client);

    const outages = (_ceaOutagesCache || []).slice(0, 10);

    const esc = escapeHtml;
    const covLabel = { covered: 'Covered', partial: 'Partial', gap: 'Gap' };
    const covColor = { covered: '#22c55e', partial: '#f59e0b', gap: '#ef4444' };

    const gapRows = quantified.map((g, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(g.equipment_tag || '—')}</td>
        <td>${esc(g.description || g.topic || '—')}<div class="src">${esc(g.criticality_source || '')}</div></td>
        <td><span class="cov" style="background:${covColor[g.coverage_status] || '#ef4444'}">${covLabel[g.coverage_status] || 'Gap'}</span><div class="src">${Math.round((g.best_match_score || 0) * 100)}% doc match</div></td>
        <td>${g.criticality_score || '—'}/5</td>
        <td>${g.linked_outages || 0}</td>
        <td class="num">₹${(g.risk_score_cr || 0).toFixed(1)} Cr</td>
      </tr>`).join('');

    const needRows = needsDocs.map(g => `
      <tr>
        <td>${esc(g.equipment_tag || '—')}</td>
        <td>${esc(g.description || g.topic || '—')}</td>
        <td><span class="cov" style="background:${covColor[g.coverage_status] || '#ef4444'}">${covLabel[g.coverage_status] || 'Gap'}</span></td>
      </tr>`).join('');

    const outageRows = outages.map(o => `
      <tr>
        <td>${esc(o.station)} U${esc(o.unit)}</td>
        <td>${esc(o.equipment_tag)}</td>
        <td>${esc(o.failure_reason_raw)}</td>
        <td class="num">₹${esc(o.revenue_lost_est_cr)} Cr</td>
        <td>${esc(o.date_out)}</td>
      </tr>`).join('');

    const now = new Date();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>ThermIQ Risk Report — ${esc(client.toUpperCase())}</title>
<style>
  @page { margin: 18mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Inter, Arial, sans-serif; color: #1a2233; margin: 0; font-size: 11.5px; line-height: 1.45; }
  .band { background: #0d1321; color: #fff; padding: 22px 26px; }
  .band h1 { margin: 0; font-size: 20px; letter-spacing: 0.04em; }
  .band h1 b { color: #14b8a6; }
  .band .meta { color: #9aa4b8; margin-top: 6px; font-size: 11px; }
  .wrap { padding: 20px 26px; }
  .stats { display: flex; gap: 12px; margin: 14px 0 22px; }
  .stat { flex: 1; border: 1px solid #d7dbe3; border-radius: 8px; padding: 12px 14px; }
  .stat .v { font-size: 20px; font-weight: 700; }
  .stat .l { color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
  .orange { color: #f59e0b; } .red { color: #ef4444; } .green { color: #22c55e; }
  h2 { font-size: 14px; border-bottom: 2px solid #0d1321; padding-bottom: 5px; margin: 26px 0 10px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #141b2e; color: #fff; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 6px 8px; border-bottom: 1px solid #e5e8ef; vertical-align: top; }
  td.num { text-align: right; font-weight: 700; white-space: nowrap; }
  .cov { color: #fff; font-weight: 700; font-size: 9.5px; padding: 2px 7px; border-radius: 9px; text-transform: uppercase; }
  .src { color: #6b7280; font-size: 9.5px; margin-top: 2px; }
  .note { background: #f4f6fa; border-left: 3px solid #14b8a6; padding: 10px 12px; font-size: 10.5px; color: #3c4557; margin: 14px 0; }
  .foot { color: #6b7280; font-size: 9.5px; margin-top: 26px; border-top: 1px solid #d7dbe3; padding-top: 8px; }
  tr { page-break-inside: avoid; }
</style></head><body>
  <div class="band">
    <h1>THERM<b>IQ</b> — Knowledge Risk Report</h1>
    <div class="meta">Plant profile: <b style="color:#fff">${esc(client.toUpperCase())}</b> &nbsp;·&nbsp; Generated ${now.toLocaleString()} &nbsp;·&nbsp; ${docs.length} plant document(s) on file &nbsp;·&nbsp; Benchmark: 19-topic CEA guideline baseline</div>
  </div>
  <div class="wrap">
    <div class="stats">
      <div class="stat"><div class="v orange">₹${Math.round(totalRisk)} Cr</div><div class="l">Total quantified risk exposure</div></div>
      <div class="stat"><div class="v red">${gapCount}</div><div class="l">Undocumented topics (gaps)</div></div>
      <div class="stat"><div class="v">${partialCount}</div><div class="l">Partially documented</div></div>
      <div class="stat"><div class="v green">${covered.length}</div><div class="l">Covered areas</div></div>
    </div>

    <div class="note"><b>Methodology.</b> Risk = Criticality (1–5, sourced from CEA forced-outage frequency and CERC penalty rules) × Consequence (₹ Cr, derived from real CEA forced-outage records × ₹5.0/kWh, LBNL/Ember 2024 India coal fleet avg) × Exposure (1 − best plant-document match score). <b>Only topics with real CEA outage history for their equipment type are priced</b>; everything else is listed under Documentation Needed with no assumed ₹ figure.</div>

    <h2>Ranked Knowledge Gaps — Quantified (${quantified.length})</h2>
    <table>
      <thead><tr><th>#</th><th>Equipment</th><th>Gap</th><th>Coverage</th><th>Crit.</th><th>CEA Outages</th><th>Risk</th></tr></thead>
      <tbody>${gapRows || '<tr><td colspan="7">None</td></tr>'}</tbody>
    </table>

    <h2>Documentation Needed — Not Yet Quantifiable (${needsDocs.length})</h2>
    <p style="color:#6b7280;font-size:10.5px;margin:4px 0 8px">No CEA-wide forced-outage history exists for these equipment types, so no ₹ figure is assigned. A missing document here is a known open item, not an assumed incident risk.</p>
    <table>
      <thead><tr><th>Equipment</th><th>Topic</th><th>Coverage</th></tr></thead>
      <tbody>${needRows || '<tr><td colspan="3">None — all topics quantified or covered</td></tr>'}</tbody>
    </table>

    ${outageRows ? `
    <h2>Recent CEA Forced Outages (fleet-wide, latest 10)</h2>
    <table>
      <thead><tr><th>Station</th><th>Equipment</th><th>Failure reason</th><th>Revenue impact</th><th>Date</th></tr></thead>
      <tbody>${outageRows}</tbody>
    </table>` : ''}

    <div class="foot">
      Generated by ThermIQ — Industrial Knowledge Intelligence · therm-iq.vercel.app · Data sources: CEA Daily Outage Reports (npp.gov.in), plant document corpus (Qdrant vector scan), Neo4j knowledge graph. Scoring engine: scripts/detect_gaps.py (single source of truth). All figures trace to cited records; assumptions are labelled.
    </div>
  </div>
  <script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 300); });</script>
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) throw new Error('Popup blocked — allow popups for this site and retry.');
    w.document.write(html);
    w.document.close();
  } catch (err) {
    alert('Could not build the risk report: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Risk Report (PDF)'; }
  }
}

// ─── Risk & Gap Graph view (moved from graph.html — logic unchanged) ─────────
// vis-network rendering verified live in task-035/039. Only the mounting
// changed (lazy in-page init instead of a standalone page's inline script).

function initGraphView() {
  const statusEl  = document.getElementById('graph-status');
  const emptyEl   = document.getElementById('graph-panel-empty');
  const contentEl = document.getElementById('graph-panel-content');
  if (!statusEl || !contentEl) return;

  const NODE_COLORS = {
    Equipment:   { border: '#60a5fa', background: 'rgba(96,165,250,0.14)' },
    FailureMode: { border: '#a1a1aa', background: 'rgba(161,161,170,0.12)' },
    Procedure:   { border: '#4ade80', background: 'rgba(74,222,128,0.12)' },
    Regulation:  { border: '#f59e0b', background: 'rgba(245,158,11,0.12)' },
    OutageEvent: { border: '#fbbf24', background: 'rgba(251,191,36,0.14)' },
    Role:        { border: '#a1a1aa', background: 'rgba(161,161,170,0.10)' },
  };
  const GAP_COLOR = { border: '#f87171', background: 'rgba(248,113,113,0.16)' };

  function shortLabel(str, len = 22) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len - 1) + '…' : str;
  }

  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${r.status})`);
    }
    return r.json();
  }

  function renderPanelNode(node) {
    emptyEl.style.display = 'none';
    contentEl.style.display = 'block';
    const rows = Object.entries(node)
      .filter(([k]) => !['id', 'node_type', 'label'].includes(k))
      .map(([k, v]) => `<div class="panel-row"><span class="panel-key">${escapeHtml(k)}</span><span class="panel-val">${escapeHtml(v)}</span></div>`)
      .join('');
    contentEl.innerHTML = `
      <div class="panel-badge">${escapeHtml(node.node_type || 'Node')}</div>
      <h3>${escapeHtml(node.label || node.id)}</h3>
      ${rows}
    `;
  }

  async function renderPanelTraversal(fmId) {
    emptyEl.style.display = 'none';
    contentEl.style.display = 'block';
    contentEl.innerHTML = `<div class="panel-badge gap">Loading traversal…</div>`;
    try {
      const data = await fetchJson(`${BACKEND}/api/graph_query?type=traversal&failure_mode_id=${encodeURIComponent(fmId)}`);
      const g = data.gap || {};
      const statusLabel = g.status === 'ABSENT' ? 'No procedure documented' : (g.status || 'Unknown');

      const outageRows = (data.outages || []).slice(0, 8).map((ev) => `
        <tr>
          <td>${escapeHtml(ev.station)}</td>
          <td>${escapeHtml(ev.unit)}</td>
          <td>${escapeHtml(ev.mw_lost)}</td>
          <td class="risk-hi">₹${(ev.revenue_cr || 0).toFixed ? ev.revenue_cr.toFixed(1) : ev.revenue_cr}</td>
        </tr>
      `).join('') || `<tr><td colspan="4">No linked outage events found.</td></tr>`;

      const regList = (data.regulations || []).map((r) => `<li>${escapeHtml(r.label)}</li>`).join('')
        || '<li>No mandating regulation linked.</li>';

      contentEl.innerHTML = `
        <div class="panel-badge gap">Gap traversal</div>
        <h3>${escapeHtml(g.failure_mode || fmId)}</h3>
        <p class="panel-chain">
          <strong>${escapeHtml(g.equipment || '—')}</strong> →
          <strong>${escapeHtml(g.failure_mode || '—')}</strong> →
          ${g.procedure ? escapeHtml(g.procedure) : '<em>no procedure</em>'}
          (<span class="risk-hi">${escapeHtml(statusLabel)}</span>${g.criticality ? `, criticality ${escapeHtml(g.criticality)}/5` : ''})
        </p>

        <h4>Real ₹ outages linked to this failure mode</h4>
        <table class="sheet-mini">
          <thead><tr><th>Station</th><th>Unit</th><th>MW</th><th>₹ Cr</th></tr></thead>
          <tbody>${outageRows}</tbody>
        </table>
        <p class="panel-total">Total exposure: <span class="risk-hi">₹${data.total_revenue_cr ?? 0} Cr</span> across ${data.outage_count ?? 0} event(s)</p>

        <h4>Mandating regulation(s)</h4>
        <ul class="panel-reg-list">${regList}</ul>
      `;
    } catch (e) {
      contentEl.innerHTML = `<div class="panel-badge gap">Error</div><p>${escapeHtml(e.message)}</p>`;
    }
  }

  async function init() {
    try {
      const [overview, gapsData] = await Promise.all([
        fetchJson(`${BACKEND}/api/graph_query?type=overview`),
        fetchJson(`${BACKEND}/api/graph_query?type=gaps`),
      ]);

      const gapFmIds = new Set((gapsData.gaps || []).map((g) => g.failure_mode_id));
      const nodesById = {};
      (overview.nodes || []).forEach((n) => { nodesById[n.id] = n; });

      const visNodes = (overview.nodes || []).map((n) => {
        const isGapNode = n.node_type === 'FailureMode' && gapFmIds.has(n.id);
        const color = isGapNode ? GAP_COLOR : (NODE_COLORS[n.node_type] || NODE_COLORS.Role);
        const node = {
          id: n.id,
          label: shortLabel(n.label || n.id),
          shape: n.node_type === 'OutageEvent' ? 'dot' : 'box',
          color: { border: color.border, background: color.background, highlight: color },
          borderWidth: isGapNode ? 3 : 1.5,
          font: { color: '#e7eaee', face: 'JetBrains Mono', size: 11 },
          _raw: n,
          _isGap: isGapNode,
        };
        if (n.node_type === 'OutageEvent') node.size = 8;
        if (isGapNode) node.shapeProperties = { borderDashes: [6, 4] };
        return node;
      });

      const visEdges = (overview.edges || []).map((e) => ({
        from: e.source,
        to: e.target,
        arrows: 'to',
        label: e.rel_type.replace(/_/g, ' '),
        font: { size: 8, color: '#8b94a3', strokeWidth: 0, align: 'middle' },
        color: { color: 'rgba(255,255,255,0.18)', highlight: '#f59e0b' },
        smooth: { type: 'continuous' },
      }));

      const container = document.getElementById('graph-canvas');
      const data = {
        nodes: new vis.DataSet(visNodes),
        edges: new vis.DataSet(visEdges),
      };
      const options = {
        physics: {
          solver: 'forceAtlas2Based',
          forceAtlas2Based: { gravitationalConstant: -60, springLength: 130, avoidOverlap: 0.6 },
          stabilization: { iterations: 200 },
        },
        interaction: { hover: true, tooltipDelay: 150 },
        layout: { improvedLayout: true },
      };
      const network = new vis.Network(container, data, options);
      _graphNetwork = network;

      statusEl.textContent = `${overview.node_count} nodes · ${overview.edge_count} edges · ${gapsData.gap_count} flagged gaps`;

      network.on('click', (params) => {
        if (!params.nodes || params.nodes.length === 0) return;
        const nodeId = params.nodes[0];
        const node = nodesById[nodeId];
        if (!node) return;
        const isGapNode = node.node_type === 'FailureMode' && gapFmIds.has(node.id);
        if (isGapNode) {
          renderPanelTraversal(node.id);
        } else {
          renderPanelNode(node);
        }
      });
    } catch (e) {
      statusEl.textContent = `Failed to load graph: ${e.message}`;
    }
  }

  init();
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

initQueryCopilot();
initDashboard();
initUpload();
initDocumentsPage();
initShell();

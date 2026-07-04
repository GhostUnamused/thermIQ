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
  ).join('');
  // Guard against double-wiring — initUpload and initDashboard both call this
  // on the single-page shell, and duplicate listeners would double-reload.
  if (!sel.dataset.wired) {
    sel.dataset.wired = '1';
    sel.addEventListener('change', () => { setActiveClient(sel.value); window.location.reload(); });
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
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
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
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

function loadStore() {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* corrupt — fall through */ }

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
    localStorage.setItem(CHATS_KEY, JSON.stringify(store));
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
      try { localStorage.setItem(CHATS_KEY, JSON.stringify(store)); } catch (e2) { /* give up */ }
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
      actionsHtml = `<div class="msg-actions">${timestampHtml}${copyBtn}${regenBtnHtml}</div>`;
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
    return `<div class="chat-bubble assistant-bubble">
      <div class="bubble-text">${DOMPurify.sanitize(marked.parse(msg.content || ''))}</div>
      ${sourcesHtml(msg.sources)}
      ${isFallback ? `<div class="bubble-meta">↩ fallback via ${escapeHtml(msg.model_used)}</div>` : ''}
      ${actionsHtml}
    </div>`;
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
    + '<span class="typing-status">Searching knowledge base…</span>';
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
      <div class="chat-item${isActive ? ' active' : ''}" data-chat-id="${id}">
        <div class="chat-item-icon">Q</div>
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
  const overlay    = document.getElementById('sidebar-overlay');
  const toggleBtn  = document.getElementById('sidebar-toggle-btn');
  const resizer    = document.getElementById('sidebar-resizer');
  const appLayout  = document.querySelector('.app-layout');
  if (!sidebar) return;

  function openSidebar() {
    sidebar.classList.add('open');
    if (overlay) overlay.classList.add('visible');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        if (sidebar.classList.contains('open')) {
          closeSidebar();
        } else {
          openSidebar();
        }
      } else {
        if (appLayout) appLayout.classList.toggle('sidebar-collapsed');
      }
    });
  }

  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

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

  // Close sidebar when switching chats on mobile
  return { closeSidebar };
}

// ─── API call helper ─────────────────────────────────────────────────────────

async function callAPI(query, history, client) {
  const res = await fetch(`${BACKEND}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, client: client || '', history }),
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

  // ── Chip clicks → populate input ──
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      inputEl.value = chip.dataset.query || '';
      inputEl.dispatchEvent(new Event('input'));
      inputEl.focus();
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
  async function submit() {
    const query = inputEl.value.trim();
    if (!query || sendBtn.disabled) return;

    // Reset input
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;

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
      const clientSelect = document.getElementById('client-select');
      const client = clientSelect ? clientSelect.value : '';

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
          answerData = await callAPI(query, history, client);
          success = true;
        } catch (err) {
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
        content: `**Error:** ${err.message}${err.message.includes('504') ? ' (Timeout)' : ''}\n\nThe server timed out or failed to respond after multiple attempts. Please try again.`,
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

  sendBtn.addEventListener('click', submit);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  });

  // ── Message action delegation (copy / edit / rerun / cancel) ──
  // (messagesEl is already defined for the scroll-bottom handler)
  if (messagesEl) {
    messagesEl.addEventListener('click', async (e) => {
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

        const clientSelect = document.getElementById('client-select');
        const client = clientSelect ? clientSelect.value : '';
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
async function loadCeaOutages(outagesBody) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s timeout
    try {
      const response = await fetch(`${BACKEND}/api/cea_outage`, { signal: controller.signal });
      clearTimeout(timeout);
      const data = await response.json();
      const outages = (data.outages || []).slice(0, 10);

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
    } catch (fetchErr) {
      clearTimeout(timeout);
      throw fetchErr;
    }
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Timed out loading outages.' : `Failed to load outages: ${escapeHtml(err.message)}`;
    outagesBody.innerHTML = `<tr><td colspan="7" class="skeleton-row">${msg}</td></tr>`;
  }
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
        gapsBody.innerHTML = `<tr><td colspan="6" class="skeleton-row">No gap analysis data. Run the gap scanner first.</td></tr>`;
      } else {
        const totalRisk = gaps.reduce((sum, g) => sum + (g.risk_score_cr || 0), 0);
        // Card label is "Critical Gaps (> ₹100 Cr)" — count by ₹ risk, not status.
        const over100Count = gaps.filter(g => (g.risk_score_cr || 0) > 100).length;
        const coveredCount = gaps.filter(g => g.coverage_status === 'covered').length;
        const gapCount     = gaps.filter(g => g.coverage_status === 'gap').length;

        if (totalRiskEl)  totalRiskEl.textContent  = `₹${Math.round(totalRisk)} Cr`;
        if (criticalEl)   criticalEl.textContent    = over100Count;
        if (coveredEl)    coveredEl.textContent      = coveredCount;
        if (gapsCountEl)  gapsCountEl.textContent    = `${gapCount}`;

        gapsBody.innerHTML = gaps.map((g, i) => {
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
  const dropZone = document.getElementById('upload-drop-zone');
  if (!dropZone) return;

  const fileInput    = document.getElementById('upload-file-input');
  const docName      = document.getElementById('upload-doc-name');
  const clientNameEl = document.getElementById('upload-client-name');
  const clientField  = document.getElementById('upload-client-name-field');
  const docType      = document.getElementById('upload-doc-type');
  const sourceUrl    = document.getElementById('upload-source-url');
  const submitBtn    = document.getElementById('upload-submit-btn');
  const btnText      = document.getElementById('upload-btn-text');
  const statusEl     = document.getElementById('upload-status');
  const fileLabel    = document.getElementById('upload-file-name');

  // Must stay under Vercel's ~4.5 MB request-body cap after base64 (+33%) overhead —
  // larger files die at the platform edge with an opaque 413.
  const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
  let selectedFiles = [];   // supports multiple files at once

  // Default the plant name to the active client, and populate the selector.
  if (clientNameEl && !clientNameEl.value) clientNameEl.value = getActiveClient();
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

  // ── Source type radio helpers ─────────────────────────────────────────────
  function getSourceType() {
    const checked = document.querySelector('input[name="source_type"]:checked');
    return checked ? checked.value : 'client';
  }

  function onSourceTypeChange() {
    const isClient = getSourceType() === 'client';
    if (clientField) {
      clientField.style.display = isClient ? '' : 'none';
    }
    updateSubmitState();
  }

  // Wire up radio buttons
  document.querySelectorAll('input[name="source_type"]').forEach(radio => {
    radio.addEventListener('change', onSourceTypeChange);
  });
  onSourceTypeChange(); // set initial state

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

  function updateSubmitState() {
    const sourceType = getSourceType();
    const needsClientName = sourceType === 'client';
    const clientNameOk = !needsClientName || (clientNameEl && clientNameEl.value.trim());
    // With multiple files each doc is named from its filename, so the single
    // Document Name field is only required when exactly one file is selected.
    const nameOk = selectedFiles.length > 1 || docName.value.trim();
    const ready = selectedFiles.length >= 1 && nameOk && clientNameOk;
    submitBtn.disabled = !ready;
    if (btnText && !submitBtn.disabled) {
      btnText.textContent = selectedFiles.length > 1
        ? `Ingest ${selectedFiles.length} Documents`
        : 'Ingest Document';
    }
  }

  // Turn a filename into a readable document name.
  function nameFromFile(file) {
    return file.name.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ').trim();
  }

  // ── File handling (accepts one or many) ────────────────────────────────────
  function handleFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const accepted = [];
    const skipped = [];
    for (const file of incoming) {
      if (!file.name.toLowerCase().endsWith('.pdf')) { skipped.push(`${file.name} (not a PDF)`); continue; }
      if (file.size > MAX_BYTES) { skipped.push(`${file.name} (>3 MB)`); continue; }
      accepted.push(file);
    }

    if (!accepted.length) {
      setStatus(`No files added. ${skipped.join('; ')}`, 'error');
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
  if (clientNameEl) clientNameEl.addEventListener('input', updateSubmitState);

  const readAsBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  async function ingestOne(file, docNameValue, sourceType, clientName) {
    const base64 = await readAsBase64(file);
    const res = await fetch(`${BACKEND}/api/ingest_document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': INGEST_KEY },
      body: JSON.stringify({
        pdf_base64:  base64,
        doc_name:    docNameValue,
        doc_type:    docType.value,
        source_url:  sourceUrl.value.trim(),
        source_type: sourceType,
        client_name: clientName,
        client:      clientName, // legacy field — keep for compat
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || `Server error ${res.status}`);
    return data;
  }

  // ── Submit (handles one OR many files, sequentially) ────────────────────────
  submitBtn.addEventListener('click', async () => {
    if (!selectedFiles.length) return;

    const sourceType = getSourceType();
    const clientName = (clientNameEl ? clientNameEl.value.trim() : '').toLowerCase();

    if (sourceType === 'client' && !clientName) {
      setStatus('Please enter a Client / Plant Name (e.g. ntpc_lara) for client documents.', 'error');
      return;
    }
    if (selectedFiles.length === 1 && !docName.value.trim()) {
      setStatus('Please enter a Document Name.', 'error');
      return;
    }

    submitBtn.disabled = true;
    clearStatus();

    const sourceLabel = sourceType === 'client' ? `plant "${clientName}"` : 'guideline corpus';
    const results = [];
    const failures = [];

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      // Single file → editable name field; multiple → derive from each filename.
      const thisName = selectedFiles.length === 1
        ? docName.value.trim()
        : nameFromFile(file);
      const counter = selectedFiles.length > 1 ? `(${i + 1}/${selectedFiles.length}) ` : '';
      btnText.textContent = `Uploading ${i + 1}/${selectedFiles.length}…`;
      setStatus(`${counter}Ingesting "${thisName}" into ${sourceLabel} — embedding via Jina AI…`, 'info');

      try {
        const data = await ingestOne(file, thisName, sourceType, clientName);
        results.push(`"${data.doc_name}": ${data.chunks_indexed} chunks / ${data.pages_parsed} pages`);
      } catch (err) {
        failures.push(`"${thisName}": ${err.message}`);
      }
    }

    // Summary
    if (failures.length === 0) {
      setStatus(`Ingested ${results.length} document(s) into ${sourceLabel}. ${results.join(' · ')}`, 'success');
    } else if (results.length === 0) {
      setStatus(`All ${failures.length} upload(s) failed. ${failures.join(' · ')}`, 'error');
    } else {
      setStatus(`Ingested ${results.length}, failed ${failures.length}. Failed: ${failures.join(' · ')}`, 'error');
    }

    // Reset file selection (keep plant name + doc type for convenience on repeat uploads)
    selectedFiles = [];
    fileInput.value = '';
    docName.value = '';
    if (sourceUrl) sourceUrl.value = '';
    fileLabel.textContent = 'No files selected · PDF only · max ~3 MB each · multiple allowed';
    dropZone.classList.remove('has-file');
    btnText.textContent = 'Ingest Document';
    submitBtn.disabled = true;

    setTimeout(loadDocuments, 1500);
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

async function loadDocuments() {
  // Both bodies must exist on this page
  const benchmarkBody = document.getElementById('benchmark-docs-body');
  const clientBody    = document.getElementById('client-docs-body');
  if (!benchmarkBody && !clientBody) return;

  if (benchmarkBody) benchmarkBody.innerHTML = `<tr><td colspan="6" class="skeleton-row">Loading…</td></tr>`;
  if (clientBody)    clientBody.innerHTML    = `<tr><td colspan="8" class="skeleton-row">Loading…</td></tr>`;

  try {
    const res  = await fetch(`${BACKEND}/api/list_documents`);
    const data = await res.json();
    const docs = data.documents || [];

    const benchmarks = docs.filter(d => d.source_type === 'benchmark' || (!d.source_type && !d.client));
    const clients    = docs.filter(d => d.source_type === 'client'    || (!d.source_type && d.client));

    // ── Benchmark rows (no delete button) ─────────────────────────────────
    if (benchmarkBody) {
      if (!benchmarks.length) {
        benchmarkBody.innerHTML = `<tr><td colspan="6" class="skeleton-row">No guideline documents found. Run the patch script if you just migrated.</td></tr>`;
      } else {
        benchmarkBody.innerHTML = benchmarks.map(d => {
          const typeLabel  = DOC_TYPE_LABELS[d.doc_type] || escapeHtml(d.doc_type || '—');
          const sourceLink = d.source_url
            ? `<a href="${escapeHtml(d.source_url)}" target="_blank" rel="noopener" class="doc-source-link">↗</a>`
            : '—';
          return `
            <tr class="doc-row-benchmark">
              <td class="doc-name-cell">
                ${escapeHtml(d.doc_name || '—')}
                <span class="doc-lock-icon" title="Guideline document — locked">Locked</span>
              </td>
              <td data-label="Type">${typeLabel}</td>
              <td data-label="Chunks">${d.chunks_indexed ?? '—'}</td>
              <td data-label="Pages">${d.pages_parsed ?? '—'}</td>
              <td data-label="Ingested">${formatDate(d.ingested_at)}</td>
              <td data-label="Source">${sourceLink}</td>
              <td>
                <button class="btn-preview-doc btn-icon-only"
                  data-doc-name="${escapeHtml(d.doc_name || '')}"
                  data-client="— (Guideline)"
                  data-type="${escapeHtml(typeLabel)}"
                  data-chunks="${d.chunks_indexed ?? '—'}"
                  data-date="${formatDate(d.ingested_at)}"
                  data-source="${escapeHtml(d.source_url || '')}"
                  title="Preview details">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
              </td>
            </tr>`;
        }).join('');
      }
    }

    // ── Client rows (with delete button) ──────────────────────────────────
    if (clientBody) {
      if (!clients.length) {
        clientBody.innerHTML = `<tr><td colspan="8" class="skeleton-row">No plant documents yet. Upload a plant's documents above.</td></tr>`;
      } else {
        clientBody.innerHTML = clients.map(d => {
          const plantName  = d.client_name || d.client || '—';
          const typeLabel  = DOC_TYPE_LABELS[d.doc_type] || escapeHtml(d.doc_type || '—');
          const sourceLink = d.source_url
            ? `<a href="${escapeHtml(d.source_url)}" target="_blank" rel="noopener" class="doc-source-link">↗</a>`
            : '—';
          return `
            <tr class="doc-row-client">
              <td class="doc-name-cell">${escapeHtml(d.doc_name || '—')}</td>
              <td data-label="Plant"><span class="client-badge">${escapeHtml(plantName.toUpperCase())}</span></td>
              <td data-label="Type">${typeLabel}</td>
              <td data-label="Chunks">${d.chunks_indexed ?? '—'}</td>
              <td data-label="Pages">${d.pages_parsed ?? '—'}</td>
              <td data-label="Ingested">${formatDate(d.ingested_at)}</td>
              <td data-label="Source">${sourceLink}</td>
              <td>
                <button class="btn-preview-doc btn-icon-only"
                  data-doc-name="${escapeHtml(d.doc_name || '')}"
                  data-client="${escapeHtml(plantName)}"
                  data-type="${escapeHtml(typeLabel)}"
                  data-chunks="${d.chunks_indexed ?? '—'}"
                  data-date="${formatDate(d.ingested_at)}"
                  data-source="${escapeHtml(d.source_url || '')}"
                  title="Preview details">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
                <button class="btn-delete-doc"
                  data-doc-id="${escapeHtml(d.id)}"
                  data-doc-name="${escapeHtml(d.doc_name || '')}"
                  data-source-type="client"
                  title="Delete plant document">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </td>
            </tr>`;
        }).join('');
      }
    }

  } catch (err) {
    const msg = `Failed to load: ${escapeHtml(err.message)}`;
    if (benchmarkBody) benchmarkBody.innerHTML = `<tr><td colspan="6" class="skeleton-row">${msg}</td></tr>`;
    if (clientBody)    clientBody.innerHTML    = `<tr><td colspan="8" class="skeleton-row">${msg}</td></tr>`;
    return;
  }

  // ── Flag CEA-required topics with no covering document ────────────────────
  // Cross-references gap_analysis (per active plant) against the doc list just
  // rendered above: any topic detect_gaps.py scored coverage_status === 'gap'
  // has no real document behind it, so we render it as a distinct "missing
  // document" card rather than a normal file card (not clickable-for-preview,
  // no delete button — there's nothing to preview or delete).
  if (clientBody) {
    try {
      const gapRes = await fetch(`${BACKEND}/api/gap_analysis?client_name=${encodeURIComponent(getActiveClient())}`);
      const gapData = await gapRes.json();
      const missingTopics = (gapData.gaps || []).filter((g) => g.coverage_status === 'gap');
      if (missingTopics.length) {
        clientBody.insertAdjacentHTML('beforeend', missingTopics.map((g) => `
          <tr class="doc-row-gap-flag">
            <td colspan="8">
              <span class="gap-flag-badge">GAP</span>
              <div class="gap-flag-title">${escapeHtml(g.topic || g.gap_id || 'Untitled topic')}</div>
              <div class="gap-flag-desc">${escapeHtml(g.description || 'No document on file covers this CEA-required topic.')}</div>
              <div class="gap-flag-meta">Equipment: ${escapeHtml(g.equipment_tag || '—')} &middot; no covering document found</div>
            </td>
          </tr>`).join(''));
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

    // Remove row immediately for snappy UX
    const row = btn ? btn.closest('tr') : null;
    if (row) row.remove();

    // Check if client table is empty
    const clientBody = document.getElementById('client-docs-body');
    if (clientBody && !clientBody.querySelector('tr:not(.skeleton-row)')) {
      clientBody.innerHTML = `<tr><td colspan="8" class="skeleton-row">No plant documents. Upload a plant's documents above.</td></tr>`;
    }
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
  // New page uses benchmark-docs-body / client-docs-body
  if (!document.getElementById('benchmark-docs-body') && !document.getElementById('client-docs-body')) return;

  loadDocuments();

  const refreshBtn = document.getElementById('docs-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadDocuments);

  const clearBtn = document.getElementById('clear-plant-btn');
  if (clearBtn) clearBtn.addEventListener('click', clearPlant);

  // Delete button delegation — only client docs have delete buttons
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-delete-doc');
    if (btn) {
      const docId   = btn.dataset.docId;
      const docName = btn.dataset.docName;
      if (docId) deleteDocument(docId, docName);
      return;
    }
    
    // Preview modal delegation
    const previewBtn = e.target.closest('.btn-preview-doc');
    if (previewBtn) {
      const modal = document.getElementById('doc-preview-modal');
      if (modal) {
        document.getElementById('modal-doc-title').textContent = previewBtn.dataset.docName || 'Document';
        document.getElementById('modal-doc-client').textContent = previewBtn.dataset.client || '—';
        document.getElementById('modal-doc-type').textContent = previewBtn.dataset.type || '—';
        document.getElementById('modal-doc-chunks').textContent = previewBtn.dataset.chunks || '—';
        document.getElementById('modal-doc-date').textContent = previewBtn.dataset.date || '—';
        
        const sourceUrl = previewBtn.dataset.source;
        const sourceEl = document.getElementById('modal-doc-source');
        // Only render as a link for http(s) URLs, and escape — source_url is
        // user-supplied at upload time, so it must not reach innerHTML raw.
        if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
          sourceEl.innerHTML = `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener" class="doc-source-link">${escapeHtml(sourceUrl)} ↗</a>`;
        } else if (sourceUrl) {
          sourceEl.textContent = sourceUrl;
        } else {
          sourceEl.textContent = '—';
        }
        
        modal.classList.add('active');
      }
    }
  });

  // Modal close logic
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalOverlay = document.getElementById('doc-preview-modal');
  if (modalCloseBtn && modalOverlay) {
    modalCloseBtn.addEventListener('click', () => modalOverlay.classList.remove('active'));
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) modalOverlay.classList.remove('active');
    });
  }

  // Grid/List toggle logic
  const bToggle = document.getElementById('benchmark-view-toggle');
  const bTable = document.getElementById('benchmark-docs-table');
  if (bToggle && bTable) {
    bToggle.addEventListener('click', () => bTable.classList.toggle('docs-grid-view'));
  }
  
  const cToggle = document.getElementById('client-view-toggle');
  const cTable = document.getElementById('client-docs-table');
  if (cToggle && cTable) {
    cToggle.addEventListener('click', () => cTable.classList.toggle('docs-grid-view'));
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
    const totalChunks = docs.reduce((s, doc) => s + (Number(doc.chunks_indexed) || 0), 0);
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

  loadShellTicker();
  routeFromHash();
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
        return {
          id: n.id,
          label: shortLabel(n.label || n.id),
          shape: n.node_type === 'OutageEvent' ? 'dot' : 'box',
          size: n.node_type === 'OutageEvent' ? 8 : undefined,
          color: { border: color.border, background: color.background, highlight: color },
          borderWidth: isGapNode ? 3 : 1.5,
          shapeProperties: isGapNode ? { borderDashes: [6, 4] } : undefined,
          font: { color: '#e7eaee', face: 'IBM Plex Mono', size: 11 },
          _raw: n,
          _isGap: isGapNode,
        };
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

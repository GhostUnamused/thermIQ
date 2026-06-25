// ThermIQ frontend — Query Copilot (chat) + Risk Dashboard
// v0.2: Multi-chat, dark/light theme, sidebar history

// ─── Config ───────────────────────────────────────────────────────────────────
const BACKEND = window.location.hostname.includes('github.io')
  ? 'https://thermiq-674.netlify.app'
  : '';

// Shared secret for the document-ingest endpoint. Lives in client JS by necessity
// (no server-side auth layer in this architecture) — deters opportunistic bots
// probing the function URL, not a defense against a targeted attacker.
const INGEST_KEY = 'd15f9ec8fb50af9f6cfe2fdce1dac181538c5495b81302fd';

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

function renderMessages(messages) {
  const messagesEl = document.getElementById('chat-messages');
  const chipsEl    = document.getElementById('suggestion-chips');
  if (!messagesEl) return;

  if (!messages || messages.length === 0) {
    messagesEl.innerHTML = `
      <div class="chat-empty">
        <div class="chat-empty-icon">⚡</div>
        <h2 class="chat-empty-title">How can I help?</h2>
        <p class="chat-empty-text">Ask anything about thermal power plant procedures,<br>turbine specs, CEA compliance, or maintenance schedules.</p>
      </div>`;
    if (chipsEl) chipsEl.style.display = 'flex';
    return;
  }

  if (chipsEl) chipsEl.style.display = 'none';

  messagesEl.innerHTML = messages.map(msg => {
    if (msg.role === 'user') {
      return `<div class="chat-bubble user-bubble">
        <div class="bubble-text">${escapeHtml(msg.content)}</div>
      </div>`;
    }
    const isFallback = msg.model_used && !msg.model_used.startsWith('gemini');
    return `<div class="chat-bubble assistant-bubble">
      <div class="bubble-text">${DOMPurify.sanitize(marked.parse(msg.content || ''))}</div>
      ${sourcesHtml(msg.sources)}
      ${isFallback ? `<div class="bubble-meta">↩ fallback via ${escapeHtml(msg.model_used)}</div>` : ''}
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
  div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
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
        <div class="chat-list-empty-icon">💬</div>
        <div>No chats yet.<br>Start a conversation!</div>
      </div>`;
    return;
  }

  listEl.innerHTML = chatIds.map(id => {
    const chat = store.chats[id];
    const isActive = id === store.activeId;
    return `
      <div class="chat-item${isActive ? ' active' : ''}" data-chat-id="${id}">
        <div class="chat-item-icon">💬</div>
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
      if (sidebar.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });
  }

  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

  // Close sidebar when switching chats on mobile
  return { closeSidebar };
}

// ─── Main Init — Query Copilot ────────────────────────────────────────────────

function initQueryCopilot() {
  const sendBtn    = document.getElementById('send-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const inputEl    = document.getElementById('chat-input');
  const chatListEl = document.getElementById('chat-list');
  if (!sendBtn || !inputEl) return;

  let store = loadStore();
  const sidebarControls = initSidebar();

  function refresh() {
    const chat = getActiveChat(store);
    renderMessages(chat ? chat.messages : []);
    renderSidebar(store);
  }

  refresh();

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
      const res = await fetch(`${BACKEND}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

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
      if (typing) typing.remove();
      sendBtn.disabled = false;
      saveStore(store);
      renderMessages(chat.messages);
      renderSidebar(store);
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
}

// ─── Risk Dashboard (dashboard.html) ──────────────────────────────────────────

function riskBadgeClass(riskScoreCr) {
  if (riskScoreCr > 300) return 'critical';
  if (riskScoreCr >= 100) return 'high';
  return 'low';
}

async function initDashboard() {
  const gapsBody = document.getElementById('gaps-table-body');
  if (!gapsBody) return;

  const outagesBody       = document.getElementById('outages-table-body');
  const totalRiskValue    = document.getElementById('total-risk-value');
  const criticalGapsValue = document.getElementById('critical-gaps-value');
  const highGapsValue     = document.getElementById('high-gaps-value');
  const gapCountValue     = document.getElementById('gap-count-value');
  const lastUpdated       = document.getElementById('last-updated');

  try {
    const response = await fetch(`${BACKEND}/api/gap_analysis`);
    const data = await response.json();
    const gaps = data.gaps || [];

    totalRiskValue.textContent    = `₹${Math.round(data.total_risk_cr || 0)} cr`;
    gapCountValue.textContent     = data.gap_count || gaps.length;
    criticalGapsValue.textContent = gaps.filter(g => g.risk_score_cr > 300).length;
    highGapsValue.textContent     = gaps.filter(g => g.risk_score_cr >= 100 && g.risk_score_cr <= 300).length;

    gapsBody.innerHTML = '';
    gaps.forEach((gap, i) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${i + 1}</td>
        <td>${escapeHtml(gap.equipment)}</td>
        <td>${escapeHtml(gap.gap_description)}</td>
        <td>${escapeHtml(gap.gap_type)}</td>
        <td>${escapeHtml(gap.supporting_outage_count)}</td>
        <td><span class="risk-badge ${riskBadgeClass(gap.risk_score_cr)}">₹${gap.risk_score_cr}</span></td>
      `;
      gapsBody.appendChild(row);
    });
  } catch (err) {
    gapsBody.innerHTML = `<tr><td colspan="6" class="skeleton-row">Failed to load gaps: ${escapeHtml(err.message)}</td></tr>`;
  }

  try {
    const response = await fetch(`${BACKEND}/api/cea_outage`);
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
  } catch (err) {
    outagesBody.innerHTML = `<tr><td colspan="7" class="skeleton-row">Failed to load outages: ${escapeHtml(err.message)}</td></tr>`;
  }

  if (lastUpdated) lastUpdated.textContent = `Last updated: ${new Date().toLocaleString()}`;
}

// ─── Document Upload (dashboard.html) ────────────────────────────────────────

function initUpload() {
  const dropZone   = document.getElementById('upload-drop-zone');
  if (!dropZone) return;

  const fileInput  = document.getElementById('upload-file-input');
  const docName    = document.getElementById('upload-doc-name');
  const docType    = document.getElementById('upload-doc-type');
  const sourceUrl  = document.getElementById('upload-source-url');
  const submitBtn  = document.getElementById('upload-submit-btn');
  const btnText    = document.getElementById('upload-btn-text');
  const statusEl   = document.getElementById('upload-status');
  const fileLabel  = document.getElementById('upload-file-name');

  const MAX_BYTES = 6 * 1024 * 1024; // 6 MB
  let selectedFile = null;

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
    const ready = selectedFile && docName.value.trim();
    submitBtn.disabled = !ready;
  }

  function handleFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setStatus('Only PDF files are supported.', 'error');
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ~6 MB.`, 'error');
      return;
    }
    clearStatus();
    selectedFile = file;
    fileLabel.textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
    dropZone.classList.add('has-file');
    // Auto-fill doc name if empty
    if (!docName.value.trim()) {
      docName.value = file.name.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ');
    }
    updateSubmitState();
  }

  // Drag & drop
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Click to browse
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  // Doc name required
  docName.addEventListener('input', updateSubmitState);

  // Submit
  submitBtn.addEventListener('click', async () => {
    if (!selectedFile || !docName.value.trim()) return;

    submitBtn.disabled = true;
    btnText.textContent = 'Reading PDF…';
    clearStatus();

    try {
      // Read file as base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          resolve(dataUrl.split(',')[1]); // strip "data:application/pdf;base64,"
        };
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });

      btnText.textContent = 'Chunking & embedding…';
      setStatus('Embedding chunks via Jina AI — this can take up to 20 seconds…', 'info');

      const res = await fetch(`${BACKEND}/api/ingest_document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': INGEST_KEY },
        body: JSON.stringify({
          pdf_base64: base64,
          doc_name:   docName.value.trim(),
          doc_type:   docType.value,
          source_url: sourceUrl.value.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Server error ${res.status}`);
      }

      setStatus(
        `✓ Ingested "${data.doc_name}" — ${data.chunks_indexed} chunks indexed from ${data.pages_parsed} pages.`,
        'success'
      );

      // Reset form
      selectedFile = null;
      fileInput.value = '';
      docName.value = '';
      sourceUrl.value = '';
      fileLabel.textContent = 'No file selected · PDF only · max ~6 MB';
      dropZone.classList.remove('has-file');
      btnText.textContent = 'Ingest Document';
      submitBtn.disabled = true;

    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
      btnText.textContent = 'Ingest Document';
      submitBtn.disabled = false;
    }
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

initQueryCopilot();
initDashboard();
initUpload();

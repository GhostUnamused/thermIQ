// ThermIQ frontend — Query Copilot (chat) + Risk Dashboard

// Backend URL: relative path works on Netlify; GitHub Pages needs the full URL
const BACKEND = window.location.hostname.includes('github.io')
  ? 'https://thermiq-674.netlify.app'
  : '';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ─── Query Copilot — Chat UI (index.html) ────────────────────────────────────

const STORAGE_KEY = 'thermiq_chat_v1';

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch (e) { return []; }
}

function saveHistory(history) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); }
  catch (e) { /* quota exceeded — silently ignore */ }
}

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

function renderHistory(history) {
  const messagesEl = document.getElementById('chat-messages');
  const chipsEl    = document.getElementById('suggestion-chips');
  if (!messagesEl) return;

  if (history.length === 0) {
    messagesEl.innerHTML = `
      <div class="chat-empty">
        <div class="chat-empty-icon">⚡</div>
        <p class="chat-empty-text">Ask anything about thermal power plant procedures,<br>turbine specs, CEA compliance, or maintenance schedules.</p>
      </div>`;
    if (chipsEl) chipsEl.style.display = 'flex';
    return;
  }

  if (chipsEl) chipsEl.style.display = 'none';

  messagesEl.innerHTML = history.map(msg => {
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

  // Scroll to latest message
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

function initQueryCopilot() {
  const sendBtn    = document.getElementById('send-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const inputEl    = document.getElementById('chat-input');
  if (!sendBtn || !inputEl) return;

  let history = loadHistory();
  renderHistory(history);

  // Auto-resize textarea as user types
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // Chip clicks → populate input
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      inputEl.value = chip.dataset.query || '';
      inputEl.dispatchEvent(new Event('input'));
      inputEl.focus();
    });
  });

  // New Chat button
  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
      if (!history.length) return;
      if (!confirm('Start a new chat? This will clear the current conversation.')) return;
      history = [];
      saveHistory(history);
      renderHistory(history);
    });
  }

  async function submit() {
    const query = inputEl.value.trim();
    if (!query || sendBtn.disabled) return;

    // Reset input
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;

    // Add user message and re-render
    history.push({ role: 'user', content: query, ts: Date.now() });
    renderHistory(history);

    const typing = addTypingIndicator();

    try {
      const res = await fetch(`${BACKEND}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

      history.push({
        role: 'assistant',
        content: data.answer,
        sources: data.sources || [],
        model_used: data.model_used || 'gemini-2.5-flash',
        ts: Date.now(),
      });
      saveHistory(history);
    } catch (err) {
      history.push({
        role: 'assistant',
        content: `**Error:** ${err.message}`,
        sources: [],
        ts: Date.now(),
      });
    } finally {
      if (typing) typing.remove();
      sendBtn.disabled = false;
      renderHistory(history);
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

// ─── Risk Dashboard (dashboard.html) ─────────────────────────────────────────

function riskBadgeClass(riskScoreCr) {
  if (riskScoreCr > 300) return 'critical';
  if (riskScoreCr >= 100) return 'high';
  return 'low';
}

async function initDashboard() {
  const gapsBody       = document.getElementById('gaps-table-body');
  if (!gapsBody) return;

  const outagesBody      = document.getElementById('outages-table-body');
  const totalRiskValue   = document.getElementById('total-risk-value');
  const criticalGapsValue = document.getElementById('critical-gaps-value');
  const highGapsValue    = document.getElementById('high-gaps-value');
  const gapCountValue    = document.getElementById('gap-count-value');
  const lastUpdated      = document.getElementById('last-updated');

  try {
    const response = await fetch(`${BACKEND}/api/gap_analysis`);
    const data = await response.json();
    const gaps = data.gaps || [];

    totalRiskValue.textContent   = `₹${Math.round(data.total_risk_cr || 0)} cr`;
    gapCountValue.textContent    = data.gap_count || gaps.length;
    criticalGapsValue.textContent = gaps.filter(g => g.risk_score_cr > 300).length;
    highGapsValue.textContent    = gaps.filter(g => g.risk_score_cr >= 100 && g.risk_score_cr <= 300).length;

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

initQueryCopilot();
initDashboard();

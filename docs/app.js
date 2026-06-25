// ThermIQ frontend — query copilot + risk dashboard

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

// ---------- Query Copilot (index.html) ----------

function initQueryCopilot() {
  const queryInput = document.getElementById("query-input");
  const askButton = document.getElementById("ask-button");
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const answerSection = document.getElementById("answer-section");
  const answerText = document.getElementById("answer-text");
  const sourcesList = document.getElementById("sources-list");
  const chips = document.querySelectorAll(".chip");

  if (!queryInput || !askButton) return;

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      queryInput.value = chip.dataset.query;
      queryInput.focus();
    });
  });

  async function submitQuery() {
    const query = queryInput.value.trim();
    if (!query) return;

    errorState.classList.add("hidden");
    answerSection.classList.add("hidden");
    loadingState.classList.remove("hidden");
    askButton.disabled = true;

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
      }

      answerText.innerHTML = marked.parse(data.answer);

      sourcesList.innerHTML = "";
      (data.sources || []).forEach((source, i) => {
        const pct = Math.round((source.score || 0) * 100);
        const card = document.createElement("div");
        card.className = "source-card";
        card.innerHTML = `
          <div class="source-meta">
            <span>[${i + 1}] ${escapeHtml(source.doc || "")} — ${escapeHtml(source.section || "")} ${
          source.page ? "(p. " + escapeHtml(source.page) + ")" : ""
        }</span>
            <span>${pct}%</span>
          </div>
          <div class="score-bar-track">
            <div class="score-bar-fill" style="width: ${pct}%"></div>
          </div>
        `;
        sourcesList.appendChild(card);
      });

      answerSection.classList.remove("hidden");
    } catch (err) {
      errorState.textContent = err.message || "Failed to reach ThermIQ.";
      errorState.classList.remove("hidden");
    } finally {
      loadingState.classList.add("hidden");
      askButton.disabled = false;
    }
  }

  askButton.addEventListener("click", submitQuery);
  queryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      submitQuery();
    }
  });
}

// ---------- Risk Dashboard (dashboard.html) ----------

function riskBadgeClass(riskScoreCr) {
  if (riskScoreCr > 300) return "critical";
  if (riskScoreCr >= 100) return "high";
  return "low";
}

async function initDashboard() {
  const gapsBody = document.getElementById("gaps-table-body");
  if (!gapsBody) return;

  const outagesBody = document.getElementById("outages-table-body");
  const totalRiskValue = document.getElementById("total-risk-value");
  const criticalGapsValue = document.getElementById("critical-gaps-value");
  const highGapsValue = document.getElementById("high-gaps-value");
  const gapCountValue = document.getElementById("gap-count-value");
  const lastUpdated = document.getElementById("last-updated");

  try {
    const response = await fetch("/api/gap_analysis");
    const data = await response.json();
    const gaps = data.gaps || [];

    totalRiskValue.textContent = `₹${Math.round(data.total_risk_cr || 0)} cr`;
    gapCountValue.textContent = data.gap_count || gaps.length;
    criticalGapsValue.textContent = gaps.filter((g) => g.risk_score_cr > 300).length;
    highGapsValue.textContent = gaps.filter(
      (g) => g.risk_score_cr >= 100 && g.risk_score_cr <= 300
    ).length;

    gapsBody.innerHTML = "";
    gaps.forEach((gap, i) => {
      const row = document.createElement("tr");
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
    gapsBody.innerHTML = `<tr><td colspan="6" class="skeleton-row">Failed to load gaps: ${escapeHtml(
      err.message
    )}</td></tr>`;
  }

  try {
    const response = await fetch("/api/cea_outage");
    const data = await response.json();
    const outages = (data.outages || []).slice(0, 10);

    outagesBody.innerHTML = "";
    outages.forEach((outage) => {
      const row = document.createElement("tr");
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
    outagesBody.innerHTML = `<tr><td colspan="7" class="skeleton-row">Failed to load outages: ${escapeHtml(
      err.message
    )}</td></tr>`;
  }

  lastUpdated.textContent = `Last updated: ${new Date().toLocaleString()}`;
}

initQueryCopilot();
initDashboard();

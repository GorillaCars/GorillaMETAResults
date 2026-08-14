const AUTO_REFRESH_MS = 15 * 60 * 1000;
const LOCK_DURATION_MS = 8 * 60 * 60 * 1000;
const LOCK_STORAGE_KEY = "gorillaCrmUnlockedUntil";

const state = {
  leads: [],
  headers: [],
  missingFinanceHeaders: [],
  selectedRow: null,
  selectedSheetName: null,
  page: "leads",
  leadView: "list",
  calendarMonth: new Date(),
  selectedDateKey: dateKey(new Date()),
  filter: "all",
  search: "",
  refreshTimer: null,
  nextRefreshAt: null,
  lockCountTimer: null,
  nextLockedCountAt: null,
  lockTimer: null,
  hasLoadedLeads: false
};

const els = {
  lockScreen: document.querySelector("#lockScreen"),
  unlockForm: document.querySelector("#unlockForm"),
  pinInput: document.querySelector("#pinInput"),
  lockHint: document.querySelector("#lockHint"),
  lockedNewCount: document.querySelector("#lockedNewCount"),
  lockedNewMeta: document.querySelector("#lockedNewMeta"),
  lockButton: document.querySelector("#lockButton"),
  sheetMeta: document.querySelector("#sheetMeta"),
  nextRefreshMeta: document.querySelector("#nextRefreshMeta"),
  syncMeter: document.querySelector("#syncMeter"),
  pageTitle: document.querySelector("#pageTitle"),
  refreshButton: document.querySelector("#refreshButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  prepareColumnsButton: document.querySelector("#prepareColumnsButton"),
  searchInput: document.querySelector("#searchInput"),
  leadRows: document.querySelector("#leadRows"),
  boardView: document.querySelector("#boardView"),
  pipelineView: document.querySelector("#pipelineView"),
  calendarGrid: document.querySelector("#calendarGrid"),
  calendarMonthLabel: document.querySelector("#calendarMonthLabel"),
  prevMonthButton: document.querySelector("#prevMonthButton"),
  nextMonthButton: document.querySelector("#nextMonthButton"),
  selectedDateTitle: document.querySelector("#selectedDateTitle"),
  selectedDateSummary: document.querySelector("#selectedDateSummary"),
  selectedDateLeads: document.querySelector("#selectedDateLeads"),
  recentLeadList: document.querySelector("#recentLeadList"),
  analyticsTotal: document.querySelector("#analyticsTotal"),
  analyticsDelta: document.querySelector("#analyticsDelta"),
  analyticsRange: document.querySelector("#analyticsRange"),
  analyticsChart: document.querySelector("#analyticsChart"),
  platformComparison: document.querySelector("#platformComparison"),
  analyticsThisMonth: document.querySelector("#analyticsThisMonth"),
  analyticsPrevMonth: document.querySelector("#analyticsPrevMonth"),
  analyticsBestMonth: document.querySelector("#analyticsBestMonth"),
  analyticsBestMonthLabel: document.querySelector("#analyticsBestMonthLabel"),
  totalLeads: document.querySelector("#totalLeads"),
  readyLeads: document.querySelector("#readyLeads"),
  needsCallLeads: document.querySelector("#needsCallLeads"),
  completeLeads: document.querySelector("#completeLeads"),
  todayLeads: document.querySelector("#todayLeads"),
  weekLeads: document.querySelector("#weekLeads"),
  unassignedLeads: document.querySelector("#unassignedLeads"),
  leadDialog: document.querySelector("#leadDialog"),
  leadForm: document.querySelector("#leadForm"),
  detailName: document.querySelector("#detailName"),
  detailContact: document.querySelector("#detailContact"),
  customerName: document.querySelector("#customerName"),
  customerPhone: document.querySelector("#customerPhone"),
  customerEmail: document.querySelector("#customerEmail"),
  detailPlatformBadge: document.querySelector("#detailPlatformBadge"),
  detailCampaignName: document.querySelector("#detailCampaignName"),
  questionAnswers: document.querySelector("#questionAnswers"),
  metaFeedbackStatus: document.querySelector("#metaFeedbackStatus"),
  metaFeedbackEvent: document.querySelector("#metaFeedbackEvent"),
  metaFeedbackSentAt: document.querySelector("#metaFeedbackSentAt"),
  metaFeedbackError: document.querySelector("#metaFeedbackError"),
  inboxLink: document.querySelector("#inboxLink"),
  saveButton: document.querySelector("#saveButton"),
  toast: document.querySelector("#toast")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  setPage("leads");
  if (!isUnlocked()) {
    lockCrm();
    return;
  }
  showCrm();
  await loadLeads();
  scheduleAutoRefresh();
}

async function unlockCrm({ expiresAt = Date.now() + LOCK_DURATION_MS, loadData = false } = {}) {
  const expiry = Number(expiresAt) || Date.now() + LOCK_DURATION_MS;
  localStorage.setItem(LOCK_STORAGE_KEY, String(expiry));
  showCrm(expiry);

  if (loadData && !state.hasLoadedLeads) {
    await loadLeads();
  }
  scheduleAutoRefresh();
}

function showCrm(expiry = Number(localStorage.getItem(LOCK_STORAGE_KEY))) {
  window.clearInterval(state.lockCountTimer);
  state.nextLockedCountAt = null;
  document.body.classList.remove("is-locked");
  els.lockScreen.setAttribute("aria-hidden", "true");
  els.pinInput.value = "";
  els.lockHint.textContent = "CRM locks every 8 hours.";
  scheduleLockExpiry(expiry);
}

function lockCrm({ syncServer = true } = {}) {
  if (syncServer) {
    api("/api/auth/lock", { method: "POST", allowLocked: true }).catch(() => {});
  }
  localStorage.removeItem(LOCK_STORAGE_KEY);
  window.clearInterval(state.refreshTimer);
  window.clearTimeout(state.lockTimer);
  state.nextRefreshAt = null;
  clearCrmData();
  updateNextRefreshMeta();
  if (els.leadDialog.open) els.leadDialog.close();
  document.body.classList.add("is-locked");
  els.lockScreen.removeAttribute("aria-hidden");
  loadLockedLeadCount();
  scheduleLockedLeadCount();
  window.setTimeout(() => els.pinInput.focus(), 50);
}

function isUnlocked() {
  const expiry = Number(localStorage.getItem(LOCK_STORAGE_KEY));
  return Number.isFinite(expiry) && expiry > Date.now();
}

function scheduleLockExpiry(expiry = Number(localStorage.getItem(LOCK_STORAGE_KEY))) {
  window.clearTimeout(state.lockTimer);
  if (!Number.isFinite(expiry)) return;
  state.lockTimer = window.setTimeout(lockCrm, Math.max(0, expiry - Date.now()));
}

function clearCrmData() {
  state.leads = [];
  state.headers = [];
  state.missingFinanceHeaders = [];
  state.selectedRow = null;
  state.selectedSheetName = null;
  state.hasLoadedLeads = false;
  els.sheetMeta.textContent = "CRM is locked";
  els.syncMeter.style.width = "12%";
  renderAll();
}

function scheduleLockedLeadCount() {
  window.clearInterval(state.lockCountTimer);
  state.nextLockedCountAt = new Date(Date.now() + AUTO_REFRESH_MS);
  updateLockedNewMeta();
  state.lockCountTimer = window.setInterval(async () => {
    await loadLockedLeadCount();
    state.nextLockedCountAt = new Date(Date.now() + AUTO_REFRESH_MS);
    updateLockedNewMeta();
  }, AUTO_REFRESH_MS);
}

async function loadLockedLeadCount() {
  if (isUnlocked()) return;
  els.lockedNewMeta.textContent = "Checking Google Sheet...";
  try {
    const data = await api("/api/leads/count", { allowLocked: true });
    els.lockedNewCount.textContent = data.createdCount;
    updateLockedNewMeta();
  } catch (error) {
    els.lockedNewCount.textContent = "-";
    els.lockedNewMeta.textContent = "Could not check leads.";
  }
}

function updateLockedNewMeta() {
  if (!state.nextLockedCountAt) {
    els.lockedNewMeta.textContent = "Refreshes every 15 minutes.";
    return;
  }
  els.lockedNewMeta.textContent = `Refreshes again ${state.nextLockedCountAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

async function handleUnlock(event) {
  event.preventDefault();
  const pin = els.pinInput.value.trim();
  els.lockHint.textContent = "Checking PIN...";
  try {
    const result = await api("/api/auth/unlock", {
      method: "POST",
      allowLocked: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin })
    });
    await unlockCrm({ expiresAt: result.expiresAt, loadData: true });
  } catch (error) {
    els.lockHint.textContent = error.message || "Incorrect PIN. Try again.";
    els.pinInput.select();
  }
}

function bindEvents() {
  els.unlockForm.addEventListener("submit", handleUnlock);
  els.lockButton.addEventListener("click", lockCrm);
  els.refreshButton.addEventListener("click", refreshNow);
  els.exportCsvButton.addEventListener("click", exportCsv);
  els.prepareColumnsButton.addEventListener("click", prepareColumns);
  els.saveButton.addEventListener("click", saveSelectedLead);
  els.prevMonthButton.addEventListener("click", () => moveCalendarMonth(-1));
  els.nextMonthButton.addEventListener("click", () => moveCalendarMonth(1));

  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderLeadViews();
  });

  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });

  document.querySelectorAll("[data-lead-view]").forEach((button) => {
    button.addEventListener("click", () => setLeadView(button.dataset.leadView));
  });

  document.querySelectorAll(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      state.filter = button.dataset.filter;
      renderLeadViews();
    });
  });
}

async function loadLeads() {
  if (!isUnlocked()) {
    lockCrm();
    return;
  }
  setBusy(els.refreshButton, true, "Loading");
  try {
    const data = await api("/api/leads");
    state.headers = data.headers;
    state.missingFinanceHeaders = data.missingFinanceHeaders;
    state.leads = sortLeadsNewestFirst(data.rows);
    if (state.leads.length) {
      state.calendarMonth = new Date(leadDate(state.leads[0]).getFullYear(), leadDate(state.leads[0]).getMonth(), 1);
      state.selectedDateKey = dateKey(leadDate(state.leads[0]));
    }
    els.sheetMeta.textContent = `${data.rows.length} lead${data.rows.length === 1 ? "" : "s"} synced`;
    els.syncMeter.style.width = data.rows.length ? "100%" : "12%";
    state.hasLoadedLeads = true;
    renderAll();
  } catch (error) {
    els.sheetMeta.textContent = "Sheet connection needs attention";
    els.syncMeter.style.width = "12%";
    showToast(error.message);
    renderAll();
  } finally {
    setBusy(els.refreshButton, false, "Refresh");
    updateNextRefreshMeta();
  }
}

async function refreshNow() {
  await loadLeads();
  scheduleAutoRefresh();
}

async function prepareColumns() {
  setBusy(els.prepareColumnsButton, true, "Preparing");
  try {
    const result = await api("/api/setup/columns", { method: "POST" });
    showToast(result.added.length ? `Added CRM fields: ${result.added.join(", ")}` : "CRM fields are already ready.");
    await loadLeads();
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(els.prepareColumnsButton, false, "Prepare CRM fields");
  }
}

async function saveSelectedLead() {
  if (!state.selectedRow) return;

  const payload = Object.fromEntries(new FormData(els.leadForm).entries());
  setBusy(els.saveButton, true, "Saving");
  try {
    const sheetQuery = state.selectedSheetName ? `?sheetName=${encodeURIComponent(state.selectedSheetName)}` : "";
    const result = await api(`/api/leads/${state.selectedRow}${sheetQuery}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    showToast(saveMessage(result.metaFeedback));
    els.leadDialog.close();
    await loadLeads();
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(els.saveButton, false, "Save to Google Sheet");
  }
}

function setPage(page) {
  state.page = page;
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === page);
  });
  document.querySelectorAll(".page-view").forEach((view) => {
    view.classList.toggle("is-active", view.dataset.view === page);
  });
  const titles = {
    analytics: "Analytics",
    calendar: "Calendar",
    dashboard: "Dashboard",
    leads: "Leads"
  };
  els.pageTitle.textContent = titles[page] || "Leads";
}

function setLeadView(view) {
  state.leadView = view;
  document.querySelectorAll("[data-lead-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.leadView === view);
  });
  document.querySelectorAll("[data-leads-view]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.leadsView === view);
  });
  renderLeadViews();
}

function scheduleAutoRefresh() {
  if (!isUnlocked()) return;
  window.clearInterval(state.refreshTimer);
  state.nextRefreshAt = new Date(Date.now() + AUTO_REFRESH_MS);
  updateNextRefreshMeta();
  state.refreshTimer = window.setInterval(async () => {
    await loadLeads();
    state.nextRefreshAt = new Date(Date.now() + AUTO_REFRESH_MS);
    updateNextRefreshMeta();
  }, AUTO_REFRESH_MS);
}

function updateNextRefreshMeta() {
  if (!els.nextRefreshMeta) return;
  if (!state.nextRefreshAt) {
    els.nextRefreshMeta.textContent = "CRM is locked";
    return;
  }
  els.nextRefreshMeta.textContent = `Next auto-refresh ${state.nextRefreshAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function renderAll() {
  renderMetrics();
  renderDashboard();
  renderAnalytics();
  renderCalendar();
  renderLeadViews();
  renderSetupButton();
}

function renderMetrics() {
  const total = state.leads.length;
  const ready = state.leads.filter(financeRequested).length;
  const needsCall = state.leads.filter((lead) => normalized(lead.finance_status || lead.lead_status).includes("CALL")).length;
  const complete = state.leads.filter((lead) => normalized(lead.lead_status).includes("COMPLETE") || normalized(lead.finance_status).includes("APPROVED")).length;

  els.totalLeads.textContent = total;
  els.readyLeads.textContent = ready;
  els.needsCallLeads.textContent = needsCall;
  els.completeLeads.textContent = complete;
}

function renderDashboard() {
  const now = new Date();
  const todayKey = dateKey(now);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  els.todayLeads.textContent = state.leads.filter((lead) => dateKey(leadDate(lead)) === todayKey).length;
  els.weekLeads.textContent = state.leads.filter((lead) => leadDate(lead) >= weekStart).length;
  els.unassignedLeads.textContent = state.leads.filter((lead) => !lead.assigned_to).length;

  const recent = state.leads.slice(0, 8);
  els.recentLeadList.innerHTML = recent.length
    ? recent.map((lead) => leadCard(lead, "recent-item")).join("")
    : emptyBlock("No leads have been received yet.");

  els.recentLeadList.querySelectorAll("[data-open]").forEach(bindOpenButton);
}

function renderAnalytics() {
  const months = monthlyLeadSeries();
  const total = months.reduce((sum, item) => sum + item.count, 0);
  const thisMonth = months.at(-1)?.count || 0;
  const prevMonth = months.at(-2)?.count || 0;
  const change = prevMonth ? Math.round(((thisMonth - prevMonth) / prevMonth) * 100) : thisMonth ? 100 : 0;
  const best = months.reduce((winner, item) => item.count > winner.count ? item : winner, months[0] || { count: 0, label: "No lead data yet" });

  els.analyticsTotal.textContent = total.toLocaleString();
  els.analyticsDelta.textContent = `${change >= 0 ? "+" : ""}${change}%`;
  els.analyticsDelta.className = change >= 0 ? "is-positive" : "is-negative";
  els.analyticsRange.textContent = "last 12 months";
  els.analyticsThisMonth.textContent = thisMonth.toLocaleString();
  els.analyticsPrevMonth.textContent = prevMonth.toLocaleString();
  els.analyticsBestMonth.textContent = best.count.toLocaleString();
  els.analyticsBestMonthLabel.textContent = best.count ? best.label : "No lead data yet.";
  renderAnalyticsChart(months);
  renderPlatformComparison();
}

function renderPlatformComparison() {
  const counts = platformCounts(state.leads);
  const total = Math.max(1, counts.facebook + counts.instagram);
  const rows = [
    { key: "instagram", label: "Instagram", count: counts.instagram },
    { key: "facebook", label: "Facebook", count: counts.facebook }
  ];

  els.platformComparison.innerHTML = rows.map((row) => {
    const percent = Math.round((row.count / total) * 100);
    return `
      <div class="platform-bar-row">
        <div class="platform-bar-label">
          ${platformBadge(row.key)}
        </div>
        <div class="platform-bar-track" aria-label="${escapeHtml(`${row.label}: ${row.count} leads`)}">
          <span class="${row.key}" style="width: ${percent}%"></span>
        </div>
        <strong class="platform-bar-count">${row.count.toLocaleString()}</strong>
      </div>
    `;
  }).join("");
}

function renderAnalyticsChart(months) {
  const width = 820;
  const height = 340;
  const padding = { top: 28, right: 28, bottom: 46, left: 46 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxCount = Math.max(1, ...months.map((item) => item.count));
  const step = months.length > 1 ? chartWidth / (months.length - 1) : chartWidth;
  const points = months.map((item, index) => {
    const x = padding.left + index * step;
    const y = padding.top + chartHeight - (item.count / maxCount) * chartHeight;
    return { ...item, x, y };
  });
  const path = points.map((point, index) => `${index ? "L" : "M"} ${round(point.x)} ${round(point.y)}`).join(" ");
  const areaPath = `${path} L ${round(points.at(-1)?.x || padding.left)} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`;
  const yLabels = niceYAxis(maxCount);
  const activePoint = points.reduce((latest, point) => point.count >= latest.count ? point : latest, points[0] || { x: 0, y: 0, count: 0, label: "" });

  els.analyticsChart.innerHTML = `
    <defs>
      <linearGradient id="leadAreaGradient" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#3fbda6" stop-opacity="0.28" />
        <stop offset="100%" stop-color="#3fbda6" stop-opacity="0.03" />
      </linearGradient>
    </defs>
    <rect class="chart-bg" x="0" y="0" width="${width}" height="${height}" rx="0"></rect>
    ${gridDots(width, height, padding)}
    ${yLabels.map((label) => {
      const y = padding.top + chartHeight - (label.value / maxCount) * chartHeight;
      return `<text class="chart-y-label" x="0" y="${round(y + 4)}">${escapeHtml(label.label)}</text>`;
    }).join("")}
    <path class="chart-area" d="${areaPath}"></path>
    <path class="chart-line" d="${path}"></path>
    <line class="chart-marker-line" x1="${round(activePoint.x)}" x2="${round(activePoint.x)}" y1="${padding.top}" y2="${height - padding.bottom}"></line>
    <circle class="chart-marker-ring" cx="${round(activePoint.x)}" cy="${round(activePoint.y)}" r="16"></circle>
    <circle class="chart-marker-dot" cx="${round(activePoint.x)}" cy="${round(activePoint.y)}" r="5"></circle>
    <g class="chart-tooltip" transform="translate(${Math.min(width - 190, Math.max(74, activePoint.x - 74))} ${Math.max(26, activePoint.y - 70)})">
      <rect width="148" height="52" rx="8"></rect>
      <text x="12" y="20">${escapeHtml(activePoint.label)}</text>
      <text x="12" y="38">${activePoint.count.toLocaleString()} leads</text>
    </g>
    ${points.map((point, index) => `
      <circle class="chart-point" cx="${round(point.x)}" cy="${round(point.y)}" r="4">
        <title>${escapeHtml(`${point.label}: ${point.count} leads`)}</title>
      </circle>
      ${index % 2 === 0 || index === points.length - 1 ? `<text class="chart-x-label" x="${round(point.x)}" y="${height - 12}">${escapeHtml(point.shortLabel)}</text>` : ""}
    `).join("")}
  `;
}

function renderCalendar() {
  const grouped = groupByDate(state.leads);
  const month = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth(), 1);
  const start = startOfCalendar(month);
  const today = dateKey(new Date());

  els.calendarMonthLabel.textContent = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  els.calendarGrid.innerHTML = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const key = dateKey(day);
    const leads = grouped.get(key) || [];
    const outsideMonth = day.getMonth() !== month.getMonth();
    return `
      <button class="calendar-day ${outsideMonth ? "is-muted" : ""} ${key === today ? "is-today" : ""} ${key === state.selectedDateKey ? "is-selected" : ""}" data-date="${key}" type="button">
        <span>${day.getDate()}</span>
        <strong>${leads.length}</strong>
        <p>${leads.length === 1 ? "lead" : "leads"}</p>
      </button>
    `;
  }).join("");

  els.calendarGrid.querySelectorAll("[data-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDateKey = button.dataset.date;
      renderCalendar();
    });
  });

  renderSelectedDate(grouped.get(state.selectedDateKey) || []);
}

function renderLeadViews() {
  renderListView();
  renderBoardView();
  renderPipelineView();
}

function renderListView() {
  const rows = filteredLeads();
  els.leadRows.innerHTML = "";

  if (!rows.length) {
    els.leadRows.innerHTML = `<tr><td colspan="5">${state.leads.length ? "No leads match this view." : "No leads loaded yet."}</td></tr>`;
    return;
  }

  rows.forEach((lead) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <button class="lead-button" data-open="${lead.rowNumber}" data-sheet="${escapeHtml(lead.sheetName || "")}" type="button">
          <span class="lead-cell">
            <strong>${escapeHtml(lead.full_name || "Unnamed lead")}</strong>
            <span>${escapeHtml(lead.email || lead.phone || "No contact supplied")}</span>
          </span>
        </button>
      </td>
      <td>${escapeHtml(sourceLabel(lead))}</td>
      <td>${statusTag(lead.finance_status || lead.lead_status || "New")}</td>
      <td>${escapeHtml(interestLabel(lead))}</td>
      <td>${escapeHtml(displayDate(lead.created_time))}</td>
    `;
    els.leadRows.appendChild(row);
  });

  els.leadRows.querySelectorAll("[data-open]").forEach(bindOpenButton);
}

function renderBoardView() {
  const rows = filteredLeads();
  const baseColumns = [
    { key: "new", title: "New", test: (lead) => includesStatus(lead, ["NEW", ""]) },
    { key: "call", title: "Needs call", test: (lead) => includesStatus(lead, ["CALL", "CONTACT"]) },
    { key: "progress", title: "In progress", test: (lead) => includesStatus(lead, ["PROGRESS", "DOCUMENT", "SUBMITTED"]) },
    { key: "done", title: "Complete", test: (lead) => includesStatus(lead, ["COMPLETE", "APPROVED"]) }
  ];
  const columns = [
    ...baseColumns,
    { key: "other", title: "Other", test: (lead) => !baseColumns.some((column) => column.test(lead)) }
  ];

  els.boardView.innerHTML = columns.map((column) => {
    const leads = rows.filter(column.test);
    return `
      <section class="board-column">
        <header><h2>${column.title}</h2><span>${leads.length}</span></header>
        <div class="board-list">
          ${leads.length ? leads.map((lead) => leadCard(lead, "board-card")).join("") : emptyBlock("No leads")}
        </div>
      </section>
    `;
  }).join("");

  els.boardView.querySelectorAll("[data-open]").forEach(bindOpenButton);
}

function renderPipelineView() {
  const rows = filteredLeads();
  const steps = [
    { title: "Lead received", test: () => true },
    { title: "Contacted", test: (lead) => includesStatus(lead, ["CONTACT", "CALL", "PROGRESS", "DOCUMENT", "SUBMITTED", "APPROVED", "COMPLETE"]) },
    { title: "Finance docs", test: (lead) => includesStatus(lead, ["DOCUMENT", "SUBMITTED", "APPROVED", "COMPLETE"]) },
    { title: "Complete", test: (lead) => includesStatus(lead, ["APPROVED", "COMPLETE"]) }
  ];

  els.pipelineView.innerHTML = steps.map((step, index) => {
    const leads = rows.filter(step.test);
    const percent = rows.length ? Math.round((leads.length / rows.length) * 100) : 0;
    return `
      <article class="pipeline-step">
        <div class="step-number">${index + 1}</div>
        <h2>${step.title}</h2>
        <strong>${leads.length}</strong>
        <div class="meter"><span style="width: ${percent}%"></span></div>
        <p>${percent}% of filtered leads</p>
      </article>
    `;
  }).join("");
}

function openLead(rowNumber, sheetName = "") {
  const lead = state.leads.find((item) => item.rowNumber === rowNumber && (!sheetName || item.sheetName === sheetName));
  if (!lead) return;

  state.selectedRow = rowNumber;
  state.selectedSheetName = lead.sheetName || null;
  els.detailName.textContent = lead.full_name || "Unnamed lead";
  els.detailContact.textContent = [lead.phone, lead.email].filter(Boolean).join(" | ") || "No contact supplied";
  els.customerName.textContent = lead.full_name || "-";
  els.customerPhone.textContent = lead.phone || "-";
  els.customerEmail.textContent = lead.email || "-";
  els.detailPlatformBadge.innerHTML = platformBadge(platformKey(lead.platform));
  els.detailCampaignName.textContent = lead.campaign_name || "No campaign supplied";
  renderQuestionAnswers(lead);
  els.metaFeedbackStatus.textContent = lead.meta_feedback_status || "Not sent";
  els.metaFeedbackEvent.textContent = lead.meta_feedback_event || "-";
  els.metaFeedbackSentAt.textContent = lead.meta_feedback_sent_at ? displayDateTime(lead.meta_feedback_sent_at) : "-";
  els.metaFeedbackError.textContent = lead.meta_feedback_error || "-";
  els.inboxLink.href = lead.inbox_url || "#";
  els.inboxLink.style.display = lead.inbox_url ? "inline-flex" : "none";

  Array.from(els.leadForm.elements).forEach((field) => {
    if (!field.name) return;
    field.value = field.name === "lead_status" ? formStatusValue(lead[field.name]) : lead[field.name] || "";
  });

  els.leadDialog.showModal();
}

function exportCsv() {
  const rows = filteredLeads();
  if (!rows.length) {
    showToast("There are no leads to export.");
    return;
  }

  const headers = ["full_name", "source", "lead_status", "interest", "created_date", "email", "phone", "vehicle_match", "finance_notes"];
  const csv = [
    headers.join(","),
    ...rows.map((lead) => [
      lead.full_name,
      sourceLabel(lead),
      displayStatusLabel(lead.finance_status || lead.lead_status),
      interestLabel(lead),
      displayDate(lead.created_time),
      lead.email,
      lead.phone,
      lead.vehicle_match,
      lead.finance_notes
    ].map(csvCell).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gorilla-leads-${dateKey(new Date())}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function moveCalendarMonth(direction) {
  state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + direction, 1);
  state.selectedDateKey = dateKey(state.calendarMonth);
  renderCalendar();
}

function filteredLeads() {
  return sortLeadsNewestFirst(state.leads.filter((lead) => {
    const haystack = Object.values(lead).join(" ").toLowerCase();
    if (state.search && !haystack.includes(state.search)) return false;
    if (state.filter === "finance") return financeRequested(lead);
    if (state.filter === "trade") return tradeRequested(lead);
    if (state.filter === "needs-call") return normalized(lead.finance_status || lead.lead_status).includes("CALL");
    if (state.filter === "complete") return normalized(lead.lead_status).includes("COMPLETE") || normalized(lead.finance_status).includes("APPROVED");
    return true;
  }));
}

function leadCard(lead, className) {
  return `
    <button class="${className}" data-open="${lead.rowNumber}" data-sheet="${escapeHtml(lead.sheetName || "")}" type="button">
      <strong>${escapeHtml(lead.full_name || "Unnamed lead")}</strong>
      <span>${escapeHtml(lead.phone || lead.email || "No contact supplied")}</span>
      <small>${escapeHtml(displayDate(lead.created_time))}</small>
    </button>
  `;
}

function renderQuestionAnswers(lead) {
  const answers = leadQuestionDefinitions()
    .map((question) => ({
      label: question.label,
      value: firstLeadValue(lead, question.keys)
    }))
    .filter((item) => item.value);

  els.questionAnswers.innerHTML = answers.length
    ? answers.map((item, index) => `
      <div class="qa-row">
        <span class="qa-index">${index + 1}.</span>
        <span class="qa-question">${escapeHtml(item.label)}</span>
        <strong class="qa-answer">${escapeHtml(item.value)}</strong>
      </div>
    `).join("")
    : emptyBlock("No customer answers supplied.");
}

function leadQuestionDefinitions() {
  return [
    { label: "Are you looking for finance?", keys: ["are_you_looking_for_finance?"] },
    { label: "Do you have a trade-in?", keys: ["do_you_have_a_trade_in?"] },
    { label: "Anything specific you're chasing?", keys: ["anything_specific_you_are_chasing?", "anything_specific_you're_chasing?", "anything_specific_you\u2019re_chasing?"] },
    { label: "How much money do you want to borrow?", keys: ["How much money do you want to borrow?"] },
    { label: "Are you employed?", keys: ["Are you employed?"] },
    { label: "Date of birth", keys: ["Date of birth"] },
    { label: "Post code", keys: ["Post code", "postcode"] },
    { label: "What do you do for work?", keys: ["What do you do for work?"] },
    { label: "Marital status", keys: ["Marital status"] }
  ];
}

function firstLeadValue(lead, keys) {
  const keySet = new Set(keys.map(normalizeKey));
  const key = Object.keys(lead).find((candidate) => keySet.has(normalizeKey(candidate)));
  return key ? String(lead[key] || "").trim() : "";
}

function bindOpenButton(button) {
  button.addEventListener("click", () => openLead(Number(button.dataset.open), button.dataset.sheet || ""));
}

function groupByDate(leads) {
  return leads.reduce((map, lead) => {
    const key = dateKey(leadDate(lead));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(lead);
    return map;
  }, new Map());
}

function monthlyLeadSeries() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
    return {
      key: monthKey(date),
      date,
      label: date.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      shortLabel: date.toLocaleDateString(undefined, { month: "short" }),
      count: 0
    };
  });
  const byKey = new Map(months.map((item) => [item.key, item]));

  state.leads.forEach((lead) => {
    const date = leadDate(lead);
    if (date < start) return;
    const bucket = byKey.get(monthKey(date));
    if (bucket) bucket.count += 1;
  });

  return months;
}

function renderSelectedDate(leads) {
  const date = new Date(`${state.selectedDateKey}T00:00:00`);
  els.selectedDateTitle.textContent = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  els.selectedDateSummary.textContent = `${leads.length} ${leads.length === 1 ? "lead" : "leads"} received.`;
  els.selectedDateLeads.innerHTML = leads.length
    ? leads.map((lead) => leadCard(lead, "recent-item")).join("")
    : emptyBlock("No leads were received on this date.");
  els.selectedDateLeads.querySelectorAll("[data-open]").forEach(bindOpenButton);
}

function startOfCalendar(month) {
  const start = new Date(month);
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  return start;
}

function leadDate(lead) {
  const date = new Date(lead.created_time || "");
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function sortLeadsNewestFirst(leads) {
  return [...leads].sort((a, b) => leadDate(b) - leadDate(a));
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function niceYAxis(maxCount) {
  const top = Math.max(1, maxCount);
  return [
    { value: top, label: top.toLocaleString() },
    { value: Math.round(top * 0.66), label: Math.round(top * 0.66).toLocaleString() },
    { value: Math.round(top * 0.33), label: Math.round(top * 0.33).toLocaleString() },
    { value: 0, label: "0" }
  ];
}

function gridDots(width, height, padding) {
  const dots = [];
  for (let x = padding.left; x <= width - padding.right; x += 34) {
    for (let y = padding.top; y <= height - padding.bottom; y += 28) {
      dots.push(`<circle class="chart-grid-dot" cx="${round(x)}" cy="${round(y)}" r="1"></circle>`);
    }
  }
  return dots.join("");
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function includesStatus(lead, values) {
  const status = normalized(`${lead.lead_status || ""} ${lead.finance_status || ""}`);
  return values.some((value) => value === "" ? !status || status === "NEW" : status.includes(value));
}

function sourceTag(lead) {
  return `<span class="tag">${escapeHtml(shortSource(sourceLabel(lead)))}</span>`;
}

function sourceLabel(lead) {
  return lead.campaign_name || lead.ad_name || lead.form_name || lead.platform || "Meta";
}

function platformCounts(leads) {
  return leads.reduce((counts, lead) => {
    const key = platformKey(lead.platform);
    if (key === "facebook" || key === "instagram") counts[key] += 1;
    return counts;
  }, { facebook: 0, instagram: 0 });
}

function platformKey(value) {
  const text = normalized(value);
  if (text.includes("INSTAGRAM") || text === "IG") return "instagram";
  if (text.includes("FACEBOOK") || text === "FB") return "facebook";
  return "unknown";
}

function platformBadge(key) {
  if (key === "instagram") {
    return `<span class="platform-badge instagram"><span aria-hidden="true"></span>Instagram</span>`;
  }
  if (key === "facebook") {
    return `<span class="platform-badge facebook"><span aria-hidden="true"></span>Facebook</span>`;
  }
  return `<span class="platform-badge unknown"><span aria-hidden="true"></span>Unknown</span>`;
}

function shortSource(value) {
  const clean = String(value || "").replace(/[^a-z0-9 ]/gi, " ").trim();
  if (!clean) return "Meta";
  return clean.split(/\s+/).slice(0, 2).join("").slice(0, 9).toUpperCase();
}

function statusTag(value) {
  const text = normalized(value);
  let variant = "yellow";
  if (text.includes("COMPLETE") || text.includes("APPROVED") || text.includes("CLOSED")) variant = "green";
  if (text.includes("DECLINED") || text.includes("LOST") || text.includes("NOT")) variant = "red";
  if (text.includes("DOCUMENT") || text.includes("SUBMITTED") || text.includes("PROGRESS")) variant = "blue";
  if (text.includes("NEW") || text.includes("CALL") || text.includes("CONTACT")) variant = "orange";
  return `<span class="tag ${variant}">${escapeHtml(displayStatusLabel(value || "New"))}</span>`;
}

function displayStatusLabel(value) {
  return normalized(value) === "NOT QUALIFIED" ? "DECLINED" : String(value || "");
}

function formStatusValue(value) {
  return normalized(value) === "DECLINED" ? "NOT QUALIFIED" : value || "";
}

function yesNoTag(value) {
  return `<span class="tag ${value ? "green" : ""}">${value ? "Yes" : "No"}</span>`;
}

function interestLabel(lead) {
  const answer = chasingAnswer(lead);
  if (answer) return answer;
  const interests = [];
  if (financeRequested(lead)) interests.push("Finance");
  if (tradeRequested(lead)) interests.push("Trade-in");
  return interests.length ? interests.join(", ") : "Not specified";
}

function chasingAnswer(lead) {
  return lead["anything_specific_you\u2019re_chasing?"] || lead["anything_specific_you're_chasing?"] || "";
}

function displayDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function displayDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function financeRequested(lead) {
  return truthyAnswer(lead["are_you_looking_for_finance?"]);
}

function tradeRequested(lead) {
  return truthyAnswer(lead["do_you_have_a_trade_in?"]);
}

function truthyAnswer(value) {
  const text = normalized(value);
  return text.includes("YES") || text.includes("TRUE") || text.includes("FINANCE") || text.includes("TEST LEAD");
}

async function api(url, options = {}) {
  const { allowLocked = false, ...fetchOptions } = options;
  if (!allowLocked && !isUnlocked()) {
    lockCrm({ syncServer: false });
    throw new Error("CRM locked. Enter the PIN to continue.");
  }
  const response = await fetch(url, fetchOptions);
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && !allowLocked) {
    lockCrm({ syncServer: false });
  }
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function renderSetupButton() {
  els.prepareColumnsButton.style.display = state.missingFinanceHeaders.length ? "inline-flex" : "none";
}

function emptyBlock(message) {
  return `<div class="empty-block">${escapeHtml(message)}</div>`;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 4000);
}

function saveMessage(metaFeedback) {
  if (!metaFeedback || metaFeedback.status === "skipped") {
    return "Lead saved to Google Sheet.";
  }
  if (metaFeedback.status === "sent") {
    return "Lead saved and Meta feedback sent.";
  }
  if (metaFeedback.status === "error") {
    return "Lead saved, but Meta feedback returned an error.";
  }
  return "Lead saved to Google Sheet.";
}

function csvCell(value) {
  const text = String(value || "");
  return `"${text.replace(/"/g, '""')}"`;
}

function normalized(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

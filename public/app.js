const AUTO_REFRESH_MS = 15 * 60 * 1000;
const LOCK_DURATION_MS = 8 * 60 * 60 * 1000;
const LOCK_STORAGE_KEY = "gorillaCrmUnlockedUntil";

const state = {
  leads: [],
  headers: [],
  missingFinanceHeaders: [],
  selectedRow: null,
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
  answerFinance: document.querySelector("#answerFinance"),
  answerTrade: document.querySelector("#answerTrade"),
  answerChasing: document.querySelector("#answerChasing"),
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
    const result = await api(`/api/leads/${state.selectedRow}`, {
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
  els.pageTitle.textContent = page === "calendar" ? "Calendar" : page === "dashboard" ? "Dashboard" : "Leads";
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
        <button class="lead-button" data-open="${lead.rowNumber}" type="button">
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

function openLead(rowNumber) {
  const lead = state.leads.find((item) => item.rowNumber === rowNumber);
  if (!lead) return;

  state.selectedRow = rowNumber;
  els.detailName.textContent = lead.full_name || "Unnamed lead";
  els.detailContact.textContent = [lead.phone, lead.email].filter(Boolean).join(" | ") || "No contact supplied";
  els.customerName.textContent = lead.full_name || "-";
  els.customerPhone.textContent = lead.phone || "-";
  els.customerEmail.textContent = lead.email || "-";
  els.answerFinance.textContent = lead["are_you_looking_for_finance?"] || "-";
  els.answerTrade.textContent = lead["do_you_have_a_trade_in?"] || "-";
  els.answerChasing.textContent = chasingAnswer(lead) || "-";
  els.metaFeedbackStatus.textContent = lead.meta_feedback_status || "Not sent";
  els.metaFeedbackEvent.textContent = lead.meta_feedback_event || "-";
  els.metaFeedbackSentAt.textContent = lead.meta_feedback_sent_at ? displayDateTime(lead.meta_feedback_sent_at) : "-";
  els.metaFeedbackError.textContent = lead.meta_feedback_error || "-";
  els.inboxLink.href = lead.inbox_url || "#";
  els.inboxLink.style.pointerEvents = lead.inbox_url ? "auto" : "none";

  Array.from(els.leadForm.elements).forEach((field) => {
    if (!field.name) return;
    field.value = lead[field.name] || "";
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
      lead.finance_status || lead.lead_status,
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
    <button class="${className}" data-open="${lead.rowNumber}" type="button">
      <strong>${escapeHtml(lead.full_name || "Unnamed lead")}</strong>
      <span>${escapeHtml(lead.phone || lead.email || "No contact supplied")}</span>
      <small>${escapeHtml(displayDate(lead.created_time))}</small>
    </button>
  `;
}

function bindOpenButton(button) {
  button.addEventListener("click", () => openLead(Number(button.dataset.open)));
}

function groupByDate(leads) {
  return leads.reduce((map, lead) => {
    const key = dateKey(leadDate(lead));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(lead);
    return map;
  }, new Map());
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
  return `<span class="tag ${variant}">${escapeHtml(value || "New")}</span>`;
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const state = {
  leads: [],
  headers: [],
  missingFinanceHeaders: [],
  selectedRow: null,
  page: "leads",
  leadView: "list",
  filter: "all",
  search: ""
};

const els = {
  sheetMeta: document.querySelector("#sheetMeta"),
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
  inboxLink: document.querySelector("#inboxLink"),
  saveButton: document.querySelector("#saveButton"),
  toast: document.querySelector("#toast")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  setPage("leads");
  await loadLeads();
}

function bindEvents() {
  els.refreshButton.addEventListener("click", loadLeads);
  els.exportCsvButton.addEventListener("click", exportCsv);
  els.prepareColumnsButton.addEventListener("click", prepareColumns);
  els.saveButton.addEventListener("click", saveSelectedLead);

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
  setBusy(els.refreshButton, true, "Loading");
  try {
    const data = await api("/api/leads");
    state.headers = data.headers;
    state.missingFinanceHeaders = data.missingFinanceHeaders;
    state.leads = data.rows.sort((a, b) => leadDate(b) - leadDate(a));
    els.sheetMeta.textContent = `${data.rows.length} lead${data.rows.length === 1 ? "" : "s"} synced`;
    els.syncMeter.style.width = data.rows.length ? "100%" : "12%";
    renderAll();
  } catch (error) {
    els.sheetMeta.textContent = "Sheet connection needs attention";
    els.syncMeter.style.width = "12%";
    showToast(error.message);
    renderAll();
  } finally {
    setBusy(els.refreshButton, false, "Refresh");
  }
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
    await api(`/api/leads/${state.selectedRow}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    showToast("Lead saved to Google Sheet.");
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
  const entries = [...grouped.entries()].sort(([a], [b]) => new Date(b) - new Date(a)).slice(0, 35);

  els.calendarGrid.innerHTML = entries.length
    ? entries.map(([key, leads]) => {
        const date = new Date(`${key}T00:00:00`);
        return `
          <article class="calendar-day">
            <span>${escapeHtml(date.toLocaleDateString(undefined, { weekday: "short" }))}</span>
            <strong>${escapeHtml(date.toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</strong>
            <b>${leads.length}</b>
            <p>${leads.length === 1 ? "lead received" : "leads received"}</p>
          </article>
        `;
      }).join("")
    : emptyBlock("No lead dates are available yet.");
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
    els.leadRows.innerHTML = `<tr><td colspan="7">${state.leads.length ? "No leads match this view." : "No leads loaded yet."}</td></tr>`;
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
      <td>${sourceTag(lead)}</td>
      <td>${statusTag(lead.finance_status || lead.lead_status || "New")}</td>
      <td>${yesNoTag(financeRequested(lead))}</td>
      <td>${yesNoTag(tradeRequested(lead))}</td>
      <td>${escapeHtml(lead.assigned_to || "Unassigned")}</td>
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

  const headers = ["full_name", "email", "phone", "created_time", "lead_status", "finance_status", "assigned_to", "next_action", "vehicle_match"];
  const csv = [headers.join(","), ...rows.map((lead) => headers.map((header) => csvCell(lead[header])).join(","))].join("\n");
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

function filteredLeads() {
  return state.leads.filter((lead) => {
    const haystack = Object.values(lead).join(" ").toLowerCase();
    if (state.search && !haystack.includes(state.search)) return false;
    if (state.filter === "finance") return financeRequested(lead);
    if (state.filter === "trade") return tradeRequested(lead);
    if (state.filter === "needs-call") return normalized(lead.finance_status || lead.lead_status).includes("CALL");
    if (state.filter === "complete") return normalized(lead.lead_status).includes("COMPLETE") || normalized(lead.finance_status).includes("APPROVED");
    return true;
  });
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

function leadDate(lead) {
  const date = new Date(lead.created_time || lead.last_contacted || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
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
  const source = lead.campaign_name || lead.ad_name || lead.form_name || "Meta";
  return `<span class="tag">${escapeHtml(shortSource(source))}</span>`;
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

function displayDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
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

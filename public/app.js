const state = {
  leads: [],
  headers: [],
  missingFinanceHeaders: [],
  selectedRow: null,
  selectedLeadRows: new Set(),
  filter: "all",
  search: ""
};

const els = {
  sheetMeta: document.querySelector("#sheetMeta"),
  refreshButton: document.querySelector("#refreshButton"),
  prepareColumnsButton: document.querySelector("#prepareColumnsButton"),
  searchInput: document.querySelector("#searchInput"),
  leadRows: document.querySelector("#leadRows"),
  totalLeads: document.querySelector("#totalLeads"),
  readyLeads: document.querySelector("#readyLeads"),
  needsCallLeads: document.querySelector("#needsCallLeads"),
  completeLeads: document.querySelector("#completeLeads"),
  selectAll: document.querySelector("#selectAll"),
  bulkBar: document.querySelector("#bulkBar"),
  selectedCount: document.querySelector("#selectedCount"),
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
  await loadLeads();
}

function bindEvents() {
  els.refreshButton.addEventListener("click", loadLeads);
  els.prepareColumnsButton.addEventListener("click", prepareColumns);
  els.saveButton.addEventListener("click", saveSelectedLead);
  els.selectAll.addEventListener("change", toggleVisibleRows);

  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderLeads();
  });

  document.querySelectorAll(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      state.filter = button.dataset.filter;
      renderLeads();
    });
  });
}

async function loadLeads() {
  setBusy(els.refreshButton, true, "Loading");
  try {
    const data = await api("/api/leads");
    state.headers = data.headers;
    state.missingFinanceHeaders = data.missingFinanceHeaders;
    state.leads = data.rows;
    state.selectedLeadRows = new Set([...state.selectedLeadRows].filter((row) => state.leads.some((lead) => lead.rowNumber === row)));
    els.sheetMeta.textContent = `${data.rows.length} lead${data.rows.length === 1 ? "" : "s"} synced`;
    renderMetrics();
    renderLeads();
    renderSetupButton();
  } catch (error) {
    els.sheetMeta.textContent = "Credentials needed";
    showToast(error.message);
    renderLeads();
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
    setBusy(els.prepareColumnsButton, false, "+ Prepare CRM fields");
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

function renderLeads() {
  const rows = filteredLeads();
  els.leadRows.innerHTML = "";

  if (!rows.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="8">${state.leads.length ? "No leads match this view." : "No leads loaded yet."}</td>`;
    els.leadRows.appendChild(row);
    renderBulkBar();
    return;
  }

  rows.forEach((lead, index) => {
    const row = document.createElement("tr");
    row.className = state.selectedLeadRows.has(lead.rowNumber) ? "is-selected" : "";
    row.innerHTML = `
      <td><input class="row-checkbox" data-row="${lead.rowNumber}" type="checkbox" ${state.selectedLeadRows.has(lead.rowNumber) ? "checked" : ""} /></td>
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
      <td>${sparkline(index, financeRequested(lead))}</td>
      <td>${probabilityTag(lead)}</td>
      <td>${escapeHtml(lead.assigned_to || "Unassigned")}</td>
      <td>${escapeHtml(lead.last_contacted || displayDate(lead.created_time))}</td>
    `;
    els.leadRows.appendChild(row);
  });

  els.leadRows.querySelectorAll(".row-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const rowNumber = Number(checkbox.dataset.row);
      checkbox.checked ? state.selectedLeadRows.add(rowNumber) : state.selectedLeadRows.delete(rowNumber);
      renderLeads();
    });
  });

  els.leadRows.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => openLead(Number(button.dataset.open)));
  });

  renderBulkBar();
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

function toggleVisibleRows() {
  filteredLeads().forEach((lead) => {
    if (els.selectAll.checked) {
      state.selectedLeadRows.add(lead.rowNumber);
    } else {
      state.selectedLeadRows.delete(lead.rowNumber);
    }
  });
  renderLeads();
}

function renderBulkBar() {
  const count = state.selectedLeadRows.size;
  els.selectedCount.textContent = count;
  els.bulkBar.classList.toggle("is-visible", count > 0);
}

function renderSetupButton() {
  els.prepareColumnsButton.style.display = state.missingFinanceHeaders.length ? "inline-flex" : "none";
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

function sourceTag(lead) {
  const source = lead.campaign_name || lead.ad_name || lead.form_name || "Organic";
  return `<span class="tag">${escapeHtml(shortSource(source))} ↗</span>`;
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
  if (text.includes("NEW") || text.includes("CALL") || text.includes("PRE")) variant = "orange";
  return `<span class="tag ${variant}">${escapeHtml(value || "New")}</span>`;
}

function probabilityTag(lead) {
  const priority = normalized(lead.priority);
  if (priority.includes("HIGH") || financeRequested(lead)) return `<span class="tag green">▥ High</span>`;
  if (priority.includes("LOW")) return `<span class="tag red">▥ Low</span>`;
  return `<span class="tag yellow">▥ Mid</span>`;
}

function sparkline(index, positive) {
  const paths = [
    "M1 14 L9 7 L17 12 L25 5 L33 9 L41 3 L49 8 L57 6 L65 2",
    "M1 8 L9 12 L17 10 L25 15 L33 13 L41 17 L49 14 L57 19 L65 18",
    "M1 16 L9 14 L17 15 L25 10 L33 12 L41 8 L49 9 L57 5 L65 7"
  ];
  const path = paths[index % paths.length];
  const color = positive ? "#6f9f77" : "#9f6f72";
  return `<svg class="spark" viewBox="0 0 70 22" aria-hidden="true"><path d="${path}" stroke="${color}"></path></svg>`;
}

function displayDate(value) {
  if (!value) return "No action";
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

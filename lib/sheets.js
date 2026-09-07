const crypto = require("crypto");

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1hjE0DJ_HCLiFNbpVaqfdIx0m-lFI0zkKYV_ivX3BHZs";
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || "Sheet1";
const SHEET_NAMES = (process.env.GOOGLE_SHEET_NAMES || `${SHEET_NAME},Sheet2,Leads 3,Leads 4`)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const META_DATASET_ID = process.env.META_DATASET_ID || "";
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "";
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || "";
const CRM_PIN = process.env.CRM_PIN || "";
const CRM_AUTH_EMAIL = (process.env.CRM_AUTH_EMAIL || "admin@gorillacars.com.au").trim().toLowerCase();
const CRM_SESSION_SECRET = process.env.CRM_SESSION_SECRET || process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "gorilla-crm-local-secret";
const CRM_SESSION_COOKIE = "gorilla_crm_session";
const CRM_SESSION_MS = 8 * 60 * 60 * 1000;
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_AUTH_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const FINANCE_HEADERS = [
  "finance_status",
  "priority",
  "assigned_to",
  "next_action",
  "last_contacted",
  "vehicle_match",
  "finance_notes"
];
const META_FEEDBACK_HEADERS = [
  "meta_feedback_status",
  "meta_feedback_event",
  "meta_feedback_sent_at",
  "meta_feedback_error"
];
const WRITEABLE_FIELDS = new Set(["lead_status", ...FINANCE_HEADERS]);
const META_STATUS_EVENT_MAP = {
  "IN PROGRESS": "QualifiedLead",
  COMPLETE: "ConvertedLead",
  "NOT QUALIFIED": "DisqualifiedLead",
  DECLINED: "DisqualifiedLead"
};
let tokenCache = null;

async function readLeads() {
  const sheets = await Promise.all(SHEET_NAMES.map(readSheetLeads));
  const headers = mergeHeaders(sheets.map((sheet) => sheet.headers));
  const missingFinanceHeaders = unique(sheets.flatMap((sheet) => sheet.missingFinanceHeaders));

  return {
    headers,
    missingFinanceHeaders,
    sheetNames: SHEET_NAMES,
    rows: sheets.flatMap((sheet) => sheet.rows)
  };
}

async function readSheetLeads(sheetName) {
  const range = `'${escapeSheetName(sheetName)}'!A1:AZ1000`;
  const values = await sheetsGet(range);
  const headers = values[0] && values[0].length ? values[0] : [];
  const rows = values.slice(1).filter((row) => row.some(Boolean));
  const missingFinanceHeaders = FINANCE_HEADERS.filter((header) => !headers.includes(header));

  return {
    sheetName,
    headers,
    missingFinanceHeaders,
    rows: rows.map((row, index) => rowToLead(headers, row, index + 2, sheetName))
  };
}

async function readCreatedLeadCount() {
  const { rows } = await readLeads();
  return {
    createdCount: rows.filter(isCreatedLead).length,
    checkedAt: new Date().toISOString()
  };
}

async function ensureFinanceColumns() {
  const results = await Promise.all(SHEET_NAMES.map((sheetName) => ensureColumns([...FINANCE_HEADERS, ...META_FEEDBACK_HEADERS], sheetName)));
  return {
    added: unique(results.flatMap((result) => result.added)),
    sheets: results
  };
}

async function ensureColumns(requiredHeaders, sheetName = SHEET_NAME) {
  const values = await sheetsGet(`'${escapeSheetName(sheetName)}'!A1:AZ1`);
  const headers = values[0] && values[0].length ? values[0] : [];
  const missing = requiredHeaders.filter((header) => !headers.includes(header));

  if (!missing.length) {
    return { sheetName, added: [], headers };
  }

  const startColumn = headers.length + 1;
  const endColumn = headers.length + missing.length;
  await sheetsUpdate(
    `'${escapeSheetName(sheetName)}'!${columnName(startColumn)}1:${columnName(endColumn)}1`,
    [missing]
  );

  return { sheetName, added: missing, headers: [...headers, ...missing] };
}

async function updateLead(rowNumber, updates, sheetName = SHEET_NAME) {
  if (!SHEET_NAMES.includes(sheetName)) {
    throw publicError(400, "Invalid sheet tab.");
  }

  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    throw publicError(400, "Invalid lead row.");
  }

  let values = await sheetsGet(`'${escapeSheetName(sheetName)}'!A1:AZ${rowNumber}`);
  let headers = values[0] && values[0].length ? values[0] : [];
  const existingLead = rowToLead(headers, values[rowNumber - 1] || [], rowNumber, sheetName);
  const allowedUpdates = Object.entries(updates || {}).filter(([key]) => WRITEABLE_FIELDS.has(key));

  if (!allowedUpdates.length) {
    throw publicError(400, "No supported finance fields were provided.");
  }

  const missing = allowedUpdates.map(([key]) => key).filter((key) => !headers.includes(key));
  const missingBaseColumns = missing.filter((key) => !FINANCE_HEADERS.includes(key));
  if (missingBaseColumns.length) {
    throw publicError(409, `Missing sheet columns: ${missingBaseColumns.join(", ")}.`);
  }

  const missingFinanceColumns = missing.filter((key) => FINANCE_HEADERS.includes(key));
  if (missingFinanceColumns.length) {
    const result = await ensureColumns(missingFinanceColumns, sheetName);
    headers = result.headers;
  }

  const data = allowedUpdates.map(([key, value]) => {
    const column = columnName(headers.indexOf(key) + 1);
    return {
      range: `'${escapeSheetName(sheetName)}'!${column}${rowNumber}`,
      values: [[value == null ? "" : String(value)]]
    };
  });

  await sheetsBatchUpdate(data);
  const updated = Object.fromEntries(allowedUpdates);
  const updatedLead = { ...existingLead, ...updated };
  const metaFeedback = await safeHandleMetaFeedback(rowNumber, headers, updatedLead, sheetName);

  return { ok: true, rowNumber, sheetName, updated, metaFeedback };
}

async function safeHandleMetaFeedback(rowNumber, headers, lead, sheetName) {
  try {
    return await handleMetaFeedback(rowNumber, headers, lead, sheetName);
  } catch (error) {
    return {
      status: "error",
      error: error.message || "Meta feedback failed."
    };
  }
}

async function handleMetaFeedback(rowNumber, headers, lead, sheetName) {
  const eventName = metaEventForStatus(lead.lead_status);
  if (!eventName) {
    return { status: "skipped", reason: "No Meta feedback event mapped for this lead status." };
  }

  if (lead.meta_feedback_status === "sent" && lead.meta_feedback_event === eventName) {
    return { status: "skipped", event: eventName, reason: "This event has already been sent for this lead." };
  }

  const result = await sendMetaFeedbackEvent(lead, eventName);
  const feedbackUpdate = {
    meta_feedback_status: result.status,
    meta_feedback_event: eventName,
    meta_feedback_sent_at: result.status === "sent" ? new Date().toISOString() : "",
    meta_feedback_error: result.error || ""
  };
  const ensured = await ensureColumns(META_FEEDBACK_HEADERS, sheetName);
  await writeRowValues(rowNumber, ensured.headers, feedbackUpdate, sheetName);
  return result;
}

async function sendMetaFeedbackEvent(lead, eventName) {
  if (!META_DATASET_ID || !META_ACCESS_TOKEN) {
    return {
      status: "skipped",
      event: eventName,
      error: "Meta environment variables are not configured."
    };
  }

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: `${lead.id || lead.rowNumber}:${eventName}`,
        action_source: "system_generated",
        user_data: buildMetaUserData(lead),
        custom_data: {
          lead_id: lead.id || "",
          lead_status: lead.lead_status || "",
          source: lead.campaign_name || lead.ad_name || lead.form_name || "Meta Lead Form"
        }
      }
    ]
  };

  if (META_TEST_EVENT_CODE) {
    payload.test_event_code = META_TEST_EVENT_CODE;
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_DATASET_ID}/events?access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      status: "error",
      event: eventName,
      error: body.error?.message || `Meta request failed with status ${response.status}.`
    };
  }

  return {
    status: "sent",
    event: eventName,
    eventsReceived: body.events_received || 0
  };
}

function buildMetaUserData(lead) {
  const userData = {};
  const emailHash = hashForMeta(lead.email);
  const phoneHash = hashForMeta(normalizePhone(lead.phone));
  const externalIdHash = hashForMeta(lead.id);

  if (emailHash) userData.em = [emailHash];
  if (phoneHash) userData.ph = [phoneHash];
  if (externalIdHash) userData.external_id = [externalIdHash];

  return userData;
}

function metaEventForStatus(status) {
  return META_STATUS_EVENT_MAP[normalizeStatus(status)] || "";
}

function normalizeStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function hashForMeta(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

async function writeRowValues(rowNumber, headers, valuesByHeader, sheetName = SHEET_NAME) {
  const data = Object.entries(valuesByHeader)
    .filter(([key]) => headers.includes(key))
    .map(([key, value]) => {
      const column = columnName(headers.indexOf(key) + 1);
      return {
        range: `'${escapeSheetName(sheetName)}'!${column}${rowNumber}`,
        values: [[value == null ? "" : String(value)]]
      };
    });

  if (data.length) {
    await sheetsBatchUpdate(data);
  }
}

function getConfig() {
  return {
    sheetId: SHEET_ID,
    sheetName: SHEET_NAME,
    sheetNames: SHEET_NAMES,
    requiredFinanceHeaders: FINANCE_HEADERS,
    requiredMetaFeedbackHeaders: META_FEEDBACK_HEADERS,
    metaFeedbackEnabled: Boolean(META_DATASET_ID && META_ACCESS_TOKEN)
  };
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function requireSession(req, res) {
  if (isValidSession(req)) return true;
  sendJson(res, 401, { error: "CRM is locked." });
  return false;
}

async function unlockSession(req, res) {
  const body = await readRequestBody(req);

  if (shouldUseSupabaseAuth()) {
    if (!isSupabaseAuthConfigured()) {
      return sendJson(res, 503, { error: "Supabase Auth environment variables are not fully configured." });
    }

    await verifySupabasePasswordLogin({
      email: body.email || CRM_AUTH_EMAIL,
      password: body.password || body.pin,
      forwardedFor: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || ""
    });
  } else {
    if (!CRM_PIN) {
      return sendJson(res, 503, { error: "Supabase Auth is not configured." });
    }

    if (String(body.pin || body.password || "").trim() !== CRM_PIN) {
      return sendJson(res, 401, { error: "Incorrect password." });
    }
  }

  const expiresAt = Date.now() + CRM_SESSION_MS;
  setSessionCookie(res, createSessionToken(expiresAt), Math.floor(CRM_SESSION_MS / 1000));
  return sendJson(res, 200, { ok: true, expiresAt });
}

function isSupabaseAuthConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_AUTH_KEY);
}

function shouldUseSupabaseAuth() {
  return process.env.NODE_ENV === "production" || Boolean(SUPABASE_URL || SUPABASE_AUTH_KEY);
}

async function verifySupabasePasswordLogin({ email, password, forwardedFor }) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanPassword = String(password || "");

  if (cleanEmail !== CRM_AUTH_EMAIL) {
    throw publicError(401, "Use the authorised Gorilla Cars admin account.");
  }

  if (!cleanPassword) {
    throw publicError(400, "Enter your Supabase password.");
  }

  const authUrl = supabaseAuthUrl();

  const headers = {
    apikey: SUPABASE_AUTH_KEY,
    Authorization: `Bearer ${SUPABASE_AUTH_KEY}`,
    "Content-Type": "application/json"
  };
  if (forwardedFor) {
    headers["X-Forwarded-For"] = String(forwardedFor).split(",")[0].trim();
  }

  let response;
  try {
    response = await fetch(authUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: cleanEmail, password: cleanPassword })
    });
  } catch (error) {
    throw publicError(502, `Could not reach Supabase Auth. Check SUPABASE_URL in Vercel. ${error.message}`);
  }
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw publicError(401, payload.error_description || payload.msg || "Incorrect email or password.");
  }

  const authenticatedEmail = String(payload.user?.email || "").trim().toLowerCase();
  if (authenticatedEmail !== CRM_AUTH_EMAIL) {
    throw publicError(403, "This Supabase user is not allowed to access Gorilla CRM.");
  }

  return payload.user;
}

function supabaseAuthUrl() {
  try {
    return new URL("/auth/v1/token?grant_type=password", SUPABASE_URL).toString();
  } catch {
    throw publicError(503, "SUPABASE_URL is not a valid Supabase project URL.");
  }
}

function lockSession(res) {
  setSessionCookie(res, "", 0);
  return sendJson(res, 200, { ok: true });
}

function isValidSession(req) {
  const token = parseCookies(req.headers.cookie || "")[CRM_SESSION_COOKIE];
  if (!token) return false;

  const [expiresAtText, signature] = token.split(".");
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !signature) return false;

  return timingSafeEqual(signature, signSessionExpiry(expiresAt));
}

function createSessionToken(expiresAt) {
  return `${expiresAt}.${signSessionExpiry(expiresAt)}`;
}

function signSessionExpiry(expiresAt) {
  return crypto.createHmac("sha256", CRM_SESSION_SECRET).update(String(expiresAt)).digest("hex");
}

function setSessionCookie(res, value, maxAge) {
  const parts = [
    `${CRM_SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function parseCookies(cookieHeader) {
  return cookieHeader.split(";").reduce((cookies, item) => {
    const [key, ...valueParts] = item.trim().split("=");
    if (key) cookies[key] = valueParts.join("=");
    return cookies;
  }, {});
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function handleError(res, error) {
  console.error(error);
  sendJson(res, error.statusCode || 500, {
    error: error.publicMessage || "Something went wrong.",
    detail: process.env.NODE_ENV === "production" ? undefined : error.message
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(publicError(413, "Request body is too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(publicError(400, "Invalid JSON."));
      }
    });
  });
}

async function sheetsGet(range) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json();

  if (!response.ok) {
    throw publicError(response.status, payload.error?.message || "Unable to read Google Sheet.");
  }

  return payload.values || [];
}

async function sheetsUpdate(range, values) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ range, majorDimension: "ROWS", values })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw publicError(response.status, payload.error?.message || "Unable to update Google Sheet.");
  }

  return payload;
}

async function sheetsBatchUpdate(data) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw publicError(response.status, payload.error?.message || "Unable to update Google Sheet.");
  }

  return payload;
}

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const account = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    },
    account.private_key
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw publicError(response.status, payload.error_description || "Google authentication failed.");
  }

  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000
  };
  return tokenCache.accessToken;
}

function getServiceAccount() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return {
      client_email: parsed.client_email,
      private_key: normalizePrivateKey(parsed.private_key)
    };
  }

  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY)
    };
  }

  throw publicError(503, "Google Sheets credentials are not configured on the server.");
}

function rowToLead(headers, row, rowNumber, sheetName = SHEET_NAME) {
  const lead = { rowNumber, sheetName };
  headers.forEach((header, index) => {
    lead[header] = row[index] || "";
  });
  applyLeadAliases(lead, headers, row);
  return lead;
}

function applyLeadAliases(lead, headers, row) {
  if (!lead.full_name) {
    lead.full_name = firstHeaderValue(headers, row, [
      "full_name",
      "full name",
      "name",
      "customer_name",
      "customer name"
    ]);
  }

  if (!lead.email) {
    lead.email = firstHeaderValue(headers, row, [
      "email",
      "email_address",
      "email address"
    ]);
  }

  if (!lead.phone) {
    lead.phone = firstHeaderValue(headers, row, [
      "phone",
      "phone_number",
      "phone number",
      "mobile",
      "mobile_number",
      "mobile number",
      "contact_number",
      "contact number"
    ]);
  }
}

function firstHeaderValue(headers, row, names) {
  const wanted = new Set(names.map(normalizeHeader));
  const index = headers.findIndex((header) => wanted.has(normalizeHeader(header)));
  return index === -1 ? "" : row[index] || "";
}

function normalizeHeader(header) {
  return String(header || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function mergeHeaders(headerGroups) {
  return unique(headerGroups.flat());
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isCreatedLead(lead) {
  const status = String(lead.lead_status || lead.finance_status || lead.status || "").trim().toUpperCase();
  return status === "CREATED";
}

function signJwt(header, payload, privateKey) {
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const body = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createSign("RSA-SHA256").update(body).sign(privateKey);
  return `${body}.${base64Url(signature)}`;
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizePrivateKey(key) {
  return key.replace(/\\n/g, "\n");
}

function escapeSheetName(name) {
  return name.replace(/'/g, "''");
}

function columnName(index) {
  let name = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name;
}

function publicError(statusCode, publicMessage) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.publicMessage = publicMessage;
  return error;
}

module.exports = {
  ensureFinanceColumns,
  getConfig,
  handleError,
  lockSession,
  readLeads,
  readCreatedLeadCount,
  readRequestBody,
  requireSession,
  sendJson,
  unlockSession,
  updateLead
};

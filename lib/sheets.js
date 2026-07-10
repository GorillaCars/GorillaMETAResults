const crypto = require("crypto");

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1hjE0DJ_HCLiFNbpVaqfdIx0m-lFI0zkKYV_ivX3BHZs";
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || "Sheet1";
const FINANCE_HEADERS = [
  "finance_status",
  "priority",
  "assigned_to",
  "next_action",
  "last_contacted",
  "vehicle_match",
  "finance_notes"
];
const WRITEABLE_FIELDS = new Set(["lead_status", ...FINANCE_HEADERS]);
let tokenCache = null;

async function readLeads() {
  const range = `'${escapeSheetName(SHEET_NAME)}'!A1:AZ1000`;
  const values = await sheetsGet(range);
  const headers = values[0] && values[0].length ? values[0] : [];
  const rows = values.slice(1).filter((row) => row.some(Boolean));
  const missingFinanceHeaders = FINANCE_HEADERS.filter((header) => !headers.includes(header));

  return {
    headers,
    missingFinanceHeaders,
    rows: rows.map((row, index) => rowToLead(headers, row, index + 2))
  };
}

async function ensureFinanceColumns() {
  return ensureColumns(FINANCE_HEADERS);
}

async function ensureColumns(requiredHeaders) {
  const values = await sheetsGet(`'${escapeSheetName(SHEET_NAME)}'!A1:AZ1`);
  const headers = values[0] && values[0].length ? values[0] : [];
  const missing = requiredHeaders.filter((header) => !headers.includes(header));

  if (!missing.length) {
    return { added: [], headers };
  }

  const startColumn = headers.length + 1;
  const endColumn = headers.length + missing.length;
  await sheetsUpdate(
    `'${escapeSheetName(SHEET_NAME)}'!${columnName(startColumn)}1:${columnName(endColumn)}1`,
    [missing]
  );

  return { added: missing, headers: [...headers, ...missing] };
}

async function updateLead(rowNumber, updates) {
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    throw publicError(400, "Invalid lead row.");
  }

  let values = await sheetsGet(`'${escapeSheetName(SHEET_NAME)}'!A1:AZ1`);
  let headers = values[0] && values[0].length ? values[0] : [];
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
    const result = await ensureColumns(missingFinanceColumns);
    headers = result.headers;
  }

  const data = allowedUpdates.map(([key, value]) => {
    const column = columnName(headers.indexOf(key) + 1);
    return {
      range: `'${escapeSheetName(SHEET_NAME)}'!${column}${rowNumber}`,
      values: [[value == null ? "" : String(value)]]
    };
  });

  await sheetsBatchUpdate(data);
  return { ok: true, rowNumber, updated: Object.fromEntries(allowedUpdates) };
}

function getConfig() {
  return {
    sheetId: SHEET_ID,
    sheetName: SHEET_NAME,
    requiredFinanceHeaders: FINANCE_HEADERS
  };
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
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

function rowToLead(headers, row, rowNumber) {
  const lead = { rowNumber };
  headers.forEach((header, index) => {
    lead[header] = row[index] || "";
  });
  return lead;
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
  readLeads,
  readRequestBody,
  sendJson,
  updateLead
};

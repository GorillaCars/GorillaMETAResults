const { handleError, readRequestBody, requireSession, sendJson, updateLead } = require("../../lib/sheets");

module.exports = async function handler(req, res) {
  if (req.method !== "PATCH") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    if (!requireSession(req, res)) return;
    const rowNumber = Number(req.query.rowNumber);
    const sheetName = req.query.sheetName || undefined;
    const body = await readRequestBody(req);
    const result = await updateLead(rowNumber, body, sheetName);
    return sendJson(res, 200, result);
  } catch (error) {
    return handleError(res, error);
  }
};

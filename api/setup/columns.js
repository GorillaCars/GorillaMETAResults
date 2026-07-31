const { ensureFinanceColumns, handleError, requireSession, sendJson } = require("../../lib/sheets");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    if (!requireSession(req, res)) return;
    const result = await ensureFinanceColumns();
    return sendJson(res, 200, result);
  } catch (error) {
    return handleError(res, error);
  }
};

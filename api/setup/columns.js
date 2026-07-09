const { ensureFinanceColumns, handleError, sendJson } = require("../../lib/sheets");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const result = await ensureFinanceColumns();
    return sendJson(res, 200, result);
  } catch (error) {
    return handleError(res, error);
  }
};

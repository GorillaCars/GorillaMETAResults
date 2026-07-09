const { handleError, readRequestBody, sendJson, updateLead } = require("../../lib/sheets");

module.exports = async function handler(req, res) {
  if (req.method !== "PATCH") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const rowNumber = Number(req.query.rowNumber);
    const body = await readRequestBody(req);
    const result = await updateLead(rowNumber, body);
    return sendJson(res, 200, result);
  } catch (error) {
    return handleError(res, error);
  }
};

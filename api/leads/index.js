const { handleError, readLeads, sendJson } = require("../../lib/sheets");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const data = await readLeads();
    return sendJson(res, 200, data);
  } catch (error) {
    return handleError(res, error);
  }
};

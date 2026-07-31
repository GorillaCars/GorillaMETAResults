const { handleError, sendJson, unlockSession } = require("../../lib/sheets");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    return await unlockSession(req, res);
  } catch (error) {
    return handleError(res, error);
  }
};

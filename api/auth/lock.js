const { lockSession, sendJson } = require("../../lib/sheets");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  return lockSession(res);
};

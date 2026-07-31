const { getConfig, requireSession, sendJson } = require("../lib/sheets");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!requireSession(req, res)) return;
  return sendJson(res, 200, getConfig());
};

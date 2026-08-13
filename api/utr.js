const { getDb } = require("../../../lib/mongodb");
const { checkApiKey } = require("../../../lib/utils");
const { checkUtrViaImap } = require("../../../lib/imapCheck");

// GET or POST /api/pass/:password/utr?utr=XXXXXXXXXXXX&email=you@gmail.com
// Header: x-api-key: GATEWAY_API_KEY
//
// Same as /api/pass/utr, except the Gmail App Password is passed directly
// in the URL path instead of being fixed in an env var. This lets one
// deployed API check UTRs against different Gmail inboxes per request,
// e.g. if you run multiple bots each with their own Gmail account.
//
// `email` can be passed as a query param; if omitted, falls back to the
// GMAIL_EMAIL env var (useful if you only ever check one inbox and just
// want the password out of your env vars for some reason).
//
// SECURITY NOTE: putting a password in a URL means it can end up in
// browser history, proxy logs, etc. Prefer /api/pass/utr with env vars
// where possible; use this only if you specifically need per-request
// credentials.
module.exports = async (req, res) => {
  const startedAt = Date.now();

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Use GET or POST" });
  }
  if (!checkApiKey(req, res)) return;

  const { password } = req.query;
  const utr = req.method === "GET" ? req.query.utr : req.body && req.body.utr;
  const email = req.method === "GET" ? req.query.email : req.body && req.body.email;

  if (!password) {
    return res.status(400).json({
      verified: false,
      message: "App password missing from URL",
      dev: "@MAKERBOTRAVIII",
      time: (Date.now() - startedAt) / 1000,
    });
  }

  if (!utr || !/^[A-Za-z0-9]{10,22}$/.test(String(utr).trim())) {
    return res.status(400).json({
      verified: false,
      utr: utr || null,
      message: "Invalid or missing UTR",
      dev: "@MAKERBOTRAVIII",
      Admin: "t.me/MAKERBOTRAVIII",
      Channel: "t.me/YourChannelHere",
      time: (Date.now() - startedAt) / 1000,
    });
  }

  const cleanUtr = String(utr).trim();
  const db = await getDb();

  const existingUse = await db.collection("used_utrs").findOne({ utr: cleanUtr });
  if (existingUse) {
    return res.status(200).json({
      verified: false,
      utr: cleanUtr,
      message: "This UTR has already been used/claimed before.",
      dev: "@MAKERBOTRAVIII",
      Admin: "t.me/MAKERBOTRAVIII",
      Channel: "t.me/YourChannelHere",
      time: (Date.now() - startedAt) / 1000,
    });
  }

  let result;
  try {
    result = await checkUtrViaImap(cleanUtr, {
      limit: 100,
      email: email, // undefined -> falls back to GMAIL_EMAIL env var inside checkUtrViaImap
      password: String(password).replace(/\s+/g, ""), // strip spaces if pasted with them
    });
  } catch (e) {
    return res.status(500).json({
      verified: false,
      utr: cleanUtr,
      message: "Email check failed: " + e.message,
      dev: "@MAKERBOTRAVIII",
      Admin: "t.me/MAKERBOTRAVIII",
      Channel: "t.me/YourChannelHere",
      time: (Date.now() - startedAt) / 1000,
    });
  }

  if (!result.found) {
    return res.status(200).json({
      verified: false,
      utr: cleanUtr,
      message: `UTR not found in last ${result.scanned || 0} emails.`,
      dev: "@MAKERBOTRAVIII",
      Admin: "t.me/MAKERBOTRAVIII",
      Channel: "t.me/YourChannelHere",
      time: (Date.now() - startedAt) / 1000,
    });
  }

  try {
    await db.collection("used_utrs").insertOne({
      utr: cleanUtr,
      order_id: null,
      reserved_at: new Date(),
      confirmed: true,
      verified_by: "imap_url_password",
    });
  } catch (e) {
    return res.status(200).json({
      verified: false,
      utr: cleanUtr,
      message: "This UTR has already been used/claimed before.",
      dev: "@MAKERBOTRAVIII",
      Admin: "t.me/MAKERBOTRAVIII",
      Channel: "t.me/YourChannelHere",
      time: (Date.now() - startedAt) / 1000,
    });
  }

  return res.status(200).json({
    verified: true,
    utr: cleanUtr,
    amount: result.amount,
    message: "UTR found and verified via email.",
    dev: "@MAKERBOTRAVIII",
    Admin: "t.me/MAKERBOTRAVIII",
    Channel: "t.me/YourChannelHere",
    time: (Date.now() - startedAt) / 1000,
  });
};

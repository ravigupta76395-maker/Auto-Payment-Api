const { getDb } = require("../../lib/mongodb");
const { checkApiKey } = require("../../lib/utils");
const { checkUtrViaImap } = require("../../lib/imapCheck");

// GET or POST /api/pass/utr?utr=XXXXXXXXXXXX
// Header: x-api-key: GATEWAY_API_KEY
//
// Standalone checker: given a UTR, searches your Gmail inbox (via App
// Password) for a matching transaction email. Independent of the
// order-based /api/create-order flow — useful if you just want a quick
// "is this UTR real and unused" check from your own bot logic.
module.exports = async (req, res) => {
  const startedAt = Date.now();

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Use GET or POST" });
  }
  if (!checkApiKey(req, res)) return;

  const utr = (req.method === "GET" ? req.query.utr : req.body && req.body.utr);

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

  // Duplicate-claim protection, same as the main flow.
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
    result = await checkUtrViaImap(cleanUtr, { limit: 100 });
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

  // Reserve it so this exact UTR can't be claimed twice, whether it comes
  // through this endpoint or the main /api/submit-utr flow.
  try {
    await db.collection("used_utrs").insertOne({
      utr: cleanUtr,
      order_id: null,
      reserved_at: new Date(),
      confirmed: true,
      verified_by: "imap_app_password",
    });
  } catch (e) {
    // Someone else claimed it in the same instant.
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

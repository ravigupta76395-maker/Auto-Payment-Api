const { getDb } = require("../lib/mongodb");
const { checkApiKey, isPlausibleUtr } = require("../lib/utils");
const { findUtrInEmail } = require("../lib/gmail");

// POST /api/submit-utr
// body: { order_id, utr }
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Use POST" });
  }
  if (!checkApiKey(req, res)) return;

  const { order_id, utr } = req.body || {};

  if (!order_id || !utr) {
    return res.status(400).json({ status: "error", message: "order_id and utr are required" });
  }

  const cleanUtr = String(utr).trim();

  if (!isPlausibleUtr(cleanUtr)) {
    return res.status(400).json({ status: "invalid", message: "Invalid UTR format" });
  }

  const db = await getDb();
  const order = await db.collection("orders").findOne({ order_id });

  if (!order) {
    return res.status(404).json({ status: "invalid", message: "Order not found" });
  }

  if (order.status === "approved") {
    return res.status(409).json({ status: "already_processed", message: "This order is already approved" });
  }

  // --- Duplicate-claim check (race-safe via unique index) ---
  const existingUse = await db.collection("used_utrs").findOne({ utr: cleanUtr });
  if (existingUse) {
    return res.status(409).json({
      status: "already_used",
      message: "This UTR has already been used to claim a deposit",
      dev: "@MAKERBOTRAVIII",
    });
  }

  // Reserve the UTR before we go check email, so a second request for the
  // same UTR can't race past this point while we're verifying.
  try {
    await db.collection("used_utrs").insertOne({
      utr: cleanUtr,
      order_id,
      reserved_at: new Date(),
      confirmed: false,
    });
  } catch (e) {
    return res.status(409).json({
      status: "already_used",
      message: "This UTR has already been used to claim a deposit",
      dev: "@MAKERBOTRAVIII",
    });
  }

  await db.collection("orders").updateOne(
    { order_id },
    { $set: { utr: cleanUtr, status: "pending_review", updated_at: new Date() } }
  );

  // --- Automatic email verification ---
  let emailResult;
  try {
    emailResult = await findUtrInEmail(cleanUtr, { maxResults: 100 });
  } catch (e) {
    emailResult = { found: false, error: e.message };
  }

  if (emailResult.found) {
    if (emailResult.amount !== null && emailResult.amount !== order.amount) {
      // UTR is real, but paid amount doesn't match what was ordered — do NOT
      // auto-approve, flag for manual review instead of silently trusting it.
      return res.status(200).json({
        status: "pending_review",
        message: `UTR found but amount mismatch (email: ₹${emailResult.amount}, expected: ₹${order.amount}). Sent for manual review.`,
        order_id,
        dev: "@MAKERBOTRAVIII",
      });
    }

    await db.collection("orders").updateOne(
      { order_id },
      { $set: { status: "approved", updated_at: new Date(), verified_by: "email" } }
    );
    await db.collection("used_utrs").updateOne(
      { order_id },
      { $set: { confirmed: true, confirmed_at: new Date(), verified_by: "email" } }
    );

    return res.status(200).json({
      status: "approved",
      message: "Payment verified automatically via email. Credit the balance now.",
      order_id,
      bot_id: order.bot_id,
      user_id: order.user_id,
      amount: order.amount,
      dev: "@MAKERBOTRAVIII",
    });
  }

  // Not found yet — email may just be delayed. Leave it in pending_review
  // so the bot can poll /api/status, and so you still have a manual
  // fallback (via /api/admin/decision) if the email never arrives.
  return res.status(200).json({
    status: "pending_review",
    message: `UTR not found in last ${emailResult.scanned || 0} emails yet. It will keep being checked — you'll be notified once verified.`,
    order_id,
    dev: "@MAKERBOTRAVIII",
  });
};

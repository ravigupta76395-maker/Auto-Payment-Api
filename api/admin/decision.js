const { getDb } = require("../../lib/mongodb");
const { checkAdminKey } = require("../../lib/utils");

// POST /api/admin/decision
// body: { order_id, action }   action = "approve" | "reject"
//
// This is the ONLY place balance actually gets credited. Call this from
// your admin Telegram bot (inline "Approve"/"Reject" buttons) after you've
// manually checked your bank/UPI app for the real transaction.
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Use POST" });
  }
  if (!checkAdminKey(req, res)) return;

  const { order_id, action } = req.body || {};

  if (!order_id || !["approve", "reject"].includes(action)) {
    return res.status(400).json({
      status: "error",
      message: "order_id and action ('approve' or 'reject') are required",
    });
  }

  const db = await getDb();
  const order = await db.collection("orders").findOne({ order_id });

  if (!order) {
    return res.status(404).json({ status: "error", message: "Order not found" });
  }

  if (order.status !== "pending_review") {
    return res.status(409).json({
      status: "error",
      message: `Order is not pending review (current status: ${order.status})`,
    });
  }

  if (action === "approve") {
    await db.collection("orders").updateOne(
      { order_id },
      { $set: { status: "approved", updated_at: new Date() } }
    );
    await db.collection("used_utrs").updateOne(
      { order_id },
      { $set: { confirmed: true, confirmed_at: new Date() } }
    );

    return res.status(200).json({
      status: "approved",
      order_id,
      bot_id: order.bot_id,
      user_id: order.user_id,
      amount: order.amount,
      message: "Order approved. Credit this amount to the user's balance in your bot now.",
      dev: "@MAKERBOTRAVIII",
    });
  }

  // Reject: release the UTR reservation so the user can correct/resubmit it.
  await db.collection("orders").updateOne(
    { order_id },
    { $set: { status: "rejected", updated_at: new Date() } }
  );
  await db.collection("used_utrs").deleteOne({ order_id, confirmed: false });

  return res.status(200).json({
    status: "rejected",
    order_id,
    message: "Order rejected and UTR reservation released.",
    dev: "@MAKERBOTRAVIII",
  });
};

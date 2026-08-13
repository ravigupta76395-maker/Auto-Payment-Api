const { getDb } = require("../lib/mongodb");
const { checkApiKey, genOrderId, buildUpiQrUrl } = require("../lib/utils");

// POST /api/create-order
// body: { bot_id, user_id, amount }
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Use POST" });
  }
  if (!checkApiKey(req, res)) return;

  const { bot_id, user_id, amount } = req.body || {};

  if (!bot_id || !user_id || !amount || Number(amount) <= 0) {
    return res.status(400).json({
      status: "error",
      message: "bot_id, user_id and a positive amount are required",
    });
  }

  const db = await getDb();
  const order_id = genOrderId();

  const order = {
    order_id,
    bot_id: String(bot_id),
    user_id: String(user_id),
    amount: Number(amount),
    status: "awaiting_utr", // awaiting_utr -> pending_review -> approved | rejected
    utr: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  await db.collection("orders").insertOne(order);

  const qr_url = buildUpiQrUrl(
    process.env.UPI_ID,
    process.env.UPI_PAYEE_NAME || "Merchant",
    amount,
    order_id
  );

  return res.status(200).json({
    status: "success",
    data: {
      order_id,
      amount: Number(amount),
      qr_url,
      upi_id: process.env.UPI_ID,
      instructions: "Scan the QR, pay the exact amount, then submit the UTR/Reference number shown after payment.",
    },
    dev: "@MAKERBOTRAVIII",
  });
};

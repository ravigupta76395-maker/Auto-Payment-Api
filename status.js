const { getDb } = require("../lib/mongodb");
const { checkApiKey } = require("../lib/utils");

// GET /api/status?order_id=DEPXXXXX
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Use GET" });
  }
  if (!checkApiKey(req, res)) return;

  const { order_id } = req.query || {};
  if (!order_id) {
    return res.status(400).json({ status: "error", message: "order_id is required" });
  }

  const db = await getDb();
  const order = await db.collection("orders").findOne({ order_id });

  if (!order) {
    return res.status(404).json({ status: "error", message: "Order not found" });
  }

  return res.status(200).json({
    status: "success",
    data: {
      order_id: order.order_id,
      amount: order.amount,
      state: order.status, // awaiting_utr | pending_review | approved | rejected
      utr: order.utr,
    },
    dev: "@MAKERBOTRAVIII",
  });
};

const { getDb } = require("../../lib/mongodb");
const { checkAdminKey } = require("../../lib/utils");

// GET /api/admin/orders?state=pending_review&limit=50
// Header: x-admin-key: ADMIN_KEY
//
// Lists orders for the admin panel. `state` filters by status
// (awaiting_utr | pending_review | approved | rejected); omit for all.
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ status: "error", message: "Use GET" });
  }
  if (!checkAdminKey(req, res)) return;

  const { state, limit } = req.query || {};
  const db = await getDb();

  const filter = {};
  if (state) filter.status = state;

  const orders = await db
    .collection("orders")
    .find(filter)
    .sort({ created_at: -1 })
    .limit(Math.min(parseInt(limit, 10) || 50, 200))
    .toArray();

  return res.status(200).json({
    status: "success",
    count: orders.length,
    orders: orders.map((o) => ({
      order_id: o.order_id,
      bot_id: o.bot_id,
      user_id: o.user_id,
      amount: o.amount,
      status: o.status,
      utr: o.utr,
      verified_by: o.verified_by || null,
      created_at: o.created_at,
      updated_at: o.updated_at,
    })),
    dev: "@MAKERBOTRAVIII",
  });
};

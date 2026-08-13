module.exports = (req, res) => {
  return res.status(200).json({
    status: "online",
    message: "Deposit Gateway API is running.",
    dev: "@MAKERBOTRAVIII",
    endpoints: {
      create_order: "/api/create-order",
      submit_utr: "/api/submit-utr",
      status: "/api/status",
      admin_decision: "/api/admin/decision",
      admin_orders: "/api/admin/orders",
      pass_utr: "/api/pass/utr",
      pass_utr_dynamic: "/api/pass/:password/utr",
    },
  });
};

const crypto = require("crypto");

// Simple API key check so random people on the internet can't create fake
// orders or approve deposits against your database.
function checkApiKey(req, res) {
  const key = req.headers["x-api-key"] || (req.query && req.query.api_key);
  if (!key || key !== process.env.GATEWAY_API_KEY) {
    res.status(401).json({ status: "error", message: "Invalid or missing API key" });
    return false;
  }
  return true;
}

function checkAdminKey(req, res) {
  const key = req.headers["x-admin-key"] || (req.query && req.query.admin_key);
  if (!key || key !== process.env.ADMIN_KEY) {
    res.status(401).json({ status: "error", message: "Invalid or missing admin key" });
    return false;
  }
  return true;
}

function genOrderId() {
  return "DEP" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString("hex").toUpperCase();
}

// Basic UPI UTR sanity check: Telegram users will paste all sorts of junk.
// Real UTRs are typically 12 numeric digits (bank RRN), but some UPI apps
// show 12-22 alphanumeric reference IDs. Adjust this regex to match what
// your specific bank/UPI app actually shows if needed.
function isPlausibleUtr(utr) {
  if (typeof utr !== "string") return false;
  const cleaned = utr.trim();
  return /^[A-Za-z0-9]{10,22}$/.test(cleaned);
}

function buildUpiQrUrl(upiId, payeeName, amount, orderId) {
  const upiUri =
    `upi://pay?pa=${encodeURIComponent(upiId)}` +
    `&pn=${encodeURIComponent(payeeName)}` +
    `&am=${encodeURIComponent(amount)}` +
    `&cu=INR` +
    `&tn=${encodeURIComponent(orderId)}`;

  // Renders an actual scannable QR image via a free QR image service.
  return `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(upiUri)}`;
}

module.exports = { checkApiKey, checkAdminKey, genOrderId, isPlausibleUtr, buildUpiQrUrl };

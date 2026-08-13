const { google } = require("googleapis");

function getGmailClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

// Extracts an amount like "Rs. 2.00" / "₹2" / "INR 2.00" from an email body.
function extractAmount(text) {
  const match = text.match(/(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?)/i);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ""));
}

function decodeBody(payload) {
  let data = "";

  function walk(part) {
    if (!part) return;
    if (part.body && part.body.data) {
      data += Buffer.from(part.body.data, "base64").toString("utf-8");
    }
    if (part.parts) {
      part.parts.forEach(walk);
    }
  }

  walk(payload);
  return data;
}

/**
 * Searches the last `maxResults` emails for one containing the given UTR.
 * Returns { found, amount, subject, date } or { found: false }.
 *
 * IMPORTANT: Adjust the Gmail search query below to match how FamPay's
 * actual notification emails look in your inbox (sender address / subject
 * keyword), so you're not scanning irrelevant emails.
 */
async function findUtrInEmail(utr, { maxResults = 100 } = {}) {
  const gmail = getGmailClient();

  // Narrow this down once you've checked your inbox — e.g.
  // `from:noreply@fampay.in "${utr}"` is far more precise than a bare search.
  const query = `"${utr}"`;

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messages = listRes.data.messages || [];
  if (messages.length === 0) {
    return { found: false, scanned: 0 };
  }

  for (const m of messages) {
    const msgRes = await gmail.users.messages.get({
      userId: "me",
      id: m.id,
      format: "full",
    });

    const payload = msgRes.data.payload;
    const bodyText = decodeBody(payload) || msgRes.data.snippet || "";

    if (bodyText.includes(utr)) {
      const headers = payload.headers || [];
      const subject = (headers.find((h) => h.name === "Subject") || {}).value || "";
      const date = (headers.find((h) => h.name === "Date") || {}).value || "";

      return {
        found: true,
        amount: extractAmount(bodyText),
        subject,
        date,
        scanned: messages.length,
      };
    }
  }

  return { found: false, scanned: messages.length };
}

module.exports = { findUtrInEmail };

const { ImapFlow } = require("imapflow");

function extractAmount(text) {
  const match = text.match(/(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?)/i);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ""));
}

/**
 * Connects to Gmail via IMAP using an App Password (not OAuth), searches
 * the last `limit` emails for the given UTR text, and returns whether it
 * was found plus the amount mentioned in that email (if parseable).
 *
 * Pass `email`/`password` explicitly to check a specific inbox, or omit
 * them to fall back to GMAIL_EMAIL + GMAIL_APP_PASSWORD env vars.
 * Generate an App Password at https://myaccount.google.com/apppasswords
 * (needs 2FA enabled on the Google account first).
 */
async function checkUtrViaImap(utr, { limit = 100, email, password } = {}) {
  const user = email || process.env.GMAIL_EMAIL;
  const pass = password || process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error("Gmail email/app password not provided (and no env var fallback set)");
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Search the most recent `limit` messages, newest first.
      const total = client.mailbox.exists;
      const start = Math.max(1, total - limit + 1);

      for (let seq = total; seq >= start; seq--) {
        const message = await client.fetchOne(String(seq), { source: true });
        if (!message || !message.source) continue;

        const text = message.source.toString("utf-8");
        if (text.includes(utr)) {
          return {
            found: true,
            amount: extractAmount(text),
            scanned: total - seq + 1,
          };
        }
      }

      return { found: false, scanned: total - start + 1 };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

module.exports = { checkUtrViaImap };

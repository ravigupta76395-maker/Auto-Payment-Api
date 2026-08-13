# Deposit Gateway (Vercel + MongoDB Atlas)

A UTR-based UPI deposit gateway you can call from a Telegram bot (e.g. Telebot
Creator's TPY, or any Node/Python bot). Deposits are **manually approved**
by you — there is no automatic bank/UPI verification, because no public,
authorized API exists for that. This is the safest and only reliable option
without buying a real payment gateway (Razorpay/Cashfree/PayU) subscription.

## How it works

1. User asks bot to deposit ₹X → bot calls `POST /api/create-order` → gets
   `order_id` + a scannable UPI QR image.
2. User pays and gets a UTR/Reference number from their UPI app.
3. User sends the UTR to the bot → bot calls `POST /api/submit-utr`.
   - If that UTR was already used on ANY previous order → instantly
     rejected as `already_used`.
   - Otherwise the UTR is reserved and the gateway **automatically searches
     your Gmail inbox** (the one linked to your FamPay account) for a
     transaction email containing that UTR.
     - **Found + amount matches** → order is auto-`approved` immediately.
     - **Found but amount doesn't match** → sent to `pending_review` (not
       auto-trusted, in case of a partial/wrong payment).
     - **Not found yet** (email delayed) → stays `pending_review`, bot can
       poll `/api/status` or resubmit later, and you still have manual
       fallback below.
4. For anything not auto-approved, you check your bank/UPI app yourself and
   call `POST /api/admin/decision` with `approve` or `reject`.
   - On `approve`, the API tells you the `bot_id`, `user_id`, and `amount`
     to credit — **your bot code performs the actual balance credit**,
     this gateway only tracks payment state, it doesn't hold your bot's
     user balances.
   - On `reject`, the UTR reservation is released so the user can submit
     a corrected UTR.

## Gmail API setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create
   a project → enable the **Gmail API**.
2. Create OAuth 2.0 credentials (OAuth client ID → "Desktop app" type) →
   note the **Client ID** and **Client Secret**.
3. Get a refresh token for the Gmail account linked to your FamPay
   notifications, using the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/):
   - Click the gear icon → check "Use your own OAuth credentials" → paste
     your Client ID/Secret.
   - In the scope box on the left, enter
     `https://www.googleapis.com/auth/gmail.readonly` → Authorize → sign in
     with the Gmail account that receives your FamPay emails.
   - Click "Exchange authorization code for tokens" → copy the
     **Refresh token**.
4. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`
   into your Vercel environment variables.
5. **Important:** open one of your actual FamPay transaction emails and
   check its sender address / subject line, then tighten the search query
   in `lib/gmail.js` (the `query` variable) to something like
   `from:notifications@fampay.in "${utr}"` — searching by bare UTR text
   across your whole inbox works but is slower and less precise.

## Setup

1. **MongoDB Atlas**: create a free cluster → create a database user →
   whitelist `0.0.0.0/0` (or Vercel's IPs) under Network Access → copy the
   connection string into `MONGODB_URI`.
2. **Vercel**: `vercel deploy` this folder, or connect the repo in the
   Vercel dashboard. Add all variables from `.env.example` under
   Project Settings → Environment Variables.
3. Note your deployed URL, e.g. `https://your-project.vercel.app`.

## Endpoints

| Endpoint | Method | Auth header | Purpose |
|---|---|---|---|
| `/api/create-order` | POST | `x-api-key` | Start a deposit, get QR |
| `/api/submit-utr` | POST | `x-api-key` | User submits UTR (OAuth email check) |
| `/api/status` | GET | `x-api-key` | Poll an order's state |
| `/api/admin/decision` | POST | `x-admin-key` | Approve/reject (admin only) |
| `/api/pass/utr` | GET/POST | `x-api-key` | Standalone UTR check via App Password (IMAP) |

`x-api-key` = `GATEWAY_API_KEY`, `x-admin-key` = `ADMIN_KEY` — never give the
admin key to the bot users, only to your admin panel/bot.

## App Password setup (for `/api/pass/utr`)

This is a simpler alternative to the OAuth flow above — no Google Cloud
project needed, just an App Password on the Gmail account linked to your
FamPay notifications:

1. Turn on **2-Step Verification** on that Google account if it isn't
   already (App Passwords require it): https://myaccount.google.com/security
2. Go to https://myaccount.google.com/apppasswords
3. Create a new app password (name it anything, e.g. "deposit-gateway") →
   Google gives you a 16-character password like `abcd efgh ijkl mnop`.
4. In Vercel, add:
   ```
   GMAIL_EMAIL=youraccount@gmail.com
   GMAIL_APP_PASSWORD=abcdefghijklmnop   (remove the spaces)
   ```
5. Redeploy. Test with:
   ```
   GET https://your-project.vercel.app/api/pass/utr?utr=YOUR_TEST_UTR
   Header: x-api-key: GATEWAY_API_KEY
   ```

Response format:
```json
{
  "verified": true,
  "utr": "368478944567",
  "amount": 2.0,
  "message": "UTR found and verified via email.",
  "dev": "@MAKERBOTRAVIII",
  "time": 1.42
}
```

If already used:
```json
{
  "verified": false,
  "utr": "368478944567",
  "message": "This UTR has already been used/claimed before.",
  "dev": "@MAKERBOTRAVIII",
  "time": 0.31
}
```

If not found:
```json
{
  "verified": false,
  "utr": "368478944567",
  "message": "UTR not found in last 100 emails.",
  "dev": "@MAKERBOTRAVIII",
  "time": 12.85
}
```

**Note:** `/api/pass/utr` shares the same `used_utrs` duplicate-check
collection as `/api/submit-utr`/`/api/admin/decision`, so a UTR claimed
through one endpoint can't be claimed again through the other.

## TPY (Telebot Creator) example — user-facing bot

```python
# /deposit command, after asking the user for an amount and storing it
# as options["amount"] via handleNextCommand

resp = HTTP.post(
    "https://your-project.vercel.app/api/create-order",
    headers={"x-api-key": "GATEWAY_API_KEY_HERE", "Content-Type": "application/json"},
    json={"bot_id": bot_id, "user_id": u, "amount": options["amount"]}
)
data = bf_json(resp.text)

if data["status"] == "success":
    order = data["data"]
    User.saveData("pending_order_id", order["order_id"])
    bot.sendPhoto(
        u,
        photo=order["qr_url"],
        caption=f"Pay ₹{order['amount']} to {order['upi_id']}\n\nAfter paying, reply with your UTR/Reference number."
    )
    Bot.handleNextCommand(command="confirm_utr")
else:
    bot.sendMessage(u, "Could not start deposit, try again later.")
```

```python
# confirm_utr command — triggered by handleNextCommand above, `msg` = UTR text

order_id = User.getData("pending_order_id")

resp = HTTP.post(
    "https://your-project.vercel.app/api/submit-utr",
    headers={"x-api-key": "GATEWAY_API_KEY_HERE", "Content-Type": "application/json"},
    json={"order_id": order_id, "utr": msg}
)
data = bf_json(resp.text)

if data["status"] == "approved":
    # Verified automatically via email — credit balance right now.
    amount = data["amount"]
    current = User.getData(f"balance:{u}") or 0
    User.saveData(f"balance:{u}", float(current) + float(amount))
    bot.sendMessage(u, f"✅ Payment verified! ₹{amount} added to your balance.")
elif data["status"] == "pending_review":
    bot.sendMessage(u, "⏳ UTR received, verifying... you'll get a message once it's confirmed.")
    # Optionally schedule a re-check a minute later in case the email was delayed:
    Bot.runCommandAfter(timeout=60, command="recheck_deposit", options={"order_id": order_id})
elif data["status"] == "already_used":
    bot.sendMessage(u, "❌ This UTR has already been used to claim a deposit.")
elif data["status"] == "invalid":
    bot.sendMessage(u, "❌ Invalid UTR format, please check and try again.")
else:
    bot.sendMessage(u, "❌ Something went wrong, please try again or contact support.")
```

```python
# recheck_deposit command — re-polls status if the email hadn't arrived yet

order_id = options["order_id"]

resp = HTTP.get(
    f"https://your-project.vercel.app/api/status?order_id={order_id}",
    headers={"x-api-key": "GATEWAY_API_KEY_HERE"}
)
data = bf_json(resp.text)["data"]

if data["state"] == "approved":
    amount = data["amount"]
    current = User.getData(f"balance:{u}") or 0
    User.saveData(f"balance:{u}", float(current) + float(amount))
    bot.sendMessage(u, f"✅ Payment verified! ₹{amount} added to your balance.")
elif data["state"] == "pending_review":
    bot.sendMessage(u, "⏳ Still verifying, please wait — an admin will confirm shortly if needed.")
```

## TPY example — your admin bot (approve/reject)

Send yourself a message with the order details and two inline buttons whose
`callback_data` encode `approve:<order_id>` / `reject:<order_id>`. On the
callback handler:

```python
action, order_id = params.split(":")  # params = callback_data here

resp = HTTP.post(
    "https://your-project.vercel.app/api/admin/decision",
    headers={"x-admin-key": "ADMIN_KEY_HERE", "Content-Type": "application/json"},
    json={"order_id": order_id, "action": "approve" if action == "approve" else "reject"}
)
data = bf_json(resp.text)

if data["status"] == "approved":
    # THIS is where you actually add balance in your bot's own storage
    target_user = data["user_id"]
    amount = data["amount"]
    current = User.getData(f"balance:{target_user}") or 0
    User.saveData(f"balance:{target_user}", float(current) + float(amount))
    bot.sendMessage(target_user, f"✅ Your deposit of ₹{amount} has been approved and added to your balance.")
    bot.answerCallbackQuery(callback_query_id=message.callback_query.id, text="Approved")
elif data["status"] == "rejected":
    bot.answerCallbackQuery(callback_query_id=message.callback_query.id, text="Rejected")
```

## Notes / limitations

- **No automatic bank verification.** This is intentional — every "auto UTR
  checker" that isn't a licensed payment gateway (Razorpay, Cashfree, PayU,
  Instamojo UPI Collect) works by scraping someone's personal banking app
  or SMS without authorization, which is unreliable and risky. If you want
  true automatic verification later, swap the manual-approval step for a
  real gateway's payment-status API — the `orders` collection and endpoints
  here don't need to change much.
- **UTR format regex** in `lib/utils.js` (`isPlausibleUtr`) is a loose
  sanity check (10-22 alphanumeric characters), not real validation — tighten
  it to match exactly what your UPI app displays if you want stricter input
  checks.
- Add rate-limiting (e.g. Vercel's built-in or a simple per-user cooldown in
  Mongo) if you're worried about people spamming fake UTRs.

# Fetching your Paddle + Google login credentials

Paddle is a **Merchant of Record** — it supports Israeli sellers, pays out to your Israeli bank, and
handles all sales tax/VAT for you. Do the steps, paste the values into `app/.env` (NOT into chat),
restart the server, and tell Claude "keys are in". Start in **Sandbox** so we can test with fake cards.

---

## 1) Paddle — payments + change top-ups

### A. Account (Sandbox first)
1. Go to **https://sandbox-login.paddle.com/signup** and create a **sandbox** account (for production later: paddle.com). Choose **Israel** as the business country — it's supported.
2. You're now in the Paddle **sandbox** dashboard (test mode).

### B. Create your products + prices  →  the `pri_…` IDs
Catalog → **Products** → **New product** for each, then add a **price** to each:

| Product name | Price | Billing | → `.env` variable |
|---|---|---|---|
| Storefronty Starter | $29.00 USD | Recurring, monthly | `PADDLE_PRICE_STARTER` |
| Storefronty Pro | $49.00 USD | Recurring, monthly | `PADDLE_PRICE_PRO` |
| Storefronty Premium | $99.00 USD | Recurring, monthly | `PADDLE_PRICE_PREMIUM` |
| 5 extra changes | $19.00 USD | One-time | `PADDLE_PRICE_PACK5` |
| 15 extra changes | $45.00 USD | One-time | `PADDLE_PRICE_PACK15` |

Each price has an ID like **`pri_01h…`** — copy each into the matching variable.

### C. Tokens  →  `PADDLE_CLIENT_TOKEN` + `PADDLE_API_KEY`
Developer Tools → **Authentication**:
- **Client-side token** (starts `live_…`/`test_…`) → `PADDLE_CLIENT_TOKEN` — this is public; the checkout overlay uses it in the browser.
- **API key** (secret) → `PADDLE_API_KEY` — keep private.

### D. Webhook  →  `PADDLE_WEBHOOK_SECRET`
Developer Tools → **Notifications** → **New destination**:
1. URL: `https://<your-domain>/paddle/webhook` (for local testing, use a tunnel like **ngrok** → `https://xxxx.ngrok.io/paddle/webhook`, or Paddle's "Simulate" button in the dashboard).
2. Subscribe to events: **`subscription.activated`**, **`subscription.canceled`**, **`transaction.completed`**.
3. Save → open the destination → copy its **secret key** (`pdl_ntfset_…` / `ntfset…`) → `PADDLE_WEBHOOK_SECRET`.

### E. Approve `localhost` for the overlay
Checkout settings → **Approved domains** (or "default payment link") → add `localhost` so the checkout overlay can open on the dev site. (Add your real domain later.)

> Sandbox test card: `4242 4242 4242 4242`, any future date/CVC. When you're verified and ready for real money, repeat B–E in the **production** dashboard and set `PADDLE_ENV=production` + the live tokens/price IDs.

---

## 2) Google — "Log in with Google" (works fine from Israel)

1. **https://console.cloud.google.com** → top bar → **New Project** "Storefronty" → create + select it.
2. **APIs & Services → OAuth consent screen** → **External** → app name `Storefronty` + your email → save. Add your own Gmail as a **Test user**.
3. **APIs & Services → Credentials → + Create credentials → OAuth client ID** → **Web application** → under **Authorized redirect URIs** add exactly:
   ```
   http://localhost:4173/auth/google/callback
   ```
   → **Create**. Copy the **Client ID** (`…apps.googleusercontent.com` → `GOOGLE_CLIENT_ID`) and **Client secret** (`GOCSPX-…` → `GOOGLE_CLIENT_SECRET`).

---

## 3) Put them in `app/.env`

Open `C:\Users\Owner\Documents\Storefronty\app\.env` and add (with your real values):

```dotenv
# --- payments (Paddle) ---
PADDLE_ENV=sandbox
PADDLE_CLIENT_TOKEN=test_xxxxx
PADDLE_API_KEY=xxxxx
PADDLE_WEBHOOK_SECRET=pdl_ntfset_xxxxx
PADDLE_PRICE_STARTER=pri_xxxxx
PADDLE_PRICE_PRO=pri_xxxxx
PADDLE_PRICE_PREMIUM=pri_xxxxx
PADDLE_PRICE_PACK5=pri_xxxxx
PADDLE_PRICE_PACK15=pri_xxxxx

# --- google login ---
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
```

Save it (`.env` is gitignored), then tell Claude **"keys are in"** and he'll restart + test the whole
flow (a sandbox checkout with the 4242 card, and Google login with your test account).

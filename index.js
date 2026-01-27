const express = require("express");
const crypto = require("crypto");

const app = express();

const {
  SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET,
  SLACK_REDIRECT_URI,
  STATE_SECRET,
} = process.env;

if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET || !SLACK_REDIRECT_URI || !STATE_SECRET) {
  console.error("Missing env vars. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_REDIRECT_URI, STATE_SECRET.");
}

function makeState() {
  const nonce = crypto.randomBytes(16).toString("hex");
  const sig = crypto.createHmac("sha256", STATE_SECRET).update(nonce).digest("hex");
  return `${nonce}.${sig}`;
}

function verifyState(state) {
  if (!state || !state.includes(".")) return false;
  const [nonce, sig] = state.split(".");
  const expected = crypto.createHmac("sha256", STATE_SECRET).update(nonce).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

app.get("/health", (req, res) => res.status(200).send("ok"));

/**
 * Start OAuth install (Enterprise owner opens this)
 * We request USER token scope via user_scope=auditlogs:read
 */
app.get("/slack/install", (req, res) => {
  const state = makeState();

  const params = new URLSearchParams({
    client_id: SLACK_CLIENT_ID,
    redirect_uri: SLACK_REDIRECT_URI,
    user_scope: "auditlogs:read",
    state,
  });

  // Slack OAuth v2 authorize endpoint
  const url = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  res.redirect(url);
});

app.get("/slack/oauth/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) return res.status(400).send(`Slack returned error: ${error}`);
    if (!code) return res.status(400).send("Missing ?code from Slack.");
    if (!verifyState(state)) return res.status(400).send("Invalid state. Possible CSRF.");

    // Exchange code for token
    const body = new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code: String(code),
      redirect_uri: SLACK_REDIRECT_URI,
    });

    const r = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await r.json();

    if (!data.ok) {
      return res.status(400).send(`oauth.v2.access failed: ${JSON.stringify(data)}`);
    }

    // IMPORTANT: Audit Logs needs USER token (xoxp...), usually in authed_user.access_token
    const userToken = data?.authed_user?.access_token;
    const isEnterpriseInstall = data?.is_enterprise_install;

    res
      .status(200)
      .type("text")
      .send(
        [
          "OAuth success.",
          `is_enterprise_install: ${isEnterpriseInstall}`,
          "",
          "COPY THIS USER TOKEN (xoxp-...) and store it securely:",
          String(userToken || "NO authed_user.access_token FOUND"),
          "",
          "You can now use this token to call: https://api.slack.com/audit/v1/logs",
        ].join("\n")
      );
  } catch (e) {
    console.error(e);
    res.status(500).send("Server error. Check App Service logs.");
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));
